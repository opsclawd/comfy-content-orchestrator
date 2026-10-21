You are performing a follow-up review of code changes made in response to earlier review findings.

## CONTEXT

## WORKSPACE CONSTRAINTS

Your working directory is a dedicated git worktree with the repository's complete history. Run all commands from it. Do NOT cd to or read paths outside this directory — external-directory access is automatically rejected. git log, git diff, etc. work here directly.

.ai-orchestrator.local.json, if one exists, lives only in the main checkout and is intentionally not copied into your worktree — it is operator-machine-specific and not part of your task. Do not search for it or read it outside this directory. Reason about configuration using only .ai-orchestrator.json in your own working directory; treat it as the effective config for your task.

Working directory: /home/gary/.openclaw/workspace/comfy-content-orchestrator/.ai-worktrees/issue-473
Issue number: 473

Issue description & acceptance criteria:
# [469 / VPM-P1.4] Register immutable source EvidenceAssets and derivatives without duplicating ReferenceAsset

Parent: #469 — Phase 1
Depends on: **#470** (authority contract), **#472** (batch persistence). **#474 depends on completion of this evidence registration path.**
Classification: **Autonomous coding + storage integration**; no real operator photography or GPUs needed.

## Goal
Attach authoritative *source-file evidence* to one client/SKU/lot while retaining the existing `ReferenceAsset` system for ready-to-render derivatives. Support macro photographs and lab/process files without pretending that H3-conditioned pixels remain authentic.

