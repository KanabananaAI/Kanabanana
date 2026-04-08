import { Router, Request, Response } from 'express';
import express from 'express';
import { v4 as uuidv4 } from 'uuid';
import { readdirSync, statSync, existsSync, mkdirSync, writeFileSync, unlinkSync, rmSync } from 'fs';
import { execSync } from 'child_process';
import path from 'path';
import { homedir } from 'os';
import db from '../db.js';

const PROJECT_ROOT = path.resolve(__dirname, '..', '..');
const WALKTHROUGH_DIR = path.resolve(PROJECT_ROOT, 'data', 'walkthroughs');
const TASK_IMAGES_DIR = path.resolve(PROJECT_ROOT, 'data', 'task-images');

const router = Router();

// ---------- Types ----------

interface TaskRow {
  id: string;
  title: string;
  description: string;
  column: string;
  position: number;
  agent_type: string;
  model: string;
  command: string;
  working_dir: string;
  workspace_id: string;
  yolo: number;
  auto_review: number;
  delegated: number;
  parent_task_id: string;
  status: string;
  assignee_id: string;
  template_id: string;
  created_at: string;
  updated_at: string;
  completed_at: string | null;
  archived: number;
  pasted_text: string;
  waitlisted: number;
  input_tokens: number;
  output_tokens: number;
  cache_read_tokens: number;
  cache_write_tokens: number;
  total_tokens: number;
  deployment_id: string;
  deployment_direction: string;
}

interface ChecklistItemRow {
  id: string;
  task_id: string;
  text: string;
  done: number;
  source: string;
  position: number;
  created_at: string;
}

interface NextStepRow {
  id: string;
  task_id: string;
  text: string;
  command: string;
  actioned: number;
  created_at: string;
}

interface ActivityLogRow {
  id: string;
  task_id: string;
  user_id: string;
  action: string;
  detail: string;
  created_at: string;
}

interface TaskImageRow {
  id: string;
  task_id: string;
  filename: string;
  original_name: string;
  mime_type: string;
  size: number;
  created_at: string;
}

interface TagRow {
  id: string;
  name: string;
  color: string;
  created_at: string;
}

interface ScheduleRow {
  id: string;
  task_id: string;
  scheduled_at: string;
  recurrence_interval_minutes: number | null;
  max_executions: number | null;
  executions_completed: number;
  is_active: number;
}

// ---------- Prepared statements ----------

const getAllTasks = db.prepare('SELECT * FROM tasks WHERE (archived=0 OR archived IS NULL) ORDER BY position ASC, created_at ASC');
const getChecklistByTask = db.prepare('SELECT * FROM checklist_items WHERE task_id = ? ORDER BY position ASC');
const getNextStepsByTask = db.prepare('SELECT * FROM next_steps WHERE task_id = ? ORDER BY created_at ASC');
const getDependencies = db.prepare('SELECT depends_on_id FROM task_dependencies WHERE task_id = ?');
const getTaskById = db.prepare('SELECT * FROM tasks WHERE id = ?');
const getImagesByTask = db.prepare('SELECT * FROM task_images WHERE task_id = ? ORDER BY created_at ASC');
const getTagsByTask = db.prepare('SELECT t.* FROM tags t INNER JOIN task_tags tt ON t.id = tt.tag_id WHERE tt.task_id = ? ORDER BY t.name ASC');
const getScheduleByTask = db.prepare('SELECT * FROM task_schedules WHERE task_id = ?');

function broadcastTaskUpdate(taskId: string, req: Request): void {
  const io = req.app.get('io');
  if (!io) return;
  const task = getTaskById.get(taskId) as TaskRow | undefined;
  if (!task) return;
  const checklistItems = getChecklistByTask.all(taskId) as ChecklistItemRow[];
  const nextSteps = getNextStepsByTask.all(taskId) as NextStepRow[];
  const deps = (getDependencies.all(taskId) as { depends_on_id: string }[]).map(d => d.depends_on_id);
  io.emit('task:updated', formatTask(task, checklistItems, nextSteps, deps));
  // Lightweight signal so clients can detect missed full events and re-fetch
  io.emit('tasks:changed', { taskId, timestamp: Date.now() });
}

