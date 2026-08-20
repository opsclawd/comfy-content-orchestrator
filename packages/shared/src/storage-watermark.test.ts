import { describe, expect, it } from "vitest";
import { STORAGE_OPERATION_CLASSES, STORAGE_WATERMARK_STATES } from "./storage-watermark.js";

describe("shared storage watermark primitives", () => {
  it("exports expected watermark state names", () => {
    expect(STORAGE_WATERMARK_STATES).toEqual(["normal", "warning", "degraded", "critical"]);
  });

  it("exports expected storage admission operation classes", () => {
    expect(STORAGE_OPERATION_CLASSES).toEqual([
      "candidate_upload",
      "proxy_upload",
      "delivery_write",
      "cleanup",
      "repair"
    ]);
  });
});
