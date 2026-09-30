import { describe, expect, it } from "vitest";
import {
  computeShotPlanSemanticDiff,
  evaluateShotPlanComparability,
  resolveShotPlanDiffSource,
  summarizeShotPlanDiff,
  ShotPlanComparisonRejectedError,
  SHOT_PLAN_DIFF_READ_ONLY_NOTICE
} from "./shot-plan-semantic-diff.js";
import type { ShotPlanDocument } from "./shot-plan.js";

const SCENE_A = "22222222-2222-4222-8222-222222222222";
const SCENE_B = "99999999-9999-4999-8999-999999999999";
const PLAN_V2 = "11111111-1111-4111-8111-111111111111";
const PLAN_V4 = "44444444-4444-4444-8444-444444444444";

function createBasePlan(overrides?: Partial<ShotPlanDocument>): ShotPlanDocument {
  return {
    id: PLAN_V2,
    sceneId: SCENE_A,
    specRevision: 3,
    variantOrdinal: 2,
    status: "draft",
    routingMode: "reference_directed",
    targetDurationMs: 5170,
    targetFrameCount: 124,
    durationToleranceMs: 355,
    fps: 24,
    framing: "medium",
    angle: "eye_level",
    lensIntent: "35mm standard",
    cameraPosition: "chest height",
    cameraMovement: "static",
    movementSpeed: "medium",
    cameraPromptDescription: "Locked off view of the product on the bar",
    actionSummary: "Bartender presents the product to camera",
    lightingStyle: "practical_interior",
    environmentDescription: "Bar interior",
    colorPalette: ["amber", "wood"],
    atmosphere: "warm haze",
    subjects: [
      {
        subjectId: "elena",
        role: "subject_identity",
        initialPosition: "screen_left",
        movementTrajectory: "stationary",
        interactionSummary: "looks at product",
        referenceAssetId: "33333333-3333-4333-8333-333333333333"
      },
      {
        subjectId: "hero-bottle",
        role: "product",
        initialPosition: "foreground_right",
        movementTrajectory: "stationary on bar",
        interactionSummary: null,
        referenceAssetId: null
      }
    ],
    beats: [
      {
        beatIndex: 1,
        startMs: 0,
        endMs: 2500,
        description: "Bartender lifts bottle",
        cameraAction: "static hold",
        subjectAction: "lifts bottle"
      },
      {
        beatIndex: 2,
        startMs: 2500,
        endMs: 5170,
        description: "Pours into glass",
        cameraAction: "static hold",
        subjectAction: "pours liquid"
      }
    ],
    dialogue: {
      speaker: "Elena",
      line: "Try this.",
      voiceoverCue: null,
      audioFxPrompt: null,
      deliveryEmotion: "warm"
    },
    continuity: {
      persistentSubjectIds: ["elena"],
      frameAnchorTarget: "none",
      anchorCandidateId: null,
      lightingContinuityNote: "warm practical throughout",
      incomingContinuityFromSceneId: null,
      anchorMediaHashSha256: null
    },
    previs: null,
    derivedFromShotPlanId: null,
    derivation: null,
    createdAt: "2026-09-27T12:00:00.000Z",
    updatedAt: "2026-09-27T12:00:00.000Z",
    ...overrides
  };
}

function createVariationPlan(overrides?: Partial<ShotPlanDocument>): ShotPlanDocument {
  const base = createBasePlan();
  return {
    ...base,
    id: PLAN_V4,
    variantOrdinal: 4,
    framing: "medium_close_up",
    lensIntent: "50mm tight prime",
    cameraMovement: "dolly_in",
    movementSpeed: "slow",
    subjects: [
      base.subjects[0]!,
      {
        ...base.subjects[1]!,
        initialPosition: "foreground_right",
        movementTrajectory: "slides toward camera"
      }
    ],
    derivedFromShotPlanId: PLAN_V2,
    derivation: {
      sourceShotPlanId: PLAN_V2,
      sourceVariantOrdinal: 2,
      directorGuidance: "Tighter 50mm, product moved forward, slow dolly-in",
      requestedAt: "2026-09-28T12:00:00.000Z",
      machineModel: null,
      provider: null,
      idempotencyKey: null,
      requestHashSha256: null
    },
    ...overrides
  };
}

