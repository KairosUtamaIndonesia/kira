import { strict as assert } from 'node:assert';

import { readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { test } from 'node:test';
import type { FileEntry } from '@earendil-works/pi-coding-agent';
import { tempDir } from '../test-support/temp.ts';
import type { ShapingState } from '../../preload/bridge.ts';
import { ThreadStore, type ObservationRecord, type ThreadRecord } from './threads.ts';

function storePath(): string {
  return join(tempDir('foundry-store-'), 'threads.db');
}

test('a new database reaches the current schema version', () => {
  const path = storePath();
  const store = new ThreadStore(path);
  store.close();

  const db = new DatabaseSync(path);
  assert.equal(
    (db.prepare('PRAGMA user_version').get() as { user_version: number }).user_version,
    15,
  );
  assert.ok(
    (db.prepare('PRAGMA table_info(threads)').all() as { name: string }[]).some(
      (column) => column.name === 'subagent_json',
    ),
  );
  db.close();
});

test('chat mode defaults to Build and is remembered per chat', () => {
  const store = new ThreadStore(storePath());
  const thread = store.createThread(tmpdir());

  assert.equal(thread.mode, 'build');
  store.setThreadMode(thread.id, 'spec');
  assert.equal(store.getThread(thread.id).mode, 'spec');

  store.close();
});

/** A stored entry. Only the id, its parent and what kind it is matter here. */
function stored(id: string, parentId: string | null): FileEntry {
  return { id, parentId, type: 'message', timestamp: '2026-01-01T00:00:00.000Z' } as FileEntry;
}

interface HeadCase {
  name: string;
  /** What is done to the thread before the place it stands on is read back. */
  write: (store: ThreadStore, threadId: string) => void;
  want: string | null;
}

/**
 * Where a thread stands: the entry a reopening conversation continues from. pi
 * keeps that position in the entry list and nowhere else, so a place we chose
 * ourselves has to be written down beside it.
 */
const HEAD_CASES: HeadCase[] = [
  {
    name: 'a thread nobody has written to stands nowhere in particular',
    write: () => {},
    want: null,
  },
  {
    name: 'an entry written to a thread is where that thread now stands',
    write: (store, threadId) => store.appendEntry(threadId, stored('a', null)),
    want: 'a',
  },
  {
    name: 'the place is the entry written last, not the first',
    write: (store, threadId) => {
      store.appendEntry(threadId, stored('a', null));
      store.appendEntry(threadId, stored('b', 'a'));
    },
    want: 'b',
  },
  {
    name: 'rewriting an entry already stored does not move the place back',
    write: (store, threadId) => {
      store.appendEntry(threadId, stored('a', null));
      store.appendEntry(threadId, stored('b', 'a'));
      store.appendEntry(threadId, stored('a', null));
    },
    want: 'b',
  },
  {
    name: 'a place chosen without writing anything is remembered too',
    write: (store, threadId) => {
      store.appendEntry(threadId, stored('a', null));
      store.appendEntry(threadId, stored('b', 'a'));
      store.setHead(threadId, 'a');
    },
    want: 'a',
  },
];

for (const testCase of HEAD_CASES) {
  test(testCase.name, () => {
    const store = new ThreadStore(storePath());
    const thread = store.createThread(tmpdir());

    testCase.write(store, thread.id);

    assert.equal(store.getThread(thread.id).headId, testCase.want);
    store.close();
  });
}

/**
 * The folder a chat works in is read from the chat's own record.
 */
interface FindCase {
  name: string;
  /** The id asked for, given the chat that was stored. */
  asked: (stored: ThreadRecord) => string;
  /** The id that comes back, or undefined when nothing is stored under it. */
  want: (stored: ThreadRecord) => string | undefined;
}

/**
 * A chat that has not been spoken in yet has no record, so "nothing is stored
 * here" is an answer rather than a throw — it is what the workbench reads as a
 * chat with no workspace yet.
 */
const FIND_CASES: FindCase[] = [
  {
    name: 'the chat stored under an id is the one that comes back',
    asked: (stored) => stored.id,
    want: (stored) => stored.id,
  },
  {
    name: 'an id nothing is stored under comes back as nothing',
    asked: () => 'never-made',
    want: () => undefined,
  },
];

for (const testCase of FIND_CASES) {
  test(testCase.name, () => {
    const store = new ThreadStore(storePath());
    const stored = store.createThread(tmpdir());

    assert.equal(store.findThread(testCase.asked(stored))?.id, testCase.want(stored));
    store.close();
  });
}

test('a database from before threads remembered a place opens, and gains one', () => {
  const path = storePath();
  beforeProjects(path, 1);

  const store = new ThreadStore(path);
  const record = store.getThread('older-chat');

  // The chat is intact, and stands nowhere until someone says otherwise.
  assert.equal(record.cwd, join(tmpdir(), 'foundry-space'));
  assert.equal(record.headId, null);
  // Two steps of migration, not one: a database this old climbs both.
  assert.equal(record.workspaceId, null);

  store.setHead('older-chat', 'somewhere');
  assert.equal(store.getThread('older-chat').headId, 'somewhere');
  store.close();
});

test('a database from before workspaces opens, and can hold one', () => {
  const path = storePath();
  beforeProjects(path, 2);

  const store = new ThreadStore(path);
  const record = store.getThread('older-chat');

  assert.equal(record.cwd, join(tmpdir(), 'foundry-space'));
  assert.equal(record.workspaceId, null);

  const workspace = store.rememberWorkspace(join(tmpdir(), 'api'));
  const filed = store.createThread(workspace.folder, { workspaceId: workspace.id });

  assert.equal(store.getThread(filed.id).workspaceId, workspace.id);
  store.close();
});

/**
 * A database as it was before workspaces existed, written out rather than
 * migrated into, so the migration meets the shape it will find in the wild.
 * Version 1 is before a thread remembered where it was being read; version 2 is
 * after that and before workspaces.
 */
function beforeProjects(path: string, version: 1 | 2): void {
  const old = new DatabaseSync(path);
  old.exec(`
    CREATE TABLE threads (
      id               TEXT PRIMARY KEY,
      cwd              TEXT NOT NULL,
      parent_thread_id TEXT REFERENCES threads(id),
      ${version === 2 ? 'head_id          TEXT,' : ''}
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

    PRAGMA user_version = ${version};
  `);
  old
    .prepare('INSERT INTO threads (id, cwd, created_at, updated_at) VALUES (?, ?, ?, ?)')
    .run(
      'older-chat',
      join(tmpdir(), 'foundry-space'),
      '2026-01-01T00:00:00.000Z',
      '2026-01-01T00:00:00.000Z',
    );
  old.close();
}

interface ProjectCase {
  name: string;
  /** What the store is asked to do before its workspaces are read back. */
  act: (store: ThreadStore) => void;
  /** The folders it should hold afterwards, in the order it lists them. */
  want: string[];
}

/**
 * Workspaces: folders that outlive the chats working in them. The folder is the
 * identity, because a workspace is a place to work — choosing the same place
 * twice is choosing one workspace, however it was spelled the second time.
 */
const PROJECT_CASES: ProjectCase[] = [
  {
    name: 'a store with nothing added holds no workspaces',
    act: () => {},
    want: [],
  },
  {
    name: 'an added folder is a workspace',
    act: (store) => void store.rememberWorkspace(join(tmpdir(), 'api')),
    want: [join(tmpdir(), 'api')],
  },
  {
    name: 'workspaces are listed in the order they were added',
    act: (store) => {
      store.rememberWorkspace(join(tmpdir(), 'api'));
      store.rememberWorkspace(join(tmpdir(), 'site'));
    },
    want: [join(tmpdir(), 'api'), join(tmpdir(), 'site')],
  },
  {
    name: 'the same folder added twice is one workspace, not two',
    act: (store) => {
      store.rememberWorkspace(join(tmpdir(), 'api'));
      store.rememberWorkspace(join(tmpdir(), 'api'));
    },
    want: [join(tmpdir(), 'api')],
  },
];

for (const testCase of PROJECT_CASES) {
  test(testCase.name, () => {
    const store = new ThreadStore(storePath());

    testCase.act(store);

    assert.deepEqual(
      store.listWorkspaces().map((workspace) => workspace.folder),
      testCase.want,
    );
    store.close();
  });
}

test('a folder already added is handed back as the workspace it already is', () => {
  const store = new ThreadStore(storePath());
  const first = store.rememberWorkspace(join(tmpdir(), 'api'));

  assert.equal(store.rememberWorkspace(join(tmpdir(), 'api')).id, first.id);
  store.close();
});

test('a chat is filed under a workspace, and a chat with none is filed nowhere', () => {
  const store = new ThreadStore(storePath());
  const workspace = store.rememberWorkspace(join(tmpdir(), 'api'));
  const filed = store.createThread(workspace.folder, { workspaceId: workspace.id });
  const loose = store.createThread(tmpdir());

  assert.equal(store.getThread(filed.id).workspaceId, workspace.id);
  assert.equal(store.getThread(loose.id).workspaceId, null);
  store.close();
});

test('a workspace works a project once it is joined to one, and none before', () => {
  const store = new ThreadStore(storePath());
  const workspace = store.rememberWorkspace(join(tmpdir(), 'api'));

  // A folder nobody has joined is a workspace waiting rather than a broken row: it
  // is the ordinary state of every folder on a machine that has not been asked yet.
  assert.equal(workspace.projectId, null);
  assert.equal(store.workspaceAt(join(tmpdir(), 'api'))?.projectId, null);

  assert.equal(store.joinWorkspace(workspace.id, 'foundry-project')?.projectId, 'foundry-project');
  assert.equal(store.workspaceAt(join(tmpdir(), 'api'))?.projectId, 'foundry-project');

  // One answer, replaced rather than accumulated: a folder works one project at a
  // time, and joining another is what changing your mind looks like.
  assert.equal(store.joinWorkspace(workspace.id, 'another-project')?.projectId, 'another-project');
  store.close();
});

test('joining a workspace that is gone answers nothing rather than failing', () => {
  const store = new ThreadStore(storePath());

  assert.equal(store.joinWorkspace('never-existed', 'foundry-project'), undefined);
  store.close();
});

test('a database from before the rename keeps its folders, its chats and what a workspace kept', () => {
  const path = storePath();
  const before = new ThreadStore(path);
  const workspace = before.rememberWorkspace(join(tmpdir(), 'api'));
  const chat = before.createThread(workspace.folder, { workspaceId: workspace.id });
  before.close();

  // What Kira kept for the folder, written under the name it has now and then
  // carried back into the old shape along with everything else.
  const old = new DatabaseSync(path);
  old
    .prepare(
      'INSERT INTO workspace_observations (workspace_id, at, kind, relevance, text) VALUES (?, ?, ?, ?, ?)',
    )
    .run(workspace.id, '2026-01-01T00:00:00.000Z', 'decision', 'high', 'the queue is derived');
  old.exec('ALTER TABLE threads DROP COLUMN ticket_id');
  beforeWorkspacesRename(old);
  old.exec('PRAGMA user_version = 8');
  old.close();

  const store = new ThreadStore(path);
  const [kept] = store.listWorkspaces();

  assert.equal(kept?.folder, workspace.folder);
  assert.equal(kept?.projectId, null);
  assert.equal(store.getThread(chat.id).workspaceId, workspace.id);
  assert.deepEqual(
    store.loadWorkspaceObservations(workspace.id, chat.id).map((each) => each.text),
    ['the queue is derived'],
  );
  store.close();
});

test('a chat can be stored under an id decided before it was stored', () => {
  const store = new ThreadStore(storePath());
  const cwd = tmpdir();
  const chosen = store.createThread(cwd, { id: 'composed-already' });

  // A new chat is composed under the id it will keep, so the window's idea of
  // which chat it is showing does not change under the words in its box.
  assert.equal(chosen.id, 'composed-already');
  // Read back by that id, not the record we just made: the row is stored under
  // the id it was given rather than one minted for it.
  assert.equal(store.getThread('composed-already').cwd, cwd);
  store.close();
});

test('global MCP servers are persisted, listed and removed', () => {
  const store = new ThreadStore(storePath());

  const server = store.createMcpServer({
    name: 'github',
    command: 'node',
    args: ['server.mjs', '--stdio'],
    cwd: join(tmpdir(), 'workspace'),
  });

  assert.equal(server.scope, 'global');
  assert.deepEqual(store.listMcpServers(), [server]);
  assert.throws(
    () =>
      store.createMcpServer({
        name: 'github',
        command: 'other',
        args: [],
        cwd: null,
      }),
    /UNIQUE|constraint/i,
  );

  store.deleteMcpServer(server.id);
  assert.deepEqual(store.listMcpServers(), []);
  store.close();
});

test('global and workspace MCP servers share names only across scopes', () => {
  const store = new ThreadStore(storePath());
  const workspace = store.rememberWorkspace(join(tmpdir(), 'mcp-workspace'));
  const anotherWorkspace = store.rememberWorkspace(join(tmpdir(), 'mcp-workspace-another'));
  const global = store.createMcpServer({
    name: 'github',
    command: 'global-node',
    args: [],
    cwd: null,
  });
  const local = store.createMcpServer({
    scope: 'workspace',
    workspaceId: workspace.id,
    name: 'github',
    command: 'workspace-node',
    args: [],
    cwd: workspace.folder,
  });

  assert.equal(global.workspaceId, null);
  assert.equal(local.scope, 'workspace');
  assert.equal(local.workspaceId, workspace.id);
  assert.deepEqual(store.listMcpServersForWorkspace(workspace.id), [local]);
  assert.deepEqual(store.listMcpServers(), [global, local]);
  const inAnotherWorkspace = store.createMcpServer({
    scope: 'workspace',
    workspaceId: anotherWorkspace.id,
    name: 'github',
    command: 'another-workspace-node',
    args: [],
    cwd: null,
  });
  assert.deepEqual(store.listMcpServersForWorkspace(anotherWorkspace.id), [inAnotherWorkspace]);
  assert.throws(
    () =>
      store.createMcpServer({
        scope: 'workspace',
        workspaceId: workspace.id,
        name: 'github',
        command: 'another-node',
        args: [],
        cwd: null,
      }),
    /UNIQUE|constraint/i,
  );

  store.close();
});

const MCP_DATABASE_CASES: Array<{ name: string; run(): void }> = [
  {
    name: 'credentials never enter the SQLite database',
    run() {
      const path = storePath();
      const store = new ThreadStore(path);
      try {
        store.createMcpServer({
          name: 'private',
          command: 'node',
          args: [],
          cwd: null,
          credentials: {
            env: { MCP_TOKEN: 'stdio-secret' },
            headers: { 'x-api-key': 'header-secret' },
            bearerToken: 'bearer-secret',
          },
        });
      } finally {
        store.close();
      }

      const contents = readFileSync(path);
      for (const secret of ['stdio-secret', 'header-secret', 'bearer-secret']) {
        assert.equal(contents.includes(Buffer.from(secret)), false);
      }
    },
  },
  {
    name: 'scope migration recovers an interrupted prior attempt',
    run() {
      const path = storePath();
      const before = new ThreadStore(path);
      let savedId: string;
      try {
        savedId = before.createMcpServer({
          name: 'local',
          command: 'node',
          args: ['server.mjs'],
          cwd: null,
        }).id;
      } finally {
        before.close();
      }

      const interrupted = new DatabaseSync(path);
      try {
        interrupted.exec(`
          ALTER TABLE mcp_servers DROP COLUMN transport;
          ALTER TABLE mcp_servers DROP COLUMN url;
          ALTER TABLE mcp_servers DROP COLUMN tool_selection_json;
          CREATE TABLE mcp_servers_v13 (stale INTEGER);
          PRAGMA user_version = 12;
        `);
      } finally {
        interrupted.close();
      }

      const recovered = new ThreadStore(path);
      try {
        assert.equal(recovered.findMcpServer(savedId)?.name, 'local');
      } finally {
        recovered.close();
      }
    },
  },
];

test('MCP database boundaries recover and protect credentials', async (context) => {
  for (const testCase of MCP_DATABASE_CASES) {
    await context.test(testCase.name, testCase.run);
  }
});

test('a version 10 database gains MCP server storage', () => {
  const path = storePath();
  const before = new ThreadStore(path);
  before.close();

  const old = new DatabaseSync(path);
  old.exec('DROP TABLE mcp_servers; PRAGMA user_version = 10;');
  old.close();

  const store = new ThreadStore(path);
  const server = store.createMcpServer({
    name: 'local',
    command: 'node',
    args: [],
    cwd: null,
  });

  assert.equal(store.listMcpServers()[0]?.id, server.id);
  store.close();
});

test('MCP transport and tool selection survive migration and updates', () => {
  const path = storePath();
  const before = new ThreadStore(path);
  const saved = before.createMcpServer({
    name: 'local',
    command: 'node',
    args: ['server.mjs'],
    cwd: null,
  });
  before.close();

  const old = new DatabaseSync(path);
  old.exec(`
    ALTER TABLE mcp_servers DROP COLUMN transport;
    ALTER TABLE mcp_servers DROP COLUMN url;
    ALTER TABLE mcp_servers DROP COLUMN tool_selection_json;
    PRAGMA user_version = 11;
  `);
  old.close();

  const store = new ThreadStore(path);
  assert.deepEqual(store.findMcpServer(saved.id), {
    ...saved,
    transport: 'stdio',
    url: null,
    toolSelection: 'all',
  });

  const updated = store.updateMcpServer(saved.id, {
    name: 'remote',
    transport: 'streamable-http',
    command: '',
    args: [],
    cwd: null,
    url: 'http://127.0.0.1:4321/mcp',
    toolSelection: ['echo'],
  });
  assert.equal(updated?.transport, 'streamable-http');
  assert.equal(updated?.url, 'http://127.0.0.1:4321/mcp');
  assert.deepEqual(updated?.toolSelection, ['echo']);
  store.close();
});

test('a chat remembers the model it runs on', () => {
  const store = new ThreadStore(storePath());
  const chat = store.createThread(join(tmpdir(), 'foundry-space'));

  // Nothing chosen yet, which is not the same as a model that happens to come
  // first: a chat that has chosen none runs on what the pool prefers.
  assert.equal(chat.modelId, null);

  store.setThreadModel(chat.id, 'gpt-6-astra');
  assert.equal(store.getThread(chat.id).modelId, 'gpt-6-astra');

  // Picking another replaces it, because a chat runs on one model at a time.
  store.setThreadModel(chat.id, 'gpt-5.6-luna');
  assert.equal(store.getThread(chat.id).modelId, 'gpt-5.6-luna');
  store.close();
});

test('a chat hands back its stored shaping across a restart', () => {
  const spec = {
    kind: 'spec' as const,
    id: 'proposal-1',
    chatId: 'chat-1',
    problem: 'Keep the agreed work visible.',
    solution: 'Show the spec with the chat.',
    stories: ['The person can read the proposal.'],
    status: 'proposed' as const,
    ticketId: null,
  };
  const current: ShapingState = { proposals: [spec] };
  // An older build's shape is handed on as written; openChats converts it with
  // shapingFrom, whose tests cover that conversion.
  const { kind: _kind, ...legacyProposal } = spec;
  const legacy = { offer: 'dismissed', proposal: legacyProposal };
  const cases: Array<{ name: string; stored: string; want: unknown }> = [
    { name: 'current shape keeps its proposals', stored: JSON.stringify(current), want: current },
    {
      name: 'older shape is handed on for conversion',
      stored: JSON.stringify(legacy),
      want: legacy,
    },
    { name: 'malformed JSON reads as no shaping', stored: '{not json', want: null },
  ];

  for (const item of cases) {
    const path = storePath();
    const store = new ThreadStore(path);
    const chat = store.createThread(join(tmpdir(), 'foundry-space'));
    store.close();

    const raw = new DatabaseSync(path);
    raw.prepare('UPDATE threads SET shaping_json = ? WHERE id = ?').run(item.stored, chat.id);
    raw.close();

    const reopened = new ThreadStore(path);
    assert.deepEqual(reopened.getThread(chat.id).shaping, item.want, item.name);
    reopened.close();
  }
});

test('a chat remembers the shaping it was given', () => {
  const path = storePath();
  const store = new ThreadStore(path);
  const chat = store.createThread(join(tmpdir(), 'foundry-space'));
  const shaping: ShapingState = {
    proposals: [
      {
        kind: 'spec',
        id: 'proposal-1',
        chatId: chat.id,
        problem: 'Keep the agreed work visible.',
        solution: 'Show the spec with the chat.',
        stories: ['The person can read the proposal.'],
        status: 'approved',
        ticketId: 'FOU-1',
      },
    ],
  };

  store.setThreadShaping(chat.id, shaping);
  assert.deepEqual(store.getThread(chat.id).shaping, shaping);
  store.close();

  const reopened = new ThreadStore(path);
  assert.deepEqual(reopened.getThread(chat.id).shaping, shaping);
  reopened.close();
});

test('removing a workspace leaves its chats stored, unfiled, and where they worked', () => {
  const store = new ThreadStore(storePath());
  const workspace = store.rememberWorkspace(join(tmpdir(), 'api'));
  const filed = store.createThread(workspace.folder, { workspaceId: workspace.id });

  store.forgetWorkspace(workspace.id);

  const record = store.getThread(filed.id);
  assert.equal(record.workspaceId, null);
  assert.equal(record.cwd, workspace.folder);
  assert.deepEqual(store.listWorkspaces(), []);
  // Asked for by an id nothing is stored under, a workspace is absent rather than a
  // failure: a chat being composed for one has to be made somewhere regardless.
  assert.equal(store.findWorkspace(workspace.id), undefined);
  store.close();
});

test('choosing the folder again takes back the chats already working in it', () => {
  const store = new ThreadStore(storePath());
  const workspace = store.rememberWorkspace(join(tmpdir(), 'api'));
  const filed = store.createThread(workspace.folder, { workspaceId: workspace.id });
  const elsewhere = store.createThread(tmpdir());

  store.forgetWorkspace(workspace.id);
  const again = store.rememberWorkspace(workspace.folder);

  // Removing a workspace is something you can take back, and that only works
  // because the chats stayed where they were working. A chat in another folder
  // has nothing to do with this one.
  assert.equal(store.getThread(filed.id).workspaceId, again.id);
  assert.equal(store.getThread(elsewhere.id).workspaceId, null);
  store.close();
});

test('a chat that is put away leaves the list and keeps everything it holds', () => {
  const store = new ThreadStore(storePath());
  const put = store.createThread(join(tmpdir(), 'foundry-space'));
  const kept = store.createThread(join(tmpdir(), 'foundry-space'));
  store.appendEntry(put.id, stored('a', null));

  store.archiveThread(put.id);

  // Putting a chat away is not throwing it away: it is out of the list, and it
  // is still there to be read — which is what settings will need to offer it
  // back, and what a chat that is still on screen in a window has to survive.
  assert.deepEqual(
    store.listThreads().map((thread) => thread.id),
    [kept.id],
  );
  assert.equal(store.getThread(put.id).cwd, join(tmpdir(), 'foundry-space'));
  assert.deepEqual(
    store.loadEntries(put.id).map((entry) => entry.id),
    ['a'],
  );
  store.close();
});

test('a chat brought back from being put away rejoins the list', () => {
  const store = new ThreadStore(storePath());
  const put = store.createThread(join(tmpdir(), 'foundry-space'));
  const kept = store.createThread(join(tmpdir(), 'foundry-space'));

  store.archiveThread(put.id);
  store.unarchiveThread(put.id);

  // Bringing a chat back undoes exactly what putting it away did: it is in the
  // list again, ordered by the activity it already had rather than by when it
  // came back.
  assert.deepEqual(
    store.listThreads().map((thread) => thread.id),
    [kept.id, put.id],
  );
  store.close();
});

test('deleting a chat takes its words with it, and leaves its forks behind', () => {
  const store = new ThreadStore(storePath());
  const workspace = store.rememberWorkspace(join(tmpdir(), 'api'));
  const gone = store.createThread(workspace.folder, { workspaceId: workspace.id });
  const forked = store.createThread(workspace.folder, {
    parentThreadId: gone.id,
  });
  store.appendEntry(gone.id, stored('a', null));

  store.deleteThread(gone.id);

  // The chat and everything said in it are gone, and the workspace it was filed
  // under is not: a chat is not the workspace's to take with it, and the same
  // goes the other way. A chat forked from this one is a chat of its own with
  // its own words — it only forgets where it came from.
  assert.throws(() => store.getThread(gone.id), {
    message: `No thread stored with id ${gone.id}.`,
  });
  assert.deepEqual(store.loadEntries(gone.id), []);
  assert.equal(store.getThread(forked.id).parentThreadId, null);
  assert.equal(store.findWorkspace(workspace.id)?.folder, workspace.folder);
  store.close();
});

/**
 * Put a database back into the shape a folder's record had before it was called a
 * workspace: the tables under their old names, no project on a workspace, and the
 * chat's column named for the folder again.
 *
 * Every shape below is written by building this build's database and taking away
 * what arrived since, so each of them passes through here first — otherwise a
 * "database from before archiving" would already have the rename done to it, and
 * the migration would be asked to rename a table that is already renamed.
 */
function beforeWorkspacesRename(old: DatabaseSync): void {
  old.exec(`
    ALTER TABLE workspaces DROP COLUMN project_id;
    ALTER TABLE workspaces RENAME TO projects;
    ALTER TABLE workspace_observations RENAME TO project_observations;
    ALTER TABLE project_observations RENAME COLUMN workspace_id TO project_id;
    ALTER TABLE threads RENAME COLUMN workspace_id TO project_id;
  `);
}

/**
 * A database as it was before a chat could be put away: the shape version 3
 * wrote, made by taking away every column added since. The row stays, so the
 * migration has something to migrate.
 */
function beforeArchiving(path: string): void {
  const store = new ThreadStore(path);
  store.createThread(join(tmpdir(), 'foundry-space'));
  store.close();

  const old = new DatabaseSync(path);
  old.exec('ALTER TABLE threads DROP COLUMN ticket_id');
  // Everything version 4 and later added, in the order it arrived: a shape that
  // keeps a column an older build never wrote is not that older shape, and the
  // migration meets it as a column that is already there.
  old.exec('ALTER TABLE threads DROP COLUMN archived_at');
  old.exec('ALTER TABLE threads DROP COLUMN model_id');
  beforeWorkspacesRename(old);
  old.exec('DROP TABLE observations');
  old.exec('DROP TABLE reflections');
  old.exec('DROP TABLE project_observations');
  old.exec('PRAGMA user_version = 3');
  old.close();
}

interface OlderCase {
  name: string;
  /** Write a database at `path` as an older build wrote it. */
  write: (path: string) => void;
}

/**
 * A database as it was before a chat remembered the model it runs on: the shape
 * version 4 wrote, made by taking the column away from the shape this build
 * writes.
 */
function beforeModelMemory(path: string): void {
  const store = new ThreadStore(path);
  store.createThread(join(tmpdir(), 'foundry-space'));
  store.close();

  const old = new DatabaseSync(path);
  old.exec('ALTER TABLE threads DROP COLUMN ticket_id');
  old.exec('ALTER TABLE threads DROP COLUMN model_id');
  beforeWorkspacesRename(old);
  old.exec('DROP TABLE observations');
  old.exec('DROP TABLE reflections');
  old.exec('DROP TABLE project_observations');
  old.exec('PRAGMA user_version = 4');
  old.close();
}

/**
 * A database as it was before Kira kept anything: the shape version 5 wrote.
 *
 * This is the one an install actually has, because 5 is what the last shipped
 * build writes — the others are shapes only a machine that has not been updated
 * in a while still holds.
 */
function beforeKeepingMemory(path: string): void {
  const store = new ThreadStore(path);
  store.createThread(join(tmpdir(), 'foundry-space'));
  store.close();

  const old = new DatabaseSync(path);
  old.exec('ALTER TABLE threads DROP COLUMN ticket_id');
  beforeWorkspacesRename(old);
  old.exec('DROP TABLE observations');
  old.exec('DROP TABLE reflections');
  old.exec('DROP TABLE project_observations');
  old.exec('PRAGMA user_version = 5');
  old.close();
}

/**
 * A database as it was before Kira drew conclusions: the shape version 6 wrote.
 *
 * This is the one an install actually has, because 6 is what the last shipped
 * build writes — the others are shapes only a machine that has not been updated
 * in a while is holding.
 */
function beforeConclusions(path: string): void {
  const store = new ThreadStore(path);
  store.createThread(join(tmpdir(), 'foundry-space'));
  store.close();

  const old = new DatabaseSync(path);
  old.exec('ALTER TABLE threads DROP COLUMN ticket_id');
  beforeWorkspacesRename(old);
  old.exec('DROP TABLE reflections');
  old.exec('DROP TABLE project_observations');
  old.exec('PRAGMA user_version = 6');
  old.close();
}

/**
 * A database as it was before a workspace kept anything: the shape version 7 wrote.
 *
 * This is the one an install actually has, because 7 is what the last shipped
 * build writes — the others are shapes only a machine that has not been updated
 * in a while is holding.
 */
function beforeProjectMemory(path: string): void {
  const store = new ThreadStore(path);
  store.createThread(join(tmpdir(), 'foundry-space'));
  store.close();

  const old = new DatabaseSync(path);
  old.exec('ALTER TABLE threads DROP COLUMN ticket_id');
  beforeWorkspacesRename(old);
  old.exec('DROP TABLE project_observations');
  old.exec('PRAGMA user_version = 7');
  old.close();
}

/**
 * A database as it was before a folder was called a workspace: the shape version
 * 8 wrote, which is what the last shipped build writes.
 *
 * This is the one an install actually has. It is the same tables as this build's,
 * under the old names, and without the project a workspace works — so what the
 * migration has to do is rename them and add the column, and a person's folders,
 * their chats and what Kira kept all have to come through it untouched (GH #65).
 */
function beforeTheRename(path: string): void {
  const store = new ThreadStore(path);
  store.createThread(join(tmpdir(), 'foundry-space'));
  store.close();

  const old = new DatabaseSync(path);
  old.exec('ALTER TABLE threads DROP COLUMN ticket_id');
  beforeWorkspacesRename(old);
  old.exec('PRAGMA user_version = 8');
  old.close();
}

/**
 * A database written before a chat could say it was a run of a ticket.
 *
 * The column arrives with this build, so a database written before it holds the rows it
 * always did without it — which is what this puts back, along with the version a build
 * from then would have written down.
 */
function beforeRunsWereChats(path: string): void {
  const store = new ThreadStore(path);
  store.createThread(join(tmpdir(), 'foundry-space'));
  store.close();

  const old = new DatabaseSync(path);
  old.exec('ALTER TABLE threads DROP COLUMN ticket_id');
  old.exec('PRAGMA user_version = 9');
  old.close();
}

/**
 * Every shape this build is expected to open, oldest first. The columns the list
 * reads are new, so each of them has to come out of the migration with them: a
 * database only climbs the steps it is behind, and one that skipped a step would
 * otherwise reach this build without one.
 */
const OLDER_CASES: OlderCase[] = [
  {
    name: 'a database from before workspaces',
    write: (path) => beforeProjects(path, 1),
  },
  {
    name: 'a database from before workspaces with a remembered place',
    write: (path) => beforeProjects(path, 2),
  },
  { name: 'a database from before archiving', write: beforeArchiving },
  { name: 'a database from before a chat remembered its model', write: beforeModelMemory },
  { name: 'a database from before Kira kept anything', write: beforeKeepingMemory },
  { name: 'a database from before Kira drew conclusions', write: beforeConclusions },
  { name: 'a database from before a workspace kept anything', write: beforeProjectMemory },
  { name: 'a database from before a folder was called a workspace', write: beforeTheRename },
  { name: 'a database from before a run was a chat', write: beforeRunsWereChats },
];

for (const testCase of OLDER_CASES) {
  test(`${testCase.name} opens, and can put a chat away`, () => {
    const path = storePath();
    testCase.write(path);

    const store = new ThreadStore(path);
    const [chat] = store.listThreads();

    assert.ok(chat, 'the chat stored before archiving is still in the list');
    store.archiveThread(chat.id);
    assert.deepEqual(store.listThreads(), []);
    store.close();
  });

  test(`${testCase.name} opens, and can remember a model`, () => {
    const path = storePath();
    testCase.write(path);

    const store = new ThreadStore(path);
    const [chat] = store.listThreads();

    assert.ok(chat, 'the chat stored before is still in the list');
    // Read before it is written, because a chat written by an older build chose
    // nothing — which is a fact about it, not a model to invent.
    assert.equal(store.getThread(chat.id).modelId, null);

    store.setThreadModel(chat.id, 'gpt-6-astra');
    assert.equal(store.getThread(chat.id).modelId, 'gpt-6-astra');
    store.close();
  });

  test(`${testCase.name} opens, and can hold what Kira remembers`, () => {
    const path = storePath();
    testCase.write(path);

    const store = new ThreadStore(path);
    const [chat] = store.listThreads();

    assert.ok(chat, 'the chat stored before is still in the list');
    assert.deepEqual(contents(store, chat.id), []);

    const held = remembered('e1', 'goal', 'high', 'Fix the auth bug');
    store.recordObservations(chat.id, [held]);
    assert.deepEqual(contents(store, chat.id), [held]);
    store.close();
  });

  test(`${testCase.name} opens, and can hold a conclusion`, () => {
    const path = storePath();
    testCase.write(path);

    const store = new ThreadStore(path);
    const [chat] = store.listThreads();

    assert.ok(chat, 'the chat stored before is still in the list');
    // Every shape below this build is older than conclusions, so a database this
    // test opens has no table to keep one in until the migration gives it one.
    // Without this case the table would only ever be created for databases this
    // build wrote itself, and an install that has been updated for a year would
    // have nowhere to put a conclusion — quietly, because a reflector that fails
    // is caught rather than allowed to cost the compaction.
    assert.deepEqual(store.loadReflections(chat.id), []);

    store.recordReflections(chat.id, [{ text: 'the queue was rejected', coversThrough: 2 }]);

    assert.deepEqual(store.loadReflections(chat.id), [
      { id: 1, text: 'the queue was rejected', coversThrough: 2 },
    ]);
    store.close();
  });

  test(`${testCase.name} opens, and can keep what a workspace worked out`, () => {
    const path = storePath();
    testCase.write(path);

    const store = new ThreadStore(path);
    const [chat] = store.listThreads();

    assert.ok(chat, 'the chat stored before is still in the list');
    // Filed where it already works, which is what adding that folder as a workspace
    // does. Every shape below this build keeps a chat's memory under the chat, so
    // a database this test opens has nowhere to put what a thrown-away chat
    // worked out until the migration gives it somewhere — and a workspace with
    // nowhere to put it loses that quietly, by way of a chat being deleted.
    const workspace = store.rememberWorkspace(chat.cwd);
    const held = remembered('e1', 'goal', 'high', 'Fix the auth bug');

    store.recordObservations(chat.id, [held]);
    store.deleteThread(chat.id);

    assert.deepEqual(store.loadWorkspaceObservations(workspace.id, chat.id), [
      { ...held, entryId: null },
    ]);
    store.close();
  });
}

// ── What Kira is holding ─────────────────────────────────────────────────────

/** One thing the observer noticed, as it is written down. */
function remembered(
  entryId: string,
  kind: string,
  relevance: string,
  text: string,
): ObservationRecord {
  return { entryId, at: '2026-01-01T00:00:00.000Z', kind, relevance, text };
}

/**
 * What a chat is holding, without where each thing was written down.
 *
 * The row id belongs to the store rather than to the ledger — it is where a fact
 * sits in a table, not something the pass that worked it out decided — so a test
 * about what Kira holds is about the rest. That an observation comes back with an
 * identifier at all is asserted on its own below.
 */
function contents(store: ThreadStore, threadId: string): ObservationRecord[] {
  return store.loadObservations(threadId).map(({ entryId, at, kind, relevance, text }) => ({
    entryId,
    at,
    kind,
    relevance,
    text,
  }));
}

test('what Kira is holding outlives the window, and is read back as it was written', () => {
  const path = storePath();
  const store = new ThreadStore(path);
  const chat = store.createThread(tmpdir());

  store.recordObservations(chat.id, [
    remembered('e1', 'goal', 'high', 'Fix the auth bug in the login flow'),
    remembered('e3', 'changed', 'medium', 'src/auth/session.ts'),
    remembered('e4', 'commit', 'medium', 'a1b2c3d: fix(auth): refresh the token'),
  ]);
  store.close();

  // Written, closed, opened again: what a relaunch would find, rather than what
  // the object that wrote it still happens to be holding in memory.
  const reopened = new ThreadStore(path);

  assert.deepEqual(contents(reopened, chat.id), [
    remembered('e1', 'goal', 'high', 'Fix the auth bug in the login flow'),
    remembered('e3', 'changed', 'medium', 'src/auth/session.ts'),
    remembered('e4', 'commit', 'medium', 'a1b2c3d: fix(auth): refresh the token'),
  ]);
  reopened.close();
});

test('what Kira is holding comes back with the identifier it is stored under', () => {
  // Recall is asked to take one of these back to the turn it came from, and it is
  // asked with this. So it has to exist, and it has to be the ledger's own order —
  // the order things were first said — rather than something a caller invents.
  const path = storePath();
  const store = new ThreadStore(path);
  const chat = store.createThread(tmpdir());

  store.recordObservations(chat.id, [
    remembered('e1', 'goal', 'high', 'Fix the auth bug in the login flow'),
    remembered('e3', 'changed', 'medium', 'src/auth/session.ts'),
    remembered('e4', 'commit', 'medium', 'a1b2c3d: fix(auth): refresh the token'),
  ]);

  const ids = store.loadObservations(chat.id).map(({ id }) => id);

  assert.equal(ids.length, 3);
  assert.ok(
    ids.every((id) => Number.isInteger(id) && id > 0),
    `every identifier should be a real row: ${JSON.stringify(ids)}`,
  );
  assert.deepEqual(
    [...ids].sort((a, b) => a - b),
    ids,
    'the identifiers should be in the order things were said',
  );
  store.close();
});

test('what Kira is holding keeps the entry it came from', () => {
  const store = new ThreadStore(storePath());
  const chat = store.createThread(tmpdir());
  store.appendEntry(chat.id, stored('e1', null));

  store.recordObservations(chat.id, [remembered('e1', 'goal', 'high', 'Fix the auth bug')]);

  // The source is what makes an observation checkable rather than something to
  // take on trust. Nothing in the table enforces it — `entry_id` is a plain
  // string — so what is pinned here is only that the entry the observer was
  // looking at is the one it wrote down.
  assert.deepEqual(contents(store, chat.id), [
    remembered('e1', 'goal', 'high', 'Fix the auth bug'),
  ]);
  assert.ok(
    store.loadEntries(chat.id).some((entry) => entry.id === 'e1'),
    'and the entry it names is really in the chat',
  );
  store.close();
});

test('one chat cannot read what another is holding', () => {
  const store = new ThreadStore(storePath());
  const mine = store.createThread(tmpdir());
  const yours = store.createThread(tmpdir());

  store.recordObservations(mine.id, [remembered('e1', 'goal', 'high', 'Fix the auth bug')]);

  assert.deepEqual(contents(store, yours.id), []);
  store.close();
});

test('observing the same thing again writes over it rather than piling it up', () => {
  const store = new ThreadStore(storePath());
  const chat = store.createThread(tmpdir());

  // What the observer does on every settled turn: hands over the whole list,
  // most of which it has handed over before. A file goes on being edited for ten
  // more turns, and what Kira is holding about it is still one thing.
  store.recordObservations(chat.id, [
    remembered('e1', 'read', 'low', 'src/auth/session.ts'),
    remembered('e2', 'goal', 'high', 'Fix the auth bug'),
  ]);
  store.recordObservations(chat.id, [
    // The same file, now that she has changed it: the same thing, held more
    // specifically, and standing at the entry where she did it.
    remembered('e5', 'changed', 'medium', 'src/auth/session.ts'),
    remembered('e2', 'goal', 'high', 'Fix the auth bug'),
  ]);

  assert.deepEqual(contents(store, chat.id), [
    remembered('e5', 'changed', 'medium', 'src/auth/session.ts'),
    remembered('e2', 'goal', 'high', 'Fix the auth bug'),
  ]);
  store.close();
});

test('deleting a chat takes what Kira was holding with it', () => {
  const store = new ThreadStore(storePath());
  const gone = store.createThread(tmpdir());
  const kept = store.createThread(tmpdir());
  store.appendEntry(gone.id, stored('e1', null));
  store.appendEntry(kept.id, stored('e1', null));

  store.recordObservations(gone.id, [remembered('e1', 'goal', 'high', 'Fix the auth bug')]);
  store.recordObservations(kept.id, [remembered('e1', 'goal', 'high', 'Ship the deploy script')]);
  store.deleteThread(gone.id);

  assert.deepEqual(contents(store, gone.id), []);
  assert.deepEqual(contents(store, kept.id), [
    remembered('e1', 'goal', 'high', 'Ship the deploy script'),
  ]);
  store.close();
});

/** A thing a workspace kept, which is a record whose entry went with the chat. */
function kept(...records: readonly ObservationRecord[]): ObservationRecord[] {
  return records.map((each) => ({ ...each, entryId: null }));
}

/** Where a case leaves the workspace, and what reading it back should answer. */
interface KeptCase {
  name: string;
  arrange: (
    store: ThreadStore,
    folder: string,
  ) => { workspaceId: string; asking: string; want: ObservationRecord[] };
}

/**
 * What a workspace holds once its chats have been thrown away.
 *
 * A chat's own memory is stored under the chat and goes with it; what it worked
 * out is the workspace's, so a filed chat leaves that behind on the way out. These
 * are the shapes that shows up in: kept at all, kept once when two chats worked
 * out the same thing, not said twice when one of them is still here to say it,
 * and told apart by what was done to a file rather than by which chat went first.
 */
const KEPT_CASES: KeptCase[] = [
  {
    name: 'what a chat worked out stays with the workspace when the chat goes',
    arrange: (store, folder) => {
      const workspace = store.rememberWorkspace(folder);
      const gone = store.createThread(folder, { workspaceId: workspace.id });
      const asking = store.createThread(folder, { workspaceId: workspace.id });
      const decided = remembered('e1', 'preference', 'critical', 'the person wants short answers');

      store.recordObservations(gone.id, [decided]);
      store.deleteThread(gone.id);

      // The chat being gone is what takes the turn away: what was worked out is
      // still held, and there is nothing left to check it against.
      return { workspaceId: workspace.id, asking: asking.id, want: kept(decided) };
    },
  },
  {
    name: 'a workspace keeps what two chats worked out once, not twice',
    arrange: (store, folder) => {
      const workspace = store.rememberWorkspace(folder);
      const first = store.createThread(folder, { workspaceId: workspace.id });
      const second = store.createThread(folder, { workspaceId: workspace.id });
      const asking = store.createThread(folder, { workspaceId: workspace.id });
      const same = remembered('e1', 'preference', 'critical', 'deploys run on Fridays');

      store.recordObservations(first.id, [same]);
      store.recordObservations(second.id, [same]);
      store.deleteThread(first.id);
      store.deleteThread(second.id);

      return { workspaceId: workspace.id, asking: asking.id, want: kept(same) };
    },
  },
  {
    name: 'what a workspace holds is held once, even when the chat that said it is still here',
    arrange: (store, folder) => {
      const workspace = store.rememberWorkspace(folder);
      const gone = store.createThread(folder, { workspaceId: workspace.id });
      const alongside = store.createThread(folder, { workspaceId: workspace.id });
      const asking = store.createThread(folder, { workspaceId: workspace.id });
      const same = remembered('e1', 'preference', 'critical', 'deploys run on Fridays');

      store.recordObservations(gone.id, [same]);
      store.recordObservations(alongside.id, [same]);
      store.deleteThread(gone.id);

      // Two lines saying one thing read as two decisions, and what a keepsake
      // cannot do that what a chat still holding it can is name a turn — so the
      // chat that is still here is the version a reader gets.
      return { workspaceId: workspace.id, asking: asking.id, want: [same] };
    },
  },
  {
    name: 'what two chats did to one file is two things the workspace knows',
    arrange: (store, folder) => {
      const workspace = store.rememberWorkspace(folder);
      const reader = store.createThread(folder, { workspaceId: workspace.id });
      const writer = store.createThread(folder, { workspaceId: workspace.id });
      const asking = store.createThread(folder, { workspaceId: workspace.id });
      const read = remembered('e1', 'read', 'low', 'src/session.ts');
      const changed = remembered('e1', 'changed', 'medium', 'src/session.ts');

      store.recordObservations(reader.id, [read]);
      store.recordObservations(writer.id, [changed]);
      store.deleteThread(reader.id);
      store.deleteThread(writer.id);

      // A summary carries the change and drops the read, so a workspace that kept
      // only whichever chat went first would have lost the one that mattered.
      return { workspaceId: workspace.id, asking: asking.id, want: kept(read, changed) };
    },
  },
];

for (const testCase of KEPT_CASES) {
  test(testCase.name, () => {
    const store = new ThreadStore(storePath());
    const { workspaceId, asking, want } = testCase.arrange(
      store,
      join(tmpdir(), 'foundry-a-workspace'),
    );

    assert.deepEqual(store.loadWorkspaceObservations(workspaceId, asking), want);
    store.close();
  });
}

test('what a workspace kept goes when the workspace goes', () => {
  const store = new ThreadStore(storePath());
  const workspace = store.rememberWorkspace(join(tmpdir(), 'foundry-a-workspace'));
  const gone = store.createThread(tmpdir(), { workspaceId: workspace.id });
  const beside = store.createThread(tmpdir(), { workspaceId: workspace.id });

  store.recordObservations(gone.id, [remembered('e1', 'goal', 'high', 'Fix the auth bug')]);
  store.recordObservations(beside.id, [remembered('e1', 'goal', 'high', 'Ship the deploy script')]);
  store.deleteThread(gone.id);

  // Kept while there is a workspace to keep it, which is the half that has to hold
  // for the rest of this case to be about removing one.
  assert.deepEqual(store.loadWorkspaceObservations(workspace.id, beside.id), [
    {
      entryId: null,
      at: '2026-01-01T00:00:00.000Z',
      kind: 'goal',
      relevance: 'high',
      text: 'Fix the auth bug',
    },
  ]);

  store.forgetWorkspace(workspace.id);

  // A workspace is the reason a gone chat's work was kept, so forgetting it forgets
  // that too. The chats still here are not the workspace's to lose: what they are
  // holding is theirs, and it stays with them.
  assert.deepEqual(store.loadWorkspaceObservations(workspace.id, beside.id), []);
  assert.deepEqual(contents(store, beside.id), [
    remembered('e1', 'goal', 'high', 'Ship the deploy script'),
  ]);
  store.close();
});

test('putting a chat away keeps what Kira is holding', () => {
  const store = new ThreadStore(storePath());
  const chat = store.createThread(tmpdir());
  store.recordObservations(chat.id, [remembered('e1', 'goal', 'high', 'Fix the auth bug')]);

  // Being put away takes a chat out of the list and nothing else. A chat that
  // came back having forgotten the work it was doing would be a second chat.
  store.archiveThread(chat.id);

  assert.deepEqual(contents(store, chat.id), [
    remembered('e1', 'goal', 'high', 'Fix the auth bug'),
  ]);
  store.close();
});

test('a thing the chat no longer says is let go', () => {
  const store = new ThreadStore(storePath());
  const chat = store.createThread(tmpdir());

  store.recordObservations(chat.id, [
    remembered('e1', 'goal', 'high', 'Fix the auth bug'),
    remembered('e2', 'read', 'low', 'deploy.toml'),
  ]);
  // What a branch switch leaves behind: a chat is read on one branch, and what
  // was said on a branch it is no longer on is not something it is holding.
  store.recordObservations(chat.id, [remembered('e1', 'goal', 'high', 'Fix the auth bug')]);

  assert.deepEqual(contents(store, chat.id), [
    remembered('e1', 'goal', 'high', 'Fix the auth bug'),
  ]);
  store.close();
});

// ── What a search of another chat reads ──────────────────────────────────────

test('a chat is read as the branch it stands on, not as every entry it holds', () => {
  const store = new ThreadStore(storePath());
  const thread = store.createThread(tmpdir());

  store.appendEntry(thread.id, stored('a', null));
  store.appendEntry(thread.id, stored('b', 'a'));
  store.appendEntry(thread.id, stored('c', 'b'));

  // Going back to b and writing another entry leaves c on a branch nobody is
  // standing on. It is still stored — the session is append-only — but it is no
  // longer part of this chat, and a search of it would find work nobody is doing.
  store.setHead(thread.id, 'b');
  store.appendEntry(thread.id, stored('d', 'b'));

  assert.deepEqual(
    store.branchEntries(thread.id).map((entry) => entry.id),
    ['a', 'b', 'd'],
  );
  assert.deepEqual(
    store.loadEntries(thread.id).map((entry) => entry.id),
    ['a', 'b', 'c', 'd'],
  );
});

test('a chat nobody has written to has no branch to read', () => {
  const store = new ThreadStore(storePath());

  assert.deepEqual(store.branchEntries(store.createThread(tmpdir()).id), []);
});

test("a workspace's other chats are the ones a search reaches, and the asker is not", () => {
  const store = new ThreadStore(storePath());
  const workspace = store.rememberWorkspace(join(tmpdir(), 'api'));
  const here = store.createThread(workspace.folder, { workspaceId: workspace.id });
  const sibling = store.createThread(workspace.folder, { workspaceId: workspace.id });
  store.createThread(join(tmpdir(), 'site'));

  assert.deepEqual(
    store.loadWorkspaceThreads(workspace.id, here.id).map((thread) => thread.id),
    [sibling.id],
  );
});

test('a chat whose place was never written down is read where pi would put it', () => {
  const store = new ThreadStore(storePath());
  const thread = store.createThread(tmpdir());

  // A chat copied out of another one — a fork — has its entries written down
  // without a position of its own, because the copy happens in the database
  // rather than by appending to it. pi loads such a chat at its last entry, so
  // that is the branch it has; reading it as empty would make a fork invisible to
  // a search, and would leave it called "New chat" in the list.
  store.reconcile(thread.id, [stored('a', null), stored('b', 'a'), stored('c', 'b')]);

  assert.equal(store.getThread(thread.id).headId, null);
  assert.deepEqual(
    store.branchEntries(thread.id).map((entry) => entry.id),
    ['a', 'b', 'c'],
  );
});

test('a conclusion offered twice is held once', () => {
  const store = new ThreadStore(storePath());
  const thread = store.createThread(tmpdir());

  store.recordReflections(thread.id, [
    { text: 'the queue was rejected for ingest', coversThrough: 4 },
  ]);

  // The reflector runs once per compaction and is told what the chat already
  // concluded, but a model that repeats itself must not leave two copies behind:
  // a conclusion and its paraphrase both being carried is the confusion this
  // whole layer exists to avoid.
  store.recordReflections(thread.id, [
    { text: 'the queue was rejected for ingest', coversThrough: 4 },
    { text: 'deploys run on Fridays before 3pm', coversThrough: 6 },
  ]);

  assert.deepEqual(concludedBy(store, thread.id), [
    { text: 'the queue was rejected for ingest', coversThrough: 4 },
    { text: 'deploys run on Fridays before 3pm', coversThrough: 6 },
  ]);
});

test('what a chat concluded goes when the chat goes', () => {
  const store = new ThreadStore(storePath());
  const thread = store.createThread(tmpdir());

  store.recordReflections(thread.id, [{ text: 'nothing here is worth keeping', coversThrough: 2 }]);
  store.deleteThread(thread.id);

  assert.deepEqual(store.loadReflections(thread.id), []);
});

test('a conclusion drawn before anything was numbered still stands', () => {
  const store = new ThreadStore(storePath());
  const thread = store.createThread(tmpdir());

  // A reflector can conclude something from a chat it could not number — a chat
  // whose only turn is a header, or whose model answered without citing a turn.
  // The conclusion is still a conclusion, so it is kept with nothing to point at
  // rather than dropped for lacking a handle.
  store.recordReflections(thread.id, [
    { text: 'the person wants short answers', coversThrough: null },
  ]);

  assert.deepEqual(concludedBy(store, thread.id), [
    { text: 'the person wants short answers', coversThrough: null },
  ]);
});

/** What a chat has concluded, without asserting where each row sits in the table. */
function concludedBy(store: ThreadStore, threadId: string) {
  return store
    .loadReflections(threadId)
    .map(({ text, coversThrough }) => ({ text, coversThrough }));
}

test('a chat says which ticket it is a run of, and an ordinary chat says nothing', () => {
  const store = new ThreadStore(storePath());
  const folder = join(tmpdir(), 'foundry-space');

  const ordinary = store.createThread(folder);
  const run = store.createThread(folder, { ticketId: 'ticket-one' });

  assert.equal(ordinary.ticketId, null, 'a chat somebody had is not a run of anything');
  assert.equal(run.ticketId, 'ticket-one');
  assert.equal(store.getThread(run.id).ticketId, 'ticket-one');
  assert.equal(
    store.listThreads().find((each) => each.id === run.id)?.ticketId,
    'ticket-one',
    'and the list the sidebar reads says so too',
  );
  store.close();
});
