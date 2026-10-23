You are performing a follow-up review of code changes made in response to earlier review findings.

## CONTEXT

## WORKSPACE CONSTRAINTS

Your working directory is a dedicated git worktree with the repository's complete history. Run all commands from it. Do NOT cd to or read paths outside this directory — external-directory access is automatically rejected. git log, git diff, etc. work here directly.

.ai-orchestrator.local.json, if one exists, lives only in the main checkout and is intentionally not copied into your worktree — it is operator-machine-specific and not part of your task. Do not search for it or read it outside this directory. Reason about configuration using only .ai-orchestrator.json in your own working directory; treat it as the effective config for your task.

Working directory: /home/gary/.openclaw/workspace/comfy-content-orchestrator/.ai-worktrees/issue-477
Issue number: 477

Issue description & acceptance criteria:
# [469 / VPM-P1.8] Add minimal verified-batch operator workspace and Phase 1 end-to-end evidence gate

Parent: #469 — Phase 1
Depends on: **#476** (dossier API, all Phase 1 storage/claims dependencies).
Classification: **Autonomous web/test implementation**, followed by **optional operator data-accuracy review**, no GPU certification. Do not mark real-world authenticity certified based on CI.

## Goal
Make Phase 1 usable in the existing private Review Hub for one real SKU/lot and provide a deterministic acceptance matrix proving the evidence/claim boundary. Prioritize legibility, corrections and provenance over polished marketing design.

## Scope
- Minimal client-scoped Product/Batches workspace (use established app routing): list SKU -> select lot -> inspect source evidence, original/derivative distinction, source status and dates -> view CoA measurements with units and lab/report attribution -> see claim status, supporting evidence and block reasons.
- Forms/controls for source operations supported by #476 (SKU/lot create, source evidence registration/upload/linking, CoA entry and report source association, claim propose/review/supersede). Ensure required facts, unknown/attested/verified status and review controls are visibly distinct.
- Display source SHA/date/type and immutable version/history safely, without surfacing filesystem paths, raw MinIO keys, unapproved thumbnails, or stale presigned URLs as permanent records.
- A concise 'batch dossier' inspection panel and reversible navigation; no magic auto-conversion of CoA values into consumer marketing copy.
- E2E fixtures and integration tests cover one complete synthetic batch with images/report; missing origin data; lot mismatch; wrong-client ID; source byte mismatch; archived/superseded CoA; decimal-unit ambiguity; source approval/claim invalidation; denied media read.
- Add release/runbook instructions for operator to create one non-public sample lot, compare CoA entries against the PDF manually, verify rights/capture metadata and confirm source retention plan. This real-data check is **operator judgment**, not autonomous/completed by CI.
- Update `docs/CONTEXT.md` and epic checklist only after passing acceptance.

## Acceptance
- From Review Hub, authorized operator creates SKU/lot, registers existing original photo and CoA, enters results, establishes/reviews a sourced claim, and sees an auditable dossier with working source inspection.
- User can tell, without reading a manifest, which data is **reported**, **operator-reviewed**, **independently sourced**, **unknown** or **blocked**; a missing original cannot be mistaken for a verified source.
- Nested client ownership is enforced by API, not only by hidden UI actions.
- Test suite proves stale source/scope conflicts block claim readiness and no unauthorized client can see a source.
- API, migration and UI tests pass in CI; no real cannabis/product photo/CoA and no private company records checked into public GitHub.
- Phase 1 completion **does not** certify compliance of any external distribution or generative fidelity; later phases stay gated.

## Non-goals
CoA card/video template, compositing/subject masking, public website, age gates, buyer portal, legal approval, OCR, model acceleration, ComfyUI hardware run.

## Execution
Read PRD, CONTEXT, #470 and child acceptance evidence. Autonomous PR must document tests; any real-document authenticity conclusion requires separate operator evidence.


Issue comments:


Design document:
# Design: private verified-batch operator workspace (#477)

## Outcome and authority

Add a minimal Product/Batches workspace to the existing Next.js Review Hub. An authorized operator can create a SKU and lot, register original photo/report bytes, transcribe a CoA, propose and link a claim, and have an authorized reviewer inspect and review it. A coherent dossier exposes exact supporting revisions, decisions and block reasons. Corrections create new revisions; neither transcription nor a successful test run establishes real-world authenticity.

The supplied #477 issue and acceptance criteria govern scope. The work is autonomous web/test implementation with a separate optional operator data-accuracy exercise. No public site, marketing template, OCR, automated copy generation, legal determination, rendering, GPU run or hardware certification is required. Future consumers may use existing pinned source/measurement contracts; implementing campaign template pinning, assembly admission or generative fidelity gates is outside this issue.

## Grounded baseline

- `AGENTS.md` requires architecture boundaries, the separate integration-test config, existing ordered validation tiers, and no agent-authored physical evidence under protected artifact directories. Only this worktree's `.ai-orchestrator.json` is considered.
- `docs/prd.md` sections 2.1–2.3 and 3.6 require private review access, ephemeral media delivery, contracts-only browser integration, server-resolved identities and version-fenced commands. ADR 0009 and `docs/verified-product-evidence-contract-fixtures.md` are the checked-in #470 design/acceptance artifacts (commit `120ac8d`, PR #478).
- History contains #471–#476 implementation commits, ending at `cca1807` (PR #486). #476 provides `apps/control-api/src/http/routes/product-evidence-routes.ts`, `packages/contracts/src/product-evidence-http.ts`, `packages/contracts/src/batch-evidence-dossier.ts`, application commands and PostgreSQL dossier queries. Reuse these rather than introducing a parallel product system.
- Existing control endpoints are `/api/v1/clients/:clientId/product-skus`, `/batches`, and batch-nested facts, evidence, derivative links, verification events, revision media, CoAs, claims and dossier. Evidence registration accepts multipart original bytes or JSON source-object reuse, with explicit create/link/supersede registration intent. CoA and claim correction/review routes already exist.
- `PostgresBatchEvidenceDossierQueries` reads a repeatable-read snapshot with claim resolutions, facts/evidence/report/claim histories and safe source projections. It bounds dossiers to 500 items and approximately 10 MiB; this one-lot workspace does not require a pagination redesign. Handle failures visibly.
- Review Hub currently has home, campaign and scene pages, reference-library UI and same-origin Next route handlers, but no Product/Batches workspace. `authorizeDirectorClientSession` resolves a trusted director, checks `REVIEW_HUB_DIRECTOR_CLIENT_MAPPINGS` and mints the scoped server-side bearer token. The existing global clients proxy does not itself filter clients by director authorization; it must not be assumed to be an authorized product client picker.
- Source media delivery checks batch linkage, tenant namespace, availability and existence, then returns a 300-second URL. This read is not a fresh SHA verification or authenticity check. Integrity checks at ingestion, verification and claim approval remain server responsibilities.
- `generateUuidV7` already exists in `packages/shared/src/product-identity.ts` and uses browser-compatible crypto. Use it for new evidence/CoA/claim command action IDs; the older web UUIDv4 helper does not meet their HTTP schemas.
- Existing tests include `product-evidence-flow.test.ts`, `product-evidence-flow.integration.test.ts`, dossier database tests and claim invalidation/concurrency tests. The Playwright harness uses PostgreSQL but currently has in-memory object storage, fake unreachable media URLs, one fixed actor, wildcard client mappings and no evidence dependencies. It needs explicit fixture wiring to prove a source inspection/review workflow.

## Design decisions

### 1. Routes, navigation and workspace

Use established App Router patterns. Add a Products/Batches entry at `/products`, an authorized client chooser, `/clients/[clientId]/products` for SKU list/selection and lot listing/creation, and `/clients/[clientId]/products/[skuId]/batches/[batchId]` for the dossier. These are proposed paths, with ordinary Next Link navigation, breadcrumbs and browser back/forward. Preserve selected SKU/lot in the URL; a deep link verifies the dossier's SKU belongs to the route. A mismatched SKU must not silently display another SKU's lot.

The chooser resolves identity on the server and filters the existing client listing using the existing mappings; scope this behavior to the new workspace unless a shared helper is appropriate. All data endpoints still enforce access independently. Prefer an authenticated same-origin initial load from a client shell (or an equivalent server loader with the same authorization) so no unauthenticated global server API helper is accidentally used. Render explicit loading, empty, forbidden/not-found, retry and failure states.

The lot page has four plainly labeled sections: batch facts, source evidence, CoA results and claims. A concise dossier summary shows client/SKU/lot, current versions, facts gaps, source availability and current claim block counts with links into details. Expandable histories stay close to the relevant record rather than requiring a manifest download. Source/report/claim support links open the exact pinned revision within the workspace and retain a return path. Use native controls, semantic tables, labels, keyboard navigation, visible focus, inline error messages and textual status badges; color alone cannot convey authority.

### 2. Provenance is multidimensional

Do not implement a single overall verified badge or infer status from an uploaded file. Display independently:

| User-facing label | Meaning and source |
| --- | --- |
| Reported | A transcribed CoA value, claimed lab identity or reported capture fact, with original report/revision and recorder. |
| Operator-attested | A submitter assertion or batch-facts attestation; show actor, time and supporting revision if present. |
| Operator-reviewed | A matching authorized review decision on this exact revision, with reviewer/time/reason. It establishes recorded review, not third-party authenticity. |
| Independently sourced/corroborated | An applicable independent verification event for this evidence revision and fact scope; show party/method and withdrawal/dispute state. A lab name or PDF upload alone is insufficient. |
| Unknown | Missing origin, capture metadata, rights, consent or verification. Do not fill gaps from filenames, images or related lots. |
| Blocked | Current server claim resolution denies readiness; show the reason code, readable explanation and exact dependency. |

These dimensions can coexist. A reported measurement may be reviewed and still lack independently corroborated lab identity. Source bytes being available is distinct from a verified fact, and reviewed transcription is distinct from source authenticity. A derivative is explicitly labeled derivative/reference with its own SHA and original linkage; it cannot substitute for a missing original. Archived/superseded/disputed/withdrawn items remain visible as history and cannot appear current or restore approval automatically.

Use existing `ResolveClaimResponse` fields as the readiness authority. Presentation helpers translate codes and event meanings; they do not reproduce domain eligibility logic. Retain unknown codes in a generic blocked message so new server reasons fail visibly. Use current policy vocabulary (`certificate_panel_measurement`, `cultivation_processing_lineage`, etc.) from contracts. Older ADR examples such as `origin_geography` and exact fixture error codes are explanatory examples, not wire enums to reintroduce.

### 3. Same-origin API boundary and security

Add typed product-evidence fetch functions and a small server forwarding helper with explicit resource/method route handlers under the Review Hub's client-scoped API paths. Map only supported operations onto the existing control `/api/v1` routes; do not build an arbitrary URL proxy. Reuse contract schemas for requests and successful responses, preserve product API structured validation/business errors and statuses, and return generic sanitized failures for unexpected upstream responses.

Authenticate and authorize the URL client before reading/uploading large bodies or fetching upstream records. Mint tokens only on the server. For mutations forward the trusted server-resolved director identity using the existing Control API trusted-proxy identity convention; discard caller-supplied identity headers. Preserve both client ownership enforcement in the control API and reviewer grants in use cases. Client mappings alone do not grant evidence verification, CoA review or claim review authority. Tests must exercise configured grants and denied actions, not only permissive adapters.

Use private/no-store responses and fetches, including errors and media lookup. Bound multipart forwarding to the current API's file/metadata constraints; preserve the generated multipart boundary and validate required metadata. Source-class inspection and quotas remain enforced by #473/#476, including production storage-policy refusal. Do not route PDFs through the existing image-reference uploader, inherit its 10 MiB image-only policy, bypass limits by trusting Content-Length, or duplicate source storage.

No new persistence or migration is expected. If acceptance tests reveal an actual nested ownership, integrity or command-wiring defect, fix the relevant existing API/application/adapter layer narrowly, preserving composite ownership keys and existing contracts. Do not hide such defects with UI filtering.

### 4. Forms, review and correction

Implement ordinary labeled forms using current contract fields and controlled vocabularies:

- SKU and lot create, metadata correction and append-only batch-facts correction. Start origin/rights/consent explicitly unknown where allowed. Canonical SKU and lot identity constraints are explained before submission.
- Source registration from an existing local original photo or CoA PDF/image via multipart, or reuse/link a known source/evidence from the authorized dossier. Expose registration intent deliberately, including revision supersession with the expected evidence version. Source reuse uses opaque IDs, never object keys or arbitrary remote URLs. Permit a known source ID for reuse when it is not discoverable from the current dossier; the API validates ownership and bytes. No new global source catalog is needed.
- Show acquisition, asserted capture date/precision/context, rights/consent, attribution, submitter assertion and batch purpose as distinct fields. Existing reference derivatives can be associated through the existing derivative-link operation, with their exact IDs/hashes. No image transformation or automatic evidence promotion is introduced.
- Verification-event controls record kind, outcome, fact scope, method, reason, corroborating party and withdrawal target as supported. They are explicitly attestations/reviews of evidence, never a one-click authenticity certificate. Surface unauthorized outcomes without writing fake local status.
- CoA creation/transcription pins the report's original evidence/revision; record report/sample identifiers, claimed lab, report date, association attestation, sample versus attributed-lot scope, completeness and measurement panel. Use text inputs and strings for exact decimals, preserving trailing zeros. Show units, quantity kind, basis, context, method, uncertainty, limits and qualifiers. Never parse analytical values through Number, silently convert units, infer zero from not-detected, or turn rows into marketing wording.
- Review, reject, supersede and archive reports using current endpoints. Report correction submits the full replacement panel as a new sealed revision. Explain and enforce server-side non-self-approval, reviewed scope limits and renewed review after supersession.
- Claim proposal uses the current six canonical parameter variants, proof category and optional operator-entered wording. Render fields conditionally rather than requiring raw JSON. Support links select exact evidence/source SHA, report revision/measurement or batch-facts revision, support role and attestation. Nothing is linked automatically merely because it shares a SKU. Unsupported manual proposals remain visibly unverified/blocked.
- Claim review, rejection, explicit invalidation and append-revision correction remain explicit commands with reason/version/revision. Superseding a claim creates a new revision and requires renewed evidence and review as the existing lifecycle dictates. Preserve all historic links and decisions.

Use shared UUIDv7 generation for each logical command, keeping the same ID and normalized payload for a transport retry. Editing a failed/conflicted payload creates a new command ID. Carry expectedVersion and revision fences from the inspected snapshot; on 409 show the conflict, preserve unsent input, reload dossier state and require a deliberate re-submit. Do not automatically retry approvals against a newer head or optimistically mark a claim approved. Disable duplicate submissions while pending. Refresh the entire coherent dossier after successful writes and on return/focus or explicit refresh; cancel/ignore late responses after client/lot/revision changes. During refresh/failure, clearly mark old data and disable review until current data is established. The API remains the final concurrency gate.

