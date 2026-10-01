/**
 * The tracker, as the main process asks the server for it.
 *
 * The Work surface reads a project's queue and writes tickets, and none of that
 * can be done without the key — which never leaves this process — so the window
 * asks through here rather than speaking HTTP. This is the same shape `memory.ts`
 * and `usage.ts` have: a capability the main process owns, handed the key it needs
 * and the local facts only this side can answer.
 *
 * Two of the things it answers are about a *folder* rather than a project: a
 * workspace works one project, that link lives in the desktop's own database, and
 * a folder nobody has joined is a refusal with a sentence rather than an empty
 * queue. The rest is one call to the server and the server's own answer — its
 * refusals are shown in its own words, because it is the party that knows why a
 * blocker cannot be added or a ticket cannot be changed.
 */
import type {
  GlossaryEdit,
  GlossaryEntry,
  BreakdownResult,
  BreakdownSlice,
  GitConnection,
  GitConnectionCreated,
  GitConnectionInput,
  JoinRequest,
  ProjectSummary,
  Ticket,
  TicketComment,
  DecisionProposal,
  ProjectDecision,
  Repository,
  RepositoryInput,
  TicketPullRequest,
  TicketChange,
  TicketDraft,
  TicketQueue,
  TimelineEntry,
  Outcome,
  OutcomeProposal,
  MapProposal,
  WorkspaceSummary,
} from '../preload/bridge.ts';

/**
 * What the server answered: a body, a refusal in its own words, nobody signed in,
 * or nothing at all.
 *
 * The last three are apart on purpose. They are three different things for a
 * window to say, and only the first of them is about the request: a folder with no
 * project, a machine nobody is signed in on and a server that cannot be reached
 * all look like "no work here" if they are folded together, and none of them is.
 */
export type TrackerAnswer<T> =
  | { kind: 'ok'; body: T }
  | { kind: 'refused'; message: string }
  | { kind: 'signed-out' }
  | { kind: 'unavailable' };

