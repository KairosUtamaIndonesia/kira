# Kira v3 — A new foundation

Kira v3 is a complete rewrite focused on making AI a first-class part of your local development environment. Agent threads are now persistent, organized by project and
session. The workspace is built around you — dockable panels for terminal, source control, browser, and file explorer. Everything is faster, the agent runtime runs
side-by-side with your app, and team management is coming through the cloud console.

This is just the start. More surface, more capability, more agentic.

## [3.4.1](https://github.com/KairosUtamaIndonesia/kira/compare/v3.4.0...v3.4.1) (2026-07-02)


### Bug Fixes

* add TTL cache to explorer file reference suggestions ([60602f7](https://github.com/KairosUtamaIndonesia/kira/commit/60602f71d8552d90f5b7de91496ae8f82ce7490c))
* keep agent thread tree state in sync after socket events and abort ([7d2b939](https://github.com/KairosUtamaIndonesia/kira/commit/7d2b939081e5df1b352fd1bb100fdec02b7dab5a))

## [3.4.0](https://github.com/KairosUtamaIndonesia/kira/compare/v3.3.1...v3.4.0) (2026-07-01)


### Features

* add steer queue, resend/edit commands, and forkable tree nodes ([ddd5448](https://github.com/KairosUtamaIndonesia/kira/commit/ddd5448e13f18dab8bc91f89545a9c48ebe472f0))
* **agent-thread:** virtualize transcript with @tanstack/react-virtual ([968f2ef](https://github.com/KairosUtamaIndonesia/kira/commit/968f2ef7132a885b5b976ea2dc152f3d3b7bb83b))
* **agent:** added brd/fsd/tsd skill ([ef17397](https://github.com/KairosUtamaIndonesia/kira/commit/ef17397244e3f8541fb676a51135d629fefb7bd9))
* **agent:** refine agent thinking block presentation in transcript ([ec0932b](https://github.com/KairosUtamaIndonesia/kira/commit/ec0932b0d00b6e7ad27bc56509353de2ab8a8bb3))
* **login:** improved styling on login callback page ([ea7ea26](https://github.com/KairosUtamaIndonesia/kira/commit/ea7ea26b876022e3b28f256d1e261c24c900b702))


### Bug Fixes

* replace div role=button with native button in ThinkingBlock ([439e516](https://github.com/KairosUtamaIndonesia/kira/commit/439e516f6f7f80f6031f49cac5fee122745e7174))
* revert to Monaco DiffEditor for agent thread tool diffs ([de323e5](https://github.com/KairosUtamaIndonesia/kira/commit/de323e5942bf04bd07cddc4998c7d5655102a622))

## [3.3.1](https://github.com/KairosUtamaIndonesia/kira/compare/v3.3.0...v3.3.1) (2026-06-26)


### Bug Fixes

* **desktop:** auto-start agent runtime before preparing agent thread ([876c496](https://github.com/KairosUtamaIndonesia/kira/commit/876c496d65c98cb1014335e6c636c80b2b8a8ce2))

## [3.3.0](https://github.com/KairosUtamaIndonesia/kira/compare/v3.2.0...v3.3.0) (2026-06-26)


### Features

* **desktop:** show app version in status bar and improve agent runtime ([0eb07c3](https://github.com/KairosUtamaIndonesia/kira/commit/0eb07c3e1ee65986880ccc9111e2381a334d162e))


### Bug Fixes

* **desktop:** correct reasoning capability handling in pi-model ([b2806f1](https://github.com/KairosUtamaIndonesia/kira/commit/b2806f12d0ecab854fdd3acadce8090fca9202ee))
* prevent release-please formatting drift in tauri.conf.json ([5eca7ee](https://github.com/KairosUtamaIndonesia/kira/commit/5eca7ee04bf866d8b1f2648df09f1ebfa28af96c))
* remove package-name from release-please config to fix post-merge component mismatch ([99a76b1](https://github.com/KairosUtamaIndonesia/kira/commit/99a76b13942783151d4d1e78c57b099a3c6b3623))

## [3.2.0](https://github.com/KairosUtamaIndonesia/kira/compare/v3.1.0...v3.2.0) (2026-06-25)


### Features

* **agent:** updated thinking block ([20d454a](https://github.com/KairosUtamaIndonesia/kira/commit/20d454a23ee071e8af9f9612d75b4b2017e429a0))
* expose model thinking level ([cf8873d](https://github.com/KairosUtamaIndonesia/kira/commit/cf8873d080cdaca746aebc9d8a9011a1dfccd9b2))


### Bug Fixes

* **desktop:** repair agent-thread resend — race, duplicate, and edge ([e29322d](https://github.com/KairosUtamaIndonesia/kira/commit/e29322d37d1ab3e0c29a7435cc9f457ca999c149))
* restore configId and permissions in desktop models verifyApiKey call ([#105](https://github.com/KairosUtamaIndonesia/kira/issues/105)) ([1c86554](https://github.com/KairosUtamaIndonesia/kira/commit/1c86554109b4437f5117977d7f4413123c21e68f))

## [3.1.0](https://github.com/KairosUtamaIndonesia/kira/compare/v3.0.2...v3.1.0) (2026-06-23)


### Features

* fixed agent stopping mid response ([#104](https://github.com/KairosUtamaIndonesia/kira/issues/104)) ([b69238d](https://github.com/KairosUtamaIndonesia/kira/commit/b69238dab321dc8378ecfc967fa72e61e00036a6))
* recursive fuzzy file reference picker with ([#103](https://github.com/KairosUtamaIndonesia/kira/issues/103)) ([f3af3c5](https://github.com/KairosUtamaIndonesia/kira/commit/f3af3c5be31b2429a93d25c5ee1303313eb0807a))


### Bug Fixes

* **ci:** remove mold from Linux release build ([e4dcf2e](https://github.com/KairosUtamaIndonesia/kira/commit/e4dcf2e80c9711608c6657538dfb4798dc43cf25))

## [3.0.2](https://github.com/KairosUtamaIndonesia/kira/compare/v3.0.1...v3.0.2) (2026-06-23)


### Bug Fixes

* **ci:** add KIRA_CLOUD_URL env to lint-check and test-rust jobs ([216f6e1](https://github.com/KairosUtamaIndonesia/kira/commit/216f6e18856144010154af3d6a28f0bcf0e9beb9))
* **updater:** register updater and process plugins in Tauri builder ([13b8e0c](https://github.com/KairosUtamaIndonesia/kira/commit/13b8e0c9578ae07cb8023284a3801f8edf7e72ad))

## [3.0.1](https://github.com/KairosUtamaIndonesia/kira/compare/v3.0.0...v3.0.1) (2026-06-23)


### Bug Fixes

* release agent-pi session memory on panel close, add WebGL terminal and Bun missing dialog ([#98](https://github.com/KairosUtamaIndonesia/kira/issues/98)) ([8445284](https://github.com/KairosUtamaIndonesia/kira/commit/8445284826a26a87be7994c0195e5b467d38ca5c))

## v3.0.0

### Bug Fixes

- fix(desktop): forward `bun run tauri build` args through turbo by adding `--` separator ([d2fec43](https://github.com/KairosUtamaIndonesia/kira/commit/d2fec43))

### Code Refactoring

- refactor(desktop): simplify agent_runtime, fix staging path, add version-based cache check ([d2fec43](https://github.com/KairosUtamaIndonesia/kira/commit/d2fec43))