### 5. Safe source inspection

Dossier records show opaque IDs, SHA, MIME/type, bytes, uploaded date, reported capture date/precision, retention policy identifier, availability and exact immutable revision lineage. Render user-entered text escaped. Do not show filesystem paths, storageBucket/storageObjectKey/storageVersionId, arbitrary rights-document locators or raw manifests as convenient inspection links. Opaque rights locators can be omitted from the visible UI until an authorized safe-link resolver exists.

Source inspection starts only on an explicit action against the batch/evidence/revision media route. Keep the returned URL only in transient component memory with expiresAt; never store it in dossier state persisted to disk, localStorage, copied provenance or canonical navigation. Show image/PDF content in a clearly labeled original-source viewer or safe open action; provide a PDF open fallback if inline viewing is unavailable. Do not eagerly render unapproved derivative thumbnails. Delivery URLs may encode storage details internally; display human-readable action labels, never their raw URL/key text.

On expiry or media load failure, remove the stale source and offer a fresh authorized lookup; on denied/quarantined/missing media show the reason and no cached preview. Clear media on scope/revision change. Do not forward bearer tokens to object storage, log signed URLs, or treat successful rendering as integrity/authenticity verification. Already-issued presigned URLs are bearer capabilities until expiration; this issue cannot promise immediate revocation. Tests prove denied issuance and unavailable UI, not retroactive invalidation of an issued S3 signature.

## Acceptance strategy and evidence boundary

Use synthetic, conspicuously labeled PNG/JPEG and PDF fixtures generated from deterministic text/shapes. No cannabis/product photographs, real laboratory reports, company records or private operator evidence go into GitHub. Static deterministic IDs belong to fixtures; UUIDv7 action IDs are unique per command/test namespace. Use two clients and two lots to expose isolation errors.

Real PostgreSQL plus MinIO integration tests prove ingest, migrations, original bytes, server policy, nested ownership and invalidation. Browser tests prove that a person can operate the workspace and inspect actual delivered synthetic media; DOM snapshots and fake presigned hosts are insufficient. Extend the current harness with evidence lock coordinator, dossier queries, original inspector, explicit test/staging storage policy, configured reviewer grants and an isolated MinIO service for the evidence scenario. Preserve other harness scenarios. Provide test-owned author/reviewer identity contexts consistently on both web and control sides, with restricted client mappings; do not add a production impersonation option or trust browser identity headers. A distinct reviewer must complete the CoA review, and the author must be rejected for self-approval.

Runbook instructions are a separate human procedure: use one non-public sample lot, manually compare every CoA row against the source PDF, verify rights and capture assertions, assess independent corroboration where available, and confirm approved retention/deletion/legal-hold/quota arrangements. A completed CI matrix establishes software behavior only. Keep operator review pending unless separate actual operator evidence exists.

## Constraints, assumptions and risks

1. `docs/CONTEXT.md` and ADR 0009 provisional P1.8 ownership tables mention template pinning and final delivery checks. #477 explicitly narrows this PR. Document the discrepancy and distinguish future contract support from present acceptance; do not expand implementation to satisfy the old table.
2. Production evidence ingest fails closed without approved storage governance; adding UI must not set isProductionApproved, loosen grants or silently fall back to development policy. The real-data exercise runs in a permitted private environment; a production exercise requires prior operator approval of that environment's policy.
3. No dedicated epic checklist was found in checked-in files; #469 appears to be the external checklist. Prepare an acceptance summary/checklist in the new runbook and update checked-in CONTEXT only after software acceptance. If an authorized integration can update #469 during execution, mark only the completed software item with test references; do not claim remote edits or phase sign-off when unavailable.
4. #470/child evidence available locally consists of committed ADR, fixture documentation, implementation and tests. This plan does not assert the remote issue checklist is complete or that any test was run during planning.
5. Review and media policy errors may expose gaps between documentation and code. Preserve current runtime error enums, test them and fix demonstrated prerequisite defects without inventing a new authority model. Independent sourcing is always tied to explicit event scope, not inferred from lab attribution.
6. The existing global client list and fixed-actor E2E setup are insufficient authorization evidence. The new picker and harness must address these directly. Upload buffering and dossier limits are acceptable for the minimal workspace only with bounded bodies and clear failures.
7. No physical hardware evidence directories are implementation outputs. Later phase deliverables, real-provider validation, locked-SHA render runs, legal approval and overall Phase 1 completion sign-off remain outside this PR's gates.

Implementation plan:
# Implementation plan: #477

## 1. Establish reusable authenticated workspace API access

Use existing `apps/web/src/api/director-client-access.ts`, reviewer identity resolution and reference proxy patterns as the baseline. Add product-specific typed API calls and explicit Next client-scoped route handlers for SKU/lot/facts, evidence registration/reuse/history/derivative/verification/media, CoA commands, claim commands and dossier. Reuse `@cco/contracts` schemas, safe source projections and shared UUIDv7 generation. Keep the forwarding helper small and operation-allowlisted; support structured product errors, no-store responses and bounded multipart forwarding. Propagate only trusted server identity and tenant tokens.

Add an authorized client picker data path using existing client list plus server-side mapping filtering. Verify client authorization on every product data path before upstream requests and before large-body reads. No schema migration or new product endpoints are planned; narrowly repair existing prerequisite wiring/security defects only when demonstrated by acceptance tests.

Validation: focused `pnpm vitest run apps/web/src/api` plus tests beside the new product route handlers. Cover 401/403, malformed IDs, forged identity/token headers, body/path disagreement, allowed route/method forwarding, preserved 400/409 errors, malformed upstream data, no-store errors, upload metadata/binary boundary preservation, oversize streaming bodies and sanitized unexpected failures. Assert denied requests never call upstream or inspect another client's source. Run `pnpm boundaries` after the API slice.

## 2. Build navigation, read-only dossier and original inspection

Add `/products`, the client-scoped product list and SKU/lot dossier pages using the existing App Router layout and style vocabulary. Add the home entry, authorized client selection, SKU and lot lists, breadcrumbs, deep-link validation and usable back/forward behavior. Build small workspace components for summary, facts, evidence/history, CoA tables and claim/support details. Avoid a new design system or separate application shell.

Use the dossier response as the coherent lot view. Add presentation helpers for reported/attested/reviewed/independently corroborated/unknown/blocked labels with exact revision/event scope. Always show claim block reasons and historic statuses; show source SHA, dates, type, retention and original/derivative distinctions without raw locators. Add on-demand original inspection using fresh media delivery, expiry handling, denied/missing states and PDF fallback. Handle late loads, client switching, refresh failures and absent originals without showing stale verified/ready badges.

Validation: colocated page/component tests with Testing Library under the existing jsdom conventions. Cover no evidence, unknown origin, reported-but-unreviewed values, scoped independent verification and its withdrawal, archived/superseded histories, source unavailable despite a derivative, no auto-loaded thumbnails, signed URL expiry, denied media, route SKU mismatch, stale responses and accessible navigation. Verify all measurement strings, including trailing zeros and below-limit/not-detected representations, survive display unchanged.

## 3. Add source and batch correction workflows

Add forms for SKU/lot create, relevant metadata correction and append batch facts. Add source upload/reuse/link/supersede controls with current evidence registration contracts, explicit acquisition/capture/rights/consent/assertion fields and batch purpose. Integrate the existing derivative association and scoped verification-event controls so operators can establish and dispute/withdraw source support without a manifest or storage console.

Make source selection explicitly client/lot/revision scoped. Unknown facts are allowed where contracts permit and remain visibly unknown. Use UUIDv7 action IDs with request-stable retries and existing expectedVersion fields. On success reload the coherent dossier. On conflicts preserve inputs and display refreshed heads without automatically resubmitting.

Validation: focused form/proxy tests prove required/unknown states, correct create/link/supersede payloads, original/derivative separation, source reuse without bytes, duplicate submission prevention, same-action retry, changed-payload new action, and stale-version recovery. Exercise existing evidence registration/application tests when changes touch those paths.

## 4. Add CoA and sourced-claim author/reviewer workflows

Add CoA metadata and typed measurement entry tied to an exact report source. Use decimal text inputs, contract validation and explicit quantity/unit/basis/context, scope, association and completeness fields. Add review/reject/supersede/archive controls and recorder/reviewer provenance. Show why drafts, self-approval or scope escalation cannot support a claim.

Add structured claim forms for current canonical variants, source-link selection and manual wording. Show exact pinned source/report/measurement/facts IDs and revisions in inspection details, but let users select labeled records rather than transcribe IDs where available. Add review/reject/invalidate and append-revision correction commands. Render server resolution and current decision history following each mutation; keep historical approval distinct from current eligibility. Include ordinary correction paths as well as the golden path.

Validation: component tests for valid and malformed decimal strings, blank/ambiguous units, precision preservation, all result kinds, wrong report selection, scope controls, distinct review controls, API-denied self-approval, unsupported manual wording and stale approvals. Focused command tests assert authoritative identity is absent from browser payloads, exact pinned links are sent, expectedVersion is retained and no failed command fabricates local approval.

## 5. Prove the Phase 1 evidence/claim acceptance matrix

Extend the existing `apps/control-api/src/http/product-evidence-flow.integration.test.ts` or add a nearby focused integration suite. Reuse PostgreSQL 18/MinIO helpers, migration runner, deterministic valid image/PDF generation, configured authorization and dossier schema checks. Retain existing repository cascade/concurrency tests rather than replacing them with mocks. Tests needing storage mutation use harness-owned object locators; those remain internal to tests.

Extend `e2e/harness` with an isolated evidence scenario: real MinIO with browser-reachable signing endpoint, evidence dependencies, explicit non-production test policy and role/tenant-restricted author/reviewer identities. Preserve existing scenario defaults where appropriate. Make test identity switching a harness-owned operation rather than an application feature; use the existing trusted identity resolution interface and test mock boundary on both services. Ensure cleanup runs on setup failure and each case has isolated clients/lots/action IDs.

Add `e2e/tests/verified-batch-workspace.spec.ts` and an acceptance matrix document (for example `docs/verified-batch-workspace-acceptance.md`) mapping each row to actual test names and boundary assertions. For each row assert persisted/API state and relevant user-facing consequence, not merely a notification message:

| Case | Backend proof | Browser proof |
| --- | --- | --- |
| Complete synthetic batch | Create SKU/lot, multipart photo/report ingest, source/derivative linkage, exact CoA entry, distinct reviewer approval, claim proposal/link/review, schema-valid dossier and actual signed source byte read. | Start at Review Hub; operate the forms, inspect original photo/PDF, review using distinct test identity, see reported/reviewed/provenance labels, trace support and navigate back. Reload proves persistence. |
| Missing origin | Unknown facts do not supply supported origin/lineage authority; use current canonical policy and actual runtime block codes. | Unknown is explicit; affected proposed claim stays blocked, while unrelated valid measured facts remain legible. |
| Lot mismatch | Same-client Lot B evidence/report/measurement cannot support Lot A without the required explicit association; mismatched request fails and makes no claim approval. | Wrong-lot records cannot be selected accidentally; injected conflict is explained and claim remains blocked. |
| Wrong-client IDs | Both URL/principal mismatch and foreign nested IDs under an authorized client fail across reads/writes/dossier/media; denied media never signs or returns source data. | Unauthorized client selection/deep link fails; scope switching clears old dossier and media. |
| Source byte mismatch | Tamper with stored bytes, then invoke actual verification/approval gate; assert integrity rejection, durable quarantine/invalidation and blocked dossier resolution. | Failed approval shows actionable failure; no ready/verified badge or stale preview remains after refresh. |
| Missing original / denied read | Missing/quarantined original or denied storage/media access yields no usable delivery; derivative existence cannot satisfy original availability. | Explicit original unavailable/denied state with no substitute thumbnail; retry requests fresh access. |
| Archived/superseded CoA | Approve a claim, archive or supersede report, prove invalidation/history retention and pinned old-revision support denial; latest revision is not substituted. | Old reported values remain inspectable as history; current claim becomes blocked and correction needs renewed review. |
| Decimal/unit ambiguity | Reject malformed decimals/unitless rows; preserve exact strings such as 24.5000; reject mismatched unit/basis/context and sample-only to lot scope escalation. | Field errors are specific; no automatic conversion, zero substitution or marketing wording appears. |
| Source approval/invalidation | Exercise applicable verification, dispute/withdrawal and evidence supersession, proving source-event scope and resulting claim eligibility/invalidation. | Review decision and independent sourcing remain distinct; withdrawn/disputed evidence and block reasons are visible. |
| Stale version/scope conflict | Reject stale expectedVersion and concurrently changed source/report heads; assert no orphan approval. Existing approve/supersede commit-order tests stay passing. | Preserve edits, require deliberate refresh/resubmit, and ignore late responses for prior selection. |
| Reviewer denial and retry | Self-review/insufficient grants fail; identical successful command replay creates one event and changed payload/action collision fails. | No client-side identity override; repeated submission does not duplicate records; denial remains visible. |

Not every storage/concurrency variant needs an expensive full browser replay. Cover all cases at real API/database/storage level where applicable, and browser consequences for each distinct workspace state, with one full mutation/review/inspection path. Browser interception may simulate expiry/transport failures but must not replace real ownership, integrity or golden-path media proof.

Commands: `pnpm vitest run --config vitest.integration.config.ts apps/control-api/src/http/product-evidence-flow.integration.test.ts` (plus any newly added integration file), `pnpm test:db`, and `pnpm --filter e2e exec playwright test tests/verified-batch-workspace.spec.ts`. Integration tests always use the integration config. Docker and Playwright Chromium are prerequisites. Existing `.github/workflows/ci.yml` already gates unit tests, database tests and all `e2e/tests`; keep the new specs in those discovery paths rather than adding a redundant CI system.

## 6. Document private operator trial and record only verified completion

Add a concise operator runbook, linked from `docs/coa-manual-entry-runbook.md` and `docs/source-evidence-storage-recovery-runbook.md` as appropriate. Include deployment migration/config checks, trusted proxy/session setup, director-client mappings, explicit reviewer grants, browser-reachable private signing endpoint and approved storage policy requirements. Explain production policy refusal rather than instructing an operator to bypass it.

Procedure: create one non-public sample SKU/lot; record existing original photo and CoA with rights/capture metadata; inspect delivered originals; manually compare every report value, qualifier, unit, scope and attribution; have a distinct reviewer check transcription; record uncertainty and corrections through revisions; propose/review a sourced claim; verify source retention, deletion/legal-hold plan and access restrictions. Define a private operator evidence record containing reviewer/date, opaque record/revision IDs, discrepancies and decision, kept outside public GitHub. Leave this record unfilled by automation. Explain that CI establishes synthetic software acceptance only and neither optional real-data review nor software completion certifies external distribution or generative fidelity.

