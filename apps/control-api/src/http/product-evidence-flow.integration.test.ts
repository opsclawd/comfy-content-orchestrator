import { describe, it, expect, beforeAll, afterAll, beforeEach } from "vitest";
import { CreateBucketCommand, PutObjectCommand, S3Client } from "@aws-sdk/client-s3";
import { createHash } from "node:crypto";
import {
  startPostgres18Container,
  startMinioContainer,
  Pool,
  type PoolClient,
  type StartedPostgres18Container,
  type StartedMinioContainer,
  insertClientRecord,
  MIGRATIONS_DIRECTORY_URL,
  createMinimalValidPdfBytes
} from "@cco/infrastructure/testing";
import {
  runMigrations,
  PostgresUnitOfWork,
  S3ObjectStorage,
  S3ReviewMediaDelivery,
  PostgresBatchEvidenceDossierQueries,
  PostgresEvidenceLockCoordinator,
  OriginalsInspectionAdapter,
  PostgresReferenceAssetRepository
} from "@cco/infrastructure";
import {
  AllowAllReviewerAuthorizationAdapter,
  DEFAULT_DEV_EVIDENCE_STORAGE_POLICY
} from "@cco/application";
import { BUCKET_NAMES } from "@cco/shared";
import { BatchEvidenceDossierSchema } from "@cco/contracts";
import { createControlApiApp } from "./app.js";

function sha256Hex(bytes: Uint8Array): string {
  return createHash("sha256").update(bytes).digest("hex");
}

function buildMultipart(
  parts: {
    name: string;
    filename?: string;
    contentType?: string;
    data: Buffer | Uint8Array | string;
  }[],
  boundary = "----WebKitFormBoundaryTest7MA4YWxkTrZu0gW"
): { body: Buffer; contentType: string } {
  const chunks: Buffer[] = [];
  for (const part of parts) {
    let header = `--${boundary}\r\nContent-Disposition: form-data; name="${part.name}"`;
    if (part.filename) {
      header += `; filename="${part.filename}"`;
    }
    header += "\r\n";
    if (part.contentType) {
      header += `Content-Type: ${part.contentType}\r\n`;
    }
    header += "\r\n";
    chunks.push(Buffer.from(header, "utf-8"));
    const dataBuf =
      typeof part.data === "string"
        ? Buffer.from(part.data, "utf-8")
        : Buffer.isBuffer(part.data)
          ? part.data
          : Buffer.from(part.data);
    chunks.push(dataBuf);
    chunks.push(Buffer.from("\r\n", "utf-8"));
  }
  chunks.push(Buffer.from(`--${boundary}--\r\n`, "utf-8"));
  return {
    body: Buffer.concat(chunks),
    contentType: `multipart/form-data; boundary=${boundary}`
  };
}

