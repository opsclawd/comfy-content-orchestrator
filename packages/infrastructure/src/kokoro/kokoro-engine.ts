import fs from "node:fs";
import path from "node:path";
import { createHash } from "node:crypto";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import type { KokoroTTS } from "kokoro-js";
import { KokoroSynthesisError } from "./kokoro-error.js";

export interface KokoroEngineInput {
  readonly text: string;
  readonly voiceId: string;
  readonly speed?: number | undefined;
}

export interface KokoroEngineOutput {
  readonly samples: Float32Array;
  readonly sampleRateHz: number;
}

export interface KokoroEngine {
  synthesize(input: KokoroEngineInput): Promise<KokoroEngineOutput>;
}

export interface KokoroJsEngineOptions {
  readonly modelId?: string | undefined;
  readonly modelRevision?: string | undefined;
  readonly modelDir?: string | undefined;
  readonly expectedSha256?: string | undefined;
  readonly dtype?: "fp32" | "fp16" | "q8" | "q4" | "q4f16" | undefined;
  readonly device?: "wasm" | "webgpu" | "cpu" | null | undefined;
  readonly expectedVoiceSha256?: string | undefined;
  readonly expectedConfigSha256?: string | undefined;
  readonly expectedTokenizerSha256?: string | undefined;
  readonly expectedTokenizerConfigSha256?: string | undefined;
}

export interface PinnedKokoroVersion {
  readonly npmVersion: string;
  readonly modelId: string;
  readonly modelRevision: string;
  readonly sha256: string;
  readonly md5?: string | undefined;
  readonly modelDir: string;
  readonly voiceAfHeartSha256: string;
  readonly configSha256: string;
  readonly tokenizerSha256: string;
  readonly tokenizerConfigSha256: string;
}

export const PINNED_KOKORO_MODEL_ID = "onnx-community/Kokoro-82M-v1.0-ONNX";
export const PINNED_KOKORO_MODEL_REVISION = "1939ad2a8e416c0acfeecc08a694d14ef25f2231";
export const PINNED_KOKORO_ONNX_SHA256 =
  "fbae9257e1e05ffc727e951ef9b9c98418e6d79f1c9b6b13bd59f5c9028a1478";
export const PINNED_KOKORO_ONNX_MD5 = "7d69053599134b7a38b2ec1dddbe92fd";
export const PINNED_KOKORO_VOICE_AF_HEART_SHA256 =
  "d583ccff3cdca2f7fae535cb998ac07e9fcb90f09737b9a41fa2734ec44a8f0b";
export const PINNED_KOKORO_CONFIG_SHA256 =
  "df34b4f930b23447cd4dc410fabfb42eb3f24e803e6c3f97d618fb359380a36f";
export const PINNED_KOKORO_TOKENIZER_SHA256 =
  "77a02c8e164413299b4b4c403b14f8e0e1c1b727db4d46a09d6327b861060a34";
export const PINNED_KOKORO_TOKENIZER_CONFIG_SHA256 =
  "be1cb066d6ef6b074b3f15e6a6dd21ac88ff3cdaedf325f0aaed686c70f75d20";

export const DEFAULT_KOKORO_MODEL_ID = PINNED_KOKORO_MODEL_ID;
export const DEFAULT_KOKORO_DTYPE = "q8";
export const DEFAULT_KOKORO_DEVICE = "cpu";
export const MAX_MODEL_TOKEN_LIMIT = 512;
export const TARGET_CHUNK_TOKEN_LIMIT = 500;

