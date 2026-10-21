# Verified Product, Batch, Evidence, and Claim Acceptance Fixtures

> [!IMPORTANT]
> **Synthetic Architectural Test Fixtures Notice:**
> All identifiers, UUIDs, binary hashes, batch codes, test measurements, and laboratory references in this document are **strictly synthetic test fixtures** authored to validate relational constraints, state machine transitions, and concurrency semantics. No real-world chemical analyses, clinical data, agricultural provenance, or regulatory certifications are asserted.

Parent: #469 — Phase 1 (Verified batch and evidence records)  
Issue: #470 / VPM-P1.1 (Specify verified product, batch, evidence and claim authority contracts)  
Governing Architecture: [ADR 0009](adr/0009-verified-product-batch-evidence-claim-authority.md)

---

## 1. Deterministic Synthetic Fixture Identifiers

The following deterministic identifiers and cryptographic digests are reused throughout these acceptance scenarios:

| Entity Alias | Synthetic UUID / Value | Description |
| :--- | :--- | :--- |
| `CLIENT_ACME_ID` | `018f0000-0000-7000-8000-000000000001` | Primary tenant client ID |
| `CLIENT_BETA_ID` | `018f0000-0000-7000-8000-000000000002` | Unrelated second tenant client ID |
| `SKU_INDICA_ID` | `018f0000-0001-7000-8000-000000000001` | SKU: "Aurora Indica 3.5g" (`CANONICAL: SKU-AURORA-INDICA-01`) |
| `BATCH_LOT_A_ID` | `018f0000-0002-7000-8000-000000000001` | Lot A: `LOT-2026-IND-042` |
| `BATCH_LOT_B_ID` | `018f0000-0002-7000-8000-000000000002` | Lot B: `LOT-2026-IND-043` |
| `SRC_PHOTO_RAW_ID`| `018f0000-0003-7000-8000-000000000001` | Original high-res RAW photo file |
| `HASH_PHOTO_RAW` | `a1b2c3d4e5f67890123456789abcdef0123456789abcdef0123456789abcdef0` | SHA-256 of RAW photo bytes (18,432,000 bytes) |
| `REF_DERIVATIVE_ID`| `018f0000-0004-7000-8000-000000000001` | Downscaled WebP reference asset |
| `HASH_REF_WEBP` | `f0e1d2c3b4a596877890123456789abcdef0123456789abcdef0123456789abc` | SHA-256 of WebP reference bytes (482,100 bytes) |
| `SRC_COA_PDF_V1_ID`| `018f0000-0005-7000-8000-000000000001` | Initial CoA PDF document |
| `HASH_COA_PDF_V1` | `c1d2e3f405162738495a6b7c8d9e0f1a2b3c4d5e6f7a8b9c0d1e2f3a4b5c6d7e` | SHA-256 of initial CoA PDF (245,670 bytes) |
| `SRC_COA_PDF_V2_ID`| `018f0000-0005-7000-8000-000000000002` | Superseding re-test CoA PDF document |
| `HASH_COA_PDF_V2` | `e7d6c5b4a39281706f5e4d3c2b1a0f9e8d7c6b5a4f3e2d1c0b9a8f7e6d5c4b3a` | SHA-256 of superseding CoA PDF (248,120 bytes) |
| `EVID_MACRO_ID` | `018f0000-0006-7000-8000-000000000001` | Evidence Asset: Macro hero photo |
| `EVID_COA_ID` | `018f0000-0007-7000-8000-000000000001` | Evidence Asset: Laboratory CoA test report |
| `COA_REPORT_ID` | `018f0000-0008-7000-8000-000000000001` | Structured CoA report entity |
| `MEASUREMENT_THC_ID` | `018f0000-0020-7000-8000-000000000001` | CoA Measurement: THC total (24.50%) |
| `MEASUREMENT_CBD_ID` | `018f0000-0020-7000-8000-000000000002` | CoA Measurement: CBD total (<0.10%) |
| `MEASUREMENT_TERP_ID`| `018f0000-0020-7000-8000-000000000003` | CoA Measurement: Terpenes total (2.85%) |
| `MEASUREMENT_THC_V2_ID`| `018f0000-0020-7000-8000-000000000004`| Superseding CoA Measurement: THC total (22.10%) |
| `CLAIM_POTENCY_ID`| `018f0000-0009-7000-8000-000000000001` | Product claim: Total THC potency |
| `LINK_CLAIM_SOURCE_ID`| `018f0000-0030-7000-8000-000000000001` | Claim source link ID |
| `APPROVE_EVENT_ID`| `018f0000-0040-7000-8000-000000000001` | Reviewer approval decision event ID |
| `INVALIDATE_EVENT_ID`| `018f0000-0040-7000-8000-000000000002` | Cascade invalidation decision event ID |

---

## 2. End-to-End Sequence Walkthrough (Golden Path Trace)

This trace details the complete chronological sequence from initial SKU creation to claim invalidation and re-authoring.

```mermaid
sequenceDiagram
    autonumber
    actor Submitter as Client Submitter
    actor Reviewer as Compliance Reviewer
    participant API as Product Evidence API
    participant DB as PostgreSQL
    participant S3 as Object Storage (MinIO)

    Note over Submitter, DB: Step 1-3: SKU, Batch & Origin Facts Setup
    Submitter->>API: createSku(canonicalSku: "SKU-AURORA-INDICA-01")
    API->>DB: INSERT product_skus, product_evidence_command_receipts
    Submitter->>API: createBatch(skuId, lot: "LOT-2026-IND-042")
    API->>DB: INSERT product_batches (ver: 1, facts_rev: 1), product_batch_facts (rev: 1, unknown), receipt
    Submitter->>API: appendBatchFacts(batchId, originKind: "own_production", expectedVersion: 1)
    API->>DB: INSERT product_batch_facts (rev: 2, supersedes: 1), UPDATE product_batches (facts_rev: 2, ver: 2), receipt

    Note over Submitter, S3: Step 4-6: Visual Macro Evidence & Derivative Linkage
    Submitter->>API: ingestOriginalSource(body: RAW_BYTES, sha256: HASH_PHOTO_RAW)
    API->>S3: PUT clients/{clientId}/evidence/originals/{sha256}
    API->>DB: INSERT source_objects, receipt
    Submitter->>API: createEvidenceAsset(sourceObjectId, sourceClass: "raw")
    API->>DB: INSERT evidence_assets (ver: 1), evidence_revisions (rev: 1), receipt
    Submitter->>API: linkEvidenceToBatch(batchId, purpose: "macro_hero_photo")
    API->>DB: INSERT batch_evidence_links, receipt
    Submitter->>API: createEvidenceDerivative(referenceAssetId, transformDescription)
    API->>DB: INSERT evidence_derivatives, receipt

    Note over Submitter, DB: Step 7-9: CoA Test Report & Typed Measurements
    Submitter->>API: ingestOriginalSource(body: PDF_BYTES, sha256: HASH_COA_PDF_V1)
    API->>S3: PUT clients/{clientId}/evidence/originals/{sha256}
    API->>DB: INSERT source_objects, receipt
    Submitter->>API: createEvidenceAsset(sourceObjectId, sourceClass: "coa")
    API->>DB: INSERT evidence_assets (ver: 1), evidence_revisions (rev: 1), receipt
    Submitter->>API: linkEvidenceToBatch(batchId, purpose: "coa_test_report")
    API->>DB: INSERT batch_evidence_links, receipt
    Submitter->>API: createCoaReport(reportDate, measurements: [THC: "24.50", CBD: "<0.10", Terpenes: "2.85"])
    API->>DB: INSERT coa_reports (ver: 1), coa_report_revisions (rev: 1), coa_measurements, receipt

    Note over Submitter, Reviewer: Step 10-12: Claim Creation, Evidence Linking & Review Approval
    Submitter->>API: createClaim(type: "potency_cannabinoid", wording: "Total THC: 24.50% (Tested sample)", numericalValue: "24.50")
    API->>DB: INSERT product_claims (state: "draft", ver: 1), product_claim_revisions (rev: 1), receipt
    Submitter->>API: linkClaimSources(claimId, measurementId)
    API->>DB: INSERT claim_source_links; UPDATE product_claims (state: "evidence_linked", ver: 2), receipt
    Reviewer->>API: reviewClaim(claimId, decision: "approve")
    API->>DB: INSERT claim_decision_events; UPDATE product_claims (state: "reviewer_approved", ver: 3), receipt

    Note over Submitter, DB: Step 13-14: CoA Supersession & Atomic Invalidation
    Submitter->>API: ingestOriginalSource(body: PDF_V2_BYTES, sha256: HASH_COA_PDF_V2)
    API->>S3: PUT clients/{clientId}/evidence/originals/{sha256}
    API->>DB: INSERT source_objects, receipt
    Submitter->>API: supersedeEvidence(evidenceId, expectedVersion: 1, sourceObjectId: SRC_COA_PDF_V2_ID)
    API->>DB: INSERT evidence_revisions (rev: 2, supersedes: 1), UPDATE evidence_assets (current_revision: 2, ver: 2), receipt
    Submitter->>API: linkEvidenceToBatch(batchId, evidenceRevision: 2, purpose: "coa_test_report")
    API->>DB: INSERT batch_evidence_links, receipt
    Submitter->>API: supersedeCoaReport(reportId, expectedVersion: 1, evidenceRevision: 2, measurements: [THC: "22.10"])
    API->>DB: BEGIN TRANSACTION (Pessimistic row locks in hierarchy: batch, evidence, report, claim)
    API->>DB: INSERT coa_report_revisions (rev: 2, supersedes: 1), coa_measurements
    API->>DB: UPDATE coa_reports (current_revision: 2, version: 2)
    API->>DB: INSERT claim_decision_events (decision: "invalidate", cause: "source_superseded")
    API->>DB: UPDATE product_claims (state: "invalidated", version: 4) WHERE dependent on coa rev 1
    API->>DB: INSERT product_evidence_command_receipts (actionId: 18, committed)
    API->>DB: COMMIT TRANSACTION
```

