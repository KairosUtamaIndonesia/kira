import { strict as assert } from 'node:assert';
import { writeFileSync } from 'node:fs';
import { createServer } from 'node:http';
import { join } from 'node:path';
import { after, before, test } from 'node:test';
import type { SessionManager } from '@earendil-works/pi-coding-agent';
import type { MemorySettings } from '../../../preload/bridge.ts';
import { ThreadStore } from '../../db/threads.ts';
import { resumeSession } from '../agent.ts';
import { foundryModels, type Models } from '../models.ts';
import { tempDir } from '../../test-support/temp.ts';
import { createThread } from '../storage.ts';

// Hermetic, as `agent.test.ts` is: pi reads `PI_CODING_AGENT_DIR` for settings and
// credentials and `HOME` for the global skills source, so both are pointed at
// temp directories.
const AGENT_DIR = tempDir('foundry-compaction-agent-');
process.env['HOME'] = tempDir('foundry-compaction-home-');
process.env['PI_CODING_AGENT_DIR'] = AGENT_DIR;

// pi compacts when the context window fills, and filling a window in a test would
// mean writing one. Telling the session to keep almost nothing recent leaves the
// next compaction with a great deal to discard, through the same settings file a
// person's install carries — rather than through a flag that exists only for tests.
writeFileSync(
  join(AGENT_DIR, 'settings.json'),
  JSON.stringify({ compaction: { enabled: true, keepRecentTokens: 1 } }),
);

/**
 * The models a session runs on, pointed at `server`.
 *
 * The catalog is read from the cache, so booting needs nothing from the network.
 * What the server answers is what the session's own model calls get, which is how
 * the one model call Foundry makes — the reflector — is given something to say.
 */
function modelsAt(server: string, ids: readonly string[] = ['served-model']): Models {
  const cache = join(tempDir('foundry-compaction-models-'), 'models.json');
  writeFileSync(cache, JSON.stringify({ models: ids.map((id) => ({ id, name: id })) }));

  return foundryModels({
    server,
    cachePath: cache,
    token: async () => 'device-key',
    catalog: async () => ({ kind: 'unavailable' }),
  });
}

/**
 * A server that refuses every completion, the way the pool does.
 *
 * A refusal rather than a dead address: pi retries a call to an address nothing
 * answers on, with backoff, which turns every test in this file into fourteen
 * seconds of waiting. A pool that refuses is the case worth pinning anyway — it
 * is what a person sees when Foundry cannot serve a model.
 */
async function refusingProvider(): Promise<{ url: string; stop: () => Promise<void> }> {
  const server = createServer((request, response) => {
    request.resume();
    response.writeHead(400, { 'content-type': 'application/json' }).end(
      JSON.stringify({
        error: {
          message: 'unknown provider for model nope-9',
          type: 'invalid_request_error',
          code: 'model_not_found',
        },
      }),
    );
  });

  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const address = server.address();
  if (address === null || typeof address === 'string') throw new Error('no port to refuse on');

  return {
    url: `http://127.0.0.1:${address.port}`,
    stop: () =>
      new Promise<void>((resolve, reject) =>
        server.close((error) => (error ? reject(error) : resolve())),
      ),
  };
}

/** The models every chat in this file boots on, answering at `refused`. */
let MODELS: Models;
let refused: { url: string; stop: () => Promise<void> };

before(async () => {
  refused = await refusingProvider();
  MODELS = modelsAt(refused.url);
});

after(() => refused.stop());

/**
 * A server that answers a completion, as the pool does.
 *
 * A summary is written by Foundry itself and costs nothing, so the only model
 * call this can see is the reflector's — which is what makes it evidence rather
 * than plumbing: a conclusion in a summary got there by being drawn by a model.
 */
