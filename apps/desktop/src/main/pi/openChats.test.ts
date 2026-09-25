/**
 * The chats that are open, exercised through what a window can see of them.
 *
 * These cases can open, show, and leave chats, but none of them can start a
 * turn — that takes a model — so the words in flight, the events a turn pushes,
 * and the sessions that are kept alive while one is writing are verified in the
 * app itself rather than here. The refusals go the same way: putting a chat
 * away, throwing one away, and forgetting a workspace are each refused while Kira
 * is writing, and each of those refusals is read out of a live turn.
 */
import { strict as assert } from 'node:assert';
import { writeFileSync } from 'node:fs';
import { basename, join } from 'node:path';
import { test } from 'node:test';
import { getAgentDir, SettingsManager } from '@earendil-works/pi-coding-agent';
import type { ChatState } from '../../preload/bridge.ts';
import { ThreadStore } from '../db/threads.ts';
import { tempDir } from '../test-support/temp.ts';
import { type OpenChats, openChats } from './openChats.ts';
import { kiraModels, type Models } from './models.ts';
import { createThread, type PiThread } from './storage.ts';

// Hermetic: pi reads `PI_CODING_AGENT_DIR` for credentials and `HOME` for the
// global skills source, so neither leaks in from the developer's machine.
process.env['HOME'] = tempDir('kira-open-home-');
process.env['PI_CODING_AGENT_DIR'] = tempDir('kira-open-agent-dir-');

/**
 * The models these chats run on: what a launch that has asked before remembers.
 * Written down rather than fetched, since what a session runs on is the server's
 * to say and asking it is `models.test.ts`'s job — here it only has to be there
 * for a chat to open.
 */
function rememberedModels(ids: string[] = ['served-model']): Models {
  const cache = join(tempDir('kira-open-models-'), 'models.json');
  writeFileSync(cache, JSON.stringify({ models: ids.map((id) => ({ id, name: id })) }));

  return kiraModels({
    server: 'http://localhost:4100',
    cachePath: cache,
    token: async () => 'device-key',
    catalog: async () => ({ kind: 'unavailable' }),
  });
}

const MODELS = rememberedModels();

/** The user asks something, and the chat holds it. Answers its entry id. */
function ask(thread: PiThread, words: string): string {
  return thread.sessionManager.appendMessage({ role: 'user', content: words, timestamp: 1 });
}

/** Stored chats, by the place the cases know them by. */
interface Fixture {
  store: ThreadStore;
  /** Each chat's thread id, in the order the chats were made. */
  ids: string[];
  /** Each chat's first question, which is what a case has to name a message with. */
  asked: string[];
}

/**
 * Legacy-style chats with one question each: enough to exercise opening and
 * leaving chats that predate persisted shaping state.
 */
function storedChats(): Fixture {
  const store = new ThreadStore(join(tempDir('kira-open-store-'), 'threads.db'));
  const asked: string[] = [];
  const ids = ['where are we', 'and the tests'].map((words) => {
    const thread = createThread(store, tempDir('kira-open-space-'));
    asked.push(ask(thread, words));

    return thread.threadId;
  });

  return { store, ids, asked };
}

/** What a window would see, in the places this fixture knows. */
interface Facts {
  /** The chat on screen: its place in the fixture's list, or -1 for a new one. */
  current: number;
  /** Whether a new chat is being composed, whether or not it is on screen. */
  draft: boolean;
  /** Every chat in the list. */
  chats: number[];
  /** Where the branch on screen ends, as a place in the transcript; -1 for nowhere. */
  head: number;
  /** How many messages the transcript holds. */
  messages: number;
  running: number[];
  streaming: string | null;
}

