# Deploying CLIProxyAPI for Kira

## Recommendation

Run CLIProxyAPI as a separately managed, single-instance service on a private
network, pinned to a specific release. Keep Kira as the public API boundary:

```text
desktop → Kira server → private CLIProxyAPI → provider
```

For a first production deployment, use a host-managed service with the
checksum-verified release binary, matching Kira's documented development
installation. Docker Compose is also reasonable if the deployment already uses
Docker, but do not copy the upstream sample's public port mappings into
production. Kira currently publishes a server image but has no server deployment
workflow; this is deployment guidance, not an existing deployment configuration.

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
- Leave the management API disabled unless needed. If enabled, restrict it to a
  separate protected admin path. Avoid publishing OAuth callback ports unless a
  specific login flow requires them.

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
