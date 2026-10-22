import {
  CrossBatchSourceError,
  NotFoundError,
  type BatchId,
  type ClientId,
  type CoaReport,
  type CoaReportId,
  type EvidenceId
} from "@cco/domain";
import type {
  ArchiveCoaReportRequest,
  CoaReportListResponse,
  CoaReportResponse,
  CoaReportReviewResponse,
  CoaReportRevisionContract,
  CreateCoaReportRequest,
  ReviewCoaReportRequest,
  SupersedeCoaReportRequest
} from "@cco/contracts";
import type {
  CoaReportCreationResult,
  CoaReportSupersessionResult,
  CommandEnvelope,
  ReviewerAuthorizationPort,
  UnitOfWork
} from "../ports/index.js";
import { DenyAllReviewerAuthorizationAdapter } from "../ports/reviewer-authorization-port.js";
import type { CreateCoaReportUseCase } from "./create-coa-report.js";
import type { SupersedeCoaReportUseCase } from "./supersede-coa-report.js";
import type { ReviewCoaReportUseCase } from "./review-coa-report.js";
import type { ArchiveCoaReportUseCase } from "./archive-coa-report.js";

export class CoaReportUseCases {
  constructor(
    private readonly uow: UnitOfWork,
    private readonly createReportUseCase: CreateCoaReportUseCase,
    private readonly supersedeReportUseCase: SupersedeCoaReportUseCase,
    private readonly reviewReportUseCase: ReviewCoaReportUseCase,
    private readonly archiveReportUseCase: ArchiveCoaReportUseCase,
    private readonly reviewerAuth: ReviewerAuthorizationPort = new DenyAllReviewerAuthorizationAdapter()
  ) {}

  private async assertBatchExists(clientId: ClientId, batchId: BatchId): Promise<void> {
    const batch = await this.uow.execute(async (ctx) => {
      if (!ctx.productEvidence) {
        throw new Error("UnitOfWorkContext.productEvidence is not configured.");
      }
      return ctx.productEvidence.getBatchById(clientId, batchId);
    });
    if (!batch) {
      throw new NotFoundError("ProductBatch", batchId);
    }
  }

  async createCoaReport(
    clientId: ClientId,
    batchId: BatchId,
    cmd: CommandEnvelope<CreateCoaReportRequest>
  ): Promise<CoaReportCreationResult> {
    await this.assertBatchExists(clientId, batchId);

    if (cmd.payload.batchId !== batchId) {
      throw new CrossBatchSourceError(
        `Command batchId "${cmd.payload.batchId}" does not match route batchId "${batchId}".`
      );
    }

    const link = await this.uow.execute(async (ctx) => {
      if (!ctx.evidenceAsset) {
        throw new Error("UnitOfWorkContext.evidenceAsset is not configured.");
      }
      return ctx.evidenceAsset.getBatchEvidenceLink(
        clientId,
        batchId,
        cmd.payload.evidenceId as EvidenceId,
        cmd.payload.evidenceRevision
      );
    });
    if (!link) {
      throw new CrossBatchSourceError(
        `Evidence revision ${cmd.payload.evidenceId}:${cmd.payload.evidenceRevision} is not linked to batch "${batchId}".`
      );
    }

    return this.createReportUseCase.execute(cmd);
  }

  async supersedeCoaReport(
    clientId: ClientId,
    batchId: BatchId,
    reportId: CoaReportId,
    cmd: CommandEnvelope<SupersedeCoaReportRequest & { readonly reportId: CoaReportId }>
  ): Promise<CoaReportSupersessionResult> {
    await this.assertBatchExists(clientId, batchId);

    const existing = await this.uow.execute(async (ctx) => {
      if (!ctx.coaReports) {
        throw new Error("UnitOfWorkContext.coaReports is not configured.");
      }
      return ctx.coaReports.getReportById(clientId, reportId);
    });
    if (!existing || existing.batchId !== batchId) {
      throw new NotFoundError("CoaReport", reportId);
    }

    const link = await this.uow.execute(async (ctx) => {
      if (!ctx.evidenceAsset) {
        throw new Error("UnitOfWorkContext.evidenceAsset is not configured.");
      }
      return ctx.evidenceAsset.getBatchEvidenceLink(
        clientId,
        batchId,
        existing.evidenceId,
        cmd.payload.evidenceRevision
      );
    });
    if (!link) {
      throw new CrossBatchSourceError(
        `Evidence revision ${existing.evidenceId}:${cmd.payload.evidenceRevision} is not linked to batch "${batchId}".`
      );
    }

    return this.supersedeReportUseCase.execute(cmd);
  }

