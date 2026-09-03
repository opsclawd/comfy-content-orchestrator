import { describe, it, expect } from "vitest";
import type { ClientRecord } from "./client.js";

describe("ClientRecord domain model", () => {
  it("allows instantiation of a valid ClientRecord object", () => {
    const record: ClientRecord = {
      id: "018e69e0-8a6a-72cb-b1b7-ec79a1f73801",
      companyName: "Acme Studios",
      brandBibleJson: { palette: ["#ffffff", "#000000"] },
      defaultAspectRatio: "9:16",
      externalProcessingPolicy: { allowCloudPlanning: true },
      createdAt: "2026-09-03T12:00:00.000Z",
      updatedAt: "2026-09-03T12:00:00.000Z"
    };

    expect(record.id).toBe("018e69e0-8a6a-72cb-b1b7-ec79a1f73801");
    expect(record.companyName).toBe("Acme Studios");
    expect(record.brandBibleJson).toEqual({ palette: ["#ffffff", "#000000"] });
    expect(record.defaultAspectRatio).toBe("9:16");
    expect(record.externalProcessingPolicy).toEqual({ allowCloudPlanning: true });
    expect(record.createdAt).toBe("2026-09-03T12:00:00.000Z");
    expect(record.updatedAt).toBe("2026-09-03T12:00:00.000Z");
  });
});
