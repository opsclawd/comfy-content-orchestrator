import { z } from "zod";

export const DeployedRealmSchema = z
  .object({
    kind: z.literal("deployed"),
    deploymentId: z.string().trim().min(1)
  })
  .strict();
export type DeployedRealm = z.infer<typeof DeployedRealmSchema>;

export const IsolatedTestRealmSchema = z
  .object({
    kind: z.literal("isolated_test"),
    testRealmId: z.string().trim().min(1),
    isolationDescriptorDigest: z
      .string()
      .regex(/^[0-9a-f]{64}$/, "Must be a 64-character lowercase hexadecimal hash")
  })
  .strict();
export type IsolatedTestRealm = z.infer<typeof IsolatedTestRealmSchema>;

export const ExecutionRealmSchema = z.discriminatedUnion("kind", [
  DeployedRealmSchema,
  IsolatedTestRealmSchema
]);
export type ExecutionRealm = z.infer<typeof ExecutionRealmSchema>;

export const EvidenceOriginSchema = z.enum(["live_execution", "simulated_test"]);
export type EvidenceOrigin = z.infer<typeof EvidenceOriginSchema>;

export const OwnerKindSchema = z.enum([
  "production_run",
  "staging_acceptance",
  "standalone_staging",
  "legacy_unspecified"
]);
export type OwnerKind = z.infer<typeof OwnerKindSchema>;

export const SimulationDescriptorSchema = z
  .object({
    testRealmId: z.string().trim().min(1),
    isolationDescriptorDigest: z
      .string()
      .regex(/^[0-9a-f]{64}$/, "Must be a 64-character lowercase hexadecimal hash"),
    fixtureSetRevision: z.string().trim().min(1),
    fixtureSourceIds: z.array(z.string().trim().min(1)).default([]),
    adapterObservationReceiptIds: z.array(z.string().trim().min(1)).default([])
  })
  .strict();
export type SimulationDescriptor = z.infer<typeof SimulationDescriptorSchema>;

export const SourceBytesObservationSchema = z
  .object({
    kind: z.literal("source_bytes"),
    tool: z.string().trim().min(1),
    bytes: z.number().int().positive(),
    checksumSha256: z
      .string()
      .regex(/^[0-9a-f]{64}$/, "Must be a 64-character lowercase hexadecimal hash"),
    durationMs: z.number().positive(),
    observedAt: z.string().datetime()
  })
  .strict();
export type SourceBytesObservation = z.infer<typeof SourceBytesObservationSchema>;

export const RuntimeObservationSchema = z
  .object({
    kind: z.literal("runtime"),
    durationMs: z.number().positive(),
    peakVramMb: z.number().int().positive().optional(),
    observedAt: z.string().datetime()
  })
  .strict();
export type RuntimeObservation = z.infer<typeof RuntimeObservationSchema>;

export const FixtureObservationSchema = z
  .object({
    kind: z.literal("fixture_observation"),
    sourceId: z.string().trim().min(1),
    receiptId: z.string().trim().min(1),
    durationMs: z.number().positive(),
    frameCount: z.number().int().positive(),
    fps: z.number().positive(),
    observedAt: z.string().datetime()
  })
  .strict();
export type FixtureObservation = z.infer<typeof FixtureObservationSchema>;

export const ExecutionObservationSchema = z.discriminatedUnion("kind", [
  SourceBytesObservationSchema,
  RuntimeObservationSchema,
  FixtureObservationSchema
]);
export type ExecutionObservation = z.infer<typeof ExecutionObservationSchema>;
