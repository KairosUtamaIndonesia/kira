import { randomUUID } from 'node:crypto';
import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import type { FileEntry } from '@earendil-works/pi-coding-agent';
import type { ChatMode, ShapingState } from '../../preload/bridge.ts';

/**
 * Bumped whenever the statements below change shape. A database written by a
 * newer build is refused rather than misread.
 */
const SCHEMA_VERSION = 15;

export type McpServerScope = 'global' | 'workspace';
export type McpServerTransport = 'stdio' | 'streamable-http';
export type McpToolSelection = 'all' | string[];

/** Fields accepted by the store; omitted issue-80 fields retain their old defaults. */
export interface McpCredentialsDraft {
  env?: Record<string, string> | null;
  headers?: Record<string, string> | null;
  bearerToken?: string | null;
}

export interface McpServerDraft {
  name: string;
  command: string;
  args: string[];
  cwd: string | null;
  scope?: McpServerScope;
  workspaceId?: string | null;
  transport?: McpServerTransport;
  url?: string | null;
  toolSelection?: McpToolSelection;
  /** Transient IPC input; ThreadStore deliberately never persists these values. */
  credentials?: McpCredentialsDraft;
}

export interface McpServerRecord {
  id: string;
  scope: McpServerScope;
  workspaceId: string | null;
  name: string;
  transport: McpServerTransport;
  command: string;
  args: string[];
  cwd: string | null;
  url: string | null;
  toolSelection: McpToolSelection;
  enabled: boolean;
  createdAt: string;
}

export type SubagentStatus = 'running' | 'complete' | 'error' | 'stopped';
export type SubagentContext = 'task' | 'parent';
/** The durable identity and terminal result of a child delegated by a chat. */
export interface SubagentRecord {
  role: 'general';
  prompt: string;
  context: SubagentContext;
  modelId: string;
  status: SubagentStatus;
  response: string;
  error: string | null;
  startedAt: string;
  endedAt: string | null;
}

export interface ThreadRecord {
  id: string;
  cwd: string;
  mode: ChatMode;
  /** The workspace this chat is filed under, or null when it is filed nowhere. */
  workspaceId: string | null;
  /**
   * The ticket this chat is a run of, or null when it is an ordinary chat.
   *
   * A run is a chat in every other way, so this is the one thing that tells them apart —
   * and it is what the sidebar draws a ticket's run with (GH #68).
   */
  ticketId: string | null;
  /** The one-time shaping offer and latest proposal, persisted with the chat. */
  shaping: ShapingState | null;
  parentThreadId: string | null;
  /** The child session this thread stores, or null for an ordinary chat/fork. */
  subagent: SubagentRecord | null;
  /** Where the conversation was being read, when it was not at the end of it. */
  headId: string | null;
  /** The model this chat runs on, or null when nobody has chosen one for it. */
  modelId: string | null;
  createdAt: string;
  updatedAt: string;
}

/**
 * A workspace: a folder to work in, remembered, and the project it works.
 *
 * The folder is the identity — a workspace is a place, and opening a place twice
 * is opening it once — and what the sidebar calls it is derived from the folder,
 * so there is no name here to keep in step with the directory. A workspace is
 * stored the moment it is chosen, which is before anything is said in it: that is
 * the difference between a workspace and the chats filed under one.
 *
 * `projectId` is the *server's* project — the shared body of work this folder
 * works — and null is a folder nobody has joined yet, which is an ordinary state
 * rather than a broken row: a workspace is where work runs, not what work belongs
 * to (docs/adr/0010, GH #61).
 */
export interface WorkspaceRecord {
  id: string;
  folder: string;
  projectId: string | null;
  createdAt: string;
}

/**
 * One thing Kira is holding, as stored.
 *
 * `kind` and `relevance` are held as text rather than as a checked set: the
 * vocabulary is the observer's, and a table that also enforced it would be a
 * second copy of that list to keep in step, with a migration owed every time a
 * kind is added. What reads this is what checks it.
 */
export interface ObservationRecord {
  /**
   * The entry this was drawn from, so it can be checked rather than believed.
   *
   * Null for something a workspace kept from a chat that has been thrown away: the
   * entry went with the chat, so the fact is held with nothing to check it
   * against.
   */
  entryId: string | null;
  at: string;
  kind: string;
  relevance: string;
  text: string;
}

/**
 * An observation as it comes back out, which is a record plus where it lives.
 *
 * The row id is read and not written: a pass hands over what it worked out and the
 * store decides where it goes. It exists because recall is asked to take one of
 * these back to the turn it was drawn from, and what it is asked with has to be
 * something a reader of the ledger was given.
 *
 * The entry is narrowed back to one this chat holds, because what a chat reads
 * back from its own memory was written from its own turns: only what a workspace
 * kept outlives the chat that worked it out.
 */
export interface StoredObservation extends Omit<ObservationRecord, 'entryId'> {
  id: number;
  entryId: string;
}

/**
 * A conclusion this chat drew, and how much of the chat it accounts for.
 *
 * A reflection is not an observation: it is what the observations amounted to,
 * and it outlives them. Observations are recomputed from the chat on every pass
 * and replaced; a conclusion stays once it has been drawn, because the evidence
 * falling out of the ledger is not a reason to unlearn it.
 *
 * `coversThrough` is the last turn the reflector was shown when it drew this —
 * the chat as it stood then, not the set of turns this conclusion needs. Which
 * observation supported which conclusion is deliberately not recorded: that is
 * what the reference workspace prunes on, and Kira has no pruning. What the
 * number is for is going back — it is a turn `recall` accepts, so the material
 * the conclusion was drawn in front of can be read again. It is a turn number rather than an observation row
 * id, because observations are replaced whole and their ids are re-minted on
 * every pass, so an id stored here would name a different fact by the next one.
 */
export interface ReflectionRecord {
  text: string;
  coversThrough: number | null;
}

/** A reflection as it comes back out, which is a record plus where it lives. */
export interface StoredReflection extends ReflectionRecord {
  id: number;
}

/**
 * Kira's thread storage. The conversation lives here, not in pi's JSONL files.
 *
 * The shape mirrors pi's own model instead of inventing one: a thread is an
 * ordered list of entries, header first. Entries are stored verbatim in `json`
 * so new entry types need no migration, and the sibling columns exist only so
 * threads can be read without parsing every entry. The primary key is
 * (thread_id, entry_id) rather than entry_id alone because pi mints entry ids
 * as `randomUUID().slice(0, 8)` — unique within a thread, not across threads.
 */
export class ThreadStore {
  private readonly db: DatabaseSync;

  constructor(path: string) {
    if (path !== ':memory:') {
      mkdirSync(dirname(path), { recursive: true });
    }
    this.db = new DatabaseSync(path);
    // Threads and their entries must not be lost to a crash mid-write.
    this.db.exec('PRAGMA journal_mode = WAL');
    this.db.exec('PRAGMA foreign_keys = ON');
    this.migrate();
  }

