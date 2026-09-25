import { afterAll, afterEach, describe, expect, test } from 'bun:test';
import { bearer, boot, closeDatabases, issue, send, user } from './test-support/server';

afterEach(closeDatabases);
afterAll(closeDatabases);

interface GlossaryEntry {
  id: string;
  projectId: string;
  term: string;
  meaning: string;
  wordsToAvoid: string[];
  version: number;
  author: { id: string; name: string } | null;
  chatId: string;
  history: Array<{
    version: number;
    term: string;
    meaning: string;
    wordsToAvoid: string[];
    author: { id: string; name: string } | null;
    chatId: string;
  }>;
}

function json(method: string, key: string, value: unknown): RequestInit {
  return {
    method,
    headers: { ...bearer(key), 'content-type': 'application/json' },
    body: JSON.stringify(value),
  };
}

async function project(app: Awaited<ReturnType<typeof boot>>['app'], key: string) {
  const response = await send(
    app,
    '/api/projects',
    json('POST', key, { name: 'Foundry', prefix: 'FND' }),
  );
  return (await response.json()).project as { id: string };
}

async function glossary(
  app: Awaited<ReturnType<typeof boot>>['app'],
  key: string,
  projectId: string,
): Promise<GlossaryEntry[]> {
  const response = await send(app, `/api/projects/${projectId}/glossary`, { headers: bearer(key) });
  if (response.status !== 200) throw new Error(await response.text());
  return ((await response.json()) as { glossary: GlossaryEntry[] }).glossary;
}

describe('a project glossary', () => {
  test('starts empty in a fresh migrated project', async () => {
    const { app, auth } = await boot();
    const person = await user(auth);
    const key = (await issue(auth, person.id, 'desktop')).key;
    const made = await project(app, key);

    expect(await glossary(app, key, made.id)).toEqual([]);
  });

  test('adds and sharpens terms with author, chat and immutable history', async () => {
    const { app, auth } = await boot();
    const person = await user(auth);
    const key = (await issue(auth, person.id, 'desktop')).key;
    const made = await project(app, key);

    const added = await send(
      app,
      `/api/projects/${made.id}/glossary`,
      json('POST', key, {
        term: '  ticket ',
        meaning: 'A bounded unit of work.',
        wordsToAvoid: ['issue', '  '],
        chatId: 'shape-chat',
      }),
    );
    expect(added.status).toBe(200);
    const first = ((await added.json()) as { entry: GlossaryEntry }).entry;
    expect(first).toMatchObject({
      term: 'ticket',
      meaning: 'A bounded unit of work.',
      wordsToAvoid: ['issue'],
      version: 1,
      chatId: 'shape-chat',
      author: { id: person.id, name: 'Ada Lovelace' },
    });
    expect(first.history).toHaveLength(1);
    expect(first.history[0]).toMatchObject({ version: 1, chatId: 'shape-chat' });

    const sharpened = await send(
      app,
      `/api/projects/${made.id}/glossary`,
      json('POST', key, {
        term: 'ticket',
        meaning: 'A bounded unit of work with acceptance criteria.',
        wordsToAvoid: ['issue', 'task'],
        chatId: 'shape-chat-2',
      }),
    );
    const current = ((await sharpened.json()) as { entry: GlossaryEntry }).entry;
    expect(current).toMatchObject({
      term: 'ticket',
      version: 2,
      chatId: 'shape-chat-2',
      meaning: 'A bounded unit of work with acceptance criteria.',
    });
    expect(current.history.map((entry) => entry.meaning)).toEqual([
      'A bounded unit of work.',
      'A bounded unit of work with acceptance criteria.',
    ]);
  });

  test('Undo restores the preceding version only while the visible version is current', async () => {
    const { app, auth } = await boot();
    const person = await user(auth);
    const key = (await issue(auth, person.id, 'desktop')).key;
    const made = await project(app, key);

    for (const meaning of ['first', 'second']) {
      await send(
        app,
        `/api/projects/${made.id}/glossary`,
        json('POST', key, { term: 'term', meaning, wordsToAvoid: [], chatId: 'shape-chat' }),
      );
    }
    const [entry] = await glossary(app, key, made.id);
    if (entry === undefined) throw new Error('the fixture did not make a glossary entry');

    const changed = await send(
      app,
      `/api/projects/${made.id}/glossary`,
      json('POST', key, { term: 'term', meaning: 'third', wordsToAvoid: [], chatId: 'new-chat' }),
    );
    expect(changed.status).toBe(200);

    const stale = await send(
      app,
      `/api/projects/${made.id}/glossary/${entry.id}/undo`,
      json('POST', key, { version: 2, chatId: 'shape-chat' }),
    );
    expect(stale.status).toBe(409);
    expect((await stale.json()).error).toMatchObject({ code: 'GLOSSARY_STALE' });
    expect((await glossary(app, key, made.id))[0]?.meaning).toBe('third');

    const current = (await glossary(app, key, made.id))[0]!;
    const undone = await send(
      app,
      `/api/projects/${made.id}/glossary/${current.id}/undo`,
      json('POST', key, { version: current.version, chatId: 'shape-chat' }),
    );
    expect(undone.status).toBe(200);
    const restored = ((await undone.json()) as { entry: GlossaryEntry }).entry;
    expect(restored).toMatchObject({ meaning: 'second', version: 4, chatId: 'shape-chat' });
    expect(restored.history.map((entry) => entry.meaning)).toEqual([
      'first',
      'second',
      'third',
      'second',
    ]);
  });
});
