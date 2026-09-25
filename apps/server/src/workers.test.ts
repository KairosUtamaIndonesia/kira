/**
 * The desktops that have offered themselves for work.
 *
 * Exercised through the HTTP app against a real migrated database, because what matters
 * about a worker is what it is answered with: whether it is here or away, what it holds,
 * and that nothing hands it work. A test that reached past the route would prove none of
 * that.
 *
 * Two things are asserted as absences. A worker holds nothing until its own person starts
 * something, because a worker never takes work on its own (docs/adr/0012); and a worker
 * that has gone quiet is still there, because away is not gone.
 */
import { afterAll, afterEach, describe, expect, test } from 'bun:test';
import { eq } from 'drizzle-orm';
import { claim, worker as workerRow } from './schema';
import { bearer, boot, closeDatabases, issue, send, user } from './test-support/server';

afterEach(closeDatabases);
afterAll(closeDatabases);

/** A worker as a client reads one. */
interface Worker {
  id: string;
  name: string;
  owner: { id: string; name: string };
  workspaces: string[];
  heardAt: string;
  away: boolean;
  quietMs: number;
  holds: string[];
}

/** A server, with people added to it as a test needs them. */
async function server() {
  const { app, auth, database } = await boot();

  return {
    app,
    auth,
    database,
    async add(email = 'ada@company.example') {
      const held = await user(auth, email);

      return { id: held.id, name: held.name, key: (await issue(auth, held.id, 'workstation')).key };
    },
  };
}

function body(method: string, headers: Record<string, string>, sent: unknown): RequestInit {
  return {
    method,
    headers: { 'content-type': 'application/json', ...headers },
    body: JSON.stringify(sent),
  };
}

/** A desktop offering itself for work. */
async function offered(
  app: Awaited<ReturnType<typeof boot>>['app'],
  key: string,
  sent: Record<string, unknown> = {},
): Promise<Response> {
  return await send(
    app,
    '/api/workers',
    body('POST', bearer(key), {
      id: 'desk-1',
      name: 'Brandon’s laptop',
      workspaces: ['/home/brandon/Workspace/kira'],
      ...sent,
    }),
  );
}

/** The roll-call. */
async function roll(app: Awaited<ReturnType<typeof boot>>['app'], key: string): Promise<Worker[]> {
  const response = await send(app, '/api/workers', { headers: bearer(key) });
  if (response.status !== 200) throw new Error(`no roll-call: ${await response.text()}`);

  return (await response.json()).workers as Worker[];
}

/** A project with one ready ticket, so there is something a worker could hold. */
async function readyTicket(
  app: Awaited<ReturnType<typeof boot>>['app'],
  key: string,
): Promise<{ projectId: string; ticketId: string }> {
  const made = await send(
    app,
    '/api/projects',
    body('POST', bearer(key), { name: 'Kira', prefix: 'FND' }),
  );
  const projectId = (await made.json()).project.id as string;

  const written = await send(
    app,
    `/api/projects/${projectId}/tickets`,
    body('POST', bearer(key), {
      kind: 'feature',
      title: 'A worker holds a ticket',
      body: 'A run happens on a claim.',
      criteria: ['A criterion is one line'],
    }),
  );
  const ticketId = (await written.json()).ticket.id as string;
  await send(
    app,
    `/api/tickets/${ticketId}`,
    body('PATCH', bearer(key), { gate: 'ready-for-agent' }),
  );

  return { projectId, ticketId };
}

