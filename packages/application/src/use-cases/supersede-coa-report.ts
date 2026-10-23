import { SupersedeCoaReportRequestSchema, type SupersedeCoaReportRequest } from "@cco/contracts";
import { createCoaReportId, ProductValidationError, type CoaReportId } from "@cco/domain";
import type { CoaReportSupersessionResult, CommandEnvelope, UnitOfWork } from "../ports/index.js";
import { validateCoaCommandEnvelope } from "./coa-command-envelope-validator.js";

export type SupersedeCoaReportPayload = SupersedeCoaReportRequest & {
  readonly reportId: CoaReportId | string;
};

export class SupersedeCoaReportUseCase {
  constructor(private readonly uow: UnitOfWork) {}

  async execute(
    cmd: CommandEnvelope<SupersedeCoaReportPayload>
  ): Promise<CoaReportSupersessionResult> {
    validateCoaCommandEnvelope(cmd);

    const { reportId: rawReportId, ...restPayload } = cmd.payload;
    const reportId = createCoaReportId(String(rawReportId));

    const parseResult = SupersedeCoaReportRequestSchema.safeParse(restPayload);
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
      return context.coaReports.supersedeReport({
        ...cmd,
        payload: {
          ...parseResult.data,
          reportId
        }
      });
    });
  }
}
