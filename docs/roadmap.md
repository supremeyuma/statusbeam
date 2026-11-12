# StatusBeam Roadmap and Gate Evidence

Source plan: `docs/plan.md`. Update this file at every phase gate. A checked box means
verified, not "written".

## S0 — Bootstrap

- [x] Folder created at `../statusbeam`
- [x] Git repository on `main`, `core.autocrlf=false`
- [x] MIT license, `.gitignore`, `.gitattributes`, `.editorconfig`
- [x] Execution plan, spec, master plan, and agent instructions committed
- [x] Private GitHub remote created and pushed
- [ ] Tooling: pnpm workspace, TypeScript strict config, ESLint/Prettier, NestJS and Next.js
      apps, `packages/contracts`, initial CI skeleton
- [ ] Initial package install and empty `pnpm build` / `pnpm typecheck` green

**Evidence:** repository bootstrapped; remote expected at
<https://github.com/supremeyuma/statusbeam>. Tooling evidence pending.

## S1 — Skeleton, config, health, compose, CI (M0)

- [ ] Nest app with config validation, request ids, exception envelope
- [ ] Drizzle schema + first migration; compose postgres/redis with reserved ports
- [ ] CI: tsc, eslint, vitest, docker build
- [ ] `/healthz`, `/readyz`, pino, metrics

**Gate evidence:** _pending_

## S2 — Auth, projects, API keys, monitor CRUD

- [ ] Register/login/refresh rotation, JWT and API-key guards
- [ ] Projects and monitor CRUD with zod discriminated unions
- [ ] SSRF guard and OpenAPI + typed client

**Gate evidence:** _pending_

## S3 — Checker, scheduler, rollups

- [ ] HTTP/TCP checker with typed results
- [ ] BullMQ repeatable job per monitor + Redis lock
- [ ] Hourly idempotent rollups and retention
- [ ] Duplicate-run and rollup-math tests

**Gate evidence:** _pending_

## S4 — Incidents and notifications

- [ ] Explicit state machine with 409 on invalid transitions
- [ ] Hysteresis: open after N failures, resolve after 2 successes
- [ ] Webhook/Slack/email adapters, retries, DLQ and replay

**Gate evidence:** _pending_

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
