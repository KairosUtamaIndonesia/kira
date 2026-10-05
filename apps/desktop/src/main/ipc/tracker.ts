/**
 * The tracker channels' handlers.
 *
 * The Work surface's own seam: reading a project's queue, writing a ticket down,
 * changing what one says, and naming or taking off a gate. Every one of these is
 * a call to the server, so the handlers are thin on purpose — what they add is the
 * check that the window sent something a server could be asked, and the envelope
 * that turns a failure into a message.
 *
 * A refusal is not invented here. The server is the party that knows why it would
 * not take a ticket without acceptance criteria, or why a gate would close a
 * circle, and its own sentence is what reaches the person — "that could not be
 * saved" would leave them nothing to act on.
 */
import {
  TICKET_KINDS,
  TICKET_PRIORITIES,
  TICKET_STATUSES,
  TRACKER_CHANNELS,
  type GlossaryEntry,
  type LivePullRequest,
  type LivePullRequestDetail,
  type PullRequestState,
  type ProjectSkill,
  type ProjectSkillFile,
  type Repository,
  type RepositoryInput,
  type Result,
  type SkillChange,
  type SkillDraft,
  type Ticket,
  type TicketChange,
  type TicketComment,
  type TicketDraft,
  type TicketKind,
  type TicketPriority,
  type TicketPullRequest,
  type TicketQueue,
  type TimelineEntry,
} from '../../preload/bridge.ts';
import { envelope, isId } from './result.ts';

export { TRACKER_CHANNELS };

/** What the handlers need from the main process. */
export interface TrackerDeps {
  /** The queue of the project this workspace works, or a throw saying why not. */
  queue(workspaceId: string): Promise<TicketQueue>;
  /** Open or resume the author-owned linked question chat. */
  openQuestion?(workspaceId: string, ticketId: string): Promise<Ticket>;
  /** Write a ticket down, answering the ticket the server wrote. */
  write(workspaceId: string, draft: TicketDraft): Promise<Ticket>;
  /** Write what changed about a ticket, answering it as it stands afterwards. */
  change(ticketId: string, change: TicketChange): Promise<Ticket>;
  /** Name a ticket that gates this one. */
  gate(ticketId: string, gatedBy: string): Promise<Ticket>;
  /** Take a gate off a ticket. */
  ungate(ticketId: string, gatedBy: string): Promise<Ticket>;
  /** A ticket's comments and history as one timeline, oldest first. */
  timeline(ticketId: string, limit?: number): Promise<TimelineEntry[]>;
  /** Say something on a ticket, or reply to a comment on it. */
  comment(
    ticketId: string,
    body: string,
    parentId?: string,
    authorKind?: 'member' | 'kira',
  ): Promise<TicketComment>;
  /** Change the words of a comment you wrote. */
  editComment(commentId: string, body: string): Promise<TicketComment>;
  /** Remove a comment you wrote, keeping any replies it has. */
  deleteComment(commentId: string): Promise<null>;
  /** A ticket's pull requests, newest first. */
  pullRequests(ticketId: string): Promise<TicketPullRequest[]>;
  /** The chat's checkout repository's pull requests, read live from its host. */
  checkoutPullRequests(chatId: string, state: PullRequestState): Promise<LivePullRequest[]>;
  /** One pull request of the chat's checkout repository, opened for reading. */
  checkoutPullRequest(chatId: string, number: number): Promise<LivePullRequestDetail>;
  /** A project's repositories. */
  repositories(projectId: string): Promise<Repository[]>;
  /** Attach a repository to a project. */
  attachRepository(projectId: string, input: RepositoryInput): Promise<Repository>;
  /** Take a repository off a project. */
  detachRepository(projectId: string, id: string): Promise<null>;
  /** The methods a project works by. */
  skills(projectId: string): Promise<ProjectSkill[]>;
  /** Write a skill the project works by. */
  writeSkill(projectId: string, draft: SkillDraft): Promise<ProjectSkill>;
  /** Change a skill, or the files that travel with it. */
  changeSkill(projectId: string, skillId: string, change: SkillChange): Promise<ProjectSkill>;
  /** Delete a skill and the files that travel with it. */
  removeSkill(projectId: string, skillId: string): Promise<null>;
  /** Restore a glossary entry only if its visible version still matches. */
  undoGlossary?(
    workspaceId: string,
    entryId: string,
    version: number,
    chatId: string,
  ): Promise<GlossaryEntry>;
}

