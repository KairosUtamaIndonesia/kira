import * as pty from 'node-pty';
import { createHash } from 'node:crypto';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import type { ExecutionTerminalEvent, ExecutionTerminalSnapshot } from '../../preload/bridge.ts';

interface HeldTerminal {
  process: pty.IPty;
  workspaceId: string;
  output: string;
  sequence: number;
  exitCode: number | null;
  stopped: boolean;
  persistTimer: NodeJS.Timeout | null;
}

const MAX_OUTPUT_LENGTH = 100_000;

/** Owns one interactive shell per execution workspace and keeps bounded scrollback on disk. */
export class ExecutionTerminals {
  private readonly held = new Map<string, HeldTerminal>();
  private readonly changed: (event: ExecutionTerminalEvent) => void;
  private readonly logDirectory: string;

  constructor(changed: (event: ExecutionTerminalEvent) => void, logDirectory: string) {
    this.changed = changed;
    this.logDirectory = logDirectory;
    mkdirSync(logDirectory, { recursive: true });
  }

  start(
    workspaceId: string,
    checkout: string,
    shell?: string,
    shellArgs?: string[],
  ): ExecutionTerminalSnapshot {
    const current = this.held.get(workspaceId);
    if (current !== undefined && !current.stopped) {
      throw new Error('A terminal is already running in this execution workspace.');
    }

    const windows = process.platform === 'win32';
    const file =
      shell ??
      (windows ? (process.env.ComSpec ?? 'powershell.exe') : (process.env.SHELL ?? '/bin/sh'));
    const args = shellArgs ?? (!windows && process.env.SHELL !== undefined ? ['-l'] : []);
    const child = pty.spawn(file, args, {
      name: 'xterm-256color',
      cols: 80,
      rows: 24,
      cwd: checkout,
      env: Object.fromEntries(
        Object.entries(process.env).filter(
          (entry): entry is [string, string] => entry[1] !== undefined,
        ),
      ),
    });
    const held: HeldTerminal = {
      process: child,
      workspaceId,
      output: current?.output ?? this.readLog(workspaceId),
      sequence: current?.sequence ?? 0,
      exitCode: null,
      stopped: false,
      persistTimer: null,
    };
    this.held.set(workspaceId, held);
    child.onData((data) => {
      held.output = this.trim(held.output + data);
      held.sequence += 1;
      this.schedulePersistence(held);
      this.publish(held, data);
    });
    child.onExit(({ exitCode }) => {
      held.exitCode = exitCode;
      held.stopped = true;
      held.sequence += 1;
      this.persist(held);
      this.publish(held, '');
    });
    held.sequence += 1;
    this.publish(held, '');
    return this.snapshot(held);
  }

  read(workspaceId: string): ExecutionTerminalSnapshot {
    const held = this.held.get(workspaceId);
    if (held !== undefined) return this.snapshot(held);
    return {
      running: false,
      output: this.readLog(workspaceId),
      exitCode: null,
      sequence: 0,
    };
  }

  write(workspaceId: string, data: string): void {
    const held = this.active(workspaceId);
    held.process.write(data);
  }

  resize(workspaceId: string, cols: number, rows: number): void {
    const held = this.active(workspaceId);
    held.process.resize(cols, rows);
  }

  stop(workspaceId: string): ExecutionTerminalSnapshot {
    const held = this.held.get(workspaceId);
    if (held === undefined || held.stopped) return this.read(workspaceId);
    held.stopped = true;
    held.sequence += 1;
    held.process.kill();
    this.persist(held);
    this.publish(held, '');
    return this.snapshot(held);
  }

  stopAll(): void {
    for (const [workspaceId] of this.held) this.stop(workspaceId);
  }

  private active(workspaceId: string): HeldTerminal {
    const held = this.held.get(workspaceId);
    if (held === undefined || held.stopped)
      throw new Error('The execution workspace terminal is not running.');
    return held;
  }

  private snapshot(held: HeldTerminal): ExecutionTerminalSnapshot {
    return {
      running: !held.stopped,
      output: held.output,
      exitCode: held.exitCode,
      sequence: held.sequence,
    };
  }

  private publish(held: HeldTerminal, data: string): void {
    this.changed({
      workspaceId: held.workspaceId,
      data,
      running: !held.stopped,
      exitCode: held.exitCode,
      sequence: held.sequence,
    });
  }

  private readLog(workspaceId: string): string {
    try {
      return this.trim(readFileSync(this.logPath(workspaceId), 'utf8'));
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return '';
      throw error;
    }
  }

  private schedulePersistence(held: HeldTerminal): void {
    if (held.persistTimer !== null) return;
    held.persistTimer = setTimeout(() => this.persist(held), 250);
    held.persistTimer.unref();
  }

  private persist(held: HeldTerminal): void {
    if (held.persistTimer !== null) clearTimeout(held.persistTimer);
    held.persistTimer = null;
    try {
      writeFileSync(this.logPath(held.workspaceId), held.output, 'utf8');
    } catch (error) {
      const message = `\r\nCould not save terminal scrollback: ${String(error)}\r\n`;
      held.output = this.trim(held.output + message);
      held.sequence += 1;
      this.publish(held, message);
    }
  }

  private logPath(workspaceId: string): string {
    const name = createHash('sha256').update(workspaceId).digest('hex');
    return join(this.logDirectory, `${name}.log`);
  }

  private trim(output: string): string {
    return output.length > MAX_OUTPUT_LENGTH ? output.slice(-MAX_OUTPUT_LENGTH) : output;
  }
}
