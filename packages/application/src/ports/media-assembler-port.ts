export interface MediaAssemblerPort<TInput, TOutput> {
  assemble(input: TInput): Promise<TOutput>;
}
