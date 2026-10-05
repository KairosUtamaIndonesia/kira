/**
 * The contract between the renderer, the preload bridge, and the main process.
 *
 * Both sides import from here — the preload for the channels it invokes, `ipc/`
 * for the same names and these types — so neither has to import the other. It
 * holds no electron and no pi, so the renderer tsconfig can include it as the
 * single source of truth for `window.kira`. Extract it into a shared package
 * once the server needs it too.
 */

/** How a tool ended, or that it has not ended yet. */
export type ToolStatus = 'running' | 'complete' | 'error';

/** What a chat lets Kira do: plan without workspace changes, or build directly. */
export type ChatMode = 'build' | 'spec';

/**
 * Where a proposal stands. Only a person moves one out of `proposed`, except that
 * a newer proposal of the same kind replaces it.
 */
export type ProposalStatus = 'proposed' | 'approved' | 'rejected' | 'replaced';

/** The part of a shaping proposal that is safe to render without parsing prose. */
export interface SpecProposal {
  id: string;
  chatId: string;
  problem: string;
  solution: string;
  stories: string[];
  /** Set only when this spec is the final child of an approved map. */
  mapTicketId?: string | null;
  /** A newer proposal supersedes an older one; only the latest can be approved. */
  status: ProposalStatus;
  ticketId: string | null;
}

/** A child that an approved map asks Kira to settle or research. */
export interface MapChildProposal {
  title: string;
  body: string;
  criteria: string[];
}

/** A non-binding map proposal; approval creates the map and its first children. */
export interface MapProposal {
  id: string;
  chatId: string;
  title: string;
  body: string;
  criteria: string[];
  questions: MapChildProposal[];
  research: MapChildProposal[];
  status: ProposalStatus;
  ticketId: string | null;
}

/** A non-binding project Decision proposal; only a person can publish it. */
export interface DecisionProposal {
  id: string;
  chatId: string;
  context: string;
  choice: string;
  rejectedOptions: string[];
  consequences: string;
  /** An approved Decision this proposal would supersede, if any. */
  supersedes: string | null;
  status: ProposalStatus;
  decisionId: string | null;
}

/** A non-binding answer proposal in a question's linked Kira chat. */
export interface OutcomeProposal {
  id: string;
  chatId: string;
  ticketId: string;
  answer: string;
  sources: string[];
  /** Durable knowledge may suggest a Decision, but never publishes one. */
  decisionProposal: Omit<DecisionProposal, 'id' | 'chatId' | 'status' | 'decisionId'> | null;
  status: ProposalStatus;
  outcomeId: string | null;
}

/** A durable, person-approved project Decision. */
export interface ProjectDecision {
  id: string;
  projectId: string;
  context: string;
  choice: string;
  rejectedOptions: string[];
  consequences: string;
  author: { id: string; name: string } | null;
  sourceChatId: string | null;
  supersededById: string | null;
  createdAt: string;
}

/** One thin vertical slice Kira proposes before a person publishes it. */
export interface BreakdownSlice {
  id: string;
  kind: TicketKind;
  title: string;
  body: string;
  criteria: string[];
  dependsOn: string[];
}

/** A breakdown proposal; approving it publishes its slices and marks them ready. */
export interface BreakdownProposal {
  id: string;
  chatId: string;
  slices: BreakdownSlice[];
  status: ProposalStatus;
  ticketIds: string[];
}

/** The answer to publishing or readying a breakdown. */
export interface BreakdownResult {
  spec: Ticket;
  children: Ticket[];
}

/**
 * One thing Kira proposed in a chat, waiting for a person's approval. Approving it
 * is the only way it reaches the tracker.
 */
export type Proposal =
  | ({ kind: 'spec' } & SpecProposal)
  | ({ kind: 'breakdown' } & BreakdownProposal & {
        /**
         * The server's refusal to mark the published slices ready, when it refused.
         * The slices stay published as drafts.
         */
        readyRefusal: string | null;
      })
  | ({ kind: 'decision' } & DecisionProposal)
  | ({ kind: 'outcome' } & OutcomeProposal)
  | ({ kind: 'map' } & MapProposal);

/** What one chat has proposed, oldest first. */
export interface ShapingState {
  proposals: Proposal[];
}

/** An image a tool returned, kept as MCP's base64 data until the renderer draws it. */
export interface ToolImage {
  data: string;
  mimeType: string;
}
/**
 * One thing Kira ran, and how it went.
 *
 * What a tool was *asked* is not here — a `write` carries a whole file — so this
 * is the call reduced to what a reader needs: which tool, what it acted on, how
 * it went, and how long it took.
 */
export interface ToolRun {
  name: string;
  /** The file, command or pattern it acted on, when its arguments named one. */
  target: string | null;
  status: ToolStatus;
  /** How long the tool took, in milliseconds. Nothing until it has ended. */
  durationMs: number | null;
  /**
   * What it came back with, as one block of text: the output it returned, or —
   * for a tool that changed a file — the change itself, because pi's receipt
   * ("replaced 1 block(s)") says nothing the row does not already. Nothing
   * until it has ended, and nothing when it had nothing to say.
   */
  output: string | null;
  /** Images returned by a tool, when its text output does not tell the whole story. */
  images?: ToolImage[];
  /**
   * Lines added and removed, for a tool that changed a file. Reported by pi
   * itself, so a tool that changes nothing counts nothing.
   */
  additions: number | null;
  deletions: number | null;
  /** Structured shaping data, when this was a proposal tool rather than a file tool. */
  proposal?: SpecProposal;
  /** Structured map data, when Kira proposed an oversized idea. */
  map?: MapProposal;
  /** Structured Decision data, when Kira proposed a project Decision. */
  decision?: DecisionProposal;
  /** Structured Outcome data, when Kira proposed an answer. */
  outcome?: OutcomeProposal;
  /** Structured breakdown data, when Kira proposes child tickets. */
  breakdownProposal?: BreakdownProposal;
}

/**
 * One piece of a message: words, or a step of her work.
 *
 * A step is what she thought before acting, and what she ran while acting on
 * it — thinking and the tools that followed it arrive as one part, because
 * that is how they read: "here is what led to these three things" is a single
 * step, and the window shows it as one collapsible group. Either half can be
 * empty (a step can be pure thought, or a tool run with nothing said before
 * it), but not both.
 */
export type ChatPart =
  | { type: 'text'; text: string }
  | { type: 'shell'; run: ShellCommandRun }
  | {
      type: 'work';
      /** What she thought before acting, if she said anything. */
      reasoning: string | null;
      /** How long the step took, start to its last tool's end. Null while any tool in it is still running, or when it is thought alone. */
      durationMs: number | null;
      calls: ToolRun[];
    }
  | {
      type: 'glossary';
      /** The server-owned change this faint note can undo. */
      change: GlossaryChangeNote;
    }
  | {
      type: 'skill';
      /** The server-owned write this faint note can take back. */
      change: SkillChangeNote;
    }
  | {
      /**
       * A boundary: everything above it was summarised into `summary`, and what
       * follows is what pi kept of the window.
       *
       * Carried on the message that comes *after* the boundary, because that is
       * where a reader meets it — the chat continues, and this says what it
       * continues from. Nothing about it is a message, so the window draws it
       * outside the bubble rather than as part of what was said.
       */
      type: 'compaction';
      /** When the summarising happened, so a reader can place it. */
      at: string;
      /**
       * How many messages of the chat now stand behind this boundary — the ones
       * the model no longer reads as they were written, counted across this
       * compaction and any before it.
       */
      messages: number;
      /**
       * The last thing the person asked before the cut, or null when the turns
       * discarded held nothing they asked. What the boundary leads with, so that a
       * reader can tell where it falls without opening it.
       *
       * Written down by the compaction rather than read back out of the summary:
       * by the time the window holds a summary the turns are gone, and the only
       * way back to a sentence would be to parse prose that was itself generated.
       */
      lastWords: string | null;
      /** The whole reconstruction, exactly as Kira wrote it. */
      reconstruction: string;
    };

/**
 * One message in a conversation, and where it sits.
 *
 * A conversation is a tree, not a list: every message names the one it follows,
 * so editing a message or asking again adds a sibling branch instead of erasing
 * what was there. `parentId` is null only for the first message of a chat.
 *
 * Tool calls are parts of the message they belong to, which is why there is no
 * `tool` role: what Kira ran is shown inside her reply, so that writes stay
 * attributable — the agent is not confined to its working folder
 * (docs/adr/0001-agent-filesystem-access.md).
 */
