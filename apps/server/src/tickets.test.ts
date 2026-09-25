/**
 * Projects, their tickets, the gate a ticket is at, and the queue those derive.
 *
 * The whole of the tracker's own domain is exercised through the HTTP app against
 * a real migrated database, because the interesting facts are relational: a prefix
 * is unique without regard to case, a ticket's number is its own within its project
 * and never drawn twice, a gate may not close a circle, and a band is read off what
 * is closed rather than stored anywhere. A test that reached past the route would
 * prove none of that.
 *
 * Two things are deliberately asserted as absences, because the alternatives are
 * what a reader would otherwise assume: a refused write leaves nothing behind, and
 * `Needs you` is not a band yet — nothing can be in it until a run record exists, and
 * drawing it empty would be a claim about a machine that does not exist yet (GH #57).
 * `Running` stopped being one of those when a claim could be taken on a ticket, which
 * is the only thing that puts anything in it (GH #69).
 */
import { afterAll, afterEach, describe, expect, test } from 'bun:test';
import { eq } from 'drizzle-orm';
import { migrate } from './database';
import { claim, decision, ticket as ticketRow, user as person } from './schema';
import { bearer, boot, closeDatabases, issue, send, user } from './test-support/server';

afterEach(closeDatabases);
afterAll(closeDatabases);

/** A project as a client reads one. */
interface Project {
  id: string;
  name: string;
  prefix: string;
}

/** A claim as a client reads one. */
interface Claim {
  holder: { id: string; name: string };
  workerId: string | null;
  startedAt: string;
  heardAt: string | null;
  leaseUntil: string | null;
  stale: boolean;
  quietMs: number | null;
}

/** A run as a client reads one. */
interface Run {
  id: string;
  ticketId: string;
  workerId: string | null;
  startedAt: string;
  contract: string[];
  branch: string | null;
  endedAt: string | null;
  stoppedBecause: string | null;
  changed: string | null;
  checks: string[] | null;
  made: string | null;
  verdict: string | null;
  verdictAt: string | null;
}

/** A ticket as a client reads one. */
interface Ticket {
  id: string;
  projectId: string;
  name: string;
  number: number;
  kind: string;
  title: string;
  body: string;
  criteria: string[];
  gate: string;
  band: string;
  rank: number;
  branch: string;
  author: { id: string; name: string } | null;
  gates: { id: string; name: string; closed: boolean; closure: string | null }[];
  children: { id: string; name: string; closed: boolean; closure: string | null }[];
  closedAt: string | null;
  closure: string | null;
  sourceChatId: string | null;
  claim: Claim | null;
  runs: Run[];
}

interface Queue {
  project: Project;
  tickets: Ticket[];
  counts: Record<string, number>;
}

/** A server, with people added to it as a test needs them. */
async function server() {
  const { app, auth, database } = await boot();

  return {
    app,
    auth,
    database,
    /** A person on this server, with a key of their own. */
    async add(email = 'ada@company.example') {
      const held = await user(auth, email);

      return { id: held.id, name: held.name, key: (await issue(auth, held.id, 'workstation')).key };
    },
  };
}

/** Somebody signed in with a key, on a server of their own. */
async function signedIn(email = 'ada@company.example') {
  const made = await server();
  const ada = await made.add(email);

  return { app: made.app, auth: made.auth, database: made.database, person: ada, key: ada.key };
}

function body(method: string, headers: Record<string, string>, sent: unknown): RequestInit {
  return {
    method,
    headers: { 'content-type': 'application/json', ...headers },
    body: JSON.stringify(sent),
  };
}

/** A project, made the way the window makes one. */
async function project(
  app: Awaited<ReturnType<typeof boot>>['app'],
  key: string,
  made: { name?: string; prefix?: string } = {},
): Promise<Project> {
  const response = await send(
    app,
    '/api/projects',
    body('POST', bearer(key), { name: 'Foundry', prefix: 'FND', ...made }),
  );
  if (response.status !== 200) throw new Error(`no project: ${await response.text()}`);

  return (await response.json()).project as Project;
}

/** A ticket written down as a draft, and the ticket it produced. */
async function drafted(
  app: Awaited<ReturnType<typeof boot>>['app'],
  key: string,
  projectId: string,
  written: Partial<Pick<Ticket, 'kind' | 'title' | 'body' | 'criteria' | 'sourceChatId'>> = {},
): Promise<Ticket> {
  const response = await send(
    app,
    `/api/projects/${projectId}/tickets`,
    body('POST', bearer(key), {
      kind: 'feature',
      title: 'Add acceptance criteria',
      body: 'A ticket says how it is known to be done.',
      criteria: ['A criterion is one line'],
      ...written,
    }),
  );
  if (response.status !== 200) throw new Error(`no ticket: ${await response.text()}`);

  return (await response.json()).ticket as Ticket;
}

/** One write to one ticket, and the ticket it answers with. */
async function wrote(
  app: Awaited<ReturnType<typeof boot>>['app'],
  key: string,
  id: string,
  changed: Record<string, unknown>,
): Promise<Response> {
  return await send(app, `/api/tickets/${id}`, body('PATCH', bearer(key), changed));
}

/** The queue a project answers with. */
async function queue(
  app: Awaited<ReturnType<typeof boot>>['app'],
  key: string,
  projectId: string,
): Promise<Queue> {
  const response = await send(app, `/api/projects/${projectId}`, { headers: bearer(key) });
  if (response.status !== 200) throw new Error(`no queue: ${await response.text()}`);

  return (await response.json()) as Queue;
}

/** One ticket, read by whatever a person would call it. */
async function read(
  app: Awaited<ReturnType<typeof boot>>['app'],
  key: string,
  ref: string,
): Promise<Response> {
  return await send(app, `/api/tickets/${ref}`, { headers: bearer(key) });
}

/** A claim taken on a ticket, and whatever came back instead. */
async function claimed(
  app: Awaited<ReturnType<typeof boot>>['app'],
  key: string,
  ref: string,
  sent: Record<string, unknown> = {},
): Promise<Response> {
  return await send(app, `/api/tickets/${ref}/claim`, body('POST', bearer(key), sent));
}

/** A heartbeat on a claim. */
async function heard(
  app: Awaited<ReturnType<typeof boot>>['app'],
  key: string,
  ref: string,
  sent: Record<string, unknown> = {},
): Promise<Response> {
  return await send(app, `/api/tickets/${ref}/claim/heartbeat`, body('POST', bearer(key), sent));
}

/** A desktop offering itself for work, the way the app does on its way up. */
async function offering(
  app: Awaited<ReturnType<typeof boot>>['app'],
  key: string,
  id: string,
): Promise<void> {
  const answer = await send(
    app,
    '/api/workers',
    body('POST', bearer(key), { id, name: `${id}-pc`, workspaces: [] }),
  );

  if (answer.status !== 200) throw new Error(`no worker: ${await answer.text()}`);
}

/** A claim let go of by hand. */
async function released(
  app: Awaited<ReturnType<typeof boot>>['app'],
  key: string,
  ref: string,
): Promise<Response> {
  return await send(app, `/api/tickets/${ref}/claim`, { method: 'DELETE', headers: bearer(key) });
}

/** A claim somebody else left behind, taken over by hand. */
async function takenOver(
  app: Awaited<ReturnType<typeof boot>>['app'],
  key: string,
  ref: string,
  sent: Record<string, unknown> = {},
): Promise<Response> {
  return await send(app, `/api/tickets/${ref}/claim/takeover`, body('POST', bearer(key), sent));
}

/** A run started on a ticket. */
async function started(
  app: Awaited<ReturnType<typeof boot>>['app'],
  key: string,
  ref: string,
  sent: Record<string, unknown> = {},
): Promise<Response> {
  return await send(app, `/api/tickets/${ref}/runs`, body('POST', bearer(key), sent));
}

/** What a run reports about itself while it works. */
async function reported(
  app: Awaited<ReturnType<typeof boot>>['app'],
  key: string,
  ref: string,
  runId: string,
  sent: Record<string, unknown>,
): Promise<Response> {
  return await send(app, `/api/tickets/${ref}/runs/${runId}`, body('PATCH', bearer(key), sent));
}

/** A run brought to an end, with whatever it made. */
async function ended(
  app: Awaited<ReturnType<typeof boot>>['app'],
  key: string,
  ref: string,
  runId: string,
  sent: Record<string, unknown> = {},
): Promise<Response> {
  return await send(app, `/api/tickets/${ref}/runs/${runId}/end`, body('POST', bearer(key), sent));
}

/** A person's verdict on what a run made. */
async function judged(
  app: Awaited<ReturnType<typeof boot>>['app'],
  key: string,
  ref: string,
  runId: string,
  sent: Record<string, unknown>,
): Promise<Response> {
  return await send(
    app,
    `/api/tickets/${ref}/runs/${runId}/verdict`,
    body('POST', bearer(key), sent),
  );
}

/** A ticket's band, out of the queue that holds it. */
function bandOf(held: Queue, id: string): string | undefined {
  return held.tickets.find((each) => each.id === id)?.band;
}

describe('a project', () => {
  test('is made with a name and a prefix, and read back in the list', async () => {
    const { app, key } = await signedIn();

    const made = await project(app, key, { name: 'Foundry', prefix: 'FND' });

    expect(made.name).toBe('Foundry');
    expect(made.prefix).toBe('FND');

    const listed = await send(app, '/api/projects', { headers: bearer(key) });

    expect(await listed.json()).toEqual({
      projects: [{ id: made.id, name: 'Foundry', prefix: 'FND' }],
    });
  });

  test('with no tickets answers as a project with no tickets', async () => {
    const { app, key } = await signedIn();
    const made = await project(app, key);

    expect(await queue(app, key, made.id)).toEqual({
      project: { id: made.id, name: 'Foundry', prefix: 'FND' },
      tickets: [],
      counts: { draft: 0, ready: 0, blocked: 0, done: 0, running: 0, 'needs-you': 0 },
    });
  });

  test('is visible to anybody signed in, because a project is shared work', async () => {
    const made = await server();
    const ada = await made.add();
    const grace = await made.add('grace@company.example');

    await project(made.app, ada.key, { name: 'Foundry', prefix: 'FND' });

    const listed = await send(made.app, '/api/projects', { headers: bearer(grace.key) });

    expect((await listed.json()).projects).toHaveLength(1);
  });

  test('has a name, so one with nothing in it is refused', async () => {
    const { app, key } = await signedIn();

    const refused = await send(
      app,
      '/api/projects',
      body('POST', bearer(key), { name: '   ', prefix: 'FND' }),
    );

    expect(refused.status).toBe(400);
    expect((await refused.json()).error.code).toBe('NAME_REQUIRED');
  });

  test.each([
    { prefix: 'FND', why: 'three letters' },
    { prefix: 'AB', why: 'the shortest allowed' },
    { prefix: 'A1B2C3', why: 'the longest allowed, with digits' },
    { prefix: 'fnd', why: 'lowercase, which is written as FND' },
    { prefix: '  FND  ', why: 'padded, which is trimmed' },
  ])('accepts a prefix of $why ($prefix)', async ({ prefix }) => {
    const { app, key } = await signedIn();

    expect((await project(app, key, { prefix })).prefix).toBe(prefix.trim().toUpperCase());
  });

  test.each([
    { prefix: '', why: 'empty' },
    { prefix: 'A', why: 'one character' },
    { prefix: 'ABCDEFG', why: 'seven characters' },
    { prefix: '1AB', why: 'starting with a digit' },
    { prefix: 'F-ND', why: 'holding a hyphen' },
    { prefix: 'F ND', why: 'holding a space' },
    { prefix: 'F_ND', why: 'holding an underscore' },
  ])('refuses a prefix of $why ($prefix)', async ({ prefix }) => {
    const { app, key } = await signedIn();

    const refused = await send(
      app,
      '/api/projects',
      body('POST', bearer(key), { name: 'Foundry', prefix }),
    );

    expect(refused.status).toBe(400);
    expect((await refused.json()).error.code).toBe('PREFIX_INVALID');
  });

  test.each(['FND', 'fnd', 'Fnd'])(
    'refuses a prefix another project holds, written %s',
    async (prefix) => {
      const { app, key } = await signedIn();
      await project(app, key, { prefix: 'FND' });

      const refused = await send(
        app,
        '/api/projects',
        body('POST', bearer(key), { name: 'Another', prefix }),
      );

      // One project holds a prefix, whoever is asking: a ticket's name has to mean one
      // thing on the server, not one thing per person.
      expect(refused.status).toBe(409);
      expect((await refused.json()).error.code).toBe('PREFIX_TAKEN');
    },
  );

  test('keeps its prefix, because there is nothing that writes one', async () => {
    const { app, key } = await signedIn();
    const made = await project(app, key, { prefix: 'FND' });

    // Tickets, branches and commit messages are named with a prefix, so changing it
    // would orphan every reference to them. The guarantee is that no route writes a
    // project after it exists — asserted as the absence it is.
    const refused = await send(
      app,
      `/api/projects/${made.id}`,
      body('PATCH', bearer(key), { prefix: 'OTHER' }),
    );

    expect(refused.status).toBe(404);
    expect((await queue(app, key, made.id)).project.prefix).toBe('FND');
  });
});

