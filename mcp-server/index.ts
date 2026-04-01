import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { z } from 'zod';

const API_BASE = process.env.KANABAN_API || 'http://localhost:3001';
const WORKSPACE_ID = process.env.KANABAN_WORKSPACE_ID || '';

// ---------- API helper ----------

async function api(path: string, options: RequestInit = {}): Promise<any> {
  const url = `${API_BASE}${path}`;
  try {
    const res = await fetch(url, {
      ...options,
      headers: { 'Content-Type': 'application/json', ...options.headers },
    });
    const body = await res.json();
    if (!res.ok) return { error: body.error || body.detail || `HTTP ${res.status}` };
    return body;
  } catch (err) {
    return { error: `Kanaban server not reachable at ${API_BASE}: ${err}` };
  }
}

function result(data: any) {
  return { content: [{ type: 'text' as const, text: JSON.stringify(data, null, 2) }] };
}

// ---------- MCP Server ----------

const server = new McpServer({
  name: 'kanaban',
  version: '0.2.0',
});

// ---------- Task Tools ----------

server.tool(
  'list_tasks',
  'List tasks on the Kanaban board. Optionally filter by column or status.',
  {
    column: z.enum(['backlog', 'todo', 'scheduled', 'in-progress', 'review', 'inspect', 'done']).optional()
      .describe('Filter by board column'),
    status: z.enum(['idle', 'running', 'executing', 'done']).optional()
      .describe('Filter by task status'),
  },
  async ({ column, status }) => {
    const params = WORKSPACE_ID ? `?workspace_id=${WORKSPACE_ID}` : '';
    let tasks = await api(`/api/tasks${params}`);
    if (tasks.error) return result(tasks);
    if (column) tasks = tasks.filter((t: any) => t.column === column);
    if (status) tasks = tasks.filter((t: any) => t.status === status);
    const summary = tasks.map((t: any) => ({
      id: t.id, title: t.title, column: t.column, status: t.status, agentType: t.agentType,
    }));
    return result(summary);
  }
);

server.tool(
  'get_task',
  'Get full details of a task including checklist, dependencies, and tags.',
  { taskId: z.string().describe('The task ID') },
  async ({ taskId }) => {
    const task = await api(`/api/tasks/${taskId}`);
    return result(task);
  }
);

server.tool(
  'create_task',
  'Create a new task on the Kanaban board.',
  {
    title: z.string().describe('Task title'),
    description: z.string().optional().describe('Task description'),
    column: z.enum(['backlog', 'todo', 'scheduled', 'in-progress', 'review', 'inspect', 'done']).optional()
      .describe('Board column (default: backlog)'),
    agentType: z.enum(['claude', 'kilo', 'gemini', 'qwen', 'droid', 'generic']).optional()
      .describe('Agent type (default: claude)'),
    checklist: z.array(z.string()).optional()
      .describe('Checklist items to add'),
    workspaceId: z.string().optional()
      .describe('Target workspace ID. If omitted, uses the default workspace.'),
    workspaceName: z.string().optional()
      .describe('Target workspace name (alternative to workspaceId). Looked up by exact match.'),
  },
  async ({ title, description, column, agentType, checklist, workspaceId, workspaceName }) => {
    // Resolve workspace: explicit ID > name lookup > env default
    let resolvedWorkspaceId = workspaceId || WORKSPACE_ID;
    if (!workspaceId && workspaceName) {
      const workspaces = await api('/api/workspaces');
      if (Array.isArray(workspaces)) {
        const match = workspaces.find((ws: any) => ws.name.toLowerCase() === workspaceName.toLowerCase());
        if (match) resolvedWorkspaceId = match.id;
        else return result({ error: `Workspace "${workspaceName}" not found` });
      }
    }
    const body: any = {
      title,
      description: description || '',
      column: column || 'backlog',
      agentType: agentType || 'claude',
      workspaceId: resolvedWorkspaceId,
    };
    if (checklist?.length) {
      body.checklistItems = checklist.map(text => ({ text }));
    }
    const task = await api('/api/tasks', {
      method: 'POST',
      body: JSON.stringify(body),
    });
    return result(task);
  }
);