export interface ChatMessage {
  id: string;
  parentId: string | null;
  role: 'you' | 'kira' | 'subagent';
  parts: ChatPart[];
  /**
   * What a reply was written with, shown beside its actions: the model that
   * wrote it, when it finished, and how long the turn took. Absent on a question,
   * on a reply still being drawn, and on anything the main process cannot date —
   * the metadata line then says less rather than saying something wrong.
   */
  reply?: ReplyMeta;
}

/** What a reply was written with, as the line beside its actions reads it. */
export interface ReplyMeta {
  /** The model that wrote it, as the pool ids it, or null when the session named none. */
  model: string | null;
  /** When the reply was written, in epoch milliseconds. */
  at: number;
  /**
   * How long the turn took, from the question to this reply, or null when there
   * was no question above it to measure from.
   */
  durationMs: number | null;
}

/** A command the active Pi session can invoke, or a skill it can load. */
export interface ChatCommand {
  id: string;
  label: string;
  description: string;
  invocation: string;
  category: 'Commands' | 'Skills';
}

/** One user-run local command and the output Pi recorded for it. */
export interface ShellCommandRun {
  id: string;
  command: string;
  output: string;
  status: 'running' | 'complete' | 'cancelled' | 'error';
  exitCode: number | null;
  truncated: boolean;
  fullOutputPath: string | null;
}

/**
 * A conversation as a tree, plus the branch on screen.
 *
 * `headId` is the last message on the path from the first message to where the
 * agent currently stands. Those messages are the visible conversation; the rest
 * of the tree is the branches the reader can go back to.
 */
export interface ChatTranscript {
  messages: ChatMessage[];
  /**
   * A boundary that no message carries, because nothing has been said since it:
   * the chat was compacted and that is the last thing that happened.
   *
   * Every other boundary rides on the message it hands over to, since that is
   * where a reader meets it. With nothing following there is no such message,
   * and the boundary would be dropped — so a chat compacted a moment ago would
   * read as though it had not been.
   */
  trailing: ChatPart[];
  headId: string | null;
}

/**
 * What kind of thing Kira is holding.
 *
 * Kira's words for what the observer notices: the summary's headings, which
 * is also what a panel groups by.
 */
export type MemoryKind = 'goal' | 'changed' | 'read' | 'commit' | 'preference';

/** One thing Kira is holding, and when it was said. */
export interface ChatMemory {
  kind: MemoryKind;
  /** When it was said, as the entry it came from records it. */
  at: string;
  text: string;
}

/**
 * One thing Kira worked out, and how far she had read when she did.
 *
 * Deliberately not a kind of what she is holding: a conclusion is drawn from
 * what she was told rather than being one of the things she was told, so the
 * pane draws them apart and they carry how far they reach.
 */
export interface ChatConclusion {
  text: string;
  /**
   * The last turn the reflector had been shown when it drew this, or null when
   * that is not known. The turns behind a conclusion fall out of the ledger
   * without the conclusion stopping being true, which is why it outlives them.
   */
  coversThrough: number | null;
}

/** One row of the chat list: a stored conversation, and what it is called. */
export interface ChatSummary {
  id: string;
  title: string;
  /** Tickets worked in this chat, not composer context; access is project-scoped. */
  workTicketIds: string[];
  /** When the chat was created. */
  createdAt: string;
  /** When a message or other conversation content last changed. */
  updatedAt: string;
  /**
   * The workspace this chat is filed under, or null when it is filed nowhere.
   * The sidebar groups by this; the chat list itself is flat.
   */
  workspaceId: string | null;
}

/**
 * One workspace: a folder to work in, and what the sidebar calls it.
 *
 * The name is the folder's own name rather than a label stored beside it, so a
 * workspace is called what the place it works in is called and the two cannot
 * drift apart. `folder` is carried for the same reason a chat carries its
 * working folder: it is what the workspace *is*, and it is worth being able to
 * show.
 *
 * `projectId` is the *server's* project — the shared body of work this folder
 * works — and null is a folder nobody has joined yet. A workspace is where work
 * runs, not what work belongs to, so a folder with no project is an ordinary
 * state rather than a broken one (docs/adr/0010, GH #61).
 */
export interface WorkspaceSummary {
  id: string;
  name: string;
  folder: string;
  projectId: string | null;
}

/** A repository to clone, as the host that names it. */
export interface CloneRequest {
  provider: string;
  owner: string;
  name: string;
}

/**
 * One entry in a folder of a chat's workspace.
 *
 * The name is what the folder holds; the path is how the window names it
 * afterwards, and it is relative to the workspace rather than to anything on
 * disk — an absolute path never crosses this seam, in either direction.
 */
export interface WorkspaceEntry {
  name: string;
  /** The path from the workspace root, with `/` between the parts. */
  path: string;
  kind: 'folder' | 'file';
}

/** A small, allowlisted binary workspace file ready for an in-window preview. */
export interface WorkspaceAsset {
  dataUrl: string;
  mimeType: string;
  sizeBytes: number;
}

/**
 * One folder of a workspace, as the window receives it.
 *
 * `filtered` says whether git was the one who answered. A folder git cannot
 * answer for — one that is not a checkout, or a machine with no git to run — is
 * read as it is, and the workbench says so rather than drawing a filter that was
 * never applied (docs/adr/0014-the-workbench-asks-git-what-to-hide.md).
 *
 * `changed` names the paths git reports as changed under this folder, named from
 * the workspace root exactly as the entries are, so a row is marked by comparing
 * the two. It is null when git could not say, which is not the same as nothing
 * having changed: a folder that is not a checkout marks nothing and says why,
 * rather than marking nothing and being read as untouched.
 */
export interface FolderListing {
  entries: WorkspaceEntry[];
  filtered: boolean;
  changed: string[] | null;
}

/**
 * One path git reports as changed in a chat's checkout, named from the chat's
 * workspace exactly as the tree names it.
 */
export interface ChangedPath {
  path: string;
  /** git's own code for what happened: `M`, `A`, `D`, `R`, `?`, and so on. */
  status: string;
  /** The path it had, when git reports a rename or a copy. */
  from?: string;
  /** Lines added and removed, when git can count them: not for an untracked or binary file. */
  added?: number;
  removed?: number;
}

/** What git says about a chat's checkout, grouped the way a person reads it. */
export interface WorkspaceGitStatus {
  /** The branch HEAD is on, or null when HEAD is detached or there are no commits. */
  branch: string | null;
  /** Commits on the branch the upstream does not have, or null when it has no upstream. */
  ahead: number | null;
  /** Commits on the upstream the branch does not have, or null when it has no upstream. */
  behind: number | null;
  /** Tracked changes already in the index. */
  staged: ChangedPath[];
  /** Tracked changes not yet in the index. */
  unstaged: ChangedPath[];
  /** Paths git does not track. */
  untracked: ChangedPath[];
}

/** One commit of a checkout, as history draws it. */
export interface CommitSummary {
  hash: string;
  short: string;
  subject: string;
  author: string;
  date: string;
}

/** Which way a checkout is synced with its remote. */
export type GitSyncAction = 'fetch' | 'pull' | 'push';

/**
 * Words waiting to be read, and when Kira will read them.
 *
 * A chat is a session, and a session answers one thing at a time, so words
 * written while Kira is answering wait their turn instead of being refused.
 * Which turn that is, is the whole of the difference: `next` is read at her
 * next step — after the tool calls she is running now, before she decides what
 * to do with them — and `later` is read once the turn she is in has finished.
 * `next` is what steering means; `later` is what a follow-up means.
 */
export interface QueuedLine {
  lane: 'next' | 'later';
  text: string;
}

/**
 * The chat surface as the window draws it: the list of chats, which one is
 * current, and the current conversation's transcript.
 */
