/**
 * The single home for Work's wording: every sentence, label, tooltip, and aria-label a person
 * reads on the Work surface (board, list, drawer, full ticket view, New ticket, workspace
 * setup, blockers, filters, toasts, banners, empty states). Components import `copy` and
 * never write a user-visible literal of their own, so wording can be read and changed here.
 * Words the server sends back on a refusal are shown as they come; the server words those in
 * `apps/server/src/messages.ts`.
 *
 * Vocabulary: a person sees Ticket, Blocker, Session, and Workspace (a checkout and branch
 * made for a ticket). Never gate, run, issue, parent, child, dependency, claim, or
 * "execution workspace". "Blocked by" and "Blocking" name the two directions. Status is the
 * word for where a ticket stands; a lane is only how the board draws a status. "Folder" is
 * the local folder a project is linked to; it is never called a workspace here.
 * Close puts a panel away; Resolve… closes a ticket (Mark done or Won’t do).
 *
 * Voice: plain, calm, exact. Sentence case. Buttons are verbs. Status lines are short
 * lowercase phrases. Empty states say what the thing is for. Say what happened and what to
 * do next; no exclamation marks; curly apostrophes (’).
 *
 * To add a string: put it in the group for the area it appears in. Static text is a plain
 * string; text with a variable is a small function. Keep this file plain TypeScript with no
 * React so it can be read and tested without a browser.
 */

/** "1 ticket", "2 tickets". Every noun used with it takes a plain -s. */
export function count(n: number, noun: string): string {
  return `${n} ${n === 1 ? noun : `${noun}s`}`;
}

/** What a person is looking at: no ticket id, just the words a row or title falls back to. */
const UNTITLED = 'Untitled';