After acceptance passes, update `docs/CONTEXT.md` with the implemented workspace, real tested boundaries and links to acceptance/runbook artifacts. Reconcile the obsolete P1.8 ownership row to identify template/assembly consumers as future capabilities. Record completed software checklist items with concrete test commands/results; leave optional operator review, storage governance and later phases explicitly pending. Prepare an issue #469 checklist update if remote access is unavailable rather than claiming it occurred. Do not mark overarching Phase 1 sign-off complete based on this PR.

## Validation and completion criteria

Use `.ai-orchestrator.json` as the effective configuration, preserving its six ordered tiers and concurrency rules. Required repository validation remains: hygiene (`pnpm check:hooks`, frozen install); isolated format fix then format check; cache preparation/build; fast deterministic gates (`lint`, `typecheck`, unit tests, bash tests, boundaries, control-plane check); and configured heavy suites (`test:db`, assembly, Kokoro, Piper, LTX production tests, WhisperX). Follow pinned dependency setup/check scripts where those suites require them. These inherited test suites are regression checks, not new real-provider/hardware certification deliverables. Run browser acceptance explicitly in addition, with `pnpm test:e2e` and `pnpm --filter web build` to cover the actual Next bundle. CI already includes the browser job in its aggregate quality gate. Do not redeclare inherited commands; if a new validation command is introduced, map it into validation.tiers and retain tier-coverage tests.

Completion requires the complete synthetic author/reviewer path and negative matrix to pass, UI/API/migration regression tests green, safe source delivery and tenant denial demonstrated, no real/private documents in committed fixtures, and documentation accurately separating software acceptance from pending operator judgment. Record actual commands/results in the implementation PR; environment failures are reported as unverified gates, never as passes. No tests were executed and no implementation was performed during this planning task.

The steps above describe logical implementation slices, not an exhaustive file allowlist. Supporting changes may span web components, API composition, contract helpers, harnesses, tests and documentation as discovered, provided they implement these acceptance criteria and preserve the authority boundaries.

Accumulated review findings ledger:

