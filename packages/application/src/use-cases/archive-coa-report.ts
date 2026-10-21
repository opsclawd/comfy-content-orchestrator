import { ArchiveCoaReportRequestSchema, type ArchiveCoaReportRequest } from "@cco/contracts";
import { createCoaReportId, ProductValidationError, type CoaReportId } from "@cco/domain";
import type { CoaReportArchiveResult, CommandEnvelope, UnitOfWork } from "../ports/index.js";
import { validateCoaCommandEnvelope } from "./coa-command-envelope-validator.js";

export type ArchiveCoaReportPayload = ArchiveCoaReportRequest & {
  readonly reportId: CoaReportId | string;
};

export class ArchiveCoaReportUseCase {
  constructor(private readonly uow: UnitOfWork) {}

  async execute(cmd: CommandEnvelope<ArchiveCoaReportPayload>): Promise<CoaReportArchiveResult> {
    validateCoaCommandEnvelope(cmd);

    const { reportId: rawReportId, ...restPayload } = cmd.payload;
    const reportId = createCoaReportId(String(rawReportId));

    const parseResult = ArchiveCoaReportRequestSchema.safeParse(restPayload);
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
      return context.coaReports.archiveReport({
        ...cmd,
        payload: {
          ...parseResult.data,
          reportId
        }
      });
    });
  }
}