describe("Product Evidence Flow & Dossier PostgreSQL + MinIO Integration", () => {
  let postgresContainer: StartedPostgres18Container;
  let minioContainer: StartedMinioContainer;
  let pool: Pool;
  let client: PoolClient;
  let rawS3Client: S3Client;
  let objectStorage: S3ObjectStorage;
  let reviewMediaDelivery: S3ReviewMediaDelivery;
  const migrationsDirectory = MIGRATIONS_DIRECTORY_URL;

  beforeAll(async () => {
    postgresContainer = await startPostgres18Container();
    minioContainer = await startMinioContainer();

    pool = new Pool({
      connectionString: postgresContainer.getConnectionUri(),
      max: 10
    });

    rawS3Client = new S3Client({
      endpoint: minioContainer.getEndpoint(),
      region: "us-east-1",
      credentials: {
        accessKeyId: minioContainer.getAccessKey(),
        secretAccessKey: minioContainer.getSecretKey()
      },
      forcePathStyle: true
    });

    for (const bucket of BUCKET_NAMES) {
      try {
        await rawS3Client.send(new CreateBucketCommand({ Bucket: bucket }));
      } catch (err: unknown) {
        const errorName =
          typeof err === "object" && err !== null && "name" in err
            ? String((err as { name: unknown }).name)
            : "";
        if (errorName !== "BucketAlreadyExists" && errorName !== "BucketAlreadyOwnedByYou") {
          throw err;
        }
      }
    }

    objectStorage = new S3ObjectStorage({
      endpoint: minioContainer.getEndpoint(),
      region: "us-east-1",
      credentials: {
        accessKeyId: minioContainer.getAccessKey(),
        secretAccessKey: minioContainer.getSecretKey()
      },
      forcePathStyle: true
    });

    reviewMediaDelivery = new S3ReviewMediaDelivery({
      signingEndpoint: minioContainer.getEndpoint(),
      region: "us-east-1",
      credentials: {
        accessKeyId: minioContainer.getAccessKey(),
        secretAccessKey: minioContainer.getSecretKey()
      },
      forcePathStyle: true,
      defaultExpirySeconds: 300
    });
  }, 120_000);

  afterAll(async () => {
    if (client) {
      client.release();
    }
    if (pool) {
      await pool.end();
    }
    if (postgresContainer) {
      await postgresContainer.stop();
    }
    if (minioContainer) {
      await minioContainer.stop();
    }
  });

  beforeEach(async () => {
    if (!client) {
      client = await pool.connect();
    }
    await client.query("DROP SCHEMA public CASCADE; CREATE SCHEMA public;");
    await runMigrations(client, { migrationsDirectory });
  });

  it("executes complete synthetic lifecycle: SKU -> lot -> multipart evidence -> derivative -> CoA -> claim -> review -> invalidate -> dossier", async () => {
    const { client_id: tenantA } = await insertClientRecord(client, {
      companyName: "Tenant Alpha Corp"
    });
    const { client_id: tenantB } = await insertClientRecord(client, {
      companyName: "Tenant Beta Ltd"
    });

    const uow = new PostgresUnitOfWork(pool);
    const lockCoordinator = new PostgresEvidenceLockCoordinator(pool);
    const dossierQueries = new PostgresBatchEvidenceDossierQueries(pool);
    const reviewerAuth = new AllowAllReviewerAuthorizationAdapter();
    const originalsInspection = new OriginalsInspectionAdapter();

    const refRepo = new PostgresReferenceAssetRepository(pool);
    let currentActorA = "compliance-author";
    const appA = createControlApiApp(
      {
        uow,
        objectStorage,
        reviewMediaDelivery,
        evidenceLockCoordinator: lockCoordinator,
        evidenceStoragePolicy: DEFAULT_DEV_EVIDENCE_STORAGE_POLICY,
        batchEvidenceDossierQueries: dossierQueries,
        reviewerAuthorization: reviewerAuth,
        originalsInspection,
        referenceAssetRepository: refRepo
      },
      {
        reviewerIdentityResolver: { resolve: async () => currentActorA },
        clientContextResolver: { resolve: async () => tenantA }
      }
    );

    const appB = createControlApiApp(
      {
        uow,
        objectStorage,
        reviewMediaDelivery,
        evidenceLockCoordinator: lockCoordinator,
        evidenceStoragePolicy: DEFAULT_DEV_EVIDENCE_STORAGE_POLICY,
        batchEvidenceDossierQueries: dossierQueries,
        reviewerAuthorization: reviewerAuth,
        originalsInspection,
        referenceAssetRepository: refRepo
      },
      {
        reviewerIdentityResolver: { resolve: async () => "outsider-reviewer" },
        clientContextResolver: { resolve: async () => tenantB }
      }
    );

    // 1. Create SKU
    const skuRes = await appA.inject({
      method: "POST",
      url: `/api/v1/clients/${tenantA}/product-skus`,
      payload: {
        actionId: "018e69e0-8a6a-72cb-b1b7-ec79a1f73001",
        canonicalSku: "SKU-SYNTH-100",
        displayName: "Highland Botanical Tincture 1000mg"
      }
    });
    expect(skuRes.statusCode).toBe(201);
    const sku = skuRes.json();
    const skuId = sku.skuId;
    expect(skuId).toBeDefined();

    // 2. Idempotent Retry of SKU Creation
    const retrySkuRes = await appA.inject({
      method: "POST",
      url: `/api/v1/clients/${tenantA}/product-skus`,
      payload: {
        actionId: "018e69e0-8a6a-72cb-b1b7-ec79a1f73001",
        canonicalSku: "SKU-SYNTH-100",
        displayName: "Highland Botanical Tincture 1000mg"
      }
    });
    expect(retrySkuRes.statusCode).toBe(201);
    expect(retrySkuRes.json().skuId).toBe(skuId);

    // 3. Create Lot (Batch)
    const batchRes = await appA.inject({
      method: "POST",
      url: `/api/v1/clients/${tenantA}/batches`,
      payload: {
        actionId: "018e69e0-8a6a-72cb-b1b7-ec79a1f73002",
        skuId,
        lotIdentifier: "LOT-2026-SYNTH-01",
        displayName: "Batch LOT-2026-SYNTH-01",
        initialFacts: {
          originKind: "own_production",
          producerIdentityAsClaimed: "Highland Organics LLC",
          productionStartDate: "2026-10-01",
          productionEndDate: "2026-10-05"
        }
      }
    });
    expect(batchRes.statusCode).toBe(201);
    const batchBody = batchRes.json();
    const batchId = batchBody.batch.batchId;
    expect(batchId).toBeDefined();
    expect(batchBody.initialFacts.revision).toBe(1);

    // 4. Append Facts with Optimistic Version Fence
    const factsRes = await appA.inject({
      method: "POST",
      url: `/api/v1/clients/${tenantA}/batches/${batchId}/facts`,
      payload: {
        actionId: "018e69e0-8a6a-72cb-b1b7-ec79a1f73003",
        expectedVersion: 1,
        originKind: "own_production",
        producerIdentityAsClaimed: "Highland Organics LLC — Facility 2",
        productionStartDate: "2026-10-01",
        productionEndDate: "2026-10-06"
      }
    });
    expect(factsRes.statusCode).toBe(201);
    expect(factsRes.json().revision).toBe(2);

    // Stale version conflict
    const staleFactsRes = await appA.inject({
      method: "POST",
      url: `/api/v1/clients/${tenantA}/batches/${batchId}/facts`,
      payload: {
        actionId: "018e69e0-8a6a-72cb-b1b7-ec79a1f73004",
        expectedVersion: 1, // Stale!
        originKind: "own_production"
      }
    });
    expect(staleFactsRes.statusCode).toBe(409);

    // 5. Register Original Evidence Asset via Multipart Upload
    // Small valid PNG bytes
    const pngBytes = Buffer.from(
      "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==",
      "base64"
    );
    const pngHash = sha256Hex(new Uint8Array(pngBytes));

    const form = buildMultipart([
      {
        name: "metadata",
        contentType: "application/json",
        data: JSON.stringify({
          actionId: "018e69e0-8a6a-72cb-b1b7-ec79a1f73005",
          purpose: "macro_hero_photo",
          sourceClass: "photo",
          acquisitionMethod: "direct_upload",
          assertionText: "Authentic primary macro photograph of bottle seal",
          registrationIntent: "initial_assertion",
          declaredMimeType: "image/png"
        })
      },
      {
        name: "file",
        filename: "seal_hero.png",
        contentType: "image/png",
        data: pngBytes
      }
    ]);

    const evidenceRes = await appA.inject({
      method: "POST",
      url: `/api/v1/clients/${tenantA}/batches/${batchId}/evidence`,
      headers: { "content-type": form.contentType },
      payload: form.body
    });
    expect(evidenceRes.statusCode).toBe(201);
    const evidenceData = evidenceRes.json();
    const evidenceId = evidenceData.evidenceAsset.evidenceId;
    expect(evidenceId).toBeDefined();
    expect(evidenceData.sourceObject.originalSha256).toBe(pngHash);

    // 5b. Upload Reference Asset and Link Derivative
    const uploadRefRes = await appA.inject({
      method: "POST",
      url: `/api/clients/${tenantA}/references`,
      headers: {
        "content-type": "image/png",
        "x-display-name": "Hero Character Portrait",
        "x-reference-role": "subject_identity"
      },
      payload: pngBytes
    });
    expect(uploadRefRes.statusCode).toBe(201);
    const refAssetId = uploadRefRes.json().id;
    expect(refAssetId).toBeDefined();

    const derivativeRes = await appA.inject({
      method: "POST",
      url: `/api/v1/clients/${tenantA}/batches/${batchId}/evidence/${evidenceId}/revisions/1/derivative`,
      payload: {
        actionId: "018e69e0-8a6a-72cb-b1b7-ec79a1f73055",
        referenceAssetId: refAssetId,
        derivativeSha256: pngHash,
        transformDescription: "Centered crop for visual render reference",
        transformToolVersion: "v1.0.0"
      }
    });
    expect(derivativeRes.statusCode).toBe(200);
    expect(derivativeRes.json().referenceAssetId).toBe(refAssetId);

    const getDerivativeRes = await appA.inject({
      method: "GET",
      url: `/api/v1/clients/${tenantA}/batches/${batchId}/evidence/${evidenceId}/revisions/1/derivative`
    });
    expect(getDerivativeRes.statusCode).toBe(200);
    expect(getDerivativeRes.json().referenceAssetId).toBe(refAssetId);

    // 6. Record Verification Event
    const verEventRes = await appA.inject({
      method: "POST",
      url: `/api/v1/clients/${tenantA}/batches/${batchId}/evidence/${evidenceId}/revisions/1/verification-events`,
      payload: {
        actionId: "018e69e0-8a6a-72cb-b1b7-ec79a1f73006",
        outcome: "verified",
        verificationKind: "human_internal_review",
        factScope: "capture_circumstances",
        method: "visual_inspection_against_spec",
        reason: "Pixel geometry and label layout matched physical packaging blueprint."
      }
    });
    expect(verEventRes.statusCode).toBe(200);

    // 7. Deliver Media Read URL
    const mediaRes = await appA.inject({
      method: "GET",
      url: `/api/v1/clients/${tenantA}/batches/${batchId}/evidence/${evidenceId}/revisions/1/media`
    });
    expect(mediaRes.statusCode).toBe(200);
    const media = mediaRes.json();
    expect(media.url).toBeDefined();
    expect(media.originalSha256).toBe(pngHash);

    // 8. Create CoA Report with typed measurements
    // Register CoA PDF first
    const coaPdfBytes = Buffer.from(await createMinimalValidPdfBytes());
    const coaPdfHash = sha256Hex(new Uint8Array(coaPdfBytes));

    const coaForm = buildMultipart([
      {
        name: "metadata",
        contentType: "application/json",
        data: JSON.stringify({
          actionId: "018e69e0-8a6a-72cb-b1b7-ec79a1f73007",
          purpose: "coa_test_report",
          sourceClass: "coa",
          acquisitionMethod: "direct_upload",
          assertionText: "Third-party analytical testing report",
          registrationIntent: "initial_assertion",
          declaredMimeType: "application/pdf"
        })
      },
      {
        name: "file",
        filename: "coa_report.pdf",
        contentType: "application/pdf",
        data: coaPdfBytes
      }
    ]);

    const coaEvRes = await appA.inject({
      method: "POST",
      url: `/api/v1/clients/${tenantA}/batches/${batchId}/evidence`,
      headers: { "content-type": coaForm.contentType },
      payload: coaForm.body
    });
    expect(coaEvRes.statusCode).toBe(201);
    const coaEvidenceId = coaEvRes.json().evidenceAsset.evidenceId;

    const coaRes = await appA.inject({
      method: "POST",
      url: `/api/v1/clients/${tenantA}/batches/${batchId}/coa-reports`,
      payload: {
        actionId: "018e69e0-8a6a-72cb-b1b7-ec79a1f73008",
        batchId,
        evidenceId: coaEvidenceId,
        evidenceRevision: 1,
        completenessStatus: "complete",
        reportIdentifierAsClaimed: "COA-SYNTH-99",
        reportDate: "2026-10-18",
        labNameAsClaimed: "Steep Hill Analytical Labs",
        sampleIdentifierAsClaimed: "SMPL-SYNTH-99",
        scopeKind: "attributed_lot",
        scopeDescription: "Comprehensive cannabinoid profiling for production lot",
        samplingMethodDescription: "Representative multi-point composite sample",
        sampleToBatchAssociationConfirmed: true,
        sampleToBatchAssociationAttestation: "Physical chain of custody verified against batch tag",
        measurements: [
          {
            analyte: "Cannabidiol (CBD)",
            resultKind: "quantified",
            resultValue: "25.5000",
            unit: "mg_per_g",
            basis: "dry_weight",
            context: "tincture_oil",
            quantityKind: "mass_fraction"
          }
        ]
      }
    });
    expect(coaRes.statusCode).toBe(201);
    const coaBody = coaRes.json();
    const reportId = coaBody.report.reportId;
    const measurementId = coaBody.currentRevision.measurements[0].measurementId;

    // 9. Review CoA Report
    currentActorA = "compliance-reviewer";
    const coaReviewRes = await appA.inject({
      method: "POST",
      url: `/api/v1/clients/${tenantA}/batches/${batchId}/coa-reports/${reportId}/review`,
      payload: {
        actionId: "018e69e0-8a6a-72cb-b1b7-ec79a1f73009",
        expectedVersion: 1,
        decision: "approved",
        reason: "Lab accreditation and digital signature verified",
        assessedScope: "attributed_lot"
      }
    });
    expect(coaReviewRes.statusCode).toBe(200);

    // 10. Create Product Claim
    currentActorA = "compliance-author";
    const claimRes = await appA.inject({
      method: "POST",
      url: `/api/v1/clients/${tenantA}/batches/${batchId}/claims`,
      payload: {
        actionId: "018e69e0-8a6a-72cb-b1b7-ec79a1f73010",
        batchId,
        canonicalKind: "certificate_panel_measurement",
        proofCategory: "coa_measurement_backed",
        parameters: {
          kind: "certificate_panel_measurement",
          measurements: [
            {
              analyte: "Cannabidiol (CBD)",
              exactDecimalValue: "25.5000",
              unit: "mg_per_g",
              quantityKind: "mass_fraction",
              basis: "dry_weight",
              context: "tincture_oil",
              requiredScope: "attributed_lot"
            }
          ]
        },
        displayWording: "Third-party tested: contains 25.5 mg/g CBD"
      }
    });
    expect(claimRes.statusCode).toBe(201);
    const claimBody = claimRes.json();
    const claimId = claimBody.claim?.claimId ?? claimBody.claimId;

    // 11. Link CoA Evidence to Claim
    const linkEvidenceRes = await appA.inject({
      method: "POST",
      url: `/api/v1/clients/${tenantA}/batches/${batchId}/claims/${claimId}/evidence-links`,
      payload: {
        actionId: "018e69e0-8a6a-72cb-b1b7-ec79a1f73011",
        expectedVersion: 1,
        claimRevision: 1,
        reason: "Linking accredited lab measurement",
        links: [
          {
            evidenceId: coaEvidenceId,
            evidenceRevision: 1,
            sourceObjectId: coaEvRes.json().sourceObject.sourceObjectId,
            sourceSha256: coaPdfHash,
            supportRole: "primary_measurement",
            reportId,
            reportRevision: 1,
            measurementId
          }
        ]
      }
    });
    expect(linkEvidenceRes.statusCode).toBe(200);

    // 12. Review Claim: self-approval rejection and distinct reviewer approval
    // (a) Self-approval by claim author is rejected with 403
    const selfApproveRes = await appA.inject({
      method: "POST",
      url: `/api/v1/clients/${tenantA}/batches/${batchId}/claims/${claimId}/review`,
      payload: {
        actionId: "018e69e0-8a6a-72cb-b1b7-ec79a1f73099",
        expectedVersion: 2,
        claimRevision: 1,
        decision: "approve",
        reason: "Self approval attempt"
      }
    });
    expect(selfApproveRes.statusCode).toBe(403);

    // (b) Distinct reviewer approval succeeds
    currentActorA = "compliance-reviewer";
    const claimReviewRes = await appA.inject({
      method: "POST",
      url: `/api/v1/clients/${tenantA}/batches/${batchId}/claims/${claimId}/review`,
      payload: {
        actionId: "018e69e0-8a6a-72cb-b1b7-ec79a1f73012",
        expectedVersion: 2,
        claimRevision: 1,
        decision: "approve",
        reason: "Evidence links corroborated by certified lab report"
      }
    });
    expect(claimReviewRes.statusCode).toBe(200);
    expect(claimReviewRes.json().claim.state).toBe("reviewer_approved");

    // 13. Read Dossier Query
    const dossierRes = await appA.inject({
      method: "GET",
      url: `/api/v1/clients/${tenantA}/batches/${batchId}/dossier`
    });
    expect(dossierRes.statusCode).toBe(200);
    const dossier = dossierRes.json();
    expect(BatchEvidenceDossierSchema.safeParse(dossier).success).toBe(true);
    expect(dossier.sku.skuId).toBe(skuId);
    expect(dossier.batch.batchId).toBe(batchId);
    expect(dossier.factsHistory).toHaveLength(2);
    expect(dossier.evidence).toHaveLength(2);
    expect(dossier.coaReports).toHaveLength(1);
    expect(dossier.claims).toHaveLength(1);

    const evItem = dossier.evidence.find(
      (e: { asset: { evidenceId: string } }) => e.asset.evidenceId === evidenceId
    );
    expect(evItem).toBeDefined();
    expect(evItem.derivatives).toHaveLength(1);
    expect(evItem.derivatives[0].referenceAssetId).toBe(refAssetId);

    // 14. Invalidate Claim: Healthy claim rejection, real dependency failure, and replay
    // (a) Attempting to invalidate a healthy claim is rejected without writes
    const healthyInvRes = await appA.inject({
      method: "POST",
      url: `/api/v1/clients/${tenantA}/batches/${batchId}/claims/${claimId}/invalidate`,
      payload: {
        actionId: "018e69e0-8a6a-72cb-b1b7-ec79a1f73013",
        expectedVersion: 3,
        claimRevision: 1,
        invalidationCause: "source_superseded",
        reason: "Lab measurement amended by re-test"
      }
    });
    expect(healthyInvRes.statusCode).toBe(400);

    // (b) Supersede CoA report to produce a genuine durable SOURCE_SUPERSEDED dependency failure
    currentActorA = "operator-a";
    const supersedeCoaRes = await appA.inject({
      method: "POST",
      url: `/api/v1/clients/${tenantA}/batches/${batchId}/coa-reports/${reportId}/supersede`,
      payload: {
        actionId: "018e69e0-8a6a-72cb-b1b7-ec79a1f73014",
        expectedVersion: 2,
        evidenceRevision: 1,
        completenessStatus: "complete",
        reportIdentifierAsClaimed: "RPT-2026-COA-001-REV2",
        reportDate: "2026-10-19",
        labNameAsClaimed: "Steep Hill Analytical",
        sampleIdentifierAsClaimed: "SMPL-789-B",
        scopeKind: "attributed_lot",
        scopeDescription: "Superseded lab test",
        sampleToBatchAssociationConfirmed: true,
        sampleToBatchAssociationAttestation: "Lot samples verified against revised harvest batch",
        samplingMethodDescription: "Composite core sample of dried flower batch",
        measurements: [
          {
            analyte: "THCA",
            resultKind: "quantified",
            resultValue: "25.0000",
            unit: "percent_w_w",
            basis: "dry_weight",
            context: "flower",
            quantityKind: "mass_fraction"
          }
        ]
      }
    });
    expect(supersedeCoaRes.statusCode).toBe(200);

    // (c) Assert automatic cascade invalidation triggered by CoA supersession:
    // Claim head is updated to 'invalidated', version incremented to 4, cause recorded as source_superseded
    const autoClaimRes = await appA.inject({
      method: "GET",
      url: `/api/v1/clients/${tenantA}/batches/${batchId}/claims/${claimId}`
    });
    expect(autoClaimRes.statusCode).toBe(200);
    const autoClaim = autoClaimRes.json();
    expect(autoClaim.claim.state).toBe("invalidated");
    expect(autoClaim.claim.version).toBe(4);
    expect(autoClaim.claim.invalidationCause).toBe("source_superseded");
    expect(autoClaim.claim.invalidationSourceRef).toBe(`${reportId}:rev:2`);

    // (d) Stale expectedVersion on terminal claim conflicts with 409
    currentActorA = "compliance-reviewer";
    const staleInvRes = await appA.inject({
      method: "POST",
      url: `/api/v1/clients/${tenantA}/batches/${batchId}/claims/${claimId}/invalidate`,
      payload: {
        actionId: "018e69e0-8a6a-72cb-b1b7-ec79a1f73015",
        expectedVersion: 3,
        claimRevision: 1,
        invalidationCause: "source_superseded",
        reason: "Stale version invalidation"
      }
    });
    expect(staleInvRes.statusCode).toBe(409);

    // (e) Attempting to re-apply invalidation to a terminal claim is rejected without writes
    const terminalInvRes = await appA.inject({
      method: "POST",
      url: `/api/v1/clients/${tenantA}/batches/${batchId}/claims/${claimId}/invalidate`,
      payload: {
        actionId: "018e69e0-8a6a-72cb-b1b7-ec79a1f73016",
        expectedVersion: 4,
        claimRevision: 1,
        invalidationCause: "source_superseded",
        reason: "Underlying CoA report was superseded"
      }
    });
    expect(terminalInvRes.statusCode).toBe(400);

    // 15. Same-tenant isolation: wrong-batch 404 vs wrong-lot 409 cross_batch_source
    const batch2Res = await appA.inject({
      method: "POST",
      url: `/api/v1/clients/${tenantA}/batches`,
      payload: {
        actionId: "018e69e0-8a6a-72cb-b1b7-ec79a1f73020",
        skuId,
        lotIdentifier: "LOT-2026-SYNTH-02",
        displayName: "Batch LOT-2026-SYNTH-02",
        initialFacts: {
          originKind: "own_production",
          producerIdentityAsClaimed: "Highland Organics LLC",
          productionStartDate: "2026-10-02",
          productionEndDate: "2026-10-02"
        }
      }
    });
    expect(batch2Res.statusCode).toBe(201);
    const batchId2 = batch2Res.json().batch.batchId;

    // (a) Wrong-batch target query returns 404 (does not expose cross-batch presence)
    const wrongBatchEvRes = await appA.inject({
      method: "GET",
      url: `/api/v1/clients/${tenantA}/batches/${batchId2}/evidence/${evidenceId}`
    });
    expect(wrongBatchEvRes.statusCode).toBe(404);

    const wrongBatchClaimRes = await appA.inject({
      method: "GET",
      url: `/api/v1/clients/${tenantA}/batches/${batchId2}/claims/${claimId}`
    });
    expect(wrongBatchClaimRes.statusCode).toBe(404);

    // (b) Wrong-lot source reference across batches in same tenant returns 409 CROSS_BATCH_SOURCE
    currentActorA = "compliance-author";
    const batch2ClaimRes = await appA.inject({
      method: "POST",
      url: `/api/v1/clients/${tenantA}/batches/${batchId2}/claims`,
      payload: {
        actionId: "018e69e0-8a6a-72cb-b1b7-ec79a1f73021",
        batchId: batchId2,
        canonicalKind: "factual_lot_identifier",
        proofCategory: "production_record_backed",
        parameters: {
          kind: "factual_lot_identifier",
          lotIdentifier: "LOT-2026-SYNTH-02"
        }
      }
    });
    expect(batch2ClaimRes.statusCode).toBe(201);
    const batch2ClaimBody = batch2ClaimRes.json();
    const batch2ClaimId = batch2ClaimBody.claim?.claimId ?? batch2ClaimBody.claimId;

    const crossBatchLinkRes = await appA.inject({
      method: "POST",
      url: `/api/v1/clients/${tenantA}/batches/${batchId2}/claims/${batch2ClaimId}/evidence-links`,
      payload: {
        actionId: "018e69e0-8a6a-72cb-b1b7-ec79a1f73022",
        expectedVersion: 1,
        claimRevision: 1,
        reason: "Attempt to link evidence belonging to batch 1",
        links: [
          {
            evidenceId,
            evidenceRevision: 1,
            sourceObjectId: evidenceData.sourceObject.sourceObjectId,
            sourceSha256: pngHash,
            supportRole: "visual_reference"
          }
        ]
      }
    });
    expect(crossBatchLinkRes.statusCode).toBe(409);
    expect(crossBatchLinkRes.json().error).toBe("CROSS_BATCH_SOURCE");

    // 16. Tampered S3 blob integrity check: quarantine committed and 409 returned
    const tamperedPng = Buffer.from(
      "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAIAAACQd1PeAAAADElEQVR42mP4//8/AAX+Av5z5wooAAAAAElFTkSuQmCC",
      "base64"
    );
    const tamperedForm = buildMultipart([
      {
        name: "metadata",
        contentType: "application/json",
        data: JSON.stringify({
          actionId: "018e69e0-8a6a-72cb-b1b7-ec79a1f73023",
          purpose: "general_supporting_evidence",
          sourceClass: "photo",
          acquisitionMethod: "direct_upload",
          assertionText: "Photo to be tampered in storage",
          registrationIntent: "initial_assertion",
          declaredMimeType: "image/png"
        })
      },
      {
        name: "file",
        filename: "tamper-target.png",
        contentType: "image/png",
        data: tamperedPng
      }
    ]);
    const tamperedEvRes = await appA.inject({
      method: "POST",
      url: `/api/v1/clients/${tenantA}/batches/${batchId2}/evidence`,
      headers: { "content-type": tamperedForm.contentType },
      payload: tamperedForm.body
    });
    expect(tamperedEvRes.statusCode).toBe(201);
    const tamperedEvData = tamperedEvRes.json();
    const tamperedEvId = tamperedEvData.evidenceAsset.evidenceId;
    const tamperedSrcObj = tamperedEvData.sourceObject;

    // Overwrite blob in MinIO/S3 with corrupted bytes
    const srcRow = await client.query<{ storage_bucket: string; storage_object_key: string }>(
      `SELECT storage_bucket, storage_object_key FROM source_objects WHERE source_object_id = $1`,
      [tamperedSrcObj.sourceObjectId]
    );
    expect(srcRow.rows[0]).toBeDefined();

    await rawS3Client.send(
      new PutObjectCommand({
        Bucket: srcRow.rows[0]!.storage_bucket,
        Key: srcRow.rows[0]!.storage_object_key,
        Body: Buffer.from("corrupted storage bytes that do not match original sha")
      })
    );

    // Recording verification event inspects bytes, detects mismatch, quarantines source in DB, and throws 409
    currentActorA = "compliance-reviewer";
    const tamperedVerRes = await appA.inject({
      method: "POST",
      url: `/api/v1/clients/${tenantA}/batches/${batchId2}/evidence/${tamperedEvId}/revisions/1/verification-events`,
      payload: {
        actionId: "018e69e0-8a6a-72cb-b1b7-ec79a1f73024",
        outcome: "verified",
        verificationKind: "human_internal_review",
        factScope: "capture_circumstances",
        method: "visual_inspection_against_spec",
        reason: "Inspecting tampered blob"
      }
    });
    expect(tamperedVerRes.statusCode).toBe(409);
    expect(tamperedVerRes.json().error).toBe("SOURCE_INTEGRITY_MISMATCH");

    // Verify source object availability is now quarantined in database
    const qRowRes = await client.query(
      `SELECT availability, quarantine_reason FROM source_objects WHERE source_object_id = $1`,
      [tamperedSrcObj.sourceObjectId]
    );
    expect(qRowRes.rows[0]?.availability).toBe("quarantined");

    // 17. Adversary Tests: Tenant B Cannot Access Tenant A Resources
    const bDossier = await appB.inject({
      method: "GET",
      url: `/api/v1/clients/${tenantA}/batches/${batchId}/dossier`
    });
    expect(bDossier.statusCode).toBe(403);

    const bCrossBatch = await appB.inject({
      method: "GET",
      url: `/api/v1/clients/${tenantB}/batches/${batchId}`
    });
    expect(bCrossBatch.statusCode).toBe(404);
  });
});
