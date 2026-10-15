import fs from "node:fs";
import path from "node:path";
import {
  PINNED_H3_CHECKPOINTS,
  PINNED_COMFYUI_CORE_REVISION,
  computeContinuityStudyDigest,
  computeContinuityRubricDigest,
  computeContinuityReviewDigest,
  computeStoryboardPlanDigest,
  computeReviewManifestDigest,
  computeReferenceManifestDigest,
  computeInvariantProjectionKey,
  mapContinuityReviewToLegacyVisualReview,
  MinimaxH3ContinuityReviewSidecarSchema,
  MinimaxH3ContinuityStudySpecSchema,
  MinimaxH3StoryboardPlanSchema,
  MinimaxH3ReviewManifestSchema,
  type MinimaxH3ContinuityReviewSidecar,
  type MinimaxH3ContinuityStudySpec,
  type MinimaxH3StoryboardPlan,
  type MinimaxH3ReviewManifest,
  type ContinuityStudyCell,
  type ContinuityComparisonEdge,
  type ContinuityStudyArm,
  type ContinuityScenario,
  type PlannedSamplePoint,
  type StoryboardPanel,
  type MinimaxH3ExperimentDescriptorV2,
  type MinimaxH3ExperimentResultV2,
  type MinimaxH3AnyExperimentDescriptor,
  type MinimaxH3AnyExperimentResult,
  type MinimaxH3FactorChange,
  type MinimaxH3ExperimentCandidateFrames,
  sha256Hex,
  canonicalizeJson
} from "@cco/contracts";
import type {
  MinimaxH3ExperimentStorePort,
  MinimaxH3TargetPreflightPort,
  PrepareMinimaxH3ExperimentOptions
} from "../ports/minimax-h3-experiment-ports.js";
import { MinimaxH3ExperimentService } from "./minimax-h3-experiment-service.js";

// ---------------------------------------------------------------------------
// 1. Controlled Study Matrix Planning & Compilation
// ---------------------------------------------------------------------------

export interface ExpandContinuityStudyOptions {
  studyId: string;
  sourceEvidenceReferences: Array<{ url: string; assertion: string }>;
  scenarios: ContinuityScenario[];
  studyControls?: {
    width?: 1344;
    height?: 768;
    fps?: 24;
    seed?: number;
    runnerVariant?: "dynamicvram-offload-v1";
    schedule?: { sampler: "res_multistep"; scheduler: "simple"; steps: 20 };
    candidateFrames?: readonly MinimaxH3ExperimentCandidateFrames[] | (124 | 192 | 243 | 362)[];
    diffusionCheckpoint?: {
      repository: string;
      revision: string;
      filename: string;
      sha256: string;
    };
  };
  includeCheckpointArms?: boolean;
  includeReducedStepArms?: boolean;
  includeAttentionArms?: boolean;
  includeCombinedArms?: boolean;
  representativeArmBlock?: {
    scenarioId?: string;
    frames?: (124 | 192 | 243 | 362)[];
  };
}

/**
 * Validates that all long-frame (>124f) cells correctly link to a conformant
 * 124f safety baseline cell within the same scenario and variant chain, and that
 * comparison edges strictly match frame durations and scenarios.
 */
export function validateSafetyBaselineLinks(study: MinimaxH3ContinuityStudySpec): {
  valid: boolean;
  errors: string[];
} {
  const errors: string[] = [];
  const cellMap = new Map<string, ContinuityStudyCell>();
  for (const cell of study.cells) {
    cellMap.set(cell.cellId, cell);
  }

  for (const cell of study.cells) {
    if (cell.frames > 124) {
      if (!cell.safetyBaseline124fCellId) {
        errors.push(
          `Cell "${cell.cellId}" (${cell.frames}f) must define a safetyBaseline124fCellId`
        );
        continue;
      }
      const safetyCell = cellMap.get(cell.safetyBaseline124fCellId);
      if (!safetyCell) {
        errors.push(
          `Cell "${cell.cellId}" references nonexistent safetyBaseline124fCellId "${cell.safetyBaseline124fCellId}"`
        );
        continue;
      }
      if (safetyCell.frames !== 124) {
        errors.push(
          `Safety baseline cell "${safetyCell.cellId}" must have frames=124, got ${safetyCell.frames}`
        );
      }
      if (safetyCell.scenarioId !== cell.scenarioId) {
        errors.push(
          `Safety baseline cell "${safetyCell.cellId}" scenario "${safetyCell.scenarioId}" does not match cell scenario "${cell.scenarioId}"`
        );
      }
      if (safetyCell.promptVariantId !== cell.promptVariantId) {
        errors.push(
          `Safety baseline cell "${safetyCell.cellId}" promptVariantId "${safetyCell.promptVariantId}" does not match cell "${cell.promptVariantId}"`
        );
      }
      if (safetyCell.arm !== cell.arm) {
        errors.push(
          `Safety baseline cell "${safetyCell.cellId}" arm "${safetyCell.arm}" does not match cell arm "${cell.arm}"`
        );
      }
      if (safetyCell.checkpointOverride !== cell.checkpointOverride) {
        errors.push(
          `Safety baseline cell "${safetyCell.cellId}" checkpointOverride "${safetyCell.checkpointOverride ?? "default"}" does not match cell "${cell.checkpointOverride ?? "default"}"`
        );
      }
      if (safetyCell.stepOverride !== cell.stepOverride) {
        errors.push(
          `Safety baseline cell "${safetyCell.cellId}" stepOverride "${safetyCell.stepOverride ?? "default"}" does not match cell "${cell.stepOverride ?? "default"}"`
        );
      }
      if (safetyCell.attentionVariant !== cell.attentionVariant) {
        errors.push(
          `Safety baseline cell "${safetyCell.cellId}" attentionVariant "${safetyCell.attentionVariant ?? "default"}" does not match cell "${cell.attentionVariant ?? "default"}"`
        );
      }
    } else {
      if (cell.safetyBaseline124fCellId !== null) {
        errors.push(
          `124f cell "${cell.cellId}" must have safetyBaseline124fCellId=null, got "${cell.safetyBaseline124fCellId}"`
        );
      }
    }
  }

  for (const edge of study.comparisonEdges) {
    const base = cellMap.get(edge.baselineCellId);
    const cand = cellMap.get(edge.candidateCellId);
    if (base && cand) {
      if (base.frames !== cand.frames) {
        errors.push(
          `Comparison edge "${edge.edgeId}" crosses frame counts: ${base.frames}f vs ${cand.frames}f. Cross-frame comparisons are strictly prohibited.`
        );
      }
      if (base.scenarioId !== cand.scenarioId) {
        errors.push(
          `Comparison edge "${edge.edgeId}" crosses scenarios: ${base.scenarioId} vs ${cand.scenarioId}`
        );
      }
    }
  }

  return {
    valid: errors.length === 0,
    errors
  };
}

/**
 * Validates all comparison edges in a study plan: ensures identical frame durations,
 * identical scenarios, identical routes, arm correspondence, and declared factor paths.
 */
export function validateStudyComparisonEdges(study: MinimaxH3ContinuityStudySpec): {
  valid: boolean;
  errors: string[];
} {
  const errors: string[] = [];
  const cellMap = new Map<string, ContinuityStudyCell>();
  for (const cell of study.cells) {
    cellMap.set(cell.cellId, cell);
  }
  const scenarioMap = new Map<string, ContinuityScenario>();
  for (const scenario of study.scenarios) {
    scenarioMap.set(scenario.scenarioId, scenario);
  }

  for (const edge of study.comparisonEdges) {
    const base = cellMap.get(edge.baselineCellId);
    const cand = cellMap.get(edge.candidateCellId);

    if (!base) {
      errors.push(
        `Comparison edge "${edge.edgeId}" references nonexistent baselineCellId "${edge.baselineCellId}"`
      );
      continue;
    }
    if (!cand) {
      errors.push(
        `Comparison edge "${edge.edgeId}" references nonexistent candidateCellId "${edge.candidateCellId}"`
      );
      continue;
    }

    if (base.frames !== cand.frames || edge.frames !== base.frames) {
      errors.push(
        `Comparison edge "${edge.edgeId}" crosses frame counts: edge is ${edge.frames}f, baseline is ${base.frames}f, candidate is ${cand.frames}f. Cross-frame comparisons are strictly prohibited.`
      );
    }
    if (base.scenarioId !== cand.scenarioId || edge.scenarioId !== base.scenarioId) {
      errors.push(
        `Comparison edge "${edge.edgeId}" crosses scenarios: edge is "${edge.scenarioId}", baseline is "${base.scenarioId}", candidate is "${cand.scenarioId}"`
      );
    }

    const baseScen = scenarioMap.get(base.scenarioId);
    const candScen = scenarioMap.get(cand.scenarioId);
    if (baseScen && candScen && baseScen.route !== candScen.route) {
      errors.push(
        `Comparison edge "${edge.edgeId}" crosses routes: baseline is "${baseScen.route}", candidate is "${candScen.route}"`
      );
    }

    if (edge.arm !== cand.arm) {
      errors.push(
        `Comparison edge "${edge.edgeId}" arm mismatch: edge specifies arm "${edge.arm}", candidate cell specifies arm "${cand.arm}"`
      );
    }

    if (edge.arm === "prompt_only") {
      if (
        edge.declaredFactorPaths.length !== 1 ||
        edge.declaredFactorPaths[0] !== "conditioning.positivePrompt"
      ) {
        errors.push(
          `Comparison edge "${edge.edgeId}" for prompt_only arm must declare exactly ["conditioning.positivePrompt"], got [${edge.declaredFactorPaths.join(", ")}]`
        );
      }
    } else if (edge.arm === "checkpoint_only") {
      if (
        edge.declaredFactorPaths.length !== 1 ||
        edge.declaredFactorPaths[0] !== "models.diffusion"
      ) {
        errors.push(
          `Comparison edge "${edge.edgeId}" for checkpoint_only arm must declare exactly ["models.diffusion"], got [${edge.declaredFactorPaths.join(", ")}]`
        );
      }
      if (baseScen?.route === "ref2v" || candScen?.route === "ref2v") {
        errors.push(
          `Comparison edge "${edge.edgeId}" has checkpoint_only arm on ref2v route, which is prohibited`
        );
      }
    } else if (edge.arm === "reduced_step_only") {
      if (
        edge.declaredFactorPaths.length !== 1 ||
        edge.declaredFactorPaths[0] !== "sampling.settings"
      ) {
        errors.push(
          `Comparison edge "${edge.edgeId}" for reduced_step_only arm must declare exactly ["sampling.settings"], got [${edge.declaredFactorPaths.join(", ")}]`
        );
      }
    } else if (edge.arm === "attention_only") {
      if (
        edge.declaredFactorPaths.length !== 1 ||
        edge.declaredFactorPaths[0] !== "attention.configuration"
      ) {
        errors.push(
          `Comparison edge "${edge.edgeId}" for attention_only arm must declare exactly ["attention.configuration"], got [${edge.declaredFactorPaths.join(", ")}]`
        );
      }
    } else if (edge.arm === "combined") {
      if (edge.declaredFactorPaths.length < 2) {
        errors.push(
          `Comparison edge "${edge.edgeId}" for combined arm must declare at least 2 factor paths, got [${edge.declaredFactorPaths.join(", ")}]`
        );
      }
      if (!edge.independentReviewPrerequisites) {
        errors.push(
          `Comparison edge "${edge.edgeId}" for combined arm must declare independentReviewPrerequisites`
        );
      }
    }
  }

  return {
    valid: errors.length === 0,
    errors
  };
}

/**
 * Validates that a 124f safety baseline descriptor and a long-shot (>124f) descriptor
 * share identical prompt, seed, baseProfileKey, runner variant, memory policy, checkpoint,
 * schedule, attention, runtime core revision, and references.
 */
