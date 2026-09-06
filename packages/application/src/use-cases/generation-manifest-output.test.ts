import { describe, expect, it } from "vitest";
import {
  createGenerationManifestOutput,
  decodeGenerationManifestOutputs,
  extractPrimaryVideoStemMedia
} from "./generation-manifest-output.js";
import { IncompleteVideoStemSourceError } from "../ports/generation-manifest-repository.js";

describe("generation-manifest-output", () => {
  const validSha = "1234567890abcdef1234567890abcdef1234567890abcdef1234567890abcdef";

  describe("createGenerationManifestOutput", () => {
    it("creates a canonical output item with optional contentType", () => {
      const itemWithContentType = createGenerationManifestOutput({
        bucket: "bucket-a",
        key: "key/to/file.mp4",
        filename: "file.mp4",
        checksumSha256: validSha,
        contentType: "video/mp4"
      });

      expect(itemWithContentType).toEqual({
        bucket: "bucket-a",
        key: "key/to/file.mp4",
        filename: "file.mp4",
        checksumSha256: validSha,
        contentType: "video/mp4"
      });

      const itemWithoutContentType = createGenerationManifestOutput({
        bucket: "bucket-b",
        key: "key/to/file.mov",
        filename: "file.mov",
        checksumSha256: validSha
      });

      expect(itemWithoutContentType).toEqual({
        bucket: "bucket-b",
        key: "key/to/file.mov",
        filename: "file.mov",
        checksumSha256: validSha
      });
    });
  });

  describe("decodeGenerationManifestOutputs", () => {
    it("decodes valid outputs array, trims strings, and lowercases sha256", () => {
      const payload = {
        outputs: [
          {
            bucket: " my-bucket ",
            key: " path/to/output.mp4 ",
            filename: "output.mp4",
            checksumSha256: `  ${validSha.toUpperCase()}  `,
            contentType: " video/mp4 "
          }
        ]
      };

      const decoded = decodeGenerationManifestOutputs(payload, "job-1");
      expect(decoded).toEqual([
        {
          bucket: "my-bucket",
          key: "path/to/output.mp4",
          filename: "output.mp4",
          checksumSha256: validSha.toLowerCase(),
          contentType: "video/mp4"
        }
      ]);
    });

    it("throws IncompleteVideoStemSourceError when manifestPayload is null or not an object", () => {
      expect(() => decodeGenerationManifestOutputs(null, "job-null")).toThrow(
        IncompleteVideoStemSourceError
      );
      expect(() => decodeGenerationManifestOutputs(undefined, "job-undef")).toThrow(
        IncompleteVideoStemSourceError
      );
      expect(() => decodeGenerationManifestOutputs("string", "job-str")).toThrow(
        IncompleteVideoStemSourceError
      );
    });

    it("throws IncompleteVideoStemSourceError when outputs property is missing", () => {
      expect(() => decodeGenerationManifestOutputs({}, "job-no-outputs")).toThrow(
        "Missing or empty outputs in manifest_payload"
      );
    });

    it("throws IncompleteVideoStemSourceError when outputs is empty or not an array", () => {
      expect(() => decodeGenerationManifestOutputs({ outputs: [] }, "job-empty")).toThrow(
        "Missing or empty outputs in manifest_payload"
      );
      expect(() =>
        decodeGenerationManifestOutputs({ outputs: "not-array" }, "job-not-arr")
      ).toThrow("Missing or empty outputs in manifest_payload");
    });

    it("throws IncompleteVideoStemSourceError when an output element is not an object", () => {
      expect(() => decodeGenerationManifestOutputs({ outputs: [null] }, "job-null-elem")).toThrow(
        "Output at index 0 is not an object"
      );
    });

    it("throws IncompleteVideoStemSourceError when required bucket is missing or empty", () => {
      expect(() =>
        decodeGenerationManifestOutputs(
          { outputs: [{ key: "k", checksumSha256: validSha }] },
          "job-no-bucket"
        )
      ).toThrow("missing required bucket");

      expect(() =>
        decodeGenerationManifestOutputs(
          { outputs: [{ bucket: "  ", key: "k", checksumSha256: validSha }] },
          "job-empty-bucket"
        )
      ).toThrow("missing required bucket");
    });

    it("throws IncompleteVideoStemSourceError when required key is missing or empty", () => {
      expect(() =>
        decodeGenerationManifestOutputs(
          { outputs: [{ bucket: "b", checksumSha256: validSha }] },
          "job-no-key"
        )
      ).toThrow("missing required key");

      expect(() =>
        decodeGenerationManifestOutputs(
          { outputs: [{ bucket: "b", key: "", checksumSha256: validSha }] },
          "job-empty-key"
        )
      ).toThrow("missing required key");
    });

    it("throws IncompleteVideoStemSourceError when required checksumSha256 is missing or empty", () => {
      expect(() =>
        decodeGenerationManifestOutputs({ outputs: [{ bucket: "b", key: "k" }] }, "job-no-sha")
      ).toThrow("missing required checksumSha256");

      expect(() =>
        decodeGenerationManifestOutputs(
          { outputs: [{ bucket: "b", key: "k", checksumSha256: "   " }] },
          "job-empty-sha"
        )
      ).toThrow("missing required checksumSha256");
    });

    it("throws IncompleteVideoStemSourceError when checksumSha256 is malformed", () => {
      // Too short
      expect(() =>
        decodeGenerationManifestOutputs(
          { outputs: [{ bucket: "b", key: "k", checksumSha256: "1234abcd" }] },
          "job-short-sha"
        )
      ).toThrow("malformed checksumSha256");

      // Non-hex characters
      expect(() =>
        decodeGenerationManifestOutputs(
          { outputs: [{ bucket: "b", key: "k", checksumSha256: "g".repeat(64) }] },
          "job-non-hex"
        )
      ).toThrow("malformed checksumSha256");

      // Too long
      expect(() =>
        decodeGenerationManifestOutputs(
          { outputs: [{ bucket: "b", key: "k", checksumSha256: "a".repeat(65) }] },
          "job-long-sha"
        )
      ).toThrow("malformed checksumSha256");
    });
  });

  describe("extractPrimaryVideoStemMedia", () => {
    it("translates checksumSha256 to sha256 and defaults missing contentType to video/mp4", () => {
      const payload = {
        outputs: [
          {
            bucket: "delivery-bucket",
            key: "renders/scene1.mp4",
            checksumSha256: validSha.toUpperCase()
          }
        ]
      };

      const media = extractPrimaryVideoStemMedia(payload, "job-test");
      expect(media).toEqual({
        bucket: "delivery-bucket",
        key: "renders/scene1.mp4",
        sha256: validSha.toLowerCase(),
        contentType: "video/mp4"
      });
    });

    it("preserves explicit contentType when provided", () => {
      const payload = {
        outputs: [
          {
            bucket: "delivery-bucket",
            key: "renders/scene1.mov",
            checksumSha256: validSha,
            contentType: "video/quicktime"
          }
        ]
      };

      const media = extractPrimaryVideoStemMedia(payload, "job-quicktime");
      expect(media.contentType).toBe("video/quicktime");
    });
  });
});