export interface TrackerHandlers {
  queue(workspaceId: unknown): Promise<Result<TicketQueue>>;
  write(workspaceId: unknown, draft: unknown): Promise<Result<Ticket>>;
  change(ticketId: unknown, change: unknown): Promise<Result<Ticket>>;
  gate(ticketId: unknown, gatedBy: unknown): Promise<Result<Ticket>>;
  ungate(ticketId: unknown, gatedBy: unknown): Promise<Result<Ticket>>;
  timeline(ticketId: unknown, limit: unknown): Promise<Result<TimelineEntry[]>>;
  comment(
    ticketId: unknown,
    body: unknown,
    parentId: unknown,
    authorKind: unknown,
  ): Promise<Result<TicketComment>>;
  pullRequests(ticketId: unknown): Promise<Result<TicketPullRequest[]>>;
  checkoutPullRequests(chatId: unknown, state: unknown): Promise<Result<LivePullRequest[]>>;
  checkoutPullRequest(chatId: unknown, number: unknown): Promise<Result<LivePullRequestDetail>>;
  editComment(commentId: unknown, body: unknown): Promise<Result<TicketComment>>;
  deleteComment(commentId: unknown): Promise<Result<null>>;
  repositories(projectId: unknown): Promise<Result<Repository[]>>;
  attachRepository(projectId: unknown, input: unknown): Promise<Result<Repository>>;
  detachRepository(projectId: unknown, id: unknown): Promise<Result<null>>;
  skills(projectId: unknown): Promise<Result<ProjectSkill[]>>;
  writeSkill(projectId: unknown, draft: unknown): Promise<Result<ProjectSkill>>;
  changeSkill(projectId: unknown, skillId: unknown, change: unknown): Promise<Result<ProjectSkill>>;
  removeSkill(projectId: unknown, skillId: unknown): Promise<Result<null>>;
  undoGlossary(
    workspaceId: unknown,
    entryId: unknown,
    version: unknown,
    chatId: unknown,
  ): Promise<Result<GlossaryEntry>>;
}

export interface QuestionTrackerHandlers {
  questionChat(workspaceId: unknown, ticketId: unknown): Promise<Result<Ticket>>;
}

