import { BaseParser, ParsedEvent } from './base-parser.js';

export class GenericParser extends BaseParser {
  /**
   * Generic parser: emits output-chunk events only (plus base error detection).
   * No smart parsing of agent-specific patterns.
   */
  parse(data: string): ParsedEvent[] {
    // Delegate entirely to the base parser
    return super.parse(data);
  }
}