## Scope
- New `EvidenceAsset` metadata + repository/port/use cases with client, batchId, source type, exact-byte SHA-256, storage bucket/key, validated MIME, byte count, optional reported capture timestamp, acquisition/rights statement, submitted-by identity, review/verification status, and immutable version/history (per #470).
- Original source is a **different identity from** a display/WebP/JPEG `ReferenceAsset`; optionally link an existing, same-client derivative reference by ID and source hash/transform provenance. Do not mutate `ReferenceAsset` IDs/hashes or make `ReferenceAsset` an attestation of source truth.
- Reuse `ObjectStoragePort`, upload bounds, content sniffing/inspection, conditional write + hash-addressed object keys, race-safe idempotency and safe orphan cleanup patterns from `upload-reference-asset.ts`. PDFs and camera RAW originals require explicit allowlisted MIME/size/security constraints; unsupported formats reject with actionable errors rather than being decoded heuristically.
- Image previews/derivative generation are **not** required; allow registration and linking when valid existing derivatives already exist. Do not leak originals via public URLs or persist presigned URLs.
- Explicit handling of possible multi-use same source hash: avoid duplicate binary storage within permitted tenant scope, but allow distinct **immutable batch-evidence associations** only with separately attested source context, never automatic cross-lot reuse. Report conflicts.
- Register reference to existing file where bytes already present only after verifying storage digest and client ownership; source supersession creates new evidence revision, never replaces old bytes.

## Acceptance
- Exact digest of persisted original is recorded and checked; same key/different bytes, tampered blob, or MIME mismatch fail closed.
- Wrong-client/batch, archived/disputed source, unknown reference derivative, reuse into unrelated lot without explicit attestation, and duplicate upload races are tested.
- Failed DB transaction does not delete blobs referenced by another committed record; failed blob write does not leave a published EvidenceAsset.
- Evidence without trusted capture metadata is stored as *reported/unknown*, not silently marked verified.
- Integration tests use generated synthetic images/docs; validate stable source->reference derivative relationship and no legacy upload regression.
- Document source storage retention classification and recovery/backups; refuse assumed production-ready archival until retention policy is signed off.

## Non-goals
VLM/OCR, photo forgery detection, visual mask/pixel lock, RAW processing pipeline, render-worker changes, new media asset gallery (Phase 2+), legal clearance.

## Execution
Read `packages/application/src/use-cases/upload-reference-asset.ts`, existing ObjectStorage ports and #470.


Issue comments:


Design document:
# Design: immutable source evidence registration (#473)

## Scope and authority

Implement the source registration path required by #473 on top of #470's ADR 0009 and #472's batch registry. The issue is authoritative where its acceptance criteria differ from older examples. Preserve the separation between exact source bytes, submitter assertions, independent verification, batch associations, and visual conditioning authority. Hash verification establishes byte integrity; neither upload success nor H3 conditioning authenticates capture circumstances or product claims.

This slice includes source storage integration, evidence metadata/history, explicit lot associations, optional links to existing derivatives, and the persistence needed to make these operations real. It does not include previews, image conversion, OCR/VLM, RAW decoding, claim authoring/approval, CoA measurements, gallery UI, render-worker changes, or legal clearance. Application use cases and exports are the callable integration surface; HTTP/read-plane work remains with the later API slice.

## Grounded baseline

- `AGENTS.md` requires inward dependency boundaries, append-only evidence, correct integration-test configuration, and no agent-authored certification artifacts. The context file is `docs/CONTEXT.md`; there is no root `CONTEXT.md` in this checkout. Its product-evidence section and ADRs 0001, 0007, and 0009 govern this design.
- Current HEAD includes #470, #471, and #472 (`04367d7`). `026_product_registry.sql` implements SKUs, batches, batch-facts revisions, and `product_evidence_command_receipts`, but no source/evidence tables. Despite its name, `ProductEvidenceRepositoryPort` currently covers product registration only. Evidence enums/entities are specified in ADR 0009 rather than implemented; branded `EvidenceId` and stable evidence error codes already exist.
- `PostgresProductEvidenceRepository` requires a transaction-bound client, locks commands by client/action, checks receipts before mutable-state preconditions, compares canonical payload hash plus command name and actor, and writes receipts within the same transaction. `PostgresUnitOfWork` owns the actual COMMIT/ROLLBACK. Reuse these guarantees.
- `upload-reference-asset.ts` demonstrates client-scoped hash keys, conditional puts, per-key locking, collision byte reads, and ownership-aware cleanup. Its existing-row shortcut skips byte re-verification and reactivates archived references. Those behaviors cannot be copied into source evidence ingestion.
- `ObjectStoragePort` accepts byte buffers and supports bounded/abortable GET, conditional PUT, and optional deletion. `S3ObjectStorage` computes the upload checksum locally and stores a metadata checksum; that metadata is not independent proof of persisted bytes. No streaming PUT or storage version identifier is currently exposed.
- `SharpImageInspectionAdapter` validates JPEG/PNG/WebP with a 10 MiB default and dimension/pixel limits. The legacy HTTP route has an independent 10 MiB body limit. There is no PDF or RAW inspector in the current infrastructure dependencies.
- `reference_assets` lacks the composite candidate key `(client_id, asset_id)` needed for the ADR's derivative foreign key. Add it without changing existing reference identities or hashes.
- Both application/repository guards and `chk_batch_facts_origin_evidence_deferred` currently reject every non-null origin-evidence pointer. This temporary restriction must be replaced with the same-client, same-batch exact-revision FK once evidence links exist.
- Existing buckets cover temp, review, reference, and delivery. Their retention classifications do not establish an original-evidence archive. PRD section 2.3 explicitly describes local MinIO as review/distribution storage, not an unlimited archival vault.

## Identity and immutable history

Implement the ADR's normalized entities rather than adding source-truth fields to `ReferenceAsset`:

1. `SourceObject`: server identity, client, exact lowercase SHA-256, verified MIME, byte count, private bucket/key, upload actor/time, access class `restricted_original`, retention class `source_evidence_archive`, policy version, availability, and nullable storage-version ID. Binary identity/location/classification are immutable. Deduplicate with `(client_id, original_sha256)` and unique bucket/key. Never deduplicate across clients.
2. `EvidenceAsset`: client, identity, current revision, optimistic version, creation/archive timestamps. Only controlled head fields can change.
3. `EvidenceRevision`: immutable source-object reference, source class, acquisition method, authenticated submitter/time, non-empty acquisition/assertion statement, reported capture metadata/context, rights/consent status and attribution, and predecessor. Revision 1 has no predecessor; appends advance exactly one revision and version with `expectedVersion` fencing. A different original produces a new revision referencing a new SourceObject; previous bytes, links, and metadata survive.
4. `BatchEvidenceLink`: immutable exact client/batch/evidence/revision tuple, purpose, actor/time. SKU is resolved through the batch, never trusted from caller metadata. No inheritance from a SKU or sibling lot.
5. `EvidenceDerivative`: immutable bridge from an exact evidence revision to an existing same-client unarchived ReferenceAsset, with its independent digest, transform description, optional tool version, actor/time. Source hash is reachable through the revision and SourceObject; the bridge never rewrites the derivative hash or asserts that transformed pixels are an original.
6. `EvidenceVerificationEvent`: append-only ADR event ledger with outcome, kind, fact scope, method/reason, actor/time and scoped withdrawal reference. Implement the core event representation and eligibility projection needed here; do not implement CoA verification or claim review workflows. No events means unreviewed/unverified. Submitter attestation remains distinguishable from internal review and independent corroboration. An unresolved dispute/rejection blocks new use; a later upload or unrelated positive event cannot erase it.

Use ADR date-only `reportedCaptureDate` when precision is only a date. Also support a nullable reported capture timestamp and explicit precision so an actually supplied time is preserved without inventing midnight or capture verification. Validate consistency when both are supplied; document this additive refinement to ADR 0009. Uploaded EXIF values, if ever exposed, remain reported metadata. Trust state belongs to scoped verification events, not a single mutable verified boolean. Missing capture information is unknown; supplied uncorroborated information is reported.

Use new additive migrations with composite tenant foreign keys, deferred current-head FK, predecessor uniqueness, positive bounds, non-empty text constraints, append-only update/delete protection and restricted application privileges consistent with migration 026. Source availability is mutable without permitting binary metadata replacement. Protect heads from deletion and illegal identity/version transitions. Maintain exact derivative digest consistency against the referenced row through transactional validation; add a trigger for privileged direct-insert integrity where necessary.

## Registration commands and reuse rules

Expose an upload/register application command accepting the trusted `CommandEnvelope`, batch ID, purpose, immutable assertion metadata, and optional derivative metadata. Compute the digest from received bytes rather than accepting a client hash as truth. An existing-source variant accepts a SourceObject ID, never an arbitrary object URL or another tenant's bucket/key. Resolve ownership before storage access and re-read/verify bytes before registration. Supporting recovery of a verified, uncommitted hash-key object uses the same tenant-scoped ingest path, not a generic import-by-key bypass.

Publish SourceObject metadata (when new), evidence head/revision, batch link, optional derivative bridge, quota consumption, and the registration receipt in one DB transaction after persisted-byte verification. Validation or blob-write failure must publish no EvidenceAsset. Source creation is storage deduplication, not automatic evidence publication.

An identical action ID and semantic payload returns the original receipt, even if later history has advanced. Different bytes, metadata, batch, purpose, derivative, command kind, or actor with that action ID produce `IDEMPOTENCY_CONFLICT`. Canonical payloads include the computed original digest/length/MIME and complete assertion context, excluding raw bytes, ephemeral reservations and server-generated entity IDs. Check for a receipt before performing storage side effects; computing an incoming digest is still needed to detect changed-byte replay. Replays do not imply renewed source eligibility and cannot grant a new association.

Distinct actions do not silently manufacture new assertions. Require an explicit registration intent: initial assertion, new batch-specific assertion over an existing source, or supersede with expected version. When a hash is already associated with another lot, default to `CROSS_BATCH_SOURCE`; only explicit reuse with a new non-empty lot-specific attestation and target batch creates a fresh evidence identity/revision and immutable link. Record the reused source identity and reuse intent in the receipt/association context. The same binary may support multiple lots only through these separate assertions. Do not automatically copy an old revision's attestation, rights, verification status, or derivative links to a new lot/revision. Repeating a tuple with changed purpose/context is a conflict; retry identical commands through receipts.

Check active batch/SKU, source availability, evidence head/current revision, unresolved disputes, and derivative ownership/archive/hash inside the publishing transaction under locks. New derivative linking and supersession also re-verify original storage bytes. A source already archived, quarantined, or deleted under retention cannot be revived by ingestion. ADR fixture CE-03B proposes automatic source reactivation; update that example to reflect #473's stricter acceptance. Legacy ReferenceAsset reactivation remains unchanged.

## Storage, integrity, and concurrency

Compose a narrow evidence-storage service over `ObjectStoragePort`, with application ports for inspection, durable quota reservation, and per-source locking. Infrastructure owns S3, parsers and PostgreSQL; domain code owns deterministic invariants. Do not introduce a competing generic storage abstraction or extend all callers for streaming prematurely.

Use a dedicated private originals bucket, proposed `BUCKETS.EVIDENCE`, with keys `clients/{clientId}/evidence/originals/{sha256}`. Add its explicit non-expiring source classification to provisioning constants/tests; do not assign a guessed legal retention duration. Originals are excluded from review-media signing, public ACLs and preview responses. Standard application credentials cannot delete committed originals. Tests use an isolated private bucket and explicit synthetic policy.

The existing port requires bounded buffers. For this slice, accept a bounded byte input (or a bounded stream collector in front of it), incrementally hash received chunks, and preserve their exact bytes; do not claim unbounded streaming support. Reserve client bytes/concurrent-upload capacity before accepting a stream or materializing its buffer; for a buffer command reserve before inspection/write and require a bounded caller. Enforce actual length even when the caller supplies a smaller expected size. Larger streaming media can extend the port later; do not adopt the ADR's illustrative 500 MB limits with the current buffer API.

Under a mandatory cross-process source lock keyed by client/digest, look up existing source metadata and always re-read the persisted object with `maxBytes` and cancellation/deadline limits. Conditional PUT uses `ifNoneMatch: *`. Read back and independently hash every newly written final object, as well as every collision/reused source; verify exact SHA-256, byte length, sniffed MIME, stored content type, and any recorded metadata. Never substitute HEAD metadata or ETag for byte verification. Missing objects, mismatched bytes or MIME fail closed. For existing registered corruption, commit quarantine and its audit separately from the aborted registration so rollback cannot undo the protective state change.

Implement the lock coordinator using a dedicated PostgreSQL session advisory lock through final UoW COMMIT/ROLLBACK and cleanup; a transaction-local lock released before cleanup or a process-local mutex is insufficient. Acquire command lock before source lock, then quota/tenant accounting locks, and deterministic batch -> evidence -> reference locks; sort multiple identities. All registration/reuse/linking paths follow the same order, with bounded timeouts and reliable lock release. Avoid nested UoWs and pool exhaustion: the coordinator holds one dedicated connection and the publishing UoW one connection, with tested minimum pool capacity. Later claim locks follow ADR hierarchy after evidence/CoA.

Use a durable ingest reservation/attempt record to account for inflight bytes and survive crashes. Consume only one binary allocation for a deduped source; release the redundant reservation. Retain accounting for final objects whose DB publication failed until reconciliation resolves ownership. Normal request cleanup deletes only attempt-owned staging data, if any. It never deletes a final hash-addressed original after publication failure; retain and flag the orphan for recovery. This deliberately strengthens legacy cleanup and handles lost COMMIT acknowledgments without risking another committed record. Reconciliation takes the same source lock, checks receipts and all source/evidence references, and adopts verified bytes on retry or reports the orphan. Physical final-object deletion remains a policy-authorized operator action, not an automatic request cleanup. Expiring an upload lease must not silently discard accounting for an orphan that still occupies storage.

## Initial MIME/security policy

Use a closed source-class/MIME matrix. Proposed development ceilings: photo JPEG/PNG/WebP 10 MiB with existing image dimension/pixel checks; PDF document/CoA/process-record 25 MiB; DNG RAW 64 MiB. These are implementation limits, not signed production quotas. Production limits must be explicit and no higher than validated ceilings until buffering is replaced. Preserve all source-class enum values, but reject unsupported video/RAW encodings with actionable supported-format guidance.

Reuse `ImageInspectionPort` for the supported raster types without re-encoding. Add a dedicated originals inspection adapter: PDFs must have a valid PDF structure and terminal structure, reject encryption, embedded files and active actions/scripts using a maintained bounded parser, with no rendering, external fetching or text extraction. Add and pin the parser dependency in infrastructure; do not use substring heuristics as the security boundary. DNG is the initial RAW allowlist entry (`image/x-adobe-dng`), validated as a bounded TIFF/DNG container with DNG-specific version tags and safe IFD offsets/counts; generic TIFF magic is insufficient. Never decode DNG pixels. Reject CR3/ARW/other RAW, ambiguous containers, SVG, office/archive formats, generic octet-stream and malformed/polyglot inputs that inspection cannot establish safely. Document that structural acceptance is not a malware-free or authenticity certification. Extend allowlists only with explicit validators/tests.

Use existing stable errors: `MIME_CONFLICT`, `SOURCE_INTEGRITY_MISMATCH`, `QUOTA_EXCEEDED`, `ACCESS_DENIED`, `SOURCE_SUPERSEDED`, `CROSS_BATCH_SOURCE`, `STALE_REVISION_CONFLICT`, `IDEMPOTENCY_CONFLICT`, and structured validation issues for unsupported/malformed format. Preserve privacy with `NOT_FOUND` for inaccessible identities and no cross-client storage lookup.

## Retention, recovery, and production gate

No reviewed original-evidence retention policy is supplied. Production ingest defaults disabled and fails closed without explicit reviewed policy identity, quotas and capacity/concurrency limits. Development/tests use explicit non-production policy configuration; a boolean flag alone cannot designate a production archive as approved.

Document backup requirements covering both immutable originals and PostgreSQL revisions, links, verification events and command receipts, with manifest/digest reconciliation after restore. Include separate failure recovery for missing blobs, corrupt blobs, orphan final objects, lost commit acknowledgments and interrupted reservations. Existing vault/backup references do not establish evidence backup coverage. Policy owners must supply actual retention/hold/deletion rules, backup location/access controls, RPO/RTO and restore verification before production readiness can be asserted. This PR provides software gates and a runbook; it does not fabricate approval or perform a production restore.

## Downstream support and risks

The exact batch/evidence/revision/source contracts enable #474 to attach structured CoA reports and later slices to implement claim invalidation, batch-pinned reference resolution and assembly admission. Those future consumers are not verification gates for this PR. There are currently no claim tables or approval workflow to invalidate: preserve source quarantine/dispute/supersession history and document the requirement that future claim mutations perform atomic invalidation in their own transactions. Do not add placeholder claims or require GPU/provider runs, locked-SHA certification or Phase 1 exit sign-off here.

Main risks are parser attack surface, buffer memory under concurrency, session-lock/pool coordination, uncertain object-store/DB outcomes, and retention decisions mistaken for approvals. Mitigate with bounded format-specific inspection, durable quotas, real concurrent PostgreSQL/MinIO tests, conservative final-object retention and default-denied production policy. No source writes or production policy changes occur during planning.

Implementation plan:
# Implementation plan: #473

## 1. Implement source/evidence contracts and deterministic rules

Add the missing ADR 0009 source, evidence, batch-link, derivative and verification types in domain/shared; add missing branded IDs beside `packages/domain/src/identifiers.ts`. Reuse the existing evidence error vocabulary and date/text validators. Add strict Zod command/result schemas under contracts and export them through existing barrels. Include registration intent, lot-specific reuse attestation, nullable reported capture timestamp/precision, expected version for supersession, and derivative provenance. Do not accept submitted-by/review authority from an untrusted payload; use the authenticated envelope.

Define pure constructors/transitions and eligibility projection, including unknown/reported capture status, scoped verification kinds, active-dispute handling, immutable predecessor rules, and explicit reuse requirements. Keep raw byte handling, hashing and parsing out of domain/shared. Add meaningful unit tests for these invariants and strict field combinations.

Validation: `pnpm vitest run packages/domain/src packages/contracts/src packages/shared/src`.

## 2. Add evidence persistence and enforce relational history

Create the next additive migration after 026 for source objects, evidence heads/revisions, batch links, derivative bridges, verification events, and durable ingest reservations/accounting. Add `(client_id, asset_id)` as a candidate key on existing references. Implement tenant-qualified source/hash uniqueness, source-location immutability, revision/predecessor constraints, deferred current-head FK, immutable relation/event protections and application-role privileges. Do not modify historical migrations or ReferenceAsset IDs/hashes.

Replace the temporary batch-facts null-only origin restriction with the composite FK to `(client_id, batch_id, evidence_id, evidence_revision)`. Preserve existing null facts and all history. Update matching runtime guards in `product-registry-use-cases.ts` and `postgres-product-evidence-repository.ts` to allow only valid eligible exact-batch origins, never a sibling-batch source. Retain pair validation and current version fencing.

Implement an evidence-focused repository port/adapter and attach it to `UnitOfWorkContext`/`PostgresUnitOfWork`, keeping the existing product-only port compatible. Reuse or extract narrowly scoped receipt/SQL error helpers rather than duplicating conflicting semantics. Required operations include source lookup, atomic registration, read/history, explicit reuse association, supersede, derivative linking, core verification-event append/projection and quarantine. Use the existing shared receipt ledger across both repositories. Map failures at the UoW boundary too, since deferred constraints can fail at COMMIT.

Test migrations from a populated 026 database, composite tenant FKs, wrong-batch origin pointers, same-tenant derivative keys, append-only triggers/privileges, stale heads, predecessor forks, uniqueness and receipt rollback. Verify ordinary legacy reference operations still work after the additive candidate key.

Validation: `pnpm vitest run --config vitest.integration.config.ts packages/infrastructure/src/postgres/repositories/postgres-evidence-asset-repository.integration.test.ts packages/infrastructure/src/postgres/repositories/postgres-product-evidence-repository.integration.test.ts` (new evidence repository filename proposed).

## 3. Add bounded originals inspection

Add an evidence inspection/integrity port in application and infrastructure adapters for the explicit matrix in the design. Reuse Sharp inspection for supported raster images without modifying exact bytes. Add a pinned maintained PDF structural parser, bounded resource behavior and rejection of encrypted/active/embedded content. Implement bounded DNG container inspection without pixel decoding. Unsupported RAW/video files produce actionable errors.

Generate valid synthetic images/PDFs/minimal DNG containers in tests; do not copy the placeholder hashes from the architectural fixture document. Test exact boundaries, empty/truncated files, declared/detected mismatch, fake TIFF-as-DNG, invalid offsets/cycles, active/encrypted PDF, huge declared lengths, corrupt image decode, unsupported formats and timeout/abort behavior. Do not introduce OCR, rendering or cloud calls.

Validation: `pnpm vitest run packages/infrastructure/src/image packages/infrastructure/src/evidence` (put new inspection tests in the evidence directory).

## 4. Implement private evidence storage, policy and quota integration

Add the private evidence bucket classification to `packages/shared/src/buckets.ts` and provisioning tests without applying temp/review expiry or inventing an archival duration. Compose the evidence storage service over existing `ObjectStoragePort`; do not widen the legacy reference upload allowlist. Add policy configuration that defaults to denial and supports explicit test/development policies. Reject absent/unreviewed production policy, invalid limits, per-client quota exhaustion, concurrent reservations and oversized actual input before a final write.

Implement durable quota reservation/attempt lifecycle, client/digest cross-process lock coordination, exact-byte hashing, tenant-scoped conditional final puts and bounded readback inspection. Persist nullable storage version until a provider capability actually supplies it; do not invent one from ETag. Original evidence must never enter `ReviewMediaDeliveryPort` or preview URL serialization.

Implement conservative cleanup/reconciliation: release redundant dedupe reservations; retain/account final orphans and ambiguous commits; delete only attempt-owned staging objects; log a structured recovery locator without access URLs. Any quarantine update surviving an aborted publication must use a separate transaction after the failing one has rolled back. Keep source/command lock ordering consistent on upload, existing-file registration and derivative-link verification.

Validation: focused policy/quota/coordination unit tests plus `pnpm vitest run --config vitest.integration.config.ts packages/infrastructure/src/storage` for provider conditional-write/readback and bucket regressions. Add evidence adapter integration coverage in this suite or the evidence suite below.

## 5. Implement callable registration and history use cases

Implement upload-and-register, register-existing-source, explicit same-source/new-lot assertion, supersede-evidence, link-existing-derivative, and scoped evidence/history reads under application use cases. Add the minimal core verification-event append/eligibility support needed to represent disputed sources; broader review/CoA workflows remain downstream. Export constructors/ports so later API work can wire them.

The sequence is: validate trusted metadata and bounded bytes; derive canonical digest-bearing command fingerprint; acquire command lock and replay/check receipt; validate storage policy/reserve quota for a new operation; acquire source lock; inspect/put-or-read and verify persisted bytes; execute one UoW publishing source/evidence/link/optional derivative/receipt and quota result; await COMMIT before returning; reconcile reservation and attempt-owned staging on failure while retaining final bytes. Recheck active parents, current evidence revision, unresolved disputes and derivative state inside that transaction. Existing-source mode first resolves ownership and uses only the stored locator. Standalone derivative linking verifies the original again and compares the target reference hash; never use global reference lookups.

Successful exact retries return the stored response without new source/evidence/version/event/link writes. Changed bytes or semantic context with the same action ID conflict. A new action cannot attach an old attestation to another lot without explicit new source context. Supersession never updates old source bytes, revisions or bridges, and never silently carries old verification to the new revision.

Test all failure stages, including failure after PUT, corrupt readback, DB failure and commit-time failure, receipt replay after later archival, and refusal to revive archived/disputed sources. Assert errors and persisted state, not only mock call counts. Assert no public/presigned URL generation or URL persistence.

Validation: `pnpm vitest run packages/application/src/use-cases/register-evidence-asset.test.ts packages/application/src/use-cases/upload-reference-asset.test.ts packages/application/src/use-cases/product-registry-use-cases.test.ts` (registration test filename proposed; include additional new use-case tests as implemented).

## 6. Prove end-to-end storage/DB safety with synthetic integration tests

Create a new evidence registration integration suite using existing PostgreSQL 18 and MinIO Testcontainers helpers, migrations and `PostgresUnitOfWork`. Use generated bytes and isolated buckets/databases with explicit non-production policy; no production originals, operator photography or GPU services.

Required scenarios:

- Upload generated original; independently GET and hash it; query published SourceObject/evidence/link and confirm MIME/byte count match the exact persisted file.
- Link a generated, pre-existing JPEG/WebP reference with a different digest; verify source -> exact evidence revision -> derivative reference relationship and transform provenance. Supersede source and confirm the old bridge, bytes and revision remain intact.
- Duplicate bytes in the same client reuse one source binary while distinct clients get distinct identities and keys. Same action/identical command converges; changed payload/actor/bytes conflicts. Cross-lot reuse without a fresh explicit attestation fails; explicit reuse creates separate immutable context without inheriting verification.
- Wrong client/batch, unknown/foreign/archived derivative, derivative hash mismatch, archived/disputed/quarantined/deleted source, superseded revision and absent trusted capture metadata behave as specified. Unknown/reported capture is never upgraded by ingest.
- Preseed the expected key with different bytes, tamper a committed blob, change storage content type, remove a blob, and inject oversized GET data: fail closed with no new published evidence; registered corruption is durably quarantined.
- Use barriers and independent connections/coordinator instances for identical upload races, distinct actions sharing a source, stale supersessions, source archive/dispute vs link, and failure vs another committed registration. Assert deterministic outcomes, bounded locks, receipt counts and that the committed winner's bytes survive.
- Inject write failure, publication rollback, deferred COMMIT failure and lost acknowledgment. Assert no EvidenceAsset on failed publication, retained recoverable/accounted final orphan where appropriate, safe retry convergence and no deletion of any shared committed object.
- Check quota reservation races, dedupe accounting, crashed-attempt recovery, no reservation leak on normal failure, and conservative accounting for unresolved final orphans.
- Exercise legacy reference upload success/dedupe/reactivation/collision/cleanup tests unchanged.

Validation: `pnpm vitest run --config vitest.integration.config.ts packages/infrastructure/src/evidence/evidence-registration.integration.test.ts`, then `pnpm test:db`. Never run integration files through the default vitest config. Docker is required.

## 7. Document policy and downstream contract boundaries

Add a source-evidence storage/recovery runbook documenting the private namespace, format matrix, reported capture semantics, source/derivative identity split, cross-lot attestation rules, immutable history, quota/orphan recovery and archival restrictions. State explicitly that software completion is not production archival readiness. Document coordinated PostgreSQL/originals backup and digest-based restore reconciliation, with policy owners responsible for actual retention, holds, backup coverage and RPO/RTO sign-off.

Update ADR 0009/contract fixtures narrowly for the timestamp precision refinement, the deliberate unsupported-format matrix and the stricter archived-source behavior; retain the accepted architecture. Mark future #474 CoA/claim/consumer support as enabled contracts rather than present test obligations. Do not require real-provider rendering, locked-SHA runs, production restore evidence, phase completion or certification artifacts.

## Validation and completion

During implementation run the focused commands after the corresponding changes. Final repository checks follow the existing six tiers in `.ai-orchestrator.json`: hygiene, isolated formatting write/check, cache preparation/build, deterministic checks, then subsystem integration. Run build, lint, typecheck, unit tests, boundaries, control-plane checks and `pnpm test:db`; automation retains its full effective tier set, including existing heavy suites. Do not duplicate inherited commands or add a separate validation command without tier mapping. Any environment-blocked suite must be reported accurately rather than counted as passing. Original-evidence tests require only Docker and generated fixtures; existing media-suite prerequisites do not become new evidence-feature acceptance criteria.

Planning performs no implementation or test execution. Completion of the later implementation means exact persisted original verification, tenant-safe immutable registration/history, explicit lot context, stable derivative lineage, passing targeted/unit/DB regressions, and documented default-denied production archival policy. Source files and branch are unchanged by this planning task.

Accumulated review findings ledger:

```
### PREVIOUSLY RESOLVED FINDINGS (REGRESSION CHECKLIST):
- **[AC-1] [RESOLVED in iter 19]** Failed requirement: Attach authoritative *source-file evidence* to one client/SKU/lot while retaining the existing `ReferenceAsset` system for ready-to-render derivatives. Support macro photographs and lab/process files without pretending that H3-conditioned pixels remain authentic.
  Resolution Evidence: packages/application/src/use-cases/register-evidence-asset.ts:512 and packages/infrastructure/src/evidence/postgres-evidence-asset-repository.ts:642 register originals independently; packages/infrastructure/migrations/027_evidence_authority.sql:202 and :204 link an exact evidence revision to a same-client reference without changing reference identity.
  Source: spec-review

- **[F-ba1dfc4f] [RESOLVED in iter 19]** ADR 0009 (§2.3, §4.1), the design document, and `validateSourceObjectInvariants` in `packages/domain/src/source-object.ts:74-80` enforce that `storageObjectKey` must equal `clients/${clientId}/evidence/originals/${originalSha256}`. As a result, `RegisterEvidenceAssetUseCase` fails 100% of the time when wired to the real `PostgresEvidenceAssetRepository`. `docs/source-evidence-storage-recovery-runbook.md` (lines 18, 51, 69) also documents the non-canonical path.
  Resolution Evidence: packages/application/src/use-cases/register-evidence-asset.ts:509 constructs clients/clientId/evidence/originals/hash; packages/domain/src/source-object.ts:73 validates that pattern; packages/infrastructure/src/evidence/postgres-evidence-asset-repository.ts:716 inserts and :735 rehydrates the source. docs/source-evidence-storage-recovery-runbook.md:18 documents the same key.
  Source: spec-review

- **[F-12319094] [RESOLVED in iter 19]** Both the Issue Acceptance Criteria ("Integration tests use generated synthetic images/docs; validate stable source->reference derivative relationship and no legacy upload regression", "Wrong-client/batch, archived/disputed source, unknown reference derivative, reuse into unrelated lot without explicit attestation, and duplicate upload races are tested", "Failed DB transaction does not delete blobs referenced by another committed record; failed blob write does not leave a published EvidenceAsset") and the Design Document ("Test plan -> Integration tests (vitest.integration.config.ts, real PostgreSQL + MinIO)") require real PostgreSQL and object-storage integration tests. Relying solely on mocked unit tests masked the fatal storage-key mismatch between `RegisterEvidenceAssetUseCase` and `PostgresEvidenceAssetRepository`.
  Resolution Evidence: packages/infrastructure/src/evidence/evidence-registration.integration.test.ts:84 constructs real S3ObjectStorage and :96 PostgresUnitOfWork; :166 tests registration, :275 derivative lineage, :1065 concurrent retries and :1114 rollback retention. Container suites were inspected, not rerun. Legacy upload regression: 14 tests passed in this review.
  Source: spec-review

- **[F-1e31c80f] [RESOLVED in iter 19]** Because `sourceObjectId` is newly randomized on each invocation, retrying an identical registration request with the same `actionId` always produces a different `payload_sha256` and throws `IdempotencyConflictError` instead of replaying the committed receipt. This violates the idempotent command execution specification where canonical payloads must exclude server-generated entity IDs.
  Resolution Evidence: packages/application/src/use-cases/register-evidence-asset.ts:512 constructs the semantic command payload and :557 checks its receipt; packages/infrastructure/src/evidence/postgres-evidence-asset-repository.ts:190 excludes only generated registration sourceObjectId, :602 checks receipt before mutation and :714 generates identity after replay. Registration suite: 34 tests passed.
  Source: spec-review

- **[F-e6106887] [RESOLVED in iter 19]** The Design Document requires replacing the temporary deferred origin-evidence guard in both the database and application/repository layers ("Both application/repository guards and `chk_batch_facts_origin_evidence_deferred` currently reject every non-null origin-evidence pointer. This temporary restriction must be replaced with the same-client, same-batch exact-revision FK once evidence links exist"). While `027_evidence_authority.sql` and `PostgresProductEvidenceRepository` were updated to allow and translate `fk_batch_facts_origin_evidence`, the application use cases still unconditionally reject valid origin evidence links.
  Resolution Evidence: packages/application/src/use-cases/product-registry-use-cases.ts:364 accepts paired origin pointers; packages/infrastructure/src/postgres/repositories/postgres-product-evidence-repository.ts:1647 validates the batch association and :1756 persists origin pointers; packages/infrastructure/migrations/027_evidence_authority.sql:183 enforces the exact-batch composite FK. Product use-case suite: 13 tests passed.
  Source: spec-review

- **[F-c4f83d7e] [RESOLVED in iter 19]** Both the Issue Scope ("Register reference to existing file where bytes already present only after verifying storage digest and client ownership; source supersession creates new evidence revision, never replaces old bytes") and the Design Document ("An existing-source variant accepts a SourceObject ID, never an arbitrary object URL or another tenant's bucket/key. Resolve ownership before storage access and re-read/verify bytes before registration") require supporting registration against an already-persisted `SourceObject` by ID after verifying tenant ownership and re-reading/hashing the stored bytes.
  Resolution Evidence: packages/application/src/use-cases/register-evidence-asset.ts:410 resolves a tenant-qualified source ID before storage access, :757 reads its stored locator, :815 hashes bytes and :855 publishes after integrity checks; packages/infrastructure/src/evidence/postgres-evidence-asset-repository.ts:648 rechecks tenant ownership and availability. Registration suite passed.
  Source: spec-review

- **[F-78e68907] [RESOLVED in iter 19]** The Design Document requires that "New derivative linking and supersession also re-verify original storage bytes", "For existing registered corruption, commit quarantine and its audit separately from the aborted registration so rollback cannot undo the protective state change", and "Check active batch/SKU, source availability, evidence head/current revision, unresolved disputes, and derivative ownership/archive/hash inside the publishing transaction under locks".
  Resolution Evidence: packages/application/src/use-cases/link-existing-derivative.ts:225 reads original bytes and :246 quarantines proven adapter integrity failures through a separate UoW; packages/application/src/use-cases/register-evidence-asset.ts:645 and :757 verify supersession/reuse originals. packages/infrastructure/src/evidence/postgres-evidence-asset-repository.ts:1163 locks the head, :1209 checks parents, :1224 checks source state and :1274 locks the reference. packages/infrastructure/src/postgres/uow/postgres-unit-of-work.ts:56 commits before return. The newly identified missing-blob dedup case is reported separately.
  Source: spec-review

- **[F-f24b1e0d] [RESOLVED in iter 19]** Because `027_evidence_authority.sql` constraints are unmapped, raw `pg` errors leak across the repository and UnitOfWork boundary on constraint violations instead of being translated to typed domain errors.
  Resolution Evidence: packages/infrastructure/src/postgres/repositories/postgres-product-evidence-repository.ts:438 allowlists evidence constraints and :558 translates them; packages/infrastructure/src/postgres/uow/postgres-unit-of-work.ts:56 executes COMMIT inside the error boundary and :60 translates deferred errors. Evidence repository unit suite: 15 tests passed.
  Source: spec-review

- **[F-f13196e0] [RESOLVED in iter 19]** Every real execution of `RegisterEvidenceAssetUseCase.execute` against `PostgresEvidenceAssetRepository` fails closed with `ProductValidationError` because the storage key omits the `/originals` segment required by ADR 0009 and the domain invariant. The unit test in `register-evidence-asset.test.ts` masked this defect by returning a raw object literal instead of calling `createSourceObject` or `rehydrateSourceObject`.
  Resolution Evidence: packages/application/src/use-cases/register-evidence-asset.ts:509 agrees with packages/domain/src/source-object.ts:73; packages/infrastructure/src/evidence/postgres-evidence-asset-repository.ts:716 persists the canonical locator and :735 rehydrates it. packages/infrastructure/src/evidence/evidence-registration.integration.test.ts:166 supplies a composed real-adapter success test.
  Source: quality-review

- **[F-a02e08eb] [RESOLVED in iter 19]** Retrying an identical registration command with the same `actionId` always generates a new `sourceObjectId`, producing a different `payload_sha256` and throwing a false `IdempotencyConflictError` instead of replaying the stored receipt. Checking receipts after quota and storage side effects also causes idempotent replays to fail if quota is exhausted or if the source was subsequently archived, and omitting `pg_advisory_xact_lock` on `(clientId, actionId)` allows concurrent identical retries to race into primary-key violations (`23505`) on `product_evidence_command_receipts`.
  Resolution Evidence: packages/application/src/use-cases/register-evidence-asset.ts:546 opens one lock session, :548 locks the command, :557 checks receipts and :573 locks the source only for new commands. packages/infrastructure/src/evidence/postgres-evidence-lock-coordinator.ts:122 holds command/source locks on one connection; packages/infrastructure/src/evidence/postgres-evidence-asset-repository.ts:602 checks the shared receipt before mutable preconditions. Registration and coordinator tests passed.
  Source: quality-review

- **[F-f2986d8b] [RESOLVED in iter 19]** Although migration 027 and `PostgresProductEvidenceRepository` replaced the temporary null-only check constraint with `fk_batch_facts_origin_evidence`, application callers still cannot link batch facts to origin evidence through `AppendBatchFactsUseCase`. Additionally, `PostgresProductEvidenceRepository.appendBatchFacts` permits linking to archived, quarantined, or disputed evidence.
  Resolution Evidence: packages/application/src/use-cases/product-registry-use-cases.ts:364 permits paired origin IDs; packages/infrastructure/src/postgres/repositories/postgres-product-evidence-repository.ts:1647 validates exact lot linkage, :1683 checks archival state, :1703 source availability and :1724 active disputes before :1756 persists. packages/infrastructure/migrations/027_evidence_authority.sql:183 prevents sibling-lot pointers.
  Source: quality-review

- **[F-843e7449] [RESOLVED in iter 19]** Omitting existing-source registration by `SourceObjectId`, skipping persisted-byte verification and eligibility checks on derivative linking and source reuse, and failing to check parent SKU archive state and active disputes violate the fail-closed authority invariants in ADR 0009 and Issue #473.
  Resolution Evidence: packages/application/src/use-cases/register-evidence-asset.ts:410 resolves owned source identity and :757 re-verifies its bytes. packages/infrastructure/src/evidence/postgres-evidence-asset-repository.ts:626 locks batch/SKU, :648 resolves owned sources, :655 rejects unavailable sources, :768 and :829 check source disputes; :1209 and :1224 validate derivative publication parents/source. Registration and derivative suites passed.
  Source: quality-review

- **[F-c45888ef] [RESOLVED in iter 19]** Returning a pooled connection after a failed `pg_advisory_unlock` permanently leaks the session advisory lock and deadlocks subsequent requests for that key; mutating session `lock_timeout` pollutes pooled connections. Unlocked check-then-act quota checks allow concurrent requests to exceed client byte and concurrency quotas.
  Resolution Evidence: packages/infrastructure/src/evidence/postgres-evidence-lock-coordinator.ts:147 checks unlock results, :157 resets lock_timeout and :162 destroys unsafe sessions. packages/infrastructure/src/evidence/postgres-evidence-asset-repository.ts:539 serializes tenant accounting; packages/application/src/use-cases/register-evidence-asset.ts:870 checks usage and reserves bytes in one UoW. All 7 coordinator tests passed.
  Source: quality-review

- **[F-cdd3150f] [RESOLVED in iter 19]** Constraint violations, lock timeouts (`55P03`), deadlocks (`40P01`), serialization failures (`40001`), and deferred FK failures (`fk_evidence_assets_current_rev`) from migration 027 tables leak raw `pg.DatabaseError` instances instead of deterministic domain errors. At the schema layer, archived sources can be reactivated via SQL UPDATE, duplicate derivatives can be inserted for the same revision, and overprivileged application roles are not rejected during migration 027.
  Resolution Evidence: packages/infrastructure/migrations/027_evidence_authority.sql:201 prevents duplicate bridges, :359 protects binary metadata, :379 prevents revival and :443 checks effective immutable-table privileges. packages/infrastructure/src/postgres/repositories/postgres-product-evidence-repository.ts:558 translates evidence constraints and :991 handles concurrency errors; packages/infrastructure/src/postgres/uow/postgres-unit-of-work.ts:56 catches deferred COMMIT errors. Evidence repository tests passed.
  Source: quality-review

- **[F-5246bea9] [RESOLVED in iter 19]** Standard PDF active actions (`/OpenAction`, `/AA`, page/annotation `/A` dictionaries with `/S /JavaScript` or `/S /Launch`) and embedded file streams (`/Type /EmbeddedFile`, `/EF`) reside in indirect objects or `/OpenAction`/`/AA` rather than top-level `/JavaScript` on the root catalog, bypassing inspection. Similarly, a truncated or cyclic TIFF container with tag `50706` in its first entry passes DNG inspection.
  Resolution Evidence: packages/infrastructure/src/evidence/originals-inspection-adapter.ts:287 traverses PDF objects, :322 rejects embedded-file dictionaries, :346 checks action subtypes and :376 inspects indirect objects. :484 tracks DNG IFD cycles and :526 requires complete IFD extent before accepting DNG tags. All 17 inspection tests passed.
  Source: quality-review

- **[F-bde14e67] [RESOLVED in iter 19]** Without integration tests against real PostgreSQL and object storage, critical integration defects—such as the storage-key mismatch between `RegisterEvidenceAssetUseCase` and `SourceObject` domain validation, broken receipt replay hashing, and untranslated SQL errors—went undetected by the mocked unit tests.
  Resolution Evidence: packages/infrastructure/src/evidence/evidence-registration.integration.test.ts:84 and :96 compose real MinIO storage and PostgreSQL UoW; :166 registration, :275 lineage, :676 replay, :880 origin links, :1065 races and :1114 rollback retention cover the previously absent integration surface. Tests exist; no new container execution is claimed.
  Source: quality-review

- **[F-34756f04] [RESOLVED in iter 19]** The generated-ID fix also removed a semantic target identifier from non-registration commands. Changed-target retries can silently replay an operation on a different evidence asset.
  Resolution Evidence: packages/infrastructure/src/evidence/postgres-evidence-asset-repository.ts:190 removes sourceObjectId only for registerEvidence. packages/application/src/use-cases/link-existing-derivative.ts:149 includes evidence identity/revision/reference in replay validation and :331 includes those targets in publication. All 17 derivative-link tests passed.
  Source: spec-review

- **[F-341a3d18] [RESOLVED in iter 19]** Missing production policy silently enables development ingest limits, and a boolean alone can enable the production branch. This contradicts the specified default-denied archival gate; a synthetic development configuration cannot establish production approval.
  Resolution Evidence: packages/application/src/use-cases/register-evidence-asset.ts:188 rejects missing policy, :196 disallows development policy in production, :203 requires approval plus reviewed identity and :216 validates capacity. packages/application/src/ports/evidence-storage-policy.ts:15 supplies only an explicitly unapproved development policy. Runtime gates remain fail-closed; no external production approval was inferred.
  Source: spec-review

- **[F-3dc201be] [RESOLVED in iter 19]** The new outer command lock increases per-request connection demand from two to three. A supported two-connection pool waits indefinitely on publication while the request itself owns both sessions. Concurrent distinct commands can similarly exhaust a larger pool with held command/source sessions; lock_timeout cannot bound pool.connect waits. This violates the design requirement to avoid pool exhaustion and test minimum pool capacity.
  Resolution Evidence: packages/infrastructure/src/evidence/postgres-evidence-lock-coordinator.ts:20 rejects pools smaller than two, :25 bounds shared-coordinator admission and :122 keeps command/source locks on one session. packages/infrastructure/src/postgres/uow/postgres-unit-of-work.ts:27 obtains the publishing connection. packages/infrastructure/src/evidence/evidence-registration.integration.test.ts:1234 exercises the supported shared-coordinator two-connection configuration. Independent coordinators on an undersized shared pool are not established safe.
  Source: spec-review

- **[F-67a8bf79] [RESOLVED in iter 19]** The newly added acquisition timeout leaves the original pg Pool request queued. When a connection eventually becomes available, it is checked out permanently with no owner to release it. Repeated timeouts shrink the usable pool and can stop all database work, aggravating F-3dc201be.
  Resolution Evidence: packages/infrastructure/src/evidence/postgres-evidence-lock-coordinator.ts:80 retains the pool acquisition promise, :81 releases late-delivered connections, :109 races acquisition with timeout, :110 clears the timer and :164 releases admission. Seven coordinator tests passed, including late acquisition cleanup.
  Source: spec-review

- **[F-106ee6f3] [RESOLVED in iter 19]** A caller can register evidence in lot A, then supersede that evidence using batchId for lot B and the existing source, creating a second-lot association under the same evidence identity without using new_batch_assertion. Alternatively, a source from another lot can be introduced through supersession without the cross-batch guard. This bypasses the separate immutable lot assertion/identity requirement and makes one evidence head span unrelated lots.
  Resolution Evidence: packages/infrastructure/src/evidence/postgres-evidence-asset-repository.ts:965 queries target batch associations and :972 rejects a changed target lot; :985 checks replacement-source lot usage and :995 rejects the bypass. :828 handles explicit new_batch_assertion with a separate evidence head. packages/infrastructure/src/evidence/evidence-registration.integration.test.ts:503 covers supersession lot fencing.
  Source: spec-review

- **[F-a237c289] [RESOLVED in iter 19]** This exposed adapter integration gap leaves a detected-corrupt committed source marked available. It fails the separately durable quarantine guarantee underlying F-78e68907 and F-843e7449, even though the attempted link/registration itself aborts. The 18 passing integration tests do not exercise corrupted readback through this exception path.
  Resolution Evidence: packages/application/src/use-cases/register-evidence-asset.ts:948 discriminates collision-read StorageIntegrityViolationError and :952 invokes separately committed quarantine-by-hash; :1005 handles readback adapter corruption and :1033 handles readback hash/length/MIME mismatch after dedup. Helper at :156 resolves the committed same-client source; packages/infrastructure/src/evidence/postgres-evidence-asset-repository.ts:574 updates quarantine and packages/infrastructure/src/postgres/uow/postgres-unit-of-work.ts:56 commits it. Registration suite: 34 tests passed. This closes the iteration-18 thrown-error and mismatch finding; the distinct undefined/missing-object branches remain a new finding.
  Source: spec-review

- **[F-6d61f537] [RESOLVED in iter 19]** A temporary S3 timeout, connection reset, service outage, or authorization failure can now durably disable a healthy committed original and all subsequent use through this path. No byte corruption was established. This is a material availability regression introduced by the fix, and the schema intentionally prevents ordinary ingestion from reversing it.
  Resolution Evidence: packages/infrastructure/src/storage/s3-object-storage.ts:338 returns undefined for missing keys and :341 propagates transport/auth failures. packages/application/src/use-cases/link-existing-derivative.ts:242 and packages/application/src/use-cases/register-evidence-asset.ts:663, :775, :948 and :1006 discriminate StorageIntegrityViolationError instead of quarantining transient failures. Storage, registration and derivative-link suites passed.
  Source: spec-review

- **[F-2da10754] [RESOLVED in iter 19]** The narrowed catch fix requires complete adapter classification of proven corruption. Actual streamed overflow proves a size mismatch just as header overflow does. A source whose persisted bytes are demonstrably oversized remains available, violating the separately durable quarantine requirement on existing-source reuse, supersession and derivative linking.
  Resolution Evidence: packages/infrastructure/src/storage/s3-object-storage.ts:126 classifies streamed overflow, :237 transformToByteArray overflow, :373 header overflow and :391 checksum mismatch as StorageIntegrityViolationError. Consumers at packages/application/src/use-cases/link-existing-derivative.ts:242 and packages/application/src/use-cases/register-evidence-asset.ts:663, :775, :948 and :1006 recognize the class. All 15 storage tests passed.
  Source: spec-review

- **[F-85e69909] [RESOLVED in iter 19]** If an existing original disappears between the conditional-write collision and either verification GET (for example through operator deletion or storage loss), registration aborts but the committed SourceObject remains available despite established loss. This leaves a known-missing original eligible to metadata-only consumers: postgres-product-evidence-repository.ts:1703 checks availability without fetching the blob before accepting origin evidence. The design explicitly requires missing-object failure and durable quarantine for existing-source integrity failures. This is a distinct missing-object result branch, not a repeat of the resolved thrown-checksum/MIME readback defect.
  Resolution Evidence: Iteration 19 (2026-10-21) flagged a further genuinely new gap in the SAME area: the "missing object" (getObject() returning undefined, not throwing) branches of both the collision GET and readback GET threw a generic Error without quarantining, unlike their thrown-exception siblings fixed in the previous two iterations. Fixed by applying the same quarantineExistingSourceByHash() treatment (gated on isDedupCollision) before throwing NotFoundError("SourceObjectBlob", ...), matching the existing missing-blob handling for an explicitly reused source object elsewhere in this file. New tests: collision-GET undefined under dedup, readback-GET undefined under dedup, and a fresh-PUT-no-collision regression confirming no spurious quarantine. Full repo suite verified: build/typecheck/lint clean, 4825/4825 tests passing, boundaries 0 errors.
  Source: spec-review

```

Deterministic validation evidence:

```
Validation result: passed (fingerprint: 59449e23ca3a)
```



Complete branch diff against base:

```diff
diff --git a/docs/verified-product-evidence-contract-fixtures.md b/docs/verified-product-evidence-contract-fixtures.md
index 850f258..8c696d2 100644
--- a/docs/verified-product-evidence-contract-fixtures.md
+++ b/docs/verified-product-evidence-contract-fixtures.md
@@ -884,7 +884,7 @@ The following matrix documents the complete set of negative invariants, integrit
 | **CE-01** | **Tenant Isolation** | Client A owns `SRC_PHOTO_RAW_ID`. | Client B attempts to link `SRC_PHOTO_RAW_ID` in `createEvidenceAsset`. | Fails closed with `NOT_FOUND`. Database composite FK `fk_evidence_revisions_source` (`client_id, source_object_id`) rejects. Zero metadata or existence disclosure regarding Client A. |
 | **CE-02** | **Lot Boundary Integrity & FK Rejection** | Client A owns Lot A (`BATCH_LOT_A_ID`) and Lot B (`BATCH_LOT_B_ID`) under same SKU. Photo is linked to Lot B (`batch_evidence_links`). | Submitter attempts to link Lot B's photo as supporting evidence for a claim on Lot A (`linkClaimSources`). | Fails closed with `CROSS_BATCH_SOURCE`. Database FK `fk_claim_sources_batch_evidence` (`client_id, batch_id, evidence_id, evidence_revision`) rejects because `batch_id` does not match the claim's batch. |
 | **CE-03** | **Duplicate Ingest Deduplication** | Client A previously ingested `SRC_PHOTO_RAW_ID` with hash `HASH_PHOTO_RAW`. | Client A re-uploads the exact same file bytes with the same hash. | Storage adapter verifies exact byte SHA-256 match and detected MIME match, then reuses existing `source_objects` row without duplicate S3 write. Quota reservation released. Distinct `EvidenceRevision` created only if asserted explicitly. |
-| **CE-03B**| **Archived Duplicate Upload** | Client A previously ingested `SRC_PHOTO_RAW_ID`, which was later archived (`availability = 'archived'`). | Client A re-uploads the exact same file bytes with the same hash. | Storage adapter reactivates `source_objects` (`availability = 'available'`). Reactivation does **not** restore prior claim approvals or bypass fresh compliance review. |
+| **CE-03B**| **Archived / Quarantined Duplicate Upload** | Client A previously ingested `SRC_PHOTO_RAW_ID`, which was later archived (`availability = 'archived'`), quarantined, or deleted under retention. | Client A re-uploads the exact same file bytes with the same hash. | Re-uploading bytes cannot reactivate an archived, quarantined, or deleted source object. Fails closed with `ACCESS_DENIED` (`cause: SOURCE_UNAVAILABLE`). Unlike ephemeral preview reference assets, source evidence archives are immutable and require operator retention governance to alter availability. |
 | **CE-04** | **Tamper / Byte Integrity Failure** | Source object record exists with hash `HASH_PHOTO_RAW`. Underlying file in S3 was altered or corrupted. | Ingestion or verification adapter reads object from storage prior to derivative creation or claim approval. | Exact computed byte hash $\ne$ recorded `original_sha256`. Fails closed with `SOURCE_INTEGRITY_MISMATCH`. Object marked `availability = 'quarantined'`; all dependent claims transition to `invalidated`. |
 | **CE-04B**| **Unavailable Source Object** | Active claim revision is linked to a source object. | Source object availability transitions to `archived`, `quarantined`, or `deleted_under_retention`. | Cascade invalidation transaction triggers. Claim state transitions `reviewer_approved -> invalidated` (`cause: source_quarantined` or `source_archived`). |
 | **CE-05** | **Missing / Ambiguous Measurement Units** | Submitter enters a CoA measurement row for total THC with `result_value = "24.5"` and `unit = ""`. | Submitter submits `createCoaReport`. | Rejected at application boundary with `MEASUREMENT_UNIT_REQUIRED`. Relational CHECK constraint `chk_measurement_strings_nonempty` prevents insertion. |
diff --git a/eslint.config.js b/eslint.config.js
index d9c01a9..b6056ca 100644
--- a/eslint.config.js
+++ b/eslint.config.js
@@ -12,7 +12,8 @@ export default tseslint.config(
       "**/.ai-tmp/**",
       "**/.ai-cache/**",
       "**/.ai-worktrees/**",
-      "**/.ai-runs/**"
+      "**/.ai-runs/**",
+      "**/*.timestamp-*.mjs"
     ]
   },
   js.configs.recommended,
diff --git a/packages/application/src/ports/index.ts b/packages/application/src/ports/index.ts
index 09efba1..8b0e8fc 100644
--- a/packages/application/src/ports/index.ts
+++ b/packages/application/src/ports/index.ts
@@ -52,3 +52,7 @@ export * from "./minimax-h3-experiment-ports.js";
 export * from "./h3-candidate-ports.js";
 export * from "./product-evidence-repository.js";
 export * from "./product-evidence-serializers.js";
+export * from "./originals-inspection-port.js";
+export * from "./evidence-storage-policy.js";
+export * from "./evidence-lock-coordinator.js";
+export * from "./evidence-asset-repository.js";
diff --git a/packages/application/src/ports/object-storage-port.ts b/packages/application/src/ports/object-storage-port.ts
index acddbab..5eb7fef 100644
--- a/packages/application/src/ports/object-storage-port.ts
+++ b/packages/application/src/ports/object-storage-port.ts
@@ -15,6 +15,30 @@ export class ObjectAlreadyExistsError extends Error {
   }
 }
 
+/**
+ * Thrown by a getObject() adapter when it has *proven* the persisted bytes
+ * are corrupt or malformed on read -- an oversized object (exceeds the
+ * caller's maxBytes) or a stored checksum that doesn't match the bytes
+ * actually read. This is distinct from every other getObject() failure
+ * (network transport errors, timeouts, auth failures, cancellation): those
+ * say nothing about the integrity of the persisted bytes and MUST NOT be
+ * treated as proof of corruption by a caller re-verifying a SourceObject --
+ * doing so would durably quarantine a healthy source over a transient
+ * failure (quarantine is a one-way transition; see
+ * migrations/027_evidence_authority.sql).
+ */
+export class StorageIntegrityViolationError extends Error {
+  override readonly name = "StorageIntegrityViolationError";
+  readonly bucket: string;
+  readonly key: string;
+
+  constructor(message: string, bucket: string, key: string, options?: ErrorOptions) {
+    super(message, options);
+    this.bucket = bucket;
+    this.key = key;
+  }
+}
+
 export interface PutObjectInput {
   readonly bucket: string;
   readonly key: string;
diff --git a/packages/application/src/ports/unit-of-work.ts b/packages/application/src/ports/unit-of-work.ts
index 3460fae..440ad3a 100644
--- a/packages/application/src/ports/unit-of-work.ts
+++ b/packages/application/src/ports/unit-of-work.ts
@@ -9,6 +9,7 @@ import type { TransactionalJobEnqueuer } from "./job-queue-port.js";
 import type { ReferenceAssetRepository } from "./reference-asset-repository.js";
 import type { ReferenceGroupRepository } from "./reference-group-repository.js";
 import type { ProductEvidenceRepositoryPort } from "./product-evidence-repository.js";
+import type { EvidenceAssetRepositoryPort } from "./evidence-asset-repository.js";
 import type { ReviewEventStore } from "./review-event-store.js";
 import type { SceneRepository } from "./scene-repository.js";
 import type { ShotPlanRepository } from "./shot-plan-repository.js";
@@ -29,6 +30,7 @@ export interface UnitOfWorkContext {
   readonly referenceGroups?: ReferenceGroupRepository | undefined;
   readonly campaignReferenceBible?: CampaignReferenceBibleRepository | undefined;
   readonly productEvidence?: ProductEvidenceRepositoryPort | undefined;
+  readonly evidenceAsset?: EvidenceAssetRepositoryPort | undefined;
 }
 
 export interface UnitOfWork {
diff --git a/packages/application/src/use-cases/index.ts b/packages/application/src/use-cases/index.ts
index 45b53d4..9eaba9c 100644
--- a/packages/application/src/use-cases/index.ts
+++ b/packages/application/src/use-cases/index.ts
@@ -81,3 +81,6 @@ export * from "./auto-plan-first-pass.js";
 export * from "./list-clients.js";
 export * from "./evaluate-h3-candidate-eligibility.js";
 export * from "./product-registry-use-cases.js";
+export * from "./register-evidence-asset.js";
+export * from "./link-existing-derivative.js";
+export * from "./record-evidence-verification-event.js";
diff --git a/packages/application/src/use-cases/product-registry-use-cases.test.ts b/packages/application/src/use-cases/product-registry-use-cases.test.ts
index 8e53b1e..0db178f 100644
--- a/packages/application/src/use-cases/product-registry-use-cases.test.ts
+++ b/packages/application/src/use-cases/product-registry-use-cases.test.ts
@@ -125,52 +125,87 @@ describe("Product registry use cases unit tests", () => {
     expect(mockRepo.createSku).toHaveBeenCalledTimes(1);
   });
 
-  it("CreateProductBatchUseCase: rejects unsupported origin evidence links with ProductValidationError", async () => {
-    const uow = createMockUow({});
+  it("CreateProductBatchUseCase: accepts valid origin evidence links and delegates to repository", async () => {
+    const mockBatch = {
+      batch: {
+        clientId: clientA,
+        batchId: createBatchId("018f0000-0002-7000-8000-000000000001"),
+        skuId: createSkuId("018f0000-0002-7000-8000-000000000002"),
+        lotIdentifier: "LOT-01",
+        displayName: "Lot 01",
+        version: 1,
+        currentFactsRevision: 1,
+        createdAt: timestamp,
+        updatedAt: timestamp,
+        archivedAt: null
+      },
+      facts: null
+    };
+    const mockRepo: Partial<ProductEvidenceRepositoryPort> = {
+      createBatch: vi.fn().mockResolvedValue(mockBatch)
+    };
+    const uow = createMockUow(mockRepo);
     const useCase = new CreateProductBatchUseCase(uow);
 
-    await expect(
-      useCase.execute({
-        actionId: action1,
-        clientId: clientA,
-        actorId: actor,
-        timestamp,
-        payload: {
-          skuId: createSkuId("018f0000-0002-7000-8000-000000000001"),
-          lotIdentifier: "LOT-01",
-          displayName: "Lot 01",
-          initialFacts: {
-            originKind: "unknown",
-            originEvidenceId: "018f0000-0003-7000-8000-000000000001" as unknown as EvidenceId,
-            originEvidenceRevision: 1
-          }
+    const result = await useCase.execute({
+      actionId: action1,
+      clientId: clientA,
+      actorId: actor,
+      timestamp,
+      payload: {
+        skuId: createSkuId("018f0000-0002-7000-8000-000000000001"),
+        lotIdentifier: "LOT-01",
+        displayName: "Lot 01",
+        initialFacts: {
+          originKind: "unknown",
+          originEvidenceId: "018f0000-0003-7000-8000-000000000001" as unknown as EvidenceId,
+          originEvidenceRevision: 1
         }
-      })
-    ).rejects.toThrow(ProductValidationError);
+      }
+    });
+    expect(result).toBe(mockBatch);
+    expect(mockRepo.createBatch).toHaveBeenCalledTimes(1);
   });
 
-  it("AppendBatchFactsUseCase: rejects unsupported origin evidence references", async () => {
-    const uow = createMockUow({});
+  it("AppendBatchFactsUseCase: accepts valid origin evidence references and delegates to repository", async () => {
+    const mockFacts = {
+      clientId: clientA,
+      batchId: createBatchId("018f0000-0002-7000-8000-000000000001"),
+      revision: 2,
+      originKind: "own_production",
+      producerIdentityAsClaimed: "Farm",
+      productionStartDate: "2026-03-01",
+      productionEndDate: "2026-03-10",
+      originEvidenceId: "018f0000-0003-7000-8000-000000000001",
+      originEvidenceRevision: 1,
+      assertedBy: actor,
+      assertedAt: timestamp,
+      supersedesRevision: 1
+    };
+    const mockRepo: Partial<ProductEvidenceRepositoryPort> = {
+      appendBatchFacts: vi.fn().mockResolvedValue(mockFacts)
+    };
+    const uow = createMockUow(mockRepo);
     const useCase = new AppendBatchFactsUseCase(uow);
 
-    await expect(
-      useCase.execute({
-        actionId: action1,
-        clientId: clientA,
-        actorId: actor,
-        timestamp,
-        payload: {
-          batchId: createBatchId("018f0000-0002-7000-8000-000000000001"),
-          expectedVersion: 1,
-          originKind: "own_production",
-          producerIdentityAsClaimed: "Farm",
-          productionStartDate: "2026-03-01",
-          productionEndDate: "2026-03-10",
-          originEvidenceId: "018f0000-0003-7000-8000-000000000001" as unknown as EvidenceId,
-          originEvidenceRevision: 1
-        }
-      })
-    ).rejects.toThrow(ProductValidationError);
+    const result = await useCase.execute({
+      actionId: action1,
+      clientId: clientA,
+      actorId: actor,
+      timestamp,
+      payload: {
+        batchId: createBatchId("018f0000-0002-7000-8000-000000000001"),
+        expectedVersion: 1,
+        originKind: "own_production",
+        producerIdentityAsClaimed: "Farm",
+        productionStartDate: "2026-03-01",
+        productionEndDate: "2026-03-10",
+        originEvidenceId: "018f0000-0003-7000-8000-000000000001" as unknown as EvidenceId,
+        originEvidenceRevision: 1
+      }
+    });
+    expect(result).toBe(mockFacts);
+    expect(mockRepo.appendBatchFacts).toHaveBeenCalledTimes(1);
   });
 
   it("UpdateProductSkuMetadataUseCase and UpdateProductBatchMetadataUseCase delegate through UoW", async () => {
diff --git a/packages/application/src/use-cases/product-registry-use-cases.ts b/packages/application/src/use-cases/product-registry-use-cases.ts
index b6f3055..cf2da0b 100644
--- a/packages/application/src/use-cases/product-registry-use-cases.ts
+++ b/packages/application/src/use-cases/product-registry-use-cases.ts
@@ -211,21 +211,42 @@ export class CreateProductBatchUseCase {
       ]);
 
       const facts = cmd.payload.initialFacts;
-      if (facts.originEvidenceId !== null && facts.originEvidenceId !== undefined) {
+      const hasId = facts.originEvidenceId !== null && facts.originEvidenceId !== undefined;
+      const hasRev =
+        facts.originEvidenceRevision !== null && facts.originEvidenceRevision !== undefined;
+      if (hasId && !hasRev) {
         throw new ProductValidationError([
           {
             code: "INVALID_FIELD_COMBINATION",
             path: ["initialFacts", "originEvidenceId"],
-            message: "Origin evidence linkage is not yet supported in this phase."
+            message: "originEvidenceRevision is required when originEvidenceId is provided."
           }
         ]);
       }
-      if (facts.originEvidenceRevision !== null && facts.originEvidenceRevision !== undefined) {
+      if (!hasId && hasRev) {
         throw new ProductValidationError([
           {
             code: "INVALID_FIELD_COMBINATION",
             path: ["initialFacts", "originEvidenceRevision"],
-            message: "Origin evidence linkage is not yet supported in this phase."
+            message: "originEvidenceId is required when originEvidenceRevision is provided."
+          }
+        ]);
+      }
+      if (hasId && !isValidUuid(facts.originEvidenceId!)) {
+        throw new ProductValidationError([
+          {
+            code: "INVALID_IDENTIFIER",
+            path: ["initialFacts", "originEvidenceId"],
+            message: "originEvidenceId must be a valid UUID string."
+          }
+        ]);
+      }
+      if (hasRev && !isValidPositiveInt(facts.originEvidenceRevision!)) {
+        throw new ProductValidationError([
+          {
+            code: "INVALID_REVISION",
+            path: ["initialFacts", "originEvidenceRevision"],
+            message: "originEvidenceRevision must be a positive integer."
           }
         ]);
       }
@@ -343,24 +364,44 @@ export class AppendBatchFactsUseCase {
       ]);
     }
 
-    if (cmd.payload.originEvidenceId !== null && cmd.payload.originEvidenceId !== undefined) {
+    const hasOriginId =
+      cmd.payload.originEvidenceId !== null && cmd.payload.originEvidenceId !== undefined;
+    const hasOriginRev =
+      cmd.payload.originEvidenceRevision !== null &&
+      cmd.payload.originEvidenceRevision !== undefined;
+    if (hasOriginId && !hasOriginRev) {
       throw new ProductValidationError([
         {
           code: "INVALID_FIELD_COMBINATION",
           path: ["originEvidenceId"],
-          message: "Origin evidence linkage is not yet supported in this phase."
+          message: "originEvidenceRevision is required when originEvidenceId is provided."
         }
       ]);
     }
-    if (
-      cmd.payload.originEvidenceRevision !== null &&
-      cmd.payload.originEvidenceRevision !== undefined
-    ) {
+    if (!hasOriginId && hasOriginRev) {
       throw new ProductValidationError([
         {
           code: "INVALID_FIELD_COMBINATION",
           path: ["originEvidenceRevision"],
-          message: "Origin evidence linkage is not yet supported in this phase."
+          message: "originEvidenceId is required when originEvidenceRevision is provided."
+        }
+      ]);
+    }
+    if (hasOriginId && !isValidUuid(cmd.payload.originEvidenceId!)) {
+      throw new ProductValidationError([
+        {
+          code: "INVALID_IDENTIFIER",
+          path: ["originEvidenceId"],
+          message: "originEvidenceId must be a valid UUID string."
+        }
+      ]);
+    }
+    if (hasOriginRev && !isValidPositiveInt(cmd.payload.originEvidenceRevision!)) {
+      throw new ProductValidationError([
+        {
+          code: "INVALID_REVISION",
+          path: ["originEvidenceRevision"],
+          message: "originEvidenceRevision must be a positive integer."
         }
       ]);
     }
diff --git a/packages/contracts/src/index.ts b/packages/contracts/src/index.ts
index 3f27bf5..961abce 100644
--- a/packages/contracts/src/index.ts
+++ b/packages/contracts/src/index.ts
@@ -42,3 +42,4 @@ export * from "./product-evidence-error.js";
 export * from "./product-evidence-command.js";
 export * from "./product-sku.js";
 export * from "./product-batch.js";
+export * from "./evidence-asset.js";
diff --git a/packages/domain/src/identifiers.ts b/packages/domain/src/identifiers.ts
index de8c8aa..c23b1c6 100644
--- a/packages/domain/src/identifiers.ts
+++ b/packages/domain/src/identifiers.ts
@@ -19,8 +19,14 @@ export type ClientId = Brand<string, "ClientId">;
 export type SkuId = Brand<string, "SkuId">;
 export type BatchId = Brand<string, "BatchId">;
 export type EvidenceId = Brand<string, "EvidenceId">;
+export type SourceObjectId = Brand<string, "SourceObjectId">;
+export type DerivativeId = Brand<string, "DerivativeId">;
+export type VerificationEventId = Brand<string, "VerificationEventId">;
 export type ActionId = Brand<string, "ActionId">;
 
+/** Lowercase 64-hex SHA-256 digest string */
+export type Sha256Hex = string & { readonly __sha256: true };
+
 function validateAndBrandUuid<B extends string>(
   val: unknown,
   _brandName: B,
@@ -57,6 +63,34 @@ export function createEvidenceId(val: string): EvidenceId {
   return validateAndBrandUuid(val, "EvidenceId", "evidenceId");
 }
 
+export function createSourceObjectId(val: string): SourceObjectId {
+  return validateAndBrandUuid(val, "SourceObjectId", "sourceObjectId");
+}
+
+export function createDerivativeId(val: string): DerivativeId {
+  return validateAndBrandUuid(val, "DerivativeId", "derivativeId");
+}
+
+export function createVerificationEventId(val: string): VerificationEventId {
+  return validateAndBrandUuid(val, "VerificationEventId", "verificationEventId");
+}
+
 export function createActionId(val: string): ActionId {
   return validateAndBrandUuid(val, "ActionId", "actionId");
 }
+
+export function createSha256Hex(val: string): Sha256Hex {
+  if (typeof val !== "string" || !/^[0-9a-f]{64}$/.test(val)) {
+    throw new ProductValidationError(
+      [
+        {
+          code: "INVALID_TEXT",
+          path: ["sha256"],
+          message: "sha256 must be a lowercase 64-hex SHA-256 digest string."
+        }
+      ],
+      `Invalid sha256: "${String(val)}" is not a valid 64-character lowercase hex digest.`
+    );
+  }
+  return val as Sha256Hex;
+}
diff --git a/packages/domain/src/index.ts b/packages/domain/src/index.ts
index f50cee8..eaa895e 100644
--- a/packages/domain/src/index.ts
+++ b/packages/domain/src/index.ts
@@ -18,3 +18,5 @@ export * from "./product-evidence-errors.js";
 export * from "./product-sku.js";
 export * from "./batch-facts.js";
 export * from "./product-batch.js";
+export * from "./source-object.js";
+export * from "./evidence-asset.js";
diff --git a/packages/domain/src/product-evidence-errors.ts b/packages/domain/src/product-evidence-errors.ts
index c47ab9e..8f5846c 100644
--- a/packages/domain/src/product-evidence-errors.ts
+++ b/packages/domain/src/product-evidence-errors.ts
@@ -128,3 +128,43 @@ export class IdempotencyConflictError extends ProductEvidenceDomainError {
     );
   }
 }
+
+export class SourceIntegrityMismatchError extends ProductEvidenceDomainError {
+  override readonly name = "SourceIntegrityMismatchError";
+
+  constructor(message: string, details?: Readonly<Record<string, unknown>>) {
+    super("SOURCE_INTEGRITY_MISMATCH", message, details);
+  }
+}
+
+export class MimeConflictError extends ProductEvidenceDomainError {
+  override readonly name = "MimeConflictError";
+
+  constructor(message: string, details?: Readonly<Record<string, unknown>>) {
+    super("MIME_CONFLICT", message, details);
+  }
+}
+
+export class SourceSupersededError extends ProductEvidenceDomainError {
+  override readonly name = "SourceSupersededError";
+
+  constructor(message: string, details?: Readonly<Record<string, unknown>>) {
+    super("SOURCE_SUPERSEDED", message, details);
+  }
+}
+
+export class QuotaExceededError extends ProductEvidenceDomainError {
+  override readonly name = "QuotaExceededError";
+
+  constructor(message: string, details?: Readonly<Record<string, unknown>>) {
+    super("QUOTA_EXCEEDED", message, details);
+  }
+}
+
+export class ReportDisputedError extends ProductEvidenceDomainError {
+  override readonly name = "ReportDisputedError";
+
+  constructor(message: string, details?: Readonly<Record<string, unknown>>) {
+    super("REPORT_DISPUTED", message, details);
+  }
+}
diff --git a/packages/domain/src/product-identifiers.test.ts b/packages/domain/src/product-identifiers.test.ts
index 1e89f07..eca8643 100644
--- a/packages/domain/src/product-identifiers.test.ts
+++ b/packages/domain/src/product-identifiers.test.ts
@@ -3,27 +3,40 @@ import {
   createActionId,
   createBatchId,
   createClientId,
+  createDerivativeId,
   createEvidenceId,
-  createSkuId
+  createSha256Hex,
+  createSkuId,
+  createSourceObjectId,
+  createVerificationEventId
 } from "./identifiers.js";
 import { ProductValidationError } from "./product-evidence-errors.js";
 
 describe("Product and Evidence Authority Brands", () => {
   const validV7 = "018f0000-0000-7000-8000-000000000001";
   const validV4 = "a0eebc99-9c0b-4ef8-bb6d-6bb9bd380a11";
+  const validSha = "a1b2c3d4e5f67890123456789abcdef0123456789abcdef0123456789abcdef0";
 
   it("creates validated branded identifiers from valid UUIDs", () => {
     const clientId = createClientId(validV7);
     const skuId = createSkuId(validV7);
     const batchId = createBatchId(validV4);
     const evidenceId = createEvidenceId(validV7);
+    const sourceObjectId = createSourceObjectId(validV7);
+    const derivativeId = createDerivativeId(validV4);
+    const verificationEventId = createVerificationEventId(validV7);
     const actionId = createActionId(validV4);
+    const sha256 = createSha256Hex(validSha);
 
     expect(clientId).toBe(validV7);
     expect(skuId).toBe(validV7);
     expect(batchId).toBe(validV4);
     expect(evidenceId).toBe(validV7);
+    expect(sourceObjectId).toBe(validV7);
+    expect(derivativeId).toBe(validV4);
+    expect(verificationEventId).toBe(validV7);
     expect(actionId).toBe(validV4);
+    expect(sha256).toBe(validSha);
   });
 
   it("normalizes uppercase hex to lowercase", () => {
@@ -38,6 +51,9 @@ describe("Product and Evidence Authority Brands", () => {
     expect(() => createSkuId(padded)).toThrow(ProductValidationError);
     expect(() => createBatchId(padded)).toThrow(ProductValidationError);
     expect(() => createEvidenceId(padded)).toThrow(ProductValidationError);
+    expect(() => createSourceObjectId(padded)).toThrow(ProductValidationError);
+    expect(() => createDerivativeId(padded)).toThrow(ProductValidationError);
+    expect(() => createVerificationEventId(padded)).toThrow(ProductValidationError);
     expect(() => createActionId(padded)).toThrow(ProductValidationError);
   });
 
@@ -45,4 +61,10 @@ describe("Product and Evidence Authority Brands", () => {
     expect(() => createClientId("not-a-uuid")).toThrow(ProductValidationError);
     expect(() => createSkuId("")).toThrow(ProductValidationError);
   });
+
+  it("rejects invalid sha256 hex strings", () => {
+    expect(() => createSha256Hex("short")).toThrow(ProductValidationError);
+    expect(() => createSha256Hex(` ${validSha} `)).toThrow(ProductValidationError);
+    expect(() => createSha256Hex(validSha.toUpperCase())).toThrow(ProductValidationError);
+  });
 });
diff --git a/packages/infrastructure/package.json b/packages/infrastructure/package.json
index a4d42af..bd10435 100644
--- a/packages/infrastructure/package.json
+++ b/packages/infrastructure/package.json
@@ -34,6 +34,7 @@
     "@cco/domain": "workspace:*",
     "@cco/shared": "workspace:*",
     "kokoro-js": "^1.2.1",
+    "pdf-lib": "1.17.1",
     "pg": "^8.13.1",
     "sharp": "0.34.5"
   },
diff --git a/packages/infrastructure/src/index.ts b/packages/infrastructure/src/index.ts
index 46bed44..a08d631 100644
--- a/packages/infrastructure/src/index.ts
+++ b/packages/infrastructure/src/index.ts
@@ -466,4 +466,14 @@ export {
   DEFAULT_MAX_PIXELS
 } from "./image/sharp-image-inspection-adapter.js";
 
+export {
+  OriginalsInspectionAdapter,
+  type OriginalsInspectionLimits
+} from "./evidence/originals-inspection-adapter.js";
+export { PostgresEvidenceLockCoordinator } from "./evidence/postgres-evidence-lock-coordinator.js";
+export {
+  PostgresEvidenceAssetRepository,
+  type PostgresEvidenceAssetRepositoryOptions
+} from "./evidence/postgres-evidence-asset-repository.js";
+
 export * from "./experiments/index.js";
diff --git a/packages/infrastructure/src/postgres/audit-protections.integration.test.ts b/packages/infrastructure/src/postgres/audit-protections.integration.test.ts
index f0d1153..7428003 100644
--- a/packages/infrastructure/src/postgres/audit-protections.integration.test.ts
+++ b/packages/infrastructure/src/postgres/audit-protections.integration.test.ts
@@ -499,7 +499,7 @@ describe("PostgreSQL audit immutability and application-role privileges integrat
     // Verify migration succeeds when no application role is configured
     await client.query("DROP SCHEMA public CASCADE; CREATE SCHEMA public;");
     const noRoleApplied = await runMigrations(client, { migrationsDirectory });
-    expect(noRoleApplied).toHaveLength(26);
+    expect(noRoleApplied).toHaveLength(27);
   });
 
   it("fails closed when application role has effective UPDATE or DELETE privilege on storyboard_candidates", async () => {
diff --git a/packages/infrastructure/src/postgres/baseline-schema.integration.test.ts b/packages/infrastructure/src/postgres/baseline-schema.integration.test.ts
index 41f5ef3..c06c672 100644
--- a/packages/infrastructure/src/postgres/baseline-schema.integration.test.ts
+++ b/packages/infrastructure/src/postgres/baseline-schema.integration.test.ts
@@ -55,7 +55,7 @@ describe("PostgreSQL 18.6 baseline schema integration", () => {
   it("migrates an empty PostgreSQL 18.6 database through the baseline", async () => {
     const applied = await runMigrations(client, { migrationsDirectory });
 
-    expect(applied).toHaveLength(26);
+    expect(applied).toHaveLength(27);
     expect(applied[0]?.version).toBe("001");
     expect(applied[1]?.version).toBe("002");
     expect(applied[2]?.version).toBe("003");
@@ -82,6 +82,7 @@ describe("PostgreSQL 18.6 baseline schema integration", () => {
     expect(applied[23]?.version).toBe("024");
     expect(applied[24]?.version).toBe("025");
     expect(applied[25]?.version).toBe("026");
+    expect(applied[26]?.version).toBe("027");
 
     const schemaRes = await client.query(
       "SELECT version FROM schema_migrations ORDER BY version ASC"
@@ -112,7 +113,8 @@ describe("PostgreSQL 18.6 baseline schema integration", () => {
       { version: "023" },
       { version: "024" },
       { version: "025" },
-      { version: "026" }
+      { version: "026" },
+      { version: "027" }
     ]);
 
     const tablesRes = await client.query<{ table_name: string }>(
@@ -126,6 +128,7 @@ describe("PostgreSQL 18.6 baseline schema integration", () => {
 
     const tableNames = tablesRes.rows.map((r) => r.table_name);
     expect(tableNames).toEqual([
+      "batch_evidence_links",
       "campaign_production_run_scenes",
       "campaign_production_runs",
       "campaign_reference_bible_changes",
@@ -133,6 +136,11 @@ describe("PostgreSQL 18.6 baseline schema integration", () => {
       "campaigns",
       "clients",
       "delivery_assembly_jobs",
+      "evidence_assets",
+      "evidence_derivatives",
+      "evidence_ingest_reservations",
+      "evidence_revisions",
+      "evidence_verification_events",
       "generation_manifests",
       "license_registry",
       "product_batch_facts",
@@ -148,6 +156,7 @@ describe("PostgreSQL 18.6 baseline schema integration", () => {
       "schema_migrations",
       "shot_plan_previs_associations",
       "shot_plans",
+      "source_objects",
       "storyboard_candidates",
       "storyboard_scenes"
     ]);
diff --git a/packages/infrastructure/src/postgres/job-dispatch-contract.integration.test.ts b/packages/infrastructure/src/postgres/job-dispatch-contract.integration.test.ts
index 3e113b5..9ff1a12 100644
--- a/packages/infrastructure/src/postgres/job-dispatch-contract.integration.test.ts
+++ b/packages/infrastructure/src/postgres/job-dispatch-contract.integration.test.ts
@@ -63,7 +63,8 @@ describe("PostgreSQL job dispatch schema contract integration", () => {
     expect(applied.some((m) => m.version === "024")).toBe(true);
     expect(applied.some((m) => m.version === "025")).toBe(true);
     expect(applied.some((m) => m.version === "026")).toBe(true);
-    expect(applied[applied.length - 1]?.version).toBe("026");
+    expect(applied.some((m) => m.version === "027")).toBe(true);
+    expect(applied[applied.length - 1]?.version).toBe("027");
 
     // 2. Run it again and assert []
     const rerun = await runMigrations(client, { migrationsDirectory });
diff --git a/packages/infrastructure/src/postgres/product-registry-schema.integration.test.ts b/packages/infrastructure/src/postgres/product-registry-schema.integration.test.ts
index faadf6e..a8fa6f6 100644
--- a/packages/infrastructure/src/postgres/product-registry-schema.integration.test.ts
+++ b/packages/infrastructure/src/postgres/product-registry-schema.integration.test.ts
@@ -2,7 +2,7 @@ import { mkdtemp, cp, rm, readdir } from "node:fs/promises";
 import { tmpdir } from "node:os";
 import { join } from "node:path";
 import { pathToFileURL, fileURLToPath } from "node:url";
-import { describe, it, expect, beforeAll, afterAll, beforeEach } from "vitest";
+import { describe, it, expect, beforeAll, afterAll, beforeEach, afterEach } from "vitest";
 import { Pool, type PoolClient } from "pg";
 import { runMigrations } from "./migration-runner.js";
 import {
@@ -43,6 +43,12 @@ describe("PostgreSQL product registry schema and protection integration", () =>
     await client.query("DROP SCHEMA public CASCADE; CREATE SCHEMA public;");
   });
 
+  afterEach(async () => {
+    if (client) {
+      await client.query("ROLLBACK").catch(() => {});
+    }
+  });
+
   it("applies migration 026 and registers exact tables and constraints", async () => {
     const applied = await runMigrations(client, { migrationsDirectory });
     expect(applied.some((m) => m.version === "026")).toBe(true);
@@ -172,7 +178,7 @@ describe("PostgreSQL product registry schema and protection integration", () =>
     ).rejects.toThrow(/chk_batch_facts_monotonic_rev/);
   });
 
-  it("enforces temporary rejection of origin evidence links via check constraint", async () => {
+  it("enforces rejection of origin evidence links without batch evidence link via foreign key constraint", async () => {
     await runMigrations(client, { migrationsDirectory });
     const clientRecord = await insertClientRecord(client);
 
@@ -197,7 +203,7 @@ describe("PostgreSQL product registry schema and protection integration", () =>
          VALUES ($1, $2, 1, 'own_production', uuidv7(), 1, 'tester')`,
         [clientRecord.client_id, batchId]
       )
