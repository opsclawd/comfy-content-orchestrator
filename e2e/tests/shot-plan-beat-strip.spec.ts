import { test, expect } from "../harness/fixture.js";
import { randomUUID, createHash } from "node:crypto";
import {
  insertStoryboardCandidateRecord,
  insertRenderJobRecord
} from "@cco/infrastructure/testing";
import { testObjectStorage } from "../harness/control-api.js";

const MINIMAL_PNG_BASE64 =
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=";

test.describe("Per-beat frame strip in the ShotPlan UI (Issue #392)", () => {
  test("renders 3 beat frames in order with labeled placeholders, non-authoritative badge, and unblocked approval", async ({
    page,
    testEnv
  }) => {
    testEnv.planningStub.reset();
    const campaignTitle = `Beat Strip Campaign ${randomUUID().slice(0, 8)}`;

    // 1. Create a campaign with 1 scene
    await page.setExtraHTTPHeaders({ "x-cco-tailscale-peer-ip": "100.64.0.1" });
    await page.goto(`${testEnv.webServer.webUrl}/campaigns/new`);
    await page
      .getByTestId("brief-description-input")
      .fill("Three-beat ShotPlan review with per-beat visual frame strip");
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

    // Navigates to campaign summary
    await page.waitForURL(`**/campaigns/${planData.campaignId}`, { timeout: 15_000 });

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

    // 2. Intercept mock storage in the browser so Beat 1's ready image loads successfully
    await page.route("http://mock-storage/**", (route) =>
      route.fulfill({
        status: 200,
        contentType: "image/png",
        body: Buffer.from(MINIMAL_PNG_BASE64, "base64")
      })
    );

    // 3. Seed candidate, shot plan with 3 beats, and job records in Postgres
    const client = await testEnv.postgres.pool.connect();
    const candidateId = randomUUID();
    const shotPlanId = randomUUID();

    try {
      const candidateBytes = Buffer.from(MINIMAL_PNG_BASE64, "base64");
      const candidateContentHash = createHash("sha256").update(candidateBytes).digest("hex");
      const candidateStorageKey = `candidates/${firstSceneId}/beat-1.png`;

      await testObjectStorage.putObject({
        bucket: "test-bucket",
        key: candidateStorageKey,
        body: candidateBytes,
        contentType: "image/png",
        checksumSha256: candidateContentHash
      });

      await insertStoryboardCandidateRecord(client, {
        candidateId,
        sceneId: firstSceneId!,
        sceneSpecRevision: 1,
        variantOrdinal: 1,
        beatIndex: 1,
        storageBucket: "test-bucket",
        storageObjectKey: candidateStorageKey,
        contentHashSha256: candidateContentHash,
        generationPayload: { prompt: "Beat 1 candidate", model: "FLUX" }
      });

      // Insert shot plan with 3 beats (intentionally declared in shuffled order in the plan JSON)
      await client.query(
        `
        INSERT INTO shot_plans (
          shot_plan_id, scene_id, spec_revision, variant_ordinal, status, routing_mode,
          target_duration_ms, target_frame_count, framing, camera_angle,
          camera_movement, lighting_style, structured_plan, previs_candidate_id
        ) VALUES (
          $1, $2, 1, 1, 'draft', 'reference_directed',
          4500, 108, 'medium', 'eye_level',
          'dolly_in', 'neon_night',
          $3::jsonb, $4
        )
        `,
        [
          shotPlanId,
          firstSceneId,
          JSON.stringify({
            movementSpeed: "slow",
            actionSummary: "Agent walks down rain-slicked alleyway",
            beats: [
              {
                beatIndex: 3,
                startMs: 3000,
                endMs: 4500,
                description: "Puddle splash reflection",
                cameraAction: "tilt down",
                subjectAction: "steps forward"
              },
              {
                beatIndex: 1,
                startMs: 0,
                endMs: 1500,
                description: "Visor lifts to reveal ocular scanner",
                cameraAction: "push in",
                subjectAction: "hand lifts visor"
              },
              {
                beatIndex: 2,
                startMs: 1500,
                endMs: 3000,
                description: "Scanner targets alleyway terminal",
                cameraAction: "pan right",
                subjectAction: "gaze fixes on terminal"
              }
            ],
            subjects: []
          }),
          candidateId
        ]
      );

      // Previs association for Beat 1 (ready)
      await client.query(
        `
        INSERT INTO shot_plan_previs_associations (
          shot_plan_id, beat_index, candidate_id, scene_id, spec_revision
        ) VALUES ($1, 1, $2, $3, 1)
        `,
        [shotPlanId, candidateId, firstSceneId]
      );

      // Beat 2: queued job (pending)
      await insertRenderJobRecord(client, {
        sceneId: firstSceneId!,
        jobKind: "candidate",
        status: "queued",
        injectedPayload: {
          shotPlanId,
          specRevision: 1,
          variantOrdinal: 1,
          beatIndex: 2
        }
      });

      // Beat 3: failed job (failed)
      await insertRenderJobRecord(client, {
        sceneId: firstSceneId!,
        jobKind: "candidate",
        status: "failed",
        injectedPayload: {
          shotPlanId,
          specRevision: 1,
          variantOrdinal: 1,
          beatIndex: 3
        }
      });

      // Set scene to director_review
      await client.query(
        "UPDATE storyboard_scenes SET status = 'director_review', updated_at = NOW() WHERE scene_id = $1",
        [firstSceneId]
      );
    } finally {
      client.release();
    }

    // 4. Navigate to the scene review page
    await page.goto(`${testEnv.webServer.webUrl}/scenes/${firstSceneId}`);
    await expect(page.getByTestId("scene-review-detail")).toBeVisible();
    await expect(page.getByTestId("shot-plan-panel")).toBeVisible();

    const card = page.getByTestId("shot-plan-card").first();
    await expect(card).toBeVisible();

    // 5. Verify the beat strip and non-authoritative badge
    const strip = card.getByTestId("shot-plan-beat-strip");
    await expect(strip).toBeVisible();

    const badge = strip.getByTestId("beat-strip-badge");
    await expect(badge).toBeVisible();
    await expect(badge).toContainText("Beat frames — non-authoritative");

    // 6. Verify the 3 beat slots are in numeric beat order
    const slots = strip.getByTestId("shot-plan-beat-slot");
    await expect(slots).toHaveCount(3);

    // Slot 1: Ready with displayable image
    const slot1 = slots.nth(0);
    await expect(slot1).toHaveAttribute("data-beat-index", "1");
    await expect(slot1).toHaveAttribute("data-status", "ready");
    await expect(slot1.getByTestId("shot-plan-beat-image")).toBeVisible();
    await expect(slot1.getByTestId("shot-plan-beat-caption")).toHaveText("Beat 1");

    // Slot 2: Pending with labeled placeholder
    const slot2 = slots.nth(1);
    await expect(slot2).toHaveAttribute("data-beat-index", "2");
    await expect(slot2).toHaveAttribute("data-status", "pending");
    const placeholder2 = slot2.getByTestId("shot-plan-beat-placeholder");
    await expect(placeholder2).toBeVisible();
    await expect(placeholder2).toHaveText("Frame pending");
    await expect(slot2.getByTestId("shot-plan-beat-caption")).toHaveText("Beat 2");

    // Slot 3: Failed with labeled placeholder
    const slot3 = slots.nth(2);
    await expect(slot3).toHaveAttribute("data-beat-index", "3");
    await expect(slot3).toHaveAttribute("data-status", "failed");
    const placeholder3 = slot3.getByTestId("shot-plan-beat-placeholder");
    await expect(placeholder3).toBeVisible();
    await expect(placeholder3).toHaveText("Frame failed");
    await expect(slot3.getByTestId("shot-plan-beat-caption")).toHaveText("Beat 3");

    // 7. Verify non-goals: candidate selection controls do NOT exist on the strip
    await expect(strip.locator("button")).toHaveCount(0);

    // 8. Verify non-goals: approval/selection are NOT blocked by pending or failed frames
    const selectBtn = card.getByTestId("shot-plan-select-button");
    const approveBtn = card.getByTestId("shot-plan-approve-button");

    await expect(selectBtn).toBeEnabled();
    await expect(approveBtn).toBeEnabled();

    // Select plan action can be executed
    await selectBtn.click();
    const commandDialog = page.getByTestId("review-command-dialog");
    await expect(commandDialog).toBeVisible();
    await page.getByTestId("confirm-command-button").click();
    await expect(card.getByTestId("shot-plan-selected-badge")).toBeVisible();
  });
});