export function validateSafetyChainDescriptor(
  safetyBaselineDesc: MinimaxH3ExperimentDescriptorV2,
  longShotDesc: MinimaxH3ExperimentDescriptorV2
): { valid: boolean; errors: string[] } {
  const errors: string[] = [];

  if (safetyBaselineDesc.configuredFrames !== 124) {
    errors.push(
      `Safety baseline descriptor must have configuredFrames=124, got ${safetyBaselineDesc.configuredFrames}`
    );
  }
  if (longShotDesc.configuredFrames <= 124) {
    errors.push(
      `Long-shot descriptor must have configuredFrames > 124, got ${longShotDesc.configuredFrames}`
    );
  }
  if (safetyBaselineDesc.route !== longShotDesc.route) {
    errors.push(
      `Safety chain route mismatch: safety baseline is "${safetyBaselineDesc.route}", long-shot is "${longShotDesc.route}"`
    );
  }
  if (safetyBaselineDesc.prompt !== longShotDesc.prompt) {
    errors.push(
      "Safety chain prompt mismatch between 124f safety baseline and long-shot descriptor"
    );
  }
  if (safetyBaselineDesc.promptDigest !== longShotDesc.promptDigest) {
    errors.push(
      "Safety chain promptDigest mismatch between 124f safety baseline and long-shot descriptor"
    );
  }
  if (safetyBaselineDesc.seed !== longShotDesc.seed) {
    errors.push(
      `Safety chain seed mismatch: safety baseline is ${safetyBaselineDesc.seed}, long-shot is ${longShotDesc.seed}`
    );
  }
  if (safetyBaselineDesc.baseProfileKey !== longShotDesc.baseProfileKey) {
    errors.push(
      `Safety chain base profile mismatch: safety baseline is "${safetyBaselineDesc.baseProfileKey}", long-shot is "${longShotDesc.baseProfileKey}"`
    );
  }
  if (
    safetyBaselineDesc.requestedRunner?.variantName !== longShotDesc.requestedRunner?.variantName
  ) {
    errors.push(
      `Safety chain runner variant mismatch: safety baseline is "${safetyBaselineDesc.requestedRunner?.variantName}", long-shot is "${longShotDesc.requestedRunner?.variantName}"`
    );
  }
  if (
    safetyBaselineDesc.requestedRunner?.memoryPolicy !== longShotDesc.requestedRunner?.memoryPolicy
  ) {
    errors.push(
      `Safety chain memory policy mismatch: safety baseline is "${safetyBaselineDesc.requestedRunner?.memoryPolicy}", long-shot is "${longShotDesc.requestedRunner?.memoryPolicy}"`
    );
  }
  if (safetyBaselineDesc.checkpointOverride !== longShotDesc.checkpointOverride) {
    errors.push(
      `Safety chain checkpointOverride mismatch: safety baseline is "${safetyBaselineDesc.checkpointOverride ?? "default"}", long-shot is "${longShotDesc.checkpointOverride ?? "default"}"`
    );
  }
  if (safetyBaselineDesc.stepOverride !== longShotDesc.stepOverride) {
    errors.push(
      `Safety chain stepOverride mismatch: safety baseline is ${safetyBaselineDesc.stepOverride ?? 20}, long-shot is ${longShotDesc.stepOverride ?? 20}`
    );
  }
  if (
    safetyBaselineDesc.attentionRequest?.attentionVariant !==
    longShotDesc.attentionRequest?.attentionVariant
  ) {
    errors.push(
      `Safety chain attentionVariant mismatch: safety baseline is "${safetyBaselineDesc.attentionRequest?.attentionVariant ?? "default"}", long-shot is "${longShotDesc.attentionRequest?.attentionVariant ?? "default"}"`
    );
  }
  const sCore =
    safetyBaselineDesc.requiredRuntime?.coreRevision ??
    safetyBaselineDesc.provenance?.comfyuiCoreRevision;
  const lCore =
    longShotDesc.requiredRuntime?.coreRevision ?? longShotDesc.provenance?.comfyuiCoreRevision;
  if (sCore && lCore && sCore !== lCore) {
    errors.push(
      `Safety chain core revision mismatch: safety baseline is "${sCore}", long-shot is "${lCore}"`
    );
  }

  // Check references match
  if (safetyBaselineDesc.references.length !== longShotDesc.references.length) {
    errors.push(
      `Safety chain reference count mismatch: safety baseline has ${safetyBaselineDesc.references.length}, long-shot has ${longShotDesc.references.length}`
    );
  } else {
    for (let i = 0; i < safetyBaselineDesc.references.length; i++) {
      const sRef = safetyBaselineDesc.references[i]!;
      const lRef = longShotDesc.references[i]!;
      if (sRef.sha256 !== lRef.sha256) {
        errors.push(
          `Safety chain reference slot ${i} SHA mismatch: safety baseline is ${sRef.sha256}, long-shot is ${lRef.sha256}`
        );
      }
    }
  }

  return {
    valid: errors.length === 0,
    errors
  };
}

/**
 * Deterministically compiles a continuity study specification from scenario definitions
 * across candidate frames [124, 192, 243, 362], pinning comparison edges and 124f safety baseline links.
 */
export function expandContinuityStudyPlan(
  options: ExpandContinuityStudyOptions
): MinimaxH3ContinuityStudySpec {
  const {
    studyId,
    sourceEvidenceReferences,
    scenarios,
    studyControls = {},
    includeCheckpointArms = false,
    includeReducedStepArms = false,
    includeAttentionArms = false,
    includeCombinedArms = false,
    representativeArmBlock
  } = options;

  const candidateFrames = (studyControls.candidateFrames ?? [124, 192, 243, 362]) as [
    124,
    192,
    243,
    362
  ];
  const seed = studyControls.seed ?? 42;
  const runnerVariant = studyControls.runnerVariant ?? "dynamicvram-offload-v1";
  const schedule = studyControls.schedule ?? {
    sampler: "res_multistep" as const,
    scheduler: "simple" as const,
    steps: 20 as const
  };

  const diffusionCheckpoint = studyControls.diffusionCheckpoint ?? {
    repository: "Comfy-Org/MiniMax-H3",
    revision: "7e75982b97cd5a41d2dcfa1904ee88d0686d6fd1",
    filename: PINNED_H3_CHECKPOINTS.ref2va.filename,
    sha256: PINNED_H3_CHECKPOINTS.ref2va.sha256
  };

  const cells: ContinuityStudyCell[] = [];
  const comparisonEdges: ContinuityComparisonEdge[] = [];

  const repScenarioId =
    representativeArmBlock?.scenarioId ??
    scenarios.find(
      (s) => s.scenarioRole === "historical_baseline" || s.subjectMotionIntent === "moving"
    )?.scenarioId ??
    scenarios[0]?.scenarioId;
  const repFrames = representativeArmBlock?.frames ?? [124, 243];

  for (const scenario of scenarios) {
    const isScenarioPending = scenario.status === "pending_source";
    const origPromptText = scenario.originalPrompt?.text ?? null;
    const origPromptDigest = scenario.originalPrompt?.digest ?? null;

    // Check if this scenario is eligible for optional arms (representative block only)
    const isScenarioEligibleForArms = scenario.scenarioId === repScenarioId;

    for (const frames of candidateFrames) {
      const isFrameEligibleForArms = repFrames.includes(frames);
      const isArmEligible = isScenarioEligibleForArms && isFrameEligibleForArms;

      // 1. Mandatory Baseline Cell
      const baselineCellId = `cell-${scenario.scenarioId}-${frames}f-base`;
      const safetyBaseline124fCellId =
        frames > 124 ? `cell-${scenario.scenarioId}-124f-base` : null;

      cells.push({
        cellId: baselineCellId,
        scenarioId: scenario.scenarioId,
        frames,
        arm: "baseline",
        promptVariantId: "original",
        prompt: origPromptText,
        promptDigest: origPromptDigest,
        status: isScenarioPending ? "pending_source" : "resolved",
        pendingReason: isScenarioPending
          ? (scenario.pendingReason ?? "Awaiting historical original prompt evidence")
          : null,
        safetyBaseline124fCellId
      });

      // 2. Mandatory Prompt-Constrained Cells
      for (const cp of scenario.constrainedPrompts) {
        const promptCellId = `cell-${scenario.scenarioId}-${frames}f-${cp.promptId}`;
        const safetyBaseline124fPromptCellId =
          frames > 124 ? `cell-${scenario.scenarioId}-124f-${cp.promptId}` : null;

        cells.push({
          cellId: promptCellId,
          scenarioId: scenario.scenarioId,
          frames,
          arm: "prompt_only",
          promptVariantId: cp.promptId,
          prompt: isScenarioPending ? null : cp.text,
          promptDigest: isScenarioPending ? null : cp.digest,
          status: isScenarioPending ? "pending_source" : "resolved",
          pendingReason: isScenarioPending
            ? (scenario.pendingReason ?? "Awaiting historical original prompt evidence")
            : null,
          safetyBaseline124fCellId: safetyBaseline124fPromptCellId
        });

        // Add matching-frame comparison edge
        comparisonEdges.push({
          edgeId: `cmp-${scenario.scenarioId}-${frames}f-prompt-${cp.promptId}`,
          frames,
          scenarioId: scenario.scenarioId,
          arm: "prompt_only",
          baselineCellId,
          candidateCellId: promptCellId,
          declaredFactorPaths: ["conditioning.positivePrompt"],
          status: isScenarioPending ? "pending_source" : "resolved",
          pendingReason: isScenarioPending ? "Baseline or candidate prompt source pending" : null
        });
      }

      // 3. Optional Isolated Checkpoint-only Arm (FL2VA vs Ref2VA on representative block)
      if (includeCheckpointArms && isArmEligible && scenario.route === "i2v") {
        const ckptCellId = `cell-${scenario.scenarioId}-${frames}f-fl2va`;
        cells.push({
          cellId: ckptCellId,
          scenarioId: scenario.scenarioId,
          frames,
          arm: "checkpoint_only",
          promptVariantId: "original",
          prompt: origPromptText,
          promptDigest: origPromptDigest,
          checkpointOverride: "fl2va",
          status: isScenarioPending ? "pending_source" : "resolved",
          pendingReason: isScenarioPending
            ? (scenario.pendingReason ?? "Awaiting original prompt evidence")
            : null,
          safetyBaseline124fCellId: frames > 124 ? `cell-${scenario.scenarioId}-124f-fl2va` : null
        });

        comparisonEdges.push({
          edgeId: `cmp-${scenario.scenarioId}-${frames}f-ckpt-fl2va`,
          frames,
          scenarioId: scenario.scenarioId,
          arm: "checkpoint_only",
          baselineCellId,
          candidateCellId: ckptCellId,
          declaredFactorPaths: ["models.diffusion"],
          status: isScenarioPending ? "pending_source" : "resolved",
          pendingReason: isScenarioPending ? "Baseline source pending" : null
        });
      }

      // 4. Optional Isolated Reduced-Step Arm (20 to 10 steps on representative block)
      if (includeReducedStepArms && isArmEligible) {
        const stepCellId = `cell-${scenario.scenarioId}-${frames}f-step10`;
        cells.push({
          cellId: stepCellId,
          scenarioId: scenario.scenarioId,
          frames,
          arm: "reduced_step_only",
          promptVariantId: "original",
          prompt: origPromptText,
          promptDigest: origPromptDigest,
          stepOverride: 10,
          status: isScenarioPending ? "pending_source" : "resolved",
          pendingReason: isScenarioPending
            ? (scenario.pendingReason ?? "Awaiting original prompt evidence")
            : null,
          safetyBaseline124fCellId: frames > 124 ? `cell-${scenario.scenarioId}-124f-step10` : null
        });

        comparisonEdges.push({
          edgeId: `cmp-${scenario.scenarioId}-${frames}f-step10`,
          frames,
          scenarioId: scenario.scenarioId,
          arm: "reduced_step_only",
          baselineCellId,
          candidateCellId: stepCellId,
          declaredFactorPaths: ["sampling.settings"],
          status: isScenarioPending ? "pending_source" : "resolved",
          pendingReason: isScenarioPending ? "Baseline source pending" : null
        });
      }

      // 5. Optional Isolated Attention Arm (native-sol-attn vs matched dense on representative block)
      if (includeAttentionArms && isArmEligible) {
        const denseControlCellId = `cell-${scenario.scenarioId}-${frames}f-dense-control`;
        cells.push({
          cellId: denseControlCellId,
          scenarioId: scenario.scenarioId,
          frames,
          arm: "baseline",
          promptVariantId: "original",
          prompt: origPromptText,
          promptDigest: origPromptDigest,
          attentionVariant: "dense",
          matchedVariant: "native-sol-attn",
          status: isScenarioPending ? "pending_source" : "resolved",
          pendingReason: isScenarioPending
            ? (scenario.pendingReason ?? "Awaiting original prompt evidence")
            : null,
          safetyBaseline124fCellId:
            frames > 124 ? `cell-${scenario.scenarioId}-124f-dense-control` : null
        });

        const attnCellId = `cell-${scenario.scenarioId}-${frames}f-solattn`;
        cells.push({
          cellId: attnCellId,
          scenarioId: scenario.scenarioId,
          frames,
          arm: "attention_only",
          promptVariantId: "original",
          prompt: origPromptText,
          promptDigest: origPromptDigest,
          attentionVariant: "native-sol-attn",
          matchedVariant: "native-sol-attn",
          status: isScenarioPending ? "pending_source" : "resolved",
          pendingReason: isScenarioPending
            ? (scenario.pendingReason ?? "Awaiting original prompt evidence")
            : null,
          safetyBaseline124fCellId: frames > 124 ? `cell-${scenario.scenarioId}-124f-solattn` : null
        });

        comparisonEdges.push({
          edgeId: `cmp-${scenario.scenarioId}-${frames}f-attn`,
          frames,
          scenarioId: scenario.scenarioId,
          arm: "attention_only",
          baselineCellId: denseControlCellId,
          candidateCellId: attnCellId,
          declaredFactorPaths: ["attention.configuration"],
          status: isScenarioPending ? "pending_source" : "resolved",
          pendingReason: isScenarioPending ? "Baseline source pending" : null
        });
      }

      // 6. Optional Combined Arm (explicitly multifactor, pending independent human reviews)
      if (includeCombinedArms && isArmEligible) {
        const step10CellId = `cell-${scenario.scenarioId}-${frames}f-step10`;
        if (!cells.some((c) => c.cellId === step10CellId)) {
          cells.push({
            cellId: step10CellId,
            scenarioId: scenario.scenarioId,
            frames,
            arm: "reduced_step_only",
            promptVariantId: "original",
            prompt: origPromptText,
            promptDigest: origPromptDigest,
            stepOverride: 10,
            status: isScenarioPending ? "pending_source" : "resolved",
            pendingReason: isScenarioPending
              ? (scenario.pendingReason ?? "Awaiting original prompt evidence")
              : null,
            safetyBaseline124fCellId:
              frames > 124 ? `cell-${scenario.scenarioId}-124f-step10` : null
          });
        }

        const combinedCellId = `cell-${scenario.scenarioId}-${frames}f-combined`;
        cells.push({
          cellId: combinedCellId,
          scenarioId: scenario.scenarioId,
          frames,
          arm: "combined",
          promptVariantId: scenario.constrainedPrompts[0]?.promptId ?? "tight-v1",
          prompt: null,
          promptDigest: null,
          stepOverride: 10,
          status: "pending_source",
          pendingReason:
            "Awaiting completed independent human reviews and explicit operator disposition of single-variable arms",
          safetyBaseline124fCellId:
            frames > 124 ? `cell-${scenario.scenarioId}-124f-combined` : null,
          prerequisiteCellIds: [
            baselineCellId,
            `cell-${scenario.scenarioId}-${frames}f-${scenario.constrainedPrompts[0]?.promptId ?? "tight-v1"}`,
            step10CellId
          ]
        });

        comparisonEdges.push({
          edgeId: `cmp-${scenario.scenarioId}-${frames}f-combined`,
          frames,
          scenarioId: scenario.scenarioId,
          arm: "combined",
          baselineCellId,
          candidateCellId: combinedCellId,
          declaredFactorPaths: ["conditioning.positivePrompt", "sampling.settings"],
          status: "pending_source",
          pendingReason:
            "Combined comparison blocked: requires independent single-variable human evaluations",
          independentReviewPrerequisites: {
            baselineCellId,
            candidateCellId: combinedCellId,
            requiredForPreparation: true
          }
        });
      }
    }
  }

  const specDraft = {
    schemaVersion: 1 as const,
    studyId,
    rubricVersion: 1 as const,
    rubricDigest: computeContinuityRubricDigest(),
    sourceEvidenceReferences,
    scenarios,
    studyControls: {
      width: 1344 as const,
      height: 768 as const,
      fps: 24 as const,
      seed,
      runnerVariant,
      schedule,
      candidateFrames,
      diffusionCheckpoint
    },
    cells,
    comparisonEdges
  };

  const studyDigest = computeContinuityStudyDigest(specDraft);
  const spec: MinimaxH3ContinuityStudySpec = {
    ...specDraft,
    studyDigest
  };

  const parsed = MinimaxH3ContinuityStudySpecSchema.parse(spec);
  const safetyCheck = validateSafetyBaselineLinks(parsed);
  if (!safetyCheck.valid) {
    throw new Error(`Safety baseline link validation failed:\n${safetyCheck.errors.join("\n")}`);
  }

  return parsed;
}

