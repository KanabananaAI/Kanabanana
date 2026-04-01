import express, { Request, Response, NextFunction } from 'express';
import { createServer } from 'http';
import helmet from 'helmet';
import rateLimit from 'express-rate-limit';
import { v4 as uuidv4 } from 'uuid';
import { Server as SocketServer, Socket } from 'socket.io';
import path from 'path';
import { existsSync, mkdirSync, writeFileSync, readFileSync, readdirSync, unlinkSync, statSync } from 'fs';
import { fileURLToPath } from 'url';
import { spawn } from 'child_process';
import * as pty from '@lydell/node-pty';
import { parseTokenUsage } from './token-parser.js';
import { createChat, getChatByWorkspace, closeChat, closeAllActiveChats } from './db.js';
import * as bus from './message-bus.js';
import { initBus } from './message-bus.js';

/**
 * Finalize a task's state when an agent finishes its work or verification.
 * This function handles moving the task to the appropriate column (review/done),
 * updating the database, notifying the client, and optionally notifying the orchestrator.
 */
function finalizeTask(taskId: string, exitCode: number | undefined, isVerified: boolean): void {
  const now = new Date().toISOString();
  const currentTask = db.prepare('SELECT * FROM tasks WHERE id = ?').get(taskId) as any;
  const currentColumn = currentTask?.column || 'in-progress';

  // Break infinite verification loops
  const verificationCount = verificationAttempts.get(taskId) || 0;
  if (isVerified && exitCode !== 0 && exitCode !== undefined) {
    verificationAttempts.set(taskId, verificationCount + 1);
  } else if (isVerified && exitCode === 0) {
    // Successful verification — clear counter, task is going to done
    verificationAttempts.delete(taskId);
  }
  // Non-verified exitCode=0 (normal completion) does NOT reset the counter —
  // prevents verify loops where the counter resets before auto-verify re-triggers.

  // Verified completions (from inspect) go to done.
  // Non-verified: if auto_review enabled → 'inspect' (auto-verification), else → 'review' (human review).
  const taskAutoReview = Boolean(currentTask?.auto_review);
  let targetColumn = isVerified ? 'done' : (taskAutoReview ? 'inspect' : 'review');

  // Block moving to done without a walkthrough file
  if (targetColumn === 'done') {
    const walkthroughPath = path.join(WALKTHROUGH_DIR, `${taskId}.md`);
    if (!existsSync(walkthroughPath)) {
      console.warn(`[kanaban] Blocking move to done — no walkthrough for task=${taskId.slice(0, 8)}, falling back to review`);
      targetColumn = 'review';
    }
  }

  // Only move to review/inspect if task is currently in a work column.
  // Prevents overriding a column that was already changed (e.g. user dragged to backlog).
  const workColumns = ['in-progress', 'inspect'];
  if ((targetColumn === 'review' || targetColumn === 'inspect') && !workColumns.includes(currentColumn)) {
    console.log(`[kanaban] finalizeTask: task ${taskId.slice(0, 8)} is in '${currentColumn}', not in a work column — skipping move, resetting status to idle`);
    db.prepare('UPDATE tasks SET status = ?, updated_at = ? WHERE id = ?')
      .run('idle', now, taskId);
    broadcastTask(taskId);
    broadcastSessions();
    return;
  }

  const targetStatus = targetColumn === 'done' ? 'done' : 'idle';

  // Parse token usage from PTY output before potentially killing the session
  const rawOutput = ptyManager.getOutputBuffer(taskId) || '';
  const tokenUsage = parseTokenUsage(rawOutput);
  if (tokenUsage.totalTokens > 0) {
    // Accumulate tokens (task may have been restarted/verified multiple times)
    db.prepare(`UPDATE tasks SET
      input_tokens = input_tokens + ?,
      output_tokens = output_tokens + ?,
      cache_read_tokens = cache_read_tokens + ?,
      cache_write_tokens = cache_write_tokens + ?,
      total_tokens = total_tokens + ?
      WHERE id = ?`).run(
      tokenUsage.inputTokens,
      tokenUsage.outputTokens,
      tokenUsage.cacheReadTokens,
      tokenUsage.cacheWriteTokens,
      tokenUsage.totalTokens,
      taskId
    );
    console.log(`[kanaban:tokens] Task ${taskId.slice(0, 8)} tokens: +${tokenUsage.totalTokens} (in=${tokenUsage.inputTokens}, out=${tokenUsage.outputTokens})`);
  }

  if (targetColumn === 'done') {
    db.prepare('UPDATE tasks SET status = ?, "column" = ?, updated_at = ?, completed_at = ? WHERE id = ?')
      .run(targetStatus, targetColumn, now, now, taskId);
    // Auto-complete all checklist items when task moves to done
    db.prepare('UPDATE checklist_items SET done = 1 WHERE task_id = ? AND done = 0')
      .run(taskId);

    // If specifically moving to done, we should kill the PTY
    if (ptyManager.hasSession(taskId)) {
      console.log(`[kanaban] Task ${taskId.slice(0, 8)} moved to DONE — killing PTY`);
      ptyManager.kill(taskId);
    }
    // Delete persisted session file — task is done, no need to keep it
    ptyManager.deleteSessionFile(taskId);
  } else {
    db.prepare('UPDATE tasks SET status = ?, "column" = ?, updated_at = ? WHERE id = ?')
      .run(targetStatus, targetColumn, now, taskId);
  }

  // Broadcast updated task so clients move the card in real-time
  broadcastTask(taskId);

  notifications.emit(io, {
    type: 'completed',
    taskId: taskId,
    data: { title: currentTask?.title, exitCode, verified: isVerified },
  });

  emitOrchestratorActivity(
    targetColumn === 'done' ? 'task-completed' : 'task-review',
    `"${currentTask?.title || taskId.slice(0, 8)}" → ${targetColumn}${isVerified ? ' (AI verified)' : ''}`,
    { taskId, column: targetColumn, exitCode },
    'system'
  );

  // Auto-trigger verification when a task lands in 'inspect' column
  if (targetColumn === 'inspect' && !isVerified) {
    const wasDelegated = delegatedTasks.has(taskId) || Boolean(currentTask?.delegated);
    const agentType = currentTask?.agent_type || 'generic';
    const vAttempts = verificationAttempts.get(taskId) || 0;

    if (wasDelegated) {
      console.log(`[kanaban:verify] Skipping auto-verify for delegated task ${taskId.slice(0, 8)}`);
    } else if (agentType === 'generic' && !currentTask?.command) {
      console.log(`[kanaban:verify] Skipping auto-verify for generic task ${taskId.slice(0, 8)} (no command)`);
    } else if (vAttempts >= 3) {
      console.log(`[kanaban:verify] Skipping auto-verify for task ${taskId.slice(0, 8)} — max attempts reached (${vAttempts}), moving to review`);
      db.prepare('UPDATE tasks SET "column" = ?, updated_at = ? WHERE id = ?').run('review', now, taskId);
      broadcastTask(taskId);
    } else {
      console.log(`[kanaban:verify] Auto-triggering inspection for task ${taskId.slice(0, 8)} (attempt ${vAttempts + 1})`);
      setTimeout(() => {
        verifyTaskAgent(taskId);
      }, 2000);
    }
  }

  // Auto-notify orchestrator with walkthrough + board state
  if (orchestratorRunning && orchestratorPty) {
    const walkthroughPath = path.join(WALKTHROUGH_DIR, `${taskId}.md`);
    let walkthroughContent = '';
    if (existsSync(walkthroughPath)) {
      walkthroughContent = readFileSync(walkthroughPath, 'utf-8');
    }

    const boardState = getKanbanStateSummary(undefined);
    const notification = [
      isVerified ? `[KANABAN EVENT: Task Verified & Completed by AI]` : `[KANABAN EVENT: Task Completed]`,
      `Task: "${currentTask?.title}" (id: ${taskId.slice(0, 8)})`,
      `Agent: ${currentTask?.agent_type || 'unknown'}`,
      `Exit Code: ${exitCode ?? 'N/A'}`,
      `Column: ${targetColumn}`,
      ``,
      `### Walkthrough`,
      walkthroughContent || '(no walkthrough available)',
      ``,
      boardState,
      ``,
      targetColumn === 'done'
        ? `This task is already in the "done" column. DO NOT move it back to review or in-progress.\n- Spawn the next priority task from backlog/todo.`
        : `This task is now in "review" and requires verification. You MUST trigger it:\n  curl -s -X POST http://localhost:3001/api/tasks/${taskId}/verify\nDO NOT move this task to "done" yourself.`,
    ].join('\n');

    setTimeout(() => {
      notifyOrchestrator(notification);
    }, 2000);
  }

  // Notify parent task's orchestrator if this is a sub-task
  const parentTaskId = currentTask?.parent_task_id;
  if (parentTaskId && delegatedTasks.has(parentTaskId) && ptyManager.hasSession(parentTaskId)) {
    const walkthroughPath = path.join(WALKTHROUGH_DIR, `${taskId}.md`);
    let walkthroughContent = '';
    if (existsSync(walkthroughPath)) {
      walkthroughContent = readFileSync(walkthroughPath, 'utf-8');
    }

    const boardState = getKanbanStateSummary(parentTaskId);
    const subNotification = [
      isVerified ? `[KANABAN EVENT: Sub-Task Verified & Completed]` : `[KANABAN EVENT: Sub-Task Completed]`,
      `Sub-Task: "${currentTask?.title}" (id: ${taskId.slice(0, 8)})`,
      `Agent: ${currentTask?.agent_type || 'unknown'}`,
      `Exit Code: ${exitCode ?? 'N/A'}`,
      `Column: ${targetColumn}`,
      ``,
      `### Walkthrough`,
      walkthroughContent || '(no walkthrough available)',
      ``,
      boardState,
      ``,
      isVerified
        ? `This sub-task has been verified and moved to "done". DO NOT move it back to review or in-progress.\nProceed with the next sub-task or check if all sub-tasks are complete.`
        : `This sub-task moved to review. You should verify it: curl -s -X POST http://localhost:3001/api/tasks/${taskId}/verify`,
    ].join('\n');

    setTimeout(() => {
      console.log(`[kanaban:delegate] Notifying parent orchestrator ${parentTaskId.slice(0, 8)} about sub-task ${taskId.slice(0, 8)} completion`);
      orchestratorNotificationQueue.push({ taskId: parentTaskId, message: subNotification + '\r' });
      processNotificationQueue();
    }, 2000);
  }

  broadcastSessions();

  // Check if any waitlisted tasks can now be spawned
  setTimeout(() => processWaitlist(), 1000);
}


const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PROJECT_ROOT = path.resolve(__dirname, '..');

import db from './db.js';
import taskRoutes from './routes/tasks.js';
import templateRoutes from './routes/templates.js';
import skillRoutes from './routes/skills.js';
import workspaceRoutes from './routes/workspaces.js';
import settingsRoutes from './routes/settings.js';
import lmstudioRoutes from './routes/lmstudio.js';
import planRoutes, { formatPlan } from './routes/plans.js';
import { PtyManager, PtyEvent } from './pty-manager.js';
import { checkAndTrigger } from './chain-manager.js';
import { NotificationManager } from './notifications.js';
import { getOrchestratorPrompt, getDelegatePrompt } from './orchestrator-prompt.js';
import { startHealthChecks, stopHealthChecks, resetHealthTracking, getHealthStatus } from './health-check.js';
import { startTaskScheduler, stopTaskScheduler } from './task-scheduler.js';
import scheduleRoutes from './routes/schedules.js';
import githubRoutes from './routes/github.js';
import {
  loadOrchestratorState, saveOrchestratorState, updateOrchestratorState,
  addActivity as persistActivity, getActivities as getPersistedActivities,
  updateOutputTail, getOutputTail, setOrchestratorStarted, setOrchestratorStopped,
  getPersistedProvider, getPersistedModel,
  type OrchestratorActivity as PersistedActivity,
} from './orchestrator-state.js';
import {
  validateEvent,
  TaskInputSchema, TaskResizeSchema, TaskSpawnSchema, TaskKillSchema,
  TaskFeedbackSchema, TaskVerifySchema, TaskDelegateSchema,
  OrchestratorSpawnSchema, OrchestratorInputSchema, OrchestratorResizeSchema,
  AgentChatSpawnSchema, AgentChatInputSchema, AgentChatKillSchema, AgentChatHistorySchema,
  type TaskInput, type OrchestratorSpawn, type OrchestratorInput,
} from './event-schemas.js';

const app = express();
const server = createServer(app);

// ---------- Completion Signal ----------

const COMPLETION_SIGNAL = 'KANABAN_TASK_COMPLETE';
const COMPLETION_COOLDOWN_MS = 15_000; // ignore signal for 15s after prompt injection completes (avoids echo + TUI rendering false-positive)

// Tracks when completion detection becomes active per task (timestamp)
const completionDetectionReady: Map<string, number> = new Map();

// Rolling buffer of ANSI-stripped output per task — only populated after cooldown
// Solves: signal split across PTY data chunks
const completionSignalBuffer: Map<string, string> = new Map();
const SIGNAL_BUFFER_SIZE = 1024; // Expanded to avoid truncation

// Track tasks currently being verified — on exit these go to 'done' instead of 'review'
const verifyingTasks: Set<string> = new Set();
// Track verification attempt counts to break infinite loops
const verificationAttempts: Map<string, number> = new Map();

// Track delegated tasks with active orchestrator PTYs
const delegatedTasks: Set<string> = new Set();

// Notification queue for orchestrators to avoid race conditions with their stdout
interface NotificationItem {
  taskId: string;
  message: string;
}
const orchestratorNotificationQueue: NotificationItem[] = [];


// Track last PTY output time per task — used to guard periodic check injections
const ptyLastOutputTime: Map<string, number> = new Map();

// Track tasks already finalized by the 30s safety-net completion scan
const completionScanFinalized: Set<string> = new Set();

// Track tasks whose completion was handled by the real-time signal detector (data handler).
// Prevents the PTY exit handler from calling finalizeTask again (which would trigger duplicate auto-verify).
const signalFinalizedTasks: Set<string> = new Set();

// Track when each task's PTY was last spawned — used to gate safety-net scan
// and prevent false positives from prompt echo in the output buffer.
const ptySpawnTime: Map<string, number> = new Map();
const SAFETY_NET_MIN_AGE_MS = 60_000; // don't scan output buffer for completion signal until 60s after spawn

// Track the output buffer length AFTER prompt injection echo settles.
// Non-TUI agents (e.g. lmstudio) echo the injected prompt to PTY output, which
// includes KANABAN_TASK_COMPLETE. The safety-net scan must skip this echoed portion
// to avoid false-positive finalization.
const postInjectionOffset: Map<string, number> = new Map();

// Spawn generation counter — prevents stale setTimeout callbacks from injecting
// prompts into a session that was already replaced by a newer spawn.
// Each spawn increments the counter; delayed callbacks compare their captured
// generation to the current one and become no-ops if they don't match.
const spawnGeneration: Map<string, number> = new Map();

// Track prompt injections currently being typed into PTYs to avoid interleaving/races
const promptInjectionInFlight: Set<string> = new Set();

// ---------- Planner State ----------

const PLAN_COMPLETE_SIGNAL = 'KANABAN_PLAN_COMPLETE';
const INTERVIEW_DONE_SIGNAL = 'KANABAN_INTERVIEW_DONE';
const MSG_START = 'KANABAN_MSG_START';
const MSG_END = 'KANABAN_MSG_END';
const GENERATE_NOW_MSG = "That's enough context. Skip remaining questions and proceed to Phase 2 now.";

// Maps ptySessionId ("plan:${planId}") -> planId
const activePlanners = new Map<string, string>();
// Accumulates ANSI-stripped output per planner session for JSON extraction
const plannerSignalBuffer = new Map<string, string>();
// Offset into plannerSignalBuffer from which unprocessed content starts.
// Set to buf.length after prompt injection so the echoed prompt is skipped.
const plannerMessageOffset = new Map<string, number>();

// ---------- Agent Chat State ----------

const activeChats = new Map<string, { chatId: string; workspaceId: string; agentType: string; model: string }>();

const isDev = process.env.NODE_ENV !== 'production';
const PORT = isDev ? 3001 : 3000;

// ---------- Socket.io ----------

const io = new SocketServer(server, {
  cors: isDev
    ? { origin: 'http://localhost:5173', methods: ['GET', 'POST'] }
    : undefined,
  pingTimeout: 60000,
  pingInterval: 25000,
});

// Initialize message bus
initBus(io);

// Bridge smart alerts from bus to socket clients
bus.on('bus:smart-alert', (msg) => {
  const socketIO = bus.getIO()
  if (socketIO) {
    socketIO.emit('orchestrator:smart-alert', {
      id: msg.id,
      severity: msg.payload?.severity || 'info',
      message: msg.payload?.message || '',
      taskId: msg.payload?.taskId || null,
      taskTitle: msg.payload?.taskTitle || null,
      timestamp: msg.timestamp,
    })
  }
})


// ---------- Middleware ----------

// Security headers
app.use(helmet({
  contentSecurityPolicy: isDev ? false : undefined,  // Disable CSP in dev (Vite needs inline scripts)
  crossOriginEmbedderPolicy: false,                  // Allow loading cross-origin resources (images, etc.)
}));

// Rate limiting — 100 requests per 15 minutes per IP
app.use('/api/', rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 200,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Too many requests, please try again later' },
}));

app.use(express.json({ limit: '50mb' }));

// Strip error details in production — catches any `detail` field in JSON error responses
app.use((_req: Request, res: Response, next: NextFunction) => {
  if (!isDev) {
    const originalJson = res.json.bind(res);
    res.json = function (body: any) {
      if (body && typeof body === 'object' && 'error' in body && 'detail' in body) {
        const { detail: _detail, ...safe } = body;
        return originalJson(safe);
      }
      return originalJson(body);
    };
  }
  next();
});

// In production, serve the client build
if (!isDev) {
  const clientDist = path.resolve(PROJECT_ROOT, 'client', 'dist');
  app.use(express.static(clientDist));
}

// ---------- API Routes ----------

app.set('io', io);
app.use(taskRoutes);
app.use(templateRoutes);
app.use(skillRoutes);
app.use(workspaceRoutes);
app.use(settingsRoutes);
app.use(lmstudioRoutes);
app.use(scheduleRoutes);
app.use(planRoutes);
app.use(githubRoutes);

// ---------- Broadcast Task Helper ----------

function broadcastTask(taskId: string): void {
  const task = db.prepare('SELECT * FROM tasks WHERE id = ?').get(taskId) as any;
  if (!task) return;

  const checklist = db.prepare('SELECT * FROM checklist_items WHERE task_id = ? ORDER BY position ASC').all(taskId) as any[];
  const nextSteps = db.prepare('SELECT * FROM next_steps WHERE task_id = ? ORDER BY created_at ASC').all(taskId) as any[];
  const deps = db.prepare('SELECT depends_on_id FROM task_dependencies WHERE task_id = ?').all(taskId) as any[];

  const tags = db.prepare(
    `SELECT t.id, t.name, t.color FROM tags t
     JOIN task_tags tt ON tt.tag_id = t.id
     WHERE tt.task_id = ?`
  ).all(taskId) as any[];

  const formatted = {
    id: task.id,
    title: task.title,
    description: task.description,
    column: task.column,
    position: task.position,
    agentType: task.agent_type,
    model: task.model || '',
    command: task.command,
    workingDir: task.working_dir || '',
    workspaceId: task.workspace_id || '',
    yolo: Boolean(task.yolo),
    autoReview: Boolean(task.auto_review),
    autoComplete: task.auto_complete !== 0,
    delegated: Boolean(task.delegated),
    parentTaskId: task.parent_task_id || '',
    status: task.status,
    assigneeId: task.assignee_id,
    templateId: task.template_id,
    createdAt: task.created_at,
    updatedAt: task.updated_at,
    completedAt: task.completed_at || null,
    checklistItems: checklist.map((item: any) => ({
      id: item.id,
      taskId: item.task_id,
      text: item.text,
      done: Boolean(item.done),
      source: item.source,
      position: item.position,
    })),
    nextSteps: nextSteps.map((step: any) => ({
      id: step.id,
      taskId: step.task_id,
      text: step.text,
      command: step.command,
      actioned: Boolean(step.actioned),
    })),
    dependsOn: deps.map((d: any) => d.depends_on_id),
    images: (db.prepare('SELECT * FROM task_images WHERE task_id = ? ORDER BY created_at ASC').all(taskId) as any[]).map((img: any) => ({
      id: img.id,
      taskId: img.task_id,
      filename: img.filename,
      originalName: img.original_name,
      mimeType: img.mime_type,
      size: img.size,
    })),
    tags: tags.map((tag: any) => ({
      id: tag.id,
      name: tag.name,
      color: tag.color,
    })),
    archived: Boolean(task.archived),
    pastedText: task.pasted_text || '',
    waitlisted: Boolean(task.waitlisted),
    inputTokens: task.input_tokens || 0,
    outputTokens: task.output_tokens || 0,
    cacheReadTokens: task.cache_read_tokens || 0,
    cacheWriteTokens: task.cache_write_tokens || 0,
    totalTokens: task.total_tokens || 0,
    schedule: (() => {
      const s = db.prepare('SELECT * FROM task_schedules WHERE task_id = ?').get(taskId) as any;
      if (!s) return null;
      return {
        id: s.id,
        taskId: s.task_id,
        scheduledAt: s.scheduled_at,
        recurrenceIntervalMinutes: s.recurrence_interval_minutes,
        maxExecutions: s.max_executions,
        executionsCompleted: s.executions_completed,
        isActive: Boolean(s.is_active),
      };
    })(),
  };

  const connectedClients = io.engine?.clientsCount ?? io.sockets?.sockets?.size ?? '?';
  console.log(`[kanaban:broadcast] task:updated id=${taskId.slice(0, 8)} title="${formatted.title}" column=${formatted.column} status=${formatted.status} clients=${connectedClients}`);
  io.emit('task:updated', formatted);
  // Lightweight signal so clients can detect missed full events and re-fetch
  io.emit('tasks:changed', { taskId, timestamp: Date.now() });
  bus.emit('bus:board-event', 'server', null, formatted);
}

