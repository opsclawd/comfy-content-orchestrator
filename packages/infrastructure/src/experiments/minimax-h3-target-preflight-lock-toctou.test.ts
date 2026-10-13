import { mkdir, rm, unlink, writeFile } from "node:fs/promises";
import type * as FsPromises from "node:fs/promises";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";

// Deterministically inject the TOCTOU race the fix targets: replace the
// lock file -- same path, different content, different inode -- exactly
// between the read (open+fstat+readFile) and the final stat-before-unlink
// check, by intercepting the real node:fs/promises stat() call once.
let replaceOnNextStat: (() => Promise<void>) | null = null;

vi.mock("node:fs/promises", async () => {
  const actual = await vi.importActual<typeof FsPromises>("node:fs/promises");
  return {
    ...actual,
    stat: async (path: Parameters<typeof FsPromises.stat>[0]) => {
      if (replaceOnNextStat) {
        const doReplace = replaceOnNextStat;
        replaceOnNextStat = null;
        await doReplace();
      }
      return actual.stat(path);
    }
  };
});

const { MinimaxH3TargetPreflight } = await import("./minimax-h3-target-preflight.js");

describe("MinimaxH3TargetPreflight GPU lock TOCTOU guard", () => {
  const gpuUuid = "GPU-toctou-test-0000-0000-000000000000";
  const lockDir = resolve(tmpdir(), "cco-gpu-locks");
  const lockPath = resolve(lockDir, `gpu-${gpuUuid}.lock`);

  afterEach(async () => {
    replaceOnNextStat = null;
    await rm(lockPath, { force: true });
  });

  it("releaseGpuLock does not delete a lock file replaced between the read and the unlink", async () => {
    const preflight = new MinimaxH3TargetPreflight();
    await mkdir(lockDir, { recursive: true });
    await writeFile(
      lockPath,
      JSON.stringify({ pid: 1111, lockToken: "stale-token", processStartTimeTicks: 100 }),
      "utf8"
    );

    // When releaseGpuLock's final pre-unlink stat() fires, replace the
    // file with a new owner's lock *before* that stat resolves -- a
    // same-path race, not a same-content race.
    replaceOnNextStat = async () => {
      // writeFile() on an existing path truncates+rewrites in place,
      // keeping the same inode -- not a real replacement. unlink then
      // write to actually get a fresh inode at the same path, the same
      // way a genuinely different process's open()+write() would.
      await unlink(lockPath);
      await writeFile(
        lockPath,
        JSON.stringify({ pid: 2222, lockToken: "new-owners-token", processStartTimeTicks: 200 }),
        "utf8"
      );
    };

    const result = await preflight.releaseGpuLock(gpuUuid, 1111, 100, "stale-token");

    expect(result.released).toBe(false);
    expect(result.reason).toContain("replaced");

    // The new owner's lock must still be intact -- the whole point of
    // the guard.
    const survivingContent = JSON.parse(await actualReadFile(lockPath));
    expect(survivingContent.lockToken).toBe("new-owners-token");
  });

  async function actualReadFile(path: string): Promise<string> {
    const actual = await vi.importActual<typeof FsPromises>("node:fs/promises");
    return actual.readFile(path, "utf8");
  }
});
