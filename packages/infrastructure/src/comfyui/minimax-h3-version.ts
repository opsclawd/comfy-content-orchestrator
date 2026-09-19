import fs from "node:fs";
import path from "node:path";

export const PINNED_MINIMAX_H3_VERSION = "v1.0.0";
export const PINNED_MINIMAX_H3_REPO = "Comfy-Org/MiniMax-H3";
export const PINNED_MINIMAX_H3_REVISION = "7e75982b97cd5a41d2dcfa1904ee88d0686d6fd1";

export const PINNED_MINIMAX_H3_DIFFUSION_REF2VA_FILE =
  "diffusion_models/minimax_h3_ref2va_pruned_int8_convrot.safetensors";
export const PINNED_MINIMAX_H3_DIFFUSION_REF2VA_SHA256 =
  "9255f52b6677845ad238f20dfaafa94727053694127ab7f255c048f0f9365779";
export const PINNED_MINIMAX_H3_DIFFUSION_REF2VA_SIZE = 20970379616;

export const PINNED_MINIMAX_H3_DIFFUSION_FL2VA_FILE =
  "diffusion_models/minimax_h3_fl2va_pruned_int8_convrot.safetensors";
export const PINNED_MINIMAX_H3_DIFFUSION_FL2VA_SHA256 =
  "e889202c41dafb67b10d67b97f0d8541508036a6090af23425a5c2615d03c47a";
export const PINNED_MINIMAX_H3_DIFFUSION_FL2VA_SIZE = 20970379616;

export const PINNED_MINIMAX_H3_TEXT_ENCODER_FILE =
  "text_encoders/qwen3vl_32b_minimax_h3_nvfp4_awq.safetensors";
export const PINNED_MINIMAX_H3_TEXT_ENCODER_SHA256 =
  "35a88d51044231fe332301d7a62aa81e3f2cba62febeb446e2c1e3e0ef76f2c6";
export const PINNED_MINIMAX_H3_TEXT_ENCODER_SIZE = 15687142551;

export const PINNED_MINIMAX_H3_VIDEO_VAE_FILE = "vae/minimax_h3_video_vae_int8_convrot.safetensors";
export const PINNED_MINIMAX_H3_VIDEO_VAE_SHA256 =
  "52a2c8c73583c86e4f41cdcce3a6ad0ea562987bc0bf3d60a0cef5f5c8e60c0e";
export const PINNED_MINIMAX_H3_VIDEO_VAE_SIZE = 2811065184;

export const PINNED_MINIMAX_H3_AUDIO_VAE_FILE = "vae/minimax_h3_audio_vae_fp32.safetensors";
export const PINNED_MINIMAX_H3_AUDIO_VAE_SHA256 =
  "8e505d95dd1561d47abd43d4238fd40d9bb1ae9e147ed0a4cba778d76ae4db48";
export const PINNED_MINIMAX_H3_AUDIO_VAE_SIZE = 605254808;

export interface PinnedMiniMaxH3Version {
  readonly version: string;
  readonly repository: string;
  readonly revision: string;
  readonly diffusionRef2vaFile: string;
  readonly diffusionRef2vaSha256: string;
  readonly diffusionRef2vaSize: number;
  readonly diffusionFl2vaFile: string;
  readonly diffusionFl2vaSha256: string;
  readonly diffusionFl2vaSize: number;
  readonly textEncoderFile: string;
  readonly textEncoderSha256: string;
  readonly textEncoderSize: number;
  readonly videoVaeFile: string;
  readonly videoVaeSha256: string;
  readonly videoVaeSize: number;
  readonly audioVaeFile: string;
  readonly audioVaeSha256: string;
  readonly audioVaeSize: number;
}

