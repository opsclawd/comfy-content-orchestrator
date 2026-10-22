# Verified-Batch Operator Runbook: Real-Data Accuracy Review

> [!IMPORTANT]
> **Operator Human Judgment Mandate:**
> This procedure requires direct human inspection by an authorized QA or compliance operator. Automated tests (CI) verify contract integrity and state transition invariants; **CI cannot verify that a transcribed value accurately reflects a physical document, or that a company holds legal rights to an original image**. This review must be conducted by human judgment prior to external reliance.

Parent: #469 — Phase 1 (Verified batch and evidence records)  
Issue: #477 / VPM-P1.8 (Minimal verified-batch operator workspace and Phase 1 end-to-end evidence gate)  
Governing Architecture: [ADR 0009](adr/0009-verified-product-batch-evidence-claim-authority.md)  
Acceptance Matrix: [docs/verified-batch-workspace-acceptance.md](verified-batch-workspace-acceptance.md)  
Related Runbooks:
- [CoA Manual Transcription and Verification Runbook](coa-manual-entry-runbook.md)
- [Source Evidence Storage, Retention & Recovery Runbook](source-evidence-storage-recovery-runbook.md)

---

## 1. Prerequisites & Access Setup

1. **Private Network Access & Trusted Proxy Configuration**:
   - Connect to the private tailnet via Tailscale. The Review Hub and Control API must operate behind an authenticated reverse proxy that forwards identity headers:
     - `tailscale-user-login`: verified email/handle of the authenticated user
     - `x-test-actor-id`: permitted only in local staging/test environments
   - Ensure your Tailscale identity (`tailscale-user-login`) is mapped to an authorized director profile in `REVIEW_HUB_DIRECTOR_CLIENT_MAPPINGS`.
2. **Reviewer Role Grant Setup & Separation of Duties**:
   - Compliance review operations (evidence verification, CoA report approval, product claim approval) require an authorized reviewer grant.
   - Operators with data-entry roles (`assertedBy`) are structurally prohibited from approving their own entries (`reviewerAuthorization.assertCanReviewCoaReport`, `assertCanReviewClaim`, `assertCanVerifyEvidence`).
   - Confirm that at least two distinct human operators participate in the verification: one data-entry operator and one designated compliance reviewer.
3. **Storage Governance & Retention Policy**:
   - Binary evidence files are held in MinIO/S3 object storage with access class `restricted_original` and retention class `source_evidence_archive`.
   - The active storage policy configuration must match `DEFAULT_DEV_EVIDENCE_STORAGE_POLICY` (or production approved equivalent with `isProductionApproved: true`).
   - Objects in `source_evidence_archive` are subject to immutable non-expiring retention lifecycles and must never be deleted by automated lifecycle rules.
4. **Review Hub Staging Instance**:
   - Access the Review Hub at `http://<staging-host>:3000/products`.
   - Verify that your client organization appears in the Authorized Client Chooser.
5. **Source Documents on Hand**:
   - Obtain one authentic, non-public certificate of analysis (PDF) and one original product photograph (RAW/PNG/JPEG).
   - Ensure the files are stored on your local workstation and do not contain public consumer marketing leaks.

---

## 2. Step-by-Step Operator Review Workflow

### Step 2.1: Create Non-Public Sample SKU and Batch
1. In Review Hub, select your authorized client from the chooser (`/products`).
2. On `/clients/[clientId]/products`, click **+ Create SKU**:
   - Enter a canonical SKU code (e.g. `SKU-SAMPLE-REAL-01`).
   - Enter a descriptive display name (e.g. `Sample Real Lot SKU`).
3. Select the created SKU and click **+ Create Lot / Batch**:
   - Enter the lot identifier from the physical package or lab manifest (e.g. `LOT-SAMPLE-2026-A1`).
   - Select the production origin (`own_production` or `partner_origin`).
   - Enter the producer/grower name.
   - Enter production start and end dates if documented.
4. Click **View Dossier** to enter the Batch Evidence Dossier workspace.

### Step 2.2: Register Original Evidence & Confirm Storage Integrity
1. In the **Source Evidence & Provenance** panel, click **+ Register Evidence**:
   - Select `Upload New File (Multipart)`.
   - Choose your original hero photo or lab certificate PDF.
   - Set Purpose: `macro_hero_photo`, `coa_test_report`, `cultivation_log`, `processing_record`, `packaging_spec`, or `general_supporting_evidence`.
   - Set Source Class: `photo` or `coa` (for laboratory test report).
   - Set Acquisition Method: `direct_upload`, `supplier_submission`, `field_capture`, or `lab_transfer`.
   - Set Capture Date and Precision (e.g. `date`, `minute`) if known (or leave blank).
   - Set Legal Rights Status: `unknown`, `granted`, `restricted`, or `denied`.
   - Set Consent Status: `unknown`, `granted`, `restricted`, or `denied`.
   - Enter Rights Attribution (e.g., photographer/agency/lab contract attribution).
   - Enter Submitter Assertion text (e.g., "Original unedited camera intake capture").
   - Click **Register Source Evidence**.
2. **Inspect Cryptographic Source Object, Storage Governance & Retention Plan**:
   - Verify the displayed SHA-256 matches your local file hash (`sha256sum <local-file>`).
   - Confirm that the displayed storage governance indicates retention class `source_evidence_archive` with the environment's configured policy version (e.g. `1.0`).
   - Confirm tenant storage quota is verified and source retention policy prevents automated deletion or unapproved lifecycle purges.
   - Verify that internal MinIO keys, bucket names, and filesystem paths are **NOT** displayed anywhere on screen.
   - Click **Inspect Original Media** and confirm the preview loads using the short-lived presigned URL (300-second TTL).