export function trackerHandlers({
  queue,
  openQuestion,
  write,
  change,
  gate,
  ungate,
  timeline,
  comment,
  editComment,
  deleteComment,
  pullRequests,
  checkoutPullRequests,
  checkoutPullRequest,
  repositories,
  attachRepository,
  detachRepository,
  skills,
  writeSkill,
  changeSkill,
  removeSkill,
  undoGlossary,
}: TrackerDeps): TrackerHandlers & QuestionTrackerHandlers {
  return {
    queue: (workspaceId) => {
      if (!isId(workspaceId)) {
        return Promise.resolve({ ok: false, error: 'A queue is read for a workspace.' });
      }

      return envelope(() => queue(workspaceId));
    },

    questionChat: (workspaceId, ticketId) => {
      if (!isId(workspaceId)) {
        return Promise.resolve({ ok: false, error: 'A question chat starts in a workspace.' });
      }
      if (!isId(ticketId)) {
        return Promise.resolve({ ok: false, error: 'A question chat needs a ticket.' });
      }
      if (openQuestion === undefined) {
        return Promise.resolve({ ok: false, error: 'Question chats are unavailable.' });
      }
      return envelope(() => openQuestion(workspaceId, ticketId));
    },

    write: (workspaceId, draft) => {
      if (!isId(workspaceId)) {
        return Promise.resolve({ ok: false, error: 'A ticket is written in a workspace.' });
      }

      const asked = draftIn(draft);
      if (asked === null) {
        return Promise.resolve({ ok: false, error: 'That is not a ticket to write.' });
      }

      return envelope(() => write(workspaceId, asked));
    },

    change: (ticketId, patch) => {
      if (!isId(ticketId)) {
        return Promise.resolve({ ok: false, error: 'A ticket needs an id to be changed.' });
      }

      const asked = changeIn(patch);
      if (asked === null) {
        return Promise.resolve({ ok: false, error: 'That is not a change to a ticket.' });
      }

      return envelope(() => change(ticketId, asked));
    },

    gate: (ticketId, gatedBy) =>
      gateCall('A ticket needs an id to be gated.', ticketId, gatedBy, gate),

    ungate: (ticketId, gatedBy) =>
      gateCall('A ticket needs an id to be ungated.', ticketId, gatedBy, ungate),

    timeline: (ticketId, limit) => {
      if (!isId(ticketId)) {
        return Promise.resolve({ ok: false, error: 'A timeline is read for a ticket.' });
      }
      if (
        limit !== undefined &&
        limit !== null &&
        (typeof limit !== 'number' || !Number.isInteger(limit) || limit < 1)
      ) {
        return Promise.resolve({ ok: false, error: 'A timeline is read up to a whole number.' });
      }

      return envelope(() => timeline(ticketId, typeof limit === 'number' ? limit : undefined));
    },

    comment: (ticketId, body, parentId, authorKind) => {
      if (!isId(ticketId)) {
        return Promise.resolve({ ok: false, error: 'A comment is written on a ticket.' });
      }
      if (typeof body !== 'string' || body.trim() === '') {
        return Promise.resolve({ ok: false, error: 'A comment says something.' });
      }
      if (parentId !== undefined && parentId !== null && !isId(parentId)) {
        return Promise.resolve({ ok: false, error: 'A reply answers a comment.' });
      }
      if (
        authorKind !== undefined &&
        authorKind !== null &&
        authorKind !== 'member' &&
        authorKind !== 'kira'
      ) {
        return Promise.resolve({ ok: false, error: 'That is not an author.' });
      }

      return envelope(() =>
        comment(
          ticketId,
          body,
          typeof parentId === 'string' ? parentId : undefined,
          authorKind === 'kira' ? 'kira' : undefined,
        ),
      );
    },

    editComment: (commentId, body) => {
      if (!isId(commentId)) {
        return Promise.resolve({ ok: false, error: 'A comment needs an id to be changed.' });
      }
      if (typeof body !== 'string' || body.trim() === '') {
        return Promise.resolve({ ok: false, error: 'A comment says something.' });
      }

      return envelope(() => editComment(commentId, body));
    },

    deleteComment: (commentId) => {
      if (!isId(commentId)) {
        return Promise.resolve({ ok: false, error: 'A comment needs an id to be removed.' });
      }

      return envelope(() => deleteComment(commentId));
    },

    repositories: (projectId) => {
      if (!isId(projectId)) {
        return Promise.resolve({ ok: false, error: 'Repositories are read for a project.' });
      }

      return envelope(() => repositories(projectId));
    },

    pullRequests: (ticketId) => {
      if (!isId(ticketId)) {
        return Promise.resolve({ ok: false, error: 'Pull requests are read for a ticket.' });
      }

      return envelope(() => pullRequests(ticketId));
    },

    checkoutPullRequests: (chatId, state) => {
      if (!isId(chatId)) {
        return Promise.resolve({ ok: false, error: 'Pull requests are read for a chat.' });
      }
      if (state !== 'open' && state !== 'closed' && state !== 'all') {
        return Promise.resolve({ ok: false, error: 'Choose open, closed or all pull requests.' });
      }

      return envelope(() => checkoutPullRequests(chatId, state));
    },

    checkoutPullRequest: (chatId, number) => {
      if (!isId(chatId)) {
        return Promise.resolve({ ok: false, error: 'A pull request is read for a chat.' });
      }
      if (typeof number !== 'number' || !Number.isInteger(number) || number < 1) {
        return Promise.resolve({ ok: false, error: 'A pull request is named by its number.' });
      }

      return envelope(() => checkoutPullRequest(chatId, number));
    },

    attachRepository: (projectId, input) => {
      if (!isId(projectId)) {
        return Promise.resolve({ ok: false, error: 'A repository is attached to a project.' });
      }

      const asked = repositoryIn(input);
      if (asked === null) {
        return Promise.resolve({ ok: false, error: 'That is not a repository to attach.' });
      }

      return envelope(() => attachRepository(projectId, asked));
    },

    detachRepository: (projectId, id) => {
      if (!isId(projectId)) {
        return Promise.resolve({ ok: false, error: 'A repository is taken off a project.' });
      }
      if (!isId(id)) {
        return Promise.resolve({ ok: false, error: 'A repository needs an id to be removed.' });
      }

      return envelope(() => detachRepository(projectId, id));
    },

    skills: (projectId) => {
      if (!isId(projectId)) {
        return Promise.resolve({ ok: false, error: 'Skills are read for a project.' });
      }

      return envelope(() => skills(projectId));
    },

    writeSkill: (projectId, draft) => {
      if (!isId(projectId)) {
        return Promise.resolve({ ok: false, error: 'A skill is written in a project.' });
      }

      const asked = skillDraftIn(draft);
      if (asked === null) {
        return Promise.resolve({ ok: false, error: 'That is not a skill to write.' });
      }

      return envelope(() => writeSkill(projectId, asked));
    },

    changeSkill: (projectId, skillId, change) => {
      if (!isId(projectId)) {
        return Promise.resolve({ ok: false, error: 'A skill is changed in a project.' });
      }
      if (!isId(skillId)) {
        return Promise.resolve({ ok: false, error: 'A skill needs an id to be changed.' });
      }

      const asked = skillChangeIn(change);
      if (asked === null) {
        return Promise.resolve({ ok: false, error: 'That is not a change to a skill.' });
      }

      return envelope(() => changeSkill(projectId, skillId, asked));
    },

    removeSkill: (projectId, skillId) => {
      if (!isId(projectId)) {
        return Promise.resolve({ ok: false, error: 'A skill is removed from a project.' });
      }
      if (!isId(skillId)) {
        return Promise.resolve({ ok: false, error: 'A skill needs an id to be removed.' });
      }

      return envelope(() => removeSkill(projectId, skillId));
    },

    undoGlossary: (workspaceId, entryId, version, chatId) => {
      if (!isId(workspaceId)) {
        return Promise.resolve({ ok: false, error: 'A glossary is undone in a workspace.' });
      }
      if (!isId(entryId)) {
        return Promise.resolve({ ok: false, error: 'A glossary entry needs an id to be undone.' });
      }
      if (!Number.isInteger(version) || (version as number) < 1) {
        return Promise.resolve({ ok: false, error: 'A glossary Undo needs a version.' });
      }
      if (!isId(chatId)) {
        return Promise.resolve({ ok: false, error: 'A glossary change needs its chat.' });
      }

      if (undoGlossary === undefined) {
        return Promise.resolve({ ok: false, error: 'Glossary undo is unavailable.' });
      }

      return envelope(() => undoGlossary(workspaceId, entryId, version as number, chatId));
    },
  };
}

