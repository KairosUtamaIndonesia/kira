/**
 * The workspace channels' handlers.
 *
 * Only the main process can open a folder picker, so the choosing is handed in
 * rather than done here: these handlers stay free of electron — like the chat
 * ones — and can be exercised with a chooser that answers whatever a case needs,
 * including the one that matters most, which is closing the picker without
 * choosing.
 *
 * Two of these reach the server, and the server's side is handed in as well:
 * listing the projects a folder could join, and joining one. What cannot be
 * reached is answered by throwing, and the envelope turns that into the message
 * the window shows — so the difference between "nobody is signed in", "the server
 * cannot be reached" and "that prefix is taken" is decided in one place, in the
 * main process, where the key is.
 *
 * Everything crossing this seam is Foundry's vocabulary: a workspace is a folder
 * and the project it works, and no path handling or database row reaches the
 * renderer.
 */
import {
  WORKSPACE_CHANNELS,
  type JoinRequest,
  type ProjectSummary,
  type Result,
  type WorkspaceSummary,
} from '../../preload/bridge.ts';
import { envelope, isId, withId } from './result.ts';

export { WORKSPACE_CHANNELS };

/** What the handlers need from the main process. */
export interface WorkspaceDeps {
  /** Ask for a folder, answering null when the picker was closed without choosing. */
  chooseFolder(): Promise<string | null>;
  /** Remember the folder as a workspace, and describe it as the sidebar draws it. */
  remember(folder: string): WorkspaceSummary;
  /** Forget a workspace, leaving its chats and their folder alone. */
  forget(id: string): Promise<void>;
  /** The projects the server holds, or a throw saying why it could not be asked. */
  projects(): Promise<ProjectSummary[]>;
  /** Join a workspace to a project, answering it as it stands afterwards. */
  join(workspaceId: string, request: JoinRequest): Promise<WorkspaceSummary>;
}

export interface WorkspaceHandlers {
  add(): Promise<Result<WorkspaceSummary | null>>;
  remove(id: unknown): Promise<Result<null>>;
  projects(): Promise<Result<ProjectSummary[]>>;
  join(workspaceId: unknown, request: unknown): Promise<Result<WorkspaceSummary>>;
}

export function workspaceHandlers({
  chooseFolder,
  remember,
  forget,
  projects,
  join,
}: WorkspaceDeps): WorkspaceHandlers {
  return {
    // Closing the picker is an answer, not a failure: nothing was chosen, and
    // the window should show no workspace rather than an error about one.
    add: () =>
      envelope(async () => {
        const folder = await chooseFolder();

        return folder === null ? null : remember(folder);
      }),

    remove: (id) =>
      withId(id, 'A workspace needs an id to be removed.', async (chosen) => {
        await forget(chosen);
      }),

    projects: () => envelope(() => projects()),

    join: (workspaceId, request) => {
      if (!isId(workspaceId)) {
        return Promise.resolve({ ok: false, error: 'A workspace needs an id to be joined.' });
      }

      const asked = joinRequestIn(request);
      if (asked === null) {
        return Promise.resolve({ ok: false, error: 'That is not a project to join.' });
      }

      return envelope(() => join(workspaceId, asked));
    },
  };
}

/**
 * What the renderer asked to join, or null when it is not a join at all.
 *
 * The window is an input to be checked rather than a caller to be believed
 * (./result.ts). A join names a project the server holds, or asks for one to be
 * made — and a project being made is a name and a prefix, both non-empty, because
 * a request that names neither is not one the server could answer.
 */
function joinRequestIn(value: unknown): JoinRequest | null {
  if (typeof value !== 'object' || value === null) return null;

  const held = value as { kind?: unknown; projectId?: unknown; name?: unknown; prefix?: unknown };

  if (held.kind === 'existing') {
    return isId(held.projectId) ? { kind: 'existing', projectId: held.projectId } : null;
  }

  if (held.kind === 'new') {
    if (typeof held.name !== 'string' || held.name.trim() === '') return null;
    if (typeof held.prefix !== 'string' || held.prefix.trim() === '') return null;

    return { kind: 'new', name: held.name, prefix: held.prefix };
  }

  return null;
}
