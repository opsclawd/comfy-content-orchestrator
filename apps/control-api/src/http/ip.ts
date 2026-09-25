import net from "node:net";

export function normalizeIpAddress(ip: string): string {
  const trimmed = ip.trim();
  const ipVersion = net.isIP(trimmed);
  if (ipVersion === 0) {
    throw new Error(`Invalid IP literal: '${ip}'`);
  }
  if (ipVersion === 4) {
    return trimmed;
  }
  const lower = trimmed.toLowerCase();
  if (lower.startsWith("::ffff:")) {
    const v4Candidate = lower.slice(7);
    if (net.isIP(v4Candidate) === 4) {
      return v4Candidate;
    }
  }
  return lower;
}
