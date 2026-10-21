You are performing a follow-up review of code changes made in response to earlier review findings.

## CONTEXT

## WORKSPACE CONSTRAINTS

Your working directory is a dedicated git worktree with the repository's complete history. Run all commands from it. Do NOT cd to or read paths outside this directory — external-directory access is automatically rejected. git log, git diff, etc. work here directly.

.ai-orchestrator.local.json, if one exists, lives only in the main checkout and is intentionally not copied into your worktree — it is operator-machine-specific and not part of your task. Do not search for it or read it outside this directory. Reason about configuration using only .ai-orchestrator.json in your own working directory; treat it as the effective config for your task.

Working directory: /home/gary/.openclaw/workspace/comfy-content-orchestrator/.ai-worktrees/issue-474
Issue number: 474

Issue description & acceptance criteria:
# [469 / VPM-P1.5] Add source-backed CoA reports and typed measurements per batch

Parent: #469 — Phase 1
Depends on: **#470** (ADR), **#472** (batch persistence), **#473** (EvidenceAsset registration).
Classification: **Autonomous application/database coding**; **no OCR or model-extracted factual authority**.

## Goal
Represent a laboratory report as a linked, immutable source of batch-specific data. Allow a human operator to transcribe/enter typed analytical values with exact units and explicit sample/report scope; the original CoA report remains attached as evidence.

## Scope
- `CoaReport` entity/repository and migration(s): clientId, batchId, source EvidenceAsset (original PDF/image), reported laboratory identity, report ID, date, sample ID/scope, source revision, review status, recorder identity/timestamps and supersession lineage. These are *reported facts* until verified/approved by reviewer; attaching a file alone does not confer validation.
- `CoaMeasurement` type: parameter/analyte code, exact decimal value (no float), explicit unit, basis/context (e.g., mass fraction vs percentage vs concentration), optional uncertainty/LOD/LOQ/qualifiers and reported method where applicable. Follow #470 typed contract rather than inventing a cannabis-only hardcoded panel.
- Enforce unique identity and report source linkage within same client and batch. CoA must be specific enough to associate sample with batch; if it is not, allow a **draft/incomplete** report but fail closed for downstream supported numerical claims.
- Permit multiple historical reports for same batch, revisions and supersession; never silently take 'latest' to overwrite pinned measurement/source identity.
- Strict invariants for invalid percent ranges, unit-basis mismatch, nonsensical dates, missing analyte, duplicate parameter with ambiguous context, negative values absent explicit analytical qualifier; exact precision preserved in storage and API mapping.
- No general unit conversion at claim/publish time unless an explicitly tested conversion rule exists, and no percent recalculation based on uncertain contexts.
- Repository/transaction tests, version fences, audit/grants and cross-client checks. Reuse EvidenceAsset source verification and storage rather than second CoA upload code.

## Acceptance
- An approved-looking numeric value **without a linked source report** cannot become a release-eligible fact.
- Mixed units, missing units, ambiguous report/sample-to-batch scope, cross-client reports and archived/superseded sources fail supported-fact resolution.
- Multiple batches of same SKU with different terpene values do not bleed across lots.
- CoA report can be corrected by creating a new revision while the original source/old measurements remain auditable.
- Precision test uses decimal-string storage and roundtrips; no IEEE-754 coercion in authoritative record path.
- Synthetic report fixtures only; application and Postgres integration tests complete without real client CoAs.
- Operational instructions distinguish manual entry from independent lab authenticity assessment.

## Non-goals
CoA OCR/LLM parsing, external lab APIs, medical/efficacy claims, GPU or I2V changes, marketing overlays, automatic CoA verification, legal review.

## Execution
Read PRD, CONTEXT, Phase 1 ADR and `EvidenceAsset` work; one issue per orchestration Run.


Issue comments:


Design document:
# Source-backed CoA reports and exact analytical measurements — issue #474

## Goal and authority

Implement batch-specific, source-linked laboratory report records and manually entered analytical measurements. A stored value is a reported laboratory assertion. File registration, byte integrity, transcription review, independent laboratory authentication, and commercial claim approval remain separate authorities. This issue provides a checked source-support boundary; it does not grant release eligibility or implement claim publication.

Requirements are the supplied issue #474, with ADR 0009 (#470), docs/CONTEXT.md, and docs/verified-product-evidence-contract-fixtures.md supplying the anchored contracts. The general docs/prd.md describes the production platform and visual authority; the product evidence details live in ADR 0009 and CONTEXT. No root CONTEXT.md exists. Dependencies #472 and #473 are present in this checkout (commits 04367d7 and 2604c3c); no dependency work needs to be recreated.

## Repository evidence and constraints

- packages/infrastructure/migrations/026_product_registry.sql establishes SKU/batch heads, append-only facts, command receipts, deferred head/revision FKs, version guards and least-privilege grants. Migration 027_evidence_authority.sql adds original source objects, EvidenceAssets/revisions, exact batch links and verification events. Add the next migration, provisionally 028_coa_reports.sql; never rewrite applied migrations.
- packages/domain/src/evidence-asset.ts contains evidence entities and evaluateEvidenceEligibility. Its eligibility predicate rejects archive/quarantine/deletion and active disputes/rejections, but does not compare a requested revision to the current evidence head. Its lack of a dispute is not affirmative authenticity verification.
- packages/application/src/ports/product-evidence-repository.ts owns the trusted CommandEnvelope and product-only repository. EvidenceAssetRepositoryPort is a separate port. Preserve this split by adding CoaReportRepositoryPort rather than filling the product registry adapter with unrelated report methods.
- packages/infrastructure/src/evidence/postgres-evidence-asset-repository.ts already supports source-backed registration, same-client/batch checks, supersession, verification events, receipt replay and transaction-only mutations. Reuse original evidence and verification infrastructure; do not introduce another upload or storage policy.
- packages/application/src/ports/unit-of-work.ts and packages/infrastructure/src/postgres/uow/postgres-unit-of-work.ts expose repositories sharing a single transaction. CoA writes and resolution must use that transaction client, including deferred-constraint error translation at COMMIT.
- Existing product registry and evidence registration integration tests provide PostgreSQL 18 Testcontainers, synthetic source registration, replay, rollback and concurrent-version patterns. vitest.integration.config.ts includes infrastructure integration tests outside the postgres subdirectory too. The default config excludes all integration tests.
- The checkout has no CoA/decimal implementation despite the contracts described in the ADR. Implement the required slice locally, following the existing identifier, shared lexical helper, domain factory, Zod DTO, serializer and package export conventions. Layer direction is enforced by pnpm boundaries.

## Requirements

R1. Every report revision pins one client, batch and original EvidenceRevision; each measurement pins its report revision and inherits identical source lineage. No standalone measurement creation or SKU-level fallback.

R2. Reports are immutable revisions behind version-fenced heads; corrections preserve original bytes, old metadata, measurement IDs, review decisions and command receipts. Multiple independent historical reports per batch are allowed. Numerical callers provide explicit report revision and measurement IDs, never a latest-report selector.

R3. Typed decimal-string results preserve spelling and precision throughout request validation, domain values, SQL parameters/storage, reads, serializers and receipt replay. Units, analytical basis and context are explicit; ambiguous units or contexts cannot support numerical facts.

R4. Drafts may retain incomplete report/sample metadata but never bypass measurement validity or source/tenant linkage. Completion and review are separate, and no upload or transcription command self-approves.

R5. Enforce percent/fraction bounds, compatible analytical dimensions, real/ordered dates, nonblank analytes, unambiguous parameter contexts, explicit qualifications for reported negative values, and consistent limits/uncertainty.

R6. Fail source-support resolution closed for missing reports, wrong tenants/lots, incomplete association, unreviewed/rejected reports, wrong requested context/unit, superseded revisions, archived dependencies, unavailable originals, or active source disputes/rejections. A successful result is a source-supported candidate for a future claim policy, never a release authorization.

R7. Cover application workflows, exact serialization, relational integrity, immutable audit/grants, concurrency and transaction rollback with synthetic fixtures only. Document manual transcription separately from independent authenticity assessment.

## Key technical decisions

KTD1. Preserve the ADR result union and exact text storage (R1, R3).

Add branded CoaReportId, CoaMeasurementId and DecimalString, immutable CoaReport/CoaReportRevision/CoaMeasurement values, and factories/rehydration. Decimal input uses the ADR grammar: optional minus, a zero or nonzero-leading integer, and optional fractional digits. Reject numbers, exponent notation, NaN/Infinity, commas and whitespace rather than coercing them. Store values, limits, LOD, LOQ and absolute uncertainty as TEXT with matching lexical constraints. Keep trailing zeros, including in command hashes and receipts. Exact comparisons use sign/integer/fraction string comparison or BigInt-based decimal comparison; no Number, parseFloat, floating SQL types or global pg parser changes. SQL exact comparisons may use guarded NUMERIC casts solely for validation, without replacing stored text or applying a fixed precision/scale.

Retain quantified(value), below_limit(limit, lt/lte), and not_detected with mutually exclusive payloads. Add optional absolute uncertainty, detectionLimit, quantificationLimit, and reported qualifier code/text; all decimal metadata uses the same unit/basis/context as the result. LOD/LOQ and uncertainty are nonnegative; when both limits exist LOD <= LOQ. A below-limit threshold must be positive. Not-detected has no quantified value, but may retain LOD/LOQ metadata. Neither nonquantified variant is numerical zero. A negative quantified value requires an explicit negative_as_reported analytical qualifier and nonblank explanation; it remains ineligible for numerical support until a specific policy exists. Qualifiers never excuse invalid percent/fraction ranges. Method is optional/null when absent from the source, and nonblank when supplied.

KTD2. Generic parameters with explicit, tested unit semantics (R3, R5, R6).

Use open analyte/parameter codes, not a fixed cannabis panel. Preserve ADR unit, basis and context fields. Add an explicit quantityKind to disambiguate mass fraction, volume fraction, mass concentration and other reported quantities; dry_weight/as_received remain specimen bases, not dimensions. Provide a small shared compatibility rule set mirrored by database constraints for supported tuples, initially percent_w_w + mass_fraction, mg_per_g + mass_fraction, and mg_per_l + mass_concentration with explicit specimen basis/context. Percent mass/volume fractions have exact 0..100 bounds; normalized fractions have 0..1 bounds. Do not infer whether bare percent or ppm denotes a mass fraction, volume fraction or concentration.

Known contradictory combinations are rejected at ingestion in every report state. Nonblank unfamiliar units/quantity kinds may be retained as reported data, but the source-support resolver denies unrecognized combinations. A report may legitimately contain different units for different analytes. A requested numerical set with mixed/incompatible units or contexts fails atomically; do not reject a valid heterogeneous laboratory panel merely because its rows use different units. There are no conversion rules in this slice, including mg_per_g-to-percent or cannabinoid total recalculation. Future conversions need explicit independent tests and provenance.

Reject repeated analyte + basis + context within a report revision, even when units or methods differ: that would otherwise create competing values for an unspecified parameter context. Legitimate replicates require an explicit distinguishing context. Check the normalized key in factories and a composite unique constraint in SQL. Preserve reported value spelling and case-sensitive parameter codes; trim descriptive fields consistently and reject control characters.

KTD3. Incomplete reports are explicit, with revision-specific review (R2, R4, R6).

Add completeness draft/complete independently of review status. A draft still requires batchId and an exact linked source; report identifier/date, laboratory/sample identity and scope may be null, never fabricated sentinel strings. Valid supplied dates and measurements remain mandatory. Complete revisions require nonblank claimed report/lab/sample identities, report date, scope description, a nonempty panel and explicit sample-to-batch association attestation. Store association confirmation and explanation separately from assigning a batch FK: an operator's batch selection alone is not proof that the document identifies that batch.

Keep scopeKind sample_only or attributed_lot, nullable only on a draft. sample_only can support a statement limited to the explicitly associated tested sample; it cannot support a universal lot statement. attributed_lot needs a documented sampling method plus explicit reviewer assessment of lot attribution. This assessment records human judgment and does not automatically certify a laboratory sampling protocol.

Represent review with an append-only coa_report_review_events ledger bound to exact report revision, containing approve/reject, trusted actor/timestamp, reason and assessed scope. Expose pending/approved/rejected status derived from that revision's decision. Permit one terminal review decision per revision; corrections or a rejected report need a new revision, and supersession resets review to pending. A review command requires expectedVersion and advances the report head version without changing its content revision. Approval is accepted only for a complete revision with currently eligible source and adequate assessed scope. Add a narrow application reviewer-authorization dependency that fails closed if unavailable; obtain actor/client from trusted command context, never caller-supplied approval booleans. SQL grants protect audit immutability but do not establish application-user authorization. HTTP authentication/role integration remains the later API slice.

verifiedLabIdentityEventId remains optional and separate from transcription review. When present, enforce same client/evidence/revision and the ADR predicates: verified, lab_identity, independent_third_party_corroboration, with no effective withdrawal. Other verification scopes or submitter/internal review cannot impersonate that event. Source-support resolution rechecks referenced event validity; it must not trust an old cached lab-verified flag.

KTD4. Permanent identity, strong lineage and bounded corrections (R1, R2, R5).

Use coa_reports, coa_report_revisions, coa_measurements and the review ledger. Bind each head permanently to clientId, batchId and EvidenceAsset identity; unique (client_id, batch_id, evidence_id) prevents duplicate logical reports for the same batch/source lineage. Report revisions may advance evidenceRevision or correct transcription against the same original revision; each correction gets new measurement IDs. A distinct independent original report uses a distinct EvidenceAsset identity and report head. Displayed laboratory report identifiers are reported facts, not globally unique trustworthy keys; do not impose a uniqueness rule that prevents legitimate revisions or reuse by different labs/batches. Never retarget an existing report to another batch.

The exact revision FK targets batch_evidence_links(client_id, batch_id, evidence_id, evidence_revision). Validate purpose coa_test_report, sourceClass coa, and a PDF or registered image MIME type; do not use visual derivative bytes as the original. Include batch/evidence identity in head-to-revision constraints and the full composite lineage key in measurement-to-report FKs, matching the ADR future ClaimSourceLink key. Keep the deferred head/current-revision FK. Enforce predecessor exactly revision - 1, one successor, positive bounded revisions, immutable identities, monotonic version increments and terminal archive. Add archive command for the report head; history remains readable.

Date-only fields use Gregorian years 0001..9999 and SQL finite dates in that range. Require sampleDate <= reportDate when both exist, and report/sample dates <= the trusted recording UTC date. Supplied valid chronology applies even to drafts. Do not infer dates from file timestamps or SKU/batch production dates, and do not invent a report expiry period. Audit timestamp validation is separate from the source's date-only values.

KTD5. Transactional report boundary and exact source-support resolution (R1, R2, R6).

CoaReportRepositoryPort exposes create, supersede, review, archive, client-scoped report/revision/history/measurement reads and batch listing, plus pinned measurement support resolution. Domain predicates own analytical rules; the adapter loads and checks relational/source state on one transaction client. Thin use cases validate trusted command envelopes and execute via UnitOfWorkContext.coaReports. Add strict request/response schemas and serializers now; adding HTTP routes or UI is not necessary for this issue's API-mapping precision acceptance.

Resolve using clientId, batchId, reportId, reportRevision and explicit measurementIds plus required unit/basis/context/scope. Require head revision equality, nonarchived SKU/batch/report/evidence, exact batch link, available source object, no active source-object dispute/rejection (including disputes attached to another assertion over the same original), approved complete report, affirmative sample association and recognized measurement semantics. Reuse evaluateEvidenceEligibility and original-source verification event semantics, adding the missing current-revision and full lineage checks explicitly. The existing registration adapter already evaluates disputes across a SourceObject; share the focused helper rather than creating a weaker CoA-only interpretation.

A quantified-support request rejects below_limit/not_detected, negative-qualified values, missing/duplicate measurement IDs and incompatible requested unit/basis/context/scope. Nonquantified records remain available in ordinary history reads for future qualified absence-claim policy. Successful resolution returns exact values and all pinned identifiers, qualifiers, scope and provenance, never a bare decimal or releaseEligible flag. Do not silently choose a report, new measurement or source when a pin becomes stale. An approved-looking DTO without these persisted dependencies cannot pass resolution.

Use a coherent transaction snapshot with dependency locks for support resolution, not independent unlocked queries that can mix old heads and new verification state. The result is valid at that check; future approving/publishing transactions must re-resolve and hold the locks through their own commit. Do not advertise a source-support read as a durable release grant.

KTD6. Receipt-first commands and compatible locking (R2, R7).

Use the existing tenant/action command advisory-lock namespace and product_evidence_command_receipts for all report mutations. Compare command name, actor and canonical payload hash; identical committed commands replay their stored response before mutable-state preconditions, even after supersession/archive. Altered actor/payload/command conflicts. Preserve input decimal text in the hash. All generated IDs, revision/measurement/review writes, head update and receipt commit or roll back together. Reject mutation on an unbound/autocommit adapter. Include new constraint names in immediate and deferred database-error translation, without leaking a foreign client's identifiers.

Account for actual evidence code, not just the ADR lock diagram. Registration currently locks batch/SKU, source, then evidence; event append locks evidence then source; derivative linking locks evidence then batch/source. Introduce no report-first dependency locking. Use one documented order for overlapping paths: SKU, batch, source objects sorted by ID, evidence heads sorted by ID, report heads sorted by ID, then future claim heads. Read immutable lineage first to discover lock targets, acquire locks in order, then recheck heads/version/lineage. Supersession involving old and replacement originals locks both source rows in sorted order. Adjust the existing event/derivative paths where their inverse order would conflict with CoA operations; keep this a focused ordering/helper change with regression tests, not a storage rewrite. Evidence registration, verification appends and quarantine must synchronize with the same source locks. Bound lock_timeout and map contention consistently.

Report support becomes false after source/report supersession or archive, dispute/rejection, withdrawal of a required verification or quarantine, without mutating historical review records. This issue has no product claim tables to invalidate. The later claim slice must add same-transaction cascade invalidation at these command boundaries and precommit dependency rechecks; no fake invalidation table, no no-op claim event bus and no claim lifecycle implementation here.

## Explicit ADR refinements and assumptions

ADR 0009 prose mentions NUMERIC while its concrete measurement DDL uses TEXT. TEXT is the authoritative choice because the issue requires decimal-string storage and preserved spelling/scale. Its report schema requires all metadata, has no draft/review fields or uncertainty limits, and makes method mandatory; extend those contracts explicitly for drafts, revision review and optional reported metadata. Its monotonic predecessor check is weaker than the issue's version-fence needs; use exact one-step lineage as existing domain factories already do. Document these changes in ADR 0009/CONTEXT and synthetic fixtures rather than quietly claiming the old DDL already satisfies them.

The source remains mandatory for all persisted reports. Incomplete means insufficient reported identity/scope, not a source-less approved fact. A single original representing a panel with several samples is modeled as distinct explicitly scoped report EvidenceAsset assertions where needed, using #473's existing-source registration rather than another blob upload. New numeric analytical families are representable as reported strings, but remain unsupported until their tuple semantics are tested.

Assume manual commands are invoked by trusted application callers, following the existing CommandEnvelope convention. Reviewer authorization is explicit at the application use-case boundary; no new public endpoint is exposed. Transcription approval assesses correspondence and scope, not legal compliance, clinical efficacy or independent lab authenticity. All examples use clearly fictitious labs and sources.

## Risks and limits

The largest implementation risk is inconsistent cross-repository lock order; prove both commit orders with controlled barriers rather than timing sleeps. A second is accidentally treating evidence eligibility or transcription approval as release authority; keep names/results and operator instructions explicit. Unknown analytical dimensions must fail closed without restricting the data model to a cannabis panel. SQL regex/check expressions must not accidentally accept NULL via three-valued logic. Deferred FKs need COMMIT-time translation tests. Decimal comparisons must remain exact for long fractions and preserve trailing zeros on replay.

No OCR/LLM extraction, automatic authenticity verification, external lab integration, medical/efficacy claims, general conversion, overlays, GPU/I2V work or real client data is included. Existing production evidence-storage governance stays in effect; this issue neither enables production ingest nor demands independent legal/security sign-off as its own implementation gate.

## Downstream traceability

| Future consumer | Contract enabled here | Current issue verification |
| --- | --- | --- |
| Claim authoring/policy | Full measurement/report/source composite identity and nonquantified result distinctions | Pinned source-support and lineage tests only; no claim workflow execution |
| Claim approval/invalidation | Revision/version heads, immutable decisions, shared transaction and lock order | Report/source concurrency and stale-pin denial; claim cascade belongs to the later claim slice |
| HTTP/read plane | Strict schemas, typed errors and exact string serializers | DTO/serializer/receipt roundtrips; no new HTTP route required |
| Review Hub/template/assembly | Batch-specific pins, explicit sample scope and source-support denial reasons | Two lots of one SKU remain isolated; no present assembly exit-gate, render-provider or locked-SHA run |

No phase completion sign-off, production lab verification, real-provider run, physical hardware measurements or downstream release admission is a gate for this PR.

Implementation plan:
# Implementation plan — issue #474

## Goal capsule

Deliver source-backed immutable CoA revisions, exact typed measurements, report transcription review and a fail-closed pinned source-support boundary using the existing batch/evidence transaction infrastructure. Implement only this issue. The supplied acceptance criteria are authoritative; design_md records the explicit ADR refinements. Do not modify certification/, baseline/ or config/render-profiles/, generate real CoAs, add upload infrastructure, or implement downstream claim/publish workflows.

Land as one issue-scoped change after application and PostgreSQL tests and the existing repository gates pass. This planning run writes result.json only and does not execute tests or production changes.

## U1. Domain values and wire contracts

Depends on: none. Covers R1–R6; KTD1–KTD4.

Add the report/measurement/review identifiers and pure decimal, quantity/unit compatibility, date and scope validators following packages/shared/src/product-identity.ts, packages/domain/src/identifiers.ts and evidence-asset.ts. Likely new modules are shared coa-measurement helpers, domain coa-report.ts/coa-measurement.ts, contracts coa-report.ts and their tests; update package index exports. Use shared lexical rules so contracts never depend on domain. Avoid moving unrelated product code.

Define report head/revision, typed results, optional absolute uncertainty/LOD/LOQ/qualifiers, generic analyte/context fields, explicit draft/complete state, association attestation, revision-bound review and exact pinned-support input/result. Add create/supersede/review/archive command payload and response schemas with strict keys. Identity, recorder/reviewer and timestamps come from trusted envelopes; create/supersede payloads cannot set approved status. Preserve ADR composite identity and result kinds. Keep reported method nullable rather than fabricating an unknown method.

Tests: string values beyond IEEE-754 precision and long fractions; exact 24.5000 spelling; malformed decimals and JSON numeric input; all three result variants and forbidden payload combinations; optional LOD/LOQ/uncertainty and contradictions; percent/fraction endpoints and tiny violations beyond endpoints; unqualified negative rejection and explicitly qualified negative retention; known unit-dimension contradictions; unknown semantics retained but unsupported; missing analyte/unit/basis/context; duplicate analyte/context across different units/methods; valid distinguished contexts; impossible/future dates and sample-after-report; incomplete drafts and complete requirements; sample vs lot assessment; new revisions discard prior review status. Roundtrip DTOs/serializers without numeric coercion.

Validation: pnpm vitest run packages/shared/src/coa-measurement.test.ts packages/domain/src/coa-report.test.ts packages/domain/src/coa-measurement.test.ts packages/contracts/src/coa-report.test.ts (use the final filenames if adjusted); pnpm typecheck.

## U2. Add relational schema and immutable audit protections

Depends on U1. Covers R1–R5, R7; KTD3, KTD4, KTD6.

