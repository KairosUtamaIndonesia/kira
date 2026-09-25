import { sql } from 'drizzle-orm';
import {
  bigint,
  boolean,
  index,
  integer,
  pgTable,
  primaryKey,
  jsonb,
  text,
  timestamp,
  uniqueIndex,
} from 'drizzle-orm/pg-core';

/**
 * Every table in Foundry's database, as code rather than as statements someone
 * ran once.
 *
 * The first five belong to Better Auth, which reads and writes them through its
 * Drizzle adapter. They are written out here rather than left to be migrated by
 * Better Auth itself so there is one schema and one migration history for the
 * whole database, instead of two systems quietly owning different halves of it
 * (docs/adr/0009-postgres.md). Column names are Better Auth's own field names,
 * which is what its adapter looks up — `userId`, not `user_id` — and `usage`
 * follows them, because two naming conventions in one database is worse than
 * whichever one is chosen.
 *
 * The shape here was not written from memory. Better Auth's own migrations were
 * run against a scratch database and the result dumped, and what is below
 * reproduces that dump: same names, same types, same nullability, the same
 * unique columns and the same indexes. `docs/internal/server-development.md`
 * says how to repeat that check after a Better Auth upgrade.
 */

/**
 * A person. `role` and the three `ban` fields are the admin plugin's (ADR 0007);
 * a row that predates the plugin holds no role, which the plugin reads as the
 * ordinary one.
 */
export const user = pgTable('user', {
  id: text('id').primaryKey(),
  name: text('name').notNull(),
  email: text('email').notNull().unique('user_email_key'),
  emailVerified: boolean('emailVerified').notNull(),
  image: text('image'),
  createdAt: timestamp('createdAt', { withTimezone: true })
    .notNull()
    .default(sql`CURRENT_TIMESTAMP`),
  updatedAt: timestamp('updatedAt', { withTimezone: true })
    .notNull()
    .default(sql`CURRENT_TIMESTAMP`),
  role: text('role'),
  banned: boolean('banned'),
  banReason: text('banReason'),
  banExpires: timestamp('banExpires', { withTimezone: true }),
});

/** One signed-in browser. A session is what the console carries a cookie for. */
export const session = pgTable(
  'session',
  {
    id: text('id').primaryKey(),
    expiresAt: timestamp('expiresAt', { withTimezone: true }).notNull(),
    token: text('token').notNull().unique('session_token_key'),
    createdAt: timestamp('createdAt', { withTimezone: true })
      .notNull()
      .default(sql`CURRENT_TIMESTAMP`),
    updatedAt: timestamp('updatedAt', { withTimezone: true }).notNull(),
    ipAddress: text('ipAddress'),
    userAgent: text('userAgent'),
    // A session cannot outlive its person.
    userId: text('userId')
      .notNull()
      .references(() => user.id, { onDelete: 'cascade' }),
    impersonatedBy: text('impersonatedBy'),
  },
  (table) => [index('session_userId_idx').on(table.userId)],
);

/** One way of signing in: here, the Microsoft account behind a person. */
export const account = pgTable(
  'account',
  {
    id: text('id').primaryKey(),
    accountId: text('accountId').notNull(),
    providerId: text('providerId').notNull(),
    // An account cannot outlive its person either.
    userId: text('userId')
      .notNull()
      .references(() => user.id, { onDelete: 'cascade' }),
    accessToken: text('accessToken'),
    refreshToken: text('refreshToken'),
    idToken: text('idToken'),
    accessTokenExpiresAt: timestamp('accessTokenExpiresAt', { withTimezone: true }),
    refreshTokenExpiresAt: timestamp('refreshTokenExpiresAt', { withTimezone: true }),
    scope: text('scope'),
    password: text('password'),
    createdAt: timestamp('createdAt', { withTimezone: true })
      .notNull()
      .default(sql`CURRENT_TIMESTAMP`),
    updatedAt: timestamp('updatedAt', { withTimezone: true }).notNull(),
  },
  (table) => [index('account_userId_idx').on(table.userId)],
);

