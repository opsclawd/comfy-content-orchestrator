export type PiperSynthesisFailureCode =
  | "INVALID_INPUT"
  | "VOICE_NOT_FOUND"
  | "SERVICE_UNAVAILABLE"
  | "INFERENCE_FAILED"
  | "DECODE_FAILED";

export interface PiperSynthesisErrorContext {
  readonly text?: string | undefined;
  readonly voiceId?: string | undefined;
  readonly requestedVoiceId?: string | undefined;
  readonly configuredVoiceId?: string | undefined;
  readonly baseUrl?: string | undefined;
  readonly statusCode?: number | undefined;
  readonly speed?: number | undefined;
  readonly details?: unknown;
}

export class PiperSynthesisError extends Error {
  override readonly name = "PiperSynthesisError";

  constructor(
    readonly code: PiperSynthesisFailureCode,
    message: string,
    readonly context: PiperSynthesisErrorContext = {},
    options?: ErrorOptions
  ) {
    super(message, options);
  }
}
