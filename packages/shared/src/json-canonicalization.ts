/**
 * Recursively sorts object keys lexicographically and strips undefined properties.
 * Primitives, null, and non-object values are returned as-is. Arrays are recursively processed.
 */
export function sortKeysDeep(value: unknown): unknown {
  if (value === null || typeof value !== "object") {
    return value;
  }
  if (Array.isArray(value)) {
    return value.map(sortKeysDeep);
  }
  const record = value as Record<string, unknown>;
  const sortedKeys = Object.keys(record).sort();
  const result: Record<string, unknown> = {};
  for (const key of sortedKeys) {
    const val = record[key];
    if (val !== undefined) {
      result[key] = sortKeysDeep(val);
    }
  }
  return result;
}