```
### UNRESOLVED BLOCKING FINDINGS:
- **[AC-1] [HIGH]** Failed requirement: Make Phase 1 usable in the existing private Review Hub for one real SKU/lot and provide a deterministic acceptance matrix proving the evidence/claim boundary. Prioritize legibility, corrections and provenance over polished marketing design.
  Evidence: SourceInspectionPanel, CoaReportsPanel and ProductClaimsPanel generate crypto.randomUUID() action IDs. Production HTTP schemas require UUIDv7 for multipart source registration and CoA/claim commands, so the required author/reviewer workflow cannot complete. The acceptance matrix also claims browser coverage that its spec cannot execute.
  Required Fix: Implement requirement to satisfy: Make Phase 1 usable in the existing private Review Hub for one real SKU/lot and provide a deterministic acceptance matrix proving the evidence/claim boundary. Prioritize legibility, corrections and provenance over polished marketing design.
  Source: spec-review (iteration 0)

- **[AC-2] [HIGH]** Failed requirement: 1. Routes, navigation and workspace
  Evidence: Routes and home entry exist, but selected SKU is component state rather than URL state; exact historical support inspection and accessible labeled forms are incomplete. See DESIGN-2 through DESIGN-4.
  Required Fix: Implement requirement to satisfy: 1. Routes, navigation and workspace
  Source: spec-review (iteration 0)

- **[AC-5] [HIGH]** Failed requirement: Provide four labeled dossier sections and a concise summary of client/SKU/lot, versions, gaps, source availability and block counts with detail links. Keep expandable histories near records and open exact pinned revisions with return navigation. Use native controls, semantic tables, labels, keyboard navigation, visible focus, inline errors and textual badges.
  Evidence: Four panels and a summary exist, but evidence, CoA and claim revisions arrays are not rendered as inspectable histories. Claim support records are truncated text spans, not links to pinned revisions. Summary cards have no detail links. Many labels lack htmlFor/nested inputs and measurement inputs rely on placeholders; modal semantics/focus handling are absent.
  Required Fix: Implement requirement to satisfy: Provide four labeled dossier sections and a concise summary of client/SKU/lot, versions, gaps, source availability and block counts with detail links. Keep expandable histories near records and open exact pinned revisions with return navigation. Use native controls, semantic tables, labels, keyboard navigation, visible focus, inline errors and textual badges.
  Source: spec-review (iteration 0)

- **[AC-6] [HIGH]** Failed requirement: 2. Provenance is multidimensional
  Evidence: SourceInspectionPanel labels every non-withdrawn verification event Independently Sourced regardless of verificationKind or rejected/disputed outcome. CoaReportsPanel applies the last review across all revisions to the current report.
  Required Fix: Implement requirement to satisfy: 2. Provenance is multidimensional
  Source: spec-review (iteration 0)

- **[AC-8] [HIGH]** Failed requirement: Display Reported with report/revision/recorder; Operator-attested with actor/time/support; Operator-reviewed on the exact reviewed revision with reviewer/time/reason; Independently sourced only for applicable independent revision/fact-scope verification with party/method and dispute/withdrawal state; Unknown for missing facts; Blocked with server reason and exact dependency.
  Evidence: SourceInspectionPanel ignores verificationKind and evidenceRevision when labeling events and does not show rights/consent or submitter/time. CoaReportsPanel selects latestReview from the entire report history and omits recorder provenance. Claim block reasons show code/message without the dependency identifiers from the resolution.
  Required Fix: Implement requirement to satisfy: Display Reported with report/revision/recorder; Operator-attested with actor/time/support; Operator-reviewed on the exact reviewed revision with reviewer/time/reason; Independently sourced only for applicable independent revision/fact-scope verification with party/method and dispute/withdrawal state; Unknown for missing facts; Blocked with server reason and exact dependency.
  Source: spec-review (iteration 0)

- **[AC-9] [HIGH]** Failed requirement: Allow provenance dimensions to coexist; separate availability, factual verification, transcription review and authenticity. Label derivatives with their SHA and original linkage; do not substitute them for missing originals. Preserve archived/superseded/disputed/withdrawn history without showing it as current or restoring approval.
  Evidence: Derivative labels and unavailable source text are present, but CoaReportsPanel displays historic approval as current after supersession. SourceInspectionPanel renders all historical events beside currentRevision without revision labels or effective withdrawal/dispute handling. Evidence/report/claim revision content is not inspectable.
  Required Fix: Implement requirement to satisfy: Allow provenance dimensions to coexist; separate availability, factual verification, transcription review and authenticity. Label derivatives with their SHA and original linkage; do not substitute them for missing originals. Preserve archived/superseded/disputed/withdrawn history without showing it as current or restoring approval.
  Source: spec-review (iteration 0)

- **[AC-10] [HIGH]** Failed requirement: 3. Same-origin API boundary and security
  Evidence: Same-origin explicit route handlers and server identity forwarding exist, but response/request schema enforcement and upstream error sanitization are missing; configured authorization denial is not tested by the browser scenario. See DESIGN-11 through DESIGN-13.
  Required Fix: Implement requirement to satisfy: 3. Same-origin API boundary and security
  Source: spec-review (iteration 0)

- **[AC-11] [HIGH]** Failed requirement: Provide typed product fetch functions and explicit allowlisted forwarding routes to existing /api/v1 operations. Reuse request/success schemas, preserve structured business errors/statuses, and sanitize unexpected upstream failures.
  Evidence: product-evidence-client.ts returns body as T without runtime parsing. product-evidence-forwarder.ts forwards all JSON untouched; a non-JSON upstream response is copied verbatim into message and returned with the original status, including 200. It imports no product request/response schemas.
  Required Fix: Implement requirement to satisfy: Provide typed product fetch functions and explicit allowlisted forwarding routes to existing /api/v1 operations. Reuse request/success schemas, preserve structured business errors/statuses, and sanitize unexpected upstream failures.
  Source: spec-review (iteration 0)

- **[AC-12] [HIGH]** Failed requirement: Authorize URL client before large body reads or upstream fetches; keep minted tokens server-side and forward trusted resolved mutation identity, discarding caller identity. Preserve API ownership and explicit reviewer grants. Test configured grants and denied actions, not just permissive adapters.
  Evidence: Forwarder authorizes before body reads and replaces identity headers. Production bootstrap uses ConfiguredReviewerAuthorizationAdapter and evidence storage policy. However, e2e/harness/control-api.ts supplies three unconditional async reviewer grants, while web-server.ts grants wildcard client mappings and the API resolves every actor to Integration Test Director. No role-separated or denied-grant browser scenario exists.
  Required Fix: Implement requirement to satisfy: Authorize URL client before large body reads or upstream fetches; keep minted tokens server-side and forward trusted resolved mutation identity, discarding caller identity. Preserve API ownership and explicit reviewer grants. Test configured grants and denied actions, not just permissive adapters.
  Source: spec-review (iteration 0)

- **[AC-13] [HIGH]** Failed requirement: Use private/no-store responses/fetches including errors/media; bound multipart forwarding to API constraints, preserve boundaries and validate metadata. Retain source inspection, quotas and production policy refusal; support PDFs through evidence ingest without bypassing size limits or duplicating storage.
  Evidence: Forwarder uses no-store and streaming byte counting and preserves Content-Type, but does not parse/validate multipart required metadata using the contract. readBoundedBody has no tests for oversize streams, missing metadata or binary/boundary preservation. The real storage governance gate remains unchanged.
  Required Fix: Implement requirement to satisfy: Use private/no-store responses/fetches including errors/media; bound multipart forwarding to API constraints, preserve boundaries and validate metadata. Retain source inspection, quotas and production policy refusal; support PDFs through evidence ingest without bypassing size limits or duplicating storage.
  Source: spec-review (iteration 0)

- **[AC-14] [HIGH]** Failed requirement: 4. Forms, review and correction
  Evidence: Forms provide some create/review commands, but production action-ID incompatibility, missing corrections, incomplete analytical fields and fabricated lineage parameters prevent the specified workflows.
  Required Fix: Implement requirement to satisfy: 4. Forms, review and correction
  Source: spec-review (iteration 0)

- **[AC-15] [HIGH]** Failed requirement: Implement ordinary labeled forms using current contract fields and controlled vocabularies.
  Evidence: CoA rows have no associated labels for inputs and omit multiple contract fields. ProductClaimsPanel offers only five of six canonical variants and hardcodes lineage facts. Source rights/consent fields are absent.
  Required Fix: Implement requirement to satisfy: Implement ordinary labeled forms using current contract fields and controlled vocabularies.
  Source: spec-review (iteration 0)

- **[AC-18] [HIGH]** Failed requirement: Expose acquisition, capture date/precision/context, rights/consent, attribution, submitter assertion and batch purpose distinctly. Associate existing derivatives with exact IDs/hashes and do not transform/promote evidence automatically.
  Evidence: SourceInspectionPanel supports capture/acquisition/assertion/purpose and derivative commands, but has no rightsStatus, consentStatus or rightsAttribution controls or display. Rights/consent remain silently omitted, so an operator cannot record the facts required by the runbook.
  Required Fix: Implement requirement to satisfy: Expose acquisition, capture date/precision/context, rights/consent, attribution, submitter assertion and batch purpose distinctly. Associate existing derivatives with exact IDs/hashes and do not transform/promote evidence automatically.
  Source: spec-review (iteration 0)

- **[AC-19] [HIGH]** Failed requirement: Pin CoA transcription to original evidence/revision; record report/sample/lab/date/association/scope/completeness and measurements. Preserve exact decimal strings and expose units, quantity kind, basis, context, method, uncertainty, limits and qualifiers without numeric conversion, inferred zero or marketing generation.
  Evidence: Decimal strings are preserved, but CoaReportsPanel has no entry controls for quantityKind, method, resultLimit, resultQualifier, uncertainty, LOD or LOQ; quantityKind and method are silently defaulted. below_limit still sends resultValue and null resultLimit/qualifier, making a valid below-limit transcription impossible. Display omits limits, qualifiers, uncertainty and quantity kind. Commands also use UUIDv4.
  Required Fix: Implement requirement to satisfy: Pin CoA transcription to original evidence/revision; record report/sample/lab/date/association/scope/completeness and measurements. Preserve exact decimal strings and expose units, quantity kind, basis, context, method, uncertainty, limits and qualifiers without numeric conversion, inferred zero or marketing generation.
  Source: spec-review (iteration 0)

- **[AC-22] [HIGH]** Failed requirement: Provide explicit claim review/rejection/invalidation and append-revision correction with reasons/version/revision. Supersession requires renewed support/review and retains historical links and decisions.
  Evidence: ProductClaimsPanel implements review and invalidate handlers but never imports/calls appendClaimRevision or exposes claim correction. Rejected/invalidated claims cannot be corrected in the workspace. Historical claim revisions are not rendered and support links are text.
  Required Fix: Implement requirement to satisfy: Provide explicit claim review/rejection/invalidation and append-revision correction with reasons/version/revision. Supersession requires renewed support/review and retains historical links and decisions.
  Source: spec-review (iteration 0)

- **[AC-23] [HIGH]** Failed requirement: Use shared UUIDv7 with stable command/payload retries and new IDs for edited payloads. Preserve version/revision fences; on 409 preserve input, reload state and require deliberate resubmit. Prevent duplicates and optimistic approval. Refresh coherently after writes/focus/return, ignore late responses and disable review while stale.
  Evidence: Every form generates fresh crypto.randomUUID() per submission. No retry identity is retained. Catch branches only set errors and never reload on 409. Dossier loadDossier has no cancellation/generation guard or focus listener. Manual refresh leaves review controls enabled with no stale warning. BatchFactsPanel uses the wrong version fence.
  Required Fix: Implement requirement to satisfy: Use shared UUIDv7 with stable command/payload retries and new IDs for edited payloads. Preserve version/revision fences; on 409 preserve input, reload state and require deliberate resubmit. Prevent duplicates and optimistic approval. Refresh coherently after writes/focus/return, ignore late responses and disable review while stale.
  Source: spec-review (iteration 0)

- **[AC-24] [HIGH]** Failed requirement: 5. Safe source inspection
  Evidence: Inspection is explicit and transient, but source metadata can describe a different revision than the bytes inspected and stale media is never cleared on expiry/load failure/scope change. See DESIGN-27 and DESIGN-29.
  Required Fix: Implement requirement to satisfy: 5. Safe source inspection
  Source: spec-review (iteration 0)

- **[AC-26] [HIGH]** Failed requirement: Remove stale media on expiry/load failure, offer fresh lookup, show denial/quarantine/missing without cached preview and clear on scope/revision change. Do not forward tokens/log signed URLs or imply authenticity. Promise denied issuance, not retroactive revocation.
  Evidence: SourceInspectionPanel imports only useState, has no expiry timer or scope/revision cleanup, and img/iframe have no onError. A late fetch after Close sets activeMedia again. Refresh with quarantined/superseded evidence leaves the old viewer active; there is only a retry for lookup rejection, not media render failure.
  Required Fix: Implement requirement to satisfy: Remove stale media on expiry/load failure, offer fresh lookup, show denial/quarantine/missing without cached preview and clear on scope/revision change. Do not forward tokens/log signed URLs or imply authenticity. Promise denied issuance, not retroactive revocation.
  Source: spec-review (iteration 0)

- **[F-a1ea62ae] [HIGH]** No valid production UI success path exists for required multipart ingest, CoA transcription/review or claim creation/review, regardless of legitimate production grants/storage governance.
  Files: apps/web/src/components/product-evidence/source-inspection-panel.tsx, apps/web/src/components/product-evidence/coa-reports-panel.tsx, apps/web/src/components/product-evidence/product-claims-panel.tsx, packages/contracts/src/product-evidence-http.ts
  Evidence: Source registration uses crypto.randomUUID() at source-inspection-panel.tsx:121; CoA/claim commands do the same. HTTP schemas explicitly refine actionId with isValidUuidV7. An independent direct schema invocation rejected the form-shaped metadata solely on actionId.
  Required Fix: Use shared generateUuidV7 for logical commands, retain ID/payload for transport retries and test actual form requests against HTTP schemas.
  Source: spec-review (iteration 0)

- **[F-b10cb648] [HIGH]** An internal assertion can be mistaken for independent corroboration, and unreviewed replacement report revision 2 appears approved by revision 1 review. This violates the evidence/claim authority boundary.
  Files: apps/web/src/components/product-evidence/source-inspection-panel.tsx, apps/web/src/components/product-evidence/coa-reports-panel.tsx, packages/infrastructure/src/postgres/queries/postgres-batch-evidence-dossier-queries.ts
  Evidence: Source events map outcome !== withdrawn to Independently Sourced, including submitter_attestation, human_internal_review, rejected and disputed events. CoA latestReview selects the last event across the complete report review history, which the query intentionally returns across revisions.
  Required Fix: Select labels by exact event kind/outcome/revision/scope and explicit withdrawal/dispute state; associate reviews only with their pinned report revision and expose historic decisions as history. Add adversarial provenance tests.
  Source: spec-review (iteration 0)

- **[F-0c16d853] [HIGH]** Required analytical results cannot be transcribed faithfully, below-limit rows cannot be validly submitted, and correction can silently lose source meaning. Exact decimal display alone does not satisfy lossless transcription.
  Files: apps/web/src/components/product-evidence/coa-reports-panel.tsx, packages/domain/src/coa-measurement.ts
  Evidence: Measurement forms expose only analyte/kind/value/unit/basis/context. methodAsReported defaults to HPLC-DAD, quantityKind to mass_fraction; limit/qualifier/uncertainty/LOD/LOQ cannot be entered. below_limit keeps a value and sends null limit/qualifier, contradicting domain validation. Supersession drops metadata and fails to initialize sample association/date.
  Required Fix: Expose all required analytical metadata, serialize each result kind correctly, initialize the complete selected report revision during correction and preserve untouched fields. Test quantified/below-limit/not-detected and complete supersession round trips.
  Source: spec-review (iteration 0)

- **[F-82811648] [HIGH]** An operator cannot author all specified claims or correct rejected/invalidated ones, and the application inserts unsupplied factual assertions into provenance.
  Files: apps/web/src/components/product-evidence/product-claims-panel.tsx
  Evidence: Canonical selector contains five variants, omitting logged_process_timing. The lineage handler fabricates operationCode OP-01, originKind own_production and claimedFacts cultivated_under_gmp. No append-revision handler/UI exists, and support cannot select facts revision or association attestation.
  Required Fix: Implement structured fields for all six canonical variants and exact support types; remove fabricated lineage defaults and add append-revision correction with renewed support/review and history inspection.
  Source: spec-review (iteration 0)

- **[F-ac648961] [HIGH]** Out-of-order results can display an old scope, review is allowed from stale snapshots, retries may duplicate commands, and facts corrections fail when metadata version diverges. Server fences remain essential but do not fulfill required UI conflict/retry behavior.
  Files: apps/web/src/app/clients/[clientId]/products/[skuId]/batches/[batchId]/page.tsx, apps/web/src/components/product-evidence/batch-facts-panel.tsx, apps/web/src/components/product-evidence/source-inspection-panel.tsx, apps/web/src/components/product-evidence/coa-reports-panel.tsx, apps/web/src/components/product-evidence/product-claims-panel.tsx
  Evidence: Dossier requests have no cancellation/generation checks or focus refresh; mutation conflicts do not reload. During manual refresh review controls stay enabled. Every retry gets a new command ID. BatchFactsPanel fences with currentFactsRevision although batch updates are version fenced.
  Required Fix: Implement scoped request cancellation, stale-state marking and review disabling, focus/return refresh, stable logical command retries and explicit 409 reload/resubmit preserving edits. Use batch.version for facts commands.
  Source: spec-review (iteration 0)

- **[F-c10e97d6] [HIGH]** An expired, failed, quarantined or previously scoped source remains in the viewer without the required fresh authorization path, and a closed viewer can reopen asynchronously.
  Files: apps/web/src/components/product-evidence/source-inspection-panel.tsx
  Evidence: activeMedia has no expiry timer or useEffect cleanup. Image/PDF viewers lack load-error handling. Closing during an outstanding lookup does not cancel/ignore its result, and refresh/scope/revision changes do not clear the preview.
  Required Fix: Expire and remove delivery state, handle render failures with a fresh lookup action, clear on scope/revision/availability change, and ignore late results after close or newer inspection. Add timer, denial and race tests.
  Source: spec-review (iteration 0)

- **[F-a7dacfe9] [HIGH]** The claimed complete synthetic author/reviewer/media gate cannot pass. Two tests do not establish the required negative matrix, configured grants or actual browser-delivered original bytes. Existing backend integration coverage cannot substitute for the missing workspace acceptance.
  Files: e2e/tests/verified-batch-workspace.spec.ts, e2e/harness/control-api.ts, e2e/harness/web-server.ts, docs/verified-batch-workspace-acceptance.md
  Evidence: The first E2E assertion expects authorized-client-chooser, but the actual page uses products-workspace-chooser and a select rather than client-choice links. Numerous later selectors also disagree. Harness uses fixed actor, wildcard client mappings, unconditional review grants, in-memory storage and http://mock-storage delivery. It supplies no evidenceStoragePolicy, so ingestion fails POLICY_CONFIGURATION_MISSING even if selectors are repaired. No PDF registration or distinct reviewer is provided.
  Required Fix: Wire an explicit permitted test policy, isolated browser-reachable MinIO and role/tenant-scoped identities; fix selectors and operate both image/report workflows with a distinct reviewer. Cover each required negative boundary at the appropriate API/storage/browser level and record actual results.
  Source: spec-review (iteration 0)

- **[F-f9b4ee7d] [MEDIUM]** An upstream HTML diagnostic or internal path can reach the browser, malformed success is treated as trusted dossier data, and the anchored typed/sanitized forwarding contract is not implemented.
  Files: apps/web/src/api/product-evidence-forwarder.ts, apps/web/src/api/product-evidence-client.ts
  Evidence: Forwarder copies unexpected non-JSON text into message and returns upstream status even for 200; arbitrary JSON success is forwarded unchanged. Client handleApiResponse returns body as T without schema validation. Multipart metadata is never validated in the forwarding helper.
  Required Fix: Apply operation-specific request/success schemas; preserve only recognized structured API errors and map malformed/unexpected responses to sanitized gateway errors. Validate bounded multipart metadata and add oversize/binary/boundary tests.
  Source: spec-review (iteration 0)

- **[F-96a07b72] [MEDIUM]** Required reversible navigation, exact historic source inspection, accessible controls and recoverable states remain incomplete.
  Files: apps/web/src/app/clients/[clientId]/products/page.tsx, apps/web/src/app/products/page.tsx, apps/web/src/components/product-evidence/source-inspection-panel.tsx, apps/web/src/components/product-evidence/coa-reports-panel.tsx, apps/web/src/components/product-evidence/product-claims-panel.tsx, apps/web/src/components/product-evidence/batch-dossier-summary.tsx
  Evidence: Selected SKU is only local state; chooser errors have no retry. Evidence/report/claim revisions are not inspectable, support references are truncated spans without navigation and summary has no detail links. Labels frequently have no association to inputs; modal focus is unmanaged.
  Required Fix: Persist SKU selection in URL, add retry, render exact pinned history with return navigation and full safe identifiers, associate labels and implement accessible modal/focus behavior. Verify with interaction/browser tests.
  Source: spec-review (iteration 0)

- **[F-d0fe5dcc] [MEDIUM]** Software completion is overstated before acceptance, and the operator cannot follow the prescribed procedure under supported production configuration. Pending human authenticity review is correctly acknowledged, but does not cure inaccurate software evidence or missing deployment/governance instructions.
  Files: docs/verified-batch-workspace-acceptance.md, docs/verified-batch-operator-runbook.md, docs/CONTEXT.md
  Evidence: Matrix marks software gates PASS and CONTEXT says concluding the Phase 1 evidence foundation despite the nonfunctional acceptance spec. New runbook omits explicit reviewer grant and trusted proxy setup, approved storage governance prerequisite, capture/consent checks and retention/deletion/legal-hold/quota confirmation; it describes nonexistent rights/retention controls and standard_retention/immutable_legal_hold instead of the source_evidence_archive contract. Existing P1.8 ownership row still asserts template/final-delivery work rather than future scope.
  Required Fix: Mark unproven software gates pending, complete and link the runbook using actual controls/contracts/configuration, reconcile P1.8 future scope and prepare an honest epic checklist update only after passing acceptance. Preserve independent human review and later phase gates.
  Source: spec-review (iteration 0)

- **[F-6df8c953] [CRITICAL]** Because `crypto.randomUUID()` produces UUIDv4 (`version 4`) and `UuidV7Schema` strictly requires version 7 (`^[0-9a-f]{8}-[0-9a-f]{4}-7...`), Control API rejects every multipart evidence registration, CoA transcription/review/supersede/archive command, and claim create/link/review/invalidate/append command from the UI with `400 VALIDATION_FAILURE`. In addition, generating a new UUID inside the submit handler on every click rather than retaining a stable `actionId` per unedited logical submission defeats idempotent command replay on transport retry.
  Files: apps/web/src/components/product-evidence/source-inspection-panel.tsx, apps/web/src/components/product-evidence/coa-reports-panel.tsx, apps/web/src/components/product-evidence/product-claims-panel.tsx, apps/web/src/components/product-evidence/batch-facts-panel.tsx, apps/web/src/app/clients/[clientId]/products/page.tsx
  Evidence: Every workspace mutation generates `actionId: crypto.randomUUID()` (UUIDv4) on each click (`source-inspection-panel.tsx:122`, `coa-reports-panel.tsx:144,179,220,255`, `product-claims-panel.tsx:175,203,230,265`, `batch-facts-panel.tsx:62`, `apps/web/src/app/clients/[clientId]/products/page.tsx:91,115`). However, `packages/contracts/src/product-evidence-http.ts` (`lines 44-46, 122, 197, 203, 208, 213, 252, 257, 262, 267, 273`) enforces `UuidV7Schema` (`isValidUuidV7`) on `RegisterEvidenceAssetMultipartMetadataSchema` and all CoA and claim HTTP command schemas.
  Required Fix: Use `generateUuidV7()` from `@cco/shared` for all product-evidence `actionId` values and retain the generated `actionId` across retries of an unedited form payload, rotating it only when the form inputs change or a submission completes.
  Source: quality-review (iteration 0)

- **[F-93b196cc] [CRITICAL]** These defects violate core provenance and data-integrity invariants: disputed/rejected or internal-only attestations are falsely badged as `Independently Sourced`; superseding an approved CoA revision with an unreviewed revision still displays `Operator-Reviewed (Approved)` from the prior revision while silently dropping analytical qualifiers/limits/attestations during supersession; and multi-revision evidence assets display and link the wrong revision's `sourceObjectId` and `originalSha256`.
  Files: apps/web/src/components/product-evidence/source-inspection-panel.tsx, apps/web/src/components/product-evidence/coa-reports-panel.tsx, apps/web/src/components/product-evidence/product-claims-panel.tsx
  Evidence: 1) In `source-inspection-panel.tsx` (`lines 582-588`), any verification event with `evt.outcome !== "withdrawn"` is rendered with `<IndependentlyCorroboratedBadge>` (`"Independently Sourced"`), even when `evt.outcome` is `"disputed"` or `"rejected"`, or when `evt.verificationKind` is `"submitter_attestation"` or `"human_internal_review"`. 2) In `coa-reports-panel.tsx` (`lines 312-315, 372-383`), `latestReview` is selected as `reviewList[reviewList.length - 1]` without filtering `ev.reportRevision === rev.revision`, even though `postgres-batch-evidence-dossier-queries.ts` (`lines 258-272`) returns review events across all revisions of a report; additionally, `coa-reports-panel.tsx` (`lines 419-437`) omits `sampleDate`, `associationAttestation`, and measurement `uncertaintyAbsolute`, `detectionLimit`, `quantificationLimit`, `analyticalQualifierCode`, and `analyticalQualifierExplanation` when superseding a CoA. 3) In `source-inspection-panel.tsx` (`line 318`) and `product-claims-panel.tsx` (`line 257`), the code picks `item.sourceObjects?.[0]` / `selectedEv?.sourceObjects[0]` rather than resolving the `sourceObjectId` of `item.currentRevision` or the selected `linkEvidenceRev`.
  Required Fix: 1) Only render `IndependentlyCorroboratedBadge` when `evt.outcome === "verified"` and `evt.verificationKind` is an independent verification kind (`independent_third_party_verification` or `cryptographic_issuer_signature`), and render explicit disputed/rejected/attested states otherwise. 2) Filter CoA `reviewEvents` by `ev.reportRevision === rev.revision` and preserve all CoA header and measurement fields when populating and submitting the supersede form. 3) Resolve the `sourceObject` matching the target revision's `sourceObjectId` from `revisions` rather than indexing `sourceObjects[0]`.
  Source: quality-review (iteration 0)

- **[F-0be9dfc8] [HIGH]** The E2E spec cannot pass against the implemented UI or test harness, and the acceptance documentation inaccurately claims automated E2E verification passed.
  Files: e2e/tests/verified-batch-workspace.spec.ts, e2e/harness/control-api.ts, docs/verified-batch-workspace-acceptance.md, docs/CONTEXT.md
  Evidence: `e2e/tests/verified-batch-workspace.spec.ts` (`lines 24-186`) queries over 20 `data-testid` selectors that do not exist anywhere in `apps/web` (e.g., `authorized-client-chooser`, `products-workspace`, `create-sku-button`, `sku-canonical-input`, `create-batch-button`, `batch-lot-identifier-input`, `batch-dossier-page`, `assertion-text-input`, `submit-register-evidence-button`, `media-inspection-modal`, `transcribe-coa-modal`, `row-analyte-0`, `coa-review-modal`, `link-evidence-modal`, `claim-review-modal`, `dossier-load-error`). Furthermore, `e2e/harness/control-api.ts` (`lines 75-99`) does not pass `evidenceStoragePolicy` to `createControlApiApp` (so `RegisterEvidenceAssetUseCase` fails closed with `POLICY_CONFIGURATION_MISSING` at `packages/application/src/use-cases/register-evidence-asset.ts:187-193`) and hardcodes `reviewerIdentityResolver: { resolve: () => "Integration Test Director" }` (`line 105`), which ignores the test's `tailscale-user-login` header and triggers `SELF_APPROVAL_FORBIDDEN` on CoA review. Yet `docs/verified-batch-workspace-acceptance.md` (`lines 17-25, 36`) records `GATE-1` through `GATE-8` as `PASS (Automated)` citing `e2e/tests/verified-batch-workspace.spec.ts`.
  Required Fix: Wire `evidenceStoragePolicy`, reachable object-storage media delivery, and header-aware test identity resolution in `e2e/harness/control-api.ts`; align `e2e/tests/verified-batch-workspace.spec.ts` selectors and flows with the actual workspace components; and only record `PASS` in `docs/verified-batch-workspace-acceptance.md` and `docs/CONTEXT.md` after the test suite actually executes and passes.
  Source: quality-review (iteration 0)

### PREVIOUSLY RESOLVED FINDINGS (REGRESSION CHECKLIST):
- **[AC-3] [RESOLVED in iter 2]** Failed requirement: Use established App Router patterns. Add a Products/Batches entry at /products, an authorized client chooser, /clients/[clientId]/products for SKU list/selection and lot listing/creation, and /clients/[clientId]/products/[skuId]/batches/[batchId] for the dossier. Use ordinary Next Link navigation, breadcrumbs and browser back/forward. Preserve selected SKU/lot in the URL; verify deep-link SKU ownership and do not silently display a different SKU lot.
  Resolution Evidence: apps/web/src/app/page.tsx:38-45 links to /products; products/page.tsx:45-59,129-139 persists SKU selection in URL search parameters and reacts to history changes. The dossier page at apps/web/src/app/clients/[clientId]/products/[skuId]/batches/[batchId]/page.tsx:118-165 rejects SKU mismatch and provides canonical/back links. These previously resolved routing behaviors remain present.
  Source: spec-review

- **[AC-4] [RESOLVED in iter 2]** Failed requirement: Resolve chooser identity on the server and filter existing clients through director mappings. Enforce access independently on all endpoints, use authenticated same-origin loads, and render loading, empty, forbidden/not-found, retry and failure states.
  Resolution Evidence: apps/web/src/app/api/authorized-clients/route.ts:23-47 resolves server identity and lines 129-142 filters schema-validated clients against director mappings with no-store responses. apps/web/src/app/products/page.tsx:70-113 retains loading/error/retry/empty states. product-evidence-forwarder.ts:275-278 independently authorizes each client request before reading the body or calling Control API.
  Source: spec-review

- **[AC-7] [RESOLVED in iter 2]** Failed requirement: Do not implement a single overall verified badge or infer status from an uploaded file. Display provenance dimensions independently.
  Resolution Evidence: apps/web/src/components/product-evidence/source-inspection-panel.tsx:537-547 presents availability separately, lines 589-624 separately present submitter, rights and consent (including unknown), and lines 775-797 distinguish rejected/disputed/withdrawn events, independent corroboration, internal review and submitter attestation. coa-reports-panel.tsx:380-386 limits transcription review to its revision. The original kind-conflation and missing rights/consent dimensions are corrected; effective-event history is evaluated separately under AC-6/AC-8/AC-9.
  Source: spec-review

- **[AC-16] [RESOLVED in iter 2]** Failed requirement: Provide SKU/lot create, metadata correction and append-only batch-facts correction. Start origin/rights/consent explicitly unknown where allowed and explain canonical SKU/lot constraints before submission.
  Resolution Evidence: apps/web/src/app/clients/[clientId]/products/page.tsx:69-95,160-182,218-240 retains SKU/lot metadata correction commands and expectedVersion. Origin defaults to unknown at line 81; source-inspection-panel.tsx:106-107 keeps rights/consent unknown. batch-facts-panel.tsx:63-74 appends facts with batch.version rather than facts revision, preserving the production version fence.
  Source: spec-review

- **[AC-17] [RESOLVED in iter 2]** Failed requirement: Register local original photo/CoA PDF/image using multipart or reuse/link known source/evidence. Expose create/link/supersede intent and expected evidence version. Reuse opaque IDs, permit known source IDs outside the dossier and validate ownership/bytes without a new global catalog.
  Resolution Evidence: apps/web/src/components/product-evidence/source-inspection-panel.tsx:162-225 retains multipart upload and opaque source-object reuse, explicit registrationIntent and supersede target/version fences, with UUIDv7 action IDs. product-evidence-forwarder.ts:321-343 validates metadata using the same RegisterEvidenceAssetMultipartMetadataSchema enforced by packages/contracts/src/product-evidence-http.ts:118-156 and the ingestion route at apps/control-api/src/http/routes/product-evidence-routes.ts:704-731. The supported original registration/reuse path remains available; retry editing and capture context are tracked separately.
  Source: spec-review

- **[AC-20] [RESOLVED in iter 2]** Failed requirement: Support report review/reject/supersede/archive. Correction submits a complete replacement sealed panel; explain/enforce non-self-approval, scope limits and renewed review after supersession.
  Resolution Evidence: apps/web/src/components/product-evidence/coa-reports-panel.tsx:137-140,234-327 uses UUIDv7 for review/supersede/archive, lines 495-521 initializes sample/date/association and all analytical metadata from the inspected revision, and lines 274-289 serializes the complete replacement panel. Lines 380-386 filter current review to that report revision. The API schemas retain UUIDv7 checks (packages/contracts/src/product-evidence-http.ts:202-214), and packages/infrastructure/src/postgres/repositories/postgres-coa-report-repository.ts:848-855,999-1074 retains version fencing and sealed replacement revisions. This closes the cited UUID, lossy initialization and inherited-review defects; missing analytical editing is tracked separately under AC-19.
  Source: spec-review

- **[AC-21] [RESOLVED in iter 3]** Failed requirement: Provide six canonical claim variants with conditional fields, proof category and optional manual wording. Select exact evidence/SHA/report/measurement/facts support, role and attestation, without automatic SKU linkage; keep unsupported manual proposals blocked.
  Resolution Evidence: apps/web/src/components/product-evidence/product-claims-panel.tsx:39-56,99-145,191-265,1051-1420 implements all six canonical claim variants (including logged_process_timing and explicit operator inputs for cultivation_processing_lineage without fabricated defaults), and lines 420-480,2065-2260 allow selecting batchFactsRevision, measurement checkboxes, association attestation, and the exact sourceObject matching the selected evidence revision.
  Source: spec-review

- **[AC-25] [RESOLVED in iter 2]** Failed requirement: Show safe IDs/SHA/type/bytes/upload/capture precision/retention/availability and exact immutable revision lineage. Escape user text; omit filesystem/storage keys, arbitrary rights locators and raw manifest inspection links.
  Resolution Evidence: apps/web/src/components/product-evidence/source-inspection-panel.tsx:376-379 now resolves the current revision source by sourceObjectId; lines 519-547 display safe SHA/type/bytes/availability/upload/retention fields; lines 632-703 resolve each historical revision source separately and show supersedes lineage with an exact-revision media action. The authoritative dossier accumulates sources across revisions at packages/infrastructure/src/postgres/queries/postgres-batch-evidence-dossier-queries.ts:135-170, which this lookup now handles correctly. The cited wrong-source projection defect is closed; fuller historical inspection is tracked under AC-5.
  Source: spec-review

- **[F-8fa3bee1] [RESOLVED in iter 2]** With two source revisions, displayed SHA/availability and claim support can describe bytes other than the inspected or selected revision. This is incorrect provenance and can block legitimate linking.
  Resolution Evidence: apps/web/src/components/product-evidence/source-inspection-panel.tsx:376-379 matches currentRevision.sourceObjectId; lines 646-649 matches each historical revision separately. product-claims-panel.tsx:429-441 resolves a selected revision and finds its sourceObjectId rather than sourceObjects[0], then sends that source ID/SHA at lines 465-468. This matches the dossier multi-revision source accumulation at packages/infrastructure/src/postgres/queries/postgres-batch-evidence-dossier-queries.ts:135-170. Valid selected revisions no longer take the first unrelated source object.
  Source: spec-review

- **[F-a01b56e6] [RESOLVED in iter 2]** Required corrections and rights/capture provenance cannot be established from Review Hub, and an unknown origin can be submitted as own production by default.
  Resolution Evidence: apps/web/src/app/clients/[clientId]/products/page.tsx:69-95,160-182,218-240 implements SKU/lot metadata edit state and version-fenced API mutations, and line 81 defaults origin to unknown. source-inspection-panel.tsx:106-108 defaults rights/consent to unknown, lines 1265-1298 exposes controls, lines 187-189,216-218 sends their values, and lines 602-624 safely displays them. The cited missing metadata and rights/consent controls/default-origin defects are corrected.
  Source: spec-review

- **[F-a2b29610] [RESOLVED in iter 2]** `apps/web/src/app/clients/[clientId]/products/page.tsx` assigns the return value of `fetchProductSkus` and `fetchProductBatches` directly to `skus` and `batches` state (`lines 62-66`) and calls `skus.map(...)` (`lines 237, 252`) and `filteredBatches.map(...)` (`line 362`), which throws `TypeError: skus.map is not a function` at runtime when loading `/clients/[clientId]/products`.
  Resolution Evidence: apps/web/src/api/product-evidence-client.ts:148-149 unwraps ProductSkuListResponseSchema to data.skus, lines 211-215 unwraps batch lists and lines 275-279 unwraps facts history. products/page.tsx:103-109 stores those arrays. Claim create/append parsing at client lines 482,501 matches production result.claim responses at apps/control-api/src/http/routes/product-evidence-routes.ts:1449,1568; archive parsing at client lines 466-467 also remains aligned. The object-as-array crash is not reintroduced.
  Source: quality-review

- **[F-a5224f73] [RESOLVED in iter 3]** Every request to list or link derivative reference assets from the workspace forwards to a non-existent upstream path and fails with `404 Not Found`.
  Resolution Evidence: apps/web/src/app/api/clients/[clientId]/batches/[batchId]/evidence/[evidenceId]/revisions/[revision]/derivatives/route.ts:18,27 now forwards to singular /api/v1/clients/${clientId}/batches/${batchId}/evidence/${evidenceId}/revisions/${revision}/derivative matching apps/control-api/src/http/routes/product-evidence-routes.ts:871,931, and apps/web/src/api/product-evidence-forwarder.ts:115-116 permits 'derivative' in validateUpstreamPath, verified by apps/web/src/app/api/clients/[clientId]/batches/[batchId]/evidence/[evidenceId]/revisions/[revision]/derivatives/route.test.ts:38-109.
  Source: quality-review

- **[F-541e5d17] [RESOLVED in iter 2]** When an operator opens a fresh batch with 0 evidence assets or 0 CoA reports and registers the first evidence asset or CoA report, the panels remain mounted while their `availableEvidence` / `availableReports` props populate. Because a `<select>` with a single option visually displays that option without firing `onChange`, `selectedEvidenceId` and `linkEvidenceId` remain `""`, causing CoA submission and claim evidence linking to fail with `"Must link to a source evidence asset."` or `"Selected evidence has no source object."`.
  Resolution Evidence: apps/web/src/components/product-evidence/coa-reports-panel.tsx:148-158 selects the first arriving evidence and its currentRevision when the prior selection is empty/absent, and lines 806-814 updates evidenceRev on evidence selection. product-claims-panel.tsx:165-188 similarly initializes arriving evidence/report/measurement selections and revision numbers. This closes the empty initial dossier followed by first ingest/transcription selection failure.
  Source: quality-review

- **[F-32fdec51] [RESOLVED in iter 3]** Unvalidated nested route parameters allow path segments or malformed identifiers to be interpolated into upstream Control API paths before upstream validation, and missing request cancellation / media-expiry cleanup can leave stale dossier or signed media state visible across scope changes or after URL expiration.
  Resolution Evidence: 1) apps/web/src/api/product-evidence-forwarder.ts:29-131,254-263 validates all upstream path segments and UUID/positive-integer route parameters in validateUpstreamPath before making upstream requests. 2) apps/web/src/app/clients/[clientId]/products/page.tsx:96-123 and apps/web/src/app/clients/[clientId]/products/[skuId]/batches/[batchId]/page.tsx:34-68 guard in-flight loads with request sequence refs and AbortController cleanup. 3) apps/web/src/components/product-evidence/source-inspection-panel.tsx:64-85 clears activeMedia on clientId/batchId change and schedules a timer to clear activeMedia.delivery when expiresAt elapses.
  Source: quality-review

- **[F-bc3df102] [RESOLVED in iter 3]** The new allowlist makes the previously repaired derivative listing/association capability inaccessible for every valid request, violating source original/derivative workflow acceptance. This is the regression of F-a5224f73.
  Resolution Evidence: apps/web/src/api/product-evidence-forwarder.ts:115-116 now allows singular 'derivative' (as well as 'derivatives') at segment index 8 in validateUpstreamPath, and apps/web/src/app/api/clients/[clientId]/batches/[batchId]/evidence/[evidenceId]/revisions/[revision]/derivatives/route.test.ts:38-109 verifies both GET and POST through the route handler into a schema-valid upstream response.
  Source: spec-review

```

