import { test, expect } from "../harness/fixture.js";
import { randomUUID } from "node:crypto";

// Synthetic 1x1 test image bytes (pure synthetic fixture, no real records)
const SYNTHETIC_IMAGE_PNG = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==",
  "base64"
);

// Synthetic minimal valid 1-page PDF bytes
const SYNTHETIC_PDF_BYTES = Buffer.from(
  "%PDF-1.4\n1 0 obj<</Type/Catalog/Pages 2 0 R>>endobj\n2 0 obj<</Type/Pages/Count 1/Kids[3 0 R]>>endobj\n3 0 obj<</Type/Page/MediaBox[0 0 612 792]/Parent 2 0 R/Resources<<>>>>endobj\nxref\n0 4\n0000000000 65535 f \n0000000010 00000 n \n0000000053 00000 n \n0000000102 00000 n \ntrailer<</Size 4/Root 1 0 R>>\nstartxref\n178\n%%EOF\n"
);

test.describe("Verified-Batch Operator Workspace and Evidence Gate (#477)", () => {
  test("complete synthetic batch lifecycle: SKU/lot creation, evidence registration, CoA transcription, claim review, and safe source inspection", async ({
    page,
    testEnv
  }) => {
    testEnv.planningStub.reset();
    const clientId = testEnv.postgres.defaultClientId;
    const testSkuName = `Test SKU ${randomUUID().slice(0, 6)}`;
    const testCanonicalSku = `SKU-TEST-${randomUUID().slice(0, 8).toUpperCase()}`;
    const testLotIdentifier = `LOT-2026-${randomUUID().slice(0, 6).toUpperCase()}`;

    // Director identity header for Review Hub authorization
    await page.setExtraHTTPHeaders({ "x-cco-tailscale-peer-ip": "100.64.0.1" });

    // 1. Client Chooser at /products
    await page.goto(`${testEnv.webServer.webUrl}/products`);
    await expect(page.getByTestId("authorized-client-chooser")).toBeVisible();
    await expect(page.getByTestId(`client-choice-${clientId}`)).toBeVisible();

    // 2. Navigate to Client's Products & Batches Workspace
    await page.getByTestId(`client-choice-${clientId}`).click();
    await page.waitForURL(`**/clients/${clientId}/products`);
    await expect(page.getByTestId("products-workspace")).toBeVisible();

    // 3. Create new SKU
    await page.getByTestId("create-sku-button").click();
    await expect(page.getByTestId("create-sku-modal")).toBeVisible();
    await page.getByTestId("sku-canonical-input").fill(testCanonicalSku);
    await page.getByTestId("sku-display-name-input").fill(testSkuName);
    await page.getByTestId("submit-create-sku-button").click();
    await expect(page.getByTestId("create-sku-modal")).toBeHidden();
    await expect(page.getByTestId(`sku-card-${testCanonicalSku}`)).toBeVisible();

    // Select the created SKU
    await page.getByTestId(`sku-card-${testCanonicalSku}`).click();
    await expect(page.getByTestId("lot-section-title")).toContainText(testCanonicalSku);

    // 4. Create new Batch / Lot under SKU
    await page.getByTestId("create-batch-button").click();
    await expect(page.getByTestId("create-batch-modal")).toBeVisible();
    await page.getByTestId("batch-lot-identifier-input").fill(testLotIdentifier);
    await page.getByTestId("batch-origin-select").selectOption("own_production");
    await page.getByTestId("batch-producer-input").fill("Apex Cultivation Facility");
    await page.getByTestId("submit-create-batch-button").click();
    await expect(page.getByTestId("create-batch-modal")).toBeHidden();
    await expect(page.getByTestId(`batch-item-${testLotIdentifier}`)).toBeVisible();

    // 5. Open Batch Evidence Dossier
    await page.getByTestId(`view-dossier-button-${testLotIdentifier}`).click();
    await expect(page.getByTestId("batch-dossier-page")).toBeVisible();
    await expect(page.getByTestId("batch-dossier-summary-panel")).toBeVisible();

    // Check dossier summary values and breadcrumbs
    await expect(page.getByTestId("dossier-breadcrumbs")).toContainText(testCanonicalSku);
    await expect(page.getByTestId("dossier-breadcrumbs")).toContainText(testLotIdentifier);
    await expect(page.getByTestId("current-facts-card")).toContainText("Apex Cultivation Facility");

    // 6. Register Source Evidence (Hero Photo)
    await page.getByTestId("register-evidence-button").click();
    await expect(page.getByTestId("register-evidence-modal")).toBeVisible();
    await page.getByTestId("evidence-file-input").setInputFiles({
      name: "synthetic_macro_hero.png",
      mimeType: "image/png",
      buffer: SYNTHETIC_IMAGE_PNG
    });
    await page.getByTestId("evidence-purpose-select").selectOption("macro_hero_photo");
    await page.getByTestId("source-class-select").selectOption("photo");
    await page.getByTestId("assertion-text-input").fill("Synthetic macro hero proof capture");
    await page.getByTestId("submit-register-evidence-button").click();
    await expect(page.getByTestId("register-evidence-modal")).toBeHidden();

    // Verify safe source projection (SHA-256 present, no internal server paths)
    await expect(page.getByTestId("source-sha256").first()).toBeVisible();
    await expect(page.getByTestId("source-availability").first()).toContainText("available");
    const pageContent = await page.content();
    expect(pageContent).not.toContain("/var/lib/minio");
    expect(pageContent).not.toContain("s3://");

    // 7. On-demand Ephemeral Media Inspection
    const inspectBtn = page.getByRole("button", { name: "Inspect Original Media" }).first();
    await inspectBtn.click();
    await expect(page.getByTestId("media-inspection-modal")).toBeVisible();
    await expect(page.getByTestId("inspected-media-image")).toBeVisible();
    await expect(page.getByTestId("media-inspection-modal")).toContainText(
      "Expires in 300 seconds"
    );
    await page.getByRole("button", { name: "Close Inspection" }).click();
    await expect(page.getByTestId("media-inspection-modal")).toBeHidden();

    // 7b. Register CoA Lab Certificate Evidence (PDF)
    await page.getByTestId("register-evidence-button").click();
    await expect(page.getByTestId("register-evidence-modal")).toBeVisible();
    await page.getByTestId("evidence-file-input").setInputFiles({
      name: "synthetic_lab_report.pdf",
      mimeType: "application/pdf",
      buffer: SYNTHETIC_PDF_BYTES
    });
    await page.getByTestId("evidence-purpose-select").selectOption("coa_test_report");
    await page.getByTestId("source-class-select").selectOption("coa");
    await page.getByTestId("assertion-text-input").fill("Synthetic laboratory test certificate");
    await page.getByTestId("submit-register-evidence-button").click();
    await expect(page.getByTestId("register-evidence-modal")).toBeHidden();

    // Inspect PDF media
    const inspectPdfBtn = page.getByRole("button", { name: "Inspect Original Media" }).first();
    await inspectPdfBtn.click();
    await expect(page.getByTestId("media-inspection-modal")).toBeVisible();
    await expect(page.getByTestId("inspected-source-pdf")).toBeVisible();
    await expect(page.getByTestId("pdf-safe-open-link")).toBeVisible();
    await page.getByRole("button", { name: "Close Inspection" }).click();
    await expect(page.getByTestId("media-inspection-modal")).toBeHidden();

    // 8. Transcribe CoA Report
    await page.getByTestId("transcribe-coa-button").click();
    await expect(page.getByTestId("transcribe-coa-modal")).toBeVisible();
    await page.getByTestId("coa-report-id-input").fill("RPT-SYNTHETIC-2026");
    await page.getByTestId("coa-lab-name-input").fill("Apex Certified Analytics");
    await page.getByTestId("row-analyte-0").fill("THC");
    await page.getByTestId("row-value-0").fill("24.5000"); // Exact decimal string preserving trailing zeros
    await page.getByTestId("row-unit-0").fill("percent");
    await page.getByTestId("submit-transcribe-coa-button").click();
    await expect(page.getByTestId("transcribe-coa-modal")).toBeHidden();

    // Verify CoA report and exact measurement string rendered
    await expect(page.getByTestId("measurement-value-THC")).toHaveText("24.5000");
    await expect(page.getByTestId("measurement-unit-THC")).toHaveText("percent");
    await expect(page.getByTestId("coa-unreviewed-badge")).toBeVisible();

    // 9. Operator Reviews CoA Report (demonstrates separation of duties via distinct reviewer actor)
    // First, author attempt (100.64.0.1) is rejected by reviewer authorization gate
    const authorReviewCoaBtn = page.getByRole("button", { name: "Record Review" }).first();
    await authorReviewCoaBtn.click();
    await expect(page.getByTestId("coa-review-modal")).toBeVisible();
    await page.getByTestId("coa-review-decision-select").selectOption("approved");
    await page.getByTestId("coa-review-reason-input").fill("Author self-review attempt");
    await page.getByTestId("submit-coa-review-button").click();
    await expect(page.getByTestId("review-coa-error")).toBeVisible();
    await expect(page.getByTestId("review-coa-error")).toContainText("not authorized");
    await page.getByTestId("coa-review-modal").getByRole("button", { name: "Cancel" }).click();
    await expect(page.getByTestId("coa-review-modal")).toBeHidden();

    // Now switch to distinct reviewer actor (100.64.0.2) -> approved
    await page.setExtraHTTPHeaders({ "x-cco-tailscale-peer-ip": "100.64.0.2" });
    const reviewCoaBtn = page.getByRole("button", { name: "Record Review" }).first();
    await reviewCoaBtn.click();
    await expect(page.getByTestId("coa-review-modal")).toBeVisible();
    await page.getByTestId("coa-review-decision-select").selectOption("approved");
    await page
      .getByTestId("coa-review-reason-input")
      .fill("Verified against lab certificate PDF signature");
    await page.getByTestId("submit-coa-review-button").click();
    await expect(page.getByTestId("coa-review-modal")).toBeHidden();
    await expect(page.getByTestId("coa-review-badge")).toBeVisible();
    await expect(page.getByTestId("coa-review-badge")).toContainText("approved");

    // 10. Propose Claim backed by CoA
    await page.setExtraHTTPHeaders({ "x-cco-tailscale-peer-ip": "100.64.0.1" });
    await page.getByTestId("propose-claim-button").click();
    await expect(page.getByTestId("propose-claim-modal")).toBeVisible();
    await page.getByTestId("claim-proof-category-select").selectOption("coa_measurement_backed");
    await page.getByTestId("param-analyte-input").fill("THC");
    await page.getByTestId("param-value-input").fill("24.5000");
    await page.getByTestId("param-unit-input").fill("percent");
    await page.getByTestId("claim-display-wording-input").fill("24.5000% THC by dry weight");
    await page.getByTestId("submit-propose-claim-button").click();
    await expect(page.getByTestId("propose-claim-modal")).toBeHidden();

    // Initially unlinked claim is blocked
    await expect(page.getByTestId("claim-blocked-badge")).toBeVisible();

    // 11. Link Evidence to Claim
    const linkEvidenceBtn = page.getByRole("button", { name: "+ Link Evidence" }).first();
    await linkEvidenceBtn.click();
    await expect(page.getByTestId("link-evidence-modal")).toBeVisible();
    await page.getByTestId("submit-link-evidence-button").click();
    await expect(page.getByTestId("link-evidence-modal")).toBeHidden();

    // Claim now becomes support-eligible
    await expect(page.getByTestId("claim-eligible-badge")).toBeVisible();
    await expect(page.getByTestId("claim-display-wording")).toContainText(
      "24.5000% THC by dry weight"
    );

    // 12. Review and Approve Claim (using distinct reviewer actor)
    // First, author attempt (100.64.0.1) is rejected by reviewer authorization gate
    const authorReviewClaimBtn = page.getByRole("button", { name: "Review Claim" }).first();
    await authorReviewClaimBtn.click();
    await expect(page.getByTestId("claim-review-modal")).toBeVisible();
    await page.getByTestId("claim-review-reason-input").fill("Author self-review attempt");
    await page.getByTestId("submit-claim-review-button").click();
    await expect(page.getByTestId("review-claim-error")).toBeVisible();
    await expect(page.getByTestId("review-claim-error")).toContainText("not authorized");
    await page.getByTestId("claim-review-modal").getByRole("button", { name: "Cancel" }).click();
    await expect(page.getByTestId("claim-review-modal")).toBeHidden();

    // Switch to distinct reviewer actor (100.64.0.2) -> approved
    await page.setExtraHTTPHeaders({ "x-cco-tailscale-peer-ip": "100.64.0.2" });
    const reviewClaimBtn = page.getByRole("button", { name: "Review Claim" }).first();
    await reviewClaimBtn.click();
    await expect(page.getByTestId("claim-review-modal")).toBeVisible();
    await page
      .getByTestId("claim-review-reason-input")
      .fill("Verified supporting CoA is authentic and active");
    await page.getByTestId("submit-claim-review-button").click();
    await expect(page.getByTestId("claim-review-modal")).toBeHidden();
  });

  test("security gate: deep-link SKU mismatch prevents foreign lot inspection", async ({
    page,
    testEnv
  }) => {
    const clientId = testEnv.postgres.defaultClientId;
    const fakeSkuId = "00000000-0000-0000-0000-000000000000";
    const fakeBatchId = "11111111-1111-1111-1111-111111111111";

    await page.setExtraHTTPHeaders({ "x-cco-tailscale-peer-ip": "100.64.0.1" });

    // Navigate with mismatched/non-existent SKU deep link
    await page.goto(
      `${testEnv.webServer.webUrl}/clients/${clientId}/products/${fakeSkuId}/batches/${fakeBatchId}`
    );

    // Mismatched or not found error banner is displayed
    await expect(page.getByTestId("dossier-load-error")).toBeVisible();
    await expect(page.getByTestId("dossier-load-error")).toContainText(
      "Failed to load batch dossier"
    );
  });
});
