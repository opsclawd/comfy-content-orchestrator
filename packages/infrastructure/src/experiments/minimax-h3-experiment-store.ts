import { createHash } from "node:crypto";
import { createReadStream, existsSync, realpathSync } from "node:fs";
import { copyFile, mkdir, open, readFile, rename, rm, stat, writeFile } from "node:fs/promises";
import { basename, dirname, join, resolve, sep } from "node:path";
import {
  MinimaxH3ExperimentDescriptorSchema,
  MinimaxH3ExperimentIntentSchema,
  MinimaxH3ExperimentReceiptSchema,
  MinimaxH3ExperimentResultSchema,
  MinimaxH3ProcessRecordSchema,
  MinimaxH3TerminalEvidenceSchema,
  type MinimaxH3ExperimentDescriptor,
  type MinimaxH3ExperimentEvent,
  type MinimaxH3ExperimentIntent,
  type MinimaxH3ExperimentReceipt,
  type MinimaxH3ExperimentResult,
  type MinimaxH3ProcessRecord,
  type MinimaxH3TelemetrySample,
  type MinimaxH3TerminalEvidence
} from "@cco/contracts";
import type { MinimaxH3ExperimentStorePort } from "@cco/application";

const FORBIDDEN_SEGMENTS = ["certification", "baseline", "config/render-profiles", "templates"];

function sortKeysRecursively(value: unknown): unknown {
  if (value === null || typeof value !== "object") {
    return value;
  }
  if (Array.isArray(value)) {
    return value.map(sortKeysRecursively);
  }
  const record = value as Record<string, unknown>;
  const sortedKeys = Object.keys(record).sort();
  const sortedObject: Record<string, unknown> = Object.create(null);
  for (const key of sortedKeys) {
    sortedObject[key] = sortKeysRecursively(record[key]);
  }
  return sortedObject;
}

export function canonicalizeJson(value: unknown): string {
  const sorted = sortKeysRecursively(value);
  return JSON.stringify(sorted, null, 2);
}

export function sha256Hex(content: string): string {
  return createHash("sha256").update(content, "utf8").digest("hex");
}

function parseImageDimensions(buf: Buffer): { width: number; height: number; mimeType: string } {
  // PNG: 89 50 4E 47 0D 0A 1A 0A
  if (
    buf.length >= 24 &&
    buf[0] === 0x89 &&
    buf[1] === 0x50 &&
    buf[2] === 0x4e &&
    buf[3] === 0x47 &&
    buf[4] === 0x0d &&
    buf[5] === 0x0a &&
    buf[6] === 0x1a &&
    buf[7] === 0x0a
  ) {
    const width = buf.readUInt32BE(16);
    const height = buf.readUInt32BE(20);
    return { width, height, mimeType: "image/png" };
  }

  // WEBP: RIFF....WEBP
  if (
    buf.length >= 30 &&
    buf.subarray(0, 4).toString("ascii") === "RIFF" &&
    buf.subarray(8, 12).toString("ascii") === "WEBP"
  ) {
    const chunkType = buf.subarray(12, 16).toString("ascii");
    if (chunkType === "VP8X" && buf.length >= 30) {
      const width = 1 + buf.readUIntLE(24, 3);
      const height = 1 + buf.readUIntLE(27, 3);
      return { width, height, mimeType: "image/webp" };
    }
    if (chunkType === "VP8 " && buf.length >= 30) {
      const width = buf.readUInt16LE(26) & 0x3fff;
      const height = buf.readUInt16LE(28) & 0x3fff;
      return { width, height, mimeType: "image/webp" };
    }
    if (chunkType === "VP8L" && buf.length >= 25) {
      const b0 = buf[21]!;
      const b1 = buf[22]!;
      const b2 = buf[23]!;
      const b3 = buf[24]!;
      const width = 1 + (((b1 & 0x3f) << 8) | b0);
      const height = 1 + (((b3 & 0x0f) << 10) | (b2 << 2) | ((b1 & 0xc0) >> 6));
      return { width, height, mimeType: "image/webp" };
    }
  }

  // JPEG: FF D8 FF
  if (buf.length >= 4 && buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff) {
    let offset = 2;
    while (offset < buf.length) {
      if (buf[offset] !== 0xff) break;
      while (offset < buf.length && buf[offset] === 0xff) {
        offset++;
      }
      if (offset >= buf.length) break;
      const marker = buf[offset]!;
      offset++;

      // Standalone markers without length
      if (marker === 0xd8 || marker === 0xd9 || (marker >= 0xd0 && marker <= 0xd7)) {
        continue;
      }

      if (offset + 2 > buf.length) break;
      const length = buf.readUInt16BE(offset);

      // SOF markers: SOF0 (0xC0), SOF1 (0xC1), SOF2 (0xC2), SOF3 (0xC3), SOF5, SOF6, SOF7, SOF9, SOF10, SOF11
      if (
        (marker >= 0xc0 && marker <= 0xc3) ||
        (marker >= 0xc5 && marker <= 0xc7) ||
        (marker >= 0xc9 && marker <= 0xcb) ||
        (marker >= 0xcd && marker <= 0xcf)
      ) {
        if (offset + 7 <= buf.length) {
          const height = buf.readUInt16BE(offset + 3);
          const width = buf.readUInt16BE(offset + 5);
          return { width, height, mimeType: "image/jpeg" };
        }
      }
      offset += length;
    }
  }

  throw new Error("Unsupported image format or corrupt header");
}

