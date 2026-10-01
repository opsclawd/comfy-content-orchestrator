# H3 Operator Acceptance Campaign — Preparation (#373)

Preparation-only tooling for the future GPU-based H3 operator acceptance campaign described
in #354 (storyboard readability) and #332 (final H3 multi-scene acceptance). This document
describes the fixture, the GPU-free preflight check, the evidence templates, and the
human-operator runbook built in issue #373.

**What this issue is not**: it does not run the physical acceptance campaign, does not
produce certification evidence, and does not create a real `ProductionAttempt`,
`GenerationManifest`, `ShotPlan` content/approval, or accepted output. All of that remains
exclusively a human-operator action on the real RTX 4090 render host, exactly as `AGENTS.md`
requires ("Evidence paths are never agent-authored").

## Why a representative fixture

#332 asks for "final H3 multi-scene acceptance" and #354 asks for "storyboard readability"
review across a representative set of framing/camera/subject cases. Rather than leaving the
operator to invent scenes and reference assets from scratch on the day of the campaign, this
issue defines:

1. A deterministic, versioned **campaign fixture** (`ACCEPTANCE-H3-REPRESENTATIVE-V1`,
   `packages/contracts/src/acceptance-campaign.ts`) covering 9 representative scene cases and
   27 coverage requirements (`R01`-`R27`) traced back to #354/#332.
2. An **install** flow (`InstallAcceptanceCampaignFixtureUseCase`) that creates the campaign
   shell, its 9 scenes, and the reference-asset library rows needed to exercise the fixture —
   composed entirely from existing, already-reviewed use cases
   (`CreateCampaignShellUseCase`, `CreateSceneUseCase`, `UploadReferenceAssetUseCase`).
3. A **preflight** flow (`EvaluateAcceptancePreflightUseCase`) that answers, without a GPU:
   "is everything this campaign depends on internally consistent and reachable?"
4. Two **empty evidence templates** the operator fills in by hand during/after the real run.
5. An **operator runbook** (`docs/h3-acceptance-operator-runbook.md`) describing exactly what
   to do on the render host.

## Fixture identity

- Fixture ID: `ACCEPTANCE-H3-REPRESENTATIVE-V1`, version `1`.
- Source root: `certification/minimax-h3/minimax-ref2v-visual-qa-001/` — a forbidden-write
  path for agents. Every asset slot below is a **read-only, hash-pinned reference** to a file
  that already exists in that directory; nothing is copied, rewritten, or re-derived.

### Asset slots (6 required + 1 optional)

| Slot | Kind | Role | Source file | Required |
| --- | --- | --- | --- | --- |
| `subjectIdentityReference` | reference_role | `subject_identity` | `reference-images/trinidad_subject.jpg` | yes |
| `productReference` | reference_role | `product` | `reference-images/trinidad_product.jpg` | yes |
| `locationReference` | reference_role | `location` | `reference-images/trinidad_location.jpg` | yes |
| `styleReference` | reference_role | `style` | `reference-images/trinidad_style.jpg` | yes |
| `compositionReference` | reference_role | `composition` | `wide-shot-frame.png` | yes |
| `frameAnchorStart` | frame_anchor | — | `output-frame.png` | yes |
| `frameAnchorEnd` | frame_anchor | — | `wide-shot-frame.png` | no |

`compositionReference` and `frameAnchorEnd` intentionally reuse the same real
`wide-shot-frame.png` bytes for two distinct, documented purposes — this is deliberate reuse
of an already-approved still, not fabrication; both resolve to the identical sha256.

Each slot's sha256 is pinned in the contract and verified against the live file at install
time (`InstallAcceptanceCampaignFixtureUseCase` fails closed — `AcceptanceFixtureIntegrityError`
— if the live bytes ever drift from the pinned hash).

### Representative scenes (9)

