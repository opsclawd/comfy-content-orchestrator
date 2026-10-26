# H3 Operator Acceptance Campaign — Runbook (#373, feeding #354 / #332)

This is the procedure a human operator with physical RTX 4090 / ComfyUI access follows to
run the representative acceptance campaign and record real evidence. Nothing in this runbook
can be executed by an autonomous agent — every step after "Preflight" requires the physical
render host.

See `docs/h3-acceptance-campaign.md` for the fixture definition this runbook drives.

## 0. Prerequisites

- Render host reachable with ComfyUI pinned at the commit in `.comfyui-version`
  (`55b6a9b11dffecdd65a3ccd5eb6a1b3a178c96dc`) and MiniMax-H3 weights verified via
  `./scripts/check-minimax-h3-version.sh`.
- Control-plane (`control-api`, Postgres, MinIO/S3) reachable from wherever you run the CLI.
- `DATABASE_URL`, `S3_STORAGE_ENDPOINT`, `AWS_ACCESS_KEY_ID`, `AWS_SECRET_ACCESS_KEY` exported
  in your shell (see `.env.example` for the documented meaning of each).

## 1. Preflight (GPU-free)

```bash
pnpm acceptance:preflight
```

Confirms, without touching the GPU:
- The representative campaign fixture's coverage is internally consistent
  (`verifyAcceptanceCoverage`).
- The two MiniMax-H3 render profiles (`minimax-h3-720p-124f-ref2v`,
  `minimax-h3-720p-124f-i2v`) are present in `templates/provenance.json` with the expected
  identity and workflow hash.
- Both evidence templates under `docs/evidence/` still contain only `TBD-OPERATOR`
  sentinels.
- The database and object storage are reachable (read-only).

Do not proceed until `readyForOperatorHandoff: true`. If it is `false`, read the per-check
`errors`/`issues` arrays in the printed JSON report before continuing.

## 2. Install the representative campaign

```bash
pnpm acceptance:install
```

By default this targets the fixed `ACCEPTANCE_CLIENT_ID` / `ACCEPTANCE_CAMPAIGN_IDEMPOTENCY_KEY`
constants (`packages/contracts/src/acceptance-campaign.ts`), so no operator bookkeeping is
required — the same command always resolves the same reconstructable fixture campaign.
`--client-id <uuid>` / `--idempotency-key <uuid>` remain available to target a different
non-production client. This is idempotent: re-running with the same idempotency key converges
on the existing campaign shell and existing scenes (looked up by their fixed `sequenceIndex`)
rather than creating duplicates. It creates:
- 1 campaign shell (`ACCEPTANCE-H3-REPRESENTATIVE-V1`, 9 scenes).
- 5 reference-asset library rows (subject/product/location/style/composition), uploaded from
  the real, read-only files under `certification/minimax-h3/minimax-ref2v-visual-qa-001/`.
- 9 scenes, 8 in `reference_directed` mode and 1 (`frame_anchored_continuity`) in
  `frame_anchored` mode.

Record the printed `campaignId` — you will need it in the control-plane UI to select ShotPlans,
approve them, and dispatch production for each scene, exactly as you would for any other
campaign. ShotPlan authoring, selection, and approval are NOT automated by this fixture — they
remain your normal director workflow.

## 3. Run the campaign on the render host

For each of the 9 scenes:
1. Author/select and approve a ShotPlan via the normal review flow.
2. Dispatch production (approving all 9 scenes atomically creates the campaign production run).
3. Let the render worker process each scene's production job on the RTX 4090 host.
4. Review each `ProductionAttempt` in the `qa` gate; `production_accept` or
   `production_rerender` as needed.

## 4. Fill in the evidence templates

As each scene is reviewed, fill in the corresponding row(s) of:
- `docs/evidence/h3-acceptance-storyboard-readability-evidence-template.md` (#354,
  requirements R01-R09) — readability judgments made during storyboard/previs review.
- `docs/evidence/h3-acceptance-multiscene-evidence-template.md` (#332, requirements
  R10-R21) — final production acceptance per scene, plus the assembled delivery reel.

Replace `TBD-OPERATOR` cells with real values as you go. Do not fill in a cell before you have
actually observed the thing it records — these templates are the audit trail, not a checklist
to pre-complete.

## 5. Sign off

Once all 21 coverage requirements have a recorded verdict and the final delivery reel has been
watched/downloaded by the director, fill in the "Overall verdict" section of both templates
with your name and a timestamp.

## 6. Variable-Duration Candidate Staging Procedure (#425)

For testing and qualifying candidate variable-duration MiniMax-H3 profiles (e.g., 8s / 192f or 10s / 243f):

### Prerequisites
1. Signed #445 decision matrix (`H3CapabilityMatrixEnvelope`) containing speed, quality, and overall `pass` verdicts for the candidate specification.
2. Signed operator authorization grant (`H3CandidateAuthorizationGrant`) binding:
   - Target candidate key and specification digest
   - Executing host name and GPU UUID
   - Valid temporal window (`[issuedAt, expiresAt]`)
   - Signature verifiable via deployment operator public key store