  private migrate(): void {
    const row = this.db.prepare('PRAGMA user_version').get() as { user_version: number };

    if (row.user_version > SCHEMA_VERSION) {
      throw new Error(
        `Thread database is version ${row.user_version}, but this build understands ${SCHEMA_VERSION}. Refusing to open it.`,
      );
    }

    if (row.user_version === SCHEMA_VERSION) {
      return;
    }

    if (row.user_version === 0) {
      this.db.exec(`
        CREATE TABLE workspaces (
          id         TEXT PRIMARY KEY,
          folder     TEXT NOT NULL UNIQUE,
          project_id TEXT,
          created_at TEXT NOT NULL
        );

        CREATE TABLE threads (
          id               TEXT PRIMARY KEY,
          cwd              TEXT NOT NULL,
          workspace_id     TEXT REFERENCES workspaces(id) ON DELETE SET NULL,
          parent_thread_id TEXT REFERENCES threads(id),
          ticket_id        TEXT,
          shaping_json     TEXT,
          head_id          TEXT,
          model_id         TEXT,
          archived_at      TEXT,
          subagent_json    TEXT,
          created_at       TEXT NOT NULL,
          updated_at       TEXT NOT NULL
        );

        CREATE TABLE entries (
          thread_id TEXT NOT NULL REFERENCES threads(id) ON DELETE CASCADE,
          entry_id  TEXT NOT NULL,
          seq       INTEGER NOT NULL,
          parent_id TEXT,
          type      TEXT NOT NULL,
          timestamp TEXT NOT NULL,
          json      TEXT NOT NULL,
          PRIMARY KEY (thread_id, entry_id)
        );

        CREATE INDEX entries_by_sequence ON entries (thread_id, seq);

        CREATE TABLE observations (
          id        INTEGER PRIMARY KEY,
          thread_id TEXT NOT NULL REFERENCES threads(id) ON DELETE CASCADE,
          entry_id  TEXT NOT NULL,
          at        TEXT NOT NULL,
          kind      TEXT NOT NULL,
          relevance TEXT NOT NULL,
          text      TEXT NOT NULL
        );

        CREATE INDEX observations_by_thread ON observations (thread_id, id);

        CREATE TABLE reflections (
          id             INTEGER PRIMARY KEY,
          thread_id      TEXT NOT NULL REFERENCES threads(id) ON DELETE CASCADE,
          covers_through INTEGER,
          text           TEXT NOT NULL,
          UNIQUE (thread_id, text)
        );

        CREATE INDEX reflections_by_thread ON reflections (thread_id, id);

        CREATE TABLE workspace_observations (
          id           INTEGER PRIMARY KEY,
          workspace_id TEXT NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
          at           TEXT NOT NULL,
          kind         TEXT NOT NULL,
          relevance    TEXT NOT NULL,
          text         TEXT NOT NULL,
          UNIQUE (workspace_id, kind, text)
        );
      `);
    }

    // A chat used to have no memory of which branch it was being read on, so a
    // switch was lost the moment the window closed. Now it keeps one.
    if (row.user_version === 1) {
      this.db.exec('ALTER TABLE threads ADD COLUMN head_id TEXT');
      this.addProjects();
      this.addObservations();
    }

    // A chat used to work in a folder of its own, which is the only reason two
    // chats could never work in the same directory. A workspace is that folder.
    if (row.user_version === 2) {
      this.addProjects();
      this.addObservations();
    }

    // A chat can be put away without being thrown away: one that is put away
    // keeps its row and leaves the list, which is a column the list reads and
    // every database written before it has to come out of here with. A fresh
    // one is created with it, so only a database that already existed is asked —
    // and only one from before version 4, because a database written since has
    // the column already and asking for it twice is an error rather than a
    // no-op.
    if (row.user_version >= 1 && row.user_version < 4) {
      this.db.exec('ALTER TABLE threads ADD COLUMN archived_at TEXT');
    }

    // A chat runs on one model, and which one is the person's to choose rather
    // than the catalog's first. A chat that chose none keeps choosing none: what
    // the pool prefers is a better answer than a model written down here when
    // nobody ever picked one.
    if (row.user_version >= 1 && row.user_version < 5) {
      this.db.exec('ALTER TABLE threads ADD COLUMN model_id TEXT');
    }

    // Kira used to forget everything but the words of a chat: what the work was,
    // which files it touched and what the person asked for were worked out again
    // at each compaction and thrown away between them. They are kept now, beside
    // the chat, and a database written before they were gains somewhere to put
    // them.
    if (row.user_version >= 3 && row.user_version < 6) {
      this.addObservations();
    }

    // A chat used to hold only what it noticed. It now also holds what it worked
    // out, which is the part a model draws and the part worth keeping. Every
    // version before this one is asked, so a database written before memory
    // existed at all arrives here too.
    if (row.user_version >= 1 && row.user_version < 7) {
      this.addReflections();
    }

    // A chat that was thrown away used to take what it had worked out with it,
    // even when it was filed under a workspace — so deleting one chat quietly took
    // a decision out of the memory of every chat beside it, which is the opposite
    // of what filing them together is for. A chat filed under a workspace hands
    // what it worked out to the workspace on its way out, and a database written
    // before that has nowhere to put it.
    if (row.user_version >= 1 && row.user_version < 8) {
      this.addProjectObservations();
    }

    // A folder stopped being called a project. The desktop's own record of a folder
    // is the workspace the domain already calls it, and a workspace now carries the
    // server project it works — which is what opening a folder to join one writes.
    // Nothing is re-filed and nothing is lost: the tables are renamed, their rows
    // come with them, and every chat keeps the folder it was in (GH #65).
    if (row.user_version >= 1 && row.user_version < 9) {
      this.toWorkspaces();
    }

    // A run is a chat, and a chat had no way to say it was one — so nothing could tell a
    // run in the sidebar from a conversation somebody had, and a run that was over had to
    // be thrown away rather than kept to be read. A chat says which ticket it is a run of,
    // and every database written before that gains somewhere to say it (GH #68).
    if (row.user_version >= 1 && row.user_version < 10) {
      this.db.exec('ALTER TABLE threads ADD COLUMN ticket_id TEXT');
    }

    // Shaping is a per-chat decision, not a transient window hint. Keeping it
    // beside the thread prevents a dismissed offer or approved proposal from
    // returning when the chat is reopened.
    if (row.user_version >= 1 && row.user_version < 11) {
      const columns = this.db.prepare('PRAGMA table_info(threads)').all() as { name: string }[];
      if (!columns.some((column) => column.name === 'shaping_json')) {
        this.db.exec('ALTER TABLE threads ADD COLUMN shaping_json TEXT');
      }
    }
    // Add the MCP table before upgrading its feature columns. This also repairs
    // databases whose version marker advanced without all MCP columns.
    if (row.user_version < 12) {
      this.addMcpServers();
      this.addMcpServerFeatures();
    }
    if (row.user_version < 13) {
      this.addMcpServerFeatures();
      this.addMcpServerScopeIndexes();
    }
    if (row.user_version < 14) {
      const columns = this.db.prepare('PRAGMA table_info(threads)').all() as { name: string }[];
      if (!columns.some((column) => column.name === 'subagent_json')) {
        this.db.exec('ALTER TABLE threads ADD COLUMN subagent_json TEXT');
      }
    }
    if (row.user_version < 15) {
      const columns = this.db.prepare('PRAGMA table_info(threads)').all() as { name: string }[];
      if (!columns.some((column) => column.name === 'mode')) {
        this.db.exec("ALTER TABLE threads ADD COLUMN mode TEXT NOT NULL DEFAULT 'build'");
      }
    }
    this.db.exec(`PRAGMA user_version = ${SCHEMA_VERSION}`);
  }