/**
 * A gate being named or taken off, checked the same way both times.
 *
 * What gates a ticket is named by whatever a person would say — `FND-12` as
 * readily as an id — so the reference is only checked for being something rather
 * than for being an id: which ticket it names is the server's to resolve, and a
 * name that names nothing is its refusal to give.
 */
function gateCall(
  complaint: string,
  ticketId: unknown,
  gatedBy: unknown,
  act: (ticketId: string, gatedBy: string) => Promise<Ticket>,
): Promise<Result<Ticket>> {
  if (!isId(ticketId)) return Promise.resolve({ ok: false, error: complaint });
  if (typeof gatedBy !== 'string' || gatedBy.trim() === '') {
    return Promise.resolve({ ok: false, error: 'A gate names a ticket.' });
  }

  return envelope(() => act(ticketId, gatedBy));
}

/** A ticket being written, or null when it is not one. */
function draftIn(value: unknown): TicketDraft | null {
  if (typeof value !== 'object' || value === null) return null;

  const held = value as {
    kind?: unknown;
    title?: unknown;
    body?: unknown;
    criteria?: unknown;
    sourceChatId?: unknown;
    status?: unknown;
    priority?: unknown;
    tags?: unknown;
  };

  if (!TICKET_KINDS.includes(held.kind as TicketKind)) return null;
  if (typeof held.title !== 'string' || typeof held.body !== 'string') return null;
  if (held.sourceChatId !== undefined && !isId(held.sourceChatId)) return null;
  if (held.status !== undefined && !TICKET_STATUSES.some((status) => status === held.status))
    return null;
  if (held.priority !== undefined && !TICKET_PRIORITIES.includes(held.priority as TicketPriority))
    return null;
  if (held.tags !== undefined && !Array.isArray(held.tags)) return null;
  if (Array.isArray(held.tags) && !held.tags.every((tag) => typeof tag === 'string')) return null;

  const criteria = criteriaIn(held.criteria);
  if (criteria === null) return null;

  return {
    kind: held.kind as TicketKind,
    title: held.title,
    body: held.body,
    criteria,
    ...(held.status === undefined ? {} : { status: held.status as TicketDraft['status'] }),
    ...(held.priority === undefined ? {} : { priority: held.priority as TicketDraft['priority'] }),
    ...(held.tags === undefined ? {} : { tags: held.tags as string[] }),
    ...(held.sourceChatId === undefined ? {} : { sourceChatId: held.sourceChatId }),
  };
}

