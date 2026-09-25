import { afterAll, afterEach, describe, expect, test } from 'bun:test';
import { eq } from 'drizzle-orm';
import { decision } from './schema';
import { bearer, boot, closeDatabases, issue, send, user } from './test-support/server';

afterEach(closeDatabases);
afterAll(closeDatabases);

const proposal = {
  context: 'The app needs a durable record of shared choices.',
  choice: 'Store approved Decisions in the project tracker.',
  rejectedOptions: ['Keep choices only in chat', 'Use an external document'],
  consequences: 'Runs and Kira can read the same history.',
  sourceChatId: 'chat-1',
};

async function server() {
  const { app, auth, database } = await boot();

  return {
    app,
    database,
    async add() {
      const ada = await user(auth);
      return { id: ada.id, key: (await issue(auth, ada.id, 'workstation')).key };
    },
  };
}

describe('project Decisions', () => {
  test('a new project has no Decisions and a person approval creates one', async () => {
    const made = await server();
    const ada = await made.add();
    const found = await makeProject(made.app, ada.key);

    const before = await send(made.app, `/api/projects/${found.id}/decisions`, {
      headers: bearer(ada.key),
    });
    expect(before.status).toBe(200);
    expect((await before.json()).decisions).toEqual([]);

    const response = await send(
      made.app,
      `/api/projects/${found.id}/decisions`,
      body('POST', bearer(ada.key), proposal),
    );
    expect(response.status).toBe(200);
    const created = (await response.json()).decision;
    expect(created).toMatchObject({
      projectId: found.id,
      context: proposal.context,
      choice: proposal.choice,
      rejectedOptions: proposal.rejectedOptions,
      consequences: proposal.consequences,
      sourceChatId: proposal.sourceChatId,
      supersededById: null,
      author: { id: ada.id },
    });
  });

  test('approving a later Decision supersedes without rewriting the old record', async () => {
    const made = await server();
    const ada = await made.add();
    const found = await makeProject(made.app, ada.key);
    const first = await create(made.app, ada.key, found.id, proposal);

    const second = await create(made.app, ada.key, found.id, {
      ...proposal,
      choice: 'Store approved Decisions with immutable history.',
      supersedes: first.id,
    });
    expect(second.supersededById).toBeNull();

    const read = await send(made.app, `/api/projects/${found.id}/decisions`, {
      headers: bearer(ada.key),
    });
    const decisions = (await read.json()).decisions;
    expect(decisions).toHaveLength(2);
    expect(decisions[0]).toMatchObject({
      id: first.id,
      choice: proposal.choice,
      supersededById: second.id,
    });
    expect(decisions[1]).toMatchObject({
      id: second.id,
      choice: 'Store approved Decisions with immutable history.',
    });

    const rows = await made.database.select().from(decision).where(eq(decision.id, first.id));
    expect(rows[0]).toMatchObject({ choice: proposal.choice, supersededById: second.id });
  });

  test('a superseded Decision cannot be superseded again', async () => {
    const made = await server();
    const ada = await made.add();
    const found = await makeProject(made.app, ada.key);
    const first = await create(made.app, ada.key, found.id, proposal);
    await create(made.app, ada.key, found.id, { ...proposal, supersedes: first.id });

    const refused = await send(
      made.app,
      `/api/projects/${found.id}/decisions`,
      body('POST', bearer(ada.key), { ...proposal, supersedes: first.id }),
    );
    expect(refused.status).toBe(400);
    expect((await refused.json()).error.code).toBe('DECISION_SUPERSEDED');
  });

  test('empty Decision fields are refused before a row is written', async () => {
    const made = await server();
    const ada = await made.add();
    const found = await makeProject(made.app, ada.key);
    const refused = await send(
      made.app,
      `/api/projects/${found.id}/decisions`,
      body('POST', bearer(ada.key), { ...proposal, context: ' ', rejectedOptions: [''] }),
    );

    expect(refused.status).toBe(400);
    const rows = await made.database.select().from(decision);
    expect(rows).toEqual([]);
  });
});

async function makeProject(app: Awaited<ReturnType<typeof server>>['app'], key: string) {
  const response = await send(
    app,
    '/api/projects',
    body('POST', bearer(key), { name: 'Foundry', prefix: 'FND' }),
  );
  if (response.status !== 200) throw new Error(`no project: ${await response.text()}`);
  return (await response.json()).project as { id: string };
}

async function create(
  app: Awaited<ReturnType<typeof server>>['app'],
  key: string,
  projectId: string,
  value: Record<string, unknown>,
) {
  const response = await send(
    app,
    `/api/projects/${projectId}/decisions`,
    body('POST', bearer(key), value),
  );
  if (response.status !== 200) throw new Error(`no Decision: ${await response.text()}`);
  return (await response.json()).decision as {
    id: string;
    supersededById: string | null;
  };
}

function body(method: string, headers: Record<string, string>, sent: unknown): RequestInit {
  return {
    method,
    headers: { 'content-type': 'application/json', ...headers },
    body: JSON.stringify(sent),
  };
}
