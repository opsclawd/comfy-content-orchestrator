import { randomUUID } from "node:crypto";
import {
  CampaignDurationPlanningError,
  DEFAULT_ASSEMBLY_PLANNING_ENVELOPE,
  computePlanSemanticDigest,
  type AssemblyPlanningEnvelope,
  type CampaignDurationPlan,
  type ExecutionProfileSelection,
  type ExecutionRealm,
  type H3ProfileFrameCapability,
  type SceneDurationAllocation
} from "@cco/contracts";
import { mapProductionDuration, isMiniMaxEngineOrProfile } from "./map-production-duration.js";
import {
  MIN_SCENE_COUNT,
  MAX_SCENE_COUNT,
  MIN_TARGET_DURATION_MS,
  MAX_TARGET_DURATION_MS,
  MIN_SCENE_DURATION_MS,
  MAX_SCENE_DURATION_MS,
  MINIMAX_H3_TARGET_SECONDS_PER_SCENE,
  LTX_TARGET_SECONDS_PER_SCENE
} from "./scene-count-policy.js";

export interface ProfileCapabilityCandidate {
  readonly profileSelection: ExecutionProfileSelection;
  readonly profileKey: string;
  readonly engine: string;
  readonly route: "i2v" | "ref2v";
  readonly routingMode: "frame_anchored" | "reference_directed";
  readonly width: number;
  readonly height: number;
  readonly fps: number;
  readonly frames: number;
  readonly toleranceMs: number;
  readonly preferredDurationMs: number;
  readonly exactNominalMs: number;
  readonly roundedNominalMs: number;
  readonly minRequestedMs: number;
  readonly maxRequestedMs: number;
  readonly capability?: H3ProfileFrameCapability | undefined;
}

export interface FeasibilityPlanningInput {
  readonly campaignId: string;
  readonly targetTotalDurationMs: number;
  readonly sceneCountOverride?: number | undefined;
  readonly explicitSceneDurationsMs?: readonly number[] | undefined;
  readonly existingAllocationIds?: readonly string[] | undefined;
  readonly revision?: number | undefined;
  readonly predecessorPlanId?: string | null | undefined;
  readonly selectedProfileSelection: ExecutionProfileSelection;
  readonly allowedProfileSelections?: readonly ExecutionProfileSelection[] | undefined;
  readonly realm: ExecutionRealm;
  readonly scope: "production" | "staging";
  readonly envelope?: AssemblyPlanningEnvelope | undefined;
  readonly capabilities?: ReadonlyMap<string, H3ProfileFrameCapability> | undefined;
}

