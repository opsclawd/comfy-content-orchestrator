import { CreateCoaReportRequestSchema, type CreateCoaReportRequest } from "@cco/contracts";
import { ProductValidationError } from "@cco/domain";
import type { CoaReportCreationResult, CommandEnvelope, UnitOfWork } from "../ports/index.js";
import { validateCoaCommandEnvelope } from "./coa-command-envelope-validator.js";

export class CreateCoaReportUseCase {
  constructor(private readonly uow: UnitOfWork) {}

  async execute(cmd: CommandEnvelope<CreateCoaReportRequest>): Promise<CoaReportCreationResult> {
    validateCoaCommandEnvelope(cmd);

    const parseResult = CreateCoaReportRequestSchema.safeParse(cmd.payload);
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
      return context.coaReports.createReport({
        ...cmd,
        payload: parseResult.data
      });
    });
  }
}