// ---------- Waitlist Processing ----------

/**
 * Check for waitlisted tasks in the in-progress column that should be spawned.
 * A waitlisted task only starts when ALL other in-progress tasks have finished.
 * Multiple waitlisted tasks stack up — they spawn one at a time in position order.
 */
function processWaitlist(): void {
  // Get all tasks currently in the in-progress column
  const inProgressTasks = db.prepare(
    `SELECT * FROM tasks WHERE "column" = 'in-progress' AND (archived = 0 OR archived IS NULL)`
  ).all() as any[];

  // Count actively running tasks — must have a live PTY session to be considered active.
  // Status alone is unreliable (ghost tasks keep stale status after PTY dies).
  const activeTasks = inProgressTasks.filter(
    (t: any) => ptyManager.hasSession(t.id)
  );

  if (activeTasks.length > 0) {
    console.log(`[kanaban:waitlist] ${activeTasks.length} active task(s) still running — waiting`);
    return;
  }

  // Find the next waitlisted task that is idle and ready to spawn from the scheduled column
  // Sort by updated_at (= when task was dropped into scheduled) so first-dropped starts first
  const scheduledTasks = db.prepare(
    `SELECT * FROM tasks WHERE "column" = 'scheduled' AND waitlisted = 1 AND status = 'idle' AND (archived = 0 OR archived IS NULL)`
  ).all() as any[];

  const waitingTasks = scheduledTasks
    .filter((t: any) => !ptyManager.hasSession(t.id))
    .sort((a: any, b: any) => (a.updated_at || '').localeCompare(b.updated_at || ''));

  if (waitingTasks.length === 0) {
    console.log(`[kanaban:waitlist] No waitlisted tasks to process`);
    return;
  }

  const nextTask = waitingTasks[0];
  console.log(`[kanaban:waitlist] Spawning next waitlisted task: "${nextTask.title}" (id=${nextTask.id.slice(0, 8)})`);
  spawnTaskAgent(nextTask.id, { source: 'system' });
}

// ---------- Agent Auto-Command ----------

const agentCliCommands: Record<string, string> = {
  claude: 'claude',
  kilo: 'kilo',
  lmstudio: `tsx ${path.join(__dirname, 'lmstudio-agent.ts').replace(/\\/g, '/')}`,
  // Legacy agent types (backwards compat with existing tasks)
  qwen: 'qwen',
  gemini: 'gemini',
  droid: 'aider',
  generic: '',
};

// YOLO mode flags: auto-accept all agent queries
const yoloFlags: Record<string, string> = {
  claude: '--dangerously-skip-permissions',
  kilo: '--auto',
  qwen: '--yolo',
  gemini: '--yolo',
  droid: '--yes',
};

// Agents whose TUI needs text and Enter sent separately (e.g. multi-line editors)
const SPLIT_ENTER_AGENTS = new Set(['claude', 'kilo', 'qwen', 'gemini']);

// Agents that support --continue flag (resume last conversation instead of starting fresh)
const CONTINUE_FLAG_AGENTS = new Set(['claude', 'kilo']);

/**
 * Write a prompt to an agent's PTY and submit it.
 * For agents with multi-line TUI editors (e.g. qwen), the Enter keystroke
 * is sent separately after a short delay so the TUI registers it as "submit"
 * rather than "newline".
 */
function writePromptAndSubmit(taskId: string, prompt: string, agentType: string): Promise<boolean> {
  if (promptInjectionInFlight.has(taskId)) {
    console.log(`[kanaban:pty] Skipping writePromptAndSubmit for ${taskId.slice(0, 8)} — injection already in-flight`);
    return Promise.resolve(false);
  }

  promptInjectionInFlight.add(taskId);
  console.log(`[kanaban:pty] Starting prompt injection for ${taskId.slice(0, 8)} (${prompt.length} chars)`);

  const cleanup = (ok: boolean) => {
    promptInjectionInFlight.delete(taskId);
    return ok;
  };

  // Agents with bracketed paste mode enabled (TUI text editors where \n = submit)
  // Wrap prompt in paste brackets so newlines are treated as text, not Enter
  const BRACKETED_PASTE_AGENTS = new Set(['claude', 'kilo', 'gemini', 'qwen']);
  const useBracketedPaste = BRACKETED_PASTE_AGENTS.has(agentType);

  if (SPLIT_ENTER_AGENTS.has(agentType)) {
    const enterDelay = agentType === 'gemini' ? 1500 : 500;
    // Wrap in bracketed paste to prevent newlines from triggering submit
    const pasteStart = useBracketedPaste ? '\x1b[200~' : '';
    const pasteEnd = useBracketedPaste ? '\x1b[201~' : '';
    const payload = pasteStart + prompt + pasteEnd;
    return ptyManager.writeChunked(taskId, payload).then((ok) => {
      if (!ok) { console.log(`[kanaban:pty] writeChunked returned false for ${taskId.slice(0, 8)}`); return cleanup(false); }
      console.log(`[kanaban:pty] Text written (paste=${useBracketedPaste}), scheduling Enter in ${enterDelay}ms for ${taskId.slice(0, 8)}`);
      return new Promise<boolean>(resolve => {
        setTimeout(() => {
          const enterOk = ptyManager.write(taskId, '\r');
          console.log(`[kanaban:pty] Enter sent for ${taskId.slice(0, 8)}: ${enterOk}`);
          resolve(cleanup(enterOk));
        }, enterDelay);
      });
    }).catch(err => { console.error(`[kanaban:pty] writeChunked error for ${taskId.slice(0, 8)}:`, err); return cleanup(false); });
  }
  return ptyManager.writeChunked(taskId, prompt + '\r').then(cleanup).catch(err => cleanup(false));
}

function buildTaskPrompt(taskRow: any): string {
  const parts: string[] = [];
  parts.push(`Task: ${taskRow.title}`);

  // Include working directory constraint if workspace or working dir is set
  const effectiveDir = getEffectiveWorkingDir(taskRow);
  if (effectiveDir) {
    parts.push(`\nWorking Directory: ${effectiveDir}`);
    parts.push('IMPORTANT: You must operate exclusively within this working directory. Do not access or modify files outside of this directory.');
  }

  if (taskRow.description) {
    parts.push(`\nDescription:\n${taskRow.description}`);
  }

  if (taskRow.pasted_text) {
    parts.push(`\nPasted Text (reference material provided by the user):\n<pasted_text>\n${taskRow.pasted_text}\n</pasted_text>`);
  }

  const checklist = db.prepare(
    'SELECT text, done FROM checklist_items WHERE task_id = ? ORDER BY position'
  ).all(taskRow.id) as { text: string; done: number }[];

  if (checklist.length > 0) {
    parts.push('\nChecklist:');
    for (const item of checklist) {
      parts.push(`- [${item.done ? 'x' : ' '}] ${item.text}`);
    }
    parts.push('\nIMPORTANT: After completing each checklist item, output the full checklist with updated status using this exact format:');
    parts.push('- [x] Completed item');
    parts.push('- [ ] Pending item');
    parts.push('This lets the board track your progress in real-time.');
  }

  // Include attached images if any
  const taskImages = db.prepare(
    'SELECT id, filename, original_name, mime_type FROM task_images WHERE task_id = ? ORDER BY created_at ASC'
  ).all(taskRow.id) as { id: string; filename: string; original_name: string; mime_type: string }[];

  if (taskImages.length > 0) {
    const imagesDir = path.join(PROJECT_ROOT, 'data', 'task-images', taskRow.id);
    parts.push('\nAttached Images:');
    parts.push('The following reference images have been attached to this task:');
    parts.push('IMPORTANT: When reading image files, the Read tool sends them to the vision API. Very small or corrupted images may cause an API error that breaks your session. If reading an image fails, do NOT retry — instead note the file path and work with the filename/context clues.');
    for (const img of taskImages) {
      const imgPath = path.join(imagesDir, img.filename);
      parts.push(`- ${img.original_name} (${img.mime_type}): ${imgPath}`);
    }
  }

  // Include existing walkthrough from previous iteration if available
  const walkthroughPath = path.join(WALKTHROUGH_DIR, `${taskRow.id}.md`);
  if (existsSync(walkthroughPath)) {
    const prevWalkthrough = readFileSync(walkthroughPath, 'utf-8');
    parts.push(`\nPrevious walkthrough from earlier iteration:\n${prevWalkthrough}`);
    parts.push('\nThis task was previously worked on. Review the walkthrough above for context on what was already done.');
  }

  // Include session file path if a previous session was persisted (crash recovery)
  const sessionFilePath = ptyManager.getSessionFilePath(taskRow.id);
  if (sessionFilePath) {
    parts.push(`\nYour previous session log is preserved at: ${sessionFilePath}`);
    parts.push('This file contains the raw terminal output from your last session. Read as much or as little as you need to understand where you left off and resume work.');
  }

  parts.push('\nPlease complete this task. Work through the checklist items if provided.');
  parts.push(`\nWhen you are finished, create or update the walkthrough markdown file at: ${walkthroughPath}`);
  parts.push('The walkthrough should document: what was done, changes made, files modified, and any important notes.');
  parts.push(`\nIMPORTANT: When you have fully completed ALL work for this task (including the walkthrough), you MUST output the exact signal ${COMPLETION_SIGNAL} on its own line (no quotes, nothing else on that line).`);
  parts.push('Do NOT output or reference this signal anywhere before you are truly finished. Only output it once, at the very end.');
  parts.push('After outputting the signal, DO NOT exit or use /exit. Stay in the session — you may receive follow-up feedback from the reviewer.');
  return parts.join('\n');
}

function buildPlanningPrompt(userPrompt: string, agentType: string): string {
  const isClaudeFamily = agentType === 'claude' || agentType === 'kilo';

  const parts: string[] = [
    'You are a task planner for a software development kanban board.',
    `The user wants to: ${userPrompt}`,
    '',
  ];

  parts.push(
    'PHASE 1: CLARIFY',
    'Ask 2-4 clarifying questions one at a time to understand scope,',
    'constraints, and success criteria.',
    'Wrap every message to the user with these exact markers on their own lines:',
    '',
    MSG_START,
    '[your question here]',
    MSG_END,
    '',
    'When you have gathered enough context, output this signal on its own line:',
    INTERVIEW_DONE_SIGNAL,
    'Then immediately proceed to Phase 2.',
    '',
    'PHASE 2: GENERATE',
    'Output ONLY a valid JSON object with this structure:',
    '{',
    '  "title": "Short, clear task title (under 80 chars)",',
    '  "description": "Detailed description with technical approach, key considerations, and acceptance criteria (2-4 paragraphs)",',
    '  "checklist": ["First concrete step", "Second concrete step", "Third concrete step"],',
    '  "suggestedTags": ["tag1", "tag2"],',
    '  "suggestedDeps": ["Description of prerequisite tasks"]',
    '}',
    `Then output ${PLAN_COMPLETE_SIGNAL} on its own line.`,
    '',
    'CRITICAL JSON RULES:',
    '- Do NOT use ... (ellipsis) anywhere in the JSON',
    '- Do NOT use trailing commas after the last array element',
    '- All string values must be properly quoted',
    '- All arrays must be complete (no placeholders)',
    '',
    'Start Phase 1 now with your first question.',
  );

  return parts.join('\n');
}

function extractJsonObject(text: string, startFrom = 0): string | null {
  const start = text.indexOf('{', startFrom);
  if (start === -1) return null;
  let depth = 0;
  let inString = false;
  let escape = false;
  for (let i = start; i < text.length; i++) {
    const ch = text[i];
    if (escape) { escape = false; continue; }
    if (ch === '\\' && inString) { escape = true; continue; }
    if (ch === '"') { inString = !inString; continue; }
    if (inString) continue;
    if (ch === '{') depth++;
    else if (ch === '}') { depth--; if (depth === 0) return text.substring(start, i + 1); }
  }
  return null;
}

// Extract a JSON object that looks like a plan (has "title" key). Falls back through multiple { candidates.
function extractPlanJson(text: string): string | null {
  // Return the LAST matching JSON with a "title" key.
  // The agent's real output always comes after any echoed/displayed user message
  // (which contains the prompt template JSON), so the last match is the real one.
  let lastCandidate: string | null = null;
  let offset = 0;
  while (offset < text.length) {
    const candidate = extractJsonObject(text, offset);
    if (!candidate) break;
    // Quick check: does it look like a plan JSON? (has "title" key)
    if (/"title"\s*:/.test(candidate)) lastCandidate = candidate;
    // Move past this candidate's opening brace
    const nextOpen = text.indexOf('{', offset) + 1;
    if (nextOpen <= offset) break;
    offset = nextOpen;
  }
  return lastCandidate;
}

function cleanJsonForParsing(raw: string): string {
  // Remove markdown code fences if present
  let cleaned = raw.replace(/^```(?:json)?\s*/m, '').replace(/\s*```\s*$/m, '');
  // Remove spread/ellipsis operators from arrays (... is invalid JSON)
  // Handle: , ... ] or , ...} or , ...,
  cleaned = cleaned.replace(/,\s*\.\.\.\s*([,\]\}])/g, '$1');
  // Handle: [ ... ] (array with only ellipsis)
  cleaned = cleaned.replace(/\[\s*\.\.\.\s*\]/g, '[]');
  // Handle: Unicode ellipsis character (…)
  cleaned = cleaned.replace(/,\s*\u2026\s*([,\]\}])/g, '$1');
  cleaned = cleaned.replace(/\[\s*\u2026\s*\]/g, '[]');
  // Handle: "..." placeholder string values in arrays (agent uses "..." to mean "more items")
  cleaned = cleaned.replace(/,\s*"\.\.\."\s*([,\]\}])/g, '$1');
  cleaned = cleaned.replace(/,\s*"\u2026"\s*([,\]\}])/g, '$1');
  // Remove trailing commas before ] or }
  cleaned = cleaned.replace(/,(\s*[}\]])/g, '$1');
  // Remove ALL control characters except \n, \r, \t (which we handle below)
  // eslint-disable-next-line no-control-regex
  cleaned = cleaned.replace(/[\x00-\x08\x0B\x0C\x0E-\x1F\x7F]/g, '');
  // Collapse \r\n and stray \r to \n so multiline strings remain valid
  cleaned = cleaned.replace(/\r\n/g, '\n').replace(/\r/g, '\n');
  // Escape literal newlines and tabs inside JSON string values.
  // Walk character-by-character to reliably handle strings with embedded newlines.
  let result = '';
  let inStr = false;
  let esc = false;
  for (let i = 0; i < cleaned.length; i++) {
    const ch = cleaned[i];
    if (esc) { result += ch; esc = false; continue; }
    if (ch === '\\' && inStr) { result += ch; esc = true; continue; }
    if (ch === '"') { inStr = !inStr; result += ch; continue; }
    if (inStr) {
      if (ch === '\n') { result += '\\n'; continue; }
      if (ch === '\t') { result += '\\t'; continue; }
    }
    result += ch;
  }
  return result.trim();
}

function buildVerifyPrompt(taskRow: any): string {
  const parts: string[] = [];
  parts.push(`Task: ${taskRow.title}`);

  // Include working directory constraint if workspace or working dir is set
  const effectiveDir = getEffectiveWorkingDir(taskRow);
  if (effectiveDir) {
    parts.push(`\nWorking Directory: ${effectiveDir}`);
    parts.push('IMPORTANT: You must operate exclusively within this working directory. Do not access or modify files outside of this directory.');
  }

  if (taskRow.description) {
    parts.push(`\nOriginal description:\n${taskRow.description}`);
  }

  const checklist = db.prepare(
    'SELECT text, done FROM checklist_items WHERE task_id = ? ORDER BY position'
  ).all(taskRow.id) as { text: string; done: number }[];

  if (checklist.length > 0) {
    parts.push('\nChecklist:');
    for (const item of checklist) {
      parts.push(`- [${item.done ? 'x' : ' '}] ${item.text}`);
    }
  }

  // Include attached images if any
  const verifyImages = db.prepare(
    'SELECT id, filename, original_name FROM task_images WHERE task_id = ? ORDER BY created_at ASC'
  ).all(taskRow.id) as { id: string; filename: string; original_name: string }[];

  if (verifyImages.length > 0) {
    const imagesDir = path.join(PROJECT_ROOT, 'data', 'task-images', taskRow.id);
    parts.push('\nAttached Images:');
    parts.push('Reference images attached to this task:');
    for (const img of verifyImages) {
      parts.push(`- ${img.original_name}: ${path.join(imagesDir, img.filename)}`);
    }
  }

  // Include walkthrough from previous run
  const walkthroughPath = path.join(WALKTHROUGH_DIR, `${taskRow.id}.md`);
  if (existsSync(walkthroughPath)) {
    const walkthrough = readFileSync(walkthroughPath, 'utf-8');
    parts.push(`\nWalkthrough from the agent that worked on this task:\n${walkthrough}`);
  }

  parts.push('\n--- VERIFICATION INSTRUCTIONS ---');
  parts.push('You are a VERIFIER. Your job is to check whether the task above was completed correctly.');
  parts.push('If you find ANY issues during verification, FIX them directly. Make the necessary code changes, then re-verify your fixes work.');
  parts.push('\nSteps:');
  parts.push('1. Read the original task description and checklist carefully');
  parts.push('2. Review the walkthrough to understand what was done and which files were modified');
  parts.push('3. Read the modified files to confirm the changes match what was described');
  parts.push('4. If there are tests, run them. If the task involves UI, check that components render correctly');
  parts.push('5. Check for regressions, missing edge cases, or incomplete work');
  parts.push('6. If you find ANY issues during verification, FIX them directly. Make the necessary code changes, then re-verify your fixes work.');
  parts.push('7. If no issues are found (or after fixing all issues), mark as PASS.');
  parts.push(`\nWhen finished, update the walkthrough file at: ${walkthroughPath}`);
  parts.push('Add a "## Verification" section at the end with:');
  parts.push('- PASS or FAIL verdict');
  parts.push('- What you checked');
  parts.push('- Any issues found');
  parts.push('- Any fixes applied (code changes made during verification)');
  parts.push(`\nIMPORTANT: When you have fully completed ALL verification work (including updating the walkthrough), you MUST output the exact signal ${COMPLETION_SIGNAL} on its own line as your very last action (no quotes, nothing else on that line).`);
  parts.push('Do NOT output or reference this signal anywhere before you are truly finished. Only output it once, at the very end.');
  return parts.join('\n');
}

function buildFeedbackPrompt(taskRow: any, feedback: string): string {
  const parts: string[] = [];
  parts.push(`Task: ${taskRow.title}`);

  // Include working directory constraint if workspace or working dir is set
  const effectiveDir = getEffectiveWorkingDir(taskRow);
  if (effectiveDir) {
    parts.push(`\nWorking Directory: ${effectiveDir}`);
    parts.push('IMPORTANT: You must operate exclusively within this working directory. Do not access or modify files outside of this directory.');
  }

  if (taskRow.description) {
    parts.push(`\nOriginal description:\n${taskRow.description}`);
  }

  // Include attached images if any
  const feedbackImages = db.prepare(
    'SELECT id, filename, original_name FROM task_images WHERE task_id = ? ORDER BY created_at ASC'
  ).all(taskRow.id) as { id: string; filename: string; original_name: string }[];

  if (feedbackImages.length > 0) {
    const imagesDir = path.join(PROJECT_ROOT, 'data', 'task-images', taskRow.id);
    parts.push('\nAttached Images:');
    parts.push('Reference images attached to this task:');
    for (const img of feedbackImages) {
      parts.push(`- ${img.original_name}: ${path.join(imagesDir, img.filename)}`);
    }
  }

  // Include walkthrough if it exists
  const walkthroughPath = path.join(WALKTHROUGH_DIR, `${taskRow.id}.md`);
  if (existsSync(walkthroughPath)) {
    const walkthrough = readFileSync(walkthroughPath, 'utf-8');
    parts.push(`\nPrevious walkthrough:\n${walkthrough}`);
  }

  // Include session file path if a previous session was persisted (crash recovery)
  const sessionFilePath = ptyManager.getSessionFilePath(taskRow.id);
  if (sessionFilePath) {
    parts.push(`\nYour previous session log is preserved at: ${sessionFilePath}`);
    parts.push('This file contains the raw terminal output from your last session. Read it if you need context on what was previously done.');
  }

  parts.push(`\nFeedback from reviewer:\n${feedback}`);
  parts.push(`\nPlease address the feedback above. When done, update the walkthrough file at: ${walkthroughPath}`);
  parts.push(`\nIMPORTANT: When you have fully completed ALL work, you MUST output the exact signal ${COMPLETION_SIGNAL} on its own line as your very last action (no quotes, nothing else on that line).`);
  parts.push('Do NOT output or reference this signal anywhere before you are truly finished. Only output it once, at the very end.');
  parts.push('After outputting the signal, DO NOT exit or use /exit. Stay in the session — you may receive follow-up feedback from the reviewer.');
  return parts.join('\n');
}

/**
 * Build a lighter feedback prompt for injecting into an EXISTING agent session
 * (either a live PTY or a --continue respawn that already has conversation context).
 * Only sends the feedback itself + completion instructions.
 */
function buildContinuationFeedback(taskRow: any, feedback: string): string {
  const walkthroughPath = path.join(WALKTHROUGH_DIR, `${taskRow.id}.md`);
  const parts: string[] = [];

  // Include session file path if a previous session was persisted (crash recovery)
  const sessionFilePath = ptyManager.getSessionFilePath(taskRow.id);
  if (sessionFilePath) {
    parts.push(`Your previous session log is preserved at: ${sessionFilePath}`);
    parts.push('Read it if you need context on what was previously done.\n');
  }

  parts.push(`Feedback from reviewer:\n${feedback}`);
  parts.push(`\nPlease address the feedback above. When done, update the walkthrough file at: ${walkthroughPath}`);
  parts.push(`\nIMPORTANT: When you have fully completed ALL work, you MUST output the exact signal ${COMPLETION_SIGNAL} on its own line as your very last action (no quotes, nothing else on that line).`);
  parts.push('Do NOT output or reference this signal anywhere before you are truly finished. Only output it once, at the very end.');
  parts.push('After outputting the signal, DO NOT exit or use /exit. Stay in the session — you may receive follow-up feedback from the reviewer.');
  return parts.join('\n');
}

