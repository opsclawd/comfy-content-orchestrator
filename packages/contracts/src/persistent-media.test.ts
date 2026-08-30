import { describe, expect, it } from "vitest";
import { PersistentMediaRefSchema } from "./persistent-media.js";

describe("PersistentMediaRef contract", () => {
  const validHash = "a".repeat(64);

  it("accepts valid persistent media references", () => {
    const valid = {
      bucket: "cco-media",
      key: "renders/scene-1.mp4",
      sha256: validHash,
      contentType: "video/mp4"
    };

    const parsed = PersistentMediaRefSchema.parse(valid);
    expect(parsed).toEqual(valid);
  });

  it("rejects empty bucket or key", () => {
    expect(
      PersistentMediaRefSchema.safeParse({
        bucket: "",
        key: "renders/scene-1.mp4",
        sha256: validHash,
        contentType: "video/mp4"
      }).success
    ).toBe(false);

    expect(
      PersistentMediaRefSchema.safeParse({
        bucket: "cco-media",
        key: "",
        sha256: validHash,
        contentType: "video/mp4"
      }).success
    ).toBe(false);
  });

  it("rejects missing, malformed, or uppercase sha256 hashes", () => {
    // Missing sha256
    expect(
      PersistentMediaRefSchema.safeParse({
        bucket: "cco-media",
        key: "renders/scene-1.mp4",
        contentType: "video/mp4"
      }).success
    ).toBe(false);

    // Empty sha256
    expect(
      PersistentMediaRefSchema.safeParse({
        bucket: "cco-media",
        key: "renders/scene-1.mp4",
        sha256: "",
        contentType: "video/mp4"
      }).success
    ).toBe(false);

    // Too short
    expect(
      PersistentMediaRefSchema.safeParse({
        bucket: "cco-media",
        key: "renders/scene-1.mp4",
        sha256: "abc123",
        contentType: "video/mp4"
      }).success
    ).toBe(false);

    // Uppercase
    expect(
      PersistentMediaRefSchema.safeParse({
        bucket: "cco-media",
        key: "renders/scene-1.mp4",
        sha256: "A".repeat(64),
        contentType: "video/mp4"
      }).success
    ).toBe(false);

    // Non-hex characters
    expect(
      PersistentMediaRefSchema.safeParse({
        bucket: "cco-media",
        key: "renders/scene-1.mp4",
        sha256: "z".repeat(64),
        contentType: "video/mp4"
      }).success
    ).toBe(false);
  });

  it("rejects empty contentType", () => {
    expect(
      PersistentMediaRefSchema.safeParse({
        bucket: "cco-media",
        key: "renders/scene-1.mp4",
        sha256: validHash,
        contentType: ""
      }).success
    ).toBe(false);
  });

  it("does not include presigned URL or filesystem path fields in schema definition", () => {
    const keys = Object.keys(PersistentMediaRefSchema.shape);
    expect(keys).toEqual(["bucket", "key", "sha256", "contentType"]);
    expect(keys).not.toContain("presignedUrl");
    expect(keys).not.toContain("url");
    expect(keys).not.toContain("path");
    expect(keys).not.toContain("filePath");
  });
});
