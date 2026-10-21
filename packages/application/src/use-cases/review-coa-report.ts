import { ReviewCoaReportRequestSchema, type ReviewCoaReportRequest } from "@cco/contracts";
import { createCoaReportId, ProductValidationError, type CoaReportId } from "@cco/domain";
import {
  DenyAllReviewerAuthorizationAdapter,
  type CoaReportReviewResult,
  type CommandEnvelope,
  type ReviewerAuthorizationPort,
  type UnitOfWork
} from "../ports/index.js";
import { validateCoaCommandEnvelope } from "./coa-command-envelope-validator.js";

export type ReviewCoaReportPayload = ReviewCoaReportRequest & {
  readonly reportId: CoaReportId | string;
};

export class ReviewCoaReportUseCase {
  constructor(
    private readonly uow: UnitOfWork,
    private readonly reviewerAuth: ReviewerAuthorizationPort = new DenyAllReviewerAuthorizationAdapter()
  ) {}

  async execute(cmd: CommandEnvelope<ReviewCoaReportPayload>): Promise<CoaReportReviewResult> {
    validateCoaCommandEnvelope(cmd);

    const { reportId: rawReportId, ...restPayload } = cmd.payload;
    const reportId = createCoaReportId(String(rawReportId));

    const parseResult = ReviewCoaReportRequestSchema.safeParse(restPayload);
    if (!parseResult.success) {
      throw new ProductValidationError(
        parseResult.error.issues.map((issue) => ({
          code: "INVALID_FIELD_COMBINATION",
          path: issue.path.map(String),
          message: issue.message
        }))
      );
    }

    await this.reviewerAuth.assertCanReviewCoaReport(cmd.clientId, cmd.actorId);

    return this.uow.execute(async (context) => {
      if (!context.coaReports) {
        throw new Error(
          "UnitOfWorkContext.coaReports is not configured for this UnitOfWork implementation."
        );
      }

      return context.coaReports.reviewReportRevision({
        ...cmd,
        payload: {
          ...parseResult.data,
          reportId
        }
      });
    });
  }
}
