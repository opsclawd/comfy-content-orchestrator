import type { ClientSummary } from "../ports/client-repository.js";
import type { UnitOfWork } from "../ports/index.js";

export class ListClientsUseCase {
  constructor(private readonly uow: UnitOfWork) {}

  async execute(): Promise<readonly ClientSummary[]> {
    return this.uow.execute(async (context) => {
      if (context.clients === undefined) {
        throw new Error(
          "UnitOfWorkContext.clients is not configured for this UnitOfWork implementation."
        );
      }
      return context.clients.listActive();
    });
  }
}