describe("computeShotPlanSemanticDiff", () => {
  it("reports no material changes for identical plans", () => {
    const plan = createBasePlan();
    const other = createBasePlan({ id: PLAN_V4, variantOrdinal: 4 });

    const diff = computeShotPlanSemanticDiff(plan, other, { currentSpecRevision: 3 });

    expect(diff.hasMaterialChanges).toBe(false);
    expect(diff.changedFieldCount).toBe(0);
    for (const group of diff.groups) {
      for (const field of group.fields) {
        expect(field.status).toBe("unchanged");
      }
      for (const entry of group.collections) {
        expect(entry.status).toBe("unchanged");
      }
    }
  });

  it("reports framing/lens/movement/blocking changes for a #361-style variation", () => {
    const source = createBasePlan();
    const target = createVariationPlan();

    const diff = computeShotPlanSemanticDiff(source, target, { currentSpecRevision: 3 });

    const framingCamera = diff.groups.find((g) => g.group === "framing_camera")!;
    const framingField = framingCamera.fields.find((f) => f.key === "framing")!;
    expect(framingField.status).toBe("changed");
    expect(framingField.before.display).toBe("Medium");
    expect(framingField.after.display).toBe("Medium Close-up");

    const lensField = framingCamera.fields.find((f) => f.key === "lensIntent")!;
    expect(lensField.status).toBe("changed");
    expect(lensField.before.display).toBe("35mm standard");
    expect(lensField.after.display).toBe("50mm tight prime");

    const movementField = framingCamera.fields.find((f) => f.key === "cameraMovement")!;
    expect(movementField.status).toBe("changed");
    expect(movementField.before.display).toBe("Static");
    expect(movementField.after.display).toBe("Dolly In");

    const speedField = framingCamera.fields.find((f) => f.key === "movementSpeed")!;
    expect(speedField.status).toBe("changed");

    const staging = diff.groups.find((g) => g.group === "staging")!;
    const productEntry = staging.collections.find((e) => e.entryKey === "hero-bottle")!;
    expect(productEntry.status).toBe("changed");
    const positionField = productEntry.fields.find((f) => f.key === "subjects.initialPosition")!;
    expect(positionField.status).toBe("unchanged"); // foreground_right -> foreground_right unchanged
    const trajectoryField = productEntry.fields.find(
      (f) => f.key === "subjects.movementTrajectory"
    )!;
    expect(trajectoryField.status).toBe("changed");

    // Subject identity, environment, lighting, and duration remain unchanged.
    const subjectEntry = staging.collections.find((e) => e.entryKey === "elena")!;
    expect(subjectEntry.status).toBe("unchanged");

    const envLighting = diff.groups.find((g) => g.group === "environment_lighting")!;
    for (const field of envLighting.fields) {
      expect(field.status).toBe("unchanged");
    }

    const timing = diff.groups.find((g) => g.group === "timing")!;
    for (const field of timing.fields) {
      expect(field.status).toBe("unchanged");
    }
    const durationField = timing.fields.find((f) => f.key === "targetDurationMs")!;
    expect(durationField.before.display).toBe("5.17 sec");
  });

  it("keeps changed and unchanged fields disjoint and exhaustive", () => {
    const source = createBasePlan();
    const target = createVariationPlan();
    const diff = computeShotPlanSemanticDiff(source, target, { currentSpecRevision: 3 });

    let totalFields = 0;
    for (const group of diff.groups) {
      totalFields += group.fields.length;
      for (const entry of group.collections) {
        totalFields += entry.fields.length;
      }
    }

    expect(diff.changedFieldCount + diff.unchangedFieldCount).toBe(totalFields);
    expect(diff.changedFieldCount).toBeGreaterThan(0);
  });

  it("marks added subjects as added and removed subjects as removed", () => {
    const source = createBasePlan();
    const target = createBasePlan({
      id: PLAN_V4,
      subjects: [source.subjects[0]!, { ...source.subjects[1]!, subjectId: "new-product" }]
    });

    const diff = computeShotPlanSemanticDiff(source, target, { currentSpecRevision: 3 });
    const staging = diff.groups.find((g) => g.group === "staging")!;
    const removed = staging.collections.find((e) => e.entryKey === "hero-bottle")!;
    expect(removed.status).toBe("removed");
    const added = staging.collections.find((e) => e.entryKey === "new-product")!;
    expect(added.status).toBe("added");
  });

  it("does not report spurious add/remove pairs when identical subjects are reordered", () => {
    const source = createBasePlan();
    const target = createBasePlan({
      id: PLAN_V4,
      subjects: [source.subjects[1]!, source.subjects[0]!]
    });

    const diff = computeShotPlanSemanticDiff(source, target, { currentSpecRevision: 3 });
    const staging = diff.groups.find((g) => g.group === "staging")!;
    for (const entry of staging.collections) {
      expect(entry.status).toBe("unchanged");
    }
  });

  it("disambiguates duplicate subjectId occurrences deterministically", () => {
    const duplicateSubject = {
      subjectId: "elena",
      role: "subject_identity" as const,
      initialPosition: "screen_left" as const,
      movementTrajectory: "stationary",
      interactionSummary: null,
      referenceAssetId: null
    };
    const source = createBasePlan({ subjects: [duplicateSubject, duplicateSubject] });
    const target = createBasePlan({ id: PLAN_V4, subjects: [duplicateSubject, duplicateSubject] });

    const diff = computeShotPlanSemanticDiff(source, target, { currentSpecRevision: 3 });
    const staging = diff.groups.find((g) => g.group === "staging")!;
    const keys = staging.collections.map((e) => e.entryKey).sort();
    expect(keys).toEqual(["elena", "elena#2"]);
    for (const entry of staging.collections) {
      expect(entry.status).toBe("unchanged");
    }
  });

  it("diffs beats for content change, timing shift, add, and remove", () => {
    const source = createBasePlan();
    const target = createBasePlan({
      id: PLAN_V4,
      beats: [
        {
          ...source.beats[0]!,
          startMs: 400,
          endMs: 2500,
          description: "Bartender lifts bottle slowly"
        },
        {
          beatIndex: 3,
          startMs: 2500,
          endMs: 5170,
          description: "New closing beat",
          cameraAction: "static hold",
          subjectAction: "sets glass down"
        }
      ]
    });

    const diff = computeShotPlanSemanticDiff(source, target, { currentSpecRevision: 3 });
    const beatsGroup = diff.groups.find((g) => g.group === "beats")!;
    const beat1 = beatsGroup.collections.find((e) => e.entryKey === "1")!;
    expect(beat1.status).toBe("changed");
    const startField = beat1.fields.find((f) => f.key === "beats.startMs")!;
    expect(startField.status).toBe("changed");
    expect(startField.after.display).toBe("400 (+400ms)");

    const beat2 = beatsGroup.collections.find((e) => e.entryKey === "2")!;
    expect(beat2.status).toBe("removed");

    const beat3 = beatsGroup.collections.find((e) => e.entryKey === "3")!;
    expect(beat3.status).toBe("added");

    const entryKeysInOrder = beatsGroup.collections.map((e) => e.entryKey);
    expect(entryKeysInOrder).toEqual(["1", "2", "3"]);
  });

  it("reports order-sensitive list changes for colorPalette and persistentSubjectIds", () => {
    const source = createBasePlan();
    const target = createBasePlan({
      id: PLAN_V4,
      colorPalette: ["wood", "amber"],
      continuity: {
        ...source.continuity,
        persistentSubjectIds: ["elena", "hero-bottle"]
      }
    });

    const diff = computeShotPlanSemanticDiff(source, target, { currentSpecRevision: 3 });
    const envLighting = diff.groups.find((g) => g.group === "environment_lighting")!;
    const palette = envLighting.fields.find((f) => f.key === "colorPalette")!;
    expect(palette.status).toBe("changed");

    const routing = diff.groups.find((g) => g.group === "routing_continuity")!;
    const persistent = routing.fields.find((f) => f.key === "continuity.persistentSubjectIds")!;
    expect(persistent.status).toBe("changed");
  });

  it("reports dialogue added/removed transitions", () => {
    const source = createBasePlan({ dialogue: null });
    const target = createBasePlan({ id: PLAN_V4 });

    const diff = computeShotPlanSemanticDiff(source, target, { currentSpecRevision: 3 });
    const dialogue = diff.groups.find((g) => g.group === "dialogue")!;
    const speaker = dialogue.fields.find((f) => f.key === "dialogue.speaker")!;
    expect(speaker.status).toBe("added");

    const reverseDiff = computeShotPlanSemanticDiff(target, source, { currentSpecRevision: 3 });
    const reverseDialogue = reverseDiff.groups.find((g) => g.group === "dialogue")!;
    const reverseSpeaker = reverseDialogue.fields.find((f) => f.key === "dialogue.speaker")!;
    expect(reverseSpeaker.status).toBe("removed");
  });

  it("reports routing/continuity changes", () => {
    const source = createBasePlan();
    const target = createBasePlan({
      id: PLAN_V4,
      routingMode: "frame_anchored",
      continuity: {
        ...source.continuity,
        frameAnchorTarget: "first_frame",
        anchorCandidateId: "66666666-6666-4666-8666-666666666666"
      }
    });

    const diff = computeShotPlanSemanticDiff(source, target, { currentSpecRevision: 3 });
    const routing = diff.groups.find((g) => g.group === "routing_continuity")!;
    const mode = routing.fields.find((f) => f.key === "routingMode")!;
    expect(mode.status).toBe("changed");
    const anchorTarget = routing.fields.find((f) => f.key === "continuity.frameAnchorTarget")!;
    expect(anchorTarget.status).toBe("changed");
    const anchorCandidate = routing.fields.find((f) => f.key === "continuity.anchorCandidateId")!;
    expect(anchorCandidate.status).toBe("added");
  });

  it("is deterministic across repeated invocations and key-permuted inputs", () => {
    const source = createBasePlan();
    const target = createVariationPlan();

    const diffA = computeShotPlanSemanticDiff(source, target, { currentSpecRevision: 3 });
    const diffB = computeShotPlanSemanticDiff(source, target, { currentSpecRevision: 3 });
    expect(diffA).toEqual(diffB);

    // Reconstruct target with top-level keys inserted in reverse order; the
    // diff reads fields by fixed accessor path, never by Object.keys
    // iteration, so key order must not affect the result.
    const reordered = Object.fromEntries(
      Object.entries(target).reverse()
    ) as unknown as ShotPlanDocument;
    const diffC = computeShotPlanSemanticDiff(source, reordered, { currentSpecRevision: 3 });
    expect(diffC).toEqual(diffA);
  });

  it("rejects cross-scene comparison", () => {
    const source = createBasePlan();
    const target = createBasePlan({ id: PLAN_V4, sceneId: SCENE_B });

    expect(() => computeShotPlanSemanticDiff(source, target, { currentSpecRevision: 3 })).toThrow(
      ShotPlanComparisonRejectedError
    );
    try {
      computeShotPlanSemanticDiff(source, target, { currentSpecRevision: 3 });
    } catch (err) {
      expect(err).toBeInstanceOf(ShotPlanComparisonRejectedError);
      expect((err as InstanceType<typeof ShotPlanComparisonRejectedError>).code).toBe(
        "CROSS_SCENE_COMPARISON"
      );
    }
  });

  it("rejects self-comparison", () => {
    const plan = createBasePlan();
    try {
      computeShotPlanSemanticDiff(plan, plan, { currentSpecRevision: 3 });
      expect.unreachable();
    } catch (err) {
      expect(err).toBeInstanceOf(ShotPlanComparisonRejectedError);
      expect((err as InstanceType<typeof ShotPlanComparisonRejectedError>).code).toBe(
        "SAME_SHOT_PLAN"
      );
    }
  });

  it("scopes comparison as current only when both sides are current and on the current revision", () => {
    const source = createBasePlan();
    const target = createBasePlan({ id: PLAN_V4, variantOrdinal: 4 });

    const currentDiff = computeShotPlanSemanticDiff(source, target, { currentSpecRevision: 3 });
    expect(currentDiff.comparisonScope).toBe("current");

    const staleSource = { ...source, specRevision: 2 };
    const historicalDiff = computeShotPlanSemanticDiff(staleSource, target, {
      currentSpecRevision: 3
    });
    expect(historicalDiff.comparisonScope).toBe("historical");
    expect(historicalDiff.source.specRevision).toBe(2);
  });

  it("evaluates comparability with per-side stale flags", () => {
    const source = createBasePlan();
    const target = createBasePlan({ id: PLAN_V4, specRevision: 4 });

    const comparability = evaluateShotPlanComparability(source, target, 4);
    expect(comparability.eligible).toBe(true);
    expect(comparability.scope).toBe("historical");
    expect(comparability.revisionMismatch).toBe(true);
    expect(comparability.staleSource).toBe(true);
    expect(comparability.staleTarget).toBe(false);
  });

  it("accepts ShotPlanReviewItem input and tolerates out-of-enum movementSpeed values", () => {
    const source = createBasePlan();
    const reviewTarget = {
      shotPlanId: PLAN_V4,
      sceneId: SCENE_A,
      specRevision: 3,
      variantOrdinal: 4,
      status: "draft",
      routingMode: "reference_directed",
      isCurrentRevision: true,
      targetDurationMs: 5170,
      targetFrameCount: 124,
      framing: "medium",
      angle: "eye_level",
      cameraMovement: "static",
      movementSpeed: "normal", // out-of-enum, see R1
      lensIntent: "35mm standard",
      cameraPosition: "chest height",
      cameraPromptDescription: "Locked off view",
      actionSummary: "Bartender presents the product to camera",
      lightingStyle: "practical_interior",
      environmentDescription: "Bar interior",
      colorPalette: [],
      atmosphere: null,
      subjects: [],
      beats: [],
      dialogue: null,
      continuity: { persistentSubjectIds: [], frameAnchorTarget: "none" },
      previs: null,
      boundReferences: [],
      createdAt: "2026-09-27T12:00:00.000Z",
      updatedAt: "2026-09-27T12:00:00.000Z"
    } as const;

    expect(() =>
      computeShotPlanSemanticDiff(source, reviewTarget as never, { currentSpecRevision: 3 })
    ).not.toThrow();
  });

  it("does not mutate its inputs", () => {
    const source = createBasePlan();
    const target = createVariationPlan();
    const sourceCopy = JSON.parse(JSON.stringify(source));
    const targetCopy = JSON.parse(JSON.stringify(target));

    computeShotPlanSemanticDiff(source, target, { currentSpecRevision: 3 });

    expect(source).toEqual(sourceCopy);
    expect(target).toEqual(targetCopy);
  });

  it("includes the read-only notice", () => {
    const source = createBasePlan();
    const target = createVariationPlan();
    const diff = computeShotPlanSemanticDiff(source, target, { currentSpecRevision: 3 });
    expect(diff.readOnlyNotice).toBe(SHOT_PLAN_DIFF_READ_ONLY_NOTICE);
  });
});

