import { strict as assert } from 'node:assert';
import { join } from 'node:path';
import { test } from 'node:test';
import { tempDir } from '../test-support/temp.ts';
import { ThreadStore } from '../db/threads.ts';
import { magicPromptHandlers } from './magicPrompts.ts';

function handlersFor(store: ThreadStore) {
  return magicPromptHandlers({
    list: () => store.listMagicPrompts(),
    create: (draft) => store.createMagicPrompt(draft),
    update: (id, draft) => store.updateMagicPrompt(id, draft),
    remove: (id) => store.deleteMagicPrompt(id),
  });
}

test('Magic Prompt handlers validate and forward shared prompt CRUD', async () => {
  const store = new ThreadStore(join(tempDir('kira-magic-prompts-'), 'threads.db'));
  const handlers = handlersFor(store);

  assert.deepEqual(await handlers.load(), { ok: true, value: [] });
  const created = await handlers.create({
    name: 'Outline',
    aliases: ['plan'],
    content: 'First line\n# literal second line',
  });
  if (!created.ok) throw new Error(created.error);
  assert.deepEqual(created.value, {
    id: created.value.id,
    name: 'Outline',
    aliases: ['plan'],
    content: 'First line\n# literal second line',
  });

  const updated = await handlers.update(created.value.id, {
    name: 'Write an outline',
    aliases: ['structure'],
    content: 'Keep this editable.',
  });
  assert.deepEqual(updated, {
    ok: true,
    value: {
      id: created.value.id,
      name: 'Write an outline',
      aliases: ['structure'],
      content: 'Keep this editable.',
    },
  });
  assert.deepEqual(await handlers.remove(created.value.id), { ok: true, value: null });
  assert.deepEqual(await handlers.load(), { ok: true, value: [] });
  store.close();
});

test('Magic Prompt handlers refuse malformed drafts and duplicate labels', async () => {
  const store = new ThreadStore(join(tempDir('kira-magic-prompts-'), 'threads.db'));
  const handlers = handlersFor(store);
  const invalidDrafts: Array<{ name: string; value: unknown }> = [
    { name: 'a missing name', value: { aliases: [], content: 'Text' } },
    { name: 'a blank name', value: { name: '  ', aliases: [], content: 'Text' } },
    { name: 'blank content', value: { name: 'Name', aliases: [], content: '\n ' } },
    { name: 'non-string aliases', value: { name: 'Name', aliases: ['ok', 4], content: 'Text' } },
  ];

  for (const testCase of invalidDrafts) {
    assert.deepEqual(
      await handlers.create(testCase.value),
      { ok: false, error: 'That is not a valid Magic Prompt.' },
      testCase.name,
    );
  }
  assert.deepEqual(await handlers.create({ name: 'Review', aliases: ['check'], content: 'Review.' }), {
    ok: true,
    value: store.listMagicPrompts()[0],
  });
  assert.deepEqual(await handlers.create({ name: 'CHECK', aliases: [], content: 'Another.' }), {
    ok: false,
    error: 'That Magic Prompt name or alias is already in use.',
  });
  assert.deepEqual(await handlers.create({ name: 'Different', aliases: ['review'], content: 'Another.' }), {
    ok: false,
    error: 'That Magic Prompt name or alias is already in use.',
  });
  assert.equal(store.listMagicPrompts().length, 1);
  store.close();
});

test('Magic Prompt updates and removals validate identifiers', async () => {
  const store = new ThreadStore(join(tempDir('kira-magic-prompts-'), 'threads.db'));
  const handlers = handlersFor(store);
  const draft = { name: 'Review', aliases: [], content: 'Review.' };

  assert.deepEqual(await handlers.update('', draft), {
    ok: false,
    error: 'A Magic Prompt needs an id to be updated.',
  });
  assert.deepEqual(await handlers.update('missing', draft), {
    ok: false,
    error: 'That Magic Prompt does not exist.',
  });
  assert.deepEqual(await handlers.remove(null), {
    ok: false,
    error: 'A Magic Prompt needs an id to be removed.',
  });
  store.close();
});
