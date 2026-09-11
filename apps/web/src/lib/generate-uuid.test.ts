import { describe, expect, it } from "vitest";
import { generateUuidV4 } from "./generate-uuid.js";

describe("generateUuidV4", () => {
  it("generates valid RFC 4122 version 4 UUIDs", () => {
    const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

    for (let i = 0; i < 50; i++) {
      const id = generateUuidV4();
      expect(id).toMatch(uuidRegex);
    }
  });

  it("generates unique IDs across successive calls", () => {
    const ids = new Set<string>();
    for (let i = 0; i < 100; i++) {
      const id = generateUuidV4();
      expect(ids.has(id)).toBe(false);
      ids.add(id);
    }
    expect(ids.size).toBe(100);
  });
});
