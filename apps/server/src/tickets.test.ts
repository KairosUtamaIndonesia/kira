import { afterAll, afterEach, describe, expect, test } from 'bun:test';
import { boot, closeDatabases, issue, send, user } from './test-support/server';

afterEach(closeDatabases);
afterAll(closeDatabases);

const bearer = (key: string) => ({ authorization: `Bearer ${key}` });
const json = (method: string, key: string, value: unknown): RequestInit => ({
  method,
  headers: { ...bearer(key), 'content-type': 'application/json' },
  body: JSON.stringify(value),
});

async function signedIn() {
  const { app, auth } = await boot();
  const person = await user(auth);
  const key = (await issue(auth, person.id, 'tracker-test')).key;
  return { app, key, person };
}

async function makeProject(app: Awaited<ReturnType<typeof boot>>['app'], key: string) {
  const response = await send(
    app,
    '/api/projects',
    json('POST', key, { name: 'Kira', prefix: 'FND' }),
  );
  expect(response.status).toBe(200);
  return (await response.json()).project as { id: string; name: string; prefix: string };
}

async function makeTicket(
  app: Awaited<ReturnType<typeof boot>>['app'],
  key: string,
  projectId: string,
  values: Record<string, unknown> = {},
) {
  const response = await send(
    app,
    `/api/projects/${projectId}/tickets`,
    json('POST', key, { kind: 'feature', title: 'An issue', body: '', criteria: [], ...values }),
  );
  expect(response.status).toBe(200);
  return (await response.json()).ticket as { id: string; status: string };
}