server.tool(
  'update_task',
  'Update a task. Only provided fields are changed.',
  {
    taskId: z.string().describe('The task ID'),
    title: z.string().optional().describe('New title'),
    description: z.string().optional().describe('New description'),
    column: z.enum(['backlog', 'todo', 'scheduled', 'in-progress', 'review', 'inspect', 'done']).optional()
      .describe('Move to column'),
    status: z.enum(['idle', 'running', 'executing', 'done']).optional()
      .describe('Set status'),
    agentType: z.enum(['claude', 'kilo', 'gemini', 'qwen', 'droid', 'generic']).optional()
      .describe('Change agent type'),
  },
  async ({ taskId, ...fields }) => {
    const body: any = {};
    if (fields.title !== undefined) body.title = fields.title;
    if (fields.description !== undefined) body.description = fields.description;
    if (fields.column !== undefined) body.column = fields.column;
    if (fields.status !== undefined) body.status = fields.status;
    if (fields.agentType !== undefined) body.agentType = fields.agentType;
    const task = await api(`/api/tasks/${taskId}`, {
      method: 'PUT',
      body: JSON.stringify(body),
    });
    return result(task);
  }
);

server.tool(
  'delete_task',
  'Delete a task from the board.',
  { taskId: z.string().describe('The task ID') },
  async ({ taskId }) => {
    const data = await api(`/api/tasks/${taskId}`, { method: 'DELETE' });
    return result(data);
  }
);

// ---------- Checklist Tools ----------

server.tool(
  'add_checklist_item',
  'Add a checklist item to a task.',
  {
    taskId: z.string().describe('The task ID'),
    text: z.string().describe('Checklist item text'),
  },
  async ({ taskId, text }) => {
    const data = await api(`/api/tasks/${taskId}/checklist`, {
      method: 'POST',
      body: JSON.stringify({ text }),
    });
    return result(data);
  }
);

server.tool(
  'update_checklist_item',
  'Update a checklist item (text or done status).',
  {
    taskId: z.string().describe('The task ID'),
    itemId: z.string().describe('The checklist item ID'),
    text: z.string().optional().describe('New text'),
    done: z.boolean().optional().describe('Mark as done/undone'),
  },
  async ({ taskId, itemId, text, done }) => {
    const body: any = {};
    if (text !== undefined) body.text = text;
    if (done !== undefined) body.done = done;
    const data = await api(`/api/tasks/${taskId}/checklist/${itemId}`, {
      method: 'PUT',
      body: JSON.stringify(body),
    });
    return result(data);
  }
);

server.tool(
  'delete_checklist_item',
  'Delete a checklist item from a task.',
  {
    taskId: z.string().describe('The task ID'),
    itemId: z.string().describe('The checklist item ID'),
  },
  async ({ taskId, itemId }) => {
    const data = await api(`/api/tasks/${taskId}/checklist/${itemId}`, { method: 'DELETE' });
    return result(data);
  }
);

// ---------- Board Awareness Tools ----------

server.tool(
  'list_workspaces',
  'List all workspaces on the Kanaban board.',
  {},
  async () => {
    const workspaces = await api('/api/workspaces');
    return result(workspaces);
  }
);

server.tool(
  'list_tags',
  'List all available tags.',
  {},
  async () => {
    const tags = await api('/api/tags');
    return result(tags);
  }
);

server.tool(
  'tag_task',
  'Add or remove a tag from a task.',
  {
    taskId: z.string().describe('The task ID'),
    tagId: z.string().describe('The tag ID'),
    action: z.enum(['add', 'remove']).describe('Whether to add or remove the tag'),
  },
  async ({ taskId, tagId, action }) => {
    if (action === 'add') {
      const data = await api(`/api/tasks/${taskId}/tags`, {
        method: 'POST',
        body: JSON.stringify({ tagId }),
      });
      return result(data);
    }
    const data = await api(`/api/tasks/${taskId}/tags/${tagId}`, { method: 'DELETE' });
    return result(data);
  }
);

// ---------- Agent Control Tools ----------

server.tool(
  'spawn_task',
  'Spawn an agent to work on a task. Moves it to in-progress.',
  {
    taskId: z.string().describe('The task ID'),
    command: z.string().optional().describe('Override the task\'s stored command'),
    forceRestart: z.boolean().optional().describe('Force respawn even if already running'),
  },
  async ({ taskId, command, forceRestart }) => {
    const body: any = {};
    if (command) body.command = command;
    if (forceRestart) body.forceRestart = forceRestart;
    const data = await api(`/api/tasks/${taskId}/spawn`, {
      method: 'POST',
      body: JSON.stringify(body),
    });
    return result(data);
  }
);

server.tool(
  'kill_task',
  'Kill a running agent. Moves the task to review.',
  { taskId: z.string().describe('The task ID') },
  async ({ taskId }) => {
    const data = await api(`/api/tasks/${taskId}/kill`, { method: 'POST' });
    return result(data);
  }
);

