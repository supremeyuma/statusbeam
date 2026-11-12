# ADR 002 — SSE instead of WebSocket for status updates

**Status:** accepted · **Date:** 2026-11-12

## Context

The public page needs one-way, low-latency status changes: incident opened/updated/resolved
and per-monitor check summaries. Browsers are the only consumers.

## Decision

Use Server-Sent Events:

- `GET /v1/projects/:slug/stream` (public) sends a `snapshot` event on connect, then
  `incident` and `check` events.
- Events are published to Redis pub/sub `status:<projectId>` and appended to a capped stream
  `status:stream:<projectId>` (MAXLEN ~1000) with a monotonic id.
- `Last-Event-ID` replays the stream after the cursor, so a reconnect does not lose an
  incident change.
- A `: ping` comment every 15s keeps proxies from closing idle connections.
- Backpressure: if `res.write()` returns false, check events are dropped (they are
  reconstructible from the next snapshot) while incident events are buffered. If the buffer
  exceeds 1,000 incidents the connection is closed so the client reconnects and replays.

## Consequences

- Native reconnect/backoff in `EventSource`; no client protocol library.
- HTTP/2-friendly and proxy-friendly; no upgrade handshake.
- One-way only. Dashboard actions continue to use typed REST calls.
- Slow clients can accumulate incident buffers; the cap converts that into a reconnect rather
  than unbounded memory.
- Fan-out is one Redis subscription per connected client. At high traffic, a dedicated fan-out
  service or shared subscription per instance is the next step.

## Alternatives rejected

- **WebSocket** — bidirectional capability unused, more reconnect/proxy complexity.
- **Polling** — simpler, but the product promise is live updates and the Playwright test
  asserts the flip.
