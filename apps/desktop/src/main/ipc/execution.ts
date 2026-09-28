import {
  EXECUTION_CHANNELS,
  type ExecutionCommandResult,
  type Result,
} from '../../preload/bridge.ts';
import { envelope, isId } from './result.ts';

export { EXECUTION_CHANNELS };

export interface ExecutionDeps {
  command(ticketId: string, workspaceId: string, command: string): Promise<ExecutionCommandResult>;
}

export interface ExecutionHandlers {
  command(
    ticketId: unknown,
    workspaceId: unknown,
    command: unknown,
  ): Promise<Result<ExecutionCommandResult>>;
}

export function executionHandlers({ command }: ExecutionDeps): ExecutionHandlers {
  return {
    command: (ticketId, workspaceId, input) => {
      if (!isId(ticketId) || !isId(workspaceId)) {
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
      return envelope(() => command(ticketId, workspaceId, input));
    },
  };
}
