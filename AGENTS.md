# Agent Instructions — StatusBeam

This repository is already bootstrapped: directory, git repo on `main`, MIT license, and a
private GitHub remote exist. **Do not run `git init`, create a new repo, or replace the
remote.** Start with the tooling part of Phase 0 in [`docs/plan.md`](docs/plan.md).

## Read first

1. [`docs/spec.md`](docs/spec.md) — product scope and milestones.
2. [`docs/plan.md`](docs/plan.md) — the authoritative execution plan.
3. [`docs/master-plan.md`](docs/master-plan.md) — commit, phase, and release conventions.
4. [`docs/roadmap.md`](docs/roadmap.md) — update this at every gate.

## How to work

- Follow the plan's phases **in order**: S0 bootstrap tooling → S1 skeleton → S2 auth/monitors
  → S3 checker/scheduler → S4 incidents → S5 realtime/public page → S6 dashboard/load/release.
- Work each phase on `phase/<n>-<name>`, commit every meaningful change with Conventional
  Commits, run the full gate, merge to `main` with `--no-ff`, tag the phase, and push.
- `scripts/verify.ps1` must pass before a phase is considered done. It runs format, lint,
  typecheck, tests, and build.
- Write tests for the hard parts **before** the implementation: the scheduler lock, duplicate
  check prevention, incident hysteresis, SSE reconnect, rollup math.
- Never weaken a failing test to make a phase pass. Fix the code or cut scope explicitly.

## Environment notes (this machine)

- Node 22 and pnpm 12 are installed via winget. **Use the installed pnpm**; set
  `packageManager` to the installed version. Do not use `corepack` — it hits EPERM on
  `C:\Program Files\nodejs`.
- Docker Desktop must be running with Linux containers. If it is not, stop and report; do not
  replace Postgres/Redis with SQLite.
- `gh` is authenticated as `supremeyuma`.

## Parallel build coordination

Two other agents are building `evalgate` and `edgelink` on the same machine, and HookRelay may
be running. Use these host ports so stacks do not collide:

| Service | Port |
|---|---|
| Postgres (host) | **5433** |
| Redis (host) | **6380** |
| API | **3001** |
| Web dashboard / public page | **3000** |

- Put `name: statusbeam` in the compose file and use these host mappings from the start.
- Set `DATABASE_URL` / `REDIS_URL` in `.env.example` and `.env` to the reserved ports.
- CI services stay on 5432/6379 inside the runner; only local host mappings change.
- Do not publish Postgres/Redis ports in production compose.
- Do not touch `C:\Users\Supreme\repos\hookrelay`, `evalgate`, or `edgelink`.

## Human-only checkpoints

Stop and report rather than faking: GitHub auth loss, Docker unavailable, a deploy account
needed for a live URL, or a secret/API key the plan marks as optional. Everything else should
be resolved autonomously using the plan's documented fallbacks.

## Definition of done

The release gate in `docs/master-plan.md` §7 plus the project checklist in
`docs/plan.md` §10: clean clone, compose up in <5 min, green CI, walkthrough recorded,
`v1.0.0` tagged and pushed, repo public with topics, and the parent
`ai-engineering-pivot/progress/log.md` updated.
