# Interview notes

## Data model sketch

```
users(id, email, password_hash)
  └─ projects(id, user_id, name, slug unique, public)
       ├─ monitors(id, project_id, name, type http|tcp, config jsonb,
       │            interval_s, timeout_ms, retries, active,
       │            next_run_at, last_status, last_checked_at)
       │    ├─ checks(id bigserial, monitor_id, status up|down, latency_ms,
       │    │          status_code, error, checked_at)   -- 7 days
       │    │    index (monitor_id, checked_at desc)
       │    ├─ rollups(monitor_id, bucket_hour, up_count, down_count,
       │    │           p95_latency_ms)                 -- 90 days
       │    ├─ incidents(id, monitor_id, status, started_at, resolved_at, cause)
       │    │    └─ incident_updates(id, incident_id, status, message, actor)
       │    └─ channels(id, project_id, type, config jsonb, active)
       ├─ api_keys(id, project_id, key_hash unique, prefix, scopes[], last_used_at)
       └─ refresh_tokens(id, user_id, token_hash unique, family_id, expires_at, revoked_at)
notification_failures(id, job_id, channel_id, incident_update_id, error_class, message, attempts)
```

Hot queries: `checks (monitor_id, checked_at desc)` for history/evaluator; rollups by
`(monitor_id, bucket_hour)` primary key; open incidents by `(monitor_id) WHERE resolved_at IS
NULL`.

## Scheduler design (60-second answer)

One repeatable BullMQ job per monitor keyed `monitor:<id>`, upserted on create/update and
removed on pause/delete. The worker takes a Redis lock `lock:check:<id>` with `SET NX PX
timeout+2s`, runs the checker, inserts a check, updates the monitor summary, publishes a check
event, and evaluates incidents. Release is compare-and-delete Lua so an expired lock owned by
another worker is never deleted. Two workers racing → one `checked`, one `skipped`, exactly one
row — covered by a test with real Redis.

Rollups are hourly and recompute the whole hour with `ON CONFLICT DO UPDATE`; p95 is
`percentile_disc(0.95)` (nearest rank). Retention deletes raw checks after 7 days and rollups
after 90.

## Three failure modes

1. **Redis dies.** Locks disappear → duplicate checks possible; queues and repeat schedules are
   lost → monitors stop being scheduled. Locks make duplicates harmless, and the documented
   fix is a startup reconcile of active monitors, which is not implemented. `/readyz` 503s.
2. **Notification provider outage.** 5xx/timeout/429 retry with exponential backoff (5
   attempts, 30s base); 4xx is permanent. Exhaustion writes `notification_failures` and moves
   the job to `notification-dlq`; replay reuses the original job id so a successful delivery is
   never duplicated.
3. **SSRF / DNS rebinding.** Every target is resolved and checked at create and check time;
   loopback/private/link-local/CGNAT/multicast are rejected. A DNS answer can change between
   the check and the TCP connect (TOCTOU); the remaining fix is pinning the validated IP for the
   request.

## Numbers to quote

- 1,000 monitors, 30s interval: ~113 checks/s, scheduler lag p95 **1.84s**, API p95 **4.7ms**,
  check duration p95 **9.5ms** on an i7-14650HX / 31.6 GB with one 5-slot worker.
- 120 API tests, 16 files; Playwright down/up smoke green 3×.

## Things I would change at 10× scale

Split the worker from the API, replace delete-based retention with daily partitions, move rate
limiting to Redis, add a startup schedule reconcile, and put a single-flight lock around public
snapshot cache misses.
