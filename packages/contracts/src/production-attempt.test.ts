import { describe, expect, it } from "vitest";
import {
  CurrentProductionAttemptReadModelSchema,
  PRODUCTION_ATTEMPT_AVAILABILITIES,
  PRODUCTION_ATTEMPT_TECHNICAL_STATES,
  ProductionAttemptAvailabilitySchema,
  ProductionAttemptMediaReadModelSchema,
  ProductionAttemptTechnicalStateSchema
} from "./production-attempt.js";

describe("ProductionAttempt Contracts", () => {
  it("validates technical states", () => {
    for (const state of PRODUCTION_ATTEMPT_TECHNICAL_STATES) {
      expect(ProductionAttemptTechnicalStateSchema.parse(state)).toBe(state);
    }
    expect(() => ProductionAttemptTechnicalStateSchema.parse("invalid")).toThrow();
  });

  it("validates availabilities", () => {
    for (const avail of PRODUCTION_ATTEMPT_AVAILABILITIES) {
      expect(ProductionAttemptAvailabilitySchema.parse(avail)).toBe(avail);
    }
    expect(() => ProductionAttemptAvailabilitySchema.parse("unknown")).toThrow();
  });

  it("validates media read model schema", () => {
    const valid = {
      url: "https://example.com/video.mp4?signed=1",
      generationManifestId: "01950c46-9e90-7d3d-82d2-8f1d3c000001"
    };
    expect(ProductionAttemptMediaReadModelSchema.parse(valid)).toEqual(valid);

    expect(() =>
      ProductionAttemptMediaReadModelSchema.parse({
        url: "",
        generationManifestId: "not-a-uuid"
      })
    ).toThrow();
  });

  it("validates current production attempt read model schema", () => {
    const valid = {
      runId: "01950c46-9e90-7d3d-82d2-8f1d3c000001",
      sceneId: "01950c46-9e90-7d3d-82d2-8f1d3c000002",
      specRevision: 1,
      attemptOrdinal: 1,
      productionJobId: "01950c46-9e90-7d3d-82d2-8f1d3c000003",
      technicalState: "completed",
      reviewReady: true,
      availability: "available",
      media: {
        url: "https://example.com/video.mp4?token=abc",
        generationManifestId: "01950c46-9e90-7d3d-82d2-8f1d3c000004"
      }
    };
    expect(CurrentProductionAttemptReadModelSchema.parse(valid)).toEqual(valid);
  });

  it("validates read model without media for unavailable/missing_manifest/inconsistent", () => {
    const missing = {
      runId: "01950c46-9e90-7d3d-82d2-8f1d3c000001",
      sceneId: "01950c46-9e90-7d3d-82d2-8f1d3c000002",
      specRevision: 2,
      attemptOrdinal: 1,
      productionJobId: "01950c46-9e90-7d3d-82d2-8f1d3c000003",
      technicalState: "completed",
      reviewReady: false,
      availability: "missing_manifest"
    };
    expect(CurrentProductionAttemptReadModelSchema.parse(missing)).toEqual(missing);
  });
});