export const copy = {
  untitled: UNTITLED,
  none: '—',

  /* ── Views and the header ─────────────────────────────────────────────── */
  views: {
    label: 'View',
    board: { label: 'Board', note: 'tickets by status' },
    list: { label: 'List', note: 'all tickets in a table' },
  },
  header: {
    backToProjects: 'Back to projects',
    prefixLine: (prefix: string, note: string) => `${prefix} · ${note}`,
    newTicket: 'New ticket',
    startChat: (n: number) => `Start chat with ${count(n, 'ticket')}`,
  },

  /* ── Statuses (the board's lanes and the List's groups) ───────────────── */
  statuses: {
    'needs-you': { label: 'Needs review', note: 'a question to answer or a session to review' },
    ready: { label: 'Ready', note: 'ready to be worked on' },
    running: { label: 'Running', note: 'being worked on now' },
    blocked: { label: 'Blocked', note: 'waiting for other tickets to close' },
    draft: { label: 'Drafts', note: 'not ready to start yet' },
    done: { label: 'Done', note: 'closed as done or won’t do' },
  },
  /** One status as a state word, singular: a ticket’s Status fact and a blocker’s state. */
  statusWord: {
    'needs-you': 'Needs review',
    ready: 'Ready',
    running: 'Running',
    blocked: 'Blocked',
    draft: 'Draft',
    done: 'Done',
  },
  kinds: {
    prototype: 'Try an idea and throw it away',
    bug: 'Something is broken',
    feature: 'Something new to build',
    refactor: 'Change the code, not the behavior',
    question: 'Something to find out',
    research: 'Read and report back',
    spec: 'Say what to build, in detail',
    map: 'Plan work too big for one ticket',
  },

  /* ── Search, Filter, Display ──────────────────────────────────────────── */
  search: {
    label: 'Search tickets',
    placeholder: 'Search tickets',
  },
  filter: {
    button: (active: number) => (active === 0 ? 'Filter' : `Filter · ${active}`),
    status: 'Status',
    kind: 'Kind',
    owner: 'Owner',
    anyStatus: 'Any status',
    anyKind: 'Any kind',
    statusChip: (status: string) => `Status: ${status}`,
    kindChip: (kind: string) => `Kind: ${kind}`,
    owners: { all: 'Any owner', claimed: 'Has an owner', unclaimed: 'No owner' },
    remove: (chip: string) => `Remove filter ${chip}`,
    clear: 'Clear filters',
    shown: (shown: number, total: number) => `${shown} of ${count(total, 'ticket')}`,
  },
  display: {
    button: 'Display',
    groupBy: 'Group by',
    groups: { status: 'Status', kind: 'Kind' },
    orderBy: 'Order by',
    orders: { rank: 'Priority', updated: 'Last updated', created: 'Newest first' },
    showDone: 'Show done tickets',
  },

  /* ── Board and List ───────────────────────────────────────────────────── */
  board: {
    lanes: 'Ticket statuses; scroll sideways to see them all',
    empty: 'Nothing here.',
    doneHidden: 'Done tickets are hidden. Turn on “Show done tickets” in Display.',
  },
  table: {
    ticket: 'Ticket',
    status: 'Status',
    kind: 'Kind',
    blockers: 'Blockers',
    sessions: 'Sessions',
    owner: 'Owner',
    updated: 'Updated',
    dragTitle: 'Drag to reorder, or move to another status',
    move: (name: string) => `Move ${name} to another status`,
  },
  row: {
    open: (name: string, title: string) => `Open ticket ${name}: ${title || UNTITLED}`,
    updated: (when: string) => `Updated ${when}`,
    blockersClosed: 'Blockers closed',
    sessions: 'Sessions',
    inNewChat: 'in new chat',
    openChat: (title: string, more: number) =>
      `Open chat: ${title}${more > 0 ? `, and ${more} more linked` : ''}`,
    openChatTitle: (title: string) => `Open chat: ${title}`,
    start: 'Start',
    startOn: (name: string) => `Start agent on ${name}`,
    toTop: (name: string) => `Move ${name} to the top of Ready`,
    addToChat: (name: string) => `Add ${name} to a new chat`,
    removeFromChat: (name: string) => `Remove ${name} from the new chat`,
    moveStatus: (name: string) => `Move ${name} to another status`,
    handleReorder: 'Reorder, or move to another status',
    handleMove: 'Move to another status',
  },

  /* ── Empty, loading, and failed states ────────────────────────────────── */
  states: {
    noFolder: {
      title: 'No folder selected',
      description:
        'Open a folder from the sidebar to see the tickets of the project it belongs to.',
    },
    loading: 'Loading tickets',
    loadFailed: 'Couldn’t load tickets',
    tryAgain: 'Try again',
    noTickets: {
      title: 'No tickets yet',
      description:
        'A ticket is one piece of work. Write one, start an agent on it, and review what it makes.',
    },
    noMatches: {
      title: 'No matching tickets',
      description: 'Try a different search, or clear the filters.',
    },
  },
  refused: {
    panelTitle: 'Couldn’t make that change',
    createTitle: 'Couldn’t create the ticket',
    joinTitle: 'Couldn’t finish that',
  },

  /* ── Confirmation bar: what a drop on another status asks ─────────────── */
  drop: {
    aria: 'Confirm move',
    heading: (name: string, destination: string) => `${name} → ${destination}`,
    move: (name: string, from: string, to: string) => `Move ${name} from ${from} to ${to}.`,
    chooseReady: (name: string) => `Choose who should pick up ${name}: an agent or a person.`,
    backToDrafts: (name: string) => `Move ${name} back to Drafts? Its blockers and sessions stay.`,
    prepareAgent: (name: string) =>
      `${name} must be ready for an agent before one can start on it.`,
    startAgent: (name: string) => `Choose the workspace for ${name}, then start its agent.`,
    addBlocker: (name: string) => `Choose a ticket that must close before ${name} can start.`,
    removeBlocker: (name: string) => `Choose a blocker to remove from ${name}.`,
    sendBack: (name: string) => `Send ${name} back to Ready so the agent can try again?`,
    accept: (name: string) => `Accept the session’s work and close ${name}?`,
    resolve: (name: string) => `Resolve ${name}: mark it done, or close it as won’t do.`,
    checkingWorkspaces: 'Checking workspaces…',
    openToSetUp: 'Open ticket to set up a workspace',
    workspace: 'Workspace',
    startAgentIn: (branch: string | undefined) =>
      branch === undefined ? 'Start agent' : `Start agent in ${branch}`,
    blocker: 'Blocker',
    openBlocker: 'Open blocker',
    addBlockerButton: 'Add blocker',
    removeBlockerButton: 'Remove blocker',
    noBlockerCandidates: 'No open tickets can block this one.',
    noOpenBlockers: 'This ticket has no open blockers.',
    openTicket: 'Open ticket',
    /** Why the board cannot make a move, as `planTicketDrop` reports it. */
    unavailable: {
      closed: 'A closed ticket can’t be reopened from the board.',
      running: 'A ticket with a running session can’t be moved by hand.',
      noResult:
        'This ticket needs a person, but no finished session is waiting for an answer. Open it to see why.',
      answerFirst: 'Accept or send back the session’s result before moving this ticket.',
      reviewIsAutomatic:
        'Tickets reach Needs review on their own, when a question needs an answer or a session finishes.',
      mapToReady: 'A map moves to Needs review once its tickets have approved Outcomes.',
      noBlockersToRemove:
        'This ticket has no blockers to remove. Open it to see why it is blocked.',
      mapCannotStart: 'A map plans work; an agent can’t be started on it.',
      needsCheckToPrepare:
        'Add a check under “Done when” before making this ticket ready for an agent.',
      needsCheckToStart: 'Add a check under “Done when” before starting an agent.',
      notReadyForAgent: 'Make this ticket ready for an agent before starting one.',
      blockerFromReadyOnly: 'Only a Ready ticket can be given a blocker from the board.',
      mapNeedsDestination: 'A map closes once its destination spec is approved.',
      needsOutcome: 'Approve this ticket’s Outcome before closing it.',
      noMove: 'The board can’t make that move. Open the ticket to change it.',
    },
  },

  /* ── Ticket actions and menus ─────────────────────────────────────────── */
  actions: {
    cancel: 'Cancel',
    save: 'Save',
    edit: 'Edit',
    close: 'Close',
    backToWork: 'Back to Work',
    openFullView: 'Open the full view',
    startAgent: 'Start agent',
    askKira: 'Ask Kira',
    continueWithKira: 'Continue with Kira',
    takeOver: (name: string) => `Take over from ${name}`,
    fixConflicts: 'Fix conflicts with Kira',
    acceptAndClose: 'Accept and close',
    sendBack: 'Send back',
    readyForAgent: 'Ready for an agent',
    readyForPerson: 'Ready for a person',
    backToDraft: 'Back to draft',
    markDone: 'Mark done',
    wontDo: 'Won’t do',
    more: 'More ticket actions',
    backToDraftNote: 'Keep it from being started until you make it ready again.',
    stopWorking: 'Stop working on it',
    stopWorkingNote: 'Release it so someone else can work on it.',
    resolve: 'Resolve…',
    resolveNote: 'Close this ticket as done or won’t do.',
  },

  /* ── The ticket: header, sections, facts ──────────────────────────────── */
  ticket: {
    asideLabel: 'Ticket actions and details',
    crumb: (status: string, name: string) => `${status} / ${name}`,
    about: 'About',
    noDescription: 'No description yet. Edit the ticket to add one.',
    doneWhen: 'Done when',
    checks: (n: number) => count(n, 'check'),
    noChecks: 'No checks yet. Add one before making this ticket ready for an agent.',
    emptyCheck: '(empty check)',
    outcomesSoFar: 'Outcomes so far',
    moreDetails: 'More ticket details',
    moreDetailsNote: 'Sessions, workspace, blockers, and branch',
    linkedChats: 'Linked chats',
    noLinkedChats: 'No chats are linked to this ticket.',
    openChat: (title: string) => `Open chat: ${title}`,
    datesHeading: 'Created and updated',
    dates: (created: string, updated: string, closed: string | null) =>
      `created ${created} · updated ${updated}${closed === null ? '' : ` · closed ${closed}`}`,
    closedAs: (when: string, wontDo: boolean) => `${when}, ${wontDo ? 'won’t do' : 'done'}`,
    closedAsShort: (when: string, wontDo: boolean) => `${when} as ${wontDo ? 'won’t do' : 'done'}`,
  },
  facts: {
    status: 'Status',
    readyFor: 'Ready for',
    kind: 'Kind',
    workingOnIt: 'Working on it',
    createdBy: 'Created by',
    priority: 'Priority',
    created: 'Created',
    updated: 'Updated',
    closed: 'Closed',
    readyForValues: {
      draft: 'Nobody yet (draft)',
      'ready-for-agent': 'An agent',
      'ready-for-human': 'A person',
    },
    nobody: 'Nobody',
  },

  /* ── Branch and sessions ──────────────────────────────────────────────── */
  branch: {
    heading: 'Branch',
    aria: 'Branch and workspace',
    copy: 'Copy branch name',
    notCreated: 'Not created yet. Starting the agent creates it.',
    moreWorkspaces: (extra: number) =>
      `· ${extra} more ${extra === 1 ? 'workspace' : 'workspaces'}`,
    setUp: 'Set up workspace',
    open: 'Open workspace',
    made: 'A session made this branch for the ticket. It stays after the session’s workspace is removed.',
    notMade:
      'This is the name the ticket’s branch will have. Nothing has created it yet: start the agent, or make it yourself.',
  },
  sessions: {
    heading: 'Session',
    earlier: 'Earlier sessions',
    changes: 'Changes',
    commands: 'Commands it ran',
    transcript: 'Transcript',
    read: 'Open session chat',
    stillWorking: 'Nothing yet. The agent is still working.',
    saidNothing: 'The agent said nothing.',
    saidBy: { brief: 'Starting brief', agent: 'Kira', note: 'Kira', person: 'You' },
    started: (when: string, how: string) => `started ${when} · ${how}`,
    ended: (when: string, how: string) => `ended ${when} · ${how}`,
    stopped: (when: string, why: string) => `ended ${when} · stopped: ${why}`,
    how: {
      going: 'still going',
      accepted: 'accepted',
      sentBack: 'sent back',
      stopped: 'stopped',
      waiting: 'waiting for you',
    },
  },

  /* ── One line saying what a ticket is doing ───────────────────────────── */
  holding: {
    wontDo: 'won’t do',
    done: 'done',
    quiet: (name: string) => `${name} stopped responding`,
    working: (name: string, howLong: string) => `${name} working on it ${howLong}`,
    waitingForPerson: 'waiting for a person',
    waitingForReview: 'waiting for your review',
    blockersClosed: (closed: number, total: number) => `${closed} of ${total} blockers closed`,
    readiness: {
      draft: 'draft',
      'ready-for-agent': 'ready for an agent',
      'ready-for-human': 'ready for a person',
    },
  },
  time: {
    moment: 'for a moment',
    forMinutes: (n: number) => `for ${count(n, 'minute')}`,
    forHours: (n: number) => `for ${count(n, 'hour')}`,
    forDays: 'for days',
    now: 'just now',
    minutesAgo: (n: number) => `${count(n, 'minute')} ago`,
    hoursAgo: (n: number) => `${count(n, 'hour')} ago`,
  },

  /* ── Blockers ─────────────────────────────────────────────────────────── */
  blockers: {
    aria: 'Blockers',
    blockedBy: 'Blocked by',
    blocking: 'Blocking',
    progress: (closed: number, total: number) => `${closed}/${total} closed`,
    progressAria: (closed: number, total: number) =>
      `${closed} of ${count(total, 'blocker')} closed`,
    none: 'No blockers. Add a ticket that must close before this one can start.',
    waitingOne: (blocker: string, name: string) =>
      `Waiting on ${blocker}. ${name} can start once it closes.`,
    waitingMany: (open: number, total: number, name: string) =>
      `Waiting on ${open} of ${count(total, 'blocker')}. ${name} can start once they close.`,
    wontDo: (names: string, several: boolean, name: string) =>
      `${names} ${several ? 'were' : 'was'} closed as won’t do. Check ${name} still makes sense before starting it.`,
    allDoneOne: (name: string) => `Its blocker is done, so ${name} can start.`,
    allDoneMany: (total: number, name: string) =>
      `All ${total} blockers are done, so ${name} can start.`,
    add: 'Add blocker',
    pick: 'Blocker',
    pickPlaceholder: 'Choose a ticket that must close first',
    confirm: 'Add',
    cancel: 'Cancel',
    open: (name: string, title: string | null) =>
      `Open ${name}${title === null ? '' : `: ${title}`}`,
    titleUnavailable: 'Title unavailable',
    openState: 'Open',
    remove: (name: string) => `Remove ${name} as a blocker`,
    lastBlocker: 'last blocker',
    blockingCount: (n: number) => count(n, 'ticket'),
    nothingWaits: (name: string) => `No other ticket waits on ${name}.`,
  },

  /* ── New ticket and Edit ──────────────────────────────────────────────── */
  editor: {
    newTitle: 'New ticket',
    newSubtitle: 'It starts as a draft. Make it ready when it’s clear enough for someone to start.',
    kindLocked: 'Kind can’t be changed later',
    create: 'Create ticket',
    creating: 'Creating ticket…',
    createHint: 'to create',
    titleLabel: 'Title',
    titlePlaceholder: 'Ticket title',
    aboutPlaceholder: 'What to build, and why. Markdown works.',
    checkLabel: (n: number) => `Check ${n}`,
    checkPlaceholder: 'How you’ll know it’s done',
    removeCheck: (n: number) => `Remove check ${n}`,
    addCheck: 'Add check',
  },
  toolbar: {
    label: 'Formatting',
    bold: 'Bold',
    italic: 'Italic',
    code: 'Code',
    bulletedList: 'Bulleted list',
    numberedList: 'Numbered list',
    quote: 'Quote',
    codeBlock: 'Code block',
    link: 'Link',
    linkAddress: 'Link address',
    linkPlaceholder: 'https://',
    apply: 'Apply',
    removeLink: 'Remove link',
  },

  /* ── Workspace: the panel on a ticket, and its setup dialog ───────────── */
  workspace: {
    aria: 'Workspaces',
    heading: 'Workspace',
    headingNote: 'Follow the agent, its checkout, its changes, and your review from this ticket.',
    add: 'Add workspace',
    startAgent: 'Start agent',
    startNewSession: 'Start a new session',
    makeReadyFirst: 'Make this ticket ready for an agent before starting one.',
    choice: (branch: string, state: string) => `${branch} · ${state}`,
    states: {
      'not-started': 'Not started',
      running: 'Running',
      completed: 'Completed',
      failed: 'Failed',
    },
    stateWords: {
      'not-started': 'Not started',
      running: 'Agent working',
      completed: 'Ready to review',
      failed: 'Stopped',
    },
  },
  setup: {
    emptyAria: 'Set up workspace',
    emptyTitle: 'No workspace yet',
    emptyNote: 'A workspace is the checkout and branch this ticket’s agent works in.',
    button: 'Set up workspace',
    title: 'Set up workspace',
    subtitle: (name: string) => `Where ${name}’s agent works.`,
    route: 'The branch the agent will make',
    in: (folder: string) => `in ${folder}`,
    checkout: 'Checkout',
    checkoutNote: 'The repository folder the agent works in.',
    otherFolder: 'Choose another folder…',
    fromBranch: 'From branch',
    readingBranches: 'Reading branches…',
    newBranch: 'New branch',
    newBranchNote: 'Suggested from the ticket.',
    useSuggested: 'Use the suggested name',
    agent: 'Agent',
    defaultModel: 'Default model',
    startsNow: 'The agent starts as soon as the workspace is made.',
    startsLater: 'You can start the agent once the ticket is ready.',
    createAndStart: 'Create and start agent',
    create: 'Create workspace',
    creating: 'Creating workspace…',
    cancel: 'Cancel',
    branchTrouble: {
      empty: 'Name the branch the agent will work on.',
      spaces: 'A branch name can’t contain spaces.',
      invalid: 'Git won’t accept this name. Use letters, numbers, - and /.',
      sameAsBase: 'The new branch needs a different name from the branch it starts from.',
    },
  },

  /* ── Joining a project from a folder that has none ────────────────────── */
  join: {
    topNote: 'this folder isn’t linked to a project yet',
    title: 'Which project is this folder for?',
    intro:
      'A project keeps a team’s tickets and outlives any one folder. Join an existing project, or start a new one here. Nothing is written to the folder, and its chats stay where they are.',
    loading: 'Loading projects',
    existing: 'Existing projects',
    noneYet: 'There are no projects yet. This folder can be the first.',
    prefixNote: (prefix: string) => `${prefix} · tickets are named ${prefix}-1, ${prefix}-2`,
    join: 'Join',
    startHeading: 'Start a new project',
    name: 'Name',
    nameNote: 'What the project is called.',
    prefix: 'Prefix',
    prefixHelp:
      'Two to six letters or digits, starting with a letter. Tickets are named with it (like FND-1), and it can’t change later.',
    start: 'Start project',
    signedOut: 'Sign in first. Projects are kept online so your team can share them.',
    chatStillWorks: 'Chat keeps working in this folder either way.',
  },

  /* ── The Work home: choosing a project ────────────────────────────────── */
  home: {
    title: 'Work',
    subtitle: 'Your projects, and the folders where their agents work.',
    loadFailed: 'Couldn’t load projects',
    tryAgain: 'Try again',
    loading: 'Loading projects',
    emptyTitle: 'No projects yet',
    emptyNote:
      'Projects shared with you appear here. Choose one to open its tickets and pick the folder its agents work in.',
    choose: 'Choose a project',
    chooseNote:
      'Each project has one shared list of tickets. A linked folder is where its agents work on your machine.',
    projects: 'Projects',
    sharedCount: (n: number) => `${count(n, 'project')} shared with you`,
    openTickets: 'Open tickets',
    hideFolders: 'Hide folders',
    chooseFolder: 'Choose folder',
    linkFolder: 'Link this folder',
    noFolder: 'No folder linked',
    oneFolder: (name: string) => `Folder · ${name}`,
    manyFolders: (n: number) => `${n} linked folders`,
    folderHeading: (project: string) => `Choose a folder for ${project}`,
    folderNote:
      'Tickets are shared across folders. Your choice sets where agents work on this machine.',
  },
} as const;
