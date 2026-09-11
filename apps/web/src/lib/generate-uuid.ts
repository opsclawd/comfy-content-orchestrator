// crypto.randomUUID() requires a secure context (HTTPS or localhost) and is
// undefined otherwise, which this deployment's plain-HTTP tailnet transport
// does not satisfy (see issue #182). crypto.getRandomValues() has no such
// restriction, so build a standard RFC 4122 v4 UUID from it directly rather
// than relying on the secure-context-only convenience API. These IDs are
// client-generated idempotency keys, not security-sensitive secrets — the
// server independently enforces idempotency via requestHashSha256/DB
// constraints, so a getRandomValues-backed generator is sufficient here.
export function generateUuidV4(): string {
  const bytes = new Uint8Array(16);
  crypto.getRandomValues(bytes);
  bytes[6] = (bytes[6]! & 0x0f) | 0x40;
  bytes[8] = (bytes[8]! & 0x3f) | 0x80;
  const hex = Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}
