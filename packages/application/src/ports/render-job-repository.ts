export interface RenderJobRepository<TRenderJob> {
  findById(renderJobId: string): Promise<TRenderJob | undefined>;
  save(renderJob: TRenderJob): Promise<void>;
}
