# StatusBeam — Execution Plan (Project 2 of 4)

> **Bootstrap note:** this repository already exists with git, an MIT license, and a private
> remote. Skip the folder/git/remote steps in Phase S0; start with the tooling tasks. See
> `AGENTS.md` for the working contract and reserved ports.

**Spec:** `projects/t1-statusbeam.md` · **Rubric:** `projects/00-project-rubric.md`
**Read first:** `execution/00-master-plan.md`. This plan follows its branch/commit/phase
conventions and release gate.

**Mission:** distributed-ish uptime checks, incident lifecycle, and a public status page
with live updates — proof of typed backend engineering, not an uptime product.

**Working days:** 20–24. **Repo:** `../statusbeam` (`C:\Users\Supreme\repos\statusbeam`).
**Start only after HookRelay is tagged `v1.0.0` and its release gate passes.**

**Stack is frozen:** Node 22, pnpm workspaces, NestJS 11 (Express adapter), TypeScript
strict, Drizzle ORM + `pg`, Postgres 16, Redis 7, BullMQ 5 + ioredis, Zod, OpenAPI,
Next.js 15 App Router, TanStack Query, Vitest + Supertest + Testcontainers, Playwright,
pino, prom-client, Docker, GitHub Actions.

> Agent rule: the scheduler and the incident state machine are the hard parts. Write their
> tests before the implementation and never weaken them to make a phase pass.

---

## 1. Target architecture

```
                    ┌─────────────────────────────┐
browser ───────────▶│ Next.js (public + dashboard)│
                    │  TanStack Query · SSE client │
                    └──────────────┬──────────────┘
                                   │ typed fetch
                    ┌──────────────▼──────────────┐
                    │ NestJS API (apps/api)       │
                    │ JWT guard · API-key guard   │
                    │ Zod validation · pino       │
                    └───┬──────────┬──────────┬───┘
                        │          │          │
                  Postgres 16    Redis 7    BullMQ workers
                  (Drizzle)      (cache,       │
                                 pub/sub,      ├─ check jobs (repeatable per monitor)
                                 locks)        ├─ rollup job (hourly)
                                               ├─ retention job (daily)
                                               └─ notification queue + DLQ
```

Rules baked into the plan:
- One repeatable BullMQ job per monitor (`jobId = monitor:<id>`), plus a Redis distributed
  lock so multiple workers never run the same check concurrently.
- Incidents are a state machine with explicit transitions; invalid transition = 409.
- Hysteresis: open after `retries` consecutive failures, resolve after 2 consecutive
  successes. A flapping monitor must not create incident spam.
- Raw checks retained 7 days; hourly rollups retained 90 days. Dashboards read rollups only.
- SSE, not WebSocket. Redis pub/sub fans out so the API can scale horizontally.

### Monorepo layout (final)

```
statusbeam/
  package.json  pnpm-workspace.yaml  tsconfig.base.json  eslint.config.js
  apps/
    api/
      src/
        main.ts app.module.ts
        common/   config.ts logger.ts request-id.ts filters/ guards/ interceptors/
        db/       schema.ts client.ts migrate.ts
        modules/
          health/ auth/ projects/ monitors/ checks/ incidents/
          notifications/ status/ api-keys/ metrics/
        jobs/     check.processor.ts rollup.processor.ts retention.processor.ts
                  notification.processor.ts queue.module.ts
      test/       unit/ integration/ e2e/
      drizzle/    migrations/ meta/
    web/
      app/        (public)/[slug]/page.tsx  dashboard/...  login/...  layout.tsx
      components/ lib/ test/  playwright.config.ts
  packages/contracts/  src/ (zod schemas, types, generated openapi client)
  infra/  docker-compose.yml  Dockerfile.api  Dockerfile.web
  docs/   roadmap.md adr/ case-study.md security.md failure-modes.md demo.gif
  scripts/ verify.ps1 seed-monitors.ts walkthrough.ps1
  .github/workflows/ci.yml  .env.example
```

---

## 2. Phase S0 — Bootstrap (0.5 day)

1. Create `../statusbeam`:
   ```powershell
   $name = "statusbeam"
   $dest = Join-Path (Split-Path -Parent (Get-Location)) $name
   New-Item -ItemType Directory -Path $dest -Force
   Set-Location $dest
   git init -b main
   git config core.autocrlf false
   ```
2. Add MIT `LICENSE`, `.gitattributes`, `.gitignore` (node_modules, dist, .next, .env*,
   coverage, playwright-report, test-results), README stub.