function factsOf(state: ChatState, fixture: Fixture): Facts {
  const place = (id: string): number => fixture.ids.indexOf(id);

  return {
    // A new chat is composed under an id that is stored nowhere, so it is not a
    // place in the fixture: -1 says the pane on screen is that new chat.
    current: place(state.currentId),
    draft: state.draftId !== null,
    // The list is recent-activity-first. The order is left out here because
    // these cases are about which chats are present, not their sorting choice.
    chats: state.chats.map((chat) => place(chat.id)).sort((one, other) => one - other),
    head:
      state.transcript.headId === null
        ? -1
        : state.transcript.messages.findIndex((message) => message.id === state.transcript.headId),
    messages: state.transcript.messages.length,
    running: state.running.map(place),
    streaming: state.streaming,
  };
}

/** Show the chat at `chat`, which the cases name by its place in the fixture. */
async function show(chats: OpenChats, fixture: Fixture, chat: number): Promise<void> {
  await chats.open(fixture.ids[chat] ?? '');
}

/**
 * The folders a new chat could be given to work in, as a window hands them out:
 * one per request, kept so a case can say whether one was asked for at all.
 */
function newWorkspaces(): { make: () => string; made: string[] } {
  const made: string[] = [];

  return {
    made,
    make: () => {
      const folder = tempDir('kira-open-space-');
      made.push(folder);

      return folder;
    },
  };
}

/** Begin a new chat to compose in, filed nowhere in particular. */
async function begin(chats: OpenChats): Promise<void> {
  await chats.start(null);
}

interface Case {
  name: string;
  run: (chats: OpenChats, fixture: Fixture) => Promise<void>;
  want: Facts;
}

const CASES: Case[] = [
  {
    name: 'showing a chat shows its own words',
    run: async (chats, fixture) => {
      await show(chats, fixture, 0);
    },
    want: {
      current: 0,
      draft: false,
      chats: [0, 1],
      head: 0,
      messages: 1,
      running: [],
      streaming: null,
    },
  },
  {
    name: 'showing another chat leaves the one before it in the list',
    run: async (chats, fixture) => {
      await show(chats, fixture, 0);
      await show(chats, fixture, 1);
    },
    want: {
      current: 1,
      draft: false,
      chats: [0, 1],
      head: 0,
      messages: 1,
      running: [],
      streaming: null,
    },
  },
  {
    name: 'a new chat is composed without joining the list',
    run: async (chats, fixture) => {
      await show(chats, fixture, 0);
      await begin(chats);
    },
    want: {
      current: -1,
      draft: true,
      chats: [0, 1],
      head: -1,
      messages: 0,
      running: [],
      streaming: null,
    },
  },
  {
    name: 'a new chat is still being composed after another chat is read',
    run: async (chats, fixture) => {
      await begin(chats);
      await show(chats, fixture, 0);
    },
    want: {
      current: 0,
      draft: true,
      chats: [0, 1],
      head: 0,
      messages: 1,
      running: [],
      streaming: null,
    },
  },
  {
    name: 'taking a question back moves the chat to where it was said, and keeps the words',
    run: async (chats, fixture) => {
      await show(chats, fixture, 0);
      await chats.edit(fixture.asked[0] ?? '');
    },
    want: {
      current: 0,
      draft: false,
      chats: [0, 1],
      head: -1,
      messages: 1,
      running: [],
      streaming: null,
    },
  },
  {
    name: 'forking shows the new chat holding the words it was forked from',
    run: async (chats, fixture) => {
      await show(chats, fixture, 0);
      await chats.fork(fixture.asked[0] ?? '');
      fixture.ids.push(chats.state().currentId);
    },
    want: {
      current: 2,
      draft: false,
      chats: [0, 1, 2],
      head: 0,
      messages: 1,
      running: [],
      streaming: null,
    },
  },
];

for (const testCase of CASES) {
  test(testCase.name, async () => {
    const fixture = storedChats();
    const workspaces = newWorkspaces();
    const chats = openChats(fixture.store, () => {}, workspaces.make, MODELS);

    await testCase.run(chats, fixture);
    assert.deepEqual(factsOf(chats.state(), fixture), testCase.want);

    chats.closeAll();
    fixture.store.close();
  });
}

