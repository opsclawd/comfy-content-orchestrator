import { createHash } from "node:crypto";

export function deriveProductionSeed(sceneId: string, specRevision: number): number {
  const hash = createHash("sha256").update(`${sceneId}:${specRevision}`).digest();
  // 6 bytes (48 bits) is well within JS Number.MAX_SAFE_INTEGER (53 bits, 9,007,199,254,740,991)
  const seed = hash.readUIntBE(0, 6);
  return seed;
}
