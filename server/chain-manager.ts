import type Database from 'better-sqlite3';

interface TaskRow {
  id: string;
  title: string;
  column: string;
  command: string;
  agent_type: string;
}

interface DependencyRow {
  task_id: string;
  depends_on_id: string;
}

export type SpawnCallback = (taskId: string, command: string, agentType: string) => void;

/**
 * Check if completing a task should trigger dependent tasks.
 * A dependent task is triggered only when ALL of its dependencies are in the 'done' column.
 */
export function checkAndTrigger(
  completedTaskId: string,
  db: Database.Database,
  spawnCallback: SpawnCallback
): void {
  // Find tasks that depend on the completed task
  const dependents = db.prepare(`
    SELECT task_id FROM task_dependencies WHERE depends_on_id = ?
  `).all(completedTaskId) as DependencyRow[];

  for (const dep of dependents) {
    const dependentTaskId = dep.task_id;

    // Get the dependent task
    const task = db.prepare(`
      SELECT id, title, "column", command, agent_type FROM tasks WHERE id = ?
    `).get(dependentTaskId) as TaskRow | undefined;

    if (!task) continue;

    // Skip if already in progress or done
    if (task.column === 'in-progress' || task.column === 'done' || task.column === 'review') {
      continue;
    }

    // Check if ALL dependencies of this task are now done
    const pendingDeps = db.prepare(`
      SELECT td.depends_on_id
      FROM task_dependencies td
      JOIN tasks t ON t.id = td.depends_on_id
      WHERE td.task_id = ? AND t."column" != 'done'
    `).all(dependentTaskId) as DependencyRow[];

    if (pendingDeps.length === 0) {
      // All dependencies are done — trigger this task
      const now = new Date().toISOString();

      db.prepare(`
        UPDATE tasks SET "column" = 'in-progress', status = 'running', updated_at = ? WHERE id = ?
      `).run(now, dependentTaskId);

      // If the task has a command, spawn it
      if (task.command) {
        spawnCallback(dependentTaskId, task.command, task.agent_type || 'generic');
      }
    }
  }
}