// ---------- Walkthrough Generation ----------

const WALKTHROUGH_DIR = path.resolve(PROJECT_ROOT, 'data', 'walkthroughs');
if (!existsSync(WALKTHROUGH_DIR)) {
  mkdirSync(WALKTHROUGH_DIR, { recursive: true });
}

const TASK_IMAGES_DIR = path.resolve(PROJECT_ROOT, 'data', 'task-images');
if (!existsSync(TASK_IMAGES_DIR)) {
  mkdirSync(TASK_IMAGES_DIR, { recursive: true });
}

const SESSIONS_DIR = path.resolve(PROJECT_ROOT, 'data', 'sessions');
if (!existsSync(SESSIONS_DIR)) {
  mkdirSync(SESSIONS_DIR, { recursive: true });
}

function stripAnsi(str: string): string {
  return str
    .replace(/\x1b\[[0-9;?]*[a-zA-Z~]/g, '')   // CSI sequences including DEC private mode (\x1b[?25l etc.)
    .replace(/\x1b\][^\x07]*\x07/g, '')          // OSC sequences (BEL-terminated)
    .replace(/\x1b\][^\x1b]*\x1b\\/g, '')        // OSC sequences (ST-terminated)
    .replace(/\x1b[()][A-Z0-9]/g, '')            // Character set selection (\x1b(B etc.)
    .replace(/\x1b[78>=<]/g, '');                 // Cursor save/restore, keypad modes
}

function generateWalkthrough(taskId: string, exitCode: number | undefined, rawOutput: string): void {
  const filePath = path.join(WALKTHROUGH_DIR, `${taskId}.md`);
  // If the agent already wrote its own walkthrough, preserve it — don't overwrite with terminal output
  if (existsSync(filePath)) {
    console.log(`[kanaban] Walkthrough already exists (agent-written), skipping generation for ${taskId.slice(0, 8)}`);
    return;
  }

  const task = db.prepare('SELECT * FROM tasks WHERE id = ?').get(taskId) as any;
  if (!task) return;

  const checklist = db.prepare(
    'SELECT text, done FROM checklist_items WHERE task_id = ? ORDER BY position'
  ).all(taskId) as { text: string; done: number }[];

  const lines: string[] = [];
  lines.push(`# ${task.title}`);
  lines.push('');
  lines.push(`**Agent:** ${task.agent_type}  `);
  lines.push(`**Status:** ${task.status}  `);
  lines.push(`**Exit Code:** ${exitCode ?? 'N/A'}  `);
  lines.push(`**Working Directory:** \`${getEffectiveWorkingDir(task) || 'N/A'}\`  `);
  if (task.command) {
    lines.push(`**Command:** \`${task.command}\`  `);
  }
  lines.push('');
  lines.push(`**Created:** ${task.created_at}  `);
  lines.push(`**Completed:** ${task.updated_at}  `);

  if (task.description) {
    lines.push('');
    lines.push('## Description');
    lines.push('');
    lines.push(task.description);
  }

  if (checklist.length > 0) {
    lines.push('');
    lines.push('## Checklist');
    lines.push('');
    for (const item of checklist) {
      lines.push(`- [${item.done ? 'x' : ' '}] ${item.text}`);
    }
  }

  // Include cleaned terminal output as the actual walkthrough content
  let cleanedOutput = stripAnsi(rawOutput).trim();

  // Strip the echoed prompt from the terminal output to avoid polluting the walkthrough
  const promptEndRegex = /Only\s+output\s+it\s+once,\s+at\s+the\s+very\s+end\./gi;
  const matches = [...cleanedOutput.matchAll(promptEndRegex)];
  if (matches.length > 0) {
    const lastMatch = matches[matches.length - 1];
    cleanedOutput = cleanedOutput.substring(lastMatch.index! + lastMatch[0].length).trim();
  }
  if (cleanedOutput.length > 0) {
    lines.push('');
    lines.push('## Terminal Output');
    lines.push('');
    // Limit to last 32KB of cleaned output to keep file manageable
    const maxLen = 32 * 1024;
    const trimmedOutput = cleanedOutput.length > maxLen
      ? '... (truncated)\n' + cleanedOutput.slice(cleanedOutput.length - maxLen)
      : cleanedOutput;
    lines.push('```');
    lines.push(trimmedOutput);
    lines.push('```');
  }

  lines.push('');
  lines.push('## Notes');
  lines.push('');
  lines.push('This walkthrough was auto-generated from terminal output. The agent did not produce a written summary.');

  lines.push('');

  writeFileSync(filePath, lines.join('\n'), 'utf-8');
  console.log(`[kanaban] Walkthrough saved: ${filePath}`);

}

app.get('/api/tasks/:id/walkthrough', (req: Request, res: Response) => {
  const { id } = req.params;
  const filePath = path.resolve(WALKTHROUGH_DIR, `${id}.md`);
  if (!filePath.startsWith(WALKTHROUGH_DIR)) {
    res.status(400).json({ error: 'Invalid task ID' });
    return;
  }
  if (!existsSync(filePath)) {
    res.status(404).json({ error: 'No walkthrough found for this task' });
    return;
  }
  const content = readFileSync(filePath, 'utf-8');
  res.json({ taskId: id, content });
});

// ---------- Board State & Orchestrator Awareness ----------

function getKanbanStateSummary(parentId?: string | 'all'): string {
  const columns = ['backlog', 'todo', 'scheduled', 'in-progress', 'review', 'inspect', 'done'];
  const lines: string[] = ['## Current Board State\n'];

  for (const col of columns) {
    let tasks: any[];
    if (parentId === 'all') {
      tasks = db.prepare('SELECT id, title, agent_type, status FROM tasks WHERE "column" = ? ORDER BY position').all(col) as any[];
    } else if (parentId) {
      tasks = db.prepare('SELECT id, title, agent_type, status FROM tasks WHERE "column" = ? AND parent_task_id = ? ORDER BY position').all(col, parentId) as any[];
    } else {
      tasks = db.prepare(`SELECT id, title, agent_type, status FROM tasks WHERE "column" = ? AND (parent_task_id IS NULL OR parent_task_id = '') ORDER BY position`).all(col) as any[];
    }

    lines.push(`### ${col} (${tasks.length})`);
    for (const t of tasks) {
      const isRunning = ptyManager.hasSession(t.id);
      const statusTag = isRunning ? ' [RUNNING]' : '';
      const walkthroughPath = path.join(WALKTHROUGH_DIR, `${t.id}.md`);
      const hasWalkthrough = existsSync(walkthroughPath);
      const wtTag = hasWalkthrough ? ' [WALKTHROUGH]' : ' [NO WALKTHROUGH]';
      lines.push(`- ${t.title} (${t.id.slice(0, 8)}) [${t.agent_type}]${statusTag}${wtTag}`);
    }
    if (tasks.length === 0) lines.push('- (empty)');
    lines.push('');
  }

  return lines.join('\n');
}

function getAgentOutputSnippet(taskId: string, maxLines: number = 50): string {
  const raw = ptyManager.getOutputBuffer(taskId);
  if (!raw) return '';
  const clean = stripAnsi(raw).trim();
  const lines = clean.split('\n');
  if (lines.length <= maxLines) return clean;
  return '... (truncated)\n' + lines.slice(-maxLines).join('\n');
}

function notifyOrchestrator(message: string): void {
  if (!orchestratorPty || !orchestratorRunning) return;
  // Queue the notification instead of writing immediately
  orchestratorNotificationQueue.push({ taskId: '__orchestrator__', message });
  console.log(`[kanaban:orchestrator] Queued notification (${message.length} chars)`);
  processNotificationQueue();
}

app.get('/api/tasks/:id/output', (req: Request, res: Response) => {
  const id = req.params.id as string;
  const maxLines = parseInt(String(req.query.lines || '100'), 10);
  const snippet = getAgentOutputSnippet(id, maxLines);
  const running = ptyManager.hasSession(id);
  res.json({ taskId: id, running, output: snippet });
});

app.get('/api/board/state', (_req: Request, res: Response) => {
  const summary = getKanbanStateSummary('all');
  res.json({ summary });
});

// ---------- Sessions API ----------

app.get('/api/sessions', (_req: Request, res: Response) => {
  const activeTaskIds = ptyManager.getActiveSessions();
  const sessions = activeTaskIds.map((taskId) => {
    const task = db.prepare('SELECT * FROM tasks WHERE id = ?').get(taskId) as any;
    return {
      taskId,
      title: task?.title || 'Unknown',
      agentType: task?.agent_type || 'generic',
      status: task?.status || 'idle',
      column: task?.column || 'in-progress',
      command: task?.command || '',
      workingDir: task?.working_dir || '',
      connected: true,
      updatedAt: task?.updated_at || '',
      createdAt: task?.created_at || '',
    };
  });
  res.json(sessions);
});

// ---------- Notification Manager ----------

const notifications = new NotificationManager();

// ---------- PTY Manager ----------

function cleanPlannerMessage(text: string): string {
  let res = '';
  // Resolve \b (backspaces)
  for (const ch of text) {
    if (ch === '\b') {
      if (res.length > 0) res = res.slice(0, -1);
    } else {
      res += ch;
    }
  }
  res = res.replace(/\r\n/g, '\n');
  const lines = res.split('\n').map(l => {
    const parts = l.split('\r');
    return parts[parts.length - 1]; // take the last \r overwrite
  });
  // TUI terminal wrappers inject newlines midway through sentences.
  // We join with space so words aren't squished together, then collapse multiple spaces.
  return lines.join(' ').replace(/\s+/g, ' ').trim();
}

/** Extract the next complete KANABAN_MSG_START...KANABAN_MSG_END block from buf starting at offset. */
function extractNextPlannerMessage(buf: string, offset: number): { text: string; newOffset: number } | null {
  const startIdx = buf.indexOf(MSG_START, offset);
  if (startIdx === -1) return null;
  const lineEnd = buf.indexOf('\n', startIdx);
  if (lineEnd === -1) return null; // incomplete line — wait for more data
  const contentStart = lineEnd + 1;
  const endIdx = buf.indexOf(MSG_END, contentStart);
  if (endIdx === -1) return null; // MSG_END not yet arrived
  const rawText = buf.substring(contentStart, endIdx).trim();
  const newOffset = endIdx + MSG_END.length;
  return { text: cleanPlannerMessage(rawText), newOffset };
}

function handlePtyEvent(event: PtyEvent): void {
  const room = `task:${event.taskId}`;

  try {
    switch (event.type) {
      case 'data':
        // Emit raw terminal data to the task room
        io.to(room).emit('task:output', {
          taskId: event.taskId,
          data: event.data,
        });
        ptyLastOutputTime.set(event.taskId, Date.now());

        // Check for ready-prompt detection (agents with slow startup)
        if (event.data && readyPromptWatchers.has(event.taskId)) {
          checkReadyPrompt(event.taskId, event.data);
        }

        // --- Planner output detection ---
        if (event.data && activePlanners.has(event.taskId)) {
          const planId = activePlanners.get(event.taskId)!;
          const stripped = stripAnsi(event.data);
          const buf = (plannerSignalBuffer.get(event.taskId) || '') + stripped;
          plannerSignalBuffer.set(event.taskId, buf);

          // --- Step 1: Extract complete interview messages (MSG_START...MSG_END) ---
          let msgScanResult = extractNextPlannerMessage(buf, plannerMessageOffset.get(event.taskId) ?? Number.MAX_SAFE_INTEGER);
          while (msgScanResult) {
            plannerMessageOffset.set(event.taskId, msgScanResult.newOffset);
            io.emit('plan:message', { planId, text: msgScanResult.text });
            console.log(`[kanaban:planner] Message for plan=${planId.slice(0, 8)}: "${msgScanResult.text.slice(0, 60)}"`);
            msgScanResult = extractNextPlannerMessage(buf, plannerMessageOffset.get(event.taskId)!);
          }

          // --- Step 2: Detect KANABAN_INTERVIEW_DONE ---
          const interviewOffset = plannerMessageOffset.get(event.taskId) ?? Number.MAX_SAFE_INTEGER;
          const doneIdx = buf.indexOf(INTERVIEW_DONE_SIGNAL, interviewOffset);
          if (doneIdx !== -1) {
            const planStatus = (db.prepare('SELECT status FROM plans WHERE id = ?').get(planId) as any)?.status;
            if (planStatus === 'interviewing') {
              db.prepare("UPDATE plans SET status = 'generating' WHERE id = ?").run(planId);
              io.emit('plan:phase-change', { planId });
              plannerMessageOffset.set(event.taskId, doneIdx + INTERVIEW_DONE_SIGNAL.length);
              console.log(`[kanaban:planner] Interview done for plan=${planId.slice(0, 8)}, transitioning to generating`);
            }
          }

          if (new RegExp(`^\\s*\\**\\s*${PLAN_COMPLETE_SIGNAL}\\s*\\**\\s*$`, 'm').test(buf)) {
            // Use lastIndexOf to skip any echoed prompt text that contains the signal inline
            const firstSignalIdx = buf.indexOf(PLAN_COMPLETE_SIGNAL);
            const lastSignalIdx = buf.lastIndexOf(PLAN_COMPLETE_SIGNAL);
            let jsonPart: string;
            if (firstSignalIdx !== lastSignalIdx) {
              // Signal appears multiple times (once in echoed prompt, once from agent)
              // Extract text between first and last occurrence — this is the agent's actual response
              jsonPart = buf.substring(firstSignalIdx + PLAN_COMPLETE_SIGNAL.length, lastSignalIdx).trim();
            } else {
              // Single occurrence — standard extraction
              jsonPart = buf.substring(0, lastSignalIdx).trim();
            }
            const jsonRaw = extractPlanJson(jsonPart);
            if (jsonRaw) {
              try {
                const cleaned = cleanJsonForParsing(jsonRaw);
                const parsed = JSON.parse(cleaned);

                const savePlan = db.transaction(() => {
                  db.prepare(`
                    UPDATE plans SET title = ?, description = ?, status = 'ready',
                    suggested_tags = ?, suggested_deps = ?
                    WHERE id = ?
                  `).run(
                    parsed.title || 'Untitled Plan',
                    parsed.description || '',
                    JSON.stringify(parsed.suggestedTags || []),
                    JSON.stringify(parsed.suggestedDeps || []),
                    planId,
                  );

                  const insertItem = db.prepare(
                    'INSERT INTO plan_checklist_items (id, plan_id, text, position) VALUES (?, ?, ?, ?)'
                  );
                  const checklist = Array.isArray(parsed.checklist) ? parsed.checklist : [];
                  checklist.forEach((text: string, i: number) => {
                    if (typeof text === 'string' && text.trim()) {
                      insertItem.run(uuidv4(), planId, text.trim(), i);
                    }
                  });
                });
                savePlan();

                const updatedPlan = db.prepare('SELECT * FROM plans WHERE id = ?').get(planId);
                io.emit('plan:ready', formatPlan(updatedPlan as any));
              } catch (parseErr) {
                console.error(`[kanaban:planner] JSON parse failed for plan=${planId.slice(0, 8)}:`, parseErr);
                console.error(`[kanaban:planner] Raw JSON (first 500 chars): ${jsonRaw.substring(0, 500)}`);
                db.prepare("UPDATE plans SET status = 'failed', error = ? WHERE id = ?")
                  .run(`JSON parse error: ${parseErr}`, planId);
                io.emit('plan:failed', { planId, error: `JSON parse error: ${parseErr}` });
              }
            } else {
              console.error(`[kanaban:planner] No JSON found for plan=${planId.slice(0, 8)}, jsonPart length=${jsonPart.length}`);
              db.prepare("UPDATE plans SET status = 'failed', error = ? WHERE id = ?")
                .run('No JSON found in agent output', planId);
              io.emit('plan:failed', { planId, error: 'No JSON found in agent output' });
            }

            // Cleanup
            ptyManager.kill(event.taskId);
            activePlanners.delete(event.taskId);
            plannerSignalBuffer.delete(event.taskId);
            plannerMessageOffset.delete(event.taskId);
            broadcastSessions();
          }
          break; // Don't process further as a regular task
        }

        // --- Agent chat data handling (plain terminal — just forward output) ---
        if (event.taskId.startsWith('agent-chat:')) {
          const chatId = event.taskId.replace('agent-chat:', '');
          if (!activeChats.has(chatId)) return;
          io.to(`agent-chat:${chatId}`).emit('agent-chat:output', { chatId, data: event.data });
          return;
        }

        // Check for completion signal from the agent
        if (event.data) {
          const readyTime = completionDetectionReady.get(event.taskId);
          if (readyTime && Date.now() >= readyTime) {
            // Append stripped text to rolling buffer (only after cooldown to skip prompt echo)
            const strippedData = stripAnsi(event.data);
            const prev = completionSignalBuffer.get(event.taskId) || '';
            const combined = prev + strippedData;
            completionSignalBuffer.set(
              event.taskId,
              combined.length > SIGNAL_BUFFER_SIZE
                ? combined.slice(combined.length - SIGNAL_BUFFER_SIZE)
                : combined
            );

            // Check rolling buffer for the completion signal
            const buffer = completionSignalBuffer.get(event.taskId)!;
            if (/^\s*\**\s*KANABAN_TASK_COMPLETE\s*\**\s*$/m.test(buffer)) {
              const isVerifyRun = verifyingTasks.has(event.taskId);

              // Check auto_complete setting — skip auto-finalization if disabled (unless it's a verify run)
              const taskAutoComplete = db.prepare('SELECT auto_complete FROM tasks WHERE id = ?').get(event.taskId) as any;
              if (!isVerifyRun && taskAutoComplete?.auto_complete === 0) {
                console.log(`[kanaban] Completion signal detected for task ${event.taskId.slice(0, 8)} — auto_complete is OFF, ignoring signal`);
                // Clear buffer to prevent re-triggering but don't finalize
                completionSignalBuffer.delete(event.taskId);
              } else {
                completionDetectionReady.delete(event.taskId);
                completionSignalBuffer.delete(event.taskId);
                postInjectionOffset.delete(event.taskId);

                if (isVerifyRun) {
                  verifyingTasks.delete(event.taskId);
                }
                // Mark as signal-finalized so the PTY exit handler won't call finalizeTask again
                signalFinalizedTasks.add(event.taskId);
                console.log(`[kanaban] Completion signal detected for task ${event.taskId.slice(0, 8)} — finalizing task (keeping PTY alive)${isVerifyRun ? ' [verify]' : ''}`);
                finalizeTask(event.taskId, 0, isVerifyRun);
              }
            }
          }
        }
        break;

      case 'parsed':
        if (event.parsed) {
          for (const parsed of event.parsed) {
            // Skip output-chunk events (redundant, handled by task:output)
            if (parsed.type === 'output-chunk') continue;

            // Handle specific parsed events
            if (parsed.type === 'status-change') {
              // Don't override status if task was already finalized by completion signal —
              // the agent may still output "executing"/"thinking" text during wind-down,
              // which would overwrite the idle status and cause ghost-task respawn loops.
              if (signalFinalizedTasks.has(event.taskId) || completionScanFinalized.has(event.taskId)) continue;

              // Debounced: queue the status change instead of writing to DB synchronously
              queueStatusChange(event.taskId, parsed.data.status, parsed.data);
            }

            if (parsed.type === 'checklist-update') {
              const dbItems = db.prepare(
                'SELECT id, text, done FROM checklist_items WHERE task_id = ? ORDER BY position'
              ).all(event.taskId) as { id: string; text: string; done: number }[];

              let changed = false;
              for (const parsedItem of parsed.data.items) {
                // Find matching DB item by normalized text comparison
                const normalise = (s: string) => s.toLowerCase().replace(/[^a-z0-9]/g, '');
                const parsedNorm = normalise(parsedItem.text);
                const match = dbItems.find((dbItem) => {
                  const dbNorm = normalise(dbItem.text);
                  return dbNorm === parsedNorm || dbNorm.includes(parsedNorm) || parsedNorm.includes(dbNorm);
                });

                if (match) {
                  const newDone = parsedItem.done ? 1 : 0;
                  if (match.done !== newDone) {
                    db.prepare('UPDATE checklist_items SET done = ? WHERE id = ?')
                      .run(newDone, match.id);
                    changed = true;
                  }
                }
              }

              // Checklist progress is tracked but we do NOT auto-move/kill here.
              // The agent is expected to output KANABAN_TASK_COMPLETE when truly done
              // (including walkthrough). Killing early cuts agents off mid-work.
              if (changed) {
                broadcastTask(event.taskId);
              }
            }

            if (parsed.type === 'error') {
              notifications.emit(io, {
                type: 'error',
                taskId: event.taskId,
                data: parsed.data,
              });
            }
          }
        }
        break;

      case 'exit': {
        // --- Planner exit handling ---
        if (activePlanners.has(event.taskId)) {
          const exitPlanId = activePlanners.get(event.taskId)!;
          const plan = db.prepare('SELECT status FROM plans WHERE id = ?').get(exitPlanId) as any;
          if (plan?.status === 'generating' || plan?.status === 'interviewing') {
            db.prepare("UPDATE plans SET status = 'failed', error = ? WHERE id = ?")
              .run('Agent exited before completing plan', exitPlanId);
            io.emit('plan:failed', { planId: exitPlanId, error: 'Agent exited before completing plan' });
          }
          activePlanners.delete(event.taskId);
          plannerSignalBuffer.delete(event.taskId);
          plannerMessageOffset.delete(event.taskId);
          broadcastSessions();
          break; // Don't process as a regular task exit
        }

        // --- Agent chat exit handling ---
        if (event.taskId.startsWith('agent-chat:')) {
          const chatId = event.taskId.replace('agent-chat:', '');
          if (!activeChats.has(chatId)) return;
          activeChats.delete(chatId);
          closeChat(chatId);
          io.to(`agent-chat:${chatId}`).emit('agent-chat:kill:result', { chatId, success: true });
          broadcastSessions();
          return;
        }

        completionDetectionReady.delete(event.taskId);
        completionSignalBuffer.delete(event.taskId);
        completionScanFinalized.delete(event.taskId);
        postInjectionOffset.delete(event.taskId);
        ptySpawnTime.delete(event.taskId);
        spawnGeneration.delete(event.taskId);
        promptInjectionInFlight.delete(event.taskId);
        resetHealthTracking(event.taskId);
        clearReadyPromptWatcher(event.taskId);
        // Clear delegation state (both in-memory set and DB flag)
        if (delegatedTasks.has(event.taskId)) {
          delegatedTasks.delete(event.taskId);
          db.prepare('UPDATE tasks SET delegated = 0, updated_at = ? WHERE id = ? AND delegated = 1')
            .run(new Date().toISOString(), event.taskId);
        }
        ptyLastOutputTime.delete(event.taskId);
        inputQueue.delete(event.taskId);

        // Read terminal output for server-side walkthrough (keep buffer for replay)
        const rawOutput = ptyManager.getOutputBuffer(event.taskId);
        generateWalkthrough(event.taskId, event.exitCode, rawOutput);

        console.log(`[kanaban] PTY exit: task=${event.taskId.slice(0, 8)} | exitCode=${event.exitCode ?? 'N/A'} | signal=${event.signal ?? 'N/A'}`);
        if (event.exitCode !== 0 && event.signal == null) {
          console.warn(`[kanaban] Non-zero exit (exitCode=${event.exitCode}) for task=${event.taskId.slice(0, 8)} — may be a crash or early termination`);
        }

        const wasVerifying = verifyingTasks.has(event.taskId);
        if (wasVerifying) {
          verifyingTasks.delete(event.taskId);
          // Track failed verification attempts (non-zero exit without completion signal)
          if (event.exitCode !== 0 && event.exitCode !== undefined) {
            const count = verificationAttempts.get(event.taskId) || 0;
            verificationAttempts.set(event.taskId, count + 1);
          }
        }
        // Only consider verified if the verify agent exited cleanly (exit code 0)
        // Failed verifications go back to review for retry
        const isVerified = wasVerifying && event.exitCode === 0;

        // If completion was already handled by the real-time signal detector,
        // skip finalizeTask to prevent duplicate auto-verify triggers.
        // But still force status=idle as a safety net — status-change events from
        // the agent's wind-down output may have overwritten it back to executing/thinking.
        if (signalFinalizedTasks.has(event.taskId)) {
          signalFinalizedTasks.delete(event.taskId);
          const exitNow = new Date().toISOString();
          db.prepare('UPDATE tasks SET status = ?, updated_at = ? WHERE id = ?')
            .run('idle', exitNow, event.taskId);
          broadcastTask(event.taskId);
          broadcastSessions();
          console.log(`[kanaban] PTY exit for task=${event.taskId.slice(0, 8)} — already finalized by signal detection, forced status=idle`);
          // Still need to check waitlist — signal-finalized path skips finalizeTask
          setTimeout(() => processWaitlist(), 1000);
        } else {
          // Use finalizeTask to handle all state transitions and notifications
          finalizeTask(event.taskId, event.exitCode, isVerified);
        }

        io.to(`task:${event.taskId}`).emit('task:exit', {
          taskId: event.taskId,
          exitCode: event.exitCode,
          signal: event.signal,
        });

        break;
      }
    }
  } catch (err) {
    console.error(`[kanaban:pty-event] Error handling PTY event for task ${event.taskId.slice(0, 8)}:`, err);
  }
}