test('composing a new chat creates nothing, in a workspace or nowhere', async () => {
  const fixture = storedChats();
  const workspaces = newWorkspaces();
  const chats = openChats(fixture.store, () => {}, workspaces.make, MODELS);
  const workspace = fixture.store.rememberWorkspace(tempDir('kira-open-workspace-'));
  const before = fixture.store.listThreads().length;

  await show(chats, fixture, 0);

  // Setting the scene: a workspace is on the surface the moment it exists, because
  // a folder with nothing in it yet is a workspace, which is the whole difference
  // between one and a chat.
  assert.deepEqual(chats.state().workspaces, [
    {
      id: workspace.id,
      name: basename(workspace.folder),
      folder: workspace.folder,
      projectId: null,
    },
  ]);

  await begin(chats);
  await chats.start(workspace.id);

  // A chat is made of words. Until one is sent there is no row to read and no
  // folder to work in — for a chat that works in a workspace, because the workspace
  // is already the folder, and for one filed nowhere, because it has not been
  // given one. What exists is the id the words will be said under.
  assert.equal(chats.state().draftId !== null, true);
  assert.deepEqual(chats.state().shaping, { proposals: [] });
  assert.equal(fixture.store.listThreads().length, before);
  assert.deepEqual(workspaces.made, []);

  chats.closeAll();
  fixture.store.close();
});
test('chat mode is kept per chat and new chats start in Build', async () => {
  const fixture = storedChats();
  const workspaces = newWorkspaces();
  const chats = openChats(fixture.store, () => {}, workspaces.make, MODELS);
  try {
    await chats.open(fixture.ids[0] ?? '');
    assert.equal(chats.state().mode, 'build');

    await chats.setMode('spec');
    assert.equal(chats.state().mode, 'spec');
    assert.equal(fixture.store.getThread(fixture.ids[0] ?? '').mode, 'spec');

    await chats.open(fixture.ids[1] ?? '');
    assert.equal(chats.state().mode, 'build');

    await begin(chats);
    assert.equal(chats.state().mode, 'build');
    await chats.setMode('spec');
    assert.equal(chats.state().mode, 'spec');
  } finally {
    chats.closeAll();
    fixture.store.close();
  }
});
test('changing the Bash path updates all open chats immediately', async () => {
  const fixture = storedChats();
  const workspaces = newWorkspaces();
  const chats = openChats(fixture.store, () => {}, workspaces.make, MODELS);
  try {
    await chats.open(fixture.ids[0] ?? '');
    await chats.open(fixture.ids[1] ?? '');

    await chats.setShellPath('C:\\Tools\\Git\\bin\\bash.exe');

    const settings = SettingsManager.create(process.cwd(), getAgentDir(), {
      projectTrusted: false,
    });
    assert.equal(settings.getShellPath(), 'C:\\Tools\\Git\\bin\\bash.exe');
  } finally {
    chats.closeAll();
    fixture.store.close();
  }
});

test('forgetting a workspace unfiles its chats, which keep working where they were', async () => {
  const fixture = storedChats();
  const workspaces = newWorkspaces();
  const chats = openChats(fixture.store, () => {}, workspaces.make, MODELS);
  const workspace = fixture.store.rememberWorkspace(tempDir('kira-open-workspace-'));
  const filed = createThread(fixture.store, workspace.folder, { workspaceId: workspace.id });

  await chats.open(filed.threadId);
  await chats.removeWorkspace(workspace.id);

  // A workspace is a filing, not a home: its chats keep their words and the folder
  // they were working in, and are simply filed nowhere until they are filed
  // somewhere again. Forgetting one does not close anything.
  assert.deepEqual(chats.state().workspaces, []);
  assert.equal(chats.state().currentId, filed.threadId);
  assert.equal(fixture.store.getThread(filed.threadId).workspaceId, null);
  assert.equal(fixture.store.getThread(filed.threadId).cwd, workspace.folder);

  chats.closeAll();
  fixture.store.close();
});

