# 0004. Embed the Browser Panel with Tauri's `unstable` multi-webview

## Status

Accepted

## Context

Kira will add a Browser Panel: a Workspace Panel that embeds a live website and supports an Element Selector that picks a DOM element on the page and extracts a structured Element Capture. This adapts Orca's Electron `<webview>` + CDP "browser tab" and "grab mode" features.

Tauri has no DOM-embeddable webview element and no CDP. The only way to embed an arbitrary third-party site inside the app window and inject a selector overlay into it is a native child webview added to the window with explicit bounds. That API — `Window::add_child` / `WebviewBuilder` attached to an existing window — is gated behind the `unstable` Cargo feature of the `tauri` crate.

The embedded-website requirement is "open any URL", which rules out the stable alternatives.

## Decision

Kira will enable the `tauri` crate `unstable` feature to embed each Browser Panel as a native child webview via `window.add_child(WebviewBuilder, position, size)`.

- The native child webview loads the site with `WebviewUrl::External(url)`.
- The Element Selector overlay is injected with `WebviewBuilder::initialization_script` (it runs in the remote page's own world on each navigation).
- The injected script returns Element Captures and navigation events via the raw IPC `window.ipc.postMessage`, received by `WebviewBuilder::on_ipc`; the backend drives the page with `webview.eval` and pushes events to the frontend with `app.emit`.
- All multi-webview / `unstable` calls are confined to the backend `browser` module so the blast radius of API churn is one file.
- The `tauri` dependency is pinned to an exact patch (current resolved version `2.11.2`) rather than a `^2` range, so an `unstable` API change cannot land via an unattended minor bump.

## Rejected alternatives

- **`<iframe>` in the React app**: rejected. Most real sites block embedding with `X-Frame-Options` / `frame-ancestors`, and the same-origin policy prevents the Element Selector from reading cross-origin DOM. Fails the "open any website" requirement.
- **A separate `WebviewWindow` per site**: rejected. It cannot be docked or split as a Workspace Panel and breaks the dockview model.
- **Staying on stable Tauri without embedding**: rejected. There is no stable API to embed a third-party site inside a window region.

## Consequences

- Kira accepts a non-semver-stable dependency; the `unstable` API can change between Tauri minors. The pin + single-module isolation are the containment strategy, and Tauri upgrades must re-verify the Browser Panel.
- There is no first-class hide/show for child webviews (tauri-apps/tauri #11126). When a Browser Panel is hidden or inactive, the backend repositions its webview off-screen and restores it on activation.
- The native child webview renders above the DOM, so React overlays that must sit on top of the page require shrinking or moving the page webview while they are shown.
- Browser View process state is runtime-owned and not persisted; the Persistence Store keeps only the Browser Panel's last URL to restore the panel, consistent with ADR 0001's treatment of Terminal Panels.
- Multi-platform support (Windows WebView2, macOS WKWebView, Linux WebKitGTK) must be verified for `add_child`, init scripts, and `window.ipc.postMessage`.