export interface ChatState {
  chats: ChatSummary[];
  /** Every workspace, in the order it was opened. A workspace outlives its chats. */
  workspaces: WorkspaceSummary[];
  currentId: string;
  /** Project tickets attached to the current chat, including a new draft. */
  /** Composer ticket attachments only; work history lives on each ChatSummary. */
  attachedTicketIds: string[];
  /** Whether the current chat is planning or can make workspace changes. */
  mode: ChatMode;
  /**
   * A new chat that has been started but not said anything in yet, or null when
   * there is none. It is a chat's id before the chat exists: nothing is stored
   * for it, and the chat list does not hold it, until the first message is sent.
   * `currentId` is this id while that new chat is the one on screen.
   */
  draftId: string | null;
  transcript: ChatTranscript;
  /**
   * What Kira is holding for the current chat, in the order it was first said.
   *
   * Read and never sent: this is the chat's memory of the work. Reading it
   * reaches the model not at all and costs nothing, which is the point of it
   * being a snapshot of the chat rather than something said in it.
   */
  memory: ChatMemory[];
  /**
   * What Kira has worked out for the current chat, in the order she worked it
   * out. Read and never sent, as her memory of the work is, and for the same
   * reason: looking at it is not a turn and costs nothing.
   */
  conclusions: ChatConclusion[];
  /**
   * The chats Kira is answering in right now. More than one can be: a chat is
   * its own session, so one keeps writing while the reader is in another.
   */
  running: string[];
  /** When each currently running chat's turn began, as epoch milliseconds. */
  runningSince: Record<string, number>;
  /** The reply being written in the current chat, or null when none is. */
  streaming: string | null;
  /** Words waiting to be read in the current chat, in the order she will read them. */
  queued: QueuedLine[];
  /**
   * The model the current chat runs on — the live session's, so it is what the
   * next message goes to rather than only what was written down. A chat being
   * composed has one too, once a model has been picked for it; null means there
   * is no chat on screen to run.
   */
  modelId: string | null;
  /**
   * What the current chat has used, or null when there is no session to have
   * used anything — a chat being composed, which has nothing working in it yet.
   */
  chatUsage: ChatUsage | null;
  /** The current chat's children, independent of its own transcript. */
  subagents?: SubagentSummary[];
  /** The ordinary-chat shaping state, when this chat has started shaping. */
  shaping?: ShapingState;
  /** A questionnaire Kira is waiting for this chat's person to answer. */
  questionnaire?: QuestionnaireRequest | null;
  /** Commands and skills supported by the current chat's active session. */
  commands?: ChatCommand[];
}

/** One choice Kira offers in a questionnaire. */
export interface QuestionnaireOption {
  label: string;
  description: string;
  preview?: string;
}

/** One question in a questionnaire. */
export interface QuestionnaireQuestion {
  question: string;
  header: string;
  options: QuestionnaireOption[];
  multiSelect?: boolean;
}

/** What Kira asked the person to answer, grouped in one tool call. */
export interface QuestionnaireParams {
  questions: QuestionnaireQuestion[];
}

/** A question and the answer the person gave. */
export interface QuestionnaireAnswer {
  questionIndex: number;
  question: string;
  kind: 'option' | 'custom' | 'multi';
  answer: string | null;
  selected?: string[];
  notes?: string;
  preview?: string;
}

/** The structured answer returned to Kira's tool call. */
export interface QuestionnaireResult {
  answers: QuestionnaireAnswer[];
  cancelled: boolean;
  globalNote?: string;
}

/** A live questionnaire request. It is transient and is not transcript history. */
export interface QuestionnaireRequest extends QuestionnaireParams {
  requestId: string;
  threadId: string;
}

/**
 * What the main process pushes while a turn runs.
 *
 * Every event names the chat it belongs to, because a turn can be running in a
 * chat the window is not showing — the chat on screen is where words are read,
 * not where they are written.
 *
 * `delta` carries text as it is written. `queued` carries the words waiting to
 * be read, which change without either of the other two moving: a line is taken
 * out when Kira reaches it, and steering her mid-turn reads one early.
 * `transcript` replaces the whole tree
 * with what the database holds, so the window cannot drift from the record no
 * matter what the model did in between.
 */
export type ChatEvent =
  | {
      type: 'delta';
      threadId: string;
      text: string;
      /**
       * Whether this text starts a reply. One turn can be several messages —
       * Kira writes, runs a tool, writes again — and each message is its own, so
       * the window begins a line instead of gluing them into one.
       */
      beginsReply: boolean;
    }
  | { type: 'transcript'; threadId: string; transcript: ChatTranscript }
  | { type: 'progress'; threadId: string; transcript: ChatTranscript; workTicketIds?: string[] }
  | { type: 'shell-command'; threadId: string; run: ShellCommandRun }
  /**
   * The first words of a turn in this chat: it is being written in.
   *
   * These words, rather than the sending of them, are when this is said, because
   * the window reads its whole state again on hearing it — and what it reads has
   * to hold the question already, or it would drop the message it is showing.
   */
  | { type: 'started'; threadId: string }
  | { type: 'queued'; threadId: string; queued: QueuedLine[] }
  | { type: 'shaping'; threadId: string; shaping: ShapingState }
  | ({ type: 'questionnaire-opened' } & QuestionnaireRequest)
  | { type: 'questionnaire-closed'; threadId: string; requestId: string }
  | { type: 'subagents'; threadId: string; subagents: SubagentSummary[]; settled?: boolean };

/**
 * What every IPC call answers with. A handler that throws would cross the
 * process boundary as an opaque Error, so failures come back as values.
 */
export type Result<T> = { ok: true; value: T } | { ok: false; error: string };

/** The channels both sides invoke. `event` flows main process to renderer. */
export const CHAT_CHANNELS = {
  load: 'chat:load',
  subagentTranscript: 'chat:subagent-transcript',
  subagentControl: 'chat:subagent-control',
  setMode: 'chat:set-mode',
  setAttachedTicketIds: 'chat:set-attached-ticket-ids',
  proposalApprove: 'chat:proposal-approve',
  proposalReject: 'chat:proposal-reject',
  outcomeSendBack: 'chat:outcome-send-back',
  shapeRetryReady: 'chat:shape-retry-ready',
  questionnaireAnswer: 'chat:questionnaire-answer',
  questionnaireCancel: 'chat:questionnaire-cancel',
  send: 'chat:send',
  runShell: 'chat:run-shell',
  cancelShell: 'chat:cancel-shell',
  stop: 'chat:stop',
  compact: 'chat:compact',
  queue: 'chat:queue',
  unqueue: 'chat:unqueue',
  start: 'chat:start',
  open: 'chat:open',
  archive: 'chat:archive',
  restore: 'chat:restore',
  delete: 'chat:delete',
  file: 'chat:file',
  branch: 'chat:branch',
  edit: 'chat:edit',
  fork: 'chat:fork',
  event: 'chat:event',
} as const;

/**
 * The workspace channels. Separate from the chat ones because a workspace is not
 * a chat: it is a folder, and it is opened rather than said.
 *
 * `projects` and `join` are the server's side of opening a folder: a workspace
 * that works no project is offered the ones the server holds, or the making of a
 * new one, and the answer is remembered with the folder. The window reaches the
 * server through these rather than speaking HTTP itself, so the key stays in the
 * main process where it is kept.
 */
export const WORKSPACE_CHANNELS = {
  add: 'workspace:add',
  clone: 'workspace:clone',
  remove: 'workspace:remove',
  projects: 'workspace:projects',
  join: 'workspace:join',
} as const;

/**
 * The tracker channels: the work a project holds, as the Work surface reads and
 * writes it.
 *
 * The queue carries the stored ticket statuses; blockers add a separate marker.
 * Each write is checked at this seam before it is sent to the server.
 */
export const TRACKER_CHANNELS = {
  queue: 'tracker:queue',
  questionChat: 'tracker:question-chat',
  write: 'tracker:write',
  change: 'tracker:change',
  gate: 'tracker:gate',
  ungate: 'tracker:ungate',
  timeline: 'tracker:timeline',
  comment: 'tracker:comment',
  editComment: 'tracker:comment-edit',
  deleteComment: 'tracker:comment-delete',
  pullRequests: 'tracker:pull-requests',
  checkoutPullRequests: 'tracker:checkout-pull-requests',
  checkoutPullRequest: 'tracker:checkout-pull-request',
  repositories: 'tracker:repositories',
  attachRepository: 'tracker:repository-attach',
  detachRepository: 'tracker:repository-detach',
  undoGlossary: 'tracker:glossary:undo',
  skills: 'tracker:skills',
  writeSkill: 'tracker:skill-write',
  changeSkill: 'tracker:skill-change',
  removeSkill: 'tracker:skill-remove',
} as const;

/**
 * The Git host channels: the hosts this server can watch, and connecting one.
 *
 * A connection is server-wide rather than a project's, and connecting it is an
 * administrator's act — the server refuses anyone else in its own words, which
 * is what reaches the window.
 */
export const GIT_CHANNELS = {
  connections: 'git:connections',
  connect: 'git:connect',
  disconnect: 'git:disconnect',
  githubConnect: 'git:github-connect',
  connectionRepositories: 'git:connection-repositories',
} as const;

/**
 * A project, as the server holds one: a name and the prefix its tickets are named
 * under. `FND` is why a ticket is `FND-12` rather than a number nobody can say.
 */
export interface ProjectSummary {
  id: string;
  name: string;
  prefix: string;
}

