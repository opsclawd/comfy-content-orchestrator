export interface VoiceSynthesisPort<TInput, TOutput> {
  synthesize(input: TInput): Promise<TOutput>;
}
