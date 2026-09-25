/**
 * The Run channel's handler.
 *
 * Pressing Run is the one act the window asks for that spends money on work nobody is
 * watching, so the handler's job is to check that the window named a workspace and a
 * ticket and then to get out of the way: whether a ticket *can* be run is the server's
 * answer, and its own sentence is what reaches the person. Anything else here would be
 * this process deciding a rule it does not own.
 */
import {
  RUN_CHANNELS,
  type Result,
  type Ticket,
  type TicketRun,
  type TicketSaid,
} from '../../preload/bridge.ts';
import { envelope, isId } from './result.ts';

export { RUN_CHANNELS };

/** What the handler needs from the main process. */
export interface RunDeps {
  /** Press Run on a ticket in a workspace. */
  start(workspaceId: string, ticketId: string): Promise<TicketRun>;
  /** Start a same-ticket run to resolve an integration conflict. */
  resolve(workspaceId: string, ticketId: string, reason: string): Promise<TicketRun>;
  /** What was said while a run went on, oldest first. */
  transcript(ticketId: string, runId: string): Promise<TicketSaid[]>;
  /** Take over a claim whose machine stopped answering. */
  takeOver(ticketId: string): Promise<Ticket>;
  /** Let a claim go, so the ticket is free again. */
  release(ticketId: string): Promise<void>;
  /** Accept a run's proposal, or send it back. */
  judge(
    ticketId: string,
    runId: string,
    verdict: 'accepted' | 'sent-back',
    workspaceId?: string,
  ): Promise<TicketRun>;
}

export interface RunHandlers {
  start(workspaceId: unknown, ticketId: unknown): Promise<Result<TicketRun>>;
  resolve(workspaceId: unknown, ticketId: unknown, reason: unknown): Promise<Result<TicketRun>>;
  transcript(ticketId: unknown, runId: unknown): Promise<Result<TicketSaid[]>>;
  takeOver(ticketId: unknown): Promise<Result<Ticket>>;
  release(ticketId: unknown): Promise<Result<null>>;
  judge(
    ticketId: unknown,
    runId: unknown,
    verdict: unknown,
    workspaceId?: unknown,
  ): Promise<Result<TicketRun>>;
}

export function runHandlers({
  start,
  resolve,
  transcript,
  takeOver,
  release,
  judge,
}: RunDeps): RunHandlers {
  return {
    start: (workspaceId, ticketId) => {
      if (!isId(workspaceId)) {
        return Promise.resolve({ ok: false, error: 'A run happens in a workspace.' });
      }
      if (!isId(ticketId)) {
        return Promise.resolve({ ok: false, error: 'A run happens on a ticket.' });
      }

      return envelope(() => start(workspaceId, ticketId));
    },

    resolve: (workspaceId, ticketId, reason) => {
      if (!isId(workspaceId)) {
        return Promise.resolve({ ok: false, error: 'A run happens in a workspace.' });
      }
      if (!isId(ticketId)) {
        return Promise.resolve({ ok: false, error: 'A run happens on a ticket.' });
      }
      if (typeof reason !== 'string' || reason.trim() === '') {
        return Promise.resolve({ ok: false, error: 'A conflict needs a reason.' });
      }

      return envelope(() => resolve(workspaceId, ticketId, reason));
    },

    transcript: (ticketId, runId) => {
      if (!isId(ticketId)) {
        return Promise.resolve({ ok: false, error: 'A transcript is of a ticket.' });
      }
      if (!isId(runId)) {
        return Promise.resolve({ ok: false, error: 'A transcript is of a run.' });
      }

      return envelope(() => transcript(ticketId, runId));
    },

    takeOver: (ticketId) => {
      if (!isId(ticketId)) {
        return Promise.resolve({ ok: false, error: 'A claim is on a ticket.' });
      }

      return envelope(() => takeOver(ticketId));
    },

    release: (ticketId) => {
      if (!isId(ticketId)) {
        return Promise.resolve({ ok: false, error: 'A claim is on a ticket.' });
      }

      return envelope(async () => {
        await release(ticketId);

        return null;
      });
    },

    judge: (ticketId, runId, verdict, workspaceId) => {
      if (!isId(ticketId)) {
        return Promise.resolve({ ok: false, error: 'A verdict is on a ticket.' });
      }
      if (!isId(runId)) {
        return Promise.resolve({ ok: false, error: 'A verdict is on a run.' });
      }
      // Checked here rather than sent on: the server refuses both of these in its own
      // words, but a window that could send anything would be sending a string where a
      // verdict belongs, and there are exactly two.
      if (workspaceId !== undefined && !isId(workspaceId)) {
        return Promise.resolve({ ok: false, error: 'A run happens in a workspace.' });
      }
      if (verdict !== 'accepted' && verdict !== 'sent-back') {
        return Promise.resolve({ ok: false, error: 'A verdict is accepted or sent back.' });
      }

      return envelope(() => judge(ticketId, runId, verdict, workspaceId));
    },
  };
}