  async reviewCoaReport(
    clientId: ClientId,
    batchId: BatchId,
    reportId: CoaReportId,
    cmd: CommandEnvelope<ReviewCoaReportRequest & { readonly reportId: CoaReportId }>
  ): Promise<CoaReportReviewResponse> {
    await this.assertBatchExists(clientId, batchId);

    const existing = await this.uow.execute(async (ctx) => {
      if (!ctx.coaReports) {
        throw new Error("UnitOfWorkContext.coaReports is not configured.");
      }
      return ctx.coaReports.getReportById(clientId, reportId);
    });
    if (!existing || existing.batchId !== batchId) {
      throw new NotFoundError("CoaReport", reportId);
    }

    await this.reviewerAuth.assertCanReviewCoaReport(clientId, cmd.actorId);

    const result = await this.reviewReportUseCase.execute(cmd);
    return {
      report: result.report,
      decisionEvent: result.reviewEvent
    };
  }

  async archiveCoaReport(
    clientId: ClientId,
    batchId: BatchId,
    reportId: CoaReportId,
    cmd: CommandEnvelope<ArchiveCoaReportRequest & { readonly reportId: CoaReportId }>
  ): Promise<CoaReport> {
    await this.assertBatchExists(clientId, batchId);

    const existing = await this.uow.execute(async (ctx) => {
      if (!ctx.coaReports) {
        throw new Error("UnitOfWorkContext.coaReports is not configured.");
      }
      return ctx.coaReports.getReportById(clientId, reportId);
    });
    if (!existing || existing.batchId !== batchId) {
      throw new NotFoundError("CoaReport", reportId);
    }

    const result = await this.archiveReportUseCase.execute(cmd);
    return result.report;
  }

  async getReportById(
    clientId: ClientId,
    batchId: BatchId,
    reportId: CoaReportId
  ): Promise<CoaReportResponse> {
    await this.assertBatchExists(clientId, batchId);

    return this.uow.execute(async (ctx) => {
      if (!ctx.coaReports) {
        throw new Error("UnitOfWorkContext.coaReports is not configured.");
      }
      const report = await ctx.coaReports.getReportById(clientId, reportId);
      if (!report || report.batchId !== batchId) {
        throw new NotFoundError("CoaReport", reportId);
      }

      const revDetail = await ctx.coaReports.getReportRevision(
        clientId,
        reportId,
        report.currentRevision
      );
      if (!revDetail) {
        throw new NotFoundError("CoaReportRevision", `${reportId}:${report.currentRevision}`);
      }

      return {
        report,
        currentRevision: {
          ...revDetail.revision,
          measurements: [...revDetail.measurements]
        }
      };
    });
  }

  async getReportRevision(
    clientId: ClientId,
    batchId: BatchId,
    reportId: CoaReportId,
    revision: number
  ): Promise<CoaReportRevisionContract> {
    await this.assertBatchExists(clientId, batchId);

    return this.uow.execute(async (ctx) => {
      if (!ctx.coaReports) {
        throw new Error("UnitOfWorkContext.coaReports is not configured.");
      }
      const report = await ctx.coaReports.getReportById(clientId, reportId);
      if (!report || report.batchId !== batchId) {
        throw new NotFoundError("CoaReport", reportId);
      }

      const revDetail = await ctx.coaReports.getReportRevision(clientId, reportId, revision);
      if (!revDetail) {
        throw new NotFoundError("CoaReportRevision", `${reportId}:${revision}`);
      }

      return {
        ...revDetail.revision,
        measurements: [...revDetail.measurements]
      };
    });
  }

  async listReportsForBatch(clientId: ClientId, batchId: BatchId): Promise<CoaReportListResponse> {
    await this.assertBatchExists(clientId, batchId);

    return this.uow.execute(async (ctx) => {
      if (!ctx.coaReports) {
        throw new Error("UnitOfWorkContext.coaReports is not configured.");
      }
      const reports = await ctx.coaReports.listReportsForBatch(clientId, batchId);
      return { reports: [...reports] };
    });
  }
}
