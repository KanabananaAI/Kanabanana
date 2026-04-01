import { Type, type Static } from '@sinclair/typebox';
import { Value } from '@sinclair/typebox/value';

// ---------- Shared Primitives ----------

const TaskId = Type.String({ minLength: 1 });
const Column = Type.Union([
  Type.Literal('backlog'),
  Type.Literal('todo'),
  Type.Literal('in-progress'),
  Type.Literal('review'),
  Type.Literal('done'),
]);
const Status = Type.Union([
  Type.Literal('idle'),
  Type.Literal('running'),
  Type.Literal('executing'),
  Type.Literal('done'),
]);

// ---------- Client → Server Events ----------

export const TaskInputSchema = Type.Object({
  taskId: TaskId,
  input: Type.String(),
});

export const TaskJoinSchema = Type.String({ minLength: 1 }); // plain taskId

export const TaskResizeSchema = Type.Object({
  taskId: TaskId,
  cols: Type.Integer({ minimum: 1 }),
  rows: Type.Integer({ minimum: 1 }),
});

export const TaskSpawnSchema = Type.Object({
  taskId: TaskId,
  command: Type.Optional(Type.String()),
});

export const TaskKillSchema = Type.Object({
  taskId: TaskId,
});

export const TaskFeedbackSchema = Type.Object({
  taskId: TaskId,
  feedback: Type.String({ minLength: 1 }),
});

export const TaskVerifySchema = Type.Object({
  taskId: TaskId,
});

export const TaskDelegateSchema = Type.Object({
  taskId: TaskId,
});

export const OrchestratorSpawnSchema = Type.Object({
  cwd: Type.Optional(Type.String()),
  provider: Type.Optional(Type.String()),
  model: Type.Optional(Type.String()),
});

export const OrchestratorInputSchema = Type.Object({
  input: Type.String(),
});

export const OrchestratorResizeSchema = Type.Object({
  cols: Type.Integer({ minimum: 1 }),
  rows: Type.Integer({ minimum: 1 }),
});

// ---------- Agent Chat Events ----------

export const AgentChatSpawnSchema = Type.Object({
  workspaceId: Type.String(),
  agentType: Type.String(),
  model: Type.String(),
  yolo: Type.Optional(Type.Boolean()),
});

export const AgentChatInputSchema = Type.Object({
  chatId: Type.String(),
  input: Type.String(),
});

export const AgentChatKillSchema = Type.Object({
  chatId: Type.String(),
});

export const AgentChatHistorySchema = Type.Object({
  workspaceId: Type.String(),
});

// ---------- Server → Client Events ----------

export const TaskOutputSchema = Type.Object({
  taskId: TaskId,
  data: Type.String(),
});

export const TaskUpdatedSchema = Type.Object({
  id: TaskId,
  title: Type.String(),
  description: Type.Optional(Type.String()),
  column: Column,
  status: Status,
  agentType: Type.String(),
  model: Type.Optional(Type.String()),
  yolo: Type.Boolean(),
  // ... remaining fields are not strictly validated to allow flexibility
}, { additionalProperties: true });

export const SessionsSchema = Type.Array(Type.Object({
  taskId: TaskId,
  agentType: Type.String(),
  pid: Type.Integer(),
}, { additionalProperties: true }));

export const OrchestratorStatusSchema = Type.Object({
  running: Type.Boolean(),
});

// ---------- Validation Helper ----------

const validationErrors: Map<string, number> = new Map();
const ERROR_LOG_INTERVAL = 60_000; // log same event type at most once per minute

export function validateEvent<T>(eventName: string, schema: { type: string }, data: unknown): data is T {
  if (Value.Check(schema as any, data)) return true;

  // Rate-limited logging to avoid spam
  const now = Date.now();
  const lastLogged = validationErrors.get(eventName) || 0;
  if (now - lastLogged > ERROR_LOG_INTERVAL) {
    const errors = [...Value.Errors(schema as any, data)];
    const firstErr = errors[0];
    console.warn(
      `[kanaban:schema] Invalid "${eventName}" event: ${firstErr?.message} at ${firstErr?.path}`,
      typeof data === 'object' ? JSON.stringify(data).slice(0, 200) : data
    );
    validationErrors.set(eventName, now);
  }
  return false;
}

// ---------- Type exports ----------

export type TaskInput = Static<typeof TaskInputSchema>;
export type TaskOutput = Static<typeof TaskOutputSchema>;
export type OrchestratorSpawn = Static<typeof OrchestratorSpawnSchema>;
export type OrchestratorInput = Static<typeof OrchestratorInputSchema>;
export type OrchestratorStatus = Static<typeof OrchestratorStatusSchema>;
export type AgentChatSpawn = Static<typeof AgentChatSpawnSchema>;
export type AgentChatInput = Static<typeof AgentChatInputSchema>;
export type AgentChatKill = Static<typeof AgentChatKillSchema>;
export type AgentChatHistory = Static<typeof AgentChatHistorySchema>;