/** A short-lived thing issued to be looked at once: sign-in state, an OAuth code. */
export const verification = pgTable(
  'verification',
  {
    id: text('id').primaryKey(),
    identifier: text('identifier').notNull(),
    value: text('value').notNull(),
    expiresAt: timestamp('expiresAt', { withTimezone: true }).notNull(),
    createdAt: timestamp('createdAt', { withTimezone: true })
      .notNull()
      .default(sql`CURRENT_TIMESTAMP`),
    updatedAt: timestamp('updatedAt', { withTimezone: true })
      .notNull()
      .default(sql`CURRENT_TIMESTAMP`),
  },
  (table) => [index('verification_identifier_idx').on(table.identifier)],
);

/**
 * A device key: what the desktop holds instead of a provider credential, and
 * what makes one machine revocable. `configId` is the api-key plugin's way of
 * telling several key sets apart.
 */
export const apikey = pgTable(
  'apikey',
  {
    id: text('id').primaryKey(),
    configId: text('configId').notNull(),
    name: text('name'),
    start: text('start'),
    referenceId: text('referenceId').notNull(),
    prefix: text('prefix'),
    key: text('key').notNull(),
    refillInterval: integer('refillInterval'),
    refillAmount: integer('refillAmount'),
    lastRefillAt: timestamp('lastRefillAt', { withTimezone: true }),
    enabled: boolean('enabled'),
    rateLimitEnabled: boolean('rateLimitEnabled'),
    rateLimitTimeWindow: integer('rateLimitTimeWindow'),
    rateLimitMax: integer('rateLimitMax'),
    requestCount: integer('requestCount'),
    remaining: integer('remaining'),
    lastRequest: timestamp('lastRequest', { withTimezone: true }),
    expiresAt: timestamp('expiresAt', { withTimezone: true }),
    createdAt: timestamp('createdAt', { withTimezone: true }).notNull(),
    updatedAt: timestamp('updatedAt', { withTimezone: true }).notNull(),
    permissions: text('permissions'),
    metadata: text('metadata'),
  },
  (table) => [
    index('apikey_configId_idx').on(table.configId),
    index('apikey_key_idx').on(table.key),
    index('apikey_referenceId_idx').on(table.referenceId),
  ],
);

/**
 * What one completed request used.
 *
 * Raw facts rather than counters (docs/adr/0005-allowances.md): a month-to-date
 * total, a window or a future cost estimate is a query over these rows, so
 * deciding later which window matters never means migrating a number that was
 * rolled up too early. Cache reads and writes are kept apart from input and
 * output because upstream bills them differently.
 *
 * The reference to a person is what one database buys: a usage row cannot
 * outlive the person it is about, and the database is what says so. It goes with
 * them rather than staying behind as an orphan, which is what a ledger of a
 * fairness number is worth.
 */
export const usage = pgTable(
  'usage',
  {
    id: bigint('id', { mode: 'number' }).primaryKey().generatedAlwaysAsIdentity(),
    userId: text('userId')
      .notNull()
      .references(() => user.id, { onDelete: 'cascade' }),
    model: text('model').notNull(),
    inputTokens: integer('inputTokens').notNull(),
    outputTokens: integer('outputTokens').notNull(),
    cacheReadTokens: integer('cacheReadTokens').notNull(),
    cacheWriteTokens: integer('cacheWriteTokens').notNull(),
    /** How the request ended. The vocabulary lands with the route that produces it. */
    outcome: text('outcome').notNull(),
    /**
     * Why a request that was turned away was turned away, in the words of the
     * code the caller was answered with. Null for a request that was sent.
     */
    reason: text('reason'),
    /** When the request completed. */
    at: timestamp('at', { withTimezone: true }).notNull(),
  },
  (table) => [index('usage_by_user_and_time').on(table.userId, table.at)],
);