async function replyingProvider(
  says: string,
  heard: string[] = [],
): Promise<{ url: string; stop: () => Promise<void> }> {
  const server = createServer((request, response) => {
    let body = '';
    request.on('data', (chunk) => (body += chunk));
    request.on('end', () => {
      heard.push(body);
      const framed = {
        id: 'chatcmpl-1',
        object: 'chat.completion',
        created: 0,
        model: 'served-model',
      };

      if (!body.includes('"stream"')) {
        response.writeHead(200, { 'content-type': 'application/json' }).end(
          JSON.stringify({
            ...framed,
            choices: [
              { index: 0, message: { role: 'assistant', content: says }, finish_reason: 'stop' },
            ],
            usage: { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 },
          }),
        );
        return;
      }

      response.writeHead(200, { 'content-type': 'text/event-stream' });
      for (const chunk of [
        {
          choices: [{ index: 0, delta: { role: 'assistant', content: says }, finish_reason: null }],
        },
        {
          choices: [{ index: 0, delta: {}, finish_reason: 'stop' }],
          usage: { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 },
        },
      ]) {
        response.write(`data: ${JSON.stringify({ ...framed, ...chunk })}\n\n`);
      }
      response.end('data: [DONE]\n\n');
    });
  });

  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const address = server.address();
  if (address === null || typeof address === 'string') throw new Error('no port to answer on');

  return {
    url: `http://127.0.0.1:${address.port}`,
    stop: () =>
      new Promise<void>((resolve, reject) =>
        server.close((error) => (error ? reject(error) : resolve())),
      ),
  };
}

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

/**
 * Writing a chat's history.
 *
 * pi's messages carry a great deal no case here cares about — an api, a provider,
 * a cost breakdown — so each kind of turn is written once, here, and the cases say
 * only what happened.
 */
interface Historian {
  /** What the person said. */
  person(text: string): void;
  /** What Kira answered. */
  kira(text: string): void;
  /** Kira working: what she thought, what she said, and the tool she reached for. */
  worked(thinking: string, text: string, tool: string, path?: string): void;
  /** What that tool handed back. */
  tool(text: string): void;
}

function historian(session: SessionManager, since = 0): Historian {
  let at = since;
  let call = 'call-0';
  let lastTool = 'tool';

  const when = (): number => (at += 1);

  return {
    person(text) {
      session.appendMessage({ role: 'user', content: text, timestamp: when() });
    },

    kira(text) {
      session.appendMessage({
        role: 'assistant',
        content: [{ type: 'text', text }],
        api: 'foundry',
        provider: 'foundry',
        model: 'served-model',
        usage: usage(),
        stopReason: 'stop',
        timestamp: when(),
      });
    },

    worked(thinking, text, tool, path) {
      call = `call-${at + 1}`;
      lastTool = tool;

      session.appendMessage({
        role: 'assistant',
        content: [
          { type: 'thinking', thinking },
          { type: 'text', text },
          { type: 'toolCall', id: call, name: tool, arguments: path === undefined ? {} : { path } },
        ],
        api: 'foundry',
        provider: 'foundry',
        model: 'served-model',
        usage: usage(),
        stopReason: 'toolUse',
        timestamp: when(),
      });
    },

    tool(text) {
      session.appendMessage({
        role: 'toolResult',
        toolCallId: call,
        toolName: lastTool,
        content: [{ type: 'text', text }],
        isError: false,
        timestamp: when(),
      });
    },
  };
}

interface Compacted {
  summary: string;
  firstKeptEntryId: string;
  /** pi's marker that an extension wrote this summary rather than pi itself. */
  fromHook: boolean | undefined;
  /** A model call's accounting, which a compaction that cost nothing does not have. */
  usage: unknown;
  /** What the window reads beside the summary to say where the cut fell. */
  lastWords: string | null | undefined;
  /** Every entry the chat holds after the compaction. */
  stored: Array<{ id: string; type: string }>;
  /** What the chat had drawn conclusions from, as it holds them afterwards. */
  reflections: string[];
}

/** Say what `fill` says in a fresh chat, fill its window, and hand back what happened. */
async function compacted(
  fill: (chat: Historian) => void,
  models: Models = MODELS,
  spoil?: (store: ThreadStore, cwd: string) => void,
  memorySettings?: () => MemorySettings | null,
): Promise<Compacted> {
  const cwd = tempDir('foundry-compaction-space-');
  const path = join(tempDir('foundry-compaction-store-'), 'threads.db');
  const store = new ThreadStore(path);
  spoil?.(store, cwd);

  const thread = createThread(store, cwd);
  fill(historian(thread.sessionManager));

  const kira = await resumeSession(store, thread.threadId, models, memorySettings);
  await kira.session.compact();
  kira.session.dispose();
  const threadId = kira.threadId;
  store.close();

  // Reopened, so that what is asserted on is what the next launch would read
  // rather than anything this process is still holding.
  const reopened = new ThreadStore(path);
  const stored = reopened.loadEntries(threadId);
  const reflections = reopened.loadReflections(threadId).map((each) => each.text);
  reopened.close();

  const compaction = stored.find((entry) => entry.type === 'compaction');
  if (compaction?.type !== 'compaction') assert.fail('the chat compacted and stored nothing');

  return {
    summary: compaction.summary,
    firstKeptEntryId: compaction.firstKeptEntryId,
    fromHook: compaction.fromHook,
    usage: compaction.usage,
    lastWords: (compaction.details as { lastWords?: string | null } | undefined)?.lastWords,
    stored: stored.map((entry) => ({ id: entry.id, type: entry.type })),
    reflections,
  };
}

