import { createServer } from 'node:http';

/** The installation access token every mint hands back, so a test can name it. */
export const INSTALLATION_TOKEN = 'ghs_fake_installation_token';

/** What the stand-in GitHub will answer about one installation. */
export interface FakeInstallation {
  id: number;
  login: string;
  type: string;
  repositories: { owner: string; name: string; defaultBranch?: string }[];
}

export interface FakeGitHub {
  /** Point Kira's `git.apiBaseUrl` at this. */
  apiBaseUrl: string;
  /** Every App JWT the stand-in was handed, in call order. */
  tokens: string[];
  /** The `page` each repositories request asked for, in call order. */
  repositoryPages: number[];
  /** The bearer each repositories request carried, in call order. */
  repositoryTokens: string[];
  stop(): Promise<void>;
}

/**
 * A stand-in for the parts of GitHub's API Kira calls: the installation itself,
 * the access token minted from it, and the repositories that token can read.
 *
 * It mirrors the real routes, including the one Kira must not use: the
 * App-authenticated repositories path is a 404 here, as it is on GitHub, so a
 * regression to it fails rather than passing on a stand-in's agreement. The JWT
 * is recorded rather than verified — real GitHub is what checks the signature.
 */
export async function startFakeGitHub(installation: FakeInstallation): Promise<FakeGitHub> {
  const fake: FakeGitHub = {
    apiBaseUrl: '',
    tokens: [],
    repositoryPages: [],
    repositoryTokens: [],
    stop: async () => {},
  };

  const server = createServer((request, response) => {
    // Requests here carry no body this stand-in needs; draining keeps the
    // connection from stalling.
    request.resume();
    const bearer = (request.headers.authorization ?? '').replace(/^Bearer /, '');
    // Only the App's own JWT is a three-part token; an installation token is not.
    if (bearer.split('.').length === 3) fake.tokens.push(bearer);

    const url = new URL(request.url ?? '/', 'http://fake');
    // /app/installations/<id>/..., and /installation/...
    const parts = url.pathname.split('/').filter((each) => each !== '');
    const owned =
      parts[0] === 'app' &&
      parts[1] === 'installations' &&
      Number(parts[2]) === installation.id;

    if (request.method === 'POST' && owned && parts[3] === 'access_tokens') {
      response.writeHead(201, { 'content-type': 'application/json' }).end(
        JSON.stringify({
          token: INSTALLATION_TOKEN,
          expires_at: new Date(Date.now() + 3_600_000).toISOString(),
        }),
      );
      return;
    }

    if (owned && parts[3] === undefined) {
      response.writeHead(200, { 'content-type': 'application/json' }).end(
        JSON.stringify({ account: { login: installation.login, type: installation.type } }),
      );
      return;
    }

    if (parts[0] === 'installation' && parts[1] === 'repositories') {
      fake.repositoryTokens.push(bearer);
      if (bearer !== INSTALLATION_TOKEN) {
        response.writeHead(401).end();
        return;
      }

      // GitHub's own paging: `per_page` per page, and a `Link` to the next one
      // while any repository is left over.
      const page = Math.max(1, Number(url.searchParams.get('page') ?? '1'));
      const perPage = Math.max(1, Number(url.searchParams.get('per_page') ?? '30'));
      fake.repositoryPages.push(page);

      const start = (page - 1) * perPage;
      const slice = installation.repositories.slice(start, start + perPage);
      const headers: Record<string, string> = { 'content-type': 'application/json' };
      if (start + perPage < installation.repositories.length) {
        const host = request.headers.host ?? '127.0.0.1';
        headers.link = `<http://${host}${url.pathname}?per_page=${perPage}&page=${page + 1}>; rel="next"`;
      }

      response.writeHead(200, headers).end(
        JSON.stringify({
          total_count: installation.repositories.length,
          repositories: slice.map((each) => ({
            name: each.name,
            full_name: `${each.owner}/${each.name}`,
            default_branch: each.defaultBranch ?? 'main',
            owner: { login: each.owner },
          })),
        }),
      );
      return;
    }

    response.writeHead(404).end();
  });

  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const address = server.address();
  if (address === null || typeof address === 'string') {
    throw new Error('the fake GitHub App API has no port');
  }

  fake.apiBaseUrl = `http://127.0.0.1:${address.port}`;
  fake.stop = () =>
    new Promise<void>((resolve, reject) =>
      server.close((error) => (error ? reject(error) : resolve())),
    );

  return fake;
}

