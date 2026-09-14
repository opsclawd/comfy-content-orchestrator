import { describe, expect, it } from "vitest";
import {
  CAMPAIGN_DELIVERY_REEL_STATES,
  CampaignDeliveryMediaReadModelSchema,
  CampaignDeliveryReelReadModelSchema,
  CampaignDeliveryReelStateSchema
} from "./campaign-delivery-reel.js";

describe("CampaignDeliveryReel contracts", () => {
  const campaignId = "01950c46-9e90-7d3d-82d2-8f1d3c000001";
  const runId = "01950c46-9e90-7d3d-82d2-8f1d3c000002";
  const assemblyJobId = "01950c46-9e90-7d3d-82d2-8f1d3c000003";
  const validSha = "a".repeat(64);

  it("defines the canonical five states", () => {
    expect(CAMPAIGN_DELIVERY_REEL_STATES).toEqual([
      "not-started",
      "assembling",
      "completed",
      "failed",
      "unavailable-artifact"
    ]);
  });

  it("validates all five states in CampaignDeliveryReelStateSchema", () => {
    for (const state of CAMPAIGN_DELIVERY_REEL_STATES) {
      expect(CampaignDeliveryReelStateSchema.parse(state)).toBe(state);
    }
    expect(() => CampaignDeliveryReelStateSchema.parse("in-progress")).toThrow();
    expect(() => CampaignDeliveryReelStateSchema.parse("ready")).toThrow();
  });

  it("validates CampaignDeliveryMediaReadModelSchema", () => {
    const validMedia = {
      url: "https://delivery.example.com/output.mp4?sig=123",
      bucket: "delivery",
      key: `campaigns/${campaignId}/assemblies/asm-1/output.mp4`,
      sha256: validSha,
      durationMs: 5000,
      width: 1080,
      height: 1920
    };
    expect(CampaignDeliveryMediaReadModelSchema.parse(validMedia)).toEqual(validMedia);

    // Rejects invalid url
    expect(() =>
      CampaignDeliveryMediaReadModelSchema.parse({
        ...validMedia,
        url: "not-a-url"
      })
    ).toThrow();

    // Rejects invalid sha256
    expect(() =>
      CampaignDeliveryMediaReadModelSchema.parse({
        ...validMedia,
        sha256: "short-hash"
      })
    ).toThrow();
  });

  it("parses not-started read model", () => {
    const model = {
      campaignId,
      status: "not-started" as const,
      state: "not-started" as const,
      updatedAt: "2026-09-13T12:00:00.000Z"
    };
    const parsed = CampaignDeliveryReelReadModelSchema.parse(model);
    expect(parsed).toEqual(model);
  });

  it("parses assembling read model", () => {
    const model = {
      campaignId,
      status: "assembling" as const,
      state: "assembling" as const,
      runId,
      assemblyJobId,
      updatedAt: "2026-09-13T12:00:00.000Z"
    };
    const parsed = CampaignDeliveryReelReadModelSchema.parse(model);
    expect(parsed).toEqual(model);
  });

  it("parses failed read model", () => {
    const model = {
      campaignId,
      status: "failed" as const,
      state: "failed" as const,
      runId,
      assemblyJobId,
      error: "FFmpeg process exited with code 1",
      updatedAt: "2026-09-13T12:00:00.000Z"
    };
    const parsed = CampaignDeliveryReelReadModelSchema.parse(model);
    expect(parsed).toEqual(model);
  });

  it("parses unavailable-artifact read model", () => {
    const model = {
      campaignId,
      status: "unavailable-artifact" as const,
      state: "unavailable-artifact" as const,
      assemblyId: "asm-1",
      reason: "Manifest object was not found in storage",
      updatedAt: "2026-09-13T12:00:00.000Z"
    };
    const parsed = CampaignDeliveryReelReadModelSchema.parse(model);
    expect(parsed).toEqual(model);
  });

  it("parses completed read model with media", () => {
    const model = {
      campaignId,
      status: "completed" as const,
      state: "completed" as const,
      assemblyId: "asm-1",
      runId,
      assemblyJobId,
      media: {
        url: "https://delivery.example.com/output.mp4?sig=123",
        bucket: "delivery",
        key: `campaigns/${campaignId}/assemblies/asm-1/output.mp4`,
        sha256: validSha,
        durationMs: 5000,
        width: 1080,
        height: 1920
      },
      updatedAt: "2026-09-13T12:00:00.000Z"
    };
    const parsed = CampaignDeliveryReelReadModelSchema.parse(model);
    expect(parsed).toEqual(model);
  });

  it("rejects invalid campaignId", () => {
    expect(() =>
      CampaignDeliveryReelReadModelSchema.parse({
        campaignId: "invalid-uuid",
        status: "not-started",
        state: "not-started"
      })
    ).toThrow();
  });
});
