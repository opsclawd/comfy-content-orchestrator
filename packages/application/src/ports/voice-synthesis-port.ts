export interface VoiceSynthesisInput {
  readonly text: string;
  readonly voiceId: string;
  readonly speed?: number | undefined;
}

export interface VoiceSynthesisOutput {
  readonly audio: Uint8Array;
  readonly contentType: string;
  readonly sampleRateHz: number;
  /**
   * Always an integer millisecond count — Math.round of the measured
   * sample-count/sampleRateHz duration — because downstream
   * VoiceoverAssetRefSchema.expectedDurationMs requires z.number().int().
   */
  readonly durationMs: number;
}

export type VoiceSynthesisProviderLocality = "cloud" | "self-hosted";

export interface VoiceSynthesisPort<TInput, TOutput> {
  readonly providerLocality?: VoiceSynthesisProviderLocality | undefined;
  readonly providerName?: string | undefined;
  synthesize(input: TInput): Promise<TOutput>;
}

export type ConcreteVoiceSynthesisPort = VoiceSynthesisPort<
  VoiceSynthesisInput,
  VoiceSynthesisOutput
>;
