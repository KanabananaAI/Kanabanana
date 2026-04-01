/** Schedule configuration for a task — supports one-time and recurring execution. */
export interface TaskSchedule {
  id: string
  taskId: string
  /** ISO 8601 timestamp for when the task should next execute. */
  scheduledAt: string
  /** Minutes between recurring executions. Null = one-time schedule. */
  recurrenceIntervalMinutes: number | null
  /** Stop recurring after this many executions. Null = unlimited. */
  maxExecutions: number | null
  executionsCompleted: number
  isActive: boolean
}

/** A task on the Kanban board — the core entity of the system. */
export interface Task {
  id: string
  title: string
  description: string
  /** Which board column the task is in. Determines workflow state. */
  column: ColumnId
  /** Sort order within the column (lower = higher on the board). */
  position: number
  /** Which AI agent CLI to use when spawning this task. */
  agentType: 'claude' | 'kilo' | 'lmstudio' | 'qwen' | 'gemini' | 'droid' | 'generic'
  /** Model identifier passed to the agent (e.g. "claude-sonnet-4-6"). */
  model: string
  /** Explicit CLI command override. Used by "generic" agent type. */
  command: string
  /** Working directory where the agent PTY process is spawned. */
  workingDir: string
  /** Workspace this task belongs to. Empty string = unassigned. */
  workspaceId: string
  /** Current agent execution state — updated in real time via PTY output parsing. */
  status: 'idle' | 'thinking' | 'executing' | 'running' | 'waiting-for-input' | 'error' | 'done'
  checklistItems: ChecklistItem[]
  /** Agent-suggested next steps parsed from output. */
  nextSteps: NextStep[]
  /** Task IDs that must complete before this task can start. */
  dependsOn: string[]
  /** When true, the agent runs in autonomous mode (skips permission prompts). */
  yolo: boolean
  /** When true, automatically trigger verification after agent completes. */
  autoReview: boolean
  /** When true, move task to Done after successful verification. */
  autoComplete: boolean
  /** When true, this task is an orchestrator that manages sub-tasks. */
  delegated: boolean
  images?: TaskImage[]
  tags?: Tag[]
  archived?: boolean
  /** If this is a sub-task, the ID of the parent orchestrator task. */
  parentTaskId: string
  assigneeId?: string
  templateId?: string
  completedAt: string | null
  /** When true, the task is queued and waiting for a free agent slot. */
  waitlisted: boolean
  /** Text pasted by the user to include in the agent prompt. */
  pastedText?: string
  /** Token usage counters — populated from agent output parsing. */
  inputTokens: number
  outputTokens: number
  cacheReadTokens: number
  cacheWriteTokens: number
  totalTokens: number
  createdAt: string
  updatedAt: string
  schedule?: TaskSchedule | null
}

/** A color-coded label that can be attached to tasks. */
export interface Tag {
  id: string
  name: string
  /** CSS color value (e.g. "#ef4444"). */
  color: string
}

/** An image attached to a task, stored on disk and referenced by filename. */
export interface TaskImage {
  id: string
  taskId: string
  filename: string
  originalName: string
  mimeType: string
  /** File size in bytes. */
  size: number
}

/** A checklist item on a task — can be created manually or by the agent. */
export interface ChecklistItem {
  id: string
  taskId: string
  text: string
  done: boolean
  /** "manual" = user-created, "agent" = parsed from agent output. */
  source: 'manual' | 'agent'
  position: number
}

/** An actionable next step suggested by the agent, parsed from output. */
export interface NextStep {
  id: string
  taskId: string
  text: string
  /** Optional CLI command the user can execute. */
  command?: string
  /** Whether the user has acted on this suggestion. */
  actioned: boolean
}

/** A reusable task configuration template. */
export interface Template {
  id: string
  name: string
  description: string
  agentType: string
  command: string
  checklistDefaults: string[]
}

export interface PlanChecklistItem {
  id: string
  planId: string
  text: string
  position: number
}

/** An AI-generated task plan — created by the task planner feature. */
export interface Plan {
  id: string
  title: string
  description: string
  originalPrompt: string
  agentType: string
  model: string
  workspaceId: string
  status: 'generating' | 'ready' | 'used' | 'failed'
  error: string
  suggestedTags: string[]
  suggestedDeps: string[]
  checklistItems: PlanChecklistItem[]
  createdAt: string
  usedAt: string | null
}

/** A workspace terminal chat session with an AI agent. */
export interface AgentChat {
  id: string
  workspaceId: string
  agentType: string
  model: string
  status: 'active' | 'closed'
  createdAt: string
  updatedAt: string
}

export interface ChatMessage {
  id: string
  chatId: string
  role: 'user' | 'agent'
  content: string
  createdAt: string
}

/** A reusable command template that can be executed against tasks with one click. */
export interface Skill {
  id: string
  name: string
  description: string
  /** The CLI command to execute. */
  command: string
  /** Which agent types this skill is compatible with. */
  agentTypes: string[]
  /** False = built-in skill, true = user-created. */
  isCustom: boolean
}

/** A workspace groups tasks by project/repository. */
export interface Workspace {
  id: string
  name: string
  /** Filesystem path to the project root. */
  path: string
  /** GitHub repo in "owner/repo" format for PR/issue integration. */
  githubRepo?: string
  createdAt: string
}

/** The seven board columns, ordered left-to-right. */
export type ColumnId = 'backlog' | 'todo' | 'scheduled' | 'in-progress' | 'review' | 'inspect' | 'done'

/** A real-time notification event emitted via WebSocket. */
export interface NotificationEvent {
  type: 'agent-started' | 'status-change' | 'needs-input' | 'completed' | 'error' | 'chain-triggered'
  taskId: string
  title: string
  message: string
  sound?: string
}
