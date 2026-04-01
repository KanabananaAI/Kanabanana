import { Cron } from 'croner';
import type { PtyManager } from './pty-manager.js';

interface SchedulerDeps {
  db: any;
  ptyManager: PtyManager;
  broadcastTask: (taskId: string) => void;
  spawnTaskAgent: (taskId: string) => { success: boolean; error?: string };
  emitActivity: (type: string, message: string, data?: Record<string, unknown>) => void;
}

interface ScheduleRow {
  id: string;
  task_id: string;
  scheduled_at: string;
  recurrence_interval_minutes: number | null;
  max_executions: number | null;
  executions_completed: number;
  is_active: number;
  title?: string;
  task_column?: string;
  task_status?: string;
}

let schedulerCron: Cron | null = null;

export function startTaskScheduler(deps: SchedulerDeps): void {
  if (schedulerCron) schedulerCron.stop();

  schedulerCron = new Cron('* * * * *', () => {
    try {
      runSchedulerCheck(deps);
    } catch (err) {
      console.error('[kanaban:scheduler] Scheduler error:', err);
    }
  });

  console.log('[kanaban:scheduler] Started task scheduler (every 60s)');
}

export function stopTaskScheduler(): void {
  if (schedulerCron) {
    schedulerCron.stop();
    schedulerCron = null;
    console.log('[kanaban:scheduler] Stopped task scheduler');
  }
}

function runSchedulerCheck(deps: SchedulerDeps): void {
  const { db, broadcastTask, spawnTaskAgent, emitActivity } = deps;
  const now = new Date().toISOString();

  // Find all due active schedules
  const dueSchedules = db.prepare(`
    SELECT ts.*, t.title, t."column" as task_column, t.status as task_status
    FROM task_schedules ts
    JOIN tasks t ON ts.task_id = t.id
    WHERE ts.is_active = 1
      AND ts.scheduled_at <= ?
      AND (ts.max_executions IS NULL OR ts.executions_completed < ts.max_executions)
  `).all(now) as ScheduleRow[];

  if (dueSchedules.length === 0) return;

  console.log(`[kanaban:scheduler] ${dueSchedules.length} due schedule(s) found`);

  for (const schedule of dueSchedules) {
    const taskId = schedule.task_id;

    // Only spawn if the task is in the scheduled column
    if (schedule.task_column !== 'scheduled') {
      console.log(`[kanaban:scheduler] Skipping "${schedule.title}" — in "${schedule.task_column}", expected "scheduled"`);
      advanceSchedule(db, schedule, now);
      continue;
    }

    // Skip if already running
    if (schedule.task_status && ['running', 'executing', 'thinking'].includes(schedule.task_status)) {
      console.log(`[kanaban:scheduler] Skipping "${schedule.title}" — already ${schedule.task_status}`);
      advanceSchedule(db, schedule, now);
      continue;
    }

    console.log(`[kanaban:scheduler] Triggering "${schedule.title}" (${taskId.slice(0, 8)}) — run ${schedule.executions_completed + 1}/${schedule.max_executions ?? '∞'}`);
    emitActivity('scheduler-spawn', `Scheduled: "${schedule.title}"`, { taskId });

    const result = spawnTaskAgent(taskId);
    if (result.success) {
      advanceSchedule(db, schedule, now);
      broadcastTask(taskId);
    } else {
      console.error(`[kanaban:scheduler] Failed to spawn "${schedule.title}":`, result.error);
    }
  }
}

function advanceSchedule(db: any, schedule: ScheduleRow, now: string): void {
  const newCompleted = schedule.executions_completed + 1;
  const isMaxed = schedule.max_executions !== null && newCompleted >= schedule.max_executions;

  if (schedule.recurrence_interval_minutes && !isMaxed) {
    // Advance scheduled_at to the next future run time
    const intervalMs = schedule.recurrence_interval_minutes * 60 * 1000;
    let nextRunMs = new Date(schedule.scheduled_at).getTime() + intervalMs;
    const nowMs = Date.now();
    // Skip past times to the next future occurrence
    while (nextRunMs <= nowMs) {
      nextRunMs += intervalMs;
    }
    const nextRun = new Date(nextRunMs).toISOString();
    db.prepare('UPDATE task_schedules SET executions_completed=?, scheduled_at=?, updated_at=? WHERE id=?')
      .run(newCompleted, nextRun, now, schedule.id);
    console.log(`[kanaban:scheduler] Next run for ${schedule.id.slice(0, 8)}: ${nextRun}`);
  } else {
    // One-off or max executions reached — deactivate
    db.prepare('UPDATE task_schedules SET executions_completed=?, is_active=0, updated_at=? WHERE id=?')
      .run(newCompleted, now, schedule.id);
    console.log(`[kanaban:scheduler] Schedule ${schedule.id.slice(0, 8)} deactivated after ${newCompleted} run(s)`);
  }
}
