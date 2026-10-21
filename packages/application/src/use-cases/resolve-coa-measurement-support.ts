import {
  ResolveCoaMeasurementSupportRequestSchema,
  type ResolveCoaMeasurementSupportRequest,
  type ResolveCoaMeasurementSupportResponse
} from "@cco/contracts";
import { createClientId, ProductValidationError, type ClientId } from "@cco/domain";
import type { UnitOfWork } from "../ports/index.js";

export type ResolveCoaMeasurementSupportInput = ResolveCoaMeasurementSupportRequest & {
  readonly clientId: ClientId | string;
};

export class ResolveCoaMeasurementSupportUseCase {
  constructor(private readonly uow: UnitOfWork) {}

  async execute(
    query: ResolveCoaMeasurementSupportInput
  ): Promise<ResolveCoaMeasurementSupportResponse> {
    const { clientId: rawClientId, ...restQuery } = query;
    const clientId = createClientId(String(rawClientId));

    const parseResult = ResolveCoaMeasurementSupportRequestSchema.safeParse(restQuery);
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
      if (!context.coaReports) {
        throw new Error(
          "UnitOfWorkContext.coaReports is not configured for this UnitOfWork implementation."
        );
      }
      return context.coaReports.resolveMeasurementSupport({
        ...parseResult.data,
        clientId
      });
    });
  }
}