3. Workspace files:
   - `package.json` with `packageManager: "pnpm@9.15.0"`, scripts `lint`, `typecheck`,
     `test`, `build`, `verify`.
   - `pnpm-workspace.yaml` → `apps/*`, `packages/*`.
   - `tsconfig.base.json`: `strict`, `noUncheckedIndexedAccess`, `exactOptionalPropertyTypes`,
     `noImplicitOverride`, `verbatimModuleSyntax`, `moduleResolution: "bundler"`.
   - `eslint.config.js` flat config + `typescript-eslint` type-checked rules; prettier.
4. Initialise the API and web apps without keeping unread boilerplate:
   ```powershell
   pnpm dlx @nestjs/cli new apps/api --package-manager pnpm --skip-git --strict
   pnpm dlx create-next-app@15 apps/web --ts --eslint --app --src-dir=false --import-alias "@/*" --use-pnpm --no-tailwind
   ```
   Delete generated controllers/services/specs you do not use. Add `packages/contracts`
   manually (`package.json`, `tsconfig.json`, `src/index.ts`).
5. Root scripts and CI skeleton (install → lint → typecheck → test → build). Commit, create
   private remote, push:
   ```powershell
   git add -A
   git commit -m "chore: bootstrap statusbeam monorepo"
   gh repo create statusbeam --private --source . --remote origin --push
   ```

**Gate:** `pnpm install`, `pnpm typecheck`, `pnpm build` pass on the empty shell.

---

## 3. Phase S1 — Skeleton, config, health, compose, CI (M0, 2–3 days)

### Tasks
1. **Config** (`apps/api/src/common/config.ts`): Zod schema over `process.env`; required
   `DATABASE_URL`, `REDIS_URL`, `JWT_SECRET` (≥32 chars), `JWT_REFRESH_SECRET`,
   `ENCRYPTION_KEY` (32 bytes hex), optional `RESEND_API_KEY`, `SLACK_WEBHOOK_URL`,
   `PUBLIC_BASE_URL`, `ALLOW_PRIVATE_TARGETS` (default false), `CHECK_TIMEOUT_MS` (default
   5000). Validate at boot; process exits non-zero with a readable error.
2. **Bootstrap** (`main.ts`): `ValidationPipe({ whitelist:true, transform:true })`,
   global exception filter returning `{statusCode,message,error,requestId,path,timestamp}`,
   request-id middleware (`X-Request-ID` echo) using `AsyncLocalStorage`, pino via
   `nestjs-pino` with redaction of `authorization`, `cookie`, `x-api-key`.
3. **DB** (`db/schema.ts` initial full schema, `db/client.ts` Drizzle with `pg.Pool`) and
   `drizzle.config.ts`; run `pnpm drizzle-kit generate` and `migrate` on boot only in dev
   (production deploy runs a one-shot migrate command).
4. **Health/metrics:** `/healthz` (liveness), `/readyz` (`SELECT 1`, Redis `PING`, 1s
   timeout, 503 on failure), `/metrics` via `prom-client` (default metrics + HTTP histogram).
5. **Compose** (`infra/docker-compose.yml`): postgres 16, redis 7 with healthchecks,
   `api` with `depends_on: service_healthy`, port 3001. (Web added in S5.)
6. **Dockerfile.api:** multi-stage `node:22-alpine`, pnpm fetch + offline install,
   `pnpm --filter @statusbeam/api build`, runtime non-root, healthcheck.
7. **CI:** install with cache, `pnpm -r lint`, `pnpm -r typecheck`, `pnpm -r test`,
   `pnpm -r build`, `docker build`. Postgres/Redis services.

### Full schema (create now, use progressively)
`users`, `projects`, `monitors`, `checks`, `rollups`, `incidents`, `incident_updates`,
`channels`, `api_keys`, `refresh_tokens`. Include indexes:
- `checks (monitor_id, checked_at desc)`, `rollups (monitor_id, bucket_hour)` unique,
- `incidents (monitor_id, started_at desc)`, `monitors (project_id, active)`,
- `api_keys (key_hash)` unique, `projects (slug)` unique.

### Tests
- config rejects a missing/short secret; readyz 503 when Redis down; exception envelope
  contains `requestId`; `/metrics` exposes `statusbeam_http_request_duration_seconds`.