// ---------------------------------------------------------------------------
// 2. Offline Descriptor-Only Pair Admission
// ---------------------------------------------------------------------------

export interface AdmitContinuityPairResult {
  admitted: boolean;
  reasons: string[];
  declaredPaths: string[];
  operationalDifferences: Array<{
    field: string;
    baselineValue: string;
    variantValue: string;
  }>;
}

/**
 * Validates whether two descriptors form a conformant, controlled single-variable
 * (or explicitly declared multifactor) comparison pair without requiring execution.
 */
export function admitContinuityPair(
  baselineDesc: MinimaxH3ExperimentDescriptorV2,
  variantDesc: MinimaxH3ExperimentDescriptorV2,
  expectedArm?: ContinuityStudyArm
): AdmitContinuityPairResult {
  const reasons: string[] = [];
  const operationalDifferences: Array<{
    field: string;
    baselineValue: string;
    variantValue: string;
  }> = [];

  const declaredFactors = variantDesc.experimentVariant?.changedFactors ?? [];
  const declaredPaths = declaredFactors.map((f) => f.path);

  // 1. Strict invariant control checks
  if (baselineDesc.route !== variantDesc.route) {
    reasons.push(
      `Route mismatch: baseline is "${baselineDesc.route}", variant is "${variantDesc.route}"`
    );
    operationalDifferences.push({
      field: "route",
      baselineValue: baselineDesc.route,
      variantValue: variantDesc.route
    });
  }

  if (baselineDesc.configuredFrames !== variantDesc.configuredFrames) {
    reasons.push(
      `Frame count mismatch: baseline is ${baselineDesc.configuredFrames}, variant is ${variantDesc.configuredFrames}. Cross-frame comparison is strictly prohibited.`
    );
    operationalDifferences.push({
      field: "configuredFrames",
      baselineValue: String(baselineDesc.configuredFrames),
      variantValue: String(variantDesc.configuredFrames)
    });
  }

  if (baselineDesc.width !== variantDesc.width || baselineDesc.height !== variantDesc.height) {
    reasons.push(
      `Geometry mismatch: baseline is ${baselineDesc.width}x${baselineDesc.height}, variant is ${variantDesc.width}x${variantDesc.height}`
    );
    operationalDifferences.push({
      field: "geometry",
      baselineValue: `${baselineDesc.width}x${baselineDesc.height}`,
      variantValue: `${variantDesc.width}x${variantDesc.height}`
    });
  }

  if (baselineDesc.fps !== variantDesc.fps) {
    reasons.push(`FPS mismatch: baseline is ${baselineDesc.fps}, variant is ${variantDesc.fps}`);
    operationalDifferences.push({
      field: "fps",
      baselineValue: String(baselineDesc.fps),
      variantValue: String(variantDesc.fps)
    });
  }

  if (baselineDesc.seed !== variantDesc.seed) {
    reasons.push(`Seed mismatch: baseline is ${baselineDesc.seed}, variant is ${variantDesc.seed}`);
    operationalDifferences.push({
      field: "seed",
      baselineValue: String(baselineDesc.seed),
      variantValue: String(variantDesc.seed)
    });
  }

  if (baselineDesc.baseProfileKey !== variantDesc.baseProfileKey) {
    reasons.push(
      `Base profile mismatch: baseline is "${baselineDesc.baseProfileKey}", variant is "${variantDesc.baseProfileKey}"`
    );
  }

  if (baselineDesc.requestedRunner?.variantName !== variantDesc.requestedRunner?.variantName) {
    reasons.push(
      `Runner variant mismatch: baseline is "${baselineDesc.requestedRunner?.variantName}", variant is "${variantDesc.requestedRunner?.variantName}"`
    );
    operationalDifferences.push({
      field: "requestedRunner.variantName",
      baselineValue: baselineDesc.requestedRunner?.variantName ?? "none",
      variantValue: variantDesc.requestedRunner?.variantName ?? "none"
    });
  }

  if (baselineDesc.requestedRunner?.memoryPolicy !== variantDesc.requestedRunner?.memoryPolicy) {
    reasons.push(
      `Memory policy mismatch: baseline is "${baselineDesc.requestedRunner?.memoryPolicy}", variant is "${variantDesc.requestedRunner?.memoryPolicy}"`
    );
  }

  // Reference assets invariant check
  if (!declaredPaths.includes("conditioning.bindings")) {
    if (baselineDesc.references.length !== variantDesc.references.length) {
      reasons.push(
        `Reference count mismatch: baseline has ${baselineDesc.references.length}, variant has ${variantDesc.references.length}`
      );
    } else {
      for (let i = 0; i < baselineDesc.references.length; i++) {
        const bRef = baselineDesc.references[i];
        const vRef = variantDesc.references[i];
        if (!bRef || !vRef) continue;
        if (bRef.role !== vRef.role || bRef.order !== vRef.order || bRef.tag !== vRef.tag) {
          reasons.push(`Reference slot ${i} mismatch (role/order/tag differs)`);
        }
        if (!bRef.sha256 || !vRef.sha256) {
          reasons.push(`Reference slot ${i} has empty or missing sha256`);
        } else if (bRef.sha256 !== vRef.sha256) {
          reasons.push(
            `Reference slot ${i} sha256 mismatch: baseline is ${bRef.sha256}, variant is ${vRef.sha256}`
          );
        }
      }
    }
  }

  // Sampler settings invariant check
  if (!declaredPaths.includes("sampling.settings")) {
    const bSampler =
      baselineDesc.samplingRecipe?.sampler ??
      baselineDesc.provenance?.samplerSettings?.sampler ??
      "res_multistep";
    const vSampler =
      variantDesc.samplingRecipe?.sampler ??
      variantDesc.provenance?.samplerSettings?.sampler ??
      "res_multistep";
    if (bSampler !== vSampler) {
      reasons.push(`Sampler mismatch: baseline is "${bSampler}", variant is "${vSampler}"`);
    }
    const bScheduler =
      baselineDesc.samplingRecipe?.scheduler ??
      baselineDesc.provenance?.samplerSettings?.scheduler ??
      "simple";
    const vScheduler =
      variantDesc.samplingRecipe?.scheduler ??
      variantDesc.provenance?.samplerSettings?.scheduler ??
      "simple";
    if (bScheduler !== vScheduler) {
      reasons.push(`Scheduler mismatch: baseline is "${bScheduler}", variant is "${vScheduler}"`);
    }
    const bDenoise = baselineDesc.samplingRecipe?.denoise ?? 1.0;
    const vDenoise = variantDesc.samplingRecipe?.denoise ?? 1.0;
    if (bDenoise !== vDenoise) {
      reasons.push(`Denoise mismatch: baseline is ${bDenoise}, variant is ${vDenoise}`);
    }
  }

  // Runtime identity check
  if (!declaredPaths.includes("runtime.manifest")) {
    const bCore =
      baselineDesc.requiredRuntime?.coreRevision ?? baselineDesc.provenance?.comfyuiCoreRevision;
    const vCore =
      variantDesc.requiredRuntime?.coreRevision ?? variantDesc.provenance?.comfyuiCoreRevision;
    if (bCore && vCore && bCore !== vCore) {
      reasons.push(`Core revision mismatch: baseline is "${bCore}", variant is "${vCore}"`);
    }
    const bRuntimeDigest =
      baselineDesc.compatibility?.relativeToRuntimeManifestDigest ??
      baselineDesc.provenanceManifestDigest;
    const vRuntimeDigest =
      variantDesc.compatibility?.relativeToRuntimeManifestDigest ??
      variantDesc.provenanceManifestDigest;
    if (bRuntimeDigest && vRuntimeDigest && bRuntimeDigest !== vRuntimeDigest) {
      reasons.push(
        `Runtime manifest digest mismatch: baseline is "${bRuntimeDigest}", variant is "${vRuntimeDigest}"`
      );
    }
  }

  // Auxiliary models check
  if (!declaredPaths.includes("models.auxiliary")) {
    const bLora = baselineDesc.samplingRecipe?.lora;
    const vLora = variantDesc.samplingRecipe?.lora;
    const bAux = bLora ? `${bLora.filename}:${bLora.sha256}:${bLora.strengthModel}` : "";
    const vAux = vLora ? `${vLora.filename}:${vLora.sha256}:${vLora.strengthModel}` : "";
    if (bAux !== vAux) {
      reasons.push(`Auxiliary models mismatch: baseline has "${bAux}", variant has "${vAux}"`);
    }
  }

  // Sigma shift check
  if (!declaredPaths.includes("sampling.sigmaShift")) {
    const bShift = JSON.stringify(baselineDesc.samplingRecipe?.sigmaShift ?? null);
    const vShift = JSON.stringify(variantDesc.samplingRecipe?.sigmaShift ?? null);
    if (bShift !== vShift) {
      reasons.push(`Sigma shift mismatch: baseline is ${bShift}, variant is ${vShift}`);
    }
  }

  // Workflow graph digests check
  if (baselineDesc.baseCanonicalWorkflowDigest && variantDesc.baseCanonicalWorkflowDigest) {
    if (baselineDesc.baseCanonicalWorkflowDigest !== variantDesc.baseCanonicalWorkflowDigest) {
      reasons.push(
        `Base canonical workflow digest mismatch: baseline is "${baselineDesc.baseCanonicalWorkflowDigest}", variant is "${variantDesc.baseCanonicalWorkflowDigest}"`
      );
    }
  }
  if (
    declaredPaths.length === 0 &&
    baselineDesc.derivedWorkflowDigest &&
    variantDesc.derivedWorkflowDigest
  ) {
    if (baselineDesc.derivedWorkflowDigest !== variantDesc.derivedWorkflowDigest) {
      reasons.push(
        `Derived workflow digest mismatch in baseline pair: baseline is "${baselineDesc.derivedWorkflowDigest}", variant is "${variantDesc.derivedWorkflowDigest}"`
      );
    }
  }

  // Invariant projection keys check
  const baselineAuxiliary = baselineDesc.samplingRecipe?.lora
    ? [
        {
          name: baselineDesc.samplingRecipe.lora.filename,
          hash: baselineDesc.samplingRecipe.lora.sha256,
          strength: baselineDesc.samplingRecipe.lora.strengthModel,
          role: "lora",
          order: 0
        }
      ]
    : undefined;
  const baselineSigmaShift = baselineDesc.samplingRecipe?.sigmaShift ?? undefined;
  const baselineAttentionDigest =
    baselineDesc.attentionRequest?.topologyDigest ??
    baselineDesc.samplingRecipe?.attentionTopology?.topologyDigest;

  const baselineRuntimeManifestDigest =
    baselineDesc.compatibility?.relativeToRuntimeManifestDigest ??
    (variantDesc.requiredRuntime?.coreRevision === PINNED_COMFYUI_CORE_REVISION ||
    variantDesc.provenance?.comfyuiCoreRevision === PINNED_COMFYUI_CORE_REVISION
      ? variantDesc.compatibility?.relativeToRuntimeManifestDigest
      : undefined);

  const baselineKey = computeInvariantProjectionKey({
    route: baselineDesc.route,
    frames: baselineDesc.configuredFrames,
    width: baselineDesc.width,
    height: baselineDesc.height,
    fps: baselineDesc.fps,
    seed: baselineDesc.seed,
    baseProfileKey: baselineDesc.baseProfileKey,
    declaredPaths,
    positivePromptText: baselineDesc.prompt,
    references: baselineDesc.references.map((r, idx) => ({
      slotIndex: r.order ?? idx,
      role: r.role,
      sha256: r.sha256 ?? ""
    })),
    diffusionModelFileHash:
      baselineDesc.provenance?.actualCheckpointHash ??
      (baselineDesc.checkpointOverride === "fl2va"
        ? PINNED_H3_CHECKPOINTS.fl2va.sha256
        : PINNED_H3_CHECKPOINTS.ref2va.sha256),
    samplerSettings: baselineDesc.provenance?.samplerSettings ?? {
      sampler: "res_multistep",
      scheduler: "simple",
      steps: baselineDesc.stepOverride ?? 20
    },
    memoryPolicy: baselineDesc.requestedRunner?.memoryPolicy ?? "high",
    ...(baselineAuxiliary ? { auxiliaryModels: baselineAuxiliary } : {}),
    ...(baselineSigmaShift ? { sigmaShift: baselineSigmaShift } : {}),
    ...(baselineAttentionDigest ? { attentionTopologyDigest: baselineAttentionDigest } : {}),
    ...(baselineRuntimeManifestDigest
      ? { runtimeManifestDigest: baselineRuntimeManifestDigest }
      : {}),
    coreRevision:
      baselineDesc.provenance?.comfyuiCoreRevision ??
      baselineDesc.requiredRuntime?.coreRevision ??
      PINNED_COMFYUI_CORE_REVISION
  });

  const variantAuxiliary = variantDesc.samplingRecipe?.lora
    ? [
        {
          name: variantDesc.samplingRecipe.lora.filename,
          hash: variantDesc.samplingRecipe.lora.sha256,
          strength: variantDesc.samplingRecipe.lora.strengthModel,
          role: "lora",
          order: 0
        }
      ]
    : undefined;
  const variantSigmaShift = variantDesc.samplingRecipe?.sigmaShift ?? undefined;
  const variantAttentionDigest =
    variantDesc.attentionRequest?.topologyDigest ??
    variantDesc.samplingRecipe?.attentionTopology?.topologyDigest;

  const variantRuntimeManifestDigest =
    variantDesc.compatibility?.relativeToRuntimeManifestDigest ??
    (baselineDesc.requiredRuntime?.coreRevision === PINNED_COMFYUI_CORE_REVISION ||
    baselineDesc.provenance?.comfyuiCoreRevision === PINNED_COMFYUI_CORE_REVISION
      ? baselineDesc.compatibility?.relativeToRuntimeManifestDigest
      : undefined);

  const variantKey = computeInvariantProjectionKey({
    route: variantDesc.route,
    frames: variantDesc.configuredFrames,
    width: variantDesc.width,
    height: variantDesc.height,
    fps: variantDesc.fps,
    seed: variantDesc.seed,
    baseProfileKey: variantDesc.baseProfileKey,
    declaredPaths,
    positivePromptText: variantDesc.prompt,
    references: variantDesc.references.map((r, idx) => ({
      slotIndex: r.order ?? idx,
      role: r.role,
      sha256: r.sha256 ?? ""
    })),
    diffusionModelFileHash:
      variantDesc.provenance?.actualCheckpointHash ??
      (variantDesc.checkpointOverride === "fl2va"
        ? PINNED_H3_CHECKPOINTS.fl2va.sha256
        : PINNED_H3_CHECKPOINTS.ref2va.sha256),
    samplerSettings: variantDesc.provenance?.samplerSettings ?? {
      sampler: "res_multistep",
      scheduler: "simple",
      steps: variantDesc.stepOverride ?? 20
    },
    memoryPolicy: variantDesc.requestedRunner?.memoryPolicy ?? "high",
    ...(variantAuxiliary ? { auxiliaryModels: variantAuxiliary } : {}),
    ...(variantSigmaShift ? { sigmaShift: variantSigmaShift } : {}),
    ...(variantAttentionDigest ? { attentionTopologyDigest: variantAttentionDigest } : {}),
    ...(variantRuntimeManifestDigest
      ? { runtimeManifestDigest: variantRuntimeManifestDigest }
      : {}),
    coreRevision:
      variantDesc.provenance?.comfyuiCoreRevision ??
      variantDesc.requiredRuntime?.coreRevision ??
      PINNED_COMFYUI_CORE_REVISION
  });

  if (baselineKey !== variantKey) {
    reasons.push(
      "Invariant projection keys do not match across baseline and variant; undeclared factor variation detected."
    );
  }

  // 2. Arm-specific single-variable controls
  const arm =
    expectedArm ??
    (declaredPaths.includes("conditioning.positivePrompt") && declaredPaths.length === 1
      ? "prompt_only"
      : declaredPaths.includes("models.diffusion") && declaredPaths.length === 1
        ? "checkpoint_only"
        : declaredPaths.includes("sampling.settings") && declaredPaths.length === 1
          ? "reduced_step_only"
          : declaredPaths.includes("attention.configuration") && declaredPaths.length === 1
            ? "attention_only"
            : declaredPaths.length > 1
              ? "combined"
              : "baseline");

  if (arm !== "prompt_only" && arm !== "combined") {
    if (baselineDesc.prompt !== variantDesc.prompt) {
      reasons.push(`Prompt differs in ${arm} arm; confounding factor`);
    }
    if (baselineDesc.promptDigest !== variantDesc.promptDigest) {
      reasons.push(`Prompt digest differs in ${arm} arm; confounding factor`);
    }
  }

  if (arm === "prompt_only") {
    if (variantDesc.experimentVariant?.purpose !== "prompt_conditioning") {
      reasons.push(
        `Arm 'prompt_only' requires purpose 'prompt_conditioning', got '${variantDesc.experimentVariant?.purpose}'`
      );
    }
    if (declaredPaths.length !== 1 || declaredPaths[0] !== "conditioning.positivePrompt") {
      reasons.push(
        `Arm 'prompt_only' requires exactly 1 declared factor 'conditioning.positivePrompt', got [${declaredPaths.join(", ")}]`
      );
    }

    // Verify prompt actually changed
    if (baselineDesc.prompt === variantDesc.prompt) {
      reasons.push("Prompt is identical between baseline and candidate; no-op factor change");
    }

    // Verify before/after match descriptors
    const promptFactor = declaredFactors.find((f) => f.path === "conditioning.positivePrompt");
    if (!promptFactor || !("before" in promptFactor) || !("after" in promptFactor)) {
      reasons.push(
        "Arm 'prompt_only' missing before/after in FactorChange for conditioning.positivePrompt"
      );
    } else {
      if (promptFactor.before.digest !== baselineDesc.promptDigest) {
        reasons.push(
          `FactorChange 'before' digest '${promptFactor.before.digest}' does not match baseline promptDigest '${baselineDesc.promptDigest}'`
        );
      }
      if (promptFactor.after.digest !== variantDesc.promptDigest) {
        reasons.push(
          `FactorChange 'after' digest '${promptFactor.after.digest}' does not match variant promptDigest '${variantDesc.promptDigest}'`
        );
      }
      if (!("text" in promptFactor.before) || promptFactor.before.text !== baselineDesc.prompt) {
        reasons.push("FactorChange 'before' text does not match baseline prompt text");
      }
      if (!("text" in promptFactor.after) || promptFactor.after.text !== variantDesc.prompt) {
        reasons.push("FactorChange 'after' text does not match variant prompt text");
      }
      if (promptFactor.before.text === promptFactor.after.text) {
        reasons.push(
          "FactorChange before and after text are identical; no-op prompt factor change"
        );
      }
    }

    // All other controls must be strictly equal
    const bHash =
      baselineDesc.provenance?.actualCheckpointHash ??
      (baselineDesc.checkpointOverride === "fl2va"
        ? PINNED_H3_CHECKPOINTS.fl2va.sha256
        : PINNED_H3_CHECKPOINTS.ref2va.sha256);
    const vHash =
      variantDesc.provenance?.actualCheckpointHash ??
      (variantDesc.checkpointOverride === "fl2va"
        ? PINNED_H3_CHECKPOINTS.fl2va.sha256
        : PINNED_H3_CHECKPOINTS.ref2va.sha256);
    if (bHash !== vHash || baselineDesc.checkpointOverride !== variantDesc.checkpointOverride) {
      reasons.push("Undeclared checkpoint change in prompt_only arm");
    }
    if (baselineDesc.stepOverride !== variantDesc.stepOverride) {
      reasons.push("Undeclared step override change in prompt_only arm");
    }
    if (
      baselineDesc.attentionRequest?.attentionVariant !==
      variantDesc.attentionRequest?.attentionVariant
    ) {
      reasons.push("Undeclared attention variant change in prompt_only arm");
    }
  } else if (arm === "checkpoint_only") {
    if (variantDesc.experimentVariant?.purpose !== "performance") {
      reasons.push(
        `Arm 'checkpoint_only' requires purpose 'performance', got '${variantDesc.experimentVariant?.purpose}'`
      );
    }
    if (declaredPaths.length !== 1 || declaredPaths[0] !== "models.diffusion") {
      reasons.push(
        `Arm 'checkpoint_only' requires exactly 1 declared factor 'models.diffusion', got [${declaredPaths.join(", ")}]`
      );
    }
    if (declaredPaths.includes("runtime.manifest")) {
      reasons.push(
        "Arm 'checkpoint_only' must not declare runtime.manifest; runtime differences must be declared as a checkpoint/runtime bundle or controlled_multifactor"
      );
    }
    if (variantDesc.route === "ref2v" && variantDesc.checkpointOverride === "fl2va") {
      reasons.push("FL2VA checkpoint is strictly incompatible with Ref2V route");
    }
    const bHash =
      baselineDesc.provenance?.actualCheckpointHash ??
      (baselineDesc.checkpointOverride === "fl2va"
        ? PINNED_H3_CHECKPOINTS.fl2va.sha256
        : PINNED_H3_CHECKPOINTS.ref2va.sha256);
    const vHash =
      variantDesc.provenance?.actualCheckpointHash ??
      (variantDesc.checkpointOverride === "fl2va"
        ? PINNED_H3_CHECKPOINTS.fl2va.sha256
        : PINNED_H3_CHECKPOINTS.ref2va.sha256);
    if (bHash === vHash && baselineDesc.checkpointOverride === variantDesc.checkpointOverride) {
      reasons.push("Checkpoint is identical between baseline and candidate; no-op factor change");
    }
    if (
      !(
        bHash === PINNED_H3_CHECKPOINTS.ref2va.sha256 &&
        vHash === PINNED_H3_CHECKPOINTS.fl2va.sha256
      ) &&
      !(
        bHash === PINNED_H3_CHECKPOINTS.fl2va.sha256 &&
        vHash === PINNED_H3_CHECKPOINTS.ref2va.sha256
      )
    ) {
      reasons.push("Checkpoint hashes must match PINNED_H3_CHECKPOINTS (ref2va or fl2va)");
    }
    const bCore =
      baselineDesc.requiredRuntime?.coreRevision ?? baselineDesc.provenance?.comfyuiCoreRevision;
    const vCore =
      variantDesc.requiredRuntime?.coreRevision ?? variantDesc.provenance?.comfyuiCoreRevision;
    if (bCore && vCore && bCore !== vCore) {
      reasons.push(
        `Core revision mismatch in checkpoint_only arm: baseline is "${bCore}", variant is "${vCore}"`
      );
    }
    const bRuntimeDigest =
      baselineDesc.compatibility?.relativeToRuntimeManifestDigest ??
      baselineDesc.provenanceManifestDigest;
    const vRuntimeDigest =
      variantDesc.compatibility?.relativeToRuntimeManifestDigest ??
      variantDesc.provenanceManifestDigest;
    if (bRuntimeDigest && vRuntimeDigest && bRuntimeDigest !== vRuntimeDigest) {
      reasons.push(
        `Runtime manifest digest mismatch in checkpoint_only arm: baseline is "${bRuntimeDigest}", variant is "${vRuntimeDigest}"`
      );
    }
    const ckptFactor = declaredFactors.find((f) => f.path === "models.diffusion");
    if (!ckptFactor || !("before" in ckptFactor) || !("after" in ckptFactor)) {
      reasons.push(
        "Arm 'checkpoint_only' missing before/after in FactorChange for models.diffusion"
      );
    } else {
      if (ckptFactor.before.fileHash === ckptFactor.after.fileHash) {
        reasons.push(
          "FactorChange before and after fileHash are identical; no-op checkpoint change"
        );
      }
      if (ckptFactor.before.fileHash !== bHash) {
        reasons.push("FactorChange 'before' fileHash does not match baseline checkpoint hash");
      }
      if (ckptFactor.after.fileHash !== vHash) {
        reasons.push("FactorChange 'after' fileHash does not match variant checkpoint hash");
      }
    }
  } else if (arm === "reduced_step_only") {
    if (variantDesc.experimentVariant?.purpose !== "performance") {
      reasons.push(
        `Arm 'reduced_step_only' requires purpose 'performance', got '${variantDesc.experimentVariant?.purpose}'`
      );
    }
    if (declaredPaths.length !== 1 || declaredPaths[0] !== "sampling.settings") {
      reasons.push(
        `Arm 'reduced_step_only' requires exactly 1 declared factor 'sampling.settings', got [${declaredPaths.join(", ")}]`
      );
    }
    const bSteps =
      baselineDesc.stepOverride ?? baselineDesc.provenance?.samplerSettings?.steps ?? 20;
    const vSteps = variantDesc.stepOverride ?? variantDesc.provenance?.samplerSettings?.steps ?? 20;
    if (bSteps === vSteps) {
      reasons.push("Steps are identical between baseline and candidate; no-op step factor change");
    }
    const stepFactor = declaredFactors.find((f) => f.path === "sampling.settings");
    if (!stepFactor || !("before" in stepFactor) || !("after" in stepFactor)) {
      reasons.push(
        "Arm 'reduced_step_only' missing before/after in FactorChange for sampling.settings"
      );
    } else {
      if (stepFactor.before.steps === stepFactor.after.steps) {
        reasons.push("FactorChange before and after steps are identical; no-op step change");
      }
      if (stepFactor.before.steps !== bSteps) {
        reasons.push(
          `FactorChange 'before' steps ${stepFactor.before.steps} does not match baseline steps ${bSteps}`
        );
      }
      if (stepFactor.after.steps !== vSteps) {
        reasons.push(
          `FactorChange 'after' steps ${stepFactor.after.steps} does not match variant steps ${vSteps}`
        );
      }
    }
  } else if (arm === "attention_only") {
    if (variantDesc.experimentVariant?.purpose !== "performance") {
      reasons.push(
        `Arm 'attention_only' requires purpose 'performance', got '${variantDesc.experimentVariant?.purpose}'`
      );
    }
    if (declaredPaths.length !== 1 || declaredPaths[0] !== "attention.configuration") {
      reasons.push(
        `Arm 'attention_only' requires exactly 1 declared factor 'attention.configuration', got [${declaredPaths.join(", ")}]`
      );
    }
    const bAttn =
      baselineDesc.attentionRequest?.attentionVariant ??
      baselineDesc.provenance?.requestedAttentionBackend ??
      "default";
    const vAttn =
      variantDesc.attentionRequest?.attentionVariant ??
      variantDesc.provenance?.requestedAttentionBackend ??
      "default";
    if (bAttn !== "dense" && bAttn !== "default") {
      reasons.push(`Arm 'attention_only' requires baseline to be dense control, got '${bAttn}'`);
    }
    const bTopology =
      baselineDesc.attentionRequest?.topologyDigest ??
      baselineDesc.samplingRecipe?.attentionTopology?.topologyDigest ??
      null;
    const vTopology =
      variantDesc.attentionRequest?.topologyDigest ??
      variantDesc.samplingRecipe?.attentionTopology?.topologyDigest ??
      null;
    if (bAttn === vAttn && bTopology === vTopology) {
      reasons.push(
        "Attention backend and topologyDigest are identical; no-op attention factor change"
      );
    }
    const bCore =
      baselineDesc.requiredRuntime?.coreRevision ?? baselineDesc.provenance?.comfyuiCoreRevision;
    const vCore =
      variantDesc.requiredRuntime?.coreRevision ?? variantDesc.provenance?.comfyuiCoreRevision;
    if (bCore && vCore && bCore !== vCore) {
      reasons.push(
        `Core revision mismatch in attention_only arm: baseline is "${bCore}", variant is "${vCore}"`
      );
    }
    const bRuntimeDigest =
      baselineDesc.compatibility?.relativeToRuntimeManifestDigest ??
      baselineDesc.provenanceManifestDigest;
    const vRuntimeDigest =
      variantDesc.compatibility?.relativeToRuntimeManifestDigest ??
      variantDesc.provenanceManifestDigest;
    if (bRuntimeDigest && vRuntimeDigest && bRuntimeDigest !== vRuntimeDigest) {
      reasons.push(
        `Runtime manifest digest mismatch in attention_only arm: baseline is "${bRuntimeDigest}", variant is "${vRuntimeDigest}"`
      );
    }
    const attnFactor = declaredFactors.find((f) => f.path === "attention.configuration");
    if (attnFactor && "before" in attnFactor && "after" in attnFactor) {
      const beforeBackend =
        typeof attnFactor.before === "string"
          ? attnFactor.before
          : (attnFactor.before as { backend?: string })?.backend;
      const afterBackend =
        typeof attnFactor.after === "string"
          ? attnFactor.after
          : (attnFactor.after as { backend?: string })?.backend;
      const beforeDigest =
        typeof attnFactor.before === "object" && attnFactor.before !== null
          ? (attnFactor.before as { topologyDigest?: string })?.topologyDigest
          : null;
      const afterDigest =
        typeof attnFactor.after === "object" && attnFactor.after !== null
          ? (attnFactor.after as { topologyDigest?: string })?.topologyDigest
          : null;

      if (
        beforeBackend === afterBackend &&
        ((!beforeDigest && !afterDigest) || beforeDigest === afterDigest)
      ) {
        reasons.push(
          "FactorChange before and after attention backend and topologyDigest are identical; no-op attention change"
        );
      }
    }
  } else if (arm === "combined") {
    if (variantDesc.experimentVariant?.purpose !== "controlled_multifactor") {
      reasons.push(
        `Arm 'combined' requires purpose 'controlled_multifactor', got '${variantDesc.experimentVariant?.purpose}'`
      );
    }
    if (declaredPaths.length < 2) {
      reasons.push("Arm 'combined' requires at least 2 declared changed factors");
    }
  }

  return {
    admitted: reasons.length === 0,
    reasons,
    declaredPaths,
    operationalDifferences
  };
}

