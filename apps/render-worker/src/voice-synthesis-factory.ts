import type { ConcreteVoiceSynthesisPort } from "@cco/application";
import {
  KokoroVoiceSynthesisAdapter,
  type KokoroEngine,
  createKokoroJsEngine,
  type KokoroJsEngineOptions,
  PiperVoiceSynthesisAdapter,
  PiperHttpClient
} from "@cco/infrastructure";

export interface VoiceSynthesisPortConfig {
  readonly provider?: "kokoro" | "piper" | string | undefined;
  readonly kokoro?:
    | {
        readonly engine?: KokoroEngine | undefined;
        readonly modelOptions?: KokoroJsEngineOptions | undefined;
      }
    | undefined;
  readonly piper?:
    | {
        readonly configuredVoiceId: string;
        readonly client?: PiperHttpClient | undefined;
        readonly baseUrl?: string | undefined;
        readonly transport?: Partial<{ fetch: typeof fetch }> | undefined;
        readonly timeoutMs?: number | undefined;
      }
    | undefined;
}

/**
 * Composition-root factory function for voice synthesis port.
 *
 * Constructs either KokoroVoiceSynthesisAdapter (in-process ONNX model) or
 * PiperVoiceSynthesisAdapter (standalone HTTP network service) as self-hosted
 * voice synthesis options. Defaults to Kokoro when provider is unset.
 */
export function createVoiceSynthesisPort(
  config: VoiceSynthesisPortConfig = {}
): ConcreteVoiceSynthesisPort {
  if (config.provider === "piper") {
    const configuredVoiceId = config.piper?.configuredVoiceId;
    if (!configuredVoiceId || configuredVoiceId.trim().length === 0) {
      throw new Error(
        "createVoiceSynthesisPort: provider 'piper' requires piper.configuredVoiceId"
      );
    }

    const client =
      config.piper?.client ??
      new PiperHttpClient(
        config.piper?.baseUrl ?? process.env.PIPER_TTS_URL,
        config.piper?.transport,
        config.piper?.timeoutMs
      );

    return new PiperVoiceSynthesisAdapter(configuredVoiceId, client);
  }

  const engine =
    config.kokoro?.engine ??
    (config.kokoro?.modelOptions ? createKokoroJsEngine(config.kokoro.modelOptions) : undefined);

  return new KokoroVoiceSynthesisAdapter(engine);
}
