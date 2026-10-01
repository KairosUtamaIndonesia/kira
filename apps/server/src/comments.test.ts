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

async function signedIn(email = 'ada@company.example') {
  const { app, auth } = await boot();
  const person = await user(auth, email);
  const key = (await issue(auth, person.id, 'comments-test')).key;
  return { app, auth, key, person };
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
  return (await response.json()).ticket as { id: string; status: string };
}

async function comment(
  app: Awaited<ReturnType<typeof boot>>['app'],
  key: string,
  ref: string,
  body: string,
  values: Record<string, unknown> = {},
) {
  const response = await send(
    app,
    `/api/tickets/${ref}/comments`,
    json('POST', key, { body, ...values }),
  );
  expect(response.status).toBe(200);
  return (await response.json()).comment as { id: string; parentId: string | null; body: string };
}

async function timeline(
  app: Awaited<ReturnType<typeof boot>>['app'],
  key: string,
  ref: string,
  query = '',
) {
  const response = await send(app, `/api/tickets/${ref}/timeline${query}`, {
    headers: bearer(key),
  });
  expect(response.status).toBe(200);
  return (await response.json()).entries as Array<{
    type: string;
    id: string;
    action?: string;
    details?: Record<string, unknown>;
    body?: string;
    deleted?: boolean;
  }>;
}

const refusalCode = (body: unknown) => (body as { error: { code: string } }).error.code;
const bodyOf = async (response: Response) => await response.json();

describe('comments', () => {
  test('says something on a ticket, replies, and reads it oldest first', async () => {
    const { app, key, person } = await signedIn();
    const project = await makeProject(app, key);
    const made = await makeTicket(app, key, project.id);

    const root = await comment(app, key, made.id, 'The login path drops the cookie.');
    expect(root.body).toBe('The login path drops the cookie.');
    expect(root.parentId).toBeNull();
    const reply = await comment(app, key, made.id, 'Fixed on the branch.', { parentId: root.id });
    expect(reply.parentId).toBe(root.id);

    const listed = await send(app, `/api/tickets/${made.id}/comments`, { headers: bearer(key) });
    expect(listed.status).toBe(200);
    const comments = (await listed.json()).comments as Array<{
      id: string;
      author: { name: string } | null;
      mine: boolean;
    }>;
    expect(comments.map((each) => each.id)).toEqual([root.id, reply.id]);
    expect(comments[0]!.author!.name).toBe(person.name);
    expect(comments.map((each) => each.mine)).toEqual([true, true]);
  });

  test('lets Kira say something on a ticket', async () => {
    const { app, key } = await signedIn();
    const project = await makeProject(app, key);
    const made = await makeTicket(app, key, project.id);

    const said = await comment(app, key, made.id, 'Working on it.', { authorKind: 'kira' });
    const listed = await send(app, `/api/tickets/${made.id}/comments`, { headers: bearer(key) });
    const comments = (await listed.json()).comments as Array<{ id: string; authorKind: string }>;
    expect(comments.find((each) => each.id === said.id)!.authorKind).toBe('kira');
  });

  test('edits a comment, then removes it outright when it has no replies', async () => {
    const { app, key } = await signedIn();
    const project = await makeProject(app, key);
    const made = await makeTicket(app, key, project.id);
    const said = await comment(app, key, made.id, 'First words');

    const edited = await send(
      app,
      `/api/comments/${said.id}`,
      json('PATCH', key, { body: 'Second words' }),
    );
    expect(edited.status).toBe(200);
    expect((await edited.json()).comment.body).toBe('Second words');

    const removed = await send(app, `/api/comments/${said.id}`, {
      method: 'DELETE',
      headers: bearer(key),
    });
    expect(removed.status).toBe(200);

    const listed = await send(app, `/api/tickets/${made.id}/comments`, { headers: bearer(key) });
    expect((await listed.json()).comments).toEqual([]);
  });

  test('tombstones a comment that has replies', async () => {
    const { app, key } = await signedIn();
    const project = await makeProject(app, key);
    const made = await makeTicket(app, key, project.id);
    const root = await comment(app, key, made.id, 'A question');
    const reply = await comment(app, key, made.id, 'An answer', { parentId: root.id });

    const removed = await send(app, `/api/comments/${root.id}`, {
      method: 'DELETE',
      headers: bearer(key),
    });
    expect(removed.status).toBe(200);

    const listed = await send(app, `/api/tickets/${made.id}/comments`, { headers: bearer(key) });
    const comments = (await listed.json()).comments as Array<{
      id: string;
      body: string;
      deleted: boolean;
    }>;
    expect(comments.map((each) => each.id)).toEqual([root.id, reply.id]);
    expect(comments[0]!.deleted).toBe(true);
    expect(comments[0]!.body).toBe('');
  });

  test('refuses what it cannot do', async () => {
    const { app, auth, key } = await signedIn();
    const project = await makeProject(app, key);
    const made = await makeTicket(app, key, project.id);
    const other = await makeTicket(app, key, project.id, { title: 'Another ticket' });
    const elsewhere = await comment(app, key, other.id, 'On the other ticket');
    const grace = await user(auth, 'grace@company.example');
    const graceKey = (await issue(auth, grace.id, 'grace-comments')).key;

    const empty = await send(
      app,
      `/api/tickets/${made.id}/comments`,
      json('POST', key, { body: '   ' }),
    );
    expect(empty.status).toBe(400);
    expect(refusalCode(await bodyOf(empty))).toBe('COMMENT_BODY_REQUIRED');

    const wrongParent = await send(
      app,
      `/api/tickets/${made.id}/comments`,
      json('POST', key, { body: 'Cross-ticket reply', parentId: elsewhere.id }),
    );
    expect(wrongParent.status).toBe(400);
    expect(refusalCode(await bodyOf(wrongParent))).toBe('COMMENT_PARENT_OTHER_TICKET');

    const root = await comment(app, key, made.id, 'Mine');
    const notMine = await send(
      app,
      `/api/comments/${root.id}`,
      json('PATCH', graceKey, { body: 'Yours now' }),
    );
    expect(notMine.status).toBe(403);
    expect(refusalCode(await bodyOf(notMine))).toBe('COMMENT_NOT_YOURS');

    const badLimit = await send(app, `/api/tickets/${made.id}/timeline?limit=0`, {
      headers: bearer(key),
    });
    expect(badLimit.status).toBe(400);
    expect(refusalCode(await bodyOf(badLimit))).toBe('LIMIT_INVALID');
  });
});

