# The desktop's key rests in the main process, encrypted by the OS

Date: 2026-09-17

## Context

ADR 0004 has the server issue the desktop a Foundry key after sign-in. Something
has to hold that key between launches: it must survive relaunch, never leave the
main process, be revocable server-side, and be destroyed on sign out.

The obvious answers are worse than they look. The OS keychain library,
`keytar`, is archived — last release February 2022, a native module, and the
reason VS Code left it is that it was archived. A plaintext file gives away the
one property the design exists for. Electron's own `safeStorage` is the right
primitive, but it has a trap that decides the implementation.

Evidence and sources: `docs/internal/research/api-key-storage.md`.

## Decision

**The key is `safeStorage` ciphertext in one small JSON file under
`app.getPath('userData')`, read and written by the main process only, and only
when the OS really has a keyring.** When it does not, the key lives in
main-process memory for that session and the user signs in again next launch.
Plaintext is never written silently.

**The availability check cannot be the async one.** Electron now recommends the
async `safeStorage` API, but on Linux its provider list ends in a fallback that
hands out a hardcoded key —
`PBKDF2-HMAC-SHA1(1 iteration, key = "peanuts", salt = "saltysalt")` — while
declaring `UseForEncryption() { return true; }`. So on a machine with no keyring
`isAsyncEncryptionAvailable()` resolves **true** and encrypts with a key anyone
can reproduce. The sync check fails closed instead: Electron's docs say it
"returns true if the app has emitted the `ready` event and the secret key is
available", and Electron ORs in a plaintext opt-in that defaults off.

So: **ask with the sync probe**, `isEncryptionAvailable()` and
`getSelectedStorageBackend() !== 'basic_text'`, and **do the round trip with the
async API**, which is non-blocking and honours `shouldReEncrypt`. Both calls wait
for `app.whenReady()` and a settled app name — probing earlier creates a macOS
Keychain entry named "Chromium Safe Storage", shared across Electron apps.

**One key per install, named for the device, with an expiry.** Revocation is the
lever; expiry is the backstop, since Better Auth's `api-key` plugin has no
rotate-in-place — rotation is create, deliver, revoke.

**An invalid key means signed out.** On `401`/`403` or a `KEY_*` error, delete
the blob and return to sign-in. A `5xx` or a network failure must keep it and
surface the failure, or a server blip signs the whole company out.

## Consequences

Where the OS cannot encrypt, users sign in on every launch. That is the accepted
cost of never writing a plaintext key: a silent plaintext fallback would buy
exactly one sign-in and give away the property the whole design exists for. The
two precedents that do write plaintext — VS Code behind `--password-store=basic`,
Signal behind a dialog whose default is "quit" — both make it explicit, never
silent.

Destroying the key on the machine means destroying the ciphertext. The Keychain
item protecting it belongs to Electron, is named for the app, and cannot be
deleted by the app, so **server-side revocation is the act that actually takes a
key out of circulation**, and signing out is the local half.

A macOS signing-identity change, or an unsigned development build, costs one
sign-in rather than a crash: a blob that will not decrypt is "not signed in".
This has to be wired deliberately — `apps/desktop/src/main/index.ts` currently
treats any boot failure as fatal (`catch` → `app.quit()`), which an
undecryptable key must not reach.

No new dependency. `electron-store`'s own `encryptionKey` is documented as "not
intended for security purposes", and the protection here comes from `safeStorage`
rather than the file format — the file's job is to be `0600` and written
atomically.

## Considered options

**`keytar`** — archived, unmaintained, a native module needing `libsecret-1-dev`
on Linux, and no longer recommended by Electron for credential storage.

**Plaintext in a JSON file** — no, silently.

**Memory-only always** — simplest and least surprising, and rejected only because
a daily browser round trip on every launch is a worse cost than one small
encrypted file for the common case where a keyring exists.

**Keeping the key in the same store as Better Auth's session cookie** — Better
Auth's Electron integration already wraps its own cookie in `safeStorage`, so
this is the same pattern rather than a competing one. Left open rather than
decided: the session and the key have different lifetimes, and one store for both
is a choice to make when the desktop code exists.

## Revisit when

Electron's async path gains a real availability signal, or the sync API is
removed — at which point the probe is the part to re-check.