Add packages/infrastructure/migrations/028_coa_reports.sql, using the next free numeric prefix at implementation time. Follow migrations 026/027, including PostgreSQL UUIDv7 defaults, exact client keys, nonempty checks, finite/bounded dates/timestamps, deferred current-revision FK, full measurement lineage FK, report predecessor and parameter-context uniqueness. Add the immutable report review ledger with one decision per report revision. Bind head batch/evidence identity permanently and prevent two report heads for one client/batch/evidence lineage. Complete reports require required identities/scope and association fields; drafts explicitly permit null missing metadata. Require source references and valid supplied measurement rows in both states.

TEXT decimal columns and typed-result checks must preserve strings and use explicit IS NOT NULL tests. Enforce analytical row rules and percentages with exact SQL predicates. Complete-panel/nonempty rules that span rows need a deferred constraint trigger or equivalent commit-time invariant, so an app-role caller cannot commit a complete report without measurements. Approval review-event insertion likewise checks the referenced revision is complete; application eligibility remains responsible for live source/reviewer checks. Composite verification-event FK proves lineage; validate its semantic predicates in the transactional adapter. Do not mutate verification infrastructure to treat a lab-name string as authentication.

Reuse existing append-only/delete-protection trigger functions. Add head update guards: only revision/version/archive columns mutable, version advances exactly one, revision unchanged for review/archive or increases exactly one for supersession, archived heads terminal. Revoke PUBLIC access; app role gets SELECT/INSERT on immutable tables and only allowed column UPDATE on heads. Explicitly revoke UPDATE/DELETE/TRUNCATE and assert effective privileges, including inherited-role and column-level grants, following the existing schema test patterns.

Add postgres/coa-report-schema.integration.test.ts. Prove empty-database migration and upgrade from 027 with existing SKU/batch/evidence rows intact. Test deferred head creation and orphan failure at COMMIT, orphan/forged measurement denial, cross-client/batch FKs, batch/source retarget denial, duplicate identities and parameter contexts, skipped/forked revision rejection, invalid decimals/NULL payloads/percent/unit/date rules, immutable UPDATE/DELETE and TRUNCATE denial through a real restricted role, legal column updates and inherited forbidden privilege detection. Report and source history must survive corrections/archive.

Validation: pnpm vitest run --config vitest.integration.config.ts packages/infrastructure/src/postgres/coa-report-schema.integration.test.ts. Requires Docker; default unit config is not valid for this file.

## U3. Transactional repository, source checks and lock integration

Depends on U1 and U2. Covers R1, R2, R6, R7; KTD4–KTD6.

Add packages/application/src/ports/coa-report-repository.ts and a PostgresCoaReportRepository adapter under packages/infrastructure/src/postgres/repositories/. Define mutation results, revision/history/measurement reads, batch listing and pinned-support loading/resolution. Add UnitOfWorkContext.coaReports and instantiate the adapter on the same PoolClient in PostgresUnitOfWork. Update relevant exports and test fakes; an optional context field can follow current repository conventions, but CoA use cases must fail clearly when absent.

Reuse command envelope validation, canonical hashing, transaction-scoped advisory locking and receipt storage patterns. Keep command-name/actor/hash checks and historical response rehydration; no standalone receipt table or nested transaction/pool acquisition. Validate create/supersede atomically against the exact batch link, class/purpose/original MIME, live source/head state and all measurement invariants. Supersession requires expectedVersion and fixed batch/evidence identity, appends exactly one next revision plus entirely new measurement IDs, resets review and advances the head with an affected-row version predicate. Review appends a terminal decision for the exact current revision and increments head version. Archive is terminal, fenced and receipt-backed.

Share narrowly scoped source-state/dispute helpers with the existing EvidenceAsset adapter. CoA resolution must add the current evidence revision check absent from getEvidenceEligibility; check active disputes for the original across evidence assertions and the semantic validity/withdrawal of any pinned independent lab event. Keep historical report reads available even when support is denied. Return scoped NOT_FOUND rather than probing a foreign tenant to explain it. Map new named checks/FKs/uniques and lock timeouts into the established closed errors, including deferred errors caught at UoW COMMIT. Preserve the existing error contract; add an error code only if the existing validation/business categories cannot express the condition, updating shared/contracts tests together.

Document and apply the design's shared dependency lock order to CoA mutations/resolution and the existing evidence paths they overlap. Include registration, verification event append, derivative link and source quarantine in the audit; fix actual inversions where required. Use immutable discovery reads, sorted source locks, head locks, then mandatory rechecks. Do not lock a report first and later acquire its evidence/batch locks. Source support must be assembled under one coherent transaction and shared locks; report state, source availability and verification events cannot be loaded in disconnected sessions.

Tests in adapter unit tests and postgres/repositories/postgres-coa-report-repository.integration.test.ts: atomic complete creation; failure after revision/measurement insertion rolls back heads, rows and receipt; unbound/autocommit refusal; same command replay, altered actor/command/payload conflict; concurrent identical retry yields one record; stale expectedVersion produces one winner; replay still returns original strings and IDs after newer revisions/archive; exact lineage and tenant-filtered reads/history; no metadata/storage mutation; correction against same PDF and against next EvidenceRevision; independent reports on same batch; long decimal/scale roundtrip through pg and JSON receipts. Update existing evidence/UoW tests for shared helper/lock changes.

Controlled concurrency tests: review vs report supersession; review/resolve vs EvidenceAsset supersession, dispute append, batch/report archive or quarantine; both commit orders must yield a state that future resolution rejects when stale. Verify bounded lock timeout and no deadlock on overlapping registration/verification/derivative operations using explicit barriers and a small connection pool. Do not test future claim invalidation tables or introduce them.

Validation: pnpm vitest run packages/infrastructure/src/postgres/repositories/postgres-coa-report-repository.test.ts packages/infrastructure/src/evidence/postgres-evidence-asset-repository.test.ts; pnpm vitest run --config vitest.integration.config.ts packages/infrastructure/src/postgres/repositories/postgres-coa-report-repository.integration.test.ts packages/infrastructure/src/postgres/uow/postgres-unit-of-work.integration.test.ts packages/infrastructure/src/evidence/evidence-registration.integration.test.ts; pnpm boundaries.

## U4. Application commands, authorization and pinned support resolution

Depends on U1 and U3. Covers R1–R7; KTD3, KTD5.

Add report create/supersede/review/archive use cases following product-registry-use-cases.ts and RecordEvidenceVerificationEventUseCase, plus a ResolveCoaMeasurementSupport use case. Add a narrow reviewer authorization port/dependency that denies missing authorization and uses the trusted actor/client; exercise it with an explicit fake implementation. Avoid implementing a new general RBAC system or accepting a reviewer role from a report body. Keep transactional cross-entity validation in the adapter, not a use-case preflight performed on an unrelated connection.

Separate source eligibility from domain analytical eligibility. Successful support output contains exact values and pinned report/source/measurement IDs and assessed sample scope. It never declares a claim approved or release eligible. Resolve all requested IDs or deny the complete request; no partial fallback. Require exact unit/basis/context and sufficient requested sample/lot scope; do no conversion, aggregating, percent recalculation or zero inference. Expose strict output mapping that never strips analytical qualifiers, provenance or scope. Ordinary report history can return nonquantified and unknown-semantic rows without treating them as supported numerical facts.

Application tests: unauthorized review and caller-supplied approval rejection; complete report remains pending after creation; authorized transcription review produces an audited decision but no claim/release grant; absent source/report, ambiguous sample association, unsupported units, incompatible requested unit sets, rejected/pending/draft report, stale evidence/report pin, withdrawn lab verification, archived SKU/batch/report/source and disputed/quarantined/deleted originals all deny support. Test not_detected/below_limit/qualified negatives cannot be numerical zero or exact supported numbers. Use two batches of one SKU with different synthetic terpene values and several historical reports to prove no cross-lot or implicit latest lookup. A pinned old measurement fails after correction; explicit new IDs work only after new review. Test same-batch sample-only support and rejection of lot-wide extension. Test API schemas and serializers roundtrip long strings and trailing zeros from repository output.

Validation: pnpm vitest run packages/application/src/use-cases/coa-report-use-cases.test.ts packages/application/src/use-cases/resolve-coa-measurement-support.test.ts packages/contracts/src/coa-report.test.ts (adjust final filenames); pnpm typecheck; pnpm lint.

## U5. Synthetic scenario, operator guidance and final verification

Depends on U2–U4. Covers R7 and acceptance traceability.

Extend docs/verified-product-evidence-contract-fixtures.md with issue-scoped synthetic scenarios for manual entry, draft completion via revision, terminal transcription review, independent lab verification distinction, exact precision and correction lineage. Explain how the current RegisterEvidenceAsset workflow combines ingest/assertion/batch linking rather than presenting the ADR's conceptual separate commands as existing APIs. Update ADR 0009 and docs/CONTEXT.md with the explicit additive contract refinements and current/future ownership distinctions. Add a concise CoA manual-entry runbook or extend the source-evidence runbook with registration references, exact units/results, missing-scope drafts, independent authenticity checks, qualified limits, and immutable correction instructions. No real lab/client documents or operator evidence artifacts.

Add an application-to-Postgres scenario using registered synthetic PDF/image originals, trusted envelopes and the real UoW: create two lots of one SKU, enter distinct values, complete/review reports, resolve exact supported values, supersede one source/report, verify old history remains and old pins deny, then explicitly review/resolve the new revision. This can live in the repository integration suite and does not need a public API or external lab service. Reuse #473's local test source registration/storage fixtures rather than duplicating upload code; MinIO is needed only if using that existing storage integration harness.

## Verification contract

The commands above are focused implementation checks, not evidence that this planning run executed them. Run tests after each unit exists; do not invent command paths that the implementation never creates. Every integration-file invocation must include --config vitest.integration.config.ts. Docker is required for pnpm test:db.

Final validation uses .ai-orchestrator.json in this worktree as effective configuration; do not search for machine-local config. Keep the six existing ordered tiers: hygiene (check:hooks and frozen install), isolated format:fix, isolated format check, parallel preValidation/build, parallel deterministic gates (lint/typecheck/test/test:bash/boundaries/check:control-plane), then the configured heavy subsystem suites (test:db/test:assembly/test:kokoro/test:piper/test:ltx-production/test:whisperx). Changes here add no command requiring config edits; do not duplicate inherited commands. Run the configured gates with their actual environment prerequisites and report unavailable Docker/model caches as environment limitations rather than claiming a pass. The CoA acceptance specifically requires application and PostgreSQL integration suites using synthetic data; no hardware certification, rendering, real-provider acceptance, locked-SHA run or downstream phase sign-off is added by this issue.

## Definition of done

- Persisted reports and measurements cannot omit or forge same-client/batch source lineage; independent historical reports and immutable correction history work.
- Complete/draft/review distinctions are explicit, version fenced and audited. Attaching a file or submitting numeric data cannot approve it, authenticate the lab or confer release eligibility.
- Exact decimals retain input precision/spelling through storage, mapping and replay, with no IEEE-754 analytical coercion. Unit/basis/context, result qualifiers and analytical validation are covered at domain/application and database boundaries.
- Pinned source-support denies incomplete, unreviewed, wrong-lot, stale, archived, unavailable or disputed dependencies and incompatible analytical requests. Two lots of one SKU remain isolated. Correction requires new explicit IDs and new review.
- Application authorization, repository/UoW rollback/replay/version behavior, restricted-role protections and both-order concurrency tests pass with synthetic sources. Relevant existing evidence tests remain green.
- Operational instructions distinguish transcription approval from independent laboratory authenticity and later commercial claim approval. Future consumers are enabled by contracts, not implemented or treated as present PR gates.
- No upload duplication, public HTTP/UI scope expansion, real client data or prohibited evidence artifacts. All applicable existing validation results and material environment limitations are reported truthfully.

## Planning confidence and review

Confidence is high in repository placement, source reuse and test infrastructure; medium in the new review/draft/unit refinements because the ADR describes only complete unreviewed report rows. Those refinements are explicitly settled in design_md rather than left for an implementer to invent. The principal concurrency risk is the observed inverse source/evidence locking in current adapters; U3 includes focused alignment and barrier tests. A sequential coherence/feasibility/security/scope review of this package checks the immutable-review reset, duplicate identity rule, draft fail-closed boundary, exact SQL text path, deferred constraints and future-consumer separation. No downstream release capability or external authenticity assessment is claimed as verified. Planning performs no implementation or test execution.

Accumulated review findings ledger:

```
### UNRESOLVED BLOCKING FINDINGS:
- **[AC-7] [HIGH]** Failed requirement: R7. Cover application workflows, exact serialization, relational integrity, immutable audit/grants, concurrency and transaction rollback with synthetic fixtures only. Document manual transcription separately from independent authenticity assessment.
  Evidence: The only new database integration file contains seven direct-SQL schema tests. No CoA repository integration file, real UnitOfWork application scenario, controlled concurrency barriers, mutation rollback/receipt atomicity scenarios or restricted-role CoA privilege tests exist. Application resolution tests only check validation/delegation. Existing registration supersession still acquires the old source after the evidence head, which conflicts with the newly reordered verification path. The runbook conflates review with lab authenticity and instructs operators to invoke conceptual commands or supply correction fields absent from current request schemas.
  Required Fix: Implement requirement to satisfy: R7. Cover application workflows, exact serialization, relational integrity, immutable audit/grants, concurrency and transaction rollback with synthetic fixtures only. Document manual transcription separately from independent authenticity assessment.
  Source: spec-review (iteration 0)

- **[F-01c1c800] [HIGH]** R7 expressly requires repository/transaction, audit/grants, cross-client and concurrency coverage. Passing broad validation cannot establish omitted behaviors; reviewer adversarial checks exposed multiple violations outside the present test cases.
  Files: packages/infrastructure/src/postgres/coa-report-schema.integration.test.ts, packages/infrastructure/src/postgres/repositories/postgres-coa-report-repository.test.ts, packages/application/src/use-cases/resolve-coa-measurement-support.test.ts
  Evidence: Only seven direct-SQL CoA integration tests exist; no postgres-coa-report-repository.integration.test.ts or equivalent CoA/UoW scenario exists. Application support tests only reject missing measurementIds and verify delegation. There are no CoA controlled concurrency, rollback/receipt atomicity, restricted-role effective-grant, two-lot resolution, historical replay or withdrawn-lab integration scenarios.
  Required Fix: Add synthetic application-to-Postgres tests through the real UnitOfWork and existing evidence registration, covering the required lifecycle, exact receipts, tenant/lot isolation, restricted grants, rollback and both-order dependency races.
  Source: spec-review (iteration 0)

- **[F-ebe31639] [MEDIUM]** The issue requires usable operator instructions separating transcription approval from independent lab authentication. KTD refinements also explicitly require documenting TEXT authority and optional reported methods rather than leaving contradictory contracts.
  Files: docs/coa-manual-entry-runbook.md, docs/adr/0009-verified-product-batch-evidence-claim-authority.md, docs/CONTEXT.md
  Evidence: Runbook section 1.2 places CoaReportReviewEvent and EvidenceVerificationEvent together under independent authenticity assessment, while its diagram joins review and lab corroboration as required inputs although the lab event is optional. SOP-01 names ingestOriginalSource/linkEvidenceToBatch instead of the implemented combined RegisterEvidenceAsset workflow. SOP-04 tells callers to supply supersedesRevision, which the strict supersede request schema rejects. ADR prose still describes NUMERIC and mandatory method despite the required explicit refinements.
  Required Fix: Document the actual register/create/correct/review calls and their accepted fields; describe transcription approval and optional independent lab authentication separately; align ADR/CONTEXT with authoritative TEXT storage, nullable method and the actual review model.
  Source: spec-review (iteration 0)

- **[F-b3986351] [HIGH]** Testing PostgresCoaReportRepository exclusively against a mock PoolClient left real SQL execution, receipt replay rehydration, transaction rollback, deferred constraint error translation, two-lot SKU isolation, and lock-ordered concurrency unverified against PostgreSQL.
  Files: packages/infrastructure/migrations/028_coa_reports.sql, packages/infrastructure/src/postgres/coa-report-schema.integration.test.ts, packages/infrastructure/src/postgres/repositories/postgres-coa-report-repository.test.ts
  Evidence: 1) 028_coa_reports.sql (lines 408-434) omits the table-level UPDATE absence assertion (`has_table_privilege(v_app_role, 'coa_reports', 'UPDATE')`) and positive column-level UPDATE assertions (`NOT has_column_privilege(v_app_role, 'coa_reports', 'current_revision', 'UPDATE')`, `'version'`, `'archived_at'`) present in 027_evidence_authority.sql (lines 470-506). 2) packages/infrastructure/src/postgres/coa-report-schema.integration.test.ts contains only 6 superuser tests and never exercises orchestrator.app_role grants, column-level UPDATE restrictions, head update triggers, or measurement check constraints. 3) packages/infrastructure/src/postgres/repositories/postgres-coa-report-repository.integration.test.ts was not created; PostgresCoaReportRepository is only tested against a mocked PoolClient in postgres-coa-report-repository.test.ts.
  Required Fix: Add the missing table-level and positive column-level UPDATE privilege assertions in 028_coa_reports.sql, expand coa-report-schema.integration.test.ts to verify restricted app_role privileges and SQL check/trigger constraints, and add postgres-coa-report-repository.integration.test.ts covering repository CRUD, receipt replay, rollback, two-batch isolation, and barrier-synchronized concurrency against PostgreSQL.
  Source: quality-review (iteration 0)

### PREVIOUSLY RESOLVED FINDINGS (REGRESSION CHECKLIST):
- **[AC-1] [RESOLVED in iter 2]** Failed requirement: Represent a laboratory report as a linked, immutable source of batch-specific data. Allow a human operator to transcribe/enter typed analytical values with exact units and explicit sample/report scope; the original CoA report remains attached as evidence.
  Resolution Evidence: packages/infrastructure/migrations/028_coa_reports.sql:352-417 now rejects measurements whose parent revision xmin differs from the current transaction, as well as reviewed, archived and noncurrent panels. The existing full-lineage FK remains at lines 153-154. packages/infrastructure/src/postgres/repositories/postgres-coa-report-repository.ts:1022-1106 creates the correction revision, advances the head, then inserts its new panel within the UoW transaction (postgres-unit-of-work.ts:30-60). PostgreSQL integration tests for post-review/post-commit insertion and a successful correction passed.
  Source: spec-review

- **[AC-2] [RESOLVED in iter 2]** Failed requirement: R2. Reports are immutable revisions behind version-fenced heads; corrections preserve original bytes, old metadata, measurement IDs, review decisions and command receipts. Multiple independent historical reports per batch are allowed. Numerical callers provide explicit report revision and measurement IDs, never a latest-report selector.
  Resolution Evidence: packages/infrastructure/migrations/028_coa_reports.sql:405-408 seals committed panels. packages/application/src/use-cases/review-coa-report.ts:39-54 authorizes and delegates without inspecting the current recorder. packages/infrastructure/src/postgres/repositories/postgres-coa-report-repository.ts:1131-1142 replays the stored review receipt before head discovery and before the locked revision-specific self-approval check at lines 1240-1258. Immutable history triggers remain at migration lines 264-274; successful revision advancement is exercised by repository integration lines 251-305.
  Source: spec-review

- **[AC-3] [RESOLVED in iter 1]** Failed requirement: R3. Typed decimal-string results preserve spelling and precision throughout request validation, domain values, SQL parameters/storage, reads, serializers and receipt replay. Units, analytical basis and context are explicit; ambiguous units or contexts cannot support numerical facts.
  Resolution Evidence: packages/contracts/src/coa-report.ts:228-261 makes requiredUnit, requiredBasis, requiredContext, and requiredScope mandatory on ResolveCoaMeasurementSupportRequestSchema and includes analyticalQualifierCode and analyticalQualifierExplanation on ResolvedMeasurementDetailSchema. packages/infrastructure/src/postgres/repositories/postgres-coa-report-repository.ts:1786-1824 enforces exact unit/basis/context matching, maps analytical qualifiers into each ResolvedMeasurementDetail, and unconditionally rejects mixed measurement contexts across multiple measurementIds.
  Source: spec-review

- **[AC-4] [RESOLVED in iter 1]** Failed requirement: R4. Drafts may retain incomplete report/sample metadata but never bypass measurement validity or source/tenant linkage. Completion and review are separate, and no upload or transcription command self-approves.
  Resolution Evidence: packages/application/src/ports/reviewer-authorization-port.ts:7-13 defines DenyAllReviewerAuthorizationAdapter, and packages/application/src/use-cases/review-coa-report.ts:19 defaults reviewerAuth to new DenyAllReviewerAuthorizationAdapter() (tested in packages/application/src/use-cases/coa-report-use-cases.test.ts:367-371). packages/infrastructure/migrations/028_coa_reports.sql:108 enforces sample_to_batch_association_confirmed IS TRUE and lines 205-213 enforce chk_coa_measurement_fraction_bounds.
  Source: spec-review

- **[AC-5] [RESOLVED in iter 1]** Failed requirement: R5. Enforce percent/fraction bounds, compatible analytical dimensions, real/ordered dates, nonblank analytes, unambiguous parameter contexts, explicit qualifications for reported negative values, and consistent limits/uncertainty.
  Resolution Evidence: packages/infrastructure/migrations/028_coa_reports.sql:108 enforces sample_to_batch_association_confirmed IS TRUE, lines 153-162 enforce trimmed canonical strings (analyte = trim(analyte), unit = trim(unit), basis = trim(basis), context = trim(context), quantity_kind = trim(quantity_kind)), and lines 205-213 enforce chk_coa_measurement_fraction_bounds (0..1) on values, limits, uncertainty, LOD, and LOQ, mirroring packages/domain/src/coa-measurement.ts:248-252,319-329,391-400,462-558.
  Source: spec-review

- **[AC-6] [RESOLVED in iter 1]** Failed requirement: R6. Fail source-support resolution closed for missing reports, wrong tenants/lots, incomplete association, unreviewed/rejected reports, wrong requested context/unit, superseded revisions, archived dependencies, unavailable originals, or active source disputes/rejections. A successful result is a source-supported candidate for a future claim policy, never a release authorization.
  Resolution Evidence: packages/infrastructure/src/postgres/repositories/postgres-coa-report-repository.ts:1586-1824 acquires ordered FOR SHARE locks and then re-reads and validates product_skus.archived_at (lines 1600-1606), product_batches.archived_at (lines 1608-1614), evidence_assets.archived_at and current_revision !== revision.evidenceRevision (lines 1616-1628), source_objects.availability (lines 1630-1649), active disputes (lines 1652-1674), coa_reports state (lines 1677-1693), subsequent outcome = 'withdrawn' events targeting verifiedLabIdentityEventId (lines 1696-1738), and review approval/scope (lines 1741-1757). reviewReportRevision (lines 1223-1231) also validates live source lineage eligibility and current evidence revision before approving.
  Source: spec-review

- **[F-82348f2c] [RESOLVED in iter 1]** KTD3 explicitly requires reviewer authorization to fail closed if unavailable. Distinct recorder/reviewer identities do not establish reviewer permission.
  Resolution Evidence: packages/application/src/ports/reviewer-authorization-port.ts:7-13 adds DenyAllReviewerAuthorizationAdapter throwing AccessDeniedError, packages/application/src/use-cases/review-coa-report.ts:19 defaults reviewerAuth to new DenyAllReviewerAuthorizationAdapter(), and packages/application/src/use-cases/coa-report-use-cases.test.ts:367-371 verifies that ReviewCoaReportUseCase fails closed with AccessDeniedError when constructed without an explicit authorization adapter.
  Source: spec-review

- **[F-c8c37245] [RESOLVED in iter 1]** Issue acceptance and R6/KTD5 require superseded sources to deny support without substituting a newer source.
  Resolution Evidence: packages/infrastructure/src/postgres/repositories/postgres-coa-report-repository.ts:1616-1628 selects archived_at, current_revision FROM evidence_assets under lock in resolveMeasurementSupport and returns { isSupported: false, reason: 'source_superseded' } when current_revision !== revision.evidenceRevision. validateSourceLineageEligibility (lines 547-566, called by reviewReportRevision at line 1223 with requireCurrentEvidence: cmd.payload.decision === 'approved') rejects approval when evidence_assets.current_revision !== options.evidenceRevision.
  Source: spec-review

- **[F-3ee40cef] [RESOLVED in iter 1]** A withdrawn independent laboratory verification must cease satisfying the pinned authentication dependency. The original immutable verified row never gains the withdrawal pointer.
  Resolution Evidence: packages/infrastructure/src/postgres/repositories/postgres-coa-report-repository.ts:490-505 (in assertValidLabVerificationEvent, used by createReport, supersedeReport, and reviewReportRevision) and lines 1724-1737 (in resolveMeasurementSupport) query evidence_verification_events for outcome = 'withdrawn' AND withdrawal_event_id = $4 scoped to client_id, evidence_id, and evidence_revision. Tested against PostgreSQL 18.6 in packages/infrastructure/src/postgres/repositories/postgres-coa-report-repository.integration.test.ts:392-508.
  Source: spec-review

- **[F-2f6736be] [RESOLVED in iter 3]** A concurrent supersession/archive between discovery and locking can yield supported stale pins, even through the transactional application use case. Direct pool-backed resolution has no coherent lock lifetime. R6 and KTD5 require a coherent transaction with dependency locks and rechecks.
  Resolution Evidence: packages/infrastructure/src/postgres/repositories/postgres-coa-report-repository.ts:1593-1615 starts a READ COMMITTED READ WRITE transaction for Pool/autocommit callers and validates externally managed transaction status. :1700-1711 takes dependency locks; :1713-1807 rereads SKU, batch, evidence, source and report state, including current revisions. :1618-1626 commits managed transactions only when returning the assembled result. packages/infrastructure/src/postgres/uow/postgres-unit-of-work.ts:30-60 retains external locks through COMMIT. Successful Pool and PoolClient integration scenarios at postgres-coa-report-repository.integration.test.ts:684-855 passed.
  Source: spec-review

- **[F-04bf4fb8] [RESOLVED in iter 1]** The issue explicitly requires mixed/incompatible sets to fail, and KTD5 requires explicit requested semantics and preservation of qualifiers in supported provenance.
  Resolution Evidence: packages/contracts/src/coa-report.ts:228-261 requires requiredUnit, requiredBasis, requiredContext, and requiredScope on ResolveCoaMeasurementSupportRequestSchema and includes analyticalQualifierCode and analyticalQualifierExplanation on ResolvedMeasurementDetailSchema. packages/infrastructure/src/postgres/repositories/postgres-coa-report-repository.ts:1786-1824 enforces unit/basis/context equality, maps analytical qualifiers (lines 1808-1809), and unconditionally rejects mixed measurement contexts (lines 1814-1824). Tested in packages/contracts/src/coa-report.test.ts:140-149.
  Source: spec-review

- **[F-d1e984e4] [RESOLVED in iter 1]** KTD3 requires approval only with a currently eligible source, and KTD4/KTD6 require corrections to retain the checked original-source boundary. A quarantined original can receive a new approval, and a correction has weaker ingestion checks than initial creation.
  Resolution Evidence: packages/infrastructure/src/postgres/repositories/postgres-coa-report-repository.ts:508-577 factors validateSourceLineageEligibility and invokes it after acquireOrderedLocks in createReport (line 670), supersedeReport (line 956), and reviewReportRevision (line 1223). supersedeReport (lines 888-915) also validates link.purpose === 'coa_test_report', link.source_class === 'coa', and allowed PDF/image MIME types.
  Source: spec-review

- **[F-951e0cc1] [RESOLVED in iter 2]** This changes the panel covered by an immutable report/review without a correction revision, new head version or new decision. R2 requires immutable report content and auditable corrections.
  Resolution Evidence: packages/infrastructure/migrations/028_coa_reports.sql:382-408 checks the revision creation transaction and rejects inserts after commit or review; the trigger is attached BEFORE INSERT at lines 415-417. Restricted-role INSERT permission at line 490 cannot bypass the trigger. packages/infrastructure/src/postgres/coa-report-schema.integration.test.ts:413-460 and 502-546 exercise post-review and post-commit rejection; both passed against PostgreSQL 18.6. Repository correction at postgres-coa-report-repository.ts:1022-1106 inserts a new revision and panel atomically and its lifecycle integration test passed.
  Source: spec-review

- **[F-1e259f9b] [RESOLVED in iter 2]** R4/R5 and KTD2/KTD4 explicitly require draft-independent analytical validity, normalized unambiguous contexts, and null-safe complete metadata at the SQL boundary.
  Resolution Evidence: packages/infrastructure/migrations/028_coa_reports.sql:109 uses IS TRUE for complete association, lines 155-163 require canonical trimmed strings, lines 207-214 enforce exact numeric 0..1 bounds, and lines 227-228 add normalized parameter-context uniqueness. SQL negative tests at packages/infrastructure/src/postgres/coa-report-schema.integration.test.ts:342-412 and 547-584 passed. The same immutable-table INSERT triggers and CHECK constraints execute under the restricted grants at migration lines 489-496.
  Source: spec-review

- **[F-4355767c] [RESOLVED in iter 3]** The two paths form an evidence-to-source versus source-to-evidence cycle. Registration can hold E waiting for S while event append holds S waiting for E. KTD6 specifically requires eliminating these overlapping inversions and locking both replacement/old originals in sorted order.
  Resolution Evidence: packages/infrastructure/src/evidence/postgres-evidence-asset-repository.ts:686-715 discovers current and existing replacement originals and locks their distinct IDs in sorted order before the evidence-head lock at :717-735. Verification append discovers immutable lineage at :1431-1443 and locks source at :1446-1450 before evidence at :1452-1456. The existing-original path at :742-746 reacquires a source already included in that ordered set. The supersession-versus-verification integration scenario at postgres-coa-report-repository.integration.test.ts:1095-1184 passed.
  Source: spec-review

- **[F-fb0d8553] [RESOLVED in iter 2]** KTD6 requires identical committed commands to replay their stored response before mutable-state preconditions, including after supersession/archive. Repository receipt-first code cannot repair a rejection in the application preflight.
  Resolution Evidence: packages/application/src/use-cases/review-coa-report.ts:39-54 retains explicit authorization and removes the mutable current-revision preflight. packages/infrastructure/src/postgres/repositories/postgres-coa-report-repository.ts:1131-1142 performs receipt lookup and domain rehydration before archive/version checks at lines 1154-1162 and separation-of-duties validation at lines 1251-1258. Command name, actor and payload matching remain at lines 312-328. The focused application and repository unit suites passed.
  Source: spec-review

- **[F-de751afd] [RESOLVED in iter 1]** Withdrawn independent third-party laboratory identity verifications and superseded EvidenceAsset revisions continue to pass createReport and resolveMeasurementSupport (returning isSupported: true), violating fail-closed source-support invariants (R6, KTD3, KTD5). Furthermore, supersedeReport can retarget a CoA report revision to a non-CoA evidence link or an invalid/withdrawn lab verification event.
  Resolution Evidence: packages/infrastructure/src/postgres/repositories/postgres-coa-report-repository.ts:454-506 (assertValidLabVerificationEvent) and lines 1696-1738 (resolveMeasurementSupport) verify that no row exists in evidence_verification_events with outcome = 'withdrawn' and withdrawal_event_id = $4. Lines 547-566 and 1616-1628 check evidence_assets.current_revision === revision.evidenceRevision in reviewReportRevision and resolveMeasurementSupport. Lines 888-915 enforce purpose === 'coa_test_report', source_class === 'coa', and allowed PDF/image MIME types in supersedeReport.
  Source: quality-review

- **[F-93d00d57] [RESOLVED in iter 1]** Because coa_measurements allows unrestricted INSERTs by the application role, additional measurement rows can be appended to a CoA report revision after compliance approval or supersession, mutating an audited analytical panel in place. Missing normalized-fraction and trimmed/case-insensitive SQL checks also allow invalid analytical rows to persist.
  Resolution Evidence: packages/infrastructure/migrations/028_coa_reports.sql:348-394 adds enforce_coa_measurements_insert() and trg_enforce_coa_measurements_insert rejecting inserts into archived, non-current, or reviewed revisions (mapped in packages/infrastructure/src/postgres/repositories/postgres-product-evidence-repository.ts:586,976-981). Migration 028 lines 153-162,193-219 and packages/domain/src/coa-measurement.ts:248-252,319-329,391-400,462-558 enforce 0..1 normalized fraction bounds, non-empty analytical_qualifier_code, and consistent case/trim normalization.
  Source: quality-review

- **[F-925a565a] [RESOLVED in iter 1]** KTD3 requires a reviewer-authorization dependency that fails closed if unavailable. Defaulting ReviewCoaReportUseCase to a permissive adapter fails open when constructed without an authorization implementation. In addition, omitting the non-self-approval invariant from the domain factory, transactional repository adapter, and SQL trigger contradicts docs/CONTEXT.md and CE-15 in docs/verified-product-evidence-contract-fixtures.md and allows self-approval through domain/repository/SQL paths or under concurrent revision races.
  Resolution Evidence: packages/application/src/ports/reviewer-authorization-port.ts:7-13 and packages/application/src/use-cases/review-coa-report.ts:19 default ReviewCoaReportUseCase to DenyAllReviewerAuthorizationAdapter. Non-self-approval (actorId.trim().toLowerCase() !== targetRevision.assertedBy.trim().toLowerCase()) is enforced in packages/domain/src/coa-report.ts:587-594, packages/infrastructure/src/postgres/repositories/postgres-coa-report-repository.ts:1214-1221 (after locking), and packages/infrastructure/migrations/028_coa_reports.sql:417-420.
  Source: quality-review

- **[F-01fffe0d] [RESOLVED in iter 3]** Under PostgreSQL READ COMMITTED isolation, unlocked discovery SELECTs read a pre-lock snapshot. If a concurrent transaction archives or supersedes a dependency while acquireOrderedLocks waits for the lock, failing to re-read state after locking allows stale or archived records to pass validation. Failing to lock old and replacement source_objects in sorted order during supersession also creates a lock-order inversion risk.
  Resolution Evidence: packages/infrastructure/src/postgres/repositories/postgres-coa-report-repository.ts:1593-1626 manages an explicit read-write resolution transaction; :1700-1807 locks then rereads mutable support dependencies. Supersession discovers both originals at :920-941 and rechecks locked report/SKU/batch/evidence at :944-991 before validateSourceLineageEligibility at :993-1001. Review locks at :1210-1216 and rechecks report and dependency state at :1219-1288. Archive rereads the locked head at :1414-1434 and associated active state at :1437-1455. Evidence registration locks discovered originals before evidence at postgres-evidence-asset-repository.ts:686-735. Real UoW and managed-resolution success tests passed.
  Source: quality-review

- **[F-202a5db7] [RESOLVED in iter 1]** Replayed commands return mutable plain JSON objects instead of frozen, branded domain values. Furthermore, actorId/assertedBy values of 129-255 characters pass envelope and domain validation but fail with an unhandled PostgreSQL 22001 string_data_right_truncation error on insert and violate contract schemas.
  Resolution Evidence: packages/infrastructure/src/postgres/repositories/postgres-coa-report-repository.ts rehydrates and freezes domain entities on receipt replay in createReport (lines 594-600), supersedeReport (lines 819-829), reviewReportRevision (lines 1116-1121), and archiveReport (lines 1308-1316). packages/application/src/use-cases/coa-command-envelope-validator.ts:51 and packages/domain/src/coa-report.ts:182,575 use normalizeAssertedBy (1-128 code points). Verified in packages/domain/src/coa-report.test.ts:468-501 and packages/infrastructure/src/postgres/repositories/postgres-coa-report-repository.integration.test.ts:186-192.
  Source: quality-review

- **[F-2e36ce8d] [RESOLVED in iter 1]** KTD5 and U4 require explicit unit/basis/context/scope resolution, atomic rejection of mixed measurement contexts, and preservation of all analytical qualifiers and provenance in resolution output. Contract omissions and documentation mismatches create ambiguity and fail-open behavior for downstream claim consumers.
  Resolution Evidence: packages/contracts/src/coa-report.ts:228-283 requires requiredUnit, requiredBasis, requiredContext, and requiredScope and includes analyticalQualifierCode, analyticalQualifierExplanation, and verifiedLabIdentityEventId in the resolution schema. packages/infrastructure/src/postgres/repositories/postgres-coa-report-repository.ts:1527,1533,1566,1808-1824,1842 maps those fields, unconditionally rejects !allSame, and aligns reason codes ('report_draft_incomplete', 'report_batch_mismatch', 'report_superseded') with docs/verified-product-evidence-contract-fixtures.md:904-907. docs/CONTEXT.md:45 uses 'pending' and docs/adr/0009-verified-product-batch-evidence-claim-authority.md:185 specifies 'TEXT in SQL'.
  Source: quality-review

- **[F-ac2eb64e] [RESOLVED in iter 3]** The newly added managed transaction cannot resolve any otherwise valid complete source-backed report. This replaces the earlier unlocked behavior with an unavoidable database failure for this supported constructor mode.
  Resolution Evidence: packages/infrastructure/src/postgres/repositories/postgres-coa-report-repository.ts:1594 and :1611 now use BEGIN TRANSACTION ISOLATION LEVEL READ COMMITTED READ WRITE, compatible with FOR SHARE at :1700-1711. :1601-1607 rejects an externalTransaction client without an active transaction. packages/infrastructure/src/postgres/repositories/postgres-coa-report-repository.integration.test.ts:684-855 verifies successful persisted-report resolution using a normal Pool and autocommit PoolClient plus rejection of a misconfigured external transaction. Both scenarios passed in the focused PostgreSQL run.
  Source: spec-review

- **[F-88cf2b4e] [RESOLVED in iter 3]** Reordering source/evidence locks leaves an earlier overlapping inversion. Valid concurrent evidence registration and CoA operations can deadlock before either reaches the corrected source locks, violating the documented common order.
  Resolution Evidence: packages/infrastructure/src/evidence/postgres-evidence-asset-repository.ts:616-632 discovers batch/SKU without a join lock, :634-653 locks and checks SKU first, and :655-670 locks/checks batch and rechecks the discovered SKU identity. Derivative linking likewise discovers links at :1244-1259 then locks sorted SKUs at :1260-1269 before sorted batches at :1272-1281. This matches CoA acquireOrderedLocks at postgres-coa-report-repository.ts:380-392. The registration-versus-CoA scenario at postgres-coa-report-repository.integration.test.ts:968-1093 passed.
  Source: spec-review

```

Deterministic validation evidence:

```
Validation result: passed (fingerprint: d65fd33e9aec)
```



Complete branch diff against base:

