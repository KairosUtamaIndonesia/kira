/**
 * Workers: the desktops that have offered themselves for work.
 *
 * The server owns the queue and a worker owns execution (docs/adr/0012). A worker is
 * online while it is being heard from and away when it is not, and that is read off how
 * long ago it was heard from rather than stored, for the same reason a band is derived:
 * nothing should be able to say a desktop is there when it is not.
 *
 * Nothing here hands work to anybody. A worker runs what its own person starts and takes
 * nothing on its own, so this is the offering and the roll-call rather than a dispatcher.
 * A worker that stops answering keeps whatever it holds, because a claim is taken over by
 * a person rather than released by a clock.
 */
import { and, asc, eq, inArray } from 'drizzle-orm';
import { Elysia, t } from 'elysia';
import type { Auth } from './auth';
import type { Database } from './database';
import { keyHolder, type HeldUser } from './keys';
import { refusal, REFUSAL } from './refusals';
import { claim, user, worker } from './schema';
import { leaseFrom, lostItsDriver } from './tickets';

/**
 * How quiet a worker has to be before it is shown as away.
 *
 * Three heartbeats at the desktop's own pace: long enough that a busy machine does not
 * flicker between here and gone, short enough that a desktop which vanished is visibly
 * away within a coffee break.
 */
const AWAY_AFTER_MS = 90_000;

/** A worker as a client reads one. */
const WORKER = t.Object({
  id: t.String(),
  name: t.String(),
  owner: t.Object({ id: t.String(), name: t.String() }),
  /** The folders it can run in, as it names them to itself. */
  workspaces: t.Array(t.String()),
  heardAt: t.String(),
  /** Whether it has gone quiet for long enough to be away rather than here. */
  away: t.Boolean(),
  quietMs: t.Integer(),
  /** The tickets it holds a claim on, which is what it is working. */
  holds: t.Array(t.String()),
});

export function createWorkers({ auth, database }: { auth: Auth; database: Database }) {
  return new Elysia()
    .get(
      '/api/workers',
      async ({ request, status }) => {
        const held = await asking(auth, request);
        if ('refused' in held) return status(401, held.refused);

        return { workers: await roll(database) };
      },
      {
        response: { 200: t.Object({ workers: t.Array(WORKER) }), 401: REFUSAL },
        detail: { summary: 'The desktops that have offered themselves for work' },
      },
    )
    .post(
      '/api/workers',
      async ({ request, body, status }) => {
        const held = await asking(auth, request);
        if ('refused' in held) return status(401, held.refused);

        const id = body.id.trim();
        const name = body.name.trim();
        if (id === '' || name === '') {
          return status(400, refusal('WORKER_NAMELESS', 'A worker says what it is called.'));
        }

        // An id is derived from the person and the machine, so an id somebody else has
        // already offered is not this person's to answer for — otherwise offering a
        // desktop would be a way to be handed somebody else's machine (GH #68).
        const [offered] = await database
          .select({ ownerId: worker.ownerId })
          .from(worker)
          .where(eq(worker.id, id))
          .limit(1);
        if (offered !== undefined && offered.ownerId !== held.user.id) {
          return status(
            400,
            refusal('WORKER_NOT_YOURS', "That desktop is somebody else's to offer."),
          );
        }

        // Offering twice with the same id is the same desktop saying hello again, so the
        // row is written rather than refused: a desktop that restarted is not a new one.
        const written = {
          id,
          ownerId: held.user.id,
          name,
          workspaces: body.workspaces.filter((each) => each.trim() !== ''),
          heardAt: new Date(),
        };
        await database
          .insert(worker)
          .values(written)
          .onConflictDoUpdate({
            target: worker.id,
            set: {
              name: written.name,
              workspaces: written.workspaces,
              heardAt: written.heardAt,
            },
          });

        return { worker: asWorker(written, [], held.user.name) };
      },
      {
        body: t.Object({
          id: t.String(),
          name: t.String(),
          workspaces: t.Array(t.String()),
        }),
        response: { 200: t.Object({ worker: WORKER }), 400: REFUSAL, 401: REFUSAL },
        detail: { summary: 'Offer this desktop for work' },
      },
    )
    .post(
      '/api/workers/:id/heartbeat',
      async ({ request, params, body, status }) => {
        const held = await asking(auth, request);
        if ('refused' in held) return status(401, held.refused);

        const known = await workerOn(database, params.id);
        if (!known) return status(404, refusal('WORKER_UNKNOWN', 'No such worker.'));

        const heardAt = new Date();
        const workspaces =
          body.workspaces === undefined
            ? known.workspaces
            : body.workspaces.filter((each) => each.trim() !== '');
        await database.update(worker).set({ heardAt, workspaces }).where(eq(worker.id, params.id));

        // And the runs it says it is driving, and only those. A desktop saying it is still
        // here is saying the work it took on is still going — but being here is not the same
        // as working, and a desktop that restarted is here with nothing in flight: the run it
        // was driving died with the window. Refreshing that lease anyway left a ticket reading
        // Running for good, with its claim never stale enough to take over, which is the one
        // thing a band must never do (GH #74, #75). Without any of this nothing refreshed a
        // worker's claim at all — the lease was set once when the run started and ran out a
        // minute later, so a healthy machine's run read as gone quiet while it was still
        // working (GH #69, #74).
        //
        // A desktop that does not say what it is driving keeps nothing fresh, which fails
        // towards a claim somebody can take over rather than towards a band that lies. A claim
        // held by hand names no worker and is left alone either way.
        const driving = body.driving ?? [];
        if (driving.length > 0) {
          await database
            .update(claim)
            .set({ heardAt, leaseUntil: leaseFrom(60) })
            .where(and(eq(claim.workerId, params.id), inArray(claim.ticketId, driving)));
        }

        return {
          worker: asWorker({ ...known, workspaces, heardAt }, await heldBy(database, params.id)),
        };
      },
      {
        params: t.Object({ id: t.String() }),
        body: t.Object({
          workspaces: t.Optional(t.Array(t.String())),
          /** The tickets this desktop is running right now, which is what stays fresh. */
          driving: t.Optional(t.Array(t.String())),
        }),
        response: { 200: t.Object({ worker: WORKER }), 401: REFUSAL, 404: REFUSAL },
        detail: { summary: 'Say this desktop is still here' },
      },
    )
    .delete(
      '/api/workers/:id',
      async ({ request, params, status }) => {
        const held = await asking(auth, request);
        if ('refused' in held) return status(401, held.refused);

        // Going is not the same as going quiet: a desktop that said goodbye is gone, and
        // one that stopped answering is away. Letting go of what is not there is the same
        // as having let go of it.
        //
        // What it held goes with it: nobody is working those tickets any more, and a claim
        // nobody holds is what lets them be claimed again (docs/adr/0012).
        //
        // The runs those claims were carrying go with them too. A desktop that is driving a
        // run never says goodbye — it goes quiet, so the run stays Running and can be taken
        // over by hand — so what it holds here is what it inherited and cannot drive, and a
        // run left open by a claim that went is a ticket that can never run again.
        const itsClaims = await database
          .select({ ticketId: claim.ticketId })
          .from(claim)
          .where(eq(claim.workerId, params.id));
        for (const each of itsClaims) {
          await lostItsDriver(database, each.ticketId, 'The desktop running this stopped.');
        }

        await database.delete(claim).where(eq(claim.workerId, params.id));
        await database.delete(worker).where(eq(worker.id, params.id));

        return { gone: true };
      },
      {
        params: t.Object({ id: t.String() }),
        response: { 200: t.Object({ gone: t.Boolean() }), 401: REFUSAL },
        detail: { summary: 'Say this desktop is gone' },
      },
    );
}