describe('a ticket', () => {
  test('keeps the shaping chat link on the ticket and returns it on reads', async () => {
    const { app, key } = await signedIn();
    const made = await project(app, key);

    const written = await drafted(app, key, made.id, { sourceChatId: 'shaping-chat-1' });
    expect(written.sourceChatId).toBe('shaping-chat-1');

    const reread = await read(app, key, written.id);
    expect(reread.status).toBe(200);
    expect((await reread.json()).ticket.sourceChatId).toBe('shaping-chat-1');

    const listed = await queue(app, key, made.id);
    expect(listed.tickets.find((ticket) => ticket.id === written.id)?.sourceChatId).toBe(
      'shaping-chat-1',
    );
  });

  test('is written as a draft, and read back as the same ticket', async () => {
    const { app, key } = await signedIn();
    const made = await project(app, key);

    const written = await drafted(app, key, made.id, {
      kind: 'bug',
      title: 'The queue forgets a rank',
      body: 'A rank is written and the queue reads it back.',
      criteria: ['Reordering survives a reload', 'A closed ticket keeps its rank'],
    });

    expect(written).toMatchObject({
      projectId: made.id,
      name: 'FND-1',
      number: 1,
      kind: 'bug',
      title: 'The queue forgets a rank',
      body: 'A rank is written and the queue reads it back.',
      criteria: ['Reordering survives a reload', 'A closed ticket keeps its rank'],
      gate: 'draft',
      band: 'draft',
      author: { id: written.author?.id, name: 'Ada Lovelace' },
      gates: [],
      children: [],
      closedAt: null,
      closure: null,
    });

    // By its id and by the name people say: a name in a chat has to be openable.
    const byId = await read(app, key, written.id);
    const byName = await read(app, key, 'FND-1');

    expect((await byId.json()).ticket).toEqual(written);
    expect((await byName.json()).ticket).toEqual(written);
  });

  test('is written with nothing in it, because capturing an idea owes nothing', async () => {
    const { app, key } = await signedIn();
    const made = await project(app, key);

    const written = await drafted(app, key, made.id, { title: '', body: '', criteria: [] });

    expect(written.gate).toBe('draft');
    expect(written.title).toBe('');
    expect(written.criteria).toEqual([]);
  });

  test.each(['prototype', 'bug', 'feature', 'refactor', 'question', 'research', 'spec', 'map'])(
    'takes %s as a kind',
    async (kind) => {
      const { app, key } = await signedIn();
      const made = await project(app, key);

      expect((await drafted(app, key, made.id, { kind })).kind).toBe(kind);
    },
  );

  test('refuses a kind that is not one of the eight', async () => {
    const { app, key } = await signedIn();
    const made = await project(app, key);

    const refused = await send(
      app,
      `/api/projects/${made.id}/tickets`,
      body('POST', bearer(key), { kind: 'epic', title: 'A tree', body: '', criteria: [] }),
    );

    expect(refused.status).toBe(400);
    expect((await refused.json()).error.code).toBe('KIND_UNKNOWN');
    expect((await queue(app, key, made.id)).tickets).toEqual([]);
  });

  test('an empty spec is blocked after it is marked ready', async () => {
    const { app, key } = await signedIn();
    const made = await project(app, key);
    const written = await drafted(app, key, made.id, { kind: 'spec' });

    const readied = await wrote(app, key, written.id, { gate: 'ready-for-agent' });

    expect(readied.status).toBe(200);
    expect((await readied.json()).ticket).toMatchObject({
      kind: 'spec',
      gate: 'ready-for-agent',
      children: [],
      band: 'blocked',
    });
  });

  test('migrates decision tickets to questions without changing their fields or links', async () => {
    const { app, key, database } = await signedIn();
    const made = await project(app, key);
    const written = await drafted(app, key, made.id, {
      title: 'A durable choice',
      body: 'The old kind must keep its contract.',
      criteria: ['The migration changes only the kind'],
    });
    const gateOn = await drafted(app, key, made.id, { title: 'The chosen slice' });
    const linked = await send(
      app,
      `/api/tickets/${written.id}/gates`,
      body('POST', bearer(key), { gatedBy: gateOn.id }),
    );
    expect(linked.status).toBe(200);

    await database.update(ticketRow).set({ kind: 'decision' }).where(eq(ticketRow.id, written.id));
    const [before] = await database.select().from(ticketRow).where(eq(ticketRow.id, written.id));
    if (before === undefined) throw new Error('the ticket was not written');

    // Boot has already applied the current migrations. Rewind the schema and journal
    // through 0013 so this test can exercise 0009 against a row shaped like an older
    // installation, then restore every migration in the cumulative history. Removing
    // all later rows matters: Drizzle applies the entries after the newest recorded row,
    // so leaving 0010-0012 recorded would skip 0009 entirely.
    await database.$client.query('ALTER TABLE "ticket" DROP COLUMN IF EXISTS "sourceChatId"');
    await database.$client.query('DROP TABLE IF EXISTS glossary_history CASCADE');
    await database.$client.query('DROP TABLE IF EXISTS glossary_entry CASCADE');
    await database.$client.query('DROP TABLE IF EXISTS outcome CASCADE');
    await database.$client.query('DROP TABLE IF EXISTS decision CASCADE');
    await database.$client.query(
      'DELETE FROM drizzle.__drizzle_migrations WHERE hash IN ($1, $2, $3, $4, $5)',
      [
        '7b218fb9233736fb51d9dd946e2551cc909b394db2c4edcae73e8a8ff78e12dd',
        'b6b9616c92307a15412fbd0d2fed91b52594cbf315cdf69ece366005b96b3545',
        'efb0a60a30a3d368edfd3896cdfaedd7ed36c492ce34814ee12a8dda8064cd0e',
        'dba709b6c7143f78c2334a33a657c57f56936ce2914ea88a6723536ffe14187f',
        '7ae2c56e8448cbe9725084311bf1b257542801b652a98dea042d1dc15a316e0a',
      ],
    );
    await migrate(database);

    const [after] = await database.select().from(ticketRow).where(eq(ticketRow.id, written.id));
    expect(after).toEqual({ ...before, kind: 'question' });
    const answer = (await (await read(app, key, written.id)).json()).ticket as Ticket;
    expect(answer).toMatchObject({
      projectId: made.id,
      kind: 'question',
      children: [{ id: gateOn.id }],
    });
  });

  test('question work is one author-owned linked chat, and approval closes it with an Outcome', async () => {
    const made = await server();
    const ada = await made.add();
    const bob = await made.add('bob@company.example');
    const projectMade = await project(made.app, ada.key);
    const question = await drafted(made.app, ada.key, projectMade.id, { kind: 'question' });
    expect((await wrote(made.app, ada.key, question.id, { gate: 'ready-for-human' })).status).toBe(
      200,
    );

    const refused = await send(
      made.app,
      `/api/tickets/${question.id}/question-chat`,
      body('POST', bearer(bob.key), { chatId: 'not-bob-question' }),
    );
    expect(refused.status).toBe(403);
    expect((await refused.json()).error.code).toBe('QUESTION_NOT_YOURS');

    const opened = await send(
      made.app,
      `/api/tickets/${question.id}/question-chat`,
      body('POST', bearer(ada.key), { chatId: 'question-chat-1' }),
    );
    expect(opened.status).toBe(200);
    expect((await opened.json()).ticket).toMatchObject({
      sourceChatId: 'question-chat-1',
      band: 'needs-you',
      claim: null,
      runs: [],
    });
    const resumed = await send(
      made.app,
      `/api/tickets/${question.id}/question-chat`,
      body('POST', bearer(ada.key), { chatId: 'a-different-chat' }),
    );
    expect((await resumed.json()).ticket.sourceChatId).toBe('question-chat-1');

    const approved = await send(
      made.app,
      `/api/tickets/${question.id}/outcome/approve`,
      body('POST', bearer(ada.key), {
        answer: 'Use the existing tracker seam.',
        sources: ['https://example.com/tracker'],
        sourceChatId: 'question-chat-1',
        decisionProposal: {
          context: 'A durable tracker rule is needed.',
          choice: 'Keep approval in the person-facing path.',
          rejectedOptions: ['Let Kira publish directly.'],
          consequences: 'The proposal remains pending until approved.',
          supersedes: null,
        },
      }),
    );
    expect(approved.status).toBe(200);
    expect((await approved.json()).outcome).toMatchObject({
      ticketId: question.id,
      answer: 'Use the existing tracker seam.',
      sources: ['https://example.com/tracker'],
    });
    expect((await (await read(made.app, ada.key, question.id)).json()).ticket).toMatchObject({
      band: 'done',
      closure: 'done',
      outcome: { answer: 'Use the existing tracker seam.' },
    });
    expect(await made.database.select().from(decision)).toEqual([]);
    expect(
      (await send(made.app, `/api/tickets/${question.id}/outcome`, { headers: bearer(ada.key) }))
        .status,
    ).toBe(200);
  });

  test.each(['question', 'research'])(
    'refuses closing a %s without an approved Outcome',
    async (kind) => {
      const { app, key } = await signedIn();
      const made = await project(app, key);
      const ticket = await drafted(app, key, made.id, { kind });
      const refused = await wrote(app, key, ticket.id, { closure: 'done' });

      expect(refused.status).toBe(400);
      expect((await refused.json()).error).toMatchObject({ code: 'OUTCOME_REQUIRED' });
    },
  );

  test('research records its answer and sources and closes without a person steering it', async () => {
    const { app, key } = await signedIn();
    const made = await project(app, key);
    const research = await drafted(app, key, made.id, { kind: 'research' });
    const recorded = await send(
      app,
      `/api/tickets/${research.id}/outcome`,
      body('POST', bearer(key), {
        answer: 'The server owns the queue.',
        sources: ['https://example.com/queue'],
      }),
    );

    expect(recorded.status).toBe(200);
    expect((await (await read(app, key, research.id)).json()).ticket).toMatchObject({
      band: 'done',
      outcome: {
        answer: 'The server owns the queue.',
        sources: ['https://example.com/queue'],
      },
    });
    const outcomeRead = await send(app, `/api/tickets/${research.id}/outcome`, {
      headers: bearer(key),
    });
    expect((await outcomeRead.json()).outcome.answer).toBe('The server owns the queue.');
  });

  test('an approved map stays blocked on child Outcomes, then closes with its destination spec atomically', async () => {
    const made = await server();
    const ada = await made.add();
    const projectMade = await project(made.app, ada.key);
    const approved = await send(
      made.app,
      `/api/projects/${projectMade.id}/maps`,
      body('POST', bearer(ada.key), {
        title: 'Scale the workspace',
        body: 'Break a large idea into evidence before choosing its destination.',
        criteria: ['The map has a destination spec.'],
        sourceChatId: 'map-chat-1',
        questions: [
          {
            title: 'Which users matter first?',
            body: 'Settle the first audience.',
            criteria: ['The audience is named.'],
          },
        ],
        research: [
          {
            title: 'Check the existing constraints',
            body: 'Research the current system.',
            criteria: ['The constraints are cited.'],
          },
        ],
      }),
    );
    expect(approved.status).toBe(200);
    const map = (await approved.json()).ticket as Ticket & {
      decisionsSoFar: unknown[];
    };
    expect(map).toMatchObject({ kind: 'map', band: 'blocked', closure: null });
    expect(map.children).toHaveLength(2);
    expect(map.decisionsSoFar).toEqual([]);

    const refusedBeforeChildrenAreDone = await send(
      made.app,
      `/api/tickets/${map.id}/destination-spec`,
      body('POST', bearer(ada.key), {
        title: 'Premature destination',
        body: 'This proposal must not close the map.',
        criteria: ['The children are done.'],
        sourceChatId: 'map-chat-1',
      }),
    );
    expect(refusedBeforeChildrenAreDone.status).toBe(400);
    expect((await refusedBeforeChildrenAreDone.json()).error.code).toBe('MAP_CHILDREN_OPEN');
    expect((await (await read(made.app, ada.key, map.id)).json()).ticket).toMatchObject({
      band: 'blocked',
      closure: null,
    });

    const children = map.children;
    const questionId = children[0]!.id;
    const researchId = children[1]!.id;
    await wrote(made.app, ada.key, questionId, { gate: 'ready-for-human' });
    await send(
      made.app,
      `/api/tickets/${questionId}/question-chat`,
      body('POST', bearer(ada.key), { chatId: 'map-question-chat' }),
    );
    const questionOutcome = await send(
      made.app,
      `/api/tickets/${questionId}/outcome/approve`,
      body('POST', bearer(ada.key), {
        answer: 'Start with workspace owners.',
        sources: ['https://example.com/audience'],
        sourceChatId: 'map-question-chat',
      }),
    );
    expect(questionOutcome.status).toBe(200);
    const researchOutcome = await send(
      made.app,
      `/api/tickets/${researchId}/outcome`,
      body('POST', bearer(ada.key), {
        answer: 'The current tracker already owns the queue.',
        sources: ['https://example.com/constraints'],
      }),
    );
    expect(researchOutcome.status).toBe(200);

    const clear = (await (await read(made.app, ada.key, map.id)).json()).ticket as Ticket & {
      decisionsSoFar: { answer: string }[];
    };
    expect(clear).toMatchObject({
      band: 'needs-you',
      decisionsSoFar: [
        { answer: 'Start with workspace owners.' },
        { answer: 'The current tracker already owns the queue.' },
      ],
    });

    const destination = await send(
      made.app,
      `/api/tickets/${map.id}/destination-spec`,
      body('POST', bearer(ada.key), {
        title: 'Build the workspace owner experience',
        body: 'The approved destination spec.',
        criteria: ['The spec is broken into slices.'],
        sourceChatId: 'map-chat-1',
      }),
    );
    expect(destination.status).toBe(200);
    const spec = (await destination.json()).ticket as Ticket;
    expect(spec).toMatchObject({ kind: 'spec', gate: 'ready-for-agent', band: 'blocked' });
    const closed = (await (await read(made.app, ada.key, map.id)).json()).ticket as Ticket;
    expect(closed).toMatchObject({
      band: 'done',
      closure: 'done',
      children: [
        { id: questionId, closed: true },
        { id: researchId, closed: true },
        { id: spec.id, closed: false },
      ],
    });

    const directClose = await wrote(made.app, ada.key, map.id, { closure: 'done' });
    expect(directClose.status).toBe(400);
    expect((await directClose.json()).error.code).toBe('MAP_DESTINATION_REQUIRED');
  });

  test('a question Outcome needs the linked chat and cannot be approved by another person', async () => {
    const made = await server();
    const ada = await made.add();
    const bob = await made.add('bob@company.example');
    const projectMade = await project(made.app, ada.key);
    const question = await drafted(made.app, ada.key, projectMade.id, { kind: 'question' });
    await wrote(made.app, ada.key, question.id, { gate: 'ready-for-human' });
    await send(
      made.app,
      `/api/tickets/${question.id}/question-chat`,
      body('POST', bearer(ada.key), { chatId: 'question-chat-2' }),
    );

    const refused = await send(
      made.app,
      `/api/tickets/${question.id}/outcome/approve`,
      body('POST', bearer(bob.key), {
        answer: 'No.',
        sources: ['https://example.com/no'],
        sourceChatId: 'question-chat-2',
      }),
    );
    expect(refused.status).toBe(403);
    expect((await refused.json()).error.code).toBe('OUTCOME_NOT_YOURS');
  });

  test('keeps the kind it was written with', async () => {
    const { app, key } = await signedIn();
    const made = await project(app, key);
    const written = await drafted(app, key, made.id, { kind: 'bug' });

    // The write carries no kind at all: it decides what a run of the ticket owes
    // (ADR 0011), so changing it would change what a closed run was asked for. A
    // ticket written as the wrong kind is closed and written again.
    const answered = await wrote(app, key, written.id, { kind: 'feature', title: 'Still a bug' });

    expect(answered.status).toBe(200);
    expect((await answered.json()).ticket).toMatchObject({ kind: 'bug', title: 'Still a bug' });
  });

  test('is numbered within its project, and its number is never drawn twice', async () => {
    const { app, key } = await signedIn();
    const first = await project(app, key, { prefix: 'FND' });
    const second = await project(app, key, { prefix: 'OTH', name: 'Other' });

    expect((await drafted(app, key, first.id)).name).toBe('FND-1');
    expect((await drafted(app, key, first.id)).name).toBe('FND-2');
    expect((await drafted(app, key, second.id)).name).toBe('OTH-1');
  });

  test('gets a number even when several are written at the same moment', async () => {
    const { app, key } = await signedIn();
    const made = await project(app, key);

    // A uniqueness error is not something a person writing a ticket can act on, so
    // the allocation is retried inside the server rather than surfaced: all of these
    // succeed and no two share a number.
    const written = await Promise.all(Array.from({ length: 8 }, () => drafted(app, key, made.id)));

    expect([...new Set(written.map((each) => each.number))]).toHaveLength(8);
  });

  test('says who wrote it, and outlives them', async () => {
    const shared = await server();
    const author = await shared.add();
    const other = await shared.add('grace@company.example');
    const made = await project(shared.app, author.key);
    const written = await drafted(shared.app, author.key, made.id);

    expect(written.author?.name).toBe('Ada Lovelace');

    // Removing a person is not a route — this reaches the database because the
    // cascade is a fact about the schema, and the fact being asserted is that
    // shared work does not cascade with the person who wrote it. The usage ledger
    // does; a project and its tickets do not.
    await shared.database.delete(person).where(eq(person.id, author.id));

    // Read by somebody else, because the person's own key went with them.
    const after = await queue(shared.app, other.key, made.id);

    expect(after.project).toEqual({ id: made.id, name: 'Foundry', prefix: 'FND' });
    expect(after.tickets).toHaveLength(1);
    expect(after.tickets[0]?.author).toBeNull();
  });

  test('is corrected, and the correction is what the next read answers', async () => {
    const { app, key } = await signedIn();
    const made = await project(app, key);
    const written = await drafted(app, key, made.id);

    const answered = await wrote(app, key, written.id, {
      title: 'Say how it is known to be done',
      body: 'A contract is a thing people get wrong the first time.',
      criteria: ['One line at a time'],
    });

    expect(answered.status).toBe(200);
    expect((await answered.json()).ticket).toMatchObject({
      title: 'Say how it is known to be done',
      body: 'A contract is a thing people get wrong the first time.',
      criteria: ['One line at a time'],
    });
    expect((await (await read(app, key, written.id)).json()).ticket.title).toBe(
      'Say how it is known to be done',
    );
  });

  test('has a name its project gives it, and a name that is not one is not a ticket', async () => {
    const { app, key } = await signedIn();
    const made = await project(app, key);
    await drafted(app, key, made.id);

    expect((await read(app, key, 'OTH-1')).status).toBe(404);
    expect((await read(app, key, 'FND-99')).status).toBe(404);
    expect((await (await read(app, key, 'FND-99')).json()).error.code).toBe('TICKET_NOT_FOUND');
  });

  test('cannot be written into a project that does not exist', async () => {
    const { app, key } = await signedIn();

    const refused = await send(
      app,
      '/api/projects/11111111-1111-1111-1111-111111111111/tickets',
      body('POST', bearer(key), { kind: 'feature', title: '', body: '', criteria: [] }),
    );

    expect(refused.status).toBe(404);
    expect((await refused.json()).error.code).toBe('PROJECT_NOT_FOUND');
  });

  test('refuses every way of not being signed in, in its own words', async () => {
    const { app, key, database, person: author } = await signedIn();
    const made = await project(app, key);
    await drafted(app, key, made.id);

    const noKey = await send(app, `/api/projects/${made.id}`);
    const unknownKey = await send(app, `/api/projects/${made.id}`, {
      headers: bearer('not-a-key'),
    });

    await database.delete(person).where(eq(person.id, author.id));
    const goneKey = await send(app, `/api/projects/${made.id}`, { headers: bearer(key) });

    const said = {
      no: await noKey.json(),
      unknown: await unknownKey.json(),
      gone: await goneKey.json(),
    };

    for (const refused of [noKey, unknownKey, goneKey]) {
      expect(refused.status).toBe(401);
    }

    for (const words of [said.no, said.unknown, said.gone]) {
      // An empty queue is what "this project has no work" looks like, so a broken
      // sign-in must never be answered as one. Each of the three says its own thing
      // about why it is not answering.
      expect(words.error.message.length).toBeGreaterThan(0);
    }

    expect(
      new Set([said.no.error.message, said.unknown.error.message, said.gone.error.message]).size,
    ).toBe(3);
    expect(said.no.error.code).toBe('KEY_NOT_FOUND');
    expect(said.unknown.error.code).toBe('INVALID_API_KEY');
    expect(said.gone.error.code).toBe('KEY_NOT_FOUND');
    expect(said.gone.error.message).toContain('gone');
  });
});

