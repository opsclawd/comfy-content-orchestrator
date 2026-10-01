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

## Open baseline questions

(Populate this section only if the physical campaign surfaces a defect in H3 dispatch,
RenderProfile semantics, ComfyUI workflow topology, ShotPlan routing, or the production
review/assembly state machine. Do not fix those files from this runbook — file a separate
issue and link it here.)

- None recorded as of the #373 preparation pass.