// ---------------------------------------------------------------------------
// 3. Cell Preparation
// ---------------------------------------------------------------------------

export interface PrepareContinuityStudyCellOptions {
  study: MinimaxH3ContinuityStudySpec;
  cellId: string;
  outputRoot: string;
  targetHost: string;
  gpuUuid: string;
  comfyUiDir: string;
  pythonPath: string;
  sourceBaseDir?: string;
  address?: string;
  port?: number;
  templatesDir?: string;
  store: MinimaxH3ExperimentStorePort;
  preflight?: MinimaxH3TargetPreflightPort;
  service?: MinimaxH3ExperimentService;
  humanReviewsForCombinedPrerequisites?: MinimaxH3ContinuityReviewSidecar[];
}

/**
 * Prepares an executable v2 experiment descriptor for a resolved study cell.
 */
export async function prepareContinuityStudyCell(
  options: PrepareContinuityStudyCellOptions
): Promise<{
  descriptor: MinimaxH3ExperimentDescriptorV2;
  result: MinimaxH3ExperimentResultV2;
  studyLink: Record<string, unknown>;
}> {
  const {
    study,
    cellId,
    outputRoot,
    targetHost,
    gpuUuid,
    comfyUiDir,
    pythonPath,
    sourceBaseDir = process.cwd(),
    address,
    port,
    templatesDir,
    store,
    preflight,
    service = new MinimaxH3ExperimentService(store, preflight),
    humanReviewsForCombinedPrerequisites
  } = options;

  const cell = study.cells.find((c) => c.cellId === cellId);
  if (!cell) {
    throw new Error(`Cell '${cellId}' not found in study '${study.studyId}'`);
  }

  const scenario = study.scenarios.find((s) => s.scenarioId === cell.scenarioId);
  if (!scenario) {
    throw new Error(`Scenario '${cell.scenarioId}' not found in study '${study.studyId}'`);
  }

  if (scenario.status === "pending_source") {
    throw new Error(
      `Cannot prepare cell '${cellId}': scenario '${scenario.scenarioId}' status is 'pending_source' (${scenario.pendingReason ?? "missing source evidence"})`
    );
  }

  if (cell.status === "pending_source") {
    throw new Error(
      `Cannot prepare cell '${cellId}': status is 'pending_source' (${cell.pendingReason ?? "missing source evidence"})`
    );
  }

  if (!cell.prompt || !cell.promptDigest) {
    throw new Error(`Cell '${cellId}' has missing or unresolved prompt text`);
  }

  // Combined variant guard: requires referenced independent human reviews
  if (cell.arm === "combined") {
    if (
      !humanReviewsForCombinedPrerequisites ||
      humanReviewsForCombinedPrerequisites.length === 0
    ) {
      throw new Error(
        `Cannot prepare combined variant cell '${cellId}': independent single-variable arms must be reviewed by a human operator before combined variants may be prepared`
      );
    }

    const requiredPrereqs = cell.prerequisiteCellIds ?? [];
    for (const prereqId of requiredPrereqs) {
      const review = humanReviewsForCombinedPrerequisites.find((r) => r.cellId === prereqId);
      if (!review) {
        throw new Error(
          `Cannot prepare combined variant cell '${cellId}': missing required review for prerequisite cell '${prereqId}'`
        );
      }
      const parsedReview = MinimaxH3ContinuityReviewSidecarSchema.safeParse(review);
      if (!parsedReview.success) {
        throw new Error(
          `Cannot prepare combined variant cell '${cellId}': prerequisite review for cell '${prereqId}' failed schema validation: ${parsedReview.error.message}`
        );
      }
      const computedReviewDigest = computeContinuityReviewDigest(review);
      if (review.reviewDigest !== computedReviewDigest) {
        throw new Error(
          `Cannot prepare combined variant cell '${cellId}': prerequisite review for cell '${prereqId}' digest mismatch: expected ${computedReviewDigest}, got ${review.reviewDigest}`
        );
      }
      if (
        !review.reviewId ||
        typeof review.reviewRevision !== "number" ||
        review.reviewRevision < 1
      ) {
        throw new Error(
          `Cannot prepare combined variant cell '${cellId}': prerequisite review for cell '${prereqId}' has invalid reviewId or reviewRevision`
        );
      }
      if (review.overallOutcome === "fail") {
        throw new Error(
          `Cannot prepare combined variant cell '${cellId}': prerequisite review '${review.reviewId}' for cell '${prereqId}' failed overall continuity rubric`
        );
      }
      if (review.dimensions.overallAdUsability.assessment === "fail") {
        throw new Error(
          `Cannot prepare combined variant cell '${cellId}': prerequisite review for cell '${prereqId}' received 'fail' overall usability`
        );
      }
      const disposition =
        review.operatorDisposition ??
        cell.prerequisiteReviews?.find((r) => r.cellId === prereqId)?.operatorDisposition;
      if (disposition !== "admitted") {
        throw new Error(
          `Cannot prepare combined variant cell '${cellId}': prerequisite review '${review.reviewId}' for cell '${prereqId}' has operatorDisposition '${disposition ?? "none"}', expected 'admitted'`
        );
      }
      if (review.studyId !== study.studyId) {
        throw new Error(
          `Cannot prepare combined variant cell '${cellId}': prerequisite review '${review.reviewId}' has studyId '${review.studyId}', expected '${study.studyId}'`
        );
      }
    }
  }

  // Route / conditioning mode verification
  if (scenario.route === "ref2v") {
    if (cell.checkpointOverride === "fl2va") {
      throw new Error("FL2VA checkpoint is strictly incompatible with Ref2V route");
    }
    const hasFirstFrame = scenario.referenceManifest.references.some(
      (r) => r.role === "first_frame"
    );
    if (hasFirstFrame) {
      throw new Error(
        "Ref2V route cannot contain a 'first_frame' reference role; I2V start frames cannot be substituted into Ref2V"
      );
    }
  } else if (scenario.route === "i2v") {
    const hasFirstFrame = scenario.referenceManifest.references.some(
      (r) => r.role === "first_frame"
    );
    if (!hasFirstFrame) {
      throw new Error("I2V route requires a reference with role 'first_frame'");
    }
  }

  // Verify reference manifest digest
  const expectedRefManifestDigest = computeReferenceManifestDigest(scenario.referenceManifest);
  if (scenario.referenceManifest.manifestDigest !== expectedRefManifestDigest) {
    throw new Error(
      `Reference manifest digest mismatch in scenario '${scenario.scenarioId}': expected ${expectedRefManifestDigest}, got ${scenario.referenceManifest.manifestDigest}`
    );
  }

  // Resolve and verify input asset hashes and sizes on disk
  const stagedReferences: Array<{
    sourceAssetPath: string;
    resolvedPath: string;
    role: string;
    tag?: string;
    slotIndex: number;
    sha256: string;
    sizeBytes: number;
    dimensions: { width: number; height: number };
  }> = [];

  for (const ref of scenario.referenceManifest.references) {
    const resolvedPath = path.isAbsolute(ref.sourceAssetPath)
      ? ref.sourceAssetPath
      : path.resolve(sourceBaseDir, ref.sourceAssetPath);

    const fileStats = await store.hashFile(resolvedPath);
    if (fileStats.sha256 !== ref.sourceSha256) {
      throw new Error(
        `Asset '${ref.sourceAssetPath}' SHA-256 mismatch: expected ${ref.sourceSha256}, got ${fileStats.sha256}`
      );
    }
    if (fileStats.sizeBytes !== ref.sourceSizeBytes) {
      throw new Error(
        `Asset '${ref.sourceAssetPath}' size mismatch: expected ${ref.sourceSizeBytes} bytes, got ${fileStats.sizeBytes} bytes`
      );
    }

    const assetInfo = await store.inspectAsset(resolvedPath);
    if (assetInfo.width !== ref.width || assetInfo.height !== ref.height) {
      throw new Error(
        `Asset '${ref.sourceAssetPath}' dimension mismatch: expected ${ref.width}x${ref.height}, got ${assetInfo.width}x${assetInfo.height}`
      );
    }
    if (ref.mimeType && assetInfo.mimeType !== ref.mimeType) {
      throw new Error(
        `Asset '${ref.sourceAssetPath}' mimeType mismatch: expected ${ref.mimeType}, got ${assetInfo.mimeType}`
      );
    }

    stagedReferences.push({
      sourceAssetPath: ref.sourceAssetPath,
      resolvedPath,
      role: ref.role,
      ...(ref.tag !== undefined ? { tag: ref.tag } : {}),
      slotIndex: ref.slotIndex,
      sha256: ref.sourceSha256,
      sizeBytes: ref.sourceSizeBytes,
      dimensions: { width: ref.width, height: ref.height }
    });
  }

  // Stage reference manifest with absolute paths so service resolves them safely
  const stagingManifestPath = `${outputRoot}/staged_manifests/${study.studyId}_${scenario.scenarioId}.json`;
  const legacyFormatManifest = {
    referenceSetId: scenario.referenceManifest.referenceSetId,
    references: stagedReferences.map((sr) => {
      const origRef = scenario.referenceManifest.references.find(
        (r) => r.slotIndex === sr.slotIndex
      );
      return {
        assetPath: sr.resolvedPath,
        stagedFilename: `${sr.role}.jpg`,
        role: sr.role,
        tag: sr.tag,
        order: sr.slotIndex,
        sha256: sr.sha256,
        sizeBytes: sr.sizeBytes,
        width: sr.dimensions.width,
        height: sr.dimensions.height,
        sourceAssetPath: sr.sourceAssetPath,
        ...(origRef?.derivation ? { derivation: origRef.derivation } : {})
      };
    })
  };
  await store.writeDurableJson(stagingManifestPath, legacyFormatManifest);

  // Construct changed factors based on arm
  let changedFactors: MinimaxH3FactorChange[] = [];
  let variantPurpose: "performance" | "prompt_conditioning" | "controlled_multifactor" =
    "performance";

  if (cell.arm === "baseline") {
    variantPurpose = "performance";
    changedFactors = [];
  } else if (cell.arm === "prompt_only") {
    variantPurpose = "prompt_conditioning";
    const baselinePrompt = scenario.originalPrompt?.text ?? cell.prompt;
    const baselineDigest = scenario.originalPrompt?.digest ?? cell.promptDigest;
    changedFactors = [
      {
        path: "conditioning.positivePrompt",
        before: {
          text: baselinePrompt,
          digest: baselineDigest
        },
        after: {
          text: cell.prompt,
          digest: cell.promptDigest
        },
        rationale: `Continuity-constrained prompt '${cell.promptVariantId}' vs original prompt`
      }
    ];
  } else if (cell.arm === "checkpoint_only") {
    variantPurpose = "performance";
    changedFactors = [
      {
        path: "models.diffusion",
        before: {
          repository: "Comfy-Org/MiniMax-H3",
          revision: "7e75982b97cd5a41d2dcfa1904ee88d0686d6fd1",
          filename: PINNED_H3_CHECKPOINTS.ref2va.filename,
          fileHash: PINNED_H3_CHECKPOINTS.ref2va.sha256,
          taskMode: "ref2va",
          licenseSourceRef: "https://huggingface.co/Comfy-Org/MiniMax-H3"
        },
        after: {
          repository: "Comfy-Org/MiniMax-H3",
          revision: "7e75982b97cd5a41d2dcfa1904ee88d0686d6fd1",
          filename: PINNED_H3_CHECKPOINTS.fl2va.filename,
          fileHash: PINNED_H3_CHECKPOINTS.fl2va.sha256,
          taskMode: "fl2va",
          licenseSourceRef: "https://huggingface.co/Comfy-Org/MiniMax-H3"
        },
        rationale: "FL2VA task-matched checkpoint vs audited legacy Ref2VA checkpoint"
      }
    ];
  } else if (cell.arm === "reduced_step_only") {
    variantPurpose = "performance";
    changedFactors = [
      {
        path: "sampling.settings",
        before: {
          sampler: "res_multistep",
          scheduler: "simple",
          steps: 20
        },
        after: {
          sampler: "res_multistep",
          scheduler: "simple",
          steps: cell.stepOverride ?? 10
        },
        rationale: "Reduced step schedule (20 to 10 steps)"
      }
    ];
  } else if (cell.arm === "attention_only") {
    // When changedFactors is empty, MinimaxH3ExperimentService automatically populates
    // attention.configuration from attentionVariant and catalog metadata with verified SHA-256 topology digests.
    variantPurpose = "performance";
    changedFactors = [];
  } else if (cell.arm === "combined") {
    variantPurpose = "controlled_multifactor";
    const baselinePrompt = scenario.originalPrompt?.text ?? cell.prompt;
    const baselineDigest = scenario.originalPrompt?.digest ?? cell.promptDigest;
    changedFactors = [
      {
        path: "conditioning.positivePrompt",
        before: {
          text: baselinePrompt,
          digest: baselineDigest
        },
        after: {
          text: cell.prompt,
          digest: cell.promptDigest
        },
        rationale: "Continuity constrained prompt"
      },
      {
        path: "sampling.settings",
        before: {
          sampler: "res_multistep",
          scheduler: "simple",
          steps: 20
        },
        after: {
          sampler: "res_multistep",
          scheduler: "simple",
          steps: cell.stepOverride ?? 10
        },
        rationale: "Reduced step schedule"
      }
    ];
  }

  const baselineCheckpointOverride =
    study.studyControls.diffusionCheckpoint.sha256 === PINNED_H3_CHECKPOINTS.fl2va.sha256 ||
    study.studyControls.diffusionCheckpoint.filename?.includes("fl2va") ||
    study.studyControls.diffusionCheckpoint.taskMode === "fl2va"
      ? "fl2va"
      : undefined;

  const effectiveCheckpointOverride =
    cell.checkpointOverride !== null && cell.checkpointOverride !== undefined
      ? cell.checkpointOverride
      : baselineCheckpointOverride;

  const effectiveStepOverride =
    cell.stepOverride !== null && cell.stepOverride !== undefined
      ? cell.stepOverride
      : study.studyControls.schedule.steps !== 20
        ? study.studyControls.schedule.steps
        : undefined;

  const runId = `${study.studyId}-${cell.cellId}`.toLowerCase().replace(/[^a-z0-9._-]/g, "-");
  const prepOptions: PrepareMinimaxH3ExperimentOptions = {
    schemaVersion: 2,
    route: scenario.route,
    frames: cell.frames,
    seed: study.studyControls.seed,
    prompt: cell.prompt,
    operatorLabel: `${study.studyId}:${cell.cellId}`,
    runId,
    outputRoot,
    targetHost,
    gpuUuid,
    comfyUiDir,
    pythonPath,
    runnerVariant: study.studyControls.runnerVariant,
    variantReason: `Continuity study cell ${cell.cellId} (${cell.arm})`,
    inputManifestPath: stagingManifestPath,
    variantPurpose,
    changedFactors,
    ...(address !== undefined ? { address } : {}),
    ...(port !== undefined ? { port } : {}),
    ...(templatesDir !== undefined ? { templatesDir } : {}),
    ...(effectiveStepOverride !== undefined ? { stepOverride: effectiveStepOverride } : {}),
    ...(effectiveCheckpointOverride !== undefined
      ? { checkpointOverride: effectiveCheckpointOverride }
      : {}),
    ...(cell.attentionVariant !== null && cell.attentionVariant !== undefined
      ? { attentionVariant: cell.attentionVariant }
      : {}),
    ...(cell.matchedVariant !== null && cell.matchedVariant !== undefined
      ? { matchedVariant: cell.matchedVariant }
      : {})
  };

  const receipt = await service.prepareExperiment(prepOptions);
  const runDir = receipt.runDir;

  const descriptor = (await store.readDescriptor(runDir)) as MinimaxH3ExperimentDescriptorV2;
  const result = (await store.readResult(runDir)) as MinimaxH3ExperimentResultV2;

  // Reconcile resulting descriptor against cell and scenario
  if (descriptor.route !== scenario.route) {
    throw new Error(
      `Prepared descriptor route '${descriptor.route}' does not match scenario route '${scenario.route}'`
    );
  }
  if (descriptor.configuredFrames !== cell.frames) {
    throw new Error(
      `Prepared descriptor configuredFrames ${descriptor.configuredFrames} does not match cell frames ${cell.frames}`
    );
  }
  if (descriptor.prompt !== cell.prompt) {
    throw new Error("Prepared descriptor prompt does not match cell prompt");
  }
  if (descriptor.promptDigest !== cell.promptDigest) {
    throw new Error(
      `Prepared descriptor promptDigest '${descriptor.promptDigest}' does not match cell promptDigest '${cell.promptDigest}'`
    );
  }
  if (effectiveStepOverride !== undefined && descriptor.stepOverride !== effectiveStepOverride) {
    throw new Error(
      `Prepared descriptor stepOverride '${descriptor.stepOverride}' does not match cell stepOverride '${effectiveStepOverride}'`
    );
  }
  if (
    effectiveCheckpointOverride !== undefined &&
    descriptor.checkpointOverride !== effectiveCheckpointOverride
  ) {
    throw new Error(
      `Prepared descriptor checkpointOverride '${descriptor.checkpointOverride}' does not match cell checkpointOverride '${effectiveCheckpointOverride}'`
    );
  }
  if (
    cell.attentionVariant !== null &&
    cell.attentionVariant !== undefined &&
    descriptor.attentionRequest?.attentionVariant !== cell.attentionVariant
  ) {
    throw new Error(
      `Prepared descriptor attentionVariant '${descriptor.attentionRequest?.attentionVariant}' does not match cell attentionVariant '${cell.attentionVariant}'`
    );
  }
  if (descriptor.references.length !== scenario.referenceManifest.references.length) {
    throw new Error(
      `Prepared descriptor reference count ${descriptor.references.length} does not match scenario manifest ${scenario.referenceManifest.references.length}`
    );
  }
  for (let i = 0; i < scenario.referenceManifest.references.length; i++) {
    const expectedRef = scenario.referenceManifest.references[i]!;
    const actualRef = descriptor.references[i]!;
    if (actualRef.sha256 !== expectedRef.sourceSha256) {
      throw new Error(
        `Prepared descriptor reference slot ${i} SHA mismatch: expected ${expectedRef.sourceSha256}, got ${actualRef.sha256}`
      );
    }
  }

  // If baseline cell for the same scenario and frames is already present in outputRoot,
  // verify offline descriptor admission immediately.
  if (cell.arm !== "baseline") {
    const edge = study.comparisonEdges.find((e) => e.candidateCellId === cell.cellId);
    const baselineCellId =
      edge?.baselineCellId ??
      study.cells.find(
        (c) => c.scenarioId === cell.scenarioId && c.frames === cell.frames && c.arm === "baseline"
      )?.cellId;
    if (baselineCellId) {
      const baselineRunId = `${study.studyId}-${baselineCellId}`
        .toLowerCase()
        .replace(/[^a-z0-9._-]/g, "-");
      const baselineRunDir = `${outputRoot}/${baselineRunId}`;
      try {
        const baselineDesc = (await store.readDescriptor(
          baselineRunDir
        )) as MinimaxH3ExperimentDescriptorV2;
        if (baselineDesc && baselineDesc.runId === baselineRunId) {
          const admission = admitContinuityPair(baselineDesc, descriptor, cell.arm);
          if (!admission.admitted) {
            throw new Error(
              `AdmitContinuityPair failed for cell '${cellId}' against baseline '${baselineCellId}':\n${admission.reasons.join("\n")}`
            );
          }
        }
      } catch (err: unknown) {
        const isNotFound =
          (err as { message?: string })?.message?.toLowerCase().includes("not found") ||
          (err as { code?: string })?.code === "ENOENT";
        if (!isNotFound && (err as Error)?.message?.includes("AdmitContinuityPair failed")) {
          throw err;
        }
      }
    }
  } else {
    // Baseline cell prepared: check if any candidate cells comparing against it already exist
    const edgesWithThisBaseline = study.comparisonEdges.filter(
      (e) => e.baselineCellId === cell.cellId
    );
    for (const edge of edgesWithThisBaseline) {
      const candidateRunId = `${study.studyId}-${edge.candidateCellId}`
        .toLowerCase()
        .replace(/[^a-z0-9._-]/g, "-");
      const candidateRunDir = `${outputRoot}/${candidateRunId}`;
      try {
        const candidateDesc = (await store.readDescriptor(
          candidateRunDir
        )) as MinimaxH3ExperimentDescriptorV2;
        if (candidateDesc && candidateDesc.runId === candidateRunId) {
          const admission = admitContinuityPair(descriptor, candidateDesc, edge.arm);
          if (!admission.admitted) {
            throw new Error(
              `AdmitContinuityPair failed for baseline cell '${cell.cellId}' against candidate '${edge.candidateCellId}':\n${admission.reasons.join("\n")}`
            );
          }
        }
      } catch (err: unknown) {
        const isNotFound =
          (err as { message?: string })?.message?.toLowerCase().includes("not found") ||
          (err as { code?: string })?.code === "ENOENT";
        if (!isNotFound && (err as Error)?.message?.includes("AdmitContinuityPair failed")) {
          throw err;
        }
      }
    }
  }

  // If cell has a 124f safety baseline and its run is present in outputRoot,
  // validate that the safety chain parameters match.
  if (cell.safetyBaseline124fCellId) {
    const safetyRunId = `${study.studyId}-${cell.safetyBaseline124fCellId}`
      .toLowerCase()
      .replace(/[^a-z0-9._-]/g, "-");
    const safetyRunDir = `${outputRoot}/${safetyRunId}`;
    try {
      const safetyDesc = (await store.readDescriptor(
        safetyRunDir
      )) as MinimaxH3ExperimentDescriptorV2;
      if (safetyDesc) {
        const safetyCheck = validateSafetyChainDescriptor(safetyDesc, descriptor);
        if (!safetyCheck.valid) {
          throw new Error(
            `Safety chain validation failed for cell '${cellId}' against 124f safety baseline '${cell.safetyBaseline124fCellId}':\n${safetyCheck.errors.join("\n")}`
          );
        }
      }
    } catch (err: unknown) {
      const isNotFound =
        (err as { message?: string })?.message?.toLowerCase().includes("not found") ||
        (err as { code?: string })?.code === "ENOENT";
      if (!isNotFound && (err as Error)?.message?.includes("Safety chain validation failed")) {
        throw err;
      }
    }
  }

  // Record durable study link
  const studyLink = {
    studyId: study.studyId,
    studyDigest: study.studyDigest,
    cellId: cell.cellId,
    scenarioId: cell.scenarioId,
    arm: cell.arm,
    frames: cell.frames,
    promptVariantId: cell.promptVariantId,
    promptDigest: cell.promptDigest,
    descriptorDigest: descriptor.descriptorDigest,
    safetyBaseline124fCellId: cell.safetyBaseline124fCellId,
    pinnedReferenceManifest: scenario.referenceManifest,
    stagedLineage: stagedReferences,
    preparedAt: new Date().toISOString()
  };
  await store.writeDurableJson(`${runDir}/study_link.json`, studyLink);

  return { descriptor, result, studyLink };
}

