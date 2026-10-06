import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { Elysia } from 'elysia';

/**
 * Where the console is built. The server serves it from its own origin in
 * production, which is what makes the session cookie first-party and the console
 * one address rather than a dev server beside an API.
 */
const DEFAULT_DIRECTORY = fileURLToPath(new URL('../../admin/dist/', import.meta.url));

/**
 * What the console's own page is allowed to load.
 *
 * Everything is its own origin; styles allow inline because StyleX and the
 * component library set style attributes, and fonts and images are the build's
 * own files. `frame-ancestors 'none'` keeps an administrator's session out of
 * anybody's frame.
 */
const CSP = [
  "default-src 'self'",
  "script-src 'self'",
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' data:",
  "font-src 'self'",
  "connect-src 'self'",
  "base-uri 'none'",
  "form-action 'self'",
  "frame-ancestors 'none'",
].join('; ');

/**
 * The built console, as files.
 *
 * A path that names a file is served as it is; anything else falls back to the
 * entry page, so a deep link like `/admin/users/:id` survives a refresh. Hashed
 * assets are immutable; everything else is no-cache, so a new build is picked up
 * the moment the entry page is. The directory is a parameter so a test can serve
 * a fixture rather than depending on a build having happened.
 */
export function createAdminConsole(directory: string = DEFAULT_DIRECTORY) {
  const root = resolve(directory);

  const serve = async ({ request }: { request: Request }) => {
    const relative = decodeURIComponent(new URL(request.url).pathname.replace(/^\/admin\/?/, ''));
    const file = await fileFor(root, relative);
    const target = file ?? (await fileFor(root, 'index.html'));

    if (target === null) {
      return new Response('The console has not been built.', { status: 404 });
    }

    const immutable = file !== null && relative.startsWith('assets/');
    const headers = new Headers({
      'content-security-policy': CSP,
      'x-content-type-options': 'nosniff',
      'cache-control': immutable ? 'public, max-age=31536000, immutable' : 'no-cache',
    });

    const served = Bun.file(target);
    if (served.type) headers.set('content-type', served.type);

    return new Response(served, { headers });
  };

  // The bare `/admin` is served as the entry page too, so no redirect is needed
  // and a deep link and the root of the console are the same shape.
  return new Elysia().get('/admin', serve).get('/admin/*', serve);
}

/** The absolute path of a file inside the console, or null when there is none. */
async function fileFor(root: string, relative: string): Promise<string | null> {
  const candidate = resolve(root, relative === '' ? 'index.html' : relative);

  // A path that climbs out of the console is not a file it has, whatever it names.
  if (candidate !== root && !candidate.startsWith(`${root}/`)) return null;

  return (await Bun.file(candidate).exists()) ? candidate : null;
}