/**
 * A chat that has noticed nothing.
 *
 * Nobody spoke and no file was touched, which is what the observer reads to work
 * out what a chat is holding — so this chat holds nothing, and there is nothing
 * for a model to draw a conclusion from.
 */
const NOBODY_ASKED = (chat: Historian): void => {
  for (let step = 1; step <= 4; step += 1) {
    chat.kira(`Step ${step}: I am looking at the repository without touching anything.`);
  }
};

/** Two exchanges, of which the boundary leaves only the last reply in context. */
const EXCHANGES = (chat: Historian): void => {
  chat.person('the deployment runs on Fridays');
  chat.kira('Then the migration lands Thursday night.');
  chat.person('the config lives in deploy.toml');
  chat.kira('I will read that before changing anything.');
};

test('a chat that fills its window is summarised by Foundry, not by a model', async () => {
  const result = await compacted(EXCHANGES);

  assert.equal(result.fromHook, true, 'pi wrote the summary rather than Foundry');
  // pi charges nothing for a summary it did not write — the summary is Foundry's
  // own reconstruction. The one call Foundry makes of its own is the reflector's,
  // and this chat's pool refuses it; what that refusal costs is asserted by the
  // cases under this one.
  assert.equal(result.usage, undefined, 'pi accounted for a summary it did not write');
  for (const kept of ['the deployment runs on Fridays', 'deploy.toml']) {
    assert.ok(
      result.summary.includes(kept),
      `the summary dropped ${JSON.stringify(kept)}:\n${result.summary}`,
    );
  }
});

test('the boundary says what the person last asked before the cut', async () => {
  const result = await compacted(EXCHANGES);

  // The last turn in the discarded window is Kira's reply, and the boundary must
  // not quote it: a reader wants to know where the chat was cut, which is a thing
  // the person said. Read beside the summary rather than out of it, so that the
  // window never has to parse the summary's own prose back into a sentence.
  assert.equal(result.lastWords, 'the config lives in deploy.toml');
});

test('the summary keeps the boundary pi chose, rather than one of its own', async () => {
  const result = await compacted(EXCHANGES);

  // With pi told to keep almost nothing recent, the newest exchange is the only
  // thing left in context: everything older is what the summary has to carry.
  const kept = result.stored.find((entry) => entry.id === result.firstKeptEntryId);
  assert.ok(kept, 'the boundary names an entry this chat does not hold');

  assert.ok(
    result.summary.includes('the config lives in deploy.toml'),
    `the summary lost the turn before the boundary:\n${result.summary}`,
  );
  assert.ok(
    !result.summary.includes('I will read that before changing anything.'),
    `the summary carried the turn the boundary kept:\n${result.summary}`,
  );
});

test('the same history compacts to the same summary', async () => {
  const first = await compacted(EXCHANGES);
  const second = await compacted(EXCHANGES);

  assert.equal(first.summary, second.summary);
});

test('the work of a turn is carried, and the thinking behind it is not', async () => {
  const result = await compacted((chat) => {
    chat.worked('The window is what matters, so read the config.', 'Reading it now.', 'read');
    chat.tool('fridays = "18:00"');
    chat.person('and the deploy script');
    chat.kira('Looking at it.');
  });

  assert.ok(
    result.summary.includes('[read]'),
    `the tool Kira reached for is gone:\n${result.summary}`,
  );
  assert.ok(
    result.summary.includes('fridays = "18:00"'),
    `what the tool handed back is gone:\n${result.summary}`,
  );
  assert.ok(
    !result.summary.includes('The window is what matters'),
    `the summary carried her working:\n${result.summary}`,
  );
});

