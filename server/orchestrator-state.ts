import { existsSync, mkdirSync, writeFileSync, readFileSync } from 'fs';
import path from 'path';

const STATE_DIR = path.resolve('data');
const STATE_FILE = path.join(STATE_DIR, 'orchestrator-state.json');
const MAX_ACTIVITIES = 100;
const MAX_BUFFER_PERSIST = 16 * 1024; // persist last 16KB of orchestrator output

export type ActivitySource = 'orchestrator' | 'user' | 'system';

export interface OrchestratorActivity {
  id: string;
  type: string;
  message: string;
  timestamp: string;
  source?: ActivitySource;
  data?: Record<string, unknown>;
}

export interface OrchestratorState {
  running: boolean;
  provider: string;
  model: string;
  startedAt: string;
  lastBoardState: string;
  activities: OrchestratorActivity[];
  outputTail: string; // last N bytes of orchestrator terminal output
}

const defaultState: OrchestratorState = {
  running: false,
  provider: '',
  model: '',
  startedAt: '',
  lastBoardState: '',
  activities: [],
  outputTail: '',
};

let currentState: OrchestratorState = { ...defaultState };

export function loadOrchestratorState(): OrchestratorState {
  try {
    if (existsSync(STATE_FILE)) {
      const raw = readFileSync(STATE_FILE, 'utf-8');
      const parsed = JSON.parse(raw);
      // Mark as not running on load (server just started)
      currentState = { ...defaultState, ...parsed, running: false };
      console.log(`[kanaban:orch-state] Loaded persisted state (${currentState.activities.length} activities, ${currentState.outputTail.length} chars output)`);
    }
  } catch (err) {
    console.warn('[kanaban:orch-state] Failed to load state, starting fresh:', err);
    currentState = { ...defaultState };
  }
  return currentState;
}

export function saveOrchestratorState(): void {
  try {
    if (!existsSync(STATE_DIR)) mkdirSync(STATE_DIR, { recursive: true });
    writeFileSync(STATE_FILE, JSON.stringify(currentState, null, 2));
  } catch (err) {
    console.error('[kanaban:orch-state] Failed to save state:', err);
  }
}

export function updateOrchestratorState(updates: Partial<OrchestratorState>): void {
  Object.assign(currentState, updates);
  saveOrchestratorState();
}

export function addActivity(activity: OrchestratorActivity): void {
  currentState.activities.push(activity);
  if (currentState.activities.length > MAX_ACTIVITIES) {
    currentState.activities.splice(0, currentState.activities.length - MAX_ACTIVITIES);
  }
  // Don't save on every activity — let periodic save handle it
}

export function getActivities(): OrchestratorActivity[] {
  return currentState.activities;
}

export function updateOutputTail(buffer: string): void {
  currentState.outputTail = buffer.length > MAX_BUFFER_PERSIST
    ? buffer.slice(buffer.length - MAX_BUFFER_PERSIST)
    : buffer;
}

export function getOutputTail(): string {
  return currentState.outputTail;
}

export function getLastBoardState(): string {
  return currentState.lastBoardState;
}

export function setOrchestratorStarted(provider: string, model: string): void {
  currentState.running = true;
  currentState.provider = provider;
  currentState.model = model;
  currentState.startedAt = new Date().toISOString();
  saveOrchestratorState();
}

export function setOrchestratorStopped(): void {
  currentState.running = false;
  saveOrchestratorState();
}

export function getPersistedProvider(): string {
  return currentState.provider;
}

export function getPersistedModel(): string {
  return currentState.model;
}

export function getCurrentState(): OrchestratorState {
  return currentState;
}