```diff
diff --git a/docs/CONTEXT.md b/docs/CONTEXT.md
index e567377..33187a6 100644
--- a/docs/CONTEXT.md
+++ b/docs/CONTEXT.md
@@ -40,8 +40,10 @@
 - **BatchEvidenceLink:** Explicit relational link binding an exact `(evidenceId, evidenceRevision)` to a specific `batchId` with declared purpose. No implicit inheritance from parent SKUs or sibling batches.
 - **EvidenceDerivative:** Relational bridge connecting an `EvidenceRevision` to a visual conditioning `ReferenceAsset` (`packages/domain/src/reference-asset.ts`) with independent SHA-256 digest and transform description.
 - **EvidenceVerificationEvent:** Append-only audit record capturing human review, submitter attestation, or independent third-party corroboration of evidence facts.
-- **CoaReport & CoaReportRevision:** Structured laboratory Certificate of Analysis test report under optimistic version fencing (`version`) and immutable revision records linked to a batch evidence asset, with claimed vs. verified lab identity, sample vs. attributed lot scope, and report date.
-- **CoaMeasurement:** Typed analytical measurement row linked to a specific `CoaReportRevision`, with analyte name, typed decimal result (`quantified`, `below_limit`, `not_detected`), non-empty unit, analytical basis, context, and reported test method. Neither `below_limit` nor `not_detected` may ever be converted into numerical zero ("0", "0.0%"), "Zero", or an exact numerical marketing value.
+- **CoaReport & CoaReportRevision:** Structured laboratory Certificate of Analysis test report under optimistic version fencing (`version`) and immutable revision records linked to a batch evidence asset, with claimed vs. verified lab identity, sample vs. attributed lot scope, report date, explicit completeness status (`draft` or `complete`), and verified sample-to-batch association confirmation and attestation.
+- **CoaMeasurement:** Typed analytical measurement row linked to a specific `CoaReportRevision`, with analyte name, typed decimal result (`quantified`, `below_limit`, `not_detected`), non-empty unit, analytical basis, context, quantity kind, and optional reported test method (`methodAsReported`, nullable when absent from source). Neither `below_limit` nor `not_detected` may ever be converted into numerical zero ("0", "0.0%"), "Zero", or an exact numerical marketing value. Stored and transported as exact string decimal representations (`DecimalString`) preserving trailing zeros with zero IEEE-754 floating-point coercion. Measurement panels are sealed upon revision commit.
+- **CoaReportReviewEvent & Review Status:** Append-only audit record capturing independent compliance review (`approved` or `rejected`) with assessed scope (`sample_only` or `attributed_lot`). Derived status is `pending` until formally reviewed. Self-approval is strictly forbidden: the recorder (`assertedBy`) cannot approve their own report revision.
+- **CoaMeasurementSupportResolution:** Fail-closed evaluation determining whether pinned batch measurements are valid, approved, un-disputed, un-superseded, and active. Fails closed with explicit reason codes if the parent report is unreviewed, draft, disputed, quarantined, or mismatched in unit/context.
 
 - **ProductClaimRevision:** Commercial product statement for a batch declaring claim type, exact copy wording, proof category (`coa_measurement_backed`, `production_record_backed`, `visual_evidence_backed`, `human_attested_unverified`), and optional paired numerical value and unit.
 - **ClaimHead:** Version-fenced mutable pointer for a product claim tracking current revision and lifecycle state (`draft`, `evidence_linked`, `reviewer_approved`, `rejected`, `invalidated`).
diff --git a/docs/adr/0009-verified-product-batch-evidence-claim-authority.md b/docs/adr/0009-verified-product-batch-evidence-claim-authority.md
index df38f4d..4c5cb01 100644
--- a/docs/adr/0009-verified-product-batch-evidence-claim-authority.md
+++ b/docs/adr/0009-verified-product-batch-evidence-claim-authority.md
@@ -182,13 +182,24 @@ erDiagram
   - `labNameAsClaimed`: Name of the laboratory reported on the document.
   - `verifiedLabIdentityEventId`: Optional foreign key to an `EvidenceVerificationEvent` corroborating accredited laboratory identity and accreditation license. The referenced verification event must belong to the same client, evidence asset, and evidence revision (`outcome = 'verified'`, `fact_scope = 'lab_identity'`, `verification_kind = 'independent_third_party_corroboration'`).
 - **Strict Decimal Representations (`CoaMeasurement`):**
-  - All numerical measurements are stored as **exact decimal strings** conforming to `^-?(0|[1-9][0-9]*)(\.[0-9]+)?$`. Floating-point numbers (`NUMERIC` in SQL, `string` in TypeScript; never IEEE 754 `number`) are mandatory to eliminate rounding and scale loss.
+  - All numerical measurements are stored as **exact decimal strings** conforming to `^-?(0|[1-9][0-9]*)(\.[0-9]+)?$`. Exact decimal representations (`TEXT` in SQL, `string` in TypeScript; never IEEE 754 `number`) are mandatory to eliminate rounding and scale loss.
   - **Typed Result Union:**
     - `quantified`: Exact measured value (`value: DecimalString`).
     - `below_limit`: Below limit of quantification (`limit: DecimalString`, `qualifier: "lt" | "lte"`).
     - `not_detected`: Analyte was not detected by the analytical instrument.
   - **Mandatory Units & Context:** Every measurement row requires non-empty strings for `analyte` (e.g., `thc_total`, `myrcene`), `unit` (e.g., `percent_w_w`, `mg_per_g`, `ppm`), `basis` (e.g., `dry_weight`, `as_received`), and `context` (e.g., `finished_inflorescence`, `extract`). Ambiguous or unitless measurements fail closed.
+  - **Exact Decimal String Storage (`TEXT`):** All analytical numbers (measurements, limits, uncertainties) are stored as verbatim decimal strings conforming to `^-?(0|[1-9][0-9]*)(\.[0-9]+)?$` with zero IEEE-754 floating-point coercion, preserving trailing precision zeros.
+  - **Reported Methods & Analytical Qualifiers:** `methodAsReported` is optional and nullable (transcribed verbatim when reported; left null rather than fabricating a placeholder). Analytical qualifiers (e.g. `negative_as_reported`) require non-blank analytical explanations and remain unsupported for positive numerical claims until explicitly governed.
+  - **Measurement Panel Sealing:** The measurement set is sealed upon revision commit; additions to an approved or committed revision require creating a new revision.
   - **Lineage Integrity:** Measurements inherit and mechanically enforce the exact `(batch_id, evidence_id, evidence_revision)` of their parent `CoaReportRevision`.
+- **Completeness & Draft States (`completenessStatus`):**
+  - `draft`: Incomplete metadata or preliminary staging; cannot be approved or satisfy measurement support resolution for downstream claims.
+  - `complete`: All claimed report identifiers, report date, lab name, sample-to-batch association confirmation, and at least one valid measurement row are provided.
+- **Independent Compliance Review & Non-Self-Approval (`CoaReportReviewEvent`):**
+  - Transcription and compliance review are strictly separated authorities. A compliance reviewer cannot approve their own recorded report revision (`assertedBy`).
+  - Assessed scope cannot exceed report scope (`sample_only` reports cannot be approved as `attributed_lot`).
+- **Fail-Closed Pinned Measurement Support Resolution:**
+  - Downstream callers specify explicit report revision and measurement IDs (`resolveMeasurementSupport`). Support fails closed if the report is unreviewed, draft, disputed, quarantined, superseded, archived, or mismatched in requested unit, basis, or context. Pinned callers are never silently redirected to a "latest" report.
 
 #### 2.8 ProductClaimRevision and ClaimSourceLink
 - **Claim Types:**
@@ -623,7 +634,7 @@ export interface CoaMeasurement {
   readonly unit: string;
   readonly basis: string;
   readonly context: string;
-  readonly methodAsReported: string;
+  readonly methodAsReported: string | null;
 }
 
 export interface ProductClaim {
@@ -1042,15 +1053,19 @@ CREATE TABLE coa_report_revisions (
   batch_id UUID NOT NULL,
   evidence_id UUID NOT NULL,
   evidence_revision INT NOT NULL,
-  report_identifier_as_claimed VARCHAR(128) NOT NULL,
-  report_date DATE NOT NULL,
-  lab_name_as_claimed VARCHAR(255) NOT NULL,
-  sample_identifier_as_claimed VARCHAR(128) NOT NULL,
-  scope_kind VARCHAR(32) NOT NULL
-    CHECK (scope_kind IN ('sample_only', 'attributed_lot')),
-  scope_description TEXT NOT NULL,
+  completeness_status VARCHAR(16) NOT NULL DEFAULT 'draft'
+    CHECK (completeness_status IN ('draft', 'complete')),
+  report_identifier_as_claimed VARCHAR(128),
+  report_date DATE,
+  lab_name_as_claimed VARCHAR(255),
+  sample_identifier_as_claimed VARCHAR(128),
+  scope_kind VARCHAR(32)
+    CHECK (scope_kind IS NULL OR scope_kind IN ('sample_only', 'attributed_lot')),
+  scope_description TEXT,
   sample_date DATE,
   sampling_method_description TEXT,
+  sample_to_batch_association_attestation TEXT,
+  sample_to_batch_association_confirmed BOOLEAN,
   verified_lab_identity_event_id UUID,
   asserted_by VARCHAR(128) NOT NULL,
   asserted_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
@@ -1067,7 +1082,7 @@ CREATE TABLE coa_report_revisions (
     REFERENCES coa_report_revisions(client_id, report_id, revision) ON DELETE RESTRICT,
   CONSTRAINT chk_coa_report_rev_monotonic CHECK (
     (revision = 1 AND supersedes_revision IS NULL) OR
-    (revision > 1 AND supersedes_revision IS NOT NULL AND supersedes_revision < revision)
+    (revision > 1 AND supersedes_revision IS NOT NULL AND supersedes_revision = revision - 1)
   ),
   CONSTRAINT uq_coa_report_rev_predecessor UNIQUE (client_id, report_id, supersedes_revision)
 );
@@ -1096,7 +1111,11 @@ CREATE TABLE coa_measurements (
   unit VARCHAR(64) NOT NULL,
   basis VARCHAR(64) NOT NULL,
   context VARCHAR(64) NOT NULL,
-  method_as_reported VARCHAR(128) NOT NULL,
+  quantity_kind VARCHAR(64) NOT NULL,
+  method_as_reported VARCHAR(128),
+  uncertainty_absolute TEXT,
+  detection_limit TEXT,
+  quantification_limit TEXT,
   CONSTRAINT uq_coa_measurements_full UNIQUE (client_id, report_id, report_revision, measurement_id),
   CONSTRAINT uq_coa_measurements_lineage UNIQUE (client_id, report_id, report_revision, measurement_id, batch_id, evidence_id, evidence_revision),
   CONSTRAINT fk_coa_measurements_report FOREIGN KEY (client_id, report_id, report_revision, batch_id, evidence_id, evidence_revision)
@@ -1118,6 +1137,27 @@ CREATE TABLE coa_measurements (
 CREATE INDEX idx_coa_measurements_analyte
   ON coa_measurements(client_id, report_id, report_revision, analyte);
 
+CREATE TABLE coa_report_review_events (
+  event_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
+  client_id UUID NOT NULL,
+  report_id UUID NOT NULL,
+  report_revision INT NOT NULL CHECK (report_revision > 0),
+  decision VARCHAR(16) NOT NULL
+    CHECK (decision IN ('approved', 'rejected')),
+  actor_id VARCHAR(128) NOT NULL,
+  occurred_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
+  reason TEXT NOT NULL,
+  assessed_scope VARCHAR(32) NOT NULL
+    CHECK (assessed_scope IN ('sample_only', 'attributed_lot')),
+  CONSTRAINT uq_coa_review_events_client_event UNIQUE (client_id, event_id),
+  CONSTRAINT uq_coa_review_events_decision_per_rev UNIQUE (client_id, report_id, report_revision),
+  CONSTRAINT fk_coa_review_events_revision FOREIGN KEY (client_id, report_id, report_revision)
+    REFERENCES coa_report_revisions(client_id, report_id, revision) ON DELETE RESTRICT
+);
+
+CREATE INDEX idx_coa_review_events_revision
+  ON coa_report_review_events(client_id, report_id, report_revision);
+
 -- ---------------------------------------------------------------------------
 -- 9. PRODUCT CLAIMS, REVISIONS & SOURCE LINKS
 -- ---------------------------------------------------------------------------
@@ -1506,47 +1546,65 @@ export interface IngestCoaMeasurementInput {
   readonly unit: string;
   readonly basis: string;
   readonly context: string;
-  readonly methodAsReported: string;
+  readonly quantityKind: string;
+  readonly methodAsReported: string | null;
+  readonly uncertaintyAbsolute?: DecimalString | null;
+  readonly detectionLimit?: DecimalString | null;
+  readonly quantificationLimit?: DecimalString | null;
+  readonly analyticalQualifierCode?: string | null;
+  readonly analyticalQualifierExplanation?: string | null;
 }
 
 export interface CreateCoaReportCommand {
+  readonly reportId?: CoaReportId;
   readonly batchId: BatchId;
   readonly evidenceId: EvidenceId;
   readonly evidenceRevision: number;
-  readonly reportIdentifierAsClaimed: string;
-  readonly reportDate: DateOnlyString;
-  readonly labNameAsClaimed: string;
-  readonly sampleIdentifierAsClaimed: string;
-  readonly scopeKind: CoaScopeKind;
-  readonly scopeDescription: string;
-  readonly sampleDate: DateOnlyString | null;
-  readonly samplingMethodDescription: string | null;
-  readonly verifiedLabIdentityEventId: VerificationEventId | null;
+  readonly completenessStatus: "draft" | "complete";
+  readonly reportIdentifierAsClaimed?: string | null;
+  readonly reportDate?: DateOnlyString | null;
+  readonly labNameAsClaimed?: string | null;
+  readonly sampleIdentifierAsClaimed?: string | null;
+  readonly scopeKind?: CoaScopeKind | null;
+  readonly scopeDescription?: string | null;
+  readonly sampleDate?: DateOnlyString | null;
+  readonly samplingMethodDescription?: string | null;
+  readonly sampleToBatchAssociationConfirmed?: boolean | null;
+  readonly sampleToBatchAssociationAttestation?: string | null;
+  readonly verifiedLabIdentityEventId?: VerificationEventId | null;
   readonly measurements: readonly IngestCoaMeasurementInput[];
 }
 
 export interface SupersedeCoaReportCommand {
   readonly reportId: CoaReportId;
   readonly expectedVersion: number;
-  readonly batchId: BatchId;
-  readonly evidenceId: EvidenceId;
   readonly evidenceRevision: number;
-  readonly reportIdentifierAsClaimed: string;
-  readonly reportDate: DateOnlyString;
-  readonly labNameAsClaimed: string;
-  readonly sampleIdentifierAsClaimed: string;
-  readonly scopeKind: CoaScopeKind;
-  readonly scopeDescription: string;
-  readonly sampleDate: DateOnlyString | null;
-  readonly samplingMethodDescription: string | null;
-  readonly verifiedLabIdentityEventId: VerificationEventId | null;
+  readonly completenessStatus: "draft" | "complete";
+  readonly reportIdentifierAsClaimed?: string | null;
+  readonly reportDate?: DateOnlyString | null;
+  readonly labNameAsClaimed?: string | null;
+  readonly sampleIdentifierAsClaimed?: string | null;
+  readonly scopeKind?: CoaScopeKind | null;
+  readonly scopeDescription?: string | null;
+  readonly sampleDate?: DateOnlyString | null;
+  readonly samplingMethodDescription?: string | null;
+  readonly sampleToBatchAssociationConfirmed?: boolean | null;
+  readonly sampleToBatchAssociationAttestation?: string | null;
+  readonly verifiedLabIdentityEventId?: VerificationEventId | null;
   readonly measurements: readonly IngestCoaMeasurementInput[];
 }
 
-export interface DisputeCoaReportCommand {
+export interface ReviewCoaReportCommand {
   readonly reportId: CoaReportId;
   readonly expectedVersion: number;
+  readonly decision: "approved" | "rejected";
   readonly reason: string;
+  readonly assessedScope: CoaScopeKind;
+}
+
+export interface ArchiveCoaReportCommand {
+  readonly reportId: CoaReportId;
+  readonly expectedVersion: number;
 }
 
 export type CreateClaimCommand =
diff --git a/docs/verified-product-evidence-contract-fixtures.md b/docs/verified-product-evidence-contract-fixtures.md
index 8c696d2..cd56a56 100644
--- a/docs/verified-product-evidence-contract-fixtures.md
+++ b/docs/verified-product-evidence-contract-fixtures.md
@@ -900,3 +900,8 @@ The following matrix documents the complete set of negative invariants, integrit
 | **CE-13A**| **Concurrent Approve vs. Supersede (Supersede Commits First)** | Reviewer attempts to approve claim Rev 1 while Submitter concurrently supersedes CoA Rev 1. | Supersede transaction commits first (advancing CoA head to Rev 2 and invalidating claim Rev 1). Approve transaction acquires locks and executes pre-commit dependency check. | Approve transaction detects underlying CoA report revision is no longer current and claim state is `invalidated`. Aborts immediately with HTTP 409 `SOURCE_SUPERSEDED`. Zero orphaned approvals. |
 | **CE-13B**| **Concurrent Approve vs. Supersede (Approve Commits First)** | Reviewer attempts to approve claim Rev 1 while Submitter concurrently supersedes CoA Rev 1. | Approve transaction commits first (transitioning claim Rev 1 to `reviewer_approved`). Supersede transaction acquires locks, appends Rev 2, queries dependent claims, finds approved claim Rev 1. | Supersede transaction appends invalidation `ClaimDecisionEvent` and updates claim head to `invalidated`. In both commit orders, committed state is deterministic and no superseded claim remains approved. |
 | **CE-14** | **Attributed Process Claim Without CoA** | Batch facts record living soil cultivation supported by cultivation log `process_record`. | Submitter creates `cultivation_process` claim ("Cultivated in Living Organic Soil") linked to log. | Permitted by policy matrix (`proofCategory = "production_record_backed"`). Human reviewer approves based on process logs without requiring a laboratory CoA. |
+| **CE-15** | **Self-Approval Forbidden** | Submitter / technician `compliance-officer` recorded CoA Report Revision 1 (`assertedBy = "compliance-officer"`). | Same actor `compliance-officer` submits `reviewReportRevision(decision: 'approved')`. | Application and domain layer reject with HTTP 403 `ACCESS_DENIED` ("Self-approval forbidden: reviewer cannot be the recorder who asserted this report revision"). Transcription and review must remain distinct human actors. |
+| **CE-16** | **Draft Report Support Denial** | Submitter staged an incomplete CoA report with `completenessStatus = 'draft'`. | Caller attempts to approve draft (`reviewReportRevision`) or resolve measurement support for a claim (`resolveMeasurementSupport`). | Both operations fail closed: `createCoaReportReviewEvent` throws `ProductValidationError` ("Cannot approve a draft CoA report"); `resolveMeasurementSupport` returns `isSupported = false, reason = 'report_draft_incomplete'`. |
+| **CE-17** | **Exact Decimal String Roundtrip & Precision Preservation** | Submitter records analytical measurement with 4-decimal precision `result_value = "24.5000"` and `uncertainty_absolute = "0.2500"`. | System persists to `coa_measurements`, computes command receipt SHA-256, reads from database, and formats API JSON response. | Exact string `"24.5000"` is preserved byte-for-byte across SQL parameter, storage, domain entity, and JSON serialization. Zero IEEE-754 floating-point coercion, zero loss of trailing zeros, zero decimal reformatting. |
+| **CE-18** | **Cross-Batch Measurement Isolation** | Same client owns SKU-1 with Lot A (`BATCH_LOT_A_ID`, total terpenes `2.85%`) and Lot B (`BATCH_LOT_B_ID`, total terpenes `1.40%`). | Caller invokes `resolveMeasurementSupport` providing Lot B's batch ID with Lot A's CoA report ID. | Fails closed with `isSupported = false, reason = 'report_batch_mismatch'`. Analytical measurements never bleed across batches of the same SKU. |
+| **CE-19** | **Pinned Measurement Support Supersession Invalidation** | Downstream claim query is pinned to CoA Report Revision 1. | Submitter records superseding CoA Report Revision 2 (`supersedeCoaReport`). | `resolveMeasurementSupport` evaluates target revision against current head revision (2 > 1), returning `isSupported = false, reason = 'report_superseded'`. Pinned queries fail closed rather than silently substituting superseded analytical facts. |
diff --git a/packages/application/src/ports/index.ts b/packages/application/src/ports/index.ts
index 8b0e8fc..16b8f65 100644
--- a/packages/application/src/ports/index.ts
+++ b/packages/application/src/ports/index.ts
@@ -56,3 +56,5 @@ export * from "./originals-inspection-port.js";
 export * from "./evidence-storage-policy.js";
 export * from "./evidence-lock-coordinator.js";
 export * from "./evidence-asset-repository.js";
+export * from "./coa-report-repository.js";
+export * from "./reviewer-authorization-port.js";
diff --git a/packages/application/src/ports/unit-of-work.ts b/packages/application/src/ports/unit-of-work.ts
index 440ad3a..f0658d6 100644
--- a/packages/application/src/ports/unit-of-work.ts
+++ b/packages/application/src/ports/unit-of-work.ts
@@ -10,6 +10,7 @@ import type { ReferenceAssetRepository } from "./reference-asset-repository.js";
 import type { ReferenceGroupRepository } from "./reference-group-repository.js";
 import type { ProductEvidenceRepositoryPort } from "./product-evidence-repository.js";
 import type { EvidenceAssetRepositoryPort } from "./evidence-asset-repository.js";
+import type { CoaReportRepositoryPort } from "./coa-report-repository.js";
 import type { ReviewEventStore } from "./review-event-store.js";
 import type { SceneRepository } from "./scene-repository.js";
 import type { ShotPlanRepository } from "./shot-plan-repository.js";
@@ -31,6 +32,7 @@ export interface UnitOfWorkContext {
   readonly campaignReferenceBible?: CampaignReferenceBibleRepository | undefined;
   readonly productEvidence?: ProductEvidenceRepositoryPort | undefined;
   readonly evidenceAsset?: EvidenceAssetRepositoryPort | undefined;
+  readonly coaReports?: CoaReportRepositoryPort | undefined;
 }
 
 export interface UnitOfWork {
diff --git a/packages/application/src/use-cases/index.ts b/packages/application/src/use-cases/index.ts
index 9eaba9c..66213a6 100644
--- a/packages/application/src/use-cases/index.ts
+++ b/packages/application/src/use-cases/index.ts
@@ -84,3 +84,9 @@ export * from "./product-registry-use-cases.js";
 export * from "./register-evidence-asset.js";
 export * from "./link-existing-derivative.js";
 export * from "./record-evidence-verification-event.js";
+export * from "./coa-command-envelope-validator.js";
+export * from "./create-coa-report.js";
+export * from "./supersede-coa-report.js";
+export * from "./review-coa-report.js";
+export * from "./archive-coa-report.js";
+export * from "./resolve-coa-measurement-support.js";
diff --git a/packages/contracts/src/index.ts b/packages/contracts/src/index.ts
index 961abce..da754b2 100644
--- a/packages/contracts/src/index.ts
+++ b/packages/contracts/src/index.ts
@@ -43,3 +43,4 @@ export * from "./product-evidence-command.js";
 export * from "./product-sku.js";
 export * from "./product-batch.js";
 export * from "./evidence-asset.js";
+export * from "./coa-report.js";
diff --git a/packages/domain/src/identifiers.ts b/packages/domain/src/identifiers.ts
index c23b1c6..9d613fc 100644
--- a/packages/domain/src/identifiers.ts
+++ b/packages/domain/src/identifiers.ts
@@ -23,6 +23,9 @@ export type SourceObjectId = Brand<string, "SourceObjectId">;
 export type DerivativeId = Brand<string, "DerivativeId">;
 export type VerificationEventId = Brand<string, "VerificationEventId">;
 export type ActionId = Brand<string, "ActionId">;
+export type CoaReportId = Brand<string, "CoaReportId">;
+export type CoaMeasurementId = Brand<string, "CoaMeasurementId">;
+export type CoaReviewEventId = Brand<string, "CoaReviewEventId">;
 
 /** Lowercase 64-hex SHA-256 digest string */
 export type Sha256Hex = string & { readonly __sha256: true };
@@ -79,6 +82,18 @@ export function createActionId(val: string): ActionId {
   return validateAndBrandUuid(val, "ActionId", "actionId");
 }
 
+export function createCoaReportId(val: string): CoaReportId {
+  return validateAndBrandUuid(val, "CoaReportId", "reportId");
+}
+
+export function createCoaMeasurementId(val: string): CoaMeasurementId {
+  return validateAndBrandUuid(val, "CoaMeasurementId", "measurementId");
+}
+
+export function createCoaReviewEventId(val: string): CoaReviewEventId {
+  return validateAndBrandUuid(val, "CoaReviewEventId", "eventId");
+}
+
 export function createSha256Hex(val: string): Sha256Hex {
   if (typeof val !== "string" || !/^[0-9a-f]{64}$/.test(val)) {
     throw new ProductValidationError(
diff --git a/packages/domain/src/index.ts b/packages/domain/src/index.ts
index eaa895e..217e7ad 100644
--- a/packages/domain/src/index.ts
+++ b/packages/domain/src/index.ts
@@ -20,3 +20,5 @@ export * from "./batch-facts.js";
 export * from "./product-batch.js";
 export * from "./source-object.js";
 export * from "./evidence-asset.js";
+export * from "./coa-measurement.js";
+export * from "./coa-report.js";
diff --git a/packages/infrastructure/src/evidence/postgres-evidence-asset-repository.test.ts b/packages/infrastructure/src/evidence/postgres-evidence-asset-repository.test.ts
index 979f378..114b16e 100644
--- a/packages/infrastructure/src/evidence/postgres-evidence-asset-repository.test.ts
+++ b/packages/infrastructure/src/evidence/postgres-evidence-asset-repository.test.ts
@@ -61,9 +61,64 @@ describe("PostgresEvidenceAssetRepository unit tests", () => {
   function createMockPoolClient(
     handler: (normSql: string, params?: unknown[]) => Promise<{ rows: Record<string, unknown>[] }>
   ) {
+    let lastSkuArchivedAt: Date | null | undefined;
+    let lastBatchArchivedAt: Date | null | undefined;
+
     return {
       query: vi.fn(async (sql: string, params?: unknown[]) => {
-        return await handler(normalizeSql(sql), params);
+        const norm = normalizeSql(sql);
+        const result = await handler(norm, params);
+
+        if (result.rows.length > 0) {
+          if ("sku_archived_at" in result.rows[0]!) {
+            lastSkuArchivedAt = result.rows[0]!.sku_archived_at as Date | null;
+          }
+          if ("batch_archived_at" in result.rows[0]!) {
+            lastBatchArchivedAt = result.rows[0]!.batch_archived_at as Date | null;
+          }
+        }
+
+        const lower = norm.toLowerCase();
+        if (lower.includes("from product_skus") && result.rows.length === 0) {
+          const skuId = (params?.[1] as string) || "018f0000-0000-7000-8000-000000000005";
+          return {
+            rows: [
+              {
+                sku_id: skuId,
+                archived_at: lastSkuArchivedAt ?? null
+              }
+            ]
+          };
+        }
+
+        if (
+          lower.includes("from product_batches") &&
+          lower.includes("for") &&
+          result.rows.length === 0
+        ) {
+          const bId = (params?.[1] as string) || "018f0000-0000-7000-8000-000000000002";
+          return {
+            rows: [
+              {
+                batch_id: bId,
+                archived_at: lastBatchArchivedAt ?? null,
+                sku_id: (params?.[1] as string) || "018f0000-0000-7000-8000-000000000005"
+              }
+            ]
+          };
+        }
+
+        if (lower.includes("from batch_evidence_links") && result.rows.length > 0) {
+          return {
+            rows: result.rows.map((r) => ({
+              batch_id: r.batch_id ?? "018f0000-0000-7000-8000-000000000002",
+              sku_id: r.sku_id ?? "018f0000-0000-7000-8000-000000000005",
+              ...r
+            }))
+          };
+        }
+
+        return result;
       }),
       getTransactionStatus: vi.fn(() => "T"),
       release: vi.fn()
@@ -547,6 +602,39 @@ describe("PostgresEvidenceAssetRepository unit tests", () => {
         if (sql.includes("product_evidence_command_receipts")) {
           return { rows: [] };
         }
+        if (sql.includes("evidence_revisions")) {
+          return {
+            rows: [
+              {
+                client_id: clientId,
+                evidence_id: evidenceId,
+                revision: 1,
+                source_object_id: sourceObjectId
+              }
+            ]
+          };
+        }
+        if (sql.includes("batch_evidence_links")) {
+          return {
+            rows: [
+              {
+                sku_archived_at: null,
+                batch_archived_at: null
+              }
+            ]
+          };
+        }
+        if (sql.includes("source_objects")) {
+          return {
+            rows: [
+              {
+                source_object_id: sourceObjectId,
+                client_id: clientId,
+                availability: "available"
+              }
+            ]
+          };
+        }
         if (sql.includes("evidence_assets")) {
           return {
             rows: [
diff --git a/packages/infrastructure/src/evidence/postgres-evidence-asset-repository.ts b/packages/infrastructure/src/evidence/postgres-evidence-asset-repository.ts
index 5c2606b..a369f71 100644
--- a/packages/infrastructure/src/evidence/postgres-evidence-asset-repository.ts
+++ b/packages/infrastructure/src/evidence/postgres-evidence-asset-repository.ts
@@ -613,17 +613,50 @@ export class PostgresEvidenceAssetRepository implements EvidenceAssetRepositoryP
         };
       }
 
-      // 1. Lock and verify batch and SKU rows
+      // 1. Discover batch and SKU without locking to maintain strict lock hierarchy: SKU -> Batch
+      const batchDiscovery = await client.query<{
+        batch_id: string;
+        sku_id: string;
+      }>(
+        `SELECT batch_id, sku_id
+         FROM product_batches
+         WHERE client_id = $1 AND batch_id = $2`,
+        [cmd.clientId, cmd.payload.batchId]
+      );
+      if (batchDiscovery.rows.length === 0) {
+        throw new NotFoundError("ProductBatch", cmd.payload.batchId);
+      }
+      const discoveredSkuId = batchDiscovery.rows[0]!.sku_id;
+
+      // Lock SKU FOR UPDATE first
+      const skuRes = await client.query<{
+        sku_id: string;
+        archived_at: Date | null;
+      }>(
+        `SELECT sku_id, archived_at
+         FROM product_skus
+         WHERE client_id = $1 AND sku_id = $2 FOR UPDATE`,
+        [cmd.clientId, discoveredSkuId]
+      );
+      if (skuRes.rows.length === 0) {
+        throw new NotFoundError("ProductSku", discoveredSkuId);
+      }
+      if (skuRes.rows[0]!.archived_at !== null) {
+        throw new AccessDeniedError(
+          "Cannot link evidence to a batch under an archived SKU",
+          "SKU_ARCHIVED"
+        );
+      }
+
+      // Lock Batch FOR UPDATE second
       const batchRes = await client.query<{
         batch_id: string;
         archived_at: Date | null;
         sku_id: string;
-        sku_archived_at: Date | null;
       }>(
-        `SELECT b.batch_id, b.archived_at, s.sku_id, s.archived_at AS sku_archived_at
-         FROM product_batches b
-         JOIN product_skus s ON s.client_id = b.client_id AND s.sku_id = b.sku_id
-         WHERE b.client_id = $1 AND b.batch_id = $2 FOR UPDATE OF b, s`,
+        `SELECT batch_id, archived_at, sku_id
+         FROM product_batches
+         WHERE client_id = $1 AND batch_id = $2 FOR UPDATE`,
         [cmd.clientId, cmd.payload.batchId]
       );
       if (batchRes.rows.length === 0) {
@@ -632,11 +665,75 @@ export class PostgresEvidenceAssetRepository implements EvidenceAssetRepositoryP
       if (batchRes.rows[0]!.archived_at !== null) {
         throw new AccessDeniedError("Cannot link evidence to an archived batch", "BATCH_ARCHIVED");
       }
-      if (batchRes.rows[0]!.sku_archived_at !== null) {
-        throw new AccessDeniedError(
-          "Cannot link evidence to a batch under an archived SKU",
-          "SKU_ARCHIVED"
+      if (batchRes.rows[0]!.sku_id !== discoveredSkuId) {
+        throw new ConcurrencyConflictError("Batch SKU association changed concurrently.");
+      }
+
+      // Pre-lock discovery for supersession to maintain canonical order: Source (sorted) -> Evidence
+      let oldSourceObjectId: string | undefined;
+      let targetAsset: EvidenceAsset | undefined;
+      if (cmd.payload.registrationIntent === "supersede") {
+        if (!cmd.payload.targetEvidenceId || cmd.payload.expectedEvidenceVersion === undefined) {
+          throw new ProductValidationError([
+            {
+              code: "INVALID_FIELD_COMBINATION",
+              path: ["targetEvidenceId"],
+              message: "targetEvidenceId and expectedEvidenceVersion are required for supersede."
+            }
+          ]);
+        }
+
+        const preLockRevRes = await client.query<{ source_object_id: string }>(
+          `SELECT r.source_object_id
+           FROM evidence_assets a
+           JOIN evidence_revisions r ON r.client_id = a.client_id AND r.evidence_id = a.evidence_id AND r.revision = a.current_revision
+           WHERE a.client_id = $1 AND a.evidence_id = $2`,
+          [cmd.clientId, cmd.payload.targetEvidenceId]
+        );
+        oldSourceObjectId = preLockRevRes.rows[0]?.source_object_id;
+
+        // Discover candidate replacement source object ID without locking
+        let candidateReplacementSourceId: string | undefined = cmd.payload.reusedSourceObjectId;
+        if (!candidateReplacementSourceId) {
+          const existingSourceCheck = await client.query<{ source_object_id: string }>(
+            `SELECT source_object_id FROM source_objects
+             WHERE client_id = $1 AND original_sha256 = $2`,
+            [cmd.clientId, cmd.payload.originalSha256]
+          );
+          candidateReplacementSourceId = existingSourceCheck.rows[0]?.source_object_id;
+        }
+
+        // Lock all involved source objects in canonical sorted order before locking evidence_assets
+        const sourceIdsToLock = Array.from(
+          new Set([oldSourceObjectId, candidateReplacementSourceId].filter(Boolean) as string[])
+        ).sort();
+        for (const sId of sourceIdsToLock) {
+          await client.query(
+            `SELECT 1 FROM source_objects WHERE client_id = $1 AND source_object_id = $2 FOR UPDATE`,
+            [cmd.clientId, sId]
+          );
+        }
+
+        // Lock target evidence asset
+        const targetRes = await client.query<EvidenceAssetRow>(
+          `SELECT * FROM evidence_assets
+           WHERE client_id = $1 AND evidence_id = $2 FOR UPDATE`,
+          [cmd.clientId, cmd.payload.targetEvidenceId]
         );
+        if (targetRes.rows.length === 0) {
+          throw new NotFoundError("EvidenceAsset", cmd.payload.targetEvidenceId);
+        }
+        targetAsset = mapRowToEvidenceAsset(targetRes.rows[0]!);
+        if (targetAsset.archivedAt !== null) {
+          throw new AccessDeniedError("Archived evidence asset cannot be superseded.");
+        }
+        if (targetAsset.version !== cmd.payload.expectedEvidenceVersion) {
+          throw new StaleRevisionConflictError(
+            "EvidenceAsset",
+            cmd.payload.expectedEvidenceVersion,
+            targetAsset.version
+          );
+        }
       }
 
       // 2. Resolve or insert SourceObject
@@ -886,35 +983,8 @@ export class PostgresEvidenceAssetRepository implements EvidenceAssetRepositoryP
         );
         evidenceRevision = mapRowToEvidenceRevision(revRes.rows[0]!);
       } else if (cmd.payload.registrationIntent === "supersede") {
-        if (!cmd.payload.targetEvidenceId || cmd.payload.expectedEvidenceVersion === undefined) {
-          throw new ProductValidationError([
-            {
-              code: "INVALID_FIELD_COMBINATION",
-              path: ["targetEvidenceId"],
-              message: "targetEvidenceId and expectedEvidenceVersion are required for supersede."
-            }
-          ]);
-        }
-
-        // Lock target evidence asset
-        const targetRes = await client.query<EvidenceAssetRow>(
-          `SELECT * FROM evidence_assets
-         WHERE client_id = $1 AND evidence_id = $2 FOR UPDATE`,
-          [cmd.clientId, cmd.payload.targetEvidenceId]
-        );
-        if (targetRes.rows.length === 0) {
-          throw new NotFoundError("EvidenceAsset", cmd.payload.targetEvidenceId);
-        }
-        const targetAsset = mapRowToEvidenceAsset(targetRes.rows[0]!);
-        if (targetAsset.archivedAt !== null) {
-          throw new AccessDeniedError("Archived evidence asset cannot be superseded.");
-        }
-        if (targetAsset.version !== cmd.payload.expectedEvidenceVersion) {
-          throw new StaleRevisionConflictError(
-            "EvidenceAsset",
-            cmd.payload.expectedEvidenceVersion,
-            targetAsset.version
-          );
+        if (!targetAsset) {
+          throw new Error("Illegal state: targetAsset not loaded for supersede intent");
         }
 
         // Check if the target evidence asset has an active dispute across any revisions
@@ -1157,7 +1227,72 @@ export class PostgresEvidenceAssetRepository implements EvidenceAssetRepositoryP
         return rehydrateEvidenceDerivative(result);
       }
 
-      // Verify EvidenceAsset exists, belongs to client, and is not archived
+      // Discover lineage before locking to ensure canonical lock order: SKU -> Batch -> Source -> Evidence
+      const discoveryRevRes = await client.query<{ source_object_id: string }>(
+        `SELECT source_object_id FROM evidence_revisions
+         WHERE client_id = $1 AND evidence_id = $2 AND revision = $3`,
+        [cmd.clientId, cmd.payload.evidenceId, cmd.payload.evidenceRevision]
+      );
+      if (discoveryRevRes.rows.length === 0) {
+        throw new NotFoundError(
+          "EvidenceRevision",
+          `${cmd.payload.evidenceId}:${cmd.payload.evidenceRevision}`
+        );
+      }
+      const discoveredSourceObjectId = discoveryRevRes.rows[0]!.source_object_id;
+
+      // Discover lineage before locking to ensure canonical lock order: SKU -> Batch -> Source -> Evidence
+      const linkBatchRes = await client.query<{
+        batch_id: string;
+        sku_id: string;
+      }>(
+        `SELECT l.batch_id, b.sku_id
+         FROM batch_evidence_links l
+         JOIN product_batches b ON b.client_id = l.client_id AND b.batch_id = l.batch_id
+         WHERE l.client_id = $1 AND l.evidence_id = $2 AND l.evidence_revision = $3`,
+        [cmd.clientId, cmd.payload.evidenceId, cmd.payload.evidenceRevision]
+      );
+      if (linkBatchRes.rows.length === 0) {
+        throw new NotFoundError("ProductBatch", "Associated batch link not found");
+      }
+
+      // Explicitly lock SKU first FOR SHARE
+      const skuIds = [...new Set(linkBatchRes.rows.map((r) => r.sku_id))].sort();
+      for (const sId of skuIds) {
+        const skuLockRes = await client.query<{ archived_at: Date | null }>(
+          `SELECT archived_at FROM product_skus WHERE client_id = $1 AND sku_id = $2 FOR SHARE`,
+          [cmd.clientId, sId]
+        );
+        if (skuLockRes.rows.length === 0 || skuLockRes.rows[0]!.archived_at !== null) {
+          throw new AccessDeniedError("Associated SKU is archived.", "SKU_ARCHIVED");
+        }
+      }
+
+      // Explicitly lock Batch second FOR SHARE
+      const batchIds = [...new Set(linkBatchRes.rows.map((r) => r.batch_id))].sort();
+      for (const bId of batchIds) {
+        const batchLockRes = await client.query<{ archived_at: Date | null }>(
+          `SELECT archived_at FROM product_batches WHERE client_id = $1 AND batch_id = $2 FOR SHARE`,
+          [cmd.clientId, bId]
+        );
+        if (batchLockRes.rows.length === 0 || batchLockRes.rows[0]!.archived_at !== null) {
+          throw new AccessDeniedError("Associated batch is archived.", "BATCH_ARCHIVED");
+        }
+      }
+
+      // Next lock source_objects row FOR UPDATE
+      const sourceRes = await client.query<SourceObjectRow>(
+        `SELECT * FROM source_objects WHERE client_id = $1 AND source_object_id = $2 FOR UPDATE`,
+        [cmd.clientId, discoveredSourceObjectId]
+      );
+      if (sourceRes.rows.length === 0 || sourceRes.rows[0]!.availability !== "available") {
+        throw new AccessDeniedError(
+          "Underlying source object is unavailable.",
+          "SOURCE_UNAVAILABLE"
+        );
+      }
+
+      // Next lock evidence_assets row FOR UPDATE
       const assetRes = await client.query<EvidenceAssetRow>(
         `SELECT * FROM evidence_assets
          WHERE client_id = $1 AND evidence_id = $2 FOR UPDATE`,
@@ -1183,7 +1318,7 @@ export class PostgresEvidenceAssetRepository implements EvidenceAssetRepositoryP
         );
       }
 
-      // Verify EvidenceRevision exists
+      // Lock EvidenceRevision row FOR UPDATE
       const revRes = await client.query<EvidenceRevisionRow>(
         `SELECT * FROM evidence_revisions
          WHERE client_id = $1 AND evidence_id = $2 AND revision = $3 FOR UPDATE`,
@@ -1196,41 +1331,6 @@ export class PostgresEvidenceAssetRepository implements EvidenceAssetRepositoryP
         );
       }
 
-      // Verify associated batch and SKU are not archived (lock SKU and batch rows for share)
-      const skuRes = await client.query<{
-        sku_archived_at: Date | null;
-        batch_archived_at: Date | null;
-      }>(
-        `SELECT s.archived_at AS sku_archived_at, b.archived_at AS batch_archived_at
-         FROM batch_evidence_links l
-         JOIN product_batches b ON b.client_id = l.client_id AND b.batch_id = l.batch_id
-         JOIN product_skus s ON s.client_id = b.client_id AND s.sku_id = b.sku_id
-         WHERE l.client_id = $1 AND l.evidence_id = $2 AND l.evidence_revision = $3
-         FOR SHARE OF s, b`,
-        [cmd.clientId, cmd.payload.evidenceId, cmd.payload.evidenceRevision]
-      );
-      if (skuRes.rows.length === 0) {
-        throw new NotFoundError("ProductBatch", "Associated batch link not found");
-      }
-      if (skuRes.rows.some((r) => r.batch_archived_at !== null)) {
-        throw new AccessDeniedError("Associated batch is archived.", "BATCH_ARCHIVED");
-      }
-      if (skuRes.rows.some((r) => r.sku_archived_at !== null)) {
-        throw new AccessDeniedError("Associated SKU is archived.", "SKU_ARCHIVED");
-      }
-
-      // Verify underlying source object availability (lock source_objects row for update)
-      const sourceRes = await client.query<SourceObjectRow>(
-        `SELECT * FROM source_objects WHERE client_id = $1 AND source_object_id = $2 FOR UPDATE`,
-        [cmd.clientId, revRes.rows[0]!.source_object_id]
-      );
-      if (sourceRes.rows.length === 0 || sourceRes.rows[0]!.availability !== "available") {
-        throw new AccessDeniedError(
-          "Underlying source object is unavailable.",
-          "SOURCE_UNAVAILABLE"
-        );
-      }
-
       await this.assertNoActiveDisputes(
         client,
         cmd.clientId,
@@ -1329,7 +1429,27 @@ export class PostgresEvidenceAssetRepository implements EvidenceAssetRepositoryP
         return rehydrateEvidenceVerificationEvent(result);
       }
 
-      // Verify EvidenceAsset exists, belongs to client, and is not archived
+      // Discover source_object_id before locking to maintain canonical order: Source -> Evidence
+      const discoveryRevRes = await client.query<{ source_object_id: string }>(
+        `SELECT source_object_id FROM evidence_revisions
+         WHERE client_id = $1 AND evidence_id = $2 AND revision = $3`,
+        [cmd.clientId, cmd.payload.evidenceId, cmd.payload.evidenceRevision]
+      );
+      if (discoveryRevRes.rows.length === 0) {
+        throw new NotFoundError(
+          "EvidenceRevision",
+          `${cmd.payload.evidenceId}:${cmd.payload.evidenceRevision}`
+        );
+      }
+      const discoveredSourceObjectId = discoveryRevRes.rows[0]!.source_object_id;
+
+      // 1. Lock underlying source_objects row FOR UPDATE first
+      await client.query(
+        `SELECT 1 FROM source_objects WHERE client_id = $1 AND source_object_id = $2 FOR UPDATE`,
+        [cmd.clientId, discoveredSourceObjectId]
+      );
+
+      // 2. Lock EvidenceAsset row FOR UPDATE
       const assetRes = await client.query<{ archived_at: Date | null }>(
         `SELECT archived_at FROM evidence_assets
          WHERE client_id = $1 AND evidence_id = $2 FOR UPDATE`,
@@ -1342,7 +1462,7 @@ export class PostgresEvidenceAssetRepository implements EvidenceAssetRepositoryP
         throw new AccessDeniedError("Target evidence asset is archived.", "EVIDENCE_ARCHIVED");
       }
 
-      // Verify EvidenceRevision exists
+      // 3. Lock EvidenceRevision row FOR UPDATE
       const revRes = await client.query<EvidenceRevisionRow>(
         `SELECT * FROM evidence_revisions
          WHERE client_id = $1 AND evidence_id = $2 AND revision = $3 FOR UPDATE`,
@@ -1355,12 +1475,6 @@ export class PostgresEvidenceAssetRepository implements EvidenceAssetRepositoryP
         );
       }
 
-      // Lock underlying source_objects row FOR UPDATE so dispute checks and event appends synchronize
-      await client.query(
-        `SELECT 1 FROM source_objects WHERE client_id = $1 AND source_object_id = $2 FOR UPDATE`,
-        [cmd.clientId, revRes.rows[0]!.source_object_id]
-      );
-
       if (cmd.payload.withdrawalEventId) {
         const priorEventRes = await client.query<{ event_id: string }>(
           `SELECT event_id FROM evidence_verification_events