test('the files Kira touched are carried, and not only what she said about them', async () => {
  const result = await compacted((chat) => {
    chat.worked('Read the config.', 'Reading it now.', 'read', 'deploy.toml');
    chat.tool('fridays = "18:00"');
    chat.person('and the deploy script');
    chat.kira('Looking at it.');
  });

  // The path lives in the tool call's arguments, which are not carried anywhere:
  // a tool call's arguments are routinely a file's whole contents. This is the
  // one thing read out of them, and it is read from the stored branch rather than
  // from the window, so a file touched four compactions ago is still named — and
  // named by the turn it was read on, so the contents can be gone back for.
  assert.ok(
    result.summary.includes('Read: [1] deploy.toml'),
    `the file she read is not named by its turn:\n${result.summary}`,
  );
});

test('a second compaction still knows what the first one saw', async () => {
  const cwd = tempDir('foundry-compaction-space-');
  const path = join(tempDir('foundry-compaction-store-'), 'threads.db');
  const store = new ThreadStore(path);

  const thread = createThread(store, cwd);
  const chat = historian(thread.sessionManager);
  chat.person('the deployment runs on Fridays');
  chat.kira('Then it lands Thursday night.');

  const kira = await resumeSession(store, thread.threadId, MODELS);
  await kira.session.compact();

  // The turns the first compaction discarded are gone from the window pi hands
  // over the second time — its next boundary falls after the first one — but they
  // are still in the branch, and the sections are read from the branch. So
  // nothing has to be carried forward between compactions for the start of the
  // chat to survive: it is recomputed from the conversation, which is what stops
  // each summarisation from thinning what Kira knows.
  const afterwards = historian(kira.session.sessionManager, 100);
  afterwards.person('the config lives in deploy.toml');
  afterwards.kira('I will read it first.');
  await kira.session.compact();
  kira.session.dispose();
  const threadId = kira.threadId;
  store.close();

  const reopened = new ThreadStore(path);
  const summaries = reopened
    .loadEntries(threadId)
    .filter((entry) => entry.type === 'compaction')
    .map((entry) => (entry.type === 'compaction' ? entry.summary : ''));
  reopened.close();

  assert.equal(summaries.length, 2, 'the chat did not compact twice');
  assert.ok(
    summaries[1]?.includes('the deployment runs on Fridays'),
    `the second summary lost the start of the chat:\n${summaries[1]}`,
  );
});

test('a chat carries what its workspace decided, and not what another workspace did', async () => {
  const cwd = tempDir('foundry-workspace-space-');
  const path = join(tempDir('foundry-workspace-store-'), 'threads.db');
  const store = new ThreadStore(path);

  /** A chat of `workspace` that has already worked something out. */
  const decided = (workspaceId: string, text: string): void => {
    const sibling = createThread(store, cwd, { workspaceId });
    store.recordObservations(sibling.threadId, [
      {
        entryId: 'elsewhere-1',
        at: '2026-01-01T00:00:00.000Z',
        kind: 'preference',
        relevance: 'critical',
        text,
      },
    ]);
  };

  // Two workspaces, each holding a correction, so that what is carried can be told
  // apart from what merely happens to be in the database.
  decided(store.rememberWorkspace(join(cwd, 'one')).id, 'the queue was rejected for ingest');
  decided(store.rememberWorkspace(join(cwd, 'two')).id, 'the cache was rejected for ingest');

  const workspace = store.listWorkspaces()[0];
  assert.ok(workspace, 'the workspace was not stored');

  const thread = createThread(store, cwd, { workspaceId: workspace.id });

  // This chat's own ledger, written down as the app writes it when a chat is
  // opened. It is not what the summary reads — the summary recomputes the chat's
  // own from the branch — but it is in the table, so a read that forgot to leave
  // the asking chat out would carry it a second time, under a heading that says
  // it came from somewhere else.
  store.recordObservations(thread.threadId, [
    {
      entryId: 'own-1',
      at: '2026-01-01T00:00:00.000Z',
      kind: 'preference',
      relevance: 'critical',
      text: 'the ingest bug is in the parser',
    },
  ]);

  const chat = historian(thread.sessionManager);
  chat.person('Fix the ingest bug');
  chat.kira('Looking.');

  const kira = await resumeSession(store, thread.threadId, MODELS);
  await kira.session.compact();
  kira.session.dispose();

  const stored = store.loadEntries(kira.threadId);
  const compaction = stored.find((entry) => entry.type === 'compaction');
  if (compaction?.type !== 'compaction') assert.fail('the chat compacted and stored nothing');
  store.close();

  // Asserted as the whole section, because three things are being pinned at once:
  // that the workspace's decision is carried, that it is carried as words alone
  // rather than with a turn number it could be checked against, and that this
  // chat's own ledger is not repeated in there.
  const section = compaction.summary.split('## Decided in this workspace\n\n')[1];
  assert.ok(section, `the workspace's side of the summary is missing:\n${compaction.summary}`);
  assert.equal(
    section.split('\n\n')[0],
    '- Preference: the queue was rejected for ingest',
    `the workspace's side of the summary is wrong:\n${compaction.summary}`,
  );
  assert.ok(
    !compaction.summary.includes('the cache was rejected for ingest'),
    `another workspace's decision was carried:\n${compaction.summary}`,
  );
});

