import { test, expect } from "../harness/fixture.js";
import { randomUUID } from "node:crypto";

// Valid 1x1 transparent PNG image buffer
const TINY_PNG_BUFFER = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==",
  "base64"
);

test.describe("Client Reference Library and Campaign Reference Selection", () => {
  test("allows uploading reference asset, displaying role badges, selecting in campaign creation, and excluding archived references (AC-1 to AC-5)", async ({
    page,
    testEnv
  }) => {
    testEnv.planningStub.reset();
    const clientId = testEnv.postgres.defaultClientId;
    const campaignTitle = `Ref Campaign ${randomUUID().slice(0, 8)}`;
    const assetDisplayName = `Hero Model ${randomUUID().slice(0, 6)}`;

    // Set Tailscale peer IP header for director identity resolution
    await page.setExtraHTTPHeaders({ "x-cco-tailscale-peer-ip": "100.64.0.1" });

    // 1. Navigate to campaign creation page
    await page.goto(`${testEnv.webServer.webUrl}/campaigns/new`);
    await expect(page.getByTestId("campaign-creation-surface")).toBeVisible();

    // Verify prompt before client ID is filled
    await expect(page.getByTestId("reference-library-prompt")).toBeVisible();
    await expect(page.getByTestId("reference-library-prompt")).toContainText(
      "Enter a valid Client ID above"
    );

    // 2. Fill client ID
    await page.getByTestId("client-id-input").fill(clientId);

    // 3. Open Reference Library Drawer
    const manageBtn = page.getByTestId("manage-references-button");
    await expect(manageBtn).toBeVisible();
    await manageBtn.click();

    const drawer = page.getByTestId("reference-library-drawer");
    await expect(drawer).toBeVisible();
    await expect(drawer.getByRole("heading", { name: "Client Reference Library" })).toBeVisible();

    // 4. Open upload modal inside drawer
    await page.getByTestId("open-upload-modal-button").click();
    const uploadModal = page.getByTestId("reference-upload-modal");
    await expect(uploadModal).toBeVisible();

    // 5. Provide image file, display name, and role
    await page.getByTestId("reference-file-input").setInputFiles({
      name: "hero_model.png",
      mimeType: "image/png",
      buffer: TINY_PNG_BUFFER
    });

    // Verify pre-upload client preview is shown
    await expect(page.getByTestId("upload-image-preview")).toBeVisible();

    // Set custom display name
    await page.getByTestId("upload-display-name-input").fill(assetDisplayName);

    // Choose role: subject_identity
    await page.getByTestId("upload-role-select").selectOption("subject_identity");

    // Track upload network response
    const uploadResponsePromise = page.waitForResponse(
      (resp) =>
        resp.url().includes(`/api/clients/${clientId}/references`) &&
        resp.request().method() === "POST" &&
        resp.status() === 201
    );

    // Submit upload
    await page.getByTestId("upload-submit-button").click();

    const uploadResponse = await uploadResponsePromise;
    const uploadedAsset = (await uploadResponse.json()) as {
      id: string;
      displayName: string;
      libraryRole: string;
    };
    expect(uploadedAsset.id).toBeTruthy();
    expect(uploadedAsset.displayName).toBe(assetDisplayName);
    expect(uploadedAsset.libraryRole).toBe("subject_identity");

    // Upload modal closes, new card appears in drawer gallery
    await expect(uploadModal).not.toBeVisible();
    const drawerCard = drawer.getByTestId(`reference-card-${uploadedAsset.id}`);
    await expect(drawerCard).toBeVisible();
    await expect(drawerCard.getByTestId("reference-display-name")).toHaveText(assetDisplayName);
    await expect(drawerCard.getByTestId("reference-role-badge")).toBeVisible();
    await expect(drawerCard.getByTestId("reference-role-badge")).toHaveText("Subject Identity");

    // 6. Close the drawer
    await page.getByTestId("close-drawer-button").click();
    await expect(drawer).not.toBeVisible();

    // 7. Verify the reference asset card is now surfaced in the form's reference section
    const formRefSection = page.getByTestId("reference-assets-section");
    const formCard = formRefSection.getByTestId(`reference-card-${uploadedAsset.id}`);
    await expect(formCard).toBeVisible();
    await expect(formCard.getByTestId("reference-display-name")).toHaveText(assetDisplayName);
    await expect(formCard.getByTestId("reference-role-badge")).toBeVisible();
    await expect(formCard.getByTestId("reference-role-badge")).toHaveText("Subject Identity");

    // 8. Select the reference asset
    await expect(formCard).toHaveAttribute("data-selected", "false");
    await formCard.click();
    await expect(formCard).toHaveAttribute("data-selected", "true");
    await expect(page.getByTestId("selected-reference-count")).toHaveText("(1 selected)");

    // 9. Fill in remainder of campaign form
    await page
      .getByTestId("brief-description-input")
      .fill("High-end cinematic campaign showcasing brand character and identity");
    await page.getByTestId("brief-visual-style-input").fill("35mm film grain golden lighting");
    await page.getByTestId("campaign-title-input").fill(campaignTitle);
    await page.getByTestId("target-platform-input").fill("tiktok");
    await page.getByTestId("target-duration-input").fill("15");

    // 10. Submit campaign creation and verify candidateReferenceAssetIds is included
    const planResponsePromise = page.waitForResponse(
      (resp) =>
        resp.url().includes("/api/campaigns/plan") &&
        (resp.status() === 201 || resp.status() === 202)
    );

    await page.getByTestId("submit-campaign-button").click();

    const planResponse = await planResponsePromise;
    const planRequest = planResponse.request().postDataJSON() as {
      candidateReferenceAssetIds?: string[];
      title: string;
      clientId: string;
    };

    expect(planRequest.candidateReferenceAssetIds).toEqual([uploadedAsset.id]);

    const planData = (await planResponse.json()) as { campaignId: string };
    expect(planData.campaignId).toBeTruthy();

    await page.waitForURL(`**/campaigns/${planData.campaignId}`, { timeout: 15_000 });
    await expect(page.getByTestId("campaign-name")).toHaveText(campaignTitle);

    // 11. Test Archive exclusion:
    // Navigate back to campaign creation
    await page.goto(`${testEnv.webServer.webUrl}/campaigns/new`);
    await page.getByTestId("client-id-input").fill(clientId);

    // Verify card is present initially
    const activeFormCard = page.getByTestId(`reference-card-${uploadedAsset.id}`);
    await expect(activeFormCard).toBeVisible();

    // Open drawer and archive this reference
    await page.getByTestId("manage-references-button").click();
    await expect(drawer).toBeVisible();

    const cardToArchive = drawer.getByTestId(`reference-card-${uploadedAsset.id}`);
    await expect(cardToArchive).toBeVisible();
    await cardToArchive.getByTestId("archive-reference-button").click();

    // Confirmation modal appears
    const archiveModal = page.getByTestId("reference-archive-modal");
    await expect(archiveModal).toBeVisible();
    await expect(archiveModal).toContainText("Archive Reference Asset");

    // Confirm archive
    const deleteResponsePromise = page.waitForResponse(
      (resp) =>
        resp.url().includes(`/api/clients/${clientId}/references/${uploadedAsset.id}`) &&
        resp.request().method() === "DELETE" &&
        resp.status() === 204
    );

    await page.getByTestId("archive-confirm-button").click();
    await deleteResponsePromise;

    // Archived reference is removed from drawer
    await expect(cardToArchive).not.toBeVisible();

    // Close drawer
    await page.getByTestId("close-drawer-button").click();

    // Verify archived reference is excluded from campaign creation selection
    await expect(page.getByTestId(`reference-card-${uploadedAsset.id}`)).not.toBeVisible();
  });
});
