import { describe, it, expect } from "vitest";
import type {
  PlanningModelClientPort,
  PlanningModelOutcome,
  PlanningModelRequest
} from "../ports/planning-model-client-port.js";
import {
  PlanningOrchestrationKernel,
  decodePlanningAuthorizationPolicy
} from "./planning-orchestration-kernel.js";
import {
  PlanningNotAuthorizedError,
  PlanningSafetyRefusalError,
  PlanningProviderExhaustedError
} from "./plan-scene-configuration-errors.js";

class MockPlanningClient implements PlanningModelClientPort {
  readonly calls: PlanningModelRequest[] = [];
  outcomeQueue: PlanningModelOutcome[] = [];

  constructor(
    readonly providerName: "Anthropic" | "OpenAI",
    readonly imageCapability: boolean = false,
    readonly maxImages: number = 9,
    initialOutcomes: PlanningModelOutcome[] = []
  ) {
    this.outcomeQueue = [...initialOutcomes];
  }

  get supportsImages(): boolean {
    return this.imageCapability;
  }

  async complete(request: PlanningModelRequest): Promise<PlanningModelOutcome> {
    this.calls.push(request);
    const nextOutcome = this.outcomeQueue.shift();
    if (!nextOutcome) {
      return {
        kind: "success",
        rawText: JSON.stringify({ ok: true, provider: this.providerName })
      };
    }
    return nextOutcome;
  }
}

