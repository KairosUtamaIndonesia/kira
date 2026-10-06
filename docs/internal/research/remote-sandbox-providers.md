# Remote sandbox backends for Kira runs

**Question:** Which remote sandbox backends could Kira run an agent chat (and ticket work) inside, instead of on the user's own machine? The agent needs a git checkout, pi's `bash`/`read`/`write`/`edit`/`grep`/`find`/`ls` tools, the ability to run tests and a dev server, outbound network only to the Kira server and the git host, hours-long life with pause/resume, desktop steering, and ideally self-hosting.

**Conclusion:** Start with plain Docker (optionally under gVisor) on a dedicated sandbox host we own, with the **whole `pi` process inside the container** in RPC mode. That is the only option that is self-hosted, needs no new vendor, and can be built in days. For a later production shape, keep the same manager API and swap the container for a microVM: [E2B's open-source runtime](https://github.com/e2b-dev/runtime) (Firecracker, Apache-2.0) is the closest self-hostable match, with [Gondolin](https://github.com/earendil-works/gondolin) and [NVIDIA OpenShell](https://docs.nvidia.com/openshell/about/overview) as lighter alternatives. Hosted SaaS (Vercel Sandbox, Fly Sprites, Modal, Cloudflare) fits the feature list well but none is self-hostable, and none of the region lists I read names Jakarta. Daytona stopped being a self-hostable option in June 2026.

Research date 2026-10-06. Everything below is from vendor docs, source repos, OpenAPI specs, or pricing pages, fetched that day. Items I could not confirm from a primary source are marked **UNVERIFIED**.

## Two topologies, and why it decides the choice

pi's own [containerization guide](../../../apps/desktop/node_modules/@earendil-works/pi-coding-agent/docs/containerization.md) names the two patterns: "run the whole `pi` process inside an isolated environment, or run `pi` on the host and route tool execution into an isolated environment."

| | A. Loop on desktop, tools routed to sandbox | B. Whole `pi` inside sandbox |
| --- | --- | --- |
| Mechanism | `*Operations` overrides, as in [`ssh.ts`](../../../apps/desktop/node_modules/@earendil-works/pi-coding-agent/examples/extensions/ssh.ts) and [`gondolin/index.ts`](../../../apps/desktop/node_modules/@earendil-works/pi-coding-agent/examples/extensions/gondolin/index.ts) | `pi --mode rpc` (headless JSONL over stdin/stdout, [`docs/rpc.md`](../../../apps/desktop/node_modules/@earendil-works/pi-coding-agent/docs/rpc.md)) or the SDK, started in the sandbox |
| Survives a closed laptop | No: the loop is the desktop process | Yes |
| Steering | Free: same `AgentSession` as today | Needs a relay: desktop ↔ server ↔ sandbox |
| Per-tool-call cost | One network round trip each | None |
| Model credentials | Stay on the desktop's path | Sandbox needs a Kira-issued token for the model proxy, never a provider key |
| Extensions and skills | Still run on the host unless they also delegate | Run inside the boundary |

Topology A fixes isolation and environment, not "hours-long, unattended". ADR 0012 ([`docs/adr/0012-a-run-happens-on-a-desktop.md`](../../adr/0012-a-run-happens-on-a-desktop.md), since superseded by ADR 0024) says "Revisit if a remote sandbox ever exists"; a server-run worker is that case, and it implies topology B. Cloudflare publishes the same shape for pi: install `@earendil-works/pi-coding-agent` in the image, run it in the sandbox, and let the sandbox reach "only your gateway and `github.com`" ([Run Pi in a sandbox](https://developers.cloudflare.com/sandbox/coding-agents/pi/index.md)).

### What topology A needs from a backend

The ops interfaces are small ([`dist/core/tools/*.d.ts`](../../../apps/desktop/node_modules/@earendil-works/pi-coding-agent/dist/core/tools/)): `ReadOperations` (`readFile`, `access`), `WriteOperations` (`writeFile`, `mkdir`), `EditOperations` (read + write + `access`), `LsOperations` (`exists`, `stat`, `readdir`), `FindOperations.glob`, `BashOperations.exec(command, cwd, {onData, signal, timeout, env})`. Any backend with "exec with streamed output" plus "read/write bytes" covers them; `ssh.ts` builds all of them from `ssh host cmd`.

Two traps found in pi 0.85.1 source:

- **`grep` is not fully pluggable.** `GrepOperations` has only `isDirectory` and `readFile`, and the tool still calls `ensureTool("rg")` and spawns a **local** `rg` on the resolved path ([`grep.js`](../../../apps/desktop/node_modules/@earendil-works/pi-coding-agent/dist/core/tools/grep.js), lines 30-101). A remote `grep` must be a full tool override, which is what the Gondolin example does (`executeGondolinGrep`, walking the guest filesystem through the VM API). The simpler remote version runs `rg --json` through `bash` exec.
- **`find` is pluggable** only if you supply `glob`; without it the tool spawns local `fd` ([`find.js`](../../../apps/desktop/node_modules/@earendil-works/pi-coding-agent/dist/core/tools/find.js), lines 67-119).

Topology B has neither problem: pi runs next to the files.

## Cross-cutting constraints

- **Reachability.** A sandbox must reach the Kira server, and every hosted provider can only do that over the public internet. Kira's server already has public ingress for desktops, so this is a token and TLS question, not a network change. Sprites always blocks private IPs ([networking](https://docs.fly.io/sprites/concepts/networking.md)), so a private-only Kira endpoint would not work there.
- **Egress allow-list.** Needed: Kira server + git host only. Providers differ in granularity (domain vs CIDR vs HTTP-only); see the table.
- **Credentials in the sandbox.** Git access should be a short-lived, repo-scoped token. Gondolin, OpenShell, Vercel, Cloudflare, E2B, Daytona and Sprites all advertise injecting secrets at the egress proxy so the guest never holds the real value; plain Docker has no such thing.
- **Residency.** Vercel offers `sin1` Singapore ([regions](https://vercel.com/docs/sandbox/concepts/regions.md)); Fly has `sin` ([pricing page region table](https://fly.io/pricing.md)); Modal has `ap-southeast` ([region selection](https://modal.com/docs/guide/region-selection), country not stated in the text I read); Daytona has `us` and `eu` shared regions ([sandboxes](https://www.daytona.io/docs/en/sandboxes/)). I found no Jakarta or Indonesia region at any of them. Cloudflare placement control: **UNVERIFIED**.

## Candidates

### 1. Self-hosted Docker/Podman on our own host

- **Isolation:** namespaces + cgroups on a shared kernel. [gVisor](https://github.com/google/gvisor) adds a userspace application kernel through its OCI runtime `runsc`, which "integrates with Docker and Kubernetes"; it is "not a VM". [Kata Containers](https://github.com/kata-containers/kata-containers) runs each container in a lightweight VM (Apache-2.0; needs hardware virtualization).
- **Self-hostable:** yes. Docker Engine and Podman are Apache-2.0.
- **Lifecycle:** the [Docker Engine API](https://docs.docker.com/reference/api/engine/version/v1.52.yaml) has `/containers/{id}/pause`, `/exec`, `/archive`, `/update` and `/commit`. `docker pause` uses the freezer cgroup, so the process is frozen with memory intact ([docs](https://docs.docker.com/reference/cli/docker/container/pause/)); that lasts only while the host stays up. Stop keeps the filesystem and kills processes. No cross-host migration.
- **Exec/files:** `exec` with streamed stdio maps to `BashOperations`; `/archive` is tar in/out, so file ops are `exec cat`/`tee` or tar. Ports: publish or attach a reverse proxy.
- **Egress:** `docker network create --internal` "restrict[s] external access to the network" ([CLI](https://docs.docker.com/reference/cli/docker/network/create/)). An allow-list needs a forward proxy container on both networks (DIY, for example Squid or [Smokescreen](https://docs.fly.io/app-guides/smokescreen.md)). I found no built-in domain allow-list in the Docker network docs I read (**UNVERIFIED** that none exists).
- **Image:** whatever we build: bun, node, git, rg, fd baked in; instant start.
- **Max duration:** none.
- **Cost:** host only.
- **Coolify:** it is a deployment orchestrator, not a sandbox API. Its OpenAPI ([`openapi.json`](https://raw.githubusercontent.com/coollabsio/coolify/v4.x/openapi.json), 202 paths) can create an app from a Docker image (`POST /applications/dockerimage`, [docs](https://coolify.io/docs/api-reference/api/operations/create-dockerimage-application)) and start/stop/restart it, but I found **no** ad-hoc exec, file, or run endpoint; only scheduled tasks, which can be executed on demand. Use Coolify to manage the sandbox *host* at most; a small manager in the Kira server should call the Docker API directly. Do not put the Docker socket on the same host as Postgres and CLIProxyAPI.
- **Maturity:** the most mature option on this list; weakest isolation.

### 2. Gondolin, and Firecracker/Kata/gVisor-class isolation

- **Gondolin** ([repo](https://github.com/earendil-works/gondolin), Apache-2.0, 2.2k stars, pushed 2026-10-04; same vendor as pi): "local Linux micro-VMs with programmable network and filesystem control", QEMU by default, experimental libkrun backend.
- **Self-hostable:** yes, but it is a **library on one host**, not a service. We would write the manager, scheduler and relay.
- **Lifecycle:** `VM.create`, `vm.close()`, disk-only checkpoints with resume (`vm.checkpoint(path)`, `checkpoint.resume()`). **No memory snapshots** ([Limitations](https://earendil-works.github.io/gondolin/limitations/)).
- **Exec/files:** `vm.exec([...])` with streamed `proc.output()`, `vm.fs.readFile/writeFile/listDir/stat/access/mkdir`, SSH and an ingress gateway for guest HTTP services. This maps one-to-one onto pi's ops; the pi example proves it.
- **Egress:** host-side HTTP/TLS allow-lists and request hooks, secret placeholders injected only for allowed hosts. Limits: HTTP/1.x and TLS-intercepted HTTPS only, no HTTP/2, HTTP/3, QUIC or generic UDP. Git over HTTPS and Kira's HTTP API are fine; mediated networking "is not the same as safe networking" (its own [security doc](https://earendil-works.github.io/gondolin/security/)).
- **Image:** Alpine only; extra packages mean building a custom image ([Limitations](https://earendil-works.github.io/gondolin/limitations/)). First use downloads ~200 MB of guest assets.
- **Host requirements:** Node.js >= 23.6, QEMU (README, example header). Running under Bun on the Kira server: **UNVERIFIED**.
- **Firecracker** ([repo](https://github.com/firecracker-microvm/firecracker), Apache-2.0): microVMs on KVM, built at AWS for Lambda and Fargate. Full snapshot support, with a documented "snapshot security and uniqueness" section ([snapshot-support.md](https://github.com/firecracker-microvm/firecracker/blob/main/docs/snapshotting/snapshot-support.md)). It is a VMM, not a platform: no exec or file API, no manager. Building on it directly is what E2B did; see below.
- **Maturity:** Gondolin is young (single vendor, README discloses agent-assisted development); Firecracker, Kata, gVisor are production-grade.

### 3. Daytona

- **Isolation:** container by default (own namespaces; the overview also says "dedicated kernel", but the Isolation page gives a real kernel boundary only to the VM classes); Linux VM sandboxes for pause/fork ([Isolation](https://www.daytona.io/docs/en/isolation.md)).
- **Self-hostable: no longer, in practice.** The open-source repository's README says: "As of June 2026, Daytona's core development has moved to a private codebase. This repository will receive no further updates, fixes, or releases" ([README](https://raw.githubusercontent.com/daytonaio/daytona/main/README.md)); GitHub shows it archived, last push 2026-07-24, AGPL-3.0 (`LICENSE` at tag v0.190.0). Today's self-hosting story is "bring your own compute": custom regions with your runners, while the API/control plane stays at `app.daytona.io` ([BYOC](https://www.daytona.io/docs/en/bring-your-own-compute.md), [architecture](https://www.daytona.io/docs/en/architecture.md)). Whether runners/proxy are open for download: **UNVERIFIED**.
- **Lifecycle:** start/stop/archive for containers; pause/resume, fork and memory snapshots for **Linux VM** class only, and VM sandboxes can only be created from existing VM snapshots ([Sandboxes](https://www.daytona.io/docs/en/sandboxes/)). Auto-stop defaults to 15 minutes and is not reset by background processes such as `npm run dev` (same page); set `auto_stop_interval=0` for long runs.
- **Exec/files:** richest file API on the list: `list_files`, `search_files`, `find_files`, `replace_in_files`, upload/download, plus sessions for background processes and PTY ([file ops](https://www.daytona.io/docs/en/file-system-operations.md), [process](https://www.daytona.io/docs/en/process-code-execution.md)). Preview URLs per port.
- **Egress:** `domainAllowList` / `networkAllowList` / `networkBlockAll` per sandbox, but only on organization tiers 3-4; tiers 1-2 get an organization-wide restriction that cannot be overridden ([Network limits](https://www.daytona.io/docs/en/network-limits.md)).
- **Limits:** default 1 vCPU / 1 GiB / 3 GiB, org maximum 4 vCPU / 8 GiB / 10 GiB per sandbox ([Sandboxes](https://www.daytona.io/docs/en/sandboxes/)). Pay-as-you-go on reserved vCPU, RAM and disk ([Billing](https://www.daytona.io/docs/en/billing.md)); I did not extract the unit rates.
- **Verdict:** feature-rich SaaS, but fails "self-hostable" today.

### 4. E2B

- **Isolation:** one Firecracker microVM per sandbox, own cgroup and network namespace, per-sandbox nftables egress firewall ([runtime README](https://raw.githubusercontent.com/e2b-dev/infra/main/README.md)).
- **Self-hostable: yes, with a caveat.** The full backend is [`e2b-dev/runtime`](https://github.com/e2b-dev/runtime) (Apache-2.0, 1.7k stars, pushed 2026-10-05; SDK repo [`e2b-dev/E2B`](https://github.com/e2b-dev/E2B), 14k stars). [E2B Embed](https://raw.githubusercontent.com/e2b-dev/infra/main/embed/README.md) runs "the whole E2B stack" on one machine via Docker Compose, Terraform (GCP/AWS/Azure) or one Kubernetes node. It needs Linux with KVM (bare metal or nested virtualization), Docker 27+, 12 GiB RAM recommended ([compose guide](https://raw.githubusercontent.com/e2b-dev/runtime/main/embed/compose/README.md)). The README calls it "an evaluation package, not a production deployment pattern"; production is "a dedicated deployment inside your account" through [E2B Enterprise](https://e2b.dev/enterprise). Dependencies: Postgres, Redis, ClickHouse, object storage.
- **Lifecycle:** `Sandbox.create`, `setTimeout`, `pause` (filesystem **and memory**, "kept indefinitely"), `connect` to resume, `kill`, snapshots and fork ([persistence](https://docs.e2b.dev/sandbox/persistence.md), [lifetime FAQ](https://docs.e2b.dev/faq/sandbox-lifetime.md)). Default timeout 5 minutes. Idle sandboxes auto-pause and incoming traffic wakes them (runtime README).
- **Exec/files:** `commands.run` (foreground or `background: true`, `onStdout`, `commands.connect(pid)` to reattach, `kill`), PTY, `files.read/write/list/watch`, upload/download, public URL `https://<port>-<sandbox>.<domain>` ([commands](https://docs.e2b.dev/commands/background.md), [PTY](https://docs.e2b.dev/sandbox/pty.md)). No grep/find API: run `rg`/`fd` in the sandbox. The in-VM `envd` agent speaks Connect RPC and REST.
- **Egress:** `allowInternetAccess: false`, or `network.allowOut` / `denyOut` with IPs, CIDRs and **domains** (domains allowed only with a deny-all; "Domains are not supported in the deny lists") ([Internet access](https://docs.e2b.dev/network/internet-access.md)). Secrets can be injected into matching requests ([inject](https://docs.e2b.dev/secrets/inject.md)).
- **Image:** templates built from Docker images and build steps, with bun/node examples ([Next.js (Bun) template](https://docs.e2b.dev/template/examples/nextjs-bun.md)); a sandbox "creation" restores a snapshot.
- **Max duration:** continuous runtime Hobby 1 h, Pro 24 h, Enterprise custom; pause resets it; paused sandboxes never expire ([Billing & limits](https://docs.e2b.dev/billing.md)). Self-hosted limits: **UNVERIFIED**.
- **Cost (cloud):** $0.000014/s per vCPU on Hobby/Pro (2 vCPU default = $0.000028/s ≈ $0.10/h); Pro $150/month ([pricing](https://e2b.dev/pricing), [billing](https://docs.e2b.dev/billing.md)). RAM/disk rates: **UNVERIFIED**.
- **Maturity:** active, large SDK community; self-hosted production depends on a commercial agreement.

### 5. Modal Sandboxes

- **Isolation:** gVisor by default, or a VM runtime with its own kernel ([Sandboxes](https://modal.com/docs/guide/sandbox)).
- **Self-hostable:** no (hosted only; client SDK is Apache-2.0).
- **Lifecycle:** `Sandbox.create`, `terminate`, **no pause/resume**. Default lifetime 5 minutes, maximum 24 hours; for longer, snapshot and restore ([same page](https://modal.com/docs/guide/sandbox)). Snapshots: filesystem and directory (30-day default TTL, can be disabled), memory (7 days, not extendable) ([Snapshots](https://modal.com/docs/guide/sandbox-snapshots)). Idle timeout counts open tunnels and running `exec` as activity.
- **Exec/files:** `sb.exec` with `stdout`/`stderr`/`stdin`; `sb.filesystem.read_text/write_text/list_files/stat/remove/make_directory` ([files](https://modal.com/docs/guide/sandbox-files)); TCP tunnels to the public internet ([Tunnels](https://modal.com/docs/guide/tunnels)). JS and Go SDKs are marked Beta in the docs nav.
- **Egress:** `block_network`, `outbound_cidr_allowlist`, and a **Beta** `outbound_domain_allowlist` that "only allows TLS traffic (port 443)" ([Networking and security](https://modal.com/docs/guide/sandbox-networking)). Enough for an HTTPS-only Kira server and git host.
- **Cost:** CPU $0.00003942 per physical core-second (2 vCPU equivalent), memory $0.00000667 per GiB-second ([pricing](https://modal.com/pricing)). My arithmetic: 2 vCPU + 4 GiB, fully busy ≈ $0.24/h.
- **Residency:** selectable container region including `ap-southeast` ([residency](https://modal.com/docs/guide/data-residency)); sandbox lifecycle requests still pass through Modal's control plane (same page).
- **Verdict:** good API, but no pause and a 24 h cap make "hours-long steerable chat" a snapshot-and-restore dance.

### 6. Fly.io Machines (and Sprites)

**Machines**

- **Isolation:** Firecracker microVMs (suspend docs: "Suspend uses Firecracker snapshots") ([Suspend and Resume](https://fly.io/docs/reference/suspend-resume/)).
- **Self-hostable:** no.
- **Lifecycle:** Machines API: create, start, stop, suspend, wait, delete ([OpenAPI](https://docs.fly.io/api/machines/openapi.json)). Suspend saves memory, but needs **≤ 2 GB** memory, and "Snapshots aren't guaranteed to persist" (host migration, maintenance, redeploy).
- **Exec/files:** `POST .../exec` is documented as returning stdout, stderr and exit code in a single response (streaming not documented), and the OpenAPI paths I listed include no file read/write endpoint (use `exec cat`).
- **Egress:** no first-party per-Machine allow-list in the docs index I read; Fly documents running your own Smokescreen proxy instead ([guide](https://docs.fly.io/app-guides/smokescreen.md)).
- **Cost:** `performance-1x` 2 GB $0.0458/h; Singapore multiplier 1.269 ([pricing](https://fly.io/pricing.md)).
- **Verdict:** a general VM host, not an agent sandbox. Skip in favour of Sprites if using Fly at all.

**Sprites** (Fly's agent product, [overview](https://fly.io/sprites.md))

- **Isolation:** "persistent, hardware-isolated Linux environments" ([docs](https://docs.fly.io/sprites/index.md)); the hypervisor is not named in the pages I read (**UNVERIFIED**).
- **Self-hostable:** no.
- **Lifecycle:** create/get/delete, automatic sleep. Warm (VM suspended, processes preserved, wake 100-500 ms) then cold (processes dropped, 1-2 s wake) after about 30 s idle; open TCP connections drop either way. A Tasks API holds a Sprite active ([Lifecycle](https://docs.fly.io/sprites/concepts/lifecycle.md), [Keeping a Sprite Running](https://docs.fly.io/sprites/keeping-sprites-running.md)). Checkpoints are live, copy-on-write, filesystem only; a Sprite checkpoints itself automatically.
- **Exec/files:** [OpenAPI](https://api.sprites.dev/openapi.json) has `exec` (websocket plus a plain HTTP POST), `exec/{id}/kill`, and `fs/read|write|list|copy|rename|delete|chmod|chown`, `services`, `checkpoint(s)`. Cleanest REST shape for pi's ops after E2B. Each Sprite has an HTTPS URL on port 8080 and `sprite proxy` for any TCP port.
- **Egress:** `POST /v1/sprites/{name}/policy/network` with ordered `allow`/`deny` domain rules and wildcards, enforced by DNS, live-reloaded, read-only inside the Sprite, private IPs always blocked.
- **Cost:** $0.0385/CPU-hour, $0.021875/GB-hour memory, storage hot $0.50 and cold $0.02 per GB-month, billed only while running; Fly's worked example is a 4-hour Claude Code session for $0.23 ([pricing](https://fly.io/pricing.md)). New orgs get $30 trial credit.
- **Maturity:** young (OpenAPI version 0.1.12, runtime `v0.0.1-rc48`), SDK repos small (`sprites-go`, MIT, 31 stars).
- **Residency:** Sprites region list: **UNVERIFIED**.

### 7. Cloudflare Sandbox SDK / Containers

- **Isolation:** each container instance "is a microVM with its own kernel and network" ([Sandboxes on Cloudflare](https://developers.cloudflare.com/sandbox/index.md)). A sandbox is a name + a Durable Object + an instance.
- **Self-hostable:** no. A Worker, Durable Objects and Containers on a Workers Paid plan are required; the SDK package (`cloudflare/sandbox-sdk`) licence reads `NOASSERTION` on GitHub.
- **Lifecycle:** the instance stops after an inactivity timeout of at most **6 hours**, `destroy()`, or main-process exit; work inside the instance does not count as activity, so a long test run needs a Durable Object alarm to stay up. Files return only through a snapshot (public beta) or R2 backup ([lifetime](https://developers.cloudflare.com/sandbox/concepts/lifetime/index.md), [snapshots](https://developers.cloudflare.com/sandbox/files/save-and-restore-a-workspace/index.md)). Processes do not survive a stop.
- **Exec/files:** `container.exec([...])`, `process.output()`, a `Files` API, previews and a terminal ([guides](https://developers.cloudflare.com/sandbox/llms.txt)). Everything is mediated by your own Worker code.
- **Egress:** `enableInternet = false` plus `allowedHosts` (deny-by-default list with globs); only ports 80 and 443 when internet is off; an outbound handler can inject tokens ([outbound traffic](https://developers.cloudflare.com/containers/configuration/outbound-traffic/index.md)).
- **Limits:** biggest instance 4 vCPU / 12 GiB / 20 GB disk ([limits](https://developers.cloudflare.com/containers/platform/limits/index.md)).
- **Cost:** memory $0.0000025/GiB-s and disk $0.00000007/GB-s on provisioned size, CPU $0.000020/vCPU-s on active use, plus Workers and Durable Object charges ([pricing](https://developers.cloudflare.com/containers/platform/pricing/index.md)). My arithmetic for 2 vCPU / 8 GiB / 16 GB fully busy: about $0.22/h before included usage.
- **Verdict:** well-documented for pi specifically, but it pulls Kira's run orchestration into Cloudflare Workers.

### 8. Vercel Sandbox

- **Isolation:** each sandbox is a [Firecracker](https://vercel.com/docs/sandbox/concepts.md) microVM with a dedicated kernel, root access, any Linux distro.
- **Self-hostable:** no. The SDK ([`vercel/sandbox`](https://github.com/vercel/sandbox), Apache-2.0) is open; the service is not.
- **Lifecycle:** **persistent by default**: stopping snapshots the filesystem, `Sandbox.get({ name })` or any SDK call resumes it ([persistent sandboxes](https://vercel.com/docs/sandbox/concepts/persistent-sandboxes.md)). Max session 45 minutes (Hobby) or 24 hours (Pro/Enterprise), reset on every resume, so total lifetime is "effectively unbounded" ([pricing and limits](https://vercel.com/docs/sandbox/pricing.md)). `extendTimeout()`, `fork`, `snapshot`. The docs describe a filesystem snapshot on stop; I found no memory-state resume, so assume processes do not survive.
- **Exec/files:** `runCommand` (also detached with log streaming), `writeFiles`, `sandbox.fs`, `domain(port)` for previews ([working with Sandbox](https://vercel.com/docs/sandbox/working-with-sandbox.md), [SDK reference](https://vercel.com/docs/sandbox/sdk-reference.md)). TypeScript and Python SDKs.
- **Egress:** modes `allow-all`, `deny-all`, or user-defined domain allow-lists with `*` labels, CIDR allow/deny, **changeable at runtime**, plus credential brokering and request proxying ([firewall](https://vercel.com/docs/sandbox/concepts/firewall.md)).
- **Image:** Vercel Managed Image, custom images from Vercel Container Registry, or snapshots ([images](https://vercel.com/docs/sandbox/concepts.md)).
- **Cost:** Pro $0.128/h Active CPU, $0.0212/GB-h memory, $0.60 per million creations, $0.08/GB-month snapshots ([pricing](https://vercel.com/docs/sandbox/pricing.md)). My arithmetic: 2 vCPU fully active + 4 GiB ≈ $0.34/h upper bound; idle time is not billed as CPU.
- **Residency:** 19 regions including `sin1` Singapore, none in Indonesia ([regions](https://vercel.com/docs/sandbox/concepts/regions.md)).
- **Verdict:** the best hosted fit for this feature list, and the cheapest path to production if residency permits.

### 9. Coder, DevPod, devcontainers

- **Coder** ([repo](https://github.com/coder/coder), AGPL-3.0, 16.9k stars, active): "self-hosted platform for cloud development environments and AI coding agents". Workspaces are Terraform templates (Docker, Kubernetes, EC2), reached over a WireGuard tunnel the workspace dials *out* to the control plane, so no inbound ports ([architecture](https://raw.githubusercontent.com/coder/coder/main/docs/ai-coder/agents/architecture.md)). It already ships "Coder Agents", an agent loop running **in the control plane** that issues tool calls to a workspace daemon over HTTP, i.e. topology A as a product. Community licences cap agents at five concurrent; the Agent Firewall (domain allow-lists) and AI Gateway need a Premium licence ([licensing](https://raw.githubusercontent.com/coder/coder/main/docs/ai-coder/agents/licensing-usage.md), [Agent Firewall](https://raw.githubusercontent.com/coder/coder/main/docs/ai-coder/agent-firewall/index.md)). Pause/resume is Terraform stop/start of the workspace (idle auto-shutdown): processes do not survive. Adopting it means running a second control plane with its own users, templates and agent UI beside Kira's. Entra ID sign-in support: **UNVERIFIED** (not checked). Good fit only if Kira also wants human-usable remote dev environments.
- **DevPod** ([repo](https://github.com/loft-sh/devpod), MPL-2.0): a client-only tool that creates devcontainer workspaces on any backend. No server, no exec/file API for agents, and the last push was 2025-11-14. Not a fit.
- **devcontainers** alone ([spec](https://containers.dev/)) describe an image and setup; useful as the *definition format* for a sandbox image, not as a runtime.

### 10. Other credible options

- **NVIDIA OpenShell** ([docs](https://docs.nvidia.com/openshell/about/overview), [repo](https://github.com/NVIDIA/OpenShell), Apache-2.0, 15k stars, created 2026-02-24, v0.1.2): an open-source runtime with a **gateway** (control plane) and compute drivers for Docker, Podman, VM or Kubernetes; declarative network/filesystem/process policy, credentials injected only for approved endpoints, "Run Pi with OpenRouter" tutorial. Its gRPC API ([`openshell.proto`](https://raw.githubusercontent.com/NVIDIA/OpenShell/main/proto/openshell.proto)) has `CreateSandbox`, `StopSandbox`, `StartSandbox`, `ExecSandbox`, `ExecSandboxInteractive`, `ForwardTcp`, `ExposeService`, `GetSandboxLogs`; no file RPC (the CLI uploads/downloads tarballs). Weekly stable releases, N-1 security support ([support matrix](https://docs.nvidia.com/openshell/about/support-matrix.md)). pi's docs list it as the "local or remote managed sandbox" pattern. Isolation strength per driver, pause semantics, and egress granularity beyond "network policy": **UNVERIFIED** (pages not read in full). Worth a spike as the self-hosted gateway.
- **Docker Sandboxes (`sbx`)** is a local-machine runtime ([pi docs](../../../apps/desktop/node_modules/@earendil-works/pi-coding-agent/docs/containerization.md)); it does not help with remote runs.

## Comparison

"Self-host" is what we could run ourselves today. "Pause" distinguishes memory-preserving (M) from filesystem-only (F).

| Backend | Isolation | Self-host | Pause/resume | Egress allow-list | Max run | Licence |
| --- | --- | --- | --- | --- | --- | --- |
| Docker (+gVisor) | shared kernel / user-space kernel | Yes | `pause` M (host-local), stop F | DIY (`--internal` + proxy) | none | Apache-2.0 |
| Gondolin | QEMU microVM | Library, one host | F (disk checkpoint) | Yes, HTTP/1.x + TLS only | none | Apache-2.0 |
| E2B runtime | Firecracker | Yes (Embed single node = evaluation; prod via Enterprise) | M, kept indefinitely | Yes, domains and CIDRs | cloud 24 h (Pro), pause resets | Apache-2.0 |
| OpenShell | driver-dependent | Yes (gateway) | Stop/Start; semantics UNVERIFIED | Policy; granularity UNVERIFIED | UNVERIFIED | Apache-2.0 |
| Daytona | container / VM class | No (core closed June 2026; BYOC runners only) | VM class M; container F | Yes, tiers 3-4 only | auto-stop default 15 min, can disable | AGPL-3.0 (frozen repo) |
| Modal | gVisor / VM | No | None; F or M snapshots | CIDR, domain (Beta, 443) | 24 h | SDK Apache-2.0 |
| Fly Machines | Firecracker | No | Suspend M (≤2 GB, not guaranteed) | None first-party | none | proprietary |
| Fly Sprites | hardware-isolated | No | Auto warm M / cold F | Yes, DNS domains | idle sleep, Tasks hold | proprietary (SDKs MIT) |
| Cloudflare | microVM | No | None; F snapshot (beta) | Yes, hosts, ports 80/443 | 6 h inactivity timeout | proprietary |
| Vercel Sandbox | Firecracker | No | Auto F snapshot | Yes, runtime-editable | 24 h per session, unbounded total | proprietary (SDK Apache-2.0) |
| Coder | your template (Docker/K8s/VM) | Yes | Workspace stop/start F | Premium Agent Firewall | none | AGPL-3.0 + Premium |

Cost for a 2 vCPU / 4 GiB sandbox busy for an hour (my arithmetic from the cited rates, excluding storage and egress): Sprites about $0.16 (Fly's own example: 4 h of Claude Code = $0.23), Cloudflare about $0.22 (8 GiB instance), Modal about $0.24, Vercel up to $0.34, E2B about $0.10 for CPU alone, self-hosted is host cost.

## Recommendation

### (a) First iteration: Docker (+ gVisor if the host supports it), pi in RPC mode, one dedicated host

1. A small sandbox manager in the Kira server calls the Docker Engine API on a **dedicated** sandbox host: create container from a pinned image (bun, node, git, `rg`, `fd`, `pi`), clone the repo, start `pi --mode rpc`, relay its JSONL events and steering commands over the server's existing channel to the desktop.
2. Network: an `--internal` network for sandboxes plus a forward proxy that allows only the Kira server and the git host. The container gets a per-run Kira token for the model proxy and a short-lived repo-scoped git token. No provider keys enter it.
3. Pause: `docker pause` while idle (memory kept, host-local); stop and `start` after a host reboot, restoring from pi's session file and the checkout volume. Dev servers restart.
4. Run `runsc` (gVisor) as the container runtime if the host allows it; otherwise accept shared-kernel risk for company-internal repos and say so.

Why this first: everything is first-party, open-source, and on infrastructure we already know how to run (compose, Coolify-managed host). It meets self-hosting and residency outright, and it forces the real design questions (relay, token issuance, lifecycle) to be answered before a vendor SDK hides them. Cost: weak isolation, DIY egress proxy, no memory snapshot across reboots, we own the manager.

Topology A (Operations routing) is a sensible smaller step if unattended runs are not needed yet; the work is mostly `exec` and file wrappers, plus a custom `grep` as above.

### (b) Later production shape: same manager, microVM backend

Keep one narrow interface in the manager (create, exec, read/write, pause, resume, destroy, set egress policy), and implement a microVM backend behind it once there is a second reason to. Candidates in order:

1. **E2B runtime** (Firecracker, Apache-2.0): memory pause/resume, domain egress rules, templates, same SDK as the hosted product. Needs a KVM host, and production use goes through E2B Enterprise today.
2. **OpenShell** gateway: open source with a policy engine; revisit when it is past 0.1.x and pause semantics are confirmed.
3. **Gondolin** inside the manager if we only need a single host and can live with Alpine images and disk-only checkpoints.

### What would change this

- **Residency allows a foreign SaaS for company code** → use **Vercel Sandbox** (`sin1`, persistent by default, runtime-editable firewall, 24 h sessions) or **Fly Sprites** (best per-hour economics, auto-sleep). Both remove the manager and host ops. Sprites is the riskier maturity bet.
- **Untrusted third-party code or other tenants** → microVM isolation becomes mandatory, skipping the container-first step.
- **Need to pause a running dev server with memory state across hosts** → E2B (or Fly Machines ≤ 2 GB); Docker `pause` does not leave the host.
- **Kira wants persistent human-usable remote workspaces too** → evaluate Coder, accepting a second control plane and AGPL/Premium terms.
- **Daytona re-opens its core** (or publishes a self-hostable control plane) → it rejoins the shortlist for its file API and VM pause.

## UNVERIFIED

- Cloudflare data-placement control; Sprites regions and hypervisor; Modal's country for `ap-southeast`.
- E2B RAM and disk rates; limits of a self-hosted E2B; E2B Enterprise terms.
- Daytona runner/proxy downloadability; Daytona unit rates.
- Fly Machines egress allow-listing beyond a self-run proxy.
- OpenShell isolation strength per driver, pause semantics, egress granularity.
- Gondolin running under Bun; Coder's Entra ID support.
- Whether Docker has a built-in domain allow-list (none seen).
- Idle and long-run behaviour of pi's RPC mode over hours (not exercised here).

## Sources

- pi 0.85.1 in this repo: [`docs/extensions.md` Remote Execution](../../../apps/desktop/node_modules/@earendil-works/pi-coding-agent/docs/extensions.md), [`containerization.md`](../../../apps/desktop/node_modules/@earendil-works/pi-coding-agent/docs/containerization.md), [`rpc.md`](../../../apps/desktop/node_modules/@earendil-works/pi-coding-agent/docs/rpc.md), [`security.md`](../../../apps/desktop/node_modules/@earendil-works/pi-coding-agent/docs/security.md), `examples/extensions/{ssh.ts,gondolin/index.ts,sandbox/index.ts}`, `dist/core/tools/{grep,find,bash,read,write,edit,ls}.{js,d.ts}`
- [ADR 0012](../../adr/0012-a-run-happens-on-a-desktop.md)
- Gondolin: [README](https://raw.githubusercontent.com/earendil-works/gondolin/main/README.md), [Limitations](https://earendil-works.github.io/gondolin/limitations/), [Security](https://earendil-works.github.io/gondolin/security/), [backends](https://raw.githubusercontent.com/earendil-works/gondolin/main/docs/backends.md)
- Docker: [Engine API v1.52](https://docs.docker.com/reference/api/engine/version/v1.52.yaml), [`docker pause`](https://docs.docker.com/reference/cli/docker/container/pause/), [`network create`](https://docs.docker.com/reference/cli/docker/network/create/); [gVisor](https://github.com/google/gvisor), [Kata](https://github.com/kata-containers/kata-containers), [Firecracker](https://github.com/firecracker-microvm/firecracker)
- Coolify: [`openapi.json`](https://raw.githubusercontent.com/coollabsio/coolify/v4.x/openapi.json), [create Docker image app](https://coolify.io/docs/api-reference/api/operations/create-dockerimage-application)
- Daytona: [Sandboxes](https://www.daytona.io/docs/en/sandboxes/), [Isolation](https://www.daytona.io/docs/en/isolation.md), [Network limits](https://www.daytona.io/docs/en/network-limits.md), [BYOC](https://www.daytona.io/docs/en/bring-your-own-compute.md), [Architecture](https://www.daytona.io/docs/en/architecture.md), [Billing](https://www.daytona.io/docs/en/billing.md), [repo README](https://raw.githubusercontent.com/daytonaio/daytona/main/README.md)
- E2B: [runtime README](https://raw.githubusercontent.com/e2b-dev/infra/main/README.md), [Embed](https://raw.githubusercontent.com/e2b-dev/infra/main/embed/README.md), [compose guide](https://raw.githubusercontent.com/e2b-dev/runtime/main/embed/compose/README.md), [Billing & limits](https://docs.e2b.dev/billing.md), [lifetime FAQ](https://docs.e2b.dev/faq/sandbox-lifetime.md), [persistence](https://docs.e2b.dev/sandbox/persistence.md), [Internet access](https://docs.e2b.dev/network/internet-access.md), [pricing](https://e2b.dev/pricing)
- Modal: [Sandboxes](https://modal.com/docs/guide/sandbox), [Networking and security](https://modal.com/docs/guide/sandbox-networking), [Snapshots](https://modal.com/docs/guide/sandbox-snapshots), [Files](https://modal.com/docs/guide/sandbox-files), [Data residency](https://modal.com/docs/guide/data-residency), [Region selection](https://modal.com/docs/guide/region-selection), [pricing](https://modal.com/pricing)
- Fly: [Suspend and Resume](https://fly.io/docs/reference/suspend-resume/), [Machines OpenAPI](https://docs.fly.io/api/machines/openapi.json), [Sprites](https://fly.io/sprites.md), [Sprites API](https://api.sprites.dev/openapi.json), [Sprites lifecycle](https://docs.fly.io/sprites/concepts/lifecycle.md), [Sprites networking](https://docs.fly.io/sprites/concepts/networking.md), [pricing](https://fly.io/pricing.md)
- Cloudflare: [Sandboxes](https://developers.cloudflare.com/sandbox/index.md), [lifetime](https://developers.cloudflare.com/sandbox/concepts/lifetime/index.md), [Run Pi](https://developers.cloudflare.com/sandbox/coding-agents/pi/index.md), [outbound traffic](https://developers.cloudflare.com/containers/configuration/outbound-traffic/index.md), [limits](https://developers.cloudflare.com/containers/platform/limits/index.md), [pricing](https://developers.cloudflare.com/containers/platform/pricing/index.md)
- Vercel: [concepts](https://vercel.com/docs/sandbox/concepts.md), [persistent sandboxes](https://vercel.com/docs/sandbox/concepts/persistent-sandboxes.md), [firewall](https://vercel.com/docs/sandbox/concepts/firewall.md), [regions](https://vercel.com/docs/sandbox/concepts/regions.md), [pricing](https://vercel.com/docs/sandbox/pricing.md), [working with Sandbox](https://vercel.com/docs/sandbox/working-with-sandbox.md)
- Coder: [README](https://raw.githubusercontent.com/coder/coder/main/README.md), [Agents architecture](https://raw.githubusercontent.com/coder/coder/main/docs/ai-coder/agents/architecture.md), [licensing](https://raw.githubusercontent.com/coder/coder/main/docs/ai-coder/agents/licensing-usage.md), [Agent Firewall](https://raw.githubusercontent.com/coder/coder/main/docs/ai-coder/agent-firewall/index.md); [DevPod](https://github.com/loft-sh/devpod)
- NVIDIA OpenShell: [overview](https://docs.nvidia.com/openshell/about/overview), [support matrix](https://docs.nvidia.com/openshell/about/support-matrix.md), [architecture](https://docs.nvidia.com/openshell/about/architecture.md), [`openshell.proto`](https://raw.githubusercontent.com/NVIDIA/OpenShell/main/proto/openshell.proto), [repo](https://github.com/NVIDIA/OpenShell)
- Licences, stars and push dates: GitHub REST API (`api.github.com/repos/...`), 2026-10-06
