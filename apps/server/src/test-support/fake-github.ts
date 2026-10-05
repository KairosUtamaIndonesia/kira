import { createServer } from 'node:http';

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
  stop(): Promise<void>;
}

/**
 * A stand-in for the parts of GitHub's App API Kira calls: the installation
 * itself, and the repositories that installation can see.
 *
 * It records the App JWT rather than verifying it — real GitHub is what checks
 * the signature, and the point of the stand-in is that Kira signs and sends one
 * at all, and reads what comes back.
 */
export async function startFakeGitHub(installation: FakeInstallation): Promise<FakeGitHub> {
  const fake: FakeGitHub = {
    apiBaseUrl: '',
    tokens: [],
    repositoryPages: [],
    stop: async () => {},
  };

  const server = createServer((request, response) => {
    // Requests here carry no body this stand-in needs; draining keeps the
    // connection from stalling.
    request.resume();
    const authorization = request.headers.authorization ?? '';
    if (authorization.startsWith('Bearer ')) {
      fake.tokens.push(authorization.slice('Bearer '.length));
    }

    const url = new URL(request.url ?? '/', 'http://fake');
    // /app/installations/<id> and /app/installations/<id>/repositories
    const parts = url.pathname.split('/').filter((each) => each !== '');
    if (
      parts[0] !== 'app' ||
      parts[1] !== 'installations' ||
      Number(parts[2]) !== installation.id
    ) {
      response.writeHead(404).end();
      return;
    }

    if (parts[3] === 'repositories') {
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

    if (parts[3] === undefined) {
      response.writeHead(200, { 'content-type': 'application/json' }).end(
        JSON.stringify({
          account: { login: installation.login, type: installation.type },
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