/** The server's half of the tracker, as `auth/kira.ts` implements it. */
export interface TrackerWire {
  /** The signed-in person behind this key. */
  currentUser(key: string): Promise<TrackerAnswer<{ id: string }>>;
  /** The projects anyone signed in may work in. */
  projects(key: string): Promise<TrackerAnswer<ProjectSummary[]>>;
  /** Make a project, refused when its prefix is taken. */
  createProject(
    key: string,
    made: { name: string; prefix: string },
  ): Promise<TrackerAnswer<ProjectSummary>>;
  /** One project with its tickets and stored statuses. */
  queue(key: string, projectId: string): Promise<TrackerAnswer<TicketQueue>>;
  /** Project glossary entries, including immutable history for each term. */
  glossary?(key: string, projectId: string): Promise<TrackerAnswer<GlossaryEntry[]>>;
  /** Add or sharpen a term without a person approving each edit. */
  updateGlossary?(
    key: string,
    projectId: string,
    edit: GlossaryEdit,
  ): Promise<TrackerAnswer<GlossaryEntry>>;
  /** Restore the preceding version when the visible version is still current. */
  undoGlossary?(
    key: string,
    projectId: string,
    entryId: string,
    version: number,
    chatId: string,
  ): Promise<TrackerAnswer<GlossaryEntry>>;
  /** Approved project Decisions, when the server supports project knowledge. */
  decisions?(key: string, projectId: string): Promise<TrackerAnswer<ProjectDecision[]>>;
  /** Publish a Decision only when the person has approved it in the chat. */
  createDecision?(
    key: string,
    projectId: string,
    proposal: Omit<DecisionProposal, 'id' | 'chatId' | 'status' | 'decisionId'> & {
      sourceChatId: string;
    },
  ): Promise<TrackerAnswer<ProjectDecision>>;
  /** One ticket, by its human-readable name or id. */
  readTicket(key: string, ref: string): Promise<TrackerAnswer<Ticket>>;
  /** Link one author-owned Kira chat to a question, idempotently. */
  openQuestion?(key: string, ticketId: string, chatId: string): Promise<TrackerAnswer<Ticket>>;
  /** Record an autonomous research Outcome and close its ticket. */
  recordOutcome?(
    key: string,
    ticketId: string,
    outcome: {
      answer: string;
      sources: string[];
      decisionProposal?: OutcomeProposal['decisionProposal'];
    },
  ): Promise<TrackerAnswer<Outcome>>;
  /** Approve a question Outcome from its linked chat and close it atomically. */
  approveOutcome?(
    key: string,
    ticketId: string,
    outcome: {
      answer: string;
      sources: string[];
      sourceChatId: string;
      decisionProposal?: OutcomeProposal['decisionProposal'];
    },
  ): Promise<TrackerAnswer<Outcome>>;
  /** Publish an approved map and its question/research children atomically. */
  createMap?(
    key: string,
    projectId: string,
    proposal: Omit<MapProposal, 'id' | 'chatId' | 'status' | 'ticketId'> & {
      sourceChatId: string;
    },
  ): Promise<TrackerAnswer<Ticket>>;
  /** Publish a map's approved destination spec and close the map atomically. */
  approveDestinationSpec?(
    key: string,
    mapTicketId: string,
    draft: TicketDraft,
  ): Promise<TrackerAnswer<Ticket>>;
  /** Create a ticket in a project. */
  writeTicket(key: string, projectId: string, draft: TicketDraft): Promise<TrackerAnswer<Ticket>>;
  /** Update a ticket's fields and stored status. */
  changeTicket(key: string, ticketId: string, change: TicketChange): Promise<TrackerAnswer<Ticket>>;
  /** Name a ticket that gates this one. */
  gateTicket(key: string, ticketId: string, gatedBy: string): Promise<TrackerAnswer<Ticket>>;
  /** Take a gate off a ticket. */
  ungateTicket(key: string, ticketId: string, gatedBy: string): Promise<TrackerAnswer<Ticket>>;
  /** A ticket's comments and history as one timeline, oldest first. */
  timeline(key: string, ticketId: string, limit?: number): Promise<TrackerAnswer<TimelineEntry[]>>;
  /** Say something on a ticket, or reply to a comment on it. */
  comment(
    key: string,
    ticketId: string,
    body: string,
    parentId?: string,
    authorKind?: 'member' | 'kira',
  ): Promise<TrackerAnswer<TicketComment>>;
  /** A ticket's pull requests, newest first. */
  pullRequests(key: string, ticketId: string): Promise<TrackerAnswer<TicketPullRequest[]>>;
  /** A project's repositories. */
  repositories(key: string, projectId: string): Promise<TrackerAnswer<Repository[]>>;
  attachRepository(
    key: string,
    projectId: string,
    input: RepositoryInput,
  ): Promise<TrackerAnswer<Repository>>;
  /** Take a repository off a project. */
  detachRepository(key: string, projectId: string, id: string): Promise<TrackerAnswer<true>>;
  /** The Git hosts this server is connected to. */
  connections(key: string): Promise<TrackerAnswer<GitConnection[]>>;
  /** Connect a Git host; its webhook secret is answered once. */
  connectHost(key: string, input: GitConnectionInput): Promise<TrackerAnswer<GitConnectionCreated>>;
  /** Disconnect a Git host. */
  disconnectHost(key: string, id: string): Promise<TrackerAnswer<true>>;
  /** Publish proposed children and dependency gates in one server transaction. */
  publishBreakdown?(
    key: string,
    specTicketId: string,
    children: BreakdownSlice[],
  ): Promise<TrackerAnswer<BreakdownResult>>;
  /** Mark all draft children of a spec ready in one server transaction. */
  markBreakdownReady?(key: string, specTicketId: string): Promise<TrackerAnswer<BreakdownResult>>;
}