### Step 2.3: Transcribe Certificate of Analysis (CoA)
1. In the **Analytical Laboratory Reports (CoA)** panel, click **+ Transcribe CoA Report**:
   - Select the pinned lab report evidence asset registered in Step 2.2.
   - Enter the official lab report identifier (as printed on the certificate).
   - Enter the testing laboratory name and report date.
   - Enter analytical measurements from the report table:
     - **Analyte**: Exact analyte name (e.g. `THC`, `CBD`, `Terpinolene`).
     - **Result Kind**: `quantified`, `below_limit`, or `not_detected`.
     - **Exact Value**: Type the number **exactly as printed**, including all trailing zeros (e.g. `24.5000`, not `24.5`).
     - **Unit**: Exact unit symbol (`percent`, `mg/g`, `ppm`).
     - **Basis**: Measurement basis (`dry_weight`, `as_received`).
     - **Context**: Analytical context (`cannabinoid_profile`, `terpene_profile`, `heavy_metals`).
   - Click **Transcribe CoA Report**.

### Step 2.4: Independent Compliance Review (Separation of Duties)
1. **Non-Self-Approval Rule**:
   - The operator who entered the transcription (`assertedBy`) **cannot** approve it.
   - An independent compliance or QA reviewer must log in to Review Hub.
2. In the CoA panel, the reviewer clicks **Record Review**:
   - Open the original PDF via **Inspect Original Media**.
   - Compare each line item: Analyte, exact numerical value with zeros, unit, basis.
   - Verify lab accreditation details.
   - Select Decision: `approved` (or `rejected` if discrepancy found).
   - Enter review reason (e.g. `"Verified against accredited lab report signature"`).
   - Click **Submit Review**.
3. Verify the report badge transitions to **Operator-Reviewed (Approved)**.

### Step 2.5: Propose and Link Product Claim
1. In the **Product Claims & Supporting Evidence** panel, click **+ Propose Product Claim**:
   - Select Canonical Kind: `certificate_panel_measurement`.
   - Proof Category: `coa_measurement_backed`.
   - Enter matching measurement parameters (e.g. `THC`, `24.5000`, `percent`, `dry_weight`).
   - (Optional) Enter display wording copy: `"Contains 24.5000% THC by dry weight"`.
   - Click **Propose Claim**.
2. **Verify Block Reason**:
   - The newly proposed claim should initially display **Support Blocked** (Reason: no active evidence links).
3. **Link Supporting Evidence**:
   - Click **+ Link Evidence** on the claim.
   - Select the approved CoA report from Step 2.4.
   - Set Support Role: `primary_measurement`.
   - Click **Link Evidence Asset**.
   - Verify the claim transitions to **✓ Support Eligible**.
4. **Independent Claim Review**:
   - Authorized reviewer clicks **Review Claim** -> Decision: `approve` -> Submit.
   - Verify the claim state is updated and auditable in the dossier.

---

## 3. Real-Data Verification Report Template

*(Complete this evaluation record on your staging instance. Keep in client internal records; do not check proprietary company data into public repositories.)*

```markdown
# Phase 1 Real-Data Sample Verification Report

- Evaluator Name: <operator-name>
- Organization / Team: <compliance-team>
- Evaluation Date: <YYYY-MM-DD>
- Review Hub Staging Environment: <staging-url>

### 1. Sample Identifiers
- Client ID: <client-uuid>
- SKU Canonical Code: <sku-canonical-code>
- Lot Identifier: <lot-identifier>
- Batch UUID: <batch-uuid>

### 2. Cryptographic Source Integrity
- File Name: <file-name>
- Local Computed SHA-256: <local-sha256>
- Platform Registered SHA-256: <platform-sha256>
- Hashes Match Exactly: [ ] YES  /  [ ] NO
- Media Inspection Presigned URL Works: [ ] YES  /  [ ] NO
- No Internal Paths Leaked in UI/Network: [ ] CONFIRMED

### 3. CoA Manual Comparison Check
| Analyte | Certificate Printed Value | Transcribed Platform Value | Units Match | Basis Match | Match Verified? |
| :--- | :--- | :--- | :--- | :--- | :--- |
| <analyte-1> | <printed-val-1> | <transcribed-val-1> | [ ] YES | [ ] YES | [ ] PASS / [ ] FAIL |
| <analyte-2> | <printed-val-2> | <transcribed-val-2> | [ ] YES | [ ] YES | [ ] PASS / [ ] FAIL |
| <analyte-3> | <printed-val-3> | <transcribed-val-3> | [ ] YES | [ ] YES | [ ] PASS / [ ] FAIL |

### 4. Governance & Separation of Duties
- Transcription Recorded By: <operator-actor-id>
- Review Performed By: <reviewer-actor-id>
- Actors Are Distinct Human Individuals: [ ] YES  /  [ ] NO
- Self-Approval Guard Enforced: [ ] CONFIRMED

### 5. Final Real-Data Authenticity Judgment
- Decision: [ ] GO (Data accurate and provenance coherent)  /  [ ] NO-GO
- Operator Notes / Discrepancies:
  <operator-notes>
```
