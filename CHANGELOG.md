# Kira v3 — A new foundation

Kira v3 is a complete rewrite focused on making AI a first-class part of your local development environment. Agent threads are now persistent, organized by project and
session. The workspace is built around you — dockable panels for terminal, source control, browser, and file explorer. Everything is faster, the agent runtime runs
side-by-side with your app, and team management is coming through the cloud console.

This is just the start. More surface, more capability, more agentic.

## [3.0.1](https://github.com/KairosUtamaIndonesia/kira/compare/v3.0.0...v3.0.1) (2026-06-23)


### Bug Fixes

* release agent-pi session memory on panel close, add WebGL terminal and Bun missing dialog ([#98](https://github.com/KairosUtamaIndonesia/kira/issues/98)) ([8445284](https://github.com/KairosUtamaIndonesia/kira/commit/8445284826a26a87be7994c0195e5b467d38ca5c))

## v3.0.0

### Bug Fixes

- fix(desktop): forward `bun run tauri build` args through turbo by adding `--` separator ([d2fec43](https://github.com/KairosUtamaIndonesia/kira/commit/d2fec43))

### Code Refactoring

- refactor(desktop): simplify agent_runtime, fix staging path, add version-based cache check ([d2fec43](https://github.com/KairosUtamaIndonesia/kira/commit/d2fec43))
