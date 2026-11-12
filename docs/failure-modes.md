# Failure modes

What happens when each dependency or assumption breaks, and what is left to do.

## 1. Ten times the monitors (10,000)

Schedules live in Redis; each check is one job. At 10× the current load the first bottleneck is
raw `checks` inserts and the 7-day delete window, not scheduling. Postgres autovacuum will grow
with the table; the API's pool (10 connections) becomes the limiter before CPU.

Observed at 1,000 monitors / 30s: 113 checks/s, scheduler lag p95 1.84s, DB CPU effectively
idle. Extrapolation to 10k is not a measurement; the plan's next step is partitioning
`checks` by day and running workers against a dedicated Postgres host.

## 2. Redis loss

- **Locks**: checks run without coordination until Redis returns; duplicate inserts are
  possible. The lock is best-effort correctness, not the only guard.
- **Queues**: repeatable schedules and pending jobs are gone. Workers reconnect when Redis
  returns, but monitors are not automatically re-scheduled. A startup reconcile (list active
  monitors, `upsertJobScheduler`) is the documented fix and is not implemented.
- **SSE**: `/readyz` returns 503; connected browsers keep the last snapshot until reconnect.
- **Cache**: status API falls back to computing from Postgres (it treats a Redis error as a
  cache miss).

## 3. Postgres connection exhaustion

The pool is capped at 10 with a 2s connection timeout. API requests that need the DB will 500
with the standard envelope; `/readyz` returns 503. Checks fail inside the worker, so jobs retry
according to BullMQ's default job options (checks have no retry set — a missed check is simply
missed, which is the safer behaviour for monitoring). Notifications still attempt.

## 4. Notification provider outage

Adapters classify 5xx, 408, 429, and network/timeout as retryable; 4xx (except 408/429) as
permanent. Retryable failures back off exponentially (30s base) up to 5 attempts, then move to
`notification-dlq` and a `notification_failures` row. Replay reuses the deterministic
`notif:<updateId>:<channelId>` job id. Email with no provider configured is skipped (`ok`,
`skipped: true`) rather than failing the incident.

## 5. SSE fan-out cost

Each connection holds one Redis subscription and one Express response. Slow clients pause
writes; check events are dropped while paused, incident events are buffered up to 1,000, then
the connection is closed so the client reconnects with `Last-Event-ID`. Fan-out is per-client;
at thousands of public viewers the next step is an in-process broadcast of one subscription per
API instance.

## 6. Rollup backlog

Hourly maintenance jobs are independent of the check queue. A missed hour is repaired by
`pnpm rollups:backfill --days N` because recompute is idempotent. Backfill beyond raw-check
retention (7 days) cannot reconstruct data — the window is bounded by design.

## 7. Duplicate jobs during deploy

`upsertJobScheduler` uses a stable scheduler id, so a deploy replaces rather than duplicates
schedules. Two workers may still receive the same job during a transition; the Redis lock
makes one of them return `skipped` and increments `statusbeam_check_skipped_total`. The insert
is not deduplicated by timestamp; this is the plan's documented residual risk.

## 8. SSRF / DNS rebinding

Targets are validated at create time and again immediately before every check (HTTP and TCP).
Any address resolving to loopback/private/link-local/CGNAT/multicast/reserved is rejected when
`ALLOW_PRIVATE_TARGETS=false`. DNS can still resolve to a public address at validation and a
private one at connect after the re-check; the remaining gap is a TOCTOU race, mitigated by
re-checking but not eliminated without pinning the resolved IP for the connection.

## 9. Clock skew

Rollup buckets are UTC hour floors based on check timestamps (`now()` from Postgres). API
instances with skewed clocks affect `nextRunAt` display and the SSE event id ordering only;
the id is a Redis counter, not a wall clock. Scheduler lag uses job timestamps from Redis and
will show skew if the worker clock drifts.

## 10. Public cache stampede

The 10s cache is written after computing; concurrent misses can each compute a snapshot. The
queries are indexed and bounded (100 monitors per project in practice), and the TTL is short,
so the stampede is accepted. A single-flight lock per slug is the next step if a large public
project is added.
