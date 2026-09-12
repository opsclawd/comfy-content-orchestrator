import { test, expect } from "../harness/fixture.js";
import { randomUUID } from "node:crypto";

test.describe("Campaign Creation Handoff and Review Hub Integration", () => {
  test("Auto scene-count happy path navigates to Review Hub with canonical scenes and admitted candidate generation (AC-1, AC-2, AC-3, AC-4, AC-5)", async ({
    page,
    testEnv
  }) => {
    testEnv.planningStub.reset();
    const campaignTitle = `Auto Campaign ${randomUUID().slice(0, 8)}`;

    // Navigate to creation form
    await page.goto(`${testEnv.webServer.webUrl}/campaigns/new`);
    await expect(page.getByTestId("campaign-creation-surface")).toBeVisible();

    // Fill form inputs
    await page
      .getByTestId("brief-description-input")
      .fill("Vibrant high-energy summer activewear commercial for outdoor enthusiasts");
    await page.getByTestId("brief-visual-style-input").fill("cinematic sunlight 35mm golden hour");
    await page.getByTestId("campaign-title-input").fill(campaignTitle);
    await page.getByTestId("client-id-input").fill(testEnv.postgres.defaultClientId);
    await page.getByTestId("target-platform-input").fill("instagram_reels");
    await page.getByTestId("target-duration-input").fill("15");

    // Auto mode is checked by default
    await expect(page.getByTestId("scene-count-mode-auto")).toBeChecked();

    // Track create response
    const planResponsePromise = page.waitForResponse(
      (resp) => resp.url().includes("/api/campaigns/plan") && resp.status() === 201
    );

    // Submit
    await page.getByTestId("submit-campaign-button").click();

    // Verify response
    const planResponse = await planResponsePromise;
    const planData = (await planResponse.json()) as {
      campaignId: string;
      scenes: Array<{ sceneId: string; ordinal: number; status: string }>;
      totalScenes: number;
    };

    expect(planData.campaignId).toBeTruthy();
    expect(planData.scenes.length).toBeGreaterThan(0);

    // AC-1: Successful creation navigates automatically to the resulting campaign/storyboard
    await page.waitForURL(`**/campaigns/${planData.campaignId}`, { timeout: 15_000 });
    await expect(page.getByTestId("campaign-summary")).toBeVisible();
    await expect(page.getByTestId("campaign-name")).toHaveText(campaignTitle);

    // AC-2: Displays exactly the server-materialized scene set in canonical order
    const sceneRows = page.getByTestId("scene-row");
    await expect(sceneRows).toHaveCount(planData.scenes.length);

    // Assert that each row in the DOM matches index-for-index the sceneId order returned from creation
    for (let i = 0; i < planData.scenes.length; i++) {
      const row = sceneRows.nth(i);
      const expectedScene = planData.scenes[i]!;
      await expect(row.getByTestId("scene-link")).toHaveAttribute(
        "href",
        `/scenes/${expectedScene.sceneId}`
      );
      await expect(row).toContainText(expectedScene.sceneId);

      // AC-3: Candidate generation is already admitted/under way after handoff
      const statusBadge = row.locator(".status-badge");
      await expect(statusBadge).toHaveAttribute("data-status", "generating_candidates");
      await expect(statusBadge).toHaveText("generating_candidates");
    }

    // AC-4: Existing candidate-review controls work unchanged after creation
    // Click into the first scene
    const firstScene = planData.scenes[0]!;
    await sceneRows.first().getByTestId("scene-link").click();

    await page.waitForURL(`**/scenes/${firstScene.sceneId}`, { timeout: 10_000 });
    await expect(page.getByTestId("scene-review-detail")).toBeVisible();
    await expect(page.getByTestId("back-to-campaign-link")).toBeVisible();
    await expect(page.getByTestId("scene-configuration")).toBeVisible();
    await expect(page.getByTestId("review-command-controls")).toBeVisible();
  });

  test("Explicit scene-count override happy path succeeds end-to-end (AC-6)", async ({
    page,
    testEnv
  }) => {
    testEnv.planningStub.reset();
    const campaignTitle = `Custom Override Campaign ${randomUUID().slice(0, 8)}`;
    const overrideCount = 2;

    await page.goto(`${testEnv.webServer.webUrl}/campaigns/new`);
    await expect(page.getByTestId("campaign-creation-surface")).toBeVisible();

    await page
      .getByTestId("brief-description-input")
      .fill("Minimalist architecture showcase with geometric lighting");
    await page.getByTestId("campaign-title-input").fill(campaignTitle);
    await page.getByTestId("client-id-input").fill(testEnv.postgres.defaultClientId);
    await page.getByTestId("target-duration-input").fill("15");

    // Select custom mode and set override count
    await page.getByTestId("scene-count-mode-custom").click();
    await page.getByTestId("scene-count-override-input").fill(String(overrideCount));

    const planResponsePromise = page.waitForResponse(
      (resp) => resp.url().includes("/api/campaigns/plan") && resp.status() === 201
    );

    await page.getByTestId("submit-campaign-button").click();

    const planResponse = await planResponsePromise;
    const planData = (await planResponse.json()) as {
      campaignId: string;
      scenes: Array<{ sceneId: string; ordinal: number; status: string }>;
      totalScenes: number;
    };

    expect(planData.totalScenes).toBe(overrideCount);
    expect(planData.scenes).toHaveLength(overrideCount);

    // Navigates to campaign review hub
    await page.waitForURL(`**/campaigns/${planData.campaignId}`, { timeout: 15_000 });
    await expect(page.getByTestId("campaign-summary")).toBeVisible();

    // Verify scene row count matches override
    const sceneRows = page.getByTestId("scene-row");
    await expect(sceneRows).toHaveCount(overrideCount);
    await expect(page.getByTestId("metric-total-scenes")).toContainText(String(overrideCount));
  });
});