export function extractProfileCandidate(
  selection: ExecutionProfileSelection,
  capabilities?: ReadonlyMap<string, H3ProfileFrameCapability>
): ProfileCapabilityCandidate {
  const profileKey = selection.profileKey;
  const isMiniMax = isMiniMaxEngineOrProfile(profileKey);

  const capability: H3ProfileFrameCapability | undefined = capabilities?.get(profileKey);
  let frames: number;
  let fps: number;
  let route: "i2v" | "ref2v";
  let routingMode: "frame_anchored" | "reference_directed";
  let width: number;
  let height: number;
  let engine: string;
  let toleranceMs: number;
  let preferredDurationMs: number;

  if (selection.kind === "legacy_production") {
    if (isMiniMax) {
      frames = 124;
      fps = 24;
      route = profileKey.includes("REF2V") ? "ref2v" : "i2v";
      routingMode = route === "ref2v" ? "reference_directed" : "frame_anchored";
      width = 1344;
      height = 768;
      engine = route === "ref2v" ? "minimax_h3_ref2v" : "minimax_h3_i2v";
      toleranceMs = 355;
      preferredDurationMs = 5_000;
    } else {
      frames = 97;
      fps = 24;
      route = "i2v";
      routingMode = "frame_anchored";
      width = 1280;
      height = 720;
      engine = "ltx_25";
      toleranceMs = 200;
      preferredDurationMs = 4_000;
    }
  } else if (selection.kind === "released_production") {
    if (!capability) {
      throw new CampaignDurationPlanningError(
        "release_unavailable",
        `Capability not found for released production profile: ${profileKey}`
      );
    }
    frames = capability.allowedFrameCounts[0]!;
    fps = capability.fps || 24;
    route = capability.route;
    routingMode = capability.routingMode;
    width = capability.width;
    height = capability.height;
    engine = route === "ref2v" ? "minimax_h3_ref2v" : "minimax_h3_i2v";
    toleranceMs = 355;
    preferredDurationMs = Math.round((frames * 1000) / fps / 1000) * 1000;
  } else {
    // staging_candidate
    if (!capability) {
      throw new CampaignDurationPlanningError(
        "capability_unavailable",
        `Capability not found for staging candidate profile: ${profileKey}`
      );
    }
    frames = capability.allowedFrameCounts[0]!;
    fps = capability.fps || 24;
    route = capability.route;
    routingMode = capability.routingMode;
    width = capability.width;
    height = capability.height;
    engine = route === "ref2v" ? "minimax_h3_ref2v" : "minimax_h3_i2v";
    toleranceMs = 355;
    preferredDurationMs = Math.round((frames * 1000) / fps / 1000) * 1000;
  }

  // Check MiniMax grid conformance if H3
  if (isMiniMax) {
    if ((frames - 5) % 17 !== 0) {
      throw new CampaignDurationPlanningError(
        "no_feasible_allocation",
        `Profile ${profileKey} frame count ${frames} is off the MiniMax-H3 temporal grid`
      );
    }
  }

  const exactNominalMs = (frames * 1000) / fps;
  const roundedNominalMs = Math.round(exactNominalMs);

  // Scene nominal ceiling check: exact nominal time <= 15,000ms
  if (exactNominalMs > MAX_SCENE_DURATION_MS) {
    throw new CampaignDurationPlanningError(
      "scene_ceiling",
      `Profile ${profileKey} nominal duration ${exactNominalMs.toFixed(3)}ms exceeds scene ceiling ${MAX_SCENE_DURATION_MS}ms`
    );
  }

  let minRequestedMs = Math.max(MIN_SCENE_DURATION_MS, Math.ceil(exactNominalMs - toleranceMs));
  let maxRequestedMs = Math.min(MAX_SCENE_DURATION_MS, Math.floor(exactNominalMs + toleranceMs));

  const mapperOptions = {
    profile: profileKey,
    engine,
    toleranceMs,
    capability
  };
  while (minRequestedMs <= maxRequestedMs) {
    const res = mapProductionDuration(minRequestedMs, mapperOptions);
    if (res.ok && res.frameCount === frames) {
      break;
    }
    minRequestedMs++;
  }
  while (maxRequestedMs >= minRequestedMs) {
    const res = mapProductionDuration(maxRequestedMs, mapperOptions);
    if (res.ok && res.frameCount === frames) {
      break;
    }
    maxRequestedMs--;
  }

  if (minRequestedMs > maxRequestedMs) {
    throw new CampaignDurationPlanningError(
      "no_feasible_allocation",
      `Profile ${profileKey} has no admissible requested duration interval within [${MIN_SCENE_DURATION_MS}, ${MAX_SCENE_DURATION_MS}]ms`
    );
  }

  return {
    profileSelection: selection,
    profileKey,
    engine,
    route,
    routingMode,
    width,
    height,
    fps,
    frames,
    toleranceMs,
    preferredDurationMs,
    exactNominalMs,
    roundedNominalMs,
    minRequestedMs,
    maxRequestedMs,
    capability
  };
}

