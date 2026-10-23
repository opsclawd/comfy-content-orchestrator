# Product & Batch Evidence Dossier API Specification

## 1. Overview & Purpose

The Product & Batch Evidence API provides an authenticated, tenant-isolated private control-plane interface for managing the complete Phase 1 factual product provenance record:
1. **Product SKU Registry**: Global SKU definitions, consumer-facing catalog details, and regulatory categories.
2. **Product Batch & Lot Registry**: Physical production lots linked to SKUs with append-only immutable facts revisions.
3. **Evidence Assets**: Original media uploads (`multipart/form-data`) and cross-lot reusable sources with strict cryptographic integrity checks (SHA-256 digests).
4. **Derivative References**: Deterministic associations to render-ready reference images used by generative pipelines (e.g. MiniMax-H3).
5. **Certificate of Analysis (CoA) Panels**: Structured analytical lab reports containing typed measurements with explicit units, bases, context, and detection limits.
6. **Product Claims**: High-confidence assertions linked to verified analytical measurements and photographic evidence, subject to independent reviewer approvals and explicit invalidation cascades.
7. **Coherent Provenance Dossier**: A unified, deep read-model returning the full factual dossier (`clientId + batchId -> SKU, lot, evidence, derivatives, CoAs, claims, eligibility, and provenance links`).

---

## 2. Security Boundaries & Tenant Isolation

### 2.1 Tenant Scoping
All product evidence routes are nested under the tenant-scoped prefix:
```
/api/v1/clients/:clientId/...
```
- **Authentication**: The client context is resolved via authenticated session token or client API credentials.
- **Tenant Isolation**: If the authenticated caller's `clientId` does not match the `:clientId` URL parameter, the API returns `403 FORBIDDEN`.
- **Zero Existence Leakage**: Attempting to read an asset (SKU, batch, evidence, CoA, or claim) that belongs to another tenant returns `404 NOT_FOUND` or `403 FORBIDDEN`. Tenant B cannot infer the existence, IDs, or metadata of Tenant A's records.

### 2.2 Server-Resolved Reviewer Identity
Privileged actions—such as approving/rejecting a CoA report (`/coa-reports/:reportId/review`), verifying evidence (`/verification-events`), or reviewing/invalidating claims (`/claims/:claimId/review`, `/claims/:claimId/invalidate`)—resolve the reviewer actor strictly on the server:
- Arbitrary client headers (e.g. `X-Reviewer-Bypass`) are never trusted.
- The reviewer's identity is passed directly to the domain layer for audit logging and state fencing.
- Unauthorized review attempts fail with `403 FORBIDDEN`.

### 2.3 Storage Credential Sanitization
Internal storage metadata (`storageBucket`, `storageObjectKey`, `storageVersionId`) is strictly isolated to internal infrastructure:
- Over HTTP, wire responses map internal source records to `SafeSourceObjectResponse`, omitting internal bucket names and physical object keys.
- Media files are accessed exclusively through short-lived (300-second TTL) presigned delivery URLs via `GET /batches/:batchId/evidence/:evidenceId/revisions/:revision/media`. No public bucket access is permitted.

---

## 3. Coherent Dossier Read Model

```http
GET /api/v1/clients/:clientId/batches/:batchId/dossier
```

The dossier endpoint compiles the complete provenance graph for a batch without flattening unverified or aspirational values into an synthetic "approved specs" dictionary.

### Dossier Structure:
- `schemaVersion`: `"1.0.0"`
- `clientId`: Tenant UUID
- `sku`: Product SKU details (brand, title, net quantity, regulatory category)
- `batch`: Batch identity (lot identifier, internal batch code)
- `factsHistory`: Chronological log of immutable batch facts revisions (manufacture date, expiration date, origin kind, certifications)
- `evidenceLinks`: Associations between the batch and registered evidence assets
- `evidence`: Full evidence projection:
  - `asset`: Evidence metadata
  - `currentRevision`: Active revision details, capture date, rights and consent
  - `revisions`: Immutable revision history
  - `sourceObjects`: Safe source object projections (SHA-256, MIME type, byte length, upload audit)
  - `derivatives`: Render-ready reference asset IDs and transform hashes
  - `verificationEvents`: Attestations and corroboration events