test('a chat carries what its workspace decided, after that chat is gone', async () => {
  const cwd = tempDir('foundry-workspace-space-');
  const path = join(tempDir('foundry-workspace-store-'), 'threads.db');
  const store = new ThreadStore(path);
  const workspace = store.rememberWorkspace(join(cwd, 'one'));

  // A chat of the workspace works something out and is then thrown away, which is
  // the whole point: what it worked out belongs to the workspace now, and the chat
  // that said it is not there to be read.
  const gone = createThread(store, cwd, { workspaceId: workspace.id });
  store.recordObservations(gone.threadId, [
    {
      entryId: 'elsewhere-1',
      at: '2026-01-01T00:00:00.000Z',
      kind: 'preference',
      relevance: 'critical',
      text: 'the queue was rejected for ingest',
    },
  ]);
  store.deleteThread(gone.threadId);

  const thread = createThread(store, cwd, { workspaceId: workspace.id });
  const chat = historian(thread.sessionManager);
  chat.person('Fix the ingest bug');
  chat.kira('Looking.');

  const kira = await resumeSession(store, thread.threadId, MODELS);
  await kira.session.compact();
  kira.session.dispose();

  const stored = store.loadEntries(kira.threadId);
  const compaction = stored.find((entry) => entry.type === 'compaction');
  if (compaction?.type !== 'compaction') assert.fail('the chat compacted and stored nothing');
  store.close();

  const section = compaction.summary.split('## Decided in this workspace\n\n')[1];
  assert.ok(section, `the workspace's side of the summary is missing:\n${compaction.summary}`);
  assert.equal(
    section.split('\n\n')[0],
    '- Preference: the queue was rejected for ingest',
    `what the workspace kept was not carried:\n${compaction.summary}`,
  );
});

test('a chat whose reflector is refused still compacts, and still carries its own', async () => {
  // The pool refuses the call, so the reflector cannot answer. A chat is not
  // less able to say what it was doing because a conclusion could not be drawn
  // about it: what the ledger already holds is written into the summary either
  // way, and the compaction happens rather than being abandoned.
  const result = await compacted(EXCHANGES);

  assert.ok(
    result.summary.includes('- [1] the deployment runs on Fridays'),
    `the chat lost what it was holding:\n${result.summary}`,
  );
  assert.ok(
    !result.summary.includes('## Reflections'),
    `conclusions appeared from a model that could not be reached:\n${result.summary}`,
  );
  assert.deepEqual(result.reflections, []);
});

