export interface PlannerPort<TInput, TOutput> {
  plan(input: TInput): Promise<TOutput>;
}
