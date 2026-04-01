import { BaseParser, ParsedEvent } from './base-parser.js';

export class DroidParser extends BaseParser {
  /**
   * Parser for Droid CLI agent output.
   * Extends base parser with Droid-specific patterns.
   * Can be enhanced later as Droid output patterns become clearer.
   */
  parse(data: string): ParsedEvent[] {
    const events = super.parse(data);

    // Detect Droid planning/thinking patterns
    if (/\bplanning\b/i.test(data) || /\bstep\s+\d+/i.test(data)) {
      events.push({
        type: 'status-change',
        data: { status: 'thinking' },
      });
    }

    // Detect Droid action execution
    if (/\brunning\s+action\b/i.test(data) || /\bexecuting\s+step\b/i.test(data) || /\baction:\s/i.test(data)) {
      events.push({
        type: 'status-change',
        data: { status: 'executing' },
      });
    }

    // NOTE: Droid completion patterns removed — false positives during work.
    // Task completion is handled via KANABAN_TASK_COMPLETE signal.

    // Detect sub-task creation patterns
    if (/\bcreating\s+sub-?task\b/i.test(data) || /\bspawning\s+sub-?task\b/i.test(data)) {
      events.push({
        type: 'sub-task-created',
        data: { raw: data },
      });
    }

    return events;
  }
}