const ptyManager = new PtyManager(handlePtyEvent, 20, SESSIONS_DIR);

// ---------- Status-Change Debounce ----------
// Batch status-change DB writes to reduce event loop blocking from rapid PTY output.
// Stores the latest pending status per task and flushes every 500ms.
const pendingStatusChanges: Map<string, { status: string; data: any }> = new Map();
let statusFlushTimer: ReturnType<typeof setTimeout> | null = null;

function queueStatusChange(taskId: string, status: string, data: any): void {
  pendingStatusChanges.set(taskId, { status, data });
  if (!statusFlushTimer) {
    statusFlushTimer = setTimeout(flushStatusChanges, 500);
  }
}

function flushStatusChanges(): void {
  statusFlushTimer = null;
  if (pendingStatusChanges.size === 0) return;

  const now = new Date().toISOString();
  const updateStmt = db.prepare('UPDATE tasks SET status = ?, updated_at = ? WHERE id = ?');
  const selectStmt = db.prepare('SELECT status FROM tasks WHERE id = ?');
  const changedTaskIds: string[] = [];

  for (const [taskId, { status, data }] of pendingStatusChanges) {
    // Re-check finalization guards at flush time
    if (signalFinalizedTasks.has(taskId) || completionScanFinalized.has(taskId)) continue;
    const current = selectStmt.get(taskId) as { status: string } | undefined;
    if (current && current.status !== status) {
      updateStmt.run(status, now, taskId);
      notifications.emit(io, {
        type: 'status-change',
        taskId,
        data,
      });
      changedTaskIds.push(taskId);
    }
  }
  pendingStatusChanges.clear();

  // Broadcast task updates so card UI reflects current status (live indicator, status label)
  for (const taskId of changedTaskIds) {
    broadcastTask(taskId);
  }
  broadcastSessions();
}

// ---------- Per-task terminal dimensions (last known from client resize) ----------
// Used to spawn PTY at the correct size instead of the hardcoded 120x30 default,
// which causes garbled output when the xterm.js viewport is narrower.
const taskTermDimensions: Map<string, { cols: number; rows: number }> = new Map();

function getTaskTermDims(taskId: string): { cols: number; rows: number } {
  return taskTermDimensions.get(taskId) || { cols: 120, rows: 30 };
}

// ---------- Input Queue (prevents voice/user input during prompt injection) ----------

const inputQueue: Map<string, string[]> = new Map();

// ---------- Ready-Prompt Detection (per-task) ----------
// For agents with slow startup (gemini, qwen, etc), detect the TUI input prompt
// in PTY output rather than using blind timeouts.
// Agent-specific ready patterns (Gemini's prompt is "Type your message", others use ">")
const READY_PROMPT_PATTERNS: Record<string, RegExp> = {
  claude: /(?:>|❯)\s*$/m,
  kilo: /(?:>|❯)\s*$/m,
  gemini: /Type your message/,
  lmstudio: />\s*$/m,
  qwen: />\s*$/m,
  droid: />\s*$/m,
};
const READY_PROMPT_FALLBACK_MS = 15000; // 15s fallback if pattern is never seen
// Agents that should use ready-prompt detection instead of blind timeouts
const READY_PROMPT_AGENTS = new Set(Object.keys(READY_PROMPT_PATTERNS));

interface ReadyPromptWatcher {
  recentOutput: string;
  pattern: RegExp;
  callback: () => void;
  fallbackTimer: ReturnType<typeof setTimeout>;
}
const readyPromptWatchers: Map<string, ReadyPromptWatcher> = new Map();

/** Register a watcher that fires callback when the agent's TUI prompt is ready. */
function waitForReadyPrompt(taskId: string, agentType: string, callback: () => void): void {
  // Clear any existing watcher
  clearReadyPromptWatcher(taskId);

  const pattern = READY_PROMPT_PATTERNS[agentType] || />\s*$/m;

  const fallbackTimer = setTimeout(() => {
    if (readyPromptWatchers.has(taskId)) {
      console.log(`[kanaban:ready-prompt] Fallback timeout (${READY_PROMPT_FALLBACK_MS}ms) for task=${taskId.slice(0, 8)} (${agentType}) — injecting prompt`);
      fireReadyPrompt(taskId);
    }
  }, READY_PROMPT_FALLBACK_MS);

  readyPromptWatchers.set(taskId, { recentOutput: '', pattern, callback, fallbackTimer });
  console.log(`[kanaban:ready-prompt] Watching for ready prompt on task=${taskId.slice(0, 8)} (${agentType}, pattern=${pattern})`);
}

/** Called from handlePtyEvent when data arrives for a watched task. */
function checkReadyPrompt(taskId: string, data: string): void {
  const watcher = readyPromptWatchers.get(taskId);
  if (!watcher) return;

  watcher.recentOutput += data;
  if (watcher.recentOutput.length > 4096) {
    watcher.recentOutput = watcher.recentOutput.slice(-2048);
  }

  // Strip ANSI escape sequences for pattern matching
  const stripped = stripAnsi(watcher.recentOutput);
  const matched = watcher.pattern.test(stripped);
  if (matched) {
    console.log(`[kanaban:ready-prompt] Detected ready prompt for task=${taskId.slice(0, 8)} (pattern matched in ${stripped.length} chars)`);
    // Small delay to let TUI fully settle
    setTimeout(() => fireReadyPrompt(taskId), 500);
  } else if (stripped.length > 200 && stripped.length % 500 < 50) {
    // Periodic debug logging: show tail of stripped output when pattern isn't matching
    const tail = stripped.slice(-120).replace(/\n/g, '\\n').replace(/\r/g, '\\r');
    console.log(`[kanaban:ready-prompt] No match yet for task=${taskId.slice(0, 8)} (${stripped.length} chars, pattern=${watcher.pattern}), tail: "${tail}"`);
  }
}

function fireReadyPrompt(taskId: string): void {
  const watcher = readyPromptWatchers.get(taskId);
  if (!watcher) { console.log(`[kanaban:ready-prompt] fireReadyPrompt: no watcher for task=${taskId.slice(0, 8)} (already fired?)`); return; }
  clearTimeout(watcher.fallbackTimer);
  readyPromptWatchers.delete(taskId);
  console.log(`[kanaban:ready-prompt] fireReadyPrompt: calling callback for task=${taskId.slice(0, 8)}`);
  watcher.callback();
}

function clearReadyPromptWatcher(taskId: string): void {
  const watcher = readyPromptWatchers.get(taskId);
  if (watcher) {
    clearTimeout(watcher.fallbackTimer);
    readyPromptWatchers.delete(taskId);
  }
}

/** Mark a task as having a pending prompt injection — user input will be queued. */
function beginInputQueue(taskId: string): void {
  inputQueue.set(taskId, []);
  console.log(`[kanaban:input-queue] Queuing enabled for task=${taskId.slice(0, 8)}`);
}

/** Flush queued user input after prompt injection finishes. */
function flushInputQueue(taskId: string): void {
  const queued = inputQueue.get(taskId);
  inputQueue.delete(taskId);
  if (!queued || queued.length === 0) return;
  console.log(`[kanaban:input-queue] Flushing ${queued.length} queued input(s) for task=${taskId.slice(0, 8)}`);
  const taskRow = db.prepare('SELECT agent_type FROM tasks WHERE id = ?').get(taskId) as any;
  const agentType = taskRow?.agent_type || 'generic';
  const needsSplitEnter = SPLIT_ENTER_AGENTS.has(agentType);
  let delay = 300;
  for (const input of queued) {
    setTimeout(() => {
      if (needsSplitEnter && input.endsWith('\r')) {
        const text = input.slice(0, -1);
        if (text.length > 0) {
          ptyManager.writeChunked(taskId, text).then(() => {
            setTimeout(() => ptyManager.write(taskId, '\r'), 500);
          });
        } else {
          ptyManager.write(taskId, '\r');
        }
      } else if (input.length > 256) {
        ptyManager.writeChunked(taskId, input);
      } else {
        ptyManager.write(taskId, input);
      }
    }, delay);
    delay += needsSplitEnter ? 1000 : 200;
  }
  // Notify clients that the terminal is now ready for direct input
  io.to(`task:${taskId}`).emit('task:input-ready', { taskId });
}

let broadcastSessionsTimer: ReturnType<typeof setTimeout> | null = null;
let broadcastSessionsPending = false;

function broadcastSessions(): void {
  // Leading + trailing debounce: emit immediately on first call,
  // then batch subsequent calls and emit once more at the end of the cooldown.
  if (!broadcastSessionsTimer) {
    // No cooldown active — emit immediately
    broadcastSessionsNow();
    broadcastSessionsTimer = setTimeout(() => {
      broadcastSessionsTimer = null;
      if (broadcastSessionsPending) {
        broadcastSessionsPending = false;
        broadcastSessionsNow();
      }
    }, 500);
  } else {
    // Cooldown active — mark pending for trailing emit
    broadcastSessionsPending = true;
  }
}

function broadcastSessionsNow(): void {
  // Show all tasks in work columns in the Agents panel
  const activeTasks = db.prepare(`
    SELECT t.*, w.name as workspace_name
    FROM tasks t
    LEFT JOIN workspaces w ON t.workspace_id = w.id
    WHERE t."column" IN ('in-progress', 'review', 'inspect')
  `).all() as any[];

  const sessions = activeTasks.map((task) => {
    const taskId = task.id;
    const hasPty = ptyManager.hasSession(taskId);

    return {
      taskId,
      title: task.title || 'Unknown',
      agentType: task.agent_type || 'generic',
      status: task.status || 'idle',
      column: task.column || 'in-progress',
      command: task.command || '',
      workingDir: task.working_dir || '',
      connected: hasPty,
      updatedAt: task.updated_at || '',
      createdAt: task.created_at || '',
      model: task.model || '',
      workspaceId: task.workspace_id || '',
      workspaceName: task.workspace_name || '',
    };
  });

  // Append active planner sessions with blue-styled flag
  const plannerSessions = Array.from(activePlanners.entries()).map(([sessionId, planId]) => {
    const plan = db.prepare('SELECT * FROM plans WHERE id = ?').get(planId) as any;
    const ws = plan?.workspace_id
      ? (db.prepare('SELECT name FROM workspaces WHERE id = ?').get(plan.workspace_id) as any)
      : null;
    const prompt = plan?.original_prompt || '';
    return {
      taskId: sessionId,
      title: `Planning: ${prompt.length > 30 ? prompt.substring(0, 30) + '...' : prompt}`,
      agentType: plan?.agent_type || 'claude',
      status: 'thinking',
      column: 'planner',
      command: '',
      workingDir: '',
      connected: true,
      updatedAt: plan?.created_at || '',
      createdAt: plan?.created_at || '',
      model: plan?.model || '',
      workspaceId: plan?.workspace_id || '',
      workspaceName: ws?.name || '',
      type: 'planner',
    };
  });

  // Append active chat sessions
  const chatSessions = Array.from(activeChats.values()).map(chat => {
    const ws = db.prepare('SELECT name FROM workspaces WHERE id = ?').get(chat.workspaceId) as any;
    return {
      taskId: `agent-chat:${chat.chatId}`,
      title: 'Workspace Terminal',
      agentType: chat.agentType,
      status: 'running',
      column: '',
      connected: true,
      updatedAt: new Date().toISOString(),
      createdAt: new Date().toISOString(),
      model: chat.model,
      workspaceId: chat.workspaceId,
      workspaceName: ws?.name || '',
      command: '',
      workingDir: '',
      type: 'agent-chat',
    };
  });

  io.emit('sessions:status', [...sessions, ...plannerSessions, ...chatSessions]);
}

// ---------- Spawn/Kill Helpers ----------

/**
 * Resolve the effective working directory for a task.
 * If the task belongs to a workspace, the workspace path is used as cwd —
 * ensuring the agent operates within the workspace folder and not elsewhere.
 * Falls back to the task's own working_dir if no workspace is set.
 */
function getEffectiveWorkingDir(taskRow: any): string {
  if (taskRow.workspace_id) {
    const workspace = db.prepare('SELECT path FROM workspaces WHERE id = ?').get(taskRow.workspace_id) as { path: string } | undefined;
    if (workspace?.path) {
      return workspace.path;
    }
  }
  return taskRow.working_dir || '';
}

/**
 * Resolve LM Studio model prefixes.
 * If the model starts with 'lmstudio:', translates it to an Aider-compatible
 * 'openai/<key>' model ID and returns OPENAI_API_BASE env var for the PTY.
 */
function resolveLmStudioModel(rawModel: string): { model: string; extraEnv?: Record<string, string> } {
  if (!rawModel || !rawModel.startsWith('lmstudio:')) {
    return { model: rawModel };
  }
  const lmsKey = rawModel.slice('lmstudio:'.length);
  return {
    model: `openai/${lmsKey}`,
    extraEnv: {
      OPENAI_API_BASE: 'http://localhost:1234/v1',
      OPENAI_API_KEY: process.env.LMSTUDIO_API_KEY || 'lm-studio',
    },
  };
}

function spawnTaskAgent(taskId: string, opts?: { command?: string; agentType?: string; forceRestart?: boolean; continueSession?: boolean; source?: 'orchestrator' | 'user' | 'system' }): { success: boolean; error?: string } {
  const taskRow = db.prepare('SELECT * FROM tasks WHERE id = ?').get(taskId) as any;
  if (!taskRow) return { success: false, error: 'Task not found' };

  // Prevent automated loops: don't spawn if a session already exists unless explicitly forced
  if (ptyManager.hasSession(taskId) && !opts?.forceRestart) {
    console.log(`[kanaban:spawn] Task ${taskId.slice(0, 8)} is already running — skipping spawn.`);
    return { success: false, error: 'Task is already running' };
  }

  // Clear stale state from any previous run.
  // Without this, a re-spawn (e.g. from health-check) would inherit the old
  // cooldown timestamp, causing the prompt echo to be falsely detected as completion.
  // Also clears promptInjectionInFlight to prevent stale injection guards from
  // blocking prompt injection on the new spawn (e.g. if previous PTY died mid-injection).
  completionDetectionReady.delete(taskId);
  completionSignalBuffer.delete(taskId);
  completionScanFinalized.delete(taskId);
  signalFinalizedTasks.delete(taskId);
  postInjectionOffset.delete(taskId);
  promptInjectionInFlight.delete(taskId);

  const agentType = opts?.agentType || taskRow.agent_type || 'generic';
  const workingDir = getEffectiveWorkingDir(taskRow);

  const explicitCommand = opts?.command || taskRow.command || '';
  const autoCommand = agentCliCommands[agentType] || '';
  let command = explicitCommand || autoCommand;
  const isAutoPrompt = !explicitCommand && !!autoCommand;

  // Add model flag if specified (unless command already has --model)
  const taskModel = taskRow.model || '';
  const { model: resolvedModel, extraEnv: lmsEnv } = resolveLmStudioModel(taskModel);
  if (resolvedModel && !command.includes('--model')) {
    command += ` --model ${resolvedModel}`;
  }

  // For --continue respawns (e.g. typing in terminal after review), add --continue flag
  if (opts?.continueSession && CONTINUE_FLAG_AGENTS.has(agentType) && !explicitCommand && !command.includes('--continue')) {
    command = command.replace(/^(\S+)/, '$1 --continue');
  }

  const isYolo = Boolean(taskRow.yolo);
  if (isYolo && command) {
    const flag = yoloFlags[agentType];
    if (flag && !command.includes(flag)) {
      command = `${command} ${flag}`;
    }
  }

  console.log(`[kanaban:spawn] Task="${taskRow.title}" agent=${agentType} model="${resolvedModel || taskModel}" command="${command}" auto=${isAutoPrompt} yolo=${isYolo} continue=${!!opts?.continueSession} cwd="${workingDir}"${lmsEnv ? ' [lmstudio]' : ''}`);

  if (!command) {
    console.log(`[kanaban:spawn] No command for agent type "${agentType}" — cannot spawn`);
    return { success: false, error: `No command for agent type "${agentType}"` };
  }

  const wasRunning = ptyManager.hasSession(taskId);
  if (wasRunning) {
    const rawOutput = ptyManager.getOutputBuffer(taskId);
    if (rawOutput) generateWalkthrough(taskId, undefined, rawOutput);
  }

  const dims = getTaskTermDims(taskId);
  const success = ptyManager.spawn(taskId, command, agentType, workingDir || undefined, lmsEnv, dims.cols, dims.rows);

  if (success) {
    // Increment spawn generation — invalidates any pending delayed callbacks from prior spawns
    const gen = (spawnGeneration.get(taskId) || 0) + 1;
    spawnGeneration.set(taskId, gen);
    const isStale = () => spawnGeneration.get(taskId) !== gen;

    ptySpawnTime.set(taskId, Date.now());
    io.to(`task:${taskId}`).emit('task:clear', { taskId });

    const now = new Date().toISOString();
    db.prepare('UPDATE tasks SET status = ?, "column" = ?, updated_at = ? WHERE id = ?')
      .run('running', 'in-progress', now, taskId);

    // For --continue sessions, skip prompt injection — agent resumes previous conversation
    // and the user's terminal input will be sent directly.
    const skipPromptInjection = opts?.continueSession && CONTINUE_FLAG_AGENTS.has(agentType) && !explicitCommand;

    if (isAutoPrompt && taskRow && !skipPromptInjection) {
      const prompt = buildTaskPrompt(taskRow);
      console.log(`[kanaban:spawn] Auto-injecting prompt (${prompt.length} chars) for "${taskRow.title}"`);

      // Queue user input until injection is done
      beginInputQueue(taskId);

      const doInject = () => {
        if (isStale()) { console.log(`[kanaban:spawn] Stale prompt injection skipped for task=${taskId.slice(0, 8)}`); return; }
        writePromptAndSubmit(taskId, prompt, agentType).then(() => {
          if (isStale()) return;
          // Flush any user input that arrived during injection after a brief settle
          setTimeout(() => { if (!isStale()) flushInputQueue(taskId); }, 500);
          // Enable completion signal detection after cooldown (from injection completion)
          completionDetectionReady.set(taskId, Date.now() + COMPLETION_COOLDOWN_MS);
          // Record output buffer length after echo settles (safety-net scan offset)
          setTimeout(() => {
            if (isStale()) return;
            const bufLen = ptyManager.getOutputBuffer(taskId)?.length || 0;
            postInjectionOffset.set(taskId, bufLen);
          }, 2000);
        });
      };

      if (READY_PROMPT_AGENTS.has(agentType) && (agentType !== 'claude' && agentType !== 'kilo' || isYolo)) {
        // Use ready-prompt detection for agents with known prompt patterns.
        // For claude/kilo, only use in yolo mode — non-yolo shows a trust confirm prompt
        // that also contains ">" which would fool detection.
        waitForReadyPrompt(taskId, agentType, doInject);
      } else {
        // Non-yolo claude/kilo or unknown agents: use a blind delay.
        const agentStartupDelay = SPLIT_ENTER_AGENTS.has(agentType) ? 6000 : 3000;
        setTimeout(doInject, agentStartupDelay);
      }
    } else {
      if (skipPromptInjection) {
        console.log(`[kanaban:spawn] Skipping prompt injection for --continue session (task=${taskId.slice(0, 8)})`);
        // Enable completion detection after a brief startup period
        completionDetectionReady.set(taskId, Date.now() + COMPLETION_COOLDOWN_MS);
      }
      // No auto-prompt or --continue — input is ready immediately
      io.to(`task:${taskId}`).emit('task:input-ready', { taskId });
    }

    broadcastTask(taskId);
    emitOrchestratorActivity('task-started', `Started "${taskRow.title}" (${agentType})`, { taskId, agentType }, opts?.source || 'user');

    notifications.emit(io, {
      type: 'agent-started',
      taskId,
      data: { command, agentType },
    });
  }

  broadcastSessions();
  return { success };
}