| # | Case | Routing mode | Engine profile | Camera movement | Lighting style | Environment |
| --- | --- | --- | --- | --- | --- | --- |
| 1 | `wide_establishing` | reference_directed | `MINIMAX_H3_720P_5S_REF2V_V1` | static | natural_golden_hour | outdoor |
| 2 | `medium_two_shot` | reference_directed | `MINIMAX_H3_720P_5S_REF2V_V1` | dolly_in | practical_interior | indoor |
| 3 | `closeup_dialogue` | reference_directed | `MINIMAX_H3_720P_5S_REF2V_V1` | static | high_key_commercial | indoor |
| 4 | `low_angle_hero` | reference_directed | `MINIMAX_H3_720P_5S_REF2V_V1` | tracking | low_key_dramatic | outdoor |
| 5 | `high_angle_overview` | reference_directed | `MINIMAX_H3_720P_5S_REF2V_V1` | pan_left | overcast_diffused | outdoor |
| 6 | `subject_product_interaction` | reference_directed | `MINIMAX_H3_720P_5S_REF2V_V1` | tracking | softbox_studio | indoor |
| 7 | `multi_subject_ensemble` | reference_directed | `MINIMAX_H3_720P_5S_REF2V_V1` | static | high_key_commercial | indoor |
| 8 | `fg_bg_depth_layering` | reference_directed | `MINIMAX_H3_720P_5S_REF2V_V1` | dolly_out | natural_golden_hour | outdoor |
| 9 | `frame_anchored_continuity` | frame_anchored | `MINIMAX_H3_720P_5S_I2V_V1` | static | natural_golden_hour | outdoor |

Across the 9 scenes: `static` (1,3,7,9), `dolly_in`/`dolly_out` (2,8), `pan_left` (5), and
`tracking` (4,6) camera-movement intent are all exercised; both `indoor` (2,3,6,7) and
`outdoor` (1,4,5,8,9) environments are exercised; and both lighter/commercial
(`high_key_commercial`, `natural_golden_hour`) and darker/dramatic (`low_key_dramatic`)
lighting intent are exercised — satisfying the issue's "static camera; dolly/pan/tracking
intent; indoor and outdoor environments; lighter commercial and darker/dramatic lighting
intent" requirement.

Scene 9 is the sole `frame_anchored` case, conditioned (conceptually, for the operator) on
`frameAnchorStart`/`frameAnchorEnd` — this fixture does **not** create a ShotPlan or wire that
anchoring itself; ShotPlan compilation and anchoring remain entirely out of scope for #373 and
are left to the normal director/ShotPlan-compiler flow on the real campaign.

### Coverage requirements (R01-R27)

Source of truth: `ACCEPTANCE_COVERAGE_REQUIREMENTS` in
`packages/contracts/src/acceptance-campaign.ts`. `verifyAcceptanceCoverage()` is a pure
function asserting every requirement id below is covered by at least one scene, and that every
scene's referenced asset slots resolve to a declared slot. It is checked automatically both at
fixture-install time and at preflight time.

| ID | Source | Description |
| --- | --- | --- |
| R01 | #354 | Wide establishing shot framing is legible at target aspect ratio. |
| R02 | #354 | Medium two-shot keeps both subjects readable without cropping. |
| R03 | #354 | Close-up dialogue framing preserves facial continuity cues. |
| R04 | #354 | Low-angle hero framing does not clip the subject's silhouette. |
| R05 | #354 | High-angle overview framing preserves environment legibility. |
| R06 | #354 | Subject/product interaction keeps product branding readable. |
| R07 | #354 | Multi-subject ensemble framing avoids subject occlusion. |
| R08 | #354 | Foreground/background depth layering reads as intended at storyboard review time. |
| R09 | #354 | Frame-anchored scene storyboard previs matches the anchor image composition. |
| R10 | #332 | Reference-directed routing mode is exercised across the representative scene set. |
| R11 | #332 | Frame-anchored routing mode is exercised by at least one representative scene. |
| R12 | #332 | `subject_identity` reference role is bound and conditions at least one scene. |
| R13 | #332 | `product` reference role is bound and conditions at least one scene. |
| R14 | #332 | `location` reference role is bound and conditions at least one scene. |
| R15 | #332 | `style` reference role is bound and conditions at least one scene. |
| R16 | #332 | `composition` reference role is bound and conditions at least one scene. |
| R17 | #332 | Every representative scene declares an explicit ShotPlanRoutingMode. |
| R18 | #332 | Campaign-level scene count matches the declared representative scene catalog. |
| R19 | #332 | Every asset slot referenced by a scene resolves to a hash-pinned, read-only fixture file. |
| R20 | #332 | Multi-scene acceptance run covers low-angle and high-angle camera variation. |
| R21 | #332 | Multi-scene acceptance run covers at least one multi-subject and one fg/bg depth case. |
| R22 | #332 | Static camera intent is exercised by at least one representative scene. |
| R23 | #332 | Dolly, pan, and tracking camera movement intent are each exercised by at least one representative scene. |
| R24 | #332 | Indoor environment intent is exercised by at least one representative scene. |
| R25 | #332 | Outdoor environment intent is exercised by at least one representative scene. |
| R26 | #332 | Lighter/commercial lighting intent is exercised by at least one representative scene. |
| R27 | #332 | Darker/dramatic lighting intent is exercised by at least one representative scene. |

