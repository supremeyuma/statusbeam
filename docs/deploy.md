# Deploy

The repository ships a production-oriented compose stack and a Caddy reverse proxy. No live
URL is claimed: the deploy account check in the master plan was not available, so the live
demo is deferred and the local walkthrough is the release evidence.

## Shape

```
Caddy :80 ──► web:3000  (Next.js standalone)
           └► api:3001  (/v1/*, /openapi.json, /healthz, /readyz, /metrics)
api ──► postgres:5432, redis:6379
```

Postgres and Redis publish no host ports in `infra/docker-compose.prod.yml`.

## Environment

Create `infra/.env` (or export the variables) before `docker compose`:

| Variable | Required | Notes |
|---|---|---|
| `POSTGRES_PASSWORD` | yes | used by Postgres and the API DSN |
| `PUBLIC_BASE_URL` | yes | e.g. `https://status.example.com`; CORS origin |
| `JWT_SECRET` | yes | ≥32 chars |
| `JWT_REFRESH_SECRET` | yes | ≥32 chars |
| `ENCRYPTION_KEY` | yes | 64 hex chars (32 bytes) |
| `RESEND_API_KEY` / `SMTP_URL` | no | email adapter falls back to SMTP, then skips |
| `SLACK_WEBHOOK_URL` | no | optional global Slack channel |
| `ALLOW_PRIVATE_TARGETS` | no | keep `false` in production |
| `CHECK_TIMEOUT_MS` | no | default 5000 |
| `LOG_LEVEL` | no | default `info` |

Generate secrets, for example:

```powershell
[Convert]::ToBase64String((1..48 | ForEach-Object { Get-Random -Maximum 256 }))
```

## Run

```powershell
docker compose -f infra/docker-compose.prod.yml up -d --build
```

The API container runs `node apps/api/dist/db/migrate.js` before the server. Migrations are
one-shot and safe to rerun; Drizzle tracks applied migrations in the `drizzle` schema.

Health:

```powershell
Invoke-RestMethod http://localhost/healthz
Invoke-RestMethod http://localhost/readyz
```

## TLS / domain

The checked-in Caddyfile listens on `:80`. To serve a real domain, replace the site address with
your hostname (Caddy provisions certificates automatically) and forward ports 80/443. Keep the
`/v1/*` proxy in front of the API so the browser uses same-origin requests
(`NEXT_PUBLIC_API_URL=''` at web build time); otherwise set it to the API origin and update
`PUBLIC_BASE_URL` for CORS.

## Backups

- Postgres: `pg_dump -Fc` nightly from a sidecar or host cron, keep 30 days off-host. Restore
  with `pg_restore --clean --if-exists`.
- Redis: AOF is enabled (`appendonly yes`). Losing Redis is survivable for data (Postgres is
  the source of truth) but drops schedules; re-create monitors or run the reconcile pass
  described in `docs/failure-modes.md`.
- Volumes: `statusbeam-prod-postgres`, `statusbeam-prod-redis`, `statusbeam-caddy-*`.

## Scaling notes

- Run API and workers separately before adding replicas; today one process does both.
- Keep Postgres on a dedicated host before 10k monitors; partition `checks` by day.
- The notification and check queues are separate; a slow provider cannot block checks.
- `/metrics` is exposed on the API; scrape it from the internal network only.

## Deferred

- Live URL / demo GIF upload (no deploy account or recording tool available in this
  environment). The app runs locally via either compose file.
- TLS hostname and DNS.