test('a chat being compacted is reflected on, and keeps what it worked out', async () => {
  const heard: string[] = [];
  const provider = await replyingProvider(
    'The deployment runs on Fridays; the config it reads is deploy.toml.',
    heard,
  );

  try {
    const result = await compacted(EXCHANGES, modelsAt(provider.url));

    // The call is made by the reflector, not by pi: the summary is still the one
    // Foundry wrote, and what the model said arrived in it as a conclusion rather
    // than as prose.
    assert.equal(result.fromHook, true, 'pi wrote the summary rather than Foundry');
    assert.ok(result.summary.includes('## Reflections'), result.summary);
    assert.ok(
      result.summary.includes(
        '- [4] The deployment runs on Fridays; the config it reads is deploy.toml.',
      ),
      result.summary,
    );

    // And it is held, rather than only written into the one summary: the next
    // compaction asks the model what it is already holding, and what it holds has
    // to be somewhere it can be read from.
    assert.deepEqual(result.reflections, [
      'The deployment runs on Fridays; the config it reads is deploy.toml.',
    ]);

    // The reflector is handed no tools, so a conclusion is something it says
    // rather than something it goes and looks up: the chat it is drawing from is
    // already in the prompt, and a tool would let it act on a chat it is only
    // reading.
    const asked = heard.find((body) => body.includes('## Noticed'));
    assert.ok(asked, `the reflector never asked anything: ${heard.length} requests`);
    assert.ok(
      !JSON.parse(asked).tools?.length,
      'the reflector was handed tools it has no business acting with',
    );
  } finally {
    await provider.stop();
  }
});

test('a chat that is not compacting never asks to be reflected on', async () => {
  // Drawing conclusions is a once-per-compaction cost, so the ordinary turns of a
  // chat that is still running must not carry it. The reflector's prompt is
  // recognisable at the wire by words nothing else says — '## Noticed' is where
  // the ledger goes — so a recording pool can tell the two apart.
  const heard: string[] = [];
  const provider = await replyingProvider('Looking.', heard);

  try {
    const cwd = tempDir('foundry-reflection-space-');
    const store = new ThreadStore(join(tempDir('foundry-reflection-store-'), 'threads.db'));
    const thread = createThread(store, cwd);
    const kira = await resumeSession(store, thread.threadId, modelsAt(provider.url));

    await kira.session.prompt('Where does the config live?');
    kira.session.dispose();
    store.close();

    assert.ok(heard.length > 0, 'the chat never reached the model, so this proves nothing');
    assert.ok(
      heard.every((body) => !body.includes('## Noticed')),
      'a turn that was not a compaction asked for conclusions',
    );
  } finally {
    await provider.stop();
  }
});

test('a chat that has noticed nothing is not asked to be reflected on', async () => {
  // A conclusion is drawn from what the chat noticed, so a chat that has noticed
  // nothing has nothing to draw one from — and asking anyway spends a person's
  // allowance to be told so. The pool here answers everything, which is what makes
  // 'nothing was asked' sayable at all: a refusing pool looks the same whether or
  // not a call was made, so the test for the guard has to be one that can answer.
  const heard: string[] = [];
  const provider = await replyingProvider('Nothing to add.', heard);

  try {
    const result = await compacted(NOBODY_ASKED, modelsAt(provider.url));

    assert.equal(result.fromHook, true, 'pi wrote the summary rather than Foundry');
    assert.deepEqual(
      heard,
      [],
      `the reflector was asked about a chat with nothing to conclude: ${heard[0]}`,
    );
    assert.deepEqual(result.reflections, []);
  } finally {
    await provider.stop();
  }
});

test("the reflector is given its own rules and not the workspace's", async () => {
  // The reflector runs in the chat's own directory, which is somebody's workspace —
  // with an AGENTS.md in it. pi loads those into a session's instructions, so
  // without saying otherwise the model would be reflecting under a set of rules
  // about how to write code here, and Foundry's prompt would not be the whole of
  // what it was told. The canary is a phrase that exists nowhere but that file.
  const heard: string[] = [];
  const provider = await replyingProvider('Nothing to add.', heard);

  try {
    await compacted(EXCHANGES, modelsAt(provider.url), (_store, cwd) => {
      writeFileSync(join(cwd, 'AGENTS.md'), 'Never mention the word banana in this repository.\n');
    });

    assert.ok(
      !heard.some((body) => body.includes('banana')),
      "the reflector was handed the workspace's own instructions",
    );
  } finally {
    await provider.stop();
  }
});

test('a chat whose ledger cannot be read still compacts, and still carries its own', async () => {
  // The store is read while compacting for the workspace's side of the ledger and
  // for what this chat has concluded. A database that will not answer must cost
  // those and not the compaction: pi answers a hook that throws by reporting an
  // extension error and writing the summary itself with a model — a different
  // summary, and a charge nobody asked for.
  const result = await compacted(EXCHANGES, MODELS, (store) => {
    store.loadReflections = () => {
      throw new Error('the disk is full');
    };
  });

  assert.equal(result.fromHook, true, 'pi wrote the summary rather than Foundry');
  assert.ok(
    result.summary.includes('- [1] the deployment runs on Fridays'),
    `the chat lost what it was holding:\n${result.summary}`,
  );
  assert.deepEqual(result.reflections, []);
});

