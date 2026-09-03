import type {
  ComponentLicenseEntry,
  ComponentLicenseRegistrySnapshot,
  LicensePolicyStatus
} from "@cco/contracts";

export function buildApprovedAcceptanceRegistrySnapshot(options?: {
  ffmpegVersion?: string | undefined;
  additionalEntries?: readonly ComponentLicenseEntry[] | undefined;
}): ComponentLicenseRegistrySnapshot {
  const ffmpegVersion = options?.ffmpegVersion ?? "n8.0.1";
  const defaultEntries: ComponentLicenseEntry[] = [
    {
      componentId: "ffmpeg",
      componentType: "runtime",
      versionOrRevision: ffmpegVersion,
      status: "approved",
      licenseSource: "FFmpeg LGPL/GPL Runtime Distribution",
      reviewedAt: "2026-08-29T12:00:00.000Z",
      policyRevision: "2026-08-29.1"
    },
    {
      componentId: "LTX_25_720P_5S_V1",
      componentType: "model",
      versionOrRevision: "1",
      status: "approved",
      licenseSource: "Lightricks LTX Video Model License",
      reviewedAt: "2026-08-29T12:00:00.000Z",
      policyRevision: "2026-08-29.1"
    },
    {
      componentId: "ltx-fake-profile",
      componentType: "model",
      versionOrRevision: "1",
      status: "approved",
      licenseSource: "Acceptance Test Stand-in Profile",
      reviewedAt: "2026-08-29T12:00:00.000Z",
      policyRevision: "2026-08-29.1"
    },
    {
      componentId: "azure-tts",
      componentType: "provider",
      versionOrRevision: "1",
      status: "approved",
      licenseSource: "Azure Cognitive Services Commercial Terms",
      reviewedAt: "2026-08-29T12:00:00.000Z",
      policyRevision: "2026-08-29.1"
    },
    ...(options?.additionalEntries ?? [])
  ];

  return {
    registryRevision: "2026-08-29.acceptance-1",
    generatedAt: "2026-08-29T12:00:00.000Z",
    entries: defaultEntries
  };
}

export function withComponentStatus(
  snapshot: ComponentLicenseRegistrySnapshot,
  componentId: string,
  status: LicensePolicyStatus | "unregistered"
): ComponentLicenseRegistrySnapshot {
  if (status === "unregistered") {
    return {
      ...snapshot,
      entries: snapshot.entries.filter((entry) => entry.componentId !== componentId)
    };
  }

  return {
    ...snapshot,
    entries: snapshot.entries.map((entry) =>
      entry.componentId === componentId ? { ...entry, status } : entry
    )
  };
}

export function withRegistryRevision(
  snapshot: ComponentLicenseRegistrySnapshot,
  registryRevision: string
): ComponentLicenseRegistrySnapshot {
  return {
    ...snapshot,
    registryRevision
  };
}
