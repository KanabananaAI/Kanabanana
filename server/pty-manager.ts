import * as pty from '@lydell/node-pty';
import { getParser, ParsedEvent } from './parsers/index.js';
import * as fs from 'fs';
import * as path from 'path';

type IPty = pty.IPty;

export interface PtyEvent {
  taskId: string;
  type: 'data' | 'parsed' | 'exit';
  data?: string;
  parsed?: ParsedEvent[];
  exitCode?: number;
  signal?: number;
}

export type PtyEventCallback = (event: PtyEvent) => void;

const MAX_OUTPUT_BUFFER = 64 * 1024; // 64KB per task

export class PtyManager {
  private sessions: Map<string, IPty> = new Map();
  private outputBuffers: Map<string, string> = new Map();
  private killedSessions: Set<string> = new Set(); // tracks explicitly-killed tasks
  private maxConcurrency: number;
  private eventCallback: PtyEventCallback;
  private sessionsDir?: string;
  private sessionStreams: Map<string, fs.WriteStream> = new Map();
  // Tracks tasks that had a session file BEFORE the current spawn — used to detect crash recovery
  private priorSessionFiles: Set<string> = new Set();

  constructor(eventCallback: PtyEventCallback, maxConcurrency: number = 20, sessionsDir?: string) {
    this.eventCallback = eventCallback;
    this.maxConcurrency = maxConcurrency;
    this.sessionsDir = sessionsDir;
  }

  private _closeStream(taskId: string): void {
    const stream = this.sessionStreams.get(taskId);
    if (stream) {
      stream.end();
      this.sessionStreams.delete(taskId);
    }
  }

  /**
   * Spawn a new PTY process for a task.
   */
  spawn(taskId: string, command: string, agentType: string = 'generic', cwd?: string, extraEnv?: Record<string, string>, cols?: number, rows?: number): boolean {
    // Check concurrency limit
    if (this.sessions.size >= this.maxConcurrency) {
      this.eventCallback({
        taskId,
        type: 'parsed',
        parsed: [{
          type: 'error',
          data: { message: `Concurrency limit reached (${this.maxConcurrency}). Cannot spawn new session.` },
        }],
      });
      return false;
    }

    // Kill existing session if one exists for this task
    if (this.sessions.has(taskId)) {
      this.kill(taskId);
    }

    const parser = getParser(agentType);
    const isWindows = process.platform === 'win32';

    // Determine shell and args
    let shell: string;
    let args: string[];

    if (isWindows) {
      shell = 'cmd.exe';
      args = ['/c', command];
    } else {
      shell = '/bin/bash';
      args = ['-c', command];
    }

    try {
      // Strip Claude Code env vars so child agents don't think they're nested
      const cleanEnv: { [key: string]: string } = {};
      for (const [k, v] of Object.entries(process.env)) {
        if (v !== undefined && !k.startsWith('CLAUDE')) {
          cleanEnv[k] = v;
        }
      }
      // Merge caller-supplied env vars (e.g. OPENAI_API_BASE for LM Studio)
      if (extraEnv) {
        Object.assign(cleanEnv, extraEnv);
      }

      const ptyProcess = pty.spawn(shell, args, {
        name: 'xterm-256color',
        cols: cols || 120,
        rows: rows || 30,
        cwd: cwd || process.cwd(),
        env: cleanEnv,
      });

      this.sessions.set(taskId, ptyProcess);
      this.outputBuffers.set(taskId, '');

      // Open session file stream for persistence (append mode — survives multiple spawns)
      if (this.sessionsDir) {
        this._closeStream(taskId); // close any leftover stream from a prior spawn
        const sessionFilePath = path.join(this.sessionsDir, `${taskId}.raw.txt`);
        // Track whether a session file existed BEFORE this spawn (crash recovery indicator)
        if (fs.existsSync(sessionFilePath)) {
          this.priorSessionFiles.add(taskId);
        } else {
          this.priorSessionFiles.delete(taskId);
        }
        const stream = fs.createWriteStream(sessionFilePath, { flags: 'a' });
        stream.on('error', (err) => console.error(`[kanaban:session] Write stream error for task=${taskId.slice(0, 8)}:`, err));
        this.sessionStreams.set(taskId, stream);
      }

      console.log(`[kanaban:pty] Spawned session for task=${taskId.slice(0, 8)} | pid=${ptyProcess.pid} | cmd=${shell} ${args.join(' ')} | cwd=${cwd || process.cwd()}`);

      // Handle data events
      ptyProcess.onData((data: string) => {
        // Buffer output for walkthrough
        const current = this.outputBuffers.get(taskId) || '';
        const updated = current + data;
        this.outputBuffers.set(taskId, updated.length > MAX_OUTPUT_BUFFER
          ? updated.slice(updated.length - MAX_OUTPUT_BUFFER)
          : updated);

        // Persist raw output to session file
        const stream = this.sessionStreams.get(taskId);
        if (stream) stream.write(data);

        // Emit raw data
        this.eventCallback({
          taskId,
          type: 'data',
          data,
        });

        // Parse and emit structured events
        const parsedEvents = parser.parse(data);
        if (parsedEvents.length > 0) {
          this.eventCallback({
            taskId,
            type: 'parsed',
            parsed: parsedEvents,
          });
        }
      });

      // Handle exit — guard against stale sessions (e.g. restart replaced this PTY)
      ptyProcess.onExit(({ exitCode, signal }: { exitCode: number; signal?: number }) => {
        if (this.sessions.get(taskId) !== ptyProcess) {
          // This session was replaced by a restart/respawn — ignore the exit
          console.log(`[kanaban:pty] Stale exit ignored for task=${taskId.slice(0, 8)} (exitCode=${exitCode}, signal=${signal})`);
          return;
        }
        const wasExplicitKill = this.killedSessions.has(taskId);
        this.killedSessions.delete(taskId);
        this.sessions.delete(taskId);
        this._closeStream(taskId); // flush and close session file on exit
        console.log(
          `[kanaban:pty] Session exited for task=${taskId.slice(0, 8)} | exitCode=${exitCode} | signal=${signal} | explicit=${wasExplicitKill}`
        );
        this.eventCallback({
          taskId,
          type: 'exit',
          exitCode: exitCode,
          signal: signal,
        });
      });

      return true;
    } catch (err) {
      this.eventCallback({
        taskId,
        type: 'parsed',
        parsed: [{
          type: 'error',
          data: { message: `Failed to spawn PTY: ${err}` },
        }],
      });
      return false;
    }
  }