/** One immutable version of a project term. */
export interface GlossaryHistory {
  version: number;
  term: string;
  meaning: string;
  wordsToAvoid: string[];
  author: { id: string; name: string } | null;
  chatId: string;
  changedAt: string;
}

/** A file that travels beside a skill's body, at a path relative to it. */
export interface ProjectSkillFile {
  path: string;
  content: string;
}

/** A method a project works by (docs/adr/0027-project-skills-live-in-the-store.md). */
export interface ProjectSkill {
  id: string;
  projectId: string;
  name: string;
  description: string;
  body: string;
  files: ProjectSkillFile[];
  author: { id: string; name: string } | null;
  /** The chat that wrote it, when Kira wrote it rather than a person. */
  chatId: string | null;
  createdAt: string;
  updatedAt: string;
}

/** A skill as a person or Kira writes one. */
export interface SkillDraft {
  name: string;
  description: string;
  body: string;
  files?: ProjectSkillFile[];
  /** The chat writing it, when Kira is. A person in the Work surface writes none. */
  chatId?: string;
}

/** A change to a skill: what is named is replaced, what is left out is kept. */
export interface SkillChange {
  name?: string;
  description?: string;
  body?: string;
  files?: ProjectSkillFile[];
}

/**
 * A skill Kira wrote, as the note the transcript offers to take back.
 *
 * `wrote` is what keeps the note honest. A skill she created can be deleted from
 * the note; one she changed cannot, because deleting it would take the whole
 * skill rather than the change — so a change is corrected in the Work surface
 * instead (docs/adr/0027).
 */
export interface SkillChangeNote {
  projectId: string;
  chatId: string;
  skillId: string;
  name: string;
  wrote: 'created' | 'changed';
}

/** The current project term, with every version that led to it. */
export interface GlossaryEntry {
  id: string;
  projectId: string;
  term: string;
  meaning: string;
  wordsToAvoid: string[];
  version: number;
  author: { id: string; name: string } | null;
  chatId: string;
  createdAt: string;
  updatedAt: string;
  history: GlossaryHistory[];
}

/** What a chat asks the server to add or sharpen. */
export interface GlossaryEdit {
  term: string;
  meaning: string;
  wordsToAvoid: string[];
  chatId: string;
}

/** The durable identity a chat note uses to offer a guarded Undo. */
export interface GlossaryChangeNote {
  workspaceId: string;
  chatId: string;
  entryId: string;
  version: number;
  term: string;
}

/**
 * Which project a folder is joining: one the server already holds, or one being
 * made here. Two answers rather than one because they are two different acts — a
 * join can fail because the project is gone, a creation because the prefix is
 * taken — and a person is owed the one that happened.
 */
export type JoinRequest =
  | { kind: 'existing'; projectId: string }
  | { kind: 'new'; name: string; prefix: string };

/**
 * The vocabulary a ticket is written in, as values rather than only as types.
 *
 * Both sides of the seam check it — the window's handler checks what it was asked
 * for, and the wire checks what came back — so one list means a kind nobody has
 * cannot be refused by one side and accepted by the other. The types below are
 * read off these lists rather than spelled again beside them.
 */
export const TICKET_KINDS = [
  'prototype',
  'bug',
  'feature',
  'refactor',
  'question',
  'research',
  'spec',
  'map',
] as const;
export const TICKET_STATUSES = [
  'draft',
  'ready',
  'running',
  'needs-review',
  'done',
  'wont-do',
] as const;
export const TICKET_PRIORITIES = ['urgent', 'high', 'medium', 'low', 'none'] as const;

/** What a ticket delivers, fixed when it is written. */
export type TicketKind = (typeof TICKET_KINDS)[number];

/** One stored ticket status. Blocked is a separate marker derived from its blockers. */
export type TicketStatus = (typeof TICKET_STATUSES)[number];
export type TicketPriority = (typeof TICKET_PRIORITIES)[number];

/** A ticket at one end of a blocker or parent link. */
export interface NamedTicket {
  id: string;
  name: string;
  status: TicketStatus;
}

/**
 * One ticket, as the window reads it.
 *
 * `children` are the blockers this ticket names; `gates` are tickets that name it.
 * Parent and sub-issue links are separate planning relationships.
 */
export interface Ticket {
  id: string;
  projectId: string;
  name: string;
  number: number;
  kind: TicketKind;
  title: string;
  body: string;
  criteria: string[];
  status: TicketStatus;
  blocked: boolean;
  rank: number;
  priority: TicketPriority;
  pullRequestUrl: string | null;
  assignee: { id: string; name: string } | null;
  tags: string[];
  author: { id: string; name: string } | null;
  gates: NamedTicket[];
  children: NamedTicket[];
  parent: NamedTicket | null;
  subIssues: NamedTicket[];
  relationships: { type: string; ticket: NamedTicket }[];
  createdAt: string;
  updatedAt: string;
  /** The ordinary shaping chat that proposed this spec, when it has one. */
  sourceChatId?: string | null;
  /** The approved answer and sources, when this question or research is closed. */
  outcome?: Outcome | null;
  /** Closed child Outcomes accumulated by a map, in child order. */
  decisionsSoFar?: Outcome[];
}

export interface Outcome {
  id: string;
  ticketId: string;
  answer: string;
  sources: string[];
  decisionProposal: OutcomeProposal['decisionProposal'];
  author: { id: string; name: string } | null;
  sourceChatId: string | null;
  createdAt: string;
}

/** One project's queue: every ticket, including Draft and Won’t do. */
export interface TicketQueue {
  project: ProjectSummary;
  tickets: Ticket[];
  counts: Record<TicketStatus, number>;
}

/** A repository a project's work happens in, as the host names it. */
export interface Repository {
  id: string;
  projectId: string;
  provider: string;
  owner: string;
  name: string;
  defaultBranch: string;
}

/** What attaching a repository asks for. */
export interface RepositoryInput {
  owner: string;
  name: string;
  provider?: string;
  defaultBranch?: string;
}

/** A repository a GitHub App installation can see, as the server reports it. */
export interface InstallationRepository {
  owner: string;
  name: string;
  defaultBranch: string;
}

/** A pull request reviewing a ticket, as its host states it. */
export interface TicketPullRequest {
  id: string;
  ticketId: string;
  provider: string;
  number: number;
  title: string;
  state: string;
  url: string;
  branch: string | null;
  authorLogin: string | null;
  mergedAt: string | null;
  /** Each check the host reported, and what they add up to. */
  checks: { context: string; state: string }[];
  checksState: string | null;
  createdAt: string;
  updatedAt: string;
}

/** Which pull requests a repository read asks its host for. */
export type PullRequestState = 'open' | 'closed' | 'all';

/** A repository's pull request, read live from its Git host. */
export interface LivePullRequest {
  number: number;
  title: string;
  /** open, draft, merged or closed, as the host states it. */
  state: string;
  url: string;
  branch: string | null;
  authorLogin: string | null;
  checksState: string | null;
  updatedAt: string | null;
}

/** A check a pull request's commits ran. */
export interface LiveCheck {
  context: string;
  state: string;
}

/** A comment on a pull request, from a person or a review. */
export interface LiveComment {
  authorLogin: string | null;
  body: string;
  createdAt: string | null;
}

/** One file a pull request changed, with the patch to read it. */
export interface LiveFile {
  path: string;
  status: string;
  patch: string | null;
}

/** One repository pull request opened, with everything the view reads about it. */
export interface LivePullRequestDetail {
  number: number;
  title: string;
  body: string;
  authorLogin: string | null;
  state: string;
  url: string;
  base: string | null;
  head: string | null;
  checks: LiveCheck[];
  comments: LiveComment[];
  files: LiveFile[];
}

/** A Git host this server can watch. */
export interface GitConnection {
  id: string;
  provider: string;
  authKind: string;
  instanceUrl: string | null;
  accountLogin: string;
  accountType: string;
  createdAt: string;
}

/** What connecting a host asks for: a token, and where the host is. */
export interface GitConnectionInput {
  provider: string;
  instanceUrl?: string;
  accessToken: string;
  webhookSecret?: string;
  accountLogin?: string;
}

/** A new connection, with the webhook secret shown once. */
export interface GitConnectionCreated {
  connection: GitConnection;
  webhookSecret: string;
}

/** Whether this server installs a GitHub App, and where to install it. */
export interface GitHubConnect {
  configured: boolean;
  url: string | null;
}

/** Someone behind a comment: a person, or Kira acting in their chat. */
export type CommentAuthor = { id: string; name: string } | null;