function killTaskAgent(taskId: string, killOpts?: { source?: 'orchestrator' | 'user' | 'system' }): { success: boolean } {
  completionDetectionReady.delete(taskId);
  completionSignalBuffer.delete(taskId);
  completionScanFinalized.delete(taskId);
  signalFinalizedTasks.delete(taskId);
  postInjectionOffset.delete(taskId);
  ptySpawnTime.delete(taskId);
  spawnGeneration.delete(taskId);
  verifyingTasks.delete(taskId);
  promptInjectionInFlight.delete(taskId);
  clearReadyPromptWatcher(taskId);
  // Clear delegation state (both in-memory set and DB flag)
  if (delegatedTasks.has(taskId)) {
    delegatedTasks.delete(taskId);
    db.prepare('UPDATE tasks SET delegated = 0, updated_at = ? WHERE id = ? AND delegated = 1')
      .run(new Date().toISOString(), taskId);
  }
  resetHealthTracking(taskId);
  inputQueue.delete(taskId);
  ptyLastOutputTime.delete(taskId);

  const rawOutput = ptyManager.getOutputBuffer(taskId);
  if (rawOutput) {
    generateWalkthrough(taskId, undefined, rawOutput);
  }

  // Read the current column BEFORE killing, so we know where it was
  const preKillTask = db.prepare('SELECT "column", title FROM tasks WHERE id = ?').get(taskId) as any;
  const success = ptyManager.kill(taskId);

  if (success) {
    const now = new Date().toISOString();

    // If the task was in 'in-progress', move it to 'review' (the agent was working on it)
    // For other columns (e.g. user dragged to backlog first), just reset status
    if (preKillTask?.column === 'in-progress') {
      db.prepare('UPDATE tasks SET status = ?, "column" = ?, updated_at = ? WHERE id = ?')
        .run('idle', 'review', now, taskId);
      console.log(`[kanaban] killTaskAgent: task ${taskId.slice(0, 8)} was in-progress — moved to review`);
    } else {
      db.prepare('UPDATE tasks SET status = ?, updated_at = ? WHERE id = ?')
        .run('idle', now, taskId);
    }

    io.to(`task:${taskId}`).emit('task:exit', { taskId, exitCode: -1 });
    broadcastTask(taskId);
    emitOrchestratorActivity('task-killed', `Killed "${preKillTask?.title || taskId.slice(0, 8)}"`, { taskId }, killOpts?.source || 'user');
  }

  broadcastSessions();

  // Check if any waitlisted tasks can now be spawned
  setTimeout(() => processWaitlist(), 1000);

  return { success };
}

// ---------- Planner Agent Spawn ----------

function spawnPlannerAgent(planId: string, agentType: string, model: string, workspaceId: string): { success: boolean; error?: string } {
  const sessionId = `plan:${planId}`;

  if (ptyManager.hasSession(sessionId)) {
    return { success: false, error: 'Planner already running' };
  }

  const cliCommand = agentCliCommands[agentType];
  if (!cliCommand) {
    return { success: false, error: `No CLI command for agent type: ${agentType}` };
  }

  let command = cliCommand;

  if (model) {
    command += ` --model ${model}`;
  }

  // Always use yolo mode for planners (no file edits, just thinking)
  const yoloFlag = yoloFlags[agentType];
  if (yoloFlag) {
    command += ` ${yoloFlag}`;
  }

  // Resolve working directory from workspace
  let workingDir = '';
  if (workspaceId) {
    const ws = db.prepare('SELECT path FROM workspaces WHERE id = ?').get(workspaceId) as any;
    if (ws?.path) workingDir = ws.path;
  }

  const planDims = getTaskTermDims(sessionId);
  const success = ptyManager.spawn(sessionId, command, agentType, workingDir || undefined, undefined, planDims.cols, planDims.rows);
  if (!success) {
    return { success: false, error: 'Failed to spawn PTY' };
  }

  // Track this as an active planner
  activePlanners.set(sessionId, planId);
  plannerSignalBuffer.set(sessionId, '');
  // Block scanning until after prompt echo has arrived (set after injection + echo delay).
  plannerMessageOffset.set(sessionId, Number.MAX_SAFE_INTEGER);

  // Retrieve prompt from DB
  const planRow = db.prepare('SELECT original_prompt FROM plans WHERE id = ?').get(planId) as any;
  const prompt = buildPlanningPrompt(planRow?.original_prompt || '', agentType);

  const isReadyPromptAgent = READY_PROMPT_AGENTS.has(agentType);
  const injectDelay = SPLIT_ENTER_AGENTS.has(agentType) ? 6000 : 3000;

  const isClaudeFamily = agentType === 'claude' || agentType === 'kilo';

  const injectPromptAndSetOffset = () => {
    writePromptAndSubmit(sessionId, prompt, agentType).then(() => {
      // Use content-based detection: the prompt always ends with this exact marker line.
      // Setting the offset to just after this text reliably skips all echoed content
      // (including the MSG_START/MSG_END examples in the prompt) without racing against
      // Claude's first response — even if it starts streaming before a fixed timer would fire.
      const PROMPT_END_MARKER = 'Start Phase 1 now with your first question.';
      let attempts = 0;
      const findPromptEnd = () => {
        if (!activePlanners.has(sessionId)) return; // session was killed
        const currentBuf = plannerSignalBuffer.get(sessionId) || '';
        const markerIdx = currentBuf.indexOf(PROMPT_END_MARKER);
        if (markerIdx !== -1) {
          const newOffset = markerIdx + PROMPT_END_MARKER.length;
          plannerMessageOffset.set(sessionId, newOffset);
          console.log(`[kanaban:planner] Interview offset set to ${newOffset} (content marker) for plan=${planId.slice(0, 8)}`);
        } else if (attempts < 30) {
          attempts++;
          setTimeout(findPromptEnd, 200);
        } else {
          // Fallback for non-echoing agents: use current buffer length
          const fallback = (plannerSignalBuffer.get(sessionId) || '').length;
          plannerMessageOffset.set(sessionId, fallback);
          console.log(`[kanaban:planner] Interview offset fallback to ${fallback} for plan=${planId.slice(0, 8)}`);
        }
      };
      setTimeout(findPromptEnd, 300);
    });
  };

  const doInject = () => {
    if (isClaudeFamily) {
      // Claude/Kilo: Enter plan mode first via /plan command, then inject the planning prompt.
      // This triggers Claude Code's native planning mode, visible in the terminal.
      ptyManager.write(sessionId, '/plan\r');
      console.log(`[kanaban:planner] Sent /plan command for plan=${planId.slice(0, 8)} (${agentType})`);
      // Wait for plan mode to activate before injecting the prompt
      setTimeout(injectPromptAndSetOffset, 2000);
    } else {
      injectPromptAndSetOffset();
    }
  };

  if (isReadyPromptAgent) {
    waitForReadyPrompt(sessionId, agentType, doInject);
  } else {
    setTimeout(doInject, injectDelay);
  }

  // Broadcast so planner appears in Agents panel
  broadcastSessions();
  io.emit('plan:generating', { planId, agentType, model });

  console.log(`[kanaban:planner] Spawned planner for plan=${planId.slice(0, 8)} agent=${agentType} model="${model}"`);
  return { success: true };
}

// Expose killTaskAgent so route handlers (e.g. DELETE /api/tasks/:id) can clean up PTYs
app.set('killTaskAgent', killTaskAgent);
app.set('spawnTaskAgent', spawnTaskAgent);
// Expose verifyTaskAgent so route handlers can auto-trigger verification
app.set('verifyTaskAgent', verifyTaskAgent);
// Expose delegatedTasks so route handlers can check delegation status
app.set('delegatedTasks', delegatedTasks);
// Expose broadcastTask so schedule routes can trigger task:updated after schedule changes
app.set('broadcastTask', broadcastTask);
// Expose deleteSessionFile so route handlers can clean up session files on task delete/done
app.set('deleteSessionFile', (taskId: string) => ptyManager.deleteSessionFile(taskId));

// ---------- Delegate Task to Orchestrator ----------

function delegateTask(taskId: string, opts?: { forceRestart?: boolean }): { success: boolean; error?: string } {
  const taskRow = db.prepare('SELECT * FROM tasks WHERE id = ?').get(taskId) as any;
  if (!taskRow) return { success: false, error: 'Task not found' };

  // Prevent automated loops — if already running and not forced, do nothing
  if (ptyManager.hasSession(taskId) && !opts?.forceRestart) {
    console.log(`[kanaban:delegate] Task ${taskId.slice(0, 8)} is already running — skipping delegate spawn.`);
    return { success: true };
  }

  // Clear stale completion detection state
  completionDetectionReady.delete(taskId);
  completionSignalBuffer.delete(taskId);
  completionScanFinalized.delete(taskId);
  postInjectionOffset.delete(taskId);

  const agentType = taskRow.agent_type || 'claude';
  const workingDir = getEffectiveWorkingDir(taskRow);

  // Build the orchestrator command (always use claude for orchestration)
  const orchAgentType = 'claude';
  let command = agentCliCommands[orchAgentType] || 'claude';
  const yoloFlag = yoloFlags[orchAgentType];
  if (yoloFlag) command += ` ${yoloFlag}`;

  // Use the task's model if it's a claude model, otherwise default
  const taskModel = taskRow.model || '';
  const { model: resolvedModel, extraEnv: lmsEnv } = resolveLmStudioModel(taskModel);
  if (resolvedModel && !command.includes('--model')) {
    command += ` --model ${resolvedModel}`;
  }

  console.log(`[kanaban:delegate] Task="${taskRow.title}" agent=${agentType} orchCmd="${command}" cwd="${workingDir}"`);

  // Mark task as delegated in DB
  const nowStr = new Date().toISOString();
  db.prepare('UPDATE tasks SET delegated = 1, status = ?, "column" = ?, updated_at = ? WHERE id = ?')
    .run('running', 'in-progress', nowStr, taskId);

  // Save output before killing existing session
  if (ptyManager.hasSession(taskId)) {
    const rawOutput = ptyManager.getOutputBuffer(taskId);
    if (rawOutput) generateWalkthrough(taskId, undefined, rawOutput);
  }

  // Spawn the PTY directly (NOT via spawnTaskAgent — avoids the auto-prompt branch)
  const orchDims = getTaskTermDims(taskId);
  const success = ptyManager.spawn(taskId, command, orchAgentType, workingDir || undefined, lmsEnv, orchDims.cols, orchDims.rows);

  if (!success) {
    return { success: false, error: 'Failed to spawn PTY for delegate' };
  }

  // Increment spawn generation — invalidates pending callbacks from prior spawns
  const gen = (spawnGeneration.get(taskId) || 0) + 1;
  spawnGeneration.set(taskId, gen);
  const isStale = () => spawnGeneration.get(taskId) !== gen;

  ptySpawnTime.set(taskId, Date.now());
  io.to(`task:${taskId}`).emit('task:clear', { taskId });

  delegatedTasks.add(taskId);

  // Build delegate prompt
  const checklist = db.prepare(
    'SELECT text, done FROM checklist_items WHERE task_id = ? ORDER BY position'
  ).all(taskId) as { text: string; done: number }[];

  const delegatePrompt = getDelegatePrompt({
    id: taskRow.id,
    title: taskRow.title,
    description: taskRow.description || '',
    workingDir: workingDir || '',
    workspaceId: taskRow.workspace_id || '',
    agentType: agentType,
    model: taskRow.model || '',
    checklistItems: checklist.map((ci: { text: string; done: number }) => ({ text: ci.text, done: Boolean(ci.done) })),
  });

  console.log(`[kanaban:delegate] Injecting delegate prompt (${delegatePrompt.length} chars) for "${taskRow.title}"`);

  // Queue user input until injection is done
  beginInputQueue(taskId);

  const doDelegateInject = () => {
    if (isStale()) { console.log(`[kanaban:delegate] Stale delegate injection skipped for task=${taskId.slice(0, 8)}`); return; }
    writePromptAndSubmit(taskId, delegatePrompt, orchAgentType).then(() => {
      if (isStale()) return;
      setTimeout(() => { if (!isStale()) flushInputQueue(taskId); }, 500);
      completionDetectionReady.set(taskId, Date.now() + COMPLETION_COOLDOWN_MS);
      setTimeout(() => {
        if (isStale()) return;
        postInjectionOffset.set(taskId, ptyManager.getOutputBuffer(taskId)?.length || 0);
      }, 2000);
    });
  };

  if (READY_PROMPT_AGENTS.has(orchAgentType)) {
    waitForReadyPrompt(taskId, orchAgentType, doDelegateInject);
  } else {
    const injectionDelay = SPLIT_ENTER_AGENTS.has(orchAgentType) ? 6000 : 5000;
    setTimeout(doDelegateInject, injectionDelay);
  }

  emitOrchestratorActivity('task-delegated', `Delegated "${taskRow.title}" to orchestrator`, { taskId, agentType }, 'orchestrator');
  broadcastTask(taskId);
  broadcastSessions();

  notifications.emit(io, {
    type: 'agent-started',
    taskId,
    data: { command, agentType: orchAgentType },
  });

  return { success: true };
}

// ---------- Verify Task (reusable function) ----------

function verifyTaskAgent(taskId: string, opts?: { forceRestart?: boolean; overrideAgentType?: string; overrideModel?: string }): { success: boolean; error?: string } {
  // If already being verified in an existing session, don't double-inject
  if (verifyingTasks.has(taskId) && ptyManager.hasSession(taskId)) {
    console.log(`[kanaban:verify] Task ${taskId.slice(0, 8)} is already being verified — skipping.`);
    return { success: true };
  }
  console.log(`[kanaban:verify] Verify requested for task ${taskId.slice(0, 8)}`);

  // Clear stale completion detection state before verify
  completionDetectionReady.delete(taskId);
  completionSignalBuffer.delete(taskId);
  completionScanFinalized.delete(taskId);
  signalFinalizedTasks.delete(taskId);
  postInjectionOffset.delete(taskId);

  const taskRow = db.prepare('SELECT * FROM tasks WHERE id = ?').get(taskId) as any;
  if (!taskRow) return { success: false, error: 'Task not found' };

  const agentType = opts?.overrideAgentType || taskRow.agent_type || 'generic';
  const workingDir = getEffectiveWorkingDir(taskRow);
  const explicitCommand = taskRow.command || '';
  let command = explicitCommand || agentCliCommands[agentType] || '';

  const verifyModel = opts?.overrideModel ?? taskRow.model ?? '';
  const { model: vfResolvedModel, extraEnv: vfLmsEnv } = resolveLmStudioModel(verifyModel);
  if (vfResolvedModel && !command.includes('--model')) {
    command += ` --model ${vfResolvedModel}`;
  }

  if (taskRow.yolo && command) {
    const flag = yoloFlags[agentType];
    if (flag && !command.includes(flag)) {
      command = `${command} ${flag}`;
    }
  }

  if (!command) return { success: false, error: 'No agent command configured' };

  const hasExistingSession = ptyManager.hasSession(taskId);
  let success = true;

  if (hasExistingSession) {
    console.log(`[kanaban:verify] Reusing existing session for task ${taskId.slice(0, 8)}`);
  } else {
    console.log(`[kanaban:verify] Task="${taskRow.title}" agent=${agentType} model="${vfResolvedModel || verifyModel}" command="${command}"`);

    // Preserve previous output so verify continues in the same terminal visually.
    // ptyManager.spawn resets the output buffer, so we save and restore it.
    const previousOutput = ptyManager.getOutputBuffer(taskId);

    const vfDims = getTaskTermDims(taskId);
    success = ptyManager.spawn(taskId, command, agentType, workingDir || undefined, vfLmsEnv, vfDims.cols, vfDims.rows);
    ptySpawnTime.set(taskId, Date.now());

    if (success && previousOutput) {
      ptyManager.prependOutputBuffer(taskId, previousOutput);
    }
  }

  if (success) {
    // Increment spawn generation for verify sessions too
    const gen = (spawnGeneration.get(taskId) || 0) + 1;
    spawnGeneration.set(taskId, gen);
    const isStale = () => spawnGeneration.get(taskId) !== gen;

    verifyingTasks.add(taskId);

    // Never clear the terminal for verify — keep prior output for context continuity
    // (previously cleared for new sessions, but verify should feel like the same session)

    const now = new Date().toISOString();
    db.prepare('UPDATE tasks SET status = ?, "column" = ?, updated_at = ? WHERE id = ?')
      .run('running', 'in-progress', now, taskId);

    const isAutoPrompt = !explicitCommand && !!agentCliCommands[agentType];
    if (isAutoPrompt) {
      const verifyPrompt = buildVerifyPrompt(taskRow);

      const verificationCount = verificationAttempts.get(taskId) || 0;
      let finalVerifyPrompt = verifyPrompt;
      if (verificationCount >= 3) {
        finalVerifyPrompt += '\n\nIMPORTANT: You have failed to verify this task 3 times. Write a comment explaining the blocker in the walkthrough, output KANABAN_TASK_COMPLETE, and EXIT WITHOUT FURTHER ACTION.';
      }

      console.log(`[kanaban:verify] Injecting verify prompt (${finalVerifyPrompt.length} chars) for "${taskRow.title}", attempt ${verificationCount + 1}`);

      beginInputQueue(taskId);

      const doVerifyInject = () => {
        if (isStale()) { console.log(`[kanaban:verify] Stale verify injection skipped for task=${taskId.slice(0, 8)}`); return; }
        writePromptAndSubmit(taskId, finalVerifyPrompt, agentType).then(() => {
          if (isStale()) return;
          setTimeout(() => { if (!isStale()) flushInputQueue(taskId); }, 500);
          completionDetectionReady.set(taskId, Date.now() + COMPLETION_COOLDOWN_MS);
          setTimeout(() => {
            if (isStale()) return;
            postInjectionOffset.set(taskId, ptyManager.getOutputBuffer(taskId)?.length || 0);
          }, 2000);
        });
      };

      if (hasExistingSession) {
        // Agent is already running — short delay is fine
        setTimeout(doVerifyInject, 500);
      } else if (READY_PROMPT_AGENTS.has(agentType)) {
        waitForReadyPrompt(taskId, agentType, doVerifyInject);
      } else {
        const verifyStartupDelay = SPLIT_ENTER_AGENTS.has(agentType) ? 6000 : 3000;
        setTimeout(doVerifyInject, verifyStartupDelay);
      }
    }

    broadcastTask(taskId);

    notifications.emit(io, {
      type: 'agent-started',
      taskId,
      data: { command, agentType },
    });

    emitOrchestratorActivity('task-verify', `Verifying "${taskRow.title}"`, { taskId }, 'system');
  }

  broadcastSessions();
  return { success };
}

// ---------- Task Spawn/Kill REST Endpoints ----------

app.post('/api/tasks/:id/spawn', (req: Request, res: Response) => {
  const { command, forceRestart } = req.body || {};
  const result = spawnTaskAgent(req.params.id as string, {
    command: command || undefined,
    forceRestart: Boolean(forceRestart),
  });
  res.json(result);
});

app.post('/api/tasks/:id/kill', (req: Request, res: Response) => {
  const result = killTaskAgent(req.params.id as string);
  res.json(result);
});

app.post('/api/tasks/:id/feedback', (req: Request, res: Response) => {
  const taskId = req.params.id as string;
  const { feedback } = req.body;
  if (!feedback) { res.status(400).json({ error: 'feedback is required' }); return; }

  const taskRow = db.prepare('SELECT * FROM tasks WHERE id = ?').get(taskId) as any;
  if (!taskRow) { res.status(404).json({ error: 'Task not found' }); return; }

  if (!ptyManager.hasSession(taskId)) {
    res.json({ success: false, error: 'No running session. Spawn the task first, then provide feedback.' });
    return;
  }

  const prompt = buildContinuationFeedback(taskRow, feedback);
  writePromptAndSubmit(taskId, prompt, taskRow.agent_type || 'claude');

  db.prepare('UPDATE tasks SET status = ?, column = ?, updated_at = ? WHERE id = ?')
    .run('running', 'in-progress', new Date().toISOString(), taskId);
  broadcastTask(taskId);

  res.json({ success: true, method: 'injected' });
});

app.post('/api/tasks/:id/delegate', (req: Request, res: Response) => {
  const result = delegateTask(req.params.id as string);
  res.json(result);
});

app.post('/api/tasks/:id/verify', (req: Request, res: Response) => {
  const taskId = req.params.id as string;
  const result = verifyTaskAgent(taskId);
  res.json(result);
});

// ---------- Orchestrator Activity Feed (persistent) ----------

// Load persisted state on startup
const orchestratorPersistedState = loadOrchestratorState();
const orchestratorActivities = orchestratorPersistedState.activities;

