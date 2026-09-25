import { afterAll, afterEach, describe, expect, test } from 'bun:test';
import { closeDatabases, send, bearer, boot, issue, user } from './test-support/server';

const json = (method: string, key: string, value?: unknown): RequestInit => ({
  method,
  headers: { ...bearer(key), 'content-type': 'application/json' },
  ...(value === undefined ? {} : { body: JSON.stringify(value) }),
});

afterEach(closeDatabases);
afterAll(closeDatabases);

describe('execution workspace review', () => {
  test('persists inline comments and feedback across review rounds', async () => {
    const { app, auth } = await boot();
    const ada = await user(auth);
    const key = (await issue(auth, ada.id, 'review-test')).key;

    const projectResponse = await send(
      app,
      '/api/projects',
      json('POST', key, { name: 'Kira', prefix: 'REV' }),
    );
    const project = (await projectResponse.json()).project as { id: string };
    const ticketResponse = await send(
      app,
      `/api/projects/${project.id}/tickets`,
      json('POST', key, {
        kind: 'feature',
        title: 'Review this change',
        body: 'A reviewer can leave feedback.',
        criteria: ['The feedback is durable'],
      }),
    );
    const ticket = (await ticketResponse.json()).ticket as { id: string };
    const workspaceResponse = await send(
      app,
      `/api/tickets/${ticket.id}/workspaces`,
      json('POST', key, {
        repository: '/work/kira',
        baseBranch: 'main',
        branch: 'review/change',
        agentConfig: 'default',
      }),
    );
    const workspace = (await workspaceResponse.json()).workspace as { id: string };

    const initiallyEmpty = await send(
      app,
      `/api/tickets/${ticket.id}/workspaces/${workspace.id}/review`,
      { headers: bearer(key) },
    );
    expect(await initiallyEmpty.json()).toEqual({ comments: [], feedback: [] });

    const commentResponse = await send(
      app,
      `/api/tickets/${ticket.id}/workspaces/${workspace.id}/review/comments`,
      json('POST', key, {
        path: 'src/feature.ts',
        line: 12,
        side: 'new',
        body: 'Please keep this branch-safe.',
      }),
    );
    expect(commentResponse.status).toBe(200);
    const comment = (await commentResponse.json()).comment as { id: string; status: string };
    expect(comment.status).toBe('open');

    const feedbackResponse = await send(
      app,
      `/api/tickets/${ticket.id}/workspaces/${workspace.id}/review/feedback`,
      json('POST', key, { body: 'Address the inline review before the next round.' }),
    );
    expect(feedbackResponse.status).toBe(200);

    const addressed = await send(
      app,
      `/api/tickets/${ticket.id}/workspaces/${workspace.id}/review/comments/${comment.id}`,
      json('PATCH', key, { status: 'addressed' }),
    );
    expect(addressed.status).toBe(200);
    expect((await addressed.json()).comment.status).toBe('addressed');

    const afterRound = await send(
      app,
      `/api/tickets/${ticket.id}/workspaces/${workspace.id}/review`,
      { headers: bearer(key) },
    );
    const review = await afterRound.json();
    expect(review.comments).toHaveLength(1);
    expect(review.comments[0].status).toBe('addressed');
    expect(review.comments[0].path).toBe('src/feature.ts');
    expect(review.feedback).toHaveLength(1);
  });

  test('refuses invalid anchors and a workspace from another ticket', async () => {
    const { app, auth } = await boot();
    const ada = await user(auth, 'review-invalid@company.example');
    const key = (await issue(auth, ada.id, 'review-invalid-test')).key;
    const project = (await (await send(app, '/api/projects', json('POST', key, { name: 'Kira', prefix: 'RVI' }))).json()).project as { id: string };
    const makeTicket = async (title: string) =>
      (await (await send(app, `/api/projects/${project.id}/tickets`, json('POST', key, {
        kind: 'feature', title, body: 'Body', criteria: ['Criterion'],
      }))).json()).ticket as { id: string };
    const first = await makeTicket('First');
    const second = await makeTicket('Second');
    const workspace = (await (await send(app, `/api/tickets/${first.id}/workspaces`, json('POST', key, {
      repository: '/work/kira', baseBranch: 'main', branch: 'first', agentConfig: 'default',
    }))).json()).workspace as { id: string };

    const invalid = await send(
      app,
      `/api/tickets/${first.id}/workspaces/${workspace.id}/review/comments`,
      json('POST', key, { path: 'src/feature.ts', line: 0, side: 'new', body: 'No.' }),
    );
    expect(invalid.status).toBe(400);

    const wrongTicket = await send(
      app,
      `/api/tickets/${second.id}/workspaces/${workspace.id}/review`,
      { headers: bearer(key) },
    );
    expect(wrongTicket.status).toBe(404);
  });
});
