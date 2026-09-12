import { describe, expect, it } from "vitest";
import { sortKeysDeep } from "./json-canonicalization.js";

describe("sortKeysDeep", () => {
  it("leaves primitives and null untouched", () => {
    expect(sortKeysDeep("hello")).toBe("hello");
    expect(sortKeysDeep(123)).toBe(123);
    expect(sortKeysDeep(true)).toBe(true);
    expect(sortKeysDeep(null)).toBe(null);
  });

  it("sorts shallow object keys lexicographically", () => {
    const input = { z: 1, a: 2, m: 3 };
    const sorted = sortKeysDeep(input);
    expect(Object.keys(sorted as object)).toEqual(["a", "m", "z"]);
    expect(JSON.stringify(sorted)).toBe('{"a":2,"m":3,"z":1}');
  });

  it("sorts deep nested object keys recursively", () => {
    const input = {
      b: { z: 1, a: 2 },
      a: { y: "value", x: { d: 4, c: 3 } }
    };
    const sorted = sortKeysDeep(input);
    expect(JSON.stringify(sorted)).toBe('{"a":{"x":{"c":3,"d":4},"y":"value"},"b":{"a":2,"z":1}}');
  });

  it("handles arrays recursively without reordering array elements", () => {
    const input = [
      { z: 1, a: 2 },
      { y: 3, x: 4 }
    ];
    const sorted = sortKeysDeep(input);
    expect(JSON.stringify(sorted)).toBe('[{"a":2,"z":1},{"x":4,"y":3}]');
  });

  it("omits undefined properties from objects", () => {
    const input = {
      a: 1,
      b: undefined,
      c: {
        d: undefined,
        e: "present"
      }
    };
    const sorted = sortKeysDeep(input);
    expect(sorted).toEqual({
      a: 1,
      c: {
        e: "present"
      }
    });
    expect(JSON.stringify(sorted)).toBe('{"a":1,"c":{"e":"present"}}');
  });
});
