import { spawn, type ChildProcess } from 'node:child_process';
import { isIP } from 'node:net';
import type { ExecutionProcessEvent, ExecutionProcessSnapshot } from '../../preload/bridge.ts';

interface HeldProcess {
  workspaceId: string;
  child: ChildProcess;
  output: string;
  previewUrl: string | null;
  exitCode: number | null;
  stopped: boolean;
}

const MAX_LOG_LENGTH = 100_000;

/** Owns the dev-server children for this desktop process, one per execution workspace. */
export class ExecutionDevServers {
  private readonly held = new Map<string, HeldProcess>();

  constructor(private readonly changed: (event: ExecutionProcessEvent) => void = () => {}) {}

  start(workspaceId: string, checkout: string, command: string): ExecutionProcessSnapshot {
    const current = this.held.get(workspaceId);
    if (current?.child.exitCode === null && current.child.pid !== undefined) {
      throw new Error('A development server is already running in this execution workspace.');
    }

    const child = spawn(command, [], {
      cwd: checkout,
      shell: true,
      detached: process.platform !== 'win32',
      stdio: 'pipe',
      windowsHide: true,
    });
    const held: HeldProcess = {
      workspaceId,
      child,
      output: '',
      previewUrl: null,
      exitCode: null,
      stopped: false,
    };
    this.held.set(workspaceId, held);

    child.stdout?.on('data', (chunk: Buffer | string) => this.append(held, chunk));
    child.stderr?.on('data', (chunk: Buffer | string) => this.append(held, chunk));
    child.once('error', (error) => {
      held.output = this.trim(`${held.output}\n${error.message}`);
      held.exitCode = 1;
      this.publish(workspaceId, held);
    });
    child.once('exit', (code) => {
      held.exitCode = code ?? 1;
      this.publish(workspaceId, held);
    });
    this.publish(workspaceId, held);
    return this.snapshot(held);
  }

  read(workspaceId: string): ExecutionProcessSnapshot {
    const held = this.held.get(workspaceId);
    if (held === undefined) return { running: false, output: '', previewUrl: null, exitCode: null };
    return this.snapshot(held);
  }

  stop(workspaceId: string): ExecutionProcessSnapshot {
    const held = this.held.get(workspaceId);
    if (held === undefined) return { running: false, output: '', previewUrl: null, exitCode: null };
    if (held.child.exitCode === null && held.child.pid !== undefined) {
      try {
        if (process.platform === 'win32') {
          const tree = spawn('taskkill', ['/pid', String(held.child.pid), '/t', '/f'], {
            windowsHide: true,
            stdio: 'ignore',
          });
          tree.once('error', () => held.child.kill('SIGTERM'));
        } else {
          process.kill(-held.child.pid, 'SIGTERM');
        }
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== 'ESRCH') throw error;
      }
      held.stopped = true;
      this.publish(workspaceId, held);
    }
    return this.snapshot(held);
  }

  stopAll(): void {
    for (const [workspaceId] of this.held) this.stop(workspaceId);
  }

  private append(held: HeldProcess, chunk: Buffer | string): void {
    const text = chunk.toString();
    held.output = this.trim(held.output + text);
    held.previewUrl ??= previewUrlIn(held.output);
    this.publish(held.workspaceId, held);
  }

  private trim(output: string): string {
    return output.length > MAX_LOG_LENGTH ? output.slice(-MAX_LOG_LENGTH) : output;
  }

  private snapshot(held: HeldProcess): ExecutionProcessSnapshot {
    return {
      running: !held.stopped && held.child.exitCode === null && held.child.pid !== undefined,
      output: held.output,
      previewUrl: held.previewUrl,
      exitCode: held.exitCode,
    };
  }

  private publish(workspaceId: string, held: HeldProcess): void {
    this.changed({ workspaceId, ...this.snapshot(held) });
  }
}

/** Only offer links and embeds to loopback hosts printed by the local dev server. */
function previewUrlIn(output: string): string | null {
  const urls = output.match(/https?:\/\/[^\s"'<>]+/g) ?? [];
  for (const candidate of urls) {
    try {
      const url = new URL(candidate.replace(/[),.;]+$/, ''));
      const host = url.hostname.replace(/^\[|\]$/g, '');
      if (host === 'localhost' || host === '127.0.0.1' || (isIP(host) === 6 && host === '::1')) {
        return url.toString();
      }
    } catch {
      // Output that only resembles a URL is just a log line, not a preview target.
    }
  }
  return null;
}
