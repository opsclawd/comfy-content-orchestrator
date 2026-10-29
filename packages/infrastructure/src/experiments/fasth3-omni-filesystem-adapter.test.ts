import { createHash } from "node:crypto";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { FastH3OmniFilesystemAdapter } from "./fasth3-omni-filesystem-adapter.js";

describe("FastH3OmniFilesystemAdapter", () => {
  let tempDir: string;
  let adapter: FastH3OmniFilesystemAdapter;

  beforeEach(async () => {
    tempDir = await mkdtemp(join(tmpdir(), "fasth3-omni-fs-test-"));
    adapter = new FastH3OmniFilesystemAdapter();
  });

  afterEach(async () => {
    await rm(tempDir, { recursive: true, force: true });
  });

  describe("assertSafeContainment", () => {
    it("allows paths safely inside allowed root", () => {
      expect(() => adapter.assertSafeContainment(`${tempDir}/runs/run-01`, tempDir)).not.toThrow();
    });

    it("rejects path traversal attempting to escape allowed root", () => {
      expect(() => adapter.assertSafeContainment(`${tempDir}/../other-dir`, tempDir)).toThrow(
        /Path containment violation/
      );
    });

    it("rejects unrelated absolute path outside allowed root", () => {
      expect(() => adapter.assertSafeContainment("/etc/shadow", tempDir)).toThrow(
        /Path containment violation/
      );
    });
  });

  describe("File operations and staging", () => {
    it("writes and reads JSON atomically", async () => {
      const filePath = `${tempDir}/test.json`;
      const data = { hello: "world", count: 42 };
      await adapter.writeJson(filePath, data);

      const exists = await adapter.fileExists(filePath);
      expect(exists).toBe(true);

      const read = await adapter.readJson<typeof data>(filePath);
      expect(read).toEqual(data);
    });

    it("computes file sha256 accurately", async () => {
      const filePath = `${tempDir}/test.txt`;
      const content = "Hello FastH3-Omni!";
      await adapter.writeText(filePath, content);

      const expectedHash = createHash("sha256").update(content).digest("hex");
      const actualHash = await adapter.computeFileSha256(filePath);
      expect(actualHash).toBe(expectedHash);
    });

    it("stages input file with verified checksum", async () => {
      const srcPath = `${tempDir}/source.png`;
      const dstPath = `${tempDir}/staged.png`;
      const content = "fake-png-bytes-for-test";
      await writeFile(srcPath, content);

      const hash = createHash("sha256").update(content).digest("hex");

      await adapter.stageInputFile(srcPath, dstPath, hash);

      const dstExists = await adapter.fileExists(dstPath);
      expect(dstExists).toBe(true);

      const dstHash = await adapter.computeFileSha256(dstPath);
      expect(dstHash).toBe(hash);
    });

    it("rejects staging when source hash does not match expected", async () => {
      const srcPath = `${tempDir}/source.png`;
      const dstPath = `${tempDir}/staged.png`;
      await writeFile(srcPath, "actual-bytes");

      await expect(adapter.stageInputFile(srcPath, dstPath, "0".repeat(64))).rejects.toThrow(
        /Source asset hash mismatch/
      );
    });

    it("rejects staging when source file does not exist", async () => {
      const srcPath = `${tempDir}/missing.png`;
      const dstPath = `${tempDir}/staged.png`;

      await expect(adapter.stageInputFile(srcPath, dstPath, "0".repeat(64))).rejects.toThrow(
        /Source asset file not found/
      );
    });
  });
});
