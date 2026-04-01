import { BaseParser, ParsedEvent } from './base-parser.js';

export class GeminiParser extends BaseParser {
  /**
   * Parser for Gemini CLI agent output.
   * Extends base parser with Gemini-specific patterns.
   * Can be enhanced later as Gemini output patterns become clearer.
   */
  parse(data: string): ParsedEvent[] {
    const events = super.parse(data);

    // Detect Gemini thinking/processing patterns
    if (/\bprocessing\b/i.test(data) || /\banalyzing\b/i.test(data) || /\bgenerating\b/i.test(data)) {
      events.push({
        type: 'status-change',
        data: { status: 'thinking' },
      });
    }

    // Detect Gemini function/tool calling
    if (/\bfunction_call\b/i.test(data) || /\btool_use\b/i.test(data) || /\bexecuting\s+function\b/i.test(data)) {
      events.push({
        type: 'status-change',
        data: { status: 'executing' },
      });
    }

    // NOTE: Gemini completion patterns removed — false positives during work.
    // Task completion is handled via KANABAN_TASK_COMPLETE signal.

    // Detect Gemini safety/error patterns
    if (/\bsafety\s+rating\b/i.test(data) || /\bblocked\b/i.test(data) || /\brecitation\b/i.test(data)) {
      events.push({
        type: 'error',
        data: { message: 'Gemini safety filter triggered', raw: data },
      });
    }

    return events;
  }
}
