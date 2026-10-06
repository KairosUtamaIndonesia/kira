# A sandbox holds no credentials; the network injects them

Date: 2026-10-06

Amends ADR 0029 (clone as the person) for sandbox chats only. ADR 0001 (no boundary) still holds. Follows ADR 0031.

## Context

A sandbox chat runs its loop inside a remote VM (ADR 0031), with no desktop and none of the person's own credentials. It needs two things from outside: the Kira server (model traffic and the tracker) and the project's repository. A prompt-injected command inside the VM can read the environment and the filesystem, so a credential placed there is a credential leaked.

## Decision

**The sandbox never holds a credential.** The Kira server gives the sandbox's egress proxy (CubeEgress) the secrets, and the proxy adds them to requests bound for two hosts. The runner's environment holds a placeholder only.

- **Kira key.** When a sandbox starts, the server mints an ordinary Kira key for the person who started it and injects it as `Authorization: Bearer` on requests to the Kira server. The server revokes it when the sandbox ends. The key is not scoped: it can do what that person's desktop key can, which is no worse than the desktop agent today.
- **Repository.** The runner clones, pushes its branch and opens the PR over HTTPS. The server mints a GitHub installation token limited to the project's one repository and injects it on `github.com` and `api.github.com`. This replaces ADR 0029's "clone as the person, never a server token", for sandboxes only; the desktop path is unchanged. The PR is still the review and the person still merges (ADR 0024, ADR 0030).
- **Egress.** Open internet with private ranges blocked, plus the two injection rules, so installs and tests work.
- **No boundary at the tool level** (ADR 0001 holds). The boundary is the VM, these credentials, and the egress rules. Nothing of the person's own (device key, ssh keys, MCP secrets) is copied in.
- **Subagents** share their chat's sandbox, key and token.

## Known limits

- **Source and ticket text can leave the sandbox.** Credentials cannot. Open egress does not stop exfiltration of what the chat has read. Revisit with a per-project strict-egress setting if a project cannot accept that.
- **The key is not scoped.** It reaches whatever the person's own key reaches. Revisit if a sandbox is ever started, shared or steered by anyone but the person (ADR 0012's declined delegation).
- **Default-branch protection is a requirement on the repository, not checked by Kira.** The token can push any ref; the repository must forbid pushes to the default branch and require review to merge.

## Consequences

- The server needs a way to mint a repository-limited installation token (the existing mint call takes no repository argument) and a way to mint and revoke a key per sandbox.
- A GitHub token lasts an hour and a sandbox may outlive it, so the server must re-inject it; the lifecycle ticket on the map owns that.
- A project needs an attached repository to start a sandbox chat on it.