// ---------------------------------------------------------------------------
// 4. Storyboard Plan & Review Manifest Builders
// ---------------------------------------------------------------------------

export interface BuildStoryboardPlanOptions {
  study: MinimaxH3ContinuityStudySpec;
  runResults?: Map<
    string,
    {
      descriptor: MinimaxH3ExperimentDescriptorV2;
      result?: MinimaxH3ExperimentResultV2 | null;
      outputSha256?: string | null;
      outputSizeBytes?: number | null;
      outputRelativePath?: string | null;
      collectionStatus?: "pending" | "available" | "unavailable" | "failed";
    }
  >;
}

/**
 * Builds a deterministic storyboard plan with aligned playback and reproducible sample points.
 */
export function buildContinuityStoryboardPlan(
  options: BuildStoryboardPlanOptions
): MinimaxH3StoryboardPlan {
  const { study, runResults = new Map() } = options;
  const panels: StoryboardPanel[] = [];

  const alignedPlayback = {
    timeZeroAligned: true as const,
    notes:
      "Align all playback windows at t=0s. Frame 0 corresponds to source media initial conditioning state."
  };

  for (const cell of study.cells) {
    const scenario = study.scenarios.find((s) => s.scenarioId === cell.scenarioId)!;
    const durationSec = cell.frames / 24;
    const panelId = `panel-${cell.cellId}`;

    const plannedSamples: PlannedSamplePoint[] = [
      {
        targetFrame: 0,
        targetTimeSec: 0,
        sampleReason: "first_frame",
        inRange: true
      }
    ];

    // Observation beats: 3.3s, 6.7s, 8.3s
    const beats: Array<{ timeSec: number; reason: PlannedSamplePoint["sampleReason"] }> = [
      { timeSec: 3.3, reason: "362f_collapse_window" },
      { timeSec: 6.7, reason: "362f_collapse_window" },
      { timeSec: 8.3, reason: "362f_recovery" }
    ];

    // Denser collapse-window sampling for long shots (362f)
    if (cell.frames >= 362) {
      beats.push(
        { timeSec: 4.0, reason: "362f_collapse_window" },
        { timeSec: 5.0, reason: "362f_collapse_window" },
        { timeSec: 6.0, reason: "362f_collapse_window" },
        { timeSec: 7.5, reason: "362f_recovery" },
        { timeSec: 9.0, reason: "362f_recovery" }
      );
    }

    for (const beat of beats) {
      const targetFrame = Math.round(beat.timeSec * 24);
      plannedSamples.push({
        targetFrame,
        targetTimeSec: beat.timeSec,
        sampleReason: beat.reason,
        inRange: beat.timeSec <= durationSec
      });
    }

    // Last frame
    plannedSamples.push({
      targetFrame: cell.frames - 1,
      targetTimeSec: (cell.frames - 1) / 24,
      sampleReason: "last_frame",
      inRange: true
    });

    // Regular interval samples (every 2.0s)
    for (let t = 2.0; t < durationSec - 0.5; t += 2.0) {
      if (
        Math.abs(t - 3.3) > 0.5 &&
        Math.abs(t - 4.0) > 0.5 &&
        Math.abs(t - 5.0) > 0.5 &&
        Math.abs(t - 6.0) > 0.5 &&
        Math.abs(t - 6.7) > 0.5 &&
        Math.abs(t - 7.5) > 0.5 &&
        Math.abs(t - 8.3) > 0.5 &&
        Math.abs(t - 9.0) > 0.5
      ) {
        plannedSamples.push({
          targetFrame: Math.round(t * 24),
          targetTimeSec: t,
          sampleReason: "regular_interval",
          inRange: true
        });
      }
    }

    // Sort samples by targetFrame
    plannedSamples.sort((a, b) => a.targetFrame - b.targetFrame);

    // Media binding lookup
    const runInfo = runResults.get(cell.cellId);
    const collectionStatus =
      runInfo?.collectionStatus ??
      (runInfo?.outputSha256 || runInfo?.result?.probe?.outputSha256
        ? ("available" as const)
        : runInfo?.result?.execution?.status === "failed"
          ? ("failed" as const)
          : ("pending" as const));

    const mediaBinding = runInfo
      ? {
          runId: runInfo.descriptor.runId,
          descriptorDigest: runInfo.descriptor.descriptorDigest,
          resultDigest: runInfo.result ? sha256Hex(canonicalizeJson(runInfo.result)) : null,
          outputSha256:
            collectionStatus === "unavailable"
              ? null
              : (runInfo.outputSha256 ?? runInfo.result?.probe?.outputSha256 ?? null),
          outputSizeBytes:
            collectionStatus === "unavailable"
              ? null
              : (runInfo.outputSizeBytes ?? runInfo.result?.probe?.outputSizeBytes ?? null),
          outputRelativePath: runInfo.outputRelativePath ?? null,
          measuredFps: runInfo.result?.probe?.measuredFacts?.fps ?? null,
          measuredFrames: runInfo.result?.probe?.measuredFacts?.measuredFrames ?? null,
          collectionStatus
        }
      : {
          collectionStatus: "pending" as const
        };

    const inspectionInstructions: string[] = [];
    if (cell.frames === 124) {
      inspectionInstructions.push("Inspect camera push speed and framing relative to prompt.");
    } else if (cell.frames === 243) {
      inspectionInstructions.push(
        "Perform full-clip inspection for 243f wardrobe departure and temporary yellow backdrop departure."
      );
    } else if (cell.frames === 362) {
      inspectionInstructions.push(
        "Inspect lighting and background persistence specifically across the ~3.3s–6.7s blackout window and recovery around ~8.3s."
      );
    }

    panels.push({
      panelId,
      cellId: cell.cellId,
      scenarioId: cell.scenarioId,
      route: scenario.route,
      conditioningMode: scenario.conditioningMode,
      frames: cell.frames,
      durationSec,
      checkpointSha:
        cell.checkpointOverride === "fl2va"
          ? PINNED_H3_CHECKPOINTS.fl2va.sha256
          : PINNED_H3_CHECKPOINTS.ref2va.sha256,
      seed: study.studyControls.seed,
      promptVariantId: cell.promptVariantId,
      promptDigest: cell.promptDigest,
      promptText: cell.prompt,
      requestedAttention: cell.attentionVariant ?? "default",
      observedAttention:
        runInfo?.descriptor?.provenance?.requestedAttentionBackend ??
        runInfo?.descriptor?.attentionRequest?.attentionVariant ??
        null,
      sampler: study.studyControls.schedule.sampler,
      scheduler: study.studyControls.schedule.scheduler,
      steps: cell.stepOverride ?? study.studyControls.schedule.steps,
      runtimeCoreRevision:
        runInfo?.descriptor?.provenance?.comfyuiCoreRevision ??
        runInfo?.descriptor?.requiredRuntime?.coreRevision ??
        PINNED_COMFYUI_CORE_REVISION,
      alignedPlayback,
      actionAndCameraBeats: ["camera_push", "lighting_continuity"],
      fullClipInspectionRequired: cell.frames === 243,
      inspectionInstructions,
      plannedSamples,
      mediaBinding
    });
  }

  const planDraft = {
    schemaVersion: 1 as const,
    kind: "storyboard-plan" as const,
    studyId: study.studyId,
    studyDigest: study.studyDigest,
    generatedAt: new Date().toISOString(),
    panels
  };

  const planDigest = computeStoryboardPlanDigest(planDraft);
  return MinimaxH3StoryboardPlanSchema.parse({
    ...planDraft,
    planDigest
  });
}