function emitOrchestratorActivity(type: string, message: string, data?: Record<string, unknown>, source: 'orchestrator' | 'user' | 'system' = 'user'): void {
  const activity: PersistedActivity = {
    id: `${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
    type,
    message,
    timestamp: new Date().toISOString(),
    source,
    data,
  };
  persistActivity(activity);
  io.emit('orchestrator:activity', activity);
}

app.set('emitOrchestratorActivity', emitOrchestratorActivity);

// ---------- Notify Parent Orchestrator ----------

function notifyParentOrchestrator(
  childTaskId: string,
  eventType: 'column-changed' | 'sub-task-created',
  details: { oldColumn?: string; newColumn?: string; title?: string }
): void {
  try {
    const childTask = db.prepare('SELECT * FROM tasks WHERE id = ?').get(childTaskId) as any;
    if (!childTask) return;

    const parentTaskId = childTask.parent_task_id;
    if (!parentTaskId) return;
    if (!delegatedTasks.has(parentTaskId)) return;
    if (!ptyManager.hasSession(parentTaskId)) return;

    const title = details.title || childTask.title || '';
    const shortId = childTaskId.slice(0, 8);
    const boardState = getKanbanStateSummary();

    const message = [
      `[KANABAN EVENT: Task Status Update]`,
      `Task: "${title}" (id: ${shortId})`,
      `From: ${details.oldColumn} -> To: ${details.newColumn}`,
      ``,
      boardState,
    ].join('\n');

    console.log(`[kanaban:delegate] Queueing notification for parent ${parentTaskId.slice(0, 8)} about ${eventType} for task ${shortId}`);
    orchestratorNotificationQueue.push({ taskId: parentTaskId, message: message + '\r' });
    processNotificationQueue();
  } catch (err) {
    console.error('[kanaban:delegate] notifyParentOrchestrator error:', err);
  }
}

// Intercept orchestrator notifications to prevent PTY write races
function processNotificationQueue(): void {
  if (orchestratorNotificationQueue.length === 0) return;

  // Only process one notification per tick, and only if the agent is idle
  const notif = orchestratorNotificationQueue[0];
  const lastOutput = ptyLastOutputTime.get(notif.taskId) ?? 0;

  // Wait 1.5s after last stdout to ensure agent is ready to read stdin
  if (Date.now() - lastOutput < 1500) {
    setTimeout(processNotificationQueue, 500);
    return;
  }

  // Agent appears idle, dequeue and send
  orchestratorNotificationQueue.shift();

  const text = notif.message;
  let cleanText = text;
  let hasCr = false;
  if (text.endsWith('\r')) {
    hasCr = true;
    cleanText = text.slice(0, -1);
  } else if (text.endsWith('\n')) {
    if (text.endsWith('\r\n')) {
      hasCr = true;
      cleanText = text.slice(0, -2);
    }
  }

  if (notif.taskId === '__orchestrator__') {
    if (orchestratorPty && orchestratorRunning) {
      const provider = lastOrchestratorOpts.provider || 'claude';
      if (hasCr && SPLIT_ENTER_AGENTS.has(provider)) {
        orchestratorPty.write(cleanText);
        setTimeout(() => { if (orchestratorPty) orchestratorPty.write('\r'); }, 500);
      } else {
        orchestratorPty.write(notif.message + (hasCr ? '' : '\r'));
      }
      emitOrchestratorActivity('board-update', 'Board state sent to orchestrator', undefined, 'orchestrator');
    }
  } else {
    let agentType = 'claude';
    try {
      const taskRow = db.prepare('SELECT agent_type FROM tasks WHERE id = ?').get(notif.taskId) as { agent_type: string } | undefined;
      if (taskRow && taskRow.agent_type) agentType = taskRow.agent_type;
    } catch (err) { }

    if (hasCr && SPLIT_ENTER_AGENTS.has(agentType)) {
      ptyManager.writeChunked(notif.taskId, cleanText).then(() => {
        setTimeout(() => ptyManager.write(notif.taskId, '\r'), 500);
      });
    } else {
      ptyManager.writeChunked(notif.taskId, notif.message);
    }
  }

  // Process next if any
  if (orchestratorNotificationQueue.length > 0) {
    setTimeout(processNotificationQueue, 1000);
  }
}

app.set('notifyParentOrchestrator', notifyParentOrchestrator);

app.get('/api/orchestrator/activities', (_req: Request, res: Response) => {
  res.json(getPersistedActivities());
});

// ---------- Orchestrator PTY ----------

let orchestratorPty: pty.IPty | null = null;
let orchestratorBuffer = '';
let orchestratorRunning = false;
const MAX_ORCH_BUFFER = 64 * 1024;

// Always-on: track last opts for auto-restart, suppress only during shutdown
let lastOrchestratorOpts: OrchestratorOpts = {};
let orchestratorSuppressRestart = false;
let isOrchestratorEnabled = true;
const ORCHESTRATOR_RESTART_DELAY_MS = 5000;

interface OrchestratorOpts {
  cwd?: string;
  provider?: string;
  model?: string;
}

function spawnOrchestrator(opts?: OrchestratorOpts): boolean {
  if (!isOrchestratorEnabled) {
    console.log('[kanaban:orchestrator] Cannot spawn — orchestrator is disabled');
    return false;
  }

  lastOrchestratorOpts = opts || {};
  if (orchestratorPty) {
    killOrchestrator();
  }
  io.to('orchestrator').emit('orchestrator:clear');

  const isWindows = process.platform === 'win32';
  const provider = opts?.provider || 'claude';
  const rawModel = opts?.model || '';
  const cwd = opts?.cwd;

  // Resolve LM Studio model prefix for orchestrator
  const { model, extraEnv: orchLmsEnv } = resolveLmStudioModel(rawModel);

  // Build command based on provider
  const cliCommand = agentCliCommands[provider] || provider;
  const yoloFlag = yoloFlags[provider] || '';
  let command = cliCommand;
  if (yoloFlag) command += ` ${yoloFlag}`;
  if (model) command += ` --model ${model}`;

  console.log(`[kanaban:orchestrator] Command: "${command}" provider=${provider} model=${model || '(default)'}${orchLmsEnv ? ' [lmstudio]' : ''}`);

  const shell = isWindows ? 'cmd.exe' : '/bin/bash';
  const args = isWindows ? ['/c', command] : ['-c', command];

  const cleanEnv: { [key: string]: string } = {};
  for (const [k, v] of Object.entries(process.env)) {
    if (v !== undefined && !k.startsWith('CLAUDE')) {
      cleanEnv[k] = v;
    }
  }
  // Merge LM Studio env vars if applicable
  if (orchLmsEnv) {
    Object.assign(cleanEnv, orchLmsEnv);
  }

  try {
    orchestratorPty = pty.spawn(shell, args, {
      name: 'xterm-256color',
      cols: 120,
      rows: 30,
      cwd: cwd || process.cwd(),
      env: cleanEnv,
    });

    orchestratorBuffer = '';
    orchestratorRunning = true;
    io.emit('orchestrator:status', { running: true });

    // Ready-prompt detection: watch PTY output for TUI input prompt instead of blind timeouts
    // Claude is excluded — it uses fixed delays because its first ">" is the YOLO confirm prompt
    const readyPattern = (provider !== 'claude') ? />\s*$/m : null;
    let orchPromptInjected = false;
    let orchReadyDetectionEnabled = true;  // for claude, disabled until after YOLO confirm
    let orchRecentOutput = '';  // rolling window to match ready pattern

    const injectOrchestratorPrompt = () => {
      if (orchPromptInjected || !orchestratorPty) return;
      orchPromptInjected = true;
      const directives: string[] = [];
      const prompt = getOrchestratorPrompt(directives);
      if (SPLIT_ENTER_AGENTS.has(provider)) {
        orchestratorPty.write(prompt);
        setTimeout(() => { if (orchestratorPty) orchestratorPty.write('\r'); }, 500);
      } else {
        orchestratorPty.write(prompt + '\r');
      }
      console.log(`[kanaban:orchestrator] Injected system prompt (${prompt.length} chars)`);
    };

    orchestratorPty.onData((data: string) => {
      orchestratorBuffer += data;
      if (orchestratorBuffer.length > MAX_ORCH_BUFFER) {
        orchestratorBuffer = orchestratorBuffer.slice(orchestratorBuffer.length - MAX_ORCH_BUFFER);
      }
      io.to('orchestrator').emit('orchestrator:output', data);
      ptyLastOutputTime.set('__orchestrator__', Date.now());
      updateOutputTail(orchestratorBuffer);

      // Parse smart alerts from orchestrator output
      const SMART_ALERT_REGEX = /<<<SMART_ALERT:(.*?)>>>/gs;
      const alertMatches = [...data.matchAll(SMART_ALERT_REGEX)];
      for (const match of alertMatches) {
        try {
          const alert = JSON.parse(match[1]);
          if (alert && alert.message) {
            bus.emit('bus:smart-alert', 'server', null, {
              severity: alert.severity || 'info',
              message: alert.message,
            });
            console.log(`[kanaban:orchestrator] Smart alert (${alert.severity}): ${alert.message}`);
          }
        } catch {
          // Invalid JSON in alert — ignore
        }
      }

      // Detect readiness from PTY output (non-claude providers)
      if (!orchPromptInjected && readyPattern && orchReadyDetectionEnabled) {
        orchRecentOutput += data;
        if (orchRecentOutput.length > 2048) {
          orchRecentOutput = orchRecentOutput.slice(-1024);
        }
        if (readyPattern.test(orchRecentOutput)) {
          console.log(`[kanaban:orchestrator] Ready prompt detected for ${provider}`);
          // Small delay to let TUI fully settle
          setTimeout(injectOrchestratorPrompt, 500);
        }
      }
    });

    orchestratorPty.onExit(() => {
      orchestratorRunning = false;
      orchestratorPty = null;
      io.emit('orchestrator:status', { running: false });
      setOrchestratorStopped();
      console.log('[kanaban:orchestrator] Orchestrator process exited');

      // Always-on: auto-restart unless server is shutting down or orchestrated is disabled
      if (!orchestratorSuppressRestart && isOrchestratorEnabled) {
        console.log(`[kanaban:orchestrator] Auto-restarting in ${ORCHESTRATOR_RESTART_DELAY_MS / 1000}s...`);
        emitOrchestratorActivity('orchestrator-restart', `Orchestrator restarting in ${ORCHESTRATOR_RESTART_DELAY_MS / 1000}s...`, undefined, 'orchestrator');
        setTimeout(() => {
          if (!orchestratorSuppressRestart && isOrchestratorEnabled) {
            spawnOrchestrator(lastOrchestratorOpts);
          }
        }, ORCHESTRATOR_RESTART_DELAY_MS);
      }
    });

    console.log('[kanaban:orchestrator] Spawned orchestrator');
    setOrchestratorStarted(provider, model);
    emitOrchestratorActivity('orchestrator-started', `Orchestrator started (${provider}${model ? ` / ${model}` : ''})`, undefined, 'orchestrator');

    // Claude with --dangerously-skip-permissions auto-accepts in v2.1+
    // Non-claude: rely on ready-prompt detection
    const readyPattern2 = />\s*$/m;
    const injectionTimeout = 45000;

    // Enable prompt detection after brief startup delay
    setTimeout(() => {
      orchReadyDetectionEnabled = true;

      // Fallback injection if ready pattern is missed
      setTimeout(() => {
        if (!orchPromptInjected) {
          console.log(`[kanaban:orchestrator] Ready pattern timeout (${injectionTimeout}ms) — injecting prompt (fallback)`);
          injectOrchestratorPrompt();
        }
      }, injectionTimeout);

    }, 500);

    return true;
  } catch (err) {
    console.error('[kanaban:orchestrator] Failed to spawn:', err);
    orchestratorRunning = false;
    return false;
  }
}

function killOrchestrator(): boolean {
  if (!orchestratorPty) return false;
  try {
    orchestratorPty.kill();
  } catch {
    // Process may have already exited
  }
  orchestratorPty = null;
  orchestratorBuffer = '';
  orchestratorRunning = false;
  io.emit('orchestrator:status', { running: false });
  emitOrchestratorActivity('orchestrator-stopped', 'Orchestrator stopped', undefined, 'orchestrator');
  console.log('[kanaban:orchestrator] Killed orchestrator');
  return true;
}

function writeOrchestrator(data: string): void {
  if (orchestratorPty) {
    if (data.length > 256) {
      // Chunked write for large data (similar to PtyManager.writeChunked)
      let offset = 0;
      const chunkSize = 256;
      const delayMs = 10;
      const writeNext = () => {
        if (!orchestratorPty || offset >= data.length) return;
        const chunk = data.slice(offset, offset + chunkSize);
        try {
          orchestratorPty.write(chunk);
        } catch {
          // Process may have exited
          return;
        }
        offset += chunkSize;
        if (offset < data.length) {
          setTimeout(writeNext, delayMs);
        }
      };
      writeNext();
    } else {
      try {
        orchestratorPty.write(data);
      } catch {
        // Process may have exited
      }
    }
  }
}

function resizeOrchestrator(cols: number, rows: number): void {
  if (orchestratorPty) {
    try {
      orchestratorPty.resize(cols, rows);
    } catch {
      // ignore
    }
  }
}

// Orchestrator REST endpoints
app.get('/api/orchestrator/status', (_req: Request, res: Response) => {
  const orchState = loadOrchestratorState()
  res.json({
    running: orchestratorRunning,
    enabled: isOrchestratorEnabled,
    provider: orchState.provider || null,
    model: orchState.model || null,
    startedAt: orchState.startedAt || null,
  });
});

app.get('/api/health/status', (_req: Request, res: Response) => {
  res.json(getHealthStatus())
});

app.get('/api/server/stats', (_req: Request, res: Response) => {
  let dbSizeBytes = 0
  try {
    dbSizeBytes = statSync(path.resolve('data/kanaban.db')).size
  } catch { /* db file may not exist yet */ }

  res.json({
    uptime: Math.floor(process.uptime()),
    connectedSockets: io.engine.clientsCount,
    dbSizeBytes,
    memoryUsageMB: Math.round(process.memoryUsage().rss / 1024 / 1024),
  })
});

app.post('/api/orchestrator/spawn', (req: Request, res: Response) => {
  const { cwd, provider, model } = req.body || {};
  const success = spawnOrchestrator({ cwd, provider, model });
  res.json({ success });
});

app.post('/api/orchestrator/kill', (_req: Request, res: Response) => {
  const success = killOrchestrator();
  res.json({ success });
});

// ---------- Socket.io Event Handlers ----------

io.on('connection', (socket: Socket) => {
  const transport = socket.conn.transport.name;
  console.log(`[socket] Client connected: ${socket.id} (transport=${transport}, ip=${socket.handshake.address})`);

  socket.conn.on('upgrade', () => {
    console.log(`[socket] Client upgraded: ${socket.id} (transport=${socket.conn.transport.name})`);
  });

  socket.on('error', (err) => {
    console.error(`[socket] Client error: ${socket.id}`, err);
  });

  // Send current session status and orchestrator status to the newly connected client
  broadcastSessions();
  socket.emit('orchestrator:status', { running: orchestratorRunning, enabled: isOrchestratorEnabled });

  // Request sessions list on demand (unicast to requester only)
  // Uses the same DB query as broadcastSessions() to ensure consistency —
  // previously used ptyManager.getActiveSessions() which could return 0 when
  // PTY processes had exited but tasks were still in in-progress/review columns.
  socket.on('sessions:request', () => {
    const activeTasks = db.prepare(`
      SELECT t.*, w.name as workspace_name
      FROM tasks t
      LEFT JOIN workspaces w ON t.workspace_id = w.id
      WHERE t."column" IN ('in-progress', 'review', 'inspect')
    `).all() as any[];
    const sessions = activeTasks.map((task) => ({
      taskId: task.id,
      title: task.title || 'Unknown',
      agentType: task.agent_type || 'generic',
      status: task.status || 'idle',
      column: task.column || 'in-progress',
      command: task.command || '',
      workingDir: task.working_dir || '',
      connected: ptyManager.hasSession(task.id),
      updatedAt: task.updated_at || '',
      createdAt: task.created_at || '',
      model: task.model || '',
      workspaceId: task.workspace_id || '',
      workspaceName: task.workspace_name || '',
    }));

    // Include active planner sessions
    const plannerSessionsList = Array.from(activePlanners.entries()).map(([sessionId, planId]) => {
      const plan = db.prepare('SELECT * FROM plans WHERE id = ?').get(planId) as any;
      const ws = plan?.workspace_id
        ? (db.prepare('SELECT name FROM workspaces WHERE id = ?').get(plan.workspace_id) as any)
        : null;
      const prompt = plan?.original_prompt || '';
      return {
        taskId: sessionId,
        title: `Planning: ${prompt.length > 30 ? prompt.substring(0, 30) + '...' : prompt}`,
        agentType: plan?.agent_type || 'claude',
        status: 'thinking',
        column: 'planner',
        command: '',
        workingDir: '',
        connected: true,
        updatedAt: plan?.created_at || '',
        createdAt: plan?.created_at || '',
        model: plan?.model || '',
        workspaceId: plan?.workspace_id || '',
        workspaceName: ws?.name || '',
        type: 'planner',
      };
    });

    // Include active chat sessions
    const chatSessionsList = Array.from(activeChats.values()).map(chat => {
      const ws = db.prepare('SELECT name FROM workspaces WHERE id = ?').get(chat.workspaceId) as any;
      return {
        taskId: `agent-chat:${chat.chatId}`,
        title: 'Workspace Terminal',
        agentType: chat.agentType,
        status: 'running',
        column: '',
        connected: true,
        updatedAt: new Date().toISOString(),
        createdAt: new Date().toISOString(),
        model: chat.model,
        workspaceId: chat.workspaceId,
        workspaceName: ws?.name || '',
        command: '',
        workingDir: '',
        type: 'agent-chat',
      };
    });

    socket.emit('sessions:status', [...sessions, ...plannerSessionsList, ...chatSessionsList]);
  });

  // Join a task room to receive events for that task
  socket.on('task:join', (taskId: string) => {
    socket.join(`task:${taskId}`);

    // Replay buffered output so the terminal isn't blank
    // First try in-memory buffer (active session), then fall back to session file (post-restart)
    let buffer = ptyManager.getOutputBuffer(taskId);
    if (!buffer) {
      buffer = ptyManager.readSessionFile(taskId);
      if (buffer) {
        console.log(`[kanaban:join] Replaying ${buffer.length} chars from session file for task=${taskId.slice(0, 8)}`);
      }
    } else {
      console.log(`[kanaban:join] Replaying ${buffer.length} chars from memory buffer for task=${taskId.slice(0, 8)}`);
    }
    if (buffer) {
      socket.emit('task:output', { taskId, data: buffer });
    }
  });

  // Leave a task room
  socket.on('task:leave', (taskId: string) => {
    socket.leave(`task:${taskId}`);
  });

  // Spawn a PTY for a task
  socket.on('task:spawn', (data: { taskId: string; command?: string; agentType?: string }) => {
    const { taskId } = data;
    // Manual spawn/restart from UI - enforce restart if already running
    const result = spawnTaskAgent(taskId, { command: data.command, agentType: data.agentType, forceRestart: true });
    if (result.success) {
      socket.join(`task:${taskId}`);
    }
    io.to(`task:${taskId}`).emit('task:spawn:result', result);
    socket.emit('task:spawn:result', { taskId, success: result.success });
  });

  // Kill a PTY for a task
  socket.on('task:kill', (data: { taskId: string }) => {
    const { taskId } = data;
    const result = killTaskAgent(taskId);
    socket.emit('task:kill:result', { taskId, success: result.success });
  });

  // Spawn a planner agent for a plan
  socket.on('plan:spawn', (data: { planId: string; agentType: string; model: string; workspaceId: string }) => {
    const result = spawnPlannerAgent(data.planId, data.agentType, data.model, data.workspaceId);
    socket.emit('plan:spawn:result', { planId: data.planId, ...result });
  });

  // Send a user answer to the planner PTY during the interview phase
  socket.on('plan:answer', (data: { planId: string; answer: string }) => {
    const sessionId = `plan:${data.planId}`;
    if (!ptyManager.hasSession(sessionId)) {
      console.warn(`[kanaban:planner] plan:answer — no session for plan=${data.planId.slice(0, 8)}`);
      return;
    }
    // Use raw write (not writePromptAndSubmit) — answers are short real-time input
    ptyManager.write(sessionId, data.answer + '\r');
    // No offset advancement needed: user answer text doesn't contain MSG_START/MSG_END markers,
    // so the scanner will simply skip past the echo without false positives.
    console.log(`[kanaban:planner] Answer sent to plan=${data.planId.slice(0, 8)}: "${data.answer.slice(0, 60)}"`);
  });

  // User requests immediate plan generation, skipping remaining questions
  socket.on('plan:generate-now', (data: { planId: string }) => {
    const sessionId = `plan:${data.planId}`;
    if (!ptyManager.hasSession(sessionId)) {
      console.warn(`[kanaban:planner] plan:generate-now — no session for plan=${data.planId.slice(0, 8)}`);
      return;
    }
    ptyManager.write(sessionId, GENERATE_NOW_MSG + '\r');
    console.log(`[kanaban:planner] Generate-now sent for plan=${data.planId.slice(0, 8)}`);
  });

  // Modal closed — kill the planner session and mark plan as failed if still in progress
  socket.on('plan:kill', (data: { planId: string }) => {
    const sessionId = `plan:${data.planId}`;
    if (ptyManager.hasSession(sessionId)) ptyManager.kill(sessionId);
    activePlanners.delete(sessionId);
    plannerSignalBuffer.delete(sessionId);
    plannerMessageOffset.delete(sessionId);
    db.prepare("UPDATE plans SET status = 'failed', error = 'Cancelled by user' WHERE id = ? AND status IN ('interviewing', 'generating')")
      .run(data.planId);
    broadcastSessions();
    console.log(`[kanaban:planner] Plan ${data.planId.slice(0, 8)} killed by user`);
  });

  // ---------- Agent Chat Handlers ----------

  socket.on('agent-chat:spawn', (data: { agentType: string; model: string; workspaceId: string; yolo?: boolean }) => {
    if (!validateEvent('agent-chat:spawn', AgentChatSpawnSchema, data)) return;
    const { agentType, model, workspaceId } = data;

    // Resolve workspace path
    let workingDir = '';
    if (workspaceId) {
      const ws = db.prepare('SELECT path FROM workspaces WHERE id = ?').get(workspaceId) as any;
      if (ws?.path) workingDir = ws.path;
    }
    if (!workingDir) {
      socket.emit('agent-chat:spawn:result', { success: false, error: 'Workspace not found or has no path' });
      return;
    }

    // Cap: max 3 workspace terminals per workspace
    const activeInWorkspace = Array.from(activeChats.values()).filter(c => c.workspaceId === workspaceId).length;
    if (activeInWorkspace >= 3) {
      socket.emit('agent-chat:spawn:result', { success: false, error: 'Maximum 3 workspace terminals per workspace' });
      return;
    }

    // Create chat record in DB
    const chatId = createChat(workspaceId, agentType, model);
    const sessionId = `agent-chat:${chatId}`;

    // Build command
    const cliCommand = agentCliCommands[agentType];
    if (!cliCommand) {
      socket.emit('agent-chat:spawn:result', { success: false, error: `No CLI command for agent type: ${agentType}` });
      return;
    }

    let command = cliCommand;
    if (model) command += ` --model ${model}`;

    // Apply yolo mode if requested (defaults to true for backward compat)
    if (data.yolo !== false) {
      const yoloFlag = yoloFlags[agentType];
      if (yoloFlag) command += ` ${yoloFlag}`;
    }

    const chatDims = getTaskTermDims(sessionId);
    const success = ptyManager.spawn(sessionId, command, agentType, workingDir, undefined, chatDims.cols, chatDims.rows);
    if (!success) {
      socket.emit('agent-chat:spawn:result', { success: false, error: 'Failed to spawn PTY' });
      return;
    }

    activeChats.set(chatId, { chatId, workspaceId, agentType, model });

    socket.join(`agent-chat:${chatId}`);

    // Plain terminal — no system prompt injection. User types directly.
    socket.emit('agent-chat:spawn:result', { success: true, chatId });
    broadcastSessions();
    console.log(`[kanaban:chat] Spawned chat session chatId=${chatId.slice(0, 8)} agent=${agentType} workspace=${workspaceId.slice(0, 8)}`);
  });

  socket.on('agent-chat:input', (data: { chatId: string; input: string }) => {
    if (!validateEvent('agent-chat:input', AgentChatInputSchema, data)) return;
    const { chatId, input } = data;
    const sessionId = `agent-chat:${chatId}`;
    if (!ptyManager.hasSession(sessionId)) {
      console.warn(`[kanaban:chat] agent-chat:input — no session for chat=${chatId.slice(0, 8)}`);
      return;
    }

    // Plain terminal — forward raw keystrokes directly to PTY
    ptyManager.write(sessionId, input);
  });

  socket.on('agent-chat:kill', (data: { chatId: string }) => {
    if (!validateEvent('agent-chat:kill', AgentChatKillSchema, data)) return;
    const { chatId } = data;
    const sessionId = `agent-chat:${chatId}`;
    if (ptyManager.hasSession(sessionId)) ptyManager.kill(sessionId);
    activeChats.delete(chatId);
    closeChat(chatId);
    io.to(`agent-chat:${chatId}`).emit('agent-chat:kill:result', { chatId, success: true });
    broadcastSessions();
    console.log(`[kanaban:chat] Chat ${chatId.slice(0, 8)} killed by user`);
  });

  socket.on('agent-chat:resize', (data: { chatId: string; cols: number; rows: number }) => {
    const { chatId, cols, rows } = data;
    if (!chatId || !cols || !rows || cols < 1 || rows < 1) return;
    const sessionId = `agent-chat:${chatId}`;
    taskTermDimensions.set(sessionId, { cols, rows });
    ptyManager.resize(sessionId, cols, rows);
  });

  socket.on('agent-chat:join', (chatId: string) => {
    socket.join(`agent-chat:${chatId}`);
    // Replay buffered output
    const sessionId = `agent-chat:${chatId}`;
    const buffer = ptyManager.getOutputBuffer(sessionId);
    if (buffer) {
      socket.emit('agent-chat:output', { chatId, data: buffer });
    }
    console.log(`[kanaban:chat] Client joined chat room ${chatId.slice(0, 8)}`);
  });

  socket.on('agent-chat:leave', (chatId: string) => {
    socket.leave(`agent-chat:${chatId}`);
    console.log(`[kanaban:chat] Client left chat room ${chatId.slice(0, 8)}`);
  });

  socket.on('agent-chat:history', (data: { workspaceId: string }) => {
    if (!validateEvent('agent-chat:history', AgentChatHistorySchema, data)) return;
    const chat = getChatByWorkspace(data.workspaceId);
    if (!chat) {
      socket.emit('agent-chat:history-response', { chatId: null, status: 'none', agentType: null, model: null });
      return;
    }
    const sessionId = `agent-chat:${chat.id}`;
    const isAlive = ptyManager.hasSession(sessionId);
    socket.emit('agent-chat:history-response', {
      chatId: chat.id,
      status: isAlive ? 'active' : 'closed',
      agentType: chat.agentType,
      model: chat.model
    });
  });

  // Toggle YOLO mode for a task (works on running agents too)
  socket.on('task:toggle-yolo', (data: { taskId: string }) => {
    const { taskId } = data;
    const taskRow = db.prepare('SELECT * FROM tasks WHERE id = ?').get(taskId) as any;
    if (!taskRow) {
      socket.emit('task:toggle-yolo:result', { taskId, success: false, error: 'Task not found' });
      return;
    }

    const newYolo = taskRow.yolo ? 0 : 1;
    const now = new Date().toISOString();
    db.prepare('UPDATE tasks SET yolo = ?, updated_at = ? WHERE id = ?').run(newYolo, now, taskId);
    console.log(`[kanaban:yolo] Toggled YOLO for task=${taskId.slice(0, 8)} — now ${newYolo ? 'ON' : 'OFF'}`);

    // If agent is running and it's a Claude-type agent, send Shift+Tab to toggle accept-edits mode
    // \x1b[Z = Shift+Tab escape sequence — cycles permission mode in Claude Code
    if (ptyManager.hasSession(taskId)) {
      const agentType = taskRow.agent_type || 'generic';
      if (agentType === 'claude' || agentType === 'kilo') {
        ptyManager.write(taskId, '\x1b[Z');
        console.log(`[kanaban:yolo] Sent Shift+Tab (\\x1b[Z) to running ${agentType} agent for task=${taskId.slice(0, 8)}`);
      }
    }

    broadcastTask(taskId);
    socket.emit('task:toggle-yolo:result', { taskId, success: true, yolo: Boolean(newYolo) });
  });

  // Toggle Auto Review for a task
  socket.on('task:toggle-auto-review', (data: { taskId: string }) => {
    const { taskId } = data;
    const taskRow = db.prepare('SELECT * FROM tasks WHERE id = ?').get(taskId) as any;
    if (!taskRow) {
      socket.emit('task:toggle-auto-review:result', { taskId, success: false, error: 'Task not found' });
      return;
    }

    const newAutoReview = taskRow.auto_review ? 0 : 1;
    const now = new Date().toISOString();
    db.prepare('UPDATE tasks SET auto_review = ?, updated_at = ? WHERE id = ?').run(newAutoReview, now, taskId);
    console.log(`[kanaban:auto-review] Toggled Auto Review for task=${taskId.slice(0, 8)} — now ${newAutoReview ? 'ON' : 'OFF'}`);

    broadcastTask(taskId);
    socket.emit('task:toggle-auto-review:result', { taskId, success: true, autoReview: Boolean(newAutoReview) });
  });

  // Toggle Waitlisted for a task
  socket.on('task:toggle-waitlist', (data: { taskId: string }) => {
    const { taskId } = data;
    const taskRow = db.prepare('SELECT * FROM tasks WHERE id = ?').get(taskId) as any;
    if (!taskRow) {
      socket.emit('task:toggle-waitlist:result', { taskId, success: false, error: 'Task not found' });
      return;
    }

    const newWaitlisted = taskRow.waitlisted ? 0 : 1;
    const now = new Date().toISOString();
    db.prepare('UPDATE tasks SET waitlisted = ?, updated_at = ? WHERE id = ?').run(newWaitlisted, now, taskId);
    console.log(`[kanaban:waitlist] Toggled waitlist for task=${taskId.slice(0, 8)} — now ${newWaitlisted ? 'ON' : 'OFF'}`);

    broadcastTask(taskId);
    socket.emit('task:toggle-waitlist:result', { taskId, success: true, waitlisted: Boolean(newWaitlisted) });
  });

  // Toggle Auto Complete for a task (controls whether KANABAN_TASK_COMPLETE signal auto-finalizes)
  socket.on('task:toggle-auto-complete', (data: { taskId: string }) => {
    const { taskId } = data;
    const taskRow = db.prepare('SELECT * FROM tasks WHERE id = ?').get(taskId) as any;
    if (!taskRow) {
      socket.emit('task:toggle-auto-complete:result', { taskId, success: false, error: 'Task not found' });
      return;
    }

    const currentValue = taskRow.auto_complete === null || taskRow.auto_complete === undefined ? 1 : taskRow.auto_complete;
    const newAutoComplete = currentValue ? 0 : 1;
    const now = new Date().toISOString();
    db.prepare('UPDATE tasks SET auto_complete = ?, updated_at = ? WHERE id = ?').run(newAutoComplete, now, taskId);
    console.log(`[kanaban:auto-complete] Toggled Auto Complete for task=${taskId.slice(0, 8)} — now ${newAutoComplete ? 'ON' : 'OFF'}`);

    broadcastTask(taskId);
    socket.emit('task:toggle-auto-complete:result', { taskId, success: true, autoComplete: Boolean(newAutoComplete) });
  });

  // Manual task complete — directly finalize regardless of auto_complete setting
  socket.on('task:manual-complete', (data: { taskId: string }) => {
    const { taskId } = data;
    const taskRow = db.prepare('SELECT id, "column" FROM tasks WHERE id = ?').get(taskId) as any;
    if (!taskRow) {
      socket.emit('task:manual-complete:result', { taskId, success: false, error: 'Task not found' });
      return;
    }
    console.log(`[kanaban:manual-complete] Manual complete triggered for task=${taskId.slice(0, 8)}`);
    signalFinalizedTasks.add(taskId);
    finalizeTask(taskId, 0, false);
    socket.emit('task:manual-complete:result', { taskId, success: true });
  });

  // Trigger waitlist processing (e.g. after dragging a waitlisted task to in-progress)
  socket.on('waitlist:check', () => {
    setTimeout(() => processWaitlist(), 500);
  });

  // Write to PTY stdin (queues during prompt injection)
  socket.on('task:input', (data: { taskId: string; input: string }) => {
    if (!validateEvent<TaskInput>('task:input', TaskInputSchema, data)) return;
    const { taskId, input } = data;

    // If a prompt injection is pending, queue user input instead of writing directly
    const queued = inputQueue.get(taskId);
    if (queued) {
      console.log(`[kanaban:input-queue] Queued input (${input.length} chars) for task=${taskId.slice(0, 8)}`);
      queued.push(input);
      return;
    }

    // If no active PTY session and task is in a restartable column, restart the terminal then send input
    if (!ptyManager.hasSession(taskId)) {
      const taskRow = db.prepare('SELECT "column" FROM tasks WHERE id = ?').get(taskId) as any;
      const col = taskRow?.column;
      if (col === 'in-progress' || col === 'review') {
        const usesContinue = col === 'review';
        console.log(`[kanaban:input] No session for ${col} task=${taskId.slice(0, 8)} — restarting terminal${usesContinue ? ' (continue)' : ''}`);
        const result = spawnTaskAgent(taskId, usesContinue ? { continueSession: true } : undefined);
        if (result.success) {
          socket.join(`task:${taskId}`);
          // If spawnTaskAgent set up an input queue (auto-prompt agent), push into it so
          // the user's command is sent after prompt injection completes.
          const newQueued = inputQueue.get(taskId);
          if (newQueued) {
            newQueued.push(input);
          } else {
            // Generic agent with explicit command — write after a brief delay
            setTimeout(() => ptyManager.write(taskId, input), 500);
          }
        }
        return;
      }
    }

    // For split-enter agents (e.g. qwen), separate text from trailing Enter
    const taskRow2 = db.prepare('SELECT agent_type FROM tasks WHERE id = ?').get(taskId) as any;
    const agentType2 = taskRow2?.agent_type || 'generic';
    if (SPLIT_ENTER_AGENTS.has(agentType2) && input.endsWith('\r')) {
      const text = input.slice(0, -1);
      if (text.length > 0) {
        ptyManager.writeChunked(taskId, text).then(() => {
          setTimeout(() => ptyManager.write(taskId, '\r'), 500);
        });
      } else {
        ptyManager.write(taskId, '\r');
      }
    } else if (input.length > 256) {
      // For large inputs (voice dictation), use chunked writes
      ptyManager.writeChunked(taskId, input);
    } else {
      ptyManager.write(taskId, input);
    }
  });

  // Fire a skill command into PTY
  socket.on('task:skill', (data: { taskId: string; command: string }) => {
    const { taskId, command } = data;

    if (ptyManager.hasSession(taskId)) {
      const skillTask = db.prepare('SELECT agent_type FROM tasks WHERE id = ?').get(taskId) as any;
      const skillAgentType = skillTask?.agent_type || 'generic';
      if (SPLIT_ENTER_AGENTS.has(skillAgentType)) {
        ptyManager.write(taskId, command);
        setTimeout(() => ptyManager.write(taskId, '\r'), 500);
      } else {
        ptyManager.write(taskId, command + '\r');
      }
    } else {
      // If no active session, emit an error
      socket.emit('task:skill:error', {
        taskId,
        error: 'No active PTY session for this task. Spawn an agent first.',
      });
    }
  });

  // Resize PTY
  socket.on('task:resize', (data: { taskId: string; cols: number; rows: number }) => {
    if (!validateEvent('task:resize', TaskResizeSchema, data)) return;
    const { taskId, cols, rows } = data;
    taskTermDimensions.set(taskId, { cols, rows });
    ptyManager.resize(taskId, cols, rows);
  });

  // Review feedback — inject into existing session if alive, or respawn if dead
  socket.on('task:feedback', (data: { taskId: string; feedback: string }) => {
    const { taskId, feedback } = data;

    const taskRow = db.prepare('SELECT * FROM tasks WHERE id = ?').get(taskId) as any;
    if (!taskRow) {
      socket.emit('task:feedback:result', { taskId, success: false, error: 'Task not found' });
      return;
    }

    const explicitCommand = taskRow.command || '';
    const agentType = taskRow.agent_type || 'generic';
    const workingDir = getEffectiveWorkingDir(taskRow);
    let command = explicitCommand || agentCliCommands[agentType] || '';

    // Add model flag if specified (unless command already has --model)
    const feedbackModel = taskRow.model || '';
    const { model: fbResolvedModel, extraEnv: fbLmsEnv } = resolveLmStudioModel(feedbackModel);
    if (fbResolvedModel && !command.includes('--model')) {
      command += ` --model ${fbResolvedModel}`;
    }

    // YOLO mode for feedback respawn
    if (taskRow.yolo && command) {
      const flag = yoloFlags[agentType];
      if (flag && !command.includes(flag)) {
        command = `${command} ${flag}`;
      }
    }

    if (!command) {
      socket.emit('task:feedback:result', { taskId, success: false, error: 'No agent command configured' });
      return;
    }

    // Check if the PTY session is still alive (finalizeTask keeps it alive on review)
    const sessionAlive = ptyManager.hasSession(taskId);

    console.log(`[kanaban:feedback] Task="${taskRow.title}" agent=${agentType} sessionAlive=${sessionAlive} model="${fbResolvedModel || feedbackModel}" command="${command}"`);

    let success = true;

    if (sessionAlive) {
      // ---- Session alive: inject feedback directly into existing session ----
      console.log(`[kanaban:feedback] Continuing existing session for "${taskRow.title}" — no respawn`);

      const gen = (spawnGeneration.get(taskId) || 0) + 1;
      spawnGeneration.set(taskId, gen);
      const isStale = () => spawnGeneration.get(taskId) !== gen;

      const now = new Date().toISOString();
      db.prepare('UPDATE tasks SET status = ?, "column" = ?, updated_at = ? WHERE id = ?')
        .run('running', 'in-progress', now, taskId);

      socket.join(`task:${taskId}`);

      const isAutoPrompt = !explicitCommand && !!agentCliCommands[agentType];
      const continuationPrompt = isAutoPrompt
        ? buildContinuationFeedback(taskRow, feedback)
        : feedback;

      console.log(`[kanaban:feedback] Injecting continuation feedback (${continuationPrompt.length} chars) into live session for "${taskRow.title}"`);

      beginInputQueue(taskId);

      const doContinuationInject = () => {
        if (isStale()) { console.log(`[kanaban:feedback] Stale continuation injection skipped for task=${taskId.slice(0, 8)}`); return; }
        writePromptAndSubmit(taskId, continuationPrompt, agentType).then(() => {
          if (isStale()) return;
          setTimeout(() => { if (!isStale()) flushInputQueue(taskId); }, 500);
          completionDetectionReady.set(taskId, Date.now() + COMPLETION_COOLDOWN_MS);
          setTimeout(() => {
            if (isStale()) return;
            postInjectionOffset.set(taskId, ptyManager.getOutputBuffer(taskId)?.length || 0);
          }, 2000);
        });
      };

      // Small delay to let the agent's TUI settle, but no startup wait needed
      setTimeout(doContinuationInject, 500);

      broadcastTask(taskId);

      notifications.emit(io, {
        type: 'agent-started',
        taskId,
        data: { command, agentType },
      });
    } else {
      // ---- Session dead: respawn agent (with --continue for supported agents) ----
      const useContinue = CONTINUE_FLAG_AGENTS.has(agentType) && !explicitCommand;
      console.log(`[kanaban:feedback] No live session for "${taskRow.title}" — respawning agent (continue=${useContinue})`);

      // For agents that support --continue, resume the previous conversation
      // so the agent retains full context without replaying the entire prompt.
      let feedbackCommand = command;
      if (useContinue && !feedbackCommand.includes('--continue')) {
        feedbackCommand = feedbackCommand.replace(/^(\S+)/, '$1 --continue');
      }

      const previousOutput = ptyManager.getOutputBuffer(taskId);

      const fbDims = getTaskTermDims(taskId);
      success = ptyManager.spawn(taskId, feedbackCommand, agentType, workingDir || undefined, fbLmsEnv, fbDims.cols, fbDims.rows);

      if (success) {
        if (previousOutput) {
          ptyManager.prependOutputBuffer(taskId, previousOutput);
        }

        const gen = (spawnGeneration.get(taskId) || 0) + 1;
        spawnGeneration.set(taskId, gen);
        const isStale = () => spawnGeneration.get(taskId) !== gen;

        ptySpawnTime.set(taskId, Date.now());

        const now = new Date().toISOString();
        db.prepare('UPDATE tasks SET status = ?, "column" = ?, updated_at = ? WHERE id = ?')
          .run('running', 'in-progress', now, taskId);

        socket.join(`task:${taskId}`);

        const isAutoPrompt = !explicitCommand && !!agentCliCommands[agentType];
        if (isAutoPrompt) {
          // With --continue, agent already has conversation context — use lighter prompt.
          // Without --continue, replay full context so the fresh session understands the task.
          const feedbackPrompt = useContinue
            ? buildContinuationFeedback(taskRow, feedback)
            : buildFeedbackPrompt(taskRow, feedback);
          console.log(`[kanaban:feedback] Injecting ${useContinue ? 'continuation' : 'full'} feedback prompt (${feedbackPrompt.length} chars) for "${taskRow.title}"`);

          beginInputQueue(taskId);

          const doFeedbackInject = () => {
            if (isStale()) { console.log(`[kanaban:feedback] Stale feedback injection skipped for task=${taskId.slice(0, 8)}`); return; }
            writePromptAndSubmit(taskId, feedbackPrompt, agentType).then(() => {
              if (isStale()) return;
              setTimeout(() => { if (!isStale()) flushInputQueue(taskId); }, 500);
              completionDetectionReady.set(taskId, Date.now() + COMPLETION_COOLDOWN_MS);
              setTimeout(() => {
                if (isStale()) return;
                postInjectionOffset.set(taskId, ptyManager.getOutputBuffer(taskId)?.length || 0);
              }, 2000);
            });
          };

          if (READY_PROMPT_AGENTS.has(agentType)) {
            waitForReadyPrompt(taskId, agentType, doFeedbackInject);
          } else {
            const fbStartupDelay = SPLIT_ENTER_AGENTS.has(agentType) ? 6000 : 3000;
            setTimeout(doFeedbackInject, fbStartupDelay);
          }
        } else {
          beginInputQueue(taskId);
          const fbDelay = 2000;
          setTimeout(() => {
            if (isStale()) return;
            writePromptAndSubmit(taskId, feedback, agentType).then(() => {
              if (isStale()) return;
              setTimeout(() => { if (!isStale()) flushInputQueue(taskId); }, 300);
            });
          }, fbDelay);
        }

        broadcastTask(taskId);

        notifications.emit(io, {
          type: 'agent-started',
          taskId,
          data: { command, agentType },
        });
      }
    }

    if (success) {
      emitOrchestratorActivity('task-feedback', `Feedback round for "${taskRow.title}"`, { taskId }, 'user');
    }
    socket.emit('task:feedback:result', { taskId, success });
    broadcastSessions();
  });

  // Verify task — spawn agent to check if work was done correctly
  socket.on('task:verify', (data: { taskId: string; verifyAgent?: string; verifyModel?: string }) => {
    const { taskId } = data;
    const result = verifyTaskAgent(taskId, {
      forceRestart: true,
      overrideAgentType: data.verifyAgent || undefined,
      overrideModel: data.verifyModel !== undefined ? data.verifyModel : undefined,
    });
    if (result.success) {
      socket.join(`task:${taskId}`);
    }
    socket.emit('task:verify:result', { taskId, success: result.success, error: result.error });
  });

  // Delegate task to orchestrator
  socket.on('task:delegate', (data: { taskId: string }) => {
    const { taskId } = data;
    console.log(`[kanaban:delegate] Delegate requested for task ${taskId.slice(0, 8)}`);
    const result = delegateTask(taskId, { forceRestart: true });
    if (result.success) {
      socket.join(`task:${taskId}`);
    }
    socket.emit('task:delegate:result', { taskId, success: result.success, error: result.error });
  });

  // ---------- Orchestrator Socket Events ----------

  socket.on('orchestrator:spawn', (data?: { cwd?: string; provider?: string; model?: string }) => {
    if (data && !validateEvent<OrchestratorSpawn>('orchestrator:spawn', OrchestratorSpawnSchema, data)) return;
    spawnOrchestrator({ cwd: data?.cwd, provider: data?.provider, model: data?.model });
    io.emit('orchestrator:status', { running: orchestratorRunning, enabled: isOrchestratorEnabled });
  });

  socket.on('orchestrator:kill', () => {
    killOrchestrator();
    io.emit('orchestrator:status', { running: orchestratorRunning, enabled: isOrchestratorEnabled });
  });

  socket.on('orchestrator:toggle', (data: { enabled: boolean }) => {
    isOrchestratorEnabled = data.enabled;
    const now = new Date().toISOString();
    db.prepare(`
      INSERT INTO settings (key, value, updated_at) VALUES (?, ?, ?)
      ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at
    `).run('orchestrator_enabled', String(isOrchestratorEnabled), now);

    if (!isOrchestratorEnabled) {
      if (orchestratorRunning) killOrchestrator();
      emitOrchestratorActivity('orchestrator-disabled', 'Orchestrator was disabled by user', undefined, 'user');
    } else {
      emitOrchestratorActivity('orchestrator-enabled', 'Orchestrator was enabled by user', undefined, 'user');
      const orchProvider = (db.prepare(`SELECT value FROM settings WHERE key = 'orchestrator_provider'`).get() as any)?.value || 'claude';
      const orchModel = (db.prepare(`SELECT value FROM settings WHERE key = 'orchestrator_model'`).get() as any)?.value || '';
      spawnOrchestrator({ provider: orchProvider, model: orchModel || undefined });
    }

    io.emit('orchestrator:status', { running: orchestratorRunning, enabled: isOrchestratorEnabled });
  });

  socket.on('orchestrator:input', (data: { input: string }) => {
    if (!validateEvent<OrchestratorInput>('orchestrator:input', OrchestratorInputSchema, data)) return;
    writeOrchestrator(data.input);
  });

  socket.on('orchestrator:join', () => {
    socket.join('orchestrator');
    // Replay buffer
    if (orchestratorBuffer) {
      socket.emit('orchestrator:output', orchestratorBuffer);
    }
  });

  socket.on('orchestrator:leave', () => {
    socket.leave('orchestrator');
  });

  socket.on('orchestrator:resize', (data: { cols: number; rows: number }) => {
    if (!validateEvent('orchestrator:resize', OrchestratorResizeSchema, data)) return;
    resizeOrchestrator(data.cols, data.rows);
  });

  socket.on('orchestrator:request-status', () => {
    socket.emit('orchestrator:status', { running: orchestratorRunning, enabled: isOrchestratorEnabled });
  });

  socket.on('disconnect', (reason) => {
    console.log(`[socket] Client disconnected: ${socket.id} (reason: ${reason})`);
  });
});

// ---------- Server Restart ----------

let restartInProgress = false;
app.post('/api/server/restart', (_req: Request, res: Response) => {
  if (restartInProgress) {
    res.json({ success: true, message: 'Restart already in progress' });
    return;
  }
  restartInProgress = true;
  console.log('[kanaban] Restart requested via API');
  logCrash('Server restart requested via API', new Error('Manual restart'));
  res.json({ success: true, message: 'Server restarting...' });

  // Give the response time to flush, then exit cleanly.
  setTimeout(() => {
    orchestratorSuppressRestart = true;
    stopHealthChecks();
    stopTaskScheduler();
    saveOrchestratorState();
    killOrchestrator();
    ptyManager.killAll();
    db.close();

    // Detect if running under a process manager (concurrently, tsx watch, etc.)
    // that will auto-restart us on exit. In that case, just exit — don't spawn
    // a child process, which would create duplicate servers.
    const isTsxWatch = process.argv.some(a => a.includes('watch'));
    const isConcurrently = !!process.env.CONCURRENTLY_INDEX;

    if (isTsxWatch || isConcurrently) {
      console.log(`[kanaban] Running under process manager (tsx-watch=${isTsxWatch}, concurrently=${isConcurrently}) — exiting to trigger auto-restart`);
    } else {
      // Standalone mode: spawn new server process after a delay.
      // On Windows, use cmd.exe so the child gets its own console —
      // node-pty's AttachConsole crashes if spawned with detached+stdio:ignore directly.
      const restartDelaySec = 5;
      const isWin = process.platform === 'win32';
      const serverScript = 'npx tsx server/index.ts';

      if (isWin) {
        const child = spawn('cmd.exe', ['/c', `powershell -Command "Start-Sleep -Seconds ${restartDelaySec}" & ${serverScript}`], {
          cwd: PROJECT_ROOT,
          detached: true,
          stdio: 'ignore',
          env: { ...process.env, KANABAN_RESTART_DELAY: '2000' },
        });
        child.unref();
      } else {
        const child = spawn('sh', ['-c', `sleep ${restartDelaySec} && ${serverScript}`], {
          cwd: PROJECT_ROOT,
          detached: true,
          stdio: 'ignore',
          env: { ...process.env, KANABAN_RESTART_DELAY: '2000' },
        });
        child.unref();
      }
      console.log(`[kanaban] Server will restart in ${restartDelaySec}s`);
    }

    // Close server first to release port, then exit
    server.close(() => process.exit(0));
    setTimeout(() => process.exit(0), 2000);
  }, 500);
});

// ---------- SPA fallback ----------

if (!isDev) {
  const clientDist = path.resolve(PROJECT_ROOT, 'client', 'dist');
  app.get('*', (_req: Request, res: Response) => {
    res.sendFile(path.join(clientDist, 'index.html'));
  });
} else {
  // In dev mode, redirect root to Vite dev server
  app.get('/', (_req: Request, res: Response) => {
    res.redirect('http://localhost:5173');
  });
}

// ---------- Startup Cleanup ----------
// Reset orphaned tasks stuck in active status from a previous crash/restart
const orphanedCount = db.prepare(
  `UPDATE tasks SET status = 'idle' WHERE status IN ('running', 'executing', 'thinking', 'waiting-for-input')`
).run().changes;
if (orphanedCount > 0) {
  console.log(`[kanaban] Reset ${orphanedCount} orphaned task(s) to idle`);
}

// Reset orphaned agent chat sessions from a previous crash/restart
closeAllActiveChats();
console.log('[server] Reset orphaned agent chat sessions');

// Clean up orphaned session files for tasks that no longer exist in the DB
try {
  const sessionFiles = readdirSync(SESSIONS_DIR).filter((f: string) => f.endsWith('.raw.txt'));
  let orphanedSessionsRemoved = 0;
  for (const filename of sessionFiles) {
    const taskId = filename.replace('.raw.txt', '');
    const exists = db.prepare('SELECT id FROM tasks WHERE id = ?').get(taskId);
    if (!exists) {
      try {
        unlinkSync(path.join(SESSIONS_DIR, filename));
        orphanedSessionsRemoved++;
      } catch { /* ignore */ }
    }
  }
  if (orphanedSessionsRemoved > 0) {
    console.log(`[kanaban:session] Removed ${orphanedSessionsRemoved} orphaned session file(s)`);
  }
} catch { /* ignore errors in session cleanup */ }

// Log server start to crash log for restart pattern analysis
try {
  const startEntry = `[${new Date().toISOString()}] Server started (pid=${process.pid})\n`;
  writeFileSync(path.join(PROJECT_ROOT, 'data', 'crash.log'), startEntry, { flag: 'a' });
} catch { }

// ---------- Event Loop Health Monitor ----------
// Warns if the event loop is blocked by synchronous operations (e.g. SQLite, huge Regex parsing)
let lastTick = Date.now();
setInterval(() => {
  const now = Date.now();
  const lag = now - lastTick - 500;
  if (lag > 100) {
    console.warn(`\n[kanaban:perf] ⚠️ EVENT LOOP BLOCKED for ${lag} ms! ⚠️`);
  }
  lastTick = now;
}, 500).unref();

// ---------- Start Server ----------

function startServer(attempt = 1): void {
  const MAX_LISTEN_RETRIES = 5;
  const RETRY_INTERVAL = 2000;

  server.listen(PORT, () => {
    console.log(`[kanaban] Server running on http://localhost:${PORT}`);
    console.log(`[kanaban] Environment: ${isDev ? 'development' : 'production'}`);
    console.log(`[kanaban] Database: data/kanaban.db`);

    // ---------- Startup Cleanup ----------
    // On server start, all PTYs are gone. Reset any tasks that were left in 'running'/'executing'
    // status from the previous process. Without this, the health-check ghost detection
    // immediately respawns them and re-injects prompts, causing the "session loop" bug.
    const staleRunning = db.prepare(
      `SELECT id, title, status FROM tasks WHERE status IN ('running', 'executing')`
    ).all() as { id: string; title: string; status: string }[];
    if (staleRunning.length > 0) {
      const now = new Date().toISOString();
      const resetStmt = db.prepare('UPDATE tasks SET status = ?, updated_at = ? WHERE id = ?');
      for (const task of staleRunning) {
        resetStmt.run('idle', now, task.id);
        console.log(`[kanaban:startup] Reset stale task "${task.title}" (${task.id.slice(0, 8)}) from ${task.status} → idle`);
      }
    }

    // Start health checks (croner-based, every 60s)
    startHealthChecks({
      db,
      ptyManager,
      broadcastTask,
      broadcastSessions,
      emitActivity: emitOrchestratorActivity,
      spawnTaskAgent,
      verifyTaskAgent,
    });

    // Start task scheduler (croner-based, every 60s) — fires scheduled todo tasks
    startTaskScheduler({
      db,
      ptyManager,
      broadcastTask,
      spawnTaskAgent,
      emitActivity: emitOrchestratorActivity,
    });

    // Always-on: auto-start orchestrator on boot (if enabled)
    const orchEnabledSetting = (db.prepare(`SELECT value FROM settings WHERE key = 'orchestrator_enabled'`).get() as any)?.value;
    isOrchestratorEnabled = orchEnabledSetting !== 'false';
    const orchProvider = (db.prepare(`SELECT value FROM settings WHERE key = 'orchestrator_provider'`).get() as any)?.value || 'claude';
    const orchModel = (db.prepare(`SELECT value FROM settings WHERE key = 'orchestrator_model'`).get() as any)?.value || '';

    if (isOrchestratorEnabled) {
      console.log(`[kanaban:orchestrator] Auto-starting on boot (provider=${orchProvider})...`);
      setTimeout(() => spawnOrchestrator({ provider: orchProvider, model: orchModel || undefined }), 3000);
    } else {
      console.log(`[kanaban:orchestrator] Auto-start skipped (disabled)`);
    }

  });

  server.once('error', (err: NodeJS.ErrnoException) => {
    if (err.code === 'EADDRINUSE' && attempt < MAX_LISTEN_RETRIES) {
      console.log(`[kanaban] Port ${PORT} busy, retrying in ${RETRY_INTERVAL}ms (attempt ${attempt}/${MAX_LISTEN_RETRIES})...`);
      setTimeout(() => startServer(attempt + 1), RETRY_INTERVAL);
    } else {
      console.error(`[kanaban] Fatal: cannot bind to port ${PORT}:`, err.message);
      logCrash(`Fatal: cannot bind to port ${PORT} after ${attempt} attempts`, err);
      process.exit(1);
    }
  });
}

