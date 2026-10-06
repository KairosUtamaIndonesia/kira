import { createHash } from 'node:crypto';
import path from 'node:path';
import { parseVSCodeJson } from '@kira/theme/vscodeJson';
import { openThemeArchive } from './archive.ts';

const CATALOG_HOSTS = new Set(['open-vsx.org', 'openvsx.eclipsecontent.org']);
const MAX_SEARCH_BYTES = 1024 * 1024;
const MAX_PACKAGE_BYTES = 20 * 1024 * 1024;
const MAX_RESOLVED_THEME_BYTES = 512 * 1024;
type ThemeCatalogFetch = (url: URL, init?: RequestInit) => Promise<Response>;

export interface ThemeExtension {
  namespace: string;
  name: string;
  version: string;
  label: string;
}

export interface ThemePackageItem {
  path: string;
  name: string;
  text: string;
  error: boolean;
}

function objectIn(value: unknown): Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value))
    throw new Error('Invalid Open VSX response.');
  return value as Record<string, unknown>;
}

function identifierIn(value: unknown): string {
  if (
    typeof value !== 'string' ||
    value.length < 1 ||
    value.length > 160 ||
    !/^[\w-]+$/u.test(value)
  ) {
    throw new Error('Invalid theme package identity.');
  }
  return value;
}

function versionIn(value: unknown): string {
  if (
    typeof value !== 'string' ||
    value.length < 1 ||
    value.length > 80 ||
    !/^[\w.+-]+$/u.test(value)
  ) {
    throw new Error('Invalid theme package version.');
  }
  return value;
}

function trustedUrl(value: string): URL {
  const url = new URL(value);
  if (
    url.protocol !== 'https:' ||
    !CATALOG_HOSTS.has(url.hostname) ||
    url.port !== '' ||
    url.username !== '' ||
    url.password !== ''
  )
    throw new Error('Unexpected Open VSX host.');
  return url;
}

async function download(
  fetchImpl: ThemeCatalogFetch,
  initialUrl: string | URL,
  maxBytes: number,
  signal: AbortSignal,
): Promise<Buffer> {
  let url = String(initialUrl);
  for (let redirects = 0; redirects < 4; redirects++) {
    const response = await fetchImpl(trustedUrl(url), { signal, redirect: 'manual' });
    if ([301, 302, 303, 307, 308].includes(response.status)) {
      const location = response.headers.get('location');
      await response.body?.cancel();
      if (!location) throw new Error('Open VSX returned an invalid redirect.');
      url = new URL(location, url).href;
      continue;
    }
    if (
      !response.ok ||
      !response.body ||
      Number(response.headers.get('content-length')) > maxBytes
    ) {
      await response.body?.cancel();
      throw new Error('Open VSX request failed.');
    }

    const reader = response.body.getReader();
    const chunks: Uint8Array[] = [];
    let length = 0;
    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        length += value.byteLength;
        if (length > maxBytes) throw new Error('Open VSX response is too large.');
        chunks.push(value);
      }
    } finally {
      await reader.cancel();
      reader.releaseLock();
    }
    return Buffer.concat(chunks, length);
  }
  throw new Error('Too many Open VSX redirects.');
}

function themePath(from: string, reference: string): string {
  if (/[\\\0:]/u.test(reference) || reference.startsWith('/'))
    throw new Error('Invalid theme path.');
  const resolved = path.posix.normalize(path.posix.join(path.posix.dirname(from), reference));
  if (!resolved.startsWith('extension/')) throw new Error('Theme path escapes the package.');
  return resolved;
}

function parseRecord(text: string): Record<string, unknown> {
  return objectIn(parseVSCodeJson(text));
}

function recordOrEmpty(value: unknown): Record<string, unknown> {
  if (value === undefined) return {};
  return objectIn(value);
}

function extensionFrom(value: unknown): ThemeExtension | null {
  try {
    const item = objectIn(value);
    return {
      namespace: identifierIn(item.namespace),
      name: identifierIn(item.name),
      version: versionIn(item.version),
      label:
        typeof item.displayName === 'string' && item.displayName.length <= 160
          ? item.displayName
          : identifierIn(item.name),
    };
  } catch {
    return null;
  }
}

function uiThemeType(value: unknown): string | undefined {
  if (value === 'vs') return 'light';
  if (value === 'vs-dark') return 'dark';
  if (value === 'hc-black') return 'hc';
  if (value === 'hc-light') return 'hc-light';
  return undefined;
}