function formatTask(task: TaskRow, checklistItems: ChecklistItemRow[], nextSteps: NextStepRow[], dependsOn: string[]) {
  const images = (getImagesByTask.all(task.id) as TaskImageRow[]);
  const tags = (getTagsByTask.all(task.id) as TagRow[]);
  const scheduleRow = getScheduleByTask.get(task.id) as ScheduleRow | undefined;
  const schedule = scheduleRow ? {
    id: scheduleRow.id,
    taskId: scheduleRow.task_id,
    scheduledAt: scheduleRow.scheduled_at,
    recurrenceIntervalMinutes: scheduleRow.recurrence_interval_minutes,
    maxExecutions: scheduleRow.max_executions,
    executionsCompleted: scheduleRow.executions_completed,
    isActive: Boolean(scheduleRow.is_active),
  } : null;
  return {
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
    checklistItems: checklistItems.map((item) => ({
      id: item.id,
      taskId: item.task_id,
      text: item.text,
      done: Boolean(item.done),
      source: item.source,
      position: item.position,
    })),
    nextSteps: nextSteps.map((step) => ({
      id: step.id,
      taskId: step.task_id,
      text: step.text,
      command: step.command,
      actioned: Boolean(step.actioned),
    })),
    dependsOn,
    images: images.map((img) => ({
      id: img.id,
      taskId: img.task_id,
      filename: img.filename,
      originalName: img.original_name,
      mimeType: img.mime_type,
      size: img.size,
    })),
    tags: tags.map((tag) => ({
      id: tag.id,
      name: tag.name,
      color: tag.color,
    })),
    archived: Boolean(task.archived),
    pastedText: task.pasted_text || '',
    waitlisted: Boolean(task.waitlisted),
    deploymentId: task.deployment_id || '',
    deploymentDirection: task.deployment_direction || '',
    inputTokens: task.input_tokens || 0,
    outputTokens: task.output_tokens || 0,
    cacheReadTokens: task.cache_read_tokens || 0,
    cacheWriteTokens: task.cache_write_tokens || 0,
    totalTokens: task.total_tokens || 0,
    schedule,
  };
}

// ---------- Routes ----------

/**
 * GET /api/tasks/archived — Get archived tasks
 */
router.get('/api/tasks/archived', (req: Request, res: Response) => {
  try {
    const workspaceId = req.query.workspace_id as string | undefined;
    let tasks: TaskRow[];
    if (workspaceId) {
      tasks = db.prepare('SELECT * FROM tasks WHERE archived=1 AND workspace_id = ? ORDER BY updated_at DESC').all(workspaceId) as TaskRow[];
    } else {
      tasks = db.prepare('SELECT * FROM tasks WHERE archived=1 ORDER BY updated_at DESC').all() as TaskRow[];
    }
    const tasksWithRelations = tasks.map((task) => {
      const checklistItems = getChecklistByTask.all(task.id) as ChecklistItemRow[];
      const nextSteps = getNextStepsByTask.all(task.id) as NextStepRow[];
      const deps = (getDependencies.all(task.id) as { depends_on_id: string }[]).map(d => d.depends_on_id);
      return formatTask(task, checklistItems, nextSteps, deps);
    });
    res.json(tasksWithRelations);
  } catch (err) {
    res.status(500).json({ error: 'Failed to fetch archived tasks', detail: String(err) });
  }
});

/**
 * POST /api/tasks/:id/archive — Archive a task
 */
router.post('/api/tasks/:id/archive', (req: Request, res: Response) => {
  try {
    const id = req.params.id as string;
    const task = getTaskById.get(id) as TaskRow | undefined;
    if (!task) { res.status(404).json({ error: 'Task not found' }); return; }
    db.prepare('UPDATE tasks SET archived=1, updated_at=? WHERE id=?').run(new Date().toISOString(), id);
    broadcastTaskUpdate(id, req);
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: 'Failed to archive task', detail: String(err) });
  }
});

/**
 * POST /api/tasks/:id/unarchive — Unarchive a task
 */
router.post('/api/tasks/:id/unarchive', (req: Request, res: Response) => {
  try {
    const id = req.params.id as string;
    const task = getTaskById.get(id) as TaskRow | undefined;
    if (!task) { res.status(404).json({ error: 'Task not found' }); return; }
    db.prepare('UPDATE tasks SET archived=0, updated_at=? WHERE id=?').run(new Date().toISOString(), id);
    broadcastTaskUpdate(id, req);
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: 'Failed to unarchive task', detail: String(err) });
  }
});

/**
 * GET /api/tasks — Get all tasks with their checklist_items and next_steps
 * Optional query: ?workspace_id=... to filter by workspace
 */
router.get('/api/tasks', (req: Request, res: Response) => {
  try {
    const workspaceId = req.query.workspace_id as string | undefined;
    let tasks: TaskRow[];
    if (workspaceId) {
      tasks = db.prepare('SELECT * FROM tasks WHERE (archived=0 OR archived IS NULL) AND workspace_id = ? ORDER BY position ASC, created_at ASC').all(workspaceId) as TaskRow[];
    } else {
      tasks = getAllTasks.all() as TaskRow[];
    }

    const tasksWithRelations = tasks.map((task) => {
      const checklistItems = getChecklistByTask.all(task.id) as ChecklistItemRow[];
      const nextSteps = getNextStepsByTask.all(task.id) as NextStepRow[];
      const deps = (getDependencies.all(task.id) as { depends_on_id: string }[]).map(d => d.depends_on_id);
      return formatTask(task, checklistItems, nextSteps, deps);
    });

    res.json(tasksWithRelations);
  } catch (err) {
    res.status(500).json({ error: 'Failed to fetch tasks', detail: String(err) });
  }
});

/**
 * GET /api/tasks/:id — Get a single task by id
 */
