import type { CandidateId, SceneId } from "@cco/domain";
import { verifyApprovedVisualProductionInput } from "@cco/domain";
import type { PersistentMediaRef } from "@cco/contracts";
import { PersistentMediaRefSchema } from "@cco/contracts";
import type {
  HashBytesPort,
  ObjectStoragePort,
  SceneRepository,
  StoryboardCandidateRepository,
  StoredObject
} from "../ports/index.js";
import {
  ApprovedCandidateMediaHashMismatchError,
  ApprovedCandidateMediaUnavailableError,
  type ResolvedApprovedVisualProductionMedia
} from "../ports/approved-candidate-media-errors.js";
import { CandidateNotFoundError } from "./candidate-not-found-error.js";
import { SceneNotFoundError } from "./scene-not-found-error.js";

export const SUPPORTED_CANDIDATE_IMAGE_CONTENT_TYPES: ReadonlySet<string> = new Set([
  "image/png",
  "image/jpeg",
  "image/webp"
]);

export const DEFAULT_MAX_CANDIDATE_IMAGE_BYTES = 10 * 1024 * 1024; // 10 MiB
export const MAX_CANDIDATE_IMAGE_BYTES = DEFAULT_MAX_CANDIDATE_IMAGE_BYTES;

function isCorruptionError(error: unknown): boolean {
  if (error && typeof error === "object") {
    const err = error as { name?: string; message?: string };
    const name = (err.name ?? "").toLowerCase();
    const msg = (err.message ?? "").toLowerCase();
    return (
      name === "baddigest" ||
      name === "checksummismatch" ||
      msg.includes("checksum mismatch") ||
      msg.includes("checksum") ||
      msg.includes("corrupt") ||
      msg.includes("integrity")
    );
  }
  return false;
}

export interface ResolveApprovedCandidateMediaInput {
  readonly sceneId: SceneId;
  readonly approvedCandidateId: CandidateId;
}

export interface ResolveApprovedCandidateMediaDeps {
  readonly sceneRepository: SceneRepository;
  readonly storyboardCandidateRepository: StoryboardCandidateRepository;
  readonly objectStorage: ObjectStoragePort;
  readonly hashBytes: HashBytesPort;
  readonly maxCandidateImageBytes?: number;
}

export class ResolveApprovedCandidateMediaUseCase {
  constructor(private readonly deps: ResolveApprovedCandidateMediaDeps) {}

  async execute(
    input: ResolveApprovedCandidateMediaInput
  ): Promise<ResolvedApprovedVisualProductionMedia> {
    const candidate = await this.deps.storyboardCandidateRepository.findById(
      input.approvedCandidateId
    );
    if (!candidate) {
      throw new CandidateNotFoundError(input.approvedCandidateId);
    }

    const scene = await this.deps.sceneRepository.findById(input.sceneId);
    if (!scene) {
      throw new SceneNotFoundError(input.sceneId);
    }

    const approvedInput = verifyApprovedVisualProductionInput({
      candidate,
      scene: scene.snapshot(),
      job: {
        approvedCandidateId: input.approvedCandidateId,
        sceneId: input.sceneId
      }
    });

    const maxBytes = this.deps.maxCandidateImageBytes ?? DEFAULT_MAX_CANDIDATE_IMAGE_BYTES;

    let stored: StoredObject | undefined;
    try {
      stored = await this.deps.objectStorage.getObject(
        {
          bucket: candidate.storageBucket,
          key: candidate.storageObjectKey
        },
        { maxBytes }
      );
    } catch (error: unknown) {
      if (
        error instanceof ApprovedCandidateMediaUnavailableError ||
        error instanceof ApprovedCandidateMediaHashMismatchError
      ) {
        throw error;
      }
      if (isCorruptionError(error)) {
        throw new ApprovedCandidateMediaUnavailableError(candidate.id, "corrupt", {
          cause: error
        });
      }
      throw new ApprovedCandidateMediaUnavailableError(candidate.id, "unreadable", {
        cause: error
      });
    }

    if (!stored) {
      throw new ApprovedCandidateMediaUnavailableError(candidate.id, "missing");
    }
    if (stored.body.byteLength === 0) {
      throw new ApprovedCandidateMediaUnavailableError(candidate.id, "unreadable");
    }

    let actualSha256: string;
    try {
      actualSha256 = await this.deps.hashBytes.hashBytes(stored.body);
    } catch (error: unknown) {
      throw new ApprovedCandidateMediaUnavailableError(candidate.id, "unreadable", {
        cause: error
      });
    }

    if (actualSha256 !== approvedInput.contentHashSha256) {
      throw new ApprovedCandidateMediaHashMismatchError(
        candidate.id,
        approvedInput.contentHashSha256,
        actualSha256
      );
    }

    const rawContentType = stored.contentType?.trim();
    const mimeType = rawContentType?.split(";")[0]?.trim().toLowerCase();
    if (!mimeType || !SUPPORTED_CANDIDATE_IMAGE_CONTENT_TYPES.has(mimeType)) {
      throw new ApprovedCandidateMediaUnavailableError(candidate.id, "unsupported_content_type");
    }

    const media: PersistentMediaRef = PersistentMediaRefSchema.parse({
      bucket: candidate.storageBucket,
      key: candidate.storageObjectKey,
      sha256: actualSha256,
      contentType: stored.contentType
    });

    return {
      input: approvedInput,
      media
    };
  }

  async resolve(
    input: ResolveApprovedCandidateMediaInput
  ): Promise<ResolvedApprovedVisualProductionMedia> {
    return this.execute(input);
  }
}