export function planFeasibleCampaignDuration(
  input: FeasibilityPlanningInput
): CampaignDurationPlan {
  const {
    campaignId,
    targetTotalDurationMs,
    sceneCountOverride,
    selectedProfileSelection,
    realm,
    scope
  } = input;

  const envelope = input.envelope ?? DEFAULT_ASSEMBLY_PLANNING_ENVELOPE;

  // 1. Validate campaign target duration
  if (
    !Number.isInteger(targetTotalDurationMs) ||
    targetTotalDurationMs < MIN_TARGET_DURATION_MS ||
    targetTotalDurationMs > MAX_TARGET_DURATION_MS
  ) {
    throw new CampaignDurationPlanningError(
      "no_feasible_allocation",
      `targetTotalDurationMs ${targetTotalDurationMs}ms is outside valid range [${MIN_TARGET_DURATION_MS}, ${MAX_TARGET_DURATION_MS}]ms`
    );
  }

  // 2. Validate scene count override if provided
  if (sceneCountOverride !== undefined) {
    if (
      !Number.isInteger(sceneCountOverride) ||
      sceneCountOverride < MIN_SCENE_COUNT ||
      sceneCountOverride > MAX_SCENE_COUNT
    ) {
      throw new CampaignDurationPlanningError(
        "no_feasible_allocation",
        `sceneCountOverride ${sceneCountOverride} is outside valid range [${MIN_SCENE_COUNT}, ${MAX_SCENE_COUNT}]`
      );
    }
    if (sceneCountOverride > envelope.maxStemCount) {
      throw new CampaignDurationPlanningError(
        "assembly_envelope_exceeded",
        `sceneCountOverride ${sceneCountOverride} exceeds assembly envelope maxStemCount ${envelope.maxStemCount}`
      );
    }
  }

  // 3. Resolve eligible profile candidates
  const allSelections: ExecutionProfileSelection[] = [selectedProfileSelection];
  if (input.allowedProfileSelections) {
    for (const sel of input.allowedProfileSelections) {
      if (!allSelections.some((s) => s.profileKey === sel.profileKey)) {
        allSelections.push(sel);
      }
    }
  }

  const candidates: ProfileCapabilityCandidate[] = [];
  for (const sel of allSelections) {
    // Validate scope compatibility
    if (scope === "production" && sel.kind === "staging_candidate") {
      throw new CampaignDurationPlanningError(
        "authorization_denied",
        `Staging candidate profile "${sel.profileKey}" is prohibited in production scope`
      );
    }
    const candidate = extractProfileCandidate(sel, input.capabilities);
    candidates.push(candidate);
  }

  // Ensure all candidates have compatible route
  const primaryRoute = candidates[0]!.route;
  for (const c of candidates) {
    if (c.route !== primaryRoute) {
      throw new CampaignDurationPlanningError(
        "profile_route_mismatch",
        `All duration profiles must share the same route: expected "${primaryRoute}", received "${c.route}" for profile "${c.profileKey}"`
      );
    }
  }

  const isLegacyOnly =
    candidates.length === 1 && candidates[0]!.profileSelection.kind === "legacy_production";
  const maxStemCount = Math.min(MAX_SCENE_COUNT, envelope.maxStemCount);

  let bestSolution:
    | {
        readonly allocations: readonly {
          readonly candidate: ProfileCapabilityCandidate;
          readonly requestedDurationMs: number;
        }[];
        readonly totalNominalMs: number;
        readonly exactRationalTotalMs: number;
        readonly totalDeviation: number;
      }
    | undefined;

  let preserveOrder = false;

  if (input.explicitSceneDurationsMs !== undefined && input.explicitSceneDurationsMs.length > 0) {
    preserveOrder = true;
    const explicitDurations = input.explicitSceneDurationsMs;
    if (explicitDurations.length > maxStemCount) {
      throw new CampaignDurationPlanningError(
        "assembly_envelope_exceeded",
        `Explicit scene count ${explicitDurations.length} exceeds assembly envelope maxStemCount ${envelope.maxStemCount}`
      );
    }
    const matched: { candidate: ProfileCapabilityCandidate; requestedDurationMs: number }[] = [];
    let totalNominalMs = 0;
    let exactRationalTotalMs = 0;

    for (const d of explicitDurations) {
      const matchingCandidate = candidates.find(
        (c) => d >= c.minRequestedMs && d <= c.maxRequestedMs
      );
      if (!matchingCandidate) {
        throw new CampaignDurationPlanningError(
          "no_feasible_allocation",
          `Scene duration ${d}ms cannot be satisfied by any eligible profile`
        );
      }
      matched.push({ candidate: matchingCandidate, requestedDurationMs: d });
      totalNominalMs += matchingCandidate.roundedNominalMs;
      exactRationalTotalMs += matchingCandidate.exactNominalMs;
    }

    bestSolution = {
      allocations: matched,
      totalNominalMs,
      exactRationalTotalMs,
      totalDeviation: 0
    };
  } else {
    // 4. Determine counts N to evaluate
    let targetCounts: number[];
    if (sceneCountOverride !== undefined) {
      targetCounts = [sceneCountOverride];
    } else if (isLegacyOnly) {
      const isMiniMax = isMiniMaxEngineOrProfile(candidates[0]!.profileKey);
      const preferredSeconds = isMiniMax
        ? MINIMAX_H3_TARGET_SECONDS_PER_SCENE
        : LTX_TARGET_SECONDS_PER_SCENE;
      const derivedN = Math.round(targetTotalDurationMs / (preferredSeconds * 1000));
      const clampedN = Math.min(Math.max(derivedN, MIN_SCENE_COUNT), MAX_SCENE_COUNT);
      targetCounts = [clampedN];
    } else {
      // Search increasing N from 1 to maxStemCount
      targetCounts = [];
      for (let n = 1; n <= maxStemCount; n++) {
        targetCounts.push(n);
      }
    }

    for (const n of targetCounts) {
      if (n > maxStemCount) {
        continue;
      }

      // Check if total duration is roughly in range [n * minReq, n * maxReq] across candidates
      const globalMinReq = Math.min(...candidates.map((c) => c.minRequestedMs));
      const globalMaxReq = Math.max(...candidates.map((c) => c.maxRequestedMs));
      if (targetTotalDurationMs < n * globalMinReq || targetTotalDurationMs > n * globalMaxReq) {
        continue;
      }

      const sol = solveExactAllocation(n, targetTotalDurationMs, candidates, envelope);
      if (sol !== undefined) {
        if (bestSolution === undefined || sol.totalDeviation < bestSolution.totalDeviation) {
          bestSolution = sol;
          // If we found a solution at the smallest feasible N, we take it!
          break;
        }
      }
    }

    if (bestSolution === undefined) {
      // Check if the reason is envelope violation
      const minNominalPerScene = Math.min(...candidates.map((c) => c.roundedNominalMs));
      const minExactRationalPerScene = Math.min(...candidates.map((c) => c.exactNominalMs));
      const matchingCounts = targetCounts.filter((n) => {
        const minReq = n * Math.min(...candidates.map((c) => c.minRequestedMs));
        const maxReq = n * Math.max(...candidates.map((c) => c.maxRequestedMs));
        return targetTotalDurationMs >= minReq && targetTotalDurationMs <= maxReq;
      });
      if (
        matchingCounts.length > 0 &&
        matchingCounts.every(
          (n) =>
            n * minNominalPerScene > envelope.maxExpectedTotalDurationMs ||
            n * minExactRationalPerScene > envelope.maxExpectedTotalDurationMs
        )
      ) {
        throw new CampaignDurationPlanningError(
          "assembly_envelope_exceeded",
          `Expected total duration exceeds assembly planning envelope maximum ${envelope.maxExpectedTotalDurationMs}ms`
        );
      }
      throw new CampaignDurationPlanningError(
        "no_feasible_allocation",
        `No feasible duration allocation found for total ${targetTotalDurationMs}ms with available profiles`
      );
    }
  }

  // 6. Check envelope budgets on the chosen solution
  if (
    bestSolution.allocations.length > envelope.maxStemCount ||
    bestSolution.totalNominalMs > envelope.maxExpectedTotalDurationMs ||
    bestSolution.exactRationalTotalMs > envelope.maxExpectedTotalDurationMs
  ) {
    throw new CampaignDurationPlanningError(
      "assembly_envelope_exceeded",
      `Feasible allocation exceeds assembly planning envelope: count ${bestSolution.allocations.length} (max ${envelope.maxStemCount}), nominal ${bestSolution.totalNominalMs}ms (max ${envelope.maxExpectedTotalDurationMs}ms)`
    );
  }

  // 7. Sort allocations into canonical order: longer-first sequence (unless order preserved for explicit scenes)
  // Ties broken by profileKey, frameCount, requestedDurationMs
  const sortedAllocations = preserveOrder
    ? [...bestSolution.allocations]
    : [...bestSolution.allocations].sort((a, b) => {
        if (b.requestedDurationMs !== a.requestedDurationMs) {
          return b.requestedDurationMs - a.requestedDurationMs;
        }
        if (b.candidate.frames !== a.candidate.frames) {
          return b.candidate.frames - a.candidate.frames;
        }
        return a.candidate.profileKey.localeCompare(b.candidate.profileKey);
      });

  // 8. Reconstruct and revalidate allocations through the real mapper
  const finalAllocations: SceneDurationAllocation[] = [];
  for (let i = 0; i < sortedAllocations.length; i++) {
    const item = sortedAllocations[i]!;
    const c = item.candidate;
    const reqMs = item.requestedDurationMs;

    const mapResult = mapProductionDuration(reqMs, {
      engine: c.engine,
      profile: c.profileKey,
      toleranceMs: c.toleranceMs,
      capability: c.capability
    });

    if (!mapResult.ok || mapResult.frameCount !== c.frames) {
      throw new CampaignDurationPlanningError(
        "no_feasible_allocation",
        `Allocation validation failed: requested ${reqMs}ms did not map to expected ${c.frames} frames`
      );
    }

    finalAllocations.push({
      allocationId: input.existingAllocationIds?.[i] ?? randomUUID(),
      ordinal: i + 1,
      requestedDurationMs: reqMs,
      nominalDurationMs: c.roundedNominalMs,
      exactRationalNominalDurationMs: c.exactNominalMs,
      profileSelection: c.profileSelection,
      engine: c.engine,
      route: c.route,
      routingMode: c.routingMode,
      width: c.width,
      height: c.height,
      frames: c.frames,
      fps: c.fps,
      toleranceMs: c.toleranceMs,
      preferredDurationMs: c.preferredDurationMs
    });
  }

  const totalNominalDurationMs = finalAllocations.reduce((sum, a) => sum + a.nominalDurationMs, 0);
  const exactRationalTotalDurationMs = finalAllocations.reduce(
    (sum, a) => sum + a.exactRationalNominalDurationMs,
    0
  );

  const planId = randomUUID();
  const allowedDurationProfileKeys = allSelections.map((s) => s.profileKey);

  const planToDigest = {
    scope,
    requestedTotalDurationMs: targetTotalDurationMs,
    selectedProfileKey: selectedProfileSelection.profileKey,
    allowedDurationProfileKeys,
    allocations: finalAllocations,
    finalEditPolicy: "preserve_generated_timeline" as const
  };

  const semanticDigest = computePlanSemanticDigest(planToDigest);

  return {
    planId,
    campaignId,
    revision: input.revision ?? 1,
    predecessorPlanId: input.predecessorPlanId ?? null,
    realm,
    scope,
    requestedTotalDurationMs: targetTotalDurationMs,
    ...(sceneCountOverride !== undefined ? { sceneCountOverride } : {}),
    selectedProfileKey: selectedProfileSelection.profileKey,
    allowedDurationProfileKeys,
    allocations: finalAllocations,
    envelope,
    finalEditPolicy: "preserve_generated_timeline",
    totalNominalDurationMs,
    exactRationalTotalDurationMs,
    semanticDigest,
    createdAt: new Date().toISOString()
  };
}

