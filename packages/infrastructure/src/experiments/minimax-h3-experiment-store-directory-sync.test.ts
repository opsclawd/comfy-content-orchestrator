import { mkdtemp, rm } from "node:fs/promises";
import type * as FsPromises from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// Simulate a filesystem that genuinely cannot fsync a directory (EINVAL,
// as some overlay/network filesystems report) by wrapping the real
// node:fs/promises open() and making only directory-mode ("r") opens
// return a handle whose sync() rejects with that code. File writes (the
// "w" mode tmp-path writes) go through untouched, so writeDurableJson's
// actual content-write behavior is unaffected -- only its directory
// barrier is unavailable, which is exactly the scenario the fix targets.
vi.mock("node:fs/promises", async () => {
  const actual = await vi.importActual<typeof FsPromises>("node:fs/promises");
  return {
    ...actual,
    open: async (path: string, mode: string) => {
      if (mode === "r") {
        const realHandle = await actual.open(path, mode);
        return {
          ...realHandle,
          sync: async () => {
            await realHandle.close();
            const err = new Error("EINVAL: directory sync not supported") as NodeJS.ErrnoException;
            err.code = "EINVAL";
            throw err;
          },
          close: async () => {
            // already closed above in the sync() rejection path; a
            // second close() is a no-op either way
          }
        };
      }
      return actual.open(path, mode);
    }
  };
});

const { MinimaxH3ExperimentStore } = await import("./minimax-h3-experiment-store.js");

describe("MinimaxH3ExperimentStore directory-sync visibility", () => {
  let tmpDir: string;
  let warnSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(async () => {
    tmpDir = await mkdtemp(join(tmpdir(), "h3-exp-dirsync-test-"));
    warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
  });

  afterEach(async () => {
    warnSpy.mockRestore();
    await rm(tmpDir, { recursive: true, force: true });
  });

  it("still completes the write and records a warning when directory fsync reports EINVAL", async () => {
    const store = new MinimaxH3ExperimentStore(tmpDir);
    const runDir = join(tmpDir, "run-001");

    const intent = {
      runId: "run-001",
      clientId: "client-abc",
      workflowDigest: "a".repeat(64),
      requestFingerprint: "b".repeat(64),
      timestamp: "2026-10-12T10:00:00.000Z"
    };

    // Must not throw -- EINVAL/ENOTSUP is tolerated, not fatal.
    await store.writeIntent(runDir, intent);

    // The write itself must have actually landed (not silently dropped).
    const readBack = await store.readIntent(runDir);
    expect(readBack).toEqual(intent);

    // But the gap must now be observable rather than fully silent.
    expect(store.directorySyncWarnings).toHaveLength(1);
    expect(store.directorySyncWarnings[0]?.code).toBe("EINVAL");
    expect(store.directorySyncWarnings[0]?.path).toContain("intent.json");
    expect(warnSpy).toHaveBeenCalledTimes(1);
    expect(warnSpy.mock.calls[0]?.[0]).toContain("directory fsync unsupported");
  });
});
