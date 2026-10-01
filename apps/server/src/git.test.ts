import { createHmac } from 'node:crypto';
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

const SECRET = 'test-github-webhook-secret';

async function signedIn() {
  const { app, auth } = await boot();
  const person = await user(auth);
  const key = (await issue(auth, person.id, 'git-test')).key;
  return { app, key, person };
}

async function makeProject(app: Awaited<ReturnType<typeof boot>>['app'], key: string) {
  const response = await send(
    app,
    '/api/projects',
    json('POST', key, { name: 'Kira', prefix: 'FND' }),
  );
  expect(response.status).toBe(200);
  return (await response.json()).project as { id: string };
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
    json('POST', key, { kind: 'feature', title: 'A ticket', body: '', criteria: [], ...values }),
  );
  expect(response.status).toBe(200);
  return (await response.json()).ticket as { id: string; name: string; status: string };
}

function delivery(payload: unknown, secret = SECRET): RequestInit {
  const body = JSON.stringify(payload);
  const signature = createHmac('sha256', secret).update(body).digest('hex');

  return {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'x-github-event': 'pull_request',
      'x-hub-signature-256': `sha256=${signature}`,
    },
    body,
  };
}

function pullRequest(values: {
  number: number;
  title: string;
  state?: string;
  merged?: boolean;
  mergedAt?: string | null;
  branch?: string;
  owner?: string;
  name?: string;
}) {
  return {
    pull_request: {
      number: values.number,
      html_url: `https://github.com/${values.owner ?? 'acme'}/${values.name ?? 'api'}/pull/${values.number}`,
      title: values.title,
      state: values.state ?? 'open',
      draft: false,
      merged: values.merged ?? false,
      merged_at: values.mergedAt ?? null,
      head: { ref: values.branch ?? `fnd-${values.number}`, sha: 'abc123' },
      user: { login: 'ada' },
    },
    repository: { name: values.name ?? 'api', owner: { login: values.owner ?? 'acme' } },
  };
}

describe('repositories', () => {
  test('attaches, lists, and removes a repository', async () => {
    const { app, key } = await signedIn();
    const project = await makeProject(app, key);

    const attached = await send(
      app,
      `/api/projects/${project.id}/repositories`,
      json('POST', key, { owner: 'acme', name: 'api' }),
    );
    expect(attached.status).toBe(200);
    expect((await attached.json()).repository).toMatchObject({
      projectId: project.id,
      provider: 'github',
      owner: 'acme',
      name: 'api',
      defaultBranch: 'main',
    });

    const listed = await send(app, `/api/projects/${project.id}/repositories`, {
      headers: bearer(key),
    });
    const repositories = (await listed.json()).repositories as Array<{ id: string }>;
    expect(repositories).toHaveLength(1);

    const again = await send(
      app,
      `/api/projects/${project.id}/repositories`,
      json('POST', key, { owner: 'acme', name: 'api' }),
    );
    expect(again.status).toBe(409);

    const removed = await send(
      app,
      `/api/projects/${project.id}/repositories/${repositories[0]!.id}`,
      {
        method: 'DELETE',
        headers: bearer(key),
      },
    );
    expect(removed.status).toBe(200);

    const empty = await send(app, `/api/projects/${project.id}/repositories`, {
      headers: bearer(key),
    });
    expect((await empty.json()).repositories).toEqual([]);
  });
});

describe('git webhook', () => {
  test('links a pull request to the ticket it names, and a merge moves it to Done', async () => {
    const { app, key } = await signedIn();
    const project = await makeProject(app, key);
    const made = await makeTicket(app, key, project.id, { title: 'Do the thing' });
    await send(app, `/api/tickets/${made.id}`, json('PATCH', key, { status: 'needs-review' }));
    await send(
      app,
      `/api/projects/${project.id}/repositories`,
      json('POST', key, { owner: 'acme', name: 'api' }),
    );

    const opened = await send(
      app,
      '/api/webhooks/github',
      delivery(pullRequest({ number: 7, title: `${made.name}: do the thing` })),
    );
    expect(opened.status).toBe(200);
    expect((await opened.json()).received).toBe(true);

    const linked = await send(app, `/api/tickets/${made.id}/pull-requests`, {
      headers: bearer(key),
    });
    const prs = (await linked.json()).pullRequests as Array<{ number: number; state: string }>;
    expect(prs).toHaveLength(1);
    expect(prs[0]).toMatchObject({ number: 7, state: 'open' });

    const before = await send(app, `/api/tickets/${made.id}`, { headers: bearer(key) });
    expect((await before.json()).ticket).toMatchObject({
      status: 'needs-review',
      pullRequestUrl: 'https://github.com/acme/api/pull/7',
    });

    const merged = await send(
      app,
      '/api/webhooks/github',
      delivery(
        pullRequest({
          number: 7,
          title: `${made.name}: do the thing`,
          state: 'closed',
          merged: true,
          mergedAt: '2026-10-01T00:00:00.000Z',
        }),
      ),
    );
    expect(merged.status).toBe(200);

    const after = await send(app, `/api/tickets/${made.id}`, { headers: bearer(key) });
    expect((await after.json()).ticket.status).toBe('done');

    const timeline = await send(app, `/api/tickets/${made.id}/timeline`, { headers: bearer(key) });
    const actions = ((await timeline.json()).entries as Array<{ action?: string }>).map(
      (entry) => entry.action,
    );
    expect(actions).toContain('pull_request_linked');
    expect(actions).toContain('pull_request_merged');
  });

  test('links from the branch when the title names nothing', async () => {
    const { app, key } = await signedIn();
    const project = await makeProject(app, key);
    const made = await makeTicket(app, key, project.id, { title: 'Branch-named work' });
    await send(
      app,
      `/api/projects/${project.id}/repositories`,
      json('POST', key, { owner: 'acme', name: 'api' }),
    );

    const opened = await send(
      app,
      '/api/webhooks/github',
      delivery(
        pullRequest({ number: 9, title: 'No identifier here', branch: `${made.name}-work` }),
      ),
    );
    expect(opened.status).toBe(200);

    const linked = await send(app, `/api/tickets/${made.id}/pull-requests`, {
      headers: bearer(key),
    });
    expect(((await linked.json()).pullRequests as unknown[]).length).toBe(1);
  });

  test('refuses an unsigned delivery and ignores a repository no project watches', async () => {
    const { app, key } = await signedIn();
    const project = await makeProject(app, key);
    const made = await makeTicket(app, key, project.id, { title: 'Untouched' });
    await send(
      app,
      `/api/projects/${project.id}/repositories`,
      json('POST', key, { owner: 'acme', name: 'api' }),
    );

    const forged = await send(
      app,
      '/api/webhooks/github',
      delivery(pullRequest({ number: 3, title: `${made.name}: forged` }), 'not-the-secret'),
    );
    expect(forged.status).toBe(401);

    const elsewhere = await send(
      app,
      '/api/webhooks/github',
      delivery(pullRequest({ number: 4, title: `${made.name}: elsewhere`, name: 'other' })),
    );
    expect(elsewhere.status).toBe(200);

    const linked = await send(app, `/api/tickets/${made.id}/pull-requests`, {
      headers: bearer(key),
    });
    expect((await linked.json()).pullRequests).toEqual([]);
  });
});