/** A change to a ticket, or null when it is not one. */
function changeIn(value: unknown): TicketChange | null {
  if (typeof value !== 'object' || value === null) return null;

  const held = value as Record<string, unknown>;
  const change: TicketChange = {};

  if (held.title !== undefined) {
    if (typeof held.title !== 'string') return null;
    change.title = held.title;
  }
  if (held.body !== undefined) {
    if (typeof held.body !== 'string') return null;
    change.body = held.body;
  }
  if (held.criteria !== undefined) {
    const criteria = criteriaIn(held.criteria);
    if (criteria === null) return null;
    change.criteria = criteria;
  }
  if (held.status !== undefined) {
    if (!TICKET_STATUSES.some((status) => status === held.status)) return null;
    change.status = held.status as TicketChange['status'];
  }
  if (held.pullRequestUrl !== undefined) {
    if (
      held.pullRequestUrl !== null &&
      (typeof held.pullRequestUrl !== 'string' || !isHttpsUrl(held.pullRequestUrl))
    ) {
      return null;
    }
    change.pullRequestUrl = held.pullRequestUrl as string | null;
  }
  if (held.priority !== undefined) {
    if (!TICKET_PRIORITIES.includes(held.priority as TicketPriority)) return null;
    change.priority = held.priority as TicketPriority;
  }
  if (held.assigneeId !== undefined) {
    if (held.assigneeId !== null && !isId(held.assigneeId)) return null;
    change.assigneeId = held.assigneeId as string | null;
  }
  if (held.tags !== undefined) {
    if (!Array.isArray(held.tags) || !held.tags.every((tag) => typeof tag === 'string'))
      return null;
    change.tags = held.tags as string[];
  }
  if (held.rank !== undefined) {
    if (!Number.isInteger(held.rank)) return null;
    change.rank = held.rank as number;
  }
  return change;
}

