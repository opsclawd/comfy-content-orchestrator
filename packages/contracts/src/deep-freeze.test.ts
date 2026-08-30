import { describe, expect, it } from "vitest";
import { deepFreeze } from "./deep-freeze.js";

describe("deepFreeze utility", () => {
  it("deeply freezes nested objects and arrays", () => {
    const obj = {
      name: "test",
      nested: {
        count: 42,
        list: [1, 2, 3]
      }
    };

    const frozen = deepFreeze(obj);
    expect(Object.isFrozen(frozen)).toBe(true);
    expect(Object.isFrozen(frozen.nested)).toBe(true);
    expect(Object.isFrozen(frozen.nested.list)).toBe(true);
  });

  it("handles primitives and null values gracefully", () => {
    expect(deepFreeze(null)).toBe(null);
    expect(deepFreeze(undefined)).toBe(undefined);
    expect(deepFreeze(123)).toBe(123);
    expect(deepFreeze("str")).toBe("str");
  });
});
