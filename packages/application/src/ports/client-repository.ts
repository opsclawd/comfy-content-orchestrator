export interface ClientSummary {
  readonly clientId: string;
  readonly companyName: string;
}

export interface ClientRepository<TClient> {
  findById(clientId: string): Promise<TClient | undefined>;
  save(client: TClient): Promise<void>;
  listActive(): Promise<readonly ClientSummary[]>;
}
