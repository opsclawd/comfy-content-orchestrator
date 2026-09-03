import { describe, expect, it } from "vitest";
import type {
  ReviewEventStore,
  SceneRepository,
  StoryboardCandidateRepository,
  UnitOfWork
} from "../ports/index.js";
import { InMemorySceneUnitOfWork } from "../test-support/in-memory-scene-unit-of-work.js";
import {
  CreateClientUseCase,
  DEFAULT_ASPECT_RATIO,
  DEFAULT_EXTERNAL_PROCESSING_POLICY
} from "./create-client.js";

describe("CreateClientUseCase", () => {
  it("creates a client with explicit fields and persists it", async () => {
    const uow = new InMemorySceneUnitOfWork();
    const useCase = new CreateClientUseCase(uow);

    const explicitBrandBible = { palette: ["#FF5722", "#212121"] };
    const explicitPolicy = {
      allowCloudPlanning: false,
      allowCloudVisualQA: false,
      allowCloudVoice: false,
      allowedProviders: ["Anthropic"],
      sensitiveDataMasking: true
    };

    const result = await useCase.execute({
      companyName: "Acme Productions Ltd",
      brandBibleJson: explicitBrandBible,
      defaultAspectRatio: "1:1",
      externalProcessingPolicy: explicitPolicy
    });

    expect(result.id).toBeDefined();
    expect(result.companyName).toBe("Acme Productions Ltd");
    expect(result.brandBibleJson).toEqual(explicitBrandBible);
    expect(result.defaultAspectRatio).toBe("1:1");
    expect(result.externalProcessingPolicy).toEqual(explicitPolicy);
    expect(result.createdAt).toBeDefined();
    expect(result.updatedAt).toBe(result.createdAt);

    expect(uow.savedClients).toHaveLength(1);
    expect(uow.savedClients[0]).toEqual(result);
  });

  it("applies defaults for brandBibleJson, defaultAspectRatio, and externalProcessingPolicy when omitted", async () => {
    const uow = new InMemorySceneUnitOfWork();
    const useCase = new CreateClientUseCase(uow);

    const result = await useCase.execute({
      companyName: "Minimal Client Inc"
    });

    expect(result.id).toBeDefined();
    expect(result.companyName).toBe("Minimal Client Inc");
    expect(result.brandBibleJson).toEqual({});
    expect(result.defaultAspectRatio).toBe(DEFAULT_ASPECT_RATIO);
    expect(result.externalProcessingPolicy).toEqual(DEFAULT_EXTERNAL_PROCESSING_POLICY);
    expect(result.createdAt).toBeDefined();
    expect(result.updatedAt).toBe(result.createdAt);

    expect(uow.savedClients).toHaveLength(1);
    expect(uow.savedClients[0]).toEqual(result);
  });

  it("throws clear error when context.clients is undefined", async () => {
    const fakeUowWithoutClients: UnitOfWork = {
      execute: async (work) => {
        return work({
          scenes: {} as unknown as SceneRepository,
          reviewEvents: {} as unknown as ReviewEventStore,
          candidates: {} as unknown as StoryboardCandidateRepository,
          clients: undefined
        });
      }
    };

    const useCase = new CreateClientUseCase(fakeUowWithoutClients);

    await expect(
      useCase.execute({
        companyName: "Will Fail"
      })
    ).rejects.toThrow(
      "UnitOfWorkContext.clients is not configured for this UnitOfWork implementation."
    );
  });
});
