export interface PrevisTextRegion {
  readonly text: string;
  /** Normalised confidence in the range 0..1. */
  readonly confidence: number;
  readonly bbox?: {
    readonly x0: number;
    readonly y0: number;
    readonly x1: number;
    readonly y1: number;
  };
}

export interface PrevisTextDetectionResult {
  readonly engine: { readonly id: string; readonly version: string };
  readonly regions: readonly PrevisTextRegion[];
}

export interface PrevisTextDetectionInput {
  readonly bytes: Uint8Array;
  readonly contentType?: string | undefined;
}

export interface PrevisTextDetectionPort {
  detectText(input: PrevisTextDetectionInput): Promise<PrevisTextDetectionResult>;
  /**
   * Optional hook invoked when a detectText call exceeded its timeout, so the engine can
   * discard any wedged state (e.g. recycle a shared worker). Must not throw.
   */
  recycleAfterTimeout?(): Promise<void>;
}