  /**
   * Write data to a task's PTY stdin.
   * Automatically uses chunked writing for large inputs to prevent buffer overflow.
   */
  write(taskId: string, data: string): boolean {
    const session = this.sessions.get(taskId);
    if (!session) {
      return false;
    }

    // For large inputs, use chunked writing to prevent PTY buffer overflow
    if (data.length > 256) {
      this.writeChunked(taskId, data);
      return true;
    }

    try {
      session.write(data);
      return true;
    } catch (err) {
      console.error(`[kanaban:pty] Failed to write to task ${taskId.slice(0, 8)}:`, err);
      return false;
    }
  }

  /**
   * Write data to a task's PTY stdin in chunks with small delays.
   * Prevents PTY input buffer overflow for large inputs (e.g. voice dictation).
   */
  writeChunked(taskId: string, data: string, chunkSize: number = 256, delayMs: number = 10): Promise<boolean> {
    const session = this.sessions.get(taskId);
    if (!session) return Promise.resolve(false);

    if (data.length <= chunkSize) {
      session.write(data);
      return Promise.resolve(true);
    }

    return new Promise((resolve) => {
      let offset = 0;
      const writeNext = () => {
        if (offset >= data.length || !this.sessions.has(taskId)) {
          resolve(offset >= data.length);
          return;
        }
        const chunk = data.slice(offset, offset + chunkSize);
        try {
          session.write(chunk);
        } catch (err) {
          console.error(`[kanaban:pty] writeChunked error on task ${taskId.slice(0, 8)} (PTY may be dead):`, err);
          resolve(false);
          return;
        }
        offset += chunkSize;
        if (offset < data.length) {
          setTimeout(writeNext, delayMs);
        } else {
          resolve(true);
        }
      };
      writeNext();
    });
  }

  /**
   * Kill a task's PTY process.
   */
  kill(taskId: string): boolean {
    const session = this.sessions.get(taskId);
    if (!session) {
      return false;
    }
    try {
      session.kill();
    } catch (err) {
      console.error(`[kanaban:pty] Non-fatal error while killing task ${taskId.slice(0, 8)}:`, err);
    }
    this.sessions.delete(taskId);
    this._closeStream(taskId); // flush and close session file
    return true;
  }