---

### Trace Step Details

#### Step 1: Provision Product SKU
- **Command:** `createSku`
- **Envelope & Payload:**
  ```json
  {
    "actionId": "018f0000-0010-7000-8000-000000000001",
    "clientId": "018f0000-0000-7000-8000-000000000001",
    "actorId": "ops_user_01",
    "timestamp": "2026-03-24T10:00:00.000Z",
    "payload": {
      "canonicalSku": "SKU-AURORA-INDICA-01",
      "displayName": "Aurora Indica Dried Flower 3.5g"
    }
  }
  ```
- **Database Mutation:**
  ```sql
  BEGIN;
  INSERT INTO product_skus (sku_id, client_id, canonical_sku, display_name, version)
  VALUES ('018f0000-0001-7000-8000-000000000001', '018f0000-0000-7000-8000-000000000001', 'SKU-AURORA-INDICA-01', 'Aurora Indica Dried Flower 3.5g', 1);

  INSERT INTO product_evidence_command_receipts (client_id, action_id, command_name, payload_sha256, actor_id, response_body, committed_at)
  VALUES ('018f0000-0000-7000-8000-000000000001', '018f0000-0010-7000-8000-000000000001', 'createSku', 'a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4e5f6a1b2', 'ops_user_01', '{"skuId":"018f0000-0001-7000-8000-000000000001","canonicalSku":"SKU-AURORA-INDICA-01","version":1}'::jsonb, NOW());
  COMMIT;
  ```
- **Result:** `ProductSku` created with `skuId = 018f0000-0001-7000-8000-000000000001`, `version = 1`.

#### Step 2: Provision Product Batch & Initial Unknown Facts
- **Command:** `createBatch`
- **Envelope & Payload:**
  ```json
  {
    "actionId": "018f0000-0010-7000-8000-000000000002",
    "clientId": "018f0000-0000-7000-8000-000000000001",
    "actorId": "ops_user_01",
    "timestamp": "2026-03-24T10:05:00.000Z",
    "payload": {
      "skuId": "018f0000-0001-7000-8000-000000000001",
      "lotIdentifier": "LOT-2026-IND-042",
      "displayName": "Harvest Batch 2026-Q1 #42"
    }
  }
  ```
- **Database Mutation:**
  ```sql
  BEGIN;
  -- 1. Insert product_batches head (current_facts_revision = 1, version = 1)
  INSERT INTO product_batches (batch_id, client_id, sku_id, lot_identifier, display_name, version, current_facts_revision)
  VALUES ('018f0000-0002-7000-8000-000000000001', '018f0000-0000-7000-8000-000000000001', '018f0000-0001-7000-8000-000000000001', 'LOT-2026-IND-042', 'Harvest Batch 2026-Q1 #42', 1, 1);

  -- 2. Insert initial batch facts revision 1 (defaulted to origin_kind = 'unknown')
  INSERT INTO product_batch_facts (client_id, batch_id, revision, origin_kind, producer_identity_as_claimed, production_start_date, production_end_date, origin_evidence_id, origin_evidence_revision, asserted_by, supersedes_revision)
  VALUES ('018f0000-0000-7000-8000-000000000001', '018f0000-0002-7000-8000-000000000001', 1, 'unknown', NULL, NULL, NULL, NULL, NULL, 'ops_user_01', NULL);

  -- 3. Insert command receipt
  INSERT INTO product_evidence_command_receipts (client_id, action_id, command_name, payload_sha256, actor_id, response_body, committed_at)
  VALUES ('018f0000-0000-7000-8000-000000000001', '018f0000-0010-7000-8000-000000000002', 'createBatch', 'b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3', 'ops_user_01', '{"batchId":"018f0000-0002-7000-8000-000000000001","version":1,"currentFactsRevision":1}'::jsonb, NOW());

  COMMIT;
  ```
- **Result:** `ProductBatch` created with `batchId = 018f0000-0002-7000-8000-000000000001`, `version = 1`, `currentFactsRevision = 1`. Deferred FK `fk_product_batches_current_facts` succeeds at commit.

#### Step 3: Record Verified Batch Cultivation Facts
- **Command:** `appendBatchFacts`
- **Envelope & Payload:**
  ```json
  {
    "actionId": "018f0000-0010-7000-8000-000000000003",
    "clientId": "018f0000-0000-7000-8000-000000000001",
    "actorId": "lead_grower_01",
    "timestamp": "2026-03-24T10:10:00.000Z",
    "payload": {
      "batchId": "018f0000-0002-7000-8000-000000000001",
      "expectedVersion": 1,
      "originKind": "own_production",
      "producerIdentityAsClaimed": "Acme Cultivation Facility #4",
      "productionStartDate": "2026-01-10",
      "productionEndDate": "2026-03-22",
      "originEvidenceId": null,
      "originEvidenceRevision": null
    }
  }
  ```
- **Database Mutation:**
  ```sql
  BEGIN;
  SELECT batch_id FROM product_batches WHERE client_id = '018f0000-0000-7000-8000-000000000001' AND batch_id = '018f0000-0002-7000-8000-000000000001' FOR UPDATE;

  INSERT INTO product_batch_facts (client_id, batch_id, revision, origin_kind, producer_identity_as_claimed, production_start_date, production_end_date, origin_evidence_id, origin_evidence_revision, asserted_by, supersedes_revision)
  VALUES ('018f0000-0000-7000-8000-000000000001', '018f0000-0002-7000-8000-000000000001', 2, 'own_production', 'Acme Cultivation Facility #4', '2026-01-10', '2026-03-22', NULL, NULL, 'lead_grower_01', 1);

  UPDATE product_batches
  SET current_facts_revision = 2,
      version = version + 1,
      updated_at = NOW()
  WHERE client_id = '018f0000-0000-7000-8000-000000000001'
    AND batch_id = '018f0000-0002-7000-8000-000000000001'
    AND version = 1;

  INSERT INTO product_evidence_command_receipts (client_id, action_id, command_name, payload_sha256, actor_id, response_body, committed_at)
  VALUES ('018f0000-0000-7000-8000-000000000001', '018f0000-0010-7000-8000-000000000003', 'appendBatchFacts', 'c3d4e5f6a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4', 'lead_grower_01', '{"batchId":"018f0000-0002-7000-8000-000000000001","revision":2,"version":2}'::jsonb, NOW());

  COMMIT;
  ```
- **Result:** `product_batch_facts` rev 2 recorded (supersedes rev 1); `product_batches.current_facts_revision` advances to 2, `version` advances to 2.

#### Step 4: Ingest Macro Photograph Master & Assert Evidence
- **Step 4A Command:** `ingestOriginalSource`
  - **Envelope & Payload:**
    ```json
    {
      "actionId": "018f0000-0010-7000-8000-000000000004",
      "clientId": "018f0000-0000-7000-8000-000000000001",
      "actorId": "photographer_bob",
      "timestamp": "2026-03-24T10:14:00.000Z",
      "payload": {
        "originalSha256": "a1b2c3d4e5f67890123456789abcdef0123456789abcdef0123456789abcdef0",
        "detectedMimeType": "image/x-sony-arw",
        "byteLength": 18432000,
        "accessClass": "restricted_original",
        "retentionClass": "source_evidence_archive",
        "retentionPolicyVersion": "v1-legal-hold"
      }
    }
    ```
  - **Database Mutation:**
    ```sql
    BEGIN;
    INSERT INTO source_objects (source_object_id, client_id, storage_bucket, storage_object_key, original_sha256, detected_mime_type, byte_length, uploader_id, access_class, retention_class, retention_policy_version, availability)
    VALUES ('018f0000-0003-7000-8000-000000000001', '018f0000-0000-7000-8000-000000000001', 'cco-evidence-archive', 'clients/018f0000-0000-7000-8000-000000000001/evidence/originals/a1b2c3d4e5f67890123456789abcdef0123456789abcdef0123456789abcdef0', 'a1b2c3d4e5f67890123456789abcdef0123456789abcdef0123456789abcdef0', 'image/x-sony-arw', 18432000, 'photographer_bob', 'restricted_original', 'source_evidence_archive', 'v1-legal-hold', 'available');

    INSERT INTO product_evidence_command_receipts (client_id, action_id, command_name, payload_sha256, actor_id, response_body, committed_at)
    VALUES ('018f0000-0000-7000-8000-000000000001', '018f0000-0010-7000-8000-000000000004', 'ingestOriginalSource', 'd4e5f6a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4e5', 'photographer_bob', '{"sourceObjectId":"018f0000-0003-7000-8000-000000000001","originalSha256":"a1b2c3d4e5f67890123456789abcdef0123456789abcdef0123456789abcdef0","availability":"available"}'::jsonb, NOW());
    COMMIT;
    ```