### Commits
```
feat(api): zod config validation with fail-fast boot
feat(api): pino logging, request ids, exception envelope
feat(db): full drizzle schema and initial migration
feat(api): health, readiness, and prometheus metrics
build: dockerfile and compose for api, postgres, redis
ci: monorepo lint, typecheck, test, build
```

### Gate
`docker compose -f infra/docker-compose.yml up -d --build`; `/readyz` 200; verify script
green.

---

## 4. Phase S2 — Auth, projects, API keys, monitor CRUD (M1 part 1, 3 days)

### Tasks
1. **Auth:** `POST /v1/auth/register` `{email,password}` (argon2id, min 12 chars, breached
   list not required; document), `POST /v1/auth/login` → access JWT (15 min) in body +
   rotating refresh token (30 days) in `HttpOnly; Secure; SameSite=Strict` cookie, hashed in
   `refresh_tokens`; `POST /v1/auth/refresh`; `POST /v1/auth/logout` (revoke). Use `jose`.
   Rate-limit login (5/min/IP) → 429.
2. **Guards:** `JwtGuard`, `ApiKeyGuard` (scopes), `ProjectOwnershipGuard`. API keys:
   `POST /v1/api-keys` `{name,scopes}` returns `sb_live_<32 bytes base64url>` once; store
   SHA-256 + prefix; scopes `monitors:read`, `monitors:write`, `incidents:write`,
   `status:read`; update `last_used_at` at most once per minute.
3. **Projects:** `POST/GET /v1/projects`; slug generated from name, unique, editable before
   first publish; `public` flag; `GET /v1/projects/:id` owner-only.
4. **Monitors CRUD** (`/v1/monitors`, scoped by project):
   - Zod discriminated union on `type`:
     ```ts
     http: { url, method: 'GET'|'HEAD', headers?, expectedStatus: number[],
             bodyContains?, bodyRegex?, latencyThresholdMs? }
     tcp:  { host, port }
     ```
   - Fields: `name`, `intervalS` 30–3600 (default 60), `timeoutMs` 1000–30000,
     `retries` 1–10 (default 3), `active`.
   - Validate URLs (`http/https` only), hostnames, and regex compilation. SSRF guard:
     resolve the host and reject loopback/private/link-local ranges unless
     `ALLOW_PRIVATE_TARGETS=true` (tests set it true; document why it is off by default).
   - Response includes `nextRunAt` and current status summary.
5. **OpenAPI:** `@nestjs/swagger` at `/openapi.json`; generate `packages/contracts/src/openapi.d.ts`
   with `openapi-typescript`; export a typed fetch client (`openapi-fetch`).
6. **Tests:** register/login/refresh/logout; refresh rotation reuse → 401 and revoke family;
   expired JWT → 401; API key scope matrix; ownership 403; monitor validation matrix
   (bad URL, port 0, interval out of range, bad regex); SSRF rejection; slug collision.

### Commits
```
feat(auth): register, login, refresh rotation, logout
feat(auth): jwt, api-key, and ownership guards
feat(projects): project crud with slugs
feat(monitors): typed monitor crud with zod discriminated union
feat(monitors): ssrf guard for targets
feat(api): openapi spec and generated typed client
test(auth): rotation, scope, and ownership matrix
test(monitors): validation and ssrf cases
```

### Gate
Scope matrix and SSRF tests green; OpenAPI generation reproducible (`pnpm contracts:gen`
produces no diff).

---

## 5. Phase S3 — Checker, scheduler, rollups (M1 part 2, 4 days)

### Tasks
1. **Checker service** (`modules/checks/checker.ts`), injectable:
   - HTTP: `fetch` with `AbortSignal.timeout(timeoutMs)`, no redirects by default (config
     `followRedirects`), capture status, latency (`performance.now()`), body prefix (≤2 KB),
     evaluate `expectedStatus`, `bodyContains`, `bodyRegex`, `latencyThresholdMs`.
   - TCP: `net.connect` with timeout, measure connect latency, close immediately.
   - Result is a discriminated union:
     ```ts
     type CheckResult =
       | { ok: true; latencyMs: number; statusCode?: number; bodySnippet?: string }
       | { ok: false; errorClass: 'timeout'|'dns'|'connection_refused'|'tls'
                              |'http_status'|'body_mismatch'|'latency_exceeded'|'unknown';
           latencyMs: number; statusCode?: number; message: string };
     ```