export function findRepoRoot(startDir?: string): string {
  let curr = startDir ?? process.cwd();
  while (true) {
    if (
      fs.existsSync(path.join(curr, ".minimax-h3-version")) ||
      fs.existsSync(path.join(curr, ".piper-version")) ||
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

export function loadPinnedMiniMaxH3Version(
  repoRoot: string = findRepoRoot()
): PinnedMiniMaxH3Version {
  const versionFile = path.join(repoRoot, ".minimax-h3-version");
  let version = PINNED_MINIMAX_H3_VERSION;
  let repository = PINNED_MINIMAX_H3_REPO;
  let revision = PINNED_MINIMAX_H3_REVISION;
  let diffusionRef2vaFile = PINNED_MINIMAX_H3_DIFFUSION_REF2VA_FILE;
  let diffusionRef2vaSha256 = PINNED_MINIMAX_H3_DIFFUSION_REF2VA_SHA256;
  let diffusionRef2vaSize = PINNED_MINIMAX_H3_DIFFUSION_REF2VA_SIZE;
  let diffusionFl2vaFile = PINNED_MINIMAX_H3_DIFFUSION_FL2VA_FILE;
  let diffusionFl2vaSha256 = PINNED_MINIMAX_H3_DIFFUSION_FL2VA_SHA256;
  let diffusionFl2vaSize = PINNED_MINIMAX_H3_DIFFUSION_FL2VA_SIZE;
  let textEncoderFile = PINNED_MINIMAX_H3_TEXT_ENCODER_FILE;
  let textEncoderSha256 = PINNED_MINIMAX_H3_TEXT_ENCODER_SHA256;
  let textEncoderSize = PINNED_MINIMAX_H3_TEXT_ENCODER_SIZE;
  let videoVaeFile = PINNED_MINIMAX_H3_VIDEO_VAE_FILE;
  let videoVaeSha256 = PINNED_MINIMAX_H3_VIDEO_VAE_SHA256;
  let videoVaeSize = PINNED_MINIMAX_H3_VIDEO_VAE_SIZE;
  let audioVaeFile = PINNED_MINIMAX_H3_AUDIO_VAE_FILE;
  let audioVaeSha256 = PINNED_MINIMAX_H3_AUDIO_VAE_SHA256;
  let audioVaeSize = PINNED_MINIMAX_H3_AUDIO_VAE_SIZE;

  if (fs.existsSync(versionFile)) {
    const content = fs.readFileSync(versionFile, "utf-8");
    const getVar = (name: string): string | undefined => {
      const match = content.match(
        new RegExp(`^\\s*${name}\\s*=\\s*["']?([^"'#\\r\\n]+)["']?`, "m")
      );
      const val = match?.[1];
      return val !== undefined ? val.trim() : undefined;
    };

    version = getVar("MINIMAX_H3_VERSION") ?? version;
    repository = getVar("MINIMAX_H3_REPO") ?? repository;
    revision = getVar("MINIMAX_H3_REVISION") ?? revision;
    diffusionRef2vaFile = getVar("MINIMAX_H3_DIFFUSION_REF2VA_FILE") ?? diffusionRef2vaFile;
    diffusionRef2vaSha256 = getVar("MINIMAX_H3_DIFFUSION_REF2VA_SHA256") ?? diffusionRef2vaSha256;
    diffusionRef2vaSize = Number(getVar("MINIMAX_H3_DIFFUSION_REF2VA_SIZE")) || diffusionRef2vaSize;
    diffusionFl2vaFile = getVar("MINIMAX_H3_DIFFUSION_FL2VA_FILE") ?? diffusionFl2vaFile;
    diffusionFl2vaSha256 = getVar("MINIMAX_H3_DIFFUSION_FL2VA_SHA256") ?? diffusionFl2vaSha256;
    diffusionFl2vaSize = Number(getVar("MINIMAX_H3_DIFFUSION_FL2VA_SIZE")) || diffusionFl2vaSize;
    textEncoderFile = getVar("MINIMAX_H3_TEXT_ENCODER_FILE") ?? textEncoderFile;
    textEncoderSha256 = getVar("MINIMAX_H3_TEXT_ENCODER_SHA256") ?? textEncoderSha256;
    textEncoderSize = Number(getVar("MINIMAX_H3_TEXT_ENCODER_SIZE")) || textEncoderSize;
    videoVaeFile = getVar("MINIMAX_H3_VIDEO_VAE_FILE") ?? videoVaeFile;
    videoVaeSha256 = getVar("MINIMAX_H3_VIDEO_VAE_SHA256") ?? videoVaeSha256;
    videoVaeSize = Number(getVar("MINIMAX_H3_VIDEO_VAE_SIZE")) || videoVaeSize;
    audioVaeFile = getVar("MINIMAX_H3_AUDIO_VAE_FILE") ?? audioVaeFile;
    audioVaeSha256 = getVar("MINIMAX_H3_AUDIO_VAE_SHA256") ?? audioVaeSha256;
    audioVaeSize = Number(getVar("MINIMAX_H3_AUDIO_VAE_SIZE")) || audioVaeSize;
  }

  return {
    version,
    repository,
    revision,
    diffusionRef2vaFile,
    diffusionRef2vaSha256,
    diffusionRef2vaSize,
    diffusionFl2vaFile,
    diffusionFl2vaSha256,
    diffusionFl2vaSize,
    textEncoderFile,
    textEncoderSha256,
    textEncoderSize,
    videoVaeFile,
    videoVaeSha256,
    videoVaeSize,
    audioVaeFile,
    audioVaeSha256,
    audioVaeSize
  };
}