- **Step 4B Command:** `createEvidenceAsset`
  - **Envelope & Payload:**
    ```json
    {
      "actionId": "018f0000-0010-7000-8000-000000000005",
      "clientId": "018f0000-0000-7000-8000-000000000001",
      "actorId": "photographer_bob",
      "timestamp": "2026-03-24T10:15:00.000Z",
      "payload": {
        "sourceObjectId": "018f0000-0003-7000-8000-000000000001",
        "sourceClass": "raw",
        "acquisitionMethod": "field_capture",
        "assertionText": "Authentic Sony A7R5 RAW macro capture of cured flower trichomes",
        "reportedCaptureDate": "2026-03-24",
        "captureContext": "Sony 90mm f/2.8 Macro at 1:1 reproduction, focus stacked 25 slices",
        "rightsStatus": "granted",
        "consentStatus": "granted",
        "rightsAttribution": "Photographer Bob / Acme Marketing License Agreement #884",
        "rightsDocumentLocator": "contracts/2026/license-884.pdf"
      }
    }
    ```
  - **Database Mutation:**
    ```sql
    BEGIN;
    INSERT INTO evidence_assets (evidence_id, client_id, current_revision, version)
    VALUES ('018f0000-0006-7000-8000-000000000001', '018f0000-0000-7000-8000-000000000001', 1, 1);

    INSERT INTO evidence_revisions (client_id, evidence_id, revision, source_object_id, source_class, acquisition_method, submitted_by, assertion_text, reported_capture_date, capture_context, rights_status, consent_status, rights_attribution, rights_document_locator, supersedes_revision)
    VALUES ('018f0000-0000-7000-8000-000000000001', '018f0000-0006-7000-8000-000000000001', 1, '018f0000-0003-7000-8000-000000000001', 'raw', 'field_capture', 'photographer_bob', 'Authentic Sony A7R5 RAW macro capture of cured flower trichomes', '2026-03-24', 'Sony 90mm f/2.8 Macro at 1:1 reproduction, focus stacked 25 slices', 'granted', 'granted', 'Photographer Bob / Acme Marketing License Agreement #884', 'contracts/2026/license-884.pdf', NULL);

    INSERT INTO product_evidence_command_receipts (client_id, action_id, command_name, payload_sha256, actor_id, response_body, committed_at)
    VALUES ('018f0000-0000-7000-8000-000000000001', '018f0000-0010-7000-8000-000000000005', 'createEvidenceAsset', 'e5f6a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4e5f6', 'photographer_bob', '{"evidenceId":"018f0000-0006-7000-8000-000000000001","revision":1,"version":1}'::jsonb, NOW());
    COMMIT;
    ```
- **Result:** `evidence_assets` created with `version = 1`, `evidence_revisions` rev 1 recorded.

#### Step 5: Link Macro Photo Evidence to Batch
- **Command:** `linkEvidenceToBatch`
- **Envelope & Payload:**
  ```json
  {
    "actionId": "018f0000-0010-7000-8000-000000000006",
    "clientId": "018f0000-0000-7000-8000-000000000001",
    "actorId": "ops_user_01",
    "timestamp": "2026-03-24T10:20:00.000Z",
    "payload": {
      "batchId": "018f0000-0002-7000-8000-000000000001",
      "evidenceId": "018f0000-0006-7000-8000-000000000001",
      "evidenceRevision": 1,
      "purpose": "macro_hero_photo"
    }
  }
  ```
- **Database Mutation:**
  ```sql
  BEGIN;
  INSERT INTO batch_evidence_links (client_id, batch_id, evidence_id, evidence_revision, purpose, asserted_by)
  VALUES ('018f0000-0000-7000-8000-000000000001', '018f0000-0002-7000-8000-000000000001', '018f0000-0006-7000-8000-000000000001', 1, 'macro_hero_photo', 'ops_user_01');

  INSERT INTO product_evidence_command_receipts (client_id, action_id, command_name, payload_sha256, actor_id, response_body, committed_at)
  VALUES ('018f0000-0000-7000-8000-000000000001', '018f0000-0010-7000-8000-000000000006', 'linkEvidenceToBatch', 'f6a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4e5f6a1', 'ops_user_01', '{"batchId":"018f0000-0002-7000-8000-000000000001","evidenceId":"018f0000-0006-7000-8000-000000000001","revision":1,"purpose":"macro_hero_photo"}'::jsonb, NOW());
  COMMIT;
  ```
- **Result:** `batch_evidence_links` record inserted.

#### Step 6: Create Evidence Derivative (Reference Asset Bridge)
- **Command:** `createEvidenceDerivative`
- **Envelope & Payload:**
  ```json
  {
    "actionId": "018f0000-0010-7000-8000-000000000007",
    "clientId": "018f0000-0000-7000-8000-000000000001",
    "actorId": "creative_tech_01",
    "timestamp": "2026-03-24T10:25:00.000Z",
    "payload": {
      "evidenceId": "018f0000-0006-7000-8000-000000000001",
      "evidenceRevision": 1,
      "referenceAssetId": "018f0000-0004-7000-8000-000000000001",
      "derivativeSha256": "f0e1d2c3b4a596877890123456789abcdef0123456789abcdef0123456789abc",
      "transformDescription": "Downscaled Lanczos crop to 1344x768 WebP for MiniMax-H3 conditioning",
      "transformToolVersion": "vips-8.15.1"
    }
  }
  ```
- **Database Mutation:**
  ```sql
  BEGIN;
  INSERT INTO evidence_derivatives (derivative_id, client_id, evidence_id, evidence_revision, reference_asset_id, derivative_sha256, transform_description, transform_tool_version, created_by)
  VALUES ('018f0000-0004-7000-8000-000000000001', '018f0000-0000-7000-8000-000000000001', '018f0000-0006-7000-8000-000000000001', 1, '018f0000-0004-7000-8000-000000000001', 'f0e1d2c3b4a596877890123456789abcdef0123456789abcdef0123456789abc', 'Downscaled Lanczos crop to 1344x768 WebP for MiniMax-H3 conditioning', 'vips-8.15.1', 'creative_tech_01');

  INSERT INTO product_evidence_command_receipts (client_id, action_id, command_name, payload_sha256, actor_id, response_body, committed_at)
  VALUES ('018f0000-0000-7000-8000-000000000001', '018f0000-0010-7000-8000-000000000007', 'createEvidenceDerivative', 'a2b3c4d5e6f7a2b3c4d5e6f7a2b3c4d5e6f7a2b3c4d5e6f7a2b3c4d5e6f7a2b3', 'creative_tech_01', '{"derivativeId":"018f0000-0004-7000-8000-000000000001","referenceAssetId":"018f0000-0004-7000-8000-000000000001"}'::jsonb, NOW());
  COMMIT;
  ```
- **Result:** Lineage bridge to visual conditioning `ReferenceAsset` established and verified.

#### Step 7: Ingest Initial CoA PDF Document & Assert Evidence Asset
- **Step 7A Command:** `ingestOriginalSource`
  - **Envelope & Payload:**
    ```json
    {
      "actionId": "018f0000-0010-7000-8000-000000000008",
      "clientId": "018f0000-0000-7000-8000-000000000001",
      "actorId": "lab_tech_lead",
      "timestamp": "2026-03-24T10:28:00.000Z",
      "payload": {
        "originalSha256": "c1d2e3f405162738495a6b7c8d9e0f1a2b3c4d5e6f7a8b9c0d1e2f3a4b5c6d7e",
        "detectedMimeType": "application/pdf",
        "byteLength": 245670,
        "accessClass": "restricted_original",
        "retentionClass": "source_evidence_archive",
        "retentionPolicyVersion": "v1-legal-hold"
      }
    }
    ```
  - **Database Mutation:**
    ```sql
    BEGIN;
    INSERT INTO source_objects (source_object_id, client_id, storage_bucket, storage_object_key, original_sha256, detected_mime_type, byte_length, uploader_id, access_class, retention_class, retention_policy_version, availability)
    VALUES ('018f0000-0005-7000-8000-000000000001', '018f0000-0000-7000-8000-000000000001', 'cco-evidence-archive', 'clients/018f0000-0000-7000-8000-000000000001/evidence/originals/c1d2e3f405162738495a6b7c8d9e0f1a2b3c4d5e6f7a8b9c0d1e2f3a4b5c6d7e', 'c1d2e3f405162738495a6b7c8d9e0f1a2b3c4d5e6f7a8b9c0d1e2f3a4b5c6d7e', 'application/pdf', 245670, 'lab_tech_lead', 'restricted_original', 'source_evidence_archive', 'v1-legal-hold', 'available');

    INSERT INTO product_evidence_command_receipts (client_id, action_id, command_name, payload_sha256, actor_id, response_body, committed_at)
    VALUES ('018f0000-0000-7000-8000-000000000001', '018f0000-0010-7000-8000-000000000008', 'ingestOriginalSource', 'b3c4d5e6f7a2b3c4d5e6f7a2b3c4d5e6f7a2b3c4d5e6f7a2b3c4d5e6f7a2b3c4', 'lab_tech_lead', '{"sourceObjectId":"018f0000-0005-7000-8000-000000000001","originalSha256":"c1d2e3f405162738495a6b7c8d9e0f1a2b3c4d5e6f7a8b9c0d1e2f3a4b5c6d7e"}'::jsonb, NOW());
    COMMIT;
    ```