export function createThemeCatalog({ fetchImpl = fetch }: { fetchImpl?: ThemeCatalogFetch } = {}) {
  async function search(
    query: string,
    signal = AbortSignal.timeout(15_000),
  ): Promise<ThemeExtension[]> {
    const normalized = query.trim();
    if (normalized.length < 1 || normalized.length > 160)
      throw new Error('Enter a search term up to 160 characters.');
    const url = new URL('https://open-vsx.org/api/-/search');
    url.search = new URLSearchParams({
      query: normalized,
      category: 'Themes',
      size: '24',
      sortBy: 'relevance',
    }).toString();
    const body = JSON.parse(
      (await download(fetchImpl, url, MAX_SEARCH_BYTES, signal)).toString('utf8'),
    ) as { extensions?: unknown };
    if (!Array.isArray(body.extensions))
      throw new Error('Open VSX returned an invalid search result.');
    return body.extensions
      .slice(0, 24)
      .map(extensionFrom)
      .filter((item): item is ThemeExtension => item !== null);
  }

  async function readPackage(
    input: ThemeExtension,
    signal = AbortSignal.timeout(45_000),
  ): Promise<ThemePackageItem[]> {
    const requested = {
      namespace: identifierIn(input.namespace),
      name: identifierIn(input.name),
      version: versionIn(input.version),
    };
    const detailsUrl = `https://open-vsx.org/api/${requested.namespace}/${requested.name}/${requested.version}`;
    const details = objectIn(
      JSON.parse(
        (await download(fetchImpl, detailsUrl, MAX_SEARCH_BYTES, signal)).toString('utf8'),
      ),
    );
    const files = objectIn(details.files);
    if (typeof files.download !== 'string' || typeof files.sha256 !== 'string')
      throw new Error('Open VSX package details are incomplete.');
    const packageBytes = await download(fetchImpl, files.download, MAX_PACKAGE_BYTES, signal);
    const checksumText = (await download(fetchImpl, files.sha256, 256, signal))
      .toString('utf8')
      .trim();
    const checksum = checksumText.split(/\s+/u)[0];
    if (
      !checksum ||
      !/^[\da-f]{64}$/iu.test(checksum) ||
      createHash('sha256').update(packageBytes).digest('hex') !== checksum.toLowerCase()
    ) {
      throw new Error('VSIX checksum does not match.');
    }

    const read = openThemeArchive(packageBytes);
    const manifest = parseRecord(await read('extension/package.json'));
    if (
      typeof manifest.publisher !== 'string' ||
      manifest.publisher.toLowerCase() !== requested.namespace.toLowerCase() ||
      manifest.name !== requested.name ||
      manifest.version !== requested.version
    )
      throw new Error('VSIX identity does not match Open VSX.');

    const contributions = objectIn(manifest.contributes);
    if (!Array.isArray(contributions.themes) || contributions.themes.length > 40)
      throw new Error('Invalid VSIX theme list.');
    let totalBytes = 0;

    const resolveTheme = async (file: string): Promise<Record<string, unknown>> => {
      const ancestors: string[] = [];
      let reads = 0;
      const load = async (current: string): Promise<Record<string, unknown>> => {
        signal.throwIfAborted();
        if (ancestors.includes(current) || ancestors.length >= 8 || ++reads > 320)
          throw new Error('Too many VS Code theme references.');
        ancestors.push(current);
        const source = parseRecord(await read(current));
        const parent =
          typeof source.include === 'string' ? await load(themePath(current, source.include)) : {};
        const tokenColors =
          typeof source.tokenColors === 'string'
            ? parseVSCodeJson(await read(themePath(current, source.tokenColors)))
            : (source.tokenColors ?? []);
        if (!Array.isArray(tokenColors)) throw new Error('Invalid theme token rules.');
        ancestors.pop();
        return {
          ...parent,
          ...source,
          include: undefined,
          colors: { ...recordOrEmpty(parent.colors), ...recordOrEmpty(source.colors) },
          semanticTokenColors: {
            ...recordOrEmpty(parent.semanticTokenColors),
            ...recordOrEmpty(source.semanticTokenColors),
          },
          tokenColors: [
            ...(Array.isArray(parent.tokenColors) ? parent.tokenColors : []),
            ...tokenColors,
          ],
        };
      };
      return load(file);
    };

    const items: ThemePackageItem[] = [];
    for (const contribution of contributions.themes) {
      const details =
        typeof contribution === 'object' && contribution !== null && !Array.isArray(contribution)
          ? (contribution as Record<string, unknown>)
          : {};
      try {
        const theme = details;
        if (
          typeof theme.path !== 'string' ||
          typeof theme.label !== 'string' ||
          theme.label.length > 160
        )
          throw new Error('Invalid VSIX theme entry.');
        const file = themePath('extension/package.json', theme.path);
        const definition = await resolveTheme(file);
        definition.name = theme.label;
        const type = uiThemeType(theme.uiTheme);
        if (type) definition.type = type;
        const text = JSON.stringify(definition);
        const size = Buffer.byteLength(text);
        totalBytes += size;
        if (size > MAX_RESOLVED_THEME_BYTES || totalBytes > 10 * 1024 * 1024)
          throw new Error('Resolved themes are too large.');
        items.push({ path: theme.path, name: theme.label, text, error: false });
      } catch {
        signal.throwIfAborted();
        items.push({
          path: typeof details.path === 'string' ? details.path : '',
          name: typeof details.label === 'string' ? details.label : 'Theme',
          text: '',
          error: true,
        });
      }
    }
    return items;
  }

  return { search, readPackage };
}
