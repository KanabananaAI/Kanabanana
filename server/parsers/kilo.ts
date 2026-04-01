import { BaseParser, ParsedEvent } from './base-parser.js';

export class KiloParser extends BaseParser {
  /**
   * Kilo Code CLI parser.
   * Kilo is a TUI-based coding agent (fork of OpenCode).
   * Emits output-chunk events plus base error detection.
   */
  parse(data: string): ParsedEvent[] {
    return super.parse(data);
  }
}