export function findRepoRoot(startDir?: string): string {
  let curr = startDir ?? process.cwd();
  while (true) {
    if (
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

export function loadPinnedKokoroVersion(repoRoot: string = findRepoRoot()): PinnedKokoroVersion {
  const versionFile = path.join(repoRoot, ".kokoro-version");
  if (fs.existsSync(versionFile)) {
    const content = fs.readFileSync(versionFile, "utf-8");
    const getVar = (name: string): string | undefined => {
      const match = content.match(
        new RegExp(`^\\s*${name}\\s*=\\s*["']?([^"'#\\r\\n]+)["']?`, "m")
      );
      const val = match?.[1];
      return val !== undefined ? val.trim() : undefined;
    };

    const modelId = getVar("KOKORO_MODEL_ID");
    const modelRevision = getVar("KOKORO_MODEL_REVISION");
    const sha256 = getVar("KOKORO_ONNX_QUANTIZED_SHA256");
    const md5 = getVar("KOKORO_ONNX_QUANTIZED_MD5") ?? PINNED_KOKORO_ONNX_MD5;
    const npmVersion = getVar("KOKORO_NPM_VERSION") ?? "1.2.1";
    const modelDir = getVar("KOKORO_MODEL_DIR") ?? "node_modules/.cache/kokoro-model";
    const voiceAfHeartSha256 =
      getVar("KOKORO_VOICE_AF_HEART_SHA256") ?? PINNED_KOKORO_VOICE_AF_HEART_SHA256;
    const configSha256 = getVar("KOKORO_CONFIG_SHA256") ?? PINNED_KOKORO_CONFIG_SHA256;
    const tokenizerSha256 = getVar("KOKORO_TOKENIZER_SHA256") ?? PINNED_KOKORO_TOKENIZER_SHA256;
    const tokenizerConfigSha256 =
      getVar("KOKORO_TOKENIZER_CONFIG_SHA256") ?? PINNED_KOKORO_TOKENIZER_CONFIG_SHA256;

    if (
      !modelId ||
      !modelRevision ||
      !sha256 ||
      !voiceAfHeartSha256 ||
      !configSha256 ||
      !tokenizerSha256 ||
      !tokenizerConfigSha256
    ) {
      throw new KokoroSynthesisError(
        "MODEL_LOAD_FAILED",
        `Invalid .kokoro-version file at ${versionFile}: must define KOKORO_MODEL_ID, KOKORO_MODEL_REVISION, KOKORO_ONNX_QUANTIZED_SHA256, KOKORO_VOICE_AF_HEART_SHA256, KOKORO_CONFIG_SHA256, KOKORO_TOKENIZER_SHA256, and KOKORO_TOKENIZER_CONFIG_SHA256`,
        { versionFile }
      );
    }

    return {
      npmVersion,
      modelId,
      modelRevision,
      sha256,
      md5,
      modelDir,
      voiceAfHeartSha256,
      configSha256,
      tokenizerSha256,
      tokenizerConfigSha256
    };
  }

  return {
    npmVersion: "1.2.1",
    modelId: PINNED_KOKORO_MODEL_ID,
    modelRevision: PINNED_KOKORO_MODEL_REVISION,
    sha256: PINNED_KOKORO_ONNX_SHA256,
    md5: PINNED_KOKORO_ONNX_MD5,
    modelDir: "node_modules/.cache/kokoro-model",
    voiceAfHeartSha256: PINNED_KOKORO_VOICE_AF_HEART_SHA256,
    configSha256: PINNED_KOKORO_CONFIG_SHA256,
    tokenizerSha256: PINNED_KOKORO_TOKENIZER_SHA256,
    tokenizerConfigSha256: PINNED_KOKORO_TOKENIZER_CONFIG_SHA256
  };
}

export function resolveKokoroModelDir(options: KokoroJsEngineOptions = {}): string {
  if (options.modelDir) {
    return path.resolve(options.modelDir);
  }
  if (process.env.KOKORO_MODEL_DIR) {
    return path.resolve(process.env.KOKORO_MODEL_DIR);
  }
  const repoRoot = findRepoRoot();
  const pinned = loadPinnedKokoroVersion(repoRoot);
  return path.resolve(repoRoot, pinned.modelDir);
}

export function verifyKokoroModelDir(
  modelDir: string,
  expectedSha256?: string,
  expectedRevision?: string,
  expectedModelId?: string,
  expectedVoiceSha256?: string,
  expectedConfigSha256?: string,
  expectedTokenizerSha256?: string,
  expectedTokenizerConfigSha256?: string
): void {
  const pinned = loadPinnedKokoroVersion();
  const targetSha256 = expectedSha256 ?? pinned.sha256;
  const targetRevision = expectedRevision ?? pinned.modelRevision;
  const targetModelId = expectedModelId ?? pinned.modelId;
  const targetVoiceSha256 = expectedVoiceSha256 ?? pinned.voiceAfHeartSha256;
  const targetConfigSha256 = expectedConfigSha256 ?? pinned.configSha256;
  const targetTokenizerSha256 = expectedTokenizerSha256 ?? pinned.tokenizerSha256;
  const targetTokenizerConfigSha256 = expectedTokenizerConfigSha256 ?? pinned.tokenizerConfigSha256;

  if (!fs.existsSync(modelDir)) {
    throw new KokoroSynthesisError(
      "MODEL_LOAD_FAILED",
      `Kokoro model directory does not exist: ${modelDir}. Run scripts/install-kokoro-model.sh first.`,
      { modelDir }
    );
  }

  const modelFile = path.join(modelDir, "onnx", "model_quantized.onnx");
  if (!fs.existsSync(modelFile)) {
    throw new KokoroSynthesisError(
      "MODEL_LOAD_FAILED",
      `Kokoro model file missing at ${modelFile}. Run scripts/install-kokoro-model.sh first.`,
      { modelDir, modelFile }
    );
  }

  const requiredAssets = [
    { file: "config.json", expected: targetConfigSha256, name: "config" },
    { file: "tokenizer.json", expected: targetTokenizerSha256, name: "tokenizer" },
    {
      file: "tokenizer_config.json",
      expected: targetTokenizerConfigSha256,
      name: "tokenizer_config"
    }
  ];

  for (const asset of requiredAssets) {
    const assetPath = path.join(modelDir, asset.file);
    if (!fs.existsSync(assetPath)) {
      throw new KokoroSynthesisError(
        "MODEL_LOAD_FAILED",
        `Kokoro model asset missing: ${assetPath}. Run scripts/install-kokoro-model.sh first.`,
        { modelDir, assetPath }
      );
    }
    const assetBytes = fs.readFileSync(assetPath);
    const actualAssetSha = createHash("sha256").update(assetBytes).digest("hex");
    if (actualAssetSha !== asset.expected) {
      throw new KokoroSynthesisError(
        "MODEL_LOAD_FAILED",
        `Kokoro ${asset.name} SHA-256 checksum mismatch: expected ${asset.expected}, got ${actualAssetSha}. Run scripts/install-kokoro-model.sh to align model cache.`,
        { modelDir, assetPath, expectedSha256: asset.expected, actualSha256: actualAssetSha }
      );
    }
  }

  const manifestPath = path.join(modelDir, "model_manifest.json");
  if (!fs.existsSync(manifestPath)) {
    throw new KokoroSynthesisError(
      "MODEL_LOAD_FAILED",
      `Kokoro model manifest missing at ${manifestPath}. Run scripts/install-kokoro-model.sh first.`,
      { modelDir, manifestPath }
    );
  }

  let manifest: {
    modelId?: string;
    revision?: string;
    sha256?: string;
    configSha256?: string;
    tokenizerSha256?: string;
    tokenizerConfigSha256?: string;
    voices?: Record<string, string>;
  };
  try {
    manifest = JSON.parse(fs.readFileSync(manifestPath, "utf-8"));
  } catch (err) {
    throw new KokoroSynthesisError(
      "MODEL_LOAD_FAILED",
      `Kokoro model manifest is invalid JSON at ${manifestPath}: ${err instanceof Error ? err.message : String(err)}. Run scripts/install-kokoro-model.sh first.`,
      { modelDir, manifestPath, details: err }
    );
  }

  if (!manifest.modelId || manifest.modelId !== targetModelId) {
    throw new KokoroSynthesisError(
      "MODEL_LOAD_FAILED",
      `Kokoro model ID mismatch: expected ${targetModelId}, found ${manifest?.modelId ?? "none"}. Run scripts/install-kokoro-model.sh to align model cache.`,
      { modelDir, expected: targetModelId, actual: manifest?.modelId }
    );
  }

  if (!manifest.revision || manifest.revision !== targetRevision) {
    throw new KokoroSynthesisError(
      "MODEL_LOAD_FAILED",
      `Kokoro model revision mismatch: expected ${targetRevision}, found ${manifest?.revision ?? "none"}. Run scripts/install-kokoro-model.sh to align model cache.`,
      { modelDir, expected: targetRevision, actual: manifest?.revision }
    );
  }

  if (!manifest.sha256 || manifest.sha256 !== targetSha256) {
    throw new KokoroSynthesisError(
      "MODEL_LOAD_FAILED",
      `Kokoro model manifest SHA-256 mismatch: expected ${targetSha256}, found ${manifest?.sha256 ?? "none"}. Run scripts/install-kokoro-model.sh to align model cache.`,
      { modelDir, expectedSha256: targetSha256, actualSha256: manifest?.sha256 }
    );
  }

  if (!manifest.configSha256 || manifest.configSha256 !== targetConfigSha256) {
    throw new KokoroSynthesisError(
      "MODEL_LOAD_FAILED",
      `Kokoro model manifest config SHA-256 mismatch: expected ${targetConfigSha256}, found ${manifest?.configSha256 ?? "none"}. Run scripts/install-kokoro-model.sh to align model cache.`,
      {
        modelDir,
        expectedConfigSha256: targetConfigSha256,
        actualConfigSha256: manifest?.configSha256
      }
    );
  }

  if (!manifest.tokenizerSha256 || manifest.tokenizerSha256 !== targetTokenizerSha256) {
    throw new KokoroSynthesisError(
      "MODEL_LOAD_FAILED",
      `Kokoro model manifest tokenizer SHA-256 mismatch: expected ${targetTokenizerSha256}, found ${manifest?.tokenizerSha256 ?? "none"}. Run scripts/install-kokoro-model.sh to align model cache.`,
      {
        modelDir,
        expectedTokenizerSha256: targetTokenizerSha256,
        actualTokenizerSha256: manifest?.tokenizerSha256
      }
    );
  }

  if (
    !manifest.tokenizerConfigSha256 ||
    manifest.tokenizerConfigSha256 !== targetTokenizerConfigSha256
  ) {
    throw new KokoroSynthesisError(
      "MODEL_LOAD_FAILED",
      `Kokoro model manifest tokenizer_config SHA-256 mismatch: expected ${targetTokenizerConfigSha256}, found ${manifest?.tokenizerConfigSha256 ?? "none"}. Run scripts/install-kokoro-model.sh to align model cache.`,
      {
        modelDir,
        expectedTokenizerConfigSha256: targetTokenizerConfigSha256,
        actualTokenizerConfigSha256: manifest?.tokenizerConfigSha256
      }
    );
  }

  const fileBytes = fs.readFileSync(modelFile);
  const actualSha256 = createHash("sha256").update(fileBytes).digest("hex");
  if (actualSha256 !== targetSha256) {
    throw new KokoroSynthesisError(
      "MODEL_LOAD_FAILED",
      `Kokoro model SHA-256 checksum mismatch: expected ${targetSha256}, got ${actualSha256}. Run scripts/install-kokoro-model.sh to align model cache.`,
      { modelDir, expectedSha256: targetSha256, actualSha256 }
    );
  }

  if (
    manifest.voices &&
    manifest.voices.af_heart &&
    manifest.voices.af_heart !== targetVoiceSha256
  ) {
    throw new KokoroSynthesisError(
      "MODEL_LOAD_FAILED",
      `Kokoro model manifest voice SHA-256 mismatch for af_heart: expected ${targetVoiceSha256}, found ${manifest.voices.af_heart}. Run scripts/install-kokoro-model.sh to align model cache.`,
      {
        modelDir,
        expectedVoiceSha256: targetVoiceSha256,
        actualVoiceSha256: manifest.voices.af_heart
      }
    );
  }

  const voiceFile = path.join(modelDir, "voices", "af_heart.bin");
  if (!fs.existsSync(voiceFile)) {
    throw new KokoroSynthesisError(
      "MODEL_LOAD_FAILED",
      `Kokoro voice artifact missing at ${voiceFile}. Run scripts/install-kokoro-model.sh first.`,
      { modelDir, voiceFile }
    );
  }

  const voiceBytes = fs.readFileSync(voiceFile);
  const actualVoiceSha256 = createHash("sha256").update(voiceBytes).digest("hex");
  if (actualVoiceSha256 !== targetVoiceSha256) {
    throw new KokoroSynthesisError(
      "MODEL_LOAD_FAILED",
      `Kokoro voice SHA-256 checksum mismatch for af_heart: expected ${targetVoiceSha256}, got ${actualVoiceSha256}. Run scripts/install-kokoro-model.sh to align model cache.`,
      { modelDir, expectedVoiceSha256: targetVoiceSha256, actualVoiceSha256 }
    );
  }
}

export function loadLocalVoice(
  modelDir: string,
  voiceId: string,
  expectedVoiceSha256?: string
): Float32Array {
  const voicePath = path.join(modelDir, "voices", `${voiceId}.bin`);
  if (!fs.existsSync(voicePath)) {
    throw new KokoroSynthesisError(
      "MODEL_LOAD_FAILED",
      `Kokoro voice artifact missing at ${voicePath}. Run scripts/install-kokoro-model.sh first.`,
      { modelDir, voiceId }
    );
  }

  const voiceBytes = fs.readFileSync(voicePath);
  const actualSha256 = createHash("sha256").update(voiceBytes).digest("hex");

  if (expectedVoiceSha256 && actualSha256 !== expectedVoiceSha256) {
    throw new KokoroSynthesisError(
      "MODEL_LOAD_FAILED",
      `Kokoro voice SHA-256 checksum mismatch for ${voiceId}: expected ${expectedVoiceSha256}, got ${actualSha256}. Run scripts/install-kokoro-model.sh to align model cache.`,
      { modelDir, voiceId, expectedVoiceSha256, actualSha256 }
    );
  }

  return new Float32Array(voiceBytes.buffer, voiceBytes.byteOffset, voiceBytes.byteLength / 4);
}

export interface TransformersModules {
  Tensor: new (type: string, data: Float32Array | number[], dims: number[]) => unknown;
  RawAudio: new (data: Float32Array, sampling_rate: number) => { toWav(): Uint8Array };
  env?:
    | {
        allowRemoteModels?: boolean;
        allowLocalModels?: boolean;
        localModelPath?: string;
        [key: string]: unknown;
      }
    | undefined;
}

export async function loadTransformersModules(): Promise<TransformersModules> {
  try {
    const require = createRequire(import.meta.url);
    const kokoroPkgPath = require.resolve("kokoro-js");
    const kokoroRequire = createRequire(kokoroPkgPath);
    const cjsPath = kokoroRequire.resolve("@huggingface/transformers");
    const mjsPath = cjsPath.replace(/\.cjs$/, ".mjs");
    const [tfMjsMod, tfCjsMod] = await Promise.all([
      import(mjsPath).catch(() => null),
      import(cjsPath).catch(() => null)
    ]);
    const Tensor = (tfMjsMod?.Tensor ?? tfCjsMod?.Tensor ?? tfCjsMod?.default?.Tensor) as
      TransformersModules["Tensor"] | undefined;
    const RawAudio = (tfMjsMod?.RawAudio ?? tfCjsMod?.RawAudio ?? tfCjsMod?.default?.RawAudio) as
      TransformersModules["RawAudio"] | undefined;
    const env = (tfMjsMod?.env ?? tfCjsMod?.default?.env ?? tfCjsMod?.env) as
      TransformersModules["env"] | undefined;
    if (Tensor && RawAudio) {
      return { Tensor, RawAudio, env };
    }
  } catch {
    // fallback
  }

  try {
    if (
      typeof (import.meta as unknown as { resolve?: (s: string) => string }).resolve === "function"
    ) {
      const kokoroUrl = import.meta.resolve("kokoro-js");
      const kokoroFile = fileURLToPath(kokoroUrl);
      const kokoroReq = createRequire(kokoroFile);
      const tfCjs = kokoroReq.resolve("@huggingface/transformers");
      const tfMjs = tfCjs.replace(/\.cjs$/, ".mjs");
      const [tfMjsMod, tfCjsMod] = await Promise.all([
        import(tfMjs).catch(() => null),
        import(tfCjs).catch(() => null)
      ]);
      const Tensor = (tfMjsMod?.Tensor ?? tfCjsMod?.Tensor ?? tfCjsMod?.default?.Tensor) as
        TransformersModules["Tensor"] | undefined;
      const RawAudio = (tfMjsMod?.RawAudio ?? tfCjsMod?.RawAudio ?? tfCjsMod?.default?.RawAudio) as
        TransformersModules["RawAudio"] | undefined;
      const env = (tfMjsMod?.env ?? tfCjsMod?.default?.env ?? tfCjsMod?.env) as
        TransformersModules["env"] | undefined;
      if (Tensor && RawAudio) {
        return { Tensor, RawAudio, env };
      }
    }
  } catch {
    // fallback
  }

  throw new KokoroSynthesisError(
    "MODEL_LOAD_FAILED",
    "Failed to load @huggingface/transformers module dependencies for Kokoro"
  );
}

export async function disableTransformersRemoteFallback(): Promise<void> {
  // Set environment variables for offline mode
  process.env.HF_HUB_OFFLINE = "1";
  process.env.TRANSFORMERS_OFFLINE = "1";

  try {
    const { env } = await loadTransformersModules();
    if (env) {
      env.allowRemoteModels = false;
      env.allowLocalModels = true;
    }
  } catch {
    // best-effort resolution
  }
}

export async function getUtteranceTokenCount(
  tts: KokoroTTS,
  text: string,
  voiceId: string
): Promise<number> {
  try {
    const require = createRequire(import.meta.url);
    const kokoroPkgPath = require.resolve("kokoro-js");
    const kokoroRequire = createRequire(kokoroPkgPath);
    const { phonemize } = await import(kokoroRequire.resolve("phonemizer"));
    const voicePrefix = voiceId.charAt(0);
    const lang = voicePrefix === "a" ? "en-us" : "en";
    const phonemeList = await phonemize(text, lang);
    const fullPhonemes = Array.isArray(phonemeList) ? phonemeList.join(" ") : String(phonemeList);
    if (!fullPhonemes) return text.length;
    const tokens = tts.tokenizer(fullPhonemes, { truncation: false });
    return tokens.input_ids.dims?.at(-1) ?? tokens.input_ids.size ?? fullPhonemes.length;
  } catch {
    // Fallback if phonemizer is unavailable (e.g. test fakes)
    return text.length;
  }
}

export async function splitTextIntoSafeUtterances(
  tts: KokoroTTS,
  text: string,
  voiceId: string
): Promise<string[]> {
  const trimmed = text.trim();
  if (!trimmed) return [];

  const fullTokens = await getUtteranceTokenCount(tts, trimmed, voiceId);
  if (fullTokens <= TARGET_CHUNK_TOKEN_LIMIT) {
    return [trimmed];
  }

  const sentenceRegex = /[^.!?\n]+(?:[.!?\n]+|$)/g;
  const rawSentences = trimmed.match(sentenceRegex) ?? [trimmed];

  const atomicChunks: string[] = [];

  for (const rawSentence of rawSentences) {
    const sentence = rawSentence.trim();
    if (!sentence) continue;

    const sentenceTokens = await getUtteranceTokenCount(tts, sentence, voiceId);
    if (sentenceTokens <= TARGET_CHUNK_TOKEN_LIMIT) {
      atomicChunks.push(sentence);
      continue;
    }

    const clauseRegex = /[^,;:—\n-]+(?:[,;:—\n-]+|$)/g;
    const rawClauses = sentence.match(clauseRegex) ?? [sentence];

    for (const rawClause of rawClauses) {
      const clause = rawClause.trim();
      if (!clause) continue;

      const clauseTokens = await getUtteranceTokenCount(tts, clause, voiceId);
      if (clauseTokens <= TARGET_CHUNK_TOKEN_LIMIT) {
        atomicChunks.push(clause);
        continue;
      }

      const words = clause.split(/\s+/).filter(Boolean);
      let accumulated = "";

      for (const word of words) {
        const candidate = accumulated ? `${accumulated} ${word}` : word;
        const candidateTokens = await getUtteranceTokenCount(tts, candidate, voiceId);

        if (candidateTokens <= TARGET_CHUNK_TOKEN_LIMIT) {
          accumulated = candidate;
        } else {
          if (accumulated) {
            atomicChunks.push(accumulated);
            accumulated = word;
            const wordTokens = await getUtteranceTokenCount(tts, word, voiceId);
            if (wordTokens > MAX_MODEL_TOKEN_LIMIT) {
              throw new KokoroSynthesisError(
                "INVALID_INPUT",
                `Unsplittable utterance exceeds maximum model token limit of ${MAX_MODEL_TOKEN_LIMIT} tokens (got ${wordTokens} tokens)`,
                { text: word, voiceId }
              );
            }
          } else {
            throw new KokoroSynthesisError(
              "INVALID_INPUT",
              `Unsplittable utterance exceeds maximum model token limit of ${MAX_MODEL_TOKEN_LIMIT} tokens (got ${candidateTokens} tokens)`,
              { text: word, voiceId }
            );
          }
        }
      }

      if (accumulated) {
        atomicChunks.push(accumulated);
      }
    }
  }

  const mergedChunks: string[] = [];
  let currentMerged = "";

  for (const chunk of atomicChunks) {
    if (!currentMerged) {
      currentMerged = chunk;
      continue;
    }

    const candidate = `${currentMerged} ${chunk}`;
    const candidateTokens = await getUtteranceTokenCount(tts, candidate, voiceId);
    if (candidateTokens <= TARGET_CHUNK_TOKEN_LIMIT) {
      currentMerged = candidate;
    } else {
      mergedChunks.push(currentMerged);
      currentMerged = chunk;
    }
  }

  if (currentMerged) {
    mergedChunks.push(currentMerged);
  }

  for (const chunk of mergedChunks) {
    const tokens = await getUtteranceTokenCount(tts, chunk, voiceId);
    if (tokens > MAX_MODEL_TOKEN_LIMIT) {
      throw new KokoroSynthesisError(
        "INVALID_INPUT",
        `Unsplittable utterance exceeds maximum model token limit of ${MAX_MODEL_TOKEN_LIMIT} tokens (got ${tokens} tokens)`,
        { text: chunk, voiceId }
      );
    }
  }

  return mergedChunks;
}

export interface KokoroJsEngine extends KokoroEngine {
  readonly modelDir: string;
  readonly modelRevision: string;
  readonly expectedSha256: string;
  readonly modelId: string;
  readonly voiceAfHeartSha256: string;
  readonly configSha256: string;
  readonly tokenizerSha256: string;
  readonly tokenizerConfigSha256: string;
  getModelProvenance(): {
    readonly modelDir: string;
    readonly modelRevision: string;
    readonly sha256: string;
    readonly modelId: string;
    readonly voiceAfHeartSha256: string;
    readonly configSha256: string;
    readonly tokenizerSha256: string;
    readonly tokenizerConfigSha256: string;
  };
}

export function createKokoroJsEngine(options: KokoroJsEngineOptions = {}): KokoroJsEngine {
  const repoRoot = findRepoRoot();
  const pinned = loadPinnedKokoroVersion(repoRoot);

  let ttsPromise: Promise<KokoroTTS> | null = null;
  let cachedTts: KokoroTTS | null = null;

  async function getTts(): Promise<KokoroTTS> {
    if (cachedTts) {
      return cachedTts;
    }
    if (ttsPromise) {
      return await ttsPromise;
    }

    const loadPromise = (async () => {
      const currentModelDir = resolveKokoroModelDir(options);
      const currentModelRevision = options.modelRevision ?? pinned.modelRevision;
      const currentSha256 = options.expectedSha256 ?? pinned.sha256;
      const currentModelId = options.modelId ?? pinned.modelId;
      const currentVoiceSha256 = options.expectedVoiceSha256 ?? pinned.voiceAfHeartSha256;
      const currentConfigSha256 = options.expectedConfigSha256 ?? pinned.configSha256;
      const currentTokenizerSha256 = options.expectedTokenizerSha256 ?? pinned.tokenizerSha256;
      const currentTokenizerConfigSha256 =
        options.expectedTokenizerConfigSha256 ?? pinned.tokenizerConfigSha256;

      verifyKokoroModelDir(
        currentModelDir,
        currentSha256,
        currentModelRevision,
        currentModelId,
        currentVoiceSha256,
        currentConfigSha256,
        currentTokenizerSha256,
        currentTokenizerConfigSha256
      );

      // Disable remote models in @huggingface/transformers to prevent remote fallback
      await disableTransformersRemoteFallback();

      const { KokoroTTS } = await import("kokoro-js");
      const tts = await KokoroTTS.from_pretrained(currentModelDir, {
        dtype: options.dtype ?? DEFAULT_KOKORO_DTYPE,
        device: options.device ?? DEFAULT_KOKORO_DEVICE
      });

      // Hook local voice loading onto KokoroTTS instance
      const { Tensor, RawAudio } = await loadTransformersModules();

      (tts as unknown as { voicesDir: string }).voicesDir = path.join(currentModelDir, "voices");
      (tts as unknown as { generate_from_ids: unknown }).generate_from_ids = async function (
        inputIds: { dims?: number[]; size?: number },
        { voice = "af_heart", speed = 1 }: { voice?: string; speed?: number } = {}
      ) {
        const expectedSha = voice === "af_heart" ? currentVoiceSha256 : undefined;
        const voiceFloats = loadLocalVoice(currentModelDir, voice, expectedSha);
        const numTokens = inputIds.dims ? inputIds.dims.at(-1) : inputIds.size;
        const l = 256 * Math.min(Math.max((numTokens ?? 0) - 2, 0), 509);
        const styleSlice = voiceFloats.slice(l, l + 256);
        const styleTensor = new Tensor("float32", styleSlice, [1, 256]);
        const speedTensor = new Tensor("float32", [speed ?? 1.0], [1]);
        const { waveform } = await (
          this as unknown as {
            model: (inputs: unknown) => Promise<{ waveform: { data: Float32Array } }>;
          }
        ).model({
          input_ids: inputIds,
          style: styleTensor,
          speed: speedTensor
        });
        return new RawAudio(waveform.data, 24000);
      };

      cachedTts = tts;
      return tts;
    })();

    ttsPromise = loadPromise;

    try {
      return await loadPromise;
    } catch (err: unknown) {
      // Reset promise and cache on failure so future calls can retry
      ttsPromise = null;
      cachedTts = null;

      if (err instanceof KokoroSynthesisError) {
        throw err;
      }
      const message = err instanceof Error ? err.message : String(err);
      throw new KokoroSynthesisError(
        "MODEL_LOAD_FAILED",
        `Failed to load Kokoro model: ${message}`,
        { details: err },
        { cause: err instanceof Error ? err : undefined }
      );
    }
  }

  return {
    get modelDir() {
      return resolveKokoroModelDir(options);
    },
    get modelRevision() {
      return options.modelRevision ?? pinned.modelRevision;
    },
    get expectedSha256() {
      return options.expectedSha256 ?? pinned.sha256;
    },
    get modelId() {
      return options.modelId ?? pinned.modelId;
    },
    get voiceAfHeartSha256() {
      return options.expectedVoiceSha256 ?? pinned.voiceAfHeartSha256;
    },
    get configSha256() {
      return options.expectedConfigSha256 ?? pinned.configSha256;
    },
    get tokenizerSha256() {
      return options.expectedTokenizerSha256 ?? pinned.tokenizerSha256;
    },
    get tokenizerConfigSha256() {
      return options.expectedTokenizerConfigSha256 ?? pinned.tokenizerConfigSha256;
    },
    getModelProvenance() {
      return {
        modelDir: resolveKokoroModelDir(options),
        modelRevision: options.modelRevision ?? pinned.modelRevision,
        sha256: options.expectedSha256 ?? pinned.sha256,
        modelId: options.modelId ?? pinned.modelId,
        voiceAfHeartSha256: options.expectedVoiceSha256 ?? pinned.voiceAfHeartSha256,
        configSha256: options.expectedConfigSha256 ?? pinned.configSha256,
        tokenizerSha256: options.expectedTokenizerSha256 ?? pinned.tokenizerSha256,
        tokenizerConfigSha256: options.expectedTokenizerConfigSha256 ?? pinned.tokenizerConfigSha256
      };
    },
    async synthesize(input: KokoroEngineInput): Promise<KokoroEngineOutput> {
      if (!input.text || input.text.trim().length === 0) {
        throw new KokoroSynthesisError("INVALID_INPUT", "Synthesis text must not be empty", {
          text: input.text,
          voiceId: input.voiceId
        });
      }
      if (!input.voiceId || input.voiceId.trim().length === 0) {
        throw new KokoroSynthesisError("INVALID_INPUT", "Synthesis voiceId must not be empty", {
          text: input.text,
          voiceId: input.voiceId
        });
      }

      // Step 1: Model loading phase (throws MODEL_LOAD_FAILED on failure)
      const tts = await getTts();

      // Step 2: Validate voice
      try {
        tts._validate_voice(input.voiceId);
      } catch (err: unknown) {
        const message = err instanceof Error ? err.message : String(err);
        throw new KokoroSynthesisError(
          "VOICE_NOT_FOUND",
          message,
          {
            voiceId: input.voiceId,
            text: input.text,
            details: err
          },
          { cause: err instanceof Error ? err : undefined }
        );
      }

      // Step 2.5: Preflight voice artifact existence & integrity before synthesis
      const currentModelDir = resolveKokoroModelDir(options);
      const currentVoiceSha256 = options.expectedVoiceSha256 ?? pinned.voiceAfHeartSha256;
      const expectedSha = input.voiceId === "af_heart" ? currentVoiceSha256 : undefined;
      loadLocalVoice(currentModelDir, input.voiceId, expectedSha);

      // Step 3: Split text into model-safe utterances
      const chunks = await splitTextIntoSafeUtterances(tts, input.text, input.voiceId);

      // Step 4: Synthesize every chunk and concatenate PCM samples
      try {
        const sampleArrays: Float32Array[] = [];
        let detectedSampleRateHz = 24000;

        for (const chunk of chunks) {
          const rawAudio = await tts.generate(chunk, {
            voice: input.voiceId as keyof KokoroTTS["voices"],
            speed: input.speed ?? 1.0
          });
          sampleArrays.push(rawAudio.audio);
          if (rawAudio.sampling_rate) {
            detectedSampleRateHz = rawAudio.sampling_rate;
          }
        }

        const totalSamples = sampleArrays.reduce((sum, s) => sum + s.length, 0);
        const mergedSamples = new Float32Array(totalSamples);
        let offset = 0;
        for (const s of sampleArrays) {
          mergedSamples.set(s, offset);
          offset += s.length;
        }

        return {
          samples: mergedSamples,
          sampleRateHz: detectedSampleRateHz
        };
      } catch (err: unknown) {
        if (err instanceof KokoroSynthesisError) {
          throw err;
        }
        const message = err instanceof Error ? err.message : String(err);
        throw new KokoroSynthesisError(
          "INFERENCE_FAILED",
          `Kokoro synthesis failed: ${message}`,
          {
            voiceId: input.voiceId,
            text: input.text,
            details: err
          },
          { cause: err instanceof Error ? err : undefined }
        );
      }
    }
  };
}