test('asking for a new chat again returns to the one already being composed', async () => {
  const fixture = storedChats();
  const workspaces = newWorkspaces();
  const chats = openChats(fixture.store, () => {}, workspaces.make, MODELS);

  await begin(chats);
  const composing = chats.state().draftId;

  // Words are written in the pane that is keyed by this id, so the id surviving
  // a chat being read and a new chat being asked for is what keeps them: the
  // window never has to hand the words to a different pane.
  await show(chats, fixture, 0);
  await begin(chats);

  assert.equal(chats.state().draftId, composing);

  chats.closeAll();
  fixture.store.close();
});

test('closing every chat forgets the new one being composed', async () => {
  const fixture = storedChats();
  const workspaces = newWorkspaces();
  const chats = openChats(fixture.store, () => {}, workspaces.make, MODELS);

  await begin(chats);
  chats.closeAll();

  // A window is gone, so nothing is being composed in it: the next window starts
  // with a new chat of its own rather than an id and no words to go with it.
  assert.throws(() => chats.state(), { message: 'No chat is open.' });

  fixture.store.close();
});

test('a fork is filed where the chat it came from was filed', async () => {
  const store = new ThreadStore(join(tempDir('kira-open-store-'), 'threads.db'));
  const workspace = store.rememberWorkspace(tempDir('kira-open-workspace-'));
  const source = createThread(store, workspace.folder, { workspaceId: workspace.id });
  const asked = ask(source, 'where are we');
  const workspaces = newWorkspaces();
  const chats = openChats(store, () => {}, workspaces.make, MODELS);

  await chats.open(source.threadId);
  await chats.fork(asked);

  // A fork is the same work carried on, so it stays where the work is filed.
  assert.equal(store.getThread(chats.state().currentId).workspaceId, workspace.id);

  chats.closeAll();
  store.close();
});

test('with nothing open there is nothing to show or send', async () => {
  const fixture = storedChats();
  const workspaces = newWorkspaces();
  const chats = openChats(fixture.store, () => {}, workspaces.make, MODELS);

  assert.throws(() => chats.state(), { message: 'No chat is open.' });
  await assert.rejects(() => chats.send('are you there?'), { message: 'No chat is open.' });
  await assert.rejects(() => chats.queue('and this too', 'later'), { message: 'No chat is open.' });
  assert.throws(() => chats.takeQueuedBack(), { message: 'No chat is open.' });
  await assert.rejects(() => chats.stop(), { message: 'No chat is open.' });
  await assert.rejects(() => chats.compact(), { message: 'No chat is open.' });

  fixture.store.close();
});

test('a ticket run remains an ordinary flat chat row beside its shaping chat', async () => {
  const store = new ThreadStore(join(tempDir('kira-open-store-'), 'threads.db'));
  const workspace = store.rememberWorkspace(tempDir('kira-open-workspace-'));
  const shaping = createThread(store, workspace.folder, { workspaceId: workspace.id });
  const run = createThread(store, workspace.folder, {
    workspaceId: workspace.id,
    ticketId: 'child-1',
  });
  ask(run, 'I checked the slice.');
  const chats = openChats(store, () => {}, newWorkspaces().make, MODELS);

  await chats.open(shaping.threadId);

  const rows = chats.state().chats;
  assert.equal(rows.length, 2);
  assert.equal(rows.find(({ id }) => id === run.threadId)?.ticketId, 'child-1');
  assert.equal(rows.find(({ id }) => id === shaping.threadId)?.ticketId, null);
  assert.ok(rows.every(({ workspaceId }) => workspaceId === workspace.id));

  chats.closeAll();
  store.close();
});

test('a chat with nothing waiting gives nothing back', async () => {
  const fixture = storedChats();
  const workspaces = newWorkspaces();
  const chats = openChats(fixture.store, () => {}, workspaces.make, MODELS);

  await show(chats, fixture, 0);

  // Taking words back is only about the queue: with none, the chat is untouched,
  // and reading the queue and emptying it agree with each other.
  assert.deepEqual(chats.state().queued, []);
  assert.deepEqual(chats.takeQueuedBack(), []);
  assert.deepEqual(factsOf(chats.state(), fixture), {
    current: 0,
    draft: false,
    chats: [0, 1],
    head: 0,
    messages: 1,
    running: [],
    streaming: null,
  });

  fixture.store.close();
});