2. **Scheduler:** on monitor create/update, `queue.upsertJobScheduler('monitor:<id>',
   { every: intervalS*1000 }, { name:'check', data:{ monitorId } })`; on delete/pause,
   `removeJobScheduler`. Worker (`check.processor.ts`):
   - Acquire Redis lock `lock:check:<id>` with `SET NX PX timeoutMs+2000`, owner token;
     release with compare-and-delete Lua. If not acquired, skip and increment
     `statusbeam_check_skipped_total`.
   - Fetch monitor, run checker, insert `checks` row, update `monitors` summary fields
     (`last_status`, `last_checked_at`), feed the incident evaluator (S4; in S3 just store).
   - Metrics: `check_duration_seconds{type,status}`, `check_skipped_total`,
     `scheduler_lag_seconds` (now − job timestamp).
3. **Rollups:** hourly repeatable job recomputes the previous hour per monitor from `checks`
   (`up_count`, `down_count`, `p95_latency_ms`) with `ON CONFLICT (monitor_id,bucket_hour)
   DO UPDATE`. Recompute, do not increment, so reruns are idempotent. Backfill command
   `pnpm rollups:backfill --days 7`.
4. **Retention:** daily job deletes `checks` older than 7 days and `rollups` older than 90
   days (configurable). Log deleted counts.
5. **Tests:** checker with a local fake target (status 200/500, wrong body, slow > timeout,
   DNS failure using an invalid TLD, TCP refused, latency threshold); scheduler creates one
   repeatable job per monitor and updates it on interval change; two concurrent workers →
   exactly one check row (fake timers + real Redis); rollup math with fixed fixtures,
   including the p95 definition (nearest-rank); retention deletes only old rows; rerunning
   rollups leaves counts unchanged.

### Commits
```
feat(checks): http and tcp checker with discriminated results
feat(jobs): bullmq repeatable scheduler per monitor
feat(jobs): redis lock to prevent duplicate checks
feat(jobs): hourly idempotent rollups and daily retention
feat(checks): check history endpoint with pagination
test(checks): timeout, dns, status, body, latency, duplicate-run
test(jobs): rollup math and retention boundaries
```

### Gate
Duplicate-run test passes 3×; backfill of a seeded 7-day dataset produces rollups whose
totals match raw checks exactly.

---

## 6. Phase S4 — Incidents and notifications (M2, 5 days)

### Tasks
1. **State machine** (`modules/incidents/state-machine.ts`):
   `investigating → identified → monitoring → resolved`; allow `investigating →
   monitoring` and direct resolve; reject everything else with 409 and the allowed
   transitions in the body. Store `incident_updates` for every change (status, message,
   actor).
2. **Evaluator** after each check:
   - Maintain consecutive failure/success counters (derive from recent checks or store on
     monitor; derive with a 20-row query is acceptable and simpler).
   - Open an incident after `retries` consecutive failures; if one is open, do nothing.
   - Resolve after 2 consecutive successes; append a system update.
   - Hysteresis test: fail, fail, success, fail, fail, success — with `retries=3` no
     incident is opened.
   - Cause text derives from the result `errorClass` and message, truncated.
3. **Channels:** `channels` CRUD per project (`webhook`, `slack`, `email`), config validated
   by type. Adapters implement `send(event)`:
   - webhook: POST JSON, HMAC `X-StatusBeam-Signature: t=...,v1=...`, 5s timeout;
   - slack: incoming webhook payload with blocks;
   - email: Resend HTTP API if `RESEND_API_KEY`, otherwise SMTP via nodemailer;
   - every adapter returns a typed `{ok:true}` / `{ok:false,retryable,errorClass}`.
4. **Notification queue:** one job per (incident update × channel) with deterministic
   `jobId = notif:<updateId>:<channelId>`; attempts 5, exponential backoff 30s base; on
   exhaustion move to `notification-dlq` (a BullMQ queue) and record `notification_failures`
   table row. Admin endpoints `GET /v1/notifications/dlq`, `POST /v1/notifications/dlq/:id/replay`.
5. **Tests:** transition matrix (valid/invalid); incident opens/resolves exactly once;
   hysteresis; notification dedupe on replay (same jobId); each adapter with a mocked HTTP
   layer (2xx, 500 then success, timeout, permanent 400); DLQ after exhaustion and replay;
   email adapter skipped cleanly when no provider is configured.

