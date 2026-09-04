# 3. Review Hub Terminates Tailscale Device Identity via whois

Date: 2026-09-04

## Status

Accepted (Amends ADR-0002)

## Context

ADR-0002 established that Tailscale device identity is the Review Hub authentication boundary, with `TailscaleReviewerIdentityResolver` (`apps/control-api/src/http/reviewer-identity.ts`) acting as the single source of reviewer identity for all audit-bearing actions. Under ADR-0002's original description, incoming traffic was expected to pass through Tailscale Serve or Funnel, which would inject `tailscale-user-login` and `tailscale-user-name` headers before proxying to the application.

In the actual deployed topology:
1. Browser clients connect directly to `review-hub` (`apps/web`) over the Tailscale network mesh on port 3001 (`TAILNET_IP`). Tailscale Serve is not configured in front of `review-hub` or `control-api`.
2. `review-hub` executes review commands server-side by issuing HTTP POST requests to `control-api` over the internal Docker bridge network (`control-plane`).
3. Because Tailscale Serve was absent, no `tailscale-user-*` headers were ever injected, and `control-api` rejected every review action with HTTP 401 `AUTHENTICATION_REQUIRED`.
4. Bypassing identity verification with `CONTROL_API_REVIEWER_IDENTITY_FALLBACK` is strictly forbidden in production (`NODE_ENV=production`) to preserve audit trail integrity.

ADR-0002 noted that any non-Tailscale proxy fronting `control-api` must strip or overwrite any incoming `tailscale-user-*` headers before forwarding to ensure clients cannot forge identities.

## Decision

We amend ADR-0002 to place the Tailscale identity termination point inside `review-hub`:

1. **Identity Provenance & Trust Boundary**:
   - Reviewer identity remains exclusively Tailscale-device-derived and never client-supplied.
   - `review-hub` is assigned a fixed IPv4 address `172.28.0.10` on the `control-plane` bridge network (`172.28.0.0/24`) in `compose.yaml`.
   - `control-api` configures `CONTROL_API_TRUSTED_IDENTITY_PROXY_ADDRESSES=172.28.0.10`.
   - `.env.example` defines `CONTROL_API_URL=http://control-api:3000` (Docker-internal default consumed by `review-hub`), while render-worker hosts continue to override `CONTROL_API_URL` to the tailnet address as documented in `docs/deployment-runbook.md`.

2. **TCP Termination via `peer-proxy.mjs`**:
   - Inside the `review-hub` container, a dedicated reverse proxy (`apps/web/peer-proxy.mjs`) binds to `0.0.0.0:${PORT:-3000}`.
   - It captures the true connecting peer IP address directly from the incoming TCP socket (`req.socket.remoteAddress`).
   - It enforces a delete-then-set discipline on the `x-cco-tailscale-peer-ip` header: any incoming client-supplied value is unconditionally removed and replaced with the normalized IP literal.
   - It spawns the Next.js standalone server (`apps/web/server.js`) on pinned internal port `127.0.0.1:3100`.
   - Liveness and error handling:
     - Maintains a `childReady` status, responding with 503 `Service Unavailable` (`Retry-After: 1`) during startup until port 3100 accepts connections (bounded by a 10s timeout).
     - Attaches an `error` listener to the `http-proxy` instance that catches connection aborts and backend resets, returning 502 or destroying dead sockets to prevent unhandled `'error'` events from crashing the process.
     - Automatically terminates if the child Next.js process exits, allowing Docker Compose (`restart: unless-stopped`) to recover the container.
     - Exposes a dedicated health check endpoint at `/api/healthz` that reports Next.js serving health independently of Tailscale socket state.

3. **Per-Request `tailscale whois` Identity Resolution**:
   - `review-hub` queries the local `tailscaled` daemon over Unix domain socket `/var/run/tailscale/tailscaled.sock` via `tailscale whois --json <peer-ip>`.
   - `resolveReviewerIdentity()` validates that `UserProfile.LoginName` is present, non-empty, and ≤128 characters. It optionally extracts `UserProfile.DisplayName` (≤128 characters).
   - If `whois` fails for any reason (missing socket, unresolvable peer IP, timeout, non-tailnet client), the route handler fails closed immediately with HTTP 401 `AUTHENTICATION_REQUIRED`, writing no review events and issuing no upstream requests to `control-api`.

4. **Hermetic Header Injection**:
   - `apps/web/src/api/client.ts` builds outgoing HTTP headers from scratch (`Content-Type`, `Accept`, `tailscale-user-login`, and optional `tailscale-user-name`).
   - It never spreads or forwards raw inbound request headers to `control-api`.
   - `TailscaleReviewerIdentityResolver` on `control-api` remains unchanged, validating that requests originate from `172.28.0.10` and trusting the server-constructed headers.

5. **Packaging & Image Artifacts**:
   - amd64 architecture is pinned (`linux/amd64`).
   - Tailscale CLI version is pinned in `.tailscale-version` with its SHA-256 hash committed in `.tailscale-checksums.txt`.
   - `apps/web/Dockerfile` verifies the checksum at build time, extracts `/usr/local/bin/tailscale`, and explicitly copies it into the runtime image stage (`COPY --from=builder /usr/local/bin/tailscale /usr/local/bin/tailscale`) with `0755` permissions for the unprivileged `node` user.
   - `peer-proxy.mjs` is bundled into `.next/standalone/apps/web/peer-proxy.mjs` via `esbuild`.

6. **Host Prerequisites & Diagnostic Separation**:
   - Host setup is codified in `scripts/prepare-tailscale-socket-access.sh`, enforcing group `tailscale-ro` (GID 9999) with bidirectional mapping verification, granting group read/write access to `/var/run/tailscale/tailscaled.sock`, and installing a systemd drop-in (`/etc/systemd/system/tailscaled.service.d/10-socket-permissions.conf`) to preserve socket permissions across tailscaled daemon restarts.
   - `compose.yaml` bind-mounts the parent directory `/var/run/tailscale:/var/run/tailscale` (avoiding binding to a replaceable socket inode across daemon unlinks/recreations) and sets `group_add: ["9999"]`.
   - Boot-time socket verification in `peer-proxy.mjs` is diagnostic-only (logs a warning and continues boot) so that image validation and non-review routes remain functional even if the host socket is unmounted.

7. **Acceptance Gate (External Operator Gate)**:
   - Automated test suites verify unit logic, syntax, image bundling, and fail-closed behaviors.
   - Verification against the live tailnet is an external gate requiring operator execution on the control-plane host:
     `docker compose exec -u node review-hub tailscale whois --json <real-tailnet-peer-ip>`
     followed by an end-to-end review command from an authenticated director device.

## Consequences

- Reviewer actions against `review-hub` now succeed for authenticated Tailscale users without phantom fallbacks.
- Audit trail integrity is preserved: `ReviewEvent.reviewer_name` reflects the verified Tailscale login of the connecting director.
- Client attempts to forge `tailscale-user-*` or `x-cco-tailscale-peer-ip` headers are stripped and rejected at two independent network boundaries.
