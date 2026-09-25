# Where the desktop stores its Kira key

Date: 2026-09-17
Status: research for the key-storage decision (ADR 0004 issues the key; nothing yet
decides where it rests). Companion to ADR 0003, 0004 and 0005.

Terminology follows `CONTEXT.md`: **key** is what the desktop presents to Kira.
"Token" and "credential" appear below only where a source uses them.

## Bottom line

Persist the key as `safeStorage` ciphertext in one small JSON file under
`app.getPath('userData')`, written and read by the **main process only**, and only
when the OS really has a keyring. When it does not, keep the key in main-process
memory for the session and make the user sign in again next launch — never write
plaintext. This is what VS Code's `SecretStorage`, Signal Desktop and Better Auth's
own Electron integration all do, and it is the smallest thing that satisfies "must
survive relaunch, never sent anywhere but our server, revocable, destroyed on sign
out".

The one non-obvious part: **the async `safeStorage` API, which Electron now
recommends, cannot tell you whether encryption is real on Linux.** Its Linux fallback
provider encrypts with a hardcoded key, and the async availability check reports that
as "available". The availability decision must come from the sync probe
(`isEncryptionAvailable()` plus `getSelectedStorageBackend() !== 'basic_text'`); the
encrypt/decrypt round trip should use the async API.

## 1. What `safeStorage` actually is

