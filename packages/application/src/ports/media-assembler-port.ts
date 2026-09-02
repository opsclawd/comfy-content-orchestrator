import type { AssemblyExecutionResult, AssemblySpec, ComponentRef } from "@cco/contracts";

export interface MediaAssemblerPort<TInput = AssemblySpec, TOutput = AssemblyExecutionResult> {
  assemble(input: TInput): Promise<TOutput>;
  /**
   * Optional: the exact, live-detected identity of this assembler's host
   * runtime dependencies (e.g. the actual FFmpeg build in use), for callers
   * that need to include them in a license-routing check before dispatch.
   * This must reflect what the assembler will actually use at execution
   * time — not a static/asserted value — so a license guard checking it
   * denies on a real environment mismatch instead of trusting an unverified
   * claim. Adapters with no such runtime-detected dependency can omit this.
   */
  getRuntimeComponents?(): Promise<readonly ComponentRef[]>;
}

export type ConcreteMediaAssemblerPort = MediaAssemblerPort<AssemblySpec, AssemblyExecutionResult>;
