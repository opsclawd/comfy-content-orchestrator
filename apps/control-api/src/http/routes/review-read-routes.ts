import type { FastifyInstance, FastifyPluginAsync } from "fastify";
import type { SceneReviewDetailReadModel } from "@cco/contracts";
import type { CampaignId, SceneId } from "@cco/domain";
import type { ControlApiAppOptions, ControlApiContainer } from "../types.js";

export interface ReviewReadRoutesOptions {
  readonly container: ControlApiContainer;
  readonly appOptions?: ControlApiAppOptions | undefined;
}

export const campaignReviewSummarySchema = {
  params: {
    type: "object",
    required: ["campaignId"],
    properties: {
      campaignId: {
        type: "string",
        format: "uuid"
      }
    },
    additionalProperties: false
  }
} as const;

export const sceneReviewDetailSchema = {
  params: {
    type: "object",
    required: ["sceneId"],
    properties: {
      sceneId: {
        type: "string",
        format: "uuid"
      }
    },
    additionalProperties: false
  }
} as const;

export const MAX_CANDIDATE_IMAGE_BYTES = 10 * 1024 * 1024; // 10 MiB

export async function readResponseBufferWithLimit(
  response: Response,
  maxBytes: number,
  signal?: AbortSignal
): Promise<Buffer | undefined> {
  if (signal?.aborted) {
    return undefined;
  }

  const contentLengthHeader = response.headers?.get?.("content-length");
  if (contentLengthHeader !== null && contentLengthHeader !== undefined) {
    const parsedLength = parseInt(contentLengthHeader, 10);
    if (!Number.isNaN(parsedLength) && parsedLength > maxBytes) {
      return undefined;
    }
  }

  if (response.body && typeof response.body.getReader === "function") {
    const reader = response.body.getReader();
    const chunks: Uint8Array[] = [];
    let totalBytes = 0;

    try {
      while (true) {
        if (signal?.aborted) {
          await reader.cancel();
          return undefined;
        }
        const { done, value } = await reader.read();
        if (done) break;
        if (value) {
          totalBytes += value.byteLength;
          if (totalBytes > maxBytes) {
            await reader.cancel();
            return undefined;
          }
          chunks.push(value);
        }
      }
      return Buffer.concat(chunks, totalBytes);
    } catch {
      return undefined;
    }
  }

  if (typeof response.arrayBuffer === "function") {
    const arrayBuffer = await response.arrayBuffer();
    if (arrayBuffer.byteLength > maxBytes || signal?.aborted) {
      return undefined;
    }
    return Buffer.from(arrayBuffer);
  }

  return undefined;
}

export const reviewReadRoutes: FastifyPluginAsync<ReviewReadRoutesOptions> = async (
  fastify: FastifyInstance,
  opts: ReviewReadRoutesOptions
): Promise<void> => {
  const { container } = opts;

  fastify.get<{ Params: { campaignId: string } }>(
    "/api/campaigns/:campaignId/review-summary",
    { schema: campaignReviewSummarySchema },
    async (request, reply) => {
      const { campaignId } = request.params;
      const queries = container.queries.sceneReview;

      const summary = queries
        ? await queries.getCampaignReviewSummary(campaignId as CampaignId)
        : undefined;
      if (!summary) {
        return reply.status(404).send({
          code: "NOT_FOUND",
          message: `Campaign '${campaignId}' review summary was not found.`
        });
      }

      return reply.status(200).send(summary);
    }
  );

  fastify.get<{ Params: { sceneId: string } }>(
    "/api/scenes/:sceneId/review",
    { schema: sceneReviewDetailSchema },
    async (request, reply) => {
      const { sceneId } = request.params;
      const queries = container.queries.sceneReview;
      const mediaDelivery = container.dependencies.reviewMediaDelivery;

      const detail = queries ? await queries.getSceneReviewDetail(sceneId as SceneId) : undefined;
      if (!detail) {
        return reply.status(404).send({
          code: "NOT_FOUND",
          message: `Scene '${sceneId}' review detail was not found.`
        });
      }

      const rankedGroups = container.useCases.rankReviewCandidates
        ? await container.useCases.rankReviewCandidates.execute(detail, async (c, signal) => {
            if (!mediaDelivery || signal?.aborted) return undefined;
            try {
              const url = await mediaDelivery.generatePresignedReadUrl({
                bucket: c.storageBucket,
                key: c.storageObjectKey,
                contentHash: c.contentHash
              });
              if (!url || signal?.aborted) return undefined;
              const response = await fetch(url, { ...(signal ? { signal } : {}) });
              if (!response.ok || signal?.aborted) return undefined;
              const mimeType =
                response.headers?.get?.("content-type") ?? "application/octet-stream";
              const buffer = await readResponseBufferWithLimit(
                response,
                MAX_CANDIDATE_IMAGE_BYTES,
                signal
              );
              if (!buffer) return undefined;
              return { base64Data: buffer.toString("base64"), mimeType };
            } catch {
              return undefined;
            }
          })
        : detail.candidatesByRevision;

      const candidatesByRevision = await Promise.all(
        rankedGroups.map(async (group) => {
          const candidates = await Promise.all(
            group.candidates.map(async (c) => {
              let media: { available: boolean; url?: string } = { available: false };

              if (mediaDelivery) {
                try {
                  const url = await mediaDelivery.generatePresignedReadUrl({
                    bucket: c.storageBucket,
                    key: c.storageObjectKey,
                    contentHash: c.contentHash
                  });
                  if (url) {
                    media = { available: true, url };
                  }
                } catch {
                  media = { available: false };
                }
              }

              return {
                candidateId: c.id,
                sceneId: c.sceneId,
                specRevision: c.specRevision,
                variantOrdinal: c.variantOrdinal,
                contentHash: c.contentHash,
                media,
                ...(c.generationMetadata ? { generationMetadata: c.generationMetadata } : {}),
                createdAt: c.createdAt
              };
            })
          );

          return {
            specRevision: group.specRevision,
            candidates
          };
        })
      );

      const readModel: SceneReviewDetailReadModel = {
        sceneId: detail.sceneId,
        campaignId: detail.campaignId,
        status: detail.status,
        specRevision: detail.specRevision,
        configuration: {
          prompt: detail.configuration.prompt,
          referenceIds: [...detail.configuration.referenceIds],
          engineProfileId: detail.configuration.engineProfileId,
          durationMs: detail.configuration.durationMs,
          ...(detail.configuration.loraConfigurationId !== undefined
            ? { loraConfigurationId: detail.configuration.loraConfigurationId }
            : {})
        },
        ...(detail.selectedCandidateId ? { selectedCandidateId: detail.selectedCandidateId } : {}),
        ...(detail.selectedCandidateRevision !== undefined
          ? { selectedCandidateRevision: detail.selectedCandidateRevision }
          : {}),
        ...(detail.approval ? { approval: detail.approval } : {}),
        candidatesByRevision,
        allowedActions: [...detail.allowedActions]
      };

      return reply.status(200).send(readModel);
    }
  );
};