/**
 * One person's allowance, when it is not the default.
 *
 * A row here replaces the default for that person; no row means the default
 * applies. Clearing the row is how somebody goes back to it, which is why there
 * is no sentinel number for "unlimited" (docs/adr/0005-allowances.md).
 */
export const allowance = pgTable('allowance', {
  userId: text('userId')
    .primaryKey()
    .references(() => user.id, { onDelete: 'cascade' }),
  /** Tokens per WIB calendar month, counted as input plus output. */
  tokensPerMonth: integer('tokensPerMonth').notNull(),
});

/**
 * What one person decided about memory, when it is not the default.
 *
 * Two answers, either of which a row may hold on its own: a person may name a
 * model without touching whether memory runs, or turn memory off without naming
 * one. No row means neither was decided — memory runs and no model is theirs —
 * which is the same shape an allowance uses (docs/adr/0005-allowances.md), and
 * why both columns are nullable rather than defaulted.
 *
 * The choice lives here rather than on a machine because it is the person's
 * rather than the device's: the same answer on every desktop they sign in on. It
 * is deliberately not a table of what memory *found* — that is the thread store's
 * business, in the database beside the chats it belongs to.
 */
export const memory = pgTable('memory', {
  userId: text('userId')
    .primaryKey()
    .references(() => user.id, { onDelete: 'cascade' }),
  /** Whether the observational-memory workers run. Null is "nobody has said". */
  enabled: boolean('enabled'),
  /** The model reflection runs on. Null is "no model of their own". */
  reflectingModel: text('reflectingModel'),
});

/**
 * A shared body of work: the home of one queue of tickets (docs/adr/0010).
 *
 * `prefix` is what its tickets are named under — `FND`, so that a ticket is
 * `FND-12` — and it is stored uppercase, which is what makes the unique constraint
 * below a rule about case as well as about spelling: `FND` and `fnd` cannot both
 * exist, because only one of them can. It is immutable because tickets, branches
 * and commit messages are named with it, so changing it would orphan every
 * reference to them; there is deliberately no route that writes a project after it
 * exists.
 */
export const project = pgTable('project', {
  id: text('id').primaryKey(),
  name: text('name').notNull(),
  prefix: text('prefix').notNull().unique('project_prefix_key'),
  /**
   * Who made it. Cleared rather than cascaded, unlike the usage ledger's own
   * reference: a project is shared work, so it outlives the person who wrote it.
   */
  authorId: text('authorId').references(() => user.id, { onDelete: 'set null' }),
  createdAt: timestamp('createdAt', { withTimezone: true })
    .notNull()
    .default(sql`CURRENT_TIMESTAMP`),
});

/**
 * One unit of work on a project: a contract somebody (or Kira) wrote down.
 *
 * `number` is scoped to the project and never reused, and the name people say is
 * the project's `prefix` and this number — `FND-12` — rather than the id, which is
 * opaque on purpose. The band a ticket is in is *not* a column: it is derived from
 * `gate`, `closedAt` and the gate edges, so nothing can assert a state the server
 * would not derive (docs/adr/0017).
 */
export const decision = pgTable(
  'decision',
  {
    id: text('id').primaryKey(),
    projectId: text('projectId')
      .notNull()
      .references(() => project.id, { onDelete: 'cascade' }),
    /** Why the project had to choose. Immutable once approved. */
    context: text('context').notNull(),
    /** The choice the person approved. Immutable once approved. */
    choice: text('choice').notNull(),
    /** Options considered and deliberately not chosen. */
    rejectedOptions: text('rejectedOptions').array().notNull(),
    /** The durable effects of the choice. */
    consequences: text('consequences').notNull(),
    /** The person who approved it, cleared if that person leaves. */
    authorId: text('authorId').references(() => user.id, { onDelete: 'set null' }),
    /** The chat that proposed it, when it came from a chat. */
    sourceChatId: text('sourceChatId'),
    /** The later approved Decision that superseded this one, if any. */
    supersededById: text('supersededById'),
    createdAt: timestamp('createdAt', { withTimezone: true })
      .notNull()
      .default(sql`CURRENT_TIMESTAMP`),
  },
  (table) => [index('decision_by_project').on(table.projectId, table.createdAt)],
);

