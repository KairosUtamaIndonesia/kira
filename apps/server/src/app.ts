import { openapi } from '@elysiajs/openapi';
import { Elysia, t } from 'elysia';
import type { Auth } from './auth';
import type { Config } from './config';
import type { Database } from './database';
import { createAllowances } from './allowance';
import { handoffLink, handoffToken } from './handoff';
import { keyHolder } from './keys';
import { createMemory } from './memory';
import { createDecisions } from './decisions';
import { createGlossary } from './glossary';
import { createPool } from './pool';
import { REFUSAL, refusal } from './refusals';
import { createTickets } from './tickets';
import { createWorkers } from './workers';

const SIGN_IN_PAGE = `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>Sign in to Foundry</title>
  </head>
  <body>
    <main>
      <h1>Foundry</h1>
      <p>Sign in with your company Microsoft account.</p>
      <form method="post" action="/sign-in">
        <button type="submit">Sign in with Microsoft</button>
      </form>
    </main>
  </body>
</html>
`;

/**
 * The platform API, without a listener. Binding a port is `index.ts`, so this
 * file can be imported by a test without one.
 */
export function createApp({
  auth,
  config,
  database,
}: {
  auth: Auth;
  config: Config;
  database: Database;
}) {
  return (
    new Elysia()
      .use(
        openapi({
          documentation: {
            info: { title: 'Foundry platform API', version: '0.1.0' },
          },
        }),
      )
      // Better Auth's own routes — the sign-in handshake and key management.
      // They are the library's surface, not ours to document. Routed by prefix
      // rather than `.mount()`, which would strip the prefix the handler
      // routes on; this also leaves Elysia owning every other path.
      .all('/api/auth/*', ({ request }) => auth.handler(request))
      // Where sign-in comes back to. Better Auth's post-sign-in address is the
      // server's own base URL, so the root is the desktop's way home: the
      // callback leaves the handoff token in a cookie and the browser brings it
      // here. Reading that cookie on this side rather than in a script keeps the
      // return to a single redirect and needs no JavaScript in the page.
      .get(
        '/',
        ({ request, status }) => {
          const token = handoffToken(request.headers.get('cookie'));
          // Nothing to come back from: the root is a hand-off or it is nowhere.
          if (token === null) return status(404, 'NOT_FOUND');

          return new Response(null, {
            status: 302,
            headers: { location: handoffLink(token) },
          });
        },
        { detail: { summary: 'Hand the desktop the token sign-in left behind' } },
      )
      .get('/health', () => ({ status: 'ok' }), {
        response: t.Object({ status: t.String() }),
        detail: { summary: 'Liveness check' },
      })
      .get('/sign-in', () => html(SIGN_IN_PAGE), {
        detail: { summary: 'Page that starts sign-in' },
      })
      .post(
        '/sign-in',
        async () => {
          const { headers, response } = await auth.api.signInSocial({
            body: { provider: 'microsoft', callbackURL: config.baseUrl },
            returnHeaders: true,
          });
          const url = response && 'url' in response ? response.url : undefined;
          if (!url) return new Response('Microsoft sign-in is unavailable.', { status: 502 });

          // The state cookie is what the callback checks when Microsoft
          // returns, so it has to reach the browser with the redirect.
          const redirect = new Response(null, { status: 302, headers: { location: url } });
          for (const cookie of headers.getSetCookie()) {
            redirect.headers.append('set-cookie', cookie);
          }
          return redirect;
        },
        { detail: { summary: 'Start sign-in with Microsoft' } },
      )
      .get(
        '/api/me',
        async ({ request, status }) => {
          const held = await keyHolder(auth, request);
          if ('refusal' in held) {
            return status(401, refusal(held.refusal.code, held.refusal.message));
          }

          return held.user;
        },
        {
          response: {
            200: t.Object({ id: t.String(), email: t.String(), name: t.String() }),
            401: REFUSAL,
          },
          detail: { summary: 'The user a Foundry key belongs to' },
        },
      )
      .use(createPool({ auth, config, database }))
      .use(createAllowances({ auth, config, database }))
      .use(createMemory({ auth, config, database }))
      .use(createDecisions({ auth, database }))
      .use(createGlossary({ auth, database }))
      .use(createTickets({ auth, database }))
      .use(createWorkers({ auth, database }))
  );
}

function html(page: string) {
  return new Response(page, { headers: { 'content-type': 'text/html; charset=utf-8' } });
}
