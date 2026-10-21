import type { EvidenceSourceClass } from "@cco/shared";

export interface EvidenceStoragePolicyConfig {
  readonly policyId: string;
  readonly isProductionApproved: boolean;
  readonly reviewedProductionApprovalIdentity?: string | null | undefined;
  readonly environment: "development" | "test" | "staging" | "production";
  readonly maxClientStorageBytes: number;
  readonly maxConcurrentUploads: number;
  readonly limitsPerSourceClass: Readonly<Record<EvidenceSourceClass, number>>;
}

export const DEFAULT_DEV_EVIDENCE_STORAGE_POLICY: EvidenceStoragePolicyConfig = Object.freeze({
  policyId: "dev-evidence-policy-v1",
  isProductionApproved: false,
  environment: "development",
  maxClientStorageBytes: 10 * 1024 * 1024 * 1024, // 10 GiB
  maxConcurrentUploads: 5,
  limitsPerSourceClass: Object.freeze({
    photo: 10 * 1024 * 1024, // 10 MiB
    document: 25 * 1024 * 1024, // 25 MiB
    coa: 25 * 1024 * 1024, // 25 MiB
    process_record: 25 * 1024 * 1024, // 25 MiB
    raw: 64 * 1024 * 1024, // 64 MiB
    video: 0 // Unsupported
  })
});
