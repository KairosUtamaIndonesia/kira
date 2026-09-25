import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import type { Worktrees } from './workspace/worktrees.ts';

const run = promisify(execFile);

export type DeliveryPath = 'pull-request' | 'local-merge';
export type DeliveryOutcome = 'delivered' | 'refused';

export interface DeliveryWorkspace {
  id: string;
  ticketId: string;
  repository: string;
  baseBranch: string;
  branch: string;
}

export interface DeliveryAudit {
  workspaceId: string;
  path: DeliveryPath;
  outcome: DeliveryOutcome;
  reference: string | null;
  url?: string;
  details?: string;
}

export interface PullRequests {
  create(input: {
    repository: string;
    baseBranch: string;
    branch: string;
    title: string;
    body: string;
  }): Promise<{ reference: string; url: string } | { refused: string }>;
}

export interface DeliveryRecorder {
  record(audit: DeliveryAudit): Promise<void>;
}

export interface Deliveries {
  deliver(
    workspace: DeliveryWorkspace,
    input: { path: DeliveryPath; title: string; body: string },
  ): Promise<DeliveryAudit>;
}

/**
 * Delivers only an approved workspace branch. Local delivery delegates to the existing
 * detached-worktree merge, which aborts conflicts before either branch is changed. Every
 * refusal is recorded so a failed delivery never looks like a completed issue.
 */
export function deliveriesFor({
  worktrees,
  pullRequests,
  recorder,
}: {
  worktrees: Worktrees;
  pullRequests: PullRequests;
  recorder: DeliveryRecorder;
}): Deliveries {
  return {
    async deliver(workspace, input) {
      if (input.path === 'pull-request') {
        const made = await pullRequests.create({
          repository: workspace.repository,
          baseBranch: workspace.baseBranch,
          branch: workspace.branch,
          title: input.title,
          body: input.body,
        });
        const audit: DeliveryAudit =
          'refused' in made
            ? {
                workspaceId: workspace.id,
                path: input.path,
                outcome: 'refused',
                reference: null,
                details: made.refused,
              }
            : {
                workspaceId: workspace.id,
                path: input.path,
                outcome: 'delivered',
                reference: made.reference,
                url: made.url,
              };
        await recorder.record(audit);
        return audit;
      }

      const merged = await worktrees.mergeSpec(workspace.repository, workspace.baseBranch, workspace.branch);
      const audit: DeliveryAudit =
        merged.kind === 'merged'
          ? {
              workspaceId: workspace.id,
              path: input.path,
              outcome: 'delivered',
              reference: workspace.baseBranch,
            }
          : {
              workspaceId: workspace.id,
              path: input.path,
              outcome: 'refused',
              reference: null,
              details: merged.reason,
            };
      await recorder.record(audit);
      return audit;
    },
  };
}

/** The GitHub CLI adapter. It is injectable in tests and keeps provider details outside delivery policy. */
export function ghPullRequests(): PullRequests {
  return {
    async create({ repository, baseBranch, branch, title, body }) {
      try {
        const result = await run('gh', ['pr', 'create', '--repo', repository, '--base', baseBranch, '--head', branch, '--title', title, '--body', body], {
          encoding: 'utf8',
        });
        const url = result.stdout.trim().split(/\s+/).at(-1);
        if (url === undefined || url === '') return { refused: 'GitHub did not return a pull request URL.' };
        return { reference: url, url };
      } catch (error) {
        return { refused: String(error) };
      }
    },
  };
}
