# Queqiao Gateway: persistent-host Linux service templates

**Status: deployment templates, not an active deployment.** The templates
in this directory are intentionally secret-free. They are a starting point
for a single host with a *named*, stable HTTPS Cloudflare Tunnel and a
locally bound Gateway. They require a host, DNS ownership, tunnel identity,
managed credentials, monitoring, and a production task API before acceptance.

## Model

```text
ChatGPT MCP OAuth client
  -> https://gateway.<your-owned-domain>/mcp
  -> named Cloudflare Tunnel -> 127.0.0.1:7575
  -> Queqiao Gateway (systemd, user=queqiao)
  -> authenticated GitHub Actions ephemeral Worker (reverse WSS)
```

Gateway management listens only at `127.0.0.1:7574`. Local gRPC Worker
sessions use `127.0.0.1:7573`. Do **not** publish those listeners,
forward them through the Tunnel, or open them in the cloud firewall.

The Gateway's `publicBaseUrl` must equal the configured HTTPS hostname.
OAuth issuer, protected resource discovery, callback validation, and
GitHub Actions OIDC audience depend on this invariant. A Quick Tunnel is
not suitable because its hostname changes when restarted.

## Host preparation checklist (run only on a provisioned Linux host)

1. Install Node 22+ with `/usr/bin/node` and a compatible version of npm.
   Deploy an immutable reviewed Queqiao commit into
   `/opt/queqiao`; run `npm ci --ignore-scripts` and `npm run build`
   during the deployment stage, **not** at service startup. Package
   permissions should prevent the non-root service user from modifying
   repository code or dependencies.
2. Create dedicated non-login system users `queqiao` and `cloudflared`
   (and matching groups). Install a supported `cloudflared` binary at
   `/usr/local/bin/cloudflared`.
3. Copy and customize `config.yaml.example` to
   `/etc/queqiao/config.yaml`. Install distinct, randomly generated
   OAuth approval and JWT signing secrets plus a restricted GitHub App /
   short-lived installation token file **outside the Git checkout**.
   Grant `queqiao` read access only to the files it needs; protect
   all credential files from other users. Do not store them in Actions
   logs, issue comments, PRs, container layers, or git commits.
4. Configure a *named* Cloudflare Tunnel with an owned hostname and
   create its DNS record. Copy `tunnel.yml.example` to
   `/etc/queqiao/tunnel.yml`. Store tunnel credentials as
   `/etc/queqiao/tunnel-credentials.json`, readable only by the
   dedicated `cloudflared` service account.
5. Install the two unit files under `/etc/systemd/system`,
   root-owned `0644`. Validate with `systemd-analyze verify`,
   run `systemctl daemon-reload`, and enable/start Gateway and Tunnel.
   Both services restart on failures; Gateway keeps its private state
   under `/var/lib/queqiao`. Never copy the template comments as real
   credentials or use `example.invalid` for actual DNS.
6. From the host, check `http://127.0.0.1:7575/.well-known/oauth-authorization-server`.
   From outside, verify HTTPS certificate and OAuth metadata at the
   stable hostname. Check the external origin remains identical after
   restarting the Gateway *and* Tunnel, and that the management and
   gRPC ports are not publicly reachable.
7. Exercise a controlled Worker task after deploying a reviewed
   **production** MCP task interface, and correlate OAuth client, lease,
   GitHub Actions Run ID, environment routing receipt, CLI stdout/exit
   code, cancellation and cleanup. Test this with the local workstation
   **powered off**.

## Known blockers

- This config leaves `mcpPocEnabled: false`. **That is intentional.**
  The existing `actions_worker_*` controls are marked as test-only
  and must not become production API endpoints merely by deploying them
  on a public host. A separately reviewed production task catalog,
  authorization boundary, and durable scheduler are required.
- The existing Gateway checkpoint covers the single-tenant POC restart
  path, not concurrent instances, remote orphan reconciliation, or
  automated GitHub credential renewal.
- Unit restart policies do not substitute for availability probes,
  alerts, automatic credential rotation, rolling upgrades, backups,
  incident response, or resource isolation. The Node/Vitest POC run
  is **not** a general-purpose code-execution sandbox.
- No host, owned domain, named tunnel, or remote secret store was
  provisioned by these files. The Linux unit parser check is structural;
  independent operational acceptance remains open in Issue #112.

## Rollback

Stop the tunnel first to prevent new external requests. Stop the Gateway
second, while separately reconciling any surviving GitHub Actions Worker
runs and leases. Restore the previous reviewed package/config version,
retain state files safely, and re-run the external OAuth metadata and
controlled task verification. Do not silently drop active leases or
rotate the public issuer hostname during rollback.
