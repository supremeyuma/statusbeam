# ADR 003 — Recompute hourly rollups; delete-based retention

**Status:** accepted · **Date:** 2026-11-12

## Context

Raw checks grow linearly with monitors × frequency. 1,000 monitors at 30s is 2.88M rows/day.
Dashboards need 90 days of uptime, but keeping raw rows that long is expensive and makes
p95 queries slow.

## Decision

- Raw `checks` are retained **7 days** (`CHECK_RETENTION_DAYS`).
- Hourly `rollups(monitor_id, bucket_hour, up_count, down_count, p95_latency_ms)` are retained
  **90 days** (`ROLLUP_RETENTION_DAYS`).
- Rollups are **recomputed** for the hour, not incremented:

```sql
INSERT INTO rollups (...)
SELECT monitor_id, $hour, count(*) FILTER (WHERE status='up'), count(*) FILTER (WHERE status='down'),
       percentile_disc(0.95) WITHIN GROUP (ORDER BY latency_ms)
FROM checks WHERE checked_at >= $hour AND checked_at < $hour + interval '1 hour'
GROUP BY monitor_id
ON CONFLICT (monitor_id, bucket_hour) DO UPDATE SET ...
```

- `percentile_disc` is nearest-rank p95 (the value at ceil(0.95·n)), which is easy to explain
  and test.
- A daily job deletes old checks first, then old rollups. `pnpm rollups:backfill --days 7`
  reuses the same code path.
- The public status endpoint aggregates 90 rollup days in memory for the bars; it does not
  touch raw checks.

## Consequences

- Reruns and backfills are idempotent; a missed hourly job is repaired by backfill.
- Rollup accuracy depends on raw checks still being present. Running backfill after retention
  has deleted an hour silently produces no bucket for that hour. The backfill window must be
  ≤ retention.
- Delete-based retention causes table bloat at very large scale. At 100k monitors the next
  step is daily partitioning with `DROP PARTITION`, not row deletes.
- The p95 definition is documented and tested with fixed latencies (10–50ms →
  p95 = 50ms).

## Alternatives rejected

- **Increment counters per check** — not idempotent; a retried job double-counts.
- **Keep raw checks for 90 days** — storage and query cost for no product benefit.
- **Approximate t-digest histograms** — overkill for hourly per-monitor p95 and harder to
  verify in tests.