- **Step 7B Command:** `createEvidenceAsset`
  - **Envelope & Payload:**
    ```json
    {
      "actionId": "018f0000-0010-7000-8000-000000000009",
      "clientId": "018f0000-0000-7000-8000-000000000001",
      "actorId": "lab_tech_lead",
      "timestamp": "2026-03-24T10:29:00.000Z",
      "payload": {
        "sourceObjectId": "018f0000-0005-7000-8000-000000000001",
        "sourceClass": "coa",
        "acquisitionMethod": "lab_transfer",
        "assertionText": "Official laboratory certificate of analysis for lot 42",
        "reportedCaptureDate": "2026-03-24",
        "captureContext": "Direct encrypted SFTP transfer from testing laboratory",
        "rightsStatus": "granted",
        "consentStatus": "granted",
        "rightsAttribution": "Steep Hill Analytical Labs / Client Service Agreement #410",
        "rightsDocumentLocator": "legal/agreements/lab-steep-hill-410.pdf"
      }
    }
    ```
  - **Database Mutation:**
    ```sql
    BEGIN;
    INSERT INTO evidence_assets (evidence_id, client_id, current_revision, version)
    VALUES ('018f0000-0007-7000-8000-000000000001', '018f0000-0000-7000-8000-000000000001', 1, 1);

    INSERT INTO evidence_revisions (client_id, evidence_id, revision, source_object_id, source_class, acquisition_method, submitted_by, assertion_text, reported_capture_date, capture_context, rights_status, consent_status, rights_attribution, rights_document_locator, supersedes_revision)
    VALUES ('018f0000-0000-7000-8000-000000000001', '018f0000-0007-7000-8000-000000000001', 1, '018f0000-0005-7000-8000-000000000001', 'coa', 'lab_transfer', 'lab_tech_lead', 'Official laboratory certificate of analysis for lot 42', '2026-03-24', 'Direct encrypted SFTP transfer from testing laboratory', 'granted', 'granted', 'Steep Hill Analytical Labs / Client Service Agreement #410', 'legal/agreements/lab-steep-hill-410.pdf', NULL);

    INSERT INTO product_evidence_command_receipts (client_id, action_id, command_name, payload_sha256, actor_id, response_body, committed_at)
    VALUES ('018f0000-0000-7000-8000-000000000001', '018f0000-0010-7000-8000-000000000009', 'createEvidenceAsset', 'c4d5e6f7a2b3c4d5e6f7a2b3c4d5e6f7a2b3c4d5e6f7a2b3c4d5e6f7a2b3c4d5', 'lab_tech_lead', '{"evidenceId":"018f0000-0007-7000-8000-000000000001","revision":1,"version":1}'::jsonb, NOW());
    COMMIT;
    ```
- **Result:** `evidence_assets` created with `version = 1`, `evidence_revisions` rev 1 recorded.

#### Step 8: Link Initial CoA Evidence Asset to Batch
- **Command:** `linkEvidenceToBatch`
- **Envelope & Payload:**
  ```json
  {
    "actionId": "018f0000-0010-7000-8000-000000000010",
    "clientId": "018f0000-0000-7000-8000-000000000001",
    "actorId": "lab_tech_lead",
    "timestamp": "2026-03-24T10:29:30.000Z",
    "payload": {
      "batchId": "018f0000-0002-7000-8000-000000000001",
      "evidenceId": "018f0000-0007-7000-8000-000000000001",
      "evidenceRevision": 1,
      "purpose": "coa_test_report"
    }
  }
  ```
- **Database Mutation:**
  ```sql
  BEGIN;
  INSERT INTO batch_evidence_links (client_id, batch_id, evidence_id, evidence_revision, purpose, asserted_by)
  VALUES ('018f0000-0000-7000-8000-000000000001', '018f0000-0002-7000-8000-000000000001', '018f0000-0007-7000-8000-000000000001', 1, 'coa_test_report', 'lab_tech_lead');

  INSERT INTO product_evidence_command_receipts (client_id, action_id, command_name, payload_sha256, actor_id, response_body, committed_at)
  VALUES ('018f0000-0000-7000-8000-000000000001', '018f0000-0010-7000-8000-000000000010', 'linkEvidenceToBatch', 'd5e6f7a2b3c4d5e6f7a2b3c4d5e6f7a2b3c4d5e6f7a2b3c4d5e6f7a2b3c4d5e6', 'lab_tech_lead', '{"batchId":"018f0000-0002-7000-8000-000000000001","evidenceId":"018f0000-0007-7000-8000-000000000001","revision":1,"purpose":"coa_test_report"}'::jsonb, NOW());
  COMMIT;
  ```
- **Result:** `batch_evidence_links` record inserted for CoA report.

#### Step 9: Create Structured CoA Report and Typed Decimal Measurements
- **Command:** `createCoaReport`
- **Envelope & Payload:**
  ```json
  {
    "actionId": "018f0000-0010-7000-8000-000000000011",
    "clientId": "018f0000-0000-7000-8000-000000000001",
    "actorId": "lab_tech_lead",
    "timestamp": "2026-03-24T10:30:00.000Z",
    "payload": {
      "batchId": "018f0000-0002-7000-8000-000000000001",
      "evidenceId": "018f0000-0007-7000-8000-000000000001",
      "evidenceRevision": 1,
      "reportIdentifierAsClaimed": "COA-2026-03-998",
      "reportDate": "2026-03-24",
      "labNameAsClaimed": "Steep Hill Analytical Labs",
      "sampleIdentifierAsClaimed": "SMPL-2026-03-998",
      "scopeKind": "sample_only",
      "scopeDescription": "Composite 5g cured flower sample from lot 42",
      "sampleDate": "2026-03-23",
      "samplingMethodDescription": "Representative tri-strata composite core sample",
      "verifiedLabIdentityEventId": null,
      "measurements": [
        {
          "analyte": "thc_total",
          "result": { "kind": "quantified", "value": "24.50" },
          "unit": "percent_w_w",
          "basis": "dry_weight",
          "context": "finished_flower",
          "methodAsReported": "HPLC-DAD per AOAC-2018.11"
        },
        {
          "analyte": "cbd_total",
          "result": { "kind": "below_limit", "limit": "0.10", "qualifier": "lt" },
          "unit": "percent_w_w",
          "basis": "dry_weight",
          "context": "finished_flower",
          "methodAsReported": "HPLC-DAD per AOAC-2018.11"
        },
        {
          "analyte": "terpenes_total",
          "result": { "kind": "quantified", "value": "2.85" },
          "unit": "percent_w_w",
          "basis": "dry_weight",
          "context": "finished_flower",
          "methodAsReported": "GC-MS per USP-436"
        }
      ]
    }
  }
  ```
- **Database Mutation:**
  ```sql
  BEGIN;
  INSERT INTO coa_reports (report_id, client_id, current_revision, version)
  VALUES ('018f0000-0008-7000-8000-000000000001', '018f0000-0000-7000-8000-000000000001', 1, 1);

  INSERT INTO coa_report_revisions (client_id, report_id, revision, batch_id, evidence_id, evidence_revision, report_identifier_as_claimed, report_date, lab_name_as_claimed, sample_identifier_as_claimed, scope_kind, scope_description, sample_date, sampling_method_description, verified_lab_identity_event_id, asserted_by, supersedes_revision)
  VALUES ('018f0000-0000-7000-8000-000000000001', '018f0000-0008-7000-8000-000000000001', 1, '018f0000-0002-7000-8000-000000000001', '018f0000-0007-7000-8000-000000000001', 1, 'COA-2026-03-998', '2026-03-24', 'Steep Hill Analytical Labs', 'SMPL-2026-03-998', 'sample_only', 'Composite 5g cured flower sample from lot 42', '2026-03-23', 'Representative tri-strata composite core sample', NULL, 'lab_tech_lead', NULL);

  INSERT INTO coa_measurements (measurement_id, client_id, report_id, report_revision, batch_id, evidence_id, evidence_revision, analyte, result_kind, result_value, result_limit, result_qualifier, unit, basis, context, method_as_reported)
  VALUES
    ('018f0000-0020-7000-8000-000000000001', '018f0000-0000-7000-8000-000000000001', '018f0000-0008-7000-8000-000000000001', 1, '018f0000-0002-7000-8000-000000000001', '018f0000-0007-7000-8000-000000000001', 1, 'thc_total', 'quantified', '24.50', NULL, NULL, 'percent_w_w', 'dry_weight', 'finished_flower', 'HPLC-DAD per AOAC-2018.11'),
    ('018f0000-0020-7000-8000-000000000002', '018f0000-0000-7000-8000-000000000001', '018f0000-0008-7000-8000-000000000001', 1, '018f0000-0002-7000-8000-000000000001', '018f0000-0007-7000-8000-000000000001', 1, 'cbd_total', 'below_limit', NULL, '0.10', 'lt', 'percent_w_w', 'dry_weight', 'finished_flower', 'HPLC-DAD per AOAC-2018.11'),
    ('018f0000-0020-7000-8000-000000000003', '018f0000-0000-7000-8000-000000000001', '018f0000-0008-7000-8000-000000000001', 1, '018f0000-0002-7000-8000-000000000001', '018f0000-0007-7000-8000-000000000001', 1, 'terpenes_total', 'quantified', '2.85', NULL, NULL, 'percent_w_w', 'dry_weight', 'finished_flower', 'GC-MS per USP-436');

  INSERT INTO product_evidence_command_receipts (client_id, action_id, command_name, payload_sha256, actor_id, response_body, committed_at)
  VALUES ('018f0000-0000-7000-8000-000000000001', '018f0000-0010-7000-8000-000000000011', 'createCoaReport', 'e6f7a2b3c4d5e6f7a2b3c4d5e6f7a2b3c4d5e6f7a2b3c4d5e6f7a2b3c4d5e6f7', 'lab_tech_lead', '{"reportId":"018f0000-0008-7000-8000-000000000001","revision":1,"version":1}'::jsonb, NOW());

  COMMIT;
  ```
