import { createHmac } from 'node:crypto';
import { afterAll, afterEach, describe, expect, setSystemTime, test } from 'bun:test';
import { boot, closeDatabases, issue, send, user } from './test-support/server';

afterEach(closeDatabases);
afterAll(closeDatabases);

// A test that moves the clock puts it back, so the next one reads the real time.
afterEach(() => {
  setSystemTime();
});

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
  return { app, auth, key, person };
}

/** Make the signed-in person an administrator, which connecting a host requires. */
async function makeAdmin(auth: Awaited<ReturnType<typeof boot>>['auth'], userId: string) {
  const context = await auth.$context;
  await context.internalAdapter.updateUser(userId, { role: 'admin' });
}

function giteaDelivery(payload: unknown, secret: string, event = 'pull_request'): RequestInit {
  const body = JSON.stringify(payload);
  const signature = createHmac('sha256', secret).update(body).digest('hex');

  return {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'x-gitea-event': event,
      'x-gitea-signature': signature,
    },
    body,
  };
}

function gitlabDelivery(
  payload: unknown,
  secret: string,
  event = 'Merge Request Hook',
): RequestInit {
  return {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'x-gitlab-event': event,
      'x-gitlab-token': secret,
    },
    body: JSON.stringify(payload),
  };
}

async function pullRequestsFor(
  app: Awaited<ReturnType<typeof boot>>['app'],
  key: string,
  ticketId: string,
) {
  const response = await send(app, `/api/tickets/${ticketId}/pull-requests`, {
    headers: bearer(key),
  });

  return (await response.json()).pullRequests as Array<{
    checksState: string | null;
    checks: { context: string; state: string }[];
  }>;
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

function delivery(payload: unknown, secret = SECRET, event = 'pull_request'): RequestInit {
  const body = JSON.stringify(payload);
  const signature = createHmac('sha256', secret).update(body).digest('hex');

  return {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'x-github-event': event,
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

describe('connected hosts', () => {
  test('connects a host as an administrator and shows the webhook secret once', async () => {
    const { app, auth, key, person } = await signedIn();

    const refused = await send(
      app,
      '/api/git/connections',
      json('POST', key, {
        provider: 'forgejo',
        instanceUrl: 'https://git.example.com',
        accessToken: 'a-token',
      }),
    );
    expect(refused.status).toBe(403);

    await makeAdmin(auth, person.id);

    const connected = await send(
      app,
      '/api/git/connections',
      json('POST', key, {
        provider: 'forgejo',
        instanceUrl: 'https://git.example.com',
        accessToken: 'a-token',
      }),
    );
    expect(connected.status).toBe(200);
    const body = (await connected.json()) as {
      connection: Record<string, unknown>;
      webhookSecret: string;
    };
    expect(body.connection).toMatchObject({
      provider: 'forgejo',
      authKind: 'token',
      instanceUrl: 'https://git.example.com',
    });
    expect(typeof body.webhookSecret).toBe('string');

    const listed = await send(app, '/api/git/connections', { headers: bearer(key) });
    const connections = (await listed.json()).connections as unknown[];
    expect(connections).toHaveLength(1);
    // The secret is stored sealed and never read back out.
    expect(JSON.stringify(connections)).not.toContain(body.webhookSecret);
  });

  test('links and completes a ticket from a connected Forgejo host', async () => {
    const { app, auth, key, person } = await signedIn();
    await makeAdmin(auth, person.id);
    const project = await makeProject(app, key);
    const made = await makeTicket(app, key, project.id, { title: 'Self-hosted work' });
    await send(app, `/api/tickets/${made.id}`, json('PATCH', key, { status: 'needs-review' }));

    const connected = await send(
      app,
      '/api/git/connections',
      json('POST', key, {
        provider: 'forgejo',
        instanceUrl: 'https://git.example.com',
        accessToken: 'a-token',
      }),
    );
    const { connection, webhookSecret } = (await connected.json()) as {
      connection: { id: string };
      webhookSecret: string;
    };
    await send(
      app,
      `/api/projects/${project.id}/repositories`,
      json('POST', key, { owner: 'acme', name: 'api', provider: 'forgejo' }),
    );

    const opened = await send(
      app,
      `/api/webhooks/git/${connection.id}`,
      giteaDelivery(pullRequest({ number: 2, title: `${made.name}: self-hosted` }), webhookSecret),
    );
    expect(opened.status).toBe(200);

    const merged = await send(
      app,
      `/api/webhooks/git/${connection.id}`,
      giteaDelivery(
        pullRequest({
          number: 2,
          title: `${made.name}: self-hosted`,
          state: 'closed',
          merged: true,
          mergedAt: '2026-10-01T00:00:00.000Z',
        }),
        webhookSecret,
      ),
    );
    expect(merged.status).toBe(200);

    const after = await send(app, `/api/tickets/${made.id}`, { headers: bearer(key) });
    expect((await after.json()).ticket.status).toBe('done');
  });

  test('links a ticket from a connected GitLab host', async () => {
    const { app, auth, key, person } = await signedIn();
    await makeAdmin(auth, person.id);
    const project = await makeProject(app, key);
    const made = await makeTicket(app, key, project.id, { title: 'GitLab work' });

    const connected = await send(
      app,
      '/api/git/connections',
      json('POST', key, {
        provider: 'gitlab',
        instanceUrl: 'https://git.example.com',
        accessToken: 'a-token',
      }),
    );
    const { connection, webhookSecret } = (await connected.json()) as {
      connection: { id: string };
      webhookSecret: string;
    };
    await send(
      app,
      `/api/projects/${project.id}/repositories`,
      json('POST', key, { owner: 'acme', name: 'api', provider: 'gitlab' }),
    );

    const delivered = await send(
      app,
      `/api/webhooks/git/${connection.id}`,
      gitlabDelivery(
        {
          object_attributes: {
            iid: 5,
            url: 'https://git.example.com/acme/api/-/merge_requests/5',
            title: `${made.name}: gitlab`,
            state: 'closed',
            action: 'merge',
            source_branch: 'fnd-5',
            last_commit: { id: 'abc' },
            author: { username: 'ada' },
            draft: false,
            merged_at: '2026-10-01T00:00:00.000Z',
          },
          project: { path_with_namespace: 'acme/api', name: 'api' },
        },
        webhookSecret,
      ),
    );
    expect(delivered.status).toBe(200);

    const linked = await send(app, `/api/tickets/${made.id}/pull-requests`, {
      headers: bearer(key),
    });
    const prs = (await linked.json()).pullRequests as Array<{ number: number; state: string }>;
    expect(prs).toHaveLength(1);
    expect(prs[0]).toMatchObject({ number: 5, state: 'merged' });
  });
});

describe('the GitHub App', () => {
  test('reports whether an App is configured, and refuses a non-administrator', async () => {
    const { app, auth, key, person } = await signedIn();

    const refused = await send(app, '/api/git/github/connect', { headers: bearer(key) });
    expect(refused.status).toBe(403);

    await makeAdmin(auth, person.id);
    const answer = await send(app, '/api/git/github/connect', { headers: bearer(key) });
    expect(answer.status).toBe(200);
    expect(await answer.json()).toEqual({ configured: false, url: null });
  });

  test('installs with a signed state, and records the connection without App credentials', async () => {
    const { app, auth } = await boot({}, {}, {}, { appSlug: 'kira-test' });
    const person = await user(auth);
    const key = (await issue(auth, person.id, 'github-app-test')).key;
    await makeAdmin(auth, person.id);

    const connect = await send(app, '/api/git/github/connect', { headers: bearer(key) });
    expect(connect.status).toBe(200);
    const body = (await connect.json()) as { configured: boolean; url: string };
    expect(body.configured).toBe(true);
    expect(body.url).toContain('https://github.com/apps/kira-test/installations/new?state=');

    const state = new URL(body.url).searchParams.get('state');
    expect(typeof state).toBe('string');

    const tampered = await send(
      app,
      `/api/git/github/setup?installation_id=42&state=${encodeURIComponent(`${state}x`)}`,
    );
    expect(tampered.status).toBe(400);

    const installed = await send(
      app,
      `/api/git/github/setup?installation_id=42&state=${encodeURIComponent(state!)}`,
    );
    expect(installed.status).toBe(200);

    const listed = await send(app, '/api/git/connections', { headers: bearer(key) });
    const connections = (await listed.json()).connections as Array<Record<string, unknown>>;
    expect(connections).toHaveLength(1);
    expect(connections[0]).toMatchObject({
      provider: 'github',
      authKind: 'app',
      accountLogin: 'unknown',
    });
  });

  test('refuses an install state older than an hour', async () => {
    const { app, auth } = await boot({}, {}, {}, { appSlug: 'kira-test' });
    const person = await user(auth);
    const key = (await issue(auth, person.id, 'github-app-stale')).key;
    await makeAdmin(auth, person.id);

    const connect = await send(app, '/api/git/github/connect', { headers: bearer(key) });
    const body = (await connect.json()) as { url: string };
    const state = new URL(body.url).searchParams.get('state')!;

    setSystemTime(new Date(Date.now() + 2 * 60 * 60 * 1000));

    const late = await send(
      app,
      `/api/git/github/setup?installation_id=42&state=${encodeURIComponent(state)}`,
    );
    expect(late.status).toBe(400);
  });

  test('drops the connection only when the App is uninstalled', async () => {
    const { app, auth } = await boot({}, {}, {}, { appSlug: 'kira-test' });
    const person = await user(auth);
    const key = (await issue(auth, person.id, 'github-app-uninstall')).key;
    await makeAdmin(auth, person.id);

    const connect = await send(app, '/api/git/github/connect', { headers: bearer(key) });
    const body = (await connect.json()) as { url: string };
    const state = new URL(body.url).searchParams.get('state')!;
    await send(
      app,
      `/api/git/github/setup?installation_id=42&state=${encodeURIComponent(state)}`,
    );

    const suspended = await send(
      app,
      '/api/webhooks/github',
      delivery({ action: 'suspend', installation: { id: 42 } }, SECRET, 'installation'),
    );
    expect(suspended.status).toBe(200);
    const kept = await send(app, '/api/git/connections', { headers: bearer(key) });
    expect((await kept.json()).connections).toHaveLength(1);

    const uninstalled = await send(
      app,
      '/api/webhooks/github',
      delivery({ action: 'deleted', installation: { id: 42 } }, SECRET, 'installation'),
    );
    expect(uninstalled.status).toBe(200);
    const gone = await send(app, '/api/git/connections', { headers: bearer(key) });
    expect((await gone.json()).connections).toHaveLength(0);
  });
});

describe('checks', () => {
  async function withPullRequest() {
    const { app, key } = await signedIn();
    const project = await makeProject(app, key);
    const made = await makeTicket(app, key, project.id, { title: 'Checked work' });
    await send(
      app,
      `/api/projects/${project.id}/repositories`,
      json('POST', key, { owner: 'acme', name: 'api' }),
    );
    await send(
      app,
      '/api/webhooks/github',
      delivery(pullRequest({ number: 7, title: `${made.name}: checked` })),
    );

    return { app, key, made };
  }

  test('rolls a check up onto the pull request', async () => {
    const { app, key, made } = await withPullRequest();

    const running = await send(
      app,
      '/api/webhooks/github',
      delivery(
        {
          check_run: {
            name: 'build',
            status: 'in_progress',
            conclusion: null,
            head_sha: 'abc123',
            pull_requests: [{ number: 7 }],
          },
          repository: { name: 'api', owner: { login: 'acme' } },
        },
        SECRET,
        'check_run',
      ),
    );
    expect(running.status).toBe(200);

    let prs = await pullRequestsFor(app, key, made.id);
    expect(prs[0]).toMatchObject({
      checksState: 'pending',
      checks: [{ context: 'build', state: 'pending' }],
    });

    const failed = await send(
      app,
      '/api/webhooks/github',
      delivery(
        {
          check_run: {
            name: 'build',
            status: 'completed',
            conclusion: 'failure',
            head_sha: 'abc123',
            pull_requests: [{ number: 7 }],
          },
          repository: { name: 'api', owner: { login: 'acme' } },
        },
        SECRET,
        'check_run',
      ),
    );
    expect(failed.status).toBe(200);

    prs = await pullRequestsFor(app, key, made.id);
    expect(prs[0]!.checksState).toBe('failed');
  });

  test('resolves a commit status by its SHA', async () => {
    const { app, key, made } = await withPullRequest();

    const sent = await send(
      app,
      '/api/webhooks/github',
      delivery(
        {
          state: 'success',
          sha: 'abc123',
          context: 'ci/test',
          repository: { name: 'api', owner: { login: 'acme' } },
        },
        SECRET,
        'status',
      ),
    );
    expect(sent.status).toBe(200);

    const prs = await pullRequestsFor(app, key, made.id);
    expect(prs[0]).toMatchObject({
      checksState: 'passed',
      checks: [{ context: 'ci/test', state: 'passed' }],
    });
  });

  test('records a GitLab pipeline on the merge request', async () => {
    const { app, auth, key, person } = await signedIn();
    await makeAdmin(auth, person.id);
    const project = await makeProject(app, key);
    const made = await makeTicket(app, key, project.id, { title: 'GitLab checks' });

    const connected = await send(
      app,
      '/api/git/connections',
      json('POST', key, {
        provider: 'gitlab',
        instanceUrl: 'https://git.example.com',
        accessToken: 'a-token',
      }),
    );
    const { connection, webhookSecret } = (await connected.json()) as {
      connection: { id: string };
      webhookSecret: string;
    };
    await send(
      app,
      `/api/projects/${project.id}/repositories`,
      json('POST', key, { owner: 'acme', name: 'api', provider: 'gitlab' }),
    );

    await send(
      app,
      `/api/webhooks/git/${connection.id}`,
      gitlabDelivery(
        {
          object_attributes: {
            iid: 5,
            url: 'https://git.example.com/acme/api/-/merge_requests/5',
            title: `${made.name}: gitlab`,
            state: 'opened',
            action: 'open',
            source_branch: 'fnd-5',
            last_commit: { id: 'sha5' },
            author: { username: 'ada' },
            draft: false,
          },
          project: { path_with_namespace: 'acme/api', name: 'api' },
        },
        webhookSecret,
      ),
    );

    const pipeline = await send(
      app,
      `/api/webhooks/git/${connection.id}`,
      gitlabDelivery(
        {
          object_attributes: { sha: 'sha5', status: 'failed' },
          merge_request: { iid: 5 },
          project: { path_with_namespace: 'acme/api' },
        },
        webhookSecret,
        'Pipeline Hook',
      ),
    );
    expect(pipeline.status).toBe(200);

    const prs = await pullRequestsFor(app, key, made.id);
    expect(prs[0]).toMatchObject({
      checksState: 'failed',
      checks: [{ context: 'pipeline', state: 'failed' }],
    });
  });
});
