/**
 * Run the local CLIProxyAPI, the process Kira's server sends model traffic
 * through in development.
 *
 * Everything it needs lives outside the checkout: the binary, the provider
 * logins and this config are all machine state, and the logins are real
 * credentials for the company's subscriptions. See
 * `docs/internal/server-development.md` for installing the binary and for how
 * the pieces fit together.
 *
 * Arguments are passed straight through, which is how the provider logins work:
 *
 *     bun run dev:cliproxyapi -- -codex-login
 */
import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, join } from 'node:path';

/** Where the binary, its credentials and its working files live. */
const ROOT = join(homedir(), '.local/share/kira/cliproxyapi');
const BINARY = join(ROOT, 'bin/cli-proxy-api');

/** The config a human edits, kept apart from what the process writes. */
const CONFIG = join(homedir(), '.config/kira/cliproxyapi.yaml');

/** The caller key Kira's server presents. A development value, nothing more. */
const POOL_KEY = 'kira-dev-pool-key';

if (!existsSync(BINARY)) {
  console.error(`no CLIProxyAPI at ${BINARY}`);
  console.error('install it first — see docs/internal/server-development.md');
  process.exit(1);
}

const authDir = join(ROOT, 'auth');
mkdirSync(authDir, { recursive: true, mode: 0o700 });
mkdirSync(dirname(CONFIG), { recursive: true });

if (existsSync(CONFIG)) {
  console.log(`config  ${CONFIG} (kept as it is)`);
} else {
  writeFileSync(CONFIG, config(authDir), { mode: 0o600 });
  console.log(`config  ${CONFIG} (written)`);
}
console.log(`logins  ${authDir}`);
console.log(`key     ${POOL_KEY}`);
console.log('');

const child = Bun.spawn({
  cmd: [BINARY, '-config', CONFIG, ...process.argv.slice(2)],
  stdio: ['inherit', 'inherit', 'inherit'],
});
process.exitCode = await child.exited;

/**
 * The config this machine runs with. Written once and then left alone, so an
 * edit survives: delete the file to get a fresh one.
 *
 * Two departures from the shipped example matter. `host` is loopback rather
 * than the example's empty string, which binds every interface — the proxy
 * holds the company's logins and only Kira talks to it. And the management
 * API is left off, because its key can read and rewrite every credential in
 * the auth directory; switch it on deliberately when the usage cross-check is
 * wanted.
 */
function config(authDir: string): string {
  return `# Kira's development CLIProxyAPI. Written by scripts/dev-cliproxyapi.ts
# when it was missing; edit it freely, or delete it to have it written again.
#
# Provider logins are written into auth-dir below by the login flags, for
# example \`bun run dev:cliproxyapi -- -codex-login\`. They are real credentials
# and must never be committed or copied into the repository.

host: "127.0.0.1"
port: 8317

auth-dir: "${authDir}"

# What Kira's server presents as its caller key.
api-keys:
  - "${POOL_KEY}"

# The management API is off: its key can read and rewrite every login above.
# remote-management:
#   secret-key: "kira-dev-management-key"

# A stand-in for a provider, so the chain can be exercised without spending
# subscription quota. Start it with \`bun run dev:upstream\`, and delete this
# block to work against real logins only.
openai-compatibility:
  - name: "fake-upstream"
    base-url: "http://127.0.0.1:8318/v1"
    api-key-entries:
      - api-key: "fake-upstream-key"
    models:
      - name: "fake-model"
        alias: "fake-model"
        display-name: "Fake Model"
        max-context-length: 128000
        input-modalities: [text, image]
`;
}