function isHttpsUrl(value: string): boolean {
  try {
    const url = new URL(value);

    return url.protocol === 'https:' && url.username === '' && url.password === '';
  } catch {
    return false;
  }
}

/** Criteria as they arrive: every one a line of text, which is all a criterion is. */
function criteriaIn(value: unknown): string[] | null {
  if (!Array.isArray(value)) return null;
  if (!value.every((each) => typeof each === 'string')) return null;

  return value as string[];
}

/** The hosts a project's work may happen in. */
const REPOSITORY_PROVIDERS = ['github', 'forgejo', 'gitea', 'gitlab'];

/** A repository being attached, or null when it is not one. */
function skillDraftIn(value: unknown): SkillDraft | null {
  if (typeof value !== 'object' || value === null) return null;

  const held = value as { name?: unknown; description?: unknown; body?: unknown; files?: unknown };
  if (typeof held.name !== 'string' || held.name.trim() === '') return null;
  if (typeof held.description !== 'string' || held.description.trim() === '') return null;
  if (typeof held.body !== 'string') return null;

  const files = skillFilesIn(held.files);
  if (files === null) return null;

  return {
    name: held.name.trim(),
    description: held.description.trim(),
    body: held.body,
    ...(files === undefined ? {} : { files }),
  };
}

/** A change to a skill, or null when nothing about it could be changed. */
function skillChangeIn(value: unknown): SkillChange | null {
  if (typeof value !== 'object' || value === null) return null;

  const held = value as { name?: unknown; description?: unknown; body?: unknown; files?: unknown };
  const change: SkillChange = {};

  if (held.name !== undefined) {
    if (typeof held.name !== 'string' || held.name.trim() === '') return null;
    change.name = held.name.trim();
  }
  if (held.description !== undefined) {
    if (typeof held.description !== 'string' || held.description.trim() === '') return null;
    change.description = held.description.trim();
  }
  if (held.body !== undefined) {
    if (typeof held.body !== 'string') return null;
    change.body = held.body;
  }
  if (held.files !== undefined) {
    const files = skillFilesIn(held.files);
    if (files === null) return null;
    change.files = files;
  }

  return change;
}

/** Files as a skill carries them: undefined when none were sent, null when malformed. */
function skillFilesIn(value: unknown): ProjectSkillFile[] | undefined | null {
  if (value === undefined) return undefined;
  if (!Array.isArray(value)) return null;

  const files: ProjectSkillFile[] = [];
  for (const entry of value) {
    if (typeof entry !== 'object' || entry === null) return null;
    const held = entry as { path?: unknown; content?: unknown };
    if (typeof held.path !== 'string' || held.path.trim() === '') return null;
    if (typeof held.content !== 'string') return null;

    files.push({ path: held.path.trim(), content: held.content });
  }

  return files;
}

function repositoryIn(value: unknown): RepositoryInput | null {
  if (typeof value !== 'object' || value === null) return null;

  const held = value as {
    owner?: unknown;
    name?: unknown;
    provider?: unknown;
    defaultBranch?: unknown;
  };
  if (typeof held.owner !== 'string' || held.owner.trim() === '') return null;
  if (typeof held.name !== 'string' || held.name.trim() === '') return null;
  if (held.provider !== undefined && !REPOSITORY_PROVIDERS.includes(held.provider as string)) {
    return null;
  }
  if (held.defaultBranch !== undefined && typeof held.defaultBranch !== 'string') return null;

  return {
    owner: held.owner.trim(),
    name: held.name.trim(),
    ...(held.provider === undefined ? {} : { provider: held.provider as string }),
    ...(held.defaultBranch === undefined ? {} : { defaultBranch: held.defaultBranch as string }),
  };
}
