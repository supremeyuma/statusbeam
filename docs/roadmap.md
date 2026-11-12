# StatusBeam Roadmap and Gate Evidence

Source plan: `docs/plan.md`. Update this file at every phase gate. A checked box means
verified, not "written".

## S0 — Bootstrap

- [x] Folder created at `../statusbeam`
- [x] Git repository on `main`, `core.autocrlf=false`
- [x] MIT license, `.gitignore`, `.gitattributes`, `.editorconfig`
- [x] Execution plan, spec, master plan, and agent instructions committed
- [x] Private GitHub remote created and pushed
- [x] Tooling: pnpm workspace, TypeScript strict config, ESLint/Prettier, NestJS and Next.js
      apps, `packages/contracts`, initial CI skeleton
- [x] Initial package install and empty `pnpm build` / `pnpm typecheck` green

**Evidence:** repository bootstrapped; remote at
<https://github.com/supremeyuma/statusbeam>. Tooling gate: `scripts/verify.ps1` exits 0
(format, lint, typecheck, 1 API test, contracts + API + Next production build). Node
v22.19.0, pnpm 12.18.0, TypeScript 5.9.3, NestJS 11, Next.js 15.5.29.

## S1 — Skeleton, config, health, compose, CI (M0)

- [x] Nest app with config validation, request ids, exception envelope
- [x] Drizzle schema + first migration; compose postgres/redis with reserved ports
- [x] CI: tsc, eslint, vitest, docker build
- [x] `/healthz`, `/readyz`, pino, metrics

**Gate evidence:** `docker compose -f infra/docker-compose.yml up -d --build` brought
postgres, redis, and api healthy. Observed: `/healthz` -> `{"status":"ok"}`; `/readyz` ->
`{"status":"ok","checks":{"database":"up","redis":"up"}}`; `/metrics` includes
`statusbeam_http_request_duration_seconds`; unknown route returns the error envelope with
`requestId`; migration created 11 public tables. `scripts/verify.ps1` exits 0 (11 API tests).

## S2 — Auth, projects, API keys, monitor CRUD

- [x] Register/login/refresh rotation, JWT and API-key guards
- [x] Projects and monitor CRUD with zod discriminated unions
- [x] SSRF guard and OpenAPI + typed client

**Gate evidence:** 65 API tests green, including refresh-token rotation and family
revocation on reuse, the API-key scope matrix (read-only key cannot write, revoked key 401),
ownership hiding (404), monitor validation matrix, and SSRF rejection for loopback targets
when `ALLOW_PRIVATE_TARGETS=false`. `pnpm contracts:gen` is byte-identical across reruns
(OpenAPI: 14 paths, generated `packages/contracts/src/openapi.d.ts`), and the compose image
serves `/openapi.json`, `POST /v1/auth/register`, and `GET /v1/projects` with a JWT.

## S3 — Checker, scheduler, rollups

- [x] HTTP/TCP checker with typed results
- [x] BullMQ repeatable job per monitor + Redis lock
- [x] Hourly idempotent rollups and retention
- [x] Duplicate-run and rollup-math tests

**Gate evidence:** 84 API tests green (12 files). The duplicate-run test races two
`CheckProcessor.process()` calls against real Redis and asserts outcomes `checked`+`skipped`
with exactly one `checks` row. Rollup fixtures (4 up / 1 down, latencies 10–50ms) yield
nearest-rank p95 = 50 and reruns leave counts unchanged. Compose smoke: monitor with
`intervalS=30` against `host.docker.internal:9099` produced 2 `up` checks, `lastStatus=up`,
and `/metrics` exposed `statusbeam_check_duration_seconds`, `statusbeam_check_skipped_total`,
and `statusbeam_scheduler_lag_seconds`. `pnpm rollups:backfill -- --days 1` rolled the seeded
history and `sum(up+down)=1` matched raw checks `=1` for the completed hours.

## S4 — Incidents and notifications

- [x] Explicit state machine with 409 on invalid transitions
- [x] Hysteresis: open after N failures, resolve after 2 successes
- [x] Webhook/Slack/email adapters, retries, DLQ and replay

**Gate evidence:** 111 API tests green. State-machine matrix covers every allowed and
rejected pair; the API returns 409 with `allowedTransitions`. The flapping sequence
down,down,up,down,down,up with `retries=3` opens zero incidents; three consecutive failures
open exactly one; two successes resolve it with system updates `investigating,resolved`.
Adapters are tested against a local sink (HMAC signature verified, 400 permanent, 500
retryable, timeout, Slack blocks, email skipped without a provider). DLQ test moves a
permanent webhook failure into `notification-dlq`, records it, and replays with the same
jobId without duplicate delivery. Compose E2E: stopping the target opened an incident with
cause `connection_refused`, restarting it resolved the incident after two successes.

## S5 — Real-time and public page

- [ ] SSE with heartbeat, `Last-Event-ID`, backpressure
- [ ] Cached public status API with ETag
- [ ] Next.js public page + Playwright smoke

**Gate evidence:** _pending_

## S6 — Dashboard, load, deploy, release

- [ ] Dashboard auth, project switcher, monitor/incident/API-key UI
- [ ] 5,000-monitor scheduler-lag load test with numbers
- [ ] Deploy recipe, README, demo, ADRs, case study
- [ ] `v1.0.0`, public repo, topics, parent log updated

**Gate evidence:** _pending_
