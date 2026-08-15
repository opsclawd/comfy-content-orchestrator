export type ComfyUiFailureCode =
  | "QUEUE_SUBMISSION_FAILED"
  | "WEBSOCKET_CONNECTION_FAILED"
  | "NODE_EXECUTION_FAILED"
  | "EXECUTION_INTERRUPTED"
  | "RENDER_TIMEOUT"
  | "HISTORY_REQUEST_FAILED"
  | "HISTORY_MISSING"
  | "HISTORY_NOT_SUCCESSFUL"
  | "VRAM_UNLOAD_FAILED"
  | "PROTOCOL_ERROR";

export interface ComfyUiFailureContext {
  readonly promptId?: string | undefined;
  readonly nodeId?: string | undefined;
  readonly nodeType?: string | undefined;
  readonly statusCode?: number | undefined;
  readonly timeoutMs?: number | undefined;
}

export class ComfyUiRenderEngineError extends Error {
  override readonly name = "ComfyUiRenderEngineError";

  constructor(
    readonly code: ComfyUiFailureCode,
    message: string,
    readonly context: ComfyUiFailureContext = {}
  ) {
    super(message);
  }
}
