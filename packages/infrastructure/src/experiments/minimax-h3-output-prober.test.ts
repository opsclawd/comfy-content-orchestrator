import { mkdir, mkdtemp, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { MinimaxH3OutputProber } from "./minimax-h3-output-prober.js";

describe("MinimaxH3OutputProber (canonical containment)", () => {
  const cleanupDirs: string[] = [];

  afterEach(async () => {
    cleanupDirs.length = 0;
  });

  async function makeTmpDir(): Promise<string> {
    const dir = await mkdtemp(join(tmpdir(), "minimax-h3-prober-test-"));
    cleanupDirs.push(dir);
    return dir;
  }

  it("fails closed when the output path is a symlink escaping the expected containing directory", async () => {
    const outsideDir = await makeTmpDir();
    const runOutputsDir = await makeTmpDir();

    const secretPath = join(outsideDir, "secret.mp4");
    await writeFile(secretPath, "not actually a video, just a probe target");

    const symlinkPath = join(runOutputsDir, "output.mp4");
    await symlink(secretPath, symlinkPath);

    const prober = new MinimaxH3OutputProber("ffprobe");
    const result = await prober.probeOutput(symlinkPath, 5000, runOutputsDir);

    expect(result.status).toBe("failed");
    expect(
      result.errors.some((e) => e.message.includes("outside the expected output directory"))
    ).toBe(true);
  });

  it("succeeds the containment check for a real file directly inside the expected directory", async () => {
    const runOutputsDir = await makeTmpDir();
    const realPath = join(runOutputsDir, "output.mp4");
    await writeFile(realPath, "not actually a video, just a probe target");

    const prober = new MinimaxH3OutputProber("ffprobe");
    const result = await prober.probeOutput(realPath, 5000, runOutputsDir);

    // ffprobe will fail to parse this as real media, but it must get past
    // the containment check and actually attempt the probe (not fail with
    // the containment-specific error).
    expect(
      result.errors.some((e) => e.message.includes("outside the expected output directory"))
    ).toBe(false);
  });

  it("fails closed for a symlink to a file nested one directory below the expected root", async () => {
    const outsideDir = await makeTmpDir();
    const runOutputsDir = await makeTmpDir();
    const nestedOutsideDir = join(outsideDir, "nested");
    await mkdir(nestedOutsideDir);

    const secretPath = join(nestedOutsideDir, "secret.mp4");
    await writeFile(secretPath, "not actually a video, just a probe target");

    const symlinkPath = join(runOutputsDir, "output.mp4");
    await symlink(secretPath, symlinkPath);

    const prober = new MinimaxH3OutputProber("ffprobe");
    const result = await prober.probeOutput(symlinkPath, 5000, runOutputsDir);

    expect(result.status).toBe("failed");
  });
});
