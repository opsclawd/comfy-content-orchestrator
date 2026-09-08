import { describe, expect, it, vi } from "vitest";
import type { CandidateId, SceneId, StoryboardCandidate } from "@cco/domain";
import type {
  CandidateRankingContext,
  RankingModelClientPort,
  RankingModelOutcome,
  RankingModelRequest,
  ResolvedCandidateImage
} from "../ports/index.js";
import {
  CandidateRankingOrchestrator,
  decideRankingFallback,
  decodeVisualQaAuthorizationPolicy
} from "./candidate-ranking-orchestrator.js";

function makeFakeCandidate(
  variantOrdinal: number,
  idSuffix = String(variantOrdinal)
): StoryboardCandidate {
  return {
    id: `cand-${idSuffix}` as CandidateId,
    sceneId: "scene-1" as SceneId,
    specRevision: 1,
    variantOrdinal,
    storageBucket: "review-bucket",
    storageObjectKey: `candidates/cand-${idSuffix}.png`,
    contentHash: `hash-${idSuffix}`,
    generationMetadata: {},
    createdAt: "2026-09-07T00:00:00.000Z"
  };
}

class FakeRankingClient implements RankingModelClientPort {
  readonly calls: RankingModelRequest[] = [];
  constructor(
    readonly providerName: "Google" | "OpenAI",
    private readonly outcomes: RankingModelOutcome[] = []
  ) {}

  async rankBatch(request: RankingModelRequest): Promise<RankingModelOutcome> {
    this.calls.push(request);
    const outcome = this.outcomes.shift();
    if (!outcome) {
      throw new Error(`No mock outcome queued for ${this.providerName}`);
    }
    return outcome;
  }
}