test('closing every chat disposes them, and what they held is still stored', async () => {
  const fixture = storedChats();
  const workspaces = newWorkspaces();
  const chats = openChats(fixture.store, () => {}, workspaces.make, MODELS);

  await show(chats, fixture, 0);
  chats.closeAll();
  assert.throws(() => chats.state(), { message: 'No chat is open.' });

  // A session being disposed says nothing about the chat: it is on disk, so
  // opening it again is reading it again.
  await show(chats, fixture, 0);
  assert.deepEqual(factsOf(chats.state(), fixture), {
    current: 0,
    draft: false,
    chats: [0, 1],
    head: 0,
    messages: 1,
    running: [],
    streaming: null,
  });

  chats.closeAll();
  fixture.store.close();
});

test('a chat that is put away leaves the list, and is still there to open', async () => {
  const fixture = storedChats();
  const workspaces = newWorkspaces();
  const chats = openChats(fixture.store, () => {}, workspaces.make, MODELS);
  const put = fixture.ids[0] ?? '';

  await show(chats, fixture, 0);
  await chats.archiveChat(put);

  // Putting a chat away is not throwing it away: it is out of the list, and the
  // window goes to the most recent chat that is still in it. Everything the
  // chat held stays, which is what it will be offered back with.
  assert.deepEqual(factsOf(chats.state(), fixture), {
    current: 1,
    draft: false,
    chats: [1],
    head: 0,
    messages: 1,
    running: [],
    streaming: null,
  });

  // Out of the list is not out of reach: a chat that was put away is opened by
  // its id like any other, with its words.
  await show(chats, fixture, 0);
  assert.deepEqual(factsOf(chats.state(), fixture), {
    current: 0,
    draft: false,
    chats: [1],
    head: 0,
    messages: 1,
    running: [],
    streaming: null,
  });

  chats.closeAll();
  fixture.store.close();
});

test('a chat brought back rejoins the list without moving what the window is showing', async () => {
  const fixture = storedChats();
  const workspaces = newWorkspaces();
  const chats = openChats(fixture.store, () => {}, workspaces.make, MODELS);
  const put = fixture.ids[0] ?? '';

  await show(chats, fixture, 1);
  await chats.archiveChat(put);
  await chats.restoreChat(put);

  // Bringing a chat back undoes exactly what putting it away did: it is in the
  // list again, and the window is left showing whatever it was already showing
  // — restoring one chat is not a reason to move off another.
  assert.deepEqual(factsOf(chats.state(), fixture), {
    current: 1,
    draft: false,
    chats: [0, 1],
    head: 0,
    messages: 1,
    running: [],
    streaming: null,
  });

  chats.closeAll();
  fixture.store.close();
});

test('deleting a chat takes it out of the list, and the window goes to the chat left', async () => {
  const fixture = storedChats();
  const workspaces = newWorkspaces();
  const chats = openChats(fixture.store, () => {}, workspaces.make, MODELS);
  const gone = fixture.ids[0] ?? '';

  await show(chats, fixture, 0);
  await chats.deleteChat(gone);

  // The chat is gone, and the window is not left drawing it: what it shows is
  // the most recent chat that is still in the list.
  assert.deepEqual(factsOf(chats.state(), fixture), {
    current: 1,
    draft: false,
    chats: [1],
    head: 0,
    messages: 1,
    running: [],
    streaming: null,
  });
  assert.throws(() => fixture.store.getThread(gone), {
    message: `No thread stored with id ${gone}.`,
  });

  chats.closeAll();
  fixture.store.close();
});

test('deleting a chat the window is not showing leaves the window where it is', async () => {
  const fixture = storedChats();
  const workspaces = newWorkspaces();
  const chats = openChats(fixture.store, () => {}, workspaces.make, MODELS);

  await show(chats, fixture, 0);
  await chats.deleteChat(fixture.ids[1] ?? '');

  // A chat going does not move the window unless it was the chat the window was
  // drawing: what was on screen is still there to be read.
  assert.deepEqual(factsOf(chats.state(), fixture), {
    current: 0,
    draft: false,
    chats: [0],
    head: 0,
    messages: 1,
    running: [],
    streaming: null,
  });

  chats.closeAll();
  fixture.store.close();
});

