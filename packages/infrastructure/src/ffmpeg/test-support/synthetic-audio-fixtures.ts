import { createHash } from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import { defaultSpawnRunner, type SpawnLikeFn } from "../ffmpeg-process-runner.js";

export interface SyntheticAudioOptions {
  readonly ffmpegPath?: string | undefined;
  readonly outputPath: string;
  readonly durationSec?: number | undefined;
  readonly frequency?: number | undefined;
  readonly channels?: number | undefined;
  readonly sampleRate?: number | undefined;
  readonly format?: "mp3" | "wav" | undefined;
  readonly spawnFn?: SpawnLikeFn | undefined;
}

export interface SyntheticAudioResult {
  readonly filePath: string;
  readonly bytes: Uint8Array;
  readonly sha256: string;
  readonly durationMs: number;
  readonly contentType: string;
}

export async function generateSyntheticAudio(
  options: SyntheticAudioOptions
): Promise<SyntheticAudioResult> {
  const {
    ffmpegPath = "ffmpeg",
    outputPath,
    durationSec = 5,
    frequency = 440,
    channels = 2,
    sampleRate = 44100,
    format = "mp3",
    spawnFn = defaultSpawnRunner
  } = options;

  await fs.mkdir(path.dirname(outputPath), { recursive: true });

  const channelFilter = channels === 2 ? "pan=stereo|c0=c0|c1=c0" : "aformat=channel_layouts=mono";

  const args = [
    "-y",
    "-f",
    "lavfi",
    "-i",
    `sine=frequency=${frequency}:duration=${durationSec}`,
    "-af",
    `${channelFilter},aresample=${sampleRate}`,
    "-c:a",
    format === "mp3" ? "libmp3lame" : "pcm_s16le",
    outputPath
  ];

  const runResult = await spawnFn(ffmpegPath, args);
  if (runResult.exitCode !== 0) {
    throw new Error(
      `Failed to generate synthetic audio: exit code ${runResult.exitCode}, stderr: ${runResult.stderr}`
    );
  }

  const bytes = await fs.readFile(outputPath);
  const sha256 = createHash("sha256").update(bytes).digest("hex");
  const durationMs = Math.round(durationSec * 1000);
  const contentType = format === "mp3" ? "audio/mpeg" : "audio/wav";

  return {
    filePath: outputPath,
    bytes,
    sha256,
    durationMs,
    contentType
  };
}