/** The ways a contract can say nothing about how it is known to be done. */
const SAYS_NOTHING: { criteria: string[]; why: string }[] = [
  { criteria: [], why: 'no criteria at all' },
  { criteria: [''], why: 'one empty criterion' },
  { criteria: ['   ', '\t'], why: 'criteria that are only whitespace' },
];

describe('the gate a ticket is at', () => {
  test.each(['ready-for-agent', 'ready-for-human'])(
    'is opened to %s from a draft',
    async (gate) => {
      const { app, key } = await signedIn();
      const made = await project(app, key);
      const written = await drafted(app, key, made.id);

      const answered = await wrote(app, key, written.id, { gate });

      expect(answered.status).toBe(200);
      expect((await answered.json()).ticket.gate).toBe(gate);
      expect(bandOf(await queue(app, key, made.id), written.id)).toBe('ready');
    },
  );

  test.each(SAYS_NOTHING)(
    'is refused for an agent with $why, and the refusal names the rule',
    async ({ criteria }) => {
      const { app, key } = await signedIn();
      const made = await project(app, key);
      const written = await drafted(app, key, made.id, { criteria });

      const refused = await wrote(app, key, written.id, { gate: 'ready-for-agent' });

      expect(refused.status).toBe(400);
      expect(await refused.json()).toEqual({
        error: {
          code: 'CRITERIA_REQUIRED',
          message: 'A ticket an agent runs has to say how it is known to be done.',
        },
      });

      // Nothing was written: a refused gate is not a half-opened one.
      expect((await (await read(app, key, written.id)).json()).ticket).toMatchObject({
        gate: 'draft',
        criteria,
      });
    },
  );

  test('is opened for a person with no criteria, because a person can be asked', async () => {
    const { app, key } = await signedIn();
    const made = await project(app, key);
    const written = await drafted(app, key, made.id, { criteria: [] });

    expect((await wrote(app, key, written.id, { gate: 'ready-for-human' })).status).toBe(200);
  });

  test('is refused when the write would take away the last criterion of a ticket an agent runs', async () => {
    const { app, key } = await signedIn();
    const made = await project(app, key);
    const written = await drafted(app, key, made.id, { criteria: ['Only one'] });
    await wrote(app, key, written.id, { gate: 'ready-for-agent' });

    // The rule is checked against the ticket as it would be after the write, not
    // only on the transition that opens the gate — otherwise a contract handed to an
    // agent could be hollowed out one write at a time.
    const refused = await wrote(app, key, written.id, { criteria: [] });

    expect(refused.status).toBe(400);
    expect((await refused.json()).error.code).toBe('CRITERIA_REQUIRED');
    expect((await (await read(app, key, written.id)).json()).ticket).toMatchObject({
      gate: 'ready-for-agent',
      criteria: ['Only one'],
    });

    const blanked = await wrote(app, key, written.id, { criteria: ['  '] });

    expect(blanked.status).toBe(400);
    expect((await (await read(app, key, written.id)).json()).ticket.criteria).toEqual(['Only one']);
  });

  test('goes back to being a draft, and its criteria may go then', async () => {
    const { app, key } = await signedIn();
    const made = await project(app, key);
    const written = await drafted(app, key, made.id, { criteria: ['Only one'] });
    await wrote(app, key, written.id, { gate: 'ready-for-agent' });

    expect((await wrote(app, key, written.id, { gate: 'draft' })).status).toBe(200);
    expect((await wrote(app, key, written.id, { criteria: [] })).status).toBe(200);
    expect(bandOf(await queue(app, key, made.id), written.id)).toBe('draft');
  });

  test.each(['draft', 'ready-for-agent', 'ready-for-human'])(
    'is closed with either reason from %s',
    async (gate) => {
      const { app, key } = await signedIn();
      const made = await project(app, key);
      const written = await drafted(app, key, made.id);
      if (gate !== 'draft') await wrote(app, key, written.id, { gate });

      const closed = await wrote(app, key, written.id, { closure: 'wontfix' });

      expect(closed.status).toBe(200);
      expect((await closed.json()).ticket).toMatchObject({
        closure: 'wontfix',
        gate,
        closedAt: expect.any(String),
      });
      expect(bandOf(await queue(app, key, made.id), written.id)).toBe('done');
    },
  );

  test('refuses a closure that is not one of the two reasons', async () => {
    const { app, key } = await signedIn();
    const made = await project(app, key);
    const written = await drafted(app, key, made.id);

    const refused = await wrote(app, key, written.id, { closure: 'abandoned' });

    expect(refused.status).toBe(400);
    expect((await refused.json()).error.code).toBe('CLOSURE_UNKNOWN');
    expect((await (await read(app, key, written.id)).json()).ticket.closedAt).toBeNull();
  });
});

