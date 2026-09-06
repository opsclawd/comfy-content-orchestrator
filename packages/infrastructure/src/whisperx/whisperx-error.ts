export type WhisperXAlignmentFailureCode =
  | "INVALID_INPUT"
  | "MODEL_LOAD_FAILED"
  | "PYTHON_NOT_FOUND"
  | "ALIGNMENT_FAILED"
  | "PROCESS_TIMEOUT"
  | "MALFORMED_OUTPUT";

export interface WhisperXAlignmentErrorContext {
  readonly command?: string | undefined;
  readonly args?: readonly string[] | undefined;
  readonly pythonPath?: string | undefined;
  readonly scriptPath?: string | undefined;
  readonly modelDir?: string | undefined;
  readonly modelFile?: string | undefined;
  readonly manifestPath?: string | undefined;
  readonly expected?: string | undefined;
  readonly actual?: string | undefined;
  readonly expectedWord?: string | undefined;
  readonly actualWord?: string | undefined;
  readonly expectedWordsCount?: number | undefined;
  readonly actualWordsCount?: number | undefined;
  readonly expectedSha256?: string | undefined;
  readonly actualSha256?: string | undefined;
  readonly item?: unknown;
  readonly index?: number | undefined;
  readonly timeoutMs?: number | undefined;
  readonly exitCode?: number | undefined;
  readonly stderr?: string | undefined;
  readonly stdout?: string | undefined;
  readonly venvDir?: string | undefined;
  readonly modelId?: string | undefined;
  readonly text?: string | undefined;
  readonly audioBytes?: number | undefined;
  readonly details?: unknown;
}

export class WhisperXAlignmentError extends Error {
  override readonly name = "WhisperXAlignmentError";

  constructor(
    readonly code: WhisperXAlignmentFailureCode,
    message: string,
    readonly context: WhisperXAlignmentErrorContext = {},
    options?: ErrorOptions
  ) {
    super(message, options);
  }
}
