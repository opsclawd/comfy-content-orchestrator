export interface ForcedAlignmentInput {
  readonly audio: Uint8Array;
  readonly text: string;
  readonly language?: string | undefined;
}

export interface AlignedWord {
  readonly word: string;
  readonly startMs: number;
  readonly endMs: number;
  readonly aligned: boolean;
}

export interface ForcedAlignmentOutput {
  readonly words: readonly AlignedWord[];
}

export interface ForcedAlignmentPort<TInput, TOutput> {
  align(input: TInput): Promise<TOutput>;
}

export type ConcreteForcedAlignmentPort = ForcedAlignmentPort<
  ForcedAlignmentInput,
  ForcedAlignmentOutput
>;
