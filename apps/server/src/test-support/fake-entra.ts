import { createServer } from 'node:http';

/** The account the fake identity provider will hand back. */
export interface EntraAccount {
  oid: string;
  tid: string;
  name: string;
  email: string;
}

export interface FakeEntra {
  /** Point Foundry's `entra.authority` at this. */
  authority: string;
  /** The tenant named in each authorize URL, in call order. */
  authorizations: string[];
  /** The tenant named in each token endpoint, in call order. */
  tokenExchanges: string[];
  stop(): Promise<void>;
}

/**
 * A stand-in for Microsoft's tenant-scoped Entra endpoints, so the sign-in
 * journey can be exercised without an account at Microsoft.
 *
 * It serves only the two calls the journey makes: the browser is redirected to
 * `authorize`, and the server exchanges the code at `token`. There is no
 * userinfo call to answer and no key set to publish, because `getUserInfo`
 * decodes the id_token it is handed rather than asking Microsoft about it, and
 * the profile-photo fetch to Graph is disabled.
 *
 * It deliberately does not enforce the tenant in the path it was asked for —
 * real Microsoft is what refuses an account from another tenant there. It
 * records the tenant instead, so a test can assert Foundry asked for the
 * company's own, which is the whole of the tenant restriction.
 */
export async function startFakeEntra(account: EntraAccount): Promise<FakeEntra> {
  // One object, filled in as the server comes up, because the request handler
  // is built before there is a port to name.
  const fake: FakeEntra = {
    authority: '',
    authorizations: [],
    tokenExchanges: [],
    stop: async () => {},
  };

  const server = createServer((request, response) => {
    // The code exchange arrives as a form body this stand-in has no use for;
    // draining it keeps the connection from stalling.
    request.resume();
    const url = new URL(request.url ?? '/', 'http://fake');
    // /<tenant>/oauth2/v2.0/<endpoint>. Another shape falls to the 404 below
    // rather than being read as an endpoint.
    const path = url.pathname.split('/');
    const tenant = path[1] ?? '';
    const endpoint = path[4] ?? '';

    if (endpoint === 'authorize') {
      fake.authorizations.push(tenant);
      const back = new URL(url.searchParams.get('redirect_uri') ?? '');
      back.searchParams.set('code', crypto.randomUUID());
      back.searchParams.set('state', url.searchParams.get('state') ?? '');
      response.writeHead(302, { location: back.toString() }).end();
      return;
    }

    if (endpoint === 'token') {
      fake.tokenExchanges.push(tenant);
      response.writeHead(200, { 'content-type': 'application/json' }).end(
        JSON.stringify({
          token_type: 'Bearer',
          access_token: 'fake-access-token',
          refresh_token: 'fake-refresh-token',
          expires_in: 3600,
          id_token: idToken(account),
        }),
      );
      return;
    }

    response.writeHead(404).end();
  });

  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const address = server.address();
  if (address === null || typeof address === 'string') {
    throw new Error('the fake identity provider has no port');
  }

  fake.authority = `http://127.0.0.1:${address.port}`;
  fake.stop = () =>
    new Promise<void>((resolve, reject) =>
      server.close((error) => (error ? reject(error) : resolve())),
    );

  return fake;
}

/**
 * An id_token with no signature. Nothing on the browser path verifies it, which
 * is the finding this test exists to hold down: the token's authority comes
 * from the endpoint that answered, not from the bytes.
 */
function idToken(account: EntraAccount): string {
  const segment = (value: unknown) => Buffer.from(JSON.stringify(value)).toString('base64url');
  return [
    segment({ alg: 'none', typ: 'JWT' }),
    segment({
      aud: 'client-id',
      iss: `https://login.microsoftonline.com/${account.tid}/v2.0`,
      oid: account.oid,
      tid: account.tid,
      name: account.name,
      email: account.email,
    }),
    'signature',
  ].join('.');
}
