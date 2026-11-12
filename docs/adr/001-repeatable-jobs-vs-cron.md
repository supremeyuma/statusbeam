# ADR 001 — Repeatable BullMQ job per monitor instead of one cron loop

**Status:** accepted · **Date:** 2026-11-12

## Context

Checks must run on per-monitor intervals (30–3600s) with thousands of monitors. A single cron
job that selects `next_run_at <= now()` and loops is the obvious first implementation. It
serialises every check through one worker, hides per-monitor failures behind one job result,
and makes "which monitor is behind?" unanswerable.

## Decision

One BullMQ repeatable job per monitor:

```ts
queue.upsertJobScheduler(`monitor:${id}`, { every: intervalS * 1000 }, {
  name: 'check',
  data: { monitorId: id },
  opts: { removeOnComplete: 100, removeOnFail: 500 },
});
```

Workers race for `lock:check:<id>` using `SET NX PX timeout+2000` and release with a
compare-and-delete Lua script. A skipped lock is counted, not retried. On create/update the
schedule is upserted in place; pause/delete removes it.

## Consequences

- Adding worker replicas increases throughput without duplicate checks.
- Per-monitor backlogs are visible as individual delayed jobs and lag metrics.
- Deploys must be idempotent: `upsertJobScheduler` with a stable id handles that, and the
  lock covers the gap between schedule replacement and worker shutdown.
- BullMQ repeat schedules are stored in Redis; Redis loss drops schedules until monitors are
  re-synced. Mitigation: a startup reconcile pass per project (documented in
  `docs/failure-modes.md` as a gap, not implemented) and the lock/insert model, which makes a
  duplicate harmless anyway.
- Job timestamp is creation time, one interval before the run. The lag metric uses
  `job.timestamp + delay`, which is the actual due time.

## Alternatives rejected

- **One cron loop** — single point of serialisation, poor failure isolation.
- **`setInterval` per monitor in the API** — loses schedules on restart, no cross-replica
  coordination.
- **Kubernetes CronJob per monitor** — far too much control-plane churn.