  /**
   * The rename a folder's record goes through, and the project it gains.
   *
   * `projects` becomes `workspaces` and a chat's `project_id` becomes its
   * `workspace_id`, because a folder is the workspace a run happens in and the word
   * project now means the server's shared body of work. The workspace table gains a
   * `project_id` of its own, which is that server project: null is a folder nobody
   * has joined yet, which is an ordinary state rather than a broken row.
   *
   * The rows are not touched. A workspace keeps its folder, every chat keeps the
   * workspace it was filed under, and what a chat worked out stays where it was
   * kept — the tables are renamed under the rows, and SQLite rewrites the foreign
   * keys that point at them.
   */
  private toWorkspaces(): void {
    this.db.exec(`
      ALTER TABLE projects RENAME TO workspaces;
      ALTER TABLE project_observations RENAME TO workspace_observations;
      ALTER TABLE workspace_observations RENAME COLUMN project_id TO workspace_id;
      ALTER TABLE threads RENAME COLUMN project_id TO workspace_id;
      ALTER TABLE workspaces ADD COLUMN project_id TEXT;
    `);
  }

  /**
   * Give a database that predates projects somewhere to file them.
   *
   * Spelled in the shape it had then — a table called `projects`, and a chat's
   * column called `project_id` — because a database at this version is being brought
   * forward one step at a time, and the step that renames them comes later. What
   * happens to a chat when its workspace goes is the reason for `SET NULL`: the
   * workspace is a filing, and the chat is not the workspace's to take with it.
   */
  private addProjects(): void {
    this.db.exec(`
      CREATE TABLE projects (
        id         TEXT PRIMARY KEY,
        folder     TEXT NOT NULL UNIQUE,
        created_at TEXT NOT NULL
      );

      ALTER TABLE threads ADD COLUMN project_id TEXT REFERENCES projects(id) ON DELETE SET NULL;
    `);
  }

  /**
   * Give a database that predates memory somewhere to hold it.
   *
   * The order rows are read back in is the order they were written, which is the
   * order the chat first said them: `id` is here for that and for nothing else.
   */
  private addObservations(): void {
    this.db.exec(`
      CREATE TABLE observations (
        id        INTEGER PRIMARY KEY,
        thread_id TEXT NOT NULL REFERENCES threads(id) ON DELETE CASCADE,
        entry_id  TEXT NOT NULL,
        at        TEXT NOT NULL,
        kind      TEXT NOT NULL,
        relevance TEXT NOT NULL,
        text      TEXT NOT NULL
      );

      CREATE INDEX observations_by_thread ON observations (thread_id, id);
    `);
  }

  /**
   * Give a chat somewhere to keep what it worked out.
   *
   * `UNIQUE (thread_id, text)` is the whole duplicate rule: the same conclusion
   * offered twice is one conclusion, so it is a fact about the table rather than
   * a check somebody has to remember to make. The thread is part of the key
   * because the same words can mean different things in two chats.
   */
  private addReflections(): void {
    this.db.exec(`
      CREATE TABLE reflections (
        id             INTEGER PRIMARY KEY,
        thread_id      TEXT NOT NULL REFERENCES threads(id) ON DELETE CASCADE,
        covers_through INTEGER,
        text           TEXT NOT NULL,
        UNIQUE (thread_id, text)
      );

      CREATE INDEX reflections_by_thread ON reflections (thread_id, id);
    `);
  }

  /**
   * Give a workspace somewhere to keep what a chat worked out when the chat is gone.
   *
   * A chat's own memory is written under the chat and worked out from it again on
   * every pass, so it lives with the chat and goes with the chat — right for one
   * filed nowhere, and wrong for one filed under a workspace, where what each chat
   * works out is the reason to file them together at all. A chat on its way out
   * therefore leaves its memory with its workspace, and this is where it lands.
   *
   * Nothing here names the entry it was worked out on, because that entry was in
   * the chat that is gone: what is kept is what was worked out, which a chat
   * beside it carries as something Kira knows rather than something she can check.
   *
   * `UNIQUE (workspace_id, kind, text)` is the duplicate rule, the same one
   * reflections use: two chats working out the same thing is one thing the workspace
   * knows. The kind is part of the key because the same words about one file can be
   * two things — a chat that read it and a chat that changed it — and a summary
   * carries the change and drops the read, so keeping only whichever came first
   * would lose the fact that matters to the order two chats were thrown away in.
   *
   * `ON DELETE CASCADE` is the decision about forgetting a workspace, rather than a
   * default: a workspace is the reason these were kept, so forgetting it forgets
   * them. The chats that are still here keep their own memory either way.
   *
   * What goes in is ordered by when it was worked out rather than by where the row
   * sits, so that the same thing recorded in two chats is dated by the first time
   * the work turned it up and not by which chat happened to be thrown away first.
   */
  private addProjectObservations(): void {
    this.db.exec(`
      CREATE TABLE project_observations (
        id         INTEGER PRIMARY KEY,
        project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
        at         TEXT NOT NULL,
        kind       TEXT NOT NULL,
        relevance  TEXT NOT NULL,
        text       TEXT NOT NULL,
        UNIQUE (project_id, kind, text)
      );
    `);
  }