/**
 * Builds a review manifest pairing same-frame panels for side-by-side evaluation.
 */
export function buildContinuityReviewManifest(
  study: MinimaxH3ContinuityStudySpec,
  storyboardPlan: MinimaxH3StoryboardPlan
): MinimaxH3ReviewManifest {
  const comparisonPairs = study.comparisonEdges.map((edge) => {
    return {
      pairId: `pair-${edge.edgeId}`,
      edgeId: edge.edgeId,
      frames: edge.frames,
      scenarioId: edge.scenarioId,
      arm: edge.arm,
      baselinePanelId: `panel-${edge.baselineCellId}`,
      candidatePanelId: `panel-${edge.candidateCellId}`,
      declaredFactorPaths: edge.declaredFactorPaths,
      status: edge.status
    };
  });

  const manifestDraft = {
    schemaVersion: 1 as const,
    kind: "review-manifest" as const,
    studyId: study.studyId,
    studyDigest: study.studyDigest,
    generatedAt: new Date().toISOString(),
    panels: storyboardPlan.panels,
    comparisonPairs
  };

  const manifestDigest = computeReviewManifestDigest(manifestDraft);
  return MinimaxH3ReviewManifestSchema.parse({
    ...manifestDraft,
    manifestDigest
  });
}

// ---------------------------------------------------------------------------
// 5. Sidecar Validation & Durable Import
// ---------------------------------------------------------------------------

