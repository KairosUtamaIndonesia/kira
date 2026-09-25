import { afterAll, describe, expect, test } from 'bun:test';
import { createHash, randomBytes } from 'node:crypto';
import { cookieHeader, closeDatabases, listening, TENANT } from './test-support/server';

// The connections this file opened are let go when it ends; see `closeDatabases`.
afterAll(closeDatabases);

const ADA = {
  oid: 'aaaaaaaa-0000-0000-0000-000000000001',
  tid: TENANT,
  name: 'Ada Lovelace',
  email: 'ada@company.example',
};

/** What the app holds after the browser has been round the houses. */
interface Handoff {
  /** The handoff token, decoded exactly as the app decodes it. */
  identifier: string;
  state: string;
  verifier: string;
  /** What the root sent the browser to. */
  deepLink: string;
}

/**
 * Walk the journey the app walks: the server sends the browser to Microsoft,
 * Microsoft sends it back, and the root hands the app its token.
 */
async function handOff(origin: string): Promise<Handoff> {
  const verifier = randomBytes(32).toString('base64url');
  const challenge = createHash('sha256').update(verifier).digest('base64url');
  const state = randomBytes(16).toString('base64url');

  const started = await fetch(
    `${origin}/api/auth/electron/init-oauth-proxy?provider=microsoft&state=${state}&code_challenge=${challenge}`,
    { redirect: 'manual' },
  );
  const toMicrosoft = started.headers.get('location');
  if (!toMicrosoft) throw new Error('the desktop sign-in did not reach Microsoft');

  const atMicrosoft = await fetch(toMicrosoft, { redirect: 'manual' });
  const backToKira = atMicrosoft.headers.get('location');
  await atMicrosoft.body?.cancel();
  if (!backToKira) throw new Error('Microsoft did not send the browser back');

  const signedIn = await fetch(new URL(backToKira), {
    redirect: 'manual',
    headers: { cookie: cookieHeader(started) },
  });

  const home = await fetch(`${origin}/`, {
    redirect: 'manual',
    headers: { cookie: cookieHeader(signedIn) },
  });
  const deepLink = home.headers.get('location');
  if (!deepLink) throw new Error('the root did not hand the app back');

  const token = new URL(deepLink).hash.replace('#token=', '');
  const decoded: unknown = JSON.parse(
    Buffer.from(decodeURIComponent(token), 'base64url').toString(),
  );
  if (!isHandoff(decoded)) throw new Error('the deep link carried no usable token');

  return { identifier: decoded.identifier, state, verifier, deepLink };
}

function isHandoff(value: unknown): value is { identifier: string; state: string } {
  return (
    typeof value === 'object' &&
    value !== null &&
    typeof (value as { identifier?: unknown }).identifier === 'string' &&
    typeof (value as { state?: unknown }).state === 'string'
  );
}

/** The exchange the app makes with the token the deep link carried. */
function exchange(origin: string, body: unknown, requestOrigin: string) {
  return fetch(`${origin}/api/auth/electron/token`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', origin: requestOrigin },
    body: JSON.stringify(body),
  });
}

/** The code and message a refusal carries, flattened for comparison. */
async function refusal(response: Response) {
  const body = (await response.json()) as { message?: string; code?: string };

  return { status: response.status, code: body.code ?? null, message: body.message ?? null };
}

type ExchangeCase = {
  name: string;
  /** The body to send, given a token that was just handed over. */
  body: (handoff: Handoff) => unknown;
  /** The origin the app presents. */
  requestOrigin: string;
  /** How many times the app makes the call. Spending a token is one of these. */
  times?: number;
  want: Awaited<ReturnType<typeof refusal>>;
};

const handoff: ExchangeCase = {
  name: 'the token the app was handed',
  body: (h) => ({ token: h.identifier, state: h.state, code_verifier: h.verifier }),
  requestOrigin: 'kira:/',
  want: { status: 200, code: null, message: null },
};

