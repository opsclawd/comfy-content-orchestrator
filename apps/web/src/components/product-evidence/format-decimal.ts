/**
 * Safe decimal formatting helper.
 * Strictly preserves exact decimal strings (including trailing zeros)
 * without casting through JavaScript Number or IEEE 754 floating point.
 */
export function formatExactDecimal(value: string | null | undefined): string {
  if (value === null || value === undefined || value.trim() === "") {
    return "—";
  }
  return value.trim();
}

/**
 * Format byte length into human-readable notation (e.g. 1.25 MB).
 */
export function formatByteLength(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes <= 0) return "0 B";
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KiB`;
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(2)} MiB`;
  return `${(bytes / (1024 * 1024 * 1024)).toFixed(2)} GiB`;
}

/**
 * Format UTC ISO timestamp into readable string without losing UTC clarity.
 */
export function formatUtcDateTime(isoString: string | null | undefined): string {
  if (!isoString) return "—";
  try {
    const d = new Date(isoString);
    if (Number.isNaN(d.getTime())) return "—";
    return d.toISOString().replace("T", " ").replace("Z", " UTC");
  } catch {
    return "—";
  }
}
