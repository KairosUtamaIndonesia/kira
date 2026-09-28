import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import type { DeliveryAudit, DeliveryPath } from '../../preload/bridge.ts';
import type { Worktrees } from '../workspace/worktrees.ts';

const run = promisify(execFile);

export type { DeliveryAudit, DeliveryPath } from '../../preload/bridge.ts';

export interface DeliveryWorkspace {
  id: string;
  ticketId: string;
  repository: string;
  checkout: string;
  baseBranch: string;
  branch: string;
}

export interface PullRequests {
  create(input: {
    repository: string;
    baseBranch: string;
    branch: string;
    title: string;
    body: string;
  }): Promise<{ reference: string; url: string } | { refused: string }>;
  merge(input: {
    repository: string;
    branch: string;
  }): Promise<{ reference: string } | { refused: string }>;
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
      if (!(await worktrees.isClean(workspace.checkout))) {
        const audit: DeliveryAudit = {
          workspaceId: workspace.id,
          path: input.path,
          outcome: 'refused',
          reference: null,
          details: 'The execution workspace has uncommitted changes. Commit them before delivery.',
        };
        await recorder.record(audit);
        return audit;
      }

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

      if (input.path === 'merge-pull-request') {
        const merged = await pullRequests.merge({
          repository: workspace.repository,
          branch: workspace.branch,
        });
        const audit: DeliveryAudit =
          'refused' in merged
            ? {
                workspaceId: workspace.id,
                path: input.path,
                outcome: 'refused',
                reference: null,
                details: merged.refused,
              }
            : {
                workspaceId: workspace.id,
                path: input.path,
                outcome: 'delivered',
                reference: merged.reference,
              };
        await recorder.record(audit);
        return audit;
      }

      const merged = await worktrees.mergeLocal(
        workspace.repository,
        workspace.baseBranch,
        workspace.branch,
      );
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
        await run('git', ['push', '--set-upstream', 'origin', branch], {
          encoding: 'utf8',
          cwd: repository,
        });
        const result = await run(
          'gh',
          [
            'pr',
            'create',
            '--base',
            baseBranch,
            '--head',
            branch,
            '--title',
            title,
            '--body',
            body,
          ],
          {
            encoding: 'utf8',
            cwd: repository,
          },
        );
        const url = result.stdout.trim().split(/\s+/).at(-1);
        if (url === undefined || url === '')
          return { refused: 'GitHub did not return a pull request URL.' };
        return { reference: url, url };
      } catch (error) {
        return { refused: String(error) };
      }
    },
    async merge({ repository, branch }) {
      try {
        const result = await run('gh', ['pr', 'merge', branch, '--merge'], {
          encoding: 'utf8',
          cwd: repository,
        });
        return { reference: result.stdout.trim() || branch };
      } catch (error) {
        return { refused: String(error) };
      }
    },
  };
}