/** What was said on a ticket, by a person or by Kira. */
export interface TicketComment {
  id: string;
  ticketId: string;
  parentId: string | null;
  author: CommentAuthor;
  authorKind: string;
  body: string;
  deleted: boolean;
  /** Whether the signed-in person wrote it, so the window can offer to change it. */
  mine: boolean;
  createdAt: string;
  updatedAt: string;
}

/**
 * One row of a ticket's timeline: something said, or something that happened.
 *
 * The history is the server's own record of a change; `details` is whatever that
 * change needed to be read, with names already resolved.
 */
export type TimelineEntry =
  | ({ type: 'comment' } & Omit<TicketComment, 'ticketId'>)
  | {
      type: 'activity';
      id: string;
      actor: CommentAuthor;
      actorKind: string;
      action: string;
      details: Record<string, unknown>;
      createdAt: string;
    };

/** What writing a ticket down asks for. */
export interface TicketDraft {
  kind: TicketKind;
  title: string;
  body: string;
  criteria: string[];
  status?: TicketStatus;
  priority?: TicketPriority;
  tags?: string[];
  /** The ordinary chat that shaped this ticket, never supplied by Kira's tools. */
  sourceChatId?: string;
}

/** What one write to a ticket may change. Kind is not among them: it is fixed. */
export interface TicketChange {
  title?: string;
  body?: string;
  criteria?: string[];
  status?: TicketStatus;
  priority?: TicketPriority;
  assigneeId?: string | null;
  tags?: string[];
  rank?: number;
  pullRequestUrl?: string | null;
}

/**
 * The file channels: a chat's workspace, one folder and one file at a time, and
 * the watch that keeps the tree level with the folder.
 *
 * The listing and the reading take a chat id and a path relative to that chat's
 * workspace, and the folder that path is resolved against comes from the chat's
 * own record in the main process, so the window never says where to look. The
 * watch takes the chat and the levels of it that are on screen, by the same
 * relative paths, so a folder nobody is showing is never walked — and `changed`
 * flows the other way saying only that something under them has happened: which
 * folders to read again is the pane's to decide, because the pane is what knows
 * which of them are on screen.
 */
export const FILE_CHANNELS = {
  list: 'file:list',
  search: 'file:search',
  read: 'file:read',
  write: 'file:write',
  create: 'file:create',
  upload: 'file:upload',
  asset: 'file:asset',
  watch: 'file:watch',
  unwatch: 'file:unwatch',
  changed: 'file:changed',
} as const;

/**
 * The local-git channels: the chat's own checkout, one folder at a time.
 *
 * Distinct from `GIT_CHANNELS`, which means the Git hosts this server is
 * connected to. A local stage or commit is not a host's, and one word has one
 * meaning everywhere: `git:` stays "which host is connected", and the local
 * surface names itself separately.
 *
 * The window names a chat and paths relative to that chat's workspace, and the
 * folder comes from the chat's own record in the main process, the same way the
 * file channels resolve one. Every index write runs through one queue per
 * checkout, so two writes never interleave and a status read never overlaps one.
 */
export const WORKSPACE_GIT_CHANNELS = {
  status: 'workspace-git:status',
  patch: 'workspace-git:patch',
  stage: 'workspace-git:stage',
  unstage: 'workspace-git:unstage',
  applyHunk: 'workspace-git:apply-hunk',
  commit: 'workspace-git:commit',
  revert: 'workspace-git:revert',
  branches: 'workspace-git:branches',
  checkout: 'workspace-git:checkout',
  log: 'workspace-git:log',
  commitFiles: 'workspace-git:commit-files',
  sync: 'workspace-git:sync',
} as const;

/**
 * Who the app is signed in as.
 *
 * The window is told this much and no more. The key that proves it never
 * crosses this seam, so there is nothing here for one to leak through.
 */
export interface AuthUser {
  /**
   * The person's server id, when the answer carried one. Older keys and stored
   * sessions may not, so a window offers to assign a ticket only when it is here.
   */
  id?: string;
  name: string;
  email: string;
}

export type AuthState = { signedIn: false } | { signedIn: true; user: AuthUser };

/**
 * Whether an answer from anywhere names a person, rather than merely claiming to.
 *
 * Two things read a user back from bytes neither of them wrote — the key store
 * opening its file, and the Kira server's answers — so the shape is checked
 * in one place rather than twice.
 */
export function isAuthUser(value: unknown): value is AuthUser {
  const user = value as Partial<AuthUser> | null;
  return typeof user?.name === 'string' && typeof user.email === 'string';
}

/**
 * What the signed-in person has spent of the pool this month.
 *
 * Their own numbers, and nobody else's: the server answers for the key it is
 * presented and takes no person to name (docs/adr/0005-allowances.md). `warned`
 * is the server's own reading of its threshold rather than a comparison the
 * window makes, so the rule stays where the allowance does.
 */
export interface Usage {
  allowance: number;
  used: number;
  warned: boolean;
}

/**
 * What the chat on screen has used, as opposed to what the month has.
 *
 * Two readings of one chat, and they count differently on purpose. `spent` is
 * what the chat has cost, counted the way the allowance counts tokens — input
 * plus output, with cache reads and writes left out — so it can be read against
 * the month above it without the two disagreeing. `context` is how much of the
 * model's window the chat is holding, which is all of it: what was sent, what
 * was cached, and what was written back. One is money, the other is room.
 */
export interface ChatUsage {
  spent: number;
  /**
   * How full the chat's context window is, or null when pi cannot say: a model
   * with no window to fill, or the gap a compaction leaves until the next reply
   * reports what it used.
   */
  context: { tokens: number; window: number } | null;
}

/** One child agent the current chat delegated, as the Workbench shows it. */
export interface SubagentSummary {
  id: string;
  role: 'general' | 'explore';
  /** The model it runs on; `ModelOption` names it. */
  modelId: string;
  title: string;
  state: 'running' | 'complete' | 'error' | 'stopped';
  outcome: string | null;
  error: string | null;
  activity: string | null;
  /** Whether it can still be steered, stopped or resumed, rather than only read. */
  controllable: boolean;
}

/**
 * What a person can do to a subagent from the panel: redirect one that is
 * working, stop it, or give a finished or stopped one more to do.
 */
export type SubagentControl =
  | { action: 'stop' }
  | { action: 'steer'; text: string }
  | { action: 'resume'; text: string };

/**
 * The usage channels.
 *
 * One command and one event, like the auth pair below: the window asks what the
 * month looks like, and hears again whenever the answer moves.
 */
export const USAGE_CHANNELS = {
  load: 'usage:load',
  event: 'usage:event',
} as const;

/**
 * One model Kira offers, as the window draws it.
 *
 * The id is what a model is asked for by, and the name is what the pool calls
 * it. Nothing else crosses: what a model costs, how wide its window is and
 * whether it reasons are facts a session is built from rather than things a
 * picker shows, and they stay in the main process where the catalog lives.
 */
export interface ModelOption {
  id: string;
  name: string;
}

/**
 * The models channels.
 *
 * `load` is the list the picker offers, in the pool's own order; `choose` runs
 * the chat on screen on one of them. There is no event beside them, unlike usage
 * and auth: the list moves only when the server is asked again, and a choice
 * lands in the chat the window is already reading, so the window reloads that
 * chat rather than being told.
 */
export const MODELS_CHANNELS = {
  load: 'models:load',
  choose: 'models:choose',
} as const;

/** The connection state shown for a user-configured MCP server. */
export type McpServerStatus =
  | 'not-started'
  | 'connecting'
  | 'connected'
  | 'failed'
  | 'disabled'
  | 'needs-sign-in';
export type McpServerTransport = 'stdio' | 'streamable-http';
export type McpToolSelection = 'all' | string[];

/** A tool an MCP server has offered to Kira. */
export interface McpToolSummary {
  /** Namespaced name exposed to chats. */
  name: string;
  /** Original name used by the MCP server and tool-selection storage. */
  toolName: string;
  description: string;
  selected: boolean;
}

/** A saved MCP server as Settings reads it. */
export interface McpServer {
  id: string;
  scope: 'global' | 'workspace';
  workspaceId: string | null;
  name: string;
  transport: McpServerTransport;
  command: string;
  args: string[];
  cwd: string | null;
  url: string | null;
  toolSelection: McpToolSelection;
  enabled: boolean;
  status: McpServerStatus;
  error: string | null;
  tools: McpToolSummary[];
  /** Whether usable credentials are loaded in the main process; values never cross preload. */
  hasCredentials: boolean;
  /** Whether an encrypted credentials file exists, even if this device cannot open it. */
  credentialsPersisted: boolean;
  /** Whether OAuth access tokens are available to the main-process MCP client. */
  hasOAuth: boolean;
  /** Whether encrypted OAuth state exists, even if this device cannot open it. */
  oauthCredentialsPersisted: boolean;
}

