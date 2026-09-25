# Foundry

Foundry is a desktop agent application. The desktop app runs the agent loop locally; the
platform API serves what the app cannot own on the user's machine.

## Structure

- `apps/desktop/` — Electron app: main process, preload bridge, React renderer (Astryx).
- `apps/server/` — platform API, served by Bun.
- `apps/admin/` — administration console, served to a browser.
- `packages/theme/` — the theme every surface of the product draws with.
- `docs/` — guides for people using Foundry. `docs/internal/` — conventions and procedures for
  people and agents building it. `docs/agents/` — configuration the engineering skills read.

## Development

```sh
bun install
docker compose up -d --wait   # Postgres, on port 5439 — the API keeps its state here

bun run dev:desktop   # Electron app with hot reload
bun run dev:server    # platform API on http://localhost:4100
bun run dev:admin     # administration console on http://localhost:4101/admin/

bun run dev:cliproxyapi   # the model proxy, after installing it once
bun run dev:upstream      # a fake provider, for chats that spend no quota
```

Model traffic goes through CLIProxyAPI, which holds the provider logins, so a chat needs it
running. [`docs/internal/server-development.md`](docs/internal/server-development.md) covers
installing it, signing a provider in, and the fake provider above. The same file covers the
database, including how to change its schema. Making the first administrator, which the console
needs before it will show anything, is in there too.
[`docs/internal/admin-development.md`](docs/internal/admin-development.md) covers the console
itself.

## Checks

```sh
bun run typecheck
bun run lint
bun run format:check
bun run build:desktop
bun run build:admin
```

## Packaging

```sh
bun run package:desktop   # unpacked build, for inspecting the bundle
bun run dist:desktop      # installers for the current platform
```

Targets for macOS, Windows, and Linux are configured in `apps/desktop/electron-builder.yml`.
Each platform's installer builds in its own environment. Application icons are not yet
supplied, so installers use the Electron default.
