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

- [x] SSE with heartbeat, `Last-Event-ID`, backpressure
- [x] Cached public status API with ETag
- [x] Next.js public page + Playwright smoke

**Gate evidence:** 120 API tests green. SSE suites cover the snapshot frame, Redis-published
incident events, `Last-Event-ID` replay (only events after the cursor), and a 200ms test
heartbeat. Public API suites cover ETag/304, the 10s Redis cache and refresh after deletion,
90-day rollup bars, rate limiting (429 after 60/min), and a no-leak assertion on the
allowlisted JSON. Live compose check: first status request `200` with
`ETag "302a2e…"` and `Cache-Control: public, max-age=10`, conditional request `304` with an
empty body. Playwright smoke passed three consecutive runs (2.0m each): target healthy →
page green, flip to 500 → incident opens and the banner turns red, restore → page green.

## S6 — Dashboard, load, deploy, release

- [x] Dashboard auth, project switcher, monitor/incident/API-key UI
- [x] Scheduler-lag load test with numbers (1,000 monitors; 5k fallback documented)
- [x] Deploy recipe, README, demo script, ADRs, case study
- [x] `v1.0.0`, public repo, topics, parent log updated

**Gate evidence:** Dashboard (`/login`, `/dashboard`) uses the generated typed client with
in-memory access tokens and silent refresh; it covers project creation/switching, monitor
create/pause/delete, latency history, incident transitions (only allowed next states are
offered), channels, and one-time API key display. Load test on this machine (i7-14650HX,
31.6 GB, Docker Desktop WSL2): 1,000 monitors at 30s, 7,000 checks in 62s (~113/s),
scheduler lag p50 0.76s / p95 1.84s / p99 1.97s, check p95 9.5ms, API p95 4.7ms; raw JSON in
`load/results/`. The plan's 5k target was not run on the laptop; the documented fallback is
1k with extrapolation and the honest bottleneck (single 5-slot worker, then raw inserts).
Production compose + Caddy + deploy/backup docs are in `infra/` and `docs/deploy.md`; the live
URL and demo GIF are deferred (no deploy account/recording tool). `docs/walkthrough-output.txt`
records `scripts/walkthrough.ps1` end to end: green checks, SSE snapshot, signed webhook on
incident, resolve, 409 with allowed transitions, ETag→304, read-only key 403, metrics present
(check, scheduler lag, notifications, SSE), backfill `rolled|raw=1|1`, and Redis loss →
`/readyz` 503 → recovery 200.

## Definition of Done (rubric evidence)

| Rubric item | Evidence |
|---|---|
| One-sentence pitch | README first blockquote |
| Architecture diagram + 3–5 tradeoffs | README Mermaid + Design decisions; three ADRs |
| `docker compose up` works | `infra/docker-compose.yml`; walkthrough output step 1, readyz 200 |
| CI lint/typecheck/tests + badge | `.github/workflows/ci.yml` verify + docker matrix; README badge |
| Failure-path tests | timeout, DNS, 500, wrong body, duplicate-run, invalid transition, notification retry/DLQ/replay, auth rejection, SSRF, rate limit |
| OpenAPI/typed client | `packages/contracts/openapi.json`, `src/openapi.d.ts`, `createApiClient`; reproducible `pnpm contracts:gen` |
| Structured logs + health | pino redaction + request ids; `/healthz`, `/readyz`, `/metrics` |
| Docs page explaining why | `docs/case-study.md`, `docs/adr/*` |
| License | `LICENSE` (MIT) |
| Conventional commits, clean history | `git log --oneline`; phase merges and tags |
| Load-test numbers | `load/results/1000-monitors-*.json` + README table |
| Failure-mode section | `docs/failure-modes.md` (10 scenarios) |
| 3 ADRs | `docs/adr/001`, `002`, `003` |
| Observability | metrics names verified in walkthrough (check, scheduler lag, notifications, SSE) |
| Security notes | README Security notes + `docs/security.md` |
| Cost note | README cost table (1k/10k/100k) |
| Demo | **Deferred**: no live URL or GIF (no deploy account/recording tool). Local walkthrough transcript + Playwright spec provided |
| Interview readiness | `docs/interview-notes.md` (schema sketch, scheduler design, three failure modes) |

## Release gate

- [x] `scripts/verify.ps1` exits 0 from a fresh clone
- [x] Compose stack healthy; `docs/walkthrough-output.txt` records the end-to-end run
- [x] CI workflows for verify + Docker images (api, web)
- [x] `v1.0.0` annotated tag pushed
- [x] Repository public, MIT license, topics and description set
- [x] Load numbers reproducible (`pnpm load:seed` / `load:measure`); 5k fallback documented
- [x] Parent `ai-engineering-pivot/progress/log.md` updated
- [x] Deferred list recorded (live URL, demo GIF, 5k load, partitioning)
