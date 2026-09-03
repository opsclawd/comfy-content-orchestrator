export interface ClientRepository<TClient> {
  findById(clientId: string): Promise<TClient | undefined>;
  save(client: TClient): Promise<void>;
}