### Commits
```
feat(incidents): explicit state machine and update audit
feat(incidents): open/resolve evaluator with hysteresis
feat(channels): webhook, slack, and email adapters
feat(jobs): notification queue with retries and dlq
feat(api): incident update endpoints and notification replay
test(incidents): transition matrix and flapping monitor
test(notifications): retry, dedupe, dlq, and replay
```

### Gate
Hysteresis and DLQ replay tests green; notification side effects counted by a local sink
equal exactly one per incident update.

---

## 7. Phase S5 — Real-time, public status API and page (M3, 4 days)

### Tasks
1. **SSE:** `GET /v1/projects/:slug/stream` (public, no auth):
   - On connect send a `snapshot` event (overall status + monitors + active incidents).
   - Subscribe to Redis channel `status:<projectId>`; forward `incident` and `check`
     summary events.
   - Heartbeat comment `: ping` every 15s; handle client disconnect; respect
     `Last-Event-ID` by replaying events from a capped Redis stream (`XADD`/`XRANGE`,
     trimmed to 1000) so a reconnect does not lose an incident change.
   - Backpressure: if `res.write()` returns false, pause the subscriber until `drain`;
     drop non-critical `check` events when the buffer is saturated, never drop `incident`.
2. **Publish events:** on incident open/update/resolve, `PUBLISH status:<projectId>` with a
   monotonic id; also `XADD` to the stream. Prune the stream on write.
3. **Public API:** `GET /v1/projects/:slug/status` — overall status, per-monitor 90-day
   uptime (from rollups), active incidents. Cache 10s in Redis; `ETag` = SHA-256 of the
   canonical JSON; honour `If-None-Match` → 304; `Cache-Control: public, max-age=10`.
   Rate limit 60/min/IP. Never expose configs, URLs, headers, or secrets.
4. **Public page** (`apps/web/app/(public)/[slug]/page.tsx`): server-render the snapshot,
   client component subscribes to SSE via `EventSource`; overall banner; per-monitor 90-day
   bars (90 divs, accessible labels); incident timeline; responsive; dark mode; no layout
   shift. Use design tokens in `app/globals.css` (CSS variables), not a UI kit.
5. **Playwright smoke** (`apps/web/test/status.spec.ts` + a controllable target server in
   `apps/api/test/fixtures/target-server.ts`):
   - create project + monitor via API, wait for the first green check;
   - flip the target to 500, wait for the incident to open;
   - assert the public page shows the incident and the banner turns red within 2s of the
     SSE event (poll with a 10s ceiling);
   - resolve and assert green returns.
6. **Tests:** SSE snapshot, heartbeat, incident event, reconnect with `Last-Event-ID`;
   public API 304/ETag; cache TTL; no secret leakage (snapshot keys are allowlisted);
   rate limit.

### Commits
```
feat(status): redis pubsub, stream buffer, and sse endpoint
feat(status): public status api with etag and 10s cache
feat(web): public status page with live updates
test(status): sse reconnect and cache semantics
test(e2e): incident opens and page flips within two seconds
```

### Gate
Playwright spec green 3× in a row; `curl -I` shows `ETag` and 304 on repeat.

---

## 8. Phase S6 — Dashboard, load test, deploy, release (M4, 4 days)

### Tasks
1. **Dashboard** (`apps/web/app/dashboard`): login/register, project switcher, monitor list
   with current status, monitor form (type-specific fields), check history chart (use the
   typed client), incident editor (allowed transitions only), channel configuration, API
   key creation (show once). Cookie-based refresh, access token in memory, silent refresh,
   redirect on 401.
2. **Typed client:** `packages/contracts` exports `createClient(baseUrl)` from the generated
   OpenAPI types; all web calls go through it. No `any`.
3. **Load test:** `scripts/seed-monitors.ts --count 5000` creates monitors with short
   intervals against a local fast target; run 2 workers; measure scheduler lag p95/p99 for
   10 minutes (prometheus histogram), API p95, DB CPU, Redis ops/s. Document the achieved
   numbers and the bottleneck (job throughput vs DB inserts). Save results under
   `load/results/`.
4. **Failure modes** (`docs/failure-modes.md`): 10× monitors, Redis loss (lock and queue
   behaviour), Postgres connection exhaustion, notification provider outage, SSE fan-out
   cost, rollup job backlog.
5. **Deploy:** `infra/docker-compose.prod.yml` (api, web, postgres, redis, caddy) or Fly.io
   configs. Document env vars, migration step, backups. Mark the live URL only if actually
   deployed.
