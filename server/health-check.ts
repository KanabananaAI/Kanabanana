import { Cron } from 'croner';
import type { PtyManager } from './pty-manager.js';

interface HealthCheckDeps {
  db: any;
  ptyManager: PtyManager;
  broadcastTask: (taskId: string) => void;
  broadcastSessions: () => void;
  emitActivity: (type: string, message: string, data?: Record<string, unknown>) => void;
  spawnTaskAgent: (taskId: string) => { success: boolean };
  verifyTaskAgent: (taskId: string) => { success: boolean; error?: string };
}


// --- Health check tracking state ---
let lastRunAt: string | null = null
let ghostTasksDetected = 0
let actionsPerformed: string[] = []

export function getHealthStatus() {
  return {
    lastRun: lastRunAt,
    ghostTasksDetected,
    actionsPerformed,
    status: ghostTasksDetected > 0 ? 'issues' : lastRunAt ? 'healthy' : 'idle',
  }
}

// Prevent re-verifying tasks that were just verified
const recentlyVerified: Set<string> = new Set();

let cronJob: Cron | null = null;

export function startHealthChecks(deps: HealthCheckDeps): void {
  if (cronJob) cronJob.stop();

  // Run every 60 seconds
  cronJob = new Cron('* * * * *', () => {
    try {
      runHealthCheck(deps);
    } catch (err) {
      console.error('[kanaban:health] Health check error:', err);
    }
  });

  console.log('[kanaban:health] Started health checks (every 60s)');
}

export function stopHealthChecks(): void {
  if (cronJob) {
    cronJob.stop();
    cronJob = null;
    console.log('[kanaban:health] Stopped health checks');
  }
}

// Clear tracking for a task (call on spawn/kill/exit) — kept as no-op for API compat
export function resetHealthTracking(_taskId: string): void {}

function runHealthCheck(deps: HealthCheckDeps): void {
  const { db, ptyManager, broadcastTask, broadcastSessions, emitActivity, spawnTaskAgent, verifyTaskAgent } = deps;

  lastRunAt = new Date().toISOString()
  ghostTasksDetected = 0
  actionsPerformed = []

  // ========== 1. Ghost tasks: DB says running but no PTY ==========
  const runningTasks = db.prepare(
    `SELECT id, title, status FROM tasks WHERE status IN ('running', 'executing') AND delegated = 0`
  ).all() as { id: string; title: string; status: string }[];

  for (const task of runningTasks) {
    if (!ptyManager.hasSession(task.id)) {
      // Agent crashed or was killed externally — reset to idle instead of respawning.
      // Auto-respawning caused infinite crash-respawn loops when resources were tight.
      ghostTasksDetected++
      console.log(`[kanaban:health] Ghost task: "${task.title}" (${task.id.slice(0, 8)}) — resetting to idle`);
      emitActivity('ghost-reset', `Ghost task reset: "${task.title}"`, { taskId: task.id });
      actionsPerformed.push(`Reset ghost task "${task.title}" to idle`)
      const now = new Date().toISOString();
      deps.db.prepare('UPDATE tasks SET status = ?, updated_at = ? WHERE id = ?')
        .run('idle', now, task.id);
      broadcastTask(task.id);
      broadcastSessions();
    }
  }

  // ========== 2. Board workflow: move cards toward done ==========

  // 2a. IN-PROGRESS with no agent — no automatic spawning.
  // Tasks stay idle until the user explicitly spawns an agent.
  // (Previously auto-spawned, which caused resource exhaustion with many concurrent agents.)

  // 2b. INSPECT cards → trigger verification if not already running
  const inspectTasks = db.prepare(
    `SELECT id, title, agent_type, delegated, parent_task_id, auto_review FROM tasks
     WHERE "column" = 'inspect' AND status = 'idle' AND delegated = 0`
  ).all() as any[];

  for (const task of inspectTasks) {
    if (ptyManager.hasSession(task.id)) continue;   // already being verified
    if (recentlyVerified.has(task.id)) continue;    // just verified, don't re-trigger
    if (task.parent_task_id) continue;               // sub-task — parent orchestrator handles
    if (task.agent_type === 'generic') continue;     // no agent to verify with

    console.log(`[kanaban:health] Workflow: "${task.title}" in inspect — triggering verification`);
    emitActivity('workflow-verify', `Auto-verifying: "${task.title}"`, { taskId: task.id });

    const result = verifyTaskAgent(task.id);
    if (result.success) {
      actionsPerformed.push(`Auto-verified "${task.title}"`)
      recentlyVerified.add(task.id);
      // Clear after 5 minutes to allow re-verification if it comes back to inspect
      setTimeout(() => recentlyVerified.delete(task.id), 5 * 60 * 1000);
    }
  }

  // 2c. TODO cards — no automatic movement. Tasks stay in todo until
  // the user explicitly drags them to in-progress or spawns an agent.

}
