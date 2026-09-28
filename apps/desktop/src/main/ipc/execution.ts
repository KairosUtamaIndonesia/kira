import {
  EXECUTION_CHANNELS,
  type ExecutionCommandResult,
  type ExecutionProcessSnapshot,
  type Result,
} from '../../preload/bridge.ts';
import { envelope, isId } from './result.ts';

export { EXECUTION_CHANNELS };

export interface ExecutionDeps {
  command(ticketId: string, workspaceId: string, command: string): Promise<ExecutionCommandResult>;
  startDevServer(
    ticketId: string,
    workspaceId: string,
    command: string,
  ): Promise<ExecutionProcessSnapshot>;
  readDevServer(ticketId: string, workspaceId: string): Promise<ExecutionProcessSnapshot>;
  stopDevServer(ticketId: string, workspaceId: string): Promise<ExecutionProcessSnapshot>;
}

export interface ExecutionHandlers {
  command(
    ticketId: unknown,
    workspaceId: unknown,
    command: unknown,
  ): Promise<Result<ExecutionCommandResult>>;
  startDevServer(
    ticketId: unknown,
    workspaceId: unknown,
    command: unknown,
  ): Promise<Result<ExecutionProcessSnapshot>>;
  readDevServer(ticketId: unknown, workspaceId: unknown): Promise<Result<ExecutionProcessSnapshot>>;
  stopDevServer(ticketId: unknown, workspaceId: unknown): Promise<Result<ExecutionProcessSnapshot>>;
}

export function executionHandlers({
  command,
  startDevServer,
  readDevServer,
  stopDevServer,
}: ExecutionDeps): ExecutionHandlers {
  const validWorkspace = (ticketId: unknown, workspaceId: unknown): boolean =>
    isId(ticketId) && isId(workspaceId);
  return {
    command: (ticketId, workspaceId, input) => {
      if (!validWorkspace(ticketId, workspaceId)) {
        return Promise.resolve({
          ok: false,
          error: 'A command needs an issue and execution workspace.',
        });
      }
      if (typeof input !== 'string' || input.trim() === '') {
        return Promise.resolve({ ok: false, error: 'Enter a command to run.' });
      }
      if (input.length > 2000) {
        return Promise.resolve({ ok: false, error: 'Commands must be 2000 characters or fewer.' });
      }
      return envelope(() => command(ticketId as string, workspaceId as string, input));
    },
    startDevServer: (ticketId, workspaceId, input) => {
      if (!validWorkspace(ticketId, workspaceId)) {
        return Promise.resolve({
          ok: false,
          error: 'A development server needs an issue and execution workspace.',
        });
      }
      if (typeof input !== 'string' || input.trim() === '') {
        return Promise.resolve({
          ok: false,
          error: 'Enter a command to start the development server.',
        });
      }
      if (input.length > 2000) {
        return Promise.resolve({ ok: false, error: 'Commands must be 2000 characters or fewer.' });
      }
      return envelope(() => startDevServer(ticketId as string, workspaceId as string, input));
    },
    readDevServer: (ticketId, workspaceId) =>
      !validWorkspace(ticketId, workspaceId)
        ? Promise.resolve({
            ok: false,
            error: 'A process log needs an issue and execution workspace.',
          })
        : envelope(() => readDevServer(ticketId as string, workspaceId as string)),
    stopDevServer: (ticketId, workspaceId) =>
      !validWorkspace(ticketId, workspaceId)
        ? Promise.resolve({ ok: false, error: 'A process needs an issue and execution workspace.' })
        : envelope(() => stopDevServer(ticketId as string, workspaceId as string)),
  };
}