- **Result:** `coa_reports` created with `version = 1`, `coa_report_revisions` rev 1 recorded with 3 typed decimal measurements.

#### Step 10: Create Product Claim
- **Command:** `createClaim`
- **Envelope & Payload:**
  ```json
  {
    "actionId": "018f0000-0010-7000-8000-000000000012",
    "clientId": "018f0000-0000-7000-8000-000000000001",
    "actorId": "copywriter_sally",
    "timestamp": "2026-03-24T10:35:00.000Z",
    "payload": {
      "batchId": "018f0000-0002-7000-8000-000000000001",
      "claimType": "potency_cannabinoid",
      "wording": "Total THC: 24.50% (Tested sample)",
      "proofCategory": "coa_measurement_backed",
      "hasNumericalSupport": true,
      "numericalValue": "24.50",
      "numericalUnit": "percent_w_w",
      "policyVersion": "v1.0"
    }
  }
  ```
- **Database Mutation:**
  ```sql
  BEGIN;
  INSERT INTO product_claims (claim_id, client_id, batch_id, current_revision, state, version)
  VALUES ('018f0000-0009-7000-8000-000000000001', '018f0000-0000-7000-8000-000000000001', '018f0000-0002-7000-8000-000000000001', 1, 'draft', 1);

  INSERT INTO product_claim_revisions (client_id, claim_id, revision, batch_id, claim_type, wording, proof_category, numerical_value, numerical_unit, created_by, policy_version, supersedes_revision)
  VALUES ('018f0000-0000-7000-8000-000000000001', '018f0000-0009-7000-8000-000000000001', 1, '018f0000-0002-7000-8000-000000000001', 'potency_cannabinoid', 'Total THC: 24.50% (Tested sample)', 'coa_measurement_backed', '24.50', 'percent_w_w', 'copywriter_sally', 'v1.0', NULL);

  INSERT INTO product_evidence_command_receipts (client_id, action_id, command_name, payload_sha256, actor_id, response_body, committed_at)
  VALUES ('018f0000-0000-7000-8000-000000000001', '018f0000-0010-7000-8000-000000000012', 'createClaim', 'f7a2b3c4d5e6f7a2b3c4d5e6f7a2b3c4d5e6f7a2b3c4d5e6f7a2b3c4d5e6f7a2', 'copywriter_sally', '{"claimId":"018f0000-0009-7000-8000-000000000001","revision":1,"version":1,"state":"draft"}'::jsonb, NOW());

  COMMIT;
  ```
- **Result:** `ProductClaim` created with `state = 'draft'`, `version = 1`.

#### Step 11: Link Claim to Measurement Source
- **Command:** `linkClaimSources`
- **Envelope & Payload:**
  ```json
  {
    "actionId": "018f0000-0010-7000-8000-000000000013",
    "clientId": "018f0000-0000-7000-8000-000000000001",
    "actorId": "copywriter_sally",
    "timestamp": "2026-03-24T10:40:00.000Z",
    "payload": {
      "claimId": "018f0000-0009-7000-8000-000000000001",
      "claimRevision": 1,
      "expectedVersion": 1,
      "sources": [
        {
          "evidenceId": "018f0000-0007-7000-8000-000000000001",
          "evidenceRevision": 1,
          "supportRole": "primary_measurement",
          "reportId": "018f0000-0008-7000-8000-000000000001",
          "reportRevision": 1,
          "measurementId": "018f0000-0020-7000-8000-000000000001"
        }
      ]
    }
  }
  ```
- **Database Mutation:**
  ```sql
  BEGIN;
  SELECT claim_id FROM product_claims WHERE client_id = '018f0000-0000-7000-8000-000000000001' AND claim_id = '018f0000-0009-7000-8000-000000000001' FOR UPDATE;

  INSERT INTO claim_source_links (link_id, client_id, claim_id, claim_revision, batch_id, evidence_id, evidence_revision, support_role, report_id, report_revision, measurement_id)
  VALUES ('018f0000-0030-7000-8000-000000000001', '018f0000-0000-7000-8000-000000000001', '018f0000-0009-7000-8000-000000000001', 1, '018f0000-0002-7000-8000-000000000001', '018f0000-0007-7000-8000-000000000001', 1, 'primary_measurement', '018f0000-0008-7000-8000-000000000001', 1, '018f0000-0020-7000-8000-000000000001');

  UPDATE product_claims
  SET state = 'evidence_linked',
      version = version + 1,
      updated_at = NOW()
  WHERE client_id = '018f0000-0000-7000-8000-000000000001'
    AND claim_id = '018f0000-0009-7000-8000-000000000001'
    AND version = 1;

  INSERT INTO product_evidence_command_receipts (client_id, action_id, command_name, payload_sha256, actor_id, response_body, committed_at)
  VALUES ('018f0000-0000-7000-8000-000000000001', '018f0000-0010-7000-8000-000000000013', 'linkClaimSources', 'a3b4c5d6e7f8a3b4c5d6e7f8a3b4c5d6e7f8a3b4c5d6e7f8a3b4c5d6e7f8a3b4', 'copywriter_sally', '{"claimId":"018f0000-0009-7000-8000-000000000001","revision":1,"version":2,"state":"evidence_linked"}'::jsonb, NOW());

  COMMIT;
  ```
- **Result:** `ProductClaim` state advances to `evidence_linked`, `version = 2`.

#### Step 12: Compliance Reviewer Approval
- **Command:** `reviewClaim`
- **Envelope & Payload:**
  ```json
  {
    "actionId": "018f0000-0010-7000-8000-000000000014",
    "clientId": "018f0000-0000-7000-8000-000000000001",
    "actorId": "compliance_officer_jane",
    "timestamp": "2026-03-24T11:00:00.000Z",
    "payload": {
      "claimId": "018f0000-0009-7000-8000-000000000001",
      "claimRevision": 1,
      "expectedVersion": 2,
      "decision": "approve",
      "reason": "Verified analytical match against active CoA report COA-2026-03-998"
    }
  }
  ```
- **Database Mutation:**
  ```sql
  BEGIN;
  -- Lock claim and dependent parent records in hierarchical order
  SELECT batch_id FROM product_batches WHERE client_id = '018f0000-0000-7000-8000-000000000001' AND batch_id = '018f0000-0002-7000-8000-000000000001' FOR UPDATE;
  SELECT evidence_id FROM evidence_assets WHERE client_id = '018f0000-0000-7000-8000-000000000001' AND evidence_id = '018f0000-0007-7000-8000-000000000001' FOR UPDATE;
  SELECT report_id FROM coa_reports WHERE client_id = '018f0000-0000-7000-8000-000000000001' AND report_id = '018f0000-0008-7000-8000-000000000001' FOR UPDATE;
  SELECT claim_id FROM product_claims WHERE client_id = '018f0000-0000-7000-8000-000000000001' AND claim_id = '018f0000-0009-7000-8000-000000000001' FOR UPDATE;

  -- Pre-commit validation confirms CoA report rev 1 and evidence rev 1 remain current and active

  INSERT INTO claim_decision_events (event_id, client_id, claim_id, claim_revision, decision, actor_id, occurred_at, reason)
  VALUES ('018f0000-0040-7000-8000-000000000001', '018f0000-0000-7000-8000-000000000001', '018f0000-0009-7000-8000-000000000001', 1, 'approve', 'compliance_officer_jane', '2026-03-24T11:00:00.000Z', 'Verified analytical match against active CoA report COA-2026-03-998');

  UPDATE product_claims
  SET state = 'reviewer_approved',
      version = version + 1,
      updated_at = NOW()
  WHERE client_id = '018f0000-0000-7000-8000-000000000001'
    AND claim_id = '018f0000-0009-7000-8000-000000000001'
    AND version = 2;

  INSERT INTO product_evidence_command_receipts (client_id, action_id, command_name, payload_sha256, actor_id, response_body, committed_at)
  VALUES ('018f0000-0000-7000-8000-000000000001', '018f0000-0010-7000-8000-000000000014', 'reviewClaim', 'b4c5d6e7f8a3b4c5d6e7f8a3b4c5d6e7f8a3b4c5d6e7f8a3b4c5d6e7f8a3b4c5', 'compliance_officer_jane', '{"claimId":"018f0000-0009-7000-8000-000000000001","revision":1,"version":3,"state":"reviewer_approved"}'::jsonb, NOW());

  COMMIT;
  ```