3. Staging-enabled render worker running with `WORKER_ALLOWED_EXECUTION_SCOPES=staging,production`.

### Staging Dispatch Command

```bash
pnpm --filter render-worker stage -- \
  --scene-id "<scene-uuid>" \
  --candidate-profile-key "<candidate-profile-key>" \
  --grant-path "/path/to/signed-grant.json" \
  --database-url "$DATABASE_URL"
```

### Safety and Isolation Invariants
- **General Production Disabled**: Candidate profiles cannot be dispatched through ordinary production queues. The worker preflight gate and queue claim policies strictly reject candidate jobs outside `executionScope: "staging"`. General production release remains gated by #428.
- **Fail-Closed Routing Checks**:
  - Ref2V shot plans cannot inherit I2V candidate eligibility.
  - Known creative failures (such as #423's 362f unoptimized I2V variant) reject before GPU dispatch.
  - Workflows attempting silent fallback to dense/standard attention or mismatched Turbo LoRAs reject with `CandidateExecutionMismatchError`.
- **Post-Render CFR & Duration Validation**: Probed video frame rate must be constant (CFR). Measured duration must not deviate from nominal duration by more than 355ms.

### Staging Denial Diagnostics

When a staging render fails preflight or execution, review the error message:

| Error Message / Blocker | Cause | Resolution |
|---|---|---|
| `Detected silent dense-attention fallback` | Candidate requires optimized attention (e.g. `flash_attn`), but workflow node configured `standard` or `dense` attention. | Set workflow node `attention_backend` to match candidate specification and ensure `fail_on_fallback` is enabled. |
| `Unknown effective attention backend: ...` | Python environment does not have the required attention kernel installed or importable. | Run check script and verify venv has the pinned custom-node packages. |
| `Ref2VA Turbo LoRA is strictly restricted to Ref2V route` | Workflow wired Ref2VA LoRA on an I2V candidate profile. | Use `minimax_h3_fl2va_turbo_8step.safetensors` for I2V or `"none"`. |
| `Attention package version mismatch` | Environment package version does not match candidate specification. | Align package version with `.minimax-h3-version` / candidate spec. |
| `Process continuity check failed: start-time ticks changed` | ComfyUI process restarted or died during preflight evaluation. | Verify ComfyUI daemon stability and restart staging run. |
| `Candidate authorization denied: OPERATOR_KEY_REVOKED` | Staging grant was signed by a key that is revoked or not in the trust store. | Issue a new grant signed by an authorized operator key. |
| `Probed output duration ... diverges from nominal duration beyond tolerance` | ComfyUI output length diverged from configured frame count. | Check scheduler step count, denoise, and latent frame count inputs. |

### Staging Rollback & State Recovery Procedure

If an operator aborts a candidate staging run or encounters fatal execution errors:

1. **Revert Worker Allowed Scopes**:
   Ensure staging scope is revoked from worker runtime:
   ```bash
   export WORKER_ALLOWED_EXECUTION_SCOPES=production
   ```
2. **Quarantine or Cancel Pending Staging Jobs**:
   ```sql
   UPDATE render_jobs
   SET status = 'failed', error_trace = 'Aborted by operator rollback'
   WHERE execution_scope = 'staging' AND status IN ('queued', 'rendering');
   ```
3. **Recover Scene Status**:
   If the scene status moved to `queued`, revert it back to `approved` to allow ordinary production dispatch:
   ```sql
   UPDATE scenes
   SET status = 'approved'
   WHERE id = '<scene-uuid>' AND status = 'queued';
   ```
4. **Clean Up Temporary Staging Directory**:
   Remove any staged candidate reference frames:
   ```bash
   rm -f "$CCO_COMFYUI_DIR/input/stage_"*
   ```

### Variable-Duration Release Gate (#428)

Issue #427 establishes automated CI simulation and software regression coverage across duration allocation, staging acceptance dispatch, worker assembly, and accepted reel readback (`docs/h3-variable-duration-ci-coverage.md`).

However, **CI simulation is not GPU certification**:
- The public UI and production release reader (`ProductionReleaseCapabilityReader`) strictly withhold advertising variable-duration candidate lengths (e.g. 243f, 362f) from general production until the operator physical campaign is executed on the RTX 4090 host.
- Only upon successful execution of this runbook with zero unmitigated visual defects (blackouts, limb corruption) may the operator promote candidate profiles into the production release catalog under issue #428.

## Open baseline questions

(Populate this section only if the physical campaign surfaces a defect in H3 dispatch,
RenderProfile semantics, ComfyUI workflow topology, ShotPlan routing, or the production
review/assembly state machine. Do not fix those files from this runbook — file a separate
issue and link it here.)

- None recorded as of the #373 preparation pass.