// If restarted via API, wait for old process to release the port
const restartDelay = parseInt(process.env.KANABAN_RESTART_DELAY || '0', 10);
if (restartDelay > 0) {
  console.log(`[kanaban] Restart delay: waiting ${restartDelay}ms for port to free...`);
}
setTimeout(() => startServer(), restartDelay);

// ---------- Orchestrator Periodic Check ----------
// Every 15s, send the current board state to the orchestrator so it can monitor and act
setInterval(() => {
  try {
    const now = new Date().toISOString();

    // Helper: build stuck/ready/review attention lines for a set of tasks
    function buildAttentionLines(tasks: { inProgress: any[]; todo: any[]; review: any[]; inspect?: any[] }): string[] {
      const lines: string[] = [];
      const stuckTasks = tasks.inProgress.filter(t => !ptyManager.hasSession(t.id));
      if (stuckTasks.length > 0) {
        lines.push(`- Stuck tasks (in-progress, no PTY — re-spawn these): ${stuckTasks.map(t => `${t.title} (${t.id.slice(0, 8)})`).join(', ')}`);
      }
      if (tasks.todo.length > 0) {
        lines.push(`- Ready to spawn (todo): ${tasks.todo.map(t => `${t.title} (${t.id.slice(0, 8)})`).join(', ')}`);
      }
      if (tasks.inspect && tasks.inspect.length > 0) {
        const stuckInspect = tasks.inspect.filter(t => !ptyManager.hasSession(t.id));
        if (stuckInspect.length > 0) {
          lines.push(`- Stuck inspections (no PTY — re-trigger): ${stuckInspect.map(t => `${t.title} (${t.id.slice(0, 8)})`).join(', ')}`);
        }
      }
      if (tasks.review.length > 0) {
        lines.push(`- Tasks in review REQUIRE verification. Check walkthroughs:`);
        for (const t of tasks.review) {
          const walkthroughPath = path.join(WALKTHROUGH_DIR, `${t.id}.md`);
          const hasWalkthrough = existsSync(walkthroughPath);
          if (hasWalkthrough) {
            lines.push(`  curl -s -X POST http://localhost:3001/api/tasks/${t.id}/verify  # "${t.title}" (READY)`);
          } else {
            lines.push(`  - "${t.title}" (${t.id.slice(0, 8)}) is MISSING a walkthrough.md summary. The agent must provide one before verification.`);
          }
        }
      }
      return lines;
    }

    // Persist board state snapshot for context recovery after restart
    const boardState = getKanbanStateSummary(undefined);
    updateOrchestratorState({ lastBoardState: boardState });

    // 1. Main orchestrator periodic check
    if (orchestratorRunning && orchestratorPty) {
      const attentionLines = buildAttentionLines({
        inProgress: db.prepare(`SELECT id, title FROM tasks WHERE "column" = 'in-progress' AND (parent_task_id IS NULL OR parent_task_id = '')`).all() as any[],
        todo: db.prepare(`SELECT id, title FROM tasks WHERE "column" = 'todo' AND (parent_task_id IS NULL OR parent_task_id = '')`).all() as any[],
        review: db.prepare(`SELECT id, title FROM tasks WHERE "column" = 'review' AND (parent_task_id IS NULL OR parent_task_id = '')`).all() as any[],
        inspect: db.prepare(`SELECT id, title FROM tasks WHERE "column" = 'inspect' AND (parent_task_id IS NULL OR parent_task_id = '')`).all() as any[],
      });
      const checkParts = [
        `[KANABAN PERIODIC CHECK — ${now}]`,
        `Review the board and take any necessary actions:`,
        boardState,
      ];
      if (attentionLines.length > 0) {
        checkParts.push('### ATTENTION - Action Required', ...attentionLines);
      }
      checkParts.push(`You can spawn new agents for tasks ready to run, verify completed work, or advance the pipeline.`);
      const orchLastOut = ptyLastOutputTime.get('__orchestrator__') ?? 0;
      if (Date.now() - orchLastOut < 15_000) {
        console.log('[kanaban:orchestrator] Skipped 15s periodic check — orchestrator active in last 15s');
      } else {
        notifyOrchestrator(checkParts.join('\n'));
        console.log('[kanaban:orchestrator] Sent 15s periodic board state check');
      }
    }

    // 2. Delegated tasks periodic check — nudge if still running
    for (const taskId of delegatedTasks) {
      if (!ptyManager.hasSession(taskId)) continue;

      const lastOut = ptyLastOutputTime.get(taskId) ?? 0;
      // Relax nudge timeout to 90s to avoid interrupting slow/thinking models (Claude Max/Opus 4.6)
      if (Date.now() - lastOut < 90_000) {
        if (Date.now() - lastOut > 15_000) {
          console.log(`[kanaban:delegate] Skipped periodic check for delegated task ${taskId.slice(0, 8)} — active in last 90s`);
        }
        continue;
      }

      const delegateCheckParts = [
        `[KANABAN PERIODIC CHECK — ${now}]`,
        `Reminder: Complete all work within this session. When finished, move the task to review and output KANABAN_TASK_COMPLETE.`,
      ];
      orchestratorNotificationQueue.push({ taskId, message: delegateCheckParts.join('\n') + '\r' });
      processNotificationQueue();
      console.log(`[kanaban:delegate] Sent 15s periodic check to delegated task ${taskId.slice(0, 8)}`);
    }
  } catch (err) {
    console.error('[kanaban:periodic] Periodic check error:', err instanceof Error ? err.message : err);
  }
}, 15_000);