export class MinimaxH3ExperimentStore implements MinimaxH3ExperimentStorePort {
  private readonly outputRoot: string;

  constructor(outputRoot: string) {
    this.outputRoot = resolve(outputRoot);
    for (const forbidden of FORBIDDEN_SEGMENTS) {
      const normalized = forbidden.replace(/\//g, sep);
      const parts = this.outputRoot.split(sep);
      if (
        parts.includes(forbidden) ||
        parts.includes(normalized) ||
        this.outputRoot.includes(`${sep}${normalized}${sep}`) ||
        this.outputRoot.endsWith(`${sep}${normalized}`) ||
        this.outputRoot === normalized
      ) {
        throw new Error(
          `Output root "${outputRoot}" targets a forbidden path segment "${forbidden}".`
        );
      }
    }

    // Check realpathSync of outputRoot or existing ancestors to prevent symlinks to forbidden paths
    let current = this.outputRoot;
    while (current && current !== dirname(current)) {
      if (existsSync(current)) {
        try {
          const real = realpathSync(current);
          for (const forbidden of FORBIDDEN_SEGMENTS) {
            const normalized = forbidden.replace(/\//g, sep);
            const realParts = real.split(sep);
            if (
              realParts.includes(forbidden) ||
              realParts.includes(normalized) ||
              real.includes(`${sep}${normalized}${sep}`) ||
              real.endsWith(`${sep}${normalized}`) ||
              real === normalized
            ) {
              throw new Error(
                `Output root "${outputRoot}" targets a forbidden path segment "${forbidden}" via symlink.`
              );
            }
          }
        } catch (e) {
          if ((e as Error).message.includes("forbidden path segment")) throw e;
        }
        break;
      }
      const parent = dirname(current);
      if (parent === current) break;
      current = parent;
    }
  }

  verifyContainment(targetPath: string, rootDir = this.outputRoot): boolean {
    const resolvedTarget = resolve(targetPath);
    const resolvedRoot = resolve(rootDir);

    for (const forbidden of FORBIDDEN_SEGMENTS) {
      const normalized = forbidden.replace(/\//g, sep);
      const targetParts = resolvedTarget.split(sep);
      const rootParts = resolvedRoot.split(sep);
      if (
        targetParts.includes(forbidden) ||
        targetParts.includes(normalized) ||
        resolvedTarget.includes(`${sep}${normalized}${sep}`) ||
        resolvedTarget.endsWith(`${sep}${normalized}`) ||
        resolvedTarget === normalized ||
        rootParts.includes(forbidden) ||
        rootParts.includes(normalized) ||
        resolvedRoot.includes(`${sep}${normalized}${sep}`) ||
        resolvedRoot.endsWith(`${sep}${normalized}`) ||
        resolvedRoot === normalized
      ) {
        return false;
      }
    }

    if (!resolvedTarget.startsWith(resolvedRoot + sep) && resolvedTarget !== resolvedRoot) {
      return false;
    }

    try {
      const effectiveRoot = existsSync(resolvedRoot) ? realpathSync(resolvedRoot) : resolvedRoot;
      let current = resolvedTarget;
      while (current.length >= resolvedRoot.length) {
        if (existsSync(current)) {
          const real = realpathSync(current);
          if (!real.startsWith(effectiveRoot + sep) && real !== effectiveRoot) {
            return false;
          }
          for (const forbidden of FORBIDDEN_SEGMENTS) {
            const normalized = forbidden.replace(/\//g, sep);
            const parts = real.split(sep);
            if (
              parts.includes(forbidden) ||
              parts.includes(normalized) ||
              real.includes(`${sep}${normalized}${sep}`) ||
              real.endsWith(`${sep}${normalized}`) ||
              real === normalized
            ) {
              return false;
            }
          }
        }
        const parent = dirname(current);
        if (parent === current) break;
        current = parent;
      }
    } catch {
      return false;
    }

    return true;
  }

  private assertSafePath(targetPath: string): void {
    if (!this.verifyContainment(targetPath, this.outputRoot)) {
      throw new Error(
        `Path "${targetPath}" is outside allowed experiment output root "${this.outputRoot}" or targets a forbidden path.`
      );
    }
  }

  async createRunDirectory(runDir: string): Promise<void> {
    this.assertSafePath(runDir);
    await mkdir(this.outputRoot, { recursive: true });
    // Exclusive mkdir without recursive: true throws EEXIST if runDir already exists
    await mkdir(runDir, { recursive: false });
  }

  /**
   * Writes content atomically and flushes both the file and parent directory to disk.
   */
  async writeDurableJson(filePath: string, content: unknown): Promise<void> {
    this.assertSafePath(filePath);
    if (
      (filePath.endsWith("/descriptor.json") ||
        filePath.endsWith("\\descriptor.json") ||
        filePath.endsWith("/config.json") ||
        filePath.endsWith("\\config.json")) &&
      existsSync(filePath)
    ) {
      throw new Error(`Cannot overwrite immutable record: ${filePath}`);
    }
    const serialized = JSON.stringify(content, null, 2);
    const parentDir = dirname(filePath);
    await mkdir(parentDir, { recursive: true });

    const tmpPath = `${filePath}.tmp.${Date.now()}.${Math.random().toString(36).substring(2, 8)}`;
    const fileHandle = await open(tmpPath, "w");
    try {
      await fileHandle.writeFile(serialized, "utf8");
      await fileHandle.sync();
    } finally {
      await fileHandle.close();
    }

    await rename(tmpPath, filePath);

    // Sync parent directory to persist directory entry
    try {
      const dirHandle = await open(parentDir, "r");
      try {
        await dirHandle.sync();
      } finally {
        await dirHandle.close();
      }
    } catch (err) {
      const code = (err as NodeJS.ErrnoException).code;
      // Allow platforms/filesystems that explicitly do not support syncing directories
      if (code !== "EINVAL" && code !== "ENOTSUP") {
        throw err;
      }
    }
  }

  async writeDescriptor(runDir: string, descriptor: MinimaxH3ExperimentDescriptor): Promise<void> {
    MinimaxH3ExperimentDescriptorSchema.parse(descriptor);
    await this.writeDurableJson(`${runDir}/descriptor.json`, descriptor);
  }

  async readDescriptor(runDir: string): Promise<MinimaxH3ExperimentDescriptor> {
    const filePath = `${runDir}/descriptor.json`;
    this.assertSafePath(filePath);
    const raw = await readFile(filePath, "utf8");
    const parsed = JSON.parse(raw);
    return MinimaxH3ExperimentDescriptorSchema.parse(parsed);
  }

  async writeConfig(runDir: string, config: Record<string, unknown>): Promise<string> {
    await this.writeDurableJson(`${runDir}/config.json`, config);
    return sha256Hex(canonicalizeJson(config));
  }

  async readConfig(runDir: string): Promise<Record<string, unknown>> {
    const filePath = `${runDir}/config.json`;
    this.assertSafePath(filePath);
    const raw = await readFile(filePath, "utf8");
    return JSON.parse(raw);
  }

  async writeInputManifest(runDir: string, manifest: unknown): Promise<void> {
    await this.writeDurableJson(`${runDir}/input-manifest.json`, manifest);
  }

  async readInputManifest(runDir: string): Promise<unknown> {
    const filePath = `${runDir}/input-manifest.json`;
    this.assertSafePath(filePath);
    const raw = await readFile(filePath, "utf8");
    return JSON.parse(raw);
  }

  async writeMeasurementTemplate(
    runDir: string,
    template: MinimaxH3ExperimentResult
  ): Promise<void> {
    MinimaxH3ExperimentResultSchema.parse(template);
    await this.writeDurableJson(`${runDir}/measurement-template.json`, template);
  }

  async readMeasurementTemplate(runDir: string): Promise<MinimaxH3ExperimentResult | null> {
    const filePath = `${runDir}/measurement-template.json`;
    this.assertSafePath(filePath);
    try {
      const raw = await readFile(filePath, "utf8");
      const parsed = JSON.parse(raw);
      return MinimaxH3ExperimentResultSchema.parse(parsed);
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code === "ENOENT") {
        return null;
      }
      throw err;
    }
  }

  async writeIntent(runDir: string, intent: MinimaxH3ExperimentIntent): Promise<void> {
    await this.writeDurableJson(`${runDir}/intent.json`, intent);
  }

  async readIntent(runDir: string): Promise<MinimaxH3ExperimentIntent | null> {
    const filePath = `${runDir}/intent.json`;
    this.assertSafePath(filePath);
    try {
      const raw = await readFile(filePath, "utf8");
      const parsed = JSON.parse(raw);
      return MinimaxH3ExperimentIntentSchema.parse(parsed);
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code === "ENOENT") {
        return null;
      }
      throw err;
    }
  }

  async writeReceipt(runDir: string, receipt: MinimaxH3ExperimentReceipt): Promise<void> {
    MinimaxH3ExperimentReceiptSchema.parse(receipt);
    await this.writeDurableJson(`${runDir}/receipt.json`, receipt);
  }

  async readReceipt(runDir: string): Promise<MinimaxH3ExperimentReceipt | null> {
    const filePath = `${runDir}/receipt.json`;
    this.assertSafePath(filePath);
    try {
      const raw = await readFile(filePath, "utf8");
      const parsed = JSON.parse(raw);
      return MinimaxH3ExperimentReceiptSchema.parse(parsed);
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code === "ENOENT") {
        return null;
      }
      throw err;
    }
  }

  async writeProcessRecord(runDir: string, record: MinimaxH3ProcessRecord): Promise<void> {
    MinimaxH3ProcessRecordSchema.parse(record);
    await this.writeDurableJson(`${runDir}/process.json`, record);
  }

  async readProcessRecord(runDir: string): Promise<MinimaxH3ProcessRecord | null> {
    const filePath = `${runDir}/process.json`;
    this.assertSafePath(filePath);
    try {
      const raw = await readFile(filePath, "utf8");
      const parsed = JSON.parse(raw);
      return MinimaxH3ProcessRecordSchema.parse(parsed);
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code === "ENOENT") {
        return null;
      }
      throw err;
    }
  }

