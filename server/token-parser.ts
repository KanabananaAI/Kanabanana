/**
 * Parse token usage from agent PTY output.
 * Different agents output token stats in different formats.
 * We extract what we can from the ANSI-stripped output buffer.
 */

export interface TokenUsage {
  inputTokens: number;
  outputTokens: number;
  cacheReadTokens: number;
  cacheWriteTokens: number;
  totalTokens: number;
}

const EMPTY_USAGE: TokenUsage = {
  inputTokens: 0,
  outputTokens: 0,
  cacheReadTokens: 0,
  cacheWriteTokens: 0,
  totalTokens: 0,
};

function parseNum(s: string): number {
  return parseInt(s.replace(/,/g, ''), 10) || 0;
}

/**
 * Parse token usage from the tail of agent output.
 * Only looks at the last ~4KB to avoid false positives from echoed prompts.
 */
export function parseTokenUsage(rawOutput: string): TokenUsage {
  if (!rawOutput) return EMPTY_USAGE;

  // Only search the tail of the output (last 4KB) where session summaries appear
  const tail = rawOutput.length > 4096 ? rawOutput.slice(-4096) : rawOutput;

  let inputTokens = 0;
  let outputTokens = 0;
  let cacheReadTokens = 0;
  let cacheWriteTokens = 0;
  let totalTokens = 0;

  // Claude Code format: "Total tokens: 24,155" or "Total tokens:  24155"
  const totalMatch = tail.match(/total.tokens?[:\s]+?([\d,]+)/i);
  if (totalMatch) {
    totalTokens = parseNum(totalMatch[1]);
  }

  // Claude Code format: "input: 15,234" or "Input tokens: 15234"
  const inputMatch = tail.match(/input(?:\s+tokens?)?[:\s]+?([\d,]+)/i);
  if (inputMatch) {
    inputTokens = parseNum(inputMatch[1]);
  }

  // Claude Code format: "output: 8,921" or "Output tokens: 8921"
  const outputMatch = tail.match(/output(?:\s+tokens?)?[:\s]+?([\d,]+)/i);
  if (outputMatch) {
    outputTokens = parseNum(outputMatch[1]);
  }

  // Cache tokens (Claude-specific): "cache read: 1,234" or "Cache read tokens: 1234"
  const cacheReadMatch = tail.match(/cache.?read(?:\s+tokens?)?[:\s]+?([\d,]+)/i);
  if (cacheReadMatch) {
    cacheReadTokens = parseNum(cacheReadMatch[1]);
  }

  const cacheWriteMatch = tail.match(/cache.?write(?:\s+tokens?)?[:\s]+?([\d,]+)/i);
  if (cacheWriteMatch) {
    cacheWriteTokens = parseNum(cacheWriteMatch[1]);
  }

  // If we got input+output but no total, calculate it
  if (!totalTokens && (inputTokens || outputTokens)) {
    totalTokens = inputTokens + outputTokens;
  }

  // If we only got total but no breakdown, leave input/output as 0
  return {
    inputTokens,
    outputTokens,
    cacheReadTokens,
    cacheWriteTokens,
    totalTokens,
  };
}

/**
 * Format token count for display (e.g., 24155 → "24.2k", 1234567 → "1.2M")
 */
export function formatTokenCount(count: number): string {
  if (count === 0) return '0';
  if (count < 1000) return String(count);
  if (count < 1_000_000) return `${(count / 1000).toFixed(1)}k`;
  return `${(count / 1_000_000).toFixed(1)}M`;
}
