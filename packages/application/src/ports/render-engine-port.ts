export type RenderWorkflow = Readonly<Record<string, unknown>>;

export interface QueueRenderInput {
  readonly renderJobId: string;
  readonly sceneId: string;
  readonly renderProfileKey: string;
  readonly workflow: RenderWorkflow;
}

export interface RenderQueueReceipt {
  readonly executionId: string;
  readonly acceptedAt: string;
}

export interface RenderResult {
  readonly executionId: string;
  readonly status: "succeeded" | "failed";
  readonly outputObjectKeys: readonly string[];
  readonly completedAt: string;
  readonly errorCode?: string;
}

export interface RenderEnginePort {
  queueRender(input: QueueRenderInput): Promise<RenderQueueReceipt>;
  getRenderResult(executionId: string): Promise<RenderResult | undefined>;
  unloadModels(): Promise<void>;
}
