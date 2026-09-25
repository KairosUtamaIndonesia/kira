import { afterEach, afterAll, describe, expect, test } from 'bun:test';
import { boot, bearer, closeDatabases, issue, send, user } from './test-support/server';

afterEach(closeDatabases);
afterAll(closeDatabases);

function body(method: string, headers: Record<string, string>, value: unknown): RequestInit {
  return {
    method,
    headers: { 'content-type': 'application/json', ...headers },
    body: JSON.stringify(value),
  };
}

type Ticket = {
  id: string;
  kind: string;
  title: string;
  gate: string;
  band: string;
  children: { id: string }[];
  gates: { id: string }[];
};

async function fixture() {
  const made = await boot();
  const ada = await user(made.auth, 'ada@company.example');
  const key = (await issue(made.auth, ada.id, 'workstation')).key;
  const projectResponse = await send(
    made.app,
    '/api/projects',
    body('POST', bearer(key), { name: 'Kira', prefix: 'FND' }),
  );
  const project = (await projectResponse.json()).project as { id: string };
  const specResponse = await send(
    made.app,
    `/api/projects/${project.id}/tickets`,
    body('POST', bearer(key), {
      kind: 'spec',
      title: 'A published spec',
      body: 'The spec has slices.',
      criteria: ['The slices are complete.'],
    }),
  );
  const spec = (await specResponse.json()).ticket as Ticket;
  return { app: made.app, key, projectId: project.id, spec };
}

function children() {
  return [
    {
      id: 'api',
      kind: 'feature',
      title: 'API slice',
      body: 'Expose the behavior.',
      criteria: ['The endpoint answers.'],
      dependsOn: [],
    },
    {
      id: 'surface',
      kind: 'feature',
      title: 'Surface slice',
      body: 'Show the behavior.',
      criteria: ['The surface shows it.'],
      dependsOn: ['api'],
    },
  ];
}

describe('spec breakdown publication', () => {
  test('rejects a dependency cycle before writing any child or gate', async () => {
    const made = await fixture();
    const response = await send(
      made.app,
      `/api/tickets/${made.spec.id}/breakdown`,
      body('POST', bearer(made.key), {
        children: children().map((child) => ({
          ...child,
          dependsOn: child.id === 'api' ? ['surface'] : ['api'],
        })),
      }),
    );
    expect(response.status).toBe(400);
    expect((await response.json()).error).toEqual({
      code: 'GATE_CIRCLE',
      message: 'That gate would close a circle of tickets.',
    });

    const queue = await send(made.app, `/api/projects/${made.projectId}`, {
      headers: bearer(made.key),
    });
    expect(((await queue.json()).tickets as Ticket[]).map((ticket) => ticket.kind)).toEqual([
      'spec',
    ]);
  });

  test('publishes draft children, direct spec gates, and proposed dependencies atomically', async () => {
    const made = await fixture();
    const published = await send(
      made.app,
      `/api/tickets/${made.spec.id}/breakdown`,
      body('POST', bearer(made.key), { children: children() }),
    );
    expect(published.status).toBe(200);
    const result = (await published.json()) as { spec: Ticket; children: Ticket[] };
    expect(result.children).toHaveLength(2);
    expect(result.children.every((child) => child.gate === 'draft')).toBe(true);
    expect(result.spec.children).toHaveLength(2);
    const api = result.children.find((child) => child.title === 'API slice')!;
    const surface = result.children.find((child) => child.title === 'Surface slice')!;
    expect(api.gates.map((ticket) => ticket.id)).toContain(surface.id);
    expect(surface.gates.map((ticket) => ticket.id)).toContain(result.spec.id);
  });

  test('refuses readiness without criteria, then returns every child as ready after repair', async () => {
    const made = await fixture();
    const published = await send(
      made.app,
      `/api/tickets/${made.spec.id}/breakdown`,
      body('POST', bearer(made.key), {
        children: children().map((child) =>
          child.id === 'surface' ? { ...child, criteria: [] } : child,
        ),
      }),
    );
    const result = (await published.json()) as { children: Ticket[] };
    const refused = await send(
      made.app,
      `/api/tickets/${made.spec.id}/breakdown/ready`,
      body('POST', bearer(made.key), {}),
    );
    expect(refused.status).toBe(400);
    expect((await refused.json()).error).toEqual({
      code: 'CRITERIA_REQUIRED',
      message: 'A ticket an agent runs has to say how it is known to be done.',
    });

    const queue = await send(made.app, `/api/projects/${made.projectId}`, {
      headers: bearer(made.key),
    });
    const current = ((await queue.json()).tickets as Ticket[]).filter((ticket) =>
      result.children.some((child) => child.id === ticket.id),
    );
    expect(current.map((ticket) => ticket.gate)).toEqual(['draft', 'draft']);

    const missing = result.children.find((child) => child.title === 'Surface slice')!;
    const repaired = await send(
      made.app,
      `/api/tickets/${missing.id}`,
      body('PATCH', bearer(made.key), { criteria: ['Now it is known to be done.'] }),
    );
    expect(repaired.status).toBe(200);
    const ready = await send(
      made.app,
      `/api/tickets/${made.spec.id}/breakdown/ready`,
      body('POST', bearer(made.key), {}),
    );
    expect(ready.status).toBe(200);
    expect(((await ready.json()).children as Ticket[]).map((ticket) => ticket.gate)).toEqual([
      'ready-for-agent',
      'ready-for-agent',
    ]);
  });
});