diff --git a/packages/infrastructure/src/index.ts b/packages/infrastructure/src/index.ts
index a08d631..0074717 100644
--- a/packages/infrastructure/src/index.ts
+++ b/packages/infrastructure/src/index.ts
@@ -475,5 +475,9 @@ export {
   PostgresEvidenceAssetRepository,
   type PostgresEvidenceAssetRepositoryOptions
 } from "./evidence/postgres-evidence-asset-repository.js";
+export {
+  PostgresCoaReportRepository,
+  type PostgresCoaReportRepositoryOptions
+} from "./postgres/repositories/postgres-coa-report-repository.js";
 
 export * from "./experiments/index.js";
diff --git a/packages/infrastructure/src/postgres/audit-protections.integration.test.ts b/packages/infrastructure/src/postgres/audit-protections.integration.test.ts
index 7428003..8fb33b5 100644
--- a/packages/infrastructure/src/postgres/audit-protections.integration.test.ts
+++ b/packages/infrastructure/src/postgres/audit-protections.integration.test.ts
@@ -499,7 +499,7 @@ describe("PostgreSQL audit immutability and application-role privileges integrat
     // Verify migration succeeds when no application role is configured
     await client.query("DROP SCHEMA public CASCADE; CREATE SCHEMA public;");
     const noRoleApplied = await runMigrations(client, { migrationsDirectory });
-    expect(noRoleApplied).toHaveLength(27);
+    expect(noRoleApplied).toHaveLength(28);
   });
 
   it("fails closed when application role has effective UPDATE or DELETE privilege on storyboard_candidates", async () => {
diff --git a/packages/infrastructure/src/postgres/baseline-schema.integration.test.ts b/packages/infrastructure/src/postgres/baseline-schema.integration.test.ts
index c06c672..f2dd7da 100644
--- a/packages/infrastructure/src/postgres/baseline-schema.integration.test.ts
+++ b/packages/infrastructure/src/postgres/baseline-schema.integration.test.ts
@@ -55,7 +55,7 @@ describe("PostgreSQL 18.6 baseline schema integration", () => {
   it("migrates an empty PostgreSQL 18.6 database through the baseline", async () => {
     const applied = await runMigrations(client, { migrationsDirectory });
 
-    expect(applied).toHaveLength(27);
+    expect(applied).toHaveLength(28);
     expect(applied[0]?.version).toBe("001");
     expect(applied[1]?.version).toBe("002");
     expect(applied[2]?.version).toBe("003");
@@ -83,6 +83,7 @@ describe("PostgreSQL 18.6 baseline schema integration", () => {
     expect(applied[24]?.version).toBe("025");
     expect(applied[25]?.version).toBe("026");
     expect(applied[26]?.version).toBe("027");
+    expect(applied[27]?.version).toBe("028");
 
     const schemaRes = await client.query(
       "SELECT version FROM schema_migrations ORDER BY version ASC"
@@ -114,7 +115,8 @@ describe("PostgreSQL 18.6 baseline schema integration", () => {
       { version: "024" },
       { version: "025" },
       { version: "026" },
-      { version: "027" }
+      { version: "027" },
+      { version: "028" }
     ]);
 
     const tablesRes = await client.query<{ table_name: string }>(
@@ -135,6 +137,10 @@ describe("PostgreSQL 18.6 baseline schema integration", () => {
       "campaign_reference_bibles",
       "campaigns",
       "clients",
+      "coa_measurements",
+      "coa_report_review_events",
+      "coa_report_revisions",
+      "coa_reports",
       "delivery_assembly_jobs",
       "evidence_assets",
       "evidence_derivatives",
diff --git a/packages/infrastructure/src/postgres/job-dispatch-contract.integration.test.ts b/packages/infrastructure/src/postgres/job-dispatch-contract.integration.test.ts
index 9ff1a12..eb45fc7 100644
--- a/packages/infrastructure/src/postgres/job-dispatch-contract.integration.test.ts
+++ b/packages/infrastructure/src/postgres/job-dispatch-contract.integration.test.ts
@@ -64,7 +64,8 @@ describe("PostgreSQL job dispatch schema contract integration", () => {
     expect(applied.some((m) => m.version === "025")).toBe(true);
     expect(applied.some((m) => m.version === "026")).toBe(true);
     expect(applied.some((m) => m.version === "027")).toBe(true);
-    expect(applied[applied.length - 1]?.version).toBe("027");
+    expect(applied.some((m) => m.version === "028")).toBe(true);
+    expect(applied[applied.length - 1]?.version).toBe("028");
 
     // 2. Run it again and assert []
     const rerun = await runMigrations(client, { migrationsDirectory });
diff --git a/packages/infrastructure/src/postgres/repositories/postgres-product-evidence-repository.ts b/packages/infrastructure/src/postgres/repositories/postgres-product-evidence-repository.ts
index 93303c2..4197fb5 100644
--- a/packages/infrastructure/src/postgres/repositories/postgres-product-evidence-repository.ts
+++ b/packages/infrastructure/src/postgres/repositories/postgres-product-evidence-repository.ts
@@ -397,7 +397,11 @@ const PRODUCT_REGISTRY_TABLES = new Set<string>([
   "batch_evidence_links",
   "evidence_derivatives",
   "evidence_verification_events",
-  "evidence_ingest_reservations"
+  "evidence_ingest_reservations",
+  "coa_reports",
+  "coa_report_revisions",
+  "coa_measurements",
+  "coa_report_review_events"
 ]);
 
 const REGISTRY_CONSTRAINTS = new Set<string>([
@@ -540,7 +544,54 @@ const REGISTRY_CONSTRAINTS = new Set<string>([
   "evidence_ingest_reservations_reserved_bytes_check",
   "evidence_ingest_reservations_status_check",
   "chk_reservation_sha256_format",
-  "chk_reservation_timestamps"
+  "chk_reservation_timestamps",
+  "coa_reports_pkey",
+  "uq_coa_reports_client_report",
+  "uq_coa_reports_client_batch_evidence",
+  "uq_coa_reports_head_identity",
+  "fk_coa_reports_batch",
+  "fk_coa_reports_evidence",
+  "fk_coa_reports_current_rev",
+  "chk_coa_reports_created_at",
+  "chk_coa_reports_archived_at",
+  "coa_report_revisions_pkey",
+  "uq_coa_report_revisions_lineage",
+  "fk_coa_report_revisions_head",
+  "fk_coa_report_revisions_head_identity",
+  "fk_coa_report_batch_evidence",
+  "fk_coa_report_verified_lab",
+  "fk_coa_report_predecessor",
+  "chk_coa_report_rev_monotonic",
+  "uq_coa_report_rev_predecessor",
+  "chk_coa_report_asserted_by_nonempty",
+  "chk_coa_report_asserted_at",
+  "chk_coa_report_dates_range",
+  "chk_coa_report_sample_date_le_report_date",
+  "chk_coa_report_dates_le_asserted_at",
+  "chk_coa_report_complete_requirements",
+  "trg_check_coa_report_complete_measurements",
+  "coa_measurements_pkey",
+  "uq_coa_measurements_full",
+  "uq_coa_measurements_lineage",
+  "uq_coa_measurements_analyte_context",
+  "fk_coa_measurements_report",
+  "chk_coa_measurement_strings_nonempty",
+  "chk_coa_measurement_quantified",
+  "chk_coa_measurement_below_limit",
+  "chk_coa_measurement_not_detected",
+  "chk_coa_measurement_metadata",
+  "chk_coa_measurement_percent_bounds",
+  "chk_coa_measurement_fraction_bounds",
+  "chk_coa_measurement_unit_contradictions",
+  "trg_enforce_coa_measurements_insert",
+  "coa_report_review_events_pkey",
+  "uq_coa_review_events_client_event",
+  "uq_coa_review_events_decision_per_rev",
+  "fk_coa_review_events_revision",
+  "chk_coa_review_events_reason_nonempty",
+  "chk_coa_review_events_actor_nonempty",
+  "chk_coa_review_events_occurred_at",
+  "trg_check_coa_report_review_event_invariants"
 ]);
 
 export function translateDatabaseError(
@@ -640,6 +691,42 @@ export function translateDatabaseError(
             `Duplicate evidence ingest reservation conflict: ${dbErr.message}`
           );
         }
+        if (dbErr.constraint === "uq_coa_reports_client_batch_evidence") {
+          throw new ConcurrencyConflictError(
+            "A CoA report already exists for this client, batch, and evidence asset."
+          );
+        }
+        if (
+          dbErr.constraint === "uq_coa_reports_client_report" ||
+          dbErr.constraint === "coa_reports_pkey"
+        ) {
+          throw new ConcurrencyConflictError(`Duplicate CoA report conflict: ${dbErr.message}`);
+        }
+        if (
+          dbErr.constraint === "uq_coa_report_rev_predecessor" ||
+          dbErr.constraint === "coa_report_revisions_pkey"
+        ) {
+          throw new NonMonotonicRevisionError(
+            "CoA report revision conflict: duplicate or forked revision"
+          );
+        }
+        if (dbErr.constraint === "uq_coa_measurements_analyte_context") {
+          throw new ProductValidationError([
+            {
+              code: "INVALID_FIELD_COMBINATION",
+              path: ["measurements"],
+              message: "Duplicate analyte + basis + context in report revision"
+            }
+          ]);
+        }
+        if (
+          dbErr.constraint === "uq_coa_review_events_decision_per_rev" ||
+          dbErr.constraint === "coa_report_review_events_pkey"
+        ) {
+          throw new ConcurrencyConflictError(
+            "A review decision already exists for this report revision."
+          );
+        }
         if (
           (dbErr.constraint && REGISTRY_CONSTRAINTS.has(dbErr.constraint)) ||
           (dbErr.table && PRODUCT_REGISTRY_TABLES.has(dbErr.table))
@@ -754,6 +841,50 @@ export function translateDatabaseError(
             "Referenced withdrawal event does not exist"
           );
         }
+        if (dbErr.constraint === "fk_coa_reports_current_rev") {
+          throw new StaleRevisionConflictError("CoaReport", 0, 0);
+        }
+        if (dbErr.constraint === "fk_coa_reports_batch") {
+          throw new NotFoundError("ProductBatch", context?.batchId ?? "unknown");
+        }
+        if (dbErr.constraint === "fk_coa_reports_evidence") {
+          throw new NotFoundError("EvidenceAsset", "Referenced evidence asset does not exist");
+        }
+        if (dbErr.constraint === "fk_coa_report_batch_evidence") {
+          throw new NotFoundError(
+            "BatchEvidenceLink",
+            "Referenced evidence revision is not linked to this batch"
+          );
+        }
+        if (dbErr.constraint === "fk_coa_report_verified_lab") {
+          throw new NotFoundError(
+            "EvidenceVerificationEvent",
+            "Referenced verified lab identity event does not exist"
+          );
+        }
+        if (dbErr.constraint === "fk_coa_report_revisions_head") {
+          throw new NotFoundError("CoaReport", "Referenced CoA report head does not exist");
+        }
+        if (dbErr.constraint === "fk_coa_report_revisions_head_identity") {
+          throw new CrossBatchSourceError(
+            "CoA report revision batch or evidence does not match report head"
+          );
+        }
+        if (dbErr.constraint === "fk_coa_measurements_report") {
+          throw new NotFoundError(
+            "CoaReportRevision",
+            "Referenced CoA report revision does not exist"
+          );
+        }
+        if (dbErr.constraint === "fk_coa_report_predecessor") {
+          throw new NonMonotonicRevisionError("Predecessor CoA report revision does not exist");
+        }
+        if (dbErr.constraint === "fk_coa_review_events_revision") {
+          throw new NotFoundError(
+            "CoaReportRevision",
+            "Referenced CoA report revision does not exist"
+          );
+        }
         if (
           (dbErr.constraint && REGISTRY_CONSTRAINTS.has(dbErr.constraint)) ||
           (dbErr.table && PRODUCT_REGISTRY_TABLES.has(dbErr.table))
@@ -789,7 +920,9 @@ export function translateDatabaseError(
           dbErr.message.includes("updated_at must be nondecreasing") ||
           dbErr.message.includes("Permanent evidence asset identity") ||
           dbErr.message.includes("Permanent source object binary columns") ||
+          dbErr.message.includes("Permanent CoA report identity") ||
           dbErr.message.includes("Archived evidence asset") ||
+          dbErr.message.includes("Archived CoA report") ||
           dbErr.message.includes("Archived source objects") ||
           dbErr.message.includes("Deleted source objects") ||
           dbErr.message.includes("Quarantined, archived, or deleted") ||
@@ -823,9 +956,45 @@ export function translateDatabaseError(
         // Check constraints - strictly allowlisted registry checks only
         if (
           dbErr.constraint === "chk_evidence_rev_monotonic" ||
-          dbErr.constraint === "chk_evidence_revision_supersedes_not_self"
+          dbErr.constraint === "chk_evidence_revision_supersedes_not_self" ||
+          dbErr.constraint === "chk_coa_report_rev_monotonic"
+        ) {
+          throw new NonMonotonicRevisionError("Revision must be contiguous and monotonic");
+        }
+        if (
+          dbErr.constraint === "trg_check_coa_report_complete_measurements" ||
+          dbErr.message.includes("must contain at least one measurement")
+        ) {
+          throw new ProductValidationError([
+            {
+              code: "INVALID_FIELD_COMBINATION",
+              path: ["measurements"],
+              message: "Complete CoA report revisions must contain at least one measurement."
+            }
+          ]);
+        }
+        if (
+          dbErr.constraint === "trg_enforce_coa_measurements_insert" ||
+          dbErr.message.includes("Cannot insert measurements into")
         ) {
-          throw new NonMonotonicRevisionError("Evidence revision must be contiguous and monotonic");
+          throw new AccessDeniedError(dbErr.message);
+        }
+        if (
+          dbErr.constraint === "trg_check_coa_report_review_event_invariants" ||
+          dbErr.message.includes("Cannot approve a draft") ||
+          dbErr.message.includes("Assessed scope cannot be attributed_lot") ||
+          dbErr.message.includes("Self-approval forbidden")
+        ) {
+          if (dbErr.message.includes("Self-approval forbidden")) {
+            throw new AccessDeniedError(dbErr.message);
+          }
+          throw new ProductValidationError([
+            {
+              code: "INVALID_FIELD_COMBINATION",
+              path: ["decision"],
+              message: dbErr.message
+            }
+          ]);
         }
         if (dbErr.constraint === "chk_batch_facts_monotonic_rev") {
           throw new NonMonotonicRevisionError(
@@ -972,6 +1141,7 @@ export function translateDatabaseError(
           dbErr.constraint?.startsWith("chk_derivative_") ||
           dbErr.constraint?.startsWith("chk_verification_events_") ||
           dbErr.constraint?.startsWith("chk_reservation_") ||
+          dbErr.constraint?.startsWith("chk_coa_") ||
           dbErr.constraint === "chk_sha256_format" ||
           (dbErr.table && PRODUCT_REGISTRY_TABLES.has(dbErr.table))
         ) {
diff --git a/packages/infrastructure/src/postgres/uow/postgres-unit-of-work.ts b/packages/infrastructure/src/postgres/uow/postgres-unit-of-work.ts
index 69811a4..7505d84 100644
--- a/packages/infrastructure/src/postgres/uow/postgres-unit-of-work.ts
+++ b/packages/infrastructure/src/postgres/uow/postgres-unit-of-work.ts
@@ -19,6 +19,7 @@ import {
   translateDatabaseError
 } from "../repositories/postgres-product-evidence-repository.js";
 import { PostgresEvidenceAssetRepository } from "../../evidence/postgres-evidence-asset-repository.js";
+import { PostgresCoaReportRepository } from "../repositories/postgres-coa-report-repository.js";
 
 export class PostgresUnitOfWork implements UnitOfWork {
   constructor(private readonly pool: Pool) {}
@@ -49,6 +50,9 @@ export class PostgresUnitOfWork implements UnitOfWork {
         }),
         evidenceAsset: new PostgresEvidenceAssetRepository(client, {
           externalTransaction: true
+        }),
+        coaReports: new PostgresCoaReportRepository(client, {
+          externalTransaction: true
         })
       };
 
diff --git a/packages/shared/src/index.ts b/packages/shared/src/index.ts
index 838c93b..a8f65cf 100644
--- a/packages/shared/src/index.ts
+++ b/packages/shared/src/index.ts
@@ -33,3 +33,4 @@ export * from "./error-redaction.js";
 export * from "./json-canonicalization.js";
 export * from "./client-session-token.js";
 export * from "./product-identity.js";
+export * from "./coa-measurement.js";
```

Fix diff since previous review:

```diff
diff --git a/docs/CONTEXT.md b/docs/CONTEXT.md
index e567377..33187a6 100644
--- a/docs/CONTEXT.md
+++ b/docs/CONTEXT.md
@@ -40,8 +40,10 @@
 - **BatchEvidenceLink:** Explicit relational link binding an exact `(evidenceId, evidenceRevision)` to a specific `batchId` with declared purpose. No implicit inheritance from parent SKUs or sibling batches.
 - **EvidenceDerivative:** Relational bridge connecting an `EvidenceRevision` to a visual conditioning `ReferenceAsset` (`packages/domain/src/reference-asset.ts`) with independent SHA-256 digest and transform description.
 - **EvidenceVerificationEvent:** Append-only audit record capturing human review, submitter attestation, or independent third-party corroboration of evidence facts.
-- **CoaReport & CoaReportRevision:** Structured laboratory Certificate of Analysis test report under optimistic version fencing (`version`) and immutable revision records linked to a batch evidence asset, with claimed vs. verified lab identity, sample vs. attributed lot scope, and report date.
-- **CoaMeasurement:** Typed analytical measurement row linked to a specific `CoaReportRevision`, with analyte name, typed decimal result (`quantified`, `below_limit`, `not_detected`), non-empty unit, analytical basis, context, and reported test method. Neither `below_limit` nor `not_detected` may ever be converted into numerical zero ("0", "0.0%"), "Zero", or an exact numerical marketing value.
+- **CoaReport & CoaReportRevision:** Structured laboratory Certificate of Analysis test report under optimistic version fencing (`version`) and immutable revision records linked to a batch evidence asset, with claimed vs. verified lab identity, sample vs. attributed lot scope, report date, explicit completeness status (`draft` or `complete`), and verified sample-to-batch association confirmation and attestation.
+- **CoaMeasurement:** Typed analytical measurement row linked to a specific `CoaReportRevision`, with analyte name, typed decimal result (`quantified`, `below_limit`, `not_detected`), non-empty unit, analytical basis, context, quantity kind, and optional reported test method (`methodAsReported`, nullable when absent from source). Neither `below_limit` nor `not_detected` may ever be converted into numerical zero ("0", "0.0%"), "Zero", or an exact numerical marketing value. Stored and transported as exact string decimal representations (`DecimalString`) preserving trailing zeros with zero IEEE-754 floating-point coercion. Measurement panels are sealed upon revision commit.
+- **CoaReportReviewEvent & Review Status:** Append-only audit record capturing independent compliance review (`approved` or `rejected`) with assessed scope (`sample_only` or `attributed_lot`). Derived status is `pending` until formally reviewed. Self-approval is strictly forbidden: the recorder (`assertedBy`) cannot approve their own report revision.
+- **CoaMeasurementSupportResolution:** Fail-closed evaluation determining whether pinned batch measurements are valid, approved, un-disputed, un-superseded, and active. Fails closed with explicit reason codes if the parent report is unreviewed, draft, disputed, quarantined, or mismatched in unit/context.
 
 - **ProductClaimRevision:** Commercial product statement for a batch declaring claim type, exact copy wording, proof category (`coa_measurement_backed`, `production_record_backed`, `visual_evidence_backed`, `human_attested_unverified`), and optional paired numerical value and unit.
 - **ClaimHead:** Version-fenced mutable pointer for a product claim tracking current revision and lifecycle state (`draft`, `evidence_linked`, `reviewer_approved`, `rejected`, `invalidated`).
diff --git a/docs/adr/0009-verified-product-batch-evidence-claim-authority.md b/docs/adr/0009-verified-product-batch-evidence-claim-authority.md
index df38f4d..4c5cb01 100644
--- a/docs/adr/0009-verified-product-batch-evidence-claim-authority.md
+++ b/docs/adr/0009-verified-product-batch-evidence-claim-authority.md
@@ -182,13 +182,24 @@ erDiagram
   - `labNameAsClaimed`: Name of the laboratory reported on the document.
   - `verifiedLabIdentityEventId`: Optional foreign key to an `EvidenceVerificationEvent` corroborating accredited laboratory identity and accreditation license. The referenced verification event must belong to the same client, evidence asset, and evidence revision (`outcome = 'verified'`, `fact_scope = 'lab_identity'`, `verification_kind = 'independent_third_party_corroboration'`).
 - **Strict Decimal Representations (`CoaMeasurement`):**
-  - All numerical measurements are stored as **exact decimal strings** conforming to `^-?(0|[1-9][0-9]*)(\.[0-9]+)?$`. Floating-point numbers (`NUMERIC` in SQL, `string` in TypeScript; never IEEE 754 `number`) are mandatory to eliminate rounding and scale loss.
+  - All numerical measurements are stored as **exact decimal strings** conforming to `^-?(0|[1-9][0-9]*)(\.[0-9]+)?$`. Exact decimal representations (`TEXT` in SQL, `string` in TypeScript; never IEEE 754 `number`) are mandatory to eliminate rounding and scale loss.
   - **Typed Result Union:**
     - `quantified`: Exact measured value (`value: DecimalString`).
     - `below_limit`: Below limit of quantification (`limit: DecimalString`, `qualifier: "lt" | "lte"`).
     - `not_detected`: Analyte was not detected by the analytical instrument.
   - **Mandatory Units & Context:** Every measurement row requires non-empty strings for `analyte` (e.g., `thc_total`, `myrcene`), `unit` (e.g., `percent_w_w`, `mg_per_g`, `ppm`), `basis` (e.g., `dry_weight`, `as_received`), and `context` (e.g., `finished_inflorescence`, `extract`). Ambiguous or unitless measurements fail closed.
+  - **Exact Decimal String Storage (`TEXT`):** All analytical numbers (measurements, limits, uncertainties) are stored as verbatim decimal strings conforming to `^-?(0|[1-9][0-9]*)(\.[0-9]+)?$` with zero IEEE-754 floating-point coercion, preserving trailing precision zeros.
+  - **Reported Methods & Analytical Qualifiers:** `methodAsReported` is optional and nullable (transcribed verbatim when reported; left null rather than fabricating a placeholder). Analytical qualifiers (e.g. `negative_as_reported`) require non-blank analytical explanations and remain unsupported for positive numerical claims until explicitly governed.
+  - **Measurement Panel Sealing:** The measurement set is sealed upon revision commit; additions to an approved or committed revision require creating a new revision.
   - **Lineage Integrity:** Measurements inherit and mechanically enforce the exact `(batch_id, evidence_id, evidence_revision)` of their parent `CoaReportRevision`.
+- **Completeness & Draft States (`completenessStatus`):**
+  - `draft`: Incomplete metadata or preliminary staging; cannot be approved or satisfy measurement support resolution for downstream claims.
+  - `complete`: All claimed report identifiers, report date, lab name, sample-to-batch association confirmation, and at least one valid measurement row are provided.
+- **Independent Compliance Review & Non-Self-Approval (`CoaReportReviewEvent`):**
+  - Transcription and compliance review are strictly separated authorities. A compliance reviewer cannot approve their own recorded report revision (`assertedBy`).
+  - Assessed scope cannot exceed report scope (`sample_only` reports cannot be approved as `attributed_lot`).
+- **Fail-Closed Pinned Measurement Support Resolution:**
+  - Downstream callers specify explicit report revision and measurement IDs (`resolveMeasurementSupport`). Support fails closed if the report is unreviewed, draft, disputed, quarantined, superseded, archived, or mismatched in requested unit, basis, or context. Pinned callers are never silently redirected to a "latest" report.
 
 #### 2.8 ProductClaimRevision and ClaimSourceLink
 - **Claim Types:**
@@ -623,7 +634,7 @@ export interface CoaMeasurement {
   readonly unit: string;
   readonly basis: string;
   readonly context: string;
-  readonly methodAsReported: string;
+  readonly methodAsReported: string | null;
 }
 
 export interface ProductClaim {
@@ -1042,15 +1053,19 @@ CREATE TABLE coa_report_revisions (
   batch_id UUID NOT NULL,
   evidence_id UUID NOT NULL,
   evidence_revision INT NOT NULL,
-  report_identifier_as_claimed VARCHAR(128) NOT NULL,
-  report_date DATE NOT NULL,
-  lab_name_as_claimed VARCHAR(255) NOT NULL,
-  sample_identifier_as_claimed VARCHAR(128) NOT NULL,
-  scope_kind VARCHAR(32) NOT NULL
-    CHECK (scope_kind IN ('sample_only', 'attributed_lot')),
-  scope_description TEXT NOT NULL,
+  completeness_status VARCHAR(16) NOT NULL DEFAULT 'draft'
+    CHECK (completeness_status IN ('draft', 'complete')),
+  report_identifier_as_claimed VARCHAR(128),
+  report_date DATE,
+  lab_name_as_claimed VARCHAR(255),
+  sample_identifier_as_claimed VARCHAR(128),
+  scope_kind VARCHAR(32)
+    CHECK (scope_kind IS NULL OR scope_kind IN ('sample_only', 'attributed_lot')),
+  scope_description TEXT,
   sample_date DATE,
   sampling_method_description TEXT,
+  sample_to_batch_association_attestation TEXT,
+  sample_to_batch_association_confirmed BOOLEAN,
   verified_lab_identity_event_id UUID,
   asserted_by VARCHAR(128) NOT NULL,
   asserted_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
@@ -1067,7 +1082,7 @@ CREATE TABLE coa_report_revisions (
     REFERENCES coa_report_revisions(client_id, report_id, revision) ON DELETE RESTRICT,
   CONSTRAINT chk_coa_report_rev_monotonic CHECK (
     (revision = 1 AND supersedes_revision IS NULL) OR
-    (revision > 1 AND supersedes_revision IS NOT NULL AND supersedes_revision < revision)
+    (revision > 1 AND supersedes_revision IS NOT NULL AND supersedes_revision = revision - 1)
   ),
   CONSTRAINT uq_coa_report_rev_predecessor UNIQUE (client_id, report_id, supersedes_revision)
 );
@@ -1096,7 +1111,11 @@ CREATE TABLE coa_measurements (
   unit VARCHAR(64) NOT NULL,
   basis VARCHAR(64) NOT NULL,
   context VARCHAR(64) NOT NULL,
-  method_as_reported VARCHAR(128) NOT NULL,
+  quantity_kind VARCHAR(64) NOT NULL,
+  method_as_reported VARCHAR(128),
+  uncertainty_absolute TEXT,
+  detection_limit TEXT,
+  quantification_limit TEXT,
   CONSTRAINT uq_coa_measurements_full UNIQUE (client_id, report_id, report_revision, measurement_id),
   CONSTRAINT uq_coa_measurements_lineage UNIQUE (client_id, report_id, report_revision, measurement_id, batch_id, evidence_id, evidence_revision),
   CONSTRAINT fk_coa_measurements_report FOREIGN KEY (client_id, report_id, report_revision, batch_id, evidence_id, evidence_revision)
@@ -1118,6 +1137,27 @@ CREATE TABLE coa_measurements (
 CREATE INDEX idx_coa_measurements_analyte
   ON coa_measurements(client_id, report_id, report_revision, analyte);
 
+CREATE TABLE coa_report_review_events (
+  event_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
+  client_id UUID NOT NULL,
+  report_id UUID NOT NULL,
+  report_revision INT NOT NULL CHECK (report_revision > 0),
+  decision VARCHAR(16) NOT NULL
+    CHECK (decision IN ('approved', 'rejected')),
+  actor_id VARCHAR(128) NOT NULL,
+  occurred_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
+  reason TEXT NOT NULL,
+  assessed_scope VARCHAR(32) NOT NULL
+    CHECK (assessed_scope IN ('sample_only', 'attributed_lot')),
+  CONSTRAINT uq_coa_review_events_client_event UNIQUE (client_id, event_id),
+  CONSTRAINT uq_coa_review_events_decision_per_rev UNIQUE (client_id, report_id, report_revision),
+  CONSTRAINT fk_coa_review_events_revision FOREIGN KEY (client_id, report_id, report_revision)
+    REFERENCES coa_report_revisions(client_id, report_id, revision) ON DELETE RESTRICT
+);
+
+CREATE INDEX idx_coa_review_events_revision
+  ON coa_report_review_events(client_id, report_id, report_revision);
+
 -- ---------------------------------------------------------------------------
 -- 9. PRODUCT CLAIMS, REVISIONS & SOURCE LINKS
 -- ---------------------------------------------------------------------------
@@ -1506,47 +1546,65 @@ export interface IngestCoaMeasurementInput {
   readonly unit: string;
   readonly basis: string;
   readonly context: string;
-  readonly methodAsReported: string;
+  readonly quantityKind: string;
+  readonly methodAsReported: string | null;
+  readonly uncertaintyAbsolute?: DecimalString | null;
+  readonly detectionLimit?: DecimalString | null;
+  readonly quantificationLimit?: DecimalString | null;
+  readonly analyticalQualifierCode?: string | null;
+  readonly analyticalQualifierExplanation?: string | null;
 }
 
 export interface CreateCoaReportCommand {
+  readonly reportId?: CoaReportId;
   readonly batchId: BatchId;
   readonly evidenceId: EvidenceId;
   readonly evidenceRevision: number;
-  readonly reportIdentifierAsClaimed: string;
-  readonly reportDate: DateOnlyString;
-  readonly labNameAsClaimed: string;
-  readonly sampleIdentifierAsClaimed: string;
-  readonly scopeKind: CoaScopeKind;
-  readonly scopeDescription: string;
-  readonly sampleDate: DateOnlyString | null;
-  readonly samplingMethodDescription: string | null;
-  readonly verifiedLabIdentityEventId: VerificationEventId | null;
+  readonly completenessStatus: "draft" | "complete";
+  readonly reportIdentifierAsClaimed?: string | null;
+  readonly reportDate?: DateOnlyString | null;
+  readonly labNameAsClaimed?: string | null;
+  readonly sampleIdentifierAsClaimed?: string | null;
+  readonly scopeKind?: CoaScopeKind | null;
+  readonly scopeDescription?: string | null;
+  readonly sampleDate?: DateOnlyString | null;
+  readonly samplingMethodDescription?: string | null;
+  readonly sampleToBatchAssociationConfirmed?: boolean | null;
+  readonly sampleToBatchAssociationAttestation?: string | null;
+  readonly verifiedLabIdentityEventId?: VerificationEventId | null;
   readonly measurements: readonly IngestCoaMeasurementInput[];
 }
 
 export interface SupersedeCoaReportCommand {
   readonly reportId: CoaReportId;
   readonly expectedVersion: number;
-  readonly batchId: BatchId;
-  readonly evidenceId: EvidenceId;
   readonly evidenceRevision: number;
-  readonly reportIdentifierAsClaimed: string;
-  readonly reportDate: DateOnlyString;
-  readonly labNameAsClaimed: string;
-  readonly sampleIdentifierAsClaimed: string;
-  readonly scopeKind: CoaScopeKind;
-  readonly scopeDescription: string;
-  readonly sampleDate: DateOnlyString | null;
-  readonly samplingMethodDescription: string | null;
-  readonly verifiedLabIdentityEventId: VerificationEventId | null;
+  readonly completenessStatus: "draft" | "complete";
+  readonly reportIdentifierAsClaimed?: string | null;
+  readonly reportDate?: DateOnlyString | null;
+  readonly labNameAsClaimed?: string | null;
+  readonly sampleIdentifierAsClaimed?: string | null;
+  readonly scopeKind?: CoaScopeKind | null;
+  readonly scopeDescription?: string | null;
+  readonly sampleDate?: DateOnlyString | null;
+  readonly samplingMethodDescription?: string | null;
+  readonly sampleToBatchAssociationConfirmed?: boolean | null;
+  readonly sampleToBatchAssociationAttestation?: string | null;
+  readonly verifiedLabIdentityEventId?: VerificationEventId | null;
   readonly measurements: readonly IngestCoaMeasurementInput[];
 }
 
-export interface DisputeCoaReportCommand {
+export interface ReviewCoaReportCommand {
   readonly reportId: CoaReportId;
   readonly expectedVersion: number;
+  readonly decision: "approved" | "rejected";
   readonly reason: string;
+  readonly assessedScope: CoaScopeKind;
+}
+
+export interface ArchiveCoaReportCommand {
+  readonly reportId: CoaReportId;
+  readonly expectedVersion: number;
 }
 
 export type CreateClaimCommand =
diff --git a/docs/verified-product-evidence-contract-fixtures.md b/docs/verified-product-evidence-contract-fixtures.md
index 8c696d2..cd56a56 100644
--- a/docs/verified-product-evidence-contract-fixtures.md
+++ b/docs/verified-product-evidence-contract-fixtures.md
@@ -900,3 +900,8 @@ The following matrix documents the complete set of negative invariants, integrit
 | **CE-13A**| **Concurrent Approve vs. Supersede (Supersede Commits First)** | Reviewer attempts to approve claim Rev 1 while Submitter concurrently supersedes CoA Rev 1. | Supersede transaction commits first (advancing CoA head to Rev 2 and invalidating claim Rev 1). Approve transaction acquires locks and executes pre-commit dependency check. | Approve transaction detects underlying CoA report revision is no longer current and claim state is `invalidated`. Aborts immediately with HTTP 409 `SOURCE_SUPERSEDED`. Zero orphaned approvals. |
 | **CE-13B**| **Concurrent Approve vs. Supersede (Approve Commits First)** | Reviewer attempts to approve claim Rev 1 while Submitter concurrently supersedes CoA Rev 1. | Approve transaction commits first (transitioning claim Rev 1 to `reviewer_approved`). Supersede transaction acquires locks, appends Rev 2, queries dependent claims, finds approved claim Rev 1. | Supersede transaction appends invalidation `ClaimDecisionEvent` and updates claim head to `invalidated`. In both commit orders, committed state is deterministic and no superseded claim remains approved. |
 | **CE-14** | **Attributed Process Claim Without CoA** | Batch facts record living soil cultivation supported by cultivation log `process_record`. | Submitter creates `cultivation_process` claim ("Cultivated in Living Organic Soil") linked to log. | Permitted by policy matrix (`proofCategory = "production_record_backed"`). Human reviewer approves based on process logs without requiring a laboratory CoA. |
+| **CE-15** | **Self-Approval Forbidden** | Submitter / technician `compliance-officer` recorded CoA Report Revision 1 (`assertedBy = "compliance-officer"`). | Same actor `compliance-officer` submits `reviewReportRevision(decision: 'approved')`. | Application and domain layer reject with HTTP 403 `ACCESS_DENIED` ("Self-approval forbidden: reviewer cannot be the recorder who asserted this report revision"). Transcription and review must remain distinct human actors. |
+| **CE-16** | **Draft Report Support Denial** | Submitter staged an incomplete CoA report with `completenessStatus = 'draft'`. | Caller attempts to approve draft (`reviewReportRevision`) or resolve measurement support for a claim (`resolveMeasurementSupport`). | Both operations fail closed: `createCoaReportReviewEvent` throws `ProductValidationError` ("Cannot approve a draft CoA report"); `resolveMeasurementSupport` returns `isSupported = false, reason = 'report_draft_incomplete'`. |
+| **CE-17** | **Exact Decimal String Roundtrip & Precision Preservation** | Submitter records analytical measurement with 4-decimal precision `result_value = "24.5000"` and `uncertainty_absolute = "0.2500"`. | System persists to `coa_measurements`, computes command receipt SHA-256, reads from database, and formats API JSON response. | Exact string `"24.5000"` is preserved byte-for-byte across SQL parameter, storage, domain entity, and JSON serialization. Zero IEEE-754 floating-point coercion, zero loss of trailing zeros, zero decimal reformatting. |
+| **CE-18** | **Cross-Batch Measurement Isolation** | Same client owns SKU-1 with Lot A (`BATCH_LOT_A_ID`, total terpenes `2.85%`) and Lot B (`BATCH_LOT_B_ID`, total terpenes `1.40%`). | Caller invokes `resolveMeasurementSupport` providing Lot B's batch ID with Lot A's CoA report ID. | Fails closed with `isSupported = false, reason = 'report_batch_mismatch'`. Analytical measurements never bleed across batches of the same SKU. |
+| **CE-19** | **Pinned Measurement Support Supersession Invalidation** | Downstream claim query is pinned to CoA Report Revision 1. | Submitter records superseding CoA Report Revision 2 (`supersedeCoaReport`). | `resolveMeasurementSupport` evaluates target revision against current head revision (2 > 1), returning `isSupported = false, reason = 'report_superseded'`. Pinned queries fail closed rather than silently substituting superseded analytical facts. |
diff --git a/packages/application/src/ports/index.ts b/packages/application/src/ports/index.ts
index 8b0e8fc..16b8f65 100644
--- a/packages/application/src/ports/index.ts
+++ b/packages/application/src/ports/index.ts
@@ -56,3 +56,5 @@ export * from "./originals-inspection-port.js";
 export * from "./evidence-storage-policy.js";
 export * from "./evidence-lock-coordinator.js";
 export * from "./evidence-asset-repository.js";
+export * from "./coa-report-repository.js";
+export * from "./reviewer-authorization-port.js";
diff --git a/packages/application/src/ports/unit-of-work.ts b/packages/application/src/ports/unit-of-work.ts
index 440ad3a..f0658d6 100644
--- a/packages/application/src/ports/unit-of-work.ts
+++ b/packages/application/src/ports/unit-of-work.ts
@@ -10,6 +10,7 @@ import type { ReferenceAssetRepository } from "./reference-asset-repository.js";
 import type { ReferenceGroupRepository } from "./reference-group-repository.js";
 import type { ProductEvidenceRepositoryPort } from "./product-evidence-repository.js";
 import type { EvidenceAssetRepositoryPort } from "./evidence-asset-repository.js";
+import type { CoaReportRepositoryPort } from "./coa-report-repository.js";
 import type { ReviewEventStore } from "./review-event-store.js";
 import type { SceneRepository } from "./scene-repository.js";
 import type { ShotPlanRepository } from "./shot-plan-repository.js";
@@ -31,6 +32,7 @@ export interface UnitOfWorkContext {
   readonly campaignReferenceBible?: CampaignReferenceBibleRepository | undefined;
   readonly productEvidence?: ProductEvidenceRepositoryPort | undefined;
   readonly evidenceAsset?: EvidenceAssetRepositoryPort | undefined;
+  readonly coaReports?: CoaReportRepositoryPort | undefined;
 }
 
 export interface UnitOfWork {
diff --git a/packages/application/src/use-cases/index.ts b/packages/application/src/use-cases/index.ts
index 9eaba9c..66213a6 100644
--- a/packages/application/src/use-cases/index.ts
+++ b/packages/application/src/use-cases/index.ts
@@ -84,3 +84,9 @@ export * from "./product-registry-use-cases.js";
 export * from "./register-evidence-asset.js";
 export * from "./link-existing-derivative.js";
 export * from "./record-evidence-verification-event.js";
+export * from "./coa-command-envelope-validator.js";
+export * from "./create-coa-report.js";
+export * from "./supersede-coa-report.js";
+export * from "./review-coa-report.js";
+export * from "./archive-coa-report.js";
+export * from "./resolve-coa-measurement-support.js";
diff --git a/packages/contracts/src/index.ts b/packages/contracts/src/index.ts
index 961abce..da754b2 100644
--- a/packages/contracts/src/index.ts
+++ b/packages/contracts/src/index.ts
@@ -43,3 +43,4 @@ export * from "./product-evidence-command.js";
 export * from "./product-sku.js";
 export * from "./product-batch.js";
 export * from "./evidence-asset.js";
+export * from "./coa-report.js";
diff --git a/packages/domain/src/identifiers.ts b/packages/domain/src/identifiers.ts
index c23b1c6..9d613fc 100644
--- a/packages/domain/src/identifiers.ts
+++ b/packages/domain/src/identifiers.ts
@@ -23,6 +23,9 @@ export type SourceObjectId = Brand<string, "SourceObjectId">;
 export type DerivativeId = Brand<string, "DerivativeId">;
 export type VerificationEventId = Brand<string, "VerificationEventId">;
 export type ActionId = Brand<string, "ActionId">;
+export type CoaReportId = Brand<string, "CoaReportId">;
+export type CoaMeasurementId = Brand<string, "CoaMeasurementId">;
+export type CoaReviewEventId = Brand<string, "CoaReviewEventId">;
 
 /** Lowercase 64-hex SHA-256 digest string */
 export type Sha256Hex = string & { readonly __sha256: true };
@@ -79,6 +82,18 @@ export function createActionId(val: string): ActionId {
   return validateAndBrandUuid(val, "ActionId", "actionId");
 }
 
+export function createCoaReportId(val: string): CoaReportId {
+  return validateAndBrandUuid(val, "CoaReportId", "reportId");
+}
+
+export function createCoaMeasurementId(val: string): CoaMeasurementId {
+  return validateAndBrandUuid(val, "CoaMeasurementId", "measurementId");
+}
+
+export function createCoaReviewEventId(val: string): CoaReviewEventId {
+  return validateAndBrandUuid(val, "CoaReviewEventId", "eventId");
+}
+
 export function createSha256Hex(val: string): Sha256Hex {
   if (typeof val !== "string" || !/^[0-9a-f]{64}$/.test(val)) {
     throw new ProductValidationError(
diff --git a/packages/domain/src/index.ts b/packages/domain/src/index.ts
index eaa895e..217e7ad 100644
--- a/packages/domain/src/index.ts
+++ b/packages/domain/src/index.ts
@@ -20,3 +20,5 @@ export * from "./batch-facts.js";
 export * from "./product-batch.js";
 export * from "./source-object.js";
 export * from "./evidence-asset.js";
+export * from "./coa-measurement.js";
+export * from "./coa-report.js";
diff --git a/packages/infrastructure/src/evidence/postgres-evidence-asset-repository.test.ts b/packages/infrastructure/src/evidence/postgres-evidence-asset-repository.test.ts
index 979f378..114b16e 100644
--- a/packages/infrastructure/src/evidence/postgres-evidence-asset-repository.test.ts
+++ b/packages/infrastructure/src/evidence/postgres-evidence-asset-repository.test.ts
@@ -61,9 +61,64 @@ describe("PostgresEvidenceAssetRepository unit tests", () => {
   function createMockPoolClient(
     handler: (normSql: string, params?: unknown[]) => Promise<{ rows: Record<string, unknown>[] }>
   ) {
+    let lastSkuArchivedAt: Date | null | undefined;
+    let lastBatchArchivedAt: Date | null | undefined;
+
     return {
       query: vi.fn(async (sql: string, params?: unknown[]) => {
-        return await handler(normalizeSql(sql), params);
+        const norm = normalizeSql(sql);
+        const result = await handler(norm, params);
+
+        if (result.rows.length > 0) {
+          if ("sku_archived_at" in result.rows[0]!) {
+            lastSkuArchivedAt = result.rows[0]!.sku_archived_at as Date | null;
+          }
+          if ("batch_archived_at" in result.rows[0]!) {
+            lastBatchArchivedAt = result.rows[0]!.batch_archived_at as Date | null;
+          }
+        }
+
+        const lower = norm.toLowerCase();
+        if (lower.includes("from product_skus") && result.rows.length === 0) {
+          const skuId = (params?.[1] as string) || "018f0000-0000-7000-8000-000000000005";
+          return {
+            rows: [
+              {
+                sku_id: skuId,
+                archived_at: lastSkuArchivedAt ?? null
+              }
+            ]
+          };
+        }
+
+        if (
+          lower.includes("from product_batches") &&
+          lower.includes("for") &&
+          result.rows.length === 0
+        ) {
+          const bId = (params?.[1] as string) || "018f0000-0000-7000-8000-000000000002";
+          return {
+            rows: [
+              {
+                batch_id: bId,
+                archived_at: lastBatchArchivedAt ?? null,
+                sku_id: (params?.[1] as string) || "018f0000-0000-7000-8000-000000000005"
+              }
+            ]
+          };
+        }
+
+        if (lower.includes("from batch_evidence_links") && result.rows.length > 0) {
+          return {
+            rows: result.rows.map((r) => ({
+              batch_id: r.batch_id ?? "018f0000-0000-7000-8000-000000000002",
+              sku_id: r.sku_id ?? "018f0000-0000-7000-8000-000000000005",
+              ...r
+            }))
+          };
+        }
+
+        return result;
       }),
       getTransactionStatus: vi.fn(() => "T"),
       release: vi.fn()
@@ -547,6 +602,39 @@ describe("PostgresEvidenceAssetRepository unit tests", () => {
         if (sql.includes("product_evidence_command_receipts")) {
           return { rows: [] };
         }
+        if (sql.includes("evidence_revisions")) {
+          return {
+            rows: [
+              {
+                client_id: clientId,
+                evidence_id: evidenceId,
+                revision: 1,
+                source_object_id: sourceObjectId
+              }
+            ]
+          };
+        }
+        if (sql.includes("batch_evidence_links")) {
+          return {
+            rows: [
+              {
+                sku_archived_at: null,
+                batch_archived_at: null
+              }
+            ]
+          };
+        }
+        if (sql.includes("source_objects")) {
+          return {
+            rows: [
+              {
+                source_object_id: sourceObjectId,
+                client_id: clientId,
+                availability: "available"
+              }
+            ]
+          };
+        }
         if (sql.includes("evidence_assets")) {
           return {
             rows: [
diff --git a/packages/infrastructure/src/evidence/postgres-evidence-asset-repository.ts b/packages/infrastructure/src/evidence/postgres-evidence-asset-repository.ts
index 5c2606b..a369f71 100644
--- a/packages/infrastructure/src/evidence/postgres-evidence-asset-repository.ts
+++ b/packages/infrastructure/src/evidence/postgres-evidence-asset-repository.ts
@@ -613,17 +613,50 @@ export class PostgresEvidenceAssetRepository implements EvidenceAssetRepositoryP
         };
       }
 
-      // 1. Lock and verify batch and SKU rows
+      // 1. Discover batch and SKU without locking to maintain strict lock hierarchy: SKU -> Batch
+      const batchDiscovery = await client.query<{
+        batch_id: string;
+        sku_id: string;
+      }>(
+        `SELECT batch_id, sku_id
+         FROM product_batches
+         WHERE client_id = $1 AND batch_id = $2`,
+        [cmd.clientId, cmd.payload.batchId]
+      );
+      if (batchDiscovery.rows.length === 0) {
+        throw new NotFoundError("ProductBatch", cmd.payload.batchId);
+      }
+      const discoveredSkuId = batchDiscovery.rows[0]!.sku_id;
+
+      // Lock SKU FOR UPDATE first
+      const skuRes = await client.query<{
+        sku_id: string;
+        archived_at: Date | null;
+      }>(
+        `SELECT sku_id, archived_at
+         FROM product_skus
+         WHERE client_id = $1 AND sku_id = $2 FOR UPDATE`,
+        [cmd.clientId, discoveredSkuId]
+      );
+      if (skuRes.rows.length === 0) {
+        throw new NotFoundError("ProductSku", discoveredSkuId);
+      }
+      if (skuRes.rows[0]!.archived_at !== null) {
+        throw new AccessDeniedError(
+          "Cannot link evidence to a batch under an archived SKU",
+          "SKU_ARCHIVED"
+        );
+      }
+
+      // Lock Batch FOR UPDATE second
       const batchRes = await client.query<{
         batch_id: string;
         archived_at: Date | null;
         sku_id: string;
-        sku_archived_at: Date | null;
       }>(
-        `SELECT b.batch_id, b.archived_at, s.sku_id, s.archived_at AS sku_archived_at
-         FROM product_batches b
-         JOIN product_skus s ON s.client_id = b.client_id AND s.sku_id = b.sku_id
-         WHERE b.client_id = $1 AND b.batch_id = $2 FOR UPDATE OF b, s`,
+        `SELECT batch_id, archived_at, sku_id
+         FROM product_batches
+         WHERE client_id = $1 AND batch_id = $2 FOR UPDATE`,
         [cmd.clientId, cmd.payload.batchId]
       );
       if (batchRes.rows.length === 0) {
@@ -632,11 +665,75 @@ export class PostgresEvidenceAssetRepository implements EvidenceAssetRepositoryP
       if (batchRes.rows[0]!.archived_at !== null) {
         throw new AccessDeniedError("Cannot link evidence to an archived batch", "BATCH_ARCHIVED");
       }
-      if (batchRes.rows[0]!.sku_archived_at !== null) {
-        throw new AccessDeniedError(
-          "Cannot link evidence to a batch under an archived SKU",
-          "SKU_ARCHIVED"
+      if (batchRes.rows[0]!.sku_id !== discoveredSkuId) {
+        throw new ConcurrencyConflictError("Batch SKU association changed concurrently.");
+      }
+
+      // Pre-lock discovery for supersession to maintain canonical order: Source (sorted) -> Evidence
+      let oldSourceObjectId: string | undefined;
+      let targetAsset: EvidenceAsset | undefined;
+      if (cmd.payload.registrationIntent === "supersede") {
+        if (!cmd.payload.targetEvidenceId || cmd.payload.expectedEvidenceVersion === undefined) {
+          throw new ProductValidationError([
+            {
+              code: "INVALID_FIELD_COMBINATION",
+              path: ["targetEvidenceId"],
+              message: "targetEvidenceId and expectedEvidenceVersion are required for supersede."
+            }
+          ]);
+        }
+
+        const preLockRevRes = await client.query<{ source_object_id: string }>(
+          `SELECT r.source_object_id
+           FROM evidence_assets a
+           JOIN evidence_revisions r ON r.client_id = a.client_id AND r.evidence_id = a.evidence_id AND r.revision = a.current_revision
+           WHERE a.client_id = $1 AND a.evidence_id = $2`,
+          [cmd.clientId, cmd.payload.targetEvidenceId]
+        );
+        oldSourceObjectId = preLockRevRes.rows[0]?.source_object_id;
+
+        // Discover candidate replacement source object ID without locking
+        let candidateReplacementSourceId: string | undefined = cmd.payload.reusedSourceObjectId;
+        if (!candidateReplacementSourceId) {
+          const existingSourceCheck = await client.query<{ source_object_id: string }>(
+            `SELECT source_object_id FROM source_objects
+             WHERE client_id = $1 AND original_sha256 = $2`,
+            [cmd.clientId, cmd.payload.originalSha256]
+          );
+          candidateReplacementSourceId = existingSourceCheck.rows[0]?.source_object_id;
+        }
+
+        // Lock all involved source objects in canonical sorted order before locking evidence_assets
+        const sourceIdsToLock = Array.from(
+          new Set([oldSourceObjectId, candidateReplacementSourceId].filter(Boolean) as string[])
+        ).sort();
+        for (const sId of sourceIdsToLock) {
+          await client.query(
+            `SELECT 1 FROM source_objects WHERE client_id = $1 AND source_object_id = $2 FOR UPDATE`,
+            [cmd.clientId, sId]
+          );
+        }
+
+        // Lock target evidence asset
+        const targetRes = await client.query<EvidenceAssetRow>(
+          `SELECT * FROM evidence_assets
+           WHERE client_id = $1 AND evidence_id = $2 FOR UPDATE`,
+          [cmd.clientId, cmd.payload.targetEvidenceId]
         );
+        if (targetRes.rows.length === 0) {
+          throw new NotFoundError("EvidenceAsset", cmd.payload.targetEvidenceId);
+        }
+        targetAsset = mapRowToEvidenceAsset(targetRes.rows[0]!);
+        if (targetAsset.archivedAt !== null) {
+          throw new AccessDeniedError("Archived evidence asset cannot be superseded.");
+        }
+        if (targetAsset.version !== cmd.payload.expectedEvidenceVersion) {
+          throw new StaleRevisionConflictError(
+            "EvidenceAsset",
+            cmd.payload.expectedEvidenceVersion,
+            targetAsset.version
+          );
+        }
       }
 
       // 2. Resolve or insert SourceObject
@@ -886,35 +983,8 @@ export class PostgresEvidenceAssetRepository implements EvidenceAssetRepositoryP
         );
         evidenceRevision = mapRowToEvidenceRevision(revRes.rows[0]!);
       } else if (cmd.payload.registrationIntent === "supersede") {
-        if (!cmd.payload.targetEvidenceId || cmd.payload.expectedEvidenceVersion === undefined) {
-          throw new ProductValidationError([
-            {
-              code: "INVALID_FIELD_COMBINATION",
-              path: ["targetEvidenceId"],
-              message: "targetEvidenceId and expectedEvidenceVersion are required for supersede."
-            }
-          ]);
-        }
-
-        // Lock target evidence asset
-        const targetRes = await client.query<EvidenceAssetRow>(
-          `SELECT * FROM evidence_assets
-         WHERE client_id = $1 AND evidence_id = $2 FOR UPDATE`,
-          [cmd.clientId, cmd.payload.targetEvidenceId]
-        );
-        if (targetRes.rows.length === 0) {
-          throw new NotFoundError("EvidenceAsset", cmd.payload.targetEvidenceId);
-        }
-        const targetAsset = mapRowToEvidenceAsset(targetRes.rows[0]!);
-        if (targetAsset.archivedAt !== null) {
-          throw new AccessDeniedError("Archived evidence asset cannot be superseded.");
-        }
-        if (targetAsset.version !== cmd.payload.expectedEvidenceVersion) {
-          throw new StaleRevisionConflictError(
-            "EvidenceAsset",
-            cmd.payload.expectedEvidenceVersion,
-            targetAsset.version
-          );
+        if (!targetAsset) {
+          throw new Error("Illegal state: targetAsset not loaded for supersede intent");
         }
 
         // Check if the target evidence asset has an active dispute across any revisions
@@ -1157,7 +1227,72 @@ export class PostgresEvidenceAssetRepository implements EvidenceAssetRepositoryP
         return rehydrateEvidenceDerivative(result);
       }
 
-      // Verify EvidenceAsset exists, belongs to client, and is not archived
+      // Discover lineage before locking to ensure canonical lock order: SKU -> Batch -> Source -> Evidence
+      const discoveryRevRes = await client.query<{ source_object_id: string }>(
+        `SELECT source_object_id FROM evidence_revisions
+         WHERE client_id = $1 AND evidence_id = $2 AND revision = $3`,
+        [cmd.clientId, cmd.payload.evidenceId, cmd.payload.evidenceRevision]
+      );
+      if (discoveryRevRes.rows.length === 0) {
+        throw new NotFoundError(
+          "EvidenceRevision",
+          `${cmd.payload.evidenceId}:${cmd.payload.evidenceRevision}`
+        );
+      }
+      const discoveredSourceObjectId = discoveryRevRes.rows[0]!.source_object_id;
+
+      // Discover lineage before locking to ensure canonical lock order: SKU -> Batch -> Source -> Evidence
+      const linkBatchRes = await client.query<{
+        batch_id: string;
+        sku_id: string;
+      }>(
+        `SELECT l.batch_id, b.sku_id
+         FROM batch_evidence_links l
+         JOIN product_batches b ON b.client_id = l.client_id AND b.batch_id = l.batch_id
+         WHERE l.client_id = $1 AND l.evidence_id = $2 AND l.evidence_revision = $3`,
+        [cmd.clientId, cmd.payload.evidenceId, cmd.payload.evidenceRevision]
+      );
+      if (linkBatchRes.rows.length === 0) {
+        throw new NotFoundError("ProductBatch", "Associated batch link not found");
+      }
+
+      // Explicitly lock SKU first FOR SHARE
+      const skuIds = [...new Set(linkBatchRes.rows.map((r) => r.sku_id))].sort();
+      for (const sId of skuIds) {
+        const skuLockRes = await client.query<{ archived_at: Date | null }>(
+          `SELECT archived_at FROM product_skus WHERE client_id = $1 AND sku_id = $2 FOR SHARE`,
+          [cmd.clientId, sId]
+        );
+        if (skuLockRes.rows.length === 0 || skuLockRes.rows[0]!.archived_at !== null) {
+          throw new AccessDeniedError("Associated SKU is archived.", "SKU_ARCHIVED");
+        }
+      }
+
+      // Explicitly lock Batch second FOR SHARE
+      const batchIds = [...new Set(linkBatchRes.rows.map((r) => r.batch_id))].sort();
+      for (const bId of batchIds) {
+        const batchLockRes = await client.query<{ archived_at: Date | null }>(
+          `SELECT archived_at FROM product_batches WHERE client_id = $1 AND batch_id = $2 FOR SHARE`,
+          [cmd.clientId, bId]
+        );
+        if (batchLockRes.rows.length === 0 || batchLockRes.rows[0]!.archived_at !== null) {
+          throw new AccessDeniedError("Associated batch is archived.", "BATCH_ARCHIVED");
+        }
+      }
+
+      // Next lock source_objects row FOR UPDATE
+      const sourceRes = await client.query<SourceObjectRow>(
+        `SELECT * FROM source_objects WHERE client_id = $1 AND source_object_id = $2 FOR UPDATE`,
+        [cmd.clientId, discoveredSourceObjectId]
+      );
+      if (sourceRes.rows.length === 0 || sourceRes.rows[0]!.availability !== "available") {
+        throw new AccessDeniedError(
+          "Underlying source object is unavailable.",
+          "SOURCE_UNAVAILABLE"
+        );
+      }
+
+      // Next lock evidence_assets row FOR UPDATE
       const assetRes = await client.query<EvidenceAssetRow>(
         `SELECT * FROM evidence_assets
          WHERE client_id = $1 AND evidence_id = $2 FOR UPDATE`,
@@ -1183,7 +1318,7 @@ export class PostgresEvidenceAssetRepository implements EvidenceAssetRepositoryP
         );
       }
 
-      // Verify EvidenceRevision exists
+      // Lock EvidenceRevision row FOR UPDATE
       const revRes = await client.query<EvidenceRevisionRow>(
         `SELECT * FROM evidence_revisions
          WHERE client_id = $1 AND evidence_id = $2 AND revision = $3 FOR UPDATE`,
@@ -1196,41 +1331,6 @@ export class PostgresEvidenceAssetRepository implements EvidenceAssetRepositoryP
         );
       }
 
-      // Verify associated batch and SKU are not archived (lock SKU and batch rows for share)
-      const skuRes = await client.query<{
-        sku_archived_at: Date | null;
-        batch_archived_at: Date | null;
-      }>(
-        `SELECT s.archived_at AS sku_archived_at, b.archived_at AS batch_archived_at
-         FROM batch_evidence_links l
-         JOIN product_batches b ON b.client_id = l.client_id AND b.batch_id = l.batch_id
-         JOIN product_skus s ON s.client_id = b.client_id AND s.sku_id = b.sku_id
-         WHERE l.client_id = $1 AND l.evidence_id = $2 AND l.evidence_revision = $3
-         FOR SHARE OF s, b`,
-        [cmd.clientId, cmd.payload.evidenceId, cmd.payload.evidenceRevision]
-      );
-      if (skuRes.rows.length === 0) {
-        throw new NotFoundError("ProductBatch", "Associated batch link not found");
-      }
-      if (skuRes.rows.some((r) => r.batch_archived_at !== null)) {
-        throw new AccessDeniedError("Associated batch is archived.", "BATCH_ARCHIVED");
-      }
-      if (skuRes.rows.some((r) => r.sku_archived_at !== null)) {
-        throw new AccessDeniedError("Associated SKU is archived.", "SKU_ARCHIVED");
-      }
-
-      // Verify underlying source object availability (lock source_objects row for update)
-      const sourceRes = await client.query<SourceObjectRow>(
-        `SELECT * FROM source_objects WHERE client_id = $1 AND source_object_id = $2 FOR UPDATE`,
-        [cmd.clientId, revRes.rows[0]!.source_object_id]
-      );
-      if (sourceRes.rows.length === 0 || sourceRes.rows[0]!.availability !== "available") {
-        throw new AccessDeniedError(
-          "Underlying source object is unavailable.",
-          "SOURCE_UNAVAILABLE"
-        );
-      }
-
       await this.assertNoActiveDisputes(
         client,
         cmd.clientId,
@@ -1329,7 +1429,27 @@ export class PostgresEvidenceAssetRepository implements EvidenceAssetRepositoryP
         return rehydrateEvidenceVerificationEvent(result);
       }
 
-      // Verify EvidenceAsset exists, belongs to client, and is not archived
+      // Discover source_object_id before locking to maintain canonical order: Source -> Evidence
+      const discoveryRevRes = await client.query<{ source_object_id: string }>(
+        `SELECT source_object_id FROM evidence_revisions
+         WHERE client_id = $1 AND evidence_id = $2 AND revision = $3`,
+        [cmd.clientId, cmd.payload.evidenceId, cmd.payload.evidenceRevision]
+      );
+      if (discoveryRevRes.rows.length === 0) {
+        throw new NotFoundError(
+          "EvidenceRevision",
+          `${cmd.payload.evidenceId}:${cmd.payload.evidenceRevision}`
+        );
+      }
+      const discoveredSourceObjectId = discoveryRevRes.rows[0]!.source_object_id;
+
+      // 1. Lock underlying source_objects row FOR UPDATE first
+      await client.query(
+        `SELECT 1 FROM source_objects WHERE client_id = $1 AND source_object_id = $2 FOR UPDATE`,
+        [cmd.clientId, discoveredSourceObjectId]
+      );
+
+      // 2. Lock EvidenceAsset row FOR UPDATE
       const assetRes = await client.query<{ archived_at: Date | null }>(
         `SELECT archived_at FROM evidence_assets
          WHERE client_id = $1 AND evidence_id = $2 FOR UPDATE`,
@@ -1342,7 +1462,7 @@ export class PostgresEvidenceAssetRepository implements EvidenceAssetRepositoryP
         throw new AccessDeniedError("Target evidence asset is archived.", "EVIDENCE_ARCHIVED");
       }
 
-      // Verify EvidenceRevision exists
+      // 3. Lock EvidenceRevision row FOR UPDATE
       const revRes = await client.query<EvidenceRevisionRow>(
         `SELECT * FROM evidence_revisions
          WHERE client_id = $1 AND evidence_id = $2 AND revision = $3 FOR UPDATE`,
@@ -1355,12 +1475,6 @@ export class PostgresEvidenceAssetRepository implements EvidenceAssetRepositoryP
         );
       }
 
-      // Lock underlying source_objects row FOR UPDATE so dispute checks and event appends synchronize
-      await client.query(
-        `SELECT 1 FROM source_objects WHERE client_id = $1 AND source_object_id = $2 FOR UPDATE`,
-        [cmd.clientId, revRes.rows[0]!.source_object_id]
-      );
-
       if (cmd.payload.withdrawalEventId) {
         const priorEventRes = await client.query<{ event_id: string }>(
           `SELECT event_id FROM evidence_verification_events
diff --git a/packages/infrastructure/src/index.ts b/packages/infrastructure/src/index.ts
index a08d631..0074717 100644
--- a/packages/infrastructure/src/index.ts
+++ b/packages/infrastructure/src/index.ts
@@ -475,5 +475,9 @@ export {
   PostgresEvidenceAssetRepository,
   type PostgresEvidenceAssetRepositoryOptions
 } from "./evidence/postgres-evidence-asset-repository.js";
+export {
+  PostgresCoaReportRepository,
+  type PostgresCoaReportRepositoryOptions
+} from "./postgres/repositories/postgres-coa-report-repository.js";
 
 export * from "./experiments/index.js";
diff --git a/packages/infrastructure/src/postgres/audit-protections.integration.test.ts b/packages/infrastructure/src/postgres/audit-protections.integration.test.ts
index 7428003..8fb33b5 100644
--- a/packages/infrastructure/src/postgres/audit-protections.integration.test.ts
+++ b/packages/infrastructure/src/postgres/audit-protections.integration.test.ts
@@ -499,7 +499,7 @@ describe("PostgreSQL audit immutability and application-role privileges integrat
     // Verify migration succeeds when no application role is configured
     await client.query("DROP SCHEMA public CASCADE; CREATE SCHEMA public;");
     const noRoleApplied = await runMigrations(client, { migrationsDirectory });
-    expect(noRoleApplied).toHaveLength(27);
+    expect(noRoleApplied).toHaveLength(28);
   });
 
   it("fails closed when application role has effective UPDATE or DELETE privilege on storyboard_candidates", async () => {
diff --git a/packages/infrastructure/src/postgres/baseline-schema.integration.test.ts b/packages/infrastructure/src/postgres/baseline-schema.integration.test.ts
index c06c672..f2dd7da 100644
--- a/packages/infrastructure/src/postgres/baseline-schema.integration.test.ts
+++ b/packages/infrastructure/src/postgres/baseline-schema.integration.test.ts
@@ -55,7 +55,7 @@ describe("PostgreSQL 18.6 baseline schema integration", () => {
   it("migrates an empty PostgreSQL 18.6 database through the baseline", async () => {
     const applied = await runMigrations(client, { migrationsDirectory });
 
-    expect(applied).toHaveLength(27);
+    expect(applied).toHaveLength(28);
     expect(applied[0]?.version).toBe("001");
     expect(applied[1]?.version).toBe("002");
     expect(applied[2]?.version).toBe("003");
@@ -83,6 +83,7 @@ describe("PostgreSQL 18.6 baseline schema integration", () => {
     expect(applied[24]?.version).toBe("025");
     expect(applied[25]?.version).toBe("026");
     expect(applied[26]?.version).toBe("027");
+    expect(applied[27]?.version).toBe("028");
 
     const schemaRes = await client.query(
       "SELECT version FROM schema_migrations ORDER BY version ASC"
@@ -114,7 +115,8 @@ describe("PostgreSQL 18.6 baseline schema integration", () => {
       { version: "024" },
       { version: "025" },
       { version: "026" },
-      { version: "027" }
+      { version: "027" },
+      { version: "028" }
     ]);
 
     const tablesRes = await client.query<{ table_name: string }>(
@@ -135,6 +137,10 @@ describe("PostgreSQL 18.6 baseline schema integration", () => {
       "campaign_reference_bibles",
       "campaigns",
       "clients",
+      "coa_measurements",
+      "coa_report_review_events",
+      "coa_report_revisions",
+      "coa_reports",
       "delivery_assembly_jobs",
       "evidence_assets",
       "evidence_derivatives",
diff --git a/packages/infrastructure/src/postgres/job-dispatch-contract.integration.test.ts b/packages/infrastructure/src/postgres/job-dispatch-contract.integration.test.ts
index 9ff1a12..eb45fc7 100644
--- a/packages/infrastructure/src/postgres/job-dispatch-contract.integration.test.ts
+++ b/packages/infrastructure/src/postgres/job-dispatch-contract.integration.test.ts
@@ -64,7 +64,8 @@ describe("PostgreSQL job dispatch schema contract integration", () => {
     expect(applied.some((m) => m.version === "025")).toBe(true);
     expect(applied.some((m) => m.version === "026")).toBe(true);
     expect(applied.some((m) => m.version === "027")).toBe(true);
-    expect(applied[applied.length - 1]?.version).toBe("027");
+    expect(applied.some((m) => m.version === "028")).toBe(true);
+    expect(applied[applied.length - 1]?.version).toBe("028");
 
     // 2. Run it again and assert []
     const rerun = await runMigrations(client, { migrationsDirectory });
diff --git a/packages/infrastructure/src/postgres/repositories/postgres-product-evidence-repository.ts b/packages/infrastructure/src/postgres/repositories/postgres-product-evidence-repository.ts
index 93303c2..4197fb5 100644
--- a/packages/infrastructure/src/postgres/repositories/postgres-product-evidence-repository.ts
+++ b/packages/infrastructure/src/postgres/repositories/postgres-product-evidence-repository.ts
@@ -397,7 +397,11 @@ const PRODUCT_REGISTRY_TABLES = new Set<string>([
   "batch_evidence_links",
   "evidence_derivatives",
   "evidence_verification_events",
-  "evidence_ingest_reservations"
+  "evidence_ingest_reservations",
+  "coa_reports",
+  "coa_report_revisions",
+  "coa_measurements",
+  "coa_report_review_events"
 ]);
 
 const REGISTRY_CONSTRAINTS = new Set<string>([
@@ -540,7 +544,54 @@ const REGISTRY_CONSTRAINTS = new Set<string>([
   "evidence_ingest_reservations_reserved_bytes_check",
   "evidence_ingest_reservations_status_check",
   "chk_reservation_sha256_format",
-  "chk_reservation_timestamps"
+  "chk_reservation_timestamps",
+  "coa_reports_pkey",
+  "uq_coa_reports_client_report",
+  "uq_coa_reports_client_batch_evidence",
+  "uq_coa_reports_head_identity",
+  "fk_coa_reports_batch",
+  "fk_coa_reports_evidence",
+  "fk_coa_reports_current_rev",
+  "chk_coa_reports_created_at",
+  "chk_coa_reports_archived_at",
+  "coa_report_revisions_pkey",
+  "uq_coa_report_revisions_lineage",
+  "fk_coa_report_revisions_head",
+  "fk_coa_report_revisions_head_identity",
+  "fk_coa_report_batch_evidence",
+  "fk_coa_report_verified_lab",
+  "fk_coa_report_predecessor",
+  "chk_coa_report_rev_monotonic",
+  "uq_coa_report_rev_predecessor",
+  "chk_coa_report_asserted_by_nonempty",
+  "chk_coa_report_asserted_at",
+  "chk_coa_report_dates_range",
+  "chk_coa_report_sample_date_le_report_date",
+  "chk_coa_report_dates_le_asserted_at",
+  "chk_coa_report_complete_requirements",
+  "trg_check_coa_report_complete_measurements",
+  "coa_measurements_pkey",
+  "uq_coa_measurements_full",
+  "uq_coa_measurements_lineage",
+  "uq_coa_measurements_analyte_context",
+  "fk_coa_measurements_report",
+  "chk_coa_measurement_strings_nonempty",
+  "chk_coa_measurement_quantified",
+  "chk_coa_measurement_below_limit",
+  "chk_coa_measurement_not_detected",
+  "chk_coa_measurement_metadata",
+  "chk_coa_measurement_percent_bounds",
+  "chk_coa_measurement_fraction_bounds",
+  "chk_coa_measurement_unit_contradictions",
+  "trg_enforce_coa_measurements_insert",
+  "coa_report_review_events_pkey",
+  "uq_coa_review_events_client_event",
+  "uq_coa_review_events_decision_per_rev",
+  "fk_coa_review_events_revision",
+  "chk_coa_review_events_reason_nonempty",
+  "chk_coa_review_events_actor_nonempty",
+  "chk_coa_review_events_occurred_at",
+  "trg_check_coa_report_review_event_invariants"
 ]);
 
 export function translateDatabaseError(
@@ -640,6 +691,42 @@ export function translateDatabaseError(
             `Duplicate evidence ingest reservation conflict: ${dbErr.message}`
           );
         }
+        if (dbErr.constraint === "uq_coa_reports_client_batch_evidence") {
+          throw new ConcurrencyConflictError(
+            "A CoA report already exists for this client, batch, and evidence asset."
+          );
+        }
+        if (
+          dbErr.constraint === "uq_coa_reports_client_report" ||
+          dbErr.constraint === "coa_reports_pkey"
+        ) {
+          throw new ConcurrencyConflictError(`Duplicate CoA report conflict: ${dbErr.message}`);
+        }
+        if (
+          dbErr.constraint === "uq_coa_report_rev_predecessor" ||
+          dbErr.constraint === "coa_report_revisions_pkey"
+        ) {
+          throw new NonMonotonicRevisionError(
+            "CoA report revision conflict: duplicate or forked revision"
+          );
+        }
+        if (dbErr.constraint === "uq_coa_measurements_analyte_context") {
+          throw new ProductValidationError([
+            {
+              code: "INVALID_FIELD_COMBINATION",
+              path: ["measurements"],
+              message: "Duplicate analyte + basis + context in report revision"
+            }
+          ]);
+        }
+        if (
+          dbErr.constraint === "uq_coa_review_events_decision_per_rev" ||
+          dbErr.constraint === "coa_report_review_events_pkey"
+        ) {
+          throw new ConcurrencyConflictError(
+            "A review decision already exists for this report revision."
+          );
+        }
         if (
           (dbErr.constraint && REGISTRY_CONSTRAINTS.has(dbErr.constraint)) ||
           (dbErr.table && PRODUCT_REGISTRY_TABLES.has(dbErr.table))
@@ -754,6 +841,50 @@ export function translateDatabaseError(
             "Referenced withdrawal event does not exist"
           );
         }
+        if (dbErr.constraint === "fk_coa_reports_current_rev") {
+          throw new StaleRevisionConflictError("CoaReport", 0, 0);
+        }
+        if (dbErr.constraint === "fk_coa_reports_batch") {
+          throw new NotFoundError("ProductBatch", context?.batchId ?? "unknown");
+        }
+        if (dbErr.constraint === "fk_coa_reports_evidence") {
+          throw new NotFoundError("EvidenceAsset", "Referenced evidence asset does not exist");
+        }
+        if (dbErr.constraint === "fk_coa_report_batch_evidence") {
+          throw new NotFoundError(
+            "BatchEvidenceLink",
+            "Referenced evidence revision is not linked to this batch"
+          );
+        }
+        if (dbErr.constraint === "fk_coa_report_verified_lab") {
+          throw new NotFoundError(
+            "EvidenceVerificationEvent",
+            "Referenced verified lab identity event does not exist"
+          );
+        }
+        if (dbErr.constraint === "fk_coa_report_revisions_head") {
+          throw new NotFoundError("CoaReport", "Referenced CoA report head does not exist");
+        }
+        if (dbErr.constraint === "fk_coa_report_revisions_head_identity") {
+          throw new CrossBatchSourceError(
+            "CoA report revision batch or evidence does not match report head"
+          );
+        }
+        if (dbErr.constraint === "fk_coa_measurements_report") {
+          throw new NotFoundError(
+            "CoaReportRevision",
+            "Referenced CoA report revision does not exist"
+          );
+        }
+        if (dbErr.constraint === "fk_coa_report_predecessor") {
+          throw new NonMonotonicRevisionError("Predecessor CoA report revision does not exist");
+        }
+        if (dbErr.constraint === "fk_coa_review_events_revision") {
+          throw new NotFoundError(
+            "CoaReportRevision",
+            "Referenced CoA report revision does not exist"
+          );
+        }
         if (
           (dbErr.constraint && REGISTRY_CONSTRAINTS.has(dbErr.constraint)) ||
           (dbErr.table && PRODUCT_REGISTRY_TABLES.has(dbErr.table))
@@ -789,7 +920,9 @@ export function translateDatabaseError(
           dbErr.message.includes("updated_at must be nondecreasing") ||
           dbErr.message.includes("Permanent evidence asset identity") ||
           dbErr.message.includes("Permanent source object binary columns") ||
+          dbErr.message.includes("Permanent CoA report identity") ||
           dbErr.message.includes("Archived evidence asset") ||
+          dbErr.message.includes("Archived CoA report") ||
           dbErr.message.includes("Archived source objects") ||
           dbErr.message.includes("Deleted source objects") ||
           dbErr.message.includes("Quarantined, archived, or deleted") ||
@@ -823,9 +956,45 @@ export function translateDatabaseError(
         // Check constraints - strictly allowlisted registry checks only
         if (
           dbErr.constraint === "chk_evidence_rev_monotonic" ||
-          dbErr.constraint === "chk_evidence_revision_supersedes_not_self"
+          dbErr.constraint === "chk_evidence_revision_supersedes_not_self" ||
+          dbErr.constraint === "chk_coa_report_rev_monotonic"
+        ) {
+          throw new NonMonotonicRevisionError("Revision must be contiguous and monotonic");
+        }
+        if (
+          dbErr.constraint === "trg_check_coa_report_complete_measurements" ||
+          dbErr.message.includes("must contain at least one measurement")
+        ) {
+          throw new ProductValidationError([
+            {
+              code: "INVALID_FIELD_COMBINATION",
+              path: ["measurements"],
+              message: "Complete CoA report revisions must contain at least one measurement."
+            }
+          ]);
+        }
+        if (
+          dbErr.constraint === "trg_enforce_coa_measurements_insert" ||
+          dbErr.message.includes("Cannot insert measurements into")
         ) {
-          throw new NonMonotonicRevisionError("Evidence revision must be contiguous and monotonic");
+          throw new AccessDeniedError(dbErr.message);
+        }
+        if (
+          dbErr.constraint === "trg_check_coa_report_review_event_invariants" ||
+          dbErr.message.includes("Cannot approve a draft") ||
+          dbErr.message.includes("Assessed scope cannot be attributed_lot") ||
+          dbErr.message.includes("Self-approval forbidden")
+        ) {
+          if (dbErr.message.includes("Self-approval forbidden")) {
+            throw new AccessDeniedError(dbErr.message);
+          }
+          throw new ProductValidationError([
+            {
+              code: "INVALID_FIELD_COMBINATION",
+              path: ["decision"],
+              message: dbErr.message
+            }
+          ]);
         }
         if (dbErr.constraint === "chk_batch_facts_monotonic_rev") {
           throw new NonMonotonicRevisionError(
@@ -972,6 +1141,7 @@ export function translateDatabaseError(
           dbErr.constraint?.startsWith("chk_derivative_") ||
           dbErr.constraint?.startsWith("chk_verification_events_") ||
           dbErr.constraint?.startsWith("chk_reservation_") ||
+          dbErr.constraint?.startsWith("chk_coa_") ||
           dbErr.constraint === "chk_sha256_format" ||
           (dbErr.table && PRODUCT_REGISTRY_TABLES.has(dbErr.table))
         ) {
diff --git a/packages/infrastructure/src/postgres/uow/postgres-unit-of-work.ts b/packages/infrastructure/src/postgres/uow/postgres-unit-of-work.ts
index 69811a4..7505d84 100644
--- a/packages/infrastructure/src/postgres/uow/postgres-unit-of-work.ts
+++ b/packages/infrastructure/src/postgres/uow/postgres-unit-of-work.ts
@@ -19,6 +19,7 @@ import {
   translateDatabaseError
 } from "../repositories/postgres-product-evidence-repository.js";
 import { PostgresEvidenceAssetRepository } from "../../evidence/postgres-evidence-asset-repository.js";
+import { PostgresCoaReportRepository } from "../repositories/postgres-coa-report-repository.js";
 
 export class PostgresUnitOfWork implements UnitOfWork {
   constructor(private readonly pool: Pool) {}
@@ -49,6 +50,9 @@ export class PostgresUnitOfWork implements UnitOfWork {
         }),
         evidenceAsset: new PostgresEvidenceAssetRepository(client, {
           externalTransaction: true
+        }),
+        coaReports: new PostgresCoaReportRepository(client, {
+          externalTransaction: true
         })
       };
 
diff --git a/packages/shared/src/index.ts b/packages/shared/src/index.ts
index 838c93b..a8f65cf 100644
--- a/packages/shared/src/index.ts
+++ b/packages/shared/src/index.ts
@@ -33,3 +33,4 @@ export * from "./error-redaction.js";
 export * from "./json-canonicalization.js";
 export * from "./client-session-token.js";
 export * from "./product-identity.js";
+export * from "./coa-measurement.js";
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