/** Values sent only when adding or replacing encrypted server credentials. */
export interface McpCredentialsDraft {
  env?: Record<string, string> | null;
  headers?: Record<string, string> | null;
  bearerToken?: string | null;
}

/** The fields needed to add or edit an MCP server. */
export interface McpServerDraft {
  scope?: 'global' | 'workspace';
  workspaceId?: string | null;
  name: string;
  transport: McpServerTransport;
  command: string;
  args: string[];
  cwd: string | null;
  url: string | null;
  toolSelection: McpToolSelection;
  credentials?: McpCredentialsDraft;
}

/**
 * What somebody decided about memory, as the server tells it.
 *
 * Two answers and a suggestion, and the last two are apart on purpose. `enabled` is
 * whether the observational-memory workers run at all; `chosen` is the model this
 * person chose to reflect with, and is null until they choose one; `recommended` is
 * what Kira suggests, and is null only when the server cannot ask its pool. The
 * suggestion never binds anybody — whoever chooses gets what they chose — and a
 * window handed one effective model instead of these two would save the suggestion
 * back as a decision the first time it saved anything.
 */
export interface MemorySettings {
  enabled: boolean;
  chosen: string | null;
  recommended: string | null;
}

/** What somebody decided, and the whole of what they can change. */
export interface MemoryChoice {
  enabled: boolean;
  /** A model of their own, or null for "whichever Kira suggests". */
  chosen: string | null;
}

/** What someone can change on a reusable prompt shared by every workspace. */
export interface MagicPromptDraft {
  name: string;
  aliases: string[];
  /** Literal text expanded into the composer; it is not submitted on selection. */
  content: string;
}

/** A saved shared Magic Prompt. */
export interface MagicPrompt extends MagicPromptDraft {
  id: string;
}

/**
 * The model the reflecting runs on: what this person chose, or what is suggested.
 *
 * One spelling of a rule the window and the main process both need — the page to
 * draw which model is in force, a compaction to run on it — so the two cannot
 * disagree about what "no choice of mine" means.
 */
export function reflectingWith(settings: MemorySettings | null): string | null {
  return settings === null ? null : (settings.chosen ?? settings.recommended);
}

/**
 * The memory channels.
 *
 * One question and one change, and deliberately no event beside them: this is the
 * settings page's own surface, and the only thing that moves the answer is a
 * person changing it there — the call back says what is now in force, so there is
 * nothing for the main process to push. What it decides reaches the rest of the
 * app through the reading the main process holds.
 */
export const MEMORY_CHANNELS = {
  load: 'memory:load',
  save: 'memory:save',
} as const;

/** Shared reusable prompt CRUD, independent of the selected workspace. */
export const MAGIC_PROMPT_CHANNELS = {
  load: 'magic-prompts:load',
  create: 'magic-prompts:create',
  update: 'magic-prompts:update',
  remove: 'magic-prompts:remove',
} as const;

/** The Settings surface for Kira-owned MCP servers. */
export const MCP_CHANNELS = {
  load: 'mcp:load',
  add: 'mcp:add',
  update: 'mcp:update',
  remove: 'mcp:remove',
  reconnect: 'mcp:reconnect',
  setEnabled: 'mcp:set-enabled',
  setToolSelection: 'mcp:set-tool-selection',
  signIn: 'mcp:sign-in',
  signOut: 'mcp:sign-out',
  event: 'mcp:event',
} as const;
/** Commands from the one trusted renderer to register its owned browser guest. */
export const BROWSER_PROFILE_PARTITION = 'persist:kira-browser';
export const BROWSER_CHANNELS = {
  register: 'browser:register',
  activate: 'browser:activate',
  deactivate: 'browser:deactivate',
} as const;

/** Desktop application update operations and lifecycle events. */
export const UPDATE_CHANNELS = {
  load: 'updates:load',
  check: 'updates:check',
  install: 'updates:install',
  event: 'updates:event',
} as const;

export type DesktopUpdateStatus =
  | 'idle'
  | 'checking'
  | 'up-to-date'
  | 'downloading'
  | 'downloaded'
  | 'installing'
  | 'unsupported'
  | 'error';

export interface DesktopUpdateSnapshot {
  status: DesktopUpdateStatus;
  currentVersion: string;
  availableVersion: string | null;
  error: string | null;
}

/**
 * The auth channels.
 *
 * Signing in leaves the app and comes back: the system browser is opened, the
 * user signs in there, and the app is returned to over a deep link. So the
 * answer arrives as an event rather than as the reply to the call that started
 * it, which is the whole reason `event` is here beside the two commands.
 */
export const AUTH_CHANNELS = {
  load: 'auth:load',
  signIn: 'auth:signIn',
  signOut: 'auth:signOut',
  event: 'auth:event',
} as const;

/** Kira's device-local command shell configuration. */
export const SHELL_CHANNELS = {
  load: 'shell:load',
  browse: 'shell:browse',
  test: 'shell:test',
  save: 'shell:save',
} as const;

export interface ShellSettingsSnapshot {
  configuredPath: string | null;
  resolvedPath: string | null;
  error: string | null;
}

export interface ShellTestResult {
  resolvedPath: string;
}

