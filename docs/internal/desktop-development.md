# Desktop development

Scope: running `apps/desktop` in development, and the parts of a developer's machine that have
to be set up by hand first.

## Signing in on Linux

Sign-in returns the app through a custom-protocol deep link:

```
ai.foundry.kairos://auth/callback#token=<one-time token>
```

The browser goes to the server, the server sends it to that address, and the operating system
looks up whatever application claims `ai.foundry.kairos`. A packaged build claims it —
`protocols` in `apps/desktop/electron-builder.yml` writes the entry. **A development build
cannot**: Electron running a script has no desktop entry, so `setAsDefaultProtocolClient`
answers false and the browser has nowhere to send the app.

The symptom is quiet. The browser finishes the Microsoft sign-in, the server creates a session,
and the app stays on the sign-in screen. Nothing appears in the main process log, because
nothing ever reached it.

**The fix is one desktop entry on your machine, once per checkout.**

```sh
cat > ~/.local/share/applications/foundry-dev.desktop <<'EOF'
[Desktop Entry]
Name=Foundry (dev)
Comment=Handle ai.foundry.kairos:// deep links for the Foundry dev app
Exec="<repo>/apps/desktop/node_modules/electron/dist/electron" "<repo>/apps/desktop" %u
Type=Application
NoDisplay=true
MimeType=x-scheme-handler/ai.foundry.kairos;
EOF

xdg-mime default foundry-dev.desktop x-scheme-handler/ai.foundry.kairos
update-desktop-database ~/.local/share/applications
```

Replace `<repo>` with the absolute path to this checkout in both places on `Exec`. The
`electron/dist/electron` binary is the stable path; do not use the `.bun/` store path, which
carries a hash that changes when the dependency is reinstalled.

`xdg-mime` may print `qtpaths: command not found`. It is harmless — the registration is
written either way.

### Check it took

```sh
xdg-settings get default-url-scheme-handler ai.foundry.kairos   # foundry-dev.desktop
```

Delivering a link by hand proves the whole route end to end, without a browser in the way:

```sh
xdg-open 'ai.foundry.kairos://auth/callback#token=whatever'
```

The app should come forward. That token is not real, so the app reports
`Code verifier not found` — which is the point: the complaint proves the link arrived.

### How it works, and what to expect

The entry starts a **second** Electron instance. That instance takes no window of its own: it
reaches the running app through the single-instance lock and hands the URL over. This is the
same route a packaged build takes, so the dev path exercises the real code.

The browser hands the link over on its own. Measured from clicking Sign in, the whole round trip
— browser, Microsoft, back into the app, key minted — takes two to four seconds, with nothing
to click in between.

A browser that was already running when you registered the entry may not know about the new
handler yet. If the first sign-in after setting this up goes nowhere, restart the browser or
simply try again; it settles.

Tokens are one-time and tied to the process that started the sign-in. A deep link from an
earlier attempt will not work, and sign-in has to finish in the app instance that began it.

### Undoing it

```sh
rm ~/.local/share/applications/foundry-dev.desktop
xdg-mime default <your-browser>.desktop x-scheme-handler/ai.foundry.kairos
update-desktop-database ~/.local/share/applications
```

### Limits

This is the freedesktop path, so it applies to Linux desktops. Other platforms are not covered
here — they register the scheme through their own mechanisms, and this document does not claim
what a development build does there.

The `Exec` line pins an absolute path to one checkout. Moving or re-cloning the repository
means editing it, or adding a second entry.

## Desktop updates

Packaged desktop builds check `https://kira.kairos-it.com/updates/desktop/` for
electron-updater metadata. The endpoint must serve `latest-mac.yml`,
`latest.yml`, or `latest-linux.yml` as appropriate, and the metadata must give
absolute GitHub Release URLs for the matching installer artifacts. Keep metadata
and assets on the same release: a manifest pointing at an older or incomplete
release can make the updater download an unusable build.

The app auto-downloads updates and offers an explicit restart in Settings.
Development builds and Linux packages other than AppImage do not update through
this feed. The macOS release must include both DMG (for first installation) and
ZIP (for electron-updater); Windows uses NSIS, and Linux uses AppImage. AppImage
updates also require the launched image to be writable. A build made before the
updater was added cannot update itself, so existing installs need one manual
upgrade to a build that includes it.

## See also

- [`frontend-debugging.md`](./frontend-debugging.md) — driving the running app over CDP.
- [`../adr/0004-sign-in.md`](../adr/0004-sign-in.md) — why sign-in returns the app this way.