Deterministic validation evidence:

```
Validation result: passed (fingerprint: c8b6234e1787)
```



Complete branch diff against base:

```diff
diff --git a/apps/web/src/app/page.tsx b/apps/web/src/app/page.tsx
index 24f7e0f..22c1af9 100644
--- a/apps/web/src/app/page.tsx
+++ b/apps/web/src/app/page.tsx
@@ -30,10 +30,18 @@ export default async function HomePage() {
           </div>
         )}
       </div>
-      <div style={{ marginTop: "1.5rem" }}>
+      <div style={{ marginTop: "1.5rem", display: "flex", gap: "1rem" }}>
         <Link href="/campaigns/new" className="stage-draft-button" data-testid="new-campaign-link">
           + New Campaign
         </Link>
+        <Link
+          href="/products"
+          className="stage-draft-button"
+          data-testid="products-workspace-link"
+          style={{ backgroundColor: "var(--bg-surface-elevated)" }}
+        >
+          Products &amp; Batches
+        </Link>
       </div>
     </section>
   );
diff --git a/docs/CONTEXT.md b/docs/CONTEXT.md
index d7fb062..08af74a 100644
--- a/docs/CONTEXT.md
+++ b/docs/CONTEXT.md
@@ -259,7 +259,7 @@ Implementation of the contracts specified in ADR 0009 is partitioned across seve
 | **P1.5** | Evidence & CoA | Evidence revision use cases, CoA report revisions, typed measurement ingestion, dispute event ledger | Integration tests: sample vs. lot scope, typed measurement qualifiers, supersession event emission. |
 | **P1.6** | Claim Policy & Invalidation | Claim authoring, evidence linking, human review use cases, atomic cascade invalidation transaction | Concurrency tests: atomic supersession with cascade invalidation, approve vs. supersede serialization. |
 | **P1.7** | Application API & Read Plane | Client-scoped HTTP endpoints, command receipt idempotency, read models for batch/claim detail | API integration tests: UUIDv7 `actionId` idempotency replay, 409 conflict responses, secure multi-tenancy. |
-| **P1.8** | Consumer & Review Integration | Review Hub presentation, template batch pinning resolver, final delivery reel claim verification | End-to-end integration tests: pinned batch resolution to `SceneReferenceBinding`s, fail-closed assembly admission. |
+| **P1.8** | Operator Workspace & Evidence Gate | Review Hub verified-batch operator workspace (`/products`, `/clients/:clientId/products`, dossier inspection), manual accuracy runbook, and Phase 1 evidence gate | Web component/forwarder unit tests, architectural boundary verification, and E2E synthetic batch acceptance. (Note: Campaign template batch pinning resolver, final delivery reel claim verification, and assembly admission gates belong to subsequent consumer integration phases). |
 
 ### 6. Architectural References
 
@@ -267,4 +267,21 @@ Implementation of the contracts specified in ADR 0009 is partitioned across seve
 - Acceptance Fixtures & Counterexamples: [docs/verified-product-evidence-contract-fixtures.md](verified-product-evidence-contract-fixtures.md)
 - ShotPlan & Visual Reference Authority: [ADR 0007](adr/0007-shotplan-previs-h3-routing-architecture.md)
 - Production Review Acceptance Gate: [ADR 0005](adr/0005-production-review-acceptance-gate.md)
+- Phase 1 Workspace Acceptance Matrix: [docs/verified-batch-workspace-acceptance.md](verified-batch-workspace-acceptance.md)
+- Phase 1 Operator Manual Review Runbook: [docs/verified-batch-operator-runbook.md](verified-batch-operator-runbook.md)
+
+### 7. Phase 1 Verified-Batch Operator Workspace (#477 / P1.8)
+
+Issue #477 adds the client-scoped Product/Batches operator workspace to Review Hub, concluding the Phase 1 evidence foundation:
+- **Routing & Workspace**: `/products` (authorized director client chooser), `/clients/:clientId/products` (SKU & Lot workspace), and `/clients/:clientId/products/:skuId/batches/:batchId` (Batch Evidence Dossier).
+- **Deep-Link SKU Verification**: Guard against URL tampering prevents displaying foreign lot data when the route's `skuId` does not match the batch's SKU.
+- **Cryptographic & Safe Inspection**: Displays original SHA-256 digests, byte sizes, MIME types, capture precision, and retention tiers without leaking internal MinIO/S3 bucket keys or storage paths.
+- **Lossless Decimal Notation**: CoA measurement panels and claims preserve exact decimal strings (e.g. `24.5000`) without floating-point coercion or rounding.
+- **Auditable Provenance Dimensions**: Visibly distinguishes `Reported`, `Operator-Attested`, `Operator-Reviewed`, `Independently Sourced`, `Unknown`, and `Blocked` states across batch facts, evidence assets, CoA reports, and product claims.
+- **Separation of Duties**: Enforces the non-self-approval invariant: the operator who records a CoA transcription or proposes a claim cannot approve it.
+- **Acceptance & Operator Runbook**: Automated matrix in [docs/verified-batch-workspace-acceptance.md](verified-batch-workspace-acceptance.md) and manual physical document comparison runbook in [docs/verified-batch-operator-runbook.md](verified-batch-operator-runbook.md).
+
+> [!NOTE]
+> Campaign template batch pinning (`PinnedProductBatchResolution` -> `SceneReferenceBinding`s), downstream delivery reel claim verification, and generative assembly admission remain assigned to subsequent consumer integration phases (outside #477).
+
 
diff --git a/e2e/harness/control-api.ts b/e2e/harness/control-api.ts
index fee126a..11c3ef1 100644
--- a/e2e/harness/control-api.ts
+++ b/e2e/harness/control-api.ts
@@ -1,11 +1,20 @@
 import type { Pool } from "pg";
-import type { ObjectStoragePort, ReviewMediaDeliveryPort } from "@cco/application";
+import { AccessDeniedError } from "@cco/domain";
+import {
+  type ObjectStoragePort,
+  type ReviewMediaDeliveryPort,
+  type ReviewerAuthorizationPort,
+  DEFAULT_DEV_EVIDENCE_STORAGE_POLICY
+} from "@cco/application";
 import {
   PostgresCampaignDeliveryReelQueries,
   PostgresCurrentProductionAttemptQueries,
   PostgresSceneReviewQueries,
   PostgresUnitOfWork,
-  PostgresReferenceAssetRepository
+  PostgresReferenceAssetRepository,
+  PostgresBatchEvidenceDossierQueries,
+  PostgresEvidenceLockCoordinator,
+  OriginalsInspectionAdapter
 } from "@cco/infrastructure";
 import { createControlApiApp, createProductionClientSessionAuthenticator } from "control-api";
 import type { ScenarioPlanningModelClient } from "./scenario-planning-client.js";
@@ -48,9 +57,11 @@ export const testObjectStorage: ObjectStoragePort = {
   }
 };
 
+let activeControlApiBaseUrl = "http://127.0.0.1:8000";
+
 const mockMediaDelivery: ReviewMediaDeliveryPort = {
   generatePresignedReadUrl: async (locator) =>
-    `http://mock-storage/${locator.bucket}/${locator.key}`
+    `${activeControlApiBaseUrl}/test-media/${locator.bucket}/${locator.key}`
 };
 
 export interface TestControlApi {
@@ -68,6 +79,28 @@ export async function startTestControlApi(options: {
   const currentProductionAttemptQueries = new PostgresCurrentProductionAttemptQueries(options.pool);
   const campaignDeliveryReelQueries = new PostgresCampaignDeliveryReelQueries(options.pool);
   const referenceAssetRepository = new PostgresReferenceAssetRepository(options.pool);
+  const batchEvidenceDossierQueries = new PostgresBatchEvidenceDossierQueries(options.pool);
+  const evidenceLockCoordinator = new PostgresEvidenceLockCoordinator(options.pool);
+  const originalsInspection = new OriginalsInspectionAdapter();
+  const reviewerAuthorization: ReviewerAuthorizationPort = {
+    assertCanReviewCoaReport: async (_clientId, actorId) => {
+      if (actorId === "author@test.internal") {
+        throw new AccessDeniedError(`Actor "${actorId}" is not authorized to review CoA reports.`);
+      }
+    },
+    assertCanReviewClaim: async (_clientId, actorId) => {
+      if (actorId === "author@test.internal") {
+        throw new AccessDeniedError(
+          `Actor "${actorId}" is not authorized to review product claims.`
+        );
+      }
+    },
+    assertCanVerifyEvidence: async (_clientId, actorId) => {
+      if (actorId === "author@test.internal") {
+        throw new AccessDeniedError(`Actor "${actorId}" is not authorized to verify evidence.`);
+      }
+    }
+  };
 
   const app = createControlApiApp(
     {
@@ -77,6 +110,10 @@ export async function startTestControlApi(options: {
       campaignDeliveryReelQueries,
       objectStorage: testObjectStorage,
       reviewMediaDelivery: mockMediaDelivery,
+      batchEvidenceDossierQueries,
+      evidenceLockCoordinator,
+      originalsInspection,
+      reviewerAuthorization,
       planningModelClients: {
         primary: options.planningStub,
         fallback: {
@@ -84,11 +121,19 @@ export async function startTestControlApi(options: {
           complete: (req) => options.planningStub.complete(req)
         }
       },
-      referenceAssetRepository
+      referenceAssetRepository,
+      evidenceStoragePolicy: DEFAULT_DEV_EVIDENCE_STORAGE_POLICY
     },
     {
       reviewerIdentityResolver: {
-        resolve: () => "Integration Test Director"
+        resolve: (req) => {
+          const headers = req?.headers as Record<string, string | undefined> | undefined;
+          return (
+            headers?.["tailscale-user-login"] ||
+            headers?.["x-test-actor-id"] ||
+            "author@test.internal"
+          );
+        }
       },
       clientSessionAuthenticator: createProductionClientSessionAuthenticator({
         secret: TEST_CLIENT_SESSION_SECRET,
@@ -98,9 +143,24 @@ export async function startTestControlApi(options: {
     }
   );
 
+  app.get("/test-media/:bucket/*", async (req, reply) => {
+    const { bucket } = req.params as { bucket: string };
+    const key = (req.params as Record<string, string>)["*"];
+    const item = inMemoryStorage.get(`${bucket}/${key}`);
+    if (!item) {
+      reply.code(404).send({ error: "Media not found" });
+      return;
+    }
+    if (item.contentType) {
+      reply.header("content-type", item.contentType);
+    }
+    reply.send(Buffer.from(item.body));
+  });
+
   await app.listen({ port: 0, host: "127.0.0.1" });
   const address = app.server.address() as AddressInfo;
   const controlApiBaseUrl = `http://127.0.0.1:${address.port}`;
+  activeControlApiBaseUrl = controlApiBaseUrl;
 
   return {
     app,
diff --git a/e2e/harness/mock-bin/tailscale b/e2e/harness/mock-bin/tailscale
index c42125e..68acfeb 100755
--- a/e2e/harness/mock-bin/tailscale
+++ b/e2e/harness/mock-bin/tailscale
@@ -19,8 +19,23 @@ if (args[0] === "whois" && args[1] === "--json") {
     process.exit(1);
   }
 
-  const login = process.env.TEST_REVIEWER_LOGIN || "Integration Test Director";
-  const displayName = process.env.TEST_REVIEWER_DISPLAY_NAME || "Integration Test Director";
+  let login = process.env.TEST_REVIEWER_LOGIN;
+  let displayName = process.env.TEST_REVIEWER_DISPLAY_NAME;
+
+  if (!login) {
+    if (ip === "100.64.0.2") {
+      login = "reviewer@test.internal";
+      displayName = displayName || "Integration Test Reviewer";
+    } else if (ip === "100.64.0.1") {
+      login = "author@test.internal";
+      displayName = displayName || "Integration Test Author";
+    } else {
+      login = "author@test.internal";
+      displayName = displayName || "Integration Test Author";
+    }
+  } else {
+    displayName = displayName || login;
+  }
 
   console.log(
     JSON.stringify({
diff --git a/e2e/harness/web-server.ts b/e2e/harness/web-server.ts
index 4a8340e..8d4e5b1 100644
--- a/e2e/harness/web-server.ts
+++ b/e2e/harness/web-server.ts
@@ -86,7 +86,9 @@ export async function startTestWebServer(options: {
         CONTROL_API_URL: options.controlApiBaseUrl,
         CONTROL_API_CLIENT_SESSION_SECRET: TEST_CLIENT_SESSION_SECRET,
         REVIEW_HUB_DIRECTOR_CLIENT_MAPPINGS: JSON.stringify({
-          "integration test director": ["*"]
+          "integration test director": ["*"],
+          "author@test.internal": ["*"],
+          "reviewer@test.internal": ["*"]
         }),
         NODE_ENV: "production"
       }
```

Fix diff since previous review:

```diff
diff --git a/apps/web/src/app/page.tsx b/apps/web/src/app/page.tsx
index 24f7e0f..22c1af9 100644
--- a/apps/web/src/app/page.tsx
+++ b/apps/web/src/app/page.tsx
@@ -30,10 +30,18 @@ export default async function HomePage() {
           </div>
         )}
       </div>
-      <div style={{ marginTop: "1.5rem" }}>
+      <div style={{ marginTop: "1.5rem", display: "flex", gap: "1rem" }}>
         <Link href="/campaigns/new" className="stage-draft-button" data-testid="new-campaign-link">
           + New Campaign
         </Link>
+        <Link
+          href="/products"
+          className="stage-draft-button"
+          data-testid="products-workspace-link"
+          style={{ backgroundColor: "var(--bg-surface-elevated)" }}
+        >
+          Products &amp; Batches
+        </Link>
       </div>
     </section>
   );
diff --git a/docs/CONTEXT.md b/docs/CONTEXT.md
index d7fb062..08af74a 100644
--- a/docs/CONTEXT.md
+++ b/docs/CONTEXT.md
@@ -259,7 +259,7 @@ Implementation of the contracts specified in ADR 0009 is partitioned across seve
 | **P1.5** | Evidence & CoA | Evidence revision use cases, CoA report revisions, typed measurement ingestion, dispute event ledger | Integration tests: sample vs. lot scope, typed measurement qualifiers, supersession event emission. |
 | **P1.6** | Claim Policy & Invalidation | Claim authoring, evidence linking, human review use cases, atomic cascade invalidation transaction | Concurrency tests: atomic supersession with cascade invalidation, approve vs. supersede serialization. |
 | **P1.7** | Application API & Read Plane | Client-scoped HTTP endpoints, command receipt idempotency, read models for batch/claim detail | API integration tests: UUIDv7 `actionId` idempotency replay, 409 conflict responses, secure multi-tenancy. |
-| **P1.8** | Consumer & Review Integration | Review Hub presentation, template batch pinning resolver, final delivery reel claim verification | End-to-end integration tests: pinned batch resolution to `SceneReferenceBinding`s, fail-closed assembly admission. |
+| **P1.8** | Operator Workspace & Evidence Gate | Review Hub verified-batch operator workspace (`/products`, `/clients/:clientId/products`, dossier inspection), manual accuracy runbook, and Phase 1 evidence gate | Web component/forwarder unit tests, architectural boundary verification, and E2E synthetic batch acceptance. (Note: Campaign template batch pinning resolver, final delivery reel claim verification, and assembly admission gates belong to subsequent consumer integration phases). |
 
 ### 6. Architectural References
 
@@ -267,4 +267,21 @@ Implementation of the contracts specified in ADR 0009 is partitioned across seve
 - Acceptance Fixtures & Counterexamples: [docs/verified-product-evidence-contract-fixtures.md](verified-product-evidence-contract-fixtures.md)
 - ShotPlan & Visual Reference Authority: [ADR 0007](adr/0007-shotplan-previs-h3-routing-architecture.md)
 - Production Review Acceptance Gate: [ADR 0005](adr/0005-production-review-acceptance-gate.md)
+- Phase 1 Workspace Acceptance Matrix: [docs/verified-batch-workspace-acceptance.md](verified-batch-workspace-acceptance.md)
+- Phase 1 Operator Manual Review Runbook: [docs/verified-batch-operator-runbook.md](verified-batch-operator-runbook.md)
+
+### 7. Phase 1 Verified-Batch Operator Workspace (#477 / P1.8)
+
+Issue #477 adds the client-scoped Product/Batches operator workspace to Review Hub, concluding the Phase 1 evidence foundation:
+- **Routing & Workspace**: `/products` (authorized director client chooser), `/clients/:clientId/products` (SKU & Lot workspace), and `/clients/:clientId/products/:skuId/batches/:batchId` (Batch Evidence Dossier).
+- **Deep-Link SKU Verification**: Guard against URL tampering prevents displaying foreign lot data when the route's `skuId` does not match the batch's SKU.
+- **Cryptographic & Safe Inspection**: Displays original SHA-256 digests, byte sizes, MIME types, capture precision, and retention tiers without leaking internal MinIO/S3 bucket keys or storage paths.
+- **Lossless Decimal Notation**: CoA measurement panels and claims preserve exact decimal strings (e.g. `24.5000`) without floating-point coercion or rounding.
+- **Auditable Provenance Dimensions**: Visibly distinguishes `Reported`, `Operator-Attested`, `Operator-Reviewed`, `Independently Sourced`, `Unknown`, and `Blocked` states across batch facts, evidence assets, CoA reports, and product claims.
+- **Separation of Duties**: Enforces the non-self-approval invariant: the operator who records a CoA transcription or proposes a claim cannot approve it.
+- **Acceptance & Operator Runbook**: Automated matrix in [docs/verified-batch-workspace-acceptance.md](verified-batch-workspace-acceptance.md) and manual physical document comparison runbook in [docs/verified-batch-operator-runbook.md](verified-batch-operator-runbook.md).
+
+> [!NOTE]
+> Campaign template batch pinning (`PinnedProductBatchResolution` -> `SceneReferenceBinding`s), downstream delivery reel claim verification, and generative assembly admission remain assigned to subsequent consumer integration phases (outside #477).
+
 
diff --git a/e2e/harness/control-api.ts b/e2e/harness/control-api.ts
index fee126a..11c3ef1 100644
--- a/e2e/harness/control-api.ts
+++ b/e2e/harness/control-api.ts
@@ -1,11 +1,20 @@
 import type { Pool } from "pg";
-import type { ObjectStoragePort, ReviewMediaDeliveryPort } from "@cco/application";
+import { AccessDeniedError } from "@cco/domain";
+import {
+  type ObjectStoragePort,
+  type ReviewMediaDeliveryPort,
+  type ReviewerAuthorizationPort,
+  DEFAULT_DEV_EVIDENCE_STORAGE_POLICY
+} from "@cco/application";
 import {
   PostgresCampaignDeliveryReelQueries,
   PostgresCurrentProductionAttemptQueries,
   PostgresSceneReviewQueries,
   PostgresUnitOfWork,
-  PostgresReferenceAssetRepository
+  PostgresReferenceAssetRepository,
+  PostgresBatchEvidenceDossierQueries,
+  PostgresEvidenceLockCoordinator,
+  OriginalsInspectionAdapter
 } from "@cco/infrastructure";
 import { createControlApiApp, createProductionClientSessionAuthenticator } from "control-api";
 import type { ScenarioPlanningModelClient } from "./scenario-planning-client.js";
@@ -48,9 +57,11 @@ export const testObjectStorage: ObjectStoragePort = {
   }
 };
 
+let activeControlApiBaseUrl = "http://127.0.0.1:8000";
+
 const mockMediaDelivery: ReviewMediaDeliveryPort = {
   generatePresignedReadUrl: async (locator) =>
-    `http://mock-storage/${locator.bucket}/${locator.key}`
+    `${activeControlApiBaseUrl}/test-media/${locator.bucket}/${locator.key}`
 };
 
 export interface TestControlApi {
@@ -68,6 +79,28 @@ export async function startTestControlApi(options: {
   const currentProductionAttemptQueries = new PostgresCurrentProductionAttemptQueries(options.pool);
   const campaignDeliveryReelQueries = new PostgresCampaignDeliveryReelQueries(options.pool);
   const referenceAssetRepository = new PostgresReferenceAssetRepository(options.pool);
+  const batchEvidenceDossierQueries = new PostgresBatchEvidenceDossierQueries(options.pool);
+  const evidenceLockCoordinator = new PostgresEvidenceLockCoordinator(options.pool);
+  const originalsInspection = new OriginalsInspectionAdapter();
+  const reviewerAuthorization: ReviewerAuthorizationPort = {
+    assertCanReviewCoaReport: async (_clientId, actorId) => {
+      if (actorId === "author@test.internal") {
+        throw new AccessDeniedError(`Actor "${actorId}" is not authorized to review CoA reports.`);
+      }
+    },
+    assertCanReviewClaim: async (_clientId, actorId) => {
+      if (actorId === "author@test.internal") {
+        throw new AccessDeniedError(
+          `Actor "${actorId}" is not authorized to review product claims.`
+        );
+      }
+    },
+    assertCanVerifyEvidence: async (_clientId, actorId) => {
+      if (actorId === "author@test.internal") {
+        throw new AccessDeniedError(`Actor "${actorId}" is not authorized to verify evidence.`);
+      }
+    }
+  };
 
   const app = createControlApiApp(
     {
@@ -77,6 +110,10 @@ export async function startTestControlApi(options: {
       campaignDeliveryReelQueries,
       objectStorage: testObjectStorage,
       reviewMediaDelivery: mockMediaDelivery,
+      batchEvidenceDossierQueries,
+      evidenceLockCoordinator,
+      originalsInspection,
+      reviewerAuthorization,
       planningModelClients: {
         primary: options.planningStub,
         fallback: {
@@ -84,11 +121,19 @@ export async function startTestControlApi(options: {
           complete: (req) => options.planningStub.complete(req)
         }
       },
-      referenceAssetRepository
+      referenceAssetRepository,
+      evidenceStoragePolicy: DEFAULT_DEV_EVIDENCE_STORAGE_POLICY
     },
     {
       reviewerIdentityResolver: {
-        resolve: () => "Integration Test Director"
+        resolve: (req) => {
+          const headers = req?.headers as Record<string, string | undefined> | undefined;
+          return (
+            headers?.["tailscale-user-login"] ||
+            headers?.["x-test-actor-id"] ||
+            "author@test.internal"
+          );
+        }
       },
       clientSessionAuthenticator: createProductionClientSessionAuthenticator({
         secret: TEST_CLIENT_SESSION_SECRET,
@@ -98,9 +143,24 @@ export async function startTestControlApi(options: {
     }
   );
 
+  app.get("/test-media/:bucket/*", async (req, reply) => {
+    const { bucket } = req.params as { bucket: string };
+    const key = (req.params as Record<string, string>)["*"];
+    const item = inMemoryStorage.get(`${bucket}/${key}`);
+    if (!item) {
+      reply.code(404).send({ error: "Media not found" });
+      return;
+    }
+    if (item.contentType) {
+      reply.header("content-type", item.contentType);
+    }
+    reply.send(Buffer.from(item.body));
+  });
+
   await app.listen({ port: 0, host: "127.0.0.1" });
   const address = app.server.address() as AddressInfo;
   const controlApiBaseUrl = `http://127.0.0.1:${address.port}`;
+  activeControlApiBaseUrl = controlApiBaseUrl;
 
   return {
     app,
diff --git a/e2e/harness/mock-bin/tailscale b/e2e/harness/mock-bin/tailscale
index c42125e..68acfeb 100755
--- a/e2e/harness/mock-bin/tailscale
+++ b/e2e/harness/mock-bin/tailscale
@@ -19,8 +19,23 @@ if (args[0] === "whois" && args[1] === "--json") {
     process.exit(1);
   }
 
-  const login = process.env.TEST_REVIEWER_LOGIN || "Integration Test Director";
-  const displayName = process.env.TEST_REVIEWER_DISPLAY_NAME || "Integration Test Director";
+  let login = process.env.TEST_REVIEWER_LOGIN;
+  let displayName = process.env.TEST_REVIEWER_DISPLAY_NAME;
+
+  if (!login) {
+    if (ip === "100.64.0.2") {
+      login = "reviewer@test.internal";
+      displayName = displayName || "Integration Test Reviewer";
+    } else if (ip === "100.64.0.1") {
+      login = "author@test.internal";
+      displayName = displayName || "Integration Test Author";
+    } else {
+      login = "author@test.internal";
+      displayName = displayName || "Integration Test Author";
+    }
+  } else {
+    displayName = displayName || login;
+  }
 
   console.log(
     JSON.stringify({
diff --git a/e2e/harness/web-server.ts b/e2e/harness/web-server.ts
index 4a8340e..8d4e5b1 100644
--- a/e2e/harness/web-server.ts
+++ b/e2e/harness/web-server.ts
@@ -86,7 +86,9 @@ export async function startTestWebServer(options: {
         CONTROL_API_URL: options.controlApiBaseUrl,
         CONTROL_API_CLIENT_SESSION_SECRET: TEST_CLIENT_SESSION_SECRET,
         REVIEW_HUB_DIRECTOR_CLIENT_MAPPINGS: JSON.stringify({
-          "integration test director": ["*"]
+          "integration test director": ["*"],
+          "author@test.internal": ["*"],
+          "reviewer@test.internal": ["*"]
         }),
         NODE_ENV: "production"
       }
```

## REQUIRED OUTPUT CONTRACT

All string values in the JSON output must be valid JSON string literals. If evidence, rationale, summary, or other freeform text (including embedded Markdown such as design_md/plan_md) quotes a code identifier, file path, backslash-containing path, or literal string, escape every `"` as `\"` and every backslash as `\\` inside that value. Do not emit a raw, unescaped `"` or `\` inside a JSON string.

You MUST write your review directly to `./follow-up-review-result.json`.
Writing your verdict or evaluations as markdown prose, stdout output, or conversational summaries CANNOT replace `./follow-up-review-result.json`. If `./follow-up-review-result.json` is missing or fails JSON/schema validation, this phase fails contract validation.

### Allowed Verdict Values
The `verdict` field must be exactly one of the following accepted enum literals:
- `APPROVE`
- `REQUEST_CHANGES`
- `approve`
- `request_changes`
- `PASS`
- `FAIL`
- `pass`
- `fail`

CRITICAL: The literal `"APPROVED"` is NOT valid and will cause schema validation rejection. You must use `"APPROVE"` (or `"REQUEST_CHANGES"`).

### JSON Schema & Field Requirements
Write valid JSON to `./follow-up-review-result.json` matching the schema:
- `verdict` (string, required): Exactly one of the accepted enum literals above (`"APPROVE"` or `"REQUEST_CHANGES"`).
- `evaluations` (array of objects, default: `[]`):
  For each finding in the ledger:
  - `finding_id` (string, required, non-empty): Exact finding ID from the ledger.
  - `resolved` (boolean, required): `true` if verified resolved, `false` otherwise.
  - `evidence` (string, required, non-empty): Concrete file:line citations and verification evidence.
  - `rationale` (string, optional): Context or explanation for the evaluation.
- `new_findings` (array of objects, optional, default: `[]`): Any new defects or regressions discovered.
- `summary` (string, optional): High-level summary of the follow-up review.
- `review_md` (string, optional): Markdown-formatted review notes.

```json
{
  "verdict": "APPROVE",
  "evaluations": [
    {
      "finding_id": "Finding ID from ledger",
      "resolved": true,
      "evidence": "Evidence citing exact file:line showing resolution",
      "rationale": "Optional explanation"
    }
  ],
  "new_findings": [
    {
      "severity": "critical",
      "files": ["path/to/file.ts"],
      "evidence": "Concrete evidence",
      "rationale": "Why this matters",
      "minimal_correction": "Smallest correction",
      "blocking": true
    }
  ],
  "summary": "Summary of follow-up review."
}
```

## TASK

Perform a focused follow-up review grounded in the issue, acceptance criteria, design, accumulated finding ledger, and diffs above.

Your responsibilities:

1. **Evaluate Prior Findings**:
   - For every unresolved finding in the accumulated finding ledger, evaluate whether it is now `resolved: true` or `resolved: false`.
   - Do not evaluate resolution solely from the fix diff or from new/changed tests near the finding's originally cited files. A fix diff shows what changed; it does not show what the finding actually required to be true. Independently trace the finding's full causal chain — from the root symptom described in its `rationale` through to the actual runtime behavior it concerns — even when that chain passes through files the fix diff did not touch.
   - When proving a prior finding resolved, trace that finding through any authoritative production artifacts (e.g. repository-owned runtime configuration, templates, profiles, schemas, workflows, migrations, contracts) that materially participate in its causal chain. Inspect only the production artifacts materially required by those causal chains to keep the follow-up review focused.
   - Synthetic tests or constructed fixtures are supporting evidence only and cannot establish resolution when they materially differ from authoritative production artifacts or construct configurations absent from production.
   - A finding is not resolved merely because validation now accepts the input, a type now allows the field, or a new test asserts an intermediate value (e.g. a value is recorded in an output object). Confirm the underlying guarantee stated in the finding's rationale actually holds at the point where it matters (e.g. if the finding is about a value being _used_, not just accepted or recorded, verify the code path that consumes it was actually changed).
   - A finding resolution is not correct if it merely changes the failure mode or converts one failure into an unavoidable downstream failure, leaving the supported production configuration internally unsatisfiable. Confirm that at least one valid end-to-end success path exists under the actual supported production configuration for the corrected behavior.
   - For capability-dependent behavior touched by the finding, confirm consistency among declared capabilities, validation rules, runtime behavior, and output/provenance contracts when materially relevant.
   - **External Authority vs. Check Manipulation (Anti-Goodhart)**:
     - Distinguish "the code/data was changed to make the check pass" from "the underlying real-world condition was verified or established".
     - For any finding whose blocking condition traces to an external authority (legal sign-off, commercial licensing review, physical hardware/certification, human operator action) rather than a code defect: automated code changes or self-authored metadata changes CANNOT resolve the finding.
     - A finding is NOT resolved if the fixer modified production compliance registries, license registries, security exception lists, or governance metadata (e.g. flipping `review_required` or `blocked` to `approved` with self-authored notes or without external authority). Such modifications constitute fabricated compliance data rather than genuine resolution.
     - If the fix diff alters production governance/licensing registries without external authority, or weakens fail-closed compliance gates to make a test pass:
       - Mark the prior finding `resolved: false`.
       - Flag a NEW critical/high-severity blocking finding citing compliance data fabrication or weakening fail-closed policy.
       - Set verdict to `REQUEST_CHANGES`.
   - Cite the exact file/line(s) that establish the full chain is closed — not just the file/line(s) the fix diff touched — as your evidence.
2. **Detect Material Regressions or Exposed Gaps**:
   - Verify that the fix did not introduce material regressions, expose new gaps violating the issue's requirements or Acceptance Criteria, or leave the supported production configuration in an unsatisfiable state.
   - Do not turn follow-up review into an unrestricted second whole-change review; keep new discoveries anchored to the fix and the requirements.
   - Do not manufacture findings or raise unrelated stylistic preferences.
3. **Verdict**:
   - `APPROVE` if all previous blocking findings are resolved and no new blocking defects exist.
   - `REQUEST_CHANGES` if any finding remains unresolved or a new material defect was introduced.

### Workspace Bookkeeping (Do Not Flag)

If you inspect `git status` or the worktree directly, you will see untracked files. The orchestrator pipeline itself writes and reads its own bookkeeping files across phases; the exact ones currently present are listed below.

(none currently untracked in this worktree)

This exemption is narrow: it applies only to the exact untracked paths listed, as they exist right now. It does not extend to tracked files (even ones with the same name), to any content or behavior change in the branch diff, or to `.gitignore`/`.prettierignore` modifications — an implementation change that widens an ignore file to hide unrelated untracked output is still a real finding and must be evaluated normally. A prior finding about scope/hygiene is resolved on this basis only when its own cited evidence was solely the presence of these exact listed paths.

## CRITICAL RULES

- This is a read-only review. Do not modify source code or create scratch files in the worktree.
- Do not switch git branches.
- Do not ask questions.
- Write `./follow-up-review-result.json` before stopping.
- Markdown prose, stdout output, or comments cannot substitute for `./follow-up-review-result.json`.
- If `./follow-up-review-result.json` already exists and needs revision (e.g. a second pass over your own review found something new), rewrite the entire file from scratch. Do not patch/diff-edit it — context-based patch tools are unreliable against large JSON arrays, since they require reproducing exact surrounding text; a failed or partial patch application can silently corrupt the file.


## CORRECTION REQUIRED (Attempt 2 of 2)

Your previous review attempt failed contract validation:
- **Failure category:** schema_violation
- **Required artifact path:** ./follow-up-review-result.json
- **Diagnostic detail:**
```
[
  {
    "code": "invalid_type",
    "expected": "string",
    "received": "undefined",
    "path": [
      "evaluations",
      0,
      "finding_id"
    ],
    "message": "Required"
  },
  {
    "code": "invalid_type",
    "expected": "string",
    "received": "undefined",
    "path": [
      "evaluations",
      0,
      "evidence"
    ],
    "message": "Required"
  },
  {
    "code": "invalid_type",
    "expected": "string",
    "received": "undefined",
    "path": [
      "evaluations",
      1,
      "finding_id"
    ],
    "message": "Required"
  },
  {
    "code": "invalid_type",
    "expected": "string",
    "received": "undefined",
    "path": [
      "evaluations",
      1,
      "evidence"
    ],
    "message": "Required"
  },
  {
    "code": "invalid_type",
    "expected": "string",
    "received": "undefined",
    "path": [
      "evaluations",
      2,
      "finding_id"
    ],
    "message": "Required"
  },
  {
    "code": "invalid_type",
    "expected": "string",
    "received": "undefined",
    "path": [
      "evaluations",
      2,
      "evidence"
    ],
    "message": "Required"
  },
  {
    "code": "invalid_type",
    "expected": "string",
    "received": "undefined",
    "path": [
      "evaluations",
      3,
      "finding_id"
    ],
    "message": "Required"
  },
  {
    "code": "invalid_type",
    "expected": "string",
    "received": "undefined",
    "path": [
      "evaluations",
      3,
      "evidence"
    ],
    "message": "Required"
  },
  {
    "code": "invalid_type",
    "expected": "string",
    "received": "undefined",
    "path": [
      "evaluations",
      4,
      "finding_id"
    ],
    "message": "Required"
  },
  {
    "code": "invalid_type",
    "expected": "string",
    "received": "undefined",
    "path": [
      "evaluations",
      4,
      "evidence"
    ],
    "message": "Required"
  },
  {
    "code": "invalid_type",
    "expected": "string",
    "received": "undefined",
    "path": [
      "evaluations",
      5,
      "finding_id"
    ],
    "message": "Required"
  },
  {
    "code": "invalid_type",
    "expected": "string",
    "received": "undefined",
    "path": [
      "evaluations",
      5,
      "evidence"
    ],
    "message": "Required"
  },
  {
    "code": "invalid_type",
    "expected": "string",
    "received": "undefined",
    "path": [
      "evaluations",
      6,
      "finding_id"
    ],
    "message": "Required"
  },
  {
    "code": "invalid_type",
    "expected": "string",
    "received": "undefined",
    "path": [
      "evaluations",
      6,
      "evidence"
    ],
    "message": "Required"
  },
  {
    "code": "invalid_type",
    "expected": "string",
    "received": "undefined",
    "path": [
      "evaluations",
      7,
      "finding_id"
    ],
    "message": "Required"
  },
  {
    "code": "invalid_type",
    "expected": "string",
    "received": "undefined",
    "path": [
      "evaluations",
      7,
      "evidence"
    ],
    "message": "Required"
  },
  {
    "code": "invalid_type",
    "expected": "string",
    "received": "undefined",
    "path": [
      "evaluations",
      8,
      "finding_id"
    ],
    "message": "Required"
  },
  {
    "code": "invalid_type",
    "expected": "string",
    "received": "undefined",
    "path": [
      "evaluations",
      8,
      "evidence"
    ],
    "message": "Required"
  },
  {
    "code": "invalid_type",
    "expected": "string",
    "received": "undefined",
    "path": [
      "evaluations",
      9,
      "finding_id"
    ],
    "message": "Required"
  },
  {
    "code": "invalid_type",
    "expected": "string",
    "received": "undefined",
    "path": [
      "evaluations",
      9,
      "evidence"
    ],
    "message": "Required"
  },
  {
    "code": "invalid_type",
    "expected": "string",
    "received": "undefined",
    "path": [
      "evaluations",
      10,
      "finding_id"
    ],
    "message": "Required"
  },
  {
    "code": "invalid_type",
    "expected": "string",
    "received": "undefined",
    "path": [
      "evaluations",
      10,
      "evidence"
    ],
    "message": "Required"
  },
  {
    "code": "invalid_type",
    "expected": "string",
    "received": "undefined",
    "path": [
      "evaluations",
      11,
      "finding_id"
    ],
    "message": "Required"
  },
  {
    "code": "invalid_type",
    "expected": "string",
    "received": "undefined",
    "path": [
      "evaluations",
      11,
      "evidence"
    ],
    "message": "Required"
  },
  {
    "code": "invalid_type",
    "expected": "string",
    "received": "undefined",
    "path": [
      "evaluations",
      12,
      "finding_id"
    ],
    "message": "Required"
  },
  {
    "code": "invalid_type",
    "expected": "string",
    "received": "undefined",
    "path": [
      "evaluations",
      12,
      "evidence"
    ],
    "message": "Required"
  },
  {
    "code": "invalid_type",
    "expected": "string",
    "received": "undefined",
    "path": [
      "evaluations",
      13,
      "finding_id"
    ],
    "message": "Required"
  },
  {
    "code": "invalid_type",
    "expected": "string",
    "received": "undefined",
    "path": [
      "evaluations",
      13,
      "evidence"
    ],
    "message": "Required"
  },
  {
    "code": "invalid_type",
    "expected": "string",
    "received": "undefined",
    "path": [
      "evaluations",
      14,
      "finding_id"
    ],
    "message": "Required"
  },
  {
    "code": "invalid_type",
    "expected": "string",
    "received": "undefined",
    "path": [
      "evaluations",
      14,
      "evidence"
    ],
    "message": "Required"
  },
  {
    "code": "invalid_type",
    "expected": "string",
    "received": "undefined",
    "path": [
      "evaluations",
      15,
      "finding_id"
    ],
    "message": "Required"
  },
  {
    "code": "invalid_type",
    "expected": "string",
    "received": "undefined",
    "path": [
      "evaluations",
      15,
      "evidence"
    ],
    "message": "Required"
  },
  {
    "code": "invalid_type",
    "expected": "string",
    "received": "undefined",
    "path": [
      "evaluations",
      16,
      "finding_id"
    ],
    "message": "Required"
  },
  {
    "code": "invalid_type",
    "expected": "string",
    "received": "undefined",
    "path": [
      "evaluations",
      16,
      "evidence"
    ],
    "message": "Required"
  },
  {
    "code": "invalid_type",
    "expected": "string",
    "received": "undefined",
    "path": [
      "evaluations",
      17,
      "finding_id"
    ],
    "message": "Required"
  },
  {
    "code": "invalid_type",
    "expected": "string",
    "received": "undefined",
    "path": [
      "evaluations",
      17,
      "evidence"
    ],
    "message": "Required"
  },
  {
    "code": "invalid_type",
    "expected": "string",
    "received": "undefined",
    "path": [
      "evaluations",
      18,
      "finding_id"
    ],
    "message": "Required"
  },
  {
    "code": "invalid_type",
    "expected": "string",
    "received": "undefined",
    "path": [
      "evaluations",
      18,
      "evidence"
    ],
    "message": "Required"
  },
  {
    "code": "invalid_type",
    "expected": "string",
    "received": "undefined",
    "path": [
      "evaluations",
      19,
      "finding_id"
    ],
    "message": "Required"
  },
  {
    "code": "invalid_type",
    "expected": "string",
    "received": "undefined",
    "path": [
      "evaluations",
      19,
      "evidence"
    ],
    "message": "Required"
  },
  {
    "code": "invalid_type",
    "expected": "string",
    "received": "undefined",
    "path": [
      "evaluations",
      20,
      "finding_id"
    ],
    "message": "Required"
  },
  {
    "code": "invalid_type",
    "expected": "string",
    "received": "undefined",
    "path": [
      "evaluations",
      20,
      "evidence"
    ],
    "message": "Required"
  },
  {
    "code": "invalid_type",
    "expected": "string",
    "received": "undefined",
    "path": [
      "evaluations",
      21,
      "finding_id"
    ],
    "message": "Required"
  },
  {
    "code": "invalid_type",
    "expected": "string",
    "received": "undefined",
    "path": [
      "evaluations",
      21,
      "evidence"
    ],
    "message": "Required"
  },
  {
    "code": "invalid_type",
    "expected": "string",
    "received": "undefined",
    "path": [
      "evaluations",
      22,
      "finding_id"
    ],
    "message": "Required"
  },
  {
    "code": "invalid_type",
    "expected": "string",
    "received": "undefined",
    "path": [
      "evaluations",
      22,
      "evidence"
    ],
    "message": "Required"
  },
  {
    "code": "invalid_type",
    "expected": "string",
    "received": "undefined",
    "path": [
      "evaluations",
      23,
      "finding_id"
    ],
    "message": "Required"
  },
  {
    "code": "invalid_type",
    "expected": "string",
    "received": "undefined",
    "path": [
      "evaluations",
      23,
      "evidence"
    ],
    "message": "Required"
  },
  {
    "code": "invalid_type",
    "expected": "string",
    "received": "undefined",
    "path": [
      "evaluations",
      24,
      "finding_id"
    ],
    "message": "Required"
  },
  {
    "code": "invalid_type",
    "expected": "string",
    "received": "undefined",
    "path": [
      "evaluations",
      24,
      "evidence"
    ],
    "message": "Required"
  },
  {
    "code": "invalid_type",
    "expected": "string",
    "received": "undefined",
    "path": [
      "evaluations",
      25,
      "finding_id"
    ],
    "message": "Required"
  },
  {
    "code": "invalid_type",
    "expected": "string",
    "received": "undefined",
    "path": [
      "evaluations",
      25,
      "evidence"
    ],
    "message": "Required"
  },
  {
    "code": "invalid_type",
    "expected": "string",
    "received": "undefined",
    "path": [
      "evaluations",
      26,
      "finding_id"
    ],
    "message": "Required"
  },
  {
    "code": "invalid_type",
    "expected": "string",
    "received": "undefined",
    "path": [
      "evaluations",
      26,
      "evidence"
    ],
    "message": "Required"
  },
  {
    "code": "invalid_type",
    "expected": "string",
    "received": "undefined",
    "path": [
      "evaluations",
      27,
      "finding_id"
    ],
    "message": "Required"
  },
  {
    "code": "invalid_type",
    "expected": "string",
    "received": "undefined",
    "path": [
      "evaluations",
      27,
      "evidence"
    ],
    "message": "Required"
  },
  {
    "code": "invalid_type",
    "expected": "string",
    "received": "undefined",
    "path": [
      "evaluations",
      28,
      "finding_id"
    ],
    "message": "Required"
  },
  {
    "code": "invalid_type",
    "expected": "string",
    "received": "undefined",
    "path": [
      "evaluations",
      28,
      "evidence"
    ],
    "message": "Required"
  },
  {
    "code": "invalid_type",
    "expected": "string",
    "received": "undefined",
    "path": [
      "evaluations",
      29,
      "finding_id"
    ],
    "message": "Required"
  },
  {
    "code": "invalid_type",
    "expected": "string",
    "received": "undefined",
    "path": [
      "evaluations",
      29,
      "evidence"
    ],
    "message": "Required"
  },
  {
    "code": "invalid_type",
    "expected": "string",
    "received": "undefined",
    "path": [
      "evaluations",
      30,
      "finding_id"
    ],
    "message": "Required"
  },
  {
    "code": "invalid_type",
    "expected": "string",
    "received": "undefined",
    "path": [
      "evaluations",
      30,
      "evidence"
    ],
    "message": "Required"
  }
]
```

### Allowed Verdict Values
The `verdict` field must be exactly one of the following accepted enum literals:
- `APPROVE`
- `REQUEST_CHANGES`
- `approve`
- `request_changes`
- `PASS`
- `FAIL`
- `pass`
- `fail`

### Schema Requirements for ./follow-up-review-result.json
You must write a complete, valid JSON artifact directly to ./follow-up-review-result.json. Markdown prose, stdout output, or summary comments cannot substitute for this required JSON file. Inspect the supplied review evidence and produce a complete JSON result.

Field requirements:
- `verdict` (string, required): Exactly one of the accepted enum literals listed above.
- `evaluations` (array of objects, default: `[]`):
  Each evaluation entry must contain:
  - `finding_id` (string, required, non-empty): ID of the evaluated finding from the ledger.
  - `resolved` (boolean, required): `true` if verified resolved, `false` otherwise.
  - `evidence` (string, required, non-empty): Concrete evidence verifying resolution or explaining non-resolution.
  - `rationale` (string, optional): Additional context or reasoning.
- `new_findings` (array of objects, optional, default: `[]`): New findings or regressions detected.
- `summary` (string, optional): High-level review summary.
- `review_md` (string, optional): Optional markdown review notes.

Inspect the supplied review evidence and write the complete JSON result to ./follow-up-review-result.json before completing.