## Install flow

```bash
pnpm acceptance:install
```

By default this installs against the fixed, synthetic `ACCEPTANCE_CLIENT_ID` and
`ACCEPTANCE_CAMPAIGN_IDEMPOTENCY_KEY` constants declared in
`packages/contracts/src/acceptance-campaign.ts`, so the campaign is reconstructable without any
operator bookkeeping — re-running the same command always resolves the same campaign shell.
`--client-id <uuid>` / `--idempotency-key <uuid>` remain available to target a different
non-production client, but are not required for the default path.

Creates (or idempotently replays) the campaign shell, uploads the 5 `reference_role` asset
slots into the reference-asset library, and creates the 9 scenes with their reference
bindings. A second install against the same idempotency key converges: it looks up each
scene by its fixed `sequenceIndex` and skips creating one that already exists, so re-running
install never duplicates scenes. Frame-anchor slots are **not** uploaded as reference-role
library assets (there is no reference role that fits a pure anchor frame) — see
`InstallAcceptanceCampaignFixtureUseCase`'s doc comment for the full rationale.

This flow never creates a `ShotPlan`, `StoryboardCandidate`, `ProductionAttempt`, or
`GenerationManifest` — verified automatically by a static source-scan unit test
(`acceptance-gpu-isolation.test.ts`).

## Preflight flow

```bash
pnpm acceptance:preflight
```

Runs six GPU-free, read-only checks and reports `readyForOperatorHandoff`:

1. **Coverage** — pure in-memory `verifyAcceptanceCoverage()`.
2. **Profile identity** — reads `templates/provenance.json` and hashes the
   `minimax-h3-720p-124f-ref2v` / `minimax-h3-720p-124f-i2v` workflow JSON files, confirming
   they match the manifest's pinned `expectedWorkflowHash` and `renderProfileIdentity`. No
   ComfyUI process is started.
3. **Evidence templates** — confirms both evidence templates exist and contain only
   `TBD-OPERATOR` sentinel values.
4. **Database / object storage reachability** — a read-only `SELECT 1` and `HeadBucket`.
5. **Fixture assets** — reads every pinned asset slot's live bytes (via the same read-only
   `AcceptanceFixtureAssetSourcePort` the installer uses) and confirms the sha256 of every
   *required* slot matches the pinned hash, catching a missing or drifted fixture file before
   any install is attempted.
6. **Campaign ledger** — looks up the fixture campaign by `ACCEPTANCE_CAMPAIGN_IDEMPOTENCY_KEY`
   and, if installed, confirms exactly the expected number of scenes exist (catching
   duplicate-scene regressions) and that zero rows exist across the production ledgers
   (`shot_plans`, `storyboard_candidates`, `review_events`, `campaign_production_runs`) for
   those scenes — i.e. preparation tooling has fabricated no ShotPlan, candidate, review
   event, or production run. If the campaign has not yet been installed this check reports
   `ok: true` with `installed: false` rather than a blocker.

`readyForOperatorHandoff: true` means the preparation tooling is internally consistent and
infrastructure is reachable — it does **not** mean the campaign has been run or that any
certification evidence exists.

## Evidence templates

- `docs/evidence/h3-acceptance-storyboard-readability-evidence-template.md` (#354)
- `docs/evidence/h3-acceptance-multiscene-evidence-template.md` (#332)

Both contain only `TBD-OPERATOR` placeholders. An automated test
(`fs-evidence-template-probe.test.ts` + the preflight's evidence-template probe) fails if
either template is ever found pre-filled.

## Operator runbook

See `docs/h3-acceptance-operator-runbook.md` for the step-by-step procedure a human operator
with RTX 4090 access follows to actually run the campaign and fill in the evidence templates.

## Open baseline questions

None identified that require a change to H3 dispatch/compiler, RenderProfile semantics,
ComfyUI workflow topology, ShotPlan routing, or the production review/assembly state machine.
If a future preflight run surfaces a defect in one of those areas, record it here rather than
modifying those files from this preparation tooling.