6. **README:** pitch, Mermaid, measured results (checks/min, scheduler lag p95, API p95),
   run steps, design decisions, security notes, cost table, what's next, demo GIF/live URL.
   ADRs: repeatable jobs vs cron, SSE vs WebSocket, rollup strategy/retention.
7. **Release:** tag `v1.0.0`, push, make public, topics, update parent `progress/log.md`.

### Commits
```
feat(web): dashboard auth, project switcher, and monitor management
feat(web): incident editor and api key management
perf: 5000-monitor scheduler load test and results
build: production compose and deploy docs
docs: readme, adrs, failure modes, and interview notes
chore: release v1.0.0
```

---

## 9. Final walkthrough test

Implement `scripts/walkthrough.ps1`; record observed output in `docs/roadmap.md`.

| # | Action | Expected |
|---|---|---|
| 1 | `docker compose -f infra/docker-compose.yml up -d --build` | healthy in <5 min |
| 2 | Register user; create project `demo` (public) | 201, slug `demo` |
| 3 | Start local target `http://host.docker.internal:9099/health` (200) | target up |
| 4 | Create HTTP monitor, interval 10s, retries 2 | 201, `nextRunAt` set |
| 5 | Wait 2 checks | 2 `checks` rows, monitor `up`, rollup job scheduled |
| 6 | Open SSE `GET /v1/projects/demo/stream` | `snapshot` received within 1s |
| 7 | Stop target; wait ~30s | incident opens after 2 failures; SSE `incident` event; webhook sink gets one signed notification |
| 8 | `POST /v1/incidents/:id/updates` invalid transition (resolved → investigating) | 409 with allowed transitions |
| 9 | Restart target; wait 2 successes | incident resolved; SSE event; page green |
| 10 | `GET /v1/projects/demo/status` twice | first 200 + ETag, second 304 |
| 11 | Read-only API key calls `POST /v1/monitors` | 403 |
| 12 | Create 5 monitors with 1s interval; confirm lock | each interval produces one check, `check_skipped_total` > 0 under forced overlap |
| 13 | Rollup backfill for the run window | totals equal raw checks; rerun unchanged |
| 14 | Playwright smoke | passes |
| 15 | `GET /metrics` | check, scheduler-lag, notification, SSE metrics present |
| 16 | Kill Redis, hit `/readyz` | 503; restart → 200 |

Also do a fresh-clone run: clone to `%TEMP%\statusbeam-smoke`, `pnpm install`,
compose up, repeat steps 2, 5, 7, 10.

---

## 10. Definition of Done checklist

- [ ] README pitch + Mermaid + measured results + run steps + tradeoffs + what's next
- [ ] Compose up from clean clone <5 min (api, web, postgres, redis)
- [ ] CI badge green (lint, typecheck, unit, integration, build)
- [ ] Failure tests: timeout, DNS, 500, wrong body, duplicate-run, invalid transition,
      notification retry/DLQ, auth rejection, SSRF, rate limit
- [ ] `/healthz`, `/readyz`, `/metrics`, pino logs with request ids
- [ ] OpenAPI + generated typed client, no `any` in web API calls
- [ ] SSE with heartbeat, reconnect, and backpressure behaviour documented
- [ ] 3 ADRs + case study + failure modes + security notes
- [ ] 5,000-monitor scheduler numbers with hardware and method
- [ ] MIT license, conventional history, `v1.0.0`
- [ ] Demo GIF or live URL
- [ ] `docs/interview-notes.md`: schema sketch, scheduler design, 3 failure modes

---

## 11. Risks and fallbacks

| Risk | Mitigation |
|---|---|
| BullMQ repeatable jobs double-run during deploys | Stable `jobId`, Redis lock, idempotent check insert keyed by `(monitor_id, checked_at bucket)` if needed |
| Playwright flaky against timers | Use a controllable target server and assert with a 10s ceiling, not fixed sleeps; isolate data per run |
| Next.js build memory/time | `output: 'standalone'`, disable telemetry, build web in its own CI job cache |
| SSRF guard blocks the local test target | `ALLOW_PRIVATE_TARGETS=true` only in dev/test; document the production default |
| SSE fan-out at scale | Redis pub/sub + per-connection handler; documented limit and "what I'd do next" |
| Email provider unavailable | Slack/webhook still ship; email adapter tested with a mocked provider; mark key optional |
| 5k-monitor load too heavy for laptop | Reduce to 1k, publish the honest number, document extrapolation and bottleneck |
