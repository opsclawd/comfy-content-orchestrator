import { z } from "zod";
import { deepFreeze, type DeepReadonly } from "./deep-freeze.js";

export const LicensePolicyStatusSchema = z.enum([
  "approved",
  "restricted",
  "review_required",
  "blocked"
]);
export type LicensePolicyStatus = z.infer<typeof LicensePolicyStatusSchema>;

export const ComponentTypeSchema = z.enum(["model", "service", "runtime", "library", "provider"]);
export type ComponentType = z.infer<typeof ComponentTypeSchema>;

export const ComponentRefSchema = z
  .object({
    componentId: z.string().min(1, "componentId must not be empty"),
    componentType: ComponentTypeSchema,
    versionOrRevision: z.string().min(1, "versionOrRevision must not be empty")
  })
  .strict();
export type ComponentRef = {
  readonly componentId: string;
  readonly componentType: ComponentType;
  readonly versionOrRevision: string;
};

export const ComponentLicenseEntrySchema = z
  .object({
    componentId: z.string().min(1, "componentId must not be empty"),
    componentType: ComponentTypeSchema,
    versionOrRevision: z.string().min(1, "versionOrRevision must not be empty"),
    status: LicensePolicyStatusSchema,
    licenseId: z.string().min(1).optional(),
    licenseSource: z.string().min(1, "licenseSource must not be empty"),
    reviewedAt: z.string().datetime({ message: "reviewedAt must be an ISO 8601 datetime string" }),
    policyRevision: z.string().min(1, "policyRevision must not be empty"),
    notes: z.string().min(1).optional(),
    territoryPolicy: z.string().min(1).optional(),
    revenueThresholdUsd: z.number().nonnegative().optional(),
    attributionRequired: z.boolean().optional(),
    approver: z.string().min(1).optional()
  })
  .strict();
export type ComponentLicenseEntry = {
  readonly componentId: string;
  readonly componentType: ComponentType;
  readonly versionOrRevision: string;
  readonly status: LicensePolicyStatus;
  readonly licenseId?: string | undefined;
  readonly licenseSource: string;
  readonly reviewedAt: string;
  readonly policyRevision: string;
  readonly notes?: string | undefined;
  readonly territoryPolicy?: string | undefined;
  readonly revenueThresholdUsd?: number | undefined;
  readonly attributionRequired?: boolean | undefined;
  readonly approver?: string | undefined;
};

export const ComponentLicenseRegistrySchema = z
  .object({
    registryRevision: z.string().min(1, "registryRevision must not be empty"),
    generatedAt: z
      .string()
      .datetime({ message: "generatedAt must be an ISO 8601 datetime string" }),
    entries: z.array(ComponentLicenseEntrySchema).min(1, "entries must contain at least one entry")
  })
  .strict()
  .transform((val) => deepFreeze(val));

export type ComponentLicenseRegistry = DeepReadonly<{
  registryRevision: string;
  generatedAt: string;
  entries: readonly ComponentLicenseEntry[];
}>;

export type ComponentLicenseRegistrySnapshot = ComponentLicenseRegistry;