// ---------- Completion Signal Safety-Net Scan ----------
// Every 30s, scan ALL active PTY output buffers for KANABAN_TASK_COMPLETE.
// This catches signals missed by the onData handler (e.g. completionDetectionReady not set,
// cooldown timing issues, signal split across chunks that the rolling buffer missed).
setInterval(() => {
  try {
    const activeSessions = ptyManager.getActiveSessions();
    for (const taskId of activeSessions) {
      // Skip orchestrator PTY
      if (taskId === '__orchestrator__') continue;
      // Skip already caught by this scan
      if (completionScanFinalized.has(taskId)) continue;
      // Skip tasks currently being verified — let the verify exit handler finalize with isVerified=true
      if (verifyingTasks.has(taskId)) continue;
      // Skip delegated tasks — orchestrator manages their lifecycle
      if (delegatedTasks.has(taskId)) continue;
      // Skip recently spawned tasks — the prompt echo contains KANABAN_TASK_COMPLETE
      // and would cause false positives if scanned too early
      const spawnedAt = ptySpawnTime.get(taskId);
      if (spawnedAt && Date.now() - spawnedAt < SAFETY_NET_MIN_AGE_MS) continue;

      const task = db.prepare('SELECT id, "column", status FROM tasks WHERE id = ?').get(taskId) as any;
      if (!task || task.column !== 'in-progress') continue;

      // Check the tail of the output buffer, skipping the prompt injection echo.
      // Non-TUI agents (lmstudio) echo injected prompt text to PTY output, which
      // includes KANABAN_TASK_COMPLETE. We only scan output produced AFTER the echo.
      const fullBuffer = ptyManager.getOutputBuffer(taskId);
      if (!fullBuffer) continue;

      const echoOffset = postInjectionOffset.get(taskId) || 0;
      const scanBuffer = echoOffset > 0 && echoOffset < fullBuffer.length
        ? fullBuffer.slice(echoOffset)
        : fullBuffer;
      const tail = scanBuffer.slice(-2048);
      const stripped = stripAnsi(tail);

      if (/^\s*\**\s*KANABAN_TASK_COMPLETE\s*\**\s*$/m.test(stripped)) {
        // Skip if auto_complete is disabled for this task
        const taskAutoComplete = db.prepare('SELECT auto_complete FROM tasks WHERE id = ?').get(taskId) as any;
        if (taskAutoComplete?.auto_complete === 0) {
          console.log(`[kanaban:scan] Task ${taskId.slice(0, 8)} has auto_complete=OFF — skipping safety-net finalization`);
          continue;
        }

        completionScanFinalized.add(taskId);
        signalFinalizedTasks.add(taskId);
        // Clean up the onData detection state too
        completionDetectionReady.delete(taskId);
        completionSignalBuffer.delete(taskId);

        console.log(`[kanaban:scan] Safety-net: completion signal found in output buffer for task ${taskId.slice(0, 8)} — finalizing`);
        finalizeTask(taskId, 0, false);
      }
    }
  } catch (err) {
    console.error('[kanaban:scan] Completion scan error:', err instanceof Error ? err.message : err);
  }
}, 30_000);

// Clean up completionScanFinalized when PTY exits (handled in onData exit case already cleans other maps)
// We hook into the existing exit handler by checking the set in the periodic scan — entries are harmless
// and get cleaned up naturally since we skip tasks not in 'in-progress'.

// ---------- Graceful Shutdown ----------

function shutdown() {
  console.log('\n[kanaban] Shutting down...');
  stopHealthChecks();
  stopTaskScheduler();
  saveOrchestratorState();
  orchestratorSuppressRestart = true;
  killOrchestrator();
  ptyManager.killAll();
  db.close();
  server.close(() => {
    console.log('[kanaban] Server closed.');
    process.exit(0);
  });
}

process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);

// ---------- Crash Protection ----------
// Prevent unhandled errors from killing the server (and all agent PTY sessions with it)

const CRASH_LOG = path.join(PROJECT_ROOT, 'data', 'crash.log');
function logCrash(label: string, err: unknown): void {
  const ts = new Date().toISOString();
  const msg = err instanceof Error ? `${err.message}\n${err.stack}` : String(err);
  const entry = `[${ts}] ${label}: ${msg}\n`;
  console.error(`[kanaban] ${label}:`, msg);
  try { writeFileSync(CRASH_LOG, entry, { flag: 'a' }); } catch { }
}

process.on('uncaughtException', (err) => {
  logCrash('Uncaught exception (server kept alive)', err);
});

process.on('unhandledRejection', (reason) => {
  logCrash('Unhandled rejection (server kept alive)', reason);
});
