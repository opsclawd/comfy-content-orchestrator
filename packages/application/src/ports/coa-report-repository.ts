import type {
  BatchId,
  ClientId,
  CoaMeasurement,
  CoaReport,
  CoaReportId,
  CoaReportReviewEvent,
  CoaReportRevision
} from "@cco/domain";
import type {
  ArchiveCoaReportRequest,
  CreateCoaReportRequest,
  ResolveCoaMeasurementSupportRequest,
  ResolveCoaMeasurementSupportResponse,
  ReviewCoaReportRequest,
  SupersedeCoaReportRequest
} from "@cco/contracts";
import type { CommandEnvelope } from "./product-evidence-repository.js";

export interface CoaReportCreationResult {
  readonly report: CoaReport;
  readonly revision: CoaReportRevision;
  readonly measurements: readonly CoaMeasurement[];
}

export interface CoaReportSupersessionResult {
  readonly report: CoaReport;
  readonly revision: CoaReportRevision;
  readonly measurements: readonly CoaMeasurement[];
  readonly audit: {
    readonly previous: CoaReport;
    readonly current: CoaReport;
  };
}

export interface CoaReportReviewResult {
  readonly report: CoaReport;
  readonly reviewEvent: CoaReportReviewEvent;
}

export interface CoaReportArchiveResult {
  readonly report: CoaReport;
  readonly audit: {
    readonly previous: CoaReport;
    readonly current: CoaReport;
  };
}

export interface CoaReportRevisionDetail {
  readonly revision: CoaReportRevision;
  readonly measurements: readonly CoaMeasurement[];
  readonly reviewEvent: CoaReportReviewEvent | null;
}

export interface CoaReportRepositoryPort {
  createReport(cmd: CommandEnvelope<CreateCoaReportRequest>): Promise<CoaReportCreationResult>;

  supersedeReport(
    cmd: CommandEnvelope<SupersedeCoaReportRequest & { readonly reportId: CoaReportId }>
  ): Promise<CoaReportSupersessionResult>;

  reviewReportRevision(
    cmd: CommandEnvelope<ReviewCoaReportRequest & { readonly reportId: CoaReportId }>
  ): Promise<CoaReportReviewResult>;

  archiveReport(
    cmd: CommandEnvelope<ArchiveCoaReportRequest & { readonly reportId: CoaReportId }>
  ): Promise<CoaReportArchiveResult>;

  getReportById(clientId: ClientId, reportId: CoaReportId): Promise<CoaReport | null>;

  getReportRevision(
    clientId: ClientId,
    reportId: CoaReportId,
    revision: number
  ): Promise<CoaReportRevisionDetail | null>;

  getReportHistory(
    clientId: ClientId,
    reportId: CoaReportId
  ): Promise<readonly CoaReportRevisionDetail[]>;

  listReportsForBatch(clientId: ClientId, batchId: BatchId): Promise<readonly CoaReport[]>;

  resolveMeasurementSupport(
    query: ResolveCoaMeasurementSupportRequest & { readonly clientId: ClientId }
  ): Promise<ResolveCoaMeasurementSupportResponse>;
}