  /**
   * Resize a task's PTY.
   */
  resize(taskId: string, cols: number, rows: number): boolean {
    const session = this.sessions.get(taskId);
    if (!session) {
      return false;
    }
    try {
      session.resize(cols, rows);
      return true;
    } catch {
      return false;
    }
  }

  /**
   * Get the number of active PTY sessions.
   */
  getActiveCount(): number {
    return this.sessions.size;
  }

  /**
   * Check if a task has an active PTY session.
   */
  hasSession(taskId: string): boolean {
    return this.sessions.has(taskId);
  }

  /**
   * Get and clear the captured output buffer for a task.
   */
  drainOutput(taskId: string): string {
    const output = this.outputBuffers.get(taskId) || '';
    this.outputBuffers.delete(taskId);
    return output;
  }

  /**
   * Get the output buffer for a task (non-destructive, for terminal replay).
   */
  getOutputBuffer(taskId: string): string {
    return this.outputBuffers.get(taskId) || '';
  }

  /**
   * Read the persisted session file for a task (for replay after server restart).
   * Returns the file content (up to MAX_OUTPUT_BUFFER tail) or empty string if not found.
   */
  readSessionFile(taskId: string): string {
    if (!this.sessionsDir) return '';
    const filePath = path.join(this.sessionsDir, `${taskId}.raw.txt`);
    try {
      if (!fs.existsSync(filePath)) return '';
      const content = fs.readFileSync(filePath, 'utf-8');
      // Return only the tail to match buffer size constraints
      if (content.length > MAX_OUTPUT_BUFFER) {
        return content.slice(content.length - MAX_OUTPUT_BUFFER);
      }
      return content;
    } catch (err) {
      console.error(`[kanaban:session] Failed to read session file for task=${taskId.slice(0, 8)}:`, err);
      return '';
    }
  }

  /**
   * Prepend data to a task's output buffer (e.g. to preserve previous session output
   * when verify spawns a new PTY but should continue in the same terminal visually).
   */
  prependOutputBuffer(taskId: string, data: string): void {
    const current = this.outputBuffers.get(taskId) || '';
    const combined = data + current;
    this.outputBuffers.set(taskId, combined.length > MAX_OUTPUT_BUFFER
      ? combined.slice(combined.length - MAX_OUTPUT_BUFFER)
      : combined);
  }

  /**
   * Get the path to the persisted session file for a task, if it existed BEFORE the current spawn.
   * Returns null for first-time spawns or when session persistence is not configured.
   * Used to detect crash recovery — the file contains output from the previous session.
   */
  getSessionFilePath(taskId: string): string | null {
    if (!this.sessionsDir) return null;
    if (!this.priorSessionFiles.has(taskId)) return null;
    const filePath = path.join(this.sessionsDir, `${taskId}.raw.txt`);
    return fs.existsSync(filePath) ? filePath : null;
  }

  /**
   * Delete the persisted session file for a task (e.g. on task completion or deletion).
   * Closes any open write stream first to ensure the file is fully flushed.
   */
  deleteSessionFile(taskId: string): void {
    this._closeStream(taskId);
    this.priorSessionFiles.delete(taskId);
    if (!this.sessionsDir) return;
    const filePath = path.join(this.sessionsDir, `${taskId}.raw.txt`);
    try {
      if (fs.existsSync(filePath)) {
        fs.unlinkSync(filePath);
        console.log(`[kanaban:session] Deleted session file for task=${taskId.slice(0, 8)}`);
      }
    } catch (err) {
      console.error(`[kanaban:session] Failed to delete session file for task=${taskId.slice(0, 8)}:`, err);
    }
  }

  /**
   * Get all active session task IDs.
   */
  getActiveSessions(): string[] {
    return Array.from(this.sessions.keys());
  }

  /**
   * Kill all active sessions (for graceful shutdown).
   */
  killAll(): void {
    for (const [taskId] of this.sessions) {
      this.kill(taskId);
    }
    // Close any remaining streams (e.g. from sessions that already exited)
    for (const [taskId] of this.sessionStreams) {
      this._closeStream(taskId);
    }
  }
}
