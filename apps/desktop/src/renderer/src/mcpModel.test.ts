import { strict as assert } from 'node:assert';
import { test } from 'node:test';
import {
  blankForm,
  buildDraft,
  joinCommand,
  parseSnippet,
  splitCommand,
  type FormValues,
} from './mcpModel.ts';

const splits: [string, string, string[]][] = [
  ['one word', 'node', ['node']],
  ['spaces and newlines', 'npx  -y\n@scope/server\n', ['npx', '-y', '@scope/server']],
  ['double quotes keep a space', 'run "my file.txt" now', ['run', 'my file.txt', 'now']],
  ['single quotes keep a space', "run 'a b'", ['run', 'a b']],
  ['an empty pair of quotes is an argument', 'cmd ""', ['cmd', '']],
  ['nothing', '   ', []],
];

for (const [name, text, expected] of splits) {
  test(`splitCommand: ${name}`, () => {
    assert.deepEqual(splitCommand(text), expected);
  });
}

test('splitCommand round-trips through joinCommand', () => {
  const tokens = ['npx', '-y', 'a b', '', 'say "hi"'];
  assert.deepEqual(splitCommand(joinCommand(tokens)), tokens);
});

const stdio = (change: Partial<FormValues>): FormValues => ({
  ...blankForm(),
  name: 'coolify',
  command: 'npx -y @scope/coolify',
  ...change,
});
const http = (change: Partial<FormValues>): FormValues => ({
  ...blankForm(),
  name: 'astryx',
  transport: 'streamable-http',
  url: ' https://mcp.example.com ',
  ...change,
});

const drafts: [string, FormValues, Record<string, unknown>][] = [
  [
    'a local command is split into command and arguments',
    stdio({}),
    { command: 'npx', args: ['-y', '@scope/coolify'], cwd: null, url: null, scope: 'global' },
  ],
  [
    'a working folder is kept for a local command only',
    stdio({ cwd: ' /srv ', url: 'https://ignored' }),
    { cwd: '/srv', url: null },
  ],
  [
    'a workspace scope carries its id',
    stdio({ scope: 'ws-1' }),
    { scope: 'workspace', workspaceId: 'ws-1' },
  ],
  [
    'environment rows become one record, blank rows dropped',
    stdio({
      env: [
        { key: 'API_TOKEN', value: 'x' },
        { key: '', value: '' },
      ],
    }),
    { credentials: { env: { API_TOKEN: 'x' } } },
  ],
  [
    'clearing saved credentials wins over rows',
    stdio({ clearCredentials: true, env: [{ key: 'A', value: '1' }] }),
    { credentials: { env: null } },
  ],
  [
    'a link is trimmed and keeps no command',
    http({}),
    { url: 'https://mcp.example.com', command: '', args: [], cwd: null },
  ],
  [
    'a bearer token and headers are sent together',
    http({ bearerToken: 't', headers: [{ key: 'x-api-key', value: 'k' }] }),
    { credentials: { bearerToken: 't', headers: { 'x-api-key': 'k' } } },
  ],
  [
    'clearing a remote server clears both',
    http({ clearCredentials: true }),
    { credentials: { headers: null, bearerToken: null } },
  ],
];

for (const [name, form, expected] of drafts) {
  test(`buildDraft: ${name}`, () => {
    const built = buildDraft(form);
    assert.ok('draft' in built, JSON.stringify(built));
    for (const [key, value] of Object.entries(expected)) {
      assert.deepEqual((built.draft as unknown as Record<string, unknown>)[key], value, key);
    }
  });
}

const refusals: [string, FormValues, string][] = [
  ['no name', stdio({ name: '  ' }), 'Give the server a name.'],
  ['no command', stdio({ command: ' ' }), 'Add the command that starts the server.'],
  ['no link', http({ url: '' }), 'Add the link to the server.'],
  [
    'a value with no name',
    stdio({ env: [{ key: '', value: 'x' }] }),
    'Give every environment variable a name.',
  ],
  [
    'a repeated name',
    stdio({
      env: [
        { key: 'A', value: '1' },
        { key: 'A', value: '2' },
      ],
    }),
    'A is listed twice.',
  ],
];

for (const [name, form, error] of refusals) {
  test(`buildDraft refuses ${name}`, () => {
    assert.deepEqual(buildDraft(form), { error });
  });
}

const snippets: [string, string, Record<string, unknown>][] = [
  [
    'a named entry under mcpServers',
    '{"mcpServers":{"pg":{"command":"npx","args":["-y","pkg","a b"],"env":{"URL":"x"}}}}',
    {
      name: 'pg',
      transport: 'stdio',
      command: 'npx -y pkg "a b"',
      env: [{ key: 'URL', value: 'x' }],
    },
  ],
  [
    'a bare server with a link',
    '{"url":"https://mcp.example.com","headers":{"x-key":"k"}}',
    {
      transport: 'streamable-http',
      url: 'https://mcp.example.com',
      headers: [{ key: 'x-key', value: 'k' }],
    },
  ],
  ['a map of one name', '{"docs":{"url":"https://d.example"}}', { name: 'docs' }],
];

for (const [name, text, expected] of snippets) {
  test(`parseSnippet: ${name}`, () => {
    const found = parseSnippet(text);
    assert.ok(!('error' in found), JSON.stringify(found));
    for (const [key, value] of Object.entries(expected)) {
      assert.deepEqual((found as Record<string, unknown>)[key], value, key);
    }
  });
}

for (const [name, text, error] of [
  ['text that is not JSON', 'npx -y x', 'That is not valid JSON.'],
  [
    'an object with no server in it',
    '{"a":1,"b":2}',
    'Paste one server: its command or url, or a map of one name to them.',
  ],
  [
    'a server with neither command nor url',
    '{"x":{"args":[]}}',
    'The snippet needs a command or a url.',
  ],
] as const) {
  test(`parseSnippet refuses ${name}`, () => {
    assert.deepEqual(parseSnippet(text), { error });
  });
}
