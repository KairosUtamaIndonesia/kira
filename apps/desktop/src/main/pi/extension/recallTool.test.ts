import { strict as assert } from 'node:assert';
import { writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import type {
  ExtensionAPI,
  ExtensionContext,
  SessionManager,
} from '@earendil-works/pi-coding-agent';
import { ThreadStore } from '../../db/threads.ts';
import { tempDir } from '../../test-support/temp.ts';
import { resumeSession } from '../agent.ts';
import { kiraModels, type Models } from '../models.ts';
import { createThread } from '../storage.ts';
import { kiraExtension } from './factory.ts';
import { recallTool } from './recallTool.ts';

// Hermetic, as the other booting tests are: pi reads `PI_CODING_AGENT_DIR` for
// settings and credentials and `HOME` for the global skills source.
const AGENT_DIR = tempDir('kira-recall-agent-');
process.env['HOME'] = tempDir('kira-recall-home-');
process.env['PI_CODING_AGENT_DIR'] = AGENT_DIR;

// Compaction is what recall exists for, so the chat in the headline test below
// has to have actually compacted. Keeping almost nothing recent leaves the next
// compaction with a great deal to discard, through the same settings file a
// person's install carries rather than a flag that exists only for tests.
writeFileSync(
  join(AGENT_DIR, 'settings.json'),
  JSON.stringify({ compaction: { enabled: true, keepRecentTokens: 1 } }),
);

/** The models a session runs on, and a server that is not there. */
function offlineModels(): Models {
  const cache = join(tempDir('kira-recall-models-'), 'models.json');
  writeFileSync(cache, JSON.stringify({ models: [{ id: 'served-model', name: 'Served Model' }] }));

  return kiraModels({
    server: 'http://127.0.0.1:1',
    cachePath: cache,
    token: async () => 'device-key',
    catalog: async () => ({ kind: 'unavailable' }),
  });
}

const MODELS = offlineModels();

/** What a reply costs, as pi records it. Nothing here reads it. */
function usage() {
  return {
    input: 1,
    output: 1,
    cacheRead: 0,
    cacheWrite: 0,
    totalTokens: 2,
    cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
  };
}

/** Writing a chat the way pi stores one, without running a model to do it. */
interface Writer {
  person(text: string): void;
  kira(text: string): void;
  /** A reply that thought before it spoke. */
  thought(text: string, thinking: string): void;
  /** A reply that reached for a tool, and what the tool handed back. */
  worked(text: string, path: string, gave: string): void;
}

function writer(session: SessionManager): Writer {
  let at = 0;
  let calls = 0;

  const when = (): number => (at += 1);
  const reply = (content: unknown[], stopReason: string) =>
    session.appendMessage({
      role: 'assistant',
      content,
      api: 'kira',
      provider: 'kira',
      model: 'served-model',
      usage: usage(),
      stopReason,
      timestamp: when(),
    } as Parameters<SessionManager['appendMessage']>[0]);

  return {
    person(text) {
      session.appendMessage({ role: 'user', content: text, timestamp: when() });
    },

    kira(text) {
      reply([{ type: 'text', text }], 'stop');
    },

    thought(text, thinking) {
      reply(
        [
          { type: 'thinking', thinking },
          { type: 'text', text },
        ],
        'stop',
      );
    },

    worked(text, path, gave) {
      calls += 1;
      const callId = `call-${calls}`;

      reply(
        [
          { type: 'text', text },
          { type: 'toolCall', id: callId, name: 'read', arguments: { path } },
        ],
        'toolUse',
      );
      session.appendMessage({
        role: 'toolResult',
        toolCallId: callId,
        toolName: 'read',
        content: [{ type: 'text', text: gave }],
        isError: false,
        timestamp: when(),
      });
    },
  };
}

const EXCHANGES = (chat: Writer): void => {
  chat.person('the config lives in deploy.toml');
  chat.kira('I will read that before changing anything.');
  chat.worked('Reading it now.', 'deploy.toml', 'fridays = 18:00');
  chat.person('and what does the rollback plan say?');
  chat.kira('That the migration lands Thursday night.');
};

/**
 * A booted chat, and the tool Kira is given over it.
 *
 * The tool is built through `recallTool` rather than by hand, and the context it
 * is called with is the session's own manager, so what is exercised is the tool a
 * run would actually reach — not a re-statement of its logic in the test.
 */
async function lookedUp(fill: (chat: Writer) => void): Promise<{
  store: ThreadStore;
  cwd: string;
  threadId: string;
  session: SessionManager;
  ask: (params: {
    number?: number;
    search?: string;
    observation?: number;
    path?: string;
    kind?: 'text' | 'thinking' | 'toolCall' | 'toolResult';
    page?: number;
    scope?: 'chat' | 'workspace';
  }) => Promise<string>;
}> {
  const cwd = tempDir('kira-recall-space-');
  const path = join(tempDir('kira-recall-store-'), 'threads.db');
  const store = new ThreadStore(path);

  const thread = createThread(store, cwd);
  fill(writer(thread.sessionManager));

  const kira = await resumeSession(store, thread.threadId, MODELS);
  const session = kira.session.sessionManager;
  const tool = recallTool(store, kira.threadId);
  const ctx = { sessionManager: session } as unknown as ExtensionContext;

  return {
    store,
    cwd,
    threadId: kira.threadId,
    session,
    async ask(params) {
      const result = await tool.execute('call-1', params, undefined, undefined, ctx);
      const [first] = result.content;

      return first?.type === 'text' ? first.text : '';
    },
  };
}

// ── Reading a turn back ──────────────────────────────────────────────────────

test('a number reads the turn back, by the number the chat gave it', async () => {
  const chat = await lookedUp(EXCHANGES);

  // The timestamp is pi's, stamped when the turn was stored rather than when this
  // test wrote it, so the shape is pinned and the clock is not.
  assert.match(
    await chat.ask({ number: 1 }),
    /^#1 \(you, \d{4}-\d{2}-\d{2}T[\d:.]+Z\):\nthe config lives in deploy\.toml$/,
  );
  assert.match(
    await chat.ask({ number: 5 }),
    /^#5 \(you, \d{4}-\d{2}-\d{2}T[\d:.]+Z\):\nand what does the rollback plan say\?$/,
  );
  chat.store.close();
});

test('a number the chat does not hold is refused rather than approximated', async () => {
  const chat = await lookedUp(EXCHANGES);

  assert.equal(await chat.ask({ number: 99 }), 'This chat has no turn 99; it has 6.');
  chat.store.close();
});

test('a search finds turns by what they say, and gives their numbers', async () => {
  const chat = await lookedUp(EXCHANGES);

  assert.equal(
    await chat.ask({ search: 'rollback' }),
    'Found 1 turn about "rollback":\n\n#5 (you): and what does the rollback plan say?',
  );
  chat.store.close();
});

// ── What compaction took away ────────────────────────────────────────────────

test('recall reaches a turn that compaction removed from what Kira can see', async () => {
  // The whole reason the tool exists. Everything is written, the chat compacts
  // so that only the last reply is left in context, and the opening turn — gone
  // from what the model is shown — is still readable by its number.
  const cwd = tempDir('kira-recall-space-');
  const path = join(tempDir('kira-recall-store-'), 'threads.db');
  const store = new ThreadStore(path);

  const thread = createThread(store, cwd);
  EXCHANGES(writer(thread.sessionManager));

  const kira = await resumeSession(store, thread.threadId, MODELS);
  await kira.session.compact();

  const session = kira.session.sessionManager;
  const tool = recallTool(store, kira.threadId);
  const ctx = { sessionManager: session } as unknown as ExtensionContext;

  // Precondition, and the point: the opening turn is no longer part of what the
  // model is given, so an answer quoting it cannot have come from what she can see.
  const inContext = session
    .buildContextEntries()
    .flatMap((entry) => (entry.type === 'message' ? [entry] : []));
  assert.ok(
    !inContext.some((entry) => JSON.stringify(entry).includes('the config lives in deploy.toml')),
    'the opening turn should have been taken out of context by the compaction',
  );

  const result = await tool.execute('call-1', { number: 1 }, undefined, undefined, ctx);
  const [first] = result.content;

  assert.match(
    first?.type === 'text' ? first.text : '',
    /^#1 \(you, \d{4}-\d{2}-\d{2}T[\d:.]+Z\):\nthe config lives in deploy\.toml$/,
  );

  kira.session.dispose();
  store.close();
});

// ── Where something held came from ───────────────────────────────────────────

test('an observation resolves to the turn it was drawn from', async () => {
  const chat = await lookedUp(EXCHANGES);

  // Written rather than observed, because what is being tested is the look-up and
  // not the pass that works the ledger out — that pass has tests of its own, and
  // it runs when a conversation is opened rather than when a session is booted.
  const first = chat.session.getBranch()[0];
  assert.ok(first, 'the chat should hold the turn it was given');
  chat.store.recordObservations(chat.threadId, [
    {
      entryId: first.id,
      at: '2026-01-01T00:00:00.000Z',
      kind: 'goal',
      relevance: 'high',
      text: 'the config lives in deploy.toml',
    },
  ]);

  const holding = chat.store.loadObservations(chat.threadId)[0];
  assert.ok(holding, 'the chat should be holding what was written');

  const answer = await chat.ask({ observation: holding.id });

  assert.match(answer, /^"the config lives in deploy\.toml" was drawn from #1:/);
  assert.match(answer, /the config lives in deploy\.toml$/);
  chat.store.close();
});

test('an identifier the chat is not holding is refused rather than guessed at', async () => {
  const chat = await lookedUp(EXCHANGES);

  assert.match(
    await chat.ask({ observation: 9999 }),
    /not holding anything with the identifier 9999/,
  );
  chat.store.close();
});

// ── Reading a turn again ─────────────────────────────────────────────────────

test('a file recorded on a turn is read back by its path', async () => {
  const chat = await lookedUp(EXCHANGES);

  // The file was read on turn 3, so that is where its contents are recorded. The
  // path is asked for as a person would write it, not as the tool call spelled it.
  assert.match(
    await chat.ask({ number: 3, path: './deploy.toml' }),
    /^#3 \(kira, [^)]+\) — \.\/deploy\.toml, page 1 of 1:\nfridays = 18:00$/,
  );
  chat.store.close();
});

test('a file the turn was not about is answered with the files it was', async () => {
  const chat = await lookedUp(EXCHANGES);

  assert.equal(await chat.ask({ number: 1, path: 'deploy.toml' }), 'Turn 1 touched no files.');
  assert.equal(
    await chat.ask({ number: 3, path: 'ship.sh' }),
    'Turn 3 did not touch ship.sh. It touched: deploy.toml.',
  );
  chat.store.close();
});

test('a file longer than a page comes back a page at a time', async () => {
  const chat = await lookedUp((wrote) => {
    wrote.person('read the long one');
    wrote.worked('Reading it now.', 'long.txt', 'x'.repeat(3000));
  });

  // Two pages of two thousand characters, and the second holds what is left.
  assert.match(
    await chat.ask({ number: 2, path: 'long.txt' }),
    /^#2 \(kira, [^)]+\) — long\.txt, page 1 of 2:\nx{2000}\n\nPage 2 has the rest\.$/,
  );
  assert.match(
    await chat.ask({ number: 2, path: 'long.txt', page: 2 }),
    /^#2 \(kira, [^)]+\) — long\.txt, page 2 of 2:\nx{1000}$/,
  );
  assert.equal(
    await chat.ask({ number: 2, path: 'long.txt', page: 9 }),
    'long.txt has 2 pages; there is no page 9.',
  );
  chat.store.close();
});

test('a turn is read again for the reasoning behind it', async () => {
  const chat = await lookedUp((wrote) => {
    wrote.person('why is the deploy on Fridays?');
    wrote.thought('Because the script reads deploy.toml.', 'The file sets the day, so read it.');
  });

  assert.match(
    await chat.ask({ number: 2, kind: 'thinking' }),
    /^#2 \(kira, [^)]+\) — thinking:\nThe file sets the day, so read it\.$/,
  );
  assert.equal(
    await chat.ask({ number: 1, kind: 'thinking' }),
    'Turn 1 has no thinking in it. It has: text.',
  );
  chat.store.close();
});

test('asking for a part of a turn without saying which turn is refused', async () => {
  const chat = await lookedUp(EXCHANGES);

  assert.match(await chat.ask({ path: 'deploy.toml' }), /read by number/);
  assert.match(await chat.ask({ kind: 'thinking' }), /read by number/);
  chat.store.close();
});

// ── Reaching pi ──────────────────────────────────────────────────────────────

test('the extension hands pi the tool, so a lookup shows in the transcript', async () => {
  // A tool nobody registered is a tool Kira cannot call, and a lookup she cannot
  // call is invisible — which is the one thing recall exists to avoid, since
  // checking has to be distinguishable from remembering.
  const store = new ThreadStore(join(tempDir('kira-recall-'), 'threads.db'));
  const registered: string[] = [];
  const pi = {
    on: () => undefined,
    registerTool: (tool: { name: string }) => registered.push(tool.name),
  } as unknown as ExtensionAPI;

  kiraExtension({ cwd: tmpdir(), store, threadId: 'any', models: MODELS }).factory(pi);

  assert.deepEqual(registered, [
    'browser_open',
    'browser_snapshot',
    'browser_click',
    'browser_fill',
    'browser_screenshot',
    'recall',
    'shape_spec_proposal',
    'propose_map',
    'propose_decision',
    'propose_outcome',
    'shape_breakdown_proposal',
  ]);
  store.close();
});

test('a turn the summary names can be read back by the number it gave', async () => {
  // The other half of the same promise. A summary abbreviates: it says where the
  // work stands and names the turn each line was drawn from, so that the words
  // behind an abbreviation are still reachable. A number that led nowhere would
  // make the summary a dead end rather than a way back in. This is the link —
  // written at the compaction, asked for afterwards, through the tool — because
  // the two halves number turns in different places and only this notices if they
  // stop agreeing.
  const cwd = tempDir('kira-recall-space-');
  const path = join(tempDir('kira-recall-store-'), 'threads.db');
  const store = new ThreadStore(path);

  const thread = createThread(store, cwd);
  EXCHANGES(writer(thread.sessionManager));

  const kira = await resumeSession(store, thread.threadId, MODELS);
  await kira.session.compact();

  const compaction = store.loadEntries(kira.threadId).find((entry) => entry.type === 'compaction');
  if (compaction?.type !== 'compaction') assert.fail('the chat compacted and stored nothing');

  const named = /^- \[(\d+)\] the config lives in deploy\.toml$/m.exec(compaction.summary);
  assert.ok(named?.[1], `the summary did not name the opening turn:\n${compaction.summary}`);

  const tool = recallTool(store, kira.threadId);
  const ctx = { sessionManager: kira.session.sessionManager } as unknown as ExtensionContext;
  const result = await tool.execute(
    'call-1',
    { number: Number(named[1]) },
    undefined,
    undefined,
    ctx,
  );
  const [first] = result.content;

  assert.ok(
    first?.type === 'text' && first.text.includes('the config lives in deploy.toml'),
    `the number the summary gave led somewhere else:\n${first?.type === 'text' ? first.text : ''}`,
  );
  kira.session.dispose();
});

// ── A search across a workspace ────────────────────────────────────────────────

/**
 * A chat beside this one, written straight into the store.
 *
 * No session is booted for it, because none is needed: the tool reads a sibling
 * out of the database, so a chat that was written down is exactly what a search
 * can see.
 */
function fillBeside(
  store: ThreadStore,
  cwd: string,
  workspaceId: string,
  fill: (chat: Writer) => void,
): void {
  fill(writer(createThread(store, cwd, { workspaceId }).sessionManager));
}

const ROLLBACK = (chat: Writer): void => {
  chat.person('the rollback plan');
  chat.kira('It lands Thursday night, and reads docs/rollback.md.');
};

test('a workspace search reaches a chat beside this one, and names it', async () => {
  const chat = await lookedUp(EXCHANGES);
  const workspace = chat.store.rememberWorkspace(chat.cwd);
  fillBeside(chat.store, chat.cwd, workspace.id, ROLLBACK);

  assert.equal(
    await chat.ask({ search: 'rollback', scope: 'workspace' }),
    'Found 3 turns about "rollback", across this workspace:\n\n' +
      '#5 (you): and what does the rollback plan say?\n' +
      '"the rollback plan" (you): the rollback plan\n' +
      '"the rollback plan" (kira): It lands Thursday night, and reads docs/rollback.md.',
  );
  chat.store.close();
});

test('a search with no scope stays in this chat, even when it belongs to a workspace', async () => {
  const chat = await lookedUp(EXCHANGES);
  const workspace = chat.store.rememberWorkspace(chat.cwd);
  fillBeside(chat.store, chat.cwd, workspace.id, ROLLBACK);

  assert.equal(
    await chat.ask({ search: 'rollback' }),
    'Found 1 turn about "rollback":\n\n#5 (you): and what does the rollback plan say?',
  );
  chat.store.close();
});

test('a workspace search in a chat filed under no workspace searches only itself', async () => {
  const chat = await lookedUp(EXCHANGES);

  assert.equal(
    await chat.ask({ search: 'rollback', scope: 'workspace' }),
    'Found 1 turn about "rollback":\n\n#5 (you): and what does the rollback plan say?',
  );
  chat.store.close();
});

test('a workspace search does not reach a chat filed under another workspace', async () => {
  const chat = await lookedUp(EXCHANGES);
  chat.store.rememberWorkspace(chat.cwd);
  const other = chat.store.rememberWorkspace(tempDir('kira-recall-other-'));
  fillBeside(chat.store, chat.cwd, other.id, ROLLBACK);

  assert.equal(
    await chat.ask({ search: 'rollback', scope: 'workspace' }),
    'Found 1 turn about "rollback":\n\n#5 (you): and what does the rollback plan say?',
  );
  chat.store.close();
});