describe("resolveShotPlanDiffSource", () => {
  it("resolves via derivation.sourceShotPlanId", () => {
    const source = createBasePlan();
    const target = createVariationPlan();
    const lineage = resolveShotPlanDiffSource(target, [source, target]);
    expect(lineage.resolution).toBe("derivation_provenance");
    expect(lineage.sourceShotPlanId).toBe(PLAN_V2);
    expect(lineage.sourcePlan).not.toBeNull();
  });

  it("resolves via derivedFromShotPlanId only", () => {
    const source = createBasePlan();
    const target = createBasePlan({
      id: PLAN_V4,
      derivedFromShotPlanId: PLAN_V2,
      derivation: null
    });
    const lineage = resolveShotPlanDiffSource(target, [source, target]);
    expect(lineage.resolution).toBe("derived_from_id");
    expect(lineage.sourceShotPlanId).toBe(PLAN_V2);
  });

  it("reports unresolved when the candidate source is missing", () => {
    const target = createVariationPlan();
    const lineage = resolveShotPlanDiffSource(target, [target]);
    expect(lineage.resolution).toBe("unresolved");
    expect(lineage.sourcePlan).toBeNull();
  });

  it("flags lineageOrdinalMismatch while still resolving by id", () => {
    const source = createBasePlan({ variantOrdinal: 7 });
    const target = createVariationPlan();
    const lineage = resolveShotPlanDiffSource(target, [source, target]);
    expect(lineage.resolution).toBe("derivation_provenance");
    expect(lineage.lineageOrdinalMismatch).toBe(true);
  });
});

describe("summarizeShotPlanDiff", () => {
  it("returns only changed/added/removed rows in group order", () => {
    const source = createBasePlan();
    const target = createVariationPlan();
    const diff = computeShotPlanSemanticDiff(source, target, { currentSpecRevision: 3 });
    const summary = summarizeShotPlanDiff(diff);

    expect(summary.length).toBe(diff.changedFieldCount);
    for (const row of summary) {
      expect(row.status).not.toBe("unchanged");
    }
  });
});
