import fs from "node:fs";
import path from "node:path";

export const PINNED_PIPER_VERSION = "v1.8.0";
export const PINNED_PIPER_VOICE_ID = "en_US-lessac-medium";
export const PINNED_PIPER_VOICE_ONNX_SHA256 =
  "5efe09e69902187827af646e1a6e9d269dee769f9877d17b16b1b46eeaaf019f";
export const PINNED_PIPER_VOICE_CONFIG_SHA256 =
  "efe19c417bed055f2d69908248c6ba650fa135bc868b0e6abb3da181dab690a0";
export const PINNED_PIPER_BASE_IMAGE_DIGEST =
  "sha256:9534e5a8e315485d4061ed659af0fd78a284c015f9b73661b41d6bab25604534";
export const PINNED_PIPER_DOCKERFILE_SHA256 =
  "8554cfc2c9dfc4516558ef22f71a0a67c514a9c0874d822c0cf7f34d931af935";
export const DEFAULT_PIPER_VOICE_DIR = "node_modules/.cache/piper-voice";

export interface PinnedPiperVersion {
  readonly version: string;
  readonly voiceId: string;
  readonly voiceDir: string;
  readonly onnxSha256: string;
  readonly configSha256: string;
  readonly baseImageDigest: string;
  readonly dockerfileSha256: string;
}

export function findRepoRoot(startDir?: string): string {
  let curr = startDir ?? process.cwd();
  while (true) {
    if (
      fs.existsSync(path.join(curr, ".piper-version")) ||
      fs.existsSync(path.join(curr, ".kokoro-version")) ||
      fs.existsSync(path.join(curr, "pnpm-workspace.yaml"))
    ) {
      return curr;
    }
    const parent = path.dirname(curr);
    if (parent === curr) break;
    curr = parent;
  }
  return process.cwd();
}

export function loadPinnedPiperVersion(repoRoot: string = findRepoRoot()): PinnedPiperVersion {
  const versionFile = path.join(repoRoot, ".piper-version");
  let version = PINNED_PIPER_VERSION;
  let voiceId = PINNED_PIPER_VOICE_ID;
  let voiceDir = DEFAULT_PIPER_VOICE_DIR;
  let onnxSha256 = PINNED_PIPER_VOICE_ONNX_SHA256;
  let configSha256 = PINNED_PIPER_VOICE_CONFIG_SHA256;
  let baseImageDigest = PINNED_PIPER_BASE_IMAGE_DIGEST;
  let dockerfileSha256 = PINNED_PIPER_DOCKERFILE_SHA256;

  if (fs.existsSync(versionFile)) {
    const content = fs.readFileSync(versionFile, "utf-8");
    const getVar = (name: string): string | undefined => {
      const match = content.match(
        new RegExp(`^\\s*${name}\\s*=\\s*["']?([^"'#\\r\\n]+)["']?`, "m")
      );
      const val = match?.[1];
      return val !== undefined ? val.trim() : undefined;
    };

    version = getVar("PIPER_VERSION") ?? version;
    voiceId = getVar("PIPER_VOICE_ID") ?? voiceId;
    voiceDir = getVar("PIPER_VOICE_DIR") ?? voiceDir;
    onnxSha256 = getVar("PIPER_VOICE_ONNX_SHA256") ?? onnxSha256;
    configSha256 = getVar("PIPER_VOICE_CONFIG_SHA256") ?? configSha256;
    baseImageDigest = getVar("PIPER_BASE_IMAGE_DIGEST") ?? baseImageDigest;
    dockerfileSha256 = getVar("PIPER_DOCKERFILE_SHA256") ?? dockerfileSha256;
  }

  return {
    version,
    voiceId,
    voiceDir,
    onnxSha256,
    configSha256,
    baseImageDigest,
    dockerfileSha256
  };
}
