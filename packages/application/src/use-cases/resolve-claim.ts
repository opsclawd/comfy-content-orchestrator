import type { ResolveClaimResponse } from "@cco/contracts";
import { createClaimId, createClientId, type ClaimId, type ClientId } from "@cco/domain";
import type { UnitOfWork } from "../ports/index.js";

export interface ResolveClaimQuery {
  readonly clientId: ClientId | string;
  readonly claimId: ClaimId | string;
  readonly revision?: number | undefined;
}

export class ResolveClaimUseCase {
  constructor(private readonly uow: UnitOfWork) {}

  async execute(query: ResolveClaimQuery): Promise<ResolveClaimResponse> {
    const clientId = createClientId(String(query.clientId));
    const claimId = createClaimId(String(query.claimId));

    return this.uow.execute(async (context) => {
      if (!context.productClaims) {
        throw new Error(
          "UnitOfWorkContext.productClaims is not configured for this UnitOfWork implementation."
        );
      }
      return context.productClaims.resolveClaim(clientId, claimId, query.revision);
    });
  }
}
