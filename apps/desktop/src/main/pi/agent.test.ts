import { strict as assert } from 'node:assert';
import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { test } from 'node:test';
import { tempDir } from '../test-support/temp.ts';
import { mcpManager } from '../mcp/servers.ts';
import { type KiraSession, resumeSession, startSession } from './agent.ts';
import { foundryModels, type Models } from './models.ts';
import { createThread } from './storage.ts';
import { ThreadStore } from '../db/threads.ts';

// Hermetic: pi reads `PI_CODING_AGENT_DIR` for credentials and `HOME` for the
// global skills source. Pointing both at temp directories keeps the result from
// depending on whatever the developer happens to have installed — the boot must
// work with no credentials present, since resolving a built-in model definition
// does not need any.
process.env['HOME'] = tempDir('foundry-agent-home-');
process.env['PI_CODING_AGENT_DIR'] = tempDir('foundry-agent-dir-');

/**
 * The models a session runs on: what a launch that has asked before remembers.
 *
 * Written down rather than fetched: these cases are about booting a session, and
 * the server answering is `models.test.ts`'s. What a session runs on, though, is
 * now the server's to say — there is no model of pi's own for it to fall back on.
 */
function rememberedModels(): Models {
  const cache = join(tempDir('foundry-agent-models-'), 'models.json');
  writeFileSync(cache, JSON.stringify({ models: [{ id: 'served-model', name: 'Served Model' }] }));

  return foundryModels({
    server: 'http://localhost:4100',
    cachePath: cache,
    token: async () => 'device-key',
    catalog: async () => ({ kind: 'unavailable' }),
  });
}

const MODELS = rememberedModels();

interface Case {
  name: string;
  /** Entries already stored for the thread before the boot, as pi type strings. */
  storedTypes: string[];
  open: (store: ThreadStore, cwd: string, models: Models) => Promise<KiraSession>;
}

const CASES: Case[] = [
  {
    name: 'a new thread',
    storedTypes: [],
    open: (store, cwd, models) => startSession(store, cwd, models),
  },
  {
    name: 'a stored thread with history',
    storedTypes: ['message'],
    open: async (store, cwd, models) => {
      const thread = createThread(store, cwd);
      thread.sessionManager.appendMessage({
        role: 'user',
        content: 'remember this',
        timestamp: 1,
      });
      return resumeSession(store, thread.threadId, models);
    },
  },
  {
    // An install from before Foundry served the models left sessions that had run
    // on pi's own built-in provider, whose credential lives on the machine. This
    // pins the outcome for one of those: whatever the session remembers, it runs on
    // the model Foundry serves — the runtime holds Foundry's own provider and no
    // other, under an id pi has no credential for, which is what makes a local
    // credential unreachable rather than merely unused
    // (docs/adr/0003-model-credentials.md).
    name: 'a stored thread that ran on a local provider',
    storedTypes: ['model_change', 'message'],
    open: async (store, cwd, models) => {
      const thread = createThread(store, cwd);
      thread.sessionManager.appendModelChange('openai-codex', 'gpt-5.6-luna');
      thread.sessionManager.appendMessage({
        role: 'user',
        content: 'hello',
        timestamp: 1,
      });
      return resumeSession(store, thread.threadId, models);
    },
  },
];

for (const testCase of CASES) {
  test(`booting ${testCase.name} gives a database-backed session`, async () => {
    const cwd = tempDir('foundry-agent-space-');
    const path = join(tempDir('foundry-agent-store-'), 'threads.db');
    const store = new ThreadStore(path);

    const kira = await testCase.open(store, cwd, MODELS);

    assert.equal(kira.cwd, cwd);

    // The provider is Foundry's own, and the model is the one the server served:
    // pi holds no credential under that id, so nothing local can answer instead.
    assert.equal(kira.session.model?.provider, 'foundry');
    assert.equal(kira.session.model?.id, 'served-model');
    // pi would name a JSONL file here if persistence were still file-based.
    assert.equal(kira.session.sessionManager.getSessionFile(), undefined);

    kira.session.sessionManager.appendMessage({
      role: 'user',
      content: 'does this reach the database?',
      timestamp: 2,
    });
    const inMemory = kira.session.sessionManager.getEntries().length;
    store.close();

    const types = new ThreadStore(path)
      .loadEntries(kira.threadId)
      .map((entry: { type: string }) => entry.type);

    // pi's own boot appends entries of its own (model and thinking-level
    // changes), and `subscribe()` never emits those. Asserting the count rather
    // than the exact sequence proves nothing pi appended was dropped, without
    // hardcoding pi's internal ordering into our test.
    assert.equal(types.length, inMemory + 1, 'every entry pi holds is stored, plus the header');
    assert.equal(types[0], 'session', 'the header is stored first');
    assert.equal(types.at(-1), 'message', 'the last thing appended is stored last');
    assert.deepEqual(
      types.slice(1, 1 + testCase.storedTypes.length),
      testCase.storedTypes,
      'history written before the boot survives it',
    );
  });
}

test(
  'changing the Bash path reaches the next command in an open session',
  { skip: process.platform === 'win32' },
  async () => {
    const cwd = tempDir('foundry-agent-shell-space-');
    const store = new ThreadStore(join(tempDir('foundry-agent-shell-store-'), 'threads.db'));
    const kira = await startSession(store, cwd, MODELS);

    try {
      await kira.setShellPath('/bin/sh');
      const bash = kira.session.getToolDefinition('bash');
      assert.ok(bash);
      const result = await bash.execute(
        'shell-path-test',
        { command: 'printf %s "$0"' },
        undefined,
        undefined,
        undefined as never,
      );
      const output = result.content
        .filter((part) => part.type === 'text')
        .map((part) => part.text)
        .join('');

      assert.equal(output, '/bin/sh');
    } finally {
      kira.dispose();
      store.close();
    }
  },
);

const BOOT_FAILURES = [
  {
    name: 'writing the chosen model fails',
    error: 'model record failed',
    fail: (store: ThreadStore) => {
      store.setThreadModel = () => { throw new Error('model record failed'); };
    },
  },
];

for (const testCase of BOOT_FAILURES) {
  test(`failed boot releases MCP subscriptions when ${testCase.name}`, async () => {
    const store = new ThreadStore(join(tempDir('foundry-agent-failure-store-'), 'threads.db'));
    const manager = mcpManager({ store });
    const subscribe = manager.subscribe.bind(manager);
    let unsubscribed = 0;
    manager.subscribe = (listener) => {
      const unsubscribe = subscribe(listener);
      return () => {
        unsubscribed += 1;
        unsubscribe();
      };
    };
    testCase.fail(store);

    try {
      await assert.rejects(
        startSession(store, tempDir('foundry-agent-failure-space-'), MODELS, {}, undefined, undefined, manager),
        { message: testCase.error },
      );
      assert.equal(unsubscribed, 1);
    } finally {
      try {
        await manager.close();
      } finally {
        store.close();
      }
    }
  });
}
