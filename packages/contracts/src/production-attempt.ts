import { z } from "zod";

export const PRODUCTION_ATTEMPT_TECHNICAL_STATES = [
  "queued",
  "leased",
  "rendering",
  "completed",
  "failed",
  "cancelled"
] as const;

export type ProductionAttemptTechnicalState = (typeof PRODUCTION_ATTEMPT_TECHNICAL_STATES)[number];

export const ProductionAttemptTechnicalStateSchema = z.enum(PRODUCTION_ATTEMPT_TECHNICAL_STATES);

export const PRODUCTION_ATTEMPT_AVAILABILITIES = [
  "available",
  "unavailable",
  "missing_manifest",
  "inconsistent"
] as const;

export type ProductionAttemptAvailability = (typeof PRODUCTION_ATTEMPT_AVAILABILITIES)[number];

export const ProductionAttemptAvailabilitySchema = z.enum(PRODUCTION_ATTEMPT_AVAILABILITIES);

export const ProductionAttemptMediaReadModelSchema = z.object({
  url: z.string().min(1, "URL must not be empty"),
  generationManifestId: z.string().uuid("generationManifestId must be a valid UUID")
});

export type ProductionAttemptMediaReadModel = {
  readonly url: string;
  readonly generationManifestId: string;
};

export const CurrentProductionAttemptReadModelSchema = z.object({
  runId: z.string().uuid("runId must be a valid UUID"),
  sceneId: z.string().uuid("sceneId must be a valid UUID"),
  specRevision: z.number().int().positive("specRevision must be a positive integer"),
  attemptOrdinal: z.number().int().positive("attemptOrdinal must be a positive integer"),
  productionJobId: z.string().uuid("productionJobId must be a valid UUID").optional(),
  technicalState: ProductionAttemptTechnicalStateSchema,
  reviewReady: z.boolean(),
  availability: ProductionAttemptAvailabilitySchema,
  media: ProductionAttemptMediaReadModelSchema.optional()
});

export type CurrentProductionAttemptReadModel = {
  readonly runId: string;
  readonly sceneId: string;
  readonly specRevision: number;
  readonly attemptOrdinal: number;
  readonly productionJobId?: string | undefined;
  readonly technicalState: ProductionAttemptTechnicalState;
  readonly reviewReady: boolean;
  readonly availability: ProductionAttemptAvailability;
  readonly media?: ProductionAttemptMediaReadModel | undefined;
};
