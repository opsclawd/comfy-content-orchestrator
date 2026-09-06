import type { ConcreteForcedAlignmentPort } from "@cco/application";
import {
  WhisperXAlignmentAdapter,
  type WhisperXAlignmentAdapterOptions,
  type WhisperXSpawnLikeFn
} from "@cco/infrastructure";

export interface ForcedAlignmentPortConfig {
  readonly provider?: "whisperx" | string | undefined;
  readonly whisperx?:
    | {
        readonly pythonPath?: string | undefined;
        readonly scriptPath?: string | undefined;
        readonly spawnRunner?: WhisperXSpawnLikeFn | undefined;
        readonly workspaceRoot?: string | undefined;
        readonly timeoutMs?: number | undefined;
        readonly skipPreflight?: boolean | undefined;
      }
    | undefined;
}

/**
 * Composition-root factory function for forced alignment port.
 *
 * Constructs WhisperXAlignmentAdapter as the concrete self-hosted default provider.
 * Automatically resolves the pinned Python virtualenv path if pythonPath is omitted.
 */
export function createForcedAlignmentPort(
  config: ForcedAlignmentPortConfig = {}
): ConcreteForcedAlignmentPort {
  const options: WhisperXAlignmentAdapterOptions = {
    pythonPath: config.whisperx?.pythonPath,
    scriptPath: config.whisperx?.scriptPath,
    spawnRunner: config.whisperx?.spawnRunner,
    workspaceRoot: config.whisperx?.workspaceRoot,
    timeoutMs: config.whisperx?.timeoutMs,
    skipPreflight: config.whisperx?.skipPreflight
  };

  return new WhisperXAlignmentAdapter(options);
}
