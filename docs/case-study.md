# Case study — StatusBeam

## Problem

Build the smallest honest uptime product that demonstrates the parts of a TypeScript backend
that are hard to fake: typed contracts across a boundary, a scheduler that survives multiple
workers, an incident lifecycle with hysteresis, and real-time delivery to a public page.

The plan deliberately excludes multi-region probes, escalation policies, billing, and browser
synthetic tests. Those are listed as next steps, not hidden.

## Approach

**Typed boundary first.** Zod schemas live in `packages/contracts`; the API uses them for
request validation and emits OpenAPI from the live Nest routes. `openapi-typescript` generates
`openapi.d.ts`, `openapi-fetch` exposes `createApiClient`, and the web app only calls the API
through it. Regenerating twice produces byte-identical output, which is checked in.

**Scheduling.** One repeatable BullMQ job per monitor. The worker takes
`lock:check:<id>` with `SET NX PX` and releases with compare-and-delete. A duplicate worker
returns `skipped` and increments a counter. Scheduler lag uses the real due time
(`job.timestamp + delay`), not queue age.

**Incidents.** A 20-check window drives consecutive failure/success counting. Open after
`retries` failures, resolve after two successes, write every transition to
`incident_updates`. The state machine rejects invalid transitions with 409 and the allowed
list; manual and system updates share the same table shape.

**Notifications.** Deterministic `notif:<updateId>:<channelId>` job ids, five exponential
attempts, permanent 4xx errors skip straight to the DLQ, and replay reuses the same id. The
sink tests verify exactly one delivery per update and that replay does not duplicate.

**Public page.** Redis pub/sub plus a capped stream. The SSE endpoint sends a snapshot, replays
after `Last-Event-ID`, heartbeats, and drops check events under backpressure while buffering
incidents. The status API is cached for 10s with ETag/304 and an allowlist that a test asserts
does not leak config or secrets.

## Results

- 120 API tests across 16 files; 3 consecutive Playwright runs of the down/up page flip.
- 1,000 monitors at 30s, measured on the dev machine: ~113 checks/s, scheduler lag p95 1.84s,
  check duration p95 9.5ms, API p95 4.7ms.
- Duplicate-race test: two concurrent processor calls always produce exactly one `checks` row.
- Rollup fixture p95 is 50ms for latencies 10–50ms (nearest rank), and reruns do not change
  counts.

## Trade-offs made

- One API process serves HTTP and runs workers. It keeps the demo runnable in one compose file
  but couples API latency to check bursts; production would split the worker.
- Delete-based retention is simple and correct at this scale; partitioning is the next step.
- Throttling is in-memory per instance; acceptable for a single public page, not for a fleet.
- The live URL is deferred because no deploy account was available. The production compose
  file and Caddy configuration are checked in; the local walkthrough is the evidence.

## What I learned

The hard part was not the HTTP checker. It was making duplicate delivery harmless (stable job
ids plus a lock plus idempotent rollups), and keeping public serialisation allowlisted instead
of "return the row and hope". Both are now enforced by tests rather than comments.
