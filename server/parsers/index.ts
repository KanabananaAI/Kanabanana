import { BaseParser } from './base-parser.js';
import { ClaudeParser } from './claude.js';
import { QwenParser } from './qwen.js';
import { GeminiParser } from './gemini.js';
import { DroidParser } from './droid.js';
import { KiloParser } from './kilo.js';
import { GenericParser } from './generic.js';

export type { ParsedEvent } from './base-parser.js';

const parserInstances: Map<string, BaseParser> = new Map();

/**
 * Get a parser instance for the given agent type.
 * Parsers are singletons — one instance per agent type.
 */
export function getParser(agentType: string): BaseParser {
  const key = agentType.toLowerCase();

  if (parserInstances.has(key)) {
    return parserInstances.get(key)!;
  }

  let parser: BaseParser;

  switch (key) {
    case 'claude':
      parser = new ClaudeParser();
      break;
    case 'qwen':
      parser = new QwenParser();
      break;
    case 'gemini':
      parser = new GeminiParser();
      break;
    case 'droid':
      parser = new DroidParser();
      break;
    case 'kilo':
      parser = new KiloParser();
      break;
    default:
      parser = new GenericParser();
      break;
  }

  parserInstances.set(key, parser);
  return parser;
}
