# Source Evidence Storage, Retention & Recovery Runbook

**Issue Reference:** #473 (Phase 1, Parent #469)  
**Classification:** Operational Runbook & Storage Governance  
**Governing ADRs:** ADR 0001 (Storage Decoupling), ADR 0007 (Database Schema), ADR 0009 (Verified Product Evidence)

---

## 1. Storage Retention Classification & Architecture

Source evidence assets are authoritative originals (macro photographs, Certificate of Analysis PDFs, Adobe DNG RAW captures, and cultivation/process records) that substantiate product identity and claims.

### 1.1 Object Storage Parameters

| Property | Value | Description |
| :--- | :--- | :--- |
| **Bucket Name** | `godzspeed-evidence` (`BUCKETS.EVIDENCE`) | Isolated, private bucket dedicated to source evidence archives. |
| **Object Key Path** | `clients/{clientId}/evidence/originals/{originalSha256}` | Deterministic, content-addressed key scoped strictly per tenant. |
| **Access Class** | `restricted_original` | Never publicly exposed; presigned URLs are strictly ephemeral and never persisted in database records. |
| **Retention Class** | `source_evidence_archive` | Non-expiring retention lifecycle; objects are never silently aged out or auto-deleted by lifecycle rules. |
| **Policy Version** | `dev-evidence-policy-v1` (or operator signed-off prod policy) | Explicit storage policy governance identifier recorded on each `SourceObject`. |

### 1.2 Refusal of Assumed Production-Ready Archival

> [!WARNING]
> Local MinIO and dev environments are distribution and review caching layers, **not** certified immutable archival vaults.
> Under `DEFAULT_DEV_EVIDENCE_STORAGE_POLICY`, `isProductionApproved` is `false`. Any registration attempted in an environment where `NODE_ENV === "production"` with an unapproved policy is rejected immediately with:
> `ACCESS_DENIED (PRODUCTION_POLICY_NOT_APPROVED): Production evidence archival policy has not been signed off.`

Production deployment requires a signed compliance retention policy and an external S3-compliant Object Lock / WORM (Write Once Read Many) bucket configuration.

---

## 2. Ingestion & Validation Lifecycle

### 2.1 Inspection Matrix & Bounds

Before bytes reach storage or persistence:
1. **Photo Class (`photo`)**: Default max 10 MiB; JPEG, PNG, WebP inspected via Sharp; max 16,384 px dimension, 67,108,864 px area.
2. **Document / CoA Class (`document`, `coa`, `process_record`)**: Default max 25 MiB; PDF inspected via `pdf-lib` to ensure valid header/trailer, correct page structure, and absence of executable JavaScript, external hooks (`/Launch`), or embedded executables (`/EmbeddedFiles`).
3. **RAW Class (`raw`)**: Default max 64 MiB; strictly limited to open standard Adobe DNG (`image/x-adobe-dng`, TIFF tag 50706 `DNGVersion`). Proprietary vendor formats (`.cr2`, `.nef`, `.arw`) and video formats are rejected with actionable `UNSUPPORTED_MIME` errors.

### 2.2 Quota Reservations & Concurrency

1. Client storage quota (`maxClientStorageBytes`) is evaluated against `totalStoredBytes + activeReservedBytes + uploadBytes`.
2. Concurrent inflight limit (`maxConcurrentUploads`) prevents resource exhaustion.
3. Active reservations in `evidence_ingest_reservations` expire after 300 seconds (5 minutes) if abandoned.

### 2.3 Per-Key Advisory Locking & Idempotent PUT

1. Cross-process / session-level advisory lock is acquired on the key `clients/{clientId}/evidence/originals/{originalSha256}`.
2. Object PUT is conditional using HTTP `If-None-Match: *`.
3. If an object already exists (`ObjectAlreadyExistsError`):
   - Storage adapter reads back existing bytes.
   - Computed SHA-256 of stored object is compared to incoming payload hash.
   - If bytes match: Deduplication succeeds without rewriting S3.
   - If bytes mismatch: Storage corruption or key clash is detected; transaction fails closed with `SOURCE_INTEGRITY_MISMATCH`.
4. Staged readback verification: Stored bytes are read back and hash-verified immediately after upload to confirm physical storage integrity before database commit.

---

## 3. Storage Failure & Orphan Reconciliation

### 3.1 Why Blobs Are Not Deleted on DB Commit Failure

> [!IMPORTANT]
> When a database transaction fails (e.g. concurrent batch state change, conflict, network partition), the uploaded S3 object is **intentionally NOT deleted**.
> 
> **Rationale:** Because objects are content-addressed (`clients/{clientId}/evidence/originals/{originalSha256}`), deleting an S3 blob on transaction failure could destroy a binary that was concurrently registered or referenced by another committed transaction. The reservation is marked `abandoned` (retaining accounting for the unreferenced blob), and the blob remains in S3 as an unreferenced object until reconciliation.

### 3.2 Orphan Blob Reconciliation Procedure

To identify and reconcile unreferenced blobs in `godzspeed-evidence`:

1. **Query Active Source Objects in Database:**
   ```sql
   SELECT client_id, original_sha256, storage_object_key
   FROM source_objects
   WHERE availability != 'deleted_under_retention';
   ```
2. **List S3 Objects in Bucket:**
   List all keys under prefix `clients/` in `godzspeed-evidence`.
3. **Difference Analysis:**
   Identify keys present in S3 but absent from `source_objects`.
4. **Safety Window:**
   Any unreferenced S3 object whose upload timestamp is older than 24 hours (outside any active reservation window) may be staged for archival cleanup or operator inspection.

### 3.3 Expired Reservation Cleanup

The background job periodically reaps expired reservations:
```sql
UPDATE evidence_ingest_reservations
SET status = 'released', updated_at = NOW()
WHERE status = 'active' AND expires_at < NOW();
```

---

## 4. Quarantine & Dispute Recovery

### 4.1 Quarantining Tampered Source Objects

If an on-disk integrity scan or derivative generation step detects a mismatch between `original_sha256` and persisted blob bytes:
1. `quarantineSourceObject(clientId, sourceObjectId, reason)` is invoked.
2. `source_objects.availability` is set to `'quarantined'`.
3. Quarantined objects can never be used to substantiate claims or linked to new batches.
4. Existing claims referencing the quarantined source object fail validation and must be withdrawn or superseded.

### 4.2 Handling Lab Disputes & Audit Withdrawals

1. When a laboratory retracts a Certificate of Analysis or an attestation is challenged:
   `RecordEvidenceVerificationEventUseCase` is called with `outcome: "disputed"` or `outcome: "withdrawn"`.
2. If `outcome === "withdrawn"`, `withdrawalEventId` must reference the prior verified event being rescinded.
3. Events are append-only in `evidence_verification_events`; historic rows are never deleted, providing an indelible audit ledger.

---

## 5. Summary Checklist for Operators

- [ ] Ensure `godzspeed-evidence` bucket exists and has default encryption enabled (SSE-S3 or SSE-KMS).
- [ ] Confirm no public access block is disabled on `godzspeed-evidence`.
- [ ] Verify database migration `027_evidence_authority.sql` is applied.
- [ ] Before deploying to production, execute formal storage governance sign-off and update `isProductionApproved: true` with certified retention policy ID.
