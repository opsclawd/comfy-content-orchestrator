import {
  type ConcreteVoiceSynthesisPort,
  type VoiceSynthesisProviderLocality,
  decodeVoiceAuthorizationPolicy,
  VoiceSynthesisNotAuthorizedError
} from "@cco/application";
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
  readonly providerLocality?: VoiceSynthesisProviderLocality | undefined;
  readonly externalProcessingPolicy?: Record<string, unknown> | undefined;
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
  readonly cloud?:
    | {
        readonly adapter: ConcreteVoiceSynthesisPort;
        readonly providerName?: string | undefined;
      }
    | undefined;
}

/**
 * Composition-root factory function for voice synthesis port.
 *
 * Constructs either KokoroVoiceSynthesisAdapter (in-process ONNX model) or
 * PiperVoiceSynthesisAdapter (standalone HTTP network service) as self-hosted
 * voice synthesis options, or configures a cloud provider with external
 * processing policy gating (PRD §9.6). Defaults to Kokoro when provider is unset.
 */
export function createVoiceSynthesisPort(
  config: VoiceSynthesisPortConfig = {}
): ConcreteVoiceSynthesisPort {
  let port: ConcreteVoiceSynthesisPort;

  if (config.cloud?.adapter) {
    port = config.cloud.adapter;
  } else if (config.provider === "piper") {
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

    port = new PiperVoiceSynthesisAdapter(configuredVoiceId, client);
  } else if (config.provider === "kokoro" || !config.provider) {
    const engine =
      config.kokoro?.engine ??
      (config.kokoro?.modelOptions ? createKokoroJsEngine(config.kokoro.modelOptions) : undefined);

    port = new KokoroVoiceSynthesisAdapter(engine);
  } else {
    throw new Error(
      `createVoiceSynthesisPort: unsupported voice synthesis provider '${config.provider}'`
    );
  }

  const effectiveLocality: VoiceSynthesisProviderLocality =
    config.providerLocality ?? port.providerLocality ?? "self-hosted";
  const effectiveProviderName =
    config.cloud?.providerName ?? config.provider ?? port.providerName ?? "unknown";

  if (config.externalProcessingPolicy && effectiveLocality === "cloud") {
    const policy = decodeVoiceAuthorizationPolicy(config.externalProcessingPolicy);
    const innerPort = port;

    return {
      providerLocality: "cloud",
      providerName: effectiveProviderName,
      async synthesize(input) {
        if (!policy.allowCloudVoice) {
          throw new VoiceSynthesisNotAuthorizedError(
            "allowCloudVoice is disabled for this client; human/local audio upload required"
          );
        }
        if (
          effectiveProviderName &&
          policy.allowedProviders.size > 0 &&
          !policy.allowedProviders.has(effectiveProviderName)
        ) {
          throw new VoiceSynthesisNotAuthorizedError(
            `Voice synthesis provider '${effectiveProviderName}' is not in allowedProviders`
          );
        }
        return innerPort.synthesize(input);
      }
    };
  }

  if (config.providerLocality || config.cloud?.providerName) {
    return {
      providerLocality: effectiveLocality,
      providerName: effectiveProviderName,
      synthesize: (input) => port.synthesize(input)
    };
  }

  return port;
}