- **Result:** `ProductClaim` state advances to `reviewer_approved`, `version = 3`.

#### Step 13: Ingest Superseding Laboratory Re-Test PDF & Supersede Evidence Asset
- **Lab Notification:** Laboratory notifies producer that instrument recalibration requires re-issuing CoA report with updated THC total quantification (22.10%).
- **Step 13A Command:** `ingestOriginalSource`
  - **Envelope & Payload:**
    ```json
    {
      "actionId": "018f0000-0010-7000-8000-000000000015",
      "clientId": "018f0000-0000-7000-8000-000000000001",
      "actorId": "lab_tech_lead",
      "timestamp": "2026-03-25T08:50:00.000Z",
      "payload": {
        "originalSha256": "e7d6c5b4a39281706f5e4d3c2b1a0f9e8d7c6b5a4f3e2d1c0b9a8f7e6d5c4b3a",
        "detectedMimeType": "application/pdf",
        "byteLength": 248120,
        "accessClass": "restricted_original",
        "retentionClass": "source_evidence_archive",
        "retentionPolicyVersion": "v1-legal-hold"
      }
    }
    ```
  - **Database Mutation:**
    ```sql
    BEGIN;
    INSERT INTO source_objects (source_object_id, client_id, storage_bucket, storage_object_key, original_sha256, detected_mime_type, byte_length, uploader_id, access_class, retention_class, retention_policy_version, availability)
    VALUES ('018f0000-0005-7000-8000-000000000002', '018f0000-0000-7000-8000-000000000001', 'cco-evidence-archive', 'clients/018f0000-0000-7000-8000-000000000001/evidence/originals/e7d6c5b4a39281706f5e4d3c2b1a0f9e8d7c6b5a4f3e2d1c0b9a8f7e6d5c4b3a', 'e7d6c5b4a39281706f5e4d3c2b1a0f9e8d7c6b5a4f3e2d1c0b9a8f7e6d5c4b3a', 'application/pdf', 248120, 'lab_tech_lead', 'restricted_original', 'source_evidence_archive', 'v1-legal-hold', 'available');

    INSERT INTO product_evidence_command_receipts (client_id, action_id, command_name, payload_sha256, actor_id, response_body, committed_at)
    VALUES ('018f0000-0000-7000-8000-000000000001', '018f0000-0010-7000-8000-000000000015', 'ingestOriginalSource', 'c5d6e7f8a3b4c5d6e7f8a3b4c5d6e7f8a3b4c5d6e7f8a3b4c5d6e7f8a3b4c5d6', 'lab_tech_lead', '{"sourceObjectId":"018f0000-0005-7000-8000-000000000002","originalSha256":"e7d6c5b4a39281706f5e4d3c2b1a0f9e8d7c6b5a4f3e2d1c0b9a8f7e6d5c4b3a"}'::jsonb, NOW());
    COMMIT;
    ```
- **Step 13B Command:** `supersedeEvidence`
  - **Envelope & Payload:**
    ```json
    {
      "actionId": "018f0000-0010-7000-8000-000000000016",
      "clientId": "018f0000-0000-7000-8000-000000000001",
      "actorId": "lab_tech_lead",
      "timestamp": "2026-03-25T08:55:00.000Z",
      "payload": {
        "evidenceId": "018f0000-0007-7000-8000-000000000001",
        "expectedVersion": 1,
        "sourceObjectId": "018f0000-0005-7000-8000-000000000002",
        "sourceClass": "coa",
        "acquisitionMethod": "lab_transfer",
        "assertionText": "Revised laboratory certificate of analysis following instrument recalibration",
        "reportedCaptureDate": "2026-03-25",
        "captureContext": "Laboratory recalibration re-issue",
        "rightsStatus": "granted",
        "consentStatus": "granted",
        "rightsAttribution": "Steep Hill Analytical Labs / Client Service Agreement #410",
        "rightsDocumentLocator": "legal/agreements/lab-steep-hill-410.pdf"
      }
    }
    ```
  - **Database Mutation:**
    ```sql
    BEGIN;
    SELECT evidence_id FROM evidence_assets WHERE client_id = '018f0000-0000-7000-8000-000000000001' AND evidence_id = '018f0000-0007-7000-8000-000000000001' FOR UPDATE;

    INSERT INTO evidence_revisions (client_id, evidence_id, revision, source_object_id, source_class, acquisition_method, submitted_by, assertion_text, reported_capture_date, capture_context, rights_status, consent_status, rights_attribution, rights_document_locator, supersedes_revision)
    VALUES ('018f0000-0000-7000-8000-000000000001', '018f0000-0007-7000-8000-000000000001', 2, '018f0000-0005-7000-8000-000000000002', 'coa', 'lab_transfer', 'lab_tech_lead', 'Revised laboratory certificate of analysis following instrument recalibration', '2026-03-25', 'Laboratory recalibration re-issue', 'granted', 'granted', 'Steep Hill Analytical Labs / Client Service Agreement #410', 'legal/agreements/lab-steep-hill-410.pdf', 1);

    UPDATE evidence_assets
    SET current_revision = 2,
        version = version + 1
    WHERE client_id = '018f0000-0000-7000-8000-000000000001'
      AND evidence_id = '018f0000-0007-7000-8000-000000000001'
      AND version = 1;

    INSERT INTO product_evidence_command_receipts (client_id, action_id, command_name, payload_sha256, actor_id, response_body, committed_at)
    VALUES ('018f0000-0000-7000-8000-000000000001', '018f0000-0010-7000-8000-000000000016', 'supersedeEvidence', 'd6e7f8a3b4c5d6e7f8a3b4c5d6e7f8a3b4c5d6e7f8a3b4c5d6e7f8a3b4c5d6e7', 'lab_tech_lead', '{"evidenceId":"018f0000-0007-7000-8000-000000000001","revision":2,"version":2}'::jsonb, NOW());
    COMMIT;
    ```
- **Step 13C Command:** `linkEvidenceToBatch`
  - **Envelope & Payload:**
    ```json
    {
      "actionId": "018f0000-0010-7000-8000-000000000017",
      "clientId": "018f0000-0000-7000-8000-000000000001",
      "actorId": "lab_tech_lead",
      "timestamp": "2026-03-25T08:58:00.000Z",
      "payload": {
        "batchId": "018f0000-0002-7000-8000-000000000001",
        "evidenceId": "018f0000-0007-7000-8000-000000000001",
        "evidenceRevision": 2,
        "purpose": "coa_test_report"
      }
    }
    ```
  - **Database Mutation:**
    ```sql
    BEGIN;
    INSERT INTO batch_evidence_links (client_id, batch_id, evidence_id, evidence_revision, purpose, asserted_by)
    VALUES ('018f0000-0000-7000-8000-000000000001', '018f0000-0002-7000-8000-000000000001', '018f0000-0007-7000-8000-000000000001', 2, 'coa_test_report', 'lab_tech_lead');

    INSERT INTO product_evidence_command_receipts (client_id, action_id, command_name, payload_sha256, actor_id, response_body, committed_at)
    VALUES ('018f0000-0000-7000-8000-000000000001', '018f0000-0010-7000-8000-000000000017', 'linkEvidenceToBatch', 'e7f8a3b4c5d6e7f8a3b4c5d6e7f8a3b4c5d6e7f8a3b4c5d6e7f8a3b4c5d6e7f8', 'lab_tech_lead', '{"batchId":"018f0000-0002-7000-8000-000000000001","evidenceId":"018f0000-0007-7000-8000-000000000001","revision":2,"purpose":"coa_test_report"}'::jsonb, NOW());
    COMMIT;
    ```
- **Result:** `evidence_assets` advances to `current_revision = 2, version = 2`; `batch_evidence_links` rev 2 linked to batch.

#### Step 14: Laboratory Re-Test Supersession & Atomic Invalidation
- **Command:** `supersedeCoaReport`
- **Envelope & Payload:**
  ```json
  {
    "actionId": "018f0000-0010-7000-8000-000000000018",
    "clientId": "018f0000-0000-7000-8000-000000000001",
    "actorId": "lab_tech_lead",
    "timestamp": "2026-03-25T09:00:00.000Z",
    "payload": {
      "reportId": "018f0000-0008-7000-8000-000000000001",
      "expectedVersion": 1,
      "batchId": "018f0000-0002-7000-8000-000000000001",
      "evidenceId": "018f0000-0007-7000-8000-000000000001",
      "evidenceRevision": 2,
      "reportIdentifierAsClaimed": "COA-2026-03-998-R1",
      "reportDate": "2026-03-25",
      "labNameAsClaimed": "Steep Hill Analytical Labs",
      "sampleIdentifierAsClaimed": "SMPL-2026-03-998",
      "scopeKind": "sample_only",
      "scopeDescription": "Composite 5g cured flower sample from lot 42 (instrument recalibration)",
      "sampleDate": "2026-03-23",
      "samplingMethodDescription": "Representative tri-strata composite core sample",
      "verifiedLabIdentityEventId": null,
      "measurements": [
        {
          "analyte": "thc_total",
          "result": { "kind": "quantified", "value": "22.10" },
          "unit": "percent_w_w",
          "basis": "dry_weight",
          "context": "finished_flower",
          "methodAsReported": "HPLC-DAD per AOAC-2018.11"
        }
      ]
    }
  }
  ```
