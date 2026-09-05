export type KokoroSynthesisFailureCode =
  "INVALID_INPUT" | "VOICE_NOT_FOUND" | "MODEL_LOAD_FAILED" | "INFERENCE_FAILED" | "ENCODE_FAILED";

export interface KokoroSynthesisErrorContext {
  readonly text?: string | undefined;
  readonly voiceId?: string | undefined;
  readonly voiceFile?: string | undefined;
  readonly speed?: number | undefined;
  readonly modelId?: string | undefined;
  readonly modelDir?: string | undefined;
  readonly modelFile?: string | undefined;
  readonly expectedSha256?: string | undefined;
  readonly actualSha256?: string | undefined;
  readonly expectedVoiceSha256?: string | undefined;
  readonly actualVoiceSha256?: string | undefined;
  readonly expectedConfigSha256?: string | undefined;
  readonly actualConfigSha256?: string | undefined;
  readonly expectedTokenizerSha256?: string | undefined;
  readonly actualTokenizerSha256?: string | undefined;
  readonly expectedTokenizerConfigSha256?: string | undefined;
  readonly actualTokenizerConfigSha256?: string | undefined;
  readonly expected?: string | undefined;
  readonly actual?: string | undefined;
  readonly assetPath?: string | undefined;
  readonly manifestPath?: string | undefined;
  readonly versionFile?: string | undefined;
  readonly sampleRateHz?: number | undefined;
  readonly details?: unknown;
}

export class KokoroSynthesisError extends Error {
  override readonly name = "KokoroSynthesisError";

  constructor(
    readonly code: KokoroSynthesisFailureCode,
    message: string,
    readonly context: KokoroSynthesisErrorContext = {},
    options?: ErrorOptions
  ) {
    super(message, options);
  }
}
