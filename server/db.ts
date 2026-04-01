import Database from 'better-sqlite3';
import { existsSync, mkdirSync } from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { v4 as uuidv4 } from 'uuid';

// Anchor to project root (one level up from server/) regardless of cwd
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PROJECT_ROOT = path.resolve(__dirname, '..');
const DATA_DIR = path.join(PROJECT_ROOT, 'data');
const DB_PATH = path.join(DATA_DIR, 'kanaban.db');

// Ensure data directory exists
if (!existsSync(DATA_DIR)) {
  mkdirSync(DATA_DIR, { recursive: true });
}

const db = new Database(DB_PATH);

// Enable WAL mode for better concurrent read performance
db.pragma('journal_mode = WAL');
db.pragma('foreign_keys = ON');

// ---------- Migrations ----------

function runMigrations(): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS users (
      id TEXT PRIMARY KEY,
      name TEXT,
      avatar TEXT,
      created_at TEXT
    );

    CREATE TABLE IF NOT EXISTS templates (
      id TEXT PRIMARY KEY,
      name TEXT,
      description TEXT,
      agent_type TEXT,
      command TEXT,
      checklist_defaults TEXT DEFAULT '[]',
      created_at TEXT
    );

    CREATE TABLE IF NOT EXISTS tasks (
      id TEXT PRIMARY KEY,
      title TEXT,
      description TEXT,
      "column" TEXT DEFAULT 'backlog',
      position INTEGER,
      agent_type TEXT DEFAULT 'generic',
      command TEXT,
      status TEXT DEFAULT 'idle',
      assignee_id TEXT,
      template_id TEXT,
      created_at TEXT,
      updated_at TEXT
    );

    CREATE TABLE IF NOT EXISTS task_dependencies (
      task_id TEXT NOT NULL,
      depends_on_id TEXT NOT NULL,
      PRIMARY KEY (task_id, depends_on_id),
      FOREIGN KEY (task_id) REFERENCES tasks(id) ON DELETE CASCADE,
      FOREIGN KEY (depends_on_id) REFERENCES tasks(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS checklist_items (
      id TEXT PRIMARY KEY,
      task_id TEXT NOT NULL,
      text TEXT,
      done INTEGER DEFAULT 0,
      source TEXT DEFAULT 'manual',
      position INTEGER,
      created_at TEXT,
      FOREIGN KEY (task_id) REFERENCES tasks(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS next_steps (
      id TEXT PRIMARY KEY,
      task_id TEXT NOT NULL,
      text TEXT,
      command TEXT,
      actioned INTEGER DEFAULT 0,
      created_at TEXT,
      FOREIGN KEY (task_id) REFERENCES tasks(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS skills (
      id TEXT PRIMARY KEY,
      name TEXT,
      description TEXT,
      command TEXT,
      agent_types TEXT DEFAULT '["*"]',
      is_custom INTEGER DEFAULT 0,
      created_at TEXT
    );

    CREATE TABLE IF NOT EXISTS activity_log (
      id TEXT PRIMARY KEY,
      task_id TEXT NOT NULL,
      user_id TEXT,
      action TEXT,
      detail TEXT,
      created_at TEXT,
      FOREIGN KEY (task_id) REFERENCES tasks(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS comments (
      id TEXT PRIMARY KEY,
      task_id TEXT NOT NULL,
      user_id TEXT,
      body TEXT,
      created_at TEXT,
      FOREIGN KEY (task_id) REFERENCES tasks(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS notification_prefs (
      user_id TEXT NOT NULL,
      event_type TEXT NOT NULL,
      toast INTEGER DEFAULT 1,
      browser INTEGER DEFAULT 0,
      sound INTEGER DEFAULT 1,
      PRIMARY KEY (user_id, event_type),
      FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS workspaces (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      path TEXT NOT NULL,
      created_at TEXT
    );

    CREATE TABLE IF NOT EXISTS settings (
      key TEXT PRIMARY KEY,
      value TEXT NOT NULL,
      updated_at TEXT
    );

    CREATE TABLE IF NOT EXISTS tags (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      color TEXT NOT NULL DEFAULT '#6b7280',
      created_at TEXT
    );

    CREATE TABLE IF NOT EXISTS task_tags (
      task_id TEXT NOT NULL,
      tag_id TEXT NOT NULL,
      PRIMARY KEY (task_id, tag_id),
      FOREIGN KEY (task_id) REFERENCES tasks(id) ON DELETE CASCADE,
      FOREIGN KEY (tag_id) REFERENCES tags(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS task_images (
      id TEXT PRIMARY KEY,
      task_id TEXT NOT NULL,
      filename TEXT NOT NULL,
      original_name TEXT NOT NULL,
      mime_type TEXT NOT NULL,
      size INTEGER NOT NULL,
      created_at TEXT,
      FOREIGN KEY (task_id) REFERENCES tasks(id) ON DELETE CASCADE
    );
  `);
}

// ---------- Seed default skills ----------

function seedDefaultSkills(): void {
  const existingCount = db.prepare('SELECT COUNT(*) as cnt FROM skills').get() as { cnt: number };
  if (existingCount.cnt > 0) return;

  const now = new Date().toISOString();
  const insert = db.prepare(`
    INSERT INTO skills (id, name, description, command, agent_types, is_custom, created_at)
    VALUES (?, ?, ?, ?, ?, 0, ?)
  `);

  const defaultSkills: Array<{ name: string; description: string; command: string; agentTypes: string[] }> = [
    // Claude skills
    {
      name: 'Summarize Progress',
      description: 'Ask Claude to summarize current progress on the task',
      command: 'Summarize the progress so far on this task. List what has been completed and what remains.',
      agentTypes: ['claude'],
    },
    {
      name: 'Run Tests',
      description: 'Ask Claude to run the test suite',
      command: 'Run the test suite and report results. Fix any failing tests.',
      agentTypes: ['claude'],
    },
    {
      name: 'Code Review',
      description: 'Ask Claude to review changes made so far',
      command: 'Review all changes made so far. Check for bugs, security issues, and code quality.',
      agentTypes: ['claude'],
    },
    {
      name: 'Commit Changes',
      description: 'Ask Claude to commit current changes',
      command: 'Stage and commit all current changes with an appropriate commit message.',
      agentTypes: ['claude'],
    },
    // Qwen skills
    {
      name: 'Explain Code',
      description: 'Ask Qwen to explain the current codebase',
      command: 'Explain the structure and key components of this codebase.',
      agentTypes: ['qwen'],
    },
    {
      name: 'Generate Docs',
      description: 'Ask Qwen to generate documentation',
      command: 'Generate documentation for the main modules and functions.',
      agentTypes: ['qwen'],
    },
    // Gemini skills
    {
      name: 'Analyze Architecture',
      description: 'Ask Gemini to analyze the project architecture',
      command: 'Analyze the project architecture and suggest improvements.',
      agentTypes: ['gemini'],
    },
    {
      name: 'Find Bugs',
      description: 'Ask Gemini to scan for potential bugs',
      command: 'Scan the codebase for potential bugs, race conditions, and edge cases.',
      agentTypes: ['gemini'],
    },
    // Droid skills
    {
      name: 'Scaffold Component',
      description: 'Ask Droid to scaffold a new component',
      command: 'Scaffold a new component with boilerplate code, tests, and documentation.',
      agentTypes: ['droid'],
    },
    {
      name: 'Optimize Performance',
      description: 'Ask Droid to optimize performance',
      command: 'Profile and optimize performance bottlenecks in the codebase.',
      agentTypes: ['droid'],
    },
    // Universal skills (all agent types)
    {
      name: 'List Files',
      description: 'List all files in the working directory',
      command: 'List all files in the current working directory recursively.',
      agentTypes: ['*'],
    },
    {
      name: 'Show Git Status',
      description: 'Show current git status',
      command: 'Show the current git status including staged, unstaged, and untracked files.',
      agentTypes: ['*'],
    },
  ];

  const insertMany = db.transaction(() => {
    for (const skill of defaultSkills) {
      insert.run(
        uuidv4(),
        skill.name,
        skill.description,
        skill.command,
        JSON.stringify(skill.agentTypes),
        now
      );
    }
  });

  insertMany();
}

// Run on import
runMigrations();

// Incremental migrations
function runIncrementalMigrations(): void {
  // Add working_dir column to tasks if it doesn't exist
  const cols = db.pragma('table_info(tasks)') as { name: string }[];
  if (!cols.some((c) => c.name === 'working_dir')) {
    db.exec("ALTER TABLE tasks ADD COLUMN working_dir TEXT DEFAULT ''");
  }

  // Add workspace_id column to tasks if it doesn't exist
  const cols2 = db.pragma('table_info(tasks)') as { name: string }[];
  if (!cols2.some((c) => c.name === 'workspace_id')) {
    db.exec("ALTER TABLE tasks ADD COLUMN workspace_id TEXT DEFAULT ''");
  }

  // Add yolo column to tasks if it doesn't exist
  const cols3 = db.pragma('table_info(tasks)') as { name: string }[];
  if (!cols3.some((c) => c.name === 'yolo')) {
    db.exec("ALTER TABLE tasks ADD COLUMN yolo INTEGER DEFAULT 0");
  }

  // Add model column to tasks if it doesn't exist
  const cols4 = db.pragma('table_info(tasks)') as { name: string }[];
  if (!cols4.some((c) => c.name === 'model')) {
    db.exec("ALTER TABLE tasks ADD COLUMN model TEXT DEFAULT ''");
  }

  // Add delegated column to tasks if it doesn't exist
  const cols5 = db.pragma('table_info(tasks)') as { name: string }[];
  if (!cols5.some((c) => c.name === 'delegated')) {
    db.exec("ALTER TABLE tasks ADD COLUMN delegated INTEGER DEFAULT 0");
  }

  // Add parent_task_id column to tasks if it doesn't exist
  const cols6 = db.pragma('table_info(tasks)') as { name: string }[];
  if (!cols6.some((c) => c.name === 'parent_task_id')) {
    db.exec("ALTER TABLE tasks ADD COLUMN parent_task_id TEXT DEFAULT ''");
  }

  // Add completed_at column to tasks if it doesn't exist
  const cols7 = db.pragma('table_info(tasks)') as { name: string }[];
  if (!cols7.some((c) => c.name === 'completed_at')) {
    db.exec("ALTER TABLE tasks ADD COLUMN completed_at TEXT");
  }

  // Add archived column to tasks if it doesn't exist
  const cols8 = db.pragma('table_info(tasks)') as { name: string }[];
  if (!cols8.some((c) => c.name === 'archived')) {
    db.exec("ALTER TABLE tasks ADD COLUMN archived INTEGER DEFAULT 0");
  }

  // Add auto_review column to tasks if it doesn't exist
  const cols9 = db.pragma('table_info(tasks)') as { name: string }[];
  if (!cols9.some((c) => c.name === 'auto_review')) {
    db.exec("ALTER TABLE tasks ADD COLUMN auto_review INTEGER DEFAULT 0");
  }

  // Add token usage columns to tasks
  const cols10 = db.pragma('table_info(tasks)') as { name: string }[];
  if (!cols10.some((c) => c.name === 'input_tokens')) {
    db.exec("ALTER TABLE tasks ADD COLUMN input_tokens INTEGER DEFAULT 0");
    db.exec("ALTER TABLE tasks ADD COLUMN output_tokens INTEGER DEFAULT 0");
    db.exec("ALTER TABLE tasks ADD COLUMN cache_read_tokens INTEGER DEFAULT 0");
    db.exec("ALTER TABLE tasks ADD COLUMN cache_write_tokens INTEGER DEFAULT 0");
    db.exec("ALTER TABLE tasks ADD COLUMN total_tokens INTEGER DEFAULT 0");
  }

  // Add pasted_text column to tasks if it doesn't exist
  const cols11 = db.pragma('table_info(tasks)') as { name: string }[];
  if (!cols11.some((c) => c.name === 'pasted_text')) {
    db.exec("ALTER TABLE tasks ADD COLUMN pasted_text TEXT DEFAULT ''");
  }

  // Add waitlisted column to tasks if it doesn't exist
  const cols12 = db.pragma('table_info(tasks)') as { name: string }[];
  if (!cols12.some((c) => c.name === 'waitlisted')) {
    db.exec("ALTER TABLE tasks ADD COLUMN waitlisted INTEGER DEFAULT 0");
  }

  // Add auto_complete column to tasks if it doesn't exist (default 1 = enabled)
  const cols13 = db.pragma('table_info(tasks)') as { name: string }[];
  if (!cols13.some((c) => c.name === 'auto_complete')) {
    db.exec("ALTER TABLE tasks ADD COLUMN auto_complete INTEGER DEFAULT 1");
  }

  // Add task_schedules table if it doesn't exist
  const scheduleTable = db.prepare(
    `SELECT COUNT(*) as cnt FROM sqlite_master WHERE type='table' AND name='task_schedules'`
  ).get() as { cnt: number };
  if (scheduleTable.cnt === 0) {
    db.exec(`
      CREATE TABLE task_schedules (
        id TEXT PRIMARY KEY,
        task_id TEXT NOT NULL UNIQUE,
        scheduled_at TEXT NOT NULL,
        recurrence_interval_minutes INTEGER,
        max_executions INTEGER,
        executions_completed INTEGER DEFAULT 0,
        is_active INTEGER DEFAULT 1,
        created_at TEXT,
        updated_at TEXT,
        FOREIGN KEY (task_id) REFERENCES tasks(id) ON DELETE CASCADE
      )
    `);
  }

  // Add plans table if it doesn't exist
  const plansTable = db.prepare(
    `SELECT COUNT(*) as cnt FROM sqlite_master WHERE type='table' AND name='plans'`
  ).get() as { cnt: number };
  if (plansTable.cnt === 0) {
    db.exec(`
      CREATE TABLE plans (
        id TEXT PRIMARY KEY,
        title TEXT DEFAULT '',
        description TEXT DEFAULT '',
        original_prompt TEXT NOT NULL,
        agent_type TEXT NOT NULL,
        model TEXT DEFAULT '',
        workspace_id TEXT DEFAULT '',
        status TEXT DEFAULT 'generating',
        error TEXT DEFAULT '',
        suggested_tags TEXT DEFAULT '[]',
        suggested_deps TEXT DEFAULT '[]',
        created_at TEXT NOT NULL,
        used_at TEXT
      )
    `);
  }

  // Add plan_checklist_items table if it doesn't exist
  const planChecklistTable = db.prepare(
    `SELECT COUNT(*) as cnt FROM sqlite_master WHERE type='table' AND name='plan_checklist_items'`
  ).get() as { cnt: number };
  if (planChecklistTable.cnt === 0) {
    db.exec(`
      CREATE TABLE plan_checklist_items (
        id TEXT PRIMARY KEY,
        plan_id TEXT NOT NULL,
        text TEXT NOT NULL,
        position INTEGER DEFAULT 0,
        FOREIGN KEY (plan_id) REFERENCES plans(id) ON DELETE CASCADE
      )
    `);
  }

  // Unified orchestrator: directives table
  const hasDirectives = db.prepare(`SELECT name FROM sqlite_master WHERE type='table' AND name='directives'`).get();
  if (!hasDirectives) {
    db.exec(`
      CREATE TABLE directives (
        id TEXT PRIMARY KEY,
        content TEXT NOT NULL,
        source_channel TEXT NOT NULL,
        active INTEGER DEFAULT 1,
        created_at TEXT NOT NULL,
        expires_at TEXT
      );
      CREATE INDEX IF NOT EXISTS idx_directives_active ON directives(active);
    `);
  }

  // Unified orchestrator: responder thread tables
  const hasResponderThreads = db.prepare(`SELECT name FROM sqlite_master WHERE type='table' AND name='responder_threads'`).get();
  if (!hasResponderThreads) {
    db.exec(`
      CREATE TABLE responder_threads (
        id TEXT PRIMARY KEY,
        channel TEXT NOT NULL,
        workspace_id TEXT NOT NULL,
        created_at TEXT NOT NULL,
        last_active_at TEXT NOT NULL,
        UNIQUE(channel, workspace_id)
      );
    `);
  }

  const hasResponderMessages = db.prepare(`SELECT name FROM sqlite_master WHERE type='table' AND name='responder_messages'`).get();
  if (!hasResponderMessages) {
    db.exec(`
      CREATE TABLE responder_messages (
        id TEXT PRIMARY KEY,
        thread_id TEXT NOT NULL REFERENCES responder_threads(id) ON DELETE CASCADE,
        role TEXT NOT NULL CHECK(role IN ('user', 'assistant')),
        content TEXT NOT NULL,
        channel TEXT NOT NULL,
        created_at TEXT NOT NULL
      );
      CREATE INDEX IF NOT EXISTS idx_responder_messages_thread ON responder_messages(thread_id, created_at);
    `);
  }

  // DEPRECATED: agent_chats and agent_chat_messages are replaced by responder_threads and responder_messages.
  // Tables preserved for data migration. Will be dropped in a future release.
  const hasAgentChats = db.prepare(`SELECT name FROM sqlite_master WHERE type='table' AND name='agent_chats'`).get();
  if (!hasAgentChats) {
    db.exec(`
      CREATE TABLE agent_chats (
        id TEXT PRIMARY KEY,
        workspaceId TEXT NOT NULL,
        agentType TEXT NOT NULL DEFAULT 'claude',
        model TEXT NOT NULL DEFAULT '',
        status TEXT NOT NULL DEFAULT 'active',
        createdAt TEXT NOT NULL DEFAULT (datetime('now')),
        updatedAt TEXT NOT NULL DEFAULT (datetime('now'))
      )
    `);
  }

  const hasAgentChatMessages = db.prepare(`SELECT name FROM sqlite_master WHERE type='table' AND name='agent_chat_messages'`).get();
  if (!hasAgentChatMessages) {
    db.exec(`
      CREATE TABLE agent_chat_messages (
        id TEXT PRIMARY KEY,
        chatId TEXT NOT NULL REFERENCES agent_chats(id) ON DELETE CASCADE,
        role TEXT NOT NULL CHECK(role IN ('user', 'agent')),
        content TEXT NOT NULL,
        createdAt TEXT NOT NULL DEFAULT (datetime('now'))
      )
    `);
  }

  // Add github_repo column to workspaces if it doesn't exist
  const wsCols = db.pragma('table_info(workspaces)') as { name: string }[];
  if (!wsCols.some((c) => c.name === 'github_repo')) {
    db.exec("ALTER TABLE workspaces ADD COLUMN github_repo TEXT");
  }

  // Add deployment_id column to tasks if it doesn't exist
  const taskCols = db.pragma('table_info(tasks)') as { name: string }[];
  if (!taskCols.some((c) => c.name === 'deployment_id')) {
    db.exec("ALTER TABLE tasks ADD COLUMN deployment_id TEXT DEFAULT ''");
    db.exec("ALTER TABLE tasks ADD COLUMN deployment_direction TEXT DEFAULT ''");
  }
}

runIncrementalMigrations();
seedDefaultSkills();

// Agent Chat helpers
export function createChat(workspaceId: string, agentType: string, model: string): string {
  db.prepare(`UPDATE agent_chats SET status = 'closed', updatedAt = datetime('now') WHERE workspaceId = ? AND status = 'active'`).run(workspaceId);
  const id = uuidv4();
  db.prepare(`INSERT INTO agent_chats (id, workspaceId, agentType, model) VALUES (?, ?, ?, ?)`).run(id, workspaceId, agentType, model);
  return id;
}

export function addChatMessage(chatId: string, role: string, content: string): string {
  const id = uuidv4();
  db.prepare(`INSERT INTO agent_chat_messages (id, chatId, role, content) VALUES (?, ?, ?, ?)`).run(id, chatId, role, content);
  db.prepare(`UPDATE agent_chats SET updatedAt = datetime('now') WHERE id = ?`).run(chatId);
  return id;
}

export function getChatMessages(chatId: string): Array<{ id: string; chatId: string; role: string; content: string; createdAt: string }> {
  return db.prepare(`SELECT * FROM agent_chat_messages WHERE chatId = ? ORDER BY createdAt ASC`).all(chatId) as any;
}

export function getChatByWorkspace(workspaceId: string): { id: string; workspaceId: string; agentType: string; model: string; status: string; createdAt: string; updatedAt: string } | undefined {
  return db.prepare(`SELECT * FROM agent_chats WHERE workspaceId = ? AND status = 'active' ORDER BY createdAt DESC LIMIT 1`).get(workspaceId) as any;
}

export function closeChat(chatId: string): void {
  db.prepare(`UPDATE agent_chats SET status = 'closed', updatedAt = datetime('now') WHERE id = ?`).run(chatId);
}

export function closeAllActiveChats(): void {
  db.prepare(`UPDATE agent_chats SET status = 'closed', updatedAt = datetime('now') WHERE status = 'active'`).run();
}

export default db;