export interface ValidateContinuityReviewOptions {
  sidecarRaw: unknown;
  descriptor?: MinimaxH3AnyExperimentDescriptor;
  result?: MinimaxH3AnyExperimentResult;
}

export function validateContinuityReview(options: ValidateContinuityReviewOptions): {
  valid: boolean;
  errors: string[];
  sidecar?: MinimaxH3ContinuityReviewSidecar;
} {
  const { sidecarRaw, descriptor, result } = options;
  const parseResult = MinimaxH3ContinuityReviewSidecarSchema.safeParse(sidecarRaw);
  if (!parseResult.success) {
    return {
      valid: false,
      errors: parseResult.error.issues.map((issue) => `${issue.path.join(".")}: ${issue.message}`)
    };
  }

  const sidecar = parseResult.data;
  const errors: string[] = [];

  // 1. Verify review digest
  const computedReviewDigest = computeContinuityReviewDigest(sidecar);
  if (sidecar.reviewDigest !== computedReviewDigest) {
    errors.push(
      `Sidecar reviewDigest "${sidecar.reviewDigest}" does not match computed digest "${computedReviewDigest}"`
    );
  }

  // 2. Verify rubric digest
  const canonicalRubricDigest = computeContinuityRubricDigest();
  if (sidecar.rubricDigest !== canonicalRubricDigest) {
    errors.push(
      `Sidecar rubricDigest "${sidecar.rubricDigest}" does not match canonical rubric digest "${canonicalRubricDigest}"`
    );
  }

  // 3. Descriptor binding checks
  if (descriptor) {
    if (sidecar.runId !== descriptor.runId) {
      errors.push(
        `Sidecar runId "${sidecar.runId}" does not match descriptor runId "${descriptor.runId}"`
      );
    }
    if (sidecar.route !== descriptor.route) {
      errors.push(
        `Sidecar route "${sidecar.route}" does not match descriptor route "${descriptor.route}"`
      );
    }
    if (sidecar.configuredFrames !== descriptor.configuredFrames) {
      errors.push(
        `Sidecar configuredFrames ${sidecar.configuredFrames} does not match descriptor configuredFrames ${descriptor.configuredFrames}`
      );
    }
    if (descriptor.descriptorDigest && sidecar.descriptorDigest !== descriptor.descriptorDigest) {
      errors.push(
        `Sidecar descriptorDigest "${sidecar.descriptorDigest}" does not match descriptor "${descriptor.descriptorDigest}"`
      );
    }
  }

  // 4. Result and media probe checks
  if (result) {
    if (result.execution?.status !== "completed") {
      errors.push(`Result execution status is "${result.execution?.status}", expected "completed"`);
    }
    if (!result.probe || result.probe.status !== "succeeded") {
      errors.push(`Result probe status is "${result.probe?.status}", expected "succeeded"`);
    }
    if (!result.probe?.outputSha256) {
      errors.push("Result probe is missing outputSha256");
    } else if (sidecar.sourceOutputSha256 !== result.probe.outputSha256) {
      errors.push(
        `Sidecar sourceOutputSha256 "${sidecar.sourceOutputSha256}" does not match result probe outputSha256 "${result.probe.outputSha256}"`
      );
    }
    if (!result.probe?.outputFile) {
      errors.push("Result probe is missing outputFile");
    }

    const measuredDurationMs =
      result.probe?.measuredFacts?.measuredVideoDurationMs ??
      result.probe?.measuredFacts?.measuredContainerDurationMs ??
      null;
    const durationSec =
      measuredDurationMs !== null
        ? measuredDurationMs / 1000
        : descriptor
          ? descriptor.configuredFrames / 24
          : null;

    // Validate interval bounds against duration
    for (const [dimKey, dim] of Object.entries(sidecar.dimensions)) {
      if (dim.intervals) {
        for (const interval of dim.intervals) {
          if (interval.startSec < 0 || interval.endSec < interval.startSec) {
            errors.push(
              `Dimension "${dimKey}" has invalid interval [${interval.startSec}, ${interval.endSec}]: start must be >= 0 and end >= start`
            );
          }
          if (durationSec !== null && interval.endSec > durationSec + 0.1) {
            errors.push(
              `Dimension "${dimKey}" interval end ${interval.endSec}s exceeds clip duration ${durationSec}s`
            );
          }
        }
      }
    }

    if (sidecar.sceneSubstitution?.detected && sidecar.sceneSubstitution.intervals) {
      for (const interval of sidecar.sceneSubstitution.intervals) {
        if (interval.startSec < 0 || interval.endSec < interval.startSec) {
          errors.push(
            `sceneSubstitution has invalid interval [${interval.startSec}, ${interval.endSec}]: start must be >= 0 and end >= start`
          );
        }
        if (durationSec !== null && interval.endSec > durationSec + 0.1) {
          errors.push(
            `sceneSubstitution interval end ${interval.endSec}s exceeds clip duration ${durationSec}s`
          );
        }
      }
    }
  }

  // 5. Sound design passing requires audio examination
  const soundDim = sidecar.dimensions.sound;
  if (soundDim && soundDim.assessment === "pass" && !sidecar.reviewCoverage.audioExamined) {
    errors.push("sound dimension cannot pass when audioExamined is false");
  }

  return {
    valid: errors.length === 0,
    errors,
    ...(errors.length === 0 && sidecar ? { sidecar } : {})
  };
}