describe("PlanningOrchestrationKernel", () => {
  const defaultPolicy = decodePlanningAuthorizationPolicy({
    allowCloudPlanning: true,
    allowedProviders: ["Anthropic", "OpenAI"],
    sensitiveDataMasking: true
  });

  const testImages = [
    { mimeType: "image/png" as const, base64Data: "BASE64_IMG_1" },
    { mimeType: "image/jpeg" as const, base64Data: "BASE64_IMG_2" }
  ];

  it("projects text-only request to primary Anthropic client and succeeds without calling fallback", async () => {
    const primaryClient = new MockPlanningClient("Anthropic", false, 0);
    const fallbackClient = new MockPlanningClient("OpenAI", true, 9);

    const kernel = new PlanningOrchestrationKernel({
      primaryClient,
      fallbackClient
    });

    const result = await kernel.run<{ ok: boolean }>({
      policy: defaultPolicy,
      buildRequest: () => ({
        systemPrompt: "System instruction",
        userPrompt: "Generate plan",
        images: testImages,
        bindingCount: 2,
        maxImages: 9
      }),
      parseAndValidate: (raw) => JSON.parse(raw)
    });

    expect(result.ok).toBe(true);
    expect(primaryClient.calls).toHaveLength(1);
    const primaryCall = primaryClient.calls[0];
    expect(primaryCall?.userPrompt).toBe("Generate plan");
    // Primary Anthropic client does not have image capability, so images are stripped
    expect(primaryCall?.images).toBeUndefined();
    expect(primaryCall?.bindingCount).toBeUndefined();
    expect(primaryCall?.maxImages).toBeUndefined();

    // Fallback is never invoked on success
    expect(fallbackClient.calls).toHaveLength(0);
  });

  it("forwards image-bearing request to image-capable OpenAI fallback when Anthropic fails permanently", async () => {
    const primaryClient = new MockPlanningClient("Anthropic", false, 0, [
      { kind: "permanent_failure", httpStatus: 400, message: "Anthropic Bad Request" }
    ]);
    const fallbackClient = new MockPlanningClient("OpenAI", true, 9);

    const kernel = new PlanningOrchestrationKernel({
      primaryClient,
      fallbackClient
    });

    const result = await kernel.run<{ ok: boolean; provider: string }>({
      policy: defaultPolicy,
      buildRequest: () => ({
        systemPrompt: "System instruction",
        userPrompt: "Generate plan",
        images: testImages,
        bindingCount: 2,
        maxImages: 9
      }),
      parseAndValidate: (raw) => JSON.parse(raw)
    });

    expect(result.ok).toBe(true);
    expect(result.provider).toBe("OpenAI");

    // Primary Anthropic received text-only projection
    expect(primaryClient.calls).toHaveLength(1);
    expect(primaryClient.calls[0]?.images).toBeUndefined();

    // Fallback OpenAI received full image-bearing request
    expect(fallbackClient.calls).toHaveLength(1);
    const fallbackCall = fallbackClient.calls[0];
    expect(fallbackCall?.images).toEqual(testImages);
    expect(fallbackCall?.bindingCount).toBe(2);
    expect(fallbackCall?.maxImages).toBe(9);
  });

  it("strips images for fallback client if fallback client is also not image-capable", async () => {
    const primaryClient = new MockPlanningClient("Anthropic", false, 0, [
      { kind: "permanent_failure", httpStatus: 500, message: "Primary 500" }
    ]);
    const fallbackClient = new MockPlanningClient("OpenAI", false, 0);

    const kernel = new PlanningOrchestrationKernel({
      primaryClient,
      fallbackClient
    });

    const result = await kernel.run<{ ok: boolean; provider: string }>({
      policy: defaultPolicy,
      buildRequest: () => ({
        systemPrompt: "System instruction",
        userPrompt: "Generate plan",
        images: testImages,
        bindingCount: 2,
        maxImages: 9
      }),
      parseAndValidate: (raw) => JSON.parse(raw)
    });

    expect(result.ok).toBe(true);
    expect(result.provider).toBe("OpenAI");

    expect(fallbackClient.calls).toHaveLength(1);
    const fallbackCall = fallbackClient.calls[0];
    expect(fallbackCall?.images).toBeUndefined();
    expect(fallbackCall?.bindingCount).toBeUndefined();
    expect(fallbackCall?.maxImages).toBeUndefined();
  });

  it("corrective retry retains image projection rules for both primary and fallback", async () => {
    // Primary fails validation on raw response, retries on same provider with text-only projection, then still fails
    const primaryClient = new MockPlanningClient("Anthropic", false, 0, [
      { kind: "success", rawText: "INVALID_JSON_1" },
      { kind: "success", rawText: "INVALID_JSON_2" }
    ]);
    // Fallback also receives invalid JSON first, retries with corrective feedback retaining full images, then succeeds
    const fallbackClient = new MockPlanningClient("OpenAI", true, 9, [
      { kind: "success", rawText: "INVALID_JSON_FALLBACK" },
      { kind: "success", rawText: JSON.stringify({ ok: true, provider: "OpenAI" }) }
    ]);

    const kernel = new PlanningOrchestrationKernel({
      primaryClient,
      fallbackClient
    });

    const result = await kernel.run<{ ok: boolean; provider: string }>({
      policy: defaultPolicy,
      buildRequest: (feedback) => ({
        systemPrompt: "System instruction",
        userPrompt: feedback ? `Fix plan: ${feedback}` : "Generate plan",
        images: testImages,
        bindingCount: 2,
        maxImages: 9
      }),
      parseAndValidate: (raw) => JSON.parse(raw)
    });

    expect(result.ok).toBe(true);
    expect(result.provider).toBe("OpenAI");

    // Primary: 2 calls, both text-only
    expect(primaryClient.calls).toHaveLength(2);
    expect(primaryClient.calls[0]?.images).toBeUndefined();
    expect(primaryClient.calls[1]?.images).toBeUndefined();
    expect(primaryClient.calls[1]?.userPrompt).toContain("Fix plan:");

    // Fallback: 2 calls, both retain images
    expect(fallbackClient.calls).toHaveLength(2);
    expect(fallbackClient.calls[0]?.images).toEqual(testImages);
    expect(fallbackClient.calls[1]?.images).toEqual(testImages);
    expect(fallbackClient.calls[1]?.userPrompt).toContain("Fix plan:");
  });

  it("terminates immediately with PlanningSafetyRefusalError on primary safety refusal without invoking fallback", async () => {
    const primaryClient = new MockPlanningClient("Anthropic", false, 0, [
      { kind: "safety_refusal", httpStatus: 403, message: "Safety refusal: prohibited content" }
    ]);
    const fallbackClient = new MockPlanningClient("OpenAI", true, 9);

    const kernel = new PlanningOrchestrationKernel({
      primaryClient,
      fallbackClient
    });

    await expect(
      kernel.run({
        policy: defaultPolicy,
        buildRequest: () => ({
          systemPrompt: "System instruction",
          userPrompt: "Generate plan",
          images: testImages
        }),
        parseAndValidate: (raw) => JSON.parse(raw)
      })
    ).rejects.toThrow(PlanningSafetyRefusalError);

    expect(primaryClient.calls).toHaveLength(1);
    expect(fallbackClient.calls).toHaveLength(0);
  });

  it("fails closed when cloud planning is disabled in policy", async () => {
    const primaryClient = new MockPlanningClient("Anthropic", false, 0);
    const fallbackClient = new MockPlanningClient("OpenAI", true, 9);

    const kernel = new PlanningOrchestrationKernel({
      primaryClient,
      fallbackClient
    });

    await expect(
      kernel.run({
        policy: {
          allowCloudPlanning: false,
          allowedProviders: new Set(["Anthropic", "OpenAI"]),
          sensitiveDataMasking: true
        },
        buildRequest: () => ({
          systemPrompt: "System",
          userPrompt: "User"
        }),
        parseAndValidate: (raw) => JSON.parse(raw)
      })
    ).rejects.toThrow(PlanningNotAuthorizedError);

    expect(primaryClient.calls).toHaveLength(0);
    expect(fallbackClient.calls).toHaveLength(0);
  });

  it("fails closed when fallback provider is not allowed in policy", async () => {
    const primaryClient = new MockPlanningClient("Anthropic", false, 0, [
      { kind: "permanent_failure", httpStatus: 500, message: "Primary 500" }
    ]);
    const fallbackClient = new MockPlanningClient("OpenAI", true, 9);

    const kernel = new PlanningOrchestrationKernel({
      primaryClient,
      fallbackClient
    });

    await expect(
      kernel.run({
        policy: {
          allowCloudPlanning: true,
          allowedProviders: new Set(["Anthropic"]), // OpenAI not allowed
          sensitiveDataMasking: true
        },
        buildRequest: () => ({
          systemPrompt: "System",
          userPrompt: "User"
        }),
        parseAndValidate: (raw) => JSON.parse(raw)
      })
    ).rejects.toThrow(PlanningNotAuthorizedError);

    expect(primaryClient.calls).toHaveLength(1);
    expect(fallbackClient.calls).toHaveLength(0);
  });

  it("throws PlanningProviderExhaustedError when both primary and fallback fail", async () => {
    const primaryClient = new MockPlanningClient("Anthropic", false, 0, [
      { kind: "permanent_failure", httpStatus: 500, message: "Primary 500" }
    ]);
    const fallbackClient = new MockPlanningClient("OpenAI", true, 9, [
      { kind: "permanent_failure", httpStatus: 502, message: "Fallback 502" }
    ]);

    const kernel = new PlanningOrchestrationKernel({
      primaryClient,
      fallbackClient
    });

    await expect(
      kernel.run({
        policy: defaultPolicy,
        buildRequest: () => ({
          systemPrompt: "System",
          userPrompt: "User"
        }),
        parseAndValidate: (raw) => JSON.parse(raw)
      })
    ).rejects.toThrow(PlanningProviderExhaustedError);

    expect(primaryClient.calls).toHaveLength(1);
    expect(fallbackClient.calls).toHaveLength(1);
  });
});
