/**
 * The single home for Work's wording: every sentence, label, tooltip, and aria-label a person
 * reads on the Work surface (board, list, drawer, full ticket view, New ticket, workspace
 * setup, blockers, filters, toasts, banners, empty states, and moving a chat into a
 * project). Components import `copy` and
 * never write a user-visible literal of their own, so wording can be read and changed here.
 * Words the server sends back on a refusal are shown as they come; the server words those in
 * `apps/server/src/messages.ts`.
 *
 * Vocabulary: a person sees Ticket, Blocker, Chat, Project, Workspace (a folder linked to a
 * project), Status, and Assignee. Never gate, issue, parent, child, dependency, claim, or
 * execution workspace. "Blocked by" and "Blocking" name the two directions. Status is the
 * word for where a ticket stands; a lane is only how the board draws a status.
 * Close puts a panel away. Ticket statuses use the same names everywhere.
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
    repositories: 'Repositories',
    skills: 'Skills',
  },

  /* ── A project's repositories, where its pull requests come from ──────── */
  repositories: {
    title: 'Repositories',
    subtitle: (project: string) => `Where ${project}’s work happens`,
    empty:
      'No repositories are attached yet. A pull request is only watched once its repository is here.',
    loading: 'Loading repositories',
    failed: 'Couldn’t load repositories.',
    remove: (owner: string, name: string) => `Remove ${owner}/${name}`,
    provider: 'Host',
    owner: 'Owner',
    ownerPlaceholder: 'acme',
    name: 'Repository',
    namePlaceholder: 'api',
    attach: 'Attach repository',
    attaching: 'Attaching',
    defaultBranch: (branch: string) => `default branch ${branch}`,
  },

  /* ── A project's skills, the methods its work is done by ──────────────── */
  skills: {
    title: 'Skills',
    subtitle: (project: string) => `How ${project}’s work is done`,
    empty:
      'No skills yet. A skill is instructions every chat in this project can use describing how something is done.',
    loading: 'Loading skills',
    failed: 'Couldn’t load skills.',
    edit: (name: string) => `Edit ${name}`,
    remove: (name: string) => `Delete ${name}`,
    fileName: 'SKILL.md',
    name: 'Name',
    namePlaceholder: 'review-checklist',
    description: 'Description',
    descriptionPlaceholder: 'What this skill is for, in one line.',
    body: 'Instructions',
    bodyPlaceholder: 'When this applies, what to check, and what to leave behind.',
    write: 'Write skill',
    save: 'Save skill',
    cancel: 'Cancel',
    /** What a skill's name has to be for Kira to be able to invoke it. */
    nameHint:
      'Lowercase letters, digits and single hyphens — this is the name Kira invokes the skill by.',
    fromChat: 'Kira wrote this in a chat',
    /* What the server says when it will not take the skill as written. */
    refused: 'That skill was not saved.',
  },

  /* ── Statuses (the board's lanes and the List's groups) ───────────────── */
  statuses: {
    'needs-review': { label: 'Needs review', note: 'ready for a person to review' },
    ready: { label: 'Ready', note: 'ready to be worked on' },
    running: { label: 'Running', note: 'being worked on now' },
    blocked: { label: 'Blocked', note: 'waiting for other tickets to close' },
    draft: { label: 'Draft', note: 'not ready to start yet' },
    done: { label: 'Done', note: 'merged and complete' },
    'wont-do': { label: 'Won’t do', note: 'work that will not be done' },
  },
  /** One status as a state word, singular: a ticket’s Status fact and a blocker’s state. */
  statusWord: {
    'needs-review': 'Needs review',
    ready: 'Ready',
    running: 'Running',
    blocked: 'Blocked',
    draft: 'Draft',
    done: 'Done',
    'wont-do': 'Won’t do',
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
    owner: 'Assignee',
    anyStatus: 'Any status',
    anyKind: 'Any kind',
    statusChip: (status: string) => `Status: ${status}`,
    kindChip: (kind: string) => `Kind: ${kind}`,
    owners: { all: 'Any assignee', assigned: 'Has an assignee', unassigned: 'No assignee' },
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
    showDone: 'Show Done and Won’t do',
  },

  /* ── Board and List ───────────────────────────────────────────────────── */
  board: {
    lanes: 'Ticket statuses; scroll sideways to see them all',
    empty: 'Nothing here.',
    doneHidden: 'Closed tickets are hidden. Turn on “Show Done and Won’t do” in Display.',
  },
  table: {
    ticket: 'Ticket',
    status: 'Status',
    kind: 'Kind',
    blockers: 'Blockers',
    owner: 'Assignee',
    updated: 'Updated',
    dragTitle: 'Drag to reorder, or move to another status',
    move: (name: string) => `Move ${name} to another status`,
  },
  row: {
    open: (name: string, title: string) => `Open ticket ${name}: ${title || UNTITLED}`,
    updated: (when: string) => `Updated ${when}`,
    blockersClosed: 'Blockers closed',
    inNewChat: 'in new chat',
    openChat: (title: string, more: number) =>
      `Open chat: ${title}${more > 0 ? `, and ${more} more linked` : ''}`,
    openChatTitle: (title: string) => `Open chat: ${title}`,
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
        'A ticket is one piece of work. Create one, link it in a chat, and work on it with the matching skill.',
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
    confirmStatus: (status: string) => `Move to ${status}`,
    addBlocker: (name: string) => `Choose a ticket that must close before ${name} can start.`,
    removeBlocker: (name: string) => `Choose a blocker to remove from ${name}.`,
    blocker: 'Blocker',
    openBlocker: 'Open blocker',
    addBlockerButton: 'Add blocker',
    removeBlockerButton: 'Remove blocker',
    noBlockerCandidates: 'No open tickets can block this one.',
    noOpenBlockers: 'This ticket has no open blockers.',
  },

  /* ── Ticket actions and menus ─────────────────────────────────────────── */
  actions: {
    cancel: 'Cancel',
    close: 'Close',
    backToWork: 'Back to Work',
    openFullView: 'Open the full view',
  },

  /* ── The ticket: header, sections, facts ──────────────────────────────── */
  ticket: {
    asideLabel: 'Ticket actions and details',
    crumb: (status: string, name: string) => `${status} / ${name}`,
    about: 'About',
    openPullRequest: 'Open pull request',
    doneWhen: 'Done when',
    checks: (n: number) => count(n, 'check'),
    outcomesSoFar: 'Outcomes so far',
    moreDetails: 'More ticket details',
    moreDetailsNote: 'Blockers, linked chats, and dates',
    linkedChats: 'Linked chats',
    noLinkedChats: 'No chats are linked to this ticket.',
    openChat: (title: string) => `Open chat: ${title}`,
    datesHeading: 'Created and updated',
    dates: (created: string, updated: string) => `created ${created} · updated ${updated}`,
    conversation: 'Conversation',
    noConversation: 'Nothing has been said or done on this ticket yet.',
    commentLabel: 'Comment',
    commentPlaceholder: 'Say something on this ticket',
    commenting: 'Commenting',
    reply: 'Reply',
    replyTo: (name: string) => `Replying to ${name}`,
    cancelReply: 'Cancel reply',
    commentRemoved: 'This comment was removed.',
    editComment: 'Edit',
    saveComment: 'Save',
    cancelEdit: 'Cancel',
    removeComment: 'Remove',
    conversationLoading: 'Loading the conversation',
    conversationFailed: 'Couldn’t load the conversation.',
    conversationRetry: 'Try again',
    kira: 'Kira',
    someone: 'Someone',
    pullRequests: 'Pull requests',
    noPullRequests: 'No pull request is linked to this ticket yet.',
    pullRequestsLoading: 'Loading pull requests',
    pullRequestsFailed: 'Couldn’t load the pull requests.',
    pullRequestBy: (who: string) => `by ${who}`,
    checksPending: 'checks running',
    checksPassed: 'checks passed',
    checksFailed: 'checks failed',
    checksNeutral: 'checks neutral',
    checksFailedOn: (names: string) => `Failed: ${names}`,
  },
  /* ── What the server recorded happening to a ticket ───────────────────── */
  activity: {
    created: 'created this ticket',
    status_changed: (from: string, to: string) => `moved this from ${from} to ${to}`,
    priority_changed: (from: string, to: string) => `changed the priority from ${from} to ${to}`,
    assignee_changed: (to: string | null) =>
      to === null ? 'unassigned this ticket' : `assigned this to ${to}`,
    title_changed: 'changed the title',
    body_updated: 'changed the description',
    checks_changed: 'changed the checks',
    blocker_added: (name: string) => `added ${name} as a blocker`,
    blocker_removed: (name: string) => `removed ${name} as a blocker`,
    pull_request_linked: 'linked a pull request',
    pull_request_merged: 'merged a pull request',
    outcome_recorded: 'recorded an Outcome',
    changed: 'changed this ticket',
  },
  facts: {
    status: 'Status',
    kind: 'Kind',
    assignee: 'Assignee',
    createdBy: 'Created by',
    priority: 'Priority',
    created: 'Created',
    updated: 'Updated',
    nobody: 'Nobody',
    assignToMe: 'Assign to me',
    unassign: 'Unassign',
  },

  /** One priority as a word, for the properties a ticket can be changed through. */
  priorities: {
    urgent: 'Urgent',
    high: 'High',
    medium: 'Medium',
    low: 'Low',
    none: 'None',
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
    remove: (name: string) => `Remove ${name} as a blocker`,
    lastBlocker: 'last blocker',
    blockingCount: (n: number) => count(n, 'ticket'),
    nothingWaits: (name: string) => `No other ticket waits on ${name}.`,
  },

  /* ── New ticket: the words of a ticket nobody has written yet ─────────── */
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

  /* ── Joining a project from a folder that has none ────────────────────── */
  join: {
    topNote: 'this folder isn’t linked to a project yet',
    title: 'Which project is this folder for?',
    intro:
      'A project keeps a team’s tickets and outlives any one folder. Join an existing project, or start a new one here.',
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
    subtitle: 'Your projects and the folders linked to them.',
    loadFailed: 'Couldn’t load projects',
    tryAgain: 'Try again',
    loading: 'Loading projects',
    emptyTitle: 'No projects yet',
    emptyNote:
      'Projects shared with you appear here. Choose one to open its tickets and link a folder on this machine.',
    choose: 'Choose a project',
    chooseNote:
      'Each project has one shared list of tickets. Link a folder to work with it on this machine.',
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
    folderNote: 'Tickets are shared across folders. Your choice sets which folder this chat uses.',
  },

  /* ── Moving a chat into a project ─────────────────────────────────────── */
  filing: {
    menu: 'Move to project…',
    menuNote: 'Work in a project’s folder from now on.',
    /** What is being approved, as the title asks about it. */
    these: {
      spec: 'this spec',
      map: 'this map',
      decision: 'this Decision',
      outcome: 'this Outcome',
      breakdown: 'these tickets',
    },
    title: (these: string) => `Where should ${these} live?`,
    moveTitle: 'Move this chat to a project',
    subtitle: 'Approving writes to a project, and this chat isn’t in one yet.',
    moveSubtitle: 'Kira works in the folder you choose from now on.',
    group: 'Where this chat goes',
    noneYet: 'No folder is in a project yet. Start one from a folder.',
    newProject: 'Start a new project',
    newProjectNote: 'in a folder you choose',
    noFolder: 'No folder chosen',
    chooseFolder: 'Choose folder…',
    changeFolder: 'Change',
    prefixHelp:
      'The prefix is two to six letters or digits, starting with a letter. Tickets are named with it, like POMO-1, and it can’t change later.',
    folderInProject: (name: string) =>
      `${name} already works a project. Choose it from the list, or pick another folder.`,
    willWork: (folder: string) => `Kira will work in ${folder} from now on.`,
    chooseToContinue: 'Choose a folder for this chat.',
    moveAndApprove: 'Move chat and approve',
    move: 'Move chat',
    moving: 'Moving…',
    refusedTitle: 'Couldn’t move this chat',
  },
} as const;