server.tool(
  'add_task_feedback',
  'Send reviewer feedback to a running agent. The agent must be spawned first.',
  {
    taskId: z.string().describe('The task ID'),
    feedback: z.string().describe('Feedback text to send to the agent'),
  },
  async ({ taskId, feedback }) => {
    const data = await api(`/api/tasks/${taskId}/feedback`, {
      method: 'POST',
      body: JSON.stringify({ feedback }),
    });
    return result(data);
  }
);

server.tool(
  'get_board_summary',
  'Get a high-level summary of the board: task counts per column, running agents.',
  {},
  async () => {
    const params = WORKSPACE_ID ? `?workspace_id=${WORKSPACE_ID}` : '';
    const tasks = await api(`/api/tasks${params}`);
    if (tasks.error) return result(tasks);

    const columns: Record<string, any[]> = {
      backlog: [], todo: [], scheduled: [], 'in-progress': [], review: [], inspect: [], done: [],
    };
    for (const t of tasks) {
      if (columns[t.column]) columns[t.column].push(t);
    }

    const summary = {
      totalTasks: tasks.length,
      columns: Object.entries(columns).map(([col, items]) => ({
        column: col,
        count: items.length,
        running: items.filter((t: any) => t.status === 'running').length,
      })),
      runningAgents: tasks
        .filter((t: any) => t.status === 'running')
        .map((t: any) => ({ id: t.id, title: t.title, agentType: t.agentType })),
    };
    return result(summary);
  }
);

// ---------- Walkthrough & Activity Tools ----------

server.tool(
  'get_walkthrough',
  'Get the completion walkthrough for a task (markdown).',
  { taskId: z.string().describe('The task ID') },
  async ({ taskId }) => {
    const data = await api(`/api/tasks/${taskId}/walkthrough`);
    return result(data);
  }
);

server.tool(
  'get_task_activity',
  'Get the activity log for a task.',
  { taskId: z.string().describe('The task ID') },
  async ({ taskId }) => {
    const data = await api(`/api/tasks/${taskId}/activity`);
    return result(data);
  }
);

// ---------- Archive Tools ----------

server.tool(
  'archive_task',
  'Archive a completed task.',
  { taskId: z.string().describe('The task ID') },
  async ({ taskId }) => {
    const data = await api(`/api/tasks/${taskId}/archive`, { method: 'POST' });
    return result(data);
  }
);

server.tool(
  'unarchive_task',
  'Restore an archived task.',
  { taskId: z.string().describe('The task ID') },
  async ({ taskId }) => {
    const data = await api(`/api/tasks/${taskId}/unarchive`, { method: 'POST' });
    return result(data);
  }
);

// ---------- Dependency & Ordering Tools ----------

server.tool(
  'set_task_dependencies',
  'Set which tasks a task depends on.',
  {
    taskId: z.string().describe('The task ID'),
    dependsOn: z.array(z.string()).describe('Array of task IDs this task depends on'),
  },
  async ({ taskId, dependsOn }) => {
    const data = await api(`/api/tasks/${taskId}`, {
      method: 'PUT',
      body: JSON.stringify({ dependsOn }),
    });
    return result(data);
  }
);

server.tool(
  'reorder_task',
  'Change a task\'s position within its column.',
  {
    taskId: z.string().describe('The task ID'),
    position: z.number().describe('New position index (0-based)'),
  },
  async ({ taskId, position }) => {
    const data = await api(`/api/tasks/${taskId}`, {
      method: 'PUT',
      body: JSON.stringify({ position }),
    });
    return result(data);
  }
);

// ---------- Schedule Tools ----------

server.tool(
  'schedule_task',
  'Schedule a task to run at a specific time, optionally recurring.',
  {
    taskId: z.string().describe('The task ID'),
    scheduledAt: z.string().describe('ISO datetime for when to run (e.g. "2026-03-15T09:00:00Z")'),
    recurrenceIntervalMinutes: z.number().optional()
      .describe('Repeat interval in minutes (omit for one-off)'),
    maxExecutions: z.number().optional()
      .describe('Max times to run (omit for unlimited, 1 for one-off)'),
  },
  async ({ taskId, scheduledAt, recurrenceIntervalMinutes, maxExecutions }) => {
    const body: any = { scheduledAt };
    if (recurrenceIntervalMinutes !== undefined) body.recurrenceIntervalMinutes = recurrenceIntervalMinutes;
    if (maxExecutions !== undefined) body.maxExecutions = maxExecutions;
    const data = await api(`/api/tasks/${taskId}/schedule`, {
      method: 'POST',
      body: JSON.stringify(body),
    });
    return result(data);
  }
);

server.tool(
  'list_schedules',
  'List all active task schedules.',
  {},
  async () => {
    const data = await api('/api/schedules');
    return result(data);
  }
);

