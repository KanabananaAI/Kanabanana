import { Router, Request, Response } from 'express';
import { v4 as uuidv4 } from 'uuid';
import db from '../db.js';

const router = Router();

interface ScheduleRow {
  id: string;
  task_id: string;
  scheduled_at: string;
  recurrence_interval_minutes: number | null;
  max_executions: number | null;
  executions_completed: number;
  is_active: number;
  created_at: string;
  updated_at: string;
}

export function formatSchedule(s: ScheduleRow) {
  return {
    id: s.id,
    taskId: s.task_id,
    scheduledAt: s.scheduled_at,
    recurrenceIntervalMinutes: s.recurrence_interval_minutes,
    maxExecutions: s.max_executions,
    executionsCompleted: s.executions_completed,
    isActive: Boolean(s.is_active),
    createdAt: s.created_at,
    updatedAt: s.updated_at,
  };
}

function broadcastTaskScheduleUpdate(taskId: string, req: Request): void {
  const io = req.app.get('io');
  if (!io) return;
  // Re-fetch full task and broadcast as task:updated so all clients get it
  const broadcastTask = req.app.get('broadcastTask') as ((taskId: string) => void) | undefined;
  if (broadcastTask) broadcastTask(taskId);
}

/**
 * GET /api/tasks/:id/schedule — Get schedule for a task
 */
router.get('/api/tasks/:id/schedule', (req: Request, res: Response) => {
  try {
    const taskId = req.params.id as string;
    const schedule = db.prepare('SELECT * FROM task_schedules WHERE task_id = ?').get(taskId) as ScheduleRow | undefined;
    if (!schedule) { res.status(404).json({ error: 'No schedule found' }); return; }
    res.json(formatSchedule(schedule));
  } catch (err) {
    res.status(500).json({ error: 'Failed to fetch schedule', detail: String(err) });
  }
});

/**
 * GET /api/schedules — Get all active schedules
 */
router.get('/api/schedules', (_req: Request, res: Response) => {
  try {
    const schedules = db.prepare('SELECT * FROM task_schedules WHERE is_active = 1 ORDER BY scheduled_at ASC').all() as ScheduleRow[];
    res.json(schedules.map(formatSchedule));
  } catch (err) {
    res.status(500).json({ error: 'Failed to fetch schedules', detail: String(err) });
  }
});

/**
 * POST /api/tasks/:id/schedule — Create or replace a task schedule
 * Body: { scheduledAt, recurrenceIntervalMinutes?, maxExecutions? }
 * maxExecutions: null = infinite, 1 = one-off, N = N times
 */
router.post('/api/tasks/:id/schedule', (req: Request, res: Response) => {
  try {
    const taskId = req.params.id as string;
    const { scheduledAt, recurrenceIntervalMinutes, maxExecutions } = req.body;

    if (!scheduledAt) { res.status(400).json({ error: 'scheduledAt is required' }); return; }

    const task = db.prepare('SELECT id FROM tasks WHERE id = ?').get(taskId);
    if (!task) { res.status(404).json({ error: 'Task not found' }); return; }

    const now = new Date().toISOString();
    const existing = db.prepare('SELECT * FROM task_schedules WHERE task_id = ?').get(taskId) as ScheduleRow | undefined;

    if (existing) {
      db.prepare(
        'UPDATE task_schedules SET scheduled_at=?, recurrence_interval_minutes=?, max_executions=?, executions_completed=0, is_active=1, updated_at=? WHERE task_id=?'
      ).run(scheduledAt, recurrenceIntervalMinutes ?? null, maxExecutions ?? null, now, taskId);
    } else {
      const id = uuidv4();
      db.prepare(
        'INSERT INTO task_schedules (id, task_id, scheduled_at, recurrence_interval_minutes, max_executions, executions_completed, is_active, created_at, updated_at) VALUES (?, ?, ?, ?, ?, 0, 1, ?, ?)'
      ).run(id, taskId, scheduledAt, recurrenceIntervalMinutes ?? null, maxExecutions ?? null, now, now);
    }

    const schedule = db.prepare('SELECT * FROM task_schedules WHERE task_id = ?').get(taskId) as ScheduleRow;
    broadcastTaskScheduleUpdate(taskId, req);
    console.log(`[kanaban:scheduler] Schedule saved for task ${taskId.slice(0, 8)}: at=${scheduledAt} interval=${recurrenceIntervalMinutes ?? 'none'} max=${maxExecutions ?? '∞'}`);
    res.json(formatSchedule(schedule));
  } catch (err) {
    res.status(500).json({ error: 'Failed to save schedule', detail: String(err) });
  }
});

/**
 * DELETE /api/tasks/:id/schedule — Remove a task schedule
 */
router.delete('/api/tasks/:id/schedule', (req: Request, res: Response) => {
  try {
    const taskId = req.params.id as string;
    db.prepare('DELETE FROM task_schedules WHERE task_id = ?').run(taskId);
    broadcastTaskScheduleUpdate(taskId, req);
    console.log(`[kanaban:scheduler] Schedule deleted for task ${taskId.slice(0, 8)}`);
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: 'Failed to delete schedule', detail: String(err) });
  }
});

export default router;