- **Atomic Database Transaction Execution:**
  ```sql
  BEGIN;
  -- 1. Pessimistic row locks in deterministic hierarchy
  SELECT batch_id FROM product_batches WHERE client_id = '018f0000-0000-7000-8000-000000000001' AND batch_id = '018f0000-0002-7000-8000-000000000001' FOR UPDATE;
  SELECT evidence_id FROM evidence_assets WHERE client_id = '018f0000-0000-7000-8000-000000000001' AND evidence_id = '018f0000-0007-7000-8000-000000000001' FOR UPDATE;
  SELECT report_id FROM coa_reports WHERE client_id = '018f0000-0000-7000-8000-000000000001' AND report_id = '018f0000-0008-7000-8000-000000000001' FOR UPDATE;
  SELECT claim_id FROM product_claims WHERE client_id = '018f0000-0000-7000-8000-000000000001' AND claim_id = '018f0000-0009-7000-8000-000000000001' FOR UPDATE;

  -- 2. Append new CoA report revision 2 referencing evidence revision 2
  INSERT INTO coa_report_revisions (client_id, report_id, revision, batch_id, evidence_id, evidence_revision, report_identifier_as_claimed, report_date, lab_name_as_claimed, sample_identifier_as_claimed, scope_kind, scope_description, sample_date, sampling_method_description, verified_lab_identity_event_id, asserted_by, supersedes_revision)
  VALUES ('018f0000-0000-7000-8000-000000000001', '018f0000-0008-7000-8000-000000000001', 2, '018f0000-0002-7000-8000-000000000001', '018f0000-0007-7000-8000-000000000001', 2, 'COA-2026-03-998-R1', '2026-03-25', 'Steep Hill Analytical Labs', 'SMPL-2026-03-998', 'sample_only', 'Composite 5g cured flower sample from lot 42 (instrument recalibration)', '2026-03-23', 'Representative tri-strata composite core sample', NULL, 'lab_tech_lead', 1);

  -- 3. Append new measurement for revision 2
  INSERT INTO coa_measurements (measurement_id, client_id, report_id, report_revision, batch_id, evidence_id, evidence_revision, analyte, result_kind, result_value, result_limit, result_qualifier, unit, basis, context, method_as_reported)
  VALUES ('018f0000-0020-7000-8000-000000000004', '018f0000-0000-7000-8000-000000000001', '018f0000-0008-7000-8000-000000000001', 2, '018f0000-0002-7000-8000-000000000001', '018f0000-0007-7000-8000-000000000001', 2, 'thc_total', 'quantified', '22.10', NULL, NULL, 'percent_w_w', 'dry_weight', 'finished_flower', 'HPLC-DAD per AOAC-2018.11');

  -- 4. Advance coa_reports head under expectedVersion check
  UPDATE coa_reports
  SET current_revision = 2,
      version = version + 1
  WHERE client_id = '018f0000-0000-7000-8000-000000000001'
    AND report_id = '018f0000-0008-7000-8000-000000000001'
    AND version = 1;

  -- 5. Append invalidation decision event for dependent claim 1
  INSERT INTO claim_decision_events (event_id, client_id, claim_id, claim_revision, decision, actor_id, occurred_at, reason, invalidation_cause, source_event_id)
  VALUES ('018f0000-0040-7000-8000-000000000002', '018f0000-0000-7000-8000-000000000001', '018f0000-0009-7000-8000-000000000001', 1, 'invalidate', 'system_concurrency_guard', '2026-03-25T09:00:00.000Z', 'Underlying CoA report revision 1 was superseded by revision 2', 'source_superseded', '018f0000-0008-7000-8000-000000000001:2');

  -- 6. Update claim head to invalidated and increment version
  UPDATE product_claims
  SET state = 'invalidated',
      version = version + 1,
      invalidation_cause = 'source_superseded',
      invalidation_source_event_id = '018f0000-0008-7000-8000-000000000001:2',
      updated_at = NOW()
  WHERE client_id = '018f0000-0000-7000-8000-000000000001'
    AND claim_id = '018f0000-0009-7000-8000-000000000001'
    AND version = 3;

  -- 7. Insert idempotent command receipt
  INSERT INTO product_evidence_command_receipts (client_id, action_id, command_name, payload_sha256, actor_id, response_body, committed_at)
  VALUES ('018f0000-0000-7000-8000-000000000001', '018f0000-0010-7000-8000-000000000018', 'supersedeCoaReport', '9f8e7d6c5b4a39281706f5e4d3c2b1a0f9e8d7c6b5a4f3e2d1c0b9a8f7e6d5c4', 'lab_tech_lead', '{"reportId":"018f0000-0008-7000-8000-000000000001","revision":2,"version":2,"invalidatedClaimIds":["018f0000-0009-7000-8000-000000000001"]}'::jsonb, NOW());

  COMMIT;
  ```
- **Outcome:** The claim is immediately non-dispatchable for commercial video packaging (`state = 'invalidated'`). Historical approval and supersession events remain preserved in the audit log.

---

### Step 15: Final Complete Historical State Snapshot

Following completion of Step 14, the relational database holds the following immutable historical trace:

| Table | Primary Key / Identifying Columns | Key Attributes & State | Immutability / Concurrency Invariant |
| :--- | :--- | :--- | :--- |
| `product_skus` | `sku_id = ...0001` | `canonical_sku = 'SKU-AURORA-INDICA-01'`, `version = 1`, `archived_at = NULL` | Active head row |
| `product_batches` | `batch_id = ...0001` | `lot_identifier = 'LOT-2026-IND-042'`, `version = 2`, `current_facts_revision = 2` | Active head row |
| `product_batch_facts` | `batch_id = ...0001, revision = 1` | `origin_kind = 'unknown'`, `supersedes_revision = NULL` | **Preserved historical fact row** |
| `product_batch_facts` | `batch_id = ...0001, revision = 2` | `origin_kind = 'own_production'`, `supersedes_revision = 1` | Current active fact row |
| `source_objects` | `source_object_id = ...0003...0001` (RAW photo) | `original_sha256 = HASH_PHOTO_RAW`, `availability = 'available'` | Immutable binary object record |
| `source_objects` | `source_object_id = ...0005...0001` (CoA v1) | `original_sha256 = HASH_COA_PDF_V1`, `availability = 'available'` | Immutable binary object record |
| `source_objects` | `source_object_id = ...0005...0002` (CoA v2) | `original_sha256 = HASH_COA_PDF_V2`, `availability = 'available'` | Immutable binary object record |
| `evidence_assets` | `evidence_id = ...0006...0001` (Macro) | `current_revision = 1`, `version = 1` | Active head row |
| `evidence_assets` | `evidence_id = ...0007...0001` (CoA) | `current_revision = 2`, `version = 2` | Active head row |
| `evidence_revisions`| `evidence_id = ...0006, revision = 1` | `source_class = 'raw'`, `rights_status = 'granted'` | Immutable assertion row |
| `evidence_revisions`| `evidence_id = ...0007, revision = 1` | `source_class = 'coa'`, `source_object_id = ...0005...0001`, `supersedes_revision = NULL` | **Preserved historical assertion** |
| `evidence_revisions`| `evidence_id = ...0007, revision = 2` | `source_class = 'coa'`, `source_object_id = ...0005...0002`, `supersedes_revision = 1` | Current active assertion |
| `batch_evidence_links` | `batch_id = ...0001, evidence_id = ...0006, revision = 1` | `purpose = 'macro_hero_photo'` | Immutable relation link |
| `batch_evidence_links` | `batch_id = ...0001, evidence_id = ...0007, revision = 1` | `purpose = 'coa_test_report'` | **Preserved historical link** |
| `batch_evidence_links` | `batch_id = ...0001, evidence_id = ...0007, revision = 2` | `purpose = 'coa_test_report'` | Current active link |
| `evidence_derivatives` | `derivative_id = ...0004` | `reference_asset_id = ...0004`, `derivative_sha256 = HASH_REF_WEBP` | Immutable derivative bridge |
| `coa_reports` | `report_id = ...0008` | `current_revision = 2`, `version = 2` | Version-bumped head row |
| `coa_report_revisions` | `report_id = ...0008, revision = 1` | `report_date = '2026-03-24'`, `evidence_revision = 1`, `supersedes_revision = NULL` | **Preserved historical revision** |
| `coa_report_revisions` | `report_id = ...0008, revision = 2` | `report_date = '2026-03-25'`, `evidence_revision = 2`, `supersedes_revision = 1` | Current active revision |
| `coa_measurements` | `report_id = ...0008, revision = 1, meas_id = ...0001` | `analyte = 'thc_total'`, `result_value = '24.50'` | **Preserved historical measurement** |
| `coa_measurements` | `report_id = ...0008, revision = 1, meas_id = ...0002` | `analyte = 'cbd_total'`, `result_limit = '0.10'` | **Preserved historical measurement** |
| `coa_measurements` | `report_id = ...0008, revision = 1, meas_id = ...0003` | `analyte = 'terpenes_total'`, `result_value = '2.85'` | **Preserved historical measurement** |
| `coa_measurements` | `report_id = ...0008, revision = 2, meas_id = ...0004` | `analyte = 'thc_total'`, `result_value = '22.10'` | Current active measurement |
| `product_claims` | `claim_id = ...0009` | `state = 'invalidated'`, `version = 4`, `invalidation_cause = 'source_superseded'` | Terminal head state for Rev 1 |
| `product_claim_revisions`| `claim_id = ...0009, revision = 1` | `wording = 'Total THC: 24.50% (Tested sample)'`, `numerical_value = '24.50'` | **Preserved historical revision** |
| `claim_source_links` | `claim_id = ...0009, claim_revision = 1, link_id = ...0001` | `report_id = ...0008, report_revision = 1, measurement_id = ...0001` | **Preserved historical link** |
| `claim_decision_events` | `event_id = ...0001` | `decision = 'approve'`, `actor_id = 'compliance_officer_jane'` | **Preserved approval audit record** |
| `claim_decision_events` | `event_id = ...0002` | `decision = 'invalidate'`, `actor_id = 'system_concurrency_guard'` | Preserved invalidation audit record |
| `product_evidence_command_receipts` | `action_id = ...0001` through `...0018` | All command receipts preserved in ledger | Preserved idempotent receipts |