server.tool(
  'delete_schedule',
  'Remove a schedule from a task.',
  { taskId: z.string().describe('The task ID') },
  async ({ taskId }) => {
    const data = await api(`/api/tasks/${taskId}/schedule`, { method: 'DELETE' });
    return result(data);
  }
);

// ---------- GitHub Tools ----------

server.tool(
  'list_github_issues',
  'List open GitHub issues for the workspace\'s linked repo.',
  {
    workspaceId: z.string().optional()
      .describe('Workspace ID (defaults to current workspace)'),
  },
  async ({ workspaceId }) => {
    const wsId = workspaceId || WORKSPACE_ID;
    if (!wsId) return result({ error: 'No workspace ID provided' });
    const data = await api(`/api/workspaces/${wsId}/github/issues`);
    return result(data);
  }
);

server.tool(
  'list_github_prs',
  'List open GitHub pull requests for the workspace\'s linked repo.',
  {
    workspaceId: z.string().optional()
      .describe('Workspace ID (defaults to current workspace)'),
  },
  async ({ workspaceId }) => {
    const wsId = workspaceId || WORKSPACE_ID;
    if (!wsId) return result({ error: 'No workspace ID provided' });
    const data = await api(`/api/workspaces/${wsId}/github/pulls`);
    return result(data);
  }
);

server.tool(
  'import_github_issue',
  'Import a GitHub issue as a Kanaban task (creates in backlog).',
  {
    issueNumber: z.number().describe('GitHub issue number'),
    workspaceId: z.string().optional()
      .describe('Workspace ID (defaults to current workspace)'),
  },
  async ({ issueNumber, workspaceId }) => {
    const wsId = workspaceId || WORKSPACE_ID;
    if (!wsId) return result({ error: 'No workspace ID provided' });
    const data = await api(`/api/workspaces/${wsId}/github/import-issue`, {
      method: 'POST',
      body: JSON.stringify({ issueNumber }),
    });
    return result(data);
  }
);

// ---------- Workspace Tools ----------

server.tool(
  'create_workspace',
  'Register a new workspace directory with Kanaban.',
  {
    name: z.string().describe('Workspace name'),
    path: z.string().describe('Absolute path to the workspace directory'),
    githubRepo: z.string().optional()
      .describe('GitHub repo (owner/repo format, e.g. "acme/my-app")'),
  },
  async ({ name, path, githubRepo }) => {
    const body: any = { name, path };
    if (githubRepo) body.githubRepo = githubRepo;
    const data = await api('/api/workspaces', {
      method: 'POST',
      body: JSON.stringify(body),
    });
    return result(data);
  }
);

server.tool(
  'delete_workspace',
  'Remove a workspace from Kanaban (does not delete files).',
  { workspaceId: z.string().describe('The workspace ID') },
  async ({ workspaceId }) => {
    const data = await api(`/api/workspaces/${workspaceId}`, { method: 'DELETE' });
    return result(data);
  }
);

server.tool(
  'browse_dirs',
  'Browse directories for workspace setup. Lists subdirectories of a given path.',
  {
    dir: z.string().optional().describe('Directory to browse (defaults to home)'),
  },
  async ({ dir }) => {
    const params = dir ? `?dir=${encodeURIComponent(dir)}` : '';
    const data = await api(`/api/browse-dirs${params}`);
    return result(data);
  }
);

// ---------- Orchestrator Tools ----------

server.tool(
  'get_orchestrator_status',
  'Check if the orchestrator is running.',
  {},
  async () => {
    const data = await api('/api/orchestrator/status');
    return result(data);
  }
);

server.tool(
  'spawn_orchestrator',
  'Start the orchestrator process.',
  {
    provider: z.enum(['claude', 'kilo', 'gemini', 'qwen', 'droid']).optional()
      .describe('Agent provider (default: claude)'),
    model: z.string().optional().describe('Model name for LM Studio'),
  },
  async ({ provider, model }) => {
    const body: any = {};
    if (provider) body.provider = provider;
    if (model) body.model = model;
    const data = await api('/api/orchestrator/spawn', {
      method: 'POST',
      body: JSON.stringify(body),
    });
    return result(data);
  }
);

server.tool(
  'kill_orchestrator',
  'Stop the orchestrator process.',
  {},
  async () => {
    const data = await api('/api/orchestrator/kill', { method: 'POST' });
    return result(data);
  }
);

server.tool(
  'get_orchestrator_activities',
  'Get the orchestrator\'s activity log.',
  {},
  async () => {
    const data = await api('/api/orchestrator/activities');
    return result(data);
  }
);

// ---------- Start ----------

const transport = new StdioServerTransport();
await server.connect(transport);