describe('the queue a project answers', () => {
  test.each([
    { why: 'a draft', written: {}, closed: null, gate: null, want: 'draft' },
    { why: 'a closed draft', written: {}, closed: 'wontfix', gate: null, want: 'done' },
    {
      why: 'a ticket an agent may run',
      written: {},
      closed: null,
      gate: 'ready-for-agent',
      want: 'ready',
    },
    {
      why: 'a ticket a person may pick up',
      written: {},
      closed: null,
      gate: 'ready-for-human',
      want: 'ready',
    },
  ])('bands $why as $want', async ({ written, closed, gate, want }) => {
    const { app, key } = await signedIn();
    const made = await project(app, key);
    const ticket = await drafted(app, key, made.id, written);
    if (gate !== null) await wrote(app, key, ticket.id, { gate });
    if (closed !== null) await wrote(app, key, ticket.id, { closure: closed });

    expect(bandOf(await queue(app, key, made.id), ticket.id)).toBe(want);
  });

  test('counts every band, drafts included', async () => {
    const { app, key } = await signedIn();
    const made = await project(app, key);

    const draft = await drafted(app, key, made.id);
    const ready = await drafted(app, key, made.id);
    await wrote(app, key, ready.id, { gate: 'ready-for-agent' });
    const blocked = await drafted(app, key, made.id);
    await wrote(app, key, blocked.id, { gate: 'ready-for-agent' });
    const done = await drafted(app, key, made.id);
    await wrote(app, key, done.id, { closure: 'done' });

    // Gated by a ticket that is still open, which is what keeps it out of the
    // frontier — a gate closed as `done` would have released it.
    const gate = await send(
      app,
      `/api/tickets/${blocked.id}/gates`,
      body('POST', bearer(key), { gatedBy: draft.id }),
    );

    expect(gate.status).toBe(200);

    const held = await queue(app, key, made.id);

    // Six bands and no others, because every one of them can hold something.
    expect(Object.keys(held.counts).sort()).toEqual([
      'blocked',
      'done',
      'draft',
      'needs-you',
      'ready',
      'running',
    ]);
    expect(held.counts).toEqual({
      draft: 1,
      ready: 1,
      blocked: 1,
      done: 1,
      running: 0,
      'needs-you': 0,
    });
  });

  test('answers what gates a ticket and what it gates, from one relation', async () => {
    const { app, key } = await signedIn();
    const made = await project(app, key);
    const slice = await drafted(app, key, made.id, { title: 'A slice' });
    const parent = await drafted(app, key, made.id, { title: 'The whole' });
    await wrote(app, key, parent.id, { gate: 'ready-for-agent' });
    await wrote(app, key, slice.id, { gate: 'ready-for-agent' });

    // The parent names its slices as its gates, so the parent is the one held out of
    // the frontier: child blocks parent, and there is no parent column anywhere.
    await send(
      app,
      `/api/tickets/${parent.id}/gates`,
      body('POST', bearer(key), { gatedBy: slice.id }),
    );

    const whole = await read(app, key, parent.id);
    const part = await read(app, key, slice.id);
    const asWhole = (await whole.json()).ticket as Ticket;
    const asPart = (await part.json()).ticket as Ticket;

    expect(asWhole.children).toEqual([
      { id: slice.id, name: 'FND-1', closed: false, closure: null },
    ]);
    expect(asWhole.gates).toEqual([]);
    expect(asPart.gates).toEqual([{ id: parent.id, name: 'FND-2', closed: false, closure: null }]);
    expect(asPart.children).toEqual([]);

    expect(bandOf(await queue(app, key, made.id), parent.id)).toBe('blocked');
    expect(bandOf(await queue(app, key, made.id), slice.id)).toBe('ready');
  });

  test('holds a parent back until its last slice is closed, then lets it through', async () => {
    const { app, key } = await signedIn();
    const made = await project(app, key);
    const parent = await drafted(app, key, made.id, { title: 'The whole' });
    await wrote(app, key, parent.id, { gate: 'ready-for-agent' });

    const slices = [
      await drafted(app, key, made.id, { title: 'First' }),
      await drafted(app, key, made.id, { title: 'Second' }),
      await drafted(app, key, made.id, { title: 'Third' }),
    ];
    for (const slice of slices) {
      await send(
        app,
        `/api/tickets/${parent.id}/gates`,
        body('POST', bearer(key), { gatedBy: slice.id }),
      );
    }

    await wrote(app, key, slices[0]!.id, { closure: 'done' });

    const one = await queue(app, key, made.id);

    expect(bandOf(one, parent.id)).toBe('blocked');
    expect(
      one.tickets.find((each) => each.id === parent.id)?.children.map((each) => each.closed),
    ).toEqual([true, false, false]);

    await wrote(app, key, slices[1]!.id, { closure: 'done' });
    expect(bandOf(await queue(app, key, made.id), parent.id)).toBe('blocked');

    await wrote(app, key, slices[2]!.id, { closure: 'done' });

    // Nothing gates it any more and it is marked ready, so it is in the frontier —
    // by derivation, with nothing having moved it there.
    expect(bandOf(await queue(app, key, made.id), parent.id)).toBe('ready');
  });

  test('lets a parent through a slice that was abandoned, and says what it lost', async () => {
    const { app, key } = await signedIn();
    const made = await project(app, key);
    const parent = await drafted(app, key, made.id, { title: 'The whole' });
    await wrote(app, key, parent.id, { gate: 'ready-for-agent' });
    const slice = await drafted(app, key, made.id, { title: 'A slice' });
    await send(
      app,
      `/api/tickets/${parent.id}/gates`,
      body('POST', bearer(key), { gatedBy: slice.id }),
    );

    await wrote(app, key, slice.id, { closure: 'wontfix' });

    // `wontfix` has to stay useful, or a slice nobody will ever do holds its parent
    // hostage — so the gate is released, and the parent says it was released by
    // abandoned work rather than reading as though the slice had delivered.
    const held = await queue(app, key, made.id);

    expect(bandOf(held, parent.id)).toBe('ready');
    expect(held.tickets.find((each) => each.id === parent.id)?.children).toEqual([
      { id: slice.id, name: 'FND-2', closed: true, closure: 'wontfix' },
    ]);
  });

  test.each([
    { why: 'itself', gateOn: 'self', code: 'GATE_SELF' },
    { why: 'a ticket in another project', gateOn: 'other', code: 'GATE_OTHER_PROJECT' },
  ])('refuses a gate naming $why, and writes nothing', async ({ gateOn, code }) => {
    const { app, key } = await signedIn();
    const made = await project(app, key);
    const ticket = await drafted(app, key, made.id);
    const other = await project(app, key, { name: 'Other', prefix: 'OTH' });
    const elsewhere = await drafted(app, key, other.id);

    const refused = await send(
      app,
      `/api/tickets/${ticket.id}/gates`,
      body('POST', bearer(key), {
        gatedBy: gateOn === 'self' ? ticket.id : elsewhere.id,
      }),
    );

    expect(refused.status).toBe(400);
    expect((await refused.json()).error.code).toBe(code);
    expect((await (await read(app, key, ticket.id)).json()).ticket.children).toEqual([]);
  });

  test.each([
    { why: 'a two-ticket circle', chain: ['a', 'b'] },
    { why: 'a longer circle', chain: ['a', 'b', 'c'] },
  ])('refuses $why, and writes nothing', async ({ chain }) => {
    const { app, key } = await signedIn();
    const made = await project(app, key);
    const a = await drafted(app, key, made.id, { title: 'A' });
    const b = await drafted(app, key, made.id, { title: 'B' });
    const c = await drafted(app, key, made.id, { title: 'C' });
    const all: Record<string, Ticket> = { a, b, c };

    // A is gated by B is gated by C… and the edge that would close the ring is
    // refused. A circle is not a hard case to get right, it is a queue that can never
    // empty: nothing in it is ever ready.
    for (let at = 0; at < chain.length - 1; at += 1) {
      const gate = await send(
        app,
        `/api/tickets/${all[chain[at]!]!.id}/gates`,
        body('POST', bearer(key), { gatedBy: all[chain[at + 1]!]!.id }),
      );
      expect(gate.status).toBe(200);
    }

    const closing = await send(
      app,
      `/api/tickets/${all[chain[chain.length - 1]!]!.id}/gates`,
      body('POST', bearer(key), { gatedBy: a.id }),
    );

    expect(closing.status).toBe(400);
    expect((await closing.json()).error.code).toBe('GATE_CIRCLE');
    expect((await (await read(app, key, a.id)).json()).ticket.gates).toEqual([]);
  });

  test('removes a gate, and the parent is in the frontier again', async () => {
    const { app, key } = await signedIn();
    const made = await project(app, key);
    const parent = await drafted(app, key, made.id, { title: 'The whole' });
    await wrote(app, key, parent.id, { gate: 'ready-for-agent' });
    const slice = await drafted(app, key, made.id, { title: 'A slice' });
    await send(
      app,
      `/api/tickets/${parent.id}/gates`,
      body('POST', bearer(key), { gatedBy: slice.id }),
    );

    const removed = await send(app, `/api/tickets/${parent.id}/gates/${slice.id}`, {
      method: 'DELETE',
      headers: bearer(key),
    });

    expect(removed.status).toBe(200);
    expect((await removed.json()).ticket.children).toEqual([]);
    expect(bandOf(await queue(app, key, made.id), parent.id)).toBe('ready');
  });

  test('takes the same gate twice as one gate', async () => {
    const { app, key } = await signedIn();
    const made = await project(app, key);
    const parent = await drafted(app, key, made.id, { title: 'The whole' });
    const slice = await drafted(app, key, made.id, { title: 'A slice' });

    for (let twice = 0; twice < 2; twice += 1) {
      const added = await send(
        app,
        `/api/tickets/${parent.id}/gates`,
        body('POST', bearer(key), { gatedBy: slice.id }),
      );
      expect(added.status).toBe(200);
    }

    expect((await (await read(app, key, parent.id)).json()).ticket.children).toHaveLength(1);
  });

  test('orders by rank, and breaks a tie with the ticket’s number', async () => {
    const { app, key } = await signedIn();
    const made = await project(app, key);
    const first = await drafted(app, key, made.id, { title: 'First' });
    const second = await drafted(app, key, made.id, { title: 'Second' });
    const third = await drafted(app, key, made.id, { title: 'Third' });

    expect((await queue(app, key, made.id)).tickets.map((each) => each.number)).toEqual([1, 2, 3]);

    // One rank, written once: the order is total without a second field, and rank 0
    // puts Third ahead of both — lower is earlier, which is what makes a promotion
    // one write rather than a rewrite of the queue.
    expect((await wrote(app, key, third.id, { rank: 0 })).status).toBe(200);

    const reordered = await queue(app, key, made.id);

    expect(reordered.tickets.map((each) => each.number)).toEqual([3, 1, 2]);
    expect(bandOf(reordered, first.id)).toBe('draft');
    expect(bandOf(reordered, second.id)).toBe('draft');
  });

  test('reorders without moving anything between bands', async () => {
    const { app, key } = await signedIn();
    const made = await project(app, key);
    const ready = await drafted(app, key, made.id);
    await wrote(app, key, ready.id, { gate: 'ready-for-agent' });
    const draft = await drafted(app, key, made.id);

    await wrote(app, key, draft.id, { rank: -5 });

    const held = await queue(app, key, made.id);

    expect(held.tickets[0]?.id).toBe(draft.id);
    expect(bandOf(held, draft.id)).toBe('draft');
    expect(bandOf(held, ready.id)).toBe('ready');
  });

  test('answers a project that does not exist as not found rather than empty', async () => {
    const { app, key } = await signedIn();

    const refused = await send(app, '/api/projects/11111111-1111-1111-1111-111111111111', {
      headers: bearer(key),
    });

    expect(refused.status).toBe(404);
    expect((await refused.json()).error.code).toBe('PROJECT_NOT_FOUND');
  });
});

