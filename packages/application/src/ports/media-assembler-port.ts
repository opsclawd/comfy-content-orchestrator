import type { AssemblyExecutionResult, AssemblySpec } from "@cco/contracts";

export interface MediaAssemblerPort<TInput = AssemblySpec, TOutput = AssemblyExecutionResult> {
  assemble(input: TInput): Promise<TOutput>;
}

export type ConcreteMediaAssemblerPort = MediaAssemblerPort<AssemblySpec, AssemblyExecutionResult>;
