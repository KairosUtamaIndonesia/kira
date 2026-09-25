# pi's config directory is renamed to `.foundry`

Date: 2026-09-16

## Context

pi derives almost every path it owns from one value, read once from **pi's own
package.json**:

```js
const CONFIG_DIR_NAME = pkg.piConfig?.configDir || '.pi';
```

That single constant drives the global agent directory (`~/.pi/agent`, holding
`settings.json`, `skills/`, `extensions/`, `prompts/`, `themes/`) and the
project-local one (`<cwd>/.pi/skills`, `<cwd>/.pi/extensions`,
`<cwd>/.pi/settings.json`). The published package ships
`piConfig: { "configDir": ".pi" }`.

Foundry is not pi and should not leave `.pi` directories in users' project
folders or home directories. The directory name is also user-visible: it is
where their skills and settings live.

There is one env var, `PI_CODING_AGENT_DIR`, but it only moves the **global**
agent directory. Project-local paths are computed from `CONFIG_DIR_NAME`, which
is fixed at import time, so the env var cannot reach them.

## Decision

Rewrite that one field from a `postinstall` script
(`scripts/patch-pi-config-dir.mjs`), targeting every installed copy of pi on
disk. The whole rename lands from the single value — global and project-local
together. `CONFIG_DIR_NAME` becomes `".foundry"`, so `getAgentDir()` returns
`~/.foundry/agent` and project resources are read from `<cwd>/.foundry/`.

Rejected:

- **`PI_CODING_AGENT_DIR` alone.** Cheapest, but leaves `<cwd>/.pi` everywhere,
  which is the case users would actually see.
- **Bun's `patchedDependencies`.** Tried first, and it does not work here. In Bun
  1.4.2 the patch is applied to the hoisted root copy in `node_modules/`, but
  `apps/desktop` resolves pi through its own `node_modules` symlink into
  `node_modules/.bun/`, which stays unpatched. Verified on a completely clean
  install: root copy `".foundry"`, resolved copy `".pi"`, `CONFIG_DIR_NAME`
  `".pi"`. A patch that reports success while the app keeps reading `.pi` is
  worse than no patch, so the mechanism was replaced.
- **Forking pi.** Enormous cost for a config value.
- **Accepting `.pi`.** Contradicts the point of the rename.

We deliberately did _not_ also set `piConfig.name`, which would rename `APP_NAME`
and with it the env vars (`FOUNDRY_CODING_AGENT_DIR`) and the debug log
(`foundry-debug.log`). That is churn with no user-visible payoff, and it would
enlarge a patch that has to survive upgrades.

## Consequences

The script mutates an installed dependency in `node_modules`, which is not
something to do casually. It is confined to one JSON field, is idempotent and
silent on repeat installs, and does nothing when pi is absent, so it cannot fail
an install that would otherwise succeed. It runs on every install, so it also
repairs a stale copy — but only if an install happens.

The failure mode is still quiet, and now has two routes: a pi upgrade whose
manifest no longer matches what the script expects, or a `node_modules`
regenerated without running `postinstall`. In both cases `CONFIG_DIR_NAME`
reverts to `".pi"` and user skills and settings simply stop being found, with
nothing reported. `apps/desktop/src/main/pi/config-dir.test.ts` is the alarm; if
it fails, run `bun install` and check the script against the new pi version.

Two things the rename cannot reach, both worth knowing:

- **`.agents/skills`.** `package-manager.js` hardcodes a second, unrelated skills
  convention at `~/.agents/skills` and `<cwd>/.agents/skills`. It is a literal,
  not derived from `configDir`, so those directories keep their name — and pi
  will pick up a user's existing `~/.agents/skills` inside Foundry.
- **Project trust.** Project-local skills, extensions and settings are ignored
  unless the settings manager is told the project is trusted
  (`settingsManager.isProjectTrusted()`). Foundry must pass `projectTrusted`
  explicitly, which is a real decision, not a formality: project extensions
  execute code.

## Revisit when

pi makes `configDir` configurable without patching, or accepts an env var for the
project-local directory. Either would let us drop the script and the install-time
mutation that comes with it. Also revisit if pi ever reads `.agents` from
`configDir`, since that would make the two conventions one.