  async writeTerminalEvidence(runDir: string, evidence: MinimaxH3TerminalEvidence): Promise<void> {
    MinimaxH3TerminalEvidenceSchema.parse(evidence);
    await this.writeDurableJson(`${runDir}/terminal-evidence.json`, evidence);
  }

  async readTerminalEvidence(runDir: string): Promise<MinimaxH3TerminalEvidence | null> {
    const filePath = `${runDir}/terminal-evidence.json`;
    this.assertSafePath(filePath);
    try {
      const raw = await readFile(filePath, "utf8");
      const parsed = JSON.parse(raw);
      return MinimaxH3TerminalEvidenceSchema.parse(parsed);
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code === "ENOENT") {
        return null;
      }
      throw err;
    }
  }

  async appendEvent(runDir: string, event: MinimaxH3ExperimentEvent): Promise<void> {
    const filePath = `${runDir}/events.jsonl`;
    this.assertSafePath(filePath);
    await mkdir(dirname(filePath), { recursive: true });
    const line = JSON.stringify(event) + "\n";
    const fileHandle = await open(filePath, "a");
    try {
      await fileHandle.writeFile(line, "utf8");
      await fileHandle.sync();
    } finally {
      await fileHandle.close();
    }
  }

  async readEvents(runDir: string): Promise<MinimaxH3ExperimentEvent[]> {
    const filePath = `${runDir}/events.jsonl`;
    this.assertSafePath(filePath);
    try {
      const raw = await readFile(filePath, "utf8");
      const lines = raw.split("\n").filter((l) => l.trim().length > 0);
      const events: MinimaxH3ExperimentEvent[] = [];
      for (const line of lines) {
        try {
          events.push(JSON.parse(line));
        } catch {
          // Trailing line corrupted / partial write from crash: stop and return valid prefix
          break;
        }
      }
      return events;
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code === "ENOENT") {
        return [];
      }
      throw err;
    }
  }

  async appendTelemetry(runDir: string, sample: MinimaxH3TelemetrySample): Promise<void> {
    const filePath = `${runDir}/telemetry.jsonl`;
    this.assertSafePath(filePath);
    await mkdir(dirname(filePath), { recursive: true });
    const line = JSON.stringify(sample) + "\n";
    const fileHandle = await open(filePath, "a");
    try {
      await fileHandle.writeFile(line, "utf8");
      await fileHandle.sync();
    } finally {
      await fileHandle.close();
    }
  }

  async readTelemetry(runDir: string): Promise<MinimaxH3TelemetrySample[]> {
    const filePath = `${runDir}/telemetry.jsonl`;
    this.assertSafePath(filePath);
    try {
      const raw = await readFile(filePath, "utf8");
      const lines = raw.split("\n").filter((l) => l.trim().length > 0);
      const samples: MinimaxH3TelemetrySample[] = [];
      for (const line of lines) {
        try {
          samples.push(JSON.parse(line));
        } catch {
          // Trailing line corrupted / partial write from crash: stop and return valid prefix
          break;
        }
      }
      return samples;
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code === "ENOENT") {
        return [];
      }
      throw err;
    }
  }

  async writeResult(runDir: string, result: MinimaxH3ExperimentResult): Promise<void> {
    MinimaxH3ExperimentResultSchema.parse(result);
    await this.writeDurableJson(`${runDir}/result.json`, result);
  }

  async readResult(runDir: string): Promise<MinimaxH3ExperimentResult | null> {
    const filePath = `${runDir}/result.json`;
    this.assertSafePath(filePath);
    try {
      const raw = await readFile(filePath, "utf8");
      const parsed = JSON.parse(raw);
      return MinimaxH3ExperimentResultSchema.parse(parsed);
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code === "ENOENT") {
        return null;
      }
      throw err;
    }
  }

  async stageInputFile(sourcePath: string, destPath: string): Promise<void> {
    this.assertSafePath(destPath);
    if (existsSync(destPath)) {
      throw new Error(`Staged destination already exists: ${destPath}`);
    }
    const base = basename(destPath);
    if (
      base.includes("..") ||
      base.includes("/") ||
      base.includes("\\") ||
      base !== destPath.split(/[/\\]/).pop()
    ) {
      throw new Error(`Invalid destination filename: ${destPath}`);
    }
    const resolvedDest = resolve(destPath);
    const parentDir = dirname(resolvedDest);
    if (basename(parentDir) !== "inputs") {
      throw new Error(`Staged input must be directly inside an 'inputs' directory: ${destPath}`);
    }
    await mkdir(parentDir, { recursive: true });
    await copyFile(sourcePath, destPath);
  }

  async inspectAsset(
    filePath: string
  ): Promise<{ width: number; height: number; mimeType: string }> {
    const fileHandle = await open(filePath, "r");
    try {
      const buf = Buffer.alloc(65536);
      const { bytesRead } = await fileHandle.read(buf, 0, 65536, 0);
      return parseImageDimensions(buf.subarray(0, bytesRead));
    } finally {
      await fileHandle.close();
    }
  }

  async hashFile(filePath: string): Promise<{ sha256: string; sizeBytes: number }> {
    const st = await stat(filePath);
    if (!st.isFile()) {
      throw new Error(`Target is not a regular file: ${filePath}`);
    }
    const hash = createHash("sha256");
    await new Promise<void>((resolvePromise, rejectPromise) => {
      const stream = createReadStream(filePath);
      stream.on("data", (chunk) => hash.update(chunk));
      stream.on("end", () => resolvePromise());
      stream.on("error", (err) => rejectPromise(err));
    });
    const st2 = await stat(filePath);
    if (
      st.size !== st2.size ||
      st.mtimeMs !== st2.mtimeMs ||
      st.ino !== st2.ino ||
      st.dev !== st2.dev
    ) {
      throw new Error(`File modified during hashing: ${filePath}`);
    }
    return { sha256: hash.digest("hex"), sizeBytes: st2.size };
  }

  async readJsonFile<T = unknown>(filePath: string): Promise<T> {
    const raw = await readFile(filePath, "utf8");
    return JSON.parse(raw);
  }

  async readTextFile(filePath: string): Promise<string> {
    return await readFile(filePath, "utf8");
  }

  async writeTextFile(filePath: string, content: string): Promise<void> {
    this.assertSafePath(filePath);
    const parentDir = dirname(filePath);
    await mkdir(parentDir, { recursive: true });
    await writeFile(filePath, content, "utf8");
  }

  async deleteRunFiles(runDir: string, removeOutputs = false): Promise<void> {
    this.assertSafePath(runDir);
    const resolvedRunDir = resolve(runDir);
    const resolvedRoot = resolve(this.outputRoot);
    if (resolvedRunDir === resolvedRoot) {
      throw new Error(`Cannot delete files in output root itself: ${runDir}`);
    }
    if (!existsSync(runDir)) return;

    // Only delete explicitly owned staging and temp directories
    const STAGING_DIRS = ["temp", "inputs", "user"];
    if (removeOutputs === true) {
      STAGING_DIRS.push("outputs");
    }

    for (const dirName of STAGING_DIRS) {
      const targetPath = join(runDir, dirName);
      if (existsSync(targetPath)) {
        await rm(targetPath, { recursive: true, force: true });
      }
    }
  }
}