export interface ImportContinuityReviewOptions {
  runDir: string;
  sidecar: MinimaxH3ContinuityReviewSidecar;
  store: MinimaxH3ExperimentStorePort;
}

class KeyedMutex {
  private readonly queues = new Map<string, Promise<void>>();

  async acquire(key: string): Promise<() => void> {
    let release!: () => void;
    const currentLock = new Promise<void>((resolve) => {
      release = resolve;
    });

    const previousLock = this.queues.get(key) ?? Promise.resolve();
    const chained = previousLock.then(
      () => currentLock,
      () => currentLock
    );
    this.queues.set(key, chained);

    await previousLock.catch(() => {});

    return () => {
      release();
      if (this.queues.get(key) === chained) {
        this.queues.delete(key);
      }
    };
  }
}

const runLockMutex = new KeyedMutex();

async function acquireInterprocessLock(
  lockDir: string,
  options: { timeoutMs?: number; retryIntervalMs?: number; staleAgeMs?: number } = {}
): Promise<() => Promise<void>> {
  const { timeoutMs = 15000, retryIntervalMs = 50, staleAgeMs = 60000 } = options;
  const parentDir = path.dirname(lockDir);
  if (!fs.existsSync(parentDir)) {
    return async () => {};
  }

  const startTime = Date.now();
  while (true) {
    try {
      await fs.promises.mkdir(lockDir, { recursive: false });
      try {
        await fs.promises.writeFile(
          path.join(lockDir, "lock.json"),
          JSON.stringify({ pid: process.pid, createdAt: Date.now() })
        );
      } catch {
        // ignore write error
      }
      return async () => {
        try {
          await fs.promises.rm(lockDir, { recursive: true, force: true });
        } catch {
          // ignore cleanup error
        }
      };
    } catch (err: unknown) {
      const error = err as { code?: string };
      if (error?.code !== "EEXIST") {
        throw err;
      }

      try {
        const stats = await fs.promises.stat(lockDir);
        if (Date.now() - stats.mtimeMs > staleAgeMs) {
          await fs.promises.rm(lockDir, { recursive: true, force: true });
          continue;
        }
      } catch {
        continue;
      }

      if (Date.now() - startTime > timeoutMs) {
        throw new Error(
          `Timed out after ${timeoutMs}ms waiting to acquire lock on directory: ${lockDir}`
        );
      }

      await new Promise((resolve) => setTimeout(resolve, retryIntervalMs));
    }
  }
}

export async function withRunLock<T>(runDir: string, action: () => Promise<T>): Promise<T> {
  const releaseInProcess = await runLockMutex.acquire(runDir);
  const lockDir = path.join(runDir, ".import_lock");
  let releaseInterprocess: (() => Promise<void>) | null = null;
  try {
    releaseInterprocess = await acquireInterprocessLock(lockDir);
    return await action();
  } finally {
    if (releaseInterprocess) {
      await releaseInterprocess();
    }
    releaseInProcess();
  }
}

export async function importContinuityReview(options: ImportContinuityReviewOptions): Promise<{
  imported: boolean;
  idempotent: boolean;
  reason?: string;
}> {
  return withRunLock(options.runDir, async () => {
    const { runDir, sidecar, store } = options;

    const descriptor = await store.readDescriptor(runDir);
    if (!descriptor) {
      throw new Error(`No descriptor found in run directory "${runDir}"`);
    }

    const result = await store.readResult(runDir);
    if (!result) {
      throw new Error(`No result.json found in run directory "${runDir}"`);
    }

    if (result.execution?.status !== "completed") {
      return {
        imported: false,
        idempotent: false,
        reason: `Result execution status is "${result.execution?.status}", expected "completed"`
      };
    }
    if (!result.probe || result.probe.status !== "succeeded") {
      return {
        imported: false,
        idempotent: false,
        reason: `Result probe status is "${result.probe?.status}", expected "succeeded"`
      };
    }
    if (!result.probe?.outputFile) {
      return {
        imported: false,
        idempotent: false,
        reason: "Result probe outputFile is missing"
      };
    }

    // Re-hash output file on disk immediately (propagate hash/file errors)
    const outputFilePath = path.resolve(runDir, result.probe.outputFile);
    const hashInfo = await store.hashFile(outputFilePath);
    if (hashInfo.sha256 !== sidecar.sourceOutputSha256) {
      return {
        imported: false,
        idempotent: false,
        reason: `Output file on disk SHA-256 "${hashInfo.sha256}" does not match sidecar sourceOutputSha256 "${sidecar.sourceOutputSha256}"`
      };
    }

    const validation = validateContinuityReview({
      sidecarRaw: sidecar,
      descriptor,
      result
    });

    if (!validation.valid) {
      return {
        imported: false,
        idempotent: false,
        reason: validation.errors.join("; ")
      };
    }

    const sidecarPath = `${runDir}/continuity_review.json`;
    let existingRaw: unknown = null;
    try {
      existingRaw = await store.readJsonFile(sidecarPath);
    } catch (err: unknown) {
      const error = err as { code?: string; message?: string };
      const isNotFound =
        error?.code === "ENOENT" ||
        error?.message?.includes("ENOENT") ||
        error?.message?.toLowerCase().includes("not found") ||
        error?.message?.toLowerCase().includes("does not exist");
      if (!isNotFound) {
        throw err; // Propagate SyntaxError, EACCES, etc.
      }
    }

    if (existingRaw) {
      const existingHash = sha256Hex(canonicalizeJson(existingRaw));
      const newHash = sha256Hex(canonicalizeJson(sidecar));
      if (existingHash === newHash) {
        // Idempotent retry reconciliation (F-ab949498 & F-944dbf37)
        const freshResult = (await store.readResult(runDir)) ?? result;
        const mappedFindings = mapContinuityReviewToLegacyVisualReview(sidecar);
        const needsReconcile =
          freshResult.visualReview?.status !== "reviewed" ||
          freshResult.visualReview?.outputSha256 !== sidecar.sourceOutputSha256 ||
          freshResult.visualReview?.reviewer !== sidecar.reviewer ||
          JSON.stringify(freshResult.visualReview?.findings) !== JSON.stringify(mappedFindings);

        if (needsReconcile) {
          const updatedResult = {
            ...freshResult,
            visualReview: {
              status: "reviewed" as const,
              outputSha256: sidecar.sourceOutputSha256,
              reviewedAt: sidecar.reviewedAt,
              reviewer: sidecar.reviewer,
              findings: mappedFindings,
              notes: sidecar.notes ?? null,
              unavailableReason: null
            }
          };
          await store.writeResult(runDir, updatedResult);
        }
        return { imported: true, idempotent: true };
      }

      // Differing review: verify reviewId or revision was bumped
      const existingSidecar = existingRaw as Partial<MinimaxH3ContinuityReviewSidecar>;
      if (
        existingSidecar.reviewId === sidecar.reviewId &&
        existingSidecar.reviewRevision === sidecar.reviewRevision
      ) {
        throw new Error(
          `Cannot import differing review with duplicate reviewId "${sidecar.reviewId}" and reviewRevision ${sidecar.reviewRevision}. Modify reviewRevision or provide a new reviewId.`
        );
      }

      // Collision-resistant archive path
      const entropy = `${Date.now()}_${Math.random().toString(36).slice(2, 8)}_${existingHash.slice(0, 12)}`;
      const archivePath = `${runDir}/prior_reviews/continuity_review_${existingSidecar.reviewId ?? "rev"}_rev${existingSidecar.reviewRevision ?? 1}_${entropy}.json`;
      await store.writeDurableJson(archivePath, existingRaw);
    }

    // Save the full detailed sidecar
    await store.writeDurableJson(sidecarPath, sidecar);

    // Conservatively map into fresh result.visualReview for existing consumers
    const freshResult = (await store.readResult(runDir)) ?? result;
    const mappedFindings = mapContinuityReviewToLegacyVisualReview(sidecar);
    const updatedResult = {
      ...freshResult,
      visualReview: {
        status: "reviewed" as const,
        outputSha256: sidecar.sourceOutputSha256,
        reviewedAt: sidecar.reviewedAt,
        reviewer: sidecar.reviewer,
        findings: mappedFindings,
        notes: sidecar.notes ?? null,
        unavailableReason: null
      }
    };

    await store.writeResult(runDir, updatedResult);

    return { imported: true, idempotent: false };
  });
}
