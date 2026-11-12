# StatusBeam — Uptime Monitoring & Public Status Page

**One line:** Distributed-ish uptime checks, incident lifecycle, and a public status page
with live updates — built to prove typed backend engineering, not to prove you like uptime.

**Why:** it forces the three things clients filter TypeScript backends for: **typed API
contracts, queues/schedulers, and real-time delivery**. It is also a product people
understand in five seconds, so demos land.

## What it proves

| Skill | Where it shows up |
|---|---|
| TypeScript strictness | Discriminated unions for check results, `satisfies`, zod/TypeBox |
| Framework depth | NestJS modules/guards/interceptors **or** Fastify plugin architecture |
| Persistence | Drizzle/Prisma migrations, indexes, retention/partitioning |
| Scheduling | BullMQ repeatable jobs, distributed locking to avoid double-checks |
| Real-time | SSE or WebSocket stream of status changes |
| Auth | API keys for monitors, JWT for dashboard, scoped access |
| Testing | Vitest + Testcontainers (Postgres/Redis), fake timers for scheduler |
| Ops | Docker, CI, structured logs, metrics, deploy |

## Scope

**In:**
- Monitors: HTTP (status/body assertion, latency threshold), TCP port, keyword check
- Configurable interval, timeout, retries-before-incident, expected regions (start with 1)
- Check results with latency, error class, response snippet
- Incident lifecycle: `investigating → identified → monitoring → resolved`, auto-open/close
- Public status page API + hosted page with 90-day uptime bars
- Notification channels: email (Resend/SMTP), generic webhook, Slack
- API keys with scopes; rate limits
- Retention: raw checks 7 days, hourly rollups 90 days

**Out:** multi-region probes, on-call escalation policies, PagerDuty sync, synthetic
browser tests, billing. List them under "what I'd do next".

## Stack (freeze it)

- NestJS 11 **or** Fastify 5 + TypeBox. Pick one; NestJS is the safer keyword, Fastify is
  the more interesting code. Recommendation: **NestJS** for the filter, Fastify for the fun.
- PostgreSQL 16, Redis 7, BullMQ, Drizzle ORM (or Prisma if you want the keyword)
- Zod for boundary validation, OpenAPI generated from types
- Next.js 15 (App Router) dashboard + public page, TanStack Query
- Vitest + Supertest + Testcontainers, Playwright for one E2E smoke
- pino logs, prom-client metrics, Docker multi-stage, GitHub Actions

## Data model

```
users(id, email, password_hash, created_at)
projects(id, user_id, name, slug, public boolean)
monitors(id, project_id, name, type, config jsonb, interval_s, timeout_ms,
         retries, active, next_run_at)
checks(id, monitor_id, region, status, latency_ms, status_code, error, checked_at)
rollups(monitor_id, bucket_hour, up_count, down_count, p95_latency_ms)
incidents(id, monitor_id, status, started_at, resolved_at, cause)
incident_updates(id, incident_id, status, message, created_at)
channels(id, project_id, type, config jsonb, active)
api_keys(id, project_id, hash, scopes, last_used_at)
```

ADR candidates: repeatable jobs vs cron; retention via delete-job vs partitioning;
SSE vs WebSocket for status updates.

## API surface

```
POST   /v1/monitors                 GET /v1/monitors
GET    /v1/monitors/:id/checks      GET /v1/monitors/:id/uptime?days=90
POST   /v1/incidents/:id/updates
GET    /v1/projects/:slug/status    # public, cached 10s
GET    /v1/projects/:slug/stream    # SSE
POST   /v1/api-keys
GET    /healthz /readyz /metrics
```

## Milestones

### M0 — Skeleton (3 days)
- [ ] Nest app with config module, validation pipe, exception filter, request-id middleware
- [ ] Drizzle schema + first migration; compose with postgres/redis
- [ ] CI: `tsc --noEmit`, eslint, vitest, docker build
- [ ] `/healthz`, `/readyz`, pino + OTel/prom metrics

### M1 — Monitors + checks (5 days)
- [ ] CRUD with zod validation and ownership guards
- [ ] HTTP/TCP checker with `AbortSignal.timeout`, body assertion, latency measurement
- [ ] BullMQ repeatable job per monitor; Redis lock so two workers never run the same check
- [ ] Rollup job (hourly) + retention job (daily)
- [ ] Tests: timeout, DNS failure, 500, wrong body, duplicate-run prevention (fake timers)

### M2 — Incidents + notifications (5 days)
- [ ] State machine with explicit transitions; invalid transition → 409
- [ ] Open after `retries` consecutive failures; close after 2 successes
- [ ] Channel adapters (email/webhook/Slack) with retry + timeout
- [ ] Dead-letter + replay for failed notifications
- [ ] Tests: flapping monitor does not open 10 incidents (hysteresis)

### M3 — Real-time + public page (4 days)
- [ ] SSE endpoint with heartbeat and backpressure handling
- [ ] Public status API with 10s cache (Redis) + ETag
- [ ] Next.js public page: overall status, per-monitor 90-day bars, incident timeline
- [ ] Playwright smoke: create monitor → simulate failure → page updates

### M4 — Dashboard + deploy (4 days)
- [ ] Auth (JWT + refresh or session), project switcher, monitor form, incident editor
- [ ] API key creation with scopes
- [ ] Load test: 5k monitors scheduling, measure scheduler lag
- [ ] Deploy (VPS + Docker or Fly/Render), README, demo video

## Demo script (for interviews)

> "StatusBeam schedules checks with BullMQ repeatable jobs and a Redis lock, so adding
> workers doesn't double-check. Failures open incidents only after hysteresis, and
> notifications retry with backoff into a dead-letter queue. The status page streams SSE
> updates; here's the Playwright test that takes a monitor down and asserts the page
> flips within two seconds. Here's the scheduler-lag graph at 5,000 monitors."

## Traps to avoid

- One cron job that loops all monitors: it collapses under load and hides failures.
- Storing every check forever. Roll up or you'll be paginating a million rows in week 3.
- WebSockets because they're cool. SSE is simpler and enough for one-way status.
- Using an ORM without writing the SQL for your hot query. Know the query plan.