describe('a worker', () => {
  test('offers itself, and answers its name, its age and the folders it holds', async () => {
    const made = await server();
    const ada = await made.add();

    const answer = await offered(made.app, ada.key);
    expect(answer.status).toBe(200);

    const held = (await answer.json()).worker as Worker;
    expect(held.id).toBe('desk-1');
    expect(held.name).toBe('Brandon’s laptop');
    expect(held.owner).toEqual({ id: ada.id, name: ada.name });
    expect(held.workspaces).toEqual(['/home/brandon/Workspace/kira']);
    expect(typeof held.heardAt).toBe('string');
    expect(held.away).toBe(false);
    expect(held.quietMs).toBeLessThan(5_000);
    expect(held.holds).toEqual([]);
  });

  test('is offered again by the same desktop rather than being a second worker', async () => {
    const made = await server();
    const ada = await made.add();

    await offered(made.app, ada.key);
    await offered(made.app, ada.key, { workspaces: ['/home/brandon/Workspace/kira'] });

    const all = await roll(made.app, ada.key);
    expect(all).toHaveLength(1);
    expect(all[0]?.workspaces).toEqual(['/home/brandon/Workspace/kira']);
  });

  test('is refused when it does not say what it is called', async () => {
    const made = await server();
    const ada = await made.add();

    const nameless = await offered(made.app, ada.key, { name: '   ' });
    expect(nameless.status).toBe(400);
    expect((await nameless.json()).error.code).toBe('WORKER_NAMELESS');

    expect(await roll(made.app, ada.key)).toHaveLength(0);
  });

  test('is refused for a desktop somebody else has already offered', async () => {
    const made = await server();
    const ada = await made.add();
    const grace = await made.add('grace@company.example');

    await offered(made.app, ada.key);

    // A desktop id is derived from the person and the machine, so an id somebody else
    // already answers for is not Grace's to offer: taking it would mean being handed a
    // machine that is not hers, and a claim naming it would read as work done by a
    // desktop she does not have (GH #68).
    const taken = await offered(made.app, grace.key);
    expect(taken.status).toBe(400);
    expect((await taken.json()).error.code).toBe('WORKER_NOT_YOURS');

    // Ada's desktop is still Ada's, and Grace's offering changed nothing.
    const all = await roll(made.app, grace.key);
    expect(all).toHaveLength(1);
    expect(all[0]?.owner.id).toBe(ada.id);
  });

  test('is away once it has gone quiet, and is still there rather than removed', async () => {
    const made = await server();
    const ada = await made.add();

    await offered(made.app, ada.key);

    // A quiet worker, written where it lives: nothing else can age one, and waiting for a
    // heartbeat to lapse would make this test about the clock.
    await made.database
      .update(workerRow)
      .set({ heardAt: new Date(Date.now() - 10 * 60_000) })
      .where(eq(workerRow.id, 'desk-1'));

    const all = await roll(made.app, ada.key);
    expect(all).toHaveLength(1);
    expect(all[0]?.away).toBe(true);
    expect(all[0]?.quietMs).toBeGreaterThanOrEqual(10 * 60_000);

    // And it is still the same worker: a heartbeat brings it back without a new offering.
    const again = await send(
      made.app,
      '/api/workers/desk-1/heartbeat',
      body('POST', bearer(ada.key), {}),
    );
    expect(again.status).toBe(200);
    expect((await again.json()).worker.away).toBe(false);
    expect(await roll(made.app, ada.key)).toHaveLength(1);
  });

  test('cannot be heartbeated by a desktop nobody has heard of', async () => {
    const made = await server();
    const ada = await made.add();

    const unknown = await send(
      made.app,
      '/api/workers/desk-9/heartbeat',
      body('POST', bearer(ada.key), {}),
    );
    expect(unknown.status).toBe(404);
    expect((await unknown.json()).error.code).toBe('WORKER_UNKNOWN');
  });

  test('holds nothing until its own person starts something', async () => {
    const made = await server();
    const ada = await made.add();
    const { ticketId } = await readyTicket(made.app, ada.key);

    await offered(made.app, ada.key);

    // Nothing was handed to it and nothing was picked up: a worker never takes work on its
    // own, and there is no route by which the server could give it any.
    const idle = await roll(made.app, ada.key);
    expect(idle[0]?.holds).toEqual([]);

    // Once a claim names this desktop, the roll-call says what it is working.
    await send(
      made.app,
      `/api/tickets/${ticketId}/claim`,
      body('POST', bearer(ada.key), { workerId: 'desk-1', leaseSeconds: 60 }),
    );

    const working = await roll(made.app, ada.key);
    expect(working[0]?.holds).toEqual([ticketId]);
  });

  test('that said goodbye is gone, and so is what it held', async () => {
    const made = await server();
    const ada = await made.add();
    const { ticketId } = await readyTicket(made.app, ada.key);

    await offered(made.app, ada.key);
    await send(
      made.app,
      `/api/tickets/${ticketId}/claim`,
      body('POST', bearer(ada.key), { workerId: 'desk-1', leaseSeconds: 60 }),
    );

    const gone = await send(made.app, '/api/workers/desk-1', {
      method: 'DELETE',
      headers: bearer(ada.key),
    });
    expect(gone.status).toBe(200);
    expect((await gone.json()).gone).toBe(true);

    expect(await roll(made.app, ada.key)).toHaveLength(0);
    // Nobody is working that ticket any more, so it is ready to be claimed again.
    expect(await made.database.select().from(claim)).toHaveLength(0);
    const ticket = await send(made.app, `/api/tickets/${ticketId}`, { headers: bearer(ada.key) });
    expect((await ticket.json()).ticket.band).toBe('ready');

    // Letting go of what is not there is the same as having let go of it.
    const again = await send(made.app, '/api/workers/desk-1', {
      method: 'DELETE',
      headers: bearer(ada.key),
    });
    expect(again.status).toBe(200);
  });

  test('that said goodbye ends the run it left behind rather than stranding it', async () => {
    const made = await server();
    const ada = await made.add();
    const { ticketId } = await readyTicket(made.app, ada.key);

    await offered(made.app, ada.key);
    await send(
      made.app,
      `/api/tickets/${ticketId}/claim`,
      body('POST', bearer(ada.key), { workerId: 'desk-1', leaseSeconds: 60 }),
    );
    const started = await send(
      made.app,
      `/api/tickets/${ticketId}/runs`,
      body('POST', bearer(ada.key), { workerId: 'desk-1' }),
    );
    const runId = (await started.json()).run.id as string;

    const gone = await send(made.app, '/api/workers/desk-1', {
      method: 'DELETE',
      headers: bearer(ada.key),
    });
    expect(gone.status).toBe(200);

    // The desktop that was driving it is gone, so the run is over: a run left open by a
    // claim that went with it is a ticket that can never be run again.
    const ticket = await send(made.app, `/api/tickets/${ticketId}`, { headers: bearer(ada.key) });
    const after = (await ticket.json()).ticket;
    expect(after.claim).toBeNull();
    const newest = after.runs[0];
    expect(newest.id).toBe(runId);
    expect(newest.endedAt).not.toBeNull();
    expect(newest.stoppedBecause).toBe('The desktop running this stopped.');
    expect(after.band).toBe('needs-you');
  });

  test('is readable by anybody signed in, because a project is shared work', async () => {
    const made = await server();
    const ada = await made.add();
    const grace = await made.add('grace@company.example');

    await offered(made.app, ada.key);

    const seen = await roll(made.app, grace.key);
    expect(seen).toHaveLength(1);
    expect(seen[0]?.name).toBe('Brandon’s laptop');
  });

  test('is refused to somebody not signed in, rather than answered as no workers', async () => {
    const made = await server();
    await offered(made.app, (await made.add()).key);

    const anonymous = await send(made.app, '/api/workers', {});
    expect(anonymous.status).toBe(401);
    expect((await anonymous.json()).error.code).toBeTruthy();
  });
});
test('a desktop saying it is still here keeps the runs it is driving alive', async () => {
  const made = await server();
  const ada = await made.add();
  const { ticketId } = await readyTicket(made.app, ada.key);

  await offered(made.app, ada.key);

  // A run starts, on a lease that has already run out — the shape of a desktop that took a
  // claim and then stopped answering, which is what a lease exists to notice.
  const taken = await send(
    made.app,
    `/api/tickets/${ticketId}/claim`,
    body('POST', bearer(ada.key), { workerId: 'desk-1', leaseSeconds: 0 }),
  );
  expect(taken.status).toBe(200);

  const before = await read(made.app, ada.key, ticketId);
  expect(before.claim.stale).toBe(true);

  // Now it says it is still here, as it does every twenty seconds while it runs, and says
  // which run it is here for. The claim it holds is not a separate fact from the desktop
  // working it, so its lease runs from this moment too — which is what makes a lease mean
  // "the machine went away" rather than "a minute passed".
  const beaten = await send(
    made.app,
    '/api/workers/desk-1/heartbeat',
    body('POST', bearer(ada.key), { driving: [ticketId] }),
  );
  expect(beaten.status).toBe(200);

  const after = await read(made.app, ada.key, ticketId);

  expect(after.claim.stale).toBe(false);
  expect(new Date(after.claim.leaseUntil).getTime()).toBeGreaterThan(Date.now() + 50_000);
});

