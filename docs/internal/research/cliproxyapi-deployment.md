# Deploying CLIProxyAPI for Kira

## Recommendation

Run CLIProxyAPI as a separately managed, single-instance service on a private
network, pinned to a specific release. Keep Kira as the public API boundary:

```text
desktop → Kira server → private CLIProxyAPI → provider
```

The repository now includes a production Docker Compose baseline at
[`deploy/compose.production.yaml`](../../../deploy/compose.production.yaml). It
runs Postgres, Kira and one CLIProxyAPI instance on a private backend network.
The proxy has no published ports; Kira reaches it over that internal network.
The proxy also has an egress-only bridge attachment so it can reach providers;
the internal network itself has no external route. Configure the
deployment's reverse proxy to join the `ingress` network and route to the server
on port 3000. Do not copy the upstream sample's public port mappings into
production.

## Network and access

- If Kira and CLIProxyAPI share a host, bind CLIProxyAPI to loopback and have
  Kira connect locally.
- If they are separate hosts, use private routing (such as a VPN/private subnet)
  and bind only to the proxy host's private interface. Restrict inbound access to
  Kira. A Docker bridge network is suitable only when both containers share a
  Docker host; Docker's user-defined bridge provides service-name DNS and
  isolation between networks, not connectivity across hosts.
- CLIProxyAPI's v7.3.7 sample config defaults to an empty host (all interfaces)
  and disables TLS. Do not expose that default listener to the public internet.
  Use TLS if the private network does not itself provide the required transport
  protection.
- Set one long, random caller key in CLIProxyAPI's `api-keys` and provide the
  matching value to Kira as a deployment secret. The keys are a flat list; they
  do not provide per-key model scopes or rate limits. Do not reuse development
  credentials.
- Kira's admin console can use the management API through the server. Set the
  same high-entropy `MANAGEMENT_PASSWORD` secret in Kira and CLIProxyAPI. This
  enables remote management in CLIProxyAPI v7.3.7, so keep it private to the
  internal Docker network, disable the bundled control panel, and never publish
  management or OAuth callback ports.

## State and operations

- Persist `config.yaml` and the configured `auth-dir` on protected durable
  storage. Auth files contain provider credentials; keep them out of source
  control, limit access to the service account, and encrypt/limit access to
  backups. Back up config and auth state together and test restores.
- Run only one process per `auth-dir`: the inspected v7.3.7 auth file storage
  has no cross-process lock, so multiple writers can race.
- Probe `GET /healthz` locally. It verifies process health only, not provider
  authentication or model availability; use a separate authenticated
  `GET /v1/models` smoke check when upstream readiness matters.
- Pin a versioned release, verify its checksum, test upgrades, and retain the
  previous binary/image and a backup for rollback. Avoid deploying `latest`.
- For Compose deployments, use a production-specific override with a restart
  policy, private networking, durable mounts, and no public proxy ports. Compose
  secrets are mounted as files; verify CLIProxyAPI can consume a secret file
  before assuming an environment variable's `_FILE` convention is supported.

## Compose deployment baseline

`deploy/compose.production.yaml` pins the multi-architecture v7.3.7 image by
tag and manifest digest. That is the version Kira's interface research verified;
do not update it to v7.3.20 or v8 without repeating the compatibility checks.
The Compose file does not contain provider credentials, the pool caller key, or
the optional management password.

Before starting it:

1. Create a protected deployment env file with `KIRA_SERVER_TAG`, `KIRA_BASE_URL`,
   the Entra settings, `KIRA_AUTH_SECRET`, `KIRA_DATABASE_USER`,
   `KIRA_DATABASE_PASSWORD`, `KIRA_POOL_KEY`, and `CLIPROXY_CONFIG_DIR`. Set
   `MANAGEMENT_PASSWORD` to enable Kira's Pool console; omit it to leave that
   feature unavailable while the rest of Kira continues to work. Use
   high-entropy secrets, restrict the file to the deploy account, and exclude it
   from backups that are not encrypted. The database password should use URL-safe
   characters because Compose interpolates it into `KIRA_DATABASE_URL`.
2. Create `${CLIPROXY_CONFIG_DIR}/config.yaml` outside the repository. Set
   `host: ""`, `port: 8317`, and `auth-dir: /root/.cli-proxy-api`; put exactly
   the same long random caller key as `KIRA_POOL_KEY` under `api-keys`. Leave
    `remote-management.disable-control-panel: true` and remove the development
    fake-upstream entry. `MANAGEMENT_PASSWORD` enables the management API without
    writing the secret into this config. The auth directory must be writable for
    OAuth login; the config file can remain read-only.
   This file contains a secret: restrict its permissions and do not commit it.
3. Start with `docker compose --env-file <protected-env-file> -f
   deploy/compose.production.yaml up -d`. Check container health and then
   `GET /ready` through Kira. Docker's proxy check only calls `/healthz`, which
   establishes process liveness; Kira's readiness check also authenticates to
   `/v1/models` and requires a non-empty catalog.
4. Add provider credentials to the persistent `cliproxyapi-auth` volume using
   CLIProxyAPI's supported login flow. Stop the running service before a one-off
   login to avoid running two writers against one auth dir, then run the proxy's
   login command in a one-off container (for example `docker compose --env-file
<protected-env-file> -f deploy/compose.production.yaml run --rm -it
cliproxyapi ./CLIProxyAPI -config /run/cliproxy-config/config.yaml
-codex-login -no-browser`). Follow the printed OAuth URL/callback instructions,
   verify the credential file appears in the volume, and start the service again.
   The long-running process hot-reloads credential files added later.
5. Back up the auth volume and config together, encrypt the backup, and test
   restoring both. Keep the prior image digest and Kira server tag for rollback.

The Compose healthchecks deliberately test liveness, not provider subscription
validity. Compose's restart policy restarts exited containers, not merely
unhealthy ones. A revoked provider login is an operational readiness/alerting
issue, not a reason to have Docker restart a healthy proxy process.

## Sources

- [Kira server development: request chain and local CLIProxyAPI setup](../server-development.md)
- [Kira's CLIProxyAPI interface research, pinned to v7.3.7](./cliproxyapi-interface.md)
- [CLIProxyAPI v7.3.7 config example](https://github.com/router-for-me/CLIProxyAPI/blob/v7.3.7/config.example.yaml)
- [CLIProxyAPI v7.3.7 routes](https://github.com/router-for-me/CLIProxyAPI/blob/v7.3.7/internal/api/server_routes.go) and [health handler](https://github.com/router-for-me/CLIProxyAPI/blob/v7.3.7/internal/api/server.go)
- [CLIProxyAPI v7.3.7 auth file store](https://github.com/router-for-me/CLIProxyAPI/blob/v7.3.7/sdk/auth/filestore.go)
- [CLIProxyAPI v7.3.7 Docker Compose sample](https://github.com/router-for-me/CLIProxyAPI/blob/v7.3.7/docker-compose.yml)
- [CLIProxyAPI v7.3.7 release](https://github.com/router-for-me/CLIProxyAPI/releases/tag/v7.3.7)
- [Docker bridge networking](https://docs.docker.com/engine/network/drivers/bridge/)
- [Docker Compose production guidance](https://docs.docker.com/compose/how-tos/production/) and [Compose secrets](https://docs.docker.com/compose/how-tos/use-secrets/)
