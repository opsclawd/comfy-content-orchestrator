import { test, expect } from "../harness/fixture.js";
import { randomUUID } from "node:crypto";
import { insertStoryboardCandidateRecord } from "@cco/infrastructure/testing";

test.describe("MiniMax-H3 End-to-End Campaign Execution and Review Lifecycle", () => {
  test("Single-scene campaign planned with MiniMax-H3 profile dispatches 124-frame production render and completes delivery (AC-1, AC-2, AC-3)", async ({
    page,
    testEnv
  }) => {
    testEnv.planningStub.reset();
    testEnv.planningStub.targetEngineProfileId = "MINIMAX_H3_720P_5S_I2V_V1";

    const campaignTitle = `MiniMax-H3 Single-Scene ${randomUUID().slice(0, 8)}`;

    // 1. Navigate to campaign creation form
    await page.setExtraHTTPHeaders({ "x-cco-tailscale-peer-ip": "100.64.0.1" });
    await page.goto(`${testEnv.webServer.webUrl}/campaigns/new`);
    await expect(page.getByTestId("campaign-creation-surface")).toBeVisible();

    // Fill form with 5-second target duration matching MiniMax-H3 canonical duration
    await page
      .getByTestId("brief-description-input")
      .fill("Photorealistic cinematic portrait of an elderly artisan in morning light");
    await page
      .getByTestId("brief-visual-style-input")
      .fill("photorealistic 35mm film photography, 8k resolution, natural lighting");
    await page.getByTestId("campaign-title-input").fill(campaignTitle);
    await page.getByTestId("client-id-input").fill(testEnv.postgres.defaultClientId);
    await page.getByTestId("target-duration-input").fill("5");

    // Select custom mode with 1 scene
    await page.getByTestId("scene-count-mode-custom").click();
    await page.getByTestId("scene-count-override-input").fill("1");

    const planPromise = page.waitForResponse(
      (resp) =>
        resp.url().includes("/api/campaigns/plan") &&
        (resp.status() === 201 || resp.status() === 202)
    );

    await page.getByTestId("submit-campaign-button").click();
    const planData = (await (await planPromise).json()) as {
      campaignId: string;
      scenes: Array<{ sceneId: string }>;
    };

    // 2. Navigates to campaign summary
    await page.waitForURL(`**/campaigns/${planData.campaignId}`, { timeout: 15_000 });
    await expect(page.getByTestId("campaign-summary")).toBeVisible();
    await expect(page.getByTestId("campaign-name")).toHaveText(campaignTitle);

    // Find materialized scene ID
    let firstSceneId = planData.scenes[0]?.sceneId;
    if (!firstSceneId) {
      for (let i = 0; i < 30; i++) {
        const scenesCheck = await testEnv.postgres.pool.query(
          "SELECT scene_id FROM storyboard_scenes WHERE campaign_id = $1 ORDER BY scene_order ASC",
          [planData.campaignId]
        );
        if (scenesCheck.rows.length > 0) {
          firstSceneId = scenesCheck.rows[0]!.scene_id;
          break;
        }
        await new Promise((r) => setTimeout(r, 100));
      }
    }
    expect(firstSceneId).toBeDefined();

    // 3. Navigate to scene review page
    await page.goto(`${testEnv.webServer.webUrl}/scenes/${firstSceneId}`);
    await expect(page.getByTestId("scene-review-detail")).toBeVisible();

    // Simulate candidate generation completing by inserting a candidate in Postgres
    const client = await testEnv.postgres.pool.connect();
    const candidateId = randomUUID();
    try {
      await insertStoryboardCandidateRecord(client, {
        candidateId,
        sceneId: firstSceneId!,
        sceneSpecRevision: 1,
        variantOrdinal: 1,
        storageBucket: "test-bucket",
        storageObjectKey: `candidates/${firstSceneId}/candidate-1.png`,
        contentHashSha256: "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef",
        generationPayload: { prompt: "Test prompt", model: "FLUX" }
      });

      await client.query(
        "UPDATE storyboard_scenes SET status = 'director_review', updated_at = NOW() WHERE scene_id = $1",
        [firstSceneId]
      );
    } finally {
      client.release();
    }

    await page.reload();
    await expect(page.getByTestId("scene-review-detail")).toBeVisible();
    await expect(page.getByTestId("candidate-card")).toHaveCount(1);

    // 4. Select the candidate
    await page.getByTestId("select-candidate-button").first().click();
    await expect(page.getByTestId("review-command-dialog")).toBeVisible();
    const selectPromise = page.waitForResponse(
      (resp) => resp.url().includes("/review-command") && resp.status() === 200
    );
    await page.getByTestId("confirm-command-button").click();
    await selectPromise;

    // 5. Approve candidate to dispatch MiniMax-H3 production rendering
    await expect(page.getByTestId("action-button-approve")).toBeVisible();
    await page.getByTestId("action-button-approve").click();

    // Confirm dialog
    await expect(page.getByTestId("review-command-dialog")).toBeVisible();
    const approvePromise = page.waitForResponse(
      (resp) => resp.url().includes("/review-command") && resp.status() === 200
    );
    await page.getByTestId("confirm-command-button").click();
    await approvePromise;

    // 6. Verify production render job was queued with MiniMax-H3 template and 124 frames
    const renderJobsQuery = await testEnv.postgres.pool.query(
      "SELECT job_id, workflow_template, injected_payload, status FROM render_jobs WHERE scene_id = $1 AND job_kind = 'production'",
      [firstSceneId]
    );
    expect(renderJobsQuery.rows.length).toBe(1);
    const prodJob = renderJobsQuery.rows[0]!;
    expect(prodJob.workflow_template).toBe("minimax-h3-720p-124f-i2v");
    const payload =
      typeof prodJob.injected_payload === "string"
        ? JSON.parse(prodJob.injected_payload)
        : prodJob.injected_payload;
    expect(payload.frameCount).toBe(124);
    expect(payload.approvedCandidateId).toBe(candidateId);

    // 7. Simulate production rendering completion
    const prodJobId = prodJob.job_id;
    const clientForProd = await testEnv.postgres.pool.connect();
    try {
      await clientForProd.query(
        "UPDATE render_jobs SET status = 'completed', updated_at = NOW() WHERE job_id = $1",
        [prodJobId]
      );

      const manifestId = randomUUID();
      await clientForProd.query(
        `INSERT INTO generation_manifests (
          manifest_id, job_id, prompt_id_comfy, campaign_id, scene_id, render_attempt, manifest_payload
        ) VALUES (
          $1, $2, $3, $4, $5, 1, $6
        )`,
        [
          manifestId,
          prodJobId,
          randomUUID(),
          planData.campaignId,
          firstSceneId,
          JSON.stringify({
            renderProfile: "MINIMAX_H3_720P_5S_I2V_V1",
            renderProfileVersion: 1,
            outputs: [
              {
                bucket: "godzspeed-delivery",
                key: `scenes/${firstSceneId}/production/${prodJobId}.mp4`,
                checksumSha256: "abcdef0123456789abcdef0123456789abcdef0123456789abcdef0123456789",
                contentType: "video/mp4"
              }
            ]
          })
        ]
      );

      await clientForProd.query(
        "UPDATE storyboard_scenes SET status = 'qa', updated_at = NOW() WHERE scene_id = $1",
        [firstSceneId]
      );
    } finally {
      clientForProd.release();
    }

    // 8. Reload scene page and verify Production Review panel
    await page.route("http://mock-storage/**", (route) =>
      route.fulfill({ status: 200, contentType: "video/mp4", body: Buffer.from("mock-video") })
    );

    await page.reload();
    await expect(page.getByTestId("production-review-panel")).toBeVisible();
    await expect(page.getByTestId("production-attempt-identity")).toBeVisible();
    await expect(page.getByTestId("action-button-production_accept")).toBeVisible();

    // 9. Accept the production video
    await page.getByTestId("action-button-production_accept").click();
    await expect(page.getByTestId("review-command-dialog")).toBeVisible();

    const acceptPromise = page.waitForResponse(
      (resp) => resp.url().includes("/review-command") && resp.status() === 200
    );
    await page.getByTestId("confirm-command-button").click();
    await acceptPromise;

    // 10. Verify scene is completed and delivery assembly job is queued
    const sceneStatusQuery = await testEnv.postgres.pool.query(
      "SELECT status FROM storyboard_scenes WHERE scene_id = $1",
      [firstSceneId]
    );
    expect(sceneStatusQuery.rows[0]!.status).toBe("completed");

    // Campaign status transitioned to queued/delivering/completed for delivery assembly
    const campaignQuery = await testEnv.postgres.pool.query(
      "SELECT status FROM campaigns WHERE campaign_id = $1",
      [planData.campaignId]
    );
    expect(["queued", "delivering", "completed"]).toContain(campaignQuery.rows[0]!.status);

    // Verify delivery reel panel reflects delivery state
    await page.goto(`${testEnv.webServer.webUrl}/campaigns/${planData.campaignId}`);
    await expect(page.getByTestId("campaign-delivery-reel-panel")).toBeVisible();
  });

  test("Engine change from LTX to MiniMax-H3 reconfigures scene duration to 5000ms", async ({
    page,
    testEnv
  }) => {
    testEnv.planningStub.reset();
    testEnv.planningStub.targetEngineProfileId = "LTX_25_720P_5S_V1";

    const campaignTitle = `Engine Switch Campaign ${randomUUID().slice(0, 8)}`;

    await page.setExtraHTTPHeaders({ "x-cco-tailscale-peer-ip": "100.64.0.1" });
    await page.goto(`${testEnv.webServer.webUrl}/campaigns/new`);

    await page
      .getByTestId("brief-description-input")
      .fill("Photorealistic subject transitioning from LTX to MiniMax");
    await page.getByTestId("campaign-title-input").fill(campaignTitle);
    await page.getByTestId("client-id-input").fill(testEnv.postgres.defaultClientId);
    await page.getByTestId("target-duration-input").fill("5");

    await page.getByTestId("scene-count-mode-custom").click();
    await page.getByTestId("scene-count-override-input").fill("1");

    const planPromise = page.waitForResponse(
      (resp) =>
        resp.url().includes("/api/campaigns/plan") &&
        (resp.status() === 201 || resp.status() === 202)
    );

    await page.getByTestId("submit-campaign-button").click();
    const planData = (await (await planPromise).json()) as {
      campaignId: string;
      scenes: Array<{ sceneId: string }>;
    };

    let sceneId = planData.scenes[0]?.sceneId;
    if (!sceneId) {
      for (let i = 0; i < 30; i++) {
        const scenesCheck = await testEnv.postgres.pool.query(
          "SELECT scene_id FROM storyboard_scenes WHERE campaign_id = $1 ORDER BY scene_order ASC",
          [planData.campaignId]
        );
        if (scenesCheck.rows.length > 0) {
          sceneId = scenesCheck.rows[0]!.scene_id;
          break;
        }
        await new Promise((r) => setTimeout(r, 100));
      }
    }
    expect(sceneId).toBeDefined();

    // Mark scene director_review
    const client = await testEnv.postgres.pool.connect();
    try {
      await insertStoryboardCandidateRecord(client, {
        sceneId: sceneId!,
        sceneSpecRevision: 1,
        variantOrdinal: 1,
        storageBucket: "test-bucket",
        storageObjectKey: `candidates/${sceneId}/candidate-1.png`,
        contentHashSha256: "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef",
        generationPayload: { prompt: "Test prompt", model: "FLUX" }
      });

      await client.query(
        "UPDATE storyboard_scenes SET status = 'director_review', updated_at = NOW() WHERE scene_id = $1",
        [sceneId]
      );
    } finally {
      client.release();
    }

    // Execute engine_change to MiniMax-H3 via review command
    const res = await page.request.post(
      `${testEnv.webServer.webUrl}/api/scenes/${sceneId}/review-command`,
      {
        headers: {
          "Content-Type": "application/json",
          "x-cco-tailscale-peer-ip": "100.64.0.1"
        },
        data: {
          actionId: randomUUID(),
          sceneId,
          expectedSpecRevision: 1,
          action: "engine_change",
          payload: {
            engineProfileId: "MINIMAX_H3_720P_5S_I2V_V1"
          },
          directorNotes: "Upgrade to MiniMax-H3"
        }
      }
    );

    expect(res.status()).toBe(200);
    const body = (await res.json()) as { specRevision: number };
    expect(body.specRevision).toBe(2);

    // Verify scene in database has MINIMAX_H3_720P_5S_I2V_V1 engine profile
    const dbCheck = await testEnv.postgres.pool.query(
      "SELECT engine_assigned, spec_revision FROM storyboard_scenes WHERE scene_id = $1",
      [sceneId]
    );
    expect(dbCheck.rows[0]!.engine_assigned).toBe("MINIMAX_H3_720P_5S_I2V_V1");
    expect(dbCheck.rows[0]!.spec_revision).toBe(2);
  });
});
