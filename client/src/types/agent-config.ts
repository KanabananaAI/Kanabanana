import type { Task } from './index'

export type AgentType = Task['agentType']

export const agentTypes: { value: AgentType; label: string }[] = [
  { value: 'claude', label: 'Claude' },
  { value: 'kilo', label: 'Kilo Code' },
  { value: 'lmstudio', label: 'LM Studio' },
]

export const agentModels: Record<string, { value: string; label: string }[]> = {
  claude: [
    { value: '', label: 'Sonnet 4.6' },
    { value: 'sonnet', label: 'Sonnet 4.6 (pinned)' },
    { value: 'opus', label: 'Opus 4.6' },
    { value: 'haiku', label: 'Haiku 4.5' },
  ],
  kilo: [
    { value: '', label: 'Default (config-driven)' },
    { value: 'kilo-auto/frontier', label: 'Auto Frontier' },
    { value: 'kilo-auto/small', label: 'Auto Small' },
    { value: 'kilo/auto-free', label: 'Auto Free' },
    // Anthropic
    { value: 'anthropic/claude-opus-4.6', label: 'Claude Opus 4.6' },
    { value: 'anthropic/claude-sonnet-4.6', label: 'Claude Sonnet 4.6' },
    { value: 'anthropic/claude-sonnet-4.5', label: 'Claude Sonnet 4.5' },
    { value: 'anthropic/claude-haiku-4.5', label: 'Claude Haiku 4.5' },
    // OpenAI
    { value: 'openai/gpt-5.4', label: 'GPT-5.4' },
    { value: 'openai/gpt-5.2', label: 'GPT-5.2' },
    { value: 'openai/gpt-5.2-codex', label: 'GPT-5.2 Codex' },
    { value: 'openai/gpt-5.1', label: 'GPT-5.1' },
    // Google
    { value: 'google/gemini-3.1-pro-preview', label: 'Gemini 3.1 Pro' },
    { value: 'google/gemini-3-pro-preview', label: 'Gemini 3 Pro' },
    { value: 'google/gemini-3-flash-preview', label: 'Gemini 3 Flash' },
    { value: 'google/gemini-2.5-flash', label: 'Gemini 2.5 Flash' },
    // Free / Budget
    { value: 'minimax/minimax-m2.5', label: 'MiniMax M2.5 (free)' },
    { value: 'deepseek/deepseek-v3.1-terminus', label: 'DeepSeek V3.1 Terminus' },
    { value: 'qwen/qwen3-coder-plus', label: 'Qwen3 Coder Plus' },
    { value: '__custom__', label: 'Custom...' },
  ],
  // LM Studio models are fetched dynamically from /api/lmstudio/models
  lmstudio: [],
  // Legacy agent types (kept for backwards compatibility with existing tasks)
  qwen: [{ value: '', label: 'Default' }],
  gemini: [{ value: '', label: 'Default' }],
  droid: [{ value: '', label: 'Default' }],
  generic: [],
}

export const commandPlaceholders: Record<string, string> = {
  claude: 'claude --chat "Your prompt here"',
  kilo: 'kilo run --auto "Your task"',
  lmstudio: 'aider --model openai/model-name',
  qwen: 'qwen-coder --task "Your task"',
  gemini: 'gemini-cli --prompt "Your prompt"',
  droid: 'droid run --task "Your task"',
  generic: 'your-cli-command --args',
}

// ---------- LM Studio Model Helpers ----------

export interface LmStudioModel {
  key: string
  displayName: string
  type: string
  architecture: string
  quantization: string
  bits: number
  maxContextLength: number
}

/**
 * Convert LM Studio models to dropdown options.
 * For lmstudio agent type, model values are stored as `lmstudio:<key>`.
 */
export function lmStudioToOptions(models: LmStudioModel[]): { value: string; label: string }[] {
  return models.map((m) => ({
    value: `lmstudio:${m.key}`,
    label: `${m.displayName}${m.quantization ? ` (${m.quantization})` : ''}`,
  }))
}