router.get('/api/tasks/:id', (req: Request, res: Response) => {
  try {
    const task = db.prepare('SELECT * FROM tasks WHERE id = ?').get(req.params.id) as TaskRow | undefined;
    if (!task) {
      res.status(404).json({ error: 'Task not found' });
      return;
    }
    const checklistItems = getChecklistByTask.all(task.id) as ChecklistItemRow[];
    const nextSteps = getNextStepsByTask.all(task.id) as NextStepRow[];
    const deps = (getDependencies.all(task.id) as { depends_on_id: string }[]).map(d => d.depends_on_id);
    res.json(formatTask(task, checklistItems, nextSteps, deps));
  } catch (err) {
    res.status(500).json({ error: 'Failed to fetch task', detail: String(err) });
  }
});

/**
 * POST /api/tasks — Create a new task
 */
router.post('/api/tasks', (req: Request, res: Response) => {
  try {
    const body = req.body;

    // Block agent-initiated sub-task creation — agents must work within their own session
    const parent_task_id = body.parentTaskId || body.parent_task_id || '';
    if (parent_task_id) {
      res.status(403).json({
        error: 'Sub-task creation is disabled',
        detail: 'Agents cannot create new tasks. All work must be completed within the current session.'
      });
      return;
    }

    const title = body.title;
    const description = body.description;
    const column = body.column || 'backlog';
    const position = body.position;
    const agent_type = body.agentType || body.agent_type || 'generic';
    const model = body.model || '';
    const command = body.command;
    const workspace_id = body.workspaceId || body.workspace_id || '';
    // Workspace path always takes priority over any provided workingDir
    let working_dir = body.workingDir || body.working_dir || '';
    if (workspace_id) {
      const ws = db.prepare('SELECT path FROM workspaces WHERE id = ?').get(workspace_id) as { path: string } | undefined;
      if (ws?.path) working_dir = ws.path;
    }
    const yolo = body.yolo ? 1 : 0;
    const auto_review = body.autoReview || body.auto_review ? 1 : 0;
    const auto_complete = (body.autoComplete === false || body.auto_complete === false) ? 0 : 1;
    const delegated = body.delegated ? 1 : 0;
    const status = body.status || 'idle';
    const assignee_id = body.assigneeId || body.assignee_id;
    const template_id = body.templateId || body.template_id;

    const id = uuidv4();
    const now = new Date().toISOString();

    // Calculate position if not provided
    const finalPosition = position ?? (db.prepare(
      'SELECT COALESCE(MAX(position), -1) + 1 as next_pos FROM tasks WHERE "column" = ?'
    ).get(column) as { next_pos: number }).next_pos;

    const pasted_text = body.pastedText || body.pasted_text || '';
    const waitlisted = body.waitlisted ? 1 : 0;

    db.prepare(`
      INSERT INTO tasks (id, title, description, pasted_text, "column", position, agent_type, model, command, working_dir, workspace_id, yolo, auto_review, auto_complete, delegated, parent_task_id, status, assignee_id, template_id, waitlisted, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(id, title, description, pasted_text, column, finalPosition, agent_type, model, command, working_dir, workspace_id, yolo, auto_review, auto_complete, delegated, parent_task_id, status, assignee_id, template_id, waitlisted, now, now);

    const created = getTaskById.get(id) as TaskRow;

    // Handle dependencies if provided
    const dependsOn: string[] = req.body.dependsOn || [];
    if (dependsOn.length > 0) {
      const insertDep = db.prepare('INSERT INTO task_dependencies (task_id, depends_on_id) VALUES (?, ?)');
      for (const depId of dependsOn) {
        insertDep.run(id, depId);
      }
    }

    // Handle checklist items if provided
    const checklistItems: { text: string; source?: string }[] = req.body.checklistItems || [];
    if (checklistItems.length > 0) {
      const insertItem = db.prepare(
        'INSERT INTO checklist_items (id, task_id, text, done, source, position, created_at) VALUES (?, ?, ?, 0, ?, ?, ?)'
      );
      const now2 = new Date().toISOString();
      checklistItems.forEach((item, i) => {
        insertItem.run(uuidv4(), id, item.text || item, item.source || 'manual', i, now2);
      });
    }

    // Handle tags if provided
    const tagIds: string[] = req.body.tagIds || [];
    if (tagIds.length > 0) {
      const insertTag = db.prepare('INSERT OR IGNORE INTO task_tags (task_id, tag_id) VALUES (?, ?)');
      for (const tagId of tagIds) {
        insertTag.run(id, tagId);
      }
    }

    const createdChecklist = getChecklistByTask.all(id) as ChecklistItemRow[];
    const createdNextSteps = getNextStepsByTask.all(id) as NextStepRow[];
    const formatted = formatTask(created, createdChecklist, createdNextSteps, dependsOn);
    const emitActivity = req.app.get('emitOrchestratorActivity') as ((type: string, message: string, data?: Record<string, unknown>) => void) | undefined;
    emitActivity?.('task-created', `Created "${title}" in ${column} (${agent_type})`, { taskId: id, column, agentType: agent_type });
    const io = req.app.get('io');
    if (io) {
      io.emit('task:created', formatted);
      io.emit('tasks:changed', { taskId: id, timestamp: Date.now() });
    }

    res.status(201).json(formatted);
  } catch (err) {
    res.status(500).json({ error: 'Failed to create task', detail: String(err) });
  }
});

/**
 * PUT /api/tasks/:id — Partial update of a task
 */
router.put('/api/tasks/:id', (req: Request, res: Response) => {
  try {
    const { id } = req.params;
    const existing = getTaskById.get(id) as TaskRow | undefined;

    if (!existing) {
      res.status(404).json({ error: 'Task not found' });
      return;
    }

    // Map camelCase to snake_case for DB columns
    const fieldMap: Record<string, string> = {
      title: 'title',
      description: 'description',
      column: '"column"',
      position: 'position',
      agentType: 'agent_type',
      agent_type: 'agent_type',
      model: 'model',
      command: 'command',
      workingDir: 'working_dir',
      working_dir: 'working_dir',
      workspaceId: 'workspace_id',
      workspace_id: 'workspace_id',
      yolo: 'yolo',
      autoReview: 'auto_review',
      auto_review: 'auto_review',
      autoComplete: 'auto_complete',
      auto_complete: 'auto_complete',
      delegated: 'delegated',
      parentTaskId: 'parent_task_id',
      parent_task_id: 'parent_task_id',
      status: 'status',
      assigneeId: 'assignee_id',
      assignee_id: 'assignee_id',
      templateId: 'template_id',
      template_id: 'template_id',
      archived: 'archived',
      pastedText: 'pasted_text',
      pasted_text: 'pasted_text',
      waitlisted: 'waitlisted',
    };

    // Fields stored as INTEGER in SQLite — booleans must be converted to 0/1
    const booleanColumns = new Set(['yolo', 'auto_review', 'auto_complete', 'delegated', 'archived', 'waitlisted']);

    const updates: string[] = [];
    const values: any[] = [];

    for (const [bodyKey, dbCol] of Object.entries(fieldMap)) {
      if (req.body[bodyKey] !== undefined) {
        updates.push(`${dbCol} = ?`);
        const raw = req.body[bodyKey];
        values.push(booleanColumns.has(dbCol) ? (raw ? 1 : 0) : raw);
      }
    }

    if (updates.length === 0) {
      res.status(400).json({ error: 'No valid fields to update' });
      return;
    }

    // If workspace_id is being updated and working_dir isn't explicitly provided,
    // sync working_dir to the workspace path so the stored value stays consistent
    const newWorkspaceId = req.body.workspaceId ?? req.body.workspace_id;
    const hasExplicitWorkingDir = req.body.workingDir !== undefined || req.body.working_dir !== undefined;
    if (newWorkspaceId !== undefined && !hasExplicitWorkingDir) {
      if (newWorkspaceId) {
        const ws = db.prepare('SELECT path FROM workspaces WHERE id = ?').get(newWorkspaceId) as { path: string } | undefined;
        if (ws?.path) {
          updates.push('working_dir = ?');
          values.push(ws.path);
        }
      } else {
        // Workspace cleared — reset working_dir
        updates.push('working_dir = ?');
        values.push('');
      }
    }

    // Block moving to "review" or "done" without a walkthrough file
    const incomingColumn = req.body.column;
    if ((incomingColumn === 'review' || incomingColumn === 'done') && existing.column !== incomingColumn) {
      const walkthroughPath = path.resolve(WALKTHROUGH_DIR, `${id}.md`);
      if (!walkthroughPath.startsWith(WALKTHROUGH_DIR)) {
        res.status(400).json({ error: 'Invalid task ID' });
        return;
      }
      if (!existsSync(walkthroughPath)) {
        res.status(400).json({ error: `Cannot move task to ${incomingColumn} without a walkthrough. A walkthrough.md must be created at ${walkthroughPath} first.` });
        return;
      }
    }

    // Auto-set completed_at when column changes to/from done
    if (incomingColumn !== undefined && incomingColumn !== existing.column) {
      if (incomingColumn === 'done') {
        updates.push('completed_at = ?');
        values.push(new Date().toISOString());
      } else if (existing.column === 'done' && existing.completed_at) {
        updates.push('completed_at = ?');
        values.push(null);
      }
    }

    // Auto-complete all checklist items when task moves to done
    if (incomingColumn === 'done' && existing.column !== 'done') {
      db.prepare('UPDATE checklist_items SET done = 1 WHERE task_id = ? AND done = 0')
        .run(id);
      // Delete persisted session file — task is complete, no crash recovery needed
      const deleteSessionFile = req.app.get('deleteSessionFile') as ((taskId: string) => void) | undefined;
      deleteSessionFile?.(id as string);
    }

    updates.push('updated_at = ?');
    values.push(new Date().toISOString());
    values.push(id);

    db.prepare(`UPDATE tasks SET ${updates.join(', ')} WHERE id = ?`).run(...values);

    // Handle dependsOn replacement if provided
    if (req.body.dependsOn !== undefined) {
      const newDeps: string[] = Array.isArray(req.body.dependsOn) ? req.body.dependsOn : [];
      db.prepare('DELETE FROM task_dependencies WHERE task_id = ?').run(id);
      const insertDep = db.prepare('INSERT INTO task_dependencies (task_id, depends_on_id) VALUES (?, ?)');
      for (const depId of newDeps) {
        insertDep.run(id, depId);
      }
    }

    // Handle checklist replacement if requested
    if (req.body.replaceChecklist && req.body.checklistItems !== undefined) {
      const items: { text: string }[] = req.body.checklistItems || [];
      db.prepare('DELETE FROM checklist_items WHERE task_id = ? AND source = ?').run(id, 'manual');
      const insertItem = db.prepare(
        'INSERT INTO checklist_items (id, task_id, text, done, source, position, created_at) VALUES (?, ?, ?, 0, ?, ?, ?)'
      );
      const now2 = new Date().toISOString();
      items.forEach((item, i) => {
        if (item.text?.trim()) {
          insertItem.run(uuidv4(), id, item.text.trim(), 'manual', i, now2);
        }
      });
    }

    // Handle tags replacement if requested
    if (req.body.replaceTags && req.body.tagIds !== undefined) {
      const tagIds: string[] = Array.isArray(req.body.tagIds) ? req.body.tagIds : [];
      db.prepare('DELETE FROM task_tags WHERE task_id = ?').run(id);
      const insertTag = db.prepare('INSERT OR IGNORE INTO task_tags (task_id, tag_id) VALUES (?, ?)');
      for (const tagId of tagIds) {
        insertTag.run(id, tagId);
      }
    }

    const updated = getTaskById.get(id) as TaskRow;
    const checklistItems = getChecklistByTask.all(id) as ChecklistItemRow[];
    const nextSteps = getNextStepsByTask.all(id) as NextStepRow[];
    const deps = (getDependencies.all(id) as { depends_on_id: string }[]).map(d => d.depends_on_id);

    // Notify parent orchestrator if column changed
    const rawColumn = req.body.column ?? req.body['column'];
    const newColumn = Array.isArray(rawColumn) ? rawColumn[0] : rawColumn;
    if (newColumn !== undefined && newColumn !== existing.column) {
      const notifyParentOrchestrator = req.app.get('notifyParentOrchestrator') as ((childTaskId: string, eventType: "column-changed" | "sub-task-created", details: { oldColumn?: string; newColumn?: string; title?: string }) => void) | undefined;
      // @ts-ignore
      notifyParentOrchestrator?.(id, 'column-changed', { oldColumn: existing.column, newColumn: String(newColumn), title: existing.title });

      // Auto-trigger verification when task moves to review (only if auto_review enabled)
      if (String(newColumn) === 'review' && existing.column !== 'review') {
        const taskAutoReview = Boolean((updated as any).auto_review);
        if (!taskAutoReview) {
          console.log(`[kanaban:verify] Skipping auto-verify for task ${(id as string).slice(0, 8)} — auto_review disabled`);
        } else {
          const verifyTaskAgent = req.app.get('verifyTaskAgent') as ((taskId: string) => { success: boolean; error?: string }) | undefined;
          if (verifyTaskAgent) {
            const agentType = (updated as any).agent_type || 'generic';
            const hasCommand = !!(updated as any).command;
            const delegatedTasks = req.app.get('delegatedTasks') as Set<string> | undefined;
            const isDelegated = delegatedTasks?.has(id as string);

            if (isDelegated) {
              console.log(`[kanaban:verify] Skipping auto-verify for delegated task ${(id as string).slice(0, 8)}`);
            } else if (agentType === 'generic' && !hasCommand) {
              console.log(`[kanaban:verify] Skipping auto-verify for generic task ${(id as string).slice(0, 8)} (no command)`);
            } else {
              console.log(`[kanaban:verify] Auto-triggering verification for task ${(id as string).slice(0, 8)} via PUT route`);
              setTimeout(() => {
                verifyTaskAgent(id as string);
              }, 2000);
            }
          }
        }
      }
    }

    const formatted = formatTask(updated, checklistItems, nextSteps, deps);

    // Broadcast to all clients so UI updates in real-time
    const io = req.app.get('io');
    if (io) {
      io.emit('task:updated', formatted);
      io.emit('tasks:changed', { taskId: id, timestamp: Date.now() });
    }

    res.json(formatted);
  } catch (err) {
    res.status(500).json({ error: 'Failed to update task', detail: String(err) });
  }
});

/**
 * DELETE /api/tasks/:id — Delete a task
 */
router.delete('/api/tasks/:id', (req: Request, res: Response) => {
  try {
    const { id } = req.params;
    const existing = getTaskById.get(id) as TaskRow | undefined;

    if (!existing) {
      res.status(404).json({ error: 'Task not found' });
      return;
    }

    // Kill any running PTY agent before deleting, so the exit handler
    // doesn't try to update/broadcast a task that no longer exists
    const killTaskAgent = req.app.get('killTaskAgent') as ((taskId: string) => { success: boolean }) | undefined;
    if (killTaskAgent) {
      killTaskAgent(id as string);
    }

    // Delete persisted session file if present
    const deleteSessionFile = req.app.get('deleteSessionFile') as ((taskId: string) => void) | undefined;
    if (deleteSessionFile) {
      deleteSessionFile(id as string);
    }

    db.prepare('DELETE FROM tasks WHERE id = ?').run(id);
    const io = req.app.get('io');
    if (io) {
      io.emit('task:deleted', { taskId: id });
      io.emit('tasks:changed', { taskId: id, timestamp: Date.now() });
    }
    res.json({ success: true, id });
  } catch (err) {
    res.status(500).json({ error: 'Failed to delete task', detail: String(err) });
  }
});

/**
 * POST /api/tasks/:id/checklist — Add a checklist item
 */
router.post('/api/tasks/:id/checklist', (req: Request, res: Response) => {
  try {
    const { id: taskId } = req.params;
    const task = getTaskById.get(taskId) as TaskRow | undefined;

    if (!task) {
      res.status(404).json({ error: 'Task not found' });
      return;
    }

    const { text, source = 'manual', done = false } = req.body;
    const itemId = uuidv4();
    const now = new Date().toISOString();

    const nextPosition = (db.prepare(
      'SELECT COALESCE(MAX(position), -1) + 1 as next_pos FROM checklist_items WHERE task_id = ?'
    ).get(taskId) as { next_pos: number }).next_pos;

    db.prepare(`
      INSERT INTO checklist_items (id, task_id, text, done, source, position, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `).run(itemId, taskId, text, done ? 1 : 0, source, nextPosition, now);

    const created = db.prepare('SELECT * FROM checklist_items WHERE id = ?').get(itemId) as ChecklistItemRow;
    broadcastTaskUpdate(taskId as string, req);
    res.status(201).json({ ...created, done: Boolean(created.done) });
  } catch (err) {
    res.status(500).json({ error: 'Failed to add checklist item', detail: String(err) });
  }
});

/**
 * PUT /api/tasks/:id/checklist/:itemId — Update a checklist item
 */
router.put('/api/tasks/:id/checklist/:itemId', (req: Request, res: Response) => {
  try {
    const { id: taskId, itemId } = req.params;

    const existing = db.prepare(
      'SELECT * FROM checklist_items WHERE id = ? AND task_id = ?'
    ).get(itemId, taskId) as ChecklistItemRow | undefined;

    if (!existing) {
      res.status(404).json({ error: 'Checklist item not found' });
      return;
    }

    const updates: string[] = [];
    const values: any[] = [];

    if (req.body.text !== undefined) {
      updates.push('text = ?');
      values.push(req.body.text);
    }
    if (req.body.done !== undefined) {
      updates.push('done = ?');
      values.push(req.body.done ? 1 : 0);
    }
    if (req.body.position !== undefined) {
      updates.push('position = ?');
      values.push(req.body.position);
    }

    if (updates.length === 0) {
      res.status(400).json({ error: 'No valid fields to update' });
      return;
    }

    values.push(itemId);
    db.prepare(`UPDATE checklist_items SET ${updates.join(', ')} WHERE id = ?`).run(...values);

    const updated = db.prepare('SELECT * FROM checklist_items WHERE id = ?').get(itemId) as ChecklistItemRow;
    broadcastTaskUpdate(taskId as string, req);
    res.json({ ...updated, done: Boolean(updated.done) });
  } catch (err) {
    res.status(500).json({ error: 'Failed to update checklist item', detail: String(err) });
  }
});

/**
 * DELETE /api/tasks/:id/checklist/:itemId — Delete a checklist item
 */
router.delete('/api/tasks/:id/checklist/:itemId', (req: Request, res: Response) => {
  try {
    const { id: taskId, itemId } = req.params;

    const existing = db.prepare(
      'SELECT * FROM checklist_items WHERE id = ? AND task_id = ?'
    ).get(itemId, taskId) as ChecklistItemRow | undefined;

    if (!existing) {
      res.status(404).json({ error: 'Checklist item not found' });
      return;
    }

    db.prepare('DELETE FROM checklist_items WHERE id = ?').run(itemId);
    broadcastTaskUpdate(taskId as string, req);
    res.json({ success: true, id: itemId });
  } catch (err) {
    res.status(500).json({ error: 'Failed to delete checklist item', detail: String(err) });
  }
});

/**
 * GET /api/tasks/:id/activity — Get activity log for a task
 */
router.get('/api/tasks/:id/activity', (req: Request, res: Response) => {
  try {
    const { id } = req.params;
    const task = getTaskById.get(id) as TaskRow | undefined;

    if (!task) {
      res.status(404).json({ error: 'Task not found' });
      return;
    }

    const activities = db.prepare(
      'SELECT * FROM activity_log WHERE task_id = ? ORDER BY created_at DESC'
    ).all(id) as ActivityLogRow[];

    res.json(activities);
  } catch (err) {
    res.status(500).json({ error: 'Failed to fetch activity log', detail: String(err) });
  }
});

/**
 * POST /api/tasks/:id/images — Upload images (base64 JSON)
 * Body: { images: [{ data: "base64...", name: "file.png", type: "image/png" }] }
 */
router.post('/api/tasks/:id/images', express.json({ limit: '50mb' }), (req: Request, res: Response) => {
  try {
    const { id: taskId } = req.params;
    const task = getTaskById.get(taskId) as TaskRow | undefined;
    if (!task) { res.status(404).json({ error: 'Task not found' }); return; }

    const images: { data: string; name: string; type: string }[] = req.body.images || [];
    if (images.length === 0) { res.status(400).json({ error: 'No images provided' }); return; }

    const ALLOWED_TYPES = ['image/png', 'image/jpeg', 'image/gif', 'image/webp', 'image/svg+xml'];
    const taskDir = path.join(TASK_IMAGES_DIR, taskId);
    if (!existsSync(taskDir)) mkdirSync(taskDir, { recursive: true });

    const insertImage = db.prepare(
      'INSERT INTO task_images (id, task_id, filename, original_name, mime_type, size, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)'
    );

    const created: TaskImageRow[] = [];
    const now = new Date().toISOString();

    for (const img of images) {
      if (!ALLOWED_TYPES.includes(img.type)) continue;

      const buffer = Buffer.from(img.data, 'base64');
      // Claude vision API rejects very small/degenerate images (e.g. 1x1 pixel = 69 bytes)
      if (buffer.length < 100) continue;

      const imageId = uuidv4();
      const ext = img.name.split('.').pop() || 'png';
      const filename = `${imageId}.${ext}`;

      writeFileSync(path.join(taskDir, filename), buffer);
      insertImage.run(imageId, taskId, filename, img.name, img.type, buffer.length, now);
      created.push({ id: imageId, task_id: taskId, filename, original_name: img.name, mime_type: img.type, size: buffer.length, created_at: now });
    }

    // Broadcast updated task with new images
    broadcastTaskUpdate(taskId, req);

    res.status(201).json(created.map((img) => ({
      id: img.id,
      taskId: img.task_id,
      filename: img.filename,
      originalName: img.original_name,
      mimeType: img.mime_type,
      size: img.size,
    })));
  } catch (err) {
    res.status(500).json({ error: 'Failed to upload images', detail: String(err) });
  }
});

/**
 * GET /api/tasks/:id/images/:imageId/file — Serve an image file
 */
router.get('/api/tasks/:id/images/:imageId/file', (req: Request, res: Response) => {
  try {
    const { id: taskId, imageId } = req.params;
    const img = db.prepare('SELECT * FROM task_images WHERE id = ? AND task_id = ?').get(imageId, taskId) as TaskImageRow | undefined;
    if (!img) { res.status(404).json({ error: 'Image not found' }); return; }

    const safeName = path.basename(img.filename);
    const filePath = path.join(TASK_IMAGES_DIR, taskId, safeName);
    if (!filePath.startsWith(path.join(TASK_IMAGES_DIR, taskId))) { res.status(403).json({ error: 'Access denied' }); return; }
    if (!existsSync(filePath)) { res.status(404).json({ error: 'Image file not found on disk' }); return; }

    res.setHeader('Content-Type', img.mime_type);
    res.sendFile(filePath);
  } catch (err) {
    res.status(500).json({ error: 'Failed to serve image', detail: String(err) });
  }
});

/**
 * DELETE /api/tasks/:id/images/:imageId — Delete an image
 */
router.delete('/api/tasks/:id/images/:imageId', (req: Request, res: Response) => {
  try {
    const { id: taskId, imageId } = req.params;
    const img = db.prepare('SELECT * FROM task_images WHERE id = ? AND task_id = ?').get(imageId, taskId) as TaskImageRow | undefined;
    if (!img) { res.status(404).json({ error: 'Image not found' }); return; }

    const filePath = path.join(TASK_IMAGES_DIR, taskId, img.filename);
    if (existsSync(filePath)) unlinkSync(filePath);

    db.prepare('DELETE FROM task_images WHERE id = ?').run(imageId);

    // Clean up empty directory
    const taskDir = path.join(TASK_IMAGES_DIR, taskId);
    try {
      const remaining = readdirSync(taskDir);
      if (remaining.length === 0) rmSync(taskDir, { recursive: true });
    } catch { /* ignore */ }

    broadcastTaskUpdate(taskId, req);
    res.json({ success: true, id: imageId });
  } catch (err) {
    res.status(500).json({ error: 'Failed to delete image', detail: String(err) });
  }
});

// ========== Tags ==========

/**
 * GET /api/tags — Get all tags
 */
router.get('/api/tags', (_req: Request, res: Response) => {
  try {
    const tags = db.prepare('SELECT * FROM tags ORDER BY name ASC').all() as TagRow[];
    res.json(tags.map((t) => ({ id: t.id, name: t.name, color: t.color })));
  } catch (err) {
    res.status(500).json({ error: 'Failed to fetch tags', detail: String(err) });
  }
});

/**
 * POST /api/tags — Create a new tag
 */
router.post('/api/tags', (req: Request, res: Response) => {
  try {
    const { name, color = '#6b7280' } = req.body;
    if (!name?.trim()) { res.status(400).json({ error: 'Tag name is required' }); return; }
    const id = uuidv4();
    const now = new Date().toISOString();
    db.prepare('INSERT INTO tags (id, name, color, created_at) VALUES (?, ?, ?, ?)').run(id, name.trim(), color, now);
    res.status(201).json({ id, name: name.trim(), color });
  } catch (err) {
    res.status(500).json({ error: 'Failed to create tag', detail: String(err) });
  }
});

/**
 * PUT /api/tags/:id — Update a tag
 */
router.put('/api/tags/:id', (req: Request, res: Response) => {
  try {
    const { id } = req.params;
    const existing = db.prepare('SELECT * FROM tags WHERE id = ?').get(id) as TagRow | undefined;
    if (!existing) { res.status(404).json({ error: 'Tag not found' }); return; }
    const name = req.body.name !== undefined ? req.body.name.trim() : existing.name;
    const color = req.body.color !== undefined ? req.body.color : existing.color;
    db.prepare('UPDATE tags SET name = ?, color = ? WHERE id = ?').run(name, color, id);
    res.json({ id, name, color });
  } catch (err) {
    res.status(500).json({ error: 'Failed to update tag', detail: String(err) });
  }
});

/**
 * DELETE /api/tags/:id — Delete a tag
 */
router.delete('/api/tags/:id', (req: Request, res: Response) => {
  try {
    const { id } = req.params;
    db.prepare('DELETE FROM task_tags WHERE tag_id = ?').run(id);
    db.prepare('DELETE FROM tags WHERE id = ?').run(id);
    res.json({ success: true, id });
  } catch (err) {
    res.status(500).json({ error: 'Failed to delete tag', detail: String(err) });
  }
});

/**
 * POST /api/tasks/:id/tags — Add a tag to a task
 */
router.post('/api/tasks/:id/tags', (req: Request, res: Response) => {
  try {
    const { id: taskId } = req.params;
    const { tagId } = req.body;
    if (!tagId) { res.status(400).json({ error: 'tagId is required' }); return; }
    const task = getTaskById.get(taskId) as TaskRow | undefined;
    if (!task) { res.status(404).json({ error: 'Task not found' }); return; }
    const tag = db.prepare('SELECT * FROM tags WHERE id = ?').get(tagId) as TagRow | undefined;
    if (!tag) { res.status(404).json({ error: 'Tag not found' }); return; }
    // Upsert — ignore if already exists
    db.prepare('INSERT OR IGNORE INTO task_tags (task_id, tag_id) VALUES (?, ?)').run(taskId, tagId);
    broadcastTaskUpdate(taskId, req);
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: 'Failed to add tag', detail: String(err) });
  }
});

/**
 * DELETE /api/tasks/:id/tags/:tagId — Remove a tag from a task
 */
router.delete('/api/tasks/:id/tags/:tagId', (req: Request, res: Response) => {
  try {
    const { id: taskId, tagId } = req.params;
    db.prepare('DELETE FROM task_tags WHERE task_id = ? AND tag_id = ?').run(taskId, tagId);
    broadcastTaskUpdate(taskId, req);
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: 'Failed to remove tag', detail: String(err) });
  }
});

/**
 * GET /api/browse-dirs?dir=... — List subdirectories for folder picker
 */
router.get('/api/browse-dirs', (req: Request, res: Response) => {
  try {
    const rawDir = (req.query.dir as string) || homedir();
    const dir = path.resolve(rawDir);

    // On Windows, if browsing a drive root (e.g. "C:\"), list available drives instead
    // when the user navigates above a drive root via ".."
    if (process.platform === 'win32' && dir === path.dirname(dir)) {
      // At filesystem root — list all drive letters
      const drives = getWindowsDrives();
      res.json({
        current: dir,
        parent: dir,
        dirs: drives.map((d) => ({ name: d, path: d + '\\' })),
      });
      return;
    }

    const entries = readdirSync(dir, { withFileTypes: true });
    const dirs = entries
      .filter((e) => {
        if (!e.isDirectory()) return false;
        // Skip hidden and node_modules
        if (e.name.startsWith('.') || e.name === 'node_modules') return false;
        return true;
      })
      .map((e) => ({
        name: e.name,
        path: path.join(dir, e.name),
      }))
      .sort((a, b) => a.name.localeCompare(b.name));

    res.json({ current: dir, parent: path.dirname(dir), dirs });
  } catch (err) {
    res.status(400).json({ error: 'Cannot read directory', detail: String(err) });
  }
});

/** List available Windows drive letters (e.g. ['C:', 'D:']). */
function getWindowsDrives(): string[] {
  try {
    const stdout = execSync('wmic logicaldisk get name', { encoding: 'utf-8' });
    return stdout
      .split('\n')
      .map((line) => line.trim())
      .filter((line) => /^[A-Z]:$/i.test(line));
  } catch {
    // Fallback: scan A-Z for accessible drives
    const drives: string[] = [];
    for (let i = 65; i <= 90; i++) {
      const letter = String.fromCharCode(i) + ':';
      try {
        readdirSync(letter + '\\');
        drives.push(letter);
      } catch { /* drive not accessible */ }
    }
    return drives;
  }
}

export default router;