test('a desktop that restarted leaves the run it was driving to go stale', async () => {
  const made = await server();
  const ada = await made.add();
  const { ticketId } = await readyTicket(made.app, ada.key);

  await offered(made.app, ada.key);
  await send(
    made.app,
    `/api/tickets/${ticketId}/claim`,
    body('POST', bearer(ada.key), { workerId: 'desk-1', leaseSeconds: 0 }),
  );

  // The window died mid-run and the app was opened again. The same desktop is here — same
  // person, same machine, same worker — and it is driving nothing, because the run went with
  // the window. Its heartbeat must not make that run look alive: a ticket that reads Running
  // while nobody is working it can never be taken over, since a claim that is refreshed
  // forever never goes stale (GH #74, #75).
  const beaten = await send(
    made.app,
    '/api/workers/desk-1/heartbeat',
    body('POST', bearer(ada.key), { driving: [] }),
  );
  expect(beaten.status).toBe(200);
  expect((await beaten.json()).worker.away).toBe(false);

  const after = await read(made.app, ada.key, ticketId);
  expect(after.claim.stale).toBe(true);
});

/** One ticket as a client reads it. */
async function read(
  app: Awaited<ReturnType<typeof boot>>['app'],
  key: string,
  ticketId: string,
): Promise<{ claim: { stale: boolean; leaseUntil: string } }> {
  const answer = await send(app, `/api/tickets/${ticketId}`, { headers: bearer(key) });

  return (await answer.json()).ticket;
}