  /** Give the desktop database a place for Kira-owned MCP configuration. */
  private addMcpServers(): void {
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS mcp_servers (
        id           TEXT PRIMARY KEY,
        scope        TEXT NOT NULL,
        workspace_id TEXT REFERENCES workspaces(id) ON DELETE CASCADE,
        name         TEXT NOT NULL,
        command      TEXT NOT NULL,
        args_json    TEXT NOT NULL,
        cwd          TEXT,
        enabled      INTEGER NOT NULL DEFAULT 1,
        created_at   TEXT NOT NULL
      );
    `);
  }

  /**
   * Replace the issue-80 global-name constraint with the per-scope rules.
   *
   * A global name is unique on its own; workspace names are unique within their
   * workspace. A single nullable composite unique constraint cannot express both,
   * because SQLite treats every NULL workspace as distinct.
   */
  private addMcpServerScopeIndexes(): void {
    this.db.exec('BEGIN IMMEDIATE');
    try {
      this.db.exec(`
      DROP TABLE IF EXISTS mcp_servers_v13;
      CREATE TABLE mcp_servers_v13 (
        id           TEXT PRIMARY KEY,
        scope        TEXT NOT NULL,
        workspace_id TEXT REFERENCES workspaces(id) ON DELETE CASCADE,
        name         TEXT NOT NULL,
        command      TEXT NOT NULL,
        args_json    TEXT NOT NULL,
        cwd          TEXT,
        enabled      INTEGER NOT NULL DEFAULT 1,
        created_at   TEXT NOT NULL,
        transport    TEXT NOT NULL DEFAULT 'stdio',
        url          TEXT,
        tool_selection_json TEXT NOT NULL DEFAULT '"all"'
      );
      INSERT INTO mcp_servers_v13
        (id, scope, workspace_id, name, command, args_json, cwd, enabled, created_at, transport, url, tool_selection_json)
      SELECT id, scope, workspace_id, name, command, args_json, cwd, enabled, created_at, transport, url, tool_selection_json
        FROM mcp_servers;
      DROP TABLE mcp_servers;
      ALTER TABLE mcp_servers_v13 RENAME TO mcp_servers;
      CREATE UNIQUE INDEX mcp_servers_global_name ON mcp_servers(name) WHERE scope = 'global';
      CREATE UNIQUE INDEX mcp_servers_workspace_name ON mcp_servers(workspace_id, name) WHERE scope = 'workspace';
      `);
      this.db.exec('COMMIT');
    } catch (error) {
      this.db.exec('ROLLBACK');
      throw error;
    }
  }

  /** Add transport and tool-selection choices without recreating historical tables. */
  private addMcpServerFeatures(): void {
    const columns = new Set(
      (this.db.prepare('PRAGMA table_info(mcp_servers)').all() as Array<{ name: string }>).map(
        (column) => column.name,
      ),
    );
    if (!columns.has('transport')) {
      this.db.exec("ALTER TABLE mcp_servers ADD COLUMN transport TEXT NOT NULL DEFAULT 'stdio'");
    }
    if (!columns.has('url')) {
      this.db.exec('ALTER TABLE mcp_servers ADD COLUMN url TEXT');
    }
    if (!columns.has('tool_selection_json')) {
      this.db.exec(
        `ALTER TABLE mcp_servers ADD COLUMN tool_selection_json TEXT NOT NULL DEFAULT '"all"'`,
      );
    }
  }

  /**
   * Store a thread and hand it back. `id` is for a chat whose id was decided
   * before it was stored — a new chat is composed under the id it will keep, so
   * the window never has to change which chat it is showing when words arrive.
   */
  createThread(
    cwd: string,
    options: {
      id?: string;
      parentThreadId?: string;
      workspaceId?: string;
      ticketId?: string;
      subagent?: SubagentRecord;
      mode?: ChatMode;
    } = {},
  ): ThreadRecord {
    const id = options.id ?? randomUUID();
    const now = new Date().toISOString();
    const parentThreadId = options.parentThreadId ?? null;
    const workspaceId = options.workspaceId ?? null;
    const ticketId = options.ticketId ?? null;
    const subagent = options.subagent ?? null;
    const mode = options.mode ?? 'build';

    this.db
      .prepare(
        'INSERT INTO threads (id, cwd, workspace_id, parent_thread_id, ticket_id, shaping_json, subagent_json, mode, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
      )
      .run(
        id,
        cwd,
        workspaceId,
        parentThreadId,
        ticketId,
        null,
        subagentJsonOf(subagent),
        mode,
        now,
        now,
      );

    return {
      id,
      cwd,
      mode,
      workspaceId,
      ticketId,
      shaping: null,
      parentThreadId,
      subagent,
      headId: null,
      modelId: null,
      createdAt: now,
      updatedAt: now,
    };
  }

  /**
   * Remember a folder as a workspace, and hand it back. Opening a folder twice is
   * opening the same place, so one that is already remembered is returned rather
   * than added again — and a workspace that already works a project keeps it.
   *
   * Chats already working in that folder are filed under it. That is what makes
   * forgetting a workspace something you can take back: the chats stay where they
   * were working, so the folder still finds them.
   */
  rememberWorkspace(folder: string): WorkspaceRecord {
    const existing = this.workspaceAt(folder);
    const record = existing ?? this.insertWorkspace(folder);

    this.db
      .prepare('UPDATE threads SET workspace_id = ? WHERE cwd = ? AND workspace_id IS NULL')
      .run(record.id, folder);

    return record;
  }

  /** The workspace this folder is, or undefined when it has never been opened. */
  workspaceAt(folder: string): WorkspaceRecord | undefined {
    const row = this.db.prepare(`${WORKSPACE_COLUMNS} WHERE folder = ?`).get(folder) as
      | WorkspaceRow
      | undefined;

    return row === undefined ? undefined : workspaceRecordOf(row);
  }

  /**
   * Join a workspace to a project.
   *
   * What a folder works is one answer, so this replaces whatever was there rather
   * than accumulating. The answer lives on the folder's own record rather than on
   * the server: two folders may work one project, and one project may be worked
   * from a checkout the server has never heard of (GH #61).
   */
  joinWorkspace(id: string, projectId: string): WorkspaceRecord | undefined {
    this.db.prepare('UPDATE workspaces SET project_id = ? WHERE id = ?').run(projectId, id);

    return this.findWorkspace(id);
  }

  private insertWorkspace(folder: string): WorkspaceRecord {
    const id = randomUUID();
    const now = new Date().toISOString();
    this.db
      .prepare('INSERT INTO workspaces (id, folder, project_id, created_at) VALUES (?, ?, ?, ?)')
      .run(id, folder, null, now);

    return { id, folder, projectId: null, createdAt: now };
  }

  /**
   * The workspace stored under `id`, or undefined when there is none.
   *
   * A workspace can be forgotten while a chat is being composed for it, and that
   * chat still has to be made somewhere: asked this way, the answer is "no
   * longer there" rather than a failure the caller has to catch.
   */
  findWorkspace(id: string): WorkspaceRecord | undefined {
    const row = this.db.prepare(`${WORKSPACE_COLUMNS} WHERE id = ?`).get(id) as
      | WorkspaceRow
      | undefined;

    return row === undefined ? undefined : workspaceRecordOf(row);
  }

  /**
   * Every workspace, the first one chosen first. Deliberately not by recency: a
   * chat moves up the list when it is opened, and workspaces sitting above them
   * should not reshuffle for the same reason.
   */
  listWorkspaces(): WorkspaceRecord[] {
    const rows = this.db
      .prepare(`${WORKSPACE_COLUMNS} ORDER BY created_at, rowid`)
      .all() as unknown as WorkspaceRow[];

    return rows.map(workspaceRecordOf);
  }

  /**
   * Forget a workspace. What is left of the chats that are gone goes with it: a
   * workspace is the reason their work was kept, so forgetting it forgets them,
   * which is the foreign key's job rather than this function's — there is no
   * workspace left to keep them for. The chats still here are not the workspace's to
   * lose: they keep their conversations and their own memory, and keep working in
   * the folder they were already working in — they are simply filed nowhere until
   * they are filed somewhere again. Forgetting one that is already gone is not a
   * failure; it is the same state.
   */
  forgetWorkspace(id: string): void {
    this.db.prepare('DELETE FROM workspaces WHERE id = ?').run(id);
  }

  /**
   * The chat stored under this id, or undefined when nothing is stored under it.
   *
   * A chat being composed has no record yet, so "nothing is stored here" is an
   * answer rather than a failure — it is what the workbench reads as a chat with
   * no workspace yet, and what keeps the draft out of every path that resolves a
   * chat to the folder it works in.
   */
  findThread(id: string): ThreadRecord | undefined {
    const row = this.db.prepare(`${THREAD_COLUMNS} WHERE id = ?`).get(id) as ThreadRow | undefined;

    return row === undefined ? undefined : threadRecordOf(row);
  }

  getThread(id: string): ThreadRecord {
    const thread = this.findThread(id);

    if (thread === undefined) {
      throw new Error(`No thread stored with id ${id}.`);
    }

    return thread;
  }

  /**
   * Every chat in the list: every stored thread that has not been put away,
   * the one with the most recent conversation activity first. A chat that has
   * been put away is out of the list and still stored, which is the difference
   * between putting one away and throwing one away. The chat list uses this as
   * its default order. Ties on `updated_at` — two chats touched inside the same
   * millisecond — are broken by insertion order so the order is never arbitrary:
   * a relaunch has to reopen the same chat twice running.
   */
  listThreads(): ThreadRecord[] {
    const rows = this.db
      .prepare(
        `${THREAD_COLUMNS} WHERE archived_at IS NULL AND subagent_json IS NULL ORDER BY updated_at DESC, rowid DESC`,
      )
      .all() as unknown as ThreadRow[];

    return rows.map(threadRecordOf);
  }

  /**
   * Put a chat away: it leaves the list and keeps everything it holds.
   *
   * Nothing is closed and nothing is taken, so it is read again by its id
   * exactly as it was — the row, its words and the folder it worked in all
   * stay. That is the difference between putting one away and throwing one away.
   */
  archiveThread(id: string): void {
    this.db
      .prepare('UPDATE threads SET archived_at = ? WHERE id = ?')
      .run(new Date().toISOString(), id);
  }

  /**
   * Bring a chat back from being put away: it rejoins the list, in whatever
   * place its `updated_at` already puts it there — putting it away never
   * touched that.
   */
  unarchiveThread(id: string): void {
    this.db.prepare('UPDATE threads SET archived_at = NULL WHERE id = ?').run(id);
  }

  /**
   * Throw a chat away: the row, every entry under it, and what it was holding.
   *
   * A chat forked from this one is a chat of its own — it keeps its words and
   * only forgets where it came from, which is why its link is unhooked rather
   * than taken with the chat it points at. The folder is not touched either:
   * a chat is what was said, and a folder is what someone put there.
   *
   * What the chat worked out goes with it, except for its workspace: a chat filed
   * under one leaves that behind first, because a decision made in one chat of a
   * workspace is what the chats beside it are for.
   */
  deleteThread(id: string): void {
    this.db.exec('BEGIN');
    try {
      // Child sessions belong to their parent. Forks are ordinary chats and keep
      // their words, so only rows carrying child metadata are removed here.
      this.db
        .prepare('DELETE FROM threads WHERE parent_thread_id = ? AND subagent_json IS NOT NULL')
        .run(id);
      this.db
        .prepare('UPDATE threads SET parent_thread_id = NULL WHERE parent_thread_id = ?')
        .run(id);

      // Before the row goes, because what a chat is holding is stored under the
      // chat and the deletion takes it — which is the point, for a chat that is
      // filed nowhere and has nothing to leave it to.
      this.keepWorkspaceObservations(id);

      this.db.prepare('DELETE FROM threads WHERE id = ?').run(id);
      this.db.exec('COMMIT');
    } catch (error) {
      this.db.exec('ROLLBACK');
      throw error;
    }
  }

  /**
   * Leave what a chat worked out with the workspace it is filed under, if it is.
   *
   * Nothing is taken from the chat here: the rows stay under it until the thread
   * goes, which is what makes a deletion that is rolled back a deletion that
   * changed nothing. A chat filed nowhere leaves nothing, which is the same thing
   * as having nowhere to leave it.
   */
  private keepWorkspaceObservations(threadId: string): void {
    const workspaceId = this.findThread(threadId)?.workspaceId ?? null;
    if (workspaceId === null) return;

    this.db
      .prepare(
        `INSERT OR IGNORE INTO workspace_observations (workspace_id, at, kind, relevance, text)
         SELECT ?, at, kind, relevance, text FROM observations WHERE thread_id = ? ORDER BY at, id`,
      )
      .run(workspaceId, threadId);
  }

  loadEntries(threadId: string): FileEntry[] {
    const rows = this.db
      .prepare('SELECT json FROM entries WHERE thread_id = ? ORDER BY seq')
      .all(threadId) as { json: string }[];

    return rows.map((row) => JSON.parse(row.json) as FileEntry);
  }

  /**
   * The entries this chat stands on, from its first to the one it now stands at.
   *
   * A session is append-only and a branch only moves the leaf, so the entries a
   * thread holds include those on branches nobody is on any more — going back to
   * an earlier entry must not destroy the ones after it. They are still stored,
   * but they are no longer part of this chat, and searching them would find work
   * nobody is doing. This is the set pi shows a model, worked out the same way:
   * from where the chat stands, up through the parents, then back into the order
   * they were said.
   */
  branchEntries(threadId: string): FileEntry[] {
    const held = this.loadEntries(threadId);
    const byId = new Map(held.map((entry) => [entry.id, entry]));
    const branch: FileEntry[] = [];

    // Where the chat stands — or, where nothing ever recorded that, the entry pi
    // itself takes as the leaf when it loads the list: the last one. A chat
    // copied out of another is stored exactly this way, with no position of its
    // own, and reading it as empty would make a fork invisible to a search.
    let at: string | null = this.findThread(threadId)?.headId ?? held[held.length - 1]?.id ?? null;
    while (at !== null) {
      const entry = byId.get(at);
      if (entry === undefined) break;

      branch.push(entry);
      at = parentIdOf(entry);
    }

    return branch.reverse();
  }

  /**
   * Append one entry, or refresh it in place if it already exists. Called for
   * every entry pi appends, so it stays O(1) and preserves the existing `seq`.
   */
  appendEntry(threadId: string, entry: FileEntry): void {
    const existing = this.db
      .prepare('SELECT seq FROM entries WHERE thread_id = ? AND entry_id = ?')
      .get(threadId, entry.id) as { seq: number } | undefined;

    if (existing) {
      this.db
        .prepare(
          'UPDATE entries SET parent_id = ?, type = ?, timestamp = ?, json = ? WHERE thread_id = ? AND entry_id = ?',
        )
        .run(
          parentIdOf(entry),
          entry.type,
          entry.timestamp,
          JSON.stringify(entry),
          threadId,
          entry.id,
        );
      this.touch(threadId);
    } else {
      const next = this.db
        .prepare('SELECT COALESCE(MAX(seq), -1) + 1 AS seq FROM entries WHERE thread_id = ?')
        .get(threadId) as { seq: number };

      this.insert(threadId, entry, next.seq);
      // A new entry is where pi now stands; a rewritten one is not a move.
      this.touch(threadId, entry.id);
    }
  }

  /**
   * Remember where the conversation is being read. A branch switch appends
   * nothing, so this is the only record that it happened at all.
   */
  setHead(threadId: string, headId: string): void {
    this.db.prepare('UPDATE threads SET head_id = ? WHERE id = ?').run(headId, threadId);
  }

  /**
   * Remember which model this chat runs on, which is the person's choice rather
   * than a property of the chat: a chat resumed without one runs on what the
   * pool prefers.
   */
  setThreadModel(threadId: string, modelId: string): void {
    this.db.prepare('UPDATE threads SET model_id = ? WHERE id = ?').run(modelId, threadId);
  }
  /** Remember whether this chat plans work or edits the workspace. */
  setThreadMode(threadId: string, mode: ChatMode): void {
    this.db.prepare('UPDATE threads SET mode = ? WHERE id = ?').run(mode, threadId);
  }

  /** Persist the shaping offer and current proposal without touching chat activity. */
  setThreadShaping(threadId: string, shaping: ShapingState): void {
    this.db
      .prepare('UPDATE threads SET shaping_json = ? WHERE id = ?')
      .run(JSON.stringify(shaping), threadId);
  }

  /** Store one MCP server, globally or for one remembered workspace. */
  createMcpServer(draft: McpServerDraft): McpServerRecord {
    const id = randomUUID();
    const now = new Date().toISOString();
    const normalized = normalizedMcpDraft(draft);
    if (normalized.scope === 'workspace') {
      if (
        normalized.workspaceId === null ||
        this.findWorkspace(normalized.workspaceId) === undefined
      ) {
        throw new Error('That MCP workspace does not exist.');
      }
    }

    this.db
      .prepare(
        `INSERT INTO mcp_servers
          (id, scope, workspace_id, name, transport, command, args_json, cwd, url, tool_selection_json, enabled, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1, ?)`,
      )
      .run(
        id,
        normalized.scope,
        normalized.workspaceId,
        normalized.name,
        normalized.transport,
        normalized.command,
        JSON.stringify(normalized.args),
        normalized.cwd,
        normalized.url,
        JSON.stringify(normalized.toolSelection),
        now,
      );

    return {
      id,
      scope: normalized.scope,
      workspaceId: normalized.workspaceId,
      name: normalized.name,
      transport: normalized.transport,
      command: normalized.command,
      args: normalized.args,
      cwd: normalized.cwd,
      url: normalized.url,
      toolSelection: normalized.toolSelection,
      enabled: true,
      createdAt: now,
    };
  }

  /** Update one MCP server's saved configuration. */
  updateMcpServer(id: string, draft: McpServerDraft): McpServerRecord | undefined {
    const normalized = normalizedMcpDraft(draft);
    if (normalized.scope === 'workspace') {
      if (
        normalized.workspaceId === null ||
        this.findWorkspace(normalized.workspaceId) === undefined
      ) {
        throw new Error('That MCP workspace does not exist.');
      }
    }
    this.db
      .prepare(
        `UPDATE mcp_servers
            SET scope = ?, workspace_id = ?, name = ?, transport = ?, command = ?, args_json = ?, cwd = ?, url = ?, tool_selection_json = ?
          WHERE id = ?`,
      )
      .run(
        normalized.scope,
        normalized.workspaceId,
        normalized.name,
        normalized.transport,
        normalized.command,
        JSON.stringify(normalized.args),
        normalized.cwd,
        normalized.url,
        JSON.stringify(normalized.toolSelection),
        id,
      );
    return this.findMcpServer(id);
  }

  /** Persist whether one MCP server may connect. */
  setMcpServerEnabled(id: string, enabled: boolean): McpServerRecord | undefined {
    this.db.prepare('UPDATE mcp_servers SET enabled = ? WHERE id = ?').run(enabled ? 1 : 0, id);
    return this.findMcpServer(id);
  }

  /** Persist the set of tools a server may expose, or 'all'. */
  setMcpServerToolSelection(
    id: string,
    toolSelection: McpToolSelection,
  ): McpServerRecord | undefined {
    this.db
      .prepare('UPDATE mcp_servers SET tool_selection_json = ? WHERE id = ?')
      .run(JSON.stringify(toolSelection), id);
    return this.findMcpServer(id);
  }

  /** Every MCP server, in creation order. */
  listMcpServers(): McpServerRecord[] {
    const rows = this.db
      .prepare(
        `SELECT id, scope, workspace_id, name, transport, command, args_json, cwd, url, tool_selection_json, enabled, created_at
           FROM mcp_servers
          ORDER BY created_at, rowid`,
      )
      .all() as unknown as McpServerRow[];

    return rows.map(mcpServerRecordOf);
  }

  /** MCP servers saved for one workspace. */
  listMcpServersForWorkspace(workspaceId: string): McpServerRecord[] {
    return this.listMcpServers().filter(
      (server) => server.scope === 'workspace' && server.workspaceId === workspaceId,
    );
  }

  /** The MCP server stored under id, or undefined when it is gone. */
  findMcpServer(id: string): McpServerRecord | undefined {
    const row = this.db
      .prepare(
        `SELECT id, scope, workspace_id, name, transport, command, args_json, cwd, url, tool_selection_json, enabled, created_at
           FROM mcp_servers
          WHERE id = ?`,
      )
      .get(id) as McpServerRow | undefined;

    return row === undefined ? undefined : mcpServerRecordOf(row);
  }

  /** Remove an MCP server's saved configuration. */
  deleteMcpServer(id: string): void {
    this.db.prepare('DELETE FROM mcp_servers WHERE id = ?').run(id);
  }
  /**
   * Replace a thread's whole entry list. pi rewrites entries outside of
   * `appendEntry` — version migration while loading, and branching — so this is
   * what keeps the database honest about those. Cheap enough because it only
   * runs when a thread is opened, created, or forked, never mid-conversation.
   */
  reconcile(threadId: string, entries: FileEntry[]): void {
    this.db.exec('BEGIN');
    try {
      this.db.prepare('DELETE FROM entries WHERE thread_id = ?').run(threadId);
      entries.forEach((entry, index) => {
        this.insert(threadId, entry, index);
      });
      // Reconciliation makes the in-memory pi session match storage. Opening a
      // chat is reading it, not activity that should reorder the list.
      this.db.exec('COMMIT');
    } catch (error) {
      this.db.exec('ROLLBACK');
      throw error;
    }
  }

  /**
   * Write down what Kira is holding, over whatever she was holding before.
   *
   * Replaced rather than updated, because the observer recomputes the ledger from
   * the chat every time: it is a pure function of the turns, so the list it hands
   * over is the answer and not a change to one. Anything no longer said goes with
   * it, which is what keeps the ledger describing the conversation the chat is
   * actually on after a branch switch.
   *
   * Replacing is not trimming. Trimming would be dropping observations that are
   * still true to save room, and this keeps every one of those.
   */
  recordObservations(threadId: string, observations: readonly ObservationRecord[]): void {
    const record = this.db.prepare(
      'INSERT INTO observations (thread_id, entry_id, at, kind, relevance, text) VALUES (?, ?, ?, ?, ?, ?)',
    );

    this.db.exec('BEGIN');
    try {
      this.db.prepare('DELETE FROM observations WHERE thread_id = ?').run(threadId);

      for (const observation of observations) {
        record.run(
          threadId,
          observation.entryId,
          observation.at,
          observation.kind,
          observation.relevance,
          observation.text,
        );
      }
      this.db.exec('COMMIT');
    } catch (error) {
      this.db.exec('ROLLBACK');
      throw error;
    }
  }

  /** What Kira is holding for this chat, in the order it was first said. */
  loadObservations(threadId: string): StoredObservation[] {
    const rows = this.db
      .prepare(
        'SELECT id, entry_id, at, kind, relevance, text FROM observations WHERE thread_id = ? ORDER BY id',
      )
      .all(threadId) as unknown as ObservationRow[];

    return rows.map(storedObservationOf);
  }

  /**
   * The other chats filed under a workspace, in the order the workspace was built.
   *
   * A search that reaches across a workspace is a search of chats this one cannot
   * see, so the list is read from the database rather than from anything this
   * conversation is holding. The chat that is asking is left out because it is
   * searched as itself, where its own turn numbers mean something.
   */
  loadWorkspaceThreads(workspaceId: string, exceptThreadId: string): ThreadRecord[] {
    const rows = this.db
      .prepare(
        `${THREAD_COLUMNS} WHERE workspace_id = ? AND id <> ? AND subagent_json IS NULL ORDER BY created_at, id`,
      )
      .all(workspaceId, exceptThreadId) as unknown as ThreadRow[];

    return rows.map(threadRecordOf);
  }

  /**
   * What the other chats of a workspace decided, and what the ones that are gone
   * left behind.
   *
   * A chat is filed under a workspace because it is the same work, and a decision
   * made in one of its chats is a decision for the others — which is the point of
   * filing them together at all. Read from the database rather than worked out,
   * because these are turns of chats that this one cannot see and must not
   * pretend to have.
   *
   * The chat that is asking is left out: it is holding its own, and it would
   * otherwise be carried twice, once with turns that can be checked and once
   * without. A chat whose ledger this build has not worked out yet contributes
   * nothing, because nothing has been written down to read — a ledger is worked
   * out when a chat is opened, not for every stored chat at once.
   *
   * What a gone chat left is the second half of the answer, and it is stored
   * rather than read from a chat, because the chat it came from is not there to
   * read. It cannot be named by a turn, so it is carried as something decided.
   * The same thing held twice is held once: a chat beside this one can still be
   * holding what a gone one also worked out, and nothing downstream could tell
   * that the two lines say one thing.
   */
  loadWorkspaceObservations(workspaceId: string, exceptThreadId: string): ObservationRecord[] {
    const beside = this.db
      .prepare(
        `SELECT o.entry_id, o.at, o.kind, o.relevance, o.text
           FROM observations o
           JOIN threads t ON t.id = o.thread_id
          WHERE t.workspace_id = ? AND o.thread_id <> ?
          ORDER BY o.id`,
      )
      .all(workspaceId, exceptThreadId) as unknown as ObservationRow[];

    const kept = this.db
      .prepare(
        `SELECT NULL AS entry_id, at, kind, relevance, text
           FROM workspace_observations
          WHERE workspace_id = ?
          ORDER BY id`,
      )
      .all(workspaceId) as unknown as ObservationRecordRow[];

    // A chat beside this one can still be holding what a gone chat also worked
    // out, and two lines saying one thing read as two decisions. The one that can
    // still be checked against a turn is the one kept, so the chats beside this
    // one come first and a keepsake only fills what they are not already saying.
    const said = new Set(beside.map((row) => row.text));

    return [...beside, ...kept.filter((row) => !said.has(row.text))].map(observationRecordOf);
  }

  /**
   * Write down what the chat has just worked out, keeping what it already knew.
   *
   * Added to rather than replaced, unlike the observations: a conclusion does not
   * stop being true because the turns that showed it have fallen out of the
   * ledger, and drawing the same conclusion again does not make it truer. What
   * the chat already holds is therefore ignored, which the table itself enforces.
   */
  recordReflections(threadId: string, reflections: readonly ReflectionRecord[]): void {
    const record = this.db.prepare(
      'INSERT OR IGNORE INTO reflections (thread_id, covers_through, text) VALUES (?, ?, ?)',
    );

    this.db.exec('BEGIN');
    try {
      for (const reflection of reflections) {
        record.run(threadId, reflection.coversThrough, reflection.text);
      }
      this.db.exec('COMMIT');
    } catch (error) {
      this.db.exec('ROLLBACK');
      throw error;
    }
  }

  /** The child sessions this chat delegated, including terminal history. */
  listSubagents(parentThreadId: string): ThreadRecord[] {
    const rows = this.db
      .prepare(
        `${THREAD_COLUMNS} WHERE parent_thread_id = ? AND subagent_json IS NOT NULL ORDER BY created_at, id`,
      )
      .all(parentThreadId) as unknown as ThreadRow[];

    return rows.map(threadRecordOf);
  }

  /** Update a child session's durable status or result. */
  updateSubagent(threadId: string, patch: Partial<SubagentRecord>): void {
    const current = this.getThread(threadId).subagent;
    if (current === null) throw new Error(`Thread ${threadId} is not a subagent.`);

    const next = { ...current, ...patch };
    this.db
      .prepare('UPDATE threads SET subagent_json = ?, updated_at = ? WHERE id = ?')
      .run(subagentJsonOf(next), new Date().toISOString(), threadId);
  }

  /** What this chat has worked out, in the order it worked it out. */
  loadReflections(threadId: string): StoredReflection[] {
    const rows = this.db
      .prepare('SELECT id, covers_through, text FROM reflections WHERE thread_id = ? ORDER BY id')
      .all(threadId) as unknown as ReflectionRow[];

    return rows.map(storedReflectionOf);
  }

  private insert(threadId: string, entry: FileEntry, seq: number): void {
    this.db
      .prepare(
        'INSERT INTO entries (thread_id, entry_id, seq, parent_id, type, timestamp, json) VALUES (?, ?, ?, ?, ?, ?, ?)',
      )
      .run(
        threadId,
        entry.id,
        seq,
        parentIdOf(entry),
        entry.type,
        entry.timestamp,
        JSON.stringify(entry),
      );
  }

  private touch(threadId: string, headId?: string): void {
    this.db
      .prepare('UPDATE threads SET updated_at = ?, head_id = COALESCE(?, head_id) WHERE id = ?')
      .run(new Date().toISOString(), headId ?? null, threadId);
  }

  close(): void {
    this.db.close();
  }
}

interface ThreadRow {
  id: string;
  cwd: string;
  mode: ChatMode;
  workspace_id: string | null;
  ticket_id: string | null;
  shaping_json: string | null;
  parent_thread_id: string | null;
  head_id: string | null;
  model_id: string | null;
  subagent_json: string | null;
  created_at: string;
  updated_at: string;
}

const THREAD_COLUMNS =
  'SELECT id, cwd, mode, workspace_id, parent_thread_id, head_id, model_id, ticket_id, shaping_json, subagent_json, created_at, updated_at FROM threads';

function subagentJsonOf(value: SubagentRecord | null): string | null {
  return value === null ? null : JSON.stringify(value);
}

function subagentOf(value: string | null): SubagentRecord | null {
  if (value === null) return null;

  try {
    const held = JSON.parse(value) as Partial<SubagentRecord>;
    if (
      held.role === 'general' &&
      typeof held.prompt === 'string' &&
      (held.context === 'task' || held.context === 'parent') &&
      typeof held.modelId === 'string' &&
      (held.status === 'running' ||
        held.status === 'complete' ||
        held.status === 'error' ||
        held.status === 'stopped') &&
      typeof held.response === 'string' &&
      (held.error === null || typeof held.error === 'string') &&
      typeof held.startedAt === 'string' &&
      (held.endedAt === null || typeof held.endedAt === 'string')
    ) {
      return held as SubagentRecord;
    }
  } catch {
    // A malformed child record is treated as an ordinary thread rather than
    // allowing local metadata to prevent the chat database from opening.
  }

  return null;
}

function shapingOf(value: string | null): ShapingState | null {
  if (value === null) return null;

  try {
    // Older builds stored another shape. The stored value is handed on as written
    // and its one reader, openChats, converts it with shapingFrom (pi/ owns shaping).
    return JSON.parse(value) as ShapingState;
  } catch {
    // A malformed local value is treated as an uninitialized shaping state.
  }

  return null;
}

function threadRecordOf(row: ThreadRow): ThreadRecord {
  return {
    id: row.id,
    cwd: row.cwd,
    mode: row.mode === 'spec' ? 'spec' : 'build',
    workspaceId: row.workspace_id,
    ticketId: row.ticket_id,
    shaping: shapingOf(row.shaping_json),
    parentThreadId: row.parent_thread_id,
    subagent: subagentOf(row.subagent_json),
    headId: row.head_id,
    modelId: row.model_id,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

interface WorkspaceRow {
  id: string;
  folder: string;
  project_id: string | null;
  created_at: string;
}

interface McpServerRow {
  id: string;
  scope: string;
  workspace_id: string | null;
  name: string;
  transport: string;
  command: string;
  args_json: string;
  cwd: string | null;
  url: string | null;
  tool_selection_json: string;
  enabled: number;
  created_at: string;
}

function normalizedMcpDraft(draft: McpServerDraft): {
  scope: McpServerScope;
  workspaceId: string | null;
  name: string;
  transport: McpServerTransport;
  command: string;
  args: string[];
  cwd: string | null;
  url: string | null;
  toolSelection: McpToolSelection;
} {
  const scope = draft.scope ?? 'global';
  const workspaceId = scope === 'workspace' ? (draft.workspaceId ?? null) : null;
  const transport = draft.transport ?? 'stdio';
  return {
    scope,
    workspaceId,
    name: draft.name,
    transport,
    command: draft.command,
    args: [...draft.args],
    cwd: draft.cwd,
    url: draft.url ?? null,
    toolSelection:
      draft.toolSelection === undefined
        ? 'all'
        : draft.toolSelection === 'all'
          ? 'all'
          : [...draft.toolSelection],
  };
}

function mcpServerRecordOf(row: McpServerRow): McpServerRecord {
  if (row.scope !== 'global' && row.scope !== 'workspace') {
    throw new Error(`Unsupported MCP server scope ${row.scope}.`);
  }
  if ((row.scope === 'global') !== (row.workspace_id === null)) {
    throw new Error(`Invalid MCP workspace for server ${row.id}.`);
  }
  if (row.transport !== 'stdio' && row.transport !== 'streamable-http') {
    throw new Error(`Unsupported MCP server transport ${row.transport}.`);
  }

  const selection = JSON.parse(row.tool_selection_json) as unknown;
  if (
    selection !== 'all' &&
    (!Array.isArray(selection) || !selection.every((name) => typeof name === 'string'))
  ) {
    throw new Error(`Invalid MCP tool selection for ${row.id}.`);
  }

  return {
    id: row.id,
    scope: row.scope as McpServerScope,
    workspaceId: row.workspace_id,
    name: row.name,
    transport: row.transport,
    command: row.command,
    args: JSON.parse(row.args_json) as string[],
    cwd: row.cwd,
    url: row.url,
    toolSelection: selection,
    enabled: row.enabled !== 0,
    createdAt: row.created_at,
  };
}

interface ObservationRow {
  id: number;
  entry_id: string;
  at: string;
  kind: string;
  relevance: string;
  text: string;
}

interface ReflectionRow {
  id: number;
  covers_through: number | null;
  text: string;
}

function storedReflectionOf(row: ReflectionRow): StoredReflection {
  return { id: row.id, text: row.text, coversThrough: row.covers_through };
}

/**
 * What a record is read from.
 *
 * A chat's own rows always name an entry — the column is what says so — and what
 * a workspace kept from a chat that is gone never does, so this is the wider of the
 * two and the shape a record is built from either way. It carries no row id,
 * because what a record is does not depend on where it sits in a table.
 */
interface ObservationRecordRow extends Omit<ObservationRow, 'entry_id'> {
  entry_id: string | null;
}

function observationRecordOf(row: ObservationRecordRow): ObservationRecord {
  return {
    entryId: row.entry_id,
    at: row.at,
    kind: row.kind,
    relevance: row.relevance,
    text: row.text,
  };
}

function storedObservationOf(row: ObservationRow): StoredObservation {
  // Written from this chat's own turns, so there is an entry to name: what a
  // workspace keeps without one never comes back through here.
  return { id: row.id, ...observationRecordOf(row), entryId: row.entry_id };
}

const WORKSPACE_COLUMNS = 'SELECT id, folder, project_id, created_at FROM workspaces';

function workspaceRecordOf(row: WorkspaceRow): WorkspaceRecord {
  return { id: row.id, folder: row.folder, projectId: row.project_id, createdAt: row.created_at };
}

/** The session header has no parent; every other entry does. */
export function parentIdOf(entry: FileEntry): string | null {
  return 'parentId' in entry ? entry.parentId : null;
}