Electron's own description: "Allows access to simple encryption and decryption of
strings for storage on the local machine… This module adds extra protection to data
being stored on disk by using OS-provided cryptography systems."
(Main process only. <https://www.electronjs.org/docs/latest/api/safe-storage>)

| platform | where the key lives                                                                                      | the docs' own claim about protection                                                                                                                                                                                             |
| -------- | -------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| macOS    | Keychain Access, per app                                                                                 | "prevents other applications from loading them without user override… content is protected from other users and other apps running in the same userspace"                                                                        |
| Windows  | DPAPI                                                                                                    | "Typically, only a user with the same logon credential as the user who encrypted the data can typically decrypt the data… protected from other users on the same machine, but not from other apps running in the same userspace" |
| Linux    | a secret store chosen from the desktop environment: `kwallet`, `kwallet5`, `kwallet6`, `gnome-libsecret` | "the security semantics… vary between window managers and secret stores"                                                                                                                                                         |

Two more caveats the same page states: on macOS (and on Linux when a password manager
is present) these calls "can block the current thread to collect user input"; and on
macOS the app must be code signed "for `safeStorage` to behave consistently", because
otherwise "macOS may not recognize different builds of your app as the same
application, which can cause the Keychain to re-prompt the user for permission on every
update" (also
<https://www.electronjs.org/docs/latest/tutorial/code-signing#macos-apis-that-require-code-signing>).

### Linux with no keyring: the important case

The docs: "not all Linux setups have an available secret store. If no secret store is
available, items stored in using the `safeStorage` API will be unprotected as they are
encrypted via hardcoded plaintext password. You can detect when this happens when
`safeStorage.getSelectedStorageBackend()` returns `basic_text`."

The underlying semantics are sharper than that paragraph suggests. Chromium's header
for the sync implementation says `IsEncryptionAvailable()` on Linux "returns true iff
the real secret key (not hardcoded one) is available" — a hardcoded key means **false**.
Electron ORs in a plaintext opt-in:

```cc
// abridged: the Linux branch compares the storage-backend string to "basic_text"
bool SafeStorage::IsEncryptionAvailable() {
  if (!electron::Browser::Get()->is_ready()) return false;
#if BUILDFLAG(IS_LINUX)
  return OSCrypt::IsEncryptionAvailable() ||
         (use_password_v10_ && /* backend == "basic_text" */);
#else
  return OSCrypt::IsEncryptionAvailable();
#endif
}
```

`use_password_v10_` defaults to `false` and is only flipped by
`safeStorage.setUsePlainTextEncryption(true)`.
(<https://github.com/electron/electron/blob/v44.4.1/shell/browser/api/electron_api_safe_storage.cc>,
<https://github.com/electron/electron/blob/v44.4.1/shell/browser/api/electron_api_safe_storage.h>;
header comment from Chromium
<https://chromium.googlesource.com/chromium/src/+/refs/tags/131.0.6778.258/components/os_crypt/sync/os_crypt.h>)

So, on Linux without a keyring, the sync API **fails closed**: `encryptString` throws
("Encryption is not available") unless the app has explicitly opted into hardcoded-key
encryption. `getSelectedStorageBackend()` is how you name the situation — `basic_text`
when the desktop environment is unrecognised, plus `unknown` before `ready`.

**Before `app.whenReady()`:** `isEncryptionAvailable()` returns false and
`encryptString`/`decryptString` throw "safeStorage cannot be used before app is ready";
the async equivalents reject. On Linux this guard exists because calling it early used
to segfault (<https://github.com/electron/electron/issues/32206>). On macOS calling
before ready also creates the Keychain entry under the name **"Chromium Safe Storage"**
rather than the app's, which the reporter notes "doesn't sound like a good idea…
_especially_ Chromium"; the issue is still open
(<https://github.com/electron/electron/issues/45328>). An older, now-closed issue records
the entry name _changing_ once a `BrowserWindow` exists, which broke decryption
(<https://github.com/electron/electron/issues/34614>). Practical rule: set
`app.name`/product name first, wait for `ready`, and only then touch `safeStorage`.

### The async API, and why it must not be the availability check

Electron 42 added `isAsyncEncryptionAvailable()`, `encryptStringAsync()`,
`decryptStringAsync()` (returning `{ result, shouldReEncrypt }`), and the docs now
recommend them: "non-blocking, supports key rotation, and handles temporary
unavailability gracefully. The synchronous API may be deprecated in a future version"
(first shipped in
<https://github.com/electron/electron/blob/v42.0.0/docs/api/safe-storage.md>, released
2026-05-06, and present in `v44.4.1`, the version this app uses; introduced by
<https://github.com/electron/electron/pull/49054>, merged 2026-02-15, milestone-less
`semver/major`; the actual deprecation PR
<https://github.com/electron/electron/pull/51314> is still unmerged, so in Electron 44
the sync API is only _documented_ as being on the way out).

On Linux the async path installs, in precedence order
(<https://github.com/electron/electron/blob/v44.4.1/shell/browser/browser_process_impl.cc>):

1. `SecretPortalKeyProvider` (15) — the `org.freedesktop.portal.Secret` D-Bus interface,
   feature-gated;
2. `FreedesktopSecretKeyProvider` (10) — Secret Service (gnome-keyring/KWallet), with the
   entry named `<app name> Keys` / `<app name> Safe Storage`;
3. `PosixKeyProvider` (5) — "On other POSIX systems, this is the only key provider. On
   Linux, it is used as a fallback."

That fallback is not protection. Chromium's `PosixKeyProvider` hands out a constant,
hardcoded AES-128-CBC key and declares itself fit for encryption:

```cc
void PosixKeyProvider::GetKey(KeyCallback callback) {
  Encryptor::Key key(kV10Key, mojom::Algorithm::kAES128CBC);
  std::move(callback).Run(kEncryptionTag, std::move(key));
}
bool PosixKeyProvider::UseForEncryption() { return true; }
```

(<https://chromium.googlesource.com/chromium/src/+/refs/heads/main/components/os_crypt/async/browser/posix_key_provider.cc>)

`OSCryptAsync` walks every provider, keeps every key it gets, and remembers the
highest-precedence one that says `UseForEncryption()`
(<https://chromium.googlesource.com/chromium/src/+/refs/heads/main/components/os_crypt/async/browser/os_crypt_async.cc>).
Electron resolves `isAsyncEncryptionAvailable()` to true as soon as that encryptor
exists. Net effect: **on a Linux machine with no keyring, the async API reports success
and encrypts with a key anyone can reproduce, while the sync check returns false.** The
docs' Linux-async bullet ("A fallback provider is used for environments without a secret
service available") is accurate but easy to read as reassurance.

This is also why the sync path is on its way out upstream: current Chromium `main` no
longer has `components/os_crypt/sync` at all
(<https://chromium.googlesource.com/chromium/src/+/refs/heads/main/components/os_crypt/>).

### Portability and limits of the encrypted buffer

Electron's docs make no portability promise — the module is for "storage on the local
machine". The platform semantics decide the rest: on Windows, "typically, only a user
with logon credentials that match those of the user who encrypted the data can decrypt
the data. In addition, decryption usually can only be done on the computer where the
data was encrypted" (roaming profiles are the documented exception)
(<https://learn.microsoft.com/en-us/windows/win32/api/dpapi/nf-dpapi-cryptprotectdata>);
on macOS the Keychain item is scoped to the app's code-signing identity, which is why
an inconsistent signature re-prompts. Treat the blob as belonging to one OS user on one
machine. Note this is inference from the platform semantics, not a sentence Electron
writes — Electron's own docs were called out as too thin on exactly these limits in
<https://github.com/electron/electron/issues/42318>, which is why the current version
states the per-platform "protected from / not protected from" wording so carefully.

The docs are also explicit that this is not protection from other processes running as
the same user on Windows; the practical adversary model is "another user of the machine,
or a backup/disk image", not "another app running as you".

## 2. `keytar`

Dead for our purposes.

- The repository is archived (`"archived": true`, last push 2022-12-12,
  <https://api.github.com/repos/atom/node-keytar>); the last release, 7.9.0, was
  published 2022-02-17 (<https://registry.npmjs.org/keytar>). npm carries no deprecation
  notice, and the maintainers are GitHub Desktop's own developers, which is why GitHub
  Desktop still ships `keytar@^7.8.0`
  (<https://github.com/desktop/desktop/blob/development/app/package.json>).
- It is a native module (per-platform prebuilds; needs `libsecret-1-dev` on Linux,
  <https://github.com/atom/node-keytar>), which is the reason VS Code gave for leaving.
- VS Code's 1.80 release notes: "Due to the deprecation and archiving of keytar, we
  looked for other solutions for the problem, specifically looking to our runtime,
  Electron… we've started the move from keytar to Electron's safeStorage API"
  (<https://code.visualstudio.com/updates/v1_80>; tracking issue
  <https://github.com/microsoft/vscode/issues/185677>).
- Electron does **not** recommend keytar for credential storage anywhere in its current
  docs. The only mention left is an aside in `systemPreferences` about Keychain access
  control constants
  (<https://www.electronjs.org/docs/latest/api/system-preferences>).

Verdict: not maintained, not recommended, and adding a native dependency we do not need.

## 3. What production Electron apps actually do

Verified against source or first-party docs. Closed-source apps are marked.

**VS Code (open source — closest analogue).** `EncryptionMainService` is a thin wrapper
over `safeStorage.encryptString`/`decryptString`, plus `getSelectedStorageBackend()` for
the UI and `isEncryptionAvailable()`
(<https://github.com/microsoft/vscode/blob/main/src/vs/platform/encryption/electron-main/encryptionMainService.ts>).
`SecretStorageService` writes the ciphertext into VS Code's own application storage under
`secret://<key>`, and — the important part — when encryption is not available it falls
back to **in-memory storage**, so secrets simply do not persist; a secret that fails to
decrypt is deleted rather than retried
(<https://github.com/microsoft/vscode/blob/main/src/vs/platform/secrets/common/secrets.ts>).
Plaintext is only used if the user passes `--password-store=basic`, and then VS Code
calls `safeStorage.setUsePlainTextEncryption(true)` itself
(same `encryptionMainService.ts`).

**Signal Desktop (open source — an app whose database key is exactly our problem).** The
SQLCipher key is stored as hex ciphertext of `safeStorage.encryptString` under
`encryptedKey` in `config.json`. Availability is computed as `app.isPackaged && … &&
safeStorage.isEncryptionAvailable() && backend !== 'basic_text'` — it does
not _use_ `safeStorage` in unpackaged/test builds — its comment: "Don't use safeStorage if
not packaged and building preload cache or running test-electron to avoid blocking prompt
on macOS CI". It records the Linux backend next to the ciphertext and treats a changed backend as
an error it cannot decrypt; if decryption yields a value that disagrees with the legacy
plaintext key it asks the user once: copy the error and quit, or continue with a
plaintext key (<https://github.com/signalapp/Signal-Desktop/blob/main/app/main.main.ts>,
`getSQLKey`/`handleSafeStorageDecryptionError`).

**GitHub Desktop (open source).** Still keytar, behind a three-function `TokenStore`
(<https://github.com/desktop/desktop/blob/development/app/src/lib/stores/token-store.ts>);
`docs/contributing/setup-linux.md` lists `libsecret-1.so.0` as a requirement. Treated
here as evidence that a maintained-by-the-owners keytar still works, not as a
recommendation.

**Slack (closed source).** Slack's own help page: "The Slack desktop app uses Keychain to
store your account information"
(<https://slack.com/help/articles/115003653183-Grant-Keychain-access-to-Slack>). A
SpecterOps analysis reports that on macOS Slack's cookies are encrypted with a
`Slack Safe Storage` key in the login Keychain and on Windows with DPAPI
(<https://specterops.io/blog/2023/11/09/abusing-slack-for-offensive-operations-part-2/>) —
i.e. Chromium's own `os_crypt`, the same mechanism `safeStorage` wraps. Consistent with
`safeStorage`, but third-party for the mechanism.

**1Password (closed source, but well documented).** Their model is not a stored session
key. For SSO accounts: "Your device stores its device key in platform-protected key
storage" on iOS/macOS/Android, and on **Windows and Linux** the device key is "obfuscated
on-disk" (<https://support.1password.com/sso-security/>). Obfuscation is acceptable there
only because the device key alone does not unlock the vault. 1Password's public Electron
work (`electron-hardener`) is about hardening fuses/command-line flags against runtime
patching, not about secret storage
(<https://github.com/1Password/electron-hardener>). Their example does not transfer: our
key alone _is_ access.

**Linear, Cursor (closed source).** I could not verify either app's behaviour. What exists
is third-party: for the Linear _CLI_ (not the desktop app) an issue reports API keys in
plaintext at `~/.config/linear/credentials.toml` and proposes the OS keyring
(<https://github.com/schpet/linear-cli/issues/130>); for Cursor, LayerX and independent
researchers report auth tokens and model API keys stored unencrypted in `state.vscdb`
and readable by any installed extension
(<https://layerxsecurity.com/blog/cursorjacking-every-cursor-user-is-vulnerable-to-api-key-theft-by-rogue-extensions/>,
<https://github.com/EladNahman/cursor-token-research>). Neither should be read as
evidence about the Linear desktop app, and both are unconfirmed by the vendors.

The pattern that survives verification: encrypt with the OS, put the ciphertext in your
own store, and when the OS cannot help, do not persist — or make plaintext an explicit,
user-visible choice.

## 4. Main process only, never through the preload

Electron's security guidance
(<https://www.electronjs.org/docs/latest/tutorial/security>):

- `contextIsolation` is the default since Electron 12 and is **required** for real
  isolation; "even when `nodeIntegration: false` is used, to truly enforce strong
  isolation and prevent the use of Node primitives `contextIsolation` **must** also be
  used." Disabling it also disables process sandboxing.
- Sandboxing is the default since Electron 20. A "sandboxed renderer won't have a Node.js
  environment initialized. Therefore… renderer processes can only perform privileged
  tasks… by delegating these tasks to the main process via inter-process communication"
  (<https://www.electronjs.org/docs/latest/tutorial/sandbox>). A sandboxed preload gets a
  polyfilled subset of Node — an allowlisted `require` (`electron` limited to
  `contextBridge`, `crashReporter`, `ipcRenderer`, `nativeImage`, `webFrame`, `webUtils`,
  plus `events`, `timers`, `url`) — and the same page warns the preload "is substantially
  more privileged than that of a sandboxed renderer", so it can still leak privileged
  APIs unless `contextIsolation` is on.
- Item 20 of the checklist: "Do not expose Electron APIs to untrusted web content" —
  specifically `ipcRenderer.on` and callback passthrough, because the event object hands
  back the sender. Item 17: validate the sender's frame origin in `ipcMain` handlers.

`safeStorage` is a main-process module, so it is not reachable from a sandboxed preload
anyway. The shape this implies for Kira is already the shape `docs/internal/desktop-conventions.md`
describes: the window learns "signed in as X / not signed in" over `ipc/`, and nothing
else. No decrypt call crosses the seam, no key crosses the seam, no `safeStorage` handle
crosses the seam.

Better Auth's Electron page says the same thing in its own words: "You should never expose
the authClient directly to the renderer process. Instead, create an IPC bridge… Also make
sure not to expose any sensitive data like tokens or cookies to the renderer process to
mitigate injection attacks"
(<https://www.better-auth.com/docs/integrations/electron>).

## 5. Failure modes, and what the fallback should be

| situation                                          | what happens                                                                                                                                                                                                                                                                                 | what to do                                                                                               |
| -------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------- |
| macOS, unsigned/ad-hoc or changed signing identity | Keychain does not recognise the build as the same app: repeated prompts, or access denied after a reinstall/signing change. Electron documents this; Signal avoids `safeStorage` entirely in unpackaged builds                                                                               | persist only in shipped builds; accept that a signing-identity change costs one sign-in                  |
| macOS, first `safeStorage` call before `ready`     | Keychain entry created as "Chromium Safe Storage", shared name across Electron apps                                                                                                                                                                                                          | set the app name and wait for `ready`; never probe early                                                 |
| Linux, no keyring daemon                           | sync `isEncryptionAvailable()` is false; async says available and uses a hardcoded key                                                                                                                                                                                                       | treat as "cannot persist"; memory only                                                                   |
| Linux, keyring exists but is not detected          | e.g. unrecognised `XDG_CURRENT_DESKTOP` (<https://github.com/electron/electron/issues/39789>), Plasma 6 sync KWallet path bug in the Electron 42 era (<https://github.com/electron/electron/issues/53230>), Flatpak needing the portal (<https://github.com/electron/electron/issues/50534>) | same: do not persist, sign in again — a false negative costs one sign-in, a false positive costs the key |
| Linux, backend changed between launches            | ciphertext written under one keyring cannot be decrypted with another (Signal's `SafeStorageBackendChangeError`)                                                                                                                                                                             | store the backend name beside the ciphertext; a mismatch is "not signed in", not a crash                 |
| Windows, DPAPI                                     | the blob belongs to the logon credential. A changed password is handled (master keys are re-encrypted; recovery on a domain uses the DC backup key), but a machine/profile that loses those master keys leaves the blob unreadable                                                           | decrypt failure → re-auth                                                                                |
| anything: decrypt throws                           | the key is gone (keychain item deleted, restored profile, new machine)                                                                                                                                                                                                                       | clear the blob, treat as signed out, sign in again                                                       |

**Should we ever write plaintext?** No. The two precedents that do it make it an explicit
choice: VS Code only when the user passes `--password-store=basic`, Signal only after a
dialog whose default button is "copy error and quit". Neither is silent. Since our key is
re-issuable by signing in again, a silent plaintext fallback buys the user one sign-in and
costs the property the whole design exists for. Memory-only is the fallback.

**Is ciphertext-in-a-JSON-file acceptable?** Yes, and it is what the reference
implementations do: Better Auth's own Electron storage is base64 ciphertext inside a
`conf` JSON file (see §6), Signal writes hex ciphertext into `config.json`, VS Code writes
ciphertext into its application storage. The protection comes from `safeStorage`, not from
the file format; the file's job is to be 0600 and written atomically. Do not confuse this
with `electron-store`'s own `encryptionKey`, which its README says is "**not intended for
security purposes**, since the encryption key would be easily found inside a plain-text
Node.js app. Its main use is for obscurity"
(<https://github.com/sindresorhus/electron-store>). We do not need `electron-store` at
all: one small file under `userData` written with `node:fs` is a few clear lines.

## 6. What `@better-auth/electron` does on the client

Better Auth documents the pattern and implements it — but only for the session cookie, not
for an api key.

- Docs: install `@better-auth/electron`; the client takes a `storage` with
  `getItem`/`setItem`; "If you'd rather not implement your own storage solution, we offer a
  default option" — install `conf` and pass `storage()`. `setupMain()` must run before the
  app is ready; `setupRenderer()` goes in the preload; sandbox mode requires bundling the
  preload import (<https://www.better-auth.com/docs/integrations/electron>).
- The default storage adapter is `conf`, i.e. a plain JSON file in
  `app.getPath('userData')`, with no encryption of its own
  (<https://github.com/better-auth/better-auth/blob/main/packages/electron/src/storage.ts>).
- The client plugin wraps that storage with `safeStorage`: cookies and the local session
  cache are stored as base64 of `safeStorage.encryptString(value)` and read back with
  `decryptString` — and if `safeStorage.isEncryptionAvailable()` is false, those values
  are held **in memory only** (`getDecrypted` returns null, so nothing is persisted across
  a restart) (<https://github.com/better-auth/better-auth/blob/main/packages/electron/src/client.ts>,
  `storageAdapter`).
- It also counts the session cookie as a "session key" in that memory map, clears the
  cookie cache on sign-out, and reads cookies for requests from the main process only.
- Package version at the time of writing: `@better-auth/electron@1.7.5`
  (<https://registry.npmjs.org/@better-auth/electron>).
- There is no api-key integration in the Electron package: nothing in
  `packages/electron/src/` knows about `apiKey` (listing:
  <https://github.com/better-auth/better-auth/tree/main/packages/electron/src>). Creating
  the key after sign-in and persisting it is our code.

So the recommendation is not a new pattern: it is Better Auth's own pattern, applied to the
one value Better Auth does not store for us. If we keep the key in the same store the
session cookie uses (or reuse the same `storageAdapter` shape), there is one encrypted
store rather than two, and one availability decision rather than two.

## 7. Rotation, expiry, and an invalid key

What Better Auth's `api-key` plugin gives us
(<https://www.better-auth.com/docs/plugins/api-key>,
<https://www.better-auth.com/docs/plugins/api-key/advanced>,
<https://www.better-auth.com/docs/plugins/api-key/reference>):

- keys are rows: per key there is an id, a name, optional `metadata`, `permissions`,
  `expiresAt`, `remaining`, `refillInterval`/`refillAmount`, per-key rate limits, and an
  enabled/disabled flag; `updateApiKey` changes those fields, `deleteApiKey` removes the
  key, `listApiKeys` enumerates them, `verifyApiKey` validates one;
- `expiresIn` is unset by default — "the `expiresAt` is set to `null`. This means that the
  API key will never expire";
- **there is no rotate-in-place.** The key value is generated at creation; rotation means
  create a new key, hand it to the client, revoke the old one;
- error codes to branch on: `KEY_NOT_FOUND`, `KEY_DISABLED`, `KEY_EXPIRED`,
  `USAGE_EXCEEDED`, `RATE_LIMIT_EXCEEDED`, `INVALID_API_KEY`
  (<https://github.com/better-auth/better-auth/blob/main/packages/api-key/src/error-codes.ts>);
- avoid `enableSessionForAPIKeys`: the docs call it "generally not recommended, as it can
  lead to security issues if not used carefully. A leaked api key can be used to
  impersonate a user."

What this implies for the desktop:

1. **One key per install, named for the device**, so "cut off a machine" is a server-side
   revoke of one row while the other devices keep working (ADR 0004 already wants signing
   out and cutting off a machine to be separate acts).
2. **Give it an expiry anyway.** A long-lived key that never expires is a permanent
   liability; 60–90 days with silent re-issue on next sign-in costs nothing, because
   signing in is a browser round trip we already have. Revocation stays the primary lever;
   expiry is the backstop.
3. **Invalid key means signed out.** On `401`/`403` (or a `KEY_*` error from our own
   endpoint): stop the run, delete the stored blob, clear the renderer's signed-in state,
   and offer sign-in again. Do not retry with the same key, and — per ADR 0003 — do not
   fall back to any local credential, because there is nothing to fall back to.
4. **Distinguish "invalid" from "unavailable".** A 5xx or a network failure must keep the
   key and surface the failure; otherwise a server blip signs the whole company out.
5. **Do not rotate on a timer client-side.** Re-issue on sign-in, revoke on sign-out or on
   a lost machine. The only other event that changes the stored value is a successful
   re-authentication, and `shouldReEncrypt` from `decryptStringAsync` (local key rotation)
   is handled by re-encrypting the blob, not the key.

## 8. What this means for Kira

Where it goes, using the conventions already in force:

- The key is a **new kind** of code in `apps/desktop/src/main/` — a store for one secret.
  It should take `safeStorage` and the user-data path as arguments, the way
  `ipc/projects.ts` takes `chooseFolder`, so `ipc/` stays free of Electron and a test can
  pass a fake. `index.ts` does the wiring, as it is the only file that imports `electron`.
- On disk: one JSON file under `app.getPath('userData')` (alongside `threads.db`), holding
  the ciphertext, the Linux backend string it was written under, and a small version field.
  Written atomically, mode 0600.
- Persist only after `app.whenReady()` and only when the probe says real encryption is
  available: `safeStorage.isEncryptionAvailable()` and, on Linux,
  `getSelectedStorageBackend() !== 'basic_text'`. Encrypt/decrypt through
  `encryptStringAsync`/`decryptStringAsync` (non-blocking, honours `shouldReEncrypt`).
  Otherwise: memory only, and the user signs in again next launch.
- Sign-out deletes the file. Note plainly: the Keychain item that protects it
  (`<app name> Safe Storage` on macOS) belongs to Electron and cannot be deleted by the
  app, so "destroy it on the machine" means destroying the ciphertext, and revocation
  server-side is the part that actually takes the key out of circulation.
- One thing to check before shipping: `index.ts` currently treats any failure during boot
  as fatal (`catch` → `console.error` → `app.quit()`). A key that cannot be decrypted must
  land in "not signed in", not in that path.

### Left unverified

- Whether `getSelectedStorageBackend()` is still populated in Electron 44 for an app that
  uses only the **async** API. `GetSelectedLinuxBackend` returns the sync backend string
  from `BrowserProcessImpl`; I read the source, I did not run it. If it turns out empty,
  the availability probe needs another answer (e.g. `FreedesktopSecretKeyProvider`
  availability) and the recommendation's gate changes.
- That `isAsyncEncryptionAvailable()` resolves true on a keyring-less Linux box. The
  provider list, the fallback provider's `UseForEncryption() == true` and `OSCryptAsync`'s
  selection loop all point that way; it should be confirmed on a bare Debian with no
  gnome-keyring/kwallet before we rely on the distinction.
- Whether `shouldReEncrypt` ever fires on macOS/Windows in practice.
- The internals of Slack, Linear and Cursor desktop (closed source; §3 says exactly what is
  and is not third-party).
- Whether Electron's sync `safeStorage` still behaves as described on Linux by the time we
  ship, given that upstream Chromium has removed the sync implementation entirely and
  Electron's own deprecation PR is in flight. The async path is where this lands; the
  availability probe is the piece to re-check on each Electron upgrade.
