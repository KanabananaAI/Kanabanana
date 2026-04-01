import { BaseParser, ParsedEvent } from './base-parser.js';

export class ClaudeParser extends BaseParser {
  /**
   * Parser for Claude Code CLI output.
   * Detects Claude-specific patterns like thinking, tool use, task completion,
   * checklist updates, and errors.
   */
  parse(data: string): ParsedEvent[] {
    const events = super.parse(data);

    // Detect "Thinking..." status
    if (/thinking\.\.\./i.test(data) || /\banalyzing\b/i.test(data)) {
      events.push({
        type: 'status-change',
        data: { status: 'thinking' },
      });
    }

    // Detect tool use patterns (Claude Code tool calls)
    const toolPatterns = [
      /\b(?:Read|Reading)\s+(?:file|from)\b/i,
      /\b(?:Write|Writing)\s+(?:file|to)\b/i,
      /\b(?:Edit|Editing)\s+(?:file)?\b/i,
      /\bBash\s*\(/i,
      /\bRunning\s+command\b/i,
      /\bExecuting\b/i,
      /\bSearching\b/i,
      /\bGrep\b/i,
      /\bGlob\b/i,
      /\btool\s+use:/i,
      /\bTool:\s*(Read|Write|Edit|Bash|Grep|Glob|WebSearch|WebFetch)/i,
    ];

    for (const pattern of toolPatterns) {
      if (pattern.test(data)) {
        events.push({
          type: 'status-change',
          data: { status: 'executing' },
        });
        break;
      }
    }

    // NOTE: Claude completion patterns removed — they matched common mid-work
    // phrases like "I've finished reading the file" and set status to "done"
    // prematurely. Task completion is handled via KANABAN_TASK_COMPLETE signal.

    // Detect checklist-like output
    // Strip ANSI escape sequences before matching so terminal formatting doesn't break the regex
    const stripped = data.includes('\x1b') ? data.replace(/\x1b\[[0-9;]*[a-zA-Z]/g, '') : data;
    // Matches lines like: - [x] Something done  or  - [ ] Something todo
    const checklistRegex = /^[\s]*[-*]\s*\[([ xX✓✔])\]\s*(.+)$/gm;
    let match: RegExpExecArray | null;
    const checklistItems: Array<{ text: string; done: boolean }> = [];

    while ((match = checklistRegex.exec(stripped)) !== null) {
      checklistItems.push({
        text: match[2].trim(),
        done: match[1] !== ' ',
      });
    }

    if (checklistItems.length > 0) {
      events.push({
        type: 'checklist-update',
        data: { items: checklistItems },
      });
    }

    // Detect Claude-specific error patterns
    if (/API\s+error/i.test(data) || /rate\s+limit/i.test(data) || /context\s+(?:window|length)\s+exceeded/i.test(data)) {
      events.push({
        type: 'error',
        data: { message: 'Claude API error detected', raw: data },
      });
    }

    // Detect next steps / suggested actions
    const nextStepPatterns = [
      /next\s+steps?:/i,
      /you\s+(?:can|should|might)\s+(?:now|also|next)/i,
      /suggested\s+(?:actions?|next)/i,
    ];

    for (const pattern of nextStepPatterns) {
      if (pattern.test(data)) {
        // Extract bullet points following the "next steps" header
        const bulletRegex = /^[\s]*[-*\d.]+\s+(.+)$/gm;
        const steps: Array<{ text: string }> = [];
        let bulletMatch: RegExpExecArray | null;

        while ((bulletMatch = bulletRegex.exec(data)) !== null) {
          steps.push({ text: bulletMatch[1].trim() });
        }

        if (steps.length > 0) {
          events.push({
            type: 'next-steps',
            data: { steps },
          });
        }
        break;
      }
    }

    return events;
  }
}
