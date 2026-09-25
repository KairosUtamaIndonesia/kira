# CLIProxyAPI: the interface Foundry proxies against

Date: 2026-09-18
Status: research for the server-side proxy. Everything below is read from source at the
pinned release, not from running the binary unless a section says otherwise.

**Pinned to `router-for-me/CLIProxyAPI` `v7.3.7`**, commit
`b773607e3e7756dc6020a291825e4eb08899595a` (tag date 2026-09-18 03:17:06 +0800, release
published 2026-09-17T19:19:20Z, not a prerelease;
<https://github.com/router-for-me/CLIProxyAPI/releases/tag/v7.3.7>). All source citations
use that tag:
`https://github.com/router-for-me/CLIProxyAPI/blob/v7.3.7/<path>#L<line>`.

Source was read from a shallow clone of that tag. Nothing here was verified by sending
live traffic to a running instance; that limit is called out per section.

## Bottom line

CLIProxyAPI is a single Go HTTP server that fronts provider subscription logins behind an
OpenAI-shaped API. For Foundry the implementable facts are: it listens on `:8317` by
default with **no loopback default** — `host: ""` binds every interface, so the VPS deploy
must set `host: 127.0.0.1`; callers authenticate with a flat, unnamed list of secrets in
`api-keys` presented as `Authorization: Bearer <key>`; provider logins live as JSON files
under `auth-dir` (`~/.cli-proxy-api` by default) and there is **no file lock** on that
directory; the routes Foundry needs are `POST /v1/chat/completions` and `GET /v1/models`,
both faithful OpenAI shapes, with Anthropic (`/v1/messages`) and Gemini (`/v1beta/...`)
surfaces alongside; streaming is SSE and the final usage chunk is an OpenAI-style
usage-only chunk with `choices: []`; and an exhausted credential pool returns HTTP 429
`{"error":{"code":"model_cooldown",... "reset_seconds":N}}` with a matching `Retry-After`
header. There is **no per-caller-key usage or quota endpoint** and no way to restrict one
caller key to a subset of models. It also ships a `/v0/management` API and a bundled web
Management Center that reconfigures the pool over HTTP, and it watches its config file and
`auth-dir` so credentials can be added while it runs. Reasoning level is not a request
field but a **suffix on the model name** — see section 10.

## 1. Identity and distribution

The repository is confirmed: `router-for-me/CLIProxyAPI` (`full_name`, MIT, default branch
`main`; <https://github.com/router-for-me/CLIProxyAPI>,
<https://api.github.com/repos/router-for-me/CLIProxyAPI>). Note the module path in this
release is `/v7`, not `/v6` — `go.mod` and all internal imports are
`github.com/router-for-me/CLIProxyAPI/v7`; `docs/sdk-access.md` still says `/v6` and is
stale.

It is a proxy server that exposes provider subscription logins behind OpenAI-, Gemini-,
Claude- and Codex-compatible API endpoints (README: "a proxy server that provides
OpenAI/Gemini/Claude/Codex/Grok compatible API interfaces for CLI",
<https://github.com/router-for-me/CLIProxyAPI/blob/v7.3.7/README.md>).

|                  |                                                                                                                                                                                                                               |
| ---------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Current release  | `v7.3.7`, 2026-09-17 (<https://github.com/router-for-me/CLIProxyAPI/releases/tag/v7.3.7>)                                                                                                                                     |
| Run as binary    | release archives `CLIProxyAPI_7.3.7_linux_amd64.tar.gz` etc. (release assets; same URL). Binary is built from `./cmd/server/` — `Dockerfile:22`                                                                               |
| Run as Docker    | image `eceasy/cli-proxy-api` (`.github/workflows/docker-image.yml` env `DOCKERHUB_REPO`, tags `latest-amd64`/`latest-arm64`/versioned; `docker-compose.yml:3` uses `${CLI_PROXY_IMAGE:-eceasy/cli-proxy-api:latest}`)         |
| Config file      | `config.yaml`, resolved next to the process working directory when `-config` is not given (`cmd/server/main.go:589`, and `defaultPluginBootstrapConfigPath` → `filepath.Join(wd, "config.yaml")` at `cmd/server/main.go:877`) |
| In the image     | config at `/CLIProxyAPI/config.yaml`, workdir `/CLIProxyAPI` (`docker-compose.yml:16-20`, `Dockerfile:36-38`)                                                                                                                 |
| Default auth dir | `~/.cli-proxy-api` (`internal/config/config_defaults.go:6`, `DefaultAuthDir`); Docker mounts it at `/root/.cli-proxy-api` (`docker-compose.yml:17`)                                                                           |

A full annotated template is committed as `config.example.yaml` (995 lines). The
`-config` flag overrides the path (`cmd/server/main.go:150`). When `-config` is absent the
file is optional: `config.LoadConfigOptional` is used (`cmd/server/main.go:589`).

`auth-dir` is the default credential store, but the binary also supports Postgres, Git and
object-storage token stores selected by environment (`PGSTORE_DSN`, `GITSTORE_GIT_URL`,
`OBJECTSTORE_ENDPOINT`; `cmd/server/main.go:274-311`, which call `.AuthDir()` on the store).
Treat files as the default deployment.

## 2. Listen address and port

Default is `host: ""` and `port: 8317`. The config keys are the top-level `host` and
`port` (`config.example.yaml:3,6`; Go fields `Config.Host`/`Config.Port` at
`internal/config/config.go:12,14`). The server address is built as
`fmt.Sprintf("%s:%d", cfg.Host, cfg.Port)` (`internal/api/server.go:250`).

**The default binds all interfaces, not loopback.** The shipped comment is explicit:
`# Server host/interface to bind to. Default is empty ("") to bind all interfaces (IPv4 +
IPv6). # Use "127.0.0.1" or "localhost" to restrict access to local machine only.`
(`config.example.yaml:1-2`). There is no default-host constant that fills in `127.0.0.1`;
with `host` unset the Go zero value `""` is used, so the listener is `:8317`. On a public
VPS Foundry must set `host: "127.0.0.1"` explicitly.

TLS is optional and off by default (`tls.enable: false`, `config.example.yaml:8-11`).

## 3. Client authentication (caller keys)

Caller keys are a flat list of strings under the top-level `api-keys` key
(`config.example.yaml:38-42`; Go field `APIKeys []string` with `yaml:"api-keys"`,
`internal/config/sdk_config.go:54-55`). There is **no name, label, scope, per-key rate
limit or model restriction** attached to a key — the built-in provider stores them as a
`map[string]struct{}` and reports the raw key as the principal
(`internal/access/config_access/provider.go:38-46,97-101`; the middleware records it as
`c.Set("userApiKey", result.Principal)`, `internal/api/server_middleware.go:172`).

Accepted presentations, in the order the provider tries them
(`internal/access/config_access/provider.go:62-85`):

| header / parameter            | notes                                                                                                                    |
| ----------------------------- | ------------------------------------------------------------------------------------------------------------------------ |
| `Authorization: Bearer <key>` | `Bearer` prefix stripped; a bare value in `Authorization` is also accepted (`extractBearerToken`, `provider.go:106-119`) |
| `X-Goog-Api-Key: <key>`       | Gemini-style                                                                                                             |
| `X-Api-Key: <key>`            | Anthropic-style                                                                                                          |
| `?key=<key>`                  | query string                                                                                                             |
| `?auth_token=<key>`           | query string                                                                                                             |

For Foundry the header to use is `Authorization: Bearer <key>`. Additional access
providers (per-provider `Name`, `APIKeys`, `Config`) exist as an SDK extension point in
`sdk/access/types.go:5-46`, but the server's own `config.yaml` in v7.3.7 only drives the
one `config-api-key` provider from `api-keys` (`internal/access/config_access/provider.go:14-31`);
no documented top-level YAML block for arbitrary providers was found. `Unverified:` whether
a plugin can register a caller-key provider with per-key model scoping; the SDK interface
would allow it, no shipped plugin was inspected.

Because keys are plain strings, Foundry must mint its own namespacing convention if it
wants per-desktop attribution (e.g. one `api-keys` entry per install). CLIProxyAPI will
not attribute traffic to a caller name for you.

## 4. Upstream credentials (`auth-dir`)

`auth-dir` is a top-level config key (`config.example.yaml:35-36`; Go field
`Config.AuthDir`, `internal/config/config.go:34-35`), default `~/.cli-proxy-api`
(`internal/config/config_defaults.go:6`). `~` is expanded at startup
(`internal/util/util.go:81-86`, called from `cmd/server/main.go:639`).

Credentials are JSON files directly under that directory (`*.json`; the file store walks
the directory for `.json` entries, `sdk/auth/filestore.go:181-200`) and are written mode
`0600` (`sdk/auth/filestore.go:152`, `os.WriteFile(path, raw, 0o600)`). Each file carries a
`"type"` provider field; `type: "gemini"` files are ignored by the file store
(`sdk/auth/filestore.go:238-244`). A `fsnotify` watcher reloads on create/write/remove/rename
(`internal/watcher/events.go:67-121`).

Typical file naming per provider (from the per-provider filename helpers):

| provider       | file name pattern                                                                | source                                        |
| -------------- | -------------------------------------------------------------------------------- | --------------------------------------------- |
| Claude (OAuth) | `claude-<email>.json`, or `claude-<identityHash>-<email>.json`                   | `internal/auth/claude/filename.go:27,32`      |
| Codex (OAuth)  | `codex-<hashAccountID>-<email>-<plan>.json` (falls back to `codex-<email>.json`) | `internal/auth/codex/filename.go:18-32`       |
| Antigravity    | `antigravity.json`, or `antigravity-<email>.json`                                | `internal/auth/antigravity/filename.go:13,15` |
| xAI            | `xai-<email>.json` / `xai-<subject>.json` / `xai-<unixMillis>.json`              | `internal/auth/xai/token.go:76-82`            |
| Kimi           | `kimi-<unixMillis>.json`                                                         | `sdk/auth/kimi.go:111`                        |
| Devin          | `devin-<identifier>.json`                                                        | `internal/auth/devin/record.go:68`            |
| Meta           | `meta-<hash>.json` / `meta-oauth.json`                                           | `internal/auth/meta/meta.go:556-563`          |
| Vertex         | imported service-account key, via `-vertex-import`                               | `cmd/server/main.go:151-152`                  |

Documented ways to add a login:

- **CLI OAuth flags**: `-claude-login`, `-codex-login`, `-codex-device-login`,
  `-antigravity-login`, `-kimi-login`, `-xai-login`, `-devin-login`, `-meta-login`
  (`cmd/server/main.go:134-143`), each writing a credential file into `auth-dir`.
- **Management API OAuth**: `GET /v0/management/anthropic-auth-url`,
  `/codex-auth-url`, `/antigravity-auth-url`, `/kimi-auth-url`, `/xai-auth-url`,
  `/devin-auth-url`, `/meta-auth-url`, plus `GET /get-auth-status`
  (`internal/api/server_management.go:190-197`).
- **Config-file API keys as upstream credentials** (no file): `claude-api-key`,
  `codex-api-key`, `xai-api-key`, `meta-api-key`, `gemini-api-key`,
  `interactions-api-key`, `vertex-api-key`, `openai-compatibility` — see sections in
  `config.example.yaml:413-800`.

**File lock: none found.** There is no `flock`/`.lock` mechanism anywhere in the tree:
`go.mod` has no locking dependency, no `.lock` path is written, and grep for
`flock`/`O_EXCL` in the auth, watcher and store packages returns no cross-process lock.
Concurrency inside one process is handled with in-process mutexes only
(`internal/watcher/watcher.go:154`, `sdk/cliproxy/auth/...`). Practical consequence: two
CLIProxyAPI processes pointed at the same `auth-dir` would both read and rewrite those JSON
files with no coordination — do not run more than one instance against one `auth-dir`.
Cooldown state is in memory by default (`save-cooldown-status: false`,
`config.example.yaml:196-198`), so nothing else is persisted alongside the files unless
that switch is enabled.

`Unverified:` whether a second instance would actually corrupt credentials or only serve
stale data; I did not run two instances. There is a "Home" cluster mode
(`config.example.yaml:68-105`, `internal/config/home.go`) whose credential-concurrency
contract implies multi-node coordination, but that is a hosted control-plane mode and was
not explored.

## 5. The HTTP surface Foundry needs

Routes are registered in `internal/api/server_routes.go:50-128`. The ones that matter:

| method + path                     | auth middleware               | handler                                                                            |
| --------------------------------- | ----------------------------- | ---------------------------------------------------------------------------------- |
| `GET /v1/models`                  | `AuthMiddleware` (caller key) | `unifiedModelsHandler` → OpenAI or Anthropic shape (`server_routes.go:65,591-616`) |
| `POST /v1/chat/completions`       | caller key                    | `openaiHandlers.ChatCompletions` (`server_routes.go:66`)                           |
| `POST /v1/completions`            | caller key                    | legacy completions (`server_routes.go:67`)                                         |
| `POST /v1/messages`               | caller key                    | Anthropic Messages (`server_routes.go:75`)                                         |
| `POST /v1/messages/count_tokens`  | caller key                    | (`server_routes.go:76`)                                                            |
| `POST /v1/responses`              | caller key                    | OpenAI Responses (`server_routes.go:78`)                                           |
| `GET/POST /v1beta/models/*action` | caller key                    | Gemini `generateContent`/`streamGenerateContent` (`server_routes.go:124-127`)      |
| `GET /healthz`                    | none                          | `{"status":"ok"}` (`server_routes.go:51,45-49`)                                    |

So yes — it is a faithful OpenAI-compatible surface for chat completions and model
listing, and it also exposes genuine Anthropic- and Gemini-shaped surfaces plus OpenAI
Responses, images, videos, realtime/websocket endpoints, and a `/backend-api/codex` alias
group (`server_routes.go:77-127`).

**`GET /v1/models` shape.** OpenAI shape is
`{"object":"list","data":[{"id","object","created","owned_by"}]}` — the handler projects
exactly `id`, `object`, `created`, `owned_by` from the registry entries
(`sdk/api/handlers/openai/openai_handlers.go:61-96`). The same route returns an
Anthropic-shaped list when the request carries an `Anthropic-Version` header or a
`claude-cli` User-Agent (`internal/api/server_routes.go:580-586,610-615`); a `client_version`
query switches to a Codex client catalog (`server_routes.go:593-599`).

**Which models appear.** They come from the process-global registry, populated by the
currently loaded credentials, and are filtered by availability: a model is dropped when it
has no available client, and quota-exceeded or suspended clients are subtracted
(`internal/registry/model_registry.go:1237-1255,1308-1310`, availability logic at
`:1265-1306`). The list is therefore _not_ static and _not_ caller-specific — every caller
sees the union of what the loaded credential pool can serve right now. Config-level
`excluded-models` (per credential/provider), `oauth-excluded-models` (per channel) and
aliases further shape it (`config.example.yaml:446-458`; OAuth-file `excluded-models` and
`model_aliases` at `:822-832`, global `oauth-excluded-models` at `:867`).

**Provider naming on a model.** There is a documented `prefix/model` convention. A
credential or `openai-compatibility` provider can set `prefix: "test"`, and the catalog
then also exposes `test/<model-id>`; the request `test/gemini-3-pro-preview` targets that
credential (`config.example.yaml:417,526,731`; the catalog half is
`applyModelPrefixes`, which emits `trimmedPrefix + "/" + baseID`,
`sdk/cliproxy/service_models.go:622-671`). Top-level `force-model-prefix: true` makes
unprefixed requests only use credentials that have no prefix
(`config.example.yaml:156-157`, `internal/config/sdk_config.go:37-40`). There is also a
separate thinking suffix of the form `model(<value>)`, stripped by
`thinking.ParseSuffix` (`internal/thinking/.../ParseSuffix`) — relevant only if Foundry
lets users type model names by hand.

## 6. Streaming

Yes: `POST /v1/chat/completions` with `stream: true` returns Server-Sent Events. The
handler reads `stream` off the JSON body (`sdk/api/handlers/openai/openai_handlers.go:118-119`),
sets `Content-Type: text/event-stream`, `Cache-Control: no-cache`, `Connection: keep-alive`
and `Access-Control-Allow-Origin: *` (`openai_handlers.go:595-598`), writes frames as
`data: {...}\n\n` and terminates with `data: [DONE]\n\n` (`openai_handlers.go:632-637`,
`:478` for the non-streaming read path).

What it does with `stream_options.include_usage`, toward upstreams:

- For an **OpenAI-compatible upstream** (`openai-compatibility` provider), the streaming
  executor forces `stream_options.include_usage = true` on the outgoing request, with the
  comment "Request usage data in the final streaming chunk so that token statistics are
  captured even when the upstream is an OpenAI-compatible provider"
  (`internal/runtime/executor/openai_compat_executor.go:355-357`, inside `ExecuteStream`).
  It does this regardless of what the caller asked for.
- For native OAuth upstreams the proxy translates server-side instead and deletes
  `stream_options` before forwarding — Codex does `sjson.DeleteBytes(body, "stream_options")`
  (`internal/runtime/executor/codex_executor_stream.go:66-69`; likewise xAI and Meta at
  `xai_executor_request.go:90`, `meta_executor_execute.go:62`).

The **final usage-bearing chunk**:

- **OpenAI → OpenAI is a verbatim passthrough.** Request and response formats are both
  `OpenAI`, and the translator strips the `data:` prefix and drops `[DONE]`, forwarding the
  upstream JSON byte-for-byte (`internal/translator/openai/openai/chat-completions/openai_openai_response.go:22-40`,
  registered in `init.go`). So the trailing chunk is whatever the OpenAI-shaped upstream
  emits — OpenAI's own usage-only chunk has `"choices": []` and a populated `usage`. The
  proxy does not rewrite it.
- **Claude (Anthropic) → OpenAI synthesizes** an OpenAI-style usage-only trailing chunk:
  on the Anthropic `message_stop` event it emits
  `{"id":...,"object":"chat.completion.chunk","created":...,"model":...,"choices":[]}` with
  `usage.prompt_tokens`, `usage.completion_tokens`, `usage.total_tokens` and
  `prompt_tokens_details.*` (`internal/translator/claude/openai/chat-completions/claude_openai_response.go:263-283`).
  A non-empty `choices` array is emitted only on content/finish chunks; usage arrives once,
  after `finish_reason`, with `choices: []`.
- **Codex → OpenAI** attaches `usage` (from `response.usage`) onto translated content
  chunks rather than a separate usage-only chunk
  (`internal/translator/codex/openai/chat-completions/codex_openai_response.go:116-133`),
  and **Gemini/Antigravity → OpenAI** likewise fold `usageMetadata` into the chunk
  (`internal/translator/gemini/openai/chat-completions/gemini_openai_response.go:110-128`,
  `internal/translator/antigravity/openai/chat-completions/antigravity_openai_response.go:128-137`).

Implementers should therefore parse usage from the _last_ chunk that carries a `usage`
object, not from a fixed chunk index, and tolerate both `choices: []` and an inline
usage on a content chunk.

Known streaming-usage defects (searched 2026-09-18; all are about usage being zero or
null, several already fixed):

| issue                                                             | state    | what it says                                                                                                 |
| ----------------------------------------------------------------- | -------- | ------------------------------------------------------------------------------------------------------------ |
| [#3173](https://github.com/router-for-me/CLIProxyAPI/issues/3173) | closed   | "Streaming usage tokens always recorded as 0 for OpenAI-compatible providers with null usage chunks"         |
| [#3076](https://github.com/router-for-me/CLIProxyAPI/issues/3076) | closed   | "Streaming token usage always zero with OpenAI-compatible providers (DeepSeek)"                              |
| [#4053](https://github.com/router-for-me/CLIProxyAPI/issues/4053) | closed   | "Streaming usage can be locked at 0 when an early usage chunk is a placeholder"                              |
| [#4964](https://github.com/router-for-me/CLIProxyAPI/issues/4964) | closed   | "Vertex Gemini 3.7 Flash streaming usage is recorded as zero when an early zero usageMetadata chunk arrives" |
| [#5617](https://github.com/router-for-me/CLIProxyAPI/issues/5617) | closed   | "Cache usage tokens are dropped on streamed OpenAI→Claude responses (present when non-streamed)"             |
| [#3279](https://github.com/router-for-me/CLIProxyAPI/pull/3279)   | **open** | "fix(openai-compatible): ignore null stream usage chunks"                                                    |
| [#2762](https://github.com/router-for-me/CLIProxyAPI/pull/2762)   | **open** | "fix(openai-compat): ignore usage:null in stream token accounting"                                           |
| [#5832](https://github.com/router-for-me/CLIProxyAPI/pull/5832)   | **open** | "fix(executor): honor explicit-zero Claude stream usage fields"                                              |

The recurring root cause in the closed issues is an upstream sending an early placeholder
`usage` (zeros or `null`) that a naive "first usage wins" reader latches onto; the open PRs
are fixes that have not merged as of v7.3.7. `Unverified:` whether any of the open PRs'
defects affect the specific upstreams Foundry will use — the fixes are version-scoped, and
I did not reproduce them.

## 7. Errors

The envelope depends on which layer fails, and the three cases are not uniform. Foundry's
proxy must branch on HTTP status first, then on the body shape.

**Bad caller key** — rejected by the `/v1` group's auth middleware before any handler, as
a **plain string under `error`, not an object**:

- `401 {"error":"Missing API key"}` when no credential was presented
- `401 {"error":"Invalid API key"}` when one was presented and did not match

Source: `c.AbortWithStatusJSON(statusCode, gin.H{"error": err.Message})` at
`internal/api/server_middleware.go:198`; messages from `sdk/access/errors.go:65-71`
(`NewNoCredentialsError`/`NewInvalidCredentialError`). The richer OpenAI-style envelope
with `type: "authentication_error"`, `code: "invalid_api_key"` exists only on the realtime
routes (`server_middleware.go:183-193`) — do **not** expect it on `/v1/chat/completions`.

**Model not available** — when the requested base model maps to no known provider, the
route resolver returns HTTP **400** with an OpenAI-style envelope whose message names the
model (`sdk/api/handlers/handlers_routing.go:200-221`):

```json
{
  "error": {
    "message": "unknown provider for model <model>",
    "type": "invalid_request_error",
    "code": "model_not_found",
    "param": "model"
  }
}
```

400 rather than 404 is deliberate, per the code comment: "400 is used rather than 404 to
keep it distinguishable from an unregistered HTTP route" (`handlers_routing.go:204-210`).

**Upstream pool exhausted / rate-limited** — your prior note is correct. The
`model_cooldown` error is real, formatted by `modelCooldownError.Error()`
(`sdk/cliproxy/auth/selector.go:122-163`):

```json
{
  "error": {
    "code": "model_cooldown",
    "message": "All credentials for model <model> are cooling down",
    "model": "<model>",
    "reset_time": "30s",
    "reset_seconds": 30,
    "provider": "<provider>",
    "last_upstream_error": "<summary>"
  }
}
```

`provider` appears only when a single provider is involved, and `last_upstream_error` only
when an upstream cause was captured; in both cases `message` is also rewritten
(`selector.go:148-157`). It is emitted with **HTTP 429** and a `Retry-After` header equal to
`ceil(reset_seconds)` (`selector.go:349-359`). `reset_time` is the human display form
(`"30s"`), `reset_seconds` the integer to compute against. The `WriteErrorResponse` path
passes a body through verbatim when it is already valid JSON (`BuildErrorResponseBodyWithError`,
`sdk/api/handlers/handlers.go:113`), which is why the `{"error":{...}}` object survives
intact instead of being re-wrapped.

Related codes worth handling: `auth_not_found` / `auth_unavailable` when no credential
matches the model at all (`sdk/cliproxy/auth/selector.go:525,704`,
`sdk/cliproxy/auth/scheduler.go:308-327`) — these are enriched with
`(providers=..., model=...)` detail and default to HTTP **503** when no status is set
(`sdk/api/handlers/handlers_errors.go:92-96`). `model_not_found` also appears inside
failed-home-dispatch paths mapping to 404 (`sdk/cliproxy/auth/home_concurrency.go:238-239`),
but that is Home mode, not the direct deployment Foundry will run.

`Unverified:` the exact status/body when a _provider_ credential is valid but the upstream
returns its own 429 — the upstream error is generally propagated, but I did not trace the
active-credential exhaustion window end to end; the cooldown error above is the terminal
shape when nothing eligible remains.

## 8. Usage and management endpoints

There is **no HTTP endpoint that reports usage or quota per caller key**. The management
surface is `/v0/management/...` and it reports on _upstream credentials_, not on the
`api-keys` callers.

- `GET /v0/management/api-key-usage` returns success/failure counters and recent request
  buckets **per upstream credential**, grouped by provider and keyed by
  `"<base_url>|<api_key>"` (`internal/api/handlers/management/api_key_usage.go:58-117`,
  composite key at `:93`). Despite the name, these are the provider API keys, not the
  `api-keys` caller keys.
- `GET /v0/management/usage-queue?count=N` pops up to `count` usage records from the
  in-memory/RESP usage queue and returns them as a JSON array
  (`internal/api/handlers/management/usage.go:24-46`).
- Other relevant routes: `GET/PUT/PATCH /v0/management/api-keys` (read and edit the caller
  key list), `GET/PUT/PATCH /v0/management/usage-statistics-enabled`,
  `GET /v0/management/auth-files` (credential inventory), and the OAuth URL endpoints
  (`internal/api/server_management.go:87-92,63-65,179`).

Auth for management: the group requires a separate **management secret** configured as
`remote-management.secret-key` (`config.example.yaml:15-24`), presented as
`Authorization: Bearer <secret>` or `X-Management-Key: <secret>`
(`internal/api/handlers/management/handler.go:266-291`). If `secret-key` is empty the whole
management API is not registered and every `/v0/management` route returns 404
(`internal/api/server.go:235-238`; `internal/api/server_management.go:202-219`). It is
localhost-only unless `remote-management.allow-remote: true` (`config.example.yaml:16-17`,
`handler.go:299-320`). Plaintext secrets in the file are bcrypt-hashed on load
(`internal/config/config_load.go:113-122`).

The usage-statistics switch is `usage-statistics-enabled`, and it **defaults to false**:
the shipped example sets `false` (`config.example.yaml:143-145`), and every config load
forces `cfg.UsageStatisticsEnabled = false` before parsing (`internal/config/parse.go:29`,
`internal/config/config_load.go:70`). It gates whether usage records are enqueued to the
usage queue (`internal/redisqueue/usage_toggle.go:5-16`, consumed at
`internal/redisqueue/plugin.go:25`). Note the package-level default before any config load
is `true` (`usage_toggle.go:7-9`) — the effective default for a configured server is false.

The README also states that "Since v6.10.0, CLIProxyAPI and CPAMC no longer ship built-in
usage statistics", directing operators to external tools (CPA Usage Keeper,
CPA-Manager-Plus) (<https://github.com/router-for-me/CLIProxyAPI/blob/v7.3.7/README.md>).
So per-key quota accounting for Foundry is Foundry's job: count tokens from the usage
chunks, or meter the proxy itself. `Unverified:` whether the `api-key-usage` counters
increment when `usage-statistics-enabled` is false; the endpoint reads per-`Auth` counters
that appear to be tracked independently of the queue toggle, but I did not run it to
confirm.

The documentation adds two surfaces to this section — a Redis-shaped usage queue on the
same TCP port and a bundled Management Center — plus the management key's persistence and
ban policy. See section 10.

## 9. Model selection and access control

Model curation happens on the **credential/config side, never on the caller key**.

- **Per credential**: an upstream entry can declare `models:` (with `alias`,
  `display-name`, `max-context-length`, `thinking.levels`) and `excluded-models:` with exact
  or `*` wildcard patterns (`config.example.yaml:446-458` for `gemini-api-key`, analogous
  blocks for `codex-api-key`, `claude-api-key`, `xai-api-key`, `vertex-api-key`,
  `openai-compatibility`). OAuth credential files can carry `excluded-models` and
  `model_aliases` in the JSON (`internal/watcher/synthesizer/helpers.go:56`;
  `config.example.yaml:806-826`).
- **Globally per channel**: `oauth-excluded-models` and `oauth-model-alias` rename/hide
  models across all credentials of a provider for both listing and routing
  (`config.example.yaml:822-832,867`).
- **Globally at the server**: `force-model-prefix` decides whether unprefixed requests may
  hit prefixed credentials (`config.example.yaml:156-157`); `routing.strategy` and session
  affinity decide _which_ credential serves a model, not whether it is visible
  (`config.example.yaml:222-246`).

**Can a caller key be restricted to a subset of models? No — not with the built-in
configuration.** `api-keys` is a list of undifferentiated strings, the built-in
`config-api-key` provider compares only the string, and the `/v1/models` handler consults
the same global registry for every authenticated caller
(`internal/access/config_access/provider.go:38-103`,
`sdk/api/handlers/openai/openai_handlers.go:53-58`,
`internal/registry/model_registry.go:1237-1310`). There is no per-key `models`,
`allowed-models` or similar key anywhere in `config.example.yaml` or the config types.

If Foundry needs per-release-group or per-user model restrictions, it must enforce them at
the Foundry boundary and expose its own filtered `/v1/models`, rather than relying on
CLIProxyAPI. The only CLIProxyAPI-side lever is issuing different _upstream_ credentials
under different `prefix`es and handing different prefixes to different callers — which
still does not stop a caller from naming another prefix.

## 10. What the documentation adds

The docs site is VitePress and **not versioned**: no page states which release it
documents, so treat everything here as "latest" and prefer the pinned source where they
disagree. Pages read: `/configuration/{basic,options,auth-dir,hot-reloading,thinking}`,
`/configuration/storage/{git,pgsql,s3}`, `/configuration/provider/*`,
`/management/{api,webui,redis-usage-queue}`, `/plugin/usage-plugin`.

**Management API** (`/management/api.html`) — base path `http://localhost:8317/v0/management`.
Every request needs the management key, localhost included, presented as
`Authorization: Bearer <key>` or `X-Management-Key`; `remote-management.allow-remote` is
`false` by default and an empty `secret-key` makes the whole group 404. Five consecutive
auth failures ban the client IP for ~30 minutes. A plaintext key found at startup is
bcrypt-hashed and **written back to the config file**, and management changes persist to
that file and hot-reload — so the config is written by the service, not only by a human,
and the service account needs write access to it. `GET/PUT /config.yaml` reads and
replaces the document as raw YAML, answering `400 invalid_yaml`, `422 invalid_config` or
`500 write_failed`. Only `remote-management.allow-remote` and
`remote-management.secret-key` refuse to change over the API.

**Management Center** (`/management/webui.html`) — an official browser UI served at
`/management.html`, published from `router-for-me/Cli-Proxy-API-Management-Center`. It can
be turned off (`remote-management.disable-control-panel`), relocated
(`MANAGEMENT_STATIC_PATH`), or replaced by an in-house panel via
`remote-management.panel-github-repository`, which polls that repo's latest release for an
asset named `management.html` and verifies an optional `sha256:` digest. Its connection
state lives in browser `localStorage` under reversible obfuscation — explicitly not a
security boundary — and the management key is only persisted when the operator opts into
remembering it. Plugin resource pages share the origin and can read the same stored key.

**Usage queue** (`/management/redis-usage-queue.html`) — a minimal Redis RESP server on
the same listener as HTTP, available only while management is enabled, authenticated with
the management key (`AUTH`, then `LPOP`/`RPOP`/`SUBSCRIBE usage`; the key argument is
ignored). Records appear only when `usage-statistics-enabled: true`, are retained in memory
for `redis-usage-queue-retention-seconds` (default 60, max 3600), and are **removed when
read** by either the queue endpoint or RESP; a subscribed client receives them live
instead of queueing them. Each record carries `timestamp`, `latency_ms`, `source`,
`auth_index`, `tokens.{input,output,reasoning,cached,total}`, `failed`, `provider`, `model`,
`alias`, `endpoint`, `auth_type`, `api_key`, `request_id` and optional
`response_headers`, and distinguishes the executed `model` from the caller's `alias`. The
legacy aggregated `/usage`, `/usage/export` and `/usage/import` endpoints are gone. The
usage-observer plugin (`/plugin/usage-plugin.html`) delivers an equivalent per-request
record with `ReasoningEffort` and `ServiceTier` included.

**Hot reloading** (`/configuration/hot-reloading.html`) — the service watches its config
file and `auth-dir`, and token JSON files can be added or removed while it runs with no
restart. The page does not enumerate which settings still need one, and does not say
whether an `api-keys` change takes effect live.

**Reasoning level is a model-name suffix** (`/configuration/thinking.html`) — append
`(value)` to the model name, where value is `minimal` (512), `low` (1024), `medium`
(8192), `high` (24576), `xhigh` (32768), `auto`, `none`, or a bare number of tokens. The
translation is per protocol: Gemini writes `thinkingConfig.thinkingBudget`, Claude enables
`thinking` with `budget_tokens`, and OpenAI/Codex/OpenRouter **overwrite
`reasoning_effort`/`reasoning.effort`** (a numeric budget does not apply there). An
unsupported level is an HTTP 400, while an unsupported model silently drops the suffix.
There are no per-model mapping tables beyond
`openai-compatibility.*.models.*.thinking.levels` (default `["low","medium","high"]`).
This matters to Foundry because pi expresses reasoning as `reasoning_effort` plus a
`thinkingLevelMap`, not as part of the model id.

**Storage backends** (`/configuration/storage/{git,pgsql,s3}.html`) — `git`, `pgsql` and
`s3` are alternative backends for **both `config.yaml` and the `auth-dir` credentials**,
not for usage or logs. They are selected by environment variables (`GITSTORE_GIT_URL`,
`PGSTORE_DSN`, `OBJECTSTORE_*`), not by config keys, and each keeps a **local writable
mirror** (`pgstore/`, `objectstore/`) so the file-per-login model and the watchers keep
working. Git auto-commits and pushes on a new login. No page mentions locking or atomic
writes. So "CLIProxyAPI does no environment interpolation" applies to config _values_;
env vars do drive storage selection and plugin credentials (`token-env`, `username-env`,
`password-env`).

**Config keys the source sections above do not enumerate** — `routing.strategy`
(`round-robin` default, or `fill-first`), `max-retry-credentials` (`0` = legacy try-all),
`max-retry-interval` (30s), `quota-exceeded.{switch-project,switch-preview-model,antigravity-credits}`
(all `true`, so an exhausted subscription is silently routed elsewhere before Foundry sees
a cooldown), `request-retry` (3, on 403/408/500/502/503/504), `force-model-prefix`,
`disable-image-generation` (`false`/`true`/`"chat"`/`"passthrough"`), `ws-auth`, and
`redis-usage-queue-retention-seconds`.

**An `openai-compatibility` entry is the richest knob Foundry has**, and each of its fields
matters to something in this document: `prefix` requires calls shaped `prefix/model` to
reach that provider; `api-key-entries[].weight` shares traffic between credentials;
`headers` copies a downstream header when the value is written `"$HEADER-NAME"`;
`support-prompt-cache-key` derives a cache key for requests from any input protocol;
`request-scoped-errors` classifies upstream failures by status and body pattern into
`stop`, `stop-and-cooldown`, `continue` or `continue-and-cooldown` — its own example matches
`maximum_context_length` and `context_length_exceeded`; and `thinking.levels` declares the
levels a model accepts, defaulting to `["low","medium","high"]` with the config's own
warning that exceeding levels such as `max` and `xhigh` are clamped to `high`.

**Provider pages document credential setup only.** `codex.html`, `claude-code.html` and
`antigravity.html` are login commands and OAuth callback ports (1455, 54545, 51121) and
nothing else. Not one of the nine provider pages states whether `max_tokens`,
`max_completion_tokens`, `reasoning_effort`, `service_tier`, `temperature`, `top_p` or a
cache key reaches the upstream, nor what any family reports for usage or caching. The only
calling instruction is `openai-compatibility.html`'s: POST to `/v1/chat/completions` with
`model` set to the configured alias. The only stated caveats are xAI's — unsupported
continuation/cache fields removed, tool definitions adjusted, reasoning settings kept only
for Grok models that support effort. Model ids are aliased per configured provider
(`models: [{name, alias}]`, and `display-name`, `max-context-length`, `input-modalities`,
`thinking.levels` alongside them). The separate global `oauth-model-alias` block applies
only to OAuth channels — vertex, aistudio, antigravity, claude, codex, kimi, xai, meta —
and its own note says it does not apply to `gemini-api-key`, `codex-api-key`,
`xai-api-key`, `meta-api-key`, `claude-api-key`, `openai-compatibility` or
`vertex-api-key`.

**Documentation that contradicts the source.** The docs describe a default config path
(CWD `config.yaml`, and a Homebrew path) where `cmd/server/main.go:49` defines
`DefaultConfigPath` as empty — pass `-config` explicitly. The docs write the flag as
`--config` (Go accepts both). `disable-codex-cloaking`, which exists in the config types,
appears nowhere in the options table, which lists only `disable-claude-cloak-mode`.
`ws-auth` defaults to `true` in the options table and `false` in the same page's example.

### Settling the unverified list locally

CLIProxyAPI is MIT and publishes platform tarballs at the pinned tag, so the whole chain runs
on a development machine without a VPS or a subscription. That setup exists:
`docs/internal/server-development.md` installs the binary, and the config it writes points an
`openai-compatibility` provider at `apps/server/src/test-support/fake-upstream.ts`, an
OpenAI-shaped stand-in that records what it receives. Section 11 is what that measured. It
does **not** exercise the Codex, Claude or Gemini translators, which need real subscription
credentials.

## 11. Measured against a running instance

Measured 2026-09-18 against the published `v7.3.7` `linux_amd64` release, checksum-verified
from the tag's own `checksums.txt` (binary reports `7.3.7`, commit `b773607e`, matching the
pin in section 1). The config is the dev chain in `docs/internal/server-development.md`:
loopback, one caller key, one `openai-compatibility` provider pointed at Foundry's own
OpenAI-shaped stand-in (`apps/server/src/test-support/fake-upstream.ts`), which records the
bodies it receives. So the upstream here is a fake — everything below is about what
**CLIProxyAPI** does between a caller and whatever is behind it, on the
`openai-compatibility` path only.

**Usage travels, and the proxy asks for it.** A streamed request that never mentioned
`stream_options` had `"stream_options":{"include_usage":true}` added on the way out, and the
usage-only chunk with `choices: []` came back to the caller anyway. The same request without
streaming returned usage in the body. Both carried `prompt_tokens_details.cached_tokens`, and
a non-zero value (9) arrived intact — so the cache-read column is readable from the reply.

**Reasoning level is filtered two different ways.** With `thinking.levels` left at its
default of `low`, `medium`, `high`:

| the caller asked for          | reached the upstream | came back |
| ----------------------------- | -------------------- | --------- |
| `reasoning_effort: "high"`    | `high`               | 200       |
| `reasoning_effort: "minimal"` | `low`                | 200       |
| `reasoning_effort: "xhigh"`   | `high`               | 200       |
| `reasoning_effort: "max"`     | `high`               | 200       |
| `reasoning_effort: "ultra"`   | nothing was sent     | 400       |
| model id `fake-model(max)`    | `high`, suffix gone  | 200       |

The 400 body is `{"error":{"message":"level \"ultra\" not supported, valid levels: low,
medium, high","type":"invalid_request_error"}}` — **no `code` field**, unlike
`model_not_found`. So a level inside the proxy's own vocabulary but outside the declared set
is silently moved to the nearest declared one, while a level it does not know at all is a
refusal. pi's levels are `minimal`, `low`, `medium`, `high`, `xhigh` and `max`, so none of
them can 400 — but all of them can be quietly downgraded. Declaring the real level set per
model and mapping pi's levels onto it is what keeps a user's "max" from becoming "high"
without a word.

**Request parameters pass through.** `max_tokens` and `max_completion_tokens` both reached
the upstream exactly as sent (the second was not renamed), as did `service_tier`.

**The catalogue's per-model facts come from the config, not the provider.** For a model
served by `openai-compatibility`, `GET /v1/models?client_version=pi` reported the
`context_window` and `input_modalities` that the config entry declared, the default
`supported_reasoning_levels`, an empty `service_tiers`, `visibility: "list"`, and **no
`max_tokens` key at all** — that field is filled from CLIProxyAPI's own registry, which does
not know a custom model id. A hand-written max-output figure is therefore still needed, but
only for models the registry does not cover; subscription models the registry knows do carry
one.

**Refusals keep the shapes section 7 describes.** A wrong caller key is
`401 {"error":"Invalid API key"}` — a bare string. An unknown model is `400
{"error":{"message":"unknown provider for model nope-9","type":"invalid_request_error","code":"model_not_found","param":"model"}}`.

## Left unverified

- **The 429 cooldown refusal was not exercised.** Everything in section 11 was measured on
  the `openai-compatibility` path against a stand-in upstream. A spent credential pool needs
  a real subscription login, so the `model_cooldown` body, its `Retry-After` header and the
  `quota-exceeded` switching behaviour remain source reads.
- **`stream_options.include_usage` on the downstream side.** Answered for this path in
  section 11: the proxy adds the flag upstream and returns the usage chunk to a caller that
  never asked for it. Still unverified for the Codex, Claude and Gemini executors, which
  need real credentials.
- **Multi-instance `auth-dir` safety.** No file lock exists; whether concurrent writers
  corrupt credentials or merely race is untested. Treat one process per `auth-dir` as the
  rule. Home/cluster mode's coordination contract was not explored.
- **Whether `api-key-usage` counters depend on `usage-statistics-enabled`.** Not traced.
- **Pluggable caller-key providers with per-key scoping.** The SDK's `AccessProvider` type
  permits a keyed provider, but no shipped implementation and no config key for one was
  found. Would be settled by inspecting plugin documentation or a plugin that registers an
  access provider.
- **Non-filesystem credential stores** (Postgres/Git/object storage, env-selected at
  `cmd/server/main.go:274-311`) — the documentation settles the layout (config _and_
  credentials, behind a local writable mirror) but neither source nor docs state their
  locking or atomic-write behaviour, which is the part that matters if two nodes ever run.
- **Whether a reasoning level can arrive as `reasoning_effort` instead of a model-name
  suffix.** Answered in section 11 for the `openai-compatibility` path: both forms work, the
  suffix is stripped and translated, and the level is filtered either way.
- **Cache-write tokens anywhere in the chain.** No provider page, no management endpoint
  and no usage-queue field reports cache _creation_; the queue's `tokens` object has only
  `cached_tokens`. Expect Foundry's cache-write column to be zero except where an upstream
  genuinely exposes it.