- `coaReports`: Structured analytical lab reports:
  - `report`: Report status and identifiers
  - `currentRevision`: Head revision including measurement panel (`analyte`, `resultKind`, `resultValue`, `unit`, `basis`, `context`)
  - `revisions`: Complete revision history
  - `reviewEvents`: Head-level reviewer decisions
- `claims`: Product assertions and provenance resolutions:
  - `claim`: Canonical kind, proof category, active state
  - `currentRevision`: Parameters, wording, author
  - `revisions`: Revision history
  - `links`: Evidence and CoA links supporting the claim
  - `decisionEvents`: Approval, rejection, or invalidation decisions
  - `resolution`: Full eligibility evaluation, block reasons, and resolved provenance category (`lab_reported`, `operator_attested_sop`, `partner_process_record`, `source_photo`, `manual_unverified`)

---

## 4. State Machine & Invalidation Lifecycle

### Claim Lifecycle:
1. **`draft`**: Claim created with parameters and display wording.
2. **`evidence_linked`**: One or more valid evidence assets or CoA measurements linked with defined support roles (`primary_measurement`, `corroborating_record`, `visual_reference`).
3. **`reviewer_approved`**: Authorized reviewer inspects evidence and issues an approval decision.
4. **`rejected`**: Reviewer rejects the claim with recorded reason.
5. **`invalidated`**: Invalidation triggered due to upstream failure, supersession, dispute, or batch fact changes.

### Invalidation Triggers:
The `POST /batches/:batchId/claims/:claimId/invalidate` endpoint transitions a claim to `invalidated` with one of the following domain causes:
- `source_superseded`: Upstream evidence revision or CoA report was superseded by a newer version.
- `source_disputed`: An evidence source or analytical lab report was flagged as disputed.
- `source_archived`: The underlying evidence asset was archived.
- `source_quarantined`: An evidence asset failed integrity checks or was placed under quarantine.
- `integrity_failure`: Cryptographic SHA-256 hash or storage corruption was detected.
- `batch_facts_changed`: Underlying lot facts (e.g. organic/GMP certification) were revised.

Optimistic locking (`expectedVersion`) ensures that concurrent writes or stale invalidations fail fast with `409 STALE_REVISION_CONFLICT`.

---

## 5. Error Code Mapping

All errors follow a uniform JSON payload format:
```json
{
  "error": "STALE_REVISION_CONFLICT",
  "message": "Resource version 1 does not match expected version 2",
  "details": {}
}
```

| HTTP Status | Error Code | Description |
|---|---|---|
| `400` | `VALIDATION_ERROR` | Schema validation error or malformed decimal/date/UUID |
| `400` | `INVALID_MEASUREMENT_DECIMAL` | Measurement result value or limit is not a valid decimal string |
| `400` | `UNSUPPORTED_MIME_TYPE` | Uploaded media type is not permitted |
| `401` | `AUTHENTICATION_REQUIRED` | Missing or invalid authentication token |
| `403` | `FORBIDDEN` | Caller does not own the tenant resource or lacks reviewer role |
| `404` | `NOT_FOUND` | Resource (SKU, batch, evidence, CoA, claim) not found in tenant scope |
| `409` | `STALE_REVISION_CONFLICT` | `expectedVersion` did not match head version |
| `409` | `IDEMPOTENCY_CONFLICT` | Replayed request with matching `actionId` had mismatched payload |
| `409` | `CONCURRENCY_CONFLICT` | Concurrent modification lock detected |
| `409` | `SOURCE_SUPERSEDED` | Attempted to link or verify a superseded evidence or CoA revision |
| `409` | `CROSS_BATCH_SOURCE` | Evidence or CoA from Batch A linked to Batch B |
| `409` | `REPORT_DISPUTED` | Operation attempted on disputed lab report |
| `409` | `EVIDENCE_REVISION_LOCKED` | Attempted mutation of sealed evidence revision |
| `409` | `UNVERIFIED_CLAIM_PROVENANCE` | Claim approval attempted without required verified evidence chain |
| `500` | `STORAGE_CONFIGURATION_ERROR` | S3 or storage policy misconfiguration |
| `500` | `INTERNAL_ERROR` | Unhandled server error |
