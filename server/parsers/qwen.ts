import { BaseParser, ParsedEvent } from './base-parser.js';

export class QwenParser extends BaseParser {
  /**
   * Parser for Qwen CLI agent output.
   * Extends base parser with Qwen-specific patterns.
   * Can be enhanced later as Qwen output patterns become clearer.
   */
  parse(data: string): ParsedEvent[] {
    const events = super.parse(data);

    // Detect Qwen thinking/reasoning patterns
    if (/\bthinking\b/i.test(data) || /\breasoning\b/i.test(data) || /<think>/i.test(data)) {
      events.push({
        type: 'status-change',
        data: { status: 'thinking' },
      });
    }

    // Detect Qwen tool execution
    if (/\bexecuting\b/i.test(data) || /\bcode_interpreter\b/i.test(data) || /\btool_call\b/i.test(data)) {
      events.push({
        type: 'status-change',
        data: { status: 'executing' },
      });
    }

    // NOTE: Qwen completion patterns removed — too broad (matched any "completed").
    // Task completion is handled via KANABAN_TASK_COMPLETE signal.

    return events;
  }
}
