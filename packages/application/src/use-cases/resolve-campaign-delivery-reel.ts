import {
  AssemblyManifestSchema,
  computeAssemblyId,
  type AssemblyManifest,
  type CampaignDeliveryReelReadModel
} from "@cco/contracts";
import type { CampaignId } from "@cco/domain";
import { BUCKETS } from "@cco/shared";
import type {
  CampaignDeliveryReelQueries,
  CanonicalDeliveryAssemblyRecord,
  ObjectStoragePort,
  ReviewMediaDeliveryPort
} from "../ports/index.js";
import { CampaignNotFoundError } from "./campaign-not-found-error.js";

export interface BuildCampaignDeliveryReelReadModelParams {
  readonly campaignId: string;
  readonly record: CanonicalDeliveryAssemblyRecord;
  readonly objectStorage?: ObjectStoragePort | undefined;
  readonly mediaDelivery?: ReviewMediaDeliveryPort | undefined;
  readonly expirySeconds?: number | undefined;
}

export async function buildCampaignDeliveryReelReadModel(
  params: BuildCampaignDeliveryReelReadModelParams
): Promise<CampaignDeliveryReelReadModel> {
  const { campaignId, record, objectStorage, mediaDelivery, expirySeconds = 300 } = params;

  if (record.status === "not-started") {
    return {
      campaignId,
      status: "not-started",
      state: "not-started",
      ...(record.updatedAt ? { updatedAt: record.updatedAt } : {})
    };
  }

  if (record.status === "assembling") {
    return {
      campaignId,
      status: "assembling",
      state: "assembling",
      ...(record.runId ? { runId: record.runId } : {}),
      ...(record.assemblyJobId ? { assemblyJobId: record.assemblyJobId } : {}),
      ...(record.updatedAt ? { updatedAt: record.updatedAt } : {})
    };
  }

  if (record.status === "failed") {
    return {
      campaignId,
      status: "failed",
      state: "failed",
      ...(record.runId ? { runId: record.runId } : {}),
      ...(record.assemblyJobId ? { assemblyJobId: record.assemblyJobId } : {}),
      ...(record.errorTrace ? { error: record.errorTrace } : {}),
      ...(record.updatedAt ? { updatedAt: record.updatedAt } : {})
    };
  }

  // Completed status handling with fail-closed availability checks
  const unavailable = (reason: string, assemblyId?: string): CampaignDeliveryReelReadModel => ({
    campaignId,
    status: "unavailable-artifact",
    state: "unavailable-artifact",
    ...(assemblyId ? { assemblyId } : {}),
    ...(record.runId ? { runId: record.runId } : {}),
    ...(record.assemblyJobId ? { assemblyJobId: record.assemblyJobId } : {}),
    reason,
    ...(record.updatedAt ? { updatedAt: record.updatedAt } : {})
  });

  if (!record.assemblySpec) {
    return unavailable("Completed delivery assembly record is missing assemblySpec");
  }

  // 1. Multi-tenant isolation: specification layer
  if (record.assemblySpec.campaignId !== campaignId) {
    return unavailable("Assembly spec campaignId does not match requested campaign");
  }

  // 2. Derive canonical assembly identity
  let expectedAssemblyId: string;
  try {
    expectedAssemblyId = computeAssemblyId(record.assemblySpec);
  } catch (err) {
    return unavailable(`Failed to compute assembly identity from spec: ${(err as Error).message}`);
  }

  if (!objectStorage) {
    return unavailable("Object storage port is not configured", expectedAssemblyId);
  }

  // 3. Retrieve AssemblyManifest from delivery storage
  const manifestKey = `campaigns/${campaignId}/assemblies/${expectedAssemblyId}/manifest.json`;
  let manifestObj;
  try {
    manifestObj = await objectStorage.getObject({
      bucket: BUCKETS.DELIVERY,
      key: manifestKey
    });
  } catch (err) {
    return unavailable(
      `Failed to retrieve assembly manifest from storage: ${(err as Error).message}`,
      expectedAssemblyId
    );
  }

  if (!manifestObj || !manifestObj.body) {
    return unavailable("Assembly manifest object was not found in storage", expectedAssemblyId);
  }

  // 4. Validate manifest schema
  let manifest: AssemblyManifest;
  try {
    const rawJson = JSON.parse(new TextDecoder().decode(manifestObj.body));
    manifest = AssemblyManifestSchema.parse(rawJson);
  } catch (err) {
    return unavailable(
      `Assembly manifest is corrupt or invalid: ${(err as Error).message}`,
      expectedAssemblyId
    );
  }

  // 5. Multi-tenant isolation: manifest layer
  if (manifest.campaignId !== campaignId) {
    return unavailable("Manifest campaignId does not match requested campaign", expectedAssemblyId);
  }

  if (manifest.assemblyId !== expectedAssemblyId) {
    return unavailable(
      "Manifest assemblyId does not match expected assembly identity",
      expectedAssemblyId
    );
  }

  // 6. Multi-tenant isolation: storage locator namespace check
  const mediaRef = manifest.output?.media;
  if (!mediaRef || !mediaRef.bucket || !mediaRef.key || !mediaRef.sha256) {
    return unavailable(
      "Assembly manifest output media is incomplete or missing",
      expectedAssemblyId
    );
  }

  const expectedNamespacePrefix = `campaigns/${campaignId}/`;
  if (!mediaRef.key.startsWith(expectedNamespacePrefix)) {
    return unavailable(
      "Assembly output media key does not belong to requested campaign namespace",
      expectedAssemblyId
    );
  }

  // 7. Verify physical output media existence and checksum consistency in storage
  let headResult;
  try {
    headResult = objectStorage.headObject
      ? await objectStorage.headObject(mediaRef)
      : await objectStorage.getObject(mediaRef);
  } catch (err) {
    return unavailable(
      `Failed to verify output media existence in storage: ${(err as Error).message}`,
      expectedAssemblyId
    );
  }

  if (!headResult) {
    return unavailable("Assembly output media object was not found in storage", expectedAssemblyId);
  }

  if (headResult.checksumSha256 && headResult.checksumSha256 !== mediaRef.sha256) {
    return unavailable(
      `Output media checksum mismatch (manifest: ${mediaRef.sha256}, storage: ${headResult.checksumSha256})`,
      expectedAssemblyId
    );
  }

  // 8. Generate short-lived presigned URL on demand via mediaDelivery
  if (!mediaDelivery) {
    return unavailable("Media delivery port is not configured", expectedAssemblyId);
  }

  let url: string;
  try {
    url = await mediaDelivery.generatePresignedReadUrl(
      {
        bucket: mediaRef.bucket,
        key: mediaRef.key,
        contentHash: mediaRef.sha256
      },
      expirySeconds
    );
  } catch (err) {
    return unavailable(
      `Failed to generate presigned URL for output media: ${(err as Error).message}`,
      expectedAssemblyId
    );
  }

  if (!url) {
    return unavailable("Generated presigned URL was empty", expectedAssemblyId);
  }

  return {
    campaignId,
    status: "completed",
    state: "completed",
    assemblyId: manifest.assemblyId,
    ...(record.runId ? { runId: record.runId } : {}),
    ...(record.assemblyJobId ? { assemblyJobId: record.assemblyJobId } : {}),
    manifest,
    media: {
      url,
      bucket: mediaRef.bucket,
      key: mediaRef.key,
      sha256: mediaRef.sha256,
      ...(manifest.output?.durationMs !== undefined
        ? { durationMs: manifest.output.durationMs }
        : {}),
      ...(manifest.output?.width !== undefined ? { width: manifest.output.width } : {}),
      ...(manifest.output?.height !== undefined ? { height: manifest.output.height } : {})
    },
    ...(record.updatedAt ? { updatedAt: record.updatedAt } : {})
  };
}

export interface ResolveCampaignDeliveryReelDependencies {
  readonly queries: CampaignDeliveryReelQueries;
  readonly objectStorage: ObjectStoragePort;
  readonly mediaDelivery: ReviewMediaDeliveryPort;
  readonly expirySeconds?: number | undefined;
}

export class ResolveCampaignDeliveryReelUseCase {
  constructor(private readonly deps: ResolveCampaignDeliveryReelDependencies) {}

  async execute(campaignId: CampaignId | string): Promise<CampaignDeliveryReelReadModel> {
    const record = await this.deps.queries.findCanonicalDeliveryAssembly(campaignId as CampaignId);
    if (!record || !record.campaignExists) {
      throw new CampaignNotFoundError(campaignId);
    }

    return buildCampaignDeliveryReelReadModel({
      campaignId,
      record,
      objectStorage: this.deps.objectStorage,
      mediaDelivery: this.deps.mediaDelivery,
      ...(this.deps.expirySeconds !== undefined ? { expirySeconds: this.deps.expirySeconds } : {})
    });
  }
}