/**
 * Solves for exact partition of targetTotalDurationMs across N scenes using candidates.
 * Prioritizes preferred durations and minimal absolute deviation.
 */
function solveExactAllocation(
  n: number,
  targetMs: number,
  candidates: readonly ProfileCapabilityCandidate[],
  envelope: AssemblyPlanningEnvelope
):
  | {
      readonly allocations: readonly {
        readonly candidate: ProfileCapabilityCandidate;
        readonly requestedDurationMs: number;
      }[];
      readonly totalNominalMs: number;
      readonly exactRationalTotalMs: number;
      readonly totalDeviation: number;
    }
  | undefined {
  // Sort candidates by preferred duration descending
  const sortedCandidates = [...candidates].sort(
    (a, b) => b.preferredDurationMs - a.preferredDurationMs
  );
  const C = sortedCandidates.length;

  // Fast path for single candidate profile
  if (C === 1) {
    const cand = sortedCandidates[0]!;
    const totalNominalMs = n * cand.roundedNominalMs;
    const exactRationalTotalMs = n * cand.exactNominalMs;
    if (
      totalNominalMs > envelope.maxExpectedTotalDurationMs ||
      exactRationalTotalMs > envelope.maxExpectedTotalDurationMs
    ) {
      return undefined;
    }
    const base = Math.floor(targetMs / n);
    const rem = targetMs % n;
    if (base < cand.minRequestedMs || base + (rem > 0 ? 1 : 0) > cand.maxRequestedMs) {
      return undefined;
    }
    const allocations = Array.from({ length: n }, (_, i) => ({
      candidate: cand,
      requestedDurationMs: i < rem ? base + 1 : base
    }));
    return {
      allocations,
      totalNominalMs,
      exactRationalTotalMs,
      totalDeviation: allocations.reduce(
        (sum, a) => sum + Math.abs(a.requestedDurationMs - cand.preferredDurationMs),
        0
      )
    };
  }

  const MAX_SEARCH_STATES = 50_000;
  let stateCount = 0;

  type AllocationSolution = {
    allocations: Array<{
      candidate: ProfileCapabilityCandidate;
      requestedDurationMs: number;
    }>;
    totalNominalMs: number;
    exactRationalTotalMs: number;
    totalDeviation: number;
  };

  let bestResult: AllocationSolution | undefined;

  // Generate bounded multiset candidate combinations: counts (k_0, ..., k_{C-1}) summing to n
  const currentCounts = new Array<number>(C).fill(0);

  function evaluatePartition(counts: readonly number[]): void {
    if (++stateCount > MAX_SEARCH_STATES) {
      throw new CampaignDurationPlanningError(
        "catalog_limit",
        `State search limit (${MAX_SEARCH_STATES}) exceeded while evaluating duration feasibility`
      );
    }

    let totalNominalMs = 0;
    let exactRationalTotalMs = 0;
    let minPossibleMs = 0;
    let maxPossibleMs = 0;
    let totalPreferredMs = 0;

    for (let j = 0; j < C; j++) {
      const count = counts[j]!;
      if (count === 0) continue;
      const cand = sortedCandidates[j]!;
      totalNominalMs += count * cand.roundedNominalMs;
      exactRationalTotalMs += count * cand.exactNominalMs;
      minPossibleMs += count * cand.minRequestedMs;
      maxPossibleMs += count * cand.maxRequestedMs;
      totalPreferredMs += count * cand.preferredDurationMs;
    }

    // Envelope bounds check
    if (
      totalNominalMs > envelope.maxExpectedTotalDurationMs ||
      exactRationalTotalMs > envelope.maxExpectedTotalDurationMs
    ) {
      return;
    }

    // Reachability check
    if (targetMs < minPossibleMs || targetMs > maxPossibleMs) {
      return;
    }

    // Lower bound deviation for this combination
    const partitionDeviation = Math.abs(targetMs - totalPreferredMs);
    if (bestResult !== undefined && partitionDeviation >= bestResult.totalDeviation) {
      return;
    }

    // Expand candidates
    const assignedCandidates: ProfileCapabilityCandidate[] = [];
    for (let j = 0; j < C; j++) {
      const count = counts[j]!;
      const cand = sortedCandidates[j]!;
      for (let k = 0; k < count; k++) {
        assignedCandidates.push(cand);
      }
    }

    // Compute integer durations d_i starting at preferred durations
    const durations = assignedCandidates.map((c) => c.preferredDurationMs);
    let diff = targetMs - totalPreferredMs;

    if (diff > 0) {
      while (diff > 0) {
        const eligibleIndices: number[] = [];
        for (let i = 0; i < n; i++) {
          if (durations[i]! < assignedCandidates[i]!.maxRequestedMs) {
            eligibleIndices.push(i);
          }
        }
        if (eligibleIndices.length === 0) break;
        const share = Math.max(1, Math.floor(diff / eligibleIndices.length));
        let progress = false;
        for (const idx of eligibleIndices) {
          const headroom = assignedCandidates[idx]!.maxRequestedMs - durations[idx]!;
          const add = Math.min(share, headroom, diff);
          if (add > 0) {
            durations[idx] = (durations[idx] ?? 0) + add;
            diff -= add;
            progress = true;
            if (diff === 0) break;
          }
        }
        if (!progress) {
          const firstIdx = eligibleIndices[0]!;
          durations[firstIdx] = (durations[firstIdx] ?? 0) + 1;
          diff -= 1;
        }
      }
    } else if (diff < 0) {
      let deficit = -diff;
      while (deficit > 0) {
        const eligibleIndices: number[] = [];
        for (let i = 0; i < n; i++) {
          if (durations[i]! > assignedCandidates[i]!.minRequestedMs) {
            eligibleIndices.push(i);
          }
        }
        if (eligibleIndices.length === 0) break;
        const share = Math.max(1, Math.floor(deficit / eligibleIndices.length));
        let progress = false;
        for (const idx of eligibleIndices) {
          const room = durations[idx]! - assignedCandidates[idx]!.minRequestedMs;
          const sub = Math.min(share, room, deficit);
          if (sub > 0) {
            durations[idx] = (durations[idx] ?? 0) - sub;
            deficit -= sub;
            progress = true;
            if (deficit === 0) break;
          }
        }
        if (!progress) {
          const firstIdx = eligibleIndices[0]!;
          durations[firstIdx] = (durations[firstIdx] ?? 0) - 1;
          deficit -= 1;
        }
      }
      diff = -deficit;
    }

    if (diff !== 0) {
      return;
    }

    // Revalidate each assigned duration through mapper
    for (let i = 0; i < n; i++) {
      const c = assignedCandidates[i]!;
      const d = durations[i]!;
      const mapRes = mapProductionDuration(d, {
        engine: c.engine,
        profile: c.profileKey,
        toleranceMs: c.toleranceMs,
        capability: c.capability
      });
      if (!mapRes.ok || mapRes.frameCount !== c.frames) {
        return;
      }
    }

    const allocations = assignedCandidates.map((candidate, i) => ({
      candidate,
      requestedDurationMs: durations[i]!
    }));

    const calculatedDeviation = allocations.reduce(
      (sum, a) => sum + Math.abs(a.requestedDurationMs - a.candidate.preferredDurationMs),
      0
    );

    if (bestResult === undefined || calculatedDeviation < bestResult.totalDeviation) {
      bestResult = {
        allocations,
        totalNominalMs,
        exactRationalTotalMs,
        totalDeviation: calculatedDeviation
      };
    }
  }

  function searchPartitions(candIdx: number, remainingScenes: number): void {
    if (candIdx === C - 1) {
      currentCounts[candIdx] = remainingScenes;
      evaluatePartition(currentCounts);
      return;
    }

    const remainingCandidates = sortedCandidates.slice(candIdx);
    const minNominalRemaining = Math.min(...remainingCandidates.map((c) => c.roundedNominalMs));
    const minExactRemaining = Math.min(...remainingCandidates.map((c) => c.exactNominalMs));
    const minReqRemaining = Math.min(...remainingCandidates.map((c) => c.minRequestedMs));
    const maxReqRemaining = Math.max(...remainingCandidates.map((c) => c.maxRequestedMs));

    for (let k = remainingScenes; k >= 0; k--) {
      currentCounts[candIdx] = k;
      const scenesLeft = remainingScenes - k;

      let curNominal = 0;
      let curExact = 0;
      let curMinReq = 0;
      let curMaxReq = 0;
      for (let i = 0; i <= candIdx; i++) {
        const count = currentCounts[i]!;
        if (count > 0) {
          const c = sortedCandidates[i]!;
          curNominal += count * c.roundedNominalMs;
          curExact += count * c.exactNominalMs;
          curMinReq += count * c.minRequestedMs;
          curMaxReq += count * c.maxRequestedMs;
        }
      }

      if (
        curNominal + scenesLeft * minNominalRemaining > envelope.maxExpectedTotalDurationMs ||
        curExact + scenesLeft * minExactRemaining > envelope.maxExpectedTotalDurationMs
      ) {
        continue;
      }

      if (
        curMaxReq + scenesLeft * maxReqRemaining < targetMs ||
        curMinReq + scenesLeft * minReqRemaining > targetMs
      ) {
        continue;
      }

      searchPartitions(candIdx + 1, scenesLeft);
      if (bestResult !== undefined && bestResult.totalDeviation === 0) {
        return;
      }
    }
  }

  searchPartitions(0, n);

  return bestResult;
}