const exchanges: ExchangeCase[] = [
  handoff,
  {
    name: 'a state the token was not issued for',
    body: (h) => ({ ...(handoff.body(h) as object), state: 'somebody-elses-state' }),
    requestOrigin: 'kira:/',
    want: { status: 400, code: 'STATE_MISMATCH', message: 'state mismatch' },
  },
  {
    name: 'a verifier that is not behind the challenge',
    body: (h) => ({ ...(handoff.body(h) as object), code_verifier: 'not-the-verifier' }),
    requestOrigin: 'kira:/',
    want: { status: 400, code: 'INVALID_CODE_VERIFIER', message: 'Invalid code verifier' },
  },
  {
    name: 'a token that was never issued',
    body: (h) => ({ ...(handoff.body(h) as object), token: 'never-issued' }),
    requestOrigin: 'kira:/',
    want: { status: 404, code: 'INVALID_TOKEN', message: 'Invalid or expired token.' },
  },
  {
    // Spending a token is the point of it: a deep link that leaks into a log
    // is worth nothing once the app it was for has used it.
    name: 'the same token a second time',
    body: (h) => handoff.body(h),
    requestOrigin: 'kira:/',
    times: 2,
    want: { status: 404, code: 'INVALID_TOKEN', message: 'Invalid or expired token.' },
  },
];

describe('signing in from the desktop app', () => {
  test.each(exchanges)(
    'the exchange answers $name',
    async ({ body, requestOrigin, times, want }) => {
      const server = await listening(ADA);
      try {
        const handed = await handOff(server.origin);

        let answered = await exchange(server.origin, body(handed), requestOrigin);
        for (let call = 1; call < (times ?? 1); call += 1) {
          answered = await exchange(server.origin, body(handed), requestOrigin);
        }

        expect(await refusal(answered)).toEqual(want);
      } finally {
        await server.stop();
      }
    },
  );

  test('the root hands over the token the callback left behind', async () => {
    const server = await listening(ADA);
    try {
      const handed = await handOff(server.origin);

      expect(handed.deepLink.startsWith('ai.kira.kairos://auth/callback#token=')).toBe(true);
      expect(handed.identifier).toBeTruthy();
    } finally {
      await server.stop();
    }
  });

  test('the root has nothing to say without a handoff to make', async () => {
    const server = await listening(ADA);
    try {
      const bare = await fetch(`${server.origin}/`, { redirect: 'manual' });

      expect(bare.status).toBe(404);
    } finally {
      await server.stop();
    }
  });

  test('the sign-in asks Microsoft for the company tenant', async () => {
    const server = await listening(ADA);
    try {
      await handOff(server.origin);

      expect(server.askedOfMicrosoft).toEqual([TENANT]);
    } finally {
      await server.stop();
    }
  });

  test('the origins Kira is driven from are origins it trusts', async () => {
    const server = await listening(ADA);
    try {
      // Asserted as configuration, not as a refusal, because Better Auth turns
      // its origin check off wholesale when `NODE_ENV` is `test` — which is what
      // `bun test` sets, via `skipOriginCheck: isTest() ? true : false` — so the
      // 403 this rule produces cannot be reached from inside the suite. Run
      // against a real process, a request that carries a session cookie and an
      // origin Kira has not trusted is refused with INVALID_ORIGIN.
      //
      // Only cookie-bearing requests are checked at all, which is the console's
      // whole write surface: signing out, and setting a role later.
      const { trustedOrigins } = await server.auth.$context;

      // Both are development origins: the desktop's own scheme, and the port the
      // console's dev server listens on. Production adds none — the base URL's
      // own origin is trusted already, and that is where the server serves the
      // console from.
      expect(trustedOrigins).toContain('ai.kira.kairos:/');
      expect(trustedOrigins).toContain('http://localhost:4101');
    } finally {
      await server.stop();
    }
  });

  test('a key minted after the handoff belongs to the user who signed in', async () => {
    const server = await listening(ADA);
    try {
      const handed = await handOff(server.origin);
      const claimed = await exchange(
        server.origin,
        { token: handed.identifier, state: handed.state, code_verifier: handed.verifier },
        'kira:/',
      );
      expect(claimed.status).toBe(200);
      expect(((await claimed.json()) as { user: { email: string } }).user.email).toBe(ADA.email);

      const minted = await fetch(`${server.origin}/api/auth/api-key/create`, {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          cookie: cookieHeader(claimed),
          origin: 'kira:/',
        },
        body: JSON.stringify({ name: 'brandons-laptop' }),
      });
      expect(minted.status).toBe(200);

      const { key } = (await minted.json()) as { key: string };
      const me = await fetch(`${server.origin}/api/me`, {
        headers: { authorization: `Bearer ${key}` },
      });

      expect(await me.json()).toEqual({
        id: expect.any(String),
        email: ADA.email,
        name: ADA.name,
      });
    } finally {
      await server.stop();
    }
  });
});