test('memory off stops what the workspace decided and what a model would draw, and not the summary', async () => {
  // The two halves of memory that are not the summary's own: what the rest of the
  // workspace decided, and the conclusions a model draws from the ledger. Both are
  // injection — the summary underneath them is recomputed from the conversation
  // either way — so turning memory off costs those, and leaves a chat that still
  // compacts with the goal, the files and the commits it would have carried.
  const heard: string[] = [];
  const provider = await replyingProvider('The config is deploy.toml.', heard);

  try {
    const cwd = tempDir('foundry-memory-off-space-');
    const path = join(tempDir('foundry-memory-off-store-'), 'threads.db');
    const store = new ThreadStore(path);

    const workspace = store.rememberWorkspace(join(cwd, 'the-week'));
    const sibling = createThread(store, cwd, { workspaceId: workspace.id });
    store.recordObservations(sibling.threadId, [
      {
        entryId: 'elsewhere-1',
        at: '2026-01-01T00:00:00.000Z',
        kind: 'preference',
        relevance: 'critical',
        text: 'the queue was rejected for ingest',
      },
    ]);

    const thread = createThread(store, cwd, { workspaceId: workspace.id });
    const chat = historian(thread.sessionManager);
    chat.person('the deployment runs on Fridays');
    chat.kira('Then it lands Thursday night.');

    const kira = await resumeSession(store, thread.threadId, modelsAt(provider.url), () => ({
      enabled: false,
      chosen: null,
      recommended: null,
    }));
    await kira.session.compact();
    kira.session.dispose();
    const threadId = kira.threadId;
    store.close();

    const reopened = new ThreadStore(path);
    const compaction = reopened.loadEntries(threadId).find((entry) => entry.type === 'compaction');
    reopened.close();
    if (compaction?.type !== 'compaction') assert.fail('the chat compacted and stored nothing');

    // Still Foundry's own summary, and still carrying the chat's own words: memory
    // off is not compaction off.
    assert.equal(compaction.fromHook, true, 'pi wrote the summary rather than Foundry');
    assert.ok(
      compaction.summary.includes('the deployment runs on Fridays'),
      `the summary lost the chat's own goal:\n${compaction.summary}`,
    );

    // No model was asked anything at all.
    assert.deepEqual(heard, [], 'a model was asked to reflect while memory was off');

    // And the workspace's side of the ledger did not ride in with it.
    assert.ok(
      !compaction.summary.includes('the queue was rejected for ingest'),
      `what the workspace decided was carried while memory was off:\n${compaction.summary}`,
    );
    assert.ok(!compaction.summary.includes('## Decided in this workspace'), compaction.summary);
  } finally {
    await provider.stop();
  }
});

test('the reflecting runs on the model this person chose, not on the chat’s own', async () => {
  // A chat runs on one model and reflects with another, and the two are separate
  // decisions on purpose: nobody wants a chat model's rate spent on a background
  // job, and nobody wants the conclusions drawn by whatever the chat happens to
  // be running on. The chosen model is settled here rather than carried into the
  // chat, so this is one call and not a change to the session.
  const heard: string[] = [];
  const provider = await replyingProvider('The config is deploy.toml.', heard);

  try {
    const result = await compacted(
      EXCHANGES,
      modelsAt(provider.url, ['served-model', 'chosen-for-reflecting']),
      undefined,
      () => ({ enabled: true, chosen: 'chosen-for-reflecting', recommended: 'served-model' }),
    );

    assert.ok(result.summary.includes('## Reflections'), result.summary);

    const asked = heard.find((body) => body.includes('## Noticed'));
    assert.ok(asked, `the reflector never asked anything: ${heard.length} requests`);
    assert.equal(
      JSON.parse(asked).model,
      'chosen-for-reflecting',
      'the reflecting ran on the chat’s own model rather than the chosen one',
    );
  } finally {
    await provider.stop();
  }
});