describe("CandidateRankingOrchestrator", () => {
  const candidates: StoryboardCandidate[] = [
    makeFakeCandidate(1),
    makeFakeCandidate(2),
    makeFakeCandidate(3)
  ];

  const fakeResolveImageData = vi.fn(
    async (candidate: StoryboardCandidate): Promise<ResolvedCandidateImage | undefined> => ({
      base64Data: `data-${candidate.variantOrdinal}`,
      mimeType: "image/png"
    })
  );

  const context: CandidateRankingContext = {
    sceneId: "scene-1" as SceneId,
    shotDescription: "Epic sunset scene",
    resolveImageData: fakeResolveImageData
  };

  it("reorders candidates on primary provider success", async () => {
    const primary = new FakeRankingClient("Google", [
      { kind: "success", rankedOrdinals: [3, 1, 2] }
    ]);
    const fallback = new FakeRankingClient("OpenAI", []);

    const orchestrator = new CandidateRankingOrchestrator({
      primaryClient: primary,
      fallbackClient: fallback,
      policy: {
        allowCloudVisualQA: true,
        allowedProviders: new Set(["Google", "OpenAI"]),
        sensitiveDataMasking: false
      }
    });

    const result = await orchestrator.rank(candidates, context);
    expect(result.map((c) => c.variantOrdinal)).toEqual([3, 1, 2]);
    expect(primary.calls).toHaveLength(1);
    expect(fallback.calls).toHaveLength(0);
  });

  it("appends any unmentioned candidate ordinals at the end in original order", async () => {
    const primary = new FakeRankingClient("Google", [
      { kind: "success", rankedOrdinals: [2] } // 1 and 3 are omitted in response
    ]);
    const fallback = new FakeRankingClient("OpenAI", []);

    const orchestrator = new CandidateRankingOrchestrator({
      primaryClient: primary,
      fallbackClient: fallback,
      policy: {
        allowCloudVisualQA: true,
        allowedProviders: new Set(["Google"]),
        sensitiveDataMasking: false
      }
    });

    const result = await orchestrator.rank(candidates, context);
    expect(result.map((c) => c.variantOrdinal)).toEqual([2, 1, 3]);
  });

  it("retries same provider once on retryable_failure before succeeding", async () => {
    const primary = new FakeRankingClient("Google", [
      { kind: "retryable_failure", httpStatus: 429, message: "Rate limited" },
      { kind: "success", rankedOrdinals: [2, 3, 1] }
    ]);
    const fallback = new FakeRankingClient("OpenAI", []);

    const orchestrator = new CandidateRankingOrchestrator({
      primaryClient: primary,
      fallbackClient: fallback,
      policy: {
        allowCloudVisualQA: true,
        allowedProviders: new Set(["Google", "OpenAI"]),
        sensitiveDataMasking: false
      }
    });

    const result = await orchestrator.rank(candidates, context);
    expect(result.map((c) => c.variantOrdinal)).toEqual([2, 3, 1]);
    expect(primary.calls).toHaveLength(2);
    expect(fallback.calls).toHaveLength(0);
  });

  it("falls back to secondary client when primary fails permanently", async () => {
    const primary = new FakeRankingClient("Google", [
      { kind: "permanent_failure", httpStatus: 400, message: "Bad request" }
    ]);
    const fallback = new FakeRankingClient("OpenAI", [
      { kind: "success", rankedOrdinals: [3, 2, 1] }
    ]);

    const orchestrator = new CandidateRankingOrchestrator({
      primaryClient: primary,
      fallbackClient: fallback,
      policy: {
        allowCloudVisualQA: true,
        allowedProviders: new Set(["Google", "OpenAI"]),
        sensitiveDataMasking: false
      }
    });

    const result = await orchestrator.rank(candidates, context);
    expect(result.map((c) => c.variantOrdinal)).toEqual([3, 2, 1]);
    expect(primary.calls).toHaveLength(1);
    expect(fallback.calls).toHaveLength(1);
  });

  it("falls back to secondary client when primary exhausts retries", async () => {
    const primary = new FakeRankingClient("Google", [
      { kind: "retryable_failure", httpStatus: 503, message: "Service Unavailable" },
      { kind: "retryable_failure", httpStatus: 503, message: "Service Unavailable" }
    ]);
    const fallback = new FakeRankingClient("OpenAI", [
      { kind: "success", rankedOrdinals: [1, 3, 2] }
    ]);

    const orchestrator = new CandidateRankingOrchestrator({
      primaryClient: primary,
      fallbackClient: fallback,
      policy: {
        allowCloudVisualQA: true,
        allowedProviders: new Set(["Google", "OpenAI"]),
        sensitiveDataMasking: false
      }
    });

    const result = await orchestrator.rank(candidates, context);
    expect(result.map((c) => c.variantOrdinal)).toEqual([1, 3, 2]);
    expect(primary.calls).toHaveLength(2);
    expect(fallback.calls).toHaveLength(1);
  });

  it("returns original unranked order when both providers fail", async () => {
    const primary = new FakeRankingClient("Google", [
      { kind: "permanent_failure", httpStatus: 400, message: "Bad request" }
    ]);
    const fallback = new FakeRankingClient("OpenAI", [
      { kind: "permanent_failure", httpStatus: 400, message: "Bad request" }
    ]);

    const orchestrator = new CandidateRankingOrchestrator({
      primaryClient: primary,
      fallbackClient: fallback,
      policy: {
        allowCloudVisualQA: true,
        allowedProviders: new Set(["Google", "OpenAI"]),
        sensitiveDataMasking: false
      }
    });

    const result = await orchestrator.rank(candidates, context);
    expect(result.map((c) => c.variantOrdinal)).toEqual([1, 2, 3]);
  });

  it("does not attempt cross-provider fallback on primary safety refusal", async () => {
    const primary = new FakeRankingClient("Google", [
      { kind: "safety_refusal", httpStatus: 403, message: "Blocked by safety filter" }
    ]);
    const fallback = new FakeRankingClient("OpenAI", []);

    const orchestrator = new CandidateRankingOrchestrator({
      primaryClient: primary,
      fallbackClient: fallback,
      policy: {
        allowCloudVisualQA: true,
        allowedProviders: new Set(["Google", "OpenAI"]),
        sensitiveDataMasking: false
      }
    });

    const result = await orchestrator.rank(candidates, context);
    expect(result.map((c) => c.variantOrdinal)).toEqual([1, 2, 3]);
    expect(primary.calls).toHaveLength(1);
    expect(fallback.calls).toHaveLength(0); // Zero calls to fallback!
  });

  it("returns original unranked order immediately when allowCloudVisualQA=false", async () => {
    const primary = new FakeRankingClient("Google", []);
    const fallback = new FakeRankingClient("OpenAI", []);

    const orchestrator = new CandidateRankingOrchestrator({
      primaryClient: primary,
      fallbackClient: fallback,
      policy: {
        allowCloudVisualQA: false,
        allowedProviders: new Set(["Google", "OpenAI"]),
        sensitiveDataMasking: false
      }
    });

    const result = await orchestrator.rank(candidates, context);
    expect(result.map((c) => c.variantOrdinal)).toEqual([1, 2, 3]);
    expect(primary.calls).toHaveLength(0);
    expect(fallback.calls).toHaveLength(0);
  });

  it("does not call OpenAI fallback when allowedProviders=['Google'] and Gemini fails permanently (Finding 2 witness)", async () => {
    const primary = new FakeRankingClient("Google", [
      { kind: "permanent_failure", httpStatus: 400, message: "Client error" }
    ]);
    const fallback = new FakeRankingClient("OpenAI", []);

    const orchestrator = new CandidateRankingOrchestrator({
      primaryClient: primary,
      fallbackClient: fallback,
      policy: {
        allowCloudVisualQA: true,
        allowedProviders: new Set(["Google"]), // OpenAI is excluded
        sensitiveDataMasking: false
      }
    });

    const result = await orchestrator.rank(candidates, context);
    expect(result.map((c) => c.variantOrdinal)).toEqual([1, 2, 3]);
    expect(primary.calls).toHaveLength(1);
    expect(fallback.calls).toHaveLength(0); // OpenAI must NEVER be called
  });

  it("skips primary (Google) and calls fallback (OpenAI) directly when allowedProviders=['OpenAI']", async () => {
    const primary = new FakeRankingClient("Google", []);
    const fallback = new FakeRankingClient("OpenAI", [
      { kind: "success", rankedOrdinals: [2, 1, 3] }
    ]);

    const orchestrator = new CandidateRankingOrchestrator({
      primaryClient: primary,
      fallbackClient: fallback,
      policy: {
        allowCloudVisualQA: true,
        allowedProviders: new Set(["OpenAI"]), // Google is excluded
        sensitiveDataMasking: false
      }
    });

    const result = await orchestrator.rank(candidates, context);
    expect(result.map((c) => c.variantOrdinal)).toEqual([2, 1, 3]);
    expect(primary.calls).toHaveLength(0); // Google never called
    expect(fallback.calls).toHaveLength(1);
  });

  it("returns candidates unchanged when fewer than 2 candidates have resolvable images", async () => {
    const primary = new FakeRankingClient("Google", []);
    const fallback = new FakeRankingClient("OpenAI", []);

    const orchestrator = new CandidateRankingOrchestrator({
      primaryClient: primary,
      fallbackClient: fallback,
      policy: {
        allowCloudVisualQA: true,
        allowedProviders: new Set(["Google", "OpenAI"]),
        sensitiveDataMasking: false
      }
    });

    const onlyOneResolvedContext: CandidateRankingContext = {
      sceneId: "scene-1" as SceneId,
      shotDescription: "Sunset",
      resolveImageData: async (c) =>
        c.variantOrdinal === 1 ? { base64Data: "xyz", mimeType: "image/png" } : undefined
    };

    const result = await orchestrator.rank(candidates, onlyOneResolvedContext);
    expect(result.map((c) => c.variantOrdinal)).toEqual([1, 2, 3]);
    expect(primary.calls).toHaveLength(0);
    expect(fallback.calls).toHaveLength(0);
  });

  it("never throws even if resolveImageData throws", async () => {
    const primary = new FakeRankingClient("Google", []);
    const fallback = new FakeRankingClient("OpenAI", []);

    const orchestrator = new CandidateRankingOrchestrator({
      primaryClient: primary,
      fallbackClient: fallback,
      policy: {
        allowCloudVisualQA: true,
        allowedProviders: new Set(["Google", "OpenAI"]),
        sensitiveDataMasking: false
      }
    });

    const throwingContext: CandidateRankingContext = {
      sceneId: "scene-1" as SceneId,
      shotDescription: "Sunset",
      resolveImageData: async () => {
        throw new Error("Storage unreachable");
      }
    };

    const result = await orchestrator.rank(candidates, throwingContext);
    expect(result.map((c) => c.variantOrdinal)).toEqual([1, 2, 3]);
  });

  it("fails closed and returns unranked candidates without calling resolveImageData or providers when sensitiveDataMasking=true", async () => {
    const primary = new FakeRankingClient("Google", [
      { kind: "success", rankedOrdinals: [3, 1, 2] }
    ]);
    const fallback = new FakeRankingClient("OpenAI", [
      { kind: "success", rankedOrdinals: [3, 1, 2] }
    ]);
    const resolveSpy = vi.fn(async () => ({ base64Data: "abc", mimeType: "image/png" }));

    const orchestrator = new CandidateRankingOrchestrator({
      primaryClient: primary,
      fallbackClient: fallback,
      policy: {
        allowCloudVisualQA: true,
        allowedProviders: new Set(["Google", "OpenAI"]),
        sensitiveDataMasking: true
      }
    });

    const result = await orchestrator.rank(candidates, {
      ...context,
      resolveImageData: resolveSpy
    });

    expect(result.map((c) => c.variantOrdinal)).toEqual([1, 2, 3]);
    expect(resolveSpy).not.toHaveBeenCalled();
    expect(primary.calls).toHaveLength(0);
    expect(fallback.calls).toHaveLength(0);
  });

  it("aborts image resolution and returns unranked candidates when overall timeout fires during resolveImageData", async () => {
    const primary = new FakeRankingClient("Google", [
      { kind: "success", rankedOrdinals: [3, 1, 2] }
    ]);
    const fallback = new FakeRankingClient("OpenAI", []);

    const orchestrator = new CandidateRankingOrchestrator({
      primaryClient: primary,
      fallbackClient: fallback,
      policy: {
        allowCloudVisualQA: true,
        allowedProviders: new Set(["Google", "OpenAI"]),
        sensitiveDataMasking: false
      },
      overallTimeoutMs: 30
    });

    const slowContext: CandidateRankingContext = {
      sceneId: "scene-1" as SceneId,
      shotDescription: "Sunset",
      resolveImageData: async (_candidate, signal) => {
        return new Promise((resolve, reject) => {
          const timer = setTimeout(() => {
            resolve({ base64Data: "data", mimeType: "image/png" });
          }, 200);
          signal?.addEventListener("abort", () => {
            clearTimeout(timer);
            reject(new Error("aborted"));
          });
        });
      }
    };

    const start = Date.now();
    const result = await orchestrator.rank(candidates, slowContext);
    const duration = Date.now() - start;

    expect(result.map((c) => c.variantOrdinal)).toEqual([1, 2, 3]);
    expect(duration).toBeLessThan(150);
    expect(primary.calls).toHaveLength(0);
  });

  it("decodes policy defaults safely via decodeVisualQaAuthorizationPolicy", () => {
    expect(decodeVisualQaAuthorizationPolicy(undefined)).toEqual({
      allowCloudVisualQA: false,
      allowedProviders: new Set(),
      sensitiveDataMasking: true
    });

    expect(decodeVisualQaAuthorizationPolicy(null)).toEqual({
      allowCloudVisualQA: false,
      allowedProviders: new Set(),
      sensitiveDataMasking: true
    });

    expect(
      decodeVisualQaAuthorizationPolicy({
        allowCloudVisualQA: true,
        allowedProviders: ["Google", "OpenAI", 123],
        sensitiveDataMasking: false
      })
    ).toEqual({
      allowCloudVisualQA: true,
      allowedProviders: new Set(["Google", "OpenAI"]),
      sensitiveDataMasking: false
    });
  });

  it("evaluates decideRankingFallback correctly", () => {
    expect(decideRankingFallback({ kind: "success", rankedOrdinals: [1, 2] }, 1)).toBe(
      "terminal_success"
    );
    expect(
      decideRankingFallback(
        { kind: "safety_refusal", httpStatus: 403, message: "Safety refusal" },
        1
      )
    ).toBe("terminal_safety_refusal");
    expect(
      decideRankingFallback(
        { kind: "retryable_failure", httpStatus: 429, message: "Rate limit" },
        1
      )
    ).toBe("retry_same");
    expect(
      decideRankingFallback(
        { kind: "retryable_failure", httpStatus: 429, message: "Rate limit" },
        2
      )
    ).toBe("fallback");
    expect(
      decideRankingFallback(
        { kind: "permanent_failure", httpStatus: 400, message: "Bad request" },
        1
      )
    ).toBe("fallback");
  });
});
