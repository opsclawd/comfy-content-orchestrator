import type {
  ConcreteVoiceSynthesisPort,
  VoiceSynthesisInput,
  VoiceSynthesisOutput
} from "@cco/application";
import type { PiperHttpClient } from "./piper-client.js";
import { decodeWav } from "./wav-decoder.js";
import { PiperSynthesisError } from "./piper-error.js";

/**
 * VoiceSynthesisPort adapter implementation using Piper TTS.
 *
 * Transcribes text to 16-bit mono PCM audio in a canonical RIFF WAV container
 * via a standalone Piper HTTP server.
 * Invariant: durationMs is guaranteed to be an integer (rounded via Math.round)
 * derived purely from the measured response audio bytes.
 */
export class PiperVoiceSynthesisAdapter implements ConcreteVoiceSynthesisPort {
  readonly configuredVoiceId: string;
  readonly client: PiperHttpClient;

  constructor(configuredVoiceId: string, client: PiperHttpClient) {
    if (!configuredVoiceId || configuredVoiceId.trim().length === 0) {
      throw new PiperSynthesisError("INVALID_INPUT", "configuredVoiceId must not be empty");
    }
    this.configuredVoiceId = configuredVoiceId.trim();
    this.client = client;
  }

  async synthesize(input: VoiceSynthesisInput): Promise<VoiceSynthesisOutput> {
    if (!input.text || input.text.trim().length === 0) {
      throw new PiperSynthesisError("INVALID_INPUT", "Synthesis text must not be empty", {
        text: input.text,
        voiceId: input.voiceId
      });
    }

    if (!input.voiceId || input.voiceId.trim().length === 0) {
      throw new PiperSynthesisError("INVALID_INPUT", "Synthesis voiceId must not be empty", {
        text: input.text,
        voiceId: input.voiceId
      });
    }

    let lengthScale: number | undefined;
    if (input.speed !== undefined) {
      if (typeof input.speed !== "number" || !Number.isFinite(input.speed) || input.speed <= 0) {
        throw new PiperSynthesisError(
          "INVALID_INPUT",
          `Synthesis speed must be a positive finite number, received ${input.speed}`,
          {
            text: input.text,
            voiceId: input.voiceId,
            speed: input.speed
          }
        );
      }

      const computedLengthScale = 1.0 / input.speed;
      if (!Number.isFinite(computedLengthScale) || computedLengthScale <= 0) {
        throw new PiperSynthesisError(
          "INVALID_INPUT",
          `Synthesis speed reciprocal must be a positive finite number, received ${input.speed} (reciprocal: ${computedLengthScale})`,
          {
            text: input.text,
            voiceId: input.voiceId,
            speed: input.speed
          }
        );
      }
      lengthScale = computedLengthScale;
    }

    if (input.voiceId !== this.configuredVoiceId) {
      throw new PiperSynthesisError(
        "VOICE_NOT_FOUND",
        `Requested voice '${input.voiceId}' does not match configured voice '${this.configuredVoiceId}'`,
        {
          requestedVoiceId: input.voiceId,
          configuredVoiceId: this.configuredVoiceId
        }
      );
    }

    const audio = await this.client.synthesize({
      text: input.text,
      voice: input.voiceId,
      lengthScale
    });

    const decoded = decodeWav(audio);

    return {
      audio,
      contentType: "audio/wav",
      sampleRateHz: decoded.sampleRateHz,
      durationMs: decoded.durationMs
    };
  }
}
