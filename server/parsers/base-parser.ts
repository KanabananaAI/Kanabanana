export interface ParsedEvent {
  type: 'status-change' | 'checklist-update' | 'next-steps' | 'output-chunk' | 'error' | 'sub-task-created';
  data: any;
}

export abstract class BaseParser {
  protected buffer: string = '';

  /**
   * Parse a chunk of PTY output data and return structured events.
   */
  parse(data: string): ParsedEvent[] {
    const events: ParsedEvent[] = [];

    // NOTE: Raw output chunk emission removed as it's redundant.
    // The server already emits the raw data via 'task:output' in server/index.ts.

    // Detect generic error patterns
    const errorPatterns = [
      /error:\s*(.+)/i,
      /exception:\s*(.+)/i,
      /fatal:\s*(.+)/i,
      /panic:\s*(.+)/i,
      /traceback/i,
      /ENOENT/,
      /EACCES/,
      /EPERM/,
    ];

    for (const pattern of errorPatterns) {
      const match = data.match(pattern);
      if (match) {
        events.push({
          type: 'error',
          data: { message: match[0], raw: data },
        });
        break;
      }
    }

    // NOTE: Generic completion patterns removed — they were too broad and
    // triggered false "done" status on phrases like "I've finished reading".
    // Task completion is now handled exclusively via the KANABAN_TASK_COMPLETE
    // signal in server/index.ts, which has proper debounce protection.

    return events;
  }
}
