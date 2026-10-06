# CubeSandbox as the sandbox backend for Kira runs

**Question:** The backend is decided: [CubeSandbox](https://github.com/TencentCloud/CubeSandbox) (self-hosted, E2B-compatible API). What facts about it does the rest of the design lean on: hosting requirements, the real API surface, auth, egress and secret handling, lifecycle, and what running `pi` inside one looks like from a Bun server?

**Conclusion:** CubeSandbox fits "whole `pi` inside the sandbox, talked to over stdio" (topology B in [remote-sandbox-providers.md](./remote-sandbox-providers.md)). Everything we need exists in the box: a microVM per chat, a long-lived stdin-open process that survives client disconnects, pause/resume of memory and disk, and an egress proxy that injects credentials so the sandbox never holds them. Five things shape the design:

1. **Do not depend on the `e2b` npm SDK.** Since `e2b` 2.51.0 (2026-09-18) it calls `POST /v2/sandboxes`, which CubeSandbox's `master` does not serve (fix PR still open). Write a thin Kira client: CubeAPI REST plus envd's Connect-JSON over `fetch`. The repo's own Node SDK is the reference to port.
2. **Idle detection watches HTTP requests through CubeProxy, not processes.** A `pi` that is busy talking to the model counts as idle. Kira must own the lifecycle (`NEVER_TIMEOUT`, explicit pause), not use `on_timeout`.
3. **Hosting is bare metal or a custom host kernel.** Nested virtualisation is "not supported"; the supported cloud-VM path replaces the host kernel with Tencent's PVM kernel.
4. **No tenancy.** One admin key, an auth callback that returns 200 or not, no per-tenant quota. Kira's server is the tenant layer.
5. **Single-node running sandboxes die with the node.** Fault recovery is on the roadmap; cross-node resume is a preview. The project is 0.7 and ships a breaking-ish release every two to five weeks.

Research date 2026-10-06. Source repo cloned at commit `e02976a` (master, 2026-09-30, one week after v0.7.2); file paths below link to `master`. The docs site [cubesandbox.com](https://cubesandbox.com) renders the same `docs/` folder. Anything I could not confirm from a primary source is marked **UNVERIFIED**.

## 1. Project facts

| Fact | Value | Source |
| --- | --- | --- |
| Licence | Apache-2.0, plus a list of third-party components under their own licences (kata-containers, cloud-hypervisor: Apache-2.0; cilium/bpf: BSD-2-Clause). GitHub's API shows `NOASSERTION` only because the file has a Tencent header above the Apache text. The PVM host kernel is Linux (GPL-2.0, **UNVERIFIED** line by line). | [LICENSE][license] |
| Maintainer | Tencent Cloud (`TencentCloud` org, copyright "2026 Tencent"). Used in Tencent Cloud production "before open-sourcing". Docs and CI mirror on `cnb.cool`. | [README][readme], [introduction][intro] |
| Latest release | **v0.7.2**, tagged 2026-09-24 (rc1 on 09-21). Pre-1.0. | [releases](https://github.com/TencentCloud/CubeSandbox/releases) |
| Cadence | v0.1.0 04-20, v0.3.0 06-02, v0.4.0 06-14, v0.5.0 07-03, v0.6.0 07-24, v0.7.0 08-28, v0.7.1 09-11, v0.7.2 09-23. Two to five weeks apiece, each with rc builds. v0.7.1 and v0.7.2 were 70 and 56 commits from 24 and 29 contributors. | [changelog][cl072], [v0.7.1][cl071] |
| Size | 12.8k stars, 1.2k forks, about 100 contributors (API lists 101), repo created 2026-04-10. 71 open issues and 96 open PRs on 2026-10-06. | GitHub API |
| Bundle | `cube-sandbox-one-click-v0.7.2-amd64.tar.gz` 294 MB, `-arm64.tar.gz` 213 MB. PVM host kernel RPM 603 MB, DEB 59 MB. | [release assets](https://github.com/TencentCloud/CubeSandbox/releases/tag/v0.7.2) |
| "Production-ready"? | Mixed. The README and intro call it production-hardened and validated at scale in Tencent Cloud. The PVM guide says the PVM kernel is production-ready. But the Kubernetes path is labelled **preview**, cross-node pause/resume is **preview**, and the deploy guides repeat that one-click and self-build are "designed for development and evaluation" until you apply the [network hardening guide][hardening] (CubeMaster `:8089` and Cubelet `:9999` bind `0.0.0.0` with no auth or TLS by default). | [README][readme], [pvm-deploy][pvm], [k8s][k8s], [self-build][selfbuild], [hardening][hardening] |

**Roadmap (not built yet)**, per [roadmap.md][roadmap]: cross-node pause/resume *performance* (the feature itself landed as a preview in v0.7.0); full E2B API compatibility ("close remaining gaps"); **sandbox fault recovery** (crashed VMs, stuck shims, partitions); scheduling and ops (affinity, live rebalancing, node drain with migration); S3 performance and cost; **filesystem-only snapshots** (today a snapshot always includes memory); GPU sandboxes. The "control and data plane separation" the prompt names did ship in v0.7.0 (node management moved into CubeOps, multi-replica control plane; [README news][readme]).

Telemetry: a quick grep found no phone-home code; I did not audit it. **UNVERIFIED.**

## 2. Self-hosting

### Virtualisation: pick one of three

| Path | What it needs | Notes |
| --- | --- | --- |
| **Bare metal** (x86_64 or aarch64) | `/dev/kvm`, root, Docker, 8 GB RAM and 50 GB free minimum | Official. "Physical machine or bare-metal server (nested virtualization is not supported)" ([self-build][selfbuild], [multi-node][multinode]). Quick-start sizing: functional 4 cores / 8 GB / 50 GB; recommended 32 cores / 64 GB / 200 GB; self-build suggests 8+ cores and 16+ GB. |
| **Ordinary cloud VM, via PVM** | Install Tencent's PVM host kernel (6.6.69, OpenCloudOS-based, RPM or DEB), reboot, `modprobe kvm_pvm`, install with `CUBE_PVM_ENABLE=1`. **x86_64 only.** | The README's "recommended" path and what the benchmarks ran on ([pvm-deploy][pvm], [bench][bench-pvm]). Costs: you run a vendor host kernel, and v0.7.2 still fixed a PVM boot panic on Intel and an Ubuntu install failure ([changelog][cl072]). |
| Nested virtualisation on a cloud VM | n/a | Not supported. A community AWS EC2 write-up needed "three required patches" ([blog index](https://github.com/TencentCloud/CubeSandbox/blob/master/docs/blog/posts/2026-05-17-aws-nested-virt-cube-deploy.md)). Skip. |

ARM64: native on bare metal (v0.5.0, built with the Arm team). `online-install.sh` only finds x86_64 bundles; ARM needs the manual tarball ([bare-metal][baremetal]). PVM is x86_64-only ([quickstart][quickstart]).

### OS and storage

- Binaries are built on Ubuntu 20.04, so **glibc ≥ 2.31**. OpenCloudOS 9 and TencentOS 4 are recommended (XFS by default). Ubuntu 20.04/22.04/24.04 are "tested" but need a manual XFS mount.
- **`/data/cubelet` must be XFS with reflink** (copy-on-write snapshots use `FICLONE`). At least 50 GB, 200 GB+ recommended if you build templates ([quickstart][quickstart]).
- `systemd-resolved` or NetworkManager+dnsmasq for local DNS routing; snap-packaged Docker is rejected ([self-build][selfbuild], [v0.7.2 fixes][cl072]).

### Install paths

| Path | State | Fit for us |
| --- | --- | --- |
| **One-click installer** (`online-install.sh` or the release tarball + `install.sh`) | Stable, the documented default. Offline bundle exists. | **Use this.** One node first. |
| Multi-node: `ONE_CLICK_DEPLOY_ROLE=compute ./install-compute.sh` pointing at the control node's CubeOps `:3010` | Documented, bare-metal nodes only | Later, if one node is not enough ([multi-node][multinode], [node-ops][nodeops]). |
| **Kubernetes Helm chart** | **Preview**; known pod-eviction and upgrade problems ([k8s][k8s]) | No. We do not run a cluster. |
| **Terraform** | Tencent Cloud only (TKE + CVM + CLB + managed MySQL/Redis) ([terraform][terraform]) | No. |

### What runs on one node (one-click)

| Process | Role | Port |
| --- | --- | --- |
| CubeAPI (Rust) | E2B-style REST gateway | 3000 |
| CubeMaster (Go) | scheduler | 8089 |
| CubeOps | node registry, multi-replica control plane | 3010 |
| Cubelet (+ embedded network runtime), CubeShim, CubeHypervisor | per-node VM lifecycle | 9999 gRPC, 9998 HTTP |
| CubeVS | eBPF switch, loaded by Cubelet, no port | n/a |
| CubeProxy (OpenResty) | public ingress for sandbox ports | 80, 443, 9090 (plain gRPC), 8082 admin |
| CubeEgress (OpenResty, container) | transparent L7 egress proxy | 8080/8443 on `192.168.0.1` (TPROXY), admin 9091 on loopback |
| cube-lifecycle-manager | idle sweeper, auto-pause and resume | n/a |
| MySQL (or Postgres, `CUBE_DATABASE_DRIVER`), Redis | state, routing metadata | loopback |
| CoreDNS | resolves `*.cube.app` for quick-start | 53 |
| WebUI | console | 12088 |
| MinIO (optional, S3 backend) | cross-node snapshots, volumes | 9000 |

Sources: [bare-metal][baremetal], [hardening][hardening], [architecture overview](https://github.com/TencentCloud/CubeSandbox/blob/master/docs/architecture/overview.md), [multi-node][multinode], [v0.7.1 changelog][cl071] (Postgres). The control plane is "stateless" over Redis; CubeAPI and CubeMaster can run several replicas.

### DNS and TLS for per-sandbox hostnames

Sandbox ports are published as `<port>-<sandboxId>.<domain>` (default domain `cube.app`). Real use needs **wildcard DNS** `*.<domain>` → the CubeProxy node, `--sandbox-domain` / `CUBE_API_SANDBOX_DOMAIN` on CubeAPI, and a **wildcard certificate** in CubeProxy's `nginx.conf` (the installer ships an mkcert cert for `cube.app`). The built-in CoreDNS is "not suitable for production" ([https-and-domain][https]).

**We can skip both** when only the Kira server talks to sandboxes. CubeProxy also routes by path: `http://<proxy>/sandbox/<id>/<port>/<rest>`, no wildcard DNS or certificate, WebSocket upgrade supported, and the envd streaming endpoints are unbuffered on this route ([https-and-domain][https], [CubeProxy nginx.conf][proxy-nginx], lines ~181-210). Keep CubeProxy on a private network and have Kira reach it by IP. Firewall everything else per the [hardening guide][hardening]; anything that reaches a sandbox IP or node port directly bypasses CubeProxy.

## 3. E2B surface: implemented versus gaps

**What the sandbox actually runs.** envd inside the guest is **unmodified upstream E2B envd** compiled from `e2b-dev/infra@2026.16` (reports version 0.5.13), copied into `cubesandbox-base` ([bring-your-own-image §7][byoi], [Dockerfile.cube-base](https://github.com/TencentCloud/CubeSandbox/blob/master/docker/Dockerfile.cube-base)). So process, filesystem and PTY behaviour is E2B's own. **The control plane (CubeAPI) is Cube's reimplementation**, and that is where the gaps are. A maintainer-run issue plans a Rust replacement envd with PTY, interactive stdin and watch *deferred* ([#1227][i1227], open): if that lands as the default, the stdin path we want would need re-checking.

### Control plane (CubeAPI)

| E2B capability | Status | Evidence |
| --- | --- | --- |
| `POST /sandboxes`, `GET /sandboxes`, `GET/DELETE /sandboxes/{id}`, `POST /sandboxes/{id}/connect`, `/pause`, `/resume`, `/timeout`, `/refreshes`, `PUT /sandboxes/{id}/network`, `/logs` | **Implemented** | [routes.rs](https://github.com/TencentCloud/CubeSandbox/blob/master/CubeAPI/src/routes.rs), [openapi.yml][openapi] |
| `GET /v2/sandboxes` (list) | Implemented, but `nextToken` pagination is ignored ([#1792](https://github.com/TencentCloud/CubeSandbox/issues/1792)) | routes.rs line 90 |
| **`POST /v2/sandboxes`, `POST /v2/sandboxes/{id}/connect`** | **Not in master.** PR [#1800][pr1800] is open. E2B's JS and Python SDKs switched create/connect to v2 in **2.51.0 (2026-09-18)**, so `Sandbox.create()` returns `405` against Cube. | [#1784][i1784], [#1819 tracker][i1819], [E2B JS changelog][e2b-js-changelog] |
| Fork (`/sandboxes/{id}/fork`) | Not implemented; Cube has native clone ([#1648](https://github.com/TencentCloud/CubeSandbox/issues/1648), PR open) | [#1819][i1819] |
| Memory-less pause (`autoPauseMemory`), resume-from-disk-only (`onResume: 'reboot'`), IAM | Not supported ([#1787](https://github.com/TencentCloud/CubeSandbox/issues/1787), open) | [#1787](https://github.com/TencentCloud/CubeSandbox/issues/1787) |
| `mcp` create option | Field accepted, no behaviour ([#1768](https://github.com/TencentCloud/CubeSandbox/issues/1768)) | issue |
| E2B template build API (v2/v3 builder DSL) | **Absent**: only `POST /templates` (build from an OCI image), rebuild, alias, build status/logs | routes.rs, openapi.yml |
| Snapshot IDs | Cube-native `POST /sandboxes/{id}/snapshots`, `/rollback`, `GET /snapshots`; ID versus name semantics diverge from E2B ([#1522](https://github.com/TencentCloud/CubeSandbox/issues/1522)) | [snapshot guide](https://github.com/TencentCloud/CubeSandbox/blob/master/docs/guide/snapshot-rollback-clone.md) |
| Volumes (`/volumes`, `volumeMounts`) | Implemented, E2B-compatible, pluggable backends (S3, JuiceFS added in v0.7.2) | [volume-plugin](https://github.com/TencentCloud/CubeSandbox/blob/master/docs/guide/volume-plugin.md), [v0.7.2][cl072] |
| E2B API key format (`e2b_…`) | Not validated by Cube. Docs use the placeholder `e2b_000000`; with the auth callback unset, anything passes. | [bare-metal][baremetal], [authentication][auth] |
| `envdAccessToken` | CubeAPI always returns `None` (`services/sandboxes.rs` lines 143, 656). E2B SDKs ≥ 2.51 assume "always secure envd access". How they behave with no token is **UNVERIFIED**. | source |

**SDK drift is the live risk.** There is no declared compatibility matrix ([#934][i934], [#1784][i1784]). The suite only validates the *Python* SDK; `e2b==2.21.0`, `2.26.0` and `2.29.5` are recorded as working, 2.37.1 as not yet validated ([e2b-versions.txt](https://github.com/TencentCloud/CubeSandbox/blob/master/tests/e2e/sdk_compat/e2b-versions.txt)). **No statement or test exists for the E2B JS SDK** against Cube. Cube's own `@cubesandbox/sdk` (npm, version 0.3.0, Node ≥ 18, uses `undici` with a custom dispatcher) is the only JS client the project tests ([sdk/node/README.md][node-sdk]). I found nothing about running either under Bun. **UNVERIFIED.**

### Data plane (envd), which is what `pi` needs

| Capability | Works? | Evidence |
| --- | --- | --- |
| Run a command, stream stdout/stderr | Yes, `process.Process/Start`, server-streaming Connect | [Node SDK commands.ts][node-cmds] |
| Keep **stdin open** | Yes at the envd level: `StartRequest.stdin = true`, then unary `SendInput`, `CloseStdin` to send EOF, or `StreamInput`. **Cube's SDKs hard-code `stdin: false` for `commands.run`**, so they do not expose it; we send the Connect request ourselves. | [process.proto][e2b-proto]; Cube SDK line `const payload = { process, stdin: false }` in [commands.ts][node-cmds] |
| Process survives client disconnect | **Yes.** envd runs the process on `context.Background()` "We do not want the command to be killed if the request context is cancelled". The hard deadline is the `Connect-Timeout-Ms` header, so **omit it** (zero or negative values hang, [#1484](https://github.com/TencentCloud/CubeSandbox/issues/1484)). | [envd start.go][e2b-start], [commands.ts][node-cmds] comments |
| Reconnect to a running process | Yes: `process.Process/Connect` with `{pid}` or `{tag}`; `List` returns pids and tags; `Start` takes a `tag`. **No output replay**: `Fork()` subscribes to future events only, with no buffer. Output produced while disconnected is gone. | [envd connect.go][e2b-connect], [multiplex.go](https://github.com/e2b-dev/infra/blob/2026.16/packages/envd/internal/services/process/handler/multiplex.go) |
| PTY | Yes, create/connect/sendStdin/resize/kill; Node SDK has `sb.pty.connect(pid)` to reattach | [Node SDK README][node-sdk] |
| Files: read, write, list, stat, mkdir, rename, remove | Yes (`GET/POST /files`, `filesystem.Filesystem/*`). Node SDK `files.read` ignores `format` and always UTF-8 decodes, which breaks binary ([#1570](https://github.com/TencentCloud/CubeSandbox/issues/1570), PR open). | [README][node-sdk] |
| Directory watch | Yes, `WatchDir` streamed; CubeProxy keeps it unbuffered | [proxy nginx.conf][proxy-nginx] |
| Port access (`get_host`) | `<port>-<id>.<domain>`, or `/sandbox/<id>/<port>/` | [https-and-domain][https] |
| HTTP and **WebSocket** into a server in the sandbox | Yes via CubeProxy (`Upgrade` headers forwarded). **HTTP buffering is on** except for envd Start/Connect/WatchDir, so SSE from your own server needs `X-Accel-Buffering: no`. | [proxy nginx.conf][proxy-nginx] |
| Lock inbound access | `network.allow_public_traffic=false` gives a per-sandbox token header on every inbound request. The token is returned **once** at create and has **no rotation API**. It applies to "every inbound request to the sandbox's public URL"; whether that includes envd `:49983` is **UNVERIFIED**. | [restrict-public-access][restrict] |

### Templates

A template is built from an **OCI image you push to a registry the Cube nodes can pull from**, not from a Dockerfile ([templates][templates], [template-from-image][tpl-image]):

```bash
cubemastercli tpl create-from-image --image <registry>/kira-pi:<tag> \
  --writable-layer-size 4G --cpu 2000 --memory 2000 \
  --expose-port 49983 --probe 49983 --probe-path /health [--backend s3]
cubemastercli tpl watch --job-id <id>
```

- The build pulls the image, converts it to a microVM rootfs, boots it, **waits for the probe to return 2xx, then snapshots filesystem and memory**. That is the template. Pre-warmed processes in the image restore with it ([templates][templates], [prewarm][prewarm]).
- **CPU, memory and disk are fixed in the template** (`--cpu` millicores default 2000, `--memory` MB default 2000, `--writable-layer-size`); `NewSandbox` has no resource fields ([template.go][cli-template], [openapi.yml][openapi]).
- Start `FROM ghcr.io/tencentcloud/cubesandbox-base:2026.16` (Ubuntu 22.04 plus envd), or copy `envd` and `cube-entrypoint.sh` out of it. `-isnotfc` must be passed to envd or `/init` stalls on a non-existent Firecracker metadata service ([bring-your-own-image][byoi]).
- Bake the CubeEgress CA with `--with-cube-ca` (default true); without it HTTPS fails before any rule is consulted ([security-proxy][secproxy]).
- **Build time and template size: not documented** ("the image is large... may take a while", [bare-metal][baremetal]). **UNVERIFIED.** Measure on the first host.
- Templates are distributed to every node; node reboot once lost the local template inventory ([#1797](https://github.com/TencentCloud/CubeSandbox/issues/1797), closed after 0.7.1).

### Snapshots, clone, rollback, volumes

- `create_snapshot` captures **memory and writable filesystem**; `clone(n)` makes n independent sandboxes from the current state; `rollback` restores in place and keeps the sandbox ID. Hundred-millisecond scale, CubeCoW reflink ([snapshot guide](https://github.com/TencentCloud/CubeSandbox/blob/master/docs/guide/snapshot-rollback-clone.md)). A snapshot can itself be used as a `templateID`.
- Volumes outlive kill and recreate ("files across kill + recreate") and can be mounted read-only ([agent-platform-freeze][freeze], [Node README][node-sdk]). Host mounts are pinned to one node.

### Documented incompatibilities, collected

1. v2 create/connect missing, so `e2b` ≥ 2.51 fails ([#1784][i1784]).
2. No E2B version matrix; 2.26+ once hung silently on `commands.run`, since fixed in 0.5.1 ([#934][i934]).
3. E2B SDKs need wildcard DNS for `*.cube.app` and trust of the cert, or a sidecar ([e2b-dev-sidecar](https://github.com/TencentCloud/CubeSandbox/tree/master/examples/e2b-dev-sidecar), dev only).
4. `stdin` is hard-coded off in Cube's own SDKs; `user` defaults to `root` "for compatibility with envd versions that reject... without an explicit user" ([Node README][node-sdk]).
5. `files.read` format handling ([#1570](https://github.com/TencentCloud/CubeSandbox/issues/1570)).
6. No `envdAccessToken`, no E2B template builder, no fork, no MCP, no memory-less pause (above).
7. Cube extras with no E2B equivalent: seconds not milliseconds for `timeout`; `lifecycle.on_timeout="kill"` default; `NEVER_TIMEOUT = -1` ([lifecycle][lifecycle]).

**Recommendation:** a Kira-owned client of about 300 lines: `fetch` to CubeAPI for create/connect/pause/kill/timeout/network, and `fetch` with a streamed body for envd Connect-JSON (5-byte envelope `[flags][len BE32][json]`, base64 for `bytes`). [`sdk/node/src/commands.ts`][node-cmds] is the working reference. That removes the version-drift risk and the Bun-versus-`undici` question in one move.

## 4. Auth, tenancy, quotas, audit

- **CubeAPI auth is off by default** ("allows all requests"). Set `AUTH_CALLBACK_URL` (or `--auth-callback-url`) and every request is forwarded as a `POST` with `Authorization: Bearer` or `X-API-Key`, plus `X-Request-Path` and `X-Request-Method`. **200 allows, anything else is 401; an unreachable callback is 500.** The callback response carries no identity ([authentication][auth]).
- **No tenant, namespace or user concept in the API.** `grep` for tenant/namespace in CubeAPI finds only template and model plumbing. One admin credential is the realistic model: **Kira's server is the only caller and owns user→sandbox mapping in Postgres.** Either run CubeAPI on a private address and point the callback at a one-line Kira endpoint, or bind CubeAPI to the private network and use a static key.
- Per-sandbox `metadata` is stored and filterable on `GET /v2/sandboxes?metadata=…`, but **paused sandboxes lose labels and metadata on lookup** ([#1843][i1843], open), so do not use metadata as the ownership record.
- **Rate limit:** a token bucket per `X-API-Key` on CubeAPI ([rate_limit.rs](https://github.com/TencentCloud/CubeSandbox/blob/master/CubeAPI/src/middleware/rate_limit.rs)).
- **Quotas are per node, not per tenant**: `host.quota.mcpu_limit`, `mem_limit`, `mvm_limit`, `creation_concurrent_num` in `Cubelet/dynamicconf/conf.yaml` ([scheduler config](https://github.com/TencentCloud/CubeSandbox/blob/master/docs/guide/cubemaster-scheduler-config.md)). Kira enforces ADR 0005's cap on chats running at once; Cube only stops scheduling when a node is full.
- **Audit:** CubeEgress writes one JSONL line per outbound request to `/data/log/cube-egress/access.jsonl` on the node ([security-proxy][secproxy]). CubeAPI has pluggable HTTP/file/OTLP logging (`CubeAPI/src/logging/`). I found no control-plane audit trail (who created or killed what) described in the docs. Kira should log its own sandbox lifecycle events. **UNVERIFIED** beyond that.

## 5. Network and secrets (CubeVS + CubeEgress)

### How it composes

Traffic leaves the microVM's TAP device into **CubeVS** (eBPF): per-sandbox allow/deny on IP and CIDR, DNS-learned allowances for domain names, SNAT. Anything an L7 `rule` names, on TCP 80/443 (or a custom `(port, scheme)` you declare, at most 8 per host), is redirected by TPROXY into **CubeEgress**, which terminates TLS with a leaf certificate signed by the cluster CA (baked into the template), evaluates the rules, optionally injects headers, and re-opens TLS to the real upstream with `proxy_ssl_verify on` ([security-proxy][secproxy], [network-policy][netpolicy]).

### Answering (a), (b), (c)

**(a) Allow only the Kira server and github.com: yes.** Create with `allow_internet_access=false` and one rule per host with `host` and `sni` set; those hosts are auto-allowed at L3 (a rule with only `path` or `method` never reaches CubeEgress). Anything unmatched is a TCP reset at CubeVS, and an unmatched request that does reach CubeEgress gets a 403 (**default deny**). Built-in `deny_out` blocks RFC1918, loopback and link-local when internet access is on; with it off, `allow_out` and rule targets still win ("allow > deny > default"). If the Kira server has a private address, allow it by IP in a rule (`host` accepts IPv4 and CIDR) ([network-policy][netpolicy]). **UNVERIFIED:** that a private-IP L7 rule behaves with `allow_internet_access=false`.

**(b) Inject a credential the sandbox never sees: yes, both cases.**

```ts
network: {
  rules: [
    { name: "kira-model", match: { scheme: "https", host: "kira.example.co.id", sni: "kira.example.co.id" },
      action: { allow: true, audit: "metadata",
        inject: [{ header: "Authorization", format: "Bearer ${SECRET}", secret: kiraRunKey }] } },
    { name: "github", match: { scheme: "https", host: "github.com", sni: "github.com", path: "/KairosUtamaIndonesia/*" },
      action: { allow: true, audit: "metadata",
        inject: [{ header: "Authorization", format: "Basic ${SECRET}", secret: base64("x-access-token:" + ghToken) }] } },
  ],
}
```

- `format` is any template containing `${SECRET}`, so `Bearer ${SECRET}` and `Basic ${SECRET}` both work. Git over HTTPS sends preemptive `Authorization: Basic base64(x-access-token:TOKEN)` accepted by GitHub (the form `actions/checkout` uses). **UNVERIFIED against CubeEgress and GitHub's current behaviour:** test `git clone` and `git push` first. SSH is not proxied; HTTPS only.
- **A header the sandbox sets itself is cleared** before injection, so a process cannot pre-seed its own `Authorization` ([access_phase.lua][egress-lua], lines ~365-373). Injection runs only when scheme is http or https and **Host equals SNI**; otherwise injects are dropped and a `security_event` is logged. Inject on plain HTTP is allowed but flagged unsafe (a DNS attacker could redirect the secret); use `scheme="https"`.
- Secrets are inline in the rule list pushed at create time; a value is limited to **2048 bytes** (v0.7.1, [changelog][cl071]); audit logs redact them. The sandbox's environment, filesystem and process space never contain them. They do live on the node (CubeEgress memory and Cubelet's persisted policy), readable by node root. **UNVERIFIED:** whether any API response echoes rules back.
- **Rotation:** `PUT /sandboxes/{id}/network` **replaces the whole policy** (fields you omit are cleared, including `allowInternetAccess`, which silently restores internet access). Send the full desired policy each time. In-flight connections are re-judged on the next packet. This is the path for a GitHub installation token (1-hour expiry) or a re-minted Kira key ([network-policy][netpolicy]).
- Path scoping is an exact string or one trailing `*`; `method` takes a list. That is enough to pin GitHub traffic to one org, or model traffic to `POST /v1/*`.

**(c) Request logs: yes.** `action.audit: "metadata"` (default) logs timestamp, sandbox IP, destination, scheme, host, method, path, status, byte counts, latency, TLS version and cipher. `full` body capture is **reserved and currently identical to `metadata`**. Deny, guard failures and TLS handshake failures land as `security_event` and `tls_handshake` lines. Logs are per node, not shipped anywhere; ship them ourselves.

### Rule semantics in one place

First match wins; request rules go before template rules; match fields AND together, missing fields wildcard; `*.example.com` matches any depth but not the apex; a deny rule without a `port` covers every port on that host; limits are 8192 allow entries, 8192 deny entries and 1024 domain entries per sandbox ([security-proxy][secproxy], [network-policy][netpolicy]).

### Caveats found in the source

1. **Streaming through CubeEgress is buffered.** `proxy_buffering on` is set globally ([CubeEgress nginx.conf][egress-nginx], line 87) and I found no override for the transparent server blocks. Model SSE would arrive in bursts unless Kira's `/v1` responds with `X-Accel-Buffering: no`, which nginx honours (nginx standard behaviour; **UNVERIFIED on this build**). Upstream timeouts are 2 hours (raised in v0.7.1 after 60-second 504s on slow LLM responses).
2. **No WebSocket through egress**: the transparent server blocks set `Connection ""` and forward no `Upgrade`. **UNVERIFIED by test.** The model path is plain HTTPS, so this only bites other tools.
3. **CA trust is per runtime.** The base image trusts the CA in the system store (git, curl). **Node ignores the system store**: `pi` needs `NODE_EXTRA_CA_CERTS=/etc/cube/ca/cube-root-ca.crt`; Python needs `REQUESTS_CA_BUNDLE` ([pi-agent guide][pi-guide]).
4. **DNS is not blocked for unlisted names** ("CubeVS no longer returns synthetic NXDOMAIN"); unmatched IPs are blocked at connect time. A resolver that is reachable can still carry DNS tunnelling. Whether a resolver is reachable under `allow_internet_access=false` is **UNVERIFIED**; test it.
5. DNS-learned IPs stay allowed until their TTL expires after a rule is removed ([network-policy][netpolicy]).

## 6. Lifecycle and cost shape

| Topic | What the docs and source say | Source |
| --- | --- | --- |
| Max lifetime | **No wall-clock ceiling.** `timeout` is an **idle** TTL in seconds. Omitted means the cluster default, and the repo ships `default_timeout_insec: -1` (never). `-1` is `NEVER_TIMEOUT`. | [lifecycle][lifecycle] |
| What counts as idle | **Requests through CubeProxy only.** CubeProxy stamps `last_active` per sandbox **in the log phase, after the response completes**, and cube-lifecycle-manager polls it. SDK calls and HTTP to a sandbox port reset it. A process that is busy but receives no proxied request does not. A single long-held `Connect` stream does not stamp until it ends. | [log_phase.lua][proxy-log], [sweeper.go][clm], [lifecycle][lifecycle] |
| Auto-pause | `lifecycle.on_timeout="pause"` plus `auto_resume=true`: pause at idle, resume transparently on the next request. Default is `on_timeout="kill"`. **`pause()` does not cancel the kill timer**: a manually paused sandbox is still deleted when its pre-pause idle deadline passes ([#1780][i1780], open; [freeze guide][freeze]). Set a long or `NEVER_TIMEOUT` timeout before pausing. | [lifecycle][lifecycle] |
| What a pause keeps | CPU registers, process memory, TCP state with no external peer, filesystem. **Outbound sockets the sandbox opened are dropped** and must be reopened by the application. | [lifecycle][lifecycle] |
| Pause and resume cost | Pause writes all anonymous memory ("full-copy mode"): about **371 ms** for a 2 GiB sandbox. Resume about **19 ms**. Incremental pause is planned. A paused sandbox costs **disk equal to its dirty memory**, **zero CPU and RAM**, but by default **still counts against the node's scheduling quota** (`host.quota.paused_resource_release_ratio`, default 0). With ratio above 0, resume can be refused with 409 when the node is full. | [PVM bench §4.6][bench-pvm], [lifecycle][lifecycle] |
| Memory and density | Marketing says under 5 MB per sandbox. **Measured on the PVM host: 27-34 MB amortised per idle 2 GiB sandbox.** Memory per sandbox is the template's `--memory`; v0.7.2 reclaims idle guest memory back to the host. | [README][readme], [bench-pvm][bench-pvm], [v0.7.2][cl072] |
| Disk | `--writable-layer-size` on the template (1G in docs, 4G suggested for `pi`). XFS reflink copy-on-write over the template. **Persists through pause and resume; lost on kill.** | [pi-agent guide][pi-guide], [architecture](https://github.com/TencentCloud/CubeSandbox/blob/master/docs/architecture/overview.md) |
| Cold start | Marketing: under 60 ms from a snapshot. Measured: avg 67 ms at 50 concurrent. This is restore from a pre-warmed template, not a boot. | [README][readme] |
| Node reboot or failure | Running sandboxes are host processes and are **lost**; "no unified automatic failover" ([#578][i578], open). Paused snapshots live on the node's XFS and come back with it. A reboot bug that dropped the template inventory was fixed after 0.7.1 ([#1797][i1797]). With the S3 backend (opt-in, cross-node resume is a **preview**) a paused sandbox can resume on another node if CPU ID and host kernel match exactly ([cross-node][xsnap]). | listed |
| Control-plane restart | Services are `Restart=on-failure` systemd units; the control plane is stateless over Redis/DB. A downstream does not restart when an upstream crashes. | [service-management](https://github.com/TencentCloud/CubeSandbox/blob/master/docs/guide/service-management.md) |

## 7. What `pi` inside a Cube sandbox looks like from Bun

**The project already ships this integration**, headless: [`docs/guide/integrations/pi-agent.md`][pi-guide] and [`examples/pi-agent-integration`](https://github.com/TencentCloud/CubeSandbox/tree/master/examples/pi-agent-integration) install `@earendil-works/pi-coding-agent` (pinned, example uses 0.80.3) in a `cubesandbox-base` image, run `pi --print --mode json` through `commands.run`, and demonstrate pause then connect with `/workspace` and `/root/.pi/agent` intact, plus CubeEgress key injection with `NODE_EXTRA_CA_CERTS`. It says "the Pi TUI is not available over the E2B protocol" and drives multi-turn from the host script. It does **not** use RPC mode.

**What we want instead is RPC mode**: `pi --mode rpc` speaks strict JSONL over stdin/stdout, split on `\n` only ([pi `docs/rpc.md`](../../../apps/desktop/node_modules/@earendil-works/pi-coding-agent/docs/rpc.md), pi 0.85.1). The flow:

1. **Template.** `FROM cubesandbox-base:2026.16`, Node 24, `pi` pinned to the desktop's 0.85.x, `git`, `ripgrep`, `fd`, Kira's skills and extensions, the CA trust variables, `WORKDIR /workspace`. Push to a registry the node can pull from; `tpl create-from-image` with `--expose-port 49983 --probe 49983 --probe-path /health`.
2. **Create.** `POST /sandboxes` with `timeout: -1`, `allow_internet_access: false`, `network.rules` from §5, `allow_public_traffic: false` (store the returned traffic token, it is returned once), and `metadata` (informational only). Note `sandboxID`.
3. **Start `pi`.** `POST <proxy>/sandbox/<id>/49983/process.Process/Start`, content type `application/connect+json`, `Authorization: Basic base64("root:")`, no `Connect-Timeout-Ms`, body:
   `{"process":{"cmd":"/bin/bash","args":["-l","-c","cd /workspace && exec pi --mode rpc --session-dir /workspace/.pi-sessions"],"envs":{...}},"tag":"chat-<chatId>","stdin":true}`.
   The response is a framed stream; each frame's `event.data.stdout` is base64. Reassemble, split on `\n`, parse each line as a pi event or response.
4. **Send input.** Each pi command (`prompt`, `steer`, `abort`, `get_state`, an extension-UI reply) is a unary `POST .../process.Process/SendInput` with `{"process":{"tag":"chat-<chatId>"},"input":{"stdin":"<base64 of the JSON line + \n>"}}`. `CloseStdin` ends the process cleanly.
5. **Unattended extension dialogs.** pi's extension UI requests (`select`, `confirm`, `input`) arrive on stdout and block until a reply arrives on stdin ([rpc.md](../../../apps/desktop/node_modules/@earendil-works/pi-coding-agent/docs/rpc.md), "Extension UI Protocol"). The Kira server must answer or cancel them when no desktop is attached, or the chat stalls.

**Reattach after the Kira server restarts:**

1. Read `sandboxId`, `tag` and the traffic token from Postgres.
2. `POST /sandboxes/{id}/connect` (resumes a paused sandbox; keep the call even when it is running).
3. `process.Process/List`, then `Connect` `{"process":{"tag":"chat-<chatId>"}}`. The `pi` process kept running while nothing listened.
4. **Catch up**, because the stream does not replay: send `get_state`, then `get_entries` with `since` set to the last entry id Kira stored. pi documents that id as "a durable cursor... even across client restarts" ([rpc.md](../../../apps/desktop/node_modules/@earendil-works/pi-coding-agent/docs/rpc.md), `get_entries`). That closes the no-replay gap without a bridge. The session file in `/workspace/.pi-sessions` survives pause and resume.
5. If the `tag` is gone (pi crashed, or a VM restore dropped it), `Start` again with `--session-dir` pointing at the same folder and `switch_session` to the last session file.

**Backpressure:** envd forwards each event to every subscriber with a blocking send; a connected but non-reading client stalls `pi`'s output pump ([multiplex.go](https://github.com/e2b-dev/infra/blob/2026.16/packages/envd/internal/services/process/handler/multiplex.go)). Always drain the stream, or disconnect.

**Port alternative, not recommended first.** `pi` has no network listener. A small bridge process in the sandbox (stdio ↔ WebSocket or SSE on a port, with its own sequence numbers and ring buffer) would also close the no-replay gap, and CubeProxy supports WebSocket. It adds a component to build and version; start with `Start`/`Connect` plus pi's `get_entries` cursor, and add the bridge only if catch-up proves insufficient (for example, live streaming deltas lost during a gap).

**Pause during a run.** Resume restores `pi`, but its open HTTPS stream to the Kira server was an outbound socket and is dropped. Mid-turn pause is a retry of that model call, not a clean continuation. Pause only between turns.

## 8. Risks and unknowns

Ranked by how likely they are to hurt, each with a cheap test on the first host (an 8-core, 16 GB bare-metal or PVM VM, one-click install, about half a day).

1. **Idle detection kills or pauses a working chat.** Idle is counted from CubeProxy request completion ([log_phase.lua][proxy-log]), `pause()` keeps the kill timer ([#1780][i1780]), and paused sandboxes lose metadata ([#1843][i1843]).
   *Test:* create with `timeout=60`, start a loop that writes a file and `curl`s an allowed host for 3 minutes with no proxied request; watch `GET /sandboxes/{id}`. Repeat with `timeout=-1`. Then `pause`, `connect`, and confirm the tagged process is still there and `Connect` works.
2. **The stdin-open process path does not behave through CubeProxy as envd's source suggests.** Cube's SDKs never use `stdin:true`, and `StreamInput` is not on the unbuffered list.
   *Test:* from a Bun script using plain `fetch`, `Start` a `cat` with `stdin:true` and a tag via the path route, `SendInput` a line, read the echo, abort the fetch, `Connect` by tag, `SendInput` again. Then `pi --mode rpc` end to end with a real prompt. Check also that the Start stream stays open past 5 minutes idle (proxy timeouts).
3. **Model and git traffic through CubeEgress.** SSE buffering, Node CA trust, header injection against GitHub, DNS exfil, private-IP allow.
   *Test:* point `pi` at Kira `/v1` with a placeholder key and the injection rule, stream a long answer and look at inter-chunk latency; repeat with `X-Accel-Buffering: no`. `git clone` and `git push` a scratch repo with `Basic ${SECRET}`. From inside run `dig @1.1.1.1 example.org`, `dig TXT x.attacker-test.example`, `curl https://example.com` (expect refusal). Rotate the secret with `PUT /network` mid-chat and confirm the next request uses it.
4. **Host kernel and hardware.** Bare metal in an Indonesian data centre may not be available quickly; PVM means a vendor kernel (603 MB RPM) on every host and Intel/Ubuntu fixes still landing ([v0.7.2][cl072]).
   *Test:* on the candidate host, `ls -la /dev/kvm`. If absent, install the PVM kernel on a scratch cloud VM from our provider and run the 50-concurrent create benchmark from [bench-pvm][bench-pvm] ([`examples/snapshot-rollback-clone/bench_pause_resume_concurrency.py`](https://github.com/TencentCloud/CubeSandbox/blob/master/examples/snapshot-rollback-clone/bench_pause_resume_concurrency.py)). Compare PVM against bare metal for a `pi` workload (tests, `npm install`), not just boot time.
5. **One node is one failure domain, and the project moves fast.** Running sandboxes die with the node ([#578][i578]); fault recovery is roadmap; cross-node resume is a preview that needs matching CPU and kernel; a release every few weeks has had upgrade notes (S3 backend became opt-in in 0.7.1; K8s networking changes in 0.7.2).
   *Test:* with one running and one paused sandbox, `reboot` the host. Record which come back, how long, and what `GET /sandboxes` and `connect` return. Then upgrade 0.7.2 to the next release on a scratch copy and note downtime and template rebuild needs.

Also watch, lower priority: template build time and size (unmeasured), the per-chat disk cost of paused memory (about the sandbox's dirty RAM), Cube's default `deny_out` of RFC1918 if the Kira server sits on a private IP, and the planned replacement envd ([#1227][i1227]).

## What this settles for the map tickets

**Where the agent loop can run.** Inside the sandbox, as `pi --mode rpc` started through envd with stdin held open; the process survives the Kira server disconnecting, and pause/resume preserves it between turns. Unattended work needs the lifecycle owned by Kira (`timeout=-1`, pause only between turns), because idle is measured by proxied requests. Reattach is `connect` plus `Connect` by tag plus a pi `get_entries` catch-up from a stored cursor; envd itself does not replay output. The server can drive it with ~300 lines over `fetch`; no E2B SDK is required or advisable.

**The trust boundary.** *Repo in:* `git clone` over HTTPS through CubeEgress, a path-scoped rule injecting GitHub `Basic` credentials; or Kira pushes files through envd's file API. *Changes out:* `git push` through the same rule to a branch (PR is the review, ADR 0024), or read files back through envd. *Credentials:* the Kira per-run key and the GitHub token live only in the rule list on the node; the sandbox holds placeholders, a self-set `Authorization` is stripped, and rotation is `PUT /network`. *Egress:* default deny, allow the Kira host and `github.com` (plus package hosts if wanted), HTTPS only, per-request JSONL audit on the node. *Open:* SSE buffering, Node CA trust and DNS exfil need the §8 tests, and whose GitHub token the rule carries (the person's or a server-minted one) is the credentials ticket's call.

**Whose allowance and hosting.** Cube has no identity: one admin key, an auth callback that returns 200 or 401, node-level capacity only. Kira's server maps user to sandbox in Postgres, mints the per-run key against the user's allowance, and enforces the cap on running chats. Hosting is a dedicated sandbox host (or a few) we own, reachable from the Kira server on a private path; bare metal or a PVM-kernel VM, **not** Coolify and **not** the Kubernetes preview. Self-hosted in Indonesia keeps code and transcripts on our hardware; the cost is operating a pre-1.0 Tencent-maintained stack with a vendor kernel option.

**Lifecycle and environment.** One template per toolchain image, built from an OCI image we push to a registry the node reaches; CPU, memory and disk are fixed in the template. A sandbox has no maximum lifetime; pause costs about 0.4 s per 2 GiB and disk equal to dirty memory, resume under a second; kill deletes its filesystem unless a volume or snapshot holds it. Running sandboxes do not survive a node loss, so durable state (the git branch, the transcript in Kira, pi's session folder on pause) must live outside the running VM.

[readme]: https://github.com/TencentCloud/CubeSandbox/blob/master/README.md
[license]: https://github.com/TencentCloud/CubeSandbox/blob/master/LICENSE
[intro]: https://github.com/TencentCloud/CubeSandbox/blob/master/docs/guide/introduction.md
[roadmap]: https://github.com/TencentCloud/CubeSandbox/blob/master/docs/guide/roadmap.md
[cl072]: https://github.com/TencentCloud/CubeSandbox/blob/master/docs/changelog/v0.7.2.md
[cl071]: https://github.com/TencentCloud/CubeSandbox/blob/master/docs/changelog/v0.7.1.md
[quickstart]: https://github.com/TencentCloud/CubeSandbox/blob/master/docs/guide/quickstart.md
[baremetal]: https://github.com/TencentCloud/CubeSandbox/blob/master/docs/guide/bare-metal-deploy.md
[pvm]: https://github.com/TencentCloud/CubeSandbox/blob/master/docs/guide/pvm-deploy.md
[selfbuild]: https://github.com/TencentCloud/CubeSandbox/blob/master/docs/guide/self-build-deploy.md
[multinode]: https://github.com/TencentCloud/CubeSandbox/blob/master/docs/guide/multi-node-deploy.md
[nodeops]: https://github.com/TencentCloud/CubeSandbox/blob/master/docs/guide/node-operations.md
[k8s]: https://github.com/TencentCloud/CubeSandbox/blob/master/docs/guide/kubernetes/index.md
[terraform]: https://github.com/TencentCloud/CubeSandbox/blob/master/docs/guide/tencentcloud-terraform-deploy.md
[hardening]: https://github.com/TencentCloud/CubeSandbox/blob/master/docs/guide/network-hardening.md
[https]: https://github.com/TencentCloud/CubeSandbox/blob/master/docs/guide/https-and-domain.md
[auth]: https://github.com/TencentCloud/CubeSandbox/blob/master/docs/guide/authentication.md
[secproxy]: https://github.com/TencentCloud/CubeSandbox/blob/master/docs/guide/security-proxy.md
[netpolicy]: https://github.com/TencentCloud/CubeSandbox/blob/master/docs/guide/network-policy.md
[restrict]: https://github.com/TencentCloud/CubeSandbox/blob/master/docs/guide/restrict-public-access.md
[lifecycle]: https://github.com/TencentCloud/CubeSandbox/blob/master/docs/guide/lifecycle.md
[freeze]: https://github.com/TencentCloud/CubeSandbox/blob/master/docs/guide/agent-platform-freeze.md
[xsnap]: https://github.com/TencentCloud/CubeSandbox/blob/master/docs/guide/cross-node-snapshot.md
[templates]: https://github.com/TencentCloud/CubeSandbox/blob/master/docs/guide/templates.md
[tpl-image]: https://github.com/TencentCloud/CubeSandbox/blob/master/docs/guide/tutorials/template-from-image.md
[prewarm]: https://github.com/TencentCloud/CubeSandbox/blob/master/docs/guide/tutorials/prewarm-template-service.md
[byoi]: https://github.com/TencentCloud/CubeSandbox/blob/master/docs/guide/tutorials/bring-your-own-image.md
[pi-guide]: https://github.com/TencentCloud/CubeSandbox/blob/master/docs/guide/integrations/pi-agent.md
[bench-pvm]: https://github.com/TencentCloud/CubeSandbox/blob/master/docs/blog/posts/2026-06-03-cubesandbox-perf-benchmark-pvm.md
[openapi]: https://github.com/TencentCloud/CubeSandbox/blob/master/openapi.yml
[cli-template]: https://github.com/TencentCloud/CubeSandbox/blob/master/CubeMaster/cmd/cubemastercli/commands/cubebox/template.go
[node-sdk]: https://github.com/TencentCloud/CubeSandbox/blob/master/sdk/node/README.md
[node-cmds]: https://github.com/TencentCloud/CubeSandbox/blob/master/sdk/node/src/commands.ts
[egress-lua]: https://github.com/TencentCloud/CubeSandbox/blob/master/CubeEgress/lua/access_phase.lua
[egress-nginx]: https://github.com/TencentCloud/CubeSandbox/blob/master/CubeEgress/nginx.conf
[proxy-nginx]: https://github.com/TencentCloud/CubeSandbox/blob/master/CubeProxy/nginx.conf
[proxy-log]: https://github.com/TencentCloud/CubeSandbox/blob/master/CubeProxy/lua/log_phase.lua
[clm]: https://github.com/TencentCloud/CubeSandbox/blob/master/cube-lifecycle-manager/internal/sweeper/sweeper.go
[i934]: https://github.com/TencentCloud/CubeSandbox/issues/934
[i1227]: https://github.com/TencentCloud/CubeSandbox/issues/1227
[i1784]: https://github.com/TencentCloud/CubeSandbox/issues/1784
[i1819]: https://github.com/TencentCloud/CubeSandbox/issues/1819
[i1780]: https://github.com/TencentCloud/CubeSandbox/issues/1780
[i1843]: https://github.com/TencentCloud/CubeSandbox/issues/1843
[i578]: https://github.com/TencentCloud/CubeSandbox/issues/578
[i1797]: https://github.com/TencentCloud/CubeSandbox/issues/1797
[pr1800]: https://github.com/TencentCloud/CubeSandbox/pull/1800
[e2b-proto]: https://github.com/e2b-dev/infra/blob/2026.16/packages/envd/spec/process/process.proto
[e2b-connect]: https://github.com/e2b-dev/infra/blob/2026.16/packages/envd/internal/services/process/connect.go
[e2b-start]: https://github.com/e2b-dev/infra/blob/2026.16/packages/envd/internal/services/process/start.go
[e2b-js-changelog]: https://github.com/e2b-dev/E2B/blob/main/packages/js-sdk/CHANGELOG.md
