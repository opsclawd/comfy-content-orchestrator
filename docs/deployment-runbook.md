# Deployment Runbook

Operational procedure for redeploying the control-plane and standing up a render-worker host. Written after the first real end-to-end run (2026-09-04) surfaced that neither procedure was documented anywhere — both had to be reverse-engineered from `.github/workflows/ci.yml` and source. No real credentials or IP addresses are recorded here; see "Where to find real values" at the end.

## Topology

- **Control-plane** (Hetzner CPX31, tailnet name `ubuntu-8gb-nbg1-1`): runs `control-api`, `review-hub`, `postgres`, `minio` via Docker Compose (`compose.yaml`). Deployed from `/opt/comfy-content-orchestrator` as `root`. Every tailnet-facing port is bound to the tailnet IP specifically, not `0.0.0.0`/`localhost` — this is intentional (zero public exposure), so health checks and API calls from the host itself must target the tailnet IP, not `localhost`. SSH is reachable on the **public** IP only (a deliberate exception, used as the Gate 1 zero-public-exposure audit's own "control" case to prove the probe methodology) — the tailnet hostname/IP does not accept SSH.
- **Render-worker** (bare-metal RTX 4090 host, tailnet name `llama-server`): runs ComfyUI (`~/ComfyUI/venv/bin/python main.py --listen 0.0.0.0 --port 8188`) and the render-worker daemon (`apps/render-worker`), checked out separately at `~/comfy-content-orchestrator`. No Docker — plain systemd.

## Redeploying the control-plane

Real production redeploy — do this deliberately, not casually. Confirm the target commit and check `git status`/`git log origin/main..HEAD` before resetting, in case there's local-only work (there was, once — two commits that turned out to already be merged upstream under different hashes from a squash-merge; verified via `git diff <local-commit> origin/main -- <touched-paths>` before discarding).

```bash
cd /opt/comfy-content-orchestrator
git fetch origin main
git log origin/main..HEAD --oneline   # confirm nothing local-only and unmerged
git checkout main
git reset --hard origin/main

# Rebuild both images exactly as CI does (see ci.yml's "Warm Docker build cache" steps)
docker build -t cco-control-api:latest -f apps/control-api/Dockerfile .
docker build -t cco-web:latest -f apps/web/Dockerfile .

# Run migrations against the real production Postgres BEFORE restarting services
docker compose run --rm migrate

# Restart with the new images
docker compose up -d control-api review-hub
```

Verify:
```bash
curl -sS http://<tailnet-ip>:3000/api/health
```

**Gotcha**: `.env` on this host can lag behind `.env.example` — new required variables land in `.env.example` as the codebase evolves, but nobody automatically syncs them into the real deployed `.env`. `docker compose config --quiet` will fail loudly naming the missing variable if this happens; check `.env.example` for the documented value/meaning before adding it.

## Standing up a render-worker host

```bash
cd ~/comfy-content-orchestrator
git fetch origin main && git reset --hard origin/main   # same staleness caveat as above
pnpm install --frozen-lockfile
pnpm -r build
```

Write `.env` (see `.env.example`'s "Render Worker Daemon Configuration" section for the full variable list). Two things `.env.example` doesn't make obvious:

- `CONTROL_API_URL` must be the control-plane's **tailnet** hostname/IP (`http://<tailnet-ip-or-hostname>:3000`), not the Docker-internal `control-api:3000` value that appears in the control-plane's own `.env` — the worker isn't in that Docker network.
- `S3_STORAGE_ENDPOINT` similarly must be the tailnet-reachable endpoint. The control-plane's own `.env` has `S3_STORAGE_ENDPOINT=http://minio:9000` (Docker-internal) — use its `S3_SIGNING_ENDPOINT` value instead (`http://<tailnet-ip>:9000`), the same one browsers use for presigned URLs.
- `COMFYUI_DIR` must point at the real ComfyUI checkout path on that specific host (varies per host — check `ps aux | grep ComfyUI` if unsure).
- `STORAGE_TELEMETRY_PATH`'s directory must exist before the worker starts — nothing creates it automatically. `mkdir -p` it first (a job will otherwise render successfully and then fail at the final write-side storage-admission check with `HostFsStorageTelemetryError: ENOENT`).
- `GOLD_MASTER_PROVENANCE_PATH` is a real gap — see "Certification provenance format" below before assuming a value works.

Run as a systemd service rather than ad-hoc (survives reboots/disconnects):

```ini
# /etc/systemd/system/cco-render-worker.service
[Unit]
Description=Comfy Content Orchestrator - Render Worker Daemon
After=network-online.target
Wants=network-online.target

[Service]
Type=simple
User=<host user>
WorkingDirectory=<repo checkout path>
EnvironmentFile=<repo checkout path>/.env
ExecStart=<absolute path to node> apps/render-worker/dist/cli/run-worker.js
Restart=on-failure
RestartSec=5
StandardOutput=journal
StandardError=journal
SyslogIdentifier=cco-render-worker

[Install]
WantedBy=multi-user.target
```

```bash
sudo systemctl daemon-reload
sudo systemctl enable --now cco-render-worker.service
sudo journalctl -u cco-render-worker.service -f
```

Sanity-check config parsing before starting the service for real, since a bad `.env` fails fast and clearly:
```bash
node --env-file=.env -e '
const { parseWorkerRuntimeConfig } = require("./apps/render-worker/dist/cli/run-worker.js");
try { parseWorkerRuntimeConfig(process.env); console.log("CONFIG OK"); }
catch (e) { console.log("CONFIG ERROR:", e.message); }
'
```

## Certification provenance format (a real, unresolved gap)

`GOLD_MASTER_PROVENANCE_PATH` (and `certify.ts`'s `--gold-master-provenance` flag) expects a specific flat JSON shape:

```json
{
  "version": 1,
  "profileId": "<profile id, e.g. flux-schnell-draft>",
  "workflow": {
    "sha256": "<workflow hash>",
    "source": { "kind": "validated_host_export", "revision": "<comfyui commit>", "uri": "...", "license": "..." }
  },
  "renderProfileProvenance": {
    "key": "<RenderProfile key, e.g. FLUX_SCHNELL_DRAFT_V1>",
    "version": 1,
    "engine": "...",
    "frames": 0,
    "steps": 0,
    "workflowHash": "<same as workflow.sha256>",
    "modelHashes": { "models/...": "<sha256>", "...": "..." }
  }
}
```

As of 2026-09-04, **no file in this shape existed anywhere in the repo**, for any profile — this is a genuine gap, not something that was ever wired up and later lost. A real certification run's own `result.json` (e.g. `certification/flux-schnell/flux-schnell-cert-run-001/result.json`) has all the same underlying data, but nested completely differently (`identity.profileId`, `identity.workflowSha256`, `identity.modelSha256`, no `workflow`/`renderProfileProvenance` keys at all) — it is NOT directly usable as `GOLD_MASTER_PROVENANCE_PATH`. See `certification/flux-schnell/approved-provenance.json` for a real example, hand-reshaped from `flux-schnell-cert-run-001`'s genuinely-passed result. Track the actual fix (`certify.ts` should write this file automatically on a passing run) via #176.

## Where to find real values

Real credentials and IPs are deliberately not recorded in this file. As of 2026-09-04:
- Control-plane `.env` (real S3/DB credentials): `/opt/comfy-content-orchestrator/.env` on the control-plane host itself.
- SSH access to the control-plane: public IP + a dedicated key (ask whoever manages `~/.ssh/hetzner/` on the relay/orchestration machine) — the tailnet hostname does not accept SSH.
- SSH access to the render-worker host: reachable directly over Tailscale.

## Related issues

- #175 — the `generating_candidates -> director_review` transition is not yet wired up; a director can currently see real generated candidates via the API but can't act on them (this is the last blocker after a successful worker run).
- #176 — automate generating the certification provenance file described above.