export const ticket = pgTable(
  'ticket',
  {
    id: text('id').primaryKey(),
    projectId: text('projectId')
      .notNull()
      .references(() => project.id, { onDelete: 'cascade' }),
    number: integer('number').notNull(),
    /** prototype, bug, feature, refactor, question, research, spec or map — fixed when it is written. */
    kind: text('kind').notNull(),
    title: text('title').notNull(),
    /** What to build, in the words of whoever wrote it. */
    body: text('body').notNull(),
    /**
     * How it is known to be done: one line each, because the surface draws them one
     * at a time and because "is there at least one" is the rule an agent's gate
     * checks. A criterion that is empty or only whitespace is not a criterion.
     */
    criteria: text('criteria').array().notNull(),
    /** draft, ready-for-agent or ready-for-human. A value, not an absence. */
    gate: text('gate').notNull(),
    /** Orders it within a band. Ties are broken by the number, so the order is total. */
    rank: integer('rank').notNull(),
    /** Cleared rather than cascaded, for the same reason a project's is. */
    authorId: text('authorId').references(() => user.id, { onDelete: 'set null' }),
    createdAt: timestamp('createdAt', { withTimezone: true })
      .notNull()
      .default(sql`CURRENT_TIMESTAMP`),
    updatedAt: timestamp('updatedAt', { withTimezone: true })
      .notNull()
      .default(sql`CURRENT_TIMESTAMP`),
    closedAt: timestamp('closedAt', { withTimezone: true }),
    /** Why it was closed: `done` or `wontfix`, and null while it is open. */
    closure: text('closure'),
    /** The ordinary shaping chat that proposed this spec, when it has one. */
    sourceChatId: text('sourceChatId'),
  },
  (table) => [
    uniqueIndex('ticket_number_key').on(table.projectId, table.number),
    index('ticket_by_project').on(table.projectId, table.rank),
  ],
);

/**
 * One edge of the tracker's single relation: this ticket is gated by that ticket.
 *
 * There is no parent column and nothing stores a tree. A ticket names the tickets
 * that gate it, and its *children* are those tickets read from the other end — the
 * parent names its slices, so the parent is the one held out of the frontier until
 * they land, and a slice's page shows the parent it holds up (docs/adr/0017).
 */
export interface OutcomeDecisionProposal {
  context: string;
  choice: string;
  rejectedOptions: string[];
  consequences: string;
  supersedes: string | null;
}

/** A person-approved answer to a question or an autonomous research result. */
export const outcome = pgTable(
  'outcome',
  {
    id: text('id').primaryKey(),
    ticketId: text('ticketId')
      .notNull()
      .unique('outcome_ticket_key')
      .references(() => ticket.id, { onDelete: 'cascade' }),
    answer: text('answer').notNull(),
    sources: text('sources').array().notNull(),
    /** A durable Decision suggestion remains a suggestion until #94 approval. */
    decisionProposal: jsonb('decisionProposal').$type<OutcomeDecisionProposal | null>(),
    authorId: text('authorId').references(() => user.id, { onDelete: 'set null' }),
    sourceChatId: text('sourceChatId'),
    createdAt: timestamp('createdAt', { withTimezone: true })
      .notNull()
      .default(sql`CURRENT_TIMESTAMP`),
  },
  (table) => [index('outcome_by_ticket').on(table.ticketId, table.createdAt)],
);