/**
 * Every worker, with what each is holding.
 *
 * Two queries whatever the number of desktops: the workers, and the claims they hold.
 */
async function roll(database: Database) {
  const rows = await database
    .select({ worker, ownerName: user.name })
    .from(worker)
    .innerJoin(user, eq(user.id, worker.ownerId))
    .orderBy(asc(worker.heardAt), asc(worker.id));

  const ids = rows.map((each) => each.worker.id);
  const held =
    ids.length === 0 ? [] : await database.select().from(claim).where(inArray(claim.workerId, ids));

  return rows.map((each) =>
    asWorker(
      each.worker,
      held.filter((one) => one.workerId === each.worker.id).map((one) => one.ticketId),
      each.ownerName,
    ),
  );
}

/** The tickets one worker holds. */
async function heldBy(database: Database, id: string): Promise<string[]> {
  const rows = await database.select().from(claim).where(eq(claim.workerId, id));

  return rows.map((each) => each.ticketId);
}

/** One worker, as it stands. */
async function workerOn(database: Database, id: string) {
  const [held] = await database.select().from(worker).where(eq(worker.id, id));

  return held;
}

/** A worker as a client reads it, with its age read off the clock at read time. */
function asWorker(held: typeof worker.$inferSelect, holds: string[], ownerName = '') {
  const quietMs = Math.max(0, Date.now() - held.heardAt.getTime());

  return {
    id: held.id,
    name: held.name,
    owner: { id: held.ownerId, name: ownerName },
    workspaces: held.workspaces,
    heardAt: held.heardAt.toISOString(),
    away: quietMs >= AWAY_AFTER_MS,
    quietMs,
    holds,
  };
}

/**
 * The person a request is from, or the refusal to answer it with.
 *
 * The same three ways of not being signed in that the tracker answers: no key at all, a
 * key nobody holds, and a key whose person is gone. A roll-call answered as an empty list
 * would be indistinguishable from nobody offering to work.
 */
type Asking = { readonly refused: ReturnType<typeof refusal> } | { readonly user: HeldUser };

async function asking(auth: Auth, request: Request): Promise<Asking> {
  const held = await keyHolder(auth, request);
  if ('refusal' in held) return { refused: refusal(held.refusal.code, held.refusal.message) };

  return { user: held.user };
}
