# Frontend debugging

Scope: the Foundry Electron window in `apps/desktop/src/renderer/`.

Use the running desktop app through `agent-browser` rather than treating the renderer as a
plain browser page. The dev launcher exposes Electron's Chrome DevTools Protocol (CDP) on
`127.0.0.1:1987`.

## Start the app

Run:

```sh
bun run dev:desktop
```

The CDP flag is part of the `dev:desktop` script, so it applies to development only. Restart
an already-running dev app after changing that script. Confirm the endpoint before driving the
UI:

```sh
curl -fsS http://127.0.0.1:1987/json/version
```

On Linux, a development build cannot receive the deep link sign-in returns through, so it sits
on the sign-in screen until the scheme is registered on your machine. That is a machine setup
problem rather than a renderer one — see
[`desktop-development.md`](./desktop-development.md).

## Check `agent-browser` first

Before frontend debugging, verify that the CLI is installed:

```sh
command -v agent-browser
```

If it is unavailable, tell the user that UI debugging cannot continue until `agent-browser` is
installed. Direct them to the official project at <https://agent-browser.dev> or
<https://github.com/vercel-labs/agent-browser>, and give them the standard install commands:

```sh
npm install -g agent-browser
agent-browser install
```

On Linux, if the installer reports missing system libraries, the user can run:

```sh
agent-browser install --with-deps
```

Do not claim that the app was visually verified when the CLI is unavailable. Continue with
source-level checks only, or ask the user to install it and return.

Once installed, load the Electron-specific instructions when needed:

```sh
agent-browser skills get electron --full
```

## Drive the Electron app

Connect to Foundry's CDP port, inspect the accessibility tree, and use the returned element
references:

```sh
agent-browser connect 1987
agent-browser tab
agent-browser snapshot -i
agent-browser click @e1
agent-browser fill @e2 "text"
agent-browser press Enter
```

Take a new snapshot after navigation, a click that changes the view, or any state change;
references from an old snapshot are not reliable. Use `agent-browser screenshot` for visual
checks and `agent-browser console` for renderer errors. Use a named session when other browser
work is running:

```sh
agent-browser --session foundry connect 1987
agent-browser --session foundry snapshot -i
```

If connecting fails, check that the dev app was launched with `bun run dev:desktop`, that the
process was restarted after the CDP script change, and that port 1987 is not already occupied.

## Safety

CDP grants full control of the local Electron app, including JavaScript execution and visible
user data. Keep port 1987 bound to localhost and use it only on a trusted development machine.
Do not add the CDP flag to production or packaging commands.

## Done means

A frontend change is debugged when the relevant flow has been exercised through
`agent-browser` on CDP port 1987, the expected UI state has been observed, and relevant
console errors have been checked. If the CLI was missing, report that limitation explicitly.
