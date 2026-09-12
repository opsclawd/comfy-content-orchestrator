import { test, expect } from "../harness/fixture.js";
import { randomUUID } from "node:crypto";

test.describe("Idempotency, Recovery, and Conflict Lifecycle", () => {
  test("Lost/ambiguous success response followed by same-intent retry lands on same campaign without duplicate admission (AC-7)", async ({
    page,
    testEnv
  }) => {
    testEnv.planningStub.reset();
    const campaignTitle = `Ambiguous Retry Campaign ${randomUUID().slice(0, 8)}`;

    await page.goto(`${testEnv.webServer.webUrl}/campaigns/new`);

    await page.getByTestId("brief-description-input").fill("Lost response resilience test brief");
    await page.getByTestId("campaign-title-input").fill(campaignTitle);
    await page.getByTestId("client-id-input").fill(testEnv.postgres.defaultClientId);
    await page.getByTestId("target-duration-input").fill("15");

    let firstIdempotencyKey: string | null = null;
    let secondIdempotencyKey: string | null = null;
    let firstCreatedCampaignId: string | null = null;
    let firstCreatedSceneIds: string[] = [];
    let requestCount = 0;

    // Route handler: allow first request to reach backend and complete in Postgres,
    // but abort the HTTP response delivered to the browser to simulate lost connection.
    await page.route("**/api/campaigns/plan", async (route) => {
      requestCount++;
      const reqBody = JSON.parse(route.request().postData() || "{}") as {
        idempotencyKey?: string;
      };
      if (requestCount === 1) {
        firstIdempotencyKey = reqBody.idempotencyKey ?? null;
        const response = await route.fetch();
        const data = (await response.json()) as {
          campaignId: string;
          idempotencyKey: string;
          scenes: Array<{ sceneId: string }>;
        };
        firstCreatedCampaignId = data.campaignId;
        firstCreatedSceneIds = data.scenes.map((s) => s.sceneId);

        // Verify the campaign was materialized in the database
        const dbCheck = await testEnv.postgres.pool.query(
          "SELECT campaign_id, total_scenes FROM campaigns WHERE campaign_id = $1",
          [firstCreatedCampaignId]
        );
        expect(dbCheck.rows.length).toBe(1);

        // Verify scenes were materialized in the database
        const scenesCheck = await testEnv.postgres.pool.query(
          "SELECT scene_id FROM storyboard_scenes WHERE campaign_id = $1",
          [firstCreatedCampaignId]
        );
        expect(scenesCheck.rows.length).toBeGreaterThan(0);

        // Abort delivery to browser
        await route.abort("failed");
      } else {
        secondIdempotencyKey = reqBody.idempotencyKey ?? null;
        await route.continue();
      }
    });

    // First submit: browser will encounter network failure
    await page.getByTestId("submit-campaign-button").click();

    // Form surfaces recoverable error banner
    await expect(page.getByTestId("campaign-creation-error")).toBeVisible();
    await expect(page.getByTestId("submit-campaign-button")).toBeEnabled();

    // Second submit with UNCHANGED inputs (same client-visible creation intent)
    const secondResponsePromise = page.waitForResponse(
      (resp) => resp.url().includes("/api/campaigns/plan") && resp.status() === 201
    );

    await page.getByTestId("submit-campaign-button").click();

    const secondResponse = await secondResponsePromise;
    const secondData = (await secondResponse.json()) as {
      campaignId: string;
      idempotencyKey: string;
      isIdempotentReplay: boolean;
      isStoryboardIdempotentReplay?: boolean;
      scenes: Array<{ sceneId: string }>;
    };

    // Replay returns the exact same campaign ID, same idempotency key, and idempotent replay flags
    expect(secondIdempotencyKey).toBe(firstIdempotencyKey);
    expect(secondData.idempotencyKey).toBe(firstIdempotencyKey);
    expect(secondData.campaignId).toBe(firstCreatedCampaignId);
    expect(secondData.isIdempotentReplay).toBe(true);
    expect(secondData.isStoryboardIdempotentReplay).toBe(true);

    const secondSceneIds = secondData.scenes.map((s) => s.sceneId);
    expect(secondSceneIds).toEqual(firstCreatedSceneIds);

    // Navigates to Review Hub for the same campaign
    await page.waitForURL(`**/campaigns/${firstCreatedCampaignId}`, { timeout: 15_000 });
    await expect(page.getByTestId("campaign-summary")).toBeVisible();

    // Confirm scene count in DB did not duplicate
    const scenesInDb = await testEnv.postgres.pool.query(
      "SELECT scene_id FROM storyboard_scenes WHERE campaign_id = $1",
      [firstCreatedCampaignId]
    );
    expect(scenesInDb.rows.length).toBe(secondData.scenes.length);
  });

  test("Planning failure before storyboard materialization is recoverable via intentional retry (AC-8)", async ({
    page,
    testEnv
  }) => {
    testEnv.planningStub.reset();
    // Configure planning stub to fail both primary and fallback on first attempt
    testEnv.planningStub.shouldThrow = true;

    const campaignTitle = `Planning Failure Recovery ${randomUUID().slice(0, 8)}`;

    await page.goto(`${testEnv.webServer.webUrl}/campaigns/new`);

    await page
      .getByTestId("brief-description-input")
      .fill("Planning failure recoverable shell test brief");
    await page.getByTestId("campaign-title-input").fill(campaignTitle);
    await page.getByTestId("client-id-input").fill(testEnv.postgres.defaultClientId);
    await page.getByTestId("target-duration-input").fill("15");

    // First attempt fails at planning model step
    await page.getByTestId("submit-campaign-button").click();

    // Form displays recoverable non-conflict error banner without crashing
    const errorBanner = page.getByTestId("campaign-creation-error");
    await expect(errorBanner).toBeVisible();
    await expect(page.getByTestId("campaign-creation-conflict")).not.toBeVisible();
    await expect(errorBanner).not.toContainText("conflict");
    await expect(page.getByTestId("submit-campaign-button")).toBeEnabled();

    // Confirm that Postgres has the campaign shell with 0 scenes
    const shellResult = await testEnv.postgres.pool.query(
      "SELECT campaign_id FROM campaigns WHERE title = $1",
      [campaignTitle]
    );
    expect(shellResult.rows.length).toBe(1);
    const failedCampaignId = shellResult.rows[0]!.campaign_id;

    const scenesResult = await testEnv.postgres.pool.query(
      "SELECT scene_id FROM storyboard_scenes WHERE campaign_id = $1",
      [failedCampaignId]
    );
    expect(scenesResult.rows.length).toBe(0);

    // Stub is now reset and will succeed on second attempt
    testEnv.planningStub.reset();

    // User retries submission via the same form
    const retryResponsePromise = page.waitForResponse(
      (resp) => resp.url().includes("/api/campaigns/plan") && resp.status() === 201
    );

    await page.getByTestId("submit-campaign-button").click();

    const retryResponse = await retryResponsePromise;
    const retryData = (await retryResponse.json()) as {
      campaignId: string;
      scenes: Array<{ sceneId: string }>;
    };

    // The retry completes the drafting shell in place
    expect(retryData.campaignId).toBe(failedCampaignId);
    expect(retryData.scenes.length).toBeGreaterThan(0);

    // Lands on Review Hub with materialized scenes
    await page.waitForURL(`**/campaigns/${failedCampaignId}`, { timeout: 15_000 });
    await expect(page.getByTestId("campaign-summary")).toBeVisible();

    const sceneRows = page.getByTestId("scene-row");
    await expect(sceneRows).toHaveCount(retryData.scenes.length);

    // Confirm candidate generation admitted for all retry scenes in DOM
    for (let i = 0; i < retryData.scenes.length; i++) {
      const row = sceneRows.nth(i);
      const statusBadge = row.locator(".status-badge");
      await expect(statusBadge).toHaveAttribute("data-status", "generating_candidates");
      await expect(statusBadge).toHaveText("generating_candidates");
    }

    // Confirm candidate generation admitted directly in Postgres database
    const scenesInDb = await testEnv.postgres.pool.query(
      "SELECT scene_id, status FROM storyboard_scenes WHERE campaign_id = $1 ORDER BY scene_order ASC",
      [failedCampaignId]
    );
    expect(scenesInDb.rows.length).toBe(retryData.scenes.length);
    for (const sceneRow of scenesInDb.rows) {
      expect(sceneRow.status).toBe("generating_candidates");
    }
  });

  test("Duplicate in-flight submit is guarded and admits only one operation (AC-9)", async ({
    page,
    testEnv
  }) => {
    testEnv.planningStub.reset();
    const campaignTitle = `InFlight Guard Campaign ${randomUUID().slice(0, 8)}`;

    await page.goto(`${testEnv.webServer.webUrl}/campaigns/new`);

    await page
      .getByTestId("brief-description-input")
      .fill("Concurrent submit throttling test brief");
    await page.getByTestId("campaign-title-input").fill(campaignTitle);
    await page.getByTestId("client-id-input").fill(testEnv.postgres.defaultClientId);
    await page.getByTestId("target-duration-input").fill("15");

    let networkPostCount = 0;
    await page.route("**/api/campaigns/plan", async (route) => {
      networkPostCount++;
      // Add a slight delay to keep submitting phase active
      await new Promise((r) => setTimeout(r, 600));
      await route.continue();
    });

    const submitBtn = page.getByTestId("submit-campaign-button");

    // First click triggers submission
    await submitBtn.click();

    // Button is immediately disabled
    await expect(submitBtn).toBeDisabled();
    await expect(submitBtn).toHaveText("Planning Storyboard...");

    // Rapid second click while in flight is ignored
    await submitBtn.click({ force: true });

    // Wait for successful navigation
    await page.waitForURL("**/campaigns/*", { timeout: 15_000 });

    // Only a single network request was initiated
    expect(networkPostCount).toBe(1);
  });

  test("Materially changed input starts a new logical creation intent (AC-10)", async ({
    page,
    testEnv
  }) => {
    testEnv.planningStub.reset();
    const firstTitle = `First Campaign ${randomUUID().slice(0, 8)}`;
    const secondTitle = `Second Campaign ${randomUUID().slice(0, 8)}`;

    // Create first campaign
    await page.goto(`${testEnv.webServer.webUrl}/campaigns/new`);
    await page.getByTestId("brief-description-input").fill("First campaign brief content");
    await page.getByTestId("campaign-title-input").fill(firstTitle);
    await page.getByTestId("client-id-input").fill(testEnv.postgres.defaultClientId);
    await page.getByTestId("target-duration-input").fill("15");

    const firstPromise = page.waitForResponse(
      (resp) => resp.url().includes("/api/campaigns/plan") && resp.status() === 201
    );
    await page.getByTestId("submit-campaign-button").click();
    const firstData = (await (await firstPromise).json()) as {
      campaignId: string;
      idempotencyKey: string;
    };

    await page.waitForURL(`**/campaigns/${firstData.campaignId}`, { timeout: 15_000 });

    // Navigate back to create a second campaign with materially changed inputs
    await page.goto(`${testEnv.webServer.webUrl}/campaigns/new`);
    await page
      .getByTestId("brief-description-input")
      .fill("Completely different brief for a distinct product release");
    await page.getByTestId("campaign-title-input").fill(secondTitle);
    await page.getByTestId("client-id-input").fill(testEnv.postgres.defaultClientId);
    await page.getByTestId("target-duration-input").fill("20");

    const secondPromise = page.waitForResponse(
      (resp) => resp.url().includes("/api/campaigns/plan") && resp.status() === 201
    );
    await page.getByTestId("submit-campaign-button").click();
    const secondData = (await (await secondPromise).json()) as {
      campaignId: string;
      idempotencyKey: string;
    };

    // Different campaign created with a fresh idempotency key
    expect(secondData.campaignId).not.toBe(firstData.campaignId);
    expect(secondData.idempotencyKey).not.toBe(firstData.idempotencyKey);

    await page.waitForURL(`**/campaigns/${secondData.campaignId}`, { timeout: 15_000 });
    await expect(page.getByTestId("campaign-name")).toHaveText(secondTitle);
  });

  test("IDEMPOTENCY_CONFLICT is explicitly surfaced in the integrated UI flow (AC-11)", async ({
    page,
    testEnv
  }) => {
    testEnv.planningStub.reset();
    const initialTitle = `PreConflict Success ${randomUUID().slice(0, 8)}`;

    // 1. Complete one successful creation in the browser before the conflict step (AC-23)
    await page.goto(`${testEnv.webServer.webUrl}/campaigns/new`);
    await page.getByTestId("brief-description-input").fill("Pre-conflict successful brief content");
    await page.getByTestId("campaign-title-input").fill(initialTitle);
    await page.getByTestId("client-id-input").fill(testEnv.postgres.defaultClientId);
    await page.getByTestId("target-duration-input").fill("15");

    const preConflictPromise = page.waitForResponse(
      (resp) => resp.url().includes("/api/campaigns/plan") && resp.status() === 201
    );
    await page.getByTestId("submit-campaign-button").click();
    const preConflictData = (await (await preConflictPromise).json()) as { campaignId: string };
    await page.waitForURL(`**/campaigns/${preConflictData.campaignId}`, { timeout: 15_000 });
    await expect(page.getByTestId("campaign-summary")).toBeVisible();

    // 2. Return to creation form to trigger conflict flow
    const conflictTitle = `Conflict Test ${randomUUID().slice(0, 8)}`;
    await page.goto(`${testEnv.webServer.webUrl}/campaigns/new`);
    await page.getByTestId("brief-description-input").fill("Initial submission for conflict test");
    await page.getByTestId("campaign-title-input").fill(conflictTitle);
    await page.getByTestId("client-id-input").fill(testEnv.postgres.defaultClientId);
    await page.getByTestId("target-duration-input").fill("15");

    let conflictRequestKey: string | null = null;
    let nextSubmitKey: string | null = null;
    let interceptedConflict = false;

    // AC-24: Intercept exactly one subsequent request with synthetic 409 IDEMPOTENCY_CONFLICT
    await page.route("**/api/campaigns/plan", async (route) => {
      const postData = JSON.parse(route.request().postData() || "{}") as {
        idempotencyKey?: string;
      };
      if (!interceptedConflict) {
        interceptedConflict = true;
        conflictRequestKey = postData.idempotencyKey ?? null;
        await route.fulfill({
          status: 409,
          contentType: "application/json",
          body: JSON.stringify({
            code: "IDEMPOTENCY_CONFLICT",
            message: "Idempotency key has already been used with conflicting request parameters."
          })
        });
      } else {
        nextSubmitKey = postData.idempotencyKey ?? null;
        await route.continue();
      }
    });

    await page.getByTestId("submit-campaign-button").click();

    // AC-25: 409 IDEMPOTENCY_CONFLICT banner is rendered with role="alert"
    const conflictBanner = page.getByTestId("campaign-creation-conflict");
    await expect(conflictBanner).toBeVisible();
    await expect(conflictBanner).toHaveAttribute("role", "alert");
    await expect(conflictBanner).toContainText("Campaign Conflict");
    await expect(conflictBanner).toContainText(
      "Idempotency key has already been used with conflicting request parameters."
    );
    await expect(page.getByTestId("submit-campaign-button")).toBeEnabled();

    // 3. Edit the form: committedIntent was cleared on IDEMPOTENCY_CONFLICT, so a fresh key is minted
    await page.getByTestId("brief-description-input").fill("Updated non-conflicting brief content");

    const successPromise = page.waitForResponse(
      (resp) => resp.url().includes("/api/campaigns/plan") && resp.status() === 201
    );

    await page.getByTestId("submit-campaign-button").click();
    const successResponse = await successPromise;
    const successData = (await successResponse.json()) as { campaignId: string };

    // AC-25: Verify committedIntent was cleared by observing freshly generated idempotencyKey
    expect(conflictRequestKey).toBeTruthy();
    expect(nextSubmitKey).toBeTruthy();
    expect(nextSubmitKey).not.toBe(conflictRequestKey);

    await page.waitForURL(`**/campaigns/${successData.campaignId}`, { timeout: 15_000 });
    await expect(page.getByTestId("campaign-summary")).toBeVisible();
  });
});
