import { DEFAULT_ASSEMBLY_PLANNING_ENVELOPE, type AssemblyPlanningEnvelope } from "@cco/contracts";

export interface AssemblyPlanningEnvelopeReader {
  getEnvelope(deploymentId?: string): Promise<AssemblyPlanningEnvelope>;
}

export class DefaultAssemblyPlanningEnvelopeReader implements AssemblyPlanningEnvelopeReader {
  constructor(
    private readonly defaultEnvelope: AssemblyPlanningEnvelope = DEFAULT_ASSEMBLY_PLANNING_ENVELOPE
  ) {}

  async getEnvelope(_deploymentId?: string): Promise<AssemblyPlanningEnvelope> {
    return this.defaultEnvelope;
  }
}
