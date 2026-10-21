import { CreateClaimRequestSchema, type CreateClaimRequest } from "@cco/contracts";
import { ProductValidationError } from "@cco/domain";
import type { CommandEnvelope, ProductClaimCreationResult, UnitOfWork } from "../ports/index.js";
import { validateClaimCommandEnvelope } from "./claim-command-envelope-validator.js";

export class CreateClaimUseCase {
  constructor(private readonly uow: UnitOfWork) {}

  async execute(cmd: CommandEnvelope<CreateClaimRequest>): Promise<ProductClaimCreationResult> {
    validateClaimCommandEnvelope(cmd);

    const parseResult = CreateClaimRequestSchema.safeParse(cmd.payload);
    if (!parseResult.success) {
      throw new ProductValidationError(
        parseResult.error.issues.map((issue) => ({
          code: "INVALID_FIELD_COMBINATION",
          path: issue.path.map(String),
          message: issue.message
        }))
      );
    }

    return this.uow.execute(async (context) => {
      if (!context.productClaims) {
        throw new Error(
          "UnitOfWorkContext.productClaims is not configured for this UnitOfWork implementation."
        );
      }
      return context.productClaims.createClaim({
        ...cmd,
        payload: parseResult.data
      });
    });
  }
}
