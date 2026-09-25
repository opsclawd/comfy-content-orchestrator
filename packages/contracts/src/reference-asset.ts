import { z } from "zod";
import { sha256HashSchema } from "./persistent-media.js";

export const REFERENCE_ROLES = [
  "subject_identity",
  "product",
  "location",
  "style",
  "composition"
] as const;

export const ReferenceRoleSchema = z.enum(REFERENCE_ROLES);
export type ReferenceRole = z.infer<typeof ReferenceRoleSchema>;

export const ReferenceAssetSchema = z.object({
  id: z.string().uuid(),
  clientId: z.string().uuid(),
  assetType: z.string().min(1).default("image"),
  storageBucket: z.string().min(1),
  storageObjectKey: z.string().min(1),
  contentHashSha256: sha256HashSchema,
  width: z.number().int().positive().optional(),
  height: z.number().int().positive().optional(),
  mimeType: z.string().min(1).default("image/png"),
  displayName: z.string().min(1).optional(),
  archivedAt: z.string().datetime().nullable().optional(),
  groupId: z.string().uuid().nullable().optional()
});
export type ReferenceAsset = z.infer<typeof ReferenceAssetSchema>;
export type ReferenceAssetContract = ReferenceAsset;

export const PREVIEW_AVAILABILITIES = ["available", "unavailable"] as const;
export const PreviewAvailabilitySchema = z.enum(PREVIEW_AVAILABILITIES);
export type PreviewAvailability = z.infer<typeof PreviewAvailabilitySchema>;

export const ReferenceAssetPreviewAvailableSchema = ReferenceAssetSchema.extend({
  previewUrl: z.string().min(1),
  previewAvailability: z.literal("available")
});

export const ReferenceAssetPreviewUnavailableSchema = ReferenceAssetSchema.extend({
  previewUrl: z.null(),
  previewAvailability: z.literal("unavailable")
});

export const ReferenceAssetResponseSchema = z.discriminatedUnion("previewAvailability", [
  ReferenceAssetPreviewAvailableSchema,
  ReferenceAssetPreviewUnavailableSchema
]);
export type ReferenceAssetResponse = z.infer<typeof ReferenceAssetResponseSchema>;
export type ReferenceAssetResponseContract = ReferenceAssetResponse;

export const ReferenceAssetListResponseSchema = z.object({
  references: z.array(ReferenceAssetResponseSchema)
});
export type ReferenceAssetListResponse = z.infer<typeof ReferenceAssetListResponseSchema>;
export type ReferenceAssetListResponseContract = ReferenceAssetListResponse;

export const ReferenceGroupSchema = z.object({
  id: z.string().uuid(),
  clientId: z.string().uuid(),
  campaignId: z.string().uuid().nullable().optional(),
  name: z.string().min(1),
  description: z.string().nullable().optional(),
  createdAt: z.string().datetime(),
  archivedAt: z.string().datetime().nullable().optional()
});
export type ReferenceGroup = z.infer<typeof ReferenceGroupSchema>;
export type ReferenceGroupContract = ReferenceGroup;

export const SceneReferenceBindingSchema = z.object({
  sceneId: z.string().uuid(),
  specRevision: z.number().int().positive(),
  referenceAssetId: z.string().uuid(),
  role: ReferenceRoleSchema,
  weight: z.number().min(0).max(1).nullable().optional(),
  hints: z.record(z.string(), z.unknown()).nullable().optional(),
  archivedAt: z.string().datetime().nullable().optional()
});
export type SceneReferenceBinding = z.infer<typeof SceneReferenceBindingSchema>;
export type SceneReferenceBindingContract = SceneReferenceBinding;