export interface Tracker {
  queue(workspaceId: string): Promise<TicketQueue>;
  /** Whether a checkout has a remote, or null when Git cannot answer. */
  checkoutHasRemote(folder: string): Promise<boolean | null>;
  /** Read the id of the signed-in person who owns this desktop key. */
  currentUserId(): Promise<string>;
  /** Read one ticket by its id or human-readable name. */
  readTicket(ref: string): Promise<Ticket>;
  openQuestion(workspaceId: string, ticketId: string, chatId: string): Promise<Ticket>;
  recordOutcome(
    ticketId: string,
    outcome: {
      answer: string;
      sources: string[];
      decisionProposal?: OutcomeProposal['decisionProposal'];
    },
  ): Promise<Outcome>;
  approveOutcome(
    workspaceId: string,
    ticketId: string,
    outcome: {
      answer: string;
      sources: string[];
      sourceChatId: string;
      decisionProposal?: OutcomeProposal['decisionProposal'];
    },
  ): Promise<Outcome>;
  glossary?(workspaceId: string): Promise<GlossaryEntry[]>;
  /** Add or sharpen a project term from a Kira chat. */
  updateGlossary?(workspaceId: string, edit: GlossaryEdit): Promise<GlossaryEntry>;
  /** Undo a visible project term change, guarded by its version. */
  undoGlossary?(
    workspaceId: string,
    entryId: string,
    version: number,
    chatId: string,
  ): Promise<GlossaryEntry>;
  /** Publish an approved map and its initial children. */
  createMap?(
    workspaceId: string,
    proposal: Omit<MapProposal, 'id' | 'chatId' | 'status' | 'ticketId'>,
    sourceChatId: string,
  ): Promise<Ticket>;
  /** Publish the final destination spec and close the map atomically. */
  approveDestinationSpec?(
    workspaceId: string,
    mapTicketId: string,
    draft: TicketDraft,
  ): Promise<Ticket>;
  decisions?(workspaceId: string): Promise<ProjectDecision[]>;
  approveDecision(
    workspaceId: string,
    proposal: Omit<DecisionProposal, 'id' | 'chatId' | 'status' | 'decisionId'>,
    sourceChatId: string,
  ): Promise<ProjectDecision>;
  write(workspaceId: string, draft: TicketDraft): Promise<Ticket>;
  change(ticketId: string, change: TicketChange): Promise<Ticket>;
  gate(ticketId: string, gatedBy: string): Promise<Ticket>;
  ungate(ticketId: string, gatedBy: string): Promise<Ticket>;
  /** Read a ticket's comments and history as one timeline, oldest first. */
  timeline(ticketId: string, limit?: number): Promise<TimelineEntry[]>;
  /** Say something on a ticket, or reply to a comment on it. */
  comment(
    ticketId: string,
    body: string,
    parentId?: string,
    authorKind?: 'member' | 'kira',
  ): Promise<TicketComment>;
  /** A ticket's pull requests, newest first. */
  pullRequests(ticketId: string): Promise<TicketPullRequest[]>;
  /** The repositories a project's work happens in. */
  repositories(projectId: string): Promise<Repository[]>;
  /** Attach a repository to a project. */
  attachRepository(projectId: string, input: RepositoryInput): Promise<Repository>;
  /** Take a repository off a project. */
  detachRepository(projectId: string, id: string): Promise<null>;
  /** The Git hosts this server is connected to. */
  gitConnections(): Promise<GitConnection[]>;
  /** Connect a Git host with a token. */
  connectGitHost(input: GitConnectionInput): Promise<GitConnectionCreated>;
  /** Disconnect a Git host. */
  disconnectGitHost(id: string): Promise<null>;
  publishBreakdown(specTicketId: string, children: BreakdownSlice[]): Promise<BreakdownResult>;
  markBreakdownReady(specTicketId: string): Promise<BreakdownResult>;
  projects(): Promise<ProjectSummary[]>;
  join(workspaceId: string, request: JoinRequest): Promise<WorkspaceSummary>;
}

/** A folder that works no project is not an error, but it is not a queue either. */
export const NO_PROJECT = 'This folder is not working a project yet.';
export const NOBODY_SIGNED_IN = 'Nobody is signed in to Kira.';
export const UNREACHABLE = 'Kira could not be reached.';

