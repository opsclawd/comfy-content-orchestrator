import type { ConcreteVoiceSynthesisPort } from "@cco/application";
import {
  KokoroVoiceSynthesisAdapter,
  type KokoroEngine,
  createKokoroJsEngine,
  type KokoroJsEngineOptions
} from "@cco/infrastructure";

export interface VoiceSynthesisPortConfig {
  readonly provider?: "kokoro" | string | undefined;
  readonly kokoro?:
    | {
        readonly engine?: KokoroEngine | undefined;
        readonly modelOptions?: KokoroJsEngineOptions | undefined;
      }
    | undefined;
}

/**
 * Composition-root factory function for voice synthesis port.
 *
 * Currently constructs KokoroVoiceSynthesisAdapter as the concrete self-hosted
 * default provider. Signature is forward-compatible for future cloud providers
 * (e.g. Azure, ElevenLabs) without changing caller interfaces.
 */
export function createVoiceSynthesisPort(
  config: VoiceSynthesisPortConfig = {}
): ConcreteVoiceSynthesisPort {
  const engine =
    config.kokoro?.engine ??
    (config.kokoro?.modelOptions ? createKokoroJsEngine(config.kokoro.modelOptions) : undefined);

  return new KokoroVoiceSynthesisAdapter(engine);
}