/** The current meaning of one project term. Its version changes on every edit. */
export const glossaryEntry = pgTable(
  'glossary_entry',
  {
    id: text('id').primaryKey(),
    projectId: text('projectId')
      .notNull()
      .references(() => project.id, { onDelete: 'cascade' }),
    term: text('term').notNull(),
    meaning: text('meaning').notNull(),
    wordsToAvoid: text('wordsToAvoid').array().notNull(),
    authorId: text('authorId').references(() => user.id, { onDelete: 'set null' }),
    chatId: text('chatId').notNull(),
    version: integer('version').notNull(),
    createdAt: timestamp('createdAt', { withTimezone: true })
      .notNull()
      .default(sql`CURRENT_TIMESTAMP`),
    updatedAt: timestamp('updatedAt', { withTimezone: true })
      .notNull()
      .default(sql`CURRENT_TIMESTAMP`),
  },
  (table) => [
    uniqueIndex('glossary_entry_project_term_key').on(table.projectId, table.term),
    index('glossary_entry_by_project').on(table.projectId, table.updatedAt),
  ],
);

/** An immutable snapshot of every glossary version, including the current one. */
export const glossaryHistory = pgTable(
  'glossary_history',
  {
    id: text('id').primaryKey(),
    entryId: text('entryId')
      .notNull()
      .references(() => glossaryEntry.id, { onDelete: 'cascade' }),
    version: integer('version').notNull(),
    term: text('term').notNull(),
    meaning: text('meaning').notNull(),
    wordsToAvoid: text('wordsToAvoid').array().notNull(),
    authorId: text('authorId').references(() => user.id, { onDelete: 'set null' }),
    chatId: text('chatId').notNull(),
    changedAt: timestamp('changedAt', { withTimezone: true })
      .notNull()
      .default(sql`CURRENT_TIMESTAMP`),
  },
  (table) => [
    uniqueIndex('glossary_history_entry_version_key').on(table.entryId, table.version),
    index('glossary_history_by_entry').on(table.entryId, table.version),
  ],
);

export const gate = pgTable(
  'gate',
  {
    ticketId: text('ticketId')
      .notNull()
      .references(() => ticket.id, { onDelete: 'cascade' }),
    gatedById: text('gatedById')
      .notNull()
      .references(() => ticket.id, { onDelete: 'cascade' }),
  },
  (table) => [
    primaryKey({ columns: [table.ticketId, table.gatedById] }),
    index('gate_by_gated_by').on(table.gatedById),
  ],
);

/**
 * A ticket held while somebody works it (docs/adr/0012).
 *
 * A worker holds a claim with a lease and a heartbeat; a person working a ticket by
 * hand holds one with neither, which is why `workerId`, `heardAt` and `leaseUntil`
 * are all nullable. Nothing releases a claim on a clock: the lease exists so a worker
 * that stopped answering can be told apart from one that is working, and the read
 * answers how stale it is so that a person takes it over rather than a timer
 * reassigning somebody's work.
 */
export const claim = pgTable('claim', {
  ticketId: text('ticketId')
    .primaryKey()
    .references(() => ticket.id, { onDelete: 'cascade' }),
  /** Cascaded rather than cleared: a claim with nobody holding it means nothing. */
  holderId: text('holderId')
    .notNull()
    .references(() => user.id, { onDelete: 'cascade' }),
  /**
   * The desktop holding it, or null when a person is working it by hand.
   *
   * Restricted rather than cascaded: a claim is a lease on a machine that exists, and a
   * desktop cannot be deleted while it holds one. Deleting the desktop first would drop
   * the claim without ending the run it carries, which is the one thing a claim going
   * away must never do (GH #68).
   */
  workerId: text('workerId').references(() => worker.id, { onDelete: 'restrict' }),
  startedAt: timestamp('startedAt', { withTimezone: true })
    .notNull()
    .default(sql`CURRENT_TIMESTAMP`),
  /** When it was last heard from, or null for a claim that has no heartbeat. */
  heardAt: timestamp('heardAt', { withTimezone: true }),
  /** When its lease runs out, or null for a claim that has no lease. */
  leaseUntil: timestamp('leaseUntil', { withTimezone: true }),
});

