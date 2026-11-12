# Security notes

## Authentication

- Passwords: Argon2id (`@node-rs/argon2`, 19 MiB, t=2, p=1), minimum 12 characters. No breached
  password list — documented as out of scope.
- Access token: HS256 JWT, 15 minutes, issuer/audience checked with `jose`.
- Refresh token: 48 random bytes, SHA-256 hashed at rest, 30-day expiry, rotated on every
  refresh. Reuse of a rotated token revokes the whole family and returns 401.
- Cookie: `HttpOnly; SameSite=Strict; Secure` in production; path `/v1/auth`.
- Login is throttled to 5 attempts/minute/IP; the 6th returns 429.

## API keys

- Format `sb_live_<32 random bytes base64url>`; only a SHA-256 hash and a short prefix are
  stored. The secret is returned once at creation.
- Scopes: `monitors:read`, `monitors:write`, `incidents:write`, `status:read`. Route metadata
  is enforced by the authorization guard; JWT users have full access to their own projects.
- Keys are bound to one project; cross-project access returns 403/404.
- `last_used_at` is written at most once per minute to avoid a write per request.
- Revocation is immediate (`revoked_at` checked on every request).

## SSRF

- HTTP: only `http:`/`https:`, no URL credentials; TCP: host + port.
- Hosts are resolved with `dns.lookup({all:true})` and every address is checked against
  loopback, RFC1918, link-local, CGNAT, multicast, documentation, and reserved ranges.
  IPv4-mapped IPv6 is unwrapped.
- Validation runs on create and immediately before each check. DNS rebinding remains a TOCTOU
  race (see `docs/failure-modes.md`).
- `ALLOW_PRIVATE_TARGETS=true` is for dev/test only and is called out in `.env.example`.

## Public surface

- `GET /v1/projects/:slug/status` and `/stream` are unauthenticated but only expose an
  allowlisted shape: project name/slug, monitor name/type/current status/last check, 90-day
  uptime buckets, incident status/cause. Monitor configs, URLs, headers, channel config, and
  secrets are never serialised.
- Response headers: `Cache-Control: public, max-age=10`, `ETag`; `If-None-Match` → 304.
- Rate limit 60/min/IP. Throttling is in-memory per API instance; a shared Redis limiter is the
  next step for multi-instance deployments.
- SSE filters the same allowlist and trims the event stream to ~1,000 entries.

## Channels and logs

- Webhook payloads are signed with `X-StatusBeam-Signature: t=<unix>,v1=<hmac-sha256>` over
  `${t}.${body}`.
- Channel responses redact webhook `secret` and Slack `webhookUrl`.
- Pino redacts `authorization`, `cookie`, `x-api-key`, and `set-cookie` headers. Error envelopes
  contain `requestId` but not stack traces.
- API keys, refresh tokens, and secrets are never written to the repository; `.env` is
  gitignored and `.env.example` contains placeholders only.

## Known gaps

- No CSRF token on refresh/logout; `SameSite=Strict` plus JSON-only endpoints is the current
  mitigation.
- Throttling is per process, not distributed.
- No audit log for key creation/revocation.
- No per-project quotas on monitors/checks.
