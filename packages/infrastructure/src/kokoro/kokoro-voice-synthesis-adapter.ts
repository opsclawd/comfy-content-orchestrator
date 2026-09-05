import type {
  ConcreteVoiceSynthesisPort,
  VoiceSynthesisInput,
  VoiceSynthesisOutput
} from "@cco/application";
import { type KokoroEngine, createKokoroJsEngine } from "./kokoro-engine.js";
import { encodeWav } from "./wav-encoder.js";
import { KokoroSynthesisError } from "./kokoro-error.js";

/**
 * VoiceSynthesisPort adapter implementation using Kokoro-82M.
 *
 * Transcribes text to 16-bit mono PCM audio in a canonical RIFF WAV container.
 * Invariant: durationMs is guaranteed to be an integer (rounded via Math.round)
 * to strictly satisfy VoiceoverAssetRefSchema.expectedDurationMs.
 */
export class KokoroVoiceSynthesisAdapter implements ConcreteVoiceSynthesisPort {
  private readonly engine: KokoroEngine;

  constructor(engine?: KokoroEngine) {
    this.engine = engine ?? createKokoroJsEngine();
  }

  async synthesize(input: VoiceSynthesisInput): Promise<VoiceSynthesisOutput> {
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

    const { samples, sampleRateHz } = await this.engine.synthesize({
      text: input.text,
      voiceId: input.voiceId,
      speed: input.speed
    });

    const audio = encodeWav(samples, sampleRateHz);

    // Duration rounding invariant: always round to integer milliseconds.
    // Downstream VoiceoverAssetRefSchema enforces z.number().int().positive().
    const durationMs = Math.round((samples.length / sampleRateHz) * 1000);

    return {
      audio,
      contentType: "audio/wav",
      sampleRateHz,
      durationMs
    };
  }
}
