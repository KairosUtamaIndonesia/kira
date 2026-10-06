import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import test from 'node:test';
import { createThemeCatalog, type ThemeExtension } from './catalog.ts';

function zip(entries: ReadonlyArray<[string, string]>): Buffer {
  const localParts: Buffer[] = [];
  const directoryParts: Buffer[] = [];
  let offset = 0;

  for (const [path, text] of entries) {
    const name = Buffer.from(path);
    const data = Buffer.from(text);
    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(20, 4);
    local.writeUInt16LE(0, 6);
    local.writeUInt16LE(0, 8);
    local.writeUInt32LE(0, 14);
    local.writeUInt32LE(data.length, 18);
    local.writeUInt32LE(data.length, 22);
    local.writeUInt16LE(name.length, 26);
    local.writeUInt16LE(0, 28);
    localParts.push(local, name, data);

    const central = Buffer.alloc(46);
    central.writeUInt32LE(0x02014b50, 0);
    central.writeUInt16LE(20, 4);
    central.writeUInt16LE(20, 6);
    central.writeUInt16LE(0, 8);
    central.writeUInt16LE(0, 10);
    central.writeUInt32LE(0, 16);
    central.writeUInt32LE(data.length, 20);
    central.writeUInt32LE(data.length, 24);
    central.writeUInt16LE(name.length, 28);
    central.writeUInt16LE(0, 30);
    central.writeUInt16LE(0, 32);
    central.writeUInt32LE(offset, 42);
    directoryParts.push(central, name);
    offset += local.length + name.length + data.length;
  }

  const directory = Buffer.concat(directoryParts);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(entries.length, 8);
  end.writeUInt16LE(entries.length, 10);
  end.writeUInt32LE(directory.length, 12);
  end.writeUInt32LE(offset, 16);
  return Buffer.concat([...localParts, directory, end]);
}

const extension: ThemeExtension = {
  namespace: 'sample',
  name: 'warm-theme',
  version: '1.0.0',
  label: 'Warm Theme',
};

test('resolves and verifies a VSIX theme package without extracting files', async () => {
  const packageBytes = zip([
    [
      'extension/package.json',
      JSON.stringify({
        publisher: extension.namespace,
        name: extension.name,
        version: extension.version,
        contributes: {
          themes: [{ label: 'Paper Light', path: './themes/light.json', uiTheme: 'vs' }],
        },
      }),
    ],
    [
      'extension/themes/light.json',
      JSON.stringify({
        type: 'dark',
        colors: { 'editor.background': '#fdfcfa' },
        tokenColors: './tokens.json',
      }),
    ],
    [
      'extension/themes/tokens.json',
      JSON.stringify([{ scope: 'keyword', settings: { foreground: '#b35017' } }]),
    ],
  ]);
  const checksum = createHash('sha256').update(packageBytes).digest('hex');
  const requests: string[] = [];
  const fetchImpl = async (input: URL) => {
    const url = String(input);
    requests.push(url);
    if (url.endsWith('/api/sample/warm-theme/1.0.0')) {
      return new Response(
        JSON.stringify({
          files: {
            download: 'https://open-vsx.org/api/sample/warm-theme/1.0.0/file/warm-theme.vsix',
            sha256: 'https://open-vsx.org/api/sample/warm-theme/1.0.0/file/warm-theme.sha256',
          },
        }),
      );
    }
    if (url.endsWith('.vsix')) return new Response(packageBytes);
    if (url.endsWith('.sha256')) return new Response(checksum);
    throw new Error(`Unexpected request: ${url}`);
  };

  const themes = await createThemeCatalog({ fetchImpl }).readPackage(extension);
  assert.equal(themes.length, 1);
  assert.equal(themes[0]?.error, false);
  const definition = JSON.parse(themes[0]!.text) as {
    name: string;
    type: string;
    tokenColors: Array<{ scope: string; settings: { foreground: string } }>;
  };
  assert.equal(definition.name, 'Paper Light');
  assert.equal(definition.type, 'light');
  assert.equal(definition.tokenColors[0]?.settings.foreground, '#b35017');
  assert.equal(requests.length, 3);
});

test('rejects package downloads from hosts outside Open VSX', async () => {
  let requests = 0;
  const fetchImpl = async () => {
    requests++;
    return new Response(
      JSON.stringify({
        files: {
          download: 'https://attacker.example/theme.vsix',
          sha256: 'https://open-vsx.org/theme.sha256',
        },
      }),
    );
  };

  await assert.rejects(
    createThemeCatalog({ fetchImpl }).readPackage(extension),
    /Unexpected Open VSX host/u,
  );
  assert.equal(requests, 1);
});
