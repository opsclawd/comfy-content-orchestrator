export interface ClientContextResolver<TRequest = unknown> {
  /**
   * Resolves the canonical authenticated client UUID from trusted request/session context.
   * Returns string UUID if authenticated, or null/undefined if unauthenticated.
   */
  resolve(request: TRequest): Promise<string | null | undefined> | string | null | undefined;
}