export function trackerFor({
  token,
  projectOf,
  joinLocally,
  wire,
  checkoutHasRemote = async () => null,
}: {
  /** The key this device holds, or null when nobody has signed in. */
  token: () => Promise<string | null>;
  /** The project a workspace works, or null when it works none. */
  projectOf: (workspaceId: string) => string | null;
  /** Remember that a workspace works a project, answering it as it stands after. */
  joinLocally: (workspaceId: string, projectId: string) => WorkspaceSummary | undefined;
  wire: TrackerWire;
  /** Read Git's local remote configuration; null fails closed for Needs review. */
  checkoutHasRemote?: (folder: string) => Promise<boolean | null>;
}): Tracker {
  /** The key, or the sentence a window shows when there is none. */
  async function key(): Promise<string> {
    const held = await token();
    if (held === null) throw new Error(NOBODY_SIGNED_IN);

    return held;
  }

  /** The project a workspace works, or the sentence a window shows when it works none. */
  function projectIn(workspaceId: string): string {
    const projectId = projectOf(workspaceId);
    if (projectId === null) throw new Error(NO_PROJECT);

    return projectId;
  }

  return {
    checkoutHasRemote,

    async queue(workspaceId) {
      const held = await key();
      const projectId = projectIn(workspaceId);

      return await asked(() => wire.queue(held, projectId));
    },

    async currentUserId() {
      const held = await key();
      return (await asked(() => wire.currentUser(held))).id;
    },

    async readTicket(ref) {
      const held = await key();

      return await asked(() => wire.readTicket(held, ref));
    },

    async openQuestion(workspaceId, ticketId, chatId) {
      if (wire.openQuestion === undefined) throw new Error('Question chats are unavailable.');
      const held = await key();
      void projectIn(workspaceId);
      return await asked(() => wire.openQuestion!(held, ticketId, chatId));
    },

    async recordOutcome(ticketId, value) {
      if (wire.recordOutcome === undefined) throw new Error('Research Outcomes are unavailable.');
      const held = await key();
      return await asked(() => wire.recordOutcome!(held, ticketId, value));
    },

    async approveOutcome(workspaceId, ticketId, value) {
      if (wire.approveOutcome === undefined) throw new Error('Question Outcomes are unavailable.');
      const held = await key();
      void projectIn(workspaceId);
      return await asked(() => wire.approveOutcome!(held, ticketId, value));
    },

    async glossary(workspaceId) {
      if (wire.glossary === undefined) return [];
      const held = await key();
      const projectId = projectIn(workspaceId);

      return await asked(() => wire.glossary!(held, projectId));
    },

    async decisions(workspaceId) {
      if (wire.decisions === undefined) return [];
      const held = await key();
      const projectId = projectIn(workspaceId);

      return await asked(() => wire.decisions!(held, projectId));
    },

    async approveDecision(workspaceId, proposal, sourceChatId) {
      if (wire.createDecision === undefined) throw new Error('Decision approval is unavailable.');
      const held = await key();
      const projectId = projectIn(workspaceId);

      return await asked(() =>
        wire.createDecision!(held, projectId, {
          ...proposal,
          sourceChatId,
        }),
      );
    },

    async updateGlossary(workspaceId, edit) {
      if (wire.updateGlossary === undefined) throw new Error('Glossary editing is unavailable.');
      const held = await key();
      const projectId = projectIn(workspaceId);

      return await asked(() => wire.updateGlossary!(held, projectId, edit));
    },

    async undoGlossary(workspaceId, entryId, version, chatId) {
      if (wire.undoGlossary === undefined) throw new Error('Glossary undo is unavailable.');
      const held = await key();
      const projectId = projectIn(workspaceId);

      return await asked(() => wire.undoGlossary!(held, projectId, entryId, version, chatId));
    },

    async createMap(workspaceId, proposal, sourceChatId) {
      if (wire.createMap === undefined) throw new Error('Map approval is unavailable.');
      const held = await key();
      const projectId = projectIn(workspaceId);
      return await asked(() => wire.createMap!(held, projectId, { ...proposal, sourceChatId }));
    },

    async approveDestinationSpec(workspaceId, mapTicketId, draft) {
      if (wire.approveDestinationSpec === undefined)
        throw new Error('Map destination approval is unavailable.');
      const held = await key();
      void projectIn(workspaceId);
      return await asked(() => wire.approveDestinationSpec!(held, mapTicketId, draft));
    },

    async write(workspaceId, draft) {
      const held = await key();
      const projectId = projectIn(workspaceId);

      return await asked(() => wire.writeTicket(held, projectId, draft));
    },

    async change(ticketId, change) {
      const held = await key();

      return await asked(() => wire.changeTicket(held, ticketId, change));
    },

    async gate(ticketId, gatedBy) {
      const held = await key();

      return await asked(() => wire.gateTicket(held, ticketId, gatedBy));
    },

    async ungate(ticketId, gatedBy) {
      const held = await key();

      return await asked(() => wire.ungateTicket(held, ticketId, gatedBy));
    },

    async timeline(ticketId, limit) {
      const held = await key();

      return await asked(() => wire.timeline(held, ticketId, limit));
    },

    async comment(ticketId, body, parentId, authorKind) {
      const held = await key();

      return await asked(() => wire.comment(held, ticketId, body, parentId, authorKind));
    },

    async repositories(projectId) {
      const held = await key();

      return await asked(() => wire.repositories(held, projectId));
    },

    async pullRequests(ticketId) {
      const held = await key();

      return await asked(() => wire.pullRequests(held, ticketId));
    },

    async attachRepository(projectId, input) {
      const held = await key();

      return await asked(() => wire.attachRepository(held, projectId, input));
    },

    async detachRepository(projectId, id) {
      const held = await key();

      await asked(() => wire.detachRepository(held, projectId, id));

      return null;
    },

    async gitConnections() {
      const held = await key();

      return await asked(() => wire.connections(held));
    },

    async connectGitHost(input) {
      const held = await key();

      return await asked(() => wire.connectHost(held, input));
    },

    async disconnectGitHost(id) {
      const held = await key();

      await asked(() => wire.disconnectHost(held, id));

      return null;
    },

    async publishBreakdown(specTicketId, children) {
      const held = await key();
      if (wire.publishBreakdown === undefined)
        throw new Error('Breakdown publication is unavailable.');

      return await asked(() => wire.publishBreakdown!(held, specTicketId, children));
    },

    async markBreakdownReady(specTicketId) {
      const held = await key();
      if (wire.markBreakdownReady === undefined)
        throw new Error('Breakdown readiness is unavailable.');

      return await asked(() => wire.markBreakdownReady!(held, specTicketId));
    },

    async projects() {
      const held = await key();

      return await asked(() => wire.projects(held));
    },

    async join(workspaceId, request) {
      const held = await key();

      // Joining a project that already exists asks the server nothing: the project
      // is a link this machine keeps, and the window was handed the list it chose
      // from. Making one is the case that needs the server, and its refusal — a
      // prefix another project holds — is what the person is shown.
      const projectId =
        request.kind === 'existing'
          ? request.projectId
          : (
              await asked(() =>
                wire.createProject(held, {
                  name: request.name,
                  prefix: request.prefix,
                }),
              )
            ).id;

      const joined = joinLocally(workspaceId, projectId);
      if (joined === undefined) throw new Error('That folder is no longer open.');

      return joined;
    },
  };
}

/** What the server answered, as a value, or a sentence saying why there is none. */
export async function asked<T>(call: () => Promise<TrackerAnswer<T>>): Promise<T> {
  const answer = await call();

  if (answer.kind === 'ok') return answer.body;
  if (answer.kind === 'signed-out') throw new Error(NOBODY_SIGNED_IN);
  if (answer.kind === 'unavailable') throw new Error(UNREACHABLE);

  throw new Error(answer.message);
}
