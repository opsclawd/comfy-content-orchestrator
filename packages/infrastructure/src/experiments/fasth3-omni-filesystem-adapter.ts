import { createHash, randomBytes } from "node:crypto";
import {
  copyFile,
  mkdir,
  readFile,
  realpath,
  rename,
  stat,
  unlink,
  writeFile
} from "node:fs/promises";
import { constants as fsConstants, realpathSync } from "node:fs";
import { dirname, isAbsolute, relative, resolve, sep, basename, join } from "node:path";

function tmpSuffix(): string {
  return `.tmp.${randomBytes(8).toString("hex")}`;
}

/** Resolve symlinks on the deepest existing ancestor, re-appending the non-existent tail. */
function realpathDeepest(p: string): string {
  let current = resolve(p);
  const tail: string[] = [];
  for (;;) {
    try {
      return join(realpathSync(current), ...tail.reverse());
    } catch {
      const parent = dirname(current);
      if (parent === current) {
        return resolve(p);
      }
      tail.push(basename(current));
      current = parent;
    }
  }
}
import type { FastH3OmniFilesystemPort } from "@cco/application";

export class FastH3OmniFilesystemAdapter implements FastH3OmniFilesystemPort {
  assertSafeContainment(targetPath: string, allowedRoot: string): void {
    const resolvedRoot = realpathDeepest(allowedRoot);
    const resolvedTarget = realpathDeepest(targetPath);
    const rel = relative(resolvedRoot, resolvedTarget);

    if (rel === ".." || rel.startsWith(`..${sep}`) || isAbsolute(rel)) {
      throw new Error(
        `Path containment violation: path "${targetPath}" resolves outside allowed root "${allowedRoot}"`
      );
    }
  }

  async ensureDirectory(dirPath: string): Promise<void> {
    await mkdir(dirPath, { recursive: true });
  }

  async fileExists(filePath: string): Promise<boolean> {
    try {
      const s = await stat(filePath);
      return s.isFile();
    } catch {
      return false;
    }
  }

  async directoryExists(dirPath: string): Promise<boolean> {
    try {
      const s = await stat(dirPath);
      return s.isDirectory();
    } catch {
      return false;
    }
  }

  async computeFileSha256(filePath: string): Promise<string> {
    const buffer = await readFile(filePath);
    return createHash("sha256").update(buffer).digest("hex");
  }

  async stageInputFile(
    sourcePath: string,
    targetPath: string,
    expectedSha256: string
  ): Promise<void> {
    const sourceExists = await this.fileExists(sourcePath);
    if (!sourceExists) {
      throw new Error(`Source asset file not found at "${sourcePath}" for staging`);
    }

    const sourceHash = await this.computeFileSha256(sourcePath);
    if (sourceHash !== expectedSha256) {
      throw new Error(
        `Source asset hash mismatch for "${sourcePath}": expected ${expectedSha256}, got ${sourceHash}`
      );
    }

    const tmpPath = `${targetPath}${tmpSuffix()}`;
    const realSource = await realpath(sourcePath);
    await copyFile(realSource, tmpPath, fsConstants.COPYFILE_EXCL);

    const stagedHash = await this.computeFileSha256(tmpPath);
    if (stagedHash !== expectedSha256) {
      await unlink(tmpPath).catch(() => {});
      throw new Error(
        `Staged asset verification failed for "${targetPath}": expected ${expectedSha256}, got ${stagedHash}`
      );
    }

    await rename(tmpPath, targetPath);
  }

  async writeJson(filePath: string, data: unknown): Promise<void> {
    const content = JSON.stringify(data, null, 2);
    const tmpPath = `${filePath}${tmpSuffix()}`;
    await writeFile(tmpPath, content, { encoding: "utf8", flag: "wx" });
    await rename(tmpPath, filePath);
  }

  async readJson<T>(filePath: string): Promise<T> {
    const content = await readFile(filePath, "utf8");
    return JSON.parse(content) as T;
  }

  async writeText(filePath: string, content: string): Promise<void> {
    const tmpPath = `${filePath}${tmpSuffix()}`;
    await writeFile(tmpPath, content, { encoding: "utf8", flag: "wx" });
    await rename(tmpPath, filePath);
  }

  async readText(filePath: string): Promise<string> {
    return readFile(filePath, "utf8");
  }
}
