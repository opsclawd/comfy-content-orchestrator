import { describe, expect, it } from "vitest";
import { ComponentLicenseRegistrySchema } from "@cco/contracts";
import {
  buildApprovedAcceptanceRegistrySnapshot,
  withComponentStatus
} from "./component-license-registry-fixtures.js";

describe("component-license-registry-fixtures", () => {
  it("builds a schema-valid approved acceptance registry snapshot", () => {
    const snapshot = buildApprovedAcceptanceRegistrySnapshot();
    const validated = ComponentLicenseRegistrySchema.parse(snapshot);
    expect(validated.registryRevision).toBe("2026-08-29.acceptance-1");
    expect(validated.entries.length).toBeGreaterThanOrEqual(4);

    const ffmpegEntry = validated.entries.find((e) => e.componentId === "ffmpeg");
    expect(ffmpegEntry).toBeDefined();
    expect(ffmpegEntry?.status).toBe("approved");
    expect(ffmpegEntry?.componentType).toBe("runtime");

    const ltxEntry = validated.entries.find((e) => e.componentId === "LTX_25_720P_5S_V1");
    expect(ltxEntry).toBeDefined();
    expect(ltxEntry?.status).toBe("approved");
    expect(ltxEntry?.componentType).toBe("model");
  });

  it("supports custom ffmpegVersion and additional entries", () => {
    const snapshot = buildApprovedAcceptanceRegistrySnapshot({
      ffmpegVersion: "custom-ffmpeg-7.1",
      additionalEntries: [
        {
          componentId: "custom-model",
          componentType: "model",
          versionOrRevision: "2",
          status: "approved",
          licenseSource: "Custom License",
          reviewedAt: "2026-08-29T12:00:00.000Z",
          policyRevision: "2026-08-29.1"
        }
      ]
    });
    const validated = ComponentLicenseRegistrySchema.parse(snapshot);
    const ffmpegEntry = validated.entries.find((e) => e.componentId === "ffmpeg");
    expect(ffmpegEntry?.versionOrRevision).toBe("custom-ffmpeg-7.1");

    const customEntry = validated.entries.find((e) => e.componentId === "custom-model");
    expect(customEntry).toBeDefined();
    expect(customEntry?.status).toBe("approved");
  });

  it("correctly mutates component status with withComponentStatus", () => {
    const snapshot = buildApprovedAcceptanceRegistrySnapshot();

    const restricted = withComponentStatus(snapshot, "LTX_25_720P_5S_V1", "restricted");
    expect(restricted.entries.find((e) => e.componentId === "LTX_25_720P_5S_V1")?.status).toBe(
      "restricted"
    );

    const reviewReq = withComponentStatus(snapshot, "LTX_25_720P_5S_V1", "review_required");
    expect(reviewReq.entries.find((e) => e.componentId === "LTX_25_720P_5S_V1")?.status).toBe(
      "review_required"
    );

    const blocked = withComponentStatus(snapshot, "LTX_25_720P_5S_V1", "blocked");
    expect(blocked.entries.find((e) => e.componentId === "LTX_25_720P_5S_V1")?.status).toBe(
      "blocked"
    );

    const unregistered = withComponentStatus(snapshot, "LTX_25_720P_5S_V1", "unregistered");
    expect(unregistered.entries.find((e) => e.componentId === "LTX_25_720P_5S_V1")).toBeUndefined();
    expect(unregistered.entries.length).toBe(snapshot.entries.length - 1);
  });
});
