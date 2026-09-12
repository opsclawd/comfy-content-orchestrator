import { test, expect } from "../harness/fixture.js";
import { randomUUID } from "node:crypto";
import { insertStoryboardCandidateRecord } from "@cco/infrastructure/testing";

test.describe("Post-Handoff Candidate Review Flow", () => {
  test("Successful orchestration response followed by normal candidate-review interactions using existing review UI (AC-4)", async ({
    page,
    testEnv
  }) => {
    testEnv.planningStub.reset();
    const campaignTitle = `Review Handoff Campaign ${randomUUID().slice(0, 8)}`;

    // 1. Create a campaign
    await page.setExtraHTTPHeaders({ "x-cco-tailscale-peer-ip": "100.64.0.1" });
    await page.goto(`${testEnv.webServer.webUrl}/campaigns/new`);
    await page
      .getByTestId("brief-description-input")
      .fill("Review handoff candidate interaction test brief");
    await page.getByTestId("campaign-title-input").fill(campaignTitle);
    await page.getByTestId("client-id-input").fill(testEnv.postgres.defaultClientId);
    await page.getByTestId("target-duration-input").fill("15");

    const planPromise = page.waitForResponse(
      (resp) => resp.url().includes("/api/campaigns/plan") && resp.status() === 201
    );

    await page.getByTestId("submit-campaign-button").click();
    const planData = (await (await planPromise).json()) as {
      campaignId: string;
      scenes: Array<{ sceneId: string }>;
    };

    // Navigates to campaign summary
    await page.waitForURL(`**/campaigns/${planData.campaignId}`, { timeout: 15_000 });
    const firstSceneId = planData.scenes[0]!.sceneId;

    // Navigate to the scene review page
    await page.goto(`${testEnv.webServer.webUrl}/scenes/${firstSceneId}`);
    await expect(page.getByTestId("scene-review-detail")).toBeVisible();
    await expect(page.getByTestId("review-command-controls")).toBeVisible();
    await expect(page.getByTestId("review-actions-toolbar")).toBeVisible();

    // Scene is in generating_candidates status; cancel action is immediately available
    await expect(page.getByTestId("action-button-cancel")).toBeVisible();

    // 2. Simulate candidate generation completing by inserting a candidate in Postgres
    // and updating the scene to director_review status
    const client = await testEnv.postgres.pool.connect();
    try {
      await insertStoryboardCandidateRecord(client, {
        sceneId: firstSceneId,
        sceneSpecRevision: 1,
        variantOrdinal: 1,
        storageBucket: "test-bucket",
        storageObjectKey: `candidates/${firstSceneId}/candidate-1.png`,
        contentHashSha256: "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef",
        generationPayload: { prompt: "Test prompt", model: "LTX" }
      });

      await client.query(
        "UPDATE storyboard_scenes SET status = 'director_review', updated_at = NOW() WHERE scene_id = $1",
        [firstSceneId]
      );
    } finally {
      client.release();
    }

    // Reload scene review page to pick up the updated status and candidates
    await page.reload();
    await expect(page.getByTestId("scene-review-detail")).toBeVisible();

    // Verify candidate gallery displays the generated candidate
    await expect(page.getByRole("region", { name: "Candidate History" })).toBeVisible();
    const candidateCards = page.getByTestId("candidate-card");
    await expect(candidateCards).toHaveCount(1);

    // Full set of review action buttons are now available in director_review
    await expect(page.getByTestId("action-button-approve")).toBeVisible();
    await expect(page.getByTestId("action-button-reroll")).toBeVisible();
    await expect(page.getByTestId("action-button-prompt_edit")).toBeVisible();

    // 3. Perform a prompt_edit review interaction through the existing UI
    await page.getByTestId("action-button-prompt_edit").click();
    await expect(page.getByTestId("review-draft-panel")).toBeVisible();
    await expect(page.getByTestId("draft-prompt-input")).toBeVisible();

    await page.getByTestId("draft-prompt-input").fill("Updated refined scene visual prompt");
    await page.getByTestId("stage-draft-button").click();

    // Confirmation panel appears
    await expect(page.getByTestId("review-command-dialog")).toBeVisible();

    // Track review command network call
    const commandPromise = page.waitForResponse(
      (resp) => resp.url().includes("/review-command") && resp.status() === 200
    );

    await page.getByTestId("confirm-command-button").click();
    await commandPromise;

    // Toast or success banner is displayed and spec revision increments
    await expect(page.locator(".scene-header")).toContainText("Revision 2");
  });

  test("Review command fails closed with 401 AUTHENTICATION_REQUIRED when Tailscale peer IP is missing or spoofed via x-cco-reviewer-identity", async ({
    page,
    testEnv
  }) => {
    testEnv.planningStub.reset();
    const sceneId = randomUUID();

    // Direct POST to review-command without x-cco-tailscale-peer-ip header
    const noPeerIpRes = await page.request.post(
      `${testEnv.webServer.webUrl}/api/scenes/${sceneId}/review-command`,
      {
        headers: {
          "Content-Type": "application/json"
        },
        data: {
          actionId: randomUUID(),
          sceneId,
          expectedSpecRevision: 1,
          action: "approve",
          payload: {},
          directorNotes: "Unauthenticated attempt"
        }
      }
    );
    expect(noPeerIpRes.status()).toBe(401);
    const noPeerIpBody = (await noPeerIpRes.json()) as { code: string; message: string };
    expect(noPeerIpBody.code).toBe("AUTHENTICATION_REQUIRED");

    // Direct POST with spoofed x-cco-reviewer-identity header (without valid peer IP)
    const spoofedRes = await page.request.post(
      `${testEnv.webServer.webUrl}/api/scenes/${sceneId}/review-command`,
      {
        headers: {
          "Content-Type": "application/json",
          "x-cco-reviewer-identity": "Malicious Spoofed Director"
        },
        data: {
          actionId: randomUUID(),
          sceneId,
          expectedSpecRevision: 1,
          action: "approve",
          payload: {},
          directorNotes: "Spoofed attempt"
        }
      }
    );
    expect(spoofedRes.status()).toBe(401);
    const spoofedBody = (await spoofedRes.json()) as { code: string; message: string };
    expect(spoofedBody.code).toBe("AUTHENTICATION_REQUIRED");
  });
});