describe('activity', () => {
  test('records a ticket’s history and merges it with its comments', async () => {
    const { app, key } = await signedIn();
    const project = await makeProject(app, key);
    const made = await makeTicket(app, key, project.id);
    await comment(app, key, made.id, 'Starting now.');

    const patched = await send(
      app,
      `/api/tickets/${made.id}`,
      json('PATCH', key, { status: 'needs-review' }),
    );
    expect(patched.status).toBe(200);

    const entries = await timeline(app, key, made.id);
    expect(entries.map((each) => each.type)).toEqual(['activity', 'comment', 'activity']);

    const created = entries[0]!;
    expect(created.action).toBe('created');

    const moved = entries[2]!;
    expect(moved.action).toBe('status_changed');
    expect(moved.details).toEqual({ from: 'draft', to: 'needs-review' });
  });

  test('records blockers being added and removed', async () => {
    const { app, key } = await signedIn();
    const project = await makeProject(app, key);
    const parent = await makeTicket(app, key, project.id, { title: 'Parent' });
    const slice = await makeTicket(app, key, project.id, { title: 'Slice' });

    const added = await send(
      app,
      `/api/tickets/${parent.id}/gates`,
      json('POST', key, { gatedBy: slice.id }),
    );
    expect(added.status).toBe(200);

    const removed = await send(app, `/api/tickets/${parent.id}/gates/${slice.id}`, {
      method: 'DELETE',
      headers: bearer(key),
    });
    expect(removed.status).toBe(200);

    const actions = (await timeline(app, key, parent.id)).map((each) => each.action);
    expect(actions).toEqual(['created', 'blocker_added', 'blocker_removed']);
  });

  test('caps the timeline to the newest entries when asked', async () => {
    const { app, key } = await signedIn();
    const project = await makeProject(app, key);
    const made = await makeTicket(app, key, project.id);
    await comment(app, key, made.id, 'One');
    await comment(app, key, made.id, 'Two');
    await comment(app, key, made.id, 'Three');

    const capped = await timeline(app, key, made.id, '?limit=2');
    expect(capped).toHaveLength(2);
    expect(capped.map((each) => each.body)).toEqual(['Two', 'Three']);
  });
});