---

## 3. Counterexample Acceptance Matrix (Given / When / Then)

The following matrix documents the complete set of negative invariants, integrity rejections, and edge cases:

| ID | Invariant Category | Given | When | Then (Expected Outcome) |
| :--- | :--- | :--- | :--- | :--- |
| **CE-01** | **Tenant Isolation** | Client A owns `SRC_PHOTO_RAW_ID`. | Client B attempts to link `SRC_PHOTO_RAW_ID` in `createEvidenceAsset`. | Fails closed with `NOT_FOUND`. Database composite FK `fk_evidence_revisions_source` (`client_id, source_object_id`) rejects. Zero metadata or existence disclosure regarding Client A. |
| **CE-02** | **Lot Boundary Integrity & FK Rejection** | Client A owns Lot A (`BATCH_LOT_A_ID`) and Lot B (`BATCH_LOT_B_ID`) under same SKU. Photo is linked to Lot B (`batch_evidence_links`). | Submitter attempts to link Lot B's photo as supporting evidence for a claim on Lot A (`linkClaimSources`). | Fails closed with `CROSS_BATCH_SOURCE`. Database FK `fk_claim_sources_batch_evidence` (`client_id, batch_id, evidence_id, evidence_revision`) rejects because `batch_id` does not match the claim's batch. |
| **CE-03** | **Duplicate Ingest Deduplication** | Client A previously ingested `SRC_PHOTO_RAW_ID` with hash `HASH_PHOTO_RAW`. | Client A re-uploads the exact same file bytes with the same hash. | Storage adapter verifies exact byte SHA-256 match and detected MIME match, then reuses existing `source_objects` row without duplicate S3 write. Quota reservation released. Distinct `EvidenceRevision` created only if asserted explicitly. |
| **CE-03B**| **Archived / Quarantined Duplicate Upload** | Client A previously ingested `SRC_PHOTO_RAW_ID`, which was later archived (`availability = 'archived'`), quarantined, or deleted under retention. | Client A re-uploads the exact same file bytes with the same hash. | Re-uploading bytes cannot reactivate an archived, quarantined, or deleted source object. Fails closed with `ACCESS_DENIED` (`cause: SOURCE_UNAVAILABLE`). Unlike ephemeral preview reference assets, source evidence archives are immutable and require operator retention governance to alter availability. |
| **CE-04** | **Tamper / Byte Integrity Failure** | Source object record exists with hash `HASH_PHOTO_RAW`. Underlying file in S3 was altered or corrupted. | Ingestion or verification adapter reads object from storage prior to derivative creation or claim approval. | Exact computed byte hash $\ne$ recorded `original_sha256`. Fails closed with `SOURCE_INTEGRITY_MISMATCH`. Object marked `availability = 'quarantined'`; all dependent claims transition to `invalidated`. |
| **CE-04B**| **Unavailable Source Object** | Active claim revision is linked to a source object. | Source object availability transitions to `archived`, `quarantined`, or `deleted_under_retention`. | Cascade invalidation transaction triggers. Claim state transitions `reviewer_approved -> invalidated` (`cause: source_quarantined` or `source_archived`). |
| **CE-05** | **Missing / Ambiguous Measurement Units** | Submitter enters a CoA measurement row for total THC with `result_value = "24.5"` and `unit = ""`. | Submitter submits `createCoaReport`. | Rejected at application boundary with `MEASUREMENT_UNIT_REQUIRED`. Relational CHECK constraint `chk_measurement_strings_nonempty` prevents insertion. |
| **CE-06** | **Below-Limit Misrepresentation** | CoA reports pesticide screening as below quantification limit (`result_kind = "below_limit"`, `limit = "0.01"`, `qualifier = "lt"`). | Submitter attempts to create numerical claim with `numericalValue = "0.00"` claiming "Zero Pesticides". | Fails policy validation: `below_limit` cannot be converted to positive or exact zero value. Rejected with `CLAIM_SUPPORT_REQUIRED`. |
| **CE-06B**| **Not-Detected Misrepresentation Claiming "Zero"** | CoA reports pesticide screening as not detected (`result_kind = "not_detected"`). | Submitter attempts to create numerical claim with `numericalValue = "0.00"` or free-text copy "0% Pesticides" or "Zero Contaminants". | Fails policy validation: `not_detected` carries no quantified value and cannot be converted into numerical zero ("0", "0.0%") or unqualified "Zero". Rejected with `CLAIM_SUPPORT_REQUIRED`. |
| **CE-07** | **Disputed Laboratory Report** | Active claim revision is linked to a CoA report. | Lab or regulator issues a dispute notice, recorded via `recordVerificationEvent(outcome: "disputed")`. | Invalidation transaction triggers. Claim state transitions `reviewer_approved -> invalidated` (`cause: source_disputed`). Report remains in audit ledger. |
| **CE-08** | **Missing Origin Provenance** | Batch has `origin_kind = "unknown"`. | Submitter attempts to link an `origin_geography` claim ("Grown in Okanagan Valley"). | Policy validation rejects claim linkage with `ORIGIN_PROVENANCE_REQUIRED`. Unknown origin cannot support geographical origin claims. |
| **CE-09** | **Sample Scope Overextension** | CoA report has `scope_kind = "sample_only"`. | Submitter drafts claim worded "Every flower in Lot 42 contains exactly 24.5% THC". | Reviewer or policy engine rejects claim: sample-only CoA cannot substantiate whole-lot universal representations without composite sampling protocol. |
| **CE-10** | **Stale Concurrency Conflict** | Batch head is at `version = 3`. | Caller issues `updateBatch` or `appendBatchFacts` providing `expectedVersion = 2`. | Relational UPDATE predicate affects 0 rows. Transaction rolls back with zero writes. Returns HTTP 409 `STALE_REVISION_CONFLICT`. |
| **CE-10B**| **Stale Claim Approval** | Reviewer attempts to approve claim Rev 1 with `expectedVersion = 2`, but concurrent link event advanced claim head to `version = 3`. | Reviewer submits `reviewClaim(expectedVersion: 2)`. | Optimistic update predicate `WHERE version = 2` affects 0 rows. Transaction rolls back with zero writes and zero receipt entries. Returns HTTP 409 `STALE_REVISION_CONFLICT`. |
| **CE-11** | **Idempotent Command Replay vs Conflict** | Command with `actionId = X` succeeded previously. | Caller re-sends command with `actionId = X` but altered payload (different display name). | Transaction compares payload SHA-256 with stored receipt, rejects update with HTTP 409 `IDEMPOTENCY_CONFLICT`. Replaying identical payload returns original 200 receipt. |
| **CE-12** | **Reference Derivative Archival** | Active claim revision is supported by a visual derivative linked to `ReferenceAsset` R. | Operator archives `ReferenceAsset` R (`reference_assets.archived_at = NOW()`). | Claim state transitions to `invalidated` (`cause: source_archived`). Un-archiving the reference asset does **not** restore claim approval. |
| **CE-13A**| **Concurrent Approve vs. Supersede (Supersede Commits First)** | Reviewer attempts to approve claim Rev 1 while Submitter concurrently supersedes CoA Rev 1. | Supersede transaction commits first (advancing CoA head to Rev 2 and invalidating claim Rev 1). Approve transaction acquires locks and executes pre-commit dependency check. | Approve transaction detects underlying CoA report revision is no longer current and claim state is `invalidated`. Aborts immediately with HTTP 409 `SOURCE_SUPERSEDED`. Zero orphaned approvals. |
| **CE-13B**| **Concurrent Approve vs. Supersede (Approve Commits First)** | Reviewer attempts to approve claim Rev 1 while Submitter concurrently supersedes CoA Rev 1. | Approve transaction commits first (transitioning claim Rev 1 to `reviewer_approved`). Supersede transaction acquires locks, appends Rev 2, queries dependent claims, finds approved claim Rev 1. | Supersede transaction appends invalidation `ClaimDecisionEvent` and updates claim head to `invalidated`. In both commit orders, committed state is deterministic and no superseded claim remains approved. |
| **CE-14** | **Attributed Process Claim Without CoA** | Batch facts record living soil cultivation supported by cultivation log `process_record`. | Submitter creates `cultivation_process` claim ("Cultivated in Living Organic Soil") linked to log. | Permitted by policy matrix (`proofCategory = "production_record_backed"`). Human reviewer approves based on process logs without requiring a laboratory CoA. |