-    ).rejects.toThrow(/chk_batch_facts_origin_evidence_deferred/);
+    ).rejects.toThrow(/fk_batch_facts_origin_evidence/);
     await client.query("ROLLBACK");
   });
 
diff --git a/packages/infrastructure/src/postgres/repositories/postgres-product-evidence-repository.integration.test.ts b/packages/infrastructure/src/postgres/repositories/postgres-product-evidence-repository.integration.test.ts
index 7b501c3..6ea7768 100644
--- a/packages/infrastructure/src/postgres/repositories/postgres-product-evidence-repository.integration.test.ts
+++ b/packages/infrastructure/src/postgres/repositories/postgres-product-evidence-repository.integration.test.ts
@@ -746,6 +746,7 @@ describe("PostgresProductEvidenceRepository and UoW integration", () => {
           payload: { skuId: sku1.skuId, lotIdentifier: "LOT-LATE", displayName: "Late Batch" }
         })
       );
+      pCreate.catch(() => {});
 
       await lockingClientA.query("COMMIT");
       await expect(pCreate).rejects.toThrow(AccessDeniedError);
diff --git a/packages/infrastructure/src/postgres/repositories/postgres-product-evidence-repository.ts b/packages/infrastructure/src/postgres/repositories/postgres-product-evidence-repository.ts
index 99f682a..93303c2 100644
--- a/packages/infrastructure/src/postgres/repositories/postgres-product-evidence-repository.ts
+++ b/packages/infrastructure/src/postgres/repositories/postgres-product-evidence-repository.ts
@@ -29,6 +29,7 @@ import {
   createProductBatch,
   createProductSku,
   createSkuId,
+  CrossBatchSourceError,
   CrossClientViolationError,
   DuplicateLotError,
   DuplicateSkuError,
@@ -39,6 +40,7 @@ import {
   rehydrateBatchFactsRevision,
   rehydrateProductBatch,
   rehydrateProductSku,
+  ReportDisputedError,
   StaleRevisionConflictError,
   updateProductBatchMetadata,
   updateProductSkuMetadata,
@@ -388,7 +390,14 @@ const PRODUCT_REGISTRY_TABLES = new Set<string>([
   "product_skus",
   "product_batches",
   "product_batch_facts",
-  "product_evidence_command_receipts"
+  "product_evidence_command_receipts",
+  "source_objects",
+  "evidence_assets",
+  "evidence_revisions",
+  "batch_evidence_links",
+  "evidence_derivatives",
+  "evidence_verification_events",
+  "evidence_ingest_reservations"
 ]);
 
 const REGISTRY_CONSTRAINTS = new Set<string>([
@@ -411,6 +420,7 @@ const REGISTRY_CONSTRAINTS = new Set<string>([
   "chk_product_batches_display_name",
   "chk_batch_facts_monotonic_rev",
   "chk_batch_facts_origin_evidence_all_or_none",
+  "fk_batch_facts_origin_evidence",
   "chk_batch_facts_origin_evidence_deferred",
   "chk_batch_facts_dates",
   "chk_batch_facts_asserted_by_nonempty",
@@ -428,7 +438,109 @@ const REGISTRY_CONSTRAINTS = new Set<string>([
   "chk_product_skus_archived_at",
   "chk_product_batches_created_at",
   "chk_product_batches_updated_at",
-  "chk_product_batches_archived_at"
+  "chk_product_batches_archived_at",
+  "uq_reference_assets_client_asset",
+  "source_objects_pkey",
+  "uq_source_objects_client_obj",
+  "uq_source_objects_client_hash",
+  "uq_source_objects_storage",
+  "uq_source_objects_storage_location",
+  "source_objects_byte_length_check",
+  "source_objects_access_class_check",
+  "source_objects_retention_class_check",
+  "source_objects_availability_check",
+  "source_objects_client_id_fkey",
+  "chk_sha256_format",
+  "chk_source_objects_uploader_nonempty",
+  "chk_source_objects_policy_nonempty",
+  "chk_source_objects_mime_nonempty",
+  "chk_source_objects_bucket_nonempty",
+  "chk_source_objects_key_nonempty",
+  "chk_source_objects_uploaded_at",
+  "chk_source_object_hash_format",
+  "chk_source_object_bucket_nonempty",
+  "chk_source_object_key_nonempty",
+  "chk_source_object_mime_nonempty",
+  "chk_source_object_uploader_nonempty",
+  "chk_source_object_policy_nonempty",
+  "chk_source_object_timestamps",
+  "evidence_assets_pkey",
+  "uq_evidence_assets_client_evidence",
+  "evidence_assets_current_revision_check",
+  "evidence_assets_version_check",
+  "evidence_assets_client_id_fkey",
+  "chk_evidence_assets_created_at",
+  "chk_evidence_assets_archived_at",
+  "chk_evidence_asset_revision_pos",
+  "chk_evidence_asset_version_pos",
+  "chk_evidence_asset_timestamps",
+  "fk_evidence_assets_current_rev",
+  "fk_evidence_assets_client",
+  "evidence_revisions_pkey",
+  "uq_evidence_revisions_client_revision",
+  "uq_evidence_revisions_predecessor",
+  "uq_evidence_rev_predecessor",
+  "fk_evidence_revisions_asset",
+  "fk_evidence_revisions_source",
+  "fk_evidence_revisions_predecessor",
+  "chk_evidence_rev_monotonic",
+  "chk_evidence_revision_supersedes_not_self",
+  "chk_evidence_revisions_assertion_nonempty",
+  "chk_evidence_revisions_submitted_by_nonempty",
+  "chk_evidence_revisions_submitted_at",
+  "chk_evidence_revisions_capture_date",
+  "chk_evidence_revisions_capture_timestamp",
+  "chk_evidence_revisions_capture_date_match",
+  "chk_evidence_revision_number_pos",
+  "chk_evidence_revision_submitted_by_nonempty",
+  "chk_evidence_revision_assertion_nonempty",
+  "chk_evidence_revision_submitted_at",
+  "chk_evidence_revision_capture_dates",
+  "chk_evidence_revision_rights_attribution",
+  "chk_evidence_revision_rights_document",
+  "evidence_revisions_revision_check",
+  "evidence_revisions_source_class_check",
+  "evidence_revisions_acquisition_method_check",
+  "evidence_revisions_rights_status_check",
+  "evidence_revisions_consent_status_check",
+  "evidence_revisions_reported_capture_precision_check",
+  "batch_evidence_links_pkey",
+  "uq_batch_evidence_links_full",
+  "uq_batch_evidence_links_client_link",
+  "fk_batch_evidence_batch",
+  "fk_batch_evidence_revision",
+  "batch_evidence_links_purpose_check",
+  "chk_batch_evidence_asserted_by_nonempty",
+  "chk_batch_evidence_asserted_at",
+  "chk_batch_evidence_purpose_nonempty",
+  "evidence_derivatives_pkey",
+  "uq_evidence_derivatives_client_deriv",
+  "uq_evidence_derivatives_bridge",
+  "fk_evidence_derivatives_revision",
+  "fk_evidence_derivatives_reference",
+  "chk_derivative_sha256_format",
+  "chk_derivative_transform_nonempty",
+  "chk_derivative_created_by_nonempty",
+  "chk_derivative_created_at",
+  "evidence_verification_events_pkey",
+  "uq_verification_events_client_event",
+  "uq_verification_events_full",
+  "fk_verification_events_revision",
+  "fk_verification_events_withdrawal",
+  "evidence_verification_events_outcome_check",
+  "evidence_verification_events_verification_kind_check",
+  "evidence_verification_events_fact_scope_check",
+  "chk_verification_events_withdrawal_no_self",
+  "chk_verification_events_method_nonempty",
+  "chk_verification_events_reason_nonempty",
+  "chk_verification_events_actor_nonempty",
+  "chk_verification_events_occurred_at",
+  "evidence_ingest_reservations_pkey",
+  "evidence_ingest_reservations_client_id_fkey",
+  "evidence_ingest_reservations_reserved_bytes_check",
+  "evidence_ingest_reservations_status_check",
+  "chk_reservation_sha256_format",
+  "chk_reservation_timestamps"
 ]);
 
 export function translateDatabaseError(
@@ -446,6 +558,43 @@ export function translateDatabaseError(
 
     switch (dbErr.code) {
       case "23505": {
+        if (dbErr.constraint === "uq_evidence_derivatives_bridge") {
+          throw new ProductValidationError([
+            {
+              code: "INVALID_FIELD_COMBINATION",
+              path: ["derivative"],
+              message: "A derivative link already exists for this revision and reference asset."
+            }
+          ]);
+        }
+        if (
+          dbErr.constraint === "uq_evidence_revisions_client_revision" ||
+          dbErr.constraint === "uq_evidence_revisions_predecessor" ||
+          dbErr.constraint === "uq_evidence_rev_predecessor" ||
+          dbErr.constraint === "evidence_revisions_pkey"
+        ) {
+          throw new NonMonotonicRevisionError(
+            "Evidence revision conflict: duplicate or forked revision"
+          );
+        }
+        if (
+          dbErr.constraint === "uq_source_objects_client_hash" ||
+          dbErr.constraint === "uq_source_objects_storage" ||
+          dbErr.constraint === "uq_source_objects_storage_location" ||
+          dbErr.constraint === "uq_source_objects_client_obj" ||
+          dbErr.constraint === "source_objects_pkey"
+        ) {
+          throw new ConcurrencyConflictError(`Duplicate source object conflict: ${dbErr.message}`);
+        }
+        if (
+          dbErr.constraint === "uq_batch_evidence_links_client_link" ||
+          dbErr.constraint === "uq_batch_evidence_links_full" ||
+          dbErr.constraint === "batch_evidence_links_pkey"
+        ) {
+          throw new ConcurrencyConflictError(
+            `Evidence revision is already linked to this batch: ${dbErr.message}`
+          );
+        }
         if (dbErr.constraint === "uq_product_skus_canonical") {
           throw new DuplicateSkuError(context?.canonicalSku ?? "unknown", context?.clientId);
         }
@@ -463,9 +612,76 @@ export function translateDatabaseError(
             "Predecessor revision conflict: duplicate or forked predecessor"
           );
         }
+        if (
+          dbErr.constraint === "uq_verification_events_client_event" ||
+          dbErr.constraint === "uq_verification_events_full" ||
+          dbErr.constraint === "evidence_verification_events_pkey"
+        ) {
+          throw new ConcurrencyConflictError(
+            `Duplicate verification event conflict: ${dbErr.message}`
+          );
+        }
+        if (
+          dbErr.constraint === "uq_evidence_assets_client_evidence" ||
+          dbErr.constraint === "evidence_assets_pkey"
+        ) {
+          throw new ConcurrencyConflictError(`Duplicate evidence asset conflict: ${dbErr.message}`);
+        }
+        if (
+          dbErr.constraint === "uq_evidence_derivatives_client_deriv" ||
+          dbErr.constraint === "evidence_derivatives_pkey"
+        ) {
+          throw new ConcurrencyConflictError(
+            `Duplicate evidence derivative conflict: ${dbErr.message}`
+          );
+        }
+        if (dbErr.constraint === "evidence_ingest_reservations_pkey") {
+          throw new ConcurrencyConflictError(
+            `Duplicate evidence ingest reservation conflict: ${dbErr.message}`
+          );
+        }
+        if (
+          (dbErr.constraint && REGISTRY_CONSTRAINTS.has(dbErr.constraint)) ||
+          (dbErr.table && PRODUCT_REGISTRY_TABLES.has(dbErr.table))
+        ) {
+          throw new ConcurrencyConflictError(`Unique constraint conflict: ${dbErr.message}`);
+        }
         break;
       }
       case "23503": {
+        if (dbErr.constraint === "fk_evidence_assets_current_rev") {
+          throw new StaleRevisionConflictError("EvidenceAsset", 0, 0);
+        }
+        if (dbErr.constraint === "fk_evidence_derivatives_reference") {
+          throw new NotFoundError(
+            "ReferenceAsset",
+            "Referenced derivative reference asset does not exist"
+          );
+        }
+        if (dbErr.constraint === "fk_evidence_derivatives_revision") {
+          throw new NotFoundError(
+            "EvidenceRevision",
+            "Referenced evidence revision does not exist"
+          );
+        }
+        if (dbErr.constraint === "fk_evidence_revisions_source") {
+          throw new NotFoundError("SourceObject", "Referenced source object does not exist");
+        }
+        if (dbErr.constraint === "fk_batch_evidence_revision") {
+          throw new NotFoundError(
+            "EvidenceRevision",
+            "Referenced evidence revision does not exist"
+          );
+        }
+        if (dbErr.constraint === "fk_batch_evidence_batch") {
+          throw new NotFoundError("ProductBatch", "Referenced product batch does not exist");
+        }
+        if (
+          dbErr.constraint === "fk_source_objects_client" ||
+          dbErr.constraint === "fk_evidence_assets_client"
+        ) {
+          throw new NotFoundError("Client", context?.clientId ?? "unknown");
+        }
         if (dbErr.constraint === "fk_product_batches_sku") {
           throw new CrossClientViolationError(
             "Referenced SKU does not exist or belongs to a different client"
@@ -483,6 +699,12 @@ export function translateDatabaseError(
         if (dbErr.constraint === "fk_batch_facts_predecessor") {
           throw new NonMonotonicRevisionError("Predecessor facts revision does not exist");
         }
+        if (dbErr.constraint === "fk_batch_facts_origin_evidence") {
+          throw new NotFoundError(
+            "BatchEvidenceLink",
+            "Referenced origin evidence revision is not linked to this batch"
+          );
+        }
         if (
           dbErr.constraint === "fk_product_skus_client" ||
           dbErr.constraint === "product_skus_client_id_fkey" ||
@@ -511,6 +733,33 @@ export function translateDatabaseError(
             "RESTRICT_VIOLATION"
           );
         }
+        if (
+          dbErr.constraint === "fk_evidence_revisions_asset" ||
+          dbErr.constraint === "evidence_revisions_client_id_fkey"
+        ) {
+          throw new NotFoundError("EvidenceAsset", "Referenced evidence asset does not exist");
+        }
+        if (dbErr.constraint === "fk_evidence_revisions_predecessor") {
+          throw new NonMonotonicRevisionError("Predecessor evidence revision does not exist");
+        }
+        if (dbErr.constraint === "fk_verification_events_revision") {
+          throw new NotFoundError(
+            "EvidenceRevision",
+            "Referenced evidence revision does not exist"
+          );
+        }
+        if (dbErr.constraint === "fk_verification_events_withdrawal") {
+          throw new NotFoundError(
+            "EvidenceVerificationEvent",
+            "Referenced withdrawal event does not exist"
+          );
+        }
+        if (
+          (dbErr.constraint && REGISTRY_CONSTRAINTS.has(dbErr.constraint)) ||
+          (dbErr.table && PRODUCT_REGISTRY_TABLES.has(dbErr.table))
+        ) {
+          throw new NotFoundError("Entity", `Referenced entity does not exist: ${dbErr.message}`);
+        }
         break;
       }
       case "23001": {
@@ -537,7 +786,15 @@ export function translateDatabaseError(
           dbErr.message.includes("append-only") ||
           dbErr.message.includes("Archived SKU") ||
           dbErr.message.includes("Archived Batch") ||
-          dbErr.message.includes("updated_at must be nondecreasing")
+          dbErr.message.includes("updated_at must be nondecreasing") ||
+          dbErr.message.includes("Permanent evidence asset identity") ||
+          dbErr.message.includes("Permanent source object binary columns") ||
+          dbErr.message.includes("Archived evidence asset") ||
+          dbErr.message.includes("Archived source objects") ||
+          dbErr.message.includes("Deleted source objects") ||
+          dbErr.message.includes("Quarantined, archived, or deleted") ||
+          dbErr.message.includes("cannot be reactivated") ||
+          dbErr.message.includes("Storage version ID cannot be changed")
         ) {
           throw new AccessDeniedError(dbErr.message);
         }
@@ -553,10 +810,23 @@ export function translateDatabaseError(
         if (dbErr.message.includes("facts pointer")) {
           throw new NonMonotonicRevisionError(dbErr.message);
         }
+        if (
+          (dbErr.table && PRODUCT_REGISTRY_TABLES.has(dbErr.table)) ||
+          (dbErr.constraint && REGISTRY_CONSTRAINTS.has(dbErr.constraint)) ||
+          dbErr.message
+        ) {
+          throw new AccessDeniedError(dbErr.message);
+        }
         break;
       }
       case "23514": {
         // Check constraints - strictly allowlisted registry checks only
+        if (
+          dbErr.constraint === "chk_evidence_rev_monotonic" ||
+          dbErr.constraint === "chk_evidence_revision_supersedes_not_self"
+        ) {
+          throw new NonMonotonicRevisionError("Evidence revision must be contiguous and monotonic");
+        }
         if (dbErr.constraint === "chk_batch_facts_monotonic_rev") {
           throw new NonMonotonicRevisionError(
             "Batch facts revision must be contiguous and monotonic"
@@ -597,7 +867,8 @@ export function translateDatabaseError(
             {
               code: "INVALID_FIELD_COMBINATION",
               path: ["originEvidenceId"],
-              message: "Origin evidence linkage is not yet supported in this phase."
+              message:
+                "originEvidenceId and originEvidenceRevision must either both be specified or both be omitted."
             }
           ]);
         }
@@ -693,17 +964,33 @@ export function translateDatabaseError(
             }
           ]);
         }
+        if (
+          (dbErr.constraint && REGISTRY_CONSTRAINTS.has(dbErr.constraint)) ||
+          dbErr.constraint?.startsWith("chk_source_object") ||
+          dbErr.constraint?.startsWith("chk_evidence_") ||
+          dbErr.constraint?.startsWith("chk_batch_evidence_") ||
+          dbErr.constraint?.startsWith("chk_derivative_") ||
+          dbErr.constraint?.startsWith("chk_verification_events_") ||
+          dbErr.constraint?.startsWith("chk_reservation_") ||
+          dbErr.constraint === "chk_sha256_format" ||
+          (dbErr.table && PRODUCT_REGISTRY_TABLES.has(dbErr.table))
+        ) {
+          throw new ProductValidationError([
+            {
+              code: "INVALID_FIELD_COMBINATION",
+              path: [],
+              message: dbErr.message
+            }
+          ]);
+        }
         break;
       }
       case "40001":
       case "40P01":
       case "55P03": {
-        if (context !== undefined || (dbErr.table && PRODUCT_REGISTRY_TABLES.has(dbErr.table))) {
-          throw new ConcurrencyConflictError(
-            `PostgreSQL transaction concurrency failure (${dbErr.code}): ${dbErr.message}`
-          );
-        }
-        break;
+        throw new ConcurrencyConflictError(
+          `PostgreSQL transaction concurrency failure (${dbErr.code}): ${dbErr.message}`
+        );
       }
     }
   }
@@ -719,27 +1006,36 @@ export function isProductRegistryDatabaseError(err: unknown): boolean {
       message: string;
       table?: string;
     };
+    if (dbErr.code === "40001" || dbErr.code === "40P01" || dbErr.code === "55P03") {
+      return true;
+    }
+    if (dbErr.code === "23506") {
+      return true;
+    }
     if (dbErr.constraint && REGISTRY_CONSTRAINTS.has(dbErr.constraint)) {
       return true;
     }
     if (dbErr.table && PRODUCT_REGISTRY_TABLES.has(dbErr.table)) {
       return true;
     }
-    if (dbErr.code === "23506") {
-      return (
-        dbErr.message.includes("Permanent SKU identity") ||
-        dbErr.message.includes("Permanent Batch identity") ||
-        dbErr.message.includes("CANNOT_DELETE_HEAD_ENTITY") ||
-        dbErr.message.includes("CANNOT_MODIFY_IMMUTABLE_ENTITY") ||
-        dbErr.message.includes("Archived SKU") ||
-        dbErr.message.includes("Archived Batch") ||
-        dbErr.message.includes("Cannot create batch under archived SKU") ||
-        dbErr.message.includes("Cannot append facts to archived batch") ||
-        dbErr.message.includes("version must advance") ||
-        dbErr.message.includes("facts pointer") ||
-        dbErr.message.includes("updated_at must be nondecreasing")
-      );
-    }
+    return (
+      dbErr.message.includes("Permanent SKU identity") ||
+      dbErr.message.includes("Permanent Batch identity") ||
+      dbErr.message.includes("CANNOT_DELETE_HEAD_ENTITY") ||
+      dbErr.message.includes("CANNOT_MODIFY_IMMUTABLE_ENTITY") ||
+      dbErr.message.includes("Archived SKU") ||
+      dbErr.message.includes("Archived Batch") ||
+      dbErr.message.includes("Cannot create batch under archived SKU") ||
+      dbErr.message.includes("Cannot append facts to archived batch") ||
+      dbErr.message.includes("version must advance") ||
+      dbErr.message.includes("facts pointer") ||
+      dbErr.message.includes("updated_at must be nondecreasing") ||
+      dbErr.message.includes("Permanent source object binary columns") ||
+      dbErr.message.includes("cannot be reactivated") ||
+      dbErr.message.includes("Storage version ID cannot be changed") ||
+      dbErr.message.includes("forbids UPDATE or DELETE") ||
+      dbErr.message.includes("forbids DELETE")
+    );
   }
   return false;
 }
@@ -923,24 +1219,54 @@ export class PostgresProductEvidenceRepository implements ProductEvidenceReposit
         "initialFacts"
       ]);
       const facts = cmd.payload.initialFacts;
-      if (facts.originEvidenceId !== null && facts.originEvidenceId !== undefined) {
+      if (
+        facts.originEvidenceId !== null &&
+        facts.originEvidenceId !== undefined &&
+        (facts.originEvidenceRevision === null || facts.originEvidenceRevision === undefined)
+      ) {
         throw new ProductValidationError([
           {
             code: "INVALID_FIELD_COMBINATION",
-            path: ["initialFacts", "originEvidenceId"],
-            message: "Origin evidence linkage is not yet supported in this phase."
+            path: ["initialFacts", "originEvidenceRevision"],
+            message: "originEvidenceRevision must be specified when originEvidenceId is present."
           }
         ]);
       }
-      if (facts.originEvidenceRevision !== null && facts.originEvidenceRevision !== undefined) {
+      if (
+        (facts.originEvidenceId === null || facts.originEvidenceId === undefined) &&
+        facts.originEvidenceRevision !== null &&
+        facts.originEvidenceRevision !== undefined
+      ) {
         throw new ProductValidationError([
           {
             code: "INVALID_FIELD_COMBINATION",
             path: ["initialFacts", "originEvidenceRevision"],
-            message: "Origin evidence linkage is not yet supported in this phase."
+            message: "originEvidenceRevision cannot be specified without originEvidenceId."
           }
         ]);
       }
+      if (facts.originEvidenceId !== null && facts.originEvidenceId !== undefined) {
+        if (!isValidUuid(facts.originEvidenceId)) {
+          throw new ProductValidationError([
+            {
+              code: "INVALID_IDENTIFIER",
+              path: ["initialFacts", "originEvidenceId"],
+              message: "originEvidenceId must be a valid UUID string."
+            }
+          ]);
+        }
+      }
+      if (facts.originEvidenceRevision !== null && facts.originEvidenceRevision !== undefined) {
+        if (!isValidPositiveInt(facts.originEvidenceRevision)) {
+          throw new ProductValidationError([
+            {
+              code: "INVALID_REVISION",
+              path: ["initialFacts", "originEvidenceRevision"],
+              message: "originEvidenceRevision must be a positive integer."
+            }
+          ]);
+        }
+      }
       if (!facts.originKind || !ALLOWED_ORIGIN_KINDS.has(facts.originKind)) {
         throw new ProductValidationError([
           {
@@ -1026,6 +1352,34 @@ export class PostgresProductEvidenceRepository implements ProductEvidenceReposit
       const idRes = await client.query<{ id: string }>("SELECT uuidv7() AS id");
       const batchId = createBatchId(idRes.rows[0]!.id);
 
+      if (
+        cmd.payload.initialFacts?.originEvidenceId != null &&
+        cmd.payload.initialFacts?.originEvidenceRevision != null
+      ) {
+        const linkRes = await client.query<{ batch_id: string }>(
+          `SELECT batch_id FROM batch_evidence_links
+           WHERE client_id = $1 AND evidence_id = $2 AND evidence_revision = $3`,
+          [
+            cmd.clientId,
+            cmd.payload.initialFacts.originEvidenceId,
+            cmd.payload.initialFacts.originEvidenceRevision
+          ]
+        );
+        if (linkRes.rows.length === 0) {
+          throw new NotFoundError(
+            "BatchEvidenceLink",
+            `${cmd.payload.initialFacts.originEvidenceId}#${cmd.payload.initialFacts.originEvidenceRevision}`
+          );
+        }
+        throw new CrossBatchSourceError(
+          `Evidence ${cmd.payload.initialFacts.originEvidenceId} revision ${cmd.payload.initialFacts.originEvidenceRevision} is linked to batch ${linkRes.rows[0]!.batch_id} but not batch ${batchId}. Explicit fresh batch evidence link is required.`,
+          {
+            sha256: cmd.payload.initialFacts.originEvidenceId,
+            existingBatchId: linkRes.rows[0]!.batch_id
+          }
+        );
+      }
+
       const creation = createProductBatch({
         parentSku,
         batchId,
@@ -1060,7 +1414,7 @@ export class PostgresProductEvidenceRepository implements ProductEvidenceReposit
           client_id, batch_id, revision, origin_kind, producer_identity_as_claimed,
           production_start_date, production_end_date, origin_evidence_id, origin_evidence_revision,
           asserted_by, asserted_at, supersedes_revision
-        ) VALUES ($1, $2, $3, $4, $5, $6, $7, NULL, NULL, $8, $9, NULL)`,
+        ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, NULL)`,
         [
           creation.initialFacts.clientId,
           creation.initialFacts.batchId,
@@ -1069,6 +1423,8 @@ export class PostgresProductEvidenceRepository implements ProductEvidenceReposit
           creation.initialFacts.producerIdentityAsClaimed,
           creation.initialFacts.productionStartDate,
           creation.initialFacts.productionEndDate,
+          creation.initialFacts.originEvidenceId,
+          creation.initialFacts.originEvidenceRevision,
           creation.initialFacts.assertedBy,
           creation.initialFacts.assertedAt
         ]
@@ -1111,16 +1467,22 @@ export class PostgresProductEvidenceRepository implements ProductEvidenceReposit
       ]);
     }
 
-    if (cmd.payload.originEvidenceId !== null && cmd.payload.originEvidenceId !== undefined) {
+    if (
+      cmd.payload.originEvidenceId !== null &&
+      cmd.payload.originEvidenceId !== undefined &&
+      (cmd.payload.originEvidenceRevision === null ||
+        cmd.payload.originEvidenceRevision === undefined)
+    ) {
       throw new ProductValidationError([
         {
           code: "INVALID_FIELD_COMBINATION",
-          path: ["originEvidenceId"],
-          message: "Origin evidence linkage is not yet supported in this phase."
+          path: ["originEvidenceRevision"],
+          message: "originEvidenceRevision must be specified when originEvidenceId is present."
         }
       ]);
     }
     if (
+      (cmd.payload.originEvidenceId === null || cmd.payload.originEvidenceId === undefined) &&
       cmd.payload.originEvidenceRevision !== null &&
       cmd.payload.originEvidenceRevision !== undefined
     ) {
@@ -1128,10 +1490,35 @@ export class PostgresProductEvidenceRepository implements ProductEvidenceReposit
         {
           code: "INVALID_FIELD_COMBINATION",
           path: ["originEvidenceRevision"],
-          message: "Origin evidence linkage is not yet supported in this phase."
+          message: "originEvidenceRevision cannot be specified without originEvidenceId."
         }
       ]);
     }
+    if (cmd.payload.originEvidenceId !== null && cmd.payload.originEvidenceId !== undefined) {
+      if (!isValidUuid(cmd.payload.originEvidenceId)) {
+        throw new ProductValidationError([
+          {
+            code: "INVALID_IDENTIFIER",
+            path: ["originEvidenceId"],
+            message: "originEvidenceId must be a valid UUID string."
+          }
+        ]);
+      }
+    }
+    if (
+      cmd.payload.originEvidenceRevision !== null &&
+      cmd.payload.originEvidenceRevision !== undefined
+    ) {
+      if (!isValidPositiveInt(cmd.payload.originEvidenceRevision)) {
+        throw new ProductValidationError([
+          {
+            code: "INVALID_REVISION",
+            path: ["originEvidenceRevision"],
+            message: "originEvidenceRevision must be a positive integer."
+          }
+        ]);
+      }
+    }
 
     if (!cmd.payload.originKind || !ALLOWED_ORIGIN_KINDS.has(cmd.payload.originKind)) {
       throw new ProductValidationError([
@@ -1260,6 +1647,91 @@ export class PostgresProductEvidenceRepository implements ProductEvidenceReposit
       }
       const previousFacts = mapRowToFacts(factsRes.rows[0]!);
 
+      if (cmd.payload.originEvidenceId != null && cmd.payload.originEvidenceRevision != null) {
+        const linkRes = await client.query<{ batch_id: string; source_object_id: string }>(
+          `SELECT l.batch_id, r.source_object_id
+           FROM batch_evidence_links l
+           JOIN evidence_revisions r
+             ON r.client_id = l.client_id AND r.evidence_id = l.evidence_id AND r.revision = l.evidence_revision
+           WHERE l.client_id = $1 AND l.evidence_id = $2 AND l.evidence_revision = $3
+           FOR SHARE OF l, r`,
+          [cmd.clientId, cmd.payload.originEvidenceId, cmd.payload.originEvidenceRevision]
+        );
+        if (linkRes.rows.length === 0) {
+          throw new NotFoundError(
+            "BatchEvidenceLink",
+            `${cmd.payload.originEvidenceId}#${cmd.payload.originEvidenceRevision}`
+          );
+        }
+        if (!linkRes.rows.some((r) => r.batch_id === cmd.payload.batchId)) {
+          throw new CrossBatchSourceError(
+            `Evidence ${cmd.payload.originEvidenceId} revision ${cmd.payload.originEvidenceRevision} is linked to batch ${linkRes.rows[0]!.batch_id} but not batch ${cmd.payload.batchId}. Explicit fresh batch evidence link is required.`,
+            {
+              sha256: cmd.payload.originEvidenceId,
+              existingBatchId: linkRes.rows[0]!.batch_id
+            }
+          );
+        }
+
+        // Check EvidenceAsset is not archived
+        const assetRes = await client.query<{ archived_at: Date | null }>(
+          `SELECT archived_at FROM evidence_assets
+           WHERE client_id = $1 AND evidence_id = $2 FOR SHARE`,
+          [cmd.clientId, cmd.payload.originEvidenceId]
+        );
+        if (assetRes.rows.length === 0) {
+          throw new NotFoundError("EvidenceAsset", cmd.payload.originEvidenceId);
+        }
+        if (assetRes.rows[0]!.archived_at !== null) {
+          throw new AccessDeniedError(
+            "Referenced evidence asset is archived.",
+            "EVIDENCE_ARCHIVED"
+          );
+        }
+
+        // Check SourceObject is available
+        const sourceRes = await client.query<{ availability: string }>(
+          `SELECT availability FROM source_objects
+           WHERE client_id = $1 AND source_object_id = $2 FOR SHARE`,
+          [cmd.clientId, linkRes.rows[0]!.source_object_id]
+        );
+        if (sourceRes.rows.length === 0) {
+          throw new NotFoundError("SourceObject", linkRes.rows[0]!.source_object_id);
+        }
+        if (sourceRes.rows[0]!.availability !== "available") {
+          throw new AccessDeniedError(
+            `Referenced source object is unavailable (${sourceRes.rows[0]!.availability}).`,
+            "SOURCE_UNAVAILABLE"
+          );
+        }
+
+        // Check for active disputes on this revision
+        const disputeRes = await client.query<{
+          event_id: string;
+          outcome: string;
+          withdrawal_event_id: string | null;
+        }>(
+          `SELECT event_id, outcome, withdrawal_event_id
+           FROM evidence_verification_events
+           WHERE client_id = $1 AND evidence_id = $2 AND evidence_revision = $3
+           ORDER BY occurred_at ASC FOR SHARE`,
+          [cmd.clientId, cmd.payload.originEvidenceId, cmd.payload.originEvidenceRevision]
+        );
+        const activeDisputes = new Set<string>();
+        for (const evt of disputeRes.rows) {
+          if (evt.outcome === "disputed" || evt.outcome === "rejected") {
+            activeDisputes.add(evt.event_id);
+          } else if (evt.outcome === "withdrawn" && evt.withdrawal_event_id) {
+            activeDisputes.delete(evt.withdrawal_event_id);
+          }
+        }
+        if (activeDisputes.size > 0) {
+          throw new ReportDisputedError(
+            `Referenced evidence revision ${cmd.payload.originEvidenceId}#${cmd.payload.originEvidenceRevision} has an active dispute or rejection and cannot be linked as batch origin.`
+          );
+        }
+      }
+
       const nextFacts = appendBatchFactsRevision(previousFacts, {
         originKind: cmd.payload.originKind,
         producerIdentityAsClaimed: cmd.payload.producerIdentityAsClaimed,
@@ -1284,7 +1756,7 @@ export class PostgresProductEvidenceRepository implements ProductEvidenceReposit
           client_id, batch_id, revision, origin_kind, producer_identity_as_claimed,
           production_start_date, production_end_date, origin_evidence_id, origin_evidence_revision,
           asserted_by, asserted_at, supersedes_revision
-        ) VALUES ($1, $2, $3, $4, $5, $6, $7, NULL, NULL, $8, $9, $10)`,
+        ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)`,
         [
           nextFacts.clientId,
           nextFacts.batchId,
@@ -1293,6 +1765,8 @@ export class PostgresProductEvidenceRepository implements ProductEvidenceReposit
           nextFacts.producerIdentityAsClaimed,
           nextFacts.productionStartDate,
           nextFacts.productionEndDate,
+          nextFacts.originEvidenceId,
+          nextFacts.originEvidenceRevision,
           nextFacts.assertedBy,
           nextFacts.assertedAt,
           nextFacts.supersedesRevision
diff --git a/packages/infrastructure/src/postgres/uow/postgres-unit-of-work.ts b/packages/infrastructure/src/postgres/uow/postgres-unit-of-work.ts
index 7a82c42..69811a4 100644
--- a/packages/infrastructure/src/postgres/uow/postgres-unit-of-work.ts
+++ b/packages/infrastructure/src/postgres/uow/postgres-unit-of-work.ts
@@ -18,6 +18,7 @@ import {
   PostgresProductEvidenceRepository,
   translateDatabaseError
 } from "../repositories/postgres-product-evidence-repository.js";
+import { PostgresEvidenceAssetRepository } from "../../evidence/postgres-evidence-asset-repository.js";
 
 export class PostgresUnitOfWork implements UnitOfWork {
   constructor(private readonly pool: Pool) {}
@@ -45,6 +46,9 @@ export class PostgresUnitOfWork implements UnitOfWork {
         campaignReferenceBible: new PostgresCampaignReferenceBibleRepository(client),
         productEvidence: new PostgresProductEvidenceRepository(client, {
           externalTransaction: true
+        }),
+        evidenceAsset: new PostgresEvidenceAssetRepository(client, {
+          externalTransaction: true
         })
       };
 
diff --git a/packages/infrastructure/src/storage/provision.integration.test.ts b/packages/infrastructure/src/storage/provision.integration.test.ts
index 6b0ffd6..85818b9 100644
--- a/packages/infrastructure/src/storage/provision.integration.test.ts
+++ b/packages/infrastructure/src/storage/provision.integration.test.ts
@@ -42,28 +42,28 @@ describe("Storage Provisioning integration with real MinIO", () => {
     }
   });
 
-  it("provisions all four buckets and is idempotent on repeat execution", async () => {
+  it("provisions all five buckets and is idempotent on repeat execution", async () => {
     // 1. Initial provisioning on clean MinIO container
     const initialSummary = await provisionStorageBuckets({
       client: rawS3Client
     });
 
-    expect(initialSummary.results).toHaveLength(4);
-    expect(initialSummary.createdCount).toBe(4);
+    expect(initialSummary.results).toHaveLength(5);
+    expect(initialSummary.createdCount).toBe(5);
     expect(initialSummary.alreadyExistsCount).toBe(0);
     expect(initialSummary.lifecycleAppliedCount).toBe(2); // temp (14d) and review (60d)
-    expect(initialSummary.lifecycleSkippedCount).toBe(2); // reference and delivery
+    expect(initialSummary.lifecycleSkippedCount).toBe(3); // reference, delivery, and evidence
 
     // 2. Second provisioning run against already provisioned buckets
     const repeatSummary = await provisionStorageBuckets({
       client: rawS3Client
     });
 
-    expect(repeatSummary.results).toHaveLength(4);
+    expect(repeatSummary.results).toHaveLength(5);
     expect(repeatSummary.createdCount).toBe(0);
-    expect(repeatSummary.alreadyExistsCount).toBe(4);
+    expect(repeatSummary.alreadyExistsCount).toBe(5);
     expect(repeatSummary.lifecycleAppliedCount).toBe(2);
-    expect(repeatSummary.lifecycleSkippedCount).toBe(2);
+    expect(repeatSummary.lifecycleSkippedCount).toBe(3);
   });
 
   it("reads back live lifecycle configurations and asserts matching rules from the bucket", async () => {
@@ -132,7 +132,7 @@ describe("Storage Provisioning integration with real MinIO", () => {
 
     // 2. Re-run provisioning
     const summary = await provisionStorageBuckets({ client: rawS3Client });
-    expect(summary.alreadyExistsCount).toBe(4);
+    expect(summary.alreadyExistsCount).toBe(5);
 
     // 3. Read back object and verify byte integrity
     const getRes = await rawS3Client.send(
diff --git a/packages/infrastructure/src/storage/provisioner.test.ts b/packages/infrastructure/src/storage/provisioner.test.ts
index 077171a..43be622 100644
--- a/packages/infrastructure/src/storage/provisioner.test.ts
+++ b/packages/infrastructure/src/storage/provisioner.test.ts
@@ -122,17 +122,17 @@ describe("Storage Provisioner unit tests", () => {
     await expect(provisionBucket(client, BUCKETS.TEMP)).rejects.toThrow("Network timeout");
   });
 
-  it("provisions all four buckets in provisionStorageBuckets and returns summary", async () => {
+  it("provisions all five buckets in provisionStorageBuckets and returns summary", async () => {
     const sendFn = vi.fn().mockResolvedValue({});
     const client = createMockS3Client(sendFn);
 
     const summary = await provisionStorageBuckets({ client });
 
-    expect(summary.results).toHaveLength(4);
-    expect(summary.createdCount).toBe(4);
+    expect(summary.results).toHaveLength(5);
+    expect(summary.createdCount).toBe(5);
     expect(summary.alreadyExistsCount).toBe(0);
     expect(summary.lifecycleAppliedCount).toBe(2); // temp and review
-    expect(summary.lifecycleSkippedCount).toBe(2); // reference and delivery
+    expect(summary.lifecycleSkippedCount).toBe(3); // reference, delivery, and evidence
   });
 
   it("provisions custom bucket subset when options.buckets is specified", async () => {
diff --git a/packages/infrastructure/src/storage/s3-object-storage.test.ts b/packages/infrastructure/src/storage/s3-object-storage.test.ts
index de34427..59cd62e 100644
--- a/packages/infrastructure/src/storage/s3-object-storage.test.ts
+++ b/packages/infrastructure/src/storage/s3-object-storage.test.ts
@@ -2,6 +2,7 @@ import { describe, expect, it } from "vitest";
 import { Readable } from "node:stream";
 import { S3ObjectStorage } from "./s3-object-storage.js";
 import { HeadObjectCommand, type S3Client } from "@aws-sdk/client-s3";
+import { StorageIntegrityViolationError } from "@cco/application";
 
 describe("S3ObjectStorage (unit)", () => {
   it("enforces maxBytes limit when ContentLength header is present and exceeds maxBytes", async () => {
@@ -29,14 +30,16 @@ describe("S3ObjectStorage (unit)", () => {
       client: fakeClient
     });
 
-    await expect(
-      storage.getObject({ bucket: "test-bucket", key: "test-key" }, { maxBytes: 50 })
-    ).rejects.toThrow(/ContentLength \(100\) exceeds maxBytes limit \(50\)/);
+    const error: unknown = await storage
+      .getObject({ bucket: "test-bucket", key: "test-key" }, { maxBytes: 50 })
+      .catch((e: unknown) => e);
+    expect(error).toBeInstanceOf(StorageIntegrityViolationError);
+    expect((error as Error).message).toMatch(/ContentLength \(100\) exceeds maxBytes limit \(50\)/);
 
     expect(streamDestroyed).toBe(true);
   });
 
-  it("enforces maxBytes limit during streaming when ContentLength is not present", async () => {
+  it("enforces maxBytes limit during streaming when ContentLength is not present (observed bytes exceed the limit, not just the header)", async () => {
     let streamDestroyed = false;
     const fakeStream = new Readable({
       read() {
@@ -61,13 +64,37 @@ describe("S3ObjectStorage (unit)", () => {
       client: fakeClient
     });
 
-    await expect(
-      storage.getObject({ bucket: "test-bucket", key: "test-key" }, { maxBytes: 10 })
-    ).rejects.toThrow(/exceeds maxBytes limit \(10\)/);
+    const error: unknown = await storage
+      .getObject({ bucket: "test-bucket", key: "test-key" }, { maxBytes: 10 })
+      .catch((e: unknown) => e);
+    expect(error).toBeInstanceOf(StorageIntegrityViolationError);
+    expect((error as Error).message).toMatch(/exceeds maxBytes limit \(10\)/);
 
     expect(streamDestroyed).toBe(true);
   });
 
+  it("enforces maxBytes limit on a transformToByteArray body when observed bytes exceed the limit (ContentLength omitted or under-reported)", async () => {
+    const fakeClient = {
+      send: async () => ({
+        ContentLength: undefined,
+        Body: {
+          transformToByteArray: async () => new Uint8Array(20) // 20 bytes
+        }
+      })
+    } as unknown as S3Client;
+
+    const storage = new S3ObjectStorage({
+      endpoint: "http://localhost:9000",
+      client: fakeClient
+    });
+
+    const error: unknown = await storage
+      .getObject({ bucket: "test-bucket", key: "test-key" }, { maxBytes: 10 })
+      .catch((e: unknown) => e);
+    expect(error).toBeInstanceOf(StorageIntegrityViolationError);
+    expect((error as Error).message).toMatch(/byteLength \(20\) exceeds maxBytes limit \(10\)/);
+  });
+
   it("successfully retrieves stream when within maxBytes limit", async () => {
     const payload = Buffer.from("hello world");
     const fakeStream = new Readable({
diff --git a/packages/infrastructure/src/storage/s3-object-storage.ts b/packages/infrastructure/src/storage/s3-object-storage.ts
index 5f4d0a6..0ffe86d 100644
--- a/packages/infrastructure/src/storage/s3-object-storage.ts
+++ b/packages/infrastructure/src/storage/s3-object-storage.ts
@@ -15,6 +15,7 @@ import {
   type ObjectLocator,
   type ObjectStoragePort,
   ObjectAlreadyExistsError,
+  StorageIntegrityViolationError,
   type PutObjectInput,
   type StoredObject
 } from "@cco/application";
@@ -125,8 +126,10 @@ async function readBodyWithLimit(
               // ignore destroy errors
             }
           }
-          throw new Error(
-            `Object ${locator.bucket}/${locator.key} byteLength (${totalBytes}) exceeds maxBytes limit (${maxBytes})`
+          throw new StorageIntegrityViolationError(
+            `Object ${locator.bucket}/${locator.key} byteLength (${totalBytes}) exceeds maxBytes limit (${maxBytes})`,
+            locator.bucket,
+            locator.key
           );
         }
         chunks.push(chunk);
@@ -234,8 +237,10 @@ async function readBodyWithLimit(
     }
 
     if (maxBytes !== undefined && bytes.byteLength > maxBytes) {
-      throw new Error(
-        `Object ${locator.bucket}/${locator.key} byteLength (${bytes.byteLength}) exceeds maxBytes limit (${maxBytes})`
+      throw new StorageIntegrityViolationError(
+        `Object ${locator.bucket}/${locator.key} byteLength (${bytes.byteLength}) exceeds maxBytes limit (${maxBytes})`,
+        locator.bucket,
+        locator.key
       );
     }
     return bytes;
@@ -365,8 +370,10 @@ export class S3ObjectStorage implements ObjectStoragePort {
           // ignore destroy errors
         }
       }
-      throw new Error(
-        `Object ${locator.bucket}/${locator.key} ContentLength (${response.ContentLength}) exceeds maxBytes limit (${options.maxBytes})`
+      throw new StorageIntegrityViolationError(
+        `Object ${locator.bucket}/${locator.key} ContentLength (${response.ContentLength}) exceeds maxBytes limit (${options.maxBytes})`,
+        locator.bucket,
+        locator.key
       );
     }
 
@@ -381,8 +388,10 @@ export class S3ObjectStorage implements ObjectStoragePort {
     if (storedChecksum !== undefined) {
       const computed = computeSha256Hex(body);
       if (computed !== storedChecksum) {
-        throw new Error(
-          `Checksum mismatch on getObject for ${locator.bucket}/${locator.key}: stored checksum ${storedChecksum}, calculated ${computed}`
+        throw new StorageIntegrityViolationError(
+          `Checksum mismatch on getObject for ${locator.bucket}/${locator.key}: stored checksum ${storedChecksum}, calculated ${computed}`,
+          locator.bucket,
+          locator.key
         );
       }
     }
diff --git a/packages/infrastructure/src/telemetry/storage-telemetry-adapter.test.ts b/packages/infrastructure/src/telemetry/storage-telemetry-adapter.test.ts
index 01db717..d0d5b3d 100644
--- a/packages/infrastructure/src/telemetry/storage-telemetry-adapter.test.ts
+++ b/packages/infrastructure/src/telemetry/storage-telemetry-adapter.test.ts
@@ -92,7 +92,8 @@ describe("HostFsStorageTelemetryAdapter", () => {
       "godzspeed-temp",
       "godzspeed-review",
       "godzspeed-reference",
-      "godzspeed-delivery"
+      "godzspeed-delivery",
+      "godzspeed-evidence"
     ]);
     expect(telemetry.buckets.every((b) => b.usedBytes === 0)).toBe(true);
   });
diff --git a/packages/shared/src/buckets.test.ts b/packages/shared/src/buckets.test.ts
index 118ff34..bfcece3 100644
--- a/packages/shared/src/buckets.test.ts
+++ b/packages/shared/src/buckets.test.ts
@@ -8,23 +8,27 @@ import {
 } from "./index.js";
 
 describe("bucket class constants and retention policies", () => {
-  it("defines the four PRD bucket class constants", () => {
+  it("defines the PRD bucket class constants including evidence archive", () => {
     expect(BUCKET_NAMES).toEqual([
       "godzspeed-temp",
       "godzspeed-review",
       "godzspeed-reference",
-      "godzspeed-delivery"
+      "godzspeed-delivery",
+      "godzspeed-evidence"
     ]);
 
     expect(BUCKETS.TEMP).toBe("godzspeed-temp");
     expect(BUCKETS.REVIEW).toBe("godzspeed-review");
     expect(BUCKETS.REFERENCE).toBe("godzspeed-reference");
     expect(BUCKETS.DELIVERY).toBe("godzspeed-delivery");
+    expect(BUCKETS.EVIDENCE).toBe("godzspeed-evidence");
   });
 
   it("type checks bucket names against union", () => {
     const validBucket: BucketName = BUCKETS.TEMP;
     expect(BUCKET_NAMES.includes(validBucket)).toBe(true);
+    const evidenceBucket: BucketName = BUCKETS.EVIDENCE;
+    expect(BUCKET_NAMES.includes(evidenceBucket)).toBe(true);
   });
 
   it("defines 14-day automated expiry for godzspeed-temp", () => {
@@ -76,4 +80,15 @@ describe("bucket class constants and retention policies", () => {
     const deliveryLifecycle = BUCKET_LIFECYCLE_DEFINITIONS["godzspeed-delivery"];
     expect(deliveryLifecycle).toBeUndefined();
   });
+
+  it("defines no automated expiry for godzspeed-evidence (source archive)", () => {
+    const evidencePolicy = BUCKET_RETENTION_POLICIES["godzspeed-evidence"];
+    expect(evidencePolicy).toBeDefined();
+    expect(evidencePolicy.bucket).toBe("godzspeed-evidence");
+    expect(evidencePolicy.defaultRetentionDays).toBeUndefined();
+    expect(evidencePolicy.isAutomatedExpiry).toBe(false);
+
+    const evidenceLifecycle = BUCKET_LIFECYCLE_DEFINITIONS["godzspeed-evidence"];
+    expect(evidenceLifecycle).toBeUndefined();
+  });
 });
diff --git a/packages/shared/src/buckets.ts b/packages/shared/src/buckets.ts
index 825fe6c..2f61997 100644
--- a/packages/shared/src/buckets.ts
+++ b/packages/shared/src/buckets.ts
@@ -5,7 +5,8 @@ export const BUCKET_NAMES = [
   "godzspeed-temp",
   "godzspeed-review",
   "godzspeed-reference",
-  "godzspeed-delivery"
+  "godzspeed-delivery",
+  "godzspeed-evidence"
 ] as const;
 
 export type BucketName = (typeof BUCKET_NAMES)[number];
@@ -14,7 +15,8 @@ export const BUCKETS = {
   TEMP: "godzspeed-temp",
   REVIEW: "godzspeed-review",
   REFERENCE: "godzspeed-reference",
-  DELIVERY: "godzspeed-delivery"
+  DELIVERY: "godzspeed-delivery",
+  EVIDENCE: "godzspeed-evidence"
 } as const;
 
 export interface BucketRetentionPolicy {
@@ -56,6 +58,12 @@ export const BUCKET_RETENTION_POLICIES: Readonly<Record<BucketName, BucketRetent
       description:
         "approved delivery copies awaiting client handoff (retained 90 days after campaign completion)",
       isAutomatedExpiry: false
+    },
+    "godzspeed-evidence": {
+      bucket: "godzspeed-evidence",
+      description:
+        "immutable source evidence archive (retained indefinitely under regulatory hold; no automated expiry)",
+      isAutomatedExpiry: false
     }
   });
 
@@ -75,5 +83,6 @@ export const BUCKET_LIFECYCLE_DEFINITIONS: Readonly<
     prefix: ""
   },
   "godzspeed-reference": undefined,
-  "godzspeed-delivery": undefined
+  "godzspeed-delivery": undefined,
+  "godzspeed-evidence": undefined
 });
diff --git a/packages/shared/src/product-identity.test.ts b/packages/shared/src/product-identity.test.ts
index acc95c9..9787596 100644
--- a/packages/shared/src/product-identity.test.ts
+++ b/packages/shared/src/product-identity.test.ts
@@ -3,6 +3,7 @@ import {
   canonicalizeUtcTimestamp,
   compareDateOnly,
   compareUtcTimestamps,
+  generateUuidV7,
   hasControlOrInvisibleChars,
   isValidCalendarDate,
   isValidCanonicalSku,
@@ -12,6 +13,7 @@ import {
   isValidLotIdentifier,
   isValidPositiveInt,
   isValidUuid,
+  isValidUuidV7,
   MAX_POSITIVE_INT,
   MIN_POSITIVE_INT,
   normalizeAssertedBy,
@@ -51,6 +53,13 @@ describe("product-identity lexical functions", () => {
       expect(isValidUuid("")).toBe(false);
       expect(isValidUuid(null)).toBe(false);
     });
+
+    it("generates and validates RFC 9562 UUIDv7", () => {
+      const v7 = generateUuidV7();
+      expect(isValidUuid(v7)).toBe(true);
+      expect(isValidUuidV7(v7)).toBe(true);
+      expect(isValidUuidV7("018f0000-0000-4000-8000-000000000001")).toBe(false); // v4 is not v7
+    });
   });
 
   describe("canonicalSku normalization and validation", () => {
diff --git a/packages/shared/src/product-identity.ts b/packages/shared/src/product-identity.ts
index 6644efb..12cab4c 100644
--- a/packages/shared/src/product-identity.ts
+++ b/packages/shared/src/product-identity.ts
@@ -10,8 +10,11 @@ export const MAX_POSITIVE_INT = 2_147_483_647; // PostgreSQL 32-bit signed INT m
 
 export const CANONICAL_SKU_REGEX = /^[A-Z0-9_-]{3,64}$/;
 export const LOT_IDENTIFIER_REGEX = /^[A-Za-z0-9_.-]{1,128}$/;
+export const SHA256_HEX_REGEX = /^[0-9a-f]{64}$/;
 export const UUID_REGEX =
   /^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[1-8][0-9a-fA-F]{3}-[89abAB][0-9a-fA-F]{3}-[0-9a-fA-F]{12}$/;
+export const UUID_V7_REGEX =
+  /^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-7[0-9a-fA-F]{3}-[89abAB][0-9a-fA-F]{3}-[0-9a-fA-F]{12}$/;
 export const DATE_ONLY_REGEX = /^(\d{4})-(\d{2})-(\d{2})$/;
 export const ISO_UTC_TIMESTAMP_REGEX =
   /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})(?:\.(\d{1,3}))?Z$/;
@@ -19,6 +22,77 @@ export const ISO_UTC_TIMESTAMP_REGEX =
 export const BATCH_ORIGIN_KINDS = ["own_production", "partner_origin", "unknown"] as const;
 export type BatchOriginKind = (typeof BATCH_ORIGIN_KINDS)[number];
 
+export const EVIDENCE_SOURCE_CLASSES = [
+  "photo",
+  "video",
+  "raw",
+  "document",
+  "coa",
+  "process_record"
+] as const;
+export type EvidenceSourceClass = (typeof EVIDENCE_SOURCE_CLASSES)[number];
+
+export const EVIDENCE_ACQUISITION_METHODS = [
+  "direct_upload",
+  "supplier_submission",
+  "field_capture",
+  "lab_transfer"
+] as const;
+export type EvidenceAcquisitionMethod = (typeof EVIDENCE_ACQUISITION_METHODS)[number];
+
+export const LEGAL_RIGHTS_STATUSES = ["unknown", "granted", "restricted", "denied"] as const;
+export type LegalRightsStatus = (typeof LEGAL_RIGHTS_STATUSES)[number];
+
+export const CONSENT_STATUSES = ["unknown", "granted", "restricted", "denied"] as const;
+export type ConsentStatus = (typeof CONSENT_STATUSES)[number];
+
+export const BATCH_EVIDENCE_PURPOSES = [
+  "macro_hero_photo",
+  "coa_test_report",
+  "cultivation_log",
+  "processing_record",
+  "packaging_spec",
+  "general_supporting_evidence"
+] as const;
+export type BatchEvidencePurpose = (typeof BATCH_EVIDENCE_PURPOSES)[number];
+
+export const VERIFICATION_OUTCOMES = ["verified", "rejected", "disputed", "withdrawn"] as const;
+export type VerificationOutcome = (typeof VERIFICATION_OUTCOMES)[number];
+
+export const VERIFICATION_KINDS = [
+  "submitter_attestation",
+  "human_internal_review",
+  "independent_third_party_corroboration"
+] as const;
+export type VerificationKind = (typeof VERIFICATION_KINDS)[number];
+
+export const VERIFICATION_FACT_SCOPES = [
+  "provenance_metadata",
+  "capture_circumstances",
+  "lab_identity",
+  "chain_of_custody",
+  "full_document_authenticity"
+] as const;
+export type VerificationFactScope = (typeof VERIFICATION_FACT_SCOPES)[number];
+
+export const SOURCE_OBJECT_AVAILABILITIES = [
+  "available",
+  "archived",
+  "quarantined",
+  "deleted_under_retention"
+] as const;
+export type SourceObjectAvailability = (typeof SOURCE_OBJECT_AVAILABILITIES)[number];
+
+export const EVIDENCE_REGISTRATION_INTENTS = [
+  "initial_assertion",
+  "new_batch_assertion",
+  "supersede"
+] as const;
+export type EvidenceRegistrationIntent = (typeof EVIDENCE_REGISTRATION_INTENTS)[number];
+
+export const REPORTED_CAPTURE_PRECISIONS = ["date", "minute", "second", "millisecond"] as const;
+export type ReportedCapturePrecision = (typeof REPORTED_CAPTURE_PRECISIONS)[number];
+
 export const PRODUCT_EVIDENCE_ERROR_CODES = [
   "NOT_FOUND",
   "CROSS_CLIENT_VIOLATION",
@@ -81,6 +155,42 @@ export function isValidUuid(val: unknown): val is string {
   return UUID_REGEX.test(val);
 }
 
+/**
+ * Validates whether a value is an RFC 9562 UUIDv7 string.
+ */
+export function isValidUuidV7(val: unknown): val is string {
+  if (typeof val !== "string") {
+    return false;
+  }
+  return UUID_V7_REGEX.test(val);
+}
+
+/**
+ * Generates an RFC 9562 UUIDv7 string using globalThis.crypto and current time.
+ */
+export function generateUuidV7(): string {
+  const bytes = new Uint8Array(16);
+  globalThis.crypto.getRandomValues(bytes);
+  const now = Date.now();
+  // 48-bit timestamp
+  bytes[0] = Math.floor(now / 0x10000000000) & 0xff;
+  bytes[1] = Math.floor(now / 0x100000000) & 0xff;
+  bytes[2] = Math.floor(now / 0x1000000) & 0xff;
+  bytes[3] = Math.floor(now / 0x10000) & 0xff;
+  bytes[4] = Math.floor(now / 0x100) & 0xff;
+  bytes[5] = now & 0xff;
+  // version 7: 0111xxxx
+  bytes[6] = (bytes[6]! & 0x0f) | 0x70;
+  // variant 10xx: 10xxxxxx
+  bytes[8] = (bytes[8]! & 0x3f) | 0x80;
+
+  const hex: string[] = [];
+  for (let i = 0; i < 16; i++) {
+    hex.push(bytes[i]!.toString(16).padStart(2, "0"));
+  }
+  return `${hex.slice(0, 4).join("")}-${hex.slice(4, 6).join("")}-${hex.slice(6, 8).join("")}-${hex.slice(8, 10).join("")}-${hex.slice(10, 16).join("")}`;
+}
+
 /**
  * Normalizes a UUID string by verifying its format and converting to lowercase hex.
  * Throws a lexical error if invalid or if leading/trailing whitespace is present.
@@ -346,3 +456,52 @@ export function normalizeAssertedBy(val: unknown, fieldName = "assertedBy"): str
   }
   return trimmed;
 }
+
+/**
+ * Validates and normalizes lowercase 64-hex SHA-256 digest string:
+ * - Must be lowercase 64 hex characters (0-9, a-f).
+ * - Rejects surrounding whitespace without silent trimming.
+ */
+export function normalizeSha256Hex(val: unknown, fieldName = "sha256"): string {
+  if (typeof val !== "string" || !SHA256_HEX_REGEX.test(val)) {
+    throw new Error(
+      `${fieldName} must be a lowercase 64-hex SHA-256 digest string without surrounding whitespace.`
+    );
+  }
+  return val;
+}
+
+export function isValidSha256Hex(val: unknown): val is string {
+  return typeof val === "string" && SHA256_HEX_REGEX.test(val);
+}
+
+/**
+ * Normalizes assertionText:
+ * - Non-empty trimmed Unicode text (1–4000 code points).
+ * - Rejects C0/C1 control and invisible formatting characters.
+ */
+export function normalizeAssertionText(val: unknown, fieldName = "assertionText"): string {
+  if (typeof val !== "string") {
+    throw new Error(`${fieldName} must be a string`);
+  }
+  if (hasControlOrInvisibleChars(val)) {
+    throw new Error(`${fieldName} contains illegal control or invisible formatting characters`);
+  }
+  const trimmed = val.trim();
+  const codePoints = Array.from(trimmed);
+  if (codePoints.length < 1 || codePoints.length > 4000) {
+    throw new Error(
+      `${fieldName} must be between 1 and 4000 Unicode code points (found ${codePoints.length})`
+    );
+  }
+  return trimmed;
+}
+
+export function isValidAssertionText(val: unknown): val is string {
+  try {
+    normalizeAssertionText(val);
+    return true;
+  } catch {
+    return false;
+  }
+}
diff --git a/pnpm-lock.yaml b/pnpm-lock.yaml
index d009743..9aef8ef 100644
--- a/pnpm-lock.yaml
+++ b/pnpm-lock.yaml
@@ -249,6 +249,9 @@ importers:
       kokoro-js:
         specifier: ^1.2.1
         version: 1.2.1
+      pdf-lib:
+        specifier: 1.17.1
+        version: 1.17.1
       pg:
         specifier: ^8.13.1
         version: 8.23.0
@@ -1186,6 +1189,12 @@ packages:
     resolution: {integrity: sha512-X5XaVWZIBCT7HHZGm5I7ZQXDwLG+bGXuSrMQAW+7Zvl87h1kmc1ZB1VSRJcpUfoUrGQp4Fkoxm5kZ+Ms+aW+eA==}
     engines: {node: '>= 20.19.0'}
 
+  '@pdf-lib/standard-fonts@1.0.0':
+    resolution: {integrity: sha512-hU30BK9IUN/su0Mn9VdlVKsWBS6GyhVfqjwl1FjZN4TxP6cCw0jP2w7V3Hf5uX7M0AZJ16vey9yE0ny7Sa59ZA==}
+
+  '@pdf-lib/upng@1.0.1':
+    resolution: {integrity: sha512-dQK2FUMQtowVP00mtIksrlZhdFXQZPC+taih1q4CvPZ5vqdxR/LKBaFg0oAfzd1GlHZXXSPdQfzQnt+ViGvEIQ==}
+
   '@pinojs/redact@0.4.0':
     resolution: {integrity: sha512-k2ENnmBugE/rzQfEcdWHcCY+/FM3VLzH9cYEsbdsoqrvzAKRhUZeRNhAZvB8OitQJ1TBed3yqWtdjzS6wJKBwg==}
 
@@ -2500,6 +2509,9 @@ packages:
   package-json-from-dist@1.0.1:
     resolution: {integrity: sha512-UEZIS3/by4OC8vL3P2dTXRETpebLI2NiI5vIrjaD/5UtrkFX/tNbwjTSRAGC/+7CAo2pIcBaRgWmcBBHcsaCIw==}
 
+  pako@1.0.11:
+    resolution: {integrity: sha512-4hLB8Py4zZce5s4yd9XzopqwVv/yGNhV1Bl8NTmCq1763HeK2+EwVTv+leGeL13Dnh2wfbqowVPXCIO0z4taYw==}
+
   parent-module@1.0.1:
     resolution: {integrity: sha512-GQ2EWRpQV8/o+Aw8YqtfZZPfNRWZYkbidE9k5rpl/hC3vtHHBfGm2Ifi6qWV+coDGkrUKZAxE3Lot5kcsRlh+g==}
     engines: {node: '>=6'}
@@ -2529,6 +2541,9 @@ packages:
     resolution: {integrity: sha512-//nshmD55c46FuFw26xV/xFAaB5HF9Xdap7HJBBnrKdAd6/GxDBaNA1870O79+9ueg61cZLSVc+OaFlfmObYVQ==}
     engines: {node: '>= 14.16'}
 
+  pdf-lib@1.17.1:
+    resolution: {integrity: sha512-V/mpyJAoTsN4cnP31vc0wfNA1+p20evqqnap0KLoRUN0Yk/p3wN52DOEsL4oBFcLdb76hlpKPtzJIgo67j/XLw==}
+
   pg-cloudflare@1.4.0:
     resolution: {integrity: sha512-Vo7z/6rrQYxpNRylp4Tlob2elzbh+N/MOQbxFVWCxS7oEx6jF53GTJFxK2WWpKuBRkmiin4Mt+xofFDjx09R0A==}
 
@@ -3038,6 +3053,9 @@ packages:
     resolution: {integrity: sha512-NoZ4roiN7LnbKn9QqE1amc9DJfzvZXxF4xDavcOWt1BPkdx+m+0gJuPM+S0vCe7zTJMYUP0R8pO2XMr+Y8oLIg==}
     engines: {node: '>=6'}
 
+  tslib@1.14.1:
+    resolution: {integrity: sha512-Xni35NKzjgMrwevysHTCArtLDpPvye8zV/0E4EyYn43P7/7qvQwPh9BGkHewbMulVntbigmcT7rdX3BNo9wRJg==}
+
   tslib@2.8.1:
     resolution: {integrity: sha512-oJFu94HQb+KVduSUQL7wnpmqnfmLsOA/nAh6b6EH0wCEoK0/mPeXU6c3wKDV83MkOuHPRHtSXKKU99IBazS/2w==}
 
@@ -3971,6 +3989,14 @@ snapshots:
 
   '@noble/hashes@2.4.0': {}
 
+  '@pdf-lib/standard-fonts@1.0.0':
+    dependencies:
+      pako: 1.0.11
+
+  '@pdf-lib/upng@1.0.1':
+    dependencies:
+      pako: 1.0.11
+
   '@pinojs/redact@0.4.0': {}
 
   '@pkgjs/parseargs@0.11.0':
@@ -5373,6 +5399,8 @@ snapshots:
 
   package-json-from-dist@1.0.1: {}
 
+  pako@1.0.11: {}
+
   parent-module@1.0.1:
     dependencies:
       callsites: 3.1.0
@@ -5396,6 +5424,13 @@ snapshots:
 
   pathval@2.0.1: {}
 
+  pdf-lib@1.17.1:
+    dependencies:
+      '@pdf-lib/standard-fonts': 1.0.0
+      '@pdf-lib/upng': 1.0.1
+      pako: 1.0.11
+      tslib: 1.14.1
+
   pg-cloudflare@1.4.0:
     optional: true
 
@@ -5989,6 +6024,8 @@ snapshots:
       minimist: 1.2.8
       strip-bom: 3.0.0
 
+  tslib@1.14.1: {}
+
   tslib@2.8.1: {}
 
   tsx@4.23.12:
```

Fix diff since previous review:

```diff
diff --git a/docs/verified-product-evidence-contract-fixtures.md b/docs/verified-product-evidence-contract-fixtures.md
index 850f258..8c696d2 100644
--- a/docs/verified-product-evidence-contract-fixtures.md
+++ b/docs/verified-product-evidence-contract-fixtures.md
@@ -884,7 +884,7 @@ The following matrix documents the complete set of negative invariants, integrit
 | **CE-01** | **Tenant Isolation** | Client A owns `SRC_PHOTO_RAW_ID`. | Client B attempts to link `SRC_PHOTO_RAW_ID` in `createEvidenceAsset`. | Fails closed with `NOT_FOUND`. Database composite FK `fk_evidence_revisions_source` (`client_id, source_object_id`) rejects. Zero metadata or existence disclosure regarding Client A. |
 | **CE-02** | **Lot Boundary Integrity & FK Rejection** | Client A owns Lot A (`BATCH_LOT_A_ID`) and Lot B (`BATCH_LOT_B_ID`) under same SKU. Photo is linked to Lot B (`batch_evidence_links`). | Submitter attempts to link Lot B's photo as supporting evidence for a claim on Lot A (`linkClaimSources`). | Fails closed with `CROSS_BATCH_SOURCE`. Database FK `fk_claim_sources_batch_evidence` (`client_id, batch_id, evidence_id, evidence_revision`) rejects because `batch_id` does not match the claim's batch. |
 | **CE-03** | **Duplicate Ingest Deduplication** | Client A previously ingested `SRC_PHOTO_RAW_ID` with hash `HASH_PHOTO_RAW`. | Client A re-uploads the exact same file bytes with the same hash. | Storage adapter verifies exact byte SHA-256 match and detected MIME match, then reuses existing `source_objects` row without duplicate S3 write. Quota reservation released. Distinct `EvidenceRevision` created only if asserted explicitly. |
-| **CE-03B**| **Archived Duplicate Upload** | Client A previously ingested `SRC_PHOTO_RAW_ID`, which was later archived (`availability = 'archived'`). | Client A re-uploads the exact same file bytes with the same hash. | Storage adapter reactivates `source_objects` (`availability = 'available'`). Reactivation does **not** restore prior claim approvals or bypass fresh compliance review. |
+| **CE-03B**| **Archived / Quarantined Duplicate Upload** | Client A previously ingested `SRC_PHOTO_RAW_ID`, which was later archived (`availability = 'archived'`), quarantined, or deleted under retention. | Client A re-uploads the exact same file bytes with the same hash. | Re-uploading bytes cannot reactivate an archived, quarantined, or deleted source object. Fails closed with `ACCESS_DENIED` (`cause: SOURCE_UNAVAILABLE`). Unlike ephemeral preview reference assets, source evidence archives are immutable and require operator retention governance to alter availability. |
 | **CE-04** | **Tamper / Byte Integrity Failure** | Source object record exists with hash `HASH_PHOTO_RAW`. Underlying file in S3 was altered or corrupted. | Ingestion or verification adapter reads object from storage prior to derivative creation or claim approval. | Exact computed byte hash $\ne$ recorded `original_sha256`. Fails closed with `SOURCE_INTEGRITY_MISMATCH`. Object marked `availability = 'quarantined'`; all dependent claims transition to `invalidated`. |
 | **CE-04B**| **Unavailable Source Object** | Active claim revision is linked to a source object. | Source object availability transitions to `archived`, `quarantined`, or `deleted_under_retention`. | Cascade invalidation transaction triggers. Claim state transitions `reviewer_approved -> invalidated` (`cause: source_quarantined` or `source_archived`). |
 | **CE-05** | **Missing / Ambiguous Measurement Units** | Submitter enters a CoA measurement row for total THC with `result_value = "24.5"` and `unit = ""`. | Submitter submits `createCoaReport`. | Rejected at application boundary with `MEASUREMENT_UNIT_REQUIRED`. Relational CHECK constraint `chk_measurement_strings_nonempty` prevents insertion. |
diff --git a/eslint.config.js b/eslint.config.js
index d9c01a9..b6056ca 100644
--- a/eslint.config.js
+++ b/eslint.config.js
@@ -12,7 +12,8 @@ export default tseslint.config(
       "**/.ai-tmp/**",
       "**/.ai-cache/**",
       "**/.ai-worktrees/**",
-      "**/.ai-runs/**"
+      "**/.ai-runs/**",
+      "**/*.timestamp-*.mjs"
     ]
   },
   js.configs.recommended,
diff --git a/packages/application/src/ports/index.ts b/packages/application/src/ports/index.ts
index 09efba1..8b0e8fc 100644
--- a/packages/application/src/ports/index.ts
+++ b/packages/application/src/ports/index.ts
@@ -52,3 +52,7 @@ export * from "./minimax-h3-experiment-ports.js";
 export * from "./h3-candidate-ports.js";
 export * from "./product-evidence-repository.js";
 export * from "./product-evidence-serializers.js";
+export * from "./originals-inspection-port.js";
+export * from "./evidence-storage-policy.js";
+export * from "./evidence-lock-coordinator.js";
+export * from "./evidence-asset-repository.js";
diff --git a/packages/application/src/ports/object-storage-port.ts b/packages/application/src/ports/object-storage-port.ts
index acddbab..5eb7fef 100644
--- a/packages/application/src/ports/object-storage-port.ts
+++ b/packages/application/src/ports/object-storage-port.ts
@@ -15,6 +15,30 @@ export class ObjectAlreadyExistsError extends Error {
   }
 }
 
+/**
+ * Thrown by a getObject() adapter when it has *proven* the persisted bytes
+ * are corrupt or malformed on read -- an oversized object (exceeds the
+ * caller's maxBytes) or a stored checksum that doesn't match the bytes
+ * actually read. This is distinct from every other getObject() failure
+ * (network transport errors, timeouts, auth failures, cancellation): those
+ * say nothing about the integrity of the persisted bytes and MUST NOT be
+ * treated as proof of corruption by a caller re-verifying a SourceObject --
+ * doing so would durably quarantine a healthy source over a transient
+ * failure (quarantine is a one-way transition; see
+ * migrations/027_evidence_authority.sql).
+ */
+export class StorageIntegrityViolationError extends Error {
+  override readonly name = "StorageIntegrityViolationError";
+  readonly bucket: string;
+  readonly key: string;
+
+  constructor(message: string, bucket: string, key: string, options?: ErrorOptions) {
+    super(message, options);
+    this.bucket = bucket;
+    this.key = key;
+  }
+}
+
 export interface PutObjectInput {
   readonly bucket: string;
   readonly key: string;
diff --git a/packages/application/src/ports/unit-of-work.ts b/packages/application/src/ports/unit-of-work.ts
index 3460fae..440ad3a 100644
--- a/packages/application/src/ports/unit-of-work.ts
+++ b/packages/application/src/ports/unit-of-work.ts
@@ -9,6 +9,7 @@ import type { TransactionalJobEnqueuer } from "./job-queue-port.js";
 import type { ReferenceAssetRepository } from "./reference-asset-repository.js";
 import type { ReferenceGroupRepository } from "./reference-group-repository.js";
 import type { ProductEvidenceRepositoryPort } from "./product-evidence-repository.js";
+import type { EvidenceAssetRepositoryPort } from "./evidence-asset-repository.js";
 import type { ReviewEventStore } from "./review-event-store.js";
 import type { SceneRepository } from "./scene-repository.js";
 import type { ShotPlanRepository } from "./shot-plan-repository.js";
@@ -29,6 +30,7 @@ export interface UnitOfWorkContext {
   readonly referenceGroups?: ReferenceGroupRepository | undefined;
   readonly campaignReferenceBible?: CampaignReferenceBibleRepository | undefined;
   readonly productEvidence?: ProductEvidenceRepositoryPort | undefined;
+  readonly evidenceAsset?: EvidenceAssetRepositoryPort | undefined;
 }
 
 export interface UnitOfWork {
diff --git a/packages/application/src/use-cases/index.ts b/packages/application/src/use-cases/index.ts
index 45b53d4..9eaba9c 100644
--- a/packages/application/src/use-cases/index.ts
+++ b/packages/application/src/use-cases/index.ts
@@ -81,3 +81,6 @@ export * from "./auto-plan-first-pass.js";
 export * from "./list-clients.js";
 export * from "./evaluate-h3-candidate-eligibility.js";
 export * from "./product-registry-use-cases.js";
+export * from "./register-evidence-asset.js";
+export * from "./link-existing-derivative.js";
+export * from "./record-evidence-verification-event.js";
diff --git a/packages/application/src/use-cases/product-registry-use-cases.test.ts b/packages/application/src/use-cases/product-registry-use-cases.test.ts
index 8e53b1e..0db178f 100644
--- a/packages/application/src/use-cases/product-registry-use-cases.test.ts
+++ b/packages/application/src/use-cases/product-registry-use-cases.test.ts
@@ -125,52 +125,87 @@ describe("Product registry use cases unit tests", () => {
     expect(mockRepo.createSku).toHaveBeenCalledTimes(1);
   });
 
-  it("CreateProductBatchUseCase: rejects unsupported origin evidence links with ProductValidationError", async () => {
-    const uow = createMockUow({});
+  it("CreateProductBatchUseCase: accepts valid origin evidence links and delegates to repository", async () => {
+    const mockBatch = {
+      batch: {
+        clientId: clientA,
+        batchId: createBatchId("018f0000-0002-7000-8000-000000000001"),
+        skuId: createSkuId("018f0000-0002-7000-8000-000000000002"),
+        lotIdentifier: "LOT-01",
+        displayName: "Lot 01",
+        version: 1,
+        currentFactsRevision: 1,
+        createdAt: timestamp,
+        updatedAt: timestamp,
+        archivedAt: null
+      },
+      facts: null
+    };
+    const mockRepo: Partial<ProductEvidenceRepositoryPort> = {
+      createBatch: vi.fn().mockResolvedValue(mockBatch)
+    };
+    const uow = createMockUow(mockRepo);
     const useCase = new CreateProductBatchUseCase(uow);
 
-    await expect(
-      useCase.execute({
-        actionId: action1,
-        clientId: clientA,
-        actorId: actor,
-        timestamp,
-        payload: {
-          skuId: createSkuId("018f0000-0002-7000-8000-000000000001"),
-          lotIdentifier: "LOT-01",
-          displayName: "Lot 01",
-          initialFacts: {
-            originKind: "unknown",
-            originEvidenceId: "018f0000-0003-7000-8000-000000000001" as unknown as EvidenceId,
-            originEvidenceRevision: 1
-          }
+    const result = await useCase.execute({
+      actionId: action1,
+      clientId: clientA,
+      actorId: actor,
+      timestamp,
+      payload: {
+        skuId: createSkuId("018f0000-0002-7000-8000-000000000001"),
+        lotIdentifier: "LOT-01",
+        displayName: "Lot 01",
+        initialFacts: {
+          originKind: "unknown",
+          originEvidenceId: "018f0000-0003-7000-8000-000000000001" as unknown as EvidenceId,
+          originEvidenceRevision: 1
         }
-      })
-    ).rejects.toThrow(ProductValidationError);
+      }
+    });
+    expect(result).toBe(mockBatch);
+    expect(mockRepo.createBatch).toHaveBeenCalledTimes(1);
   });
 
-  it("AppendBatchFactsUseCase: rejects unsupported origin evidence references", async () => {
-    const uow = createMockUow({});
+  it("AppendBatchFactsUseCase: accepts valid origin evidence references and delegates to repository", async () => {
+    const mockFacts = {
+      clientId: clientA,
+      batchId: createBatchId("018f0000-0002-7000-8000-000000000001"),
+      revision: 2,
+      originKind: "own_production",
+      producerIdentityAsClaimed: "Farm",
+      productionStartDate: "2026-03-01",
+      productionEndDate: "2026-03-10",
+      originEvidenceId: "018f0000-0003-7000-8000-000000000001",
+      originEvidenceRevision: 1,
+      assertedBy: actor,
+      assertedAt: timestamp,
+      supersedesRevision: 1
+    };
+    const mockRepo: Partial<ProductEvidenceRepositoryPort> = {
+      appendBatchFacts: vi.fn().mockResolvedValue(mockFacts)
+    };
+    const uow = createMockUow(mockRepo);
     const useCase = new AppendBatchFactsUseCase(uow);
 
-    await expect(
-      useCase.execute({
-        actionId: action1,
-        clientId: clientA,
-        actorId: actor,
-        timestamp,
-        payload: {
-          batchId: createBatchId("018f0000-0002-7000-8000-000000000001"),
-          expectedVersion: 1,
-          originKind: "own_production",
-          producerIdentityAsClaimed: "Farm",
-          productionStartDate: "2026-03-01",
-          productionEndDate: "2026-03-10",
-          originEvidenceId: "018f0000-0003-7000-8000-000000000001" as unknown as EvidenceId,
-          originEvidenceRevision: 1
-        }
-      })
-    ).rejects.toThrow(ProductValidationError);
+    const result = await useCase.execute({
+      actionId: action1,
+      clientId: clientA,
+      actorId: actor,
+      timestamp,
+      payload: {
+        batchId: createBatchId("018f0000-0002-7000-8000-000000000001"),
+        expectedVersion: 1,
+        originKind: "own_production",
+        producerIdentityAsClaimed: "Farm",
+        productionStartDate: "2026-03-01",
+        productionEndDate: "2026-03-10",
+        originEvidenceId: "018f0000-0003-7000-8000-000000000001" as unknown as EvidenceId,
+        originEvidenceRevision: 1
+      }
+    });
+    expect(result).toBe(mockFacts);
+    expect(mockRepo.appendBatchFacts).toHaveBeenCalledTimes(1);
   });
 
   it("UpdateProductSkuMetadataUseCase and UpdateProductBatchMetadataUseCase delegate through UoW", async () => {
diff --git a/packages/application/src/use-cases/product-registry-use-cases.ts b/packages/application/src/use-cases/product-registry-use-cases.ts
index b6f3055..cf2da0b 100644
--- a/packages/application/src/use-cases/product-registry-use-cases.ts
+++ b/packages/application/src/use-cases/product-registry-use-cases.ts
@@ -211,21 +211,42 @@ export class CreateProductBatchUseCase {
       ]);
 
       const facts = cmd.payload.initialFacts;
-      if (facts.originEvidenceId !== null && facts.originEvidenceId !== undefined) {
+      const hasId = facts.originEvidenceId !== null && facts.originEvidenceId !== undefined;
+      const hasRev =
+        facts.originEvidenceRevision !== null && facts.originEvidenceRevision !== undefined;
+      if (hasId && !hasRev) {
         throw new ProductValidationError([
           {
             code: "INVALID_FIELD_COMBINATION",
             path: ["initialFacts", "originEvidenceId"],
-            message: "Origin evidence linkage is not yet supported in this phase."
+            message: "originEvidenceRevision is required when originEvidenceId is provided."
           }
         ]);
       }
-      if (facts.originEvidenceRevision !== null && facts.originEvidenceRevision !== undefined) {
+      if (!hasId && hasRev) {
         throw new ProductValidationError([
           {
             code: "INVALID_FIELD_COMBINATION",
             path: ["initialFacts", "originEvidenceRevision"],
-            message: "Origin evidence linkage is not yet supported in this phase."
+            message: "originEvidenceId is required when originEvidenceRevision is provided."
+          }
+        ]);
+      }
+      if (hasId && !isValidUuid(facts.originEvidenceId!)) {
+        throw new ProductValidationError([
+          {
+            code: "INVALID_IDENTIFIER",
+            path: ["initialFacts", "originEvidenceId"],
+            message: "originEvidenceId must be a valid UUID string."
+          }
+        ]);
+      }
+      if (hasRev && !isValidPositiveInt(facts.originEvidenceRevision!)) {
+        throw new ProductValidationError([
+          {
+            code: "INVALID_REVISION",
+            path: ["initialFacts", "originEvidenceRevision"],
+            message: "originEvidenceRevision must be a positive integer."
           }
         ]);
       }
@@ -343,24 +364,44 @@ export class AppendBatchFactsUseCase {
       ]);
     }
 
-    if (cmd.payload.originEvidenceId !== null && cmd.payload.originEvidenceId !== undefined) {
+    const hasOriginId =
+      cmd.payload.originEvidenceId !== null && cmd.payload.originEvidenceId !== undefined;
+    const hasOriginRev =
+      cmd.payload.originEvidenceRevision !== null &&
+      cmd.payload.originEvidenceRevision !== undefined;
+    if (hasOriginId && !hasOriginRev) {
       throw new ProductValidationError([
         {
           code: "INVALID_FIELD_COMBINATION",
           path: ["originEvidenceId"],
-          message: "Origin evidence linkage is not yet supported in this phase."
+          message: "originEvidenceRevision is required when originEvidenceId is provided."
         }
       ]);
     }
-    if (
-      cmd.payload.originEvidenceRevision !== null &&
-      cmd.payload.originEvidenceRevision !== undefined
-    ) {
+    if (!hasOriginId && hasOriginRev) {
       throw new ProductValidationError([
         {
           code: "INVALID_FIELD_COMBINATION",
           path: ["originEvidenceRevision"],
-          message: "Origin evidence linkage is not yet supported in this phase."
+          message: "originEvidenceId is required when originEvidenceRevision is provided."
+        }
+      ]);
+    }
+    if (hasOriginId && !isValidUuid(cmd.payload.originEvidenceId!)) {
+      throw new ProductValidationError([
+        {
+          code: "INVALID_IDENTIFIER",
+          path: ["originEvidenceId"],
+          message: "originEvidenceId must be a valid UUID string."
+        }
+      ]);
+    }
+    if (hasOriginRev && !isValidPositiveInt(cmd.payload.originEvidenceRevision!)) {
+      throw new ProductValidationError([
+        {
+          code: "INVALID_REVISION",
+          path: ["originEvidenceRevision"],
+          message: "originEvidenceRevision must be a positive integer."
         }
       ]);
     }
diff --git a/packages/contracts/src/index.ts b/packages/contracts/src/index.ts
index 3f27bf5..961abce 100644
--- a/packages/contracts/src/index.ts
+++ b/packages/contracts/src/index.ts
@@ -42,3 +42,4 @@ export * from "./product-evidence-error.js";
 export * from "./product-evidence-command.js";
 export * from "./product-sku.js";
 export * from "./product-batch.js";
+export * from "./evidence-asset.js";
diff --git a/packages/domain/src/identifiers.ts b/packages/domain/src/identifiers.ts
index de8c8aa..c23b1c6 100644
--- a/packages/domain/src/identifiers.ts
+++ b/packages/domain/src/identifiers.ts
@@ -19,8 +19,14 @@ export type ClientId = Brand<string, "ClientId">;
 export type SkuId = Brand<string, "SkuId">;
 export type BatchId = Brand<string, "BatchId">;
 export type EvidenceId = Brand<string, "EvidenceId">;
+export type SourceObjectId = Brand<string, "SourceObjectId">;
+export type DerivativeId = Brand<string, "DerivativeId">;
+export type VerificationEventId = Brand<string, "VerificationEventId">;
 export type ActionId = Brand<string, "ActionId">;
 
+/** Lowercase 64-hex SHA-256 digest string */
+export type Sha256Hex = string & { readonly __sha256: true };
+
 function validateAndBrandUuid<B extends string>(
   val: unknown,
   _brandName: B,
@@ -57,6 +63,34 @@ export function createEvidenceId(val: string): EvidenceId {
   return validateAndBrandUuid(val, "EvidenceId", "evidenceId");
 }
 
+export function createSourceObjectId(val: string): SourceObjectId {
+  return validateAndBrandUuid(val, "SourceObjectId", "sourceObjectId");
+}
+
+export function createDerivativeId(val: string): DerivativeId {
+  return validateAndBrandUuid(val, "DerivativeId", "derivativeId");
+}
+
+export function createVerificationEventId(val: string): VerificationEventId {
+  return validateAndBrandUuid(val, "VerificationEventId", "verificationEventId");
+}
+
 export function createActionId(val: string): ActionId {
   return validateAndBrandUuid(val, "ActionId", "actionId");
 }
+
+export function createSha256Hex(val: string): Sha256Hex {
+  if (typeof val !== "string" || !/^[0-9a-f]{64}$/.test(val)) {
+    throw new ProductValidationError(
+      [
+        {
+          code: "INVALID_TEXT",
+          path: ["sha256"],
+          message: "sha256 must be a lowercase 64-hex SHA-256 digest string."
+        }
+      ],
+      `Invalid sha256: "${String(val)}" is not a valid 64-character lowercase hex digest.`
+    );
+  }
+  return val as Sha256Hex;
+}
diff --git a/packages/domain/src/index.ts b/packages/domain/src/index.ts
index f50cee8..eaa895e 100644
--- a/packages/domain/src/index.ts
+++ b/packages/domain/src/index.ts
@@ -18,3 +18,5 @@ export * from "./product-evidence-errors.js";
 export * from "./product-sku.js";
 export * from "./batch-facts.js";
 export * from "./product-batch.js";
+export * from "./source-object.js";
+export * from "./evidence-asset.js";
diff --git a/packages/domain/src/product-evidence-errors.ts b/packages/domain/src/product-evidence-errors.ts
index c47ab9e..8f5846c 100644
--- a/packages/domain/src/product-evidence-errors.ts
+++ b/packages/domain/src/product-evidence-errors.ts
@@ -128,3 +128,43 @@ export class IdempotencyConflictError extends ProductEvidenceDomainError {
     );
   }
 }
+
+export class SourceIntegrityMismatchError extends ProductEvidenceDomainError {
+  override readonly name = "SourceIntegrityMismatchError";
+
+  constructor(message: string, details?: Readonly<Record<string, unknown>>) {
+    super("SOURCE_INTEGRITY_MISMATCH", message, details);
+  }
+}
+
+export class MimeConflictError extends ProductEvidenceDomainError {
+  override readonly name = "MimeConflictError";
+
+  constructor(message: string, details?: Readonly<Record<string, unknown>>) {
+    super("MIME_CONFLICT", message, details);
+  }
+}
+
+export class SourceSupersededError extends ProductEvidenceDomainError {
+  override readonly name = "SourceSupersededError";
+
+  constructor(message: string, details?: Readonly<Record<string, unknown>>) {
+    super("SOURCE_SUPERSEDED", message, details);
+  }
+}
+
+export class QuotaExceededError extends ProductEvidenceDomainError {
+  override readonly name = "QuotaExceededError";
+
+  constructor(message: string, details?: Readonly<Record<string, unknown>>) {
+    super("QUOTA_EXCEEDED", message, details);
+  }
+}
+
+export class ReportDisputedError extends ProductEvidenceDomainError {
+  override readonly name = "ReportDisputedError";
+
+  constructor(message: string, details?: Readonly<Record<string, unknown>>) {
+    super("REPORT_DISPUTED", message, details);
+  }
+}
diff --git a/packages/domain/src/product-identifiers.test.ts b/packages/domain/src/product-identifiers.test.ts
index 1e89f07..eca8643 100644
--- a/packages/domain/src/product-identifiers.test.ts
+++ b/packages/domain/src/product-identifiers.test.ts
@@ -3,27 +3,40 @@ import {
   createActionId,
   createBatchId,
   createClientId,
+  createDerivativeId,
   createEvidenceId,
-  createSkuId
+  createSha256Hex,
+  createSkuId,
+  createSourceObjectId,
+  createVerificationEventId
 } from "./identifiers.js";
 import { ProductValidationError } from "./product-evidence-errors.js";
 
 describe("Product and Evidence Authority Brands", () => {
   const validV7 = "018f0000-0000-7000-8000-000000000001";
   const validV4 = "a0eebc99-9c0b-4ef8-bb6d-6bb9bd380a11";
+  const validSha = "a1b2c3d4e5f67890123456789abcdef0123456789abcdef0123456789abcdef0";
 
   it("creates validated branded identifiers from valid UUIDs", () => {
     const clientId = createClientId(validV7);
     const skuId = createSkuId(validV7);
     const batchId = createBatchId(validV4);
     const evidenceId = createEvidenceId(validV7);
+    const sourceObjectId = createSourceObjectId(validV7);
+    const derivativeId = createDerivativeId(validV4);
+    const verificationEventId = createVerificationEventId(validV7);
     const actionId = createActionId(validV4);
+    const sha256 = createSha256Hex(validSha);
 
     expect(clientId).toBe(validV7);
     expect(skuId).toBe(validV7);
     expect(batchId).toBe(validV4);
     expect(evidenceId).toBe(validV7);
+    expect(sourceObjectId).toBe(validV7);
+    expect(derivativeId).toBe(validV4);
+    expect(verificationEventId).toBe(validV7);
     expect(actionId).toBe(validV4);
+    expect(sha256).toBe(validSha);
   });
 
   it("normalizes uppercase hex to lowercase", () => {
@@ -38,6 +51,9 @@ describe("Product and Evidence Authority Brands", () => {
     expect(() => createSkuId(padded)).toThrow(ProductValidationError);
     expect(() => createBatchId(padded)).toThrow(ProductValidationError);
     expect(() => createEvidenceId(padded)).toThrow(ProductValidationError);
+    expect(() => createSourceObjectId(padded)).toThrow(ProductValidationError);
+    expect(() => createDerivativeId(padded)).toThrow(ProductValidationError);
+    expect(() => createVerificationEventId(padded)).toThrow(ProductValidationError);
     expect(() => createActionId(padded)).toThrow(ProductValidationError);
   });
 
@@ -45,4 +61,10 @@ describe("Product and Evidence Authority Brands", () => {
     expect(() => createClientId("not-a-uuid")).toThrow(ProductValidationError);
     expect(() => createSkuId("")).toThrow(ProductValidationError);
   });
+
+  it("rejects invalid sha256 hex strings", () => {
+    expect(() => createSha256Hex("short")).toThrow(ProductValidationError);
+    expect(() => createSha256Hex(` ${validSha} `)).toThrow(ProductValidationError);
+    expect(() => createSha256Hex(validSha.toUpperCase())).toThrow(ProductValidationError);
+  });
 });
diff --git a/packages/infrastructure/package.json b/packages/infrastructure/package.json
index a4d42af..bd10435 100644
--- a/packages/infrastructure/package.json
+++ b/packages/infrastructure/package.json
@@ -34,6 +34,7 @@
     "@cco/domain": "workspace:*",
     "@cco/shared": "workspace:*",
     "kokoro-js": "^1.2.1",
+    "pdf-lib": "1.17.1",
     "pg": "^8.13.1",
     "sharp": "0.34.5"
   },
diff --git a/packages/infrastructure/src/index.ts b/packages/infrastructure/src/index.ts
index 46bed44..a08d631 100644
--- a/packages/infrastructure/src/index.ts
+++ b/packages/infrastructure/src/index.ts
@@ -466,4 +466,14 @@ export {
   DEFAULT_MAX_PIXELS
 } from "./image/sharp-image-inspection-adapter.js";
 
+export {
+  OriginalsInspectionAdapter,
+  type OriginalsInspectionLimits
+} from "./evidence/originals-inspection-adapter.js";
+export { PostgresEvidenceLockCoordinator } from "./evidence/postgres-evidence-lock-coordinator.js";
+export {
+  PostgresEvidenceAssetRepository,
+  type PostgresEvidenceAssetRepositoryOptions
+} from "./evidence/postgres-evidence-asset-repository.js";
+
 export * from "./experiments/index.js";
diff --git a/packages/infrastructure/src/postgres/audit-protections.integration.test.ts b/packages/infrastructure/src/postgres/audit-protections.integration.test.ts
index f0d1153..7428003 100644
--- a/packages/infrastructure/src/postgres/audit-protections.integration.test.ts
+++ b/packages/infrastructure/src/postgres/audit-protections.integration.test.ts
@@ -499,7 +499,7 @@ describe("PostgreSQL audit immutability and application-role privileges integrat
     // Verify migration succeeds when no application role is configured
     await client.query("DROP SCHEMA public CASCADE; CREATE SCHEMA public;");
     const noRoleApplied = await runMigrations(client, { migrationsDirectory });
-    expect(noRoleApplied).toHaveLength(26);
+    expect(noRoleApplied).toHaveLength(27);
   });
 
   it("fails closed when application role has effective UPDATE or DELETE privilege on storyboard_candidates", async () => {
diff --git a/packages/infrastructure/src/postgres/baseline-schema.integration.test.ts b/packages/infrastructure/src/postgres/baseline-schema.integration.test.ts
index 41f5ef3..c06c672 100644
--- a/packages/infrastructure/src/postgres/baseline-schema.integration.test.ts
+++ b/packages/infrastructure/src/postgres/baseline-schema.integration.test.ts
@@ -55,7 +55,7 @@ describe("PostgreSQL 18.6 baseline schema integration", () => {
   it("migrates an empty PostgreSQL 18.6 database through the baseline", async () => {
     const applied = await runMigrations(client, { migrationsDirectory });
 
-    expect(applied).toHaveLength(26);
+    expect(applied).toHaveLength(27);
     expect(applied[0]?.version).toBe("001");
     expect(applied[1]?.version).toBe("002");
     expect(applied[2]?.version).toBe("003");
@@ -82,6 +82,7 @@ describe("PostgreSQL 18.6 baseline schema integration", () => {
     expect(applied[23]?.version).toBe("024");
     expect(applied[24]?.version).toBe("025");
     expect(applied[25]?.version).toBe("026");
+    expect(applied[26]?.version).toBe("027");
 
     const schemaRes = await client.query(
       "SELECT version FROM schema_migrations ORDER BY version ASC"
@@ -112,7 +113,8 @@ describe("PostgreSQL 18.6 baseline schema integration", () => {
       { version: "023" },
       { version: "024" },
       { version: "025" },
-      { version: "026" }
+      { version: "026" },
+      { version: "027" }
     ]);
 
     const tablesRes = await client.query<{ table_name: string }>(
@@ -126,6 +128,7 @@ describe("PostgreSQL 18.6 baseline schema integration", () => {
 
     const tableNames = tablesRes.rows.map((r) => r.table_name);
     expect(tableNames).toEqual([
+      "batch_evidence_links",
       "campaign_production_run_scenes",
       "campaign_production_runs",
       "campaign_reference_bible_changes",
@@ -133,6 +136,11 @@ describe("PostgreSQL 18.6 baseline schema integration", () => {
       "campaigns",
       "clients",
       "delivery_assembly_jobs",
+      "evidence_assets",
+      "evidence_derivatives",
+      "evidence_ingest_reservations",
+      "evidence_revisions",
+      "evidence_verification_events",
       "generation_manifests",
       "license_registry",
       "product_batch_facts",
@@ -148,6 +156,7 @@ describe("PostgreSQL 18.6 baseline schema integration", () => {
       "schema_migrations",
       "shot_plan_previs_associations",
       "shot_plans",
+      "source_objects",
       "storyboard_candidates",
       "storyboard_scenes"
     ]);
diff --git a/packages/infrastructure/src/postgres/job-dispatch-contract.integration.test.ts b/packages/infrastructure/src/postgres/job-dispatch-contract.integration.test.ts
index 3e113b5..9ff1a12 100644
--- a/packages/infrastructure/src/postgres/job-dispatch-contract.integration.test.ts
+++ b/packages/infrastructure/src/postgres/job-dispatch-contract.integration.test.ts
@@ -63,7 +63,8 @@ describe("PostgreSQL job dispatch schema contract integration", () => {
     expect(applied.some((m) => m.version === "024")).toBe(true);
     expect(applied.some((m) => m.version === "025")).toBe(true);
     expect(applied.some((m) => m.version === "026")).toBe(true);
-    expect(applied[applied.length - 1]?.version).toBe("026");
+    expect(applied.some((m) => m.version === "027")).toBe(true);
+    expect(applied[applied.length - 1]?.version).toBe("027");
 
     // 2. Run it again and assert []
     const rerun = await runMigrations(client, { migrationsDirectory });
diff --git a/packages/infrastructure/src/postgres/product-registry-schema.integration.test.ts b/packages/infrastructure/src/postgres/product-registry-schema.integration.test.ts
index faadf6e..a8fa6f6 100644
--- a/packages/infrastructure/src/postgres/product-registry-schema.integration.test.ts
+++ b/packages/infrastructure/src/postgres/product-registry-schema.integration.test.ts
@@ -2,7 +2,7 @@ import { mkdtemp, cp, rm, readdir } from "node:fs/promises";
 import { tmpdir } from "node:os";
 import { join } from "node:path";
 import { pathToFileURL, fileURLToPath } from "node:url";
-import { describe, it, expect, beforeAll, afterAll, beforeEach } from "vitest";
+import { describe, it, expect, beforeAll, afterAll, beforeEach, afterEach } from "vitest";
 import { Pool, type PoolClient } from "pg";
 import { runMigrations } from "./migration-runner.js";
 import {
@@ -43,6 +43,12 @@ describe("PostgreSQL product registry schema and protection integration", () =>
     await client.query("DROP SCHEMA public CASCADE; CREATE SCHEMA public;");
   });
 
+  afterEach(async () => {
+    if (client) {
+      await client.query("ROLLBACK").catch(() => {});
+    }
+  });
+
   it("applies migration 026 and registers exact tables and constraints", async () => {
     const applied = await runMigrations(client, { migrationsDirectory });
     expect(applied.some((m) => m.version === "026")).toBe(true);
@@ -172,7 +178,7 @@ describe("PostgreSQL product registry schema and protection integration", () =>
     ).rejects.toThrow(/chk_batch_facts_monotonic_rev/);
   });
 
-  it("enforces temporary rejection of origin evidence links via check constraint", async () => {
+  it("enforces rejection of origin evidence links without batch evidence link via foreign key constraint", async () => {
     await runMigrations(client, { migrationsDirectory });
     const clientRecord = await insertClientRecord(client);
 
@@ -197,7 +203,7 @@ describe("PostgreSQL product registry schema and protection integration", () =>
          VALUES ($1, $2, 1, 'own_production', uuidv7(), 1, 'tester')`,
         [clientRecord.client_id, batchId]
       )
-    ).rejects.toThrow(/chk_batch_facts_origin_evidence_deferred/);
+    ).rejects.toThrow(/fk_batch_facts_origin_evidence/);
     await client.query("ROLLBACK");
   });
 
diff --git a/packages/infrastructure/src/postgres/repositories/postgres-product-evidence-repository.integration.test.ts b/packages/infrastructure/src/postgres/repositories/postgres-product-evidence-repository.integration.test.ts
index 7b501c3..6ea7768 100644
--- a/packages/infrastructure/src/postgres/repositories/postgres-product-evidence-repository.integration.test.ts
+++ b/packages/infrastructure/src/postgres/repositories/postgres-product-evidence-repository.integration.test.ts
@@ -746,6 +746,7 @@ describe("PostgresProductEvidenceRepository and UoW integration", () => {
           payload: { skuId: sku1.skuId, lotIdentifier: "LOT-LATE", displayName: "Late Batch" }
         })
       );
+      pCreate.catch(() => {});
 
       await lockingClientA.query("COMMIT");
       await expect(pCreate).rejects.toThrow(AccessDeniedError);
diff --git a/packages/infrastructure/src/postgres/repositories/postgres-product-evidence-repository.ts b/packages/infrastructure/src/postgres/repositories/postgres-product-evidence-repository.ts
index 99f682a..93303c2 100644
--- a/packages/infrastructure/src/postgres/repositories/postgres-product-evidence-repository.ts
+++ b/packages/infrastructure/src/postgres/repositories/postgres-product-evidence-repository.ts
@@ -29,6 +29,7 @@ import {
   createProductBatch,
   createProductSku,
   createSkuId,
+  CrossBatchSourceError,
   CrossClientViolationError,
   DuplicateLotError,
   DuplicateSkuError,
@@ -39,6 +40,7 @@ import {
   rehydrateBatchFactsRevision,
   rehydrateProductBatch,
   rehydrateProductSku,
+  ReportDisputedError,
   StaleRevisionConflictError,
   updateProductBatchMetadata,
   updateProductSkuMetadata,
@@ -388,7 +390,14 @@ const PRODUCT_REGISTRY_TABLES = new Set<string>([
   "product_skus",
   "product_batches",
   "product_batch_facts",
-  "product_evidence_command_receipts"
+  "product_evidence_command_receipts",
+  "source_objects",
+  "evidence_assets",
+  "evidence_revisions",
+  "batch_evidence_links",
+  "evidence_derivatives",
+  "evidence_verification_events",
+  "evidence_ingest_reservations"
 ]);
 
 const REGISTRY_CONSTRAINTS = new Set<string>([
@@ -411,6 +420,7 @@ const REGISTRY_CONSTRAINTS = new Set<string>([
   "chk_product_batches_display_name",
   "chk_batch_facts_monotonic_rev",
   "chk_batch_facts_origin_evidence_all_or_none",
+  "fk_batch_facts_origin_evidence",
   "chk_batch_facts_origin_evidence_deferred",
   "chk_batch_facts_dates",
   "chk_batch_facts_asserted_by_nonempty",
@@ -428,7 +438,109 @@ const REGISTRY_CONSTRAINTS = new Set<string>([
   "chk_product_skus_archived_at",
   "chk_product_batches_created_at",
   "chk_product_batches_updated_at",
-  "chk_product_batches_archived_at"
+  "chk_product_batches_archived_at",
+  "uq_reference_assets_client_asset",
+  "source_objects_pkey",
+  "uq_source_objects_client_obj",
+  "uq_source_objects_client_hash",
+  "uq_source_objects_storage",
+  "uq_source_objects_storage_location",
+  "source_objects_byte_length_check",
+  "source_objects_access_class_check",
+  "source_objects_retention_class_check",
+  "source_objects_availability_check",
+  "source_objects_client_id_fkey",
+  "chk_sha256_format",
+  "chk_source_objects_uploader_nonempty",
+  "chk_source_objects_policy_nonempty",
+  "chk_source_objects_mime_nonempty",
+  "chk_source_objects_bucket_nonempty",
+  "chk_source_objects_key_nonempty",
+  "chk_source_objects_uploaded_at",
+  "chk_source_object_hash_format",
+  "chk_source_object_bucket_nonempty",
+  "chk_source_object_key_nonempty",
+  "chk_source_object_mime_nonempty",
+  "chk_source_object_uploader_nonempty",
+  "chk_source_object_policy_nonempty",
+  "chk_source_object_timestamps",
+  "evidence_assets_pkey",
+  "uq_evidence_assets_client_evidence",
+  "evidence_assets_current_revision_check",
+  "evidence_assets_version_check",
+  "evidence_assets_client_id_fkey",
+  "chk_evidence_assets_created_at",
+  "chk_evidence_assets_archived_at",
+  "chk_evidence_asset_revision_pos",
+  "chk_evidence_asset_version_pos",
+  "chk_evidence_asset_timestamps",
+  "fk_evidence_assets_current_rev",
+  "fk_evidence_assets_client",
+  "evidence_revisions_pkey",
+  "uq_evidence_revisions_client_revision",
+  "uq_evidence_revisions_predecessor",
+  "uq_evidence_rev_predecessor",
+  "fk_evidence_revisions_asset",
+  "fk_evidence_revisions_source",
+  "fk_evidence_revisions_predecessor",
+  "chk_evidence_rev_monotonic",
+  "chk_evidence_revision_supersedes_not_self",
+  "chk_evidence_revisions_assertion_nonempty",
+  "chk_evidence_revisions_submitted_by_nonempty",
+  "chk_evidence_revisions_submitted_at",
+  "chk_evidence_revisions_capture_date",
+  "chk_evidence_revisions_capture_timestamp",
+  "chk_evidence_revisions_capture_date_match",
+  "chk_evidence_revision_number_pos",
+  "chk_evidence_revision_submitted_by_nonempty",
+  "chk_evidence_revision_assertion_nonempty",
+  "chk_evidence_revision_submitted_at",
+  "chk_evidence_revision_capture_dates",
+  "chk_evidence_revision_rights_attribution",
+  "chk_evidence_revision_rights_document",
+  "evidence_revisions_revision_check",
+  "evidence_revisions_source_class_check",
+  "evidence_revisions_acquisition_method_check",
+  "evidence_revisions_rights_status_check",
+  "evidence_revisions_consent_status_check",
+  "evidence_revisions_reported_capture_precision_check",
+  "batch_evidence_links_pkey",
+  "uq_batch_evidence_links_full",
+  "uq_batch_evidence_links_client_link",
+  "fk_batch_evidence_batch",
+  "fk_batch_evidence_revision",
+  "batch_evidence_links_purpose_check",
+  "chk_batch_evidence_asserted_by_nonempty",
+  "chk_batch_evidence_asserted_at",
+  "chk_batch_evidence_purpose_nonempty",
+  "evidence_derivatives_pkey",
+  "uq_evidence_derivatives_client_deriv",
+  "uq_evidence_derivatives_bridge",
+  "fk_evidence_derivatives_revision",
+  "fk_evidence_derivatives_reference",
+  "chk_derivative_sha256_format",
+  "chk_derivative_transform_nonempty",
+  "chk_derivative_created_by_nonempty",
+  "chk_derivative_created_at",
+  "evidence_verification_events_pkey",
+  "uq_verification_events_client_event",
+  "uq_verification_events_full",
+  "fk_verification_events_revision",
+  "fk_verification_events_withdrawal",
+  "evidence_verification_events_outcome_check",
+  "evidence_verification_events_verification_kind_check",
+  "evidence_verification_events_fact_scope_check",
+  "chk_verification_events_withdrawal_no_self",
+  "chk_verification_events_method_nonempty",
+  "chk_verification_events_reason_nonempty",
+  "chk_verification_events_actor_nonempty",
+  "chk_verification_events_occurred_at",
+  "evidence_ingest_reservations_pkey",
+  "evidence_ingest_reservations_client_id_fkey",
+  "evidence_ingest_reservations_reserved_bytes_check",
+  "evidence_ingest_reservations_status_check",
+  "chk_reservation_sha256_format",
+  "chk_reservation_timestamps"
 ]);
 
 export function translateDatabaseError(
@@ -446,6 +558,43 @@ export function translateDatabaseError(
 
     switch (dbErr.code) {
       case "23505": {
+        if (dbErr.constraint === "uq_evidence_derivatives_bridge") {
+          throw new ProductValidationError([
+            {
+              code: "INVALID_FIELD_COMBINATION",
+              path: ["derivative"],
+              message: "A derivative link already exists for this revision and reference asset."
+            }
+          ]);
+        }
+        if (
+          dbErr.constraint === "uq_evidence_revisions_client_revision" ||
+          dbErr.constraint === "uq_evidence_revisions_predecessor" ||
+          dbErr.constraint === "uq_evidence_rev_predecessor" ||
+          dbErr.constraint === "evidence_revisions_pkey"
+        ) {
+          throw new NonMonotonicRevisionError(
+            "Evidence revision conflict: duplicate or forked revision"
+          );
+        }
+        if (
+          dbErr.constraint === "uq_source_objects_client_hash" ||
+          dbErr.constraint === "uq_source_objects_storage" ||
+          dbErr.constraint === "uq_source_objects_storage_location" ||
+          dbErr.constraint === "uq_source_objects_client_obj" ||
+          dbErr.constraint === "source_objects_pkey"
+        ) {
+          throw new ConcurrencyConflictError(`Duplicate source object conflict: ${dbErr.message}`);
+        }
+        if (
+          dbErr.constraint === "uq_batch_evidence_links_client_link" ||
+          dbErr.constraint === "uq_batch_evidence_links_full" ||
+          dbErr.constraint === "batch_evidence_links_pkey"
+        ) {
+          throw new ConcurrencyConflictError(
+            `Evidence revision is already linked to this batch: ${dbErr.message}`
+          );
+        }
         if (dbErr.constraint === "uq_product_skus_canonical") {
           throw new DuplicateSkuError(context?.canonicalSku ?? "unknown", context?.clientId);
         }
@@ -463,9 +612,76 @@ export function translateDatabaseError(
             "Predecessor revision conflict: duplicate or forked predecessor"
           );
         }
+        if (
+          dbErr.constraint === "uq_verification_events_client_event" ||
+          dbErr.constraint === "uq_verification_events_full" ||
+          dbErr.constraint === "evidence_verification_events_pkey"
+        ) {
+          throw new ConcurrencyConflictError(
+            `Duplicate verification event conflict: ${dbErr.message}`
+          );
+        }
+        if (
+          dbErr.constraint === "uq_evidence_assets_client_evidence" ||
+          dbErr.constraint === "evidence_assets_pkey"
+        ) {
+          throw new ConcurrencyConflictError(`Duplicate evidence asset conflict: ${dbErr.message}`);
+        }
+        if (
+          dbErr.constraint === "uq_evidence_derivatives_client_deriv" ||
+          dbErr.constraint === "evidence_derivatives_pkey"
+        ) {
+          throw new ConcurrencyConflictError(
+            `Duplicate evidence derivative conflict: ${dbErr.message}`
+          );
+        }
+        if (dbErr.constraint === "evidence_ingest_reservations_pkey") {
+          throw new ConcurrencyConflictError(
+            `Duplicate evidence ingest reservation conflict: ${dbErr.message}`
+          );
+        }
+        if (
+          (dbErr.constraint && REGISTRY_CONSTRAINTS.has(dbErr.constraint)) ||
+          (dbErr.table && PRODUCT_REGISTRY_TABLES.has(dbErr.table))
+        ) {
+          throw new ConcurrencyConflictError(`Unique constraint conflict: ${dbErr.message}`);
+        }
         break;
       }
       case "23503": {
+        if (dbErr.constraint === "fk_evidence_assets_current_rev") {
+          throw new StaleRevisionConflictError("EvidenceAsset", 0, 0);
+        }
+        if (dbErr.constraint === "fk_evidence_derivatives_reference") {
+          throw new NotFoundError(
+            "ReferenceAsset",
+            "Referenced derivative reference asset does not exist"
+          );
+        }
+        if (dbErr.constraint === "fk_evidence_derivatives_revision") {
+          throw new NotFoundError(
+            "EvidenceRevision",
+            "Referenced evidence revision does not exist"
+          );
+        }
+        if (dbErr.constraint === "fk_evidence_revisions_source") {
+          throw new NotFoundError("SourceObject", "Referenced source object does not exist");
+        }
+        if (dbErr.constraint === "fk_batch_evidence_revision") {
+          throw new NotFoundError(
+            "EvidenceRevision",
+            "Referenced evidence revision does not exist"
+          );
+        }
+        if (dbErr.constraint === "fk_batch_evidence_batch") {
+          throw new NotFoundError("ProductBatch", "Referenced product batch does not exist");
+        }
+        if (
+          dbErr.constraint === "fk_source_objects_client" ||
+          dbErr.constraint === "fk_evidence_assets_client"
+        ) {
+          throw new NotFoundError("Client", context?.clientId ?? "unknown");
+        }
         if (dbErr.constraint === "fk_product_batches_sku") {
           throw new CrossClientViolationError(
             "Referenced SKU does not exist or belongs to a different client"
@@ -483,6 +699,12 @@ export function translateDatabaseError(
         if (dbErr.constraint === "fk_batch_facts_predecessor") {
           throw new NonMonotonicRevisionError("Predecessor facts revision does not exist");
         }
+        if (dbErr.constraint === "fk_batch_facts_origin_evidence") {
+          throw new NotFoundError(
+            "BatchEvidenceLink",
+            "Referenced origin evidence revision is not linked to this batch"
+          );
+        }
         if (
           dbErr.constraint === "fk_product_skus_client" ||
           dbErr.constraint === "product_skus_client_id_fkey" ||
@@ -511,6 +733,33 @@ export function translateDatabaseError(
             "RESTRICT_VIOLATION"
           );
         }
+        if (
+          dbErr.constraint === "fk_evidence_revisions_asset" ||
+          dbErr.constraint === "evidence_revisions_client_id_fkey"
+        ) {
+          throw new NotFoundError("EvidenceAsset", "Referenced evidence asset does not exist");
+        }
+        if (dbErr.constraint === "fk_evidence_revisions_predecessor") {
+          throw new NonMonotonicRevisionError("Predecessor evidence revision does not exist");
+        }
+        if (dbErr.constraint === "fk_verification_events_revision") {
+          throw new NotFoundError(
+            "EvidenceRevision",
+            "Referenced evidence revision does not exist"
+          );
+        }
+        if (dbErr.constraint === "fk_verification_events_withdrawal") {
+          throw new NotFoundError(
+            "EvidenceVerificationEvent",
+            "Referenced withdrawal event does not exist"
+          );
+        }
+        if (
+          (dbErr.constraint && REGISTRY_CONSTRAINTS.has(dbErr.constraint)) ||
+          (dbErr.table && PRODUCT_REGISTRY_TABLES.has(dbErr.table))
+        ) {
+          throw new NotFoundError("Entity", `Referenced entity does not exist: ${dbErr.message}`);
+        }
         break;
       }
       case "23001": {
@@ -537,7 +786,15 @@ export function translateDatabaseError(
           dbErr.message.includes("append-only") ||
           dbErr.message.includes("Archived SKU") ||
           dbErr.message.includes("Archived Batch") ||
-          dbErr.message.includes("updated_at must be nondecreasing")
+          dbErr.message.includes("updated_at must be nondecreasing") ||
+          dbErr.message.includes("Permanent evidence asset identity") ||
+          dbErr.message.includes("Permanent source object binary columns") ||
+          dbErr.message.includes("Archived evidence asset") ||
+          dbErr.message.includes("Archived source objects") ||
+          dbErr.message.includes("Deleted source objects") ||
+          dbErr.message.includes("Quarantined, archived, or deleted") ||
+          dbErr.message.includes("cannot be reactivated") ||
+          dbErr.message.includes("Storage version ID cannot be changed")
         ) {
           throw new AccessDeniedError(dbErr.message);
         }
@@ -553,10 +810,23 @@ export function translateDatabaseError(
         if (dbErr.message.includes("facts pointer")) {
           throw new NonMonotonicRevisionError(dbErr.message);
         }
+        if (
+          (dbErr.table && PRODUCT_REGISTRY_TABLES.has(dbErr.table)) ||
+          (dbErr.constraint && REGISTRY_CONSTRAINTS.has(dbErr.constraint)) ||
+          dbErr.message
+        ) {
+          throw new AccessDeniedError(dbErr.message);
+        }
         break;
       }
       case "23514": {
         // Check constraints - strictly allowlisted registry checks only
+        if (
+          dbErr.constraint === "chk_evidence_rev_monotonic" ||
+          dbErr.constraint === "chk_evidence_revision_supersedes_not_self"
+        ) {
+          throw new NonMonotonicRevisionError("Evidence revision must be contiguous and monotonic");
+        }
         if (dbErr.constraint === "chk_batch_facts_monotonic_rev") {
           throw new NonMonotonicRevisionError(
             "Batch facts revision must be contiguous and monotonic"
@@ -597,7 +867,8 @@ export function translateDatabaseError(
             {
               code: "INVALID_FIELD_COMBINATION",
               path: ["originEvidenceId"],
-              message: "Origin evidence linkage is not yet supported in this phase."
+              message:
+                "originEvidenceId and originEvidenceRevision must either both be specified or both be omitted."
             }
           ]);
         }
@@ -693,17 +964,33 @@ export function translateDatabaseError(
             }
           ]);
         }
+        if (
+          (dbErr.constraint && REGISTRY_CONSTRAINTS.has(dbErr.constraint)) ||
+          dbErr.constraint?.startsWith("chk_source_object") ||
+          dbErr.constraint?.startsWith("chk_evidence_") ||
+          dbErr.constraint?.startsWith("chk_batch_evidence_") ||
+          dbErr.constraint?.startsWith("chk_derivative_") ||
+          dbErr.constraint?.startsWith("chk_verification_events_") ||
+          dbErr.constraint?.startsWith("chk_reservation_") ||
+          dbErr.constraint === "chk_sha256_format" ||
+          (dbErr.table && PRODUCT_REGISTRY_TABLES.has(dbErr.table))
+        ) {
+          throw new ProductValidationError([
+            {
+              code: "INVALID_FIELD_COMBINATION",
+              path: [],
+              message: dbErr.message
+            }
+          ]);
+        }
         break;
       }
       case "40001":
       case "40P01":
       case "55P03": {
-        if (context !== undefined || (dbErr.table && PRODUCT_REGISTRY_TABLES.has(dbErr.table))) {
-          throw new ConcurrencyConflictError(
-            `PostgreSQL transaction concurrency failure (${dbErr.code}): ${dbErr.message}`
-          );
-        }
-        break;
+        throw new ConcurrencyConflictError(
+          `PostgreSQL transaction concurrency failure (${dbErr.code}): ${dbErr.message}`
+        );
       }
     }
   }
@@ -719,27 +1006,36 @@ export function isProductRegistryDatabaseError(err: unknown): boolean {
       message: string;
       table?: string;
     };
+    if (dbErr.code === "40001" || dbErr.code === "40P01" || dbErr.code === "55P03") {
+      return true;
+    }
+    if (dbErr.code === "23506") {
+      return true;
+    }
     if (dbErr.constraint && REGISTRY_CONSTRAINTS.has(dbErr.constraint)) {
       return true;
     }
     if (dbErr.table && PRODUCT_REGISTRY_TABLES.has(dbErr.table)) {
       return true;
     }
-    if (dbErr.code === "23506") {
-      return (
-        dbErr.message.includes("Permanent SKU identity") ||
-        dbErr.message.includes("Permanent Batch identity") ||
-        dbErr.message.includes("CANNOT_DELETE_HEAD_ENTITY") ||
-        dbErr.message.includes("CANNOT_MODIFY_IMMUTABLE_ENTITY") ||
-        dbErr.message.includes("Archived SKU") ||
-        dbErr.message.includes("Archived Batch") ||
-        dbErr.message.includes("Cannot create batch under archived SKU") ||
-        dbErr.message.includes("Cannot append facts to archived batch") ||
-        dbErr.message.includes("version must advance") ||
-        dbErr.message.includes("facts pointer") ||
-        dbErr.message.includes("updated_at must be nondecreasing")
-      );
-    }
+    return (
+      dbErr.message.includes("Permanent SKU identity") ||
+      dbErr.message.includes("Permanent Batch identity") ||
+      dbErr.message.includes("CANNOT_DELETE_HEAD_ENTITY") ||
+      dbErr.message.includes("CANNOT_MODIFY_IMMUTABLE_ENTITY") ||
+      dbErr.message.includes("Archived SKU") ||
+      dbErr.message.includes("Archived Batch") ||
+      dbErr.message.includes("Cannot create batch under archived SKU") ||
+      dbErr.message.includes("Cannot append facts to archived batch") ||
+      dbErr.message.includes("version must advance") ||
+      dbErr.message.includes("facts pointer") ||
+      dbErr.message.includes("updated_at must be nondecreasing") ||
+      dbErr.message.includes("Permanent source object binary columns") ||
+      dbErr.message.includes("cannot be reactivated") ||
+      dbErr.message.includes("Storage version ID cannot be changed") ||
+      dbErr.message.includes("forbids UPDATE or DELETE") ||
+      dbErr.message.includes("forbids DELETE")
+    );
   }
   return false;
 }
@@ -923,24 +1219,54 @@ export class PostgresProductEvidenceRepository implements ProductEvidenceReposit
         "initialFacts"
       ]);
       const facts = cmd.payload.initialFacts;
-      if (facts.originEvidenceId !== null && facts.originEvidenceId !== undefined) {
+      if (
+        facts.originEvidenceId !== null &&
+        facts.originEvidenceId !== undefined &&
+        (facts.originEvidenceRevision === null || facts.originEvidenceRevision === undefined)
+      ) {
         throw new ProductValidationError([
           {
             code: "INVALID_FIELD_COMBINATION",
-            path: ["initialFacts", "originEvidenceId"],
-            message: "Origin evidence linkage is not yet supported in this phase."
+            path: ["initialFacts", "originEvidenceRevision"],
+            message: "originEvidenceRevision must be specified when originEvidenceId is present."
           }
         ]);
       }
-      if (facts.originEvidenceRevision !== null && facts.originEvidenceRevision !== undefined) {
+      if (
+        (facts.originEvidenceId === null || facts.originEvidenceId === undefined) &&
+        facts.originEvidenceRevision !== null &&
+        facts.originEvidenceRevision !== undefined
+      ) {
         throw new ProductValidationError([
           {
             code: "INVALID_FIELD_COMBINATION",
             path: ["initialFacts", "originEvidenceRevision"],
-            message: "Origin evidence linkage is not yet supported in this phase."
+            message: "originEvidenceRevision cannot be specified without originEvidenceId."
           }
         ]);
       }
+      if (facts.originEvidenceId !== null && facts.originEvidenceId !== undefined) {
+        if (!isValidUuid(facts.originEvidenceId)) {
+          throw new ProductValidationError([
+            {
+              code: "INVALID_IDENTIFIER",
+              path: ["initialFacts", "originEvidenceId"],
+              message: "originEvidenceId must be a valid UUID string."
+            }
+          ]);
+        }
+      }
+      if (facts.originEvidenceRevision !== null && facts.originEvidenceRevision !== undefined) {
+        if (!isValidPositiveInt(facts.originEvidenceRevision)) {
+          throw new ProductValidationError([
+            {
+              code: "INVALID_REVISION",
+              path: ["initialFacts", "originEvidenceRevision"],
+              message: "originEvidenceRevision must be a positive integer."
+            }
+          ]);
+        }
+      }
       if (!facts.originKind || !ALLOWED_ORIGIN_KINDS.has(facts.originKind)) {
         throw new ProductValidationError([
           {
@@ -1026,6 +1352,34 @@ export class PostgresProductEvidenceRepository implements ProductEvidenceReposit
       const idRes = await client.query<{ id: string }>("SELECT uuidv7() AS id");
       const batchId = createBatchId(idRes.rows[0]!.id);
 
+      if (
+        cmd.payload.initialFacts?.originEvidenceId != null &&
+        cmd.payload.initialFacts?.originEvidenceRevision != null
+      ) {
+        const linkRes = await client.query<{ batch_id: string }>(
+          `SELECT batch_id FROM batch_evidence_links
+           WHERE client_id = $1 AND evidence_id = $2 AND evidence_revision = $3`,
+          [
+            cmd.clientId,
+            cmd.payload.initialFacts.originEvidenceId,
+            cmd.payload.initialFacts.originEvidenceRevision
+          ]
+        );
+        if (linkRes.rows.length === 0) {
+          throw new NotFoundError(
+            "BatchEvidenceLink",
+            `${cmd.payload.initialFacts.originEvidenceId}#${cmd.payload.initialFacts.originEvidenceRevision}`
+          );
+        }
+        throw new CrossBatchSourceError(
+          `Evidence ${cmd.payload.initialFacts.originEvidenceId} revision ${cmd.payload.initialFacts.originEvidenceRevision} is linked to batch ${linkRes.rows[0]!.batch_id} but not batch ${batchId}. Explicit fresh batch evidence link is required.`,
+          {
+            sha256: cmd.payload.initialFacts.originEvidenceId,
+            existingBatchId: linkRes.rows[0]!.batch_id
+          }
+        );
+      }
+
       const creation = createProductBatch({
         parentSku,
         batchId,
@@ -1060,7 +1414,7 @@ export class PostgresProductEvidenceRepository implements ProductEvidenceReposit
           client_id, batch_id, revision, origin_kind, producer_identity_as_claimed,
           production_start_date, production_end_date, origin_evidence_id, origin_evidence_revision,
           asserted_by, asserted_at, supersedes_revision
-        ) VALUES ($1, $2, $3, $4, $5, $6, $7, NULL, NULL, $8, $9, NULL)`,
+        ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, NULL)`,
         [
           creation.initialFacts.clientId,
           creation.initialFacts.batchId,
@@ -1069,6 +1423,8 @@ export class PostgresProductEvidenceRepository implements ProductEvidenceReposit
           creation.initialFacts.producerIdentityAsClaimed,
           creation.initialFacts.productionStartDate,
           creation.initialFacts.productionEndDate,
+          creation.initialFacts.originEvidenceId,
+          creation.initialFacts.originEvidenceRevision,
           creation.initialFacts.assertedBy,
           creation.initialFacts.assertedAt
         ]
@@ -1111,16 +1467,22 @@ export class PostgresProductEvidenceRepository implements ProductEvidenceReposit
       ]);
     }
 
-    if (cmd.payload.originEvidenceId !== null && cmd.payload.originEvidenceId !== undefined) {
+    if (
+      cmd.payload.originEvidenceId !== null &&
+      cmd.payload.originEvidenceId !== undefined &&
+      (cmd.payload.originEvidenceRevision === null ||
+        cmd.payload.originEvidenceRevision === undefined)
+    ) {
       throw new ProductValidationError([
         {
           code: "INVALID_FIELD_COMBINATION",
-          path: ["originEvidenceId"],
-          message: "Origin evidence linkage is not yet supported in this phase."
+          path: ["originEvidenceRevision"],
+          message: "originEvidenceRevision must be specified when originEvidenceId is present."
         }
       ]);
     }
     if (
+      (cmd.payload.originEvidenceId === null || cmd.payload.originEvidenceId === undefined) &&
       cmd.payload.originEvidenceRevision !== null &&
       cmd.payload.originEvidenceRevision !== undefined
     ) {
@@ -1128,10 +1490,35 @@ export class PostgresProductEvidenceRepository implements ProductEvidenceReposit
         {
           code: "INVALID_FIELD_COMBINATION",
           path: ["originEvidenceRevision"],
-          message: "Origin evidence linkage is not yet supported in this phase."
+          message: "originEvidenceRevision cannot be specified without originEvidenceId."
         }
       ]);
     }
+    if (cmd.payload.originEvidenceId !== null && cmd.payload.originEvidenceId !== undefined) {
+      if (!isValidUuid(cmd.payload.originEvidenceId)) {
+        throw new ProductValidationError([
+          {
+            code: "INVALID_IDENTIFIER",
+            path: ["originEvidenceId"],
+            message: "originEvidenceId must be a valid UUID string."
+          }
+        ]);
+      }
+    }
+    if (
+      cmd.payload.originEvidenceRevision !== null &&
+      cmd.payload.originEvidenceRevision !== undefined
+    ) {
+      if (!isValidPositiveInt(cmd.payload.originEvidenceRevision)) {
+        throw new ProductValidationError([
+          {
+            code: "INVALID_REVISION",
+            path: ["originEvidenceRevision"],
+            message: "originEvidenceRevision must be a positive integer."
+          }
+        ]);
+      }
+    }
 
     if (!cmd.payload.originKind || !ALLOWED_ORIGIN_KINDS.has(cmd.payload.originKind)) {
       throw new ProductValidationError([
@@ -1260,6 +1647,91 @@ export class PostgresProductEvidenceRepository implements ProductEvidenceReposit
       }
       const previousFacts = mapRowToFacts(factsRes.rows[0]!);
 
+      if (cmd.payload.originEvidenceId != null && cmd.payload.originEvidenceRevision != null) {
+        const linkRes = await client.query<{ batch_id: string; source_object_id: string }>(
+          `SELECT l.batch_id, r.source_object_id
+           FROM batch_evidence_links l
+           JOIN evidence_revisions r
+             ON r.client_id = l.client_id AND r.evidence_id = l.evidence_id AND r.revision = l.evidence_revision
+           WHERE l.client_id = $1 AND l.evidence_id = $2 AND l.evidence_revision = $3
+           FOR SHARE OF l, r`,
+          [cmd.clientId, cmd.payload.originEvidenceId, cmd.payload.originEvidenceRevision]
+        );
+        if (linkRes.rows.length === 0) {
+          throw new NotFoundError(
+            "BatchEvidenceLink",
+            `${cmd.payload.originEvidenceId}#${cmd.payload.originEvidenceRevision}`
+          );
+        }
+        if (!linkRes.rows.some((r) => r.batch_id === cmd.payload.batchId)) {
+          throw new CrossBatchSourceError(
+            `Evidence ${cmd.payload.originEvidenceId} revision ${cmd.payload.originEvidenceRevision} is linked to batch ${linkRes.rows[0]!.batch_id} but not batch ${cmd.payload.batchId}. Explicit fresh batch evidence link is required.`,
+            {
+              sha256: cmd.payload.originEvidenceId,
+              existingBatchId: linkRes.rows[0]!.batch_id
+            }
+          );
+        }
+
+        // Check EvidenceAsset is not archived
+        const assetRes = await client.query<{ archived_at: Date | null }>(
+          `SELECT archived_at FROM evidence_assets
+           WHERE client_id = $1 AND evidence_id = $2 FOR SHARE`,
+          [cmd.clientId, cmd.payload.originEvidenceId]
+        );
+        if (assetRes.rows.length === 0) {
+          throw new NotFoundError("EvidenceAsset", cmd.payload.originEvidenceId);
+        }
+        if (assetRes.rows[0]!.archived_at !== null) {
+          throw new AccessDeniedError(
+            "Referenced evidence asset is archived.",
+            "EVIDENCE_ARCHIVED"
+          );
+        }
+
+        // Check SourceObject is available
+        const sourceRes = await client.query<{ availability: string }>(
+          `SELECT availability FROM source_objects
+           WHERE client_id = $1 AND source_object_id = $2 FOR SHARE`,
+          [cmd.clientId, linkRes.rows[0]!.source_object_id]
+        );
+        if (sourceRes.rows.length === 0) {
+          throw new NotFoundError("SourceObject", linkRes.rows[0]!.source_object_id);
+        }
+        if (sourceRes.rows[0]!.availability !== "available") {
+          throw new AccessDeniedError(
+            `Referenced source object is unavailable (${sourceRes.rows[0]!.availability}).`,
+            "SOURCE_UNAVAILABLE"
+          );
+        }
+
+        // Check for active disputes on this revision
+        const disputeRes = await client.query<{
+          event_id: string;
+          outcome: string;
+          withdrawal_event_id: string | null;
+        }>(
+          `SELECT event_id, outcome, withdrawal_event_id
+           FROM evidence_verification_events
+           WHERE client_id = $1 AND evidence_id = $2 AND evidence_revision = $3
+           ORDER BY occurred_at ASC FOR SHARE`,
+          [cmd.clientId, cmd.payload.originEvidenceId, cmd.payload.originEvidenceRevision]
+        );
+        const activeDisputes = new Set<string>();
+        for (const evt of disputeRes.rows) {
+          if (evt.outcome === "disputed" || evt.outcome === "rejected") {
+            activeDisputes.add(evt.event_id);
+          } else if (evt.outcome === "withdrawn" && evt.withdrawal_event_id) {
+            activeDisputes.delete(evt.withdrawal_event_id);
+          }
+        }
+        if (activeDisputes.size > 0) {
+          throw new ReportDisputedError(
+            `Referenced evidence revision ${cmd.payload.originEvidenceId}#${cmd.payload.originEvidenceRevision} has an active dispute or rejection and cannot be linked as batch origin.`
+          );
+        }
+      }
+
       const nextFacts = appendBatchFactsRevision(previousFacts, {
         originKind: cmd.payload.originKind,
         producerIdentityAsClaimed: cmd.payload.producerIdentityAsClaimed,
@@ -1284,7 +1756,7 @@ export class PostgresProductEvidenceRepository implements ProductEvidenceReposit
           client_id, batch_id, revision, origin_kind, producer_identity_as_claimed,
           production_start_date, production_end_date, origin_evidence_id, origin_evidence_revision,
           asserted_by, asserted_at, supersedes_revision
-        ) VALUES ($1, $2, $3, $4, $5, $6, $7, NULL, NULL, $8, $9, $10)`,
+        ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)`,
         [
           nextFacts.clientId,
           nextFacts.batchId,
@@ -1293,6 +1765,8 @@ export class PostgresProductEvidenceRepository implements ProductEvidenceReposit
           nextFacts.producerIdentityAsClaimed,
           nextFacts.productionStartDate,
           nextFacts.productionEndDate,
+          nextFacts.originEvidenceId,
+          nextFacts.originEvidenceRevision,
           nextFacts.assertedBy,
           nextFacts.assertedAt,
           nextFacts.supersedesRevision
diff --git a/packages/infrastructure/src/postgres/uow/postgres-unit-of-work.ts b/packages/infrastructure/src/postgres/uow/postgres-unit-of-work.ts
index 7a82c42..69811a4 100644
--- a/packages/infrastructure/src/postgres/uow/postgres-unit-of-work.ts
+++ b/packages/infrastructure/src/postgres/uow/postgres-unit-of-work.ts
@@ -18,6 +18,7 @@ import {
   PostgresProductEvidenceRepository,
   translateDatabaseError
 } from "../repositories/postgres-product-evidence-repository.js";
+import { PostgresEvidenceAssetRepository } from "../../evidence/postgres-evidence-asset-repository.js";
 
 export class PostgresUnitOfWork implements UnitOfWork {
   constructor(private readonly pool: Pool) {}
@@ -45,6 +46,9 @@ export class PostgresUnitOfWork implements UnitOfWork {
         campaignReferenceBible: new PostgresCampaignReferenceBibleRepository(client),
         productEvidence: new PostgresProductEvidenceRepository(client, {
           externalTransaction: true
+        }),
+        evidenceAsset: new PostgresEvidenceAssetRepository(client, {
+          externalTransaction: true
         })
       };
 
diff --git a/packages/infrastructure/src/storage/provision.integration.test.ts b/packages/infrastructure/src/storage/provision.integration.test.ts
index 6b0ffd6..85818b9 100644
--- a/packages/infrastructure/src/storage/provision.integration.test.ts
+++ b/packages/infrastructure/src/storage/provision.integration.test.ts
@@ -42,28 +42,28 @@ describe("Storage Provisioning integration with real MinIO", () => {
     }
   });
 
-  it("provisions all four buckets and is idempotent on repeat execution", async () => {
+  it("provisions all five buckets and is idempotent on repeat execution", async () => {
     // 1. Initial provisioning on clean MinIO container
     const initialSummary = await provisionStorageBuckets({
       client: rawS3Client
     });
 
-    expect(initialSummary.results).toHaveLength(4);
-    expect(initialSummary.createdCount).toBe(4);
+    expect(initialSummary.results).toHaveLength(5);
+    expect(initialSummary.createdCount).toBe(5);
     expect(initialSummary.alreadyExistsCount).toBe(0);
     expect(initialSummary.lifecycleAppliedCount).toBe(2); // temp (14d) and review (60d)
-    expect(initialSummary.lifecycleSkippedCount).toBe(2); // reference and delivery
+    expect(initialSummary.lifecycleSkippedCount).toBe(3); // reference, delivery, and evidence
 
     // 2. Second provisioning run against already provisioned buckets
     const repeatSummary = await provisionStorageBuckets({
       client: rawS3Client
     });
 
-    expect(repeatSummary.results).toHaveLength(4);
+    expect(repeatSummary.results).toHaveLength(5);
     expect(repeatSummary.createdCount).toBe(0);
-    expect(repeatSummary.alreadyExistsCount).toBe(4);
+    expect(repeatSummary.alreadyExistsCount).toBe(5);
     expect(repeatSummary.lifecycleAppliedCount).toBe(2);
-    expect(repeatSummary.lifecycleSkippedCount).toBe(2);
+    expect(repeatSummary.lifecycleSkippedCount).toBe(3);
   });
 
   it("reads back live lifecycle configurations and asserts matching rules from the bucket", async () => {
@@ -132,7 +132,7 @@ describe("Storage Provisioning integration with real MinIO", () => {
 
     // 2. Re-run provisioning
     const summary = await provisionStorageBuckets({ client: rawS3Client });
-    expect(summary.alreadyExistsCount).toBe(4);
+    expect(summary.alreadyExistsCount).toBe(5);
 
     // 3. Read back object and verify byte integrity
     const getRes = await rawS3Client.send(
diff --git a/packages/infrastructure/src/storage/provisioner.test.ts b/packages/infrastructure/src/storage/provisioner.test.ts
index 077171a..43be622 100644
--- a/packages/infrastructure/src/storage/provisioner.test.ts
+++ b/packages/infrastructure/src/storage/provisioner.test.ts
@@ -122,17 +122,17 @@ describe("Storage Provisioner unit tests", () => {
     await expect(provisionBucket(client, BUCKETS.TEMP)).rejects.toThrow("Network timeout");
   });
 
-  it("provisions all four buckets in provisionStorageBuckets and returns summary", async () => {
+  it("provisions all five buckets in provisionStorageBuckets and returns summary", async () => {
     const sendFn = vi.fn().mockResolvedValue({});
     const client = createMockS3Client(sendFn);
 
     const summary = await provisionStorageBuckets({ client });
 
-    expect(summary.results).toHaveLength(4);
-    expect(summary.createdCount).toBe(4);
+    expect(summary.results).toHaveLength(5);
+    expect(summary.createdCount).toBe(5);
     expect(summary.alreadyExistsCount).toBe(0);
     expect(summary.lifecycleAppliedCount).toBe(2); // temp and review
-    expect(summary.lifecycleSkippedCount).toBe(2); // reference and delivery
+    expect(summary.lifecycleSkippedCount).toBe(3); // reference, delivery, and evidence
   });
 
   it("provisions custom bucket subset when options.buckets is specified", async () => {
diff --git a/packages/infrastructure/src/storage/s3-object-storage.test.ts b/packages/infrastructure/src/storage/s3-object-storage.test.ts
index de34427..59cd62e 100644
--- a/packages/infrastructure/src/storage/s3-object-storage.test.ts
+++ b/packages/infrastructure/src/storage/s3-object-storage.test.ts
@@ -2,6 +2,7 @@ import { describe, expect, it } from "vitest";
 import { Readable } from "node:stream";
 import { S3ObjectStorage } from "./s3-object-storage.js";
 import { HeadObjectCommand, type S3Client } from "@aws-sdk/client-s3";
+import { StorageIntegrityViolationError } from "@cco/application";
 
 describe("S3ObjectStorage (unit)", () => {
   it("enforces maxBytes limit when ContentLength header is present and exceeds maxBytes", async () => {
@@ -29,14 +30,16 @@ describe("S3ObjectStorage (unit)", () => {
       client: fakeClient
     });
 
-    await expect(
-      storage.getObject({ bucket: "test-bucket", key: "test-key" }, { maxBytes: 50 })
-    ).rejects.toThrow(/ContentLength \(100\) exceeds maxBytes limit \(50\)/);
+    const error: unknown = await storage
+      .getObject({ bucket: "test-bucket", key: "test-key" }, { maxBytes: 50 })
+      .catch((e: unknown) => e);
+    expect(error).toBeInstanceOf(StorageIntegrityViolationError);
+    expect((error as Error).message).toMatch(/ContentLength \(100\) exceeds maxBytes limit \(50\)/);
 
     expect(streamDestroyed).toBe(true);
   });
 
-  it("enforces maxBytes limit during streaming when ContentLength is not present", async () => {
+  it("enforces maxBytes limit during streaming when ContentLength is not present (observed bytes exceed the limit, not just the header)", async () => {
     let streamDestroyed = false;
     const fakeStream = new Readable({
       read() {
@@ -61,13 +64,37 @@ describe("S3ObjectStorage (unit)", () => {
       client: fakeClient
     });
 
-    await expect(
-      storage.getObject({ bucket: "test-bucket", key: "test-key" }, { maxBytes: 10 })
-    ).rejects.toThrow(/exceeds maxBytes limit \(10\)/);
+    const error: unknown = await storage
+      .getObject({ bucket: "test-bucket", key: "test-key" }, { maxBytes: 10 })
+      .catch((e: unknown) => e);
+    expect(error).toBeInstanceOf(StorageIntegrityViolationError);
+    expect((error as Error).message).toMatch(/exceeds maxBytes limit \(10\)/);
 
     expect(streamDestroyed).toBe(true);
   });
 
+  it("enforces maxBytes limit on a transformToByteArray body when observed bytes exceed the limit (ContentLength omitted or under-reported)", async () => {
+    const fakeClient = {
+      send: async () => ({
+        ContentLength: undefined,
+        Body: {
+          transformToByteArray: async () => new Uint8Array(20) // 20 bytes
+        }
+      })
+    } as unknown as S3Client;
+
+    const storage = new S3ObjectStorage({
+      endpoint: "http://localhost:9000",
+      client: fakeClient
+    });
+
+    const error: unknown = await storage
+      .getObject({ bucket: "test-bucket", key: "test-key" }, { maxBytes: 10 })
+      .catch((e: unknown) => e);
+    expect(error).toBeInstanceOf(StorageIntegrityViolationError);
+    expect((error as Error).message).toMatch(/byteLength \(20\) exceeds maxBytes limit \(10\)/);
+  });
+
   it("successfully retrieves stream when within maxBytes limit", async () => {
     const payload = Buffer.from("hello world");
     const fakeStream = new Readable({
diff --git a/packages/infrastructure/src/storage/s3-object-storage.ts b/packages/infrastructure/src/storage/s3-object-storage.ts
index 5f4d0a6..0ffe86d 100644
--- a/packages/infrastructure/src/storage/s3-object-storage.ts
+++ b/packages/infrastructure/src/storage/s3-object-storage.ts
@@ -15,6 +15,7 @@ import {
   type ObjectLocator,
   type ObjectStoragePort,
   ObjectAlreadyExistsError,
+  StorageIntegrityViolationError,
   type PutObjectInput,
   type StoredObject
 } from "@cco/application";
@@ -125,8 +126,10 @@ async function readBodyWithLimit(
               // ignore destroy errors
             }
           }
-          throw new Error(
-            `Object ${locator.bucket}/${locator.key} byteLength (${totalBytes}) exceeds maxBytes limit (${maxBytes})`
+          throw new StorageIntegrityViolationError(
+            `Object ${locator.bucket}/${locator.key} byteLength (${totalBytes}) exceeds maxBytes limit (${maxBytes})`,
+            locator.bucket,
+            locator.key
           );
         }
         chunks.push(chunk);
@@ -234,8 +237,10 @@ async function readBodyWithLimit(
     }
 
     if (maxBytes !== undefined && bytes.byteLength > maxBytes) {
-      throw new Error(
-        `Object ${locator.bucket}/${locator.key} byteLength (${bytes.byteLength}) exceeds maxBytes limit (${maxBytes})`
+      throw new StorageIntegrityViolationError(
+        `Object ${locator.bucket}/${locator.key} byteLength (${bytes.byteLength}) exceeds maxBytes limit (${maxBytes})`,
+        locator.bucket,
+        locator.key
       );
     }
     return bytes;
@@ -365,8 +370,10 @@ export class S3ObjectStorage implements ObjectStoragePort {
           // ignore destroy errors
         }
       }
-      throw new Error(
-        `Object ${locator.bucket}/${locator.key} ContentLength (${response.ContentLength}) exceeds maxBytes limit (${options.maxBytes})`
+      throw new StorageIntegrityViolationError(
+        `Object ${locator.bucket}/${locator.key} ContentLength (${response.ContentLength}) exceeds maxBytes limit (${options.maxBytes})`,
+        locator.bucket,
+        locator.key
       );
     }
 
@@ -381,8 +388,10 @@ export class S3ObjectStorage implements ObjectStoragePort {
     if (storedChecksum !== undefined) {
       const computed = computeSha256Hex(body);
       if (computed !== storedChecksum) {
-        throw new Error(
-          `Checksum mismatch on getObject for ${locator.bucket}/${locator.key}: stored checksum ${storedChecksum}, calculated ${computed}`
+        throw new StorageIntegrityViolationError(
+          `Checksum mismatch on getObject for ${locator.bucket}/${locator.key}: stored checksum ${storedChecksum}, calculated ${computed}`,
+          locator.bucket,
+          locator.key
         );
       }
     }
diff --git a/packages/infrastructure/src/telemetry/storage-telemetry-adapter.test.ts b/packages/infrastructure/src/telemetry/storage-telemetry-adapter.test.ts
index 01db717..d0d5b3d 100644
--- a/packages/infrastructure/src/telemetry/storage-telemetry-adapter.test.ts
+++ b/packages/infrastructure/src/telemetry/storage-telemetry-adapter.test.ts
@@ -92,7 +92,8 @@ describe("HostFsStorageTelemetryAdapter", () => {
       "godzspeed-temp",
       "godzspeed-review",
       "godzspeed-reference",
-      "godzspeed-delivery"
+      "godzspeed-delivery",
+      "godzspeed-evidence"
     ]);
     expect(telemetry.buckets.every((b) => b.usedBytes === 0)).toBe(true);
   });
diff --git a/packages/shared/src/buckets.test.ts b/packages/shared/src/buckets.test.ts
index 118ff34..bfcece3 100644
--- a/packages/shared/src/buckets.test.ts
+++ b/packages/shared/src/buckets.test.ts
@@ -8,23 +8,27 @@ import {
 } from "./index.js";
 
 describe("bucket class constants and retention policies", () => {
-  it("defines the four PRD bucket class constants", () => {
+  it("defines the PRD bucket class constants including evidence archive", () => {
     expect(BUCKET_NAMES).toEqual([
       "godzspeed-temp",
       "godzspeed-review",
       "godzspeed-reference",
-      "godzspeed-delivery"
+      "godzspeed-delivery",
+      "godzspeed-evidence"
     ]);
 
     expect(BUCKETS.TEMP).toBe("godzspeed-temp");
     expect(BUCKETS.REVIEW).toBe("godzspeed-review");
     expect(BUCKETS.REFERENCE).toBe("godzspeed-reference");
     expect(BUCKETS.DELIVERY).toBe("godzspeed-delivery");
+    expect(BUCKETS.EVIDENCE).toBe("godzspeed-evidence");
   });
 
   it("type checks bucket names against union", () => {
     const validBucket: BucketName = BUCKETS.TEMP;
     expect(BUCKET_NAMES.includes(validBucket)).toBe(true);
+    const evidenceBucket: BucketName = BUCKETS.EVIDENCE;
+    expect(BUCKET_NAMES.includes(evidenceBucket)).toBe(true);
   });
 
   it("defines 14-day automated expiry for godzspeed-temp", () => {
@@ -76,4 +80,15 @@ describe("bucket class constants and retention policies", () => {
     const deliveryLifecycle = BUCKET_LIFECYCLE_DEFINITIONS["godzspeed-delivery"];
     expect(deliveryLifecycle).toBeUndefined();
   });
+
+  it("defines no automated expiry for godzspeed-evidence (source archive)", () => {
+    const evidencePolicy = BUCKET_RETENTION_POLICIES["godzspeed-evidence"];
+    expect(evidencePolicy).toBeDefined();
+    expect(evidencePolicy.bucket).toBe("godzspeed-evidence");
+    expect(evidencePolicy.defaultRetentionDays).toBeUndefined();
+    expect(evidencePolicy.isAutomatedExpiry).toBe(false);
+
+    const evidenceLifecycle = BUCKET_LIFECYCLE_DEFINITIONS["godzspeed-evidence"];
+    expect(evidenceLifecycle).toBeUndefined();
+  });
 });
diff --git a/packages/shared/src/buckets.ts b/packages/shared/src/buckets.ts
index 825fe6c..2f61997 100644
--- a/packages/shared/src/buckets.ts
+++ b/packages/shared/src/buckets.ts
@@ -5,7 +5,8 @@ export const BUCKET_NAMES = [
   "godzspeed-temp",
   "godzspeed-review",
   "godzspeed-reference",
-  "godzspeed-delivery"
+  "godzspeed-delivery",
+  "godzspeed-evidence"
 ] as const;
 
 export type BucketName = (typeof BUCKET_NAMES)[number];
@@ -14,7 +15,8 @@ export const BUCKETS = {
   TEMP: "godzspeed-temp",
   REVIEW: "godzspeed-review",
   REFERENCE: "godzspeed-reference",
-  DELIVERY: "godzspeed-delivery"
+  DELIVERY: "godzspeed-delivery",
+  EVIDENCE: "godzspeed-evidence"
 } as const;
 
 export interface BucketRetentionPolicy {
@@ -56,6 +58,12 @@ export const BUCKET_RETENTION_POLICIES: Readonly<Record<BucketName, BucketRetent
       description:
         "approved delivery copies awaiting client handoff (retained 90 days after campaign completion)",
       isAutomatedExpiry: false
+    },
+    "godzspeed-evidence": {
+      bucket: "godzspeed-evidence",
+      description:
+        "immutable source evidence archive (retained indefinitely under regulatory hold; no automated expiry)",
+      isAutomatedExpiry: false
     }
   });
 
@@ -75,5 +83,6 @@ export const BUCKET_LIFECYCLE_DEFINITIONS: Readonly<
     prefix: ""
   },
   "godzspeed-reference": undefined,
-  "godzspeed-delivery": undefined
+  "godzspeed-delivery": undefined,
+  "godzspeed-evidence": undefined
 });
diff --git a/packages/shared/src/product-identity.test.ts b/packages/shared/src/product-identity.test.ts
index acc95c9..9787596 100644
--- a/packages/shared/src/product-identity.test.ts
+++ b/packages/shared/src/product-identity.test.ts
@@ -3,6 +3,7 @@ import {
   canonicalizeUtcTimestamp,
   compareDateOnly,
   compareUtcTimestamps,
+  generateUuidV7,
   hasControlOrInvisibleChars,
   isValidCalendarDate,
   isValidCanonicalSku,
@@ -12,6 +13,7 @@ import {
   isValidLotIdentifier,
   isValidPositiveInt,
   isValidUuid,
+  isValidUuidV7,
   MAX_POSITIVE_INT,
   MIN_POSITIVE_INT,
   normalizeAssertedBy,
@@ -51,6 +53,13 @@ describe("product-identity lexical functions", () => {
       expect(isValidUuid("")).toBe(false);
       expect(isValidUuid(null)).toBe(false);
     });
+
+    it("generates and validates RFC 9562 UUIDv7", () => {
+      const v7 = generateUuidV7();
+      expect(isValidUuid(v7)).toBe(true);
+      expect(isValidUuidV7(v7)).toBe(true);
+      expect(isValidUuidV7("018f0000-0000-4000-8000-000000000001")).toBe(false); // v4 is not v7
+    });
   });
 
   describe("canonicalSku normalization and validation", () => {
diff --git a/packages/shared/src/product-identity.ts b/packages/shared/src/product-identity.ts
index 6644efb..12cab4c 100644
--- a/packages/shared/src/product-identity.ts
+++ b/packages/shared/src/product-identity.ts
@@ -10,8 +10,11 @@ export const MAX_POSITIVE_INT = 2_147_483_647; // PostgreSQL 32-bit signed INT m
 
 export const CANONICAL_SKU_REGEX = /^[A-Z0-9_-]{3,64}$/;
 export const LOT_IDENTIFIER_REGEX = /^[A-Za-z0-9_.-]{1,128}$/;
+export const SHA256_HEX_REGEX = /^[0-9a-f]{64}$/;
 export const UUID_REGEX =
   /^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[1-8][0-9a-fA-F]{3}-[89abAB][0-9a-fA-F]{3}-[0-9a-fA-F]{12}$/;
+export const UUID_V7_REGEX =
+  /^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-7[0-9a-fA-F]{3}-[89abAB][0-9a-fA-F]{3}-[0-9a-fA-F]{12}$/;
 export const DATE_ONLY_REGEX = /^(\d{4})-(\d{2})-(\d{2})$/;
 export const ISO_UTC_TIMESTAMP_REGEX =
   /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})(?:\.(\d{1,3}))?Z$/;
@@ -19,6 +22,77 @@ export const ISO_UTC_TIMESTAMP_REGEX =
 export const BATCH_ORIGIN_KINDS = ["own_production", "partner_origin", "unknown"] as const;
 export type BatchOriginKind = (typeof BATCH_ORIGIN_KINDS)[number];
 
+export const EVIDENCE_SOURCE_CLASSES = [
+  "photo",
+  "video",
+  "raw",
+  "document",
+  "coa",
+  "process_record"
+] as const;
+export type EvidenceSourceClass = (typeof EVIDENCE_SOURCE_CLASSES)[number];
+
+export const EVIDENCE_ACQUISITION_METHODS = [
+  "direct_upload",
+  "supplier_submission",
+  "field_capture",
+  "lab_transfer"
+] as const;
+export type EvidenceAcquisitionMethod = (typeof EVIDENCE_ACQUISITION_METHODS)[number];
+
+export const LEGAL_RIGHTS_STATUSES = ["unknown", "granted", "restricted", "denied"] as const;
+export type LegalRightsStatus = (typeof LEGAL_RIGHTS_STATUSES)[number];
+
+export const CONSENT_STATUSES = ["unknown", "granted", "restricted", "denied"] as const;
+export type ConsentStatus = (typeof CONSENT_STATUSES)[number];
+
+export const BATCH_EVIDENCE_PURPOSES = [
+  "macro_hero_photo",
+  "coa_test_report",
+  "cultivation_log",
+  "processing_record",
+  "packaging_spec",
+  "general_supporting_evidence"
+] as const;
+export type BatchEvidencePurpose = (typeof BATCH_EVIDENCE_PURPOSES)[number];
+
+export const VERIFICATION_OUTCOMES = ["verified", "rejected", "disputed", "withdrawn"] as const;
+export type VerificationOutcome = (typeof VERIFICATION_OUTCOMES)[number];
+
+export const VERIFICATION_KINDS = [
+  "submitter_attestation",
+  "human_internal_review",
+  "independent_third_party_corroboration"
+] as const;
+export type VerificationKind = (typeof VERIFICATION_KINDS)[number];
+
+export const VERIFICATION_FACT_SCOPES = [
+  "provenance_metadata",
+  "capture_circumstances",
+  "lab_identity",
+  "chain_of_custody",
+  "full_document_authenticity"
+] as const;
+export type VerificationFactScope = (typeof VERIFICATION_FACT_SCOPES)[number];
+
+export const SOURCE_OBJECT_AVAILABILITIES = [
+  "available",
+  "archived",
+  "quarantined",
+  "deleted_under_retention"
+] as const;
+export type SourceObjectAvailability = (typeof SOURCE_OBJECT_AVAILABILITIES)[number];
+
+export const EVIDENCE_REGISTRATION_INTENTS = [
+  "initial_assertion",
+  "new_batch_assertion",
+  "supersede"
+] as const;
+export type EvidenceRegistrationIntent = (typeof EVIDENCE_REGISTRATION_INTENTS)[number];
+
+export const REPORTED_CAPTURE_PRECISIONS = ["date", "minute", "second", "millisecond"] as const;
+export type ReportedCapturePrecision = (typeof REPORTED_CAPTURE_PRECISIONS)[number];
+
 export const PRODUCT_EVIDENCE_ERROR_CODES = [
   "NOT_FOUND",
   "CROSS_CLIENT_VIOLATION",
@@ -81,6 +155,42 @@ export function isValidUuid(val: unknown): val is string {
   return UUID_REGEX.test(val);
 }
 
+/**
+ * Validates whether a value is an RFC 9562 UUIDv7 string.
+ */
+export function isValidUuidV7(val: unknown): val is string {
+  if (typeof val !== "string") {
+    return false;
+  }
+  return UUID_V7_REGEX.test(val);
+}
+
+/**
+ * Generates an RFC 9562 UUIDv7 string using globalThis.crypto and current time.
+ */
+export function generateUuidV7(): string {
+  const bytes = new Uint8Array(16);
+  globalThis.crypto.getRandomValues(bytes);
+  const now = Date.now();
+  // 48-bit timestamp
+  bytes[0] = Math.floor(now / 0x10000000000) & 0xff;
+  bytes[1] = Math.floor(now / 0x100000000) & 0xff;
+  bytes[2] = Math.floor(now / 0x1000000) & 0xff;
+  bytes[3] = Math.floor(now / 0x10000) & 0xff;
+  bytes[4] = Math.floor(now / 0x100) & 0xff;
+  bytes[5] = now & 0xff;
+  // version 7: 0111xxxx
+  bytes[6] = (bytes[6]! & 0x0f) | 0x70;
+  // variant 10xx: 10xxxxxx
+  bytes[8] = (bytes[8]! & 0x3f) | 0x80;
+
+  const hex: string[] = [];
+  for (let i = 0; i < 16; i++) {
+    hex.push(bytes[i]!.toString(16).padStart(2, "0"));
+  }
+  return `${hex.slice(0, 4).join("")}-${hex.slice(4, 6).join("")}-${hex.slice(6, 8).join("")}-${hex.slice(8, 10).join("")}-${hex.slice(10, 16).join("")}`;
+}
+
 /**
  * Normalizes a UUID string by verifying its format and converting to lowercase hex.
  * Throws a lexical error if invalid or if leading/trailing whitespace is present.
@@ -346,3 +456,52 @@ export function normalizeAssertedBy(val: unknown, fieldName = "assertedBy"): str
   }
   return trimmed;
 }
+
+/**
+ * Validates and normalizes lowercase 64-hex SHA-256 digest string:
+ * - Must be lowercase 64 hex characters (0-9, a-f).
+ * - Rejects surrounding whitespace without silent trimming.
+ */
+export function normalizeSha256Hex(val: unknown, fieldName = "sha256"): string {
+  if (typeof val !== "string" || !SHA256_HEX_REGEX.test(val)) {
+    throw new Error(
+      `${fieldName} must be a lowercase 64-hex SHA-256 digest string without surrounding whitespace.`
+    );
+  }
+  return val;
+}
+
+export function isValidSha256Hex(val: unknown): val is string {
+  return typeof val === "string" && SHA256_HEX_REGEX.test(val);
+}
+
+/**
+ * Normalizes assertionText:
+ * - Non-empty trimmed Unicode text (1–4000 code points).
+ * - Rejects C0/C1 control and invisible formatting characters.
+ */
+export function normalizeAssertionText(val: unknown, fieldName = "assertionText"): string {
+  if (typeof val !== "string") {
+    throw new Error(`${fieldName} must be a string`);
+  }
+  if (hasControlOrInvisibleChars(val)) {
+    throw new Error(`${fieldName} contains illegal control or invisible formatting characters`);
+  }
+  const trimmed = val.trim();
+  const codePoints = Array.from(trimmed);
+  if (codePoints.length < 1 || codePoints.length > 4000) {
+    throw new Error(
+      `${fieldName} must be between 1 and 4000 Unicode code points (found ${codePoints.length})`
+    );
+  }
+  return trimmed;
+}
+
+export function isValidAssertionText(val: unknown): val is string {
+  try {
+    normalizeAssertionText(val);
+    return true;
+  } catch {
+    return false;
+  }
+}
diff --git a/pnpm-lock.yaml b/pnpm-lock.yaml
index d009743..9aef8ef 100644
--- a/pnpm-lock.yaml
+++ b/pnpm-lock.yaml
@@ -249,6 +249,9 @@ importers:
       kokoro-js:
         specifier: ^1.2.1
         version: 1.2.1
+      pdf-lib:
+        specifier: 1.17.1
+        version: 1.17.1
       pg:
         specifier: ^8.13.1
         version: 8.23.0
@@ -1186,6 +1189,12 @@ packages:
     resolution: {integrity: sha512-X5XaVWZIBCT7HHZGm5I7ZQXDwLG+bGXuSrMQAW+7Zvl87h1kmc1ZB1VSRJcpUfoUrGQp4Fkoxm5kZ+Ms+aW+eA==}
     engines: {node: '>= 20.19.0'}
 
+  '@pdf-lib/standard-fonts@1.0.0':
+    resolution: {integrity: sha512-hU30BK9IUN/su0Mn9VdlVKsWBS6GyhVfqjwl1FjZN4TxP6cCw0jP2w7V3Hf5uX7M0AZJ16vey9yE0ny7Sa59ZA==}
+
+  '@pdf-lib/upng@1.0.1':
+    resolution: {integrity: sha512-dQK2FUMQtowVP00mtIksrlZhdFXQZPC+taih1q4CvPZ5vqdxR/LKBaFg0oAfzd1GlHZXXSPdQfzQnt+ViGvEIQ==}
+
   '@pinojs/redact@0.4.0':
     resolution: {integrity: sha512-k2ENnmBugE/rzQfEcdWHcCY+/FM3VLzH9cYEsbdsoqrvzAKRhUZeRNhAZvB8OitQJ1TBed3yqWtdjzS6wJKBwg==}
 
@@ -2500,6 +2509,9 @@ packages:
   package-json-from-dist@1.0.1:
     resolution: {integrity: sha512-UEZIS3/by4OC8vL3P2dTXRETpebLI2NiI5vIrjaD/5UtrkFX/tNbwjTSRAGC/+7CAo2pIcBaRgWmcBBHcsaCIw==}
 
+  pako@1.0.11:
+    resolution: {integrity: sha512-4hLB8Py4zZce5s4yd9XzopqwVv/yGNhV1Bl8NTmCq1763HeK2+EwVTv+leGeL13Dnh2wfbqowVPXCIO0z4taYw==}
+
   parent-module@1.0.1:
     resolution: {integrity: sha512-GQ2EWRpQV8/o+Aw8YqtfZZPfNRWZYkbidE9k5rpl/hC3vtHHBfGm2Ifi6qWV+coDGkrUKZAxE3Lot5kcsRlh+g==}
     engines: {node: '>=6'}
@@ -2529,6 +2541,9 @@ packages:
     resolution: {integrity: sha512-//nshmD55c46FuFw26xV/xFAaB5HF9Xdap7HJBBnrKdAd6/GxDBaNA1870O79+9ueg61cZLSVc+OaFlfmObYVQ==}
     engines: {node: '>= 14.16'}
 
+  pdf-lib@1.17.1:
+    resolution: {integrity: sha512-V/mpyJAoTsN4cnP31vc0wfNA1+p20evqqnap0KLoRUN0Yk/p3wN52DOEsL4oBFcLdb76hlpKPtzJIgo67j/XLw==}
+
   pg-cloudflare@1.4.0:
     resolution: {integrity: sha512-Vo7z/6rrQYxpNRylp4Tlob2elzbh+N/MOQbxFVWCxS7oEx6jF53GTJFxK2WWpKuBRkmiin4Mt+xofFDjx09R0A==}
 
@@ -3038,6 +3053,9 @@ packages:
     resolution: {integrity: sha512-NoZ4roiN7LnbKn9QqE1amc9DJfzvZXxF4xDavcOWt1BPkdx+m+0gJuPM+S0vCe7zTJMYUP0R8pO2XMr+Y8oLIg==}
     engines: {node: '>=6'}
 
+  tslib@1.14.1:
+    resolution: {integrity: sha512-Xni35NKzjgMrwevysHTCArtLDpPvye8zV/0E4EyYn43P7/7qvQwPh9BGkHewbMulVntbigmcT7rdX3BNo9wRJg==}
+
   tslib@2.8.1:
     resolution: {integrity: sha512-oJFu94HQb+KVduSUQL7wnpmqnfmLsOA/nAh6b6EH0wCEoK0/mPeXU6c3wKDV83MkOuHPRHtSXKKU99IBazS/2w==}
 
@@ -3971,6 +3989,14 @@ snapshots:
 
   '@noble/hashes@2.4.0': {}
 
+  '@pdf-lib/standard-fonts@1.0.0':
+    dependencies:
+      pako: 1.0.11
+
+  '@pdf-lib/upng@1.0.1':
+    dependencies:
+      pako: 1.0.11
+
   '@pinojs/redact@0.4.0': {}
 
   '@pkgjs/parseargs@0.11.0':
@@ -5373,6 +5399,8 @@ snapshots:
 
   package-json-from-dist@1.0.1: {}
 
+  pako@1.0.11: {}
+
   parent-module@1.0.1:
     dependencies:
       callsites: 3.1.0
@@ -5396,6 +5424,13 @@ snapshots:
 
   pathval@2.0.1: {}
 
+  pdf-lib@1.17.1:
+    dependencies:
+      '@pdf-lib/standard-fonts': 1.0.0
+      '@pdf-lib/upng': 1.0.1
+      pako: 1.0.11
+      tslib: 1.14.1
+
   pg-cloudflare@1.4.0:
     optional: true
 
@@ -5989,6 +6024,8 @@ snapshots:
       minimist: 1.2.8
       strip-bom: 3.0.0
 
+  tslib@1.14.1: {}
+
   tslib@2.8.1: {}
 
   tsx@4.23.12:
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
- **Failure category:** missing_artifact
- **Required artifact path:** ./follow-up-review-result.json
- **Diagnostic detail:**
```
Required result artifact 'follow-up-review-result.json' was not created (contract violation: missing_required_artifact)
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