describe('tickets', () => {
  test('creates, reads, and updates a ticket with stored status', async () => {
    const { app, key, person } = await signedIn();
    const project = await makeProject(app, key);
    const made = await makeTicket(app, key, project.id, {
      status: 'draft',
      priority: 'high',
      assigneeId: person.id,
      tags: ['bug', 'desktop'],
    });

    expect(made.status).toBe('draft');
    const updated = await send(
      app,
      `/api/tickets/${made.id}`,
      json('PATCH', key, { status: 'needs-review', title: 'Reviewed', tags: ['ready'] }),
    );
    expect(updated.status).toBe(200);
    expect((await updated.json()).ticket).toMatchObject({
      status: 'needs-review',
      title: 'Reviewed',
      priority: 'high',
      assignee: { id: person.id, name: person.name },
      tags: ['ready'],
      blocked: false,
    });

    const read = await send(app, `/api/tickets/${made.id}`, { headers: bearer(key) });
    const ticket = (await read.json()).ticket;
    expect(ticket.status).toBe('needs-review');
    expect(ticket).not.toHaveProperty('band');
    expect(ticket).not.toHaveProperty('claim');
    expect(ticket).not.toHaveProperty('runs');
  });

  test('stores and returns one current pull request link, which can be cleared', async () => {
    const { app, key } = await signedIn();
    const project = await makeProject(app, key);
    const made = await makeTicket(app, key, project.id);
    const pullRequestUrl = 'https://github.com/example/kira/pull/42';

    const reviewed = await send(
      app,
      `/api/tickets/${made.id}`,
      json('PATCH', key, { status: 'needs-review', pullRequestUrl }),
    );

    expect(reviewed.status).toBe(200);
    expect((await reviewed.json()).ticket).toMatchObject({
      status: 'needs-review',
      pullRequestUrl,
    });

    const cleared = await send(
      app,
      `/api/tickets/${made.id}`,
      json('PATCH', key, { pullRequestUrl: null }),
    );
    expect((await cleared.json()).ticket.pullRequestUrl).toBeNull();

    const read = await send(app, `/api/tickets/${made.id}`, { headers: bearer(key) });
    expect((await read.json()).ticket.pullRequestUrl).toBeNull();
  });

  test.each([
    'http://github.com/example/kira/pull/42',
    'javascript:alert(1)',
    'https://user:password@github.com/example/kira/pull/42',
    'not a URL',
  ])('rejects an unsafe pull request link (%s)', async (pullRequestUrl) => {
    const { app, key } = await signedIn();
    const project = await makeProject(app, key);
    const made = await makeTicket(app, key, project.id);

    const refused = await send(
      app,
      `/api/tickets/${made.id}`,
      json('PATCH', key, { pullRequestUrl }),
    );

    expect(refused.status).toBe(400);
    expect((await refused.json()).error.code).toBe('PULL_REQUEST_URL_INVALID');
    const unchanged = await send(app, `/api/tickets/${made.id}`, { headers: bearer(key) });
    expect((await unchanged.json()).ticket.pullRequestUrl).toBeNull();
  });

  test.each(['draft', 'ready', 'running', 'needs-review', 'done', 'wont-do'])(
    'accepts stored status %s',
    async (status) => {
      const { app, key } = await signedIn();
      const project = await makeProject(app, key);

      const ticket = await makeTicket(app, key, project.id, { status });

      expect(ticket.status).toBe(status);
    },
  );

  test.each(['blocked', 'backlog', 'todo', 'in-progress', 'in-review', 'cancelled'])(
    'rejects non-stored status %s without changing the ticket',
    async (status) => {
      const { app, key } = await signedIn();
      const project = await makeProject(app, key);
      const ticket = await makeTicket(app, key, project.id);

      const refused = await send(app, `/api/tickets/${ticket.id}`, json('PATCH', key, { status }));

      expect(refused.status).toBe(400);
      expect((await refused.json()).error.code).toBe('STATUS_UNKNOWN');
      const unchanged = await send(app, `/api/tickets/${ticket.id}`, { headers: bearer(key) });
      expect((await unchanged.json()).ticket.status).toBe('draft');
    },
  );

  test('shows blockers without replacing a ticket status', async () => {
    const { app, key } = await signedIn();
    const project = await makeProject(app, key);
    const issue = await makeTicket(app, key, project.id, { status: 'ready' });
    const blocker = await makeTicket(app, key, project.id);

    const added = await send(
      app,
      `/api/tickets/${issue.id}/gates`,
      json('POST', key, { gatedBy: blocker.id }),
    );
    expect((await added.json()).ticket).toMatchObject({ status: 'ready', blocked: true });

    await send(app, `/api/tickets/${blocker.id}`, json('PATCH', key, { status: 'done' }));
    const unblocked = await send(app, `/api/tickets/${issue.id}`, { headers: bearer(key) });
    expect((await unblocked.json()).ticket).toMatchObject({ status: 'ready', blocked: false });

    const removed = await send(app, `/api/tickets/${issue.id}/gates/${blocker.id}`, {
      method: 'DELETE',
      headers: bearer(key),
    });
    expect((await removed.json()).ticket.children).toEqual([]);
  });

  test('refuses blockers across projects, self-links, and cycles', async () => {
    const { app, key } = await signedIn();
    const firstProject = await makeProject(app, key);
    const secondProjectResponse = await send(
      app,
      '/api/projects',
      json('POST', key, { name: 'Other', prefix: 'OTH' }),
    );
    const secondProject = (await secondProjectResponse.json()).project;
    const first = await makeTicket(app, key, firstProject.id);
    const second = await makeTicket(app, key, firstProject.id);
    const other = await makeTicket(app, key, secondProject.id);

    const cases = [
      { ticket: first.id, blocker: first.id, code: 'GATE_SELF' },
      { ticket: first.id, blocker: other.id, code: 'GATE_OTHER_PROJECT' },
    ];
    for (const each of cases) {
      const refused = await send(
        app,
        `/api/tickets/${each.ticket}/gates`,
        json('POST', key, { gatedBy: each.blocker }),
      );
      expect(refused.status).toBe(400);
      expect((await refused.json()).error.code).toBe(each.code);
    }

    expect(
      (await send(app, `/api/tickets/${first.id}/gates`, json('POST', key, { gatedBy: second.id })))
        .status,
    ).toBe(200);
    const cycle = await send(
      app,
      `/api/tickets/${second.id}/gates`,
      json('POST', key, { gatedBy: first.id }),
    );
    expect(cycle.status).toBe(400);
    expect((await cycle.json()).error.code).toBe('GATE_CIRCLE');
  });
});