test('deleting the last chat leaves a new chat to compose in', async () => {
  const store = new ThreadStore(join(tempDir('kira-open-store-'), 'threads.db'));
  const thread = createThread(store, tempDir('kira-open-space-'));
  ask(thread, 'anything at all');
  const workspaces = newWorkspaces();
  const chats = openChats(store, () => {}, workspaces.make, MODELS);
  const only = thread.threadId;

  await chats.open(only);
  await chats.deleteChat(only);

  // A window draws a chat, so it has to be given one: with nothing left in the
  // list, what it draws is a new chat to compose in. Nothing is stored for that
  // one and nothing is made for it, exactly as when New chat is pressed.
  const state = chats.state();
  assert.deepEqual(state.chats, []);
  assert.equal(state.draftId, state.currentId);
  assert.equal(store.listThreads().length, 0);
  assert.deepEqual(workspaces.made, []);

  chats.closeAll();
  store.close();
});

test('putting away or deleting a chat that is already gone is not a failure', async () => {
  const fixture = storedChats();
  const workspaces = newWorkspaces();
  const chats = openChats(fixture.store, () => {}, workspaces.make, MODELS);

  await show(chats, fixture, 0);

  // The window asks for what it drew, and what it drew may already be gone —
  // from another window, or from this one a moment ago. Either way the answer
  // is the same: that chat is not there, and the one on screen is untouched.
  await chats.archiveChat('a-chat-that-never-was');
  await chats.deleteChat('a-chat-that-never-was');
  assert.equal(chats.state().currentId, fixture.ids[0]);

  chats.closeAll();
  fixture.store.close();
});

test('a new chat starts on the model the chat before it ran on', async () => {
  const fixture = storedChats();
  const workspaces = newWorkspaces();
  const chats = openChats(
    fixture.store,
    () => {},
    workspaces.make,
    rememberedModels(['preferred-model', 'chosen-model']),
  );

  // A chat changed to the pool's second model, so what it runs on can be told
  // apart from what the pool prefers.
  fixture.store.setThreadModel(fixture.ids[0] ?? '', 'chosen-model');

  await show(chats, fixture, 0);
  assert.equal(chats.state().modelId, 'chosen-model');

  await begin(chats);

  // Beginning a chat leaves the model where it was. The choice is still the
  // chat's — nothing binds the new chat to it — but starting back at the pool's
  // preference would mean picking the same model again every time one is begun.
  assert.equal(chats.state().modelId, 'chosen-model');

  chats.closeAll();
  fixture.store.close();
});

test('what a chat worked out reaches the window, beside what it was told', async () => {
  const fixture = storedChats();
  const chats = openChats(fixture.store, () => {}, newWorkspaces().make, MODELS);
  const first = fixture.ids[0];
  assert.ok(first, 'the fixture has a chat to work something out in');

  // The reflector draws conclusions at compaction, which takes a model, so they
  // are written the way the store writes them rather than spent for here.
  fixture.store.recordReflections(first, [
    { text: 'The auth bug is in the session lookup', coversThrough: 1 },
  ]);

  await show(chats, fixture, 0);

  // Read as the window reads it. This is the whole path — the table, the chat,
  // and the snapshot the pane draws — so a conclusion that stopped being carried
  // anywhere along it would fail here rather than quietly never appearing.
  assert.deepEqual(chats.state().conclusions, [
    { text: 'The auth bug is in the session lookup', coversThrough: 1 },
  ]);

  // A chat beside it has worked nothing out, and says so rather than borrowing
  // its sibling's conclusions.
  await show(chats, fixture, 1);
  assert.deepEqual(chats.state().conclusions, []);

  chats.closeAll();
  fixture.store.close();
});