describe('the branch a ticket belongs on', () => {
  test.each([
    { title: 'Add acceptance criteria', want: 'fnd-1-add-acceptance-criteria' },
    { title: 'Fix: the queue’s rank!', want: 'fnd-1-fix-the-queue-s-rank' },
    { title: 'A/B test the “New ticket” form', want: 'fnd-1-a-b-test-the-new-ticket-form' },
    { title: 'Rank — and why it is an integer', want: 'fnd-1-rank-and-why-it-is-an-integer' },
    { title: 'Retry.. the lost write', want: 'fnd-1-retry-the-lost-write' },
    { title: '   ', want: 'fnd-1' },
    { title: '———', want: 'fnd-1' },
    { title: '~^:?*[\\', want: 'fnd-1' },
    { title: 'Close it.lock', want: 'fnd-1-close-it-lock' },
    { title: '-leading dash', want: 'fnd-1-leading-dash' },
    { title: '123', want: 'fnd-1-123' },
    {
      title: 'A very long title that goes on and on about the queue and its bands',
      want: 'fnd-1-a-very-long-title-that-goes-on-and-on',
    },
  ])('turns $title into $want', async ({ title, want }) => {
    const { app, key } = await signedIn();
    const made = await project(app, key);
    const written = await drafted(app, key, made.id, { title });

    expect(written.branch).toBe(want);
    // Whatever a title does, the name is one git takes: no spaces, no `..`, no
    // leading dash, none of `~ ^ : ? * [ \`, and nothing ending in `.lock` or `/`.
    expect(written.branch).toMatch(/^[a-z0-9][a-z0-9._/-]*$/);
    expect(written.branch).not.toMatch(/\.\.|@\{|\/\/|\.lock$|\/$/);
  });

  test('is the ticket’s own name when the title has nothing to slug', async () => {
    const { app, key } = await signedIn();
    const made = await project(app, key, { prefix: 'A1B2C3' });
    const written = await drafted(app, key, made.id, { title: '!!!' });

    expect(written.branch).toBe('a1b2c3-1');
  });

  test('follows a retitle, because it is derived rather than stored', async () => {
    const { app, key } = await signedIn();
    const made = await project(app, key);
    const written = await drafted(app, key, made.id, { title: 'First name' });

    await wrote(app, key, written.id, { title: 'Second name' });

    // The limit this carries is accepted and documented: a branch made before a
    // retitle keeps the name it was made with, because nothing here claims a branch
    // exists. When a run records the branch it made, the ticket shows that instead.
    expect((await (await read(app, key, written.id)).json()).ticket.branch).toBe(
      'fnd-1-second-name',
    );
  });
});

describe('a claim', () => {
  /** A project with one ticket marked ready, which is the only thing claimable. */
  async function readyTicket() {
    const made = await server();
    const ada = await made.add();
    const madeProject = await project(made.app, ada.key);
    const written = await drafted(made.app, ada.key, madeProject.id);
    await wrote(made.app, ada.key, written.id, { gate: 'ready-for-agent' });

    // The desktop the claims below name, because a claim names a machine that exists.
    await offering(made.app, ada.key, 'desk-1');

    return {
      app: made.app,
      database: made.database,
      person: ada,
      project: madeProject,
      ticket: written,
      /** Somebody else on the same server, for the refusals that are about who asks. */
      add: made.add,
    };
  }

  test('is taken on a ready ticket, and says who holds it and since when', async () => {
    const { app, person, ticket } = await readyTicket();

    const answer = await claimed(app, person.key, ticket.id);
    expect(answer.status).toBe(200);

    const held = (await answer.json()).ticket as Ticket;
    expect(held.claim?.holder).toEqual({ id: person.id, name: person.name });
    expect(typeof held.claim?.startedAt).toBe('string');
    expect(held.claim?.workerId).toBeNull();
    expect(held.claim?.stale).toBe(false);
  });

  test('leaves the ticket out of the frontier, and says it is running', async () => {
    const { app, person, project: made, ticket } = await readyTicket();

    await claimed(app, person.key, ticket.id);

    const held = await queue(app, person.key, made.id);
    expect(bandOf(held, ticket.id)).toBe('running');
    expect(held.counts.running).toBe(1);
    expect(held.counts.ready).toBe(0);
  });

  test('is refused for a ticket that is not ready, a ticket already claimed, and somebody else', async () => {
    const { app, person, ticket, project: made, add, database } = await readyTicket();
    const grace = await add('grace@company.example');

    // A draft is not ready, and the refusal is the app's own envelope.
    const early = await drafted(app, person.key, made.id);
    const notReady = await claimed(app, person.key, early.id);
    expect(notReady.status).toBe(400);
    expect((await notReady.json()).error.code).toBe('CLAIM_NOT_READY');

    // Somebody the ticket is not for may not take it, whatever its band.
    const notYours = await claimed(app, grace.key, ticket.id);
    expect(notYours.status).toBe(400);
    expect((await notYours.json()).error.code).toBe('CLAIM_NOT_YOURS');
    expect(bandOf(await queue(app, person.key, made.id), ticket.id)).toBe('ready');

    // The first claim wins and the second is refused.
    expect((await claimed(app, person.key, ticket.id)).status).toBe(200);
    const twice = await claimed(app, person.key, ticket.id);
    expect(twice.status).toBe(400);
    expect((await twice.json()).error.code).toBe('CLAIM_TAKEN');

    // Nothing refused above wrote a claim.
    const rows = await database.select().from(claim).where(eq(claim.ticketId, ticket.id));
    expect(rows).toHaveLength(1);
  });

  test('is refused when it names a desktop that has never offered itself', async () => {
    const { app, person, ticket, database } = await readyTicket();

    const answer = await claimed(app, person.key, ticket.id, { workerId: 'desk-nobody' });
    expect(answer.status).toBe(400);
    expect((await answer.json()).error.code).toBe('CLAIM_NO_WORKER');

    // A claim naming a machine that does not exist is not a claim, so nothing was written.
    const rows = await database.select().from(claim).where(eq(claim.ticketId, ticket.id));
    expect(rows).toHaveLength(0);
  });

  test("is refused when it names a desktop that is somebody else's", async () => {
    const { app, add } = await readyTicket();
    const grace = await add('grace@company.example');

    // Grace has a desktop of her own and a ticket of her own to work on it.
    await offering(app, grace.key, 'desk-grace');
    const hers = await project(app, grace.key, { name: 'Grace', prefix: 'GRC' });
    const written = await drafted(app, grace.key, hers.id);
    await wrote(app, grace.key, written.id, { gate: 'ready-for-agent' });

    // Ada's desktop is not Grace's to work from, whatever her own ticket says.
    const answer = await claimed(app, grace.key, written.id, { workerId: 'desk-1' });
    expect(answer.status).toBe(400);
    expect((await answer.json()).error.code).toBe('CLAIM_WORKER_NOT_YOURS');
  });

  test('moves its lease forward when it is heard from, and answers the claim', async () => {
    const { app, person, ticket, project: made } = await readyTicket();

    const first = (
      await (
        await claimed(app, person.key, ticket.id, { workerId: 'desk-1', leaseSeconds: 60 })
      ).json()
    ).ticket as Ticket;
    const heard1 = await heard(app, person.key, ticket.id, { workerId: 'desk-1' });
    expect(heard1.status).toBe(200);

    const after = (await heard1.json()).ticket as Ticket;
    expect(after.claim?.heardAt).not.toBeNull();
    expect(Date.parse(after.claim!.leaseUntil!)).toBeGreaterThanOrEqual(
      Date.parse(first.claim!.leaseUntil!),
    );

    // A heartbeat on a ticket nobody holds is refused rather than inventing one.
    const loose = await drafted(app, person.key, made.id);
    const none = await heard(app, person.key, loose.id);
    expect(none.status).toBe(400);
    expect((await none.json()).error.code).toBe('CLAIM_NONE');
  });

  test('is let go of by hand, and letting go of one nobody holds is a no-op', async () => {
    const { app, person, ticket, project: made } = await readyTicket();

    await claimed(app, person.key, ticket.id);
    const gone = await released(app, person.key, ticket.id);
    expect(gone.status).toBe(200);
    expect((await gone.json()).ticket.claim).toBeNull();
    expect(bandOf(await queue(app, person.key, made.id), ticket.id)).toBe('ready');

    // Releasing what nobody holds answers the ticket rather than refusing.
    const again = await released(app, person.key, ticket.id);
    expect(again.status).toBe(200);
    expect((await again.json()).ticket.claim).toBeNull();
  });

  test('may be held by a person with no lease and no heartbeat', async () => {
    const { app, person, ticket } = await readyTicket();

    const held = (await (await claimed(app, person.key, ticket.id)).json()).ticket as Ticket;
    expect(held.claim?.workerId).toBeNull();
    expect(held.claim?.leaseUntil).toBeNull();
    expect(held.claim?.heardAt).toBeNull();
    expect(held.claim?.stale).toBe(false);
  });

  test('whose lease has run out is still held, and says how long it has been quiet', async () => {
    const { app, person, ticket, database } = await readyTicket();

    await claimed(app, person.key, ticket.id, { workerId: 'desk-1', leaseSeconds: 60 });

    // A lease that has run out, written where it lives: nothing else can age a claim,
    // and waiting for one to expire would make this test about the clock.
    const longAgo = new Date(Date.now() - 120_000);
    await database
      .update(claim)
      .set({ leaseUntil: longAgo, heardAt: longAgo })
      .where(eq(claim.ticketId, ticket.id));

    const held = (await (await read(app, person.key, ticket.id)).json()).ticket as Ticket;
    expect(held.claim).not.toBeNull();
    expect(held.claim?.stale).toBe(true);
    expect(held.claim?.quietMs).toBeGreaterThanOrEqual(120_000);

    // And it is still theirs: nothing released it on a clock.
    expect(held.claim?.holder.id).toBe(person.id);
    expect(held.band).toBe('running');
  });

  test('is taken over by hand in one request that replaces the holder and nothing else', async () => {
    const { app, person, ticket, database, add } = await readyTicket();
    const grace = await add('grace@company.example');

    await claimed(app, person.key, ticket.id, { workerId: 'desk-1', leaseSeconds: 60 });
    const longAgo = new Date(Date.now() - 120_000);
    await database
      .update(claim)
      .set({ leaseUntil: longAgo, heardAt: longAgo })
      .where(eq(claim.ticketId, ticket.id));

    // A claim that has not gone stale is nobody else's to take.
    const fresh = await drafted(app, person.key, ticket.projectId);
    await wrote(app, person.key, fresh.id, { gate: 'ready-for-agent' });
    await claimed(app, person.key, fresh.id, { workerId: 'desk-1', leaseSeconds: 60 });
    const early = await takenOver(app, grace.key, fresh.id);
    expect(early.status).toBe(400);
    expect((await early.json()).error.code).toBe('CLAIM_NOT_STALE');

    const answer = await takenOver(app, grace.key, ticket.id);
    expect(answer.status).toBe(200);

    const held = (await answer.json()).ticket as Ticket;
    expect(held.claim?.holder).toEqual({ id: grace.id, name: grace.name });
    expect(held.claim?.workerId).toBeNull();
    expect(held.claim?.stale).toBe(false);
    expect(held.band).toBe('running');

    // One claim, replaced rather than added to.
    const rows = await database.select().from(claim).where(eq(claim.ticketId, ticket.id));
    expect(rows).toHaveLength(1);
  });

  test('is taken by exactly one of two workers claiming at the same instant', async () => {
    const { app, person, ticket, database } = await readyTicket();

    const [first, second] = await Promise.all([
      claimed(app, person.key, ticket.id, { workerId: 'desk-1', leaseSeconds: 60 }),
      claimed(app, person.key, ticket.id, { workerId: 'desk-2', leaseSeconds: 60 }),
    ]);

    expect([first.status, second.status].sort()).toEqual([200, 400]);
    const rows = await database.select().from(claim).where(eq(claim.ticketId, ticket.id));
    expect(rows).toHaveLength(1);
  });

  test('does not outlive its ticket', async () => {
    const { app, person, ticket, database } = await readyTicket();

    await claimed(app, person.key, ticket.id);
    // Deleting the ticket directly, because nothing in the app deletes one: this is
    // the schema's own promise that a claim has nothing to be about once it is gone.
    await database.delete(ticketRow).where(eq(ticketRow.id, ticket.id));

    expect(await database.select().from(claim)).toHaveLength(0);
  });
});

describe('a run', () => {
  /** A project with one ready ticket, claimed by its author, ready to be run. */
  async function claimedTicket(leaseSeconds = 60) {
    const made = await server();
    const ada = await made.add();
    const madeProject = await project(made.app, ada.key);
    const written = await drafted(made.app, ada.key, madeProject.id);
    await wrote(made.app, ada.key, written.id, { gate: 'ready-for-agent' });

    // The desktop this run is driven from, offered before it claims anything.
    await offering(made.app, ada.key, 'desk-1');

    const taken = await send(
      made.app,
      `/api/tickets/${written.id}/claim`,
      body('POST', bearer(ada.key), { workerId: 'desk-1', leaseSeconds }),
    );
    if (taken.status !== 200) throw new Error(`not claimed: ${await taken.text()}`);

    return {
      app: made.app,
      database: made.database,
      person: ada,
      project: madeProject,
      ticket: written,
      add: made.add,
    };
  }

  test('starts on a claimed ticket, and says its ticket, its worker and when it started', async () => {
    const { app, person, ticket } = await claimedTicket();

    const answer = await started(app, person.key, ticket.id, { workerId: 'desk-1' });
    expect(answer.status).toBe(200);

    const made = (await answer.json()).run as Run;
    expect(made.ticketId).toBe(ticket.id);
    expect(made.workerId).toBe('desk-1');
    expect(typeof made.startedAt).toBe('string');
    expect(made.endedAt).toBeNull();
    expect(made.verdict).toBeNull();
  });

  test('is refused on a ticket nobody holds, and on one somebody else holds', async () => {
    const { app, person, project: made, add } = await claimedTicket();
    const grace = await add('grace@company.example');

    const loose = await drafted(app, person.key, made.id);
    await wrote(app, person.key, loose.id, { gate: 'ready-for-agent' });
    const nobody = await started(app, person.key, loose.id, { workerId: 'desk-1' });
    expect(nobody.status).toBe(400);
    expect((await nobody.json()).error.code).toBe('CLAIM_NONE');

    // Grace holds a claim of her own on a ticket of her own; Ada may not run it.
    const hers = await drafted(app, grace.key, made.id);
    await wrote(app, grace.key, hers.id, { gate: 'ready-for-agent' });
    await offering(app, grace.key, 'desk-2');
    await send(
      app,
      `/api/tickets/${hers.id}/claim`,
      body('POST', bearer(grace.key), { workerId: 'desk-2', leaseSeconds: 60 }),
    );

    const notHers = await started(app, person.key, hers.id, { workerId: 'desk-1' });
    expect(notHers.status).toBe(400);
    expect((await notHers.json()).error.code).toBe('CLAIM_NOT_HOLDER');
  });

  test('records the contract it was given, and a criterion edited afterwards leaves it alone', async () => {
    const { app, person, ticket } = await claimedTicket();
    const before = (await (await read(app, person.key, ticket.id)).json()).ticket as Ticket;

    const made = (await (await started(app, person.key, ticket.id, { workerId: 'desk-1' })).json())
      .run as Run;
    expect(made.contract).toEqual(before.criteria);

    // The contract is a copy, so a criterion rewritten while a run works is a steering
    // decision on the ticket rather than a silent swap under the run's evidence.
    await wrote(app, person.key, ticket.id, { criteria: ['Something else entirely'] });

    const after = (await (await read(app, person.key, ticket.id)).json()).ticket as Ticket;
    expect(after.runs[0]?.contract).toEqual(before.criteria);
    expect(after.criteria).toEqual(['Something else entirely']);
  });

  test('records the branch it made, and accepting outside a spec keeps that branch', async () => {
    const { app, person, ticket } = await claimedTicket();
    const made = (await (await started(app, person.key, ticket.id, { workerId: 'desk-1' })).json())
      .run as Run;

    const derived = (await (await read(app, person.key, ticket.id)).json()).ticket as Ticket;
    expect(derived.branch).toBe('fnd-1-add-acceptance-criteria');

    const said = await reported(app, person.key, ticket.id, made.id, {
      branch: 'fnd-1-a-name-it-was-made-with',
    });
    expect(said.status).toBe(200);
    expect((await said.json()).run.branch).toBe('fnd-1-a-name-it-was-made-with');

    // The branch that exists rather than the one the title would derive: a retitle no
    // longer changes what the ticket says it is on.
    await wrote(app, person.key, ticket.id, { title: 'A new title entirely' });
    const after = (await (await read(app, person.key, ticket.id)).json()).ticket as Ticket;
    expect(after.branch).toBe('fnd-1-a-name-it-was-made-with');

    await ended(app, person.key, ticket.id, made.id, { changed: 'A branch was made.' });
    const accepted = await judged(app, person.key, ticket.id, made.id, { verdict: 'accepted' });
    expect(accepted.status).toBe(200);
    const closed = (await (await read(app, person.key, ticket.id)).json()).ticket as Ticket;
    expect(closed).toMatchObject({
      closure: 'done',
      branch: 'fnd-1-a-name-it-was-made-with',
    });
  });

  test('ends as a proposal carrying what it changed, what it ran and what it made of it', async () => {
    const { app, person, ticket } = await claimedTicket();
    const made = (await (await started(app, person.key, ticket.id, { workerId: 'desk-1' })).json())
      .run as Run;

    const answer = await ended(app, person.key, ticket.id, made.id, {
      changed: 'A claim is a row now.',
      checks: ['bun test src/tickets.test.ts — 89 pass'],
      made: 'The lease is what tells a stopped worker apart.',
    });
    expect(answer.status).toBe(200);

    const done = (await answer.json()).run as Run;
    expect(done.endedAt).not.toBeNull();
    expect(done.stoppedBecause).toBeNull();
    expect(done.changed).toBe('A claim is a row now.');
    expect(done.checks).toEqual(['bun test src/tickets.test.ts — 89 pass']);
    expect(done.made).toBe('The lease is what tells a stopped worker apart.');
    expect(done.verdict).toBeNull();
  });

  test('cannot be ended twice', async () => {
    const { app, person, ticket } = await claimedTicket();
    const made = (await (await started(app, person.key, ticket.id, { workerId: 'desk-1' })).json())
      .run as Run;

    expect((await ended(app, person.key, ticket.id, made.id, { changed: 'Done.' })).status).toBe(
      200,
    );
    const twice = await ended(app, person.key, ticket.id, made.id, { changed: 'Done again.' });
    expect(twice.status).toBe(400);
    expect((await twice.json()).error.code).toBe('RUN_ENDED');
  });

  test('that stopped needing a person says so, and why', async () => {
    const { app, person, ticket } = await claimedTicket();
    const made = (await (await started(app, person.key, ticket.id, { workerId: 'desk-1' })).json())
      .run as Run;

    const answer = await ended(app, person.key, ticket.id, made.id, {
      changed: 'Half of it.',
      stoppedBecause: 'I could not exercise it: this machine cannot start the app.',
    });

    const done = (await answer.json()).run as Run;
    expect(done.stoppedBecause).toBe('I could not exercise it: this machine cannot start the app.');
  });

  test('is judged accepted or sent back, with when the person decided', async () => {
    const { app, person, ticket } = await claimedTicket();
    const made = (await (await started(app, person.key, ticket.id, { workerId: 'desk-1' })).json())
      .run as Run;
    await ended(app, person.key, ticket.id, made.id, { changed: 'A claim is a row now.' });

    const answer = await judged(app, person.key, ticket.id, made.id, { verdict: 'accepted' });
    expect(answer.status).toBe(200);

    const judgedRun = (await answer.json()).run as Run;
    expect(judgedRun.verdict).toBe('accepted');
    expect(judgedRun.verdictAt).not.toBeNull();

    // Acceptance records the verdict and closes the ticket as one server decision.
    const closed = (await (await read(app, person.key, ticket.id)).json()).ticket as Ticket;
    expect(closed).toMatchObject({ closure: 'done', closedAt: expect.any(String), band: 'done' });

    // A verdict is once: sending it back after accepting is not a second opinion, and the
    // refusal is the server's sentence rather than a desktop-made explanation.
    const twice = await judged(app, person.key, ticket.id, made.id, { verdict: 'sent-back' });
    expect(twice.status).toBe(400);
    expect(await twice.json()).toEqual({
      error: { code: 'RUN_JUDGED', message: 'That run has already been judged.' },
    });

    // A closed ticket cannot be retried, and this refusal also comes from the server.
    const retry = await claimed(app, person.key, ticket.id, { workerId: 'desk-1' });
    expect(retry.status).toBe(400);
    expect(await retry.json()).toEqual({
      error: {
        code: 'CLAIM_NOT_READY',
        message: 'A ticket is worked when it is ready and nothing else.',
      },
    });

    // And a verdict that is not one of the two is refused in Foundry's own words.
    const other = await judged(app, person.key, ticket.id, made.id, { verdict: 'maybe' });
    expect(other.status).toBe(400);
    expect((await other.json()).error.code).toBe('VERDICT_UNKNOWN');
  });

  test('accepting a gated ticket releases the ticket it gates', async () => {
    const made = await server();
    const ada = await made.add();
    const madeProject = await project(made.app, ada.key);
    const parent = await drafted(made.app, ada.key, madeProject.id, { title: 'The whole' });
    await wrote(made.app, ada.key, parent.id, { gate: 'ready-for-agent' });
    const slice = await drafted(made.app, ada.key, madeProject.id, { title: 'A slice' });
    await wrote(made.app, ada.key, slice.id, { gate: 'ready-for-agent' });
    await send(
      made.app,
      `/api/tickets/${parent.id}/gates`,
      body('POST', bearer(ada.key), { gatedBy: slice.id }),
    );

    expect(bandOf(await queue(made.app, ada.key, madeProject.id), parent.id)).toBe('blocked');

    await offering(made.app, ada.key, 'desk-1');
    await claimed(made.app, ada.key, slice.id, { workerId: 'desk-1' });
    const madeRun = (
      await (await started(made.app, ada.key, slice.id, { workerId: 'desk-1' })).json()
    ).run as Run;
    await ended(made.app, ada.key, slice.id, madeRun.id, { changed: 'The slice landed.' });
    const accepted = await judged(made.app, ada.key, slice.id, madeRun.id, { verdict: 'accepted' });
    expect(accepted.status).toBe(200);

    const held = await queue(made.app, ada.key, madeProject.id);
    expect(bandOf(held, slice.id)).toBe('done');
    expect(bandOf(held, parent.id)).toBe('ready');
  });

  test('cannot be judged before it has ended', async () => {
    const { app, person, ticket } = await claimedTicket();
    const made = (await (await started(app, person.key, ticket.id, { workerId: 'desk-1' })).json())
      .run as Run;

    const answer = await judged(app, person.key, ticket.id, made.id, { verdict: 'accepted' });
    expect(answer.status).toBe(400);
    expect(await answer.json()).toEqual({
      error: { code: 'RUN_UNFINISHED', message: 'That run has not ended yet.' },
    });
  });

  test('ending releases the claim, and the ticket keeps every run it has had', async () => {
    const { app, person, ticket } = await claimedTicket();
    const first = (await (await started(app, person.key, ticket.id, { workerId: 'desk-1' })).json())
      .run as Run;
    await ended(app, person.key, ticket.id, first.id, { changed: 'A first go.' });
    await judged(app, person.key, ticket.id, first.id, { verdict: 'sent-back' });

    // Ending the run let the ticket go, so it can be claimed and run again.
    const after = (await (await read(app, person.key, ticket.id)).json()).ticket as Ticket;
    expect(after.claim).toBeNull();

    const again = await claimed(app, person.key, ticket.id, {
      workerId: 'desk-1',
      leaseSeconds: 60,
    });
    expect(again.status).toBe(200);
    const second = (
      await (await started(app, person.key, ticket.id, { workerId: 'desk-1' })).json()
    ).run as Run;

    const held = (await (await read(app, person.key, ticket.id)).json()).ticket as Ticket;
    expect(held.runs).toHaveLength(2);
    expect(held.runs.map((each) => each.id)).toEqual([second.id, first.id]);
    expect(held.runs[1]?.verdict).toBe('sent-back');
    expect(held.closure).toBeNull();

    // A run is not the ticket's state: two runs in, the ticket is where its own facts
    // put it — a claim is held, so it is running — and not where its last run left it.
    expect(held.band).toBe('running');
  });

  test('letting the claim go ends the run it was carrying, saying so', async () => {
    const { app, person, ticket } = await claimedTicket();
    const run = (await (await started(app, person.key, ticket.id, { workerId: 'desk-1' })).json())
      .run as Run;

    const letGo = await released(app, person.key, ticket.id);
    expect(letGo.status).toBe(200);

    // A claim and a run are two halves of one thing. A claim that goes while its run
    // stays open leaves a ticket nobody can run again: Run refuses it, because a run is
    // already going, and no window can end a run nobody is driving (GH #68, #75).
    const after = (await (await read(app, person.key, ticket.id)).json()).ticket as Ticket;
    expect(after.claim).toBeNull();
    const newest = after.runs[0];
    expect(newest?.id).toBe(run.id);
    expect(newest?.endedAt).not.toBeNull();
    expect(newest?.stoppedBecause).toBe('Somebody let this run go.');
    expect(after.band).toBe('needs-you');
  });

  test('taking a claim over ends the run the desktop that stopped answering left', async () => {
    // A lease that has already run out is what a machine that went quiet looks like.
    const { app, person, ticket } = await claimedTicket(0);
    const run = (await (await started(app, person.key, ticket.id, { workerId: 'desk-1' })).json())
      .run as Run;

    const over = await takenOver(app, person.key, ticket.id);
    expect(over.status).toBe(200);

    const after = (await (await read(app, person.key, ticket.id)).json()).ticket as Ticket;
    const newest = after.runs[0];
    expect(newest?.id).toBe(run.id);
    expect(newest?.endedAt).not.toBeNull();
    expect(newest?.stoppedBecause).toBe('The desktop driving this run stopped answering.');
    // The claim is held by hand now, so the ticket is somebody's work again.
    expect(after.claim?.workerId).toBeNull();
    expect(after.band).toBe('running');
  });

  test('leaves a run that has already ended with the words it ended with', async () => {
    const { app, person, ticket } = await claimedTicket();
    const run = (await (await started(app, person.key, ticket.id, { workerId: 'desk-1' })).json())
      .run as Run;
    await ended(app, person.key, ticket.id, run.id, {
      made: 'What it made.',
      stoppedBecause: 'It could not go on.',
    });

    // Ending the run let the claim go with it, so this is a claim that is not there.
    const letGo = await released(app, person.key, ticket.id);
    expect(letGo.status).toBe(200);

    const after = (await (await read(app, person.key, ticket.id)).json()).ticket as Ticket;
    const newest = after.runs[0];
    expect(newest?.made).toBe('What it made.');
    expect(newest?.stoppedBecause).toBe('It could not go on.');
  });
});

describe('what was said while a run went on', () => {
  /** A project with one ready ticket running on a claim of its author's. */
  async function runningTicket() {
    const made = await server();
    const ada = await made.add();
    const madeProject = await project(made.app, ada.key);
    const written = await drafted(made.app, ada.key, madeProject.id);
    await wrote(made.app, ada.key, written.id, { gate: 'ready-for-agent' });
    await offering(made.app, ada.key, 'desk-1');
    await claimed(made.app, ada.key, written.id, { workerId: 'desk-1', leaseSeconds: 60 });

    const answer = await started(made.app, ada.key, written.id, { workerId: 'desk-1' });
    if (answer.status !== 200) throw new Error(`no run: ${await answer.text()}`);

    return {
      app: made.app,
      person: ada,
      project: madeProject,
      ticket: written,
      run: (await answer.json()).run as Run,
      add: made.add,
    };
  }

  /** One line written into a run's transcript. */
  async function said(
    app: Awaited<ReturnType<typeof boot>>['app'],
    key: string,
    ref: string,
    runId: string,
    sent: Record<string, unknown>,
  ): Promise<Response> {
    return await send(
      app,
      `/api/tickets/${ref}/runs/${runId}/transcript`,
      body('POST', bearer(key), sent),
    );
  }

  /** A run's transcript, read back in the order it was said. */
  async function heard(
    app: Awaited<ReturnType<typeof boot>>['app'],
    key: string,
    ref: string,
    runId: string,
  ): Promise<Response> {
    return await send(app, `/api/tickets/${ref}/runs/${runId}/transcript`, {
      headers: bearer(key),
    });
  }

  test('keeps what the person steering and the agent said, in the order they said it', async () => {
    const { app, person, ticket, run } = await runningTicket();

    const mine = await said(app, person.key, ticket.id, run.id, {
      saidBy: 'person',
      words: 'Use the existing helper rather than a new one.',
    });
    expect(mine.status).toBe(200);
    expect((await mine.json()).said.words).toBe('Use the existing helper rather than a new one.');

    await said(app, person.key, ticket.id, run.id, { saidBy: 'agent', words: 'Found one.' });
    await said(app, person.key, ticket.id, run.id, {
      saidBy: 'note',
      words: 'The checkout was made at fnd-1-a-ticket.',
    });

    const back = await heard(app, person.key, ticket.id, run.id);
    expect(back.status).toBe(200);
    const lines = (await back.json()).transcript as { saidBy: string; words: string; at: string }[];
    expect(lines.map((each) => each.saidBy)).toEqual(['person', 'agent', 'note']);
    expect(lines[0]?.words).toBe('Use the existing helper rather than a new one.');
    expect(typeof lines[0]?.at).toBe('string');
  });

  test('is readable long after the run ended, and can still take the reason it stopped', async () => {
    const { app, person, ticket, run } = await runningTicket();
    await said(app, person.key, ticket.id, run.id, { saidBy: 'agent', words: 'Half done.' });
    await ended(app, person.key, ticket.id, run.id, { stoppedBecause: 'It needs a decision.' });

    const after = await said(app, person.key, ticket.id, run.id, {
      saidBy: 'note',
      words: 'It stopped because it needs a decision.',
    });
    expect(after.status).toBe(200);

    const back = await heard(app, person.key, ticket.id, run.id);
    expect(back.status).toBe(200);
    expect(((await back.json()).transcript as unknown[]).length).toBe(2);
  });

  test('is readable by anyone on the project, and writable only by the run’s driver', async () => {
    const { app, person, ticket, run, add } = await runningTicket();
    await said(app, person.key, ticket.id, run.id, { saidBy: 'agent', words: 'Working.' });
    const grace = await add('grace@company.example');

    const hers = await heard(app, grace.key, ticket.id, run.id);
    expect(hers.status).toBe(200);
    expect(((await hers.json()).transcript as unknown[]).length).toBe(1);

    const hersToWrite = await said(app, grace.key, ticket.id, run.id, {
      saidBy: 'person',
      words: 'Stop that.',
    });
    expect(hersToWrite.status).toBe(400);
    expect((await hersToWrite.json()).error.code).toBe('RUN_NOT_YOURS');
  });

  test('refuses a line from nobody in particular, and a line with nothing in it', async () => {
    const { app, person, ticket, run } = await runningTicket();

    const stranger = await said(app, person.key, ticket.id, run.id, {
      saidBy: 'somebody',
      words: 'Hello.',
    });
    expect(stranger.status).toBe(400);
    expect((await stranger.json()).error.code).toBe('SAID_BY_UNKNOWN');

    const empty = await said(app, person.key, ticket.id, run.id, {
      saidBy: 'person',
      words: '   ',
    });
    expect(empty.status).toBe(400);
    expect((await empty.json()).error.code).toBe('SAID_NOTHING');
  });

  test('is nobody’s business without a key, and there is no transcript of a run that never was', async () => {
    const { app, person, ticket, run } = await runningTicket();

    const unsigned = await send(app, `/api/tickets/${ticket.id}/runs/${run.id}/transcript`, {
      headers: {},
    });
    expect(unsigned.status).toBe(401);

    const nowhere = await heard(app, person.key, ticket.id, 'no-such-run');
    expect(nowhere.status).toBe(404);
    expect((await nowhere.json()).error.code).toBe('RUN_NOT_FOUND');
  });
});

describe('the bands a claim and a run put a ticket in', () => {
  /**
   * The band of a ticket made to order: whether it is a draft, closed, gated by an open
   * ticket, claimed, and how its newest run ended.
   *
   * Every combination is built through the routes rather than written into the tables,
   * because the derivation is a statement about what a client is answered, not about
   * what the rows hold.
   */
  async function bandWith(state: {
    draft?: boolean;
    blocked?: boolean;
    closed?: boolean;
    claimed?: boolean;
    run?: 'open' | 'proposal' | 'stopped' | 'accepted' | 'sent-back';
  }): Promise<string> {
    const made = await server();
    const ada = await made.add();
    const madeProject = await project(made.app, ada.key);
    const written = await drafted(made.app, ada.key, madeProject.id);

    // Ready first, because a ticket is claimed when it is ready and nothing else — so
    // anything that would take it out of the frontier is applied after the claim rather
    // than before it.
    await wrote(made.app, ada.key, written.id, { gate: 'ready-for-agent' });

    // The desktop the claim below names, offered the way the app offers itself.
    await offering(made.app, ada.key, 'desk-1');

    const claimIt = async (): Promise<void> => {
      await send(
        made.app,
        `/api/tickets/${written.id}/claim`,
        body('POST', bearer(ada.key), { workerId: 'desk-1', leaseSeconds: 60 }),
      );
    };

    if (state.run !== undefined) {
      await claimIt();
      const madeRun = (
        await (await started(made.app, ada.key, written.id, { workerId: 'desk-1' })).json()
      ).run as Run;

      if (state.run !== 'open') {
        await ended(made.app, ada.key, written.id, madeRun.id, {
          changed: 'Something was made.',
          ...(state.run === 'stopped' ? { stoppedBecause: 'It could not be exercised.' } : {}),
        });
      }

      if (state.run === 'accepted' || state.run === 'sent-back') {
        await judged(made.app, ada.key, written.id, madeRun.id, { verdict: state.run });
      }
    }

    // Claimed after the run, because ending a run lets the claim go.
    if (state.claimed === true) await claimIt();

    if (state.draft === true) {
      await wrote(made.app, ada.key, written.id, { gate: 'draft' });
    }

    if (state.blocked === true) {
      const slice = await drafted(made.app, ada.key, madeProject.id);
      await send(
        made.app,
        `/api/tickets/${written.id}/gates`,
        body('POST', bearer(ada.key), { gatedBy: slice.id }),
      );
    }

    if (state.closed === true) {
      await wrote(made.app, ada.key, written.id, { closure: 'done' });
    }

    return bandOf(await queue(made.app, ada.key, madeProject.id), written.id) ?? 'missing';
  }

  test('a claimed ticket is Running whatever else is true of it', async () => {
    expect(await bandWith({ claimed: true })).toBe('running');
    expect(await bandWith({ claimed: true, draft: true })).toBe('running');
    expect(await bandWith({ claimed: true, blocked: true })).toBe('running');
    // Even closed: a run that is going is going, and hiding it in Done would lose it.
    expect(await bandWith({ claimed: true, closed: true })).toBe('running');
    expect(await bandWith({ run: 'open' })).toBe('running');
  });

  test('a ticket whose proposal is waiting is Needs you, and says what it made', async () => {
    const made = await server();
    const ada = await made.add();
    const madeProject = await project(made.app, ada.key);
    const written = await drafted(made.app, ada.key, madeProject.id);
    await wrote(made.app, ada.key, written.id, { gate: 'ready-for-agent' });
    await offering(made.app, ada.key, 'desk-1');
    await send(
      made.app,
      `/api/tickets/${written.id}/claim`,
      body('POST', bearer(ada.key), { workerId: 'desk-1', leaseSeconds: 60 }),
    );
    const madeRun = (
      await (await started(made.app, ada.key, written.id, { workerId: 'desk-1' })).json()
    ).run as Run;
    await ended(made.app, ada.key, written.id, madeRun.id, { changed: 'A claim is a row now.' });

    const held = await queue(made.app, ada.key, madeProject.id);
    const ticket = held.tickets.find((each) => each.id === written.id);
    expect(ticket?.band).toBe('needs-you');
    // What it is waiting on is readable from the ticket rather than guessed at.
    expect(ticket?.runs[0]?.changed).toBe('A claim is a row now.');
    expect(ticket?.runs[0]?.verdict).toBeNull();
    expect(held.counts['needs-you']).toBe(1);
  });

  test('a ticket whose run stopped needing a person is Needs you, and says why', async () => {
    const made = await server();
    const ada = await made.add();
    const madeProject = await project(made.app, ada.key);
    const written = await drafted(made.app, ada.key, madeProject.id);
    await wrote(made.app, ada.key, written.id, { gate: 'ready-for-agent' });
    await offering(made.app, ada.key, 'desk-1');
    await send(
      made.app,
      `/api/tickets/${written.id}/claim`,
      body('POST', bearer(ada.key), { workerId: 'desk-1', leaseSeconds: 60 }),
    );
    const madeRun = (
      await (await started(made.app, ada.key, written.id, { workerId: 'desk-1' })).json()
    ).run as Run;
    await ended(made.app, ada.key, written.id, madeRun.id, {
      changed: 'Half of it.',
      stoppedBecause: 'I could not exercise it: this machine cannot start the app.',
    });

    const held = await queue(made.app, ada.key, madeProject.id);
    const ticket = held.tickets.find((each) => each.id === written.id);
    expect(ticket?.band).toBe('needs-you');
    expect(ticket?.runs[0]?.stoppedBecause).toBe(
      'I could not exercise it: this machine cannot start the app.',
    );
  });

  test('acceptance is Done while sending a run back leaves the ticket ready', async () => {
    expect(await bandWith({ run: 'accepted' })).toBe('done');
    expect(await bandWith({ run: 'sent-back' })).toBe('ready');
  });

  test('a closed ticket is Done however its last run ended', async () => {
    expect(await bandWith({ closed: true })).toBe('done');
    expect(await bandWith({ closed: true, run: 'proposal' })).toBe('done');
    expect(await bandWith({ closed: true, run: 'stopped' })).toBe('done');
    expect(await bandWith({ closed: true, run: 'accepted' })).toBe('done');
  });

  test('Running and Needs you are not in the frontier', async () => {
    expect(await bandWith({ run: 'proposal' })).toBe('needs-you');
    // Blocked and ready are still reached with no claim and no run waiting on a person.
    expect(await bandWith({})).toBe('ready');
    expect(await bandWith({ blocked: true })).toBe('blocked');
    expect(await bandWith({ draft: true })).toBe('draft');
  });

  test('the counts answer exactly the six bands', async () => {
    const { app, key } = await signedIn();
    const made = await project(app, key);

    expect(Object.keys((await queue(app, key, made.id)).counts).sort()).toEqual([
      'blocked',
      'done',
      'draft',
      'needs-you',
      'ready',
      'running',
    ]);
  });

  test('is one table over closure, a claim, and how the last run ended', async () => {
    const cases: {
      state: Parameters<typeof bandWith>[0];
      want: string;
      why: string;
    }[] = [
      { state: {}, want: 'ready', why: 'nothing holds it and nothing gates it' },
      { state: { draft: true }, want: 'draft', why: 'nobody has asked for it yet' },
      { state: { blocked: true }, want: 'blocked', why: 'a ticket it names is still open' },
      { state: { closed: true }, want: 'done', why: 'closed is closed' },
      { state: { claimed: true }, want: 'running', why: 'somebody is working it' },
      { state: { run: 'open' }, want: 'running', why: 'a run is going' },
      { state: { run: 'proposal' }, want: 'needs-you', why: 'a proposal is waiting' },
      { state: { run: 'stopped' }, want: 'needs-you', why: 'a run stopped needing a person' },
      { state: { run: 'accepted' }, want: 'done', why: 'acceptance closes the ticket' },
      { state: { run: 'sent-back' }, want: 'ready', why: 'sending it back leaves it open' },
      { state: { draft: true, claimed: true }, want: 'running', why: 'a claim outranks draft' },
      { state: { blocked: true, claimed: true }, want: 'running', why: 'a claim outranks blocked' },
      { state: { closed: true, claimed: true }, want: 'running', why: 'a claim outranks closure' },
      {
        state: { blocked: true, run: 'proposal' },
        want: 'needs-you',
        why: 'waiting on a person outranks waiting on a ticket',
      },
      {
        state: { blocked: true, run: 'accepted' },
        want: 'done',
        why: 'acceptance closes the ticket before its gates are read',
      },
      {
        state: { draft: true, run: 'proposal' },
        want: 'needs-you',
        why: 'a proposal waiting is a person to answer, whatever the gate says',
      },
      {
        state: { closed: true, run: 'proposal' },
        want: 'done',
        why: 'closure outranks a proposal nobody needs to answer',
      },
    ];

    for (const each of cases) {
      expect([each.want, await bandWith(each.state), each.why]).toEqual([
        each.want,
        each.want,
        each.why,
      ]);
    }
    // Seventeen tickets, each built through the routes on a server of its own: the
    // default budget is for a test that makes one.
  }, 60_000);
});
