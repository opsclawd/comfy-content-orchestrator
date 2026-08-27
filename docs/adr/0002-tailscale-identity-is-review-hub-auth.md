# 2. Tailscale Device Identity Is the Review Hub Authentication Boundary

Date: 2026-08-27

## Status

Accepted

## Context

PRD §2.5 (rev 2026-08-26) flagged two unresolved capabilities required before the
Review Hub Browser Access Gate (§9.4) could pass: TLS for transport security,
and an open product decision about whether Tailscale device identity *is* the
authentication boundary or whether a separate session/login layer is also
required. The PRD explicitly warned that building both in parallel would
produce two conflicting sources of reviewer identity feeding the same audit
trail, and demanded the question be answered before implementation.

The codebase already had an answer in production: `TailscaleReviewerIdentityResolver`
(`apps/control-api/src/http/reviewer-identity.ts`, shipped via PR #80) is the
sole resolver wired into review-action endpoints. It reads `tailscale-user-login`
/ `tailscale-user-name` HTTP headers **only when** the request's source address
is in a configured `trustedProxies` allowlist (no trust-by-default), and fails
closed with `ReviewerIdentityUnavailableError` when identity cannot be resolved
or when no trusted-proxy path applies. The trust therefore transfers to whatever
front-ends the Control API on those addresses: in production this is Tailscale
itself (Tailscale Serve or the HTTPS funnel), which injects the headers based on
the authenticated Tailscale user.

Any non-Tailscale trusted proxy in front of the Control API **must** strip or
overwrite any incoming `tailscale-user-*` headers before forwarding; otherwise a
client reaching that proxy could supply the headers directly and the resolver,
seeing the proxy's source address as trusted, would treat those client-supplied
values as authoritative reviewer identity. This requirement is implicit in the
resolver's design but is not stated by the resolver itself — the ADR records it
explicitly so that any future operator introducing a reverse proxy between
Tailscale and the Control API is forced to confront it.

Issue #90's open question therefore had, in effect, been answered by the
shipping code. It remained "open" only because no document recorded the
decision explicitly. This ADR closes that gap.

## Decision

**Tailscale device identity is the Review Hub authentication boundary.
`TailscaleReviewerIdentityResolver` is the single source of reviewer identity
for all audit-bearing actions.** No separate username/password or session/login
layer will be built for the Review Hub.

Specifically:

- Reaching the Review Hub at all requires being an authorized device on the
  Tailscale tailnet (already enforced by §2.2's zero-public-exposure posture
  and the existing Tailscale perimeter).
- Reviewer identity is derived from `tailscale-user-login` /
  `tailscale-user-name` headers injected by Tailscale, never from browser
  input. This satisfies the "Server-Authoritative Reviewer Identity &
  Timestamp" invariant in `docs/CONTEXT.md`.
- A stolen or compromised device can be revoked at the Tailscale admin console
  without application changes; this is the operational lever for credential
  rotation.
- Shared devices equate to shared Tailscale human identity, and therefore to
  shared audit identity. This is acceptable for the current operating model
  (one human per device); if that assumption breaks, this ADR is the one to
  revisit.
- `CONTROL_API_REVIEWER_IDENTITY_FALLBACK` is **forbidden in production
  deployments**. The resolver already refuses to start when both
  `trustedProxies` and `fallbackIdentity` are configured
  (`apps/control-api/src/http/reviewer-identity.ts:111-119`), but a
  `fallbackIdentity`-only configuration is still accepted and silently
  attributes every request to the fallback identity — every `ReviewEvent`
  would carry a phantom reviewer. Production must configure neither env var,
  or both — never `fallbackIdentity` alone. (A runtime rejection keyed on
  `NODE_ENV=production` would convert this ADR constraint into a hard server
  refusal; tracked as a follow-up.)

What this decision explicitly does *not* change:

- TLS is still required for the Review Hub — it is the transport-security
  half of §2.5 and is tracked separately in issue #90 (rescoped to TLS-only).
- Worker authentication on `apps/control-api` job-dispatch endpoints remains
  out of scope per the Sprint 2.5 dispatch-contract design (see §"Worker
  authentication is deliberately not designed here" in
  `docs/superpowers/specs/2026-08-26-sprint-2-5-dispatch-contract-design.md`).
- `CONTROL_API_REVIEWER_IDENTITY_FALLBACK` remains supported for
  dev/test/CI environments where Tailscale is not fronting the Control API.

## Consequences

- Issue #90 is rescoped to TLS-only; the auth half is closed by this ADR.
- PRD §2.5's "open product decision" is removed; the section points here.
- `docs/sprint-2-deployment-acceptance.md` Gate 3 step 3 changes from
  "Log in / verify session authentication" to verifying that the reviewer
  identity surfaced in audit metadata matches the Tailscale user logged into
  the Creative Director's device.
- The deployment-acceptance runbook's hostnames (`review.godzspeed-internal.ts.net`
  et al.) are also updated to the real tailnet suffix `taild802ae.ts.net`
  per the decisions recorded in issue #87.
- Reviewer granularity is "Tailscale human on tailnet device," not "per
  browser session." Acceptable for the current operating model; the ADR
  records this as the trigger condition for revisiting.
- A future change to add session/login must amend or supersede this ADR
  before any code lands, per PRD §11's "Use ADRs for major decisions" rule.
- Any operator introducing a non-Tailscale reverse proxy in front of the
  Control API must add it to `CONTROL_API_TRUSTED_IDENTITY_PROXY_ADDRESSES`
  **only after** verifying the proxy strips or overwrites incoming
  `tailscale-user-*` headers. The deployment runbook should call this out at
  the point where the proxy is introduced (tracked as a follow-up).