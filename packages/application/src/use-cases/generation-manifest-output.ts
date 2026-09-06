import type { PersistentMediaRef } from "@cco/contracts";
import { IncompleteVideoStemSourceError } from "../ports/generation-manifest-repository.js";

export interface GenerationManifestOutputItem {
  readonly bucket: string;
  readonly key: string;
  readonly filename?: string | undefined;
  readonly checksumSha256: string;
  readonly contentType?: string | undefined;
}

/** Creates the canonical persisted output shape used by generation manifests. */
export function createGenerationManifestOutput(input: {
  readonly bucket: string;
  readonly key: string;
  readonly filename: string;
  readonly checksumSha256: string;
  readonly contentType?: string | undefined;
}): GenerationManifestOutputItem {
  return {
    bucket: input.bucket,
    key: input.key,
    filename: input.filename,
    checksumSha256: input.checksumSha256,
    ...(input.contentType ? { contentType: input.contentType } : {})
  };
}

const HEX_64_REGEX = /^[0-9a-fA-F]{64}$/;

/**
 * Decodes and validates the `outputs` array from a persisted generation manifest payload.
 * Used by both `PostgresGenerationManifestRepository.getComponentIdentityById` and `findVideoStemSourceByJobId`.
 */
export function decodeGenerationManifestOutputs(
  manifestPayload: unknown,
  jobId: string = "unknown"
): readonly GenerationManifestOutputItem[] {
  if (
    manifestPayload === null ||
    typeof manifestPayload !== "object" ||
    !("outputs" in manifestPayload)
  ) {
    throw new IncompleteVideoStemSourceError(jobId, "Missing or empty outputs in manifest_payload");
  }

  const payload = manifestPayload as { readonly outputs?: unknown };
  if (!Array.isArray(payload.outputs) || payload.outputs.length === 0) {
    throw new IncompleteVideoStemSourceError(jobId, "Missing or empty outputs in manifest_payload");
  }

  const items: GenerationManifestOutputItem[] = [];
  for (let i = 0; i < payload.outputs.length; i++) {
    const raw = payload.outputs[i];
    if (!raw || typeof raw !== "object") {
      throw new IncompleteVideoStemSourceError(jobId, `Output at index ${i} is not an object`);
    }
    const r = raw as Record<string, unknown>;
    if (typeof r.bucket !== "string" || r.bucket.trim().length === 0) {
      throw new IncompleteVideoStemSourceError(
        jobId,
        `Output at index ${i} is missing required bucket`
      );
    }
    if (typeof r.key !== "string" || r.key.trim().length === 0) {
      throw new IncompleteVideoStemSourceError(
        jobId,
        `Output at index ${i} is missing required key`
      );
    }
    if (typeof r.checksumSha256 !== "string" || r.checksumSha256.trim().length === 0) {
      throw new IncompleteVideoStemSourceError(
        jobId,
        `Output at index ${i} is missing required checksumSha256`
      );
    }
    const trimmedChecksum = r.checksumSha256.trim();
    if (!HEX_64_REGEX.test(trimmedChecksum)) {
      throw new IncompleteVideoStemSourceError(
        jobId,
        `Output at index ${i} has malformed checksumSha256: expected 64 hex characters`
      );
    }

    items.push({
      bucket: r.bucket.trim(),
      key: r.key.trim(),
      ...(typeof r.filename === "string" ? { filename: r.filename } : {}),
      checksumSha256: trimmedChecksum.toLowerCase(),
      ...(typeof r.contentType === "string" && r.contentType.trim().length > 0
        ? { contentType: r.contentType.trim() }
        : {})
    });
  }

  return items;
}

/**
 * Extracts and translates the primary (first) video stem output from a generation manifest payload into a PersistentMediaRef.
 * Performs explicit field translation:
 * - checksumSha256 -> sha256 (lowercase)
 * - contentType defaults to "video/mp4" when absent or empty
 */
export function extractPrimaryVideoStemMedia(
  manifestPayload: unknown,
  jobId: string
): PersistentMediaRef {
  const outputs = decodeGenerationManifestOutputs(manifestPayload, jobId);
  const primary = outputs[0];
  if (!primary) {
    throw new IncompleteVideoStemSourceError(jobId, "Missing or empty outputs in manifest_payload");
  }

  return {
    bucket: primary.bucket,
    key: primary.key,
    sha256: primary.checksumSha256,
    contentType: primary.contentType ?? "video/mp4"
  };
}
