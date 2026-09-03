export class ClientNotFoundError extends Error {
  override readonly name = "ClientNotFoundError";
  readonly clientId: string;

  constructor(clientId: string) {
    super(`Client '${clientId}' was not found.`);
    this.clientId = clientId;
  }
}