export interface KiraBridge {
  /** Host platform, so the renderer can adapt without importing Node APIs. */
  platform: string;
  /** Register a guest created by this window, after Electron attaches it. */
  registerBrowserGuest(input: {
    browserId: string;
    chatId: string;
    webContentsId: number;
  }): Promise<Result<null>>;
  /** Name this chat's selected browser to its agent tools. */
  activateBrowser(chatId: string, browserId: string): Promise<Result<null>>;
  /** Clear the selected browser when the chat has no active browser tab. */
  deactivateBrowser(chatId: string): Promise<Result<null>>;
  /** Everything the surface needs to draw itself: chats, current chat, transcript. */
  loadChat(): Promise<Result<ChatState>>;
  readSubagentTranscript(
    parentThreadId: string,
    childThreadId: string,
  ): Promise<Result<ChatTranscript>>;
  /** Steer, stop or resume one of a chat's subagents. */
  controlSubagent(
    parentThreadId: string,
    childThreadId: string,
    control: SubagentControl,
  ): Promise<Result<null>>;
  /** Change the current chat between direct building and planning-only Spec mode. */
  setChatMode(mode: ChatMode): Promise<Result<null>>;
  setChatAttachedTicketIds(attachedTicketIds: string[]): Promise<Result<null>>;
  /**
   * Send a message to the current chat. Resolves when Kira's turn has finished,
   * which may be long after the window has moved to another chat.
   */
  sendMessage(text: string): Promise<Result<null>>;
  /** Run a local command in the named chat's workspace, without starting a model turn. */
  runShellCommand(chatId: string, command: string): Promise<Result<string>>;
  /** Stop one user-run local command without stopping an AI turn. */
  cancelShellCommand(chatId: string, runId: string): Promise<Result<null>>;
  /**
   * Stop the reply being written in the current chat, and wait for the turn to
   * end. What Kira has already written stays in the conversation, and so do the
   * words still waiting to be read: they come back, because stopping is how you
   * change your mind about what you asked for.
   */
  stopChat(): Promise<Result<QueuedLine[]>>;
  /**
   * Summarise the current chat now rather than waiting for its window to fill.
   *
   * What it carries is what any other compaction carries, because it is the same
   * compaction: the chat keeps every word it held, and the boundary it leaves is
   * the last thing in the transcript until something is said after it. Refused
   * when there is nothing in the chat to summarise, which is pi's own judgement
   * rather than this app's.
   */
  compactChat(): Promise<Result<null>>;
  /**
   * Give Kira words to read at her next step, or once this turn has finished.
   * Either way they are answered in the chat they were written in.
   */
  queueMessage(text: string, lane: QueuedLine['lane']): Promise<Result<null>>;
  /**
   * Take back the words still waiting to be read, in the order she would have
   * read them. The turn being written keeps going; only the queue empties.
   */
  takeQueuedBack(): Promise<Result<QueuedLine[]>>;
  /** Start a new chat and switch to it, filed under `workspaceId` when there is one. */
  startChat(workspaceId: string | null, attachedTicketIds?: string[]): Promise<Result<null>>;
  /** Switch to a stored chat, leaving whatever it — or the chat left behind — is doing. */
  openChat(id: string): Promise<Result<null>>;
  /**
   * Put a chat away: it leaves the sidebar and keeps everything it holds, so it
   * is read again by its id. Nothing is taken and nothing is stopped, and a chat
   * Kira is writing in is refused rather than put away: the words in flight are
   * that chat's.
   */
  archiveChat(id: string): Promise<Result<null>>;
  /** Bring a chat back from being put away. */
  restoreChat(id: string): Promise<Result<null>>;
  /**
   * Throw a chat away: the conversation and everything said in it, which is not
   * something that can be taken back. The folder it worked in is left as it is,
   * and so is any chat forked from it.
   */
  deleteChat(id: string): Promise<Result<null>>;
  /**
   * File a chat under a workspace, so it works in that workspace's folder from then on.
   * Its words come with it. A chat Kira is writing in is refused, and a refusal leaves
   * the chat exactly as it was.
   */
  fileChat(id: string, workspaceId: string): Promise<Result<null>>;
  /** Show the branch ending at `messageId`, and carry on from there. */
  switchBranch(messageId: string): Promise<Result<null>>;
  /**
   * Take back the message at `messageId`, so it can be said differently: the
   * next message sent replaces it and lands beside it as another branch. Only
   * your own message can be taken back. Nothing is stored yet — the message that
   * follows is what says what was said instead.
   */
  editMessage(messageId: string): Promise<Result<null>>;
  /** Start a chat holding this one's words up to `messageId`, and switch to it. */
  forkChat(messageId: string): Promise<Result<null>>;
  /**
   * Choose a folder to work in, and remember it as a workspace. Answers the
   * workspace that folder now is — the same one it already was, if it was opened
   * before — or null when the folder picker was closed without choosing.
   */
  addWorkspace(): Promise<Result<WorkspaceSummary | null>>;
  /**
   * Clone a repository into a folder you pick, and remember it as a workspace.
   * Answers null when the folder picker was closed without choosing, and raises
   * what git said when the clone is refused — a private repository this machine
   * has no credential for is the person's to fix, not Kira's to work around.
   */
  cloneWorkspace(request: CloneRequest): Promise<Result<WorkspaceSummary | null>>;
  /**
   * Stop showing a workspace. Its chats keep their conversations and the folder
   * they work in; they are simply filed nowhere until they are filed again. A
   * workspace Kira is writing in is not stopped, since the work is filed under it
   * and there is nowhere else to file it while the turn runs.
   */
  removeWorkspace(id: string): Promise<Result<null>>;
  /**
   * The projects this workspace could join, as the server holds them. Refused when
   * nobody is signed in or the server cannot be reached, which are two different
   * things to be told and neither of them an empty list.
   */
  joinableProjects(): Promise<Result<ProjectSummary[]>>;
  /**
   * Join a workspace to a project — one the server holds, or one made now — and
   * answer the workspace as it stands afterwards. A prefix another project holds
   * is refused in the server's own words, and the folder is left joined to nothing
   * rather than half-joined.
   */
  joinWorkspace(workspaceId: string, request: JoinRequest): Promise<Result<WorkspaceSummary>>;
  /**
   * The queue of the project this workspace works: every ticket with its stored
   * status, including Draft and Won’t do. Refused when the server cannot be
   * reached, which is not the same as a project with no work in it.
   */
  loadQueue(workspaceId: string): Promise<Result<TicketQueue>>;
  /** Open or resume the author-owned linked chat for a question. */
  openQuestion(workspaceId: string, ticketId: string): Promise<Result<Ticket>>;
  /** Undo a glossary change only when the visible version is still current. */
  undoGlossary(
    workspaceId: string,
    entryId: string,
    version: number,
    chatId: string,
  ): Promise<Result<GlossaryEntry>>;
  /** Create a ticket in the workspace's project. */
  writeTicket(workspaceId: string, draft: TicketDraft): Promise<Result<Ticket>>;
  /** Update a ticket's fields and stored status. */
  changeTicket(ticketId: string, change: TicketChange): Promise<Result<Ticket>>;
  /**
   * Name a ticket that gates this one. A circle, a self-gate and a ticket in
   * another project are each refused with nothing written.
   */
  gateTicket(ticketId: string, gatedBy: string): Promise<Result<Ticket>>;
  /** Take a gate off a ticket. */
  ungateTicket(ticketId: string, gatedBy: string): Promise<Result<Ticket>>;
  /**
   * A ticket's comments and history as one timeline, oldest first. `limit` keeps
   * only the newest entries, which is what a long ticket is read through.
   */
  loadTimeline(ticketId: string, limit?: number): Promise<Result<TimelineEntry[]>>;
  /** Say something on a ticket, or reply to a comment on it. */
  postComment(
    ticketId: string,
    body: string,
    parentId?: string,
    authorKind?: 'member' | 'kira',
  ): Promise<Result<TicketComment>>;
  /** The pull requests reviewing a ticket. */
  loadPullRequests(ticketId: string): Promise<Result<TicketPullRequest[]>>;
  /**
   * The chat's checkout repository's pull requests, read live from its connected
   * Git host. A checkout with no remote, a repository whose host is not connected,
   * and a host with no adapter each come back as a sentence.
   */
  loadCheckoutPullRequests(
    chatId: string,
    state: PullRequestState,
  ): Promise<Result<LivePullRequest[]>>;
  /** One pull request opened: its body, checks, comments and changed files. */
  loadCheckoutPullRequest(chatId: string, number: number): Promise<Result<LivePullRequestDetail>>;
  /** Change the words of a comment you wrote. */
  editComment(commentId: string, body: string): Promise<Result<TicketComment>>;
  /** Remove a comment you wrote, keeping any replies it has. */
  deleteComment(commentId: string): Promise<Result<null>>;
  /** The repositories a project's work happens in. */
  loadRepositories(projectId: string): Promise<Result<Repository[]>>;
  /** Attach a repository to a project. */
  attachRepository(projectId: string, input: RepositoryInput): Promise<Result<Repository>>;
  /** Take a repository off a project. */
  detachRepository(projectId: string, id: string): Promise<Result<null>>;
  /** The repositories a GitHub App installation can see, for attaching by name. */
  listConnectionRepositories(connectionId: string): Promise<Result<InstallationRepository[]>>;
  /** The methods a project works by. */
  loadSkills(projectId: string): Promise<Result<ProjectSkill[]>>;
  /** Write a skill the project works by, refused when its name is taken. */
  writeSkill(projectId: string, draft: SkillDraft): Promise<Result<ProjectSkill>>;
  /** Change a skill, or the files that travel with it. */
  changeSkill(
    projectId: string,
    skillId: string,
    change: SkillChange,
  ): Promise<Result<ProjectSkill>>;
  /** Delete a skill and the files that travel with it. */
  removeSkill(projectId: string, skillId: string): Promise<Result<null>>;
  /** The Git hosts this server is connected to. */
  loadGitConnections(): Promise<Result<GitConnection[]>>;
  /** Connect a Git host with a token; its webhook secret comes back once. */
  connectGitHost(input: GitConnectionInput): Promise<Result<GitConnectionCreated>>;
  /** Disconnect a Git host. */
  disconnectGitHost(id: string): Promise<Result<null>>;
  /** Where to install this server's GitHub App, or that none is configured. */
  loadGitHubConnect(): Promise<Result<GitHubConnect>>;
  /**
   * What one folder of the chat's workspace holds, or null when that chat has
   * no workspace — a chat nothing has been said in yet has no folder to show,
   * which is not the same as a folder with nothing in it.
   */
  listWorkspaceFolder(chatId: string, path: string): Promise<Result<FolderListing | null>>;
  /** Search file names in the chat's workspace without reading their contents. */
  searchWorkspaceFiles(chatId: string, query: string): Promise<Result<string[]>>;
  /**
   * One file's text, from a path inside the chat's workspace. A file too large
   * to read, or one that is not text, is refused with a sentence saying so
   * rather than answered with something that would read as its contents.
   */
  readWorkspaceFile(chatId: string, path: string): Promise<Result<string>>;
  /** Save a text file if it still matches the contents the window opened. */
  writeWorkspaceFile(
    chatId: string,
    path: string,
    expected: string,
    content: string,
  ): Promise<Result<null>>;
  /** Create a new file or folder in the chat's workspace without replacing an existing item. */
  createWorkspaceItem(chatId: string, path: string, kind: 'file' | 'folder'): Promise<Result<null>>;
  /** Copy a user-selected file into the chat's workspace without replacing an existing item. */
  uploadWorkspaceFile(chatId: string, path: string, content: Uint8Array): Promise<Result<null>>;
  /** Read an allowlisted image, document, media, or font preview asset. */
  readWorkspaceAsset(chatId: string, path: string): Promise<Result<WorkspaceAsset>>;
  /**
   * Watch the levels of the chat's workspace the pane is showing, so a file Kira
   * writes reaches the tree without anyone asking again. One set per window:
   * watching another chat stops watching the one before it, and a level the
   * platform will not watch is not an error — the tree reads it just the same.
   */
  watchWorkspace(chatId: string, folders: readonly string[]): Promise<Result<null>>;
  /**
   * Stop watching. What the pane says when it is put away, so a folder is not
   * watched for a chat nobody is looking at.
   */
  unwatchWorkspace(): Promise<Result<null>>;
  /**
   * Subscribe to changes in the watched workspace. Returns an unsubscribe
   * function. Nothing is carried: a change means "read what is on screen again".
   */
  onWorkspaceChanged(listener: () => void): () => void;
  /**
   * What git says changed in the chat's checkout, grouped staged / unstaged /
   * untracked. A folder that is not a checkout, or a machine with no git, is
   * refused with a sentence rather than shown as a clean tree.
   */
  workspaceGitStatus(chatId: string): Promise<Result<WorkspaceGitStatus>>;
  /** One path's unified patch: in the index when `staged`, in the working tree otherwise. */
  workspaceGitPatch(chatId: string, path: string, staged: boolean): Promise<Result<string>>;
  /** Put paths in the index. */
  stageWorkspacePaths(chatId: string, paths: string[]): Promise<Result<null>>;
  /** Take paths back out of the index, keeping what is in the working tree. */
  unstageWorkspacePaths(chatId: string, paths: string[]): Promise<Result<null>>;
  /** Apply one hunk of a patch to the index, or reverse it back out. */
  applyWorkspaceHunk(chatId: string, patch: string, reverse: boolean): Promise<Result<null>>;
  /** Commit what is staged, with this message. */
  commitWorkspace(chatId: string, message: string): Promise<Result<null>>;
  /** Put one path back the way HEAD has it, index and working tree together. */
  revertWorkspacePath(chatId: string, path: string): Promise<Result<null>>;
  /** The checkout's local branches and the one it has out. */
  workspaceGitBranches(
    chatId: string,
  ): Promise<Result<{ branches: string[]; current: string | null }>>;
  /** Switch the checkout to another branch, refusing a tree with uncommitted changes. */
  checkoutWorkspaceBranch(chatId: string, branch: string): Promise<Result<null>>;
  /** Recent commits of the checkout's current branch, newest first. */
  workspaceGitLog(chatId: string, limit: number): Promise<Result<CommitSummary[]>>;
  /** The paths one commit changed. */
  workspaceCommitFiles(chatId: string, hash: string): Promise<Result<ChangedPath[]>>;
  /** Fetch, pull or push against the checkout's remote, showing git's own refusal. */
  syncWorkspaceRemote(chatId: string, action: GitSyncAction): Promise<Result<string>>;
  /**
   * Approve a proposal in the chat on screen as a person, writing it to the
   * tracker. A breakdown is published and marked ready in one step.
   */
  approveProposal(proposalId: string): Promise<Result<null>>;
  /** Reject a proposal in the chat on screen; nothing reaches the tracker. */
  rejectProposal(proposalId: string): Promise<Result<null>>;
  /** Send an Outcome back for revision without unlinking the question chat. */
  sendBackOutcome(proposalId: string): Promise<Result<null>>;
  /** Retry readiness for an already-published breakdown in the chat on screen. */
  retryBreakdownReady(): Promise<Result<null>>;
  /** Submit the answers to the questionnaire identified by its live request id. */
  answerQuestionnaire(
    threadId: string,
    requestId: string,
    result: QuestionnaireResult,
  ): Promise<Result<null>>;
  /** Cancel a live questionnaire and tell Kira the person declined. */
  cancelQuestionnaire(threadId: string, requestId: string): Promise<Result<null>>;
  /** Subscribe to pushed turn events. Returns an unsubscribe function. */
  onChatEvent(listener: (event: ChatEvent) => void): () => void;
  /** Whether anyone is signed in, and who, as the server last confirmed it. */
  loadAuth(): Promise<Result<AuthState>>;
  /**
   * Open the system browser to sign in. Resolves once the browser is open — the
   * user has a whole sign-in to complete in between, so what came of it arrives
   * as an auth event rather than as this call's answer.
   */
  signIn(): Promise<Result<null>>;
  /** Forget this device's key, and end the session it was issued under. */
  signOut(): Promise<Result<AuthState>>;
  /** Subscribe to auth changes. Returns an unsubscribe function. */
  onAuthEvent(listener: (state: AuthState) => void): () => void;
  /** Read the current desktop update state. */
  loadDesktopUpdate(): Promise<Result<DesktopUpdateSnapshot>>;
  /** Check the configured release feed now. */
  checkDesktopUpdate(): Promise<Result<DesktopUpdateSnapshot>>;
  /** Install a downloaded update and restart the app. */
  installDesktopUpdate(): Promise<Result<{ installed: boolean; message: string }>>;
  /** Subscribe to update state changes. */
  onDesktopUpdateEvent(listener: (snapshot: DesktopUpdateSnapshot) => void): () => void;
  /**
   * What this person has used of their allowance this month, as the server last
   * said — or null when nobody is signed in, or when the server could not be
   * asked, which is not the same as having used nothing.
   */
  loadUsage(): Promise<Result<Usage | null>>;
  /** Subscribe to new readings. Returns an unsubscribe function. */
  onUsageEvent(listener: (usage: Usage | null) => void): () => void;
  /**
   * The models Kira offers, in the order the pool ranks them, so the picker
   * draws what can actually be run rather than what the machine once knew.
   */
  loadModels(): Promise<Result<ModelOption[]>>;
  /** Run the chat on screen on the model `modelId` names. */
  chooseModel(modelId: string): Promise<Result<null>>;
  /**
   * What this person decided about memory, as the server last said — or null
   * when nobody is signed in, or when the server could not be asked, which is not
   * the same as having decided nothing.
   */
  loadMemory(): Promise<Result<MemorySettings | null>>;
  /**
   * Decide whether memory runs, and which model reflects. Answers what is in
   * force afterwards, which is not always what was asked for: a model the pool is
   * not offering is refused, in the server's own words.
   */
  saveMemory(decided: MemoryChoice): Promise<Result<MemorySettings>>;
  /** Read the prompts shared across every workspace on this installation. */
  loadMagicPrompts(): Promise<Result<MagicPrompt[]>>;
  /** Add a shared prompt. */
  createMagicPrompt(draft: MagicPromptDraft): Promise<Result<MagicPrompt>>;
  /** Edit a shared prompt without changing its id. */
  updateMagicPrompt(id: string, draft: MagicPromptDraft): Promise<Result<MagicPrompt>>;
  /** Remove a shared prompt. */
  removeMagicPrompt(id: string): Promise<Result<null>>;
  /** List the global MCP servers configured on this desktop. */
  loadMcpServers(): Promise<Result<McpServer[]>>;
  /** Add a global MCP server. */
  addMcpServer(draft: McpServerDraft): Promise<Result<McpServer>>;
  /** Edit a global MCP server and reconnect only it. */
  updateMcpServer(id: string, draft: McpServerDraft): Promise<Result<McpServer>>;
  /** Remove a global MCP server and stop its process. */
  removeMcpServer(id: string): Promise<Result<null>>;
  /** Retry one server without changing its saved configuration. */
  reconnectMcpServer(id: string): Promise<Result<null>>;
  /** Enable or disable one server. */
  setMcpServerEnabled(id: string, enabled: boolean): Promise<Result<null>>;
  /** Choose all tools or an explicit list for one server. */
  setMcpServerToolSelection(id: string, selection: McpToolSelection): Promise<Result<null>>;
  /** Sign in to an OAuth-protected Streamable HTTP server in the system browser. */
  signInMcpServer(id: string): Promise<Result<null>>;
  /** Remove saved OAuth tokens for one MCP server. */
  signOutMcpServer(id: string): Promise<Result<null>>;
  /** Subscribe to MCP connection and tool-list changes. */
  onMcpEvent(listener: (servers: McpServer[]) => void): () => void;
  /** Read Kira's device-local shell override and Pi's detected shell. */
  loadShellSettings(): Promise<Result<ShellSettingsSnapshot>>;
  /** Pick a Bash executable, or null when the picker was cancelled. */
  browseShellPath(): Promise<Result<string | null>>;
  /** Run a harmless command with the chosen shell to verify it works. */
  testShellPath(path: string | null): Promise<Result<ShellTestResult>>;
  /** Save an override or restore Pi's automatic shell detection. */
  saveShellPath(path: string | null): Promise<Result<null>>;
}