/**
 * One agent's attempt at a ticket, in one workspace, from a claim to an end.
 *
 * A ticket has many runs and a run is never the ticket's state (docs/adr/0012). The
 * contract it was given is copied in rather than read from the ticket, because a run's
 * evidence is evidence about the criteria as they read when it started: a criterion
 * edited afterwards cannot be presented as something the run verified, and editing one
 * while a run works is a steering decision rather than a silent swap (GH #57).
 */
export const run = pgTable(
  'run',
  {
    id: text('id').primaryKey(),
    ticketId: text('ticketId')
      .notNull()
      .references(() => ticket.id, { onDelete: 'cascade' }),
    /** Who drove it: the person the ticket is for, whose allowance it spends. */
    driverId: text('driverId').references(() => user.id, { onDelete: 'set null' }),
    /** The desktop it ran on, or null when a person worked the ticket by hand. */
    workerId: text('workerId'),
    startedAt: timestamp('startedAt', { withTimezone: true })
      .notNull()
      .default(sql`CURRENT_TIMESTAMP`),
    /** The criteria as they read when the run started. */
    contract: text('contract').array().notNull(),
    /** The branch it made, or null while it has made none. */
    branch: text('branch'),
    endedAt: timestamp('endedAt', { withTimezone: true }),
    /** Why it stopped needing a person, or null when it finished what it set out to do. */
    stoppedBecause: text('stoppedBecause'),
    /** What it changed, what it ran, and what it made of it: its proposal. */
    changed: text('changed'),
    checks: text('checks').array(),
    made: text('made'),
    /** `accepted` or `sent-back` once the person has judged it, null until then. */
    verdict: text('verdict'),
    verdictAt: timestamp('verdictAt', { withTimezone: true }),
  },
  (table) => [index('run_by_ticket').on(table.ticketId, table.startedAt)],
);

/**
 * What was said while a run went on.
 *
 * A run's words are the project's, not the machine's (docs/adr/0012): the chat in the
 * window is a way of watching them, and closing the window does not lose them. An entry
 * is written once and never changed, because a transcript somebody can edit afterwards is
 * not a record of what happened. `saidBy` is who said it — the person steering, the agent
 * doing the work, or a note Foundry adds itself, such as why a run stopped.
 */
export const transcript = pgTable(
  'transcript',
  {
    id: text('id').primaryKey(),
    runId: text('runId')
      .notNull()
      .references(() => run.id, { onDelete: 'cascade' }),
    /** `person`, `agent` or `note`. */
    saidBy: text('saidBy').notNull(),
    words: text('words').notNull(),
    at: timestamp('at', { withTimezone: true })
      .notNull()
      .default(sql`CURRENT_TIMESTAMP`),
  },
  (table) => [index('transcript_by_run').on(table.runId, table.at)],
);

/**
 * A desktop that has offered itself for work (docs/adr/0012).
 *
 * A worker is online while it is being heard from, away when it is not, and gone when it
 * says so — which is why nothing here has an `online` column: online is how long ago it
 * was heard from, read at read time. A worker that stops answering keeps its claims,
 * because a claim is taken over by a person rather than released by a clock.
 */
export const worker = pgTable('worker', {
  id: text('id').primaryKey(),
  /** Cascaded: a worker is a live offering, not history, and it belongs to one person. */
  ownerId: text('ownerId')
    .notNull()
    .references(() => user.id, { onDelete: 'cascade' }),
  name: text('name').notNull(),
  /** The folders it can run in, as it names them to itself. */
  workspaces: text('workspaces').array().notNull(),
  heardAt: timestamp('heardAt', { withTimezone: true })
    .notNull()
    .default(sql`CURRENT_TIMESTAMP`),
});

/**
 * Everything, under the names Better Auth asks for. Its adapter looks up a
 * model by these keys and a field by the key inside it, so the export names are
 * part of the contract rather than a matter of taste.
 */
export const schema = {
  user,
  session,
  account,
  verification,
  apikey,
  usage,
  allowance,
  memory,
  project,
  decision,
  ticket,
  outcome,
  glossaryEntry,
  glossaryHistory,
  gate,
  claim,
  run,
  transcript,
  worker,
};
