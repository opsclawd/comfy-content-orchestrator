import { execFile as execFileCallback } from "node:child_process";
import * as fsPromises from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  collectGitProvenance,
  readGitCommit,
  type CustomNodeGitRevision,
  type GitProvenance
} from "./git-tracker.js";

const execFile = promisify(execFileCallback);

async function initGitRepo(dir: string): Promise<string> {
  await fsPromises.mkdir(dir, { recursive: true });
  await execFile("git", ["init"], { cwd: dir });
  await execFile("git", ["config", "user.name", "Test Author"], { cwd: dir });
  await execFile("git", ["config", "user.email", "test@example.com"], { cwd: dir });
  await fsPromises.writeFile(join(dir, "README.md"), "test\n");
  await execFile("git", ["add", "."], { cwd: dir });
  await execFile("git", ["commit", "-m", "initial commit"], { cwd: dir });
  const { stdout } = await execFile("git", ["rev-parse", "HEAD"], { cwd: dir });
  return stdout.trim().toLowerCase();
}

describe("ComfyUI and Custom-Node Git Tracker", () => {
  let tempDir: string;

  beforeEach(async () => {
    tempDir = await fsPromises.mkdtemp(join(tmpdir(), "git-tracker-test-"));
  });

  afterEach(async () => {
    await fsPromises.rm(tempDir, { recursive: true, force: true });
  });

  it("git provenance captures the exact ComfyUI HEAD", async () => {
    const comfyUiDir = join(tempDir, "comfyui");
    const commit = await initGitRepo(comfyUiDir);

    const provenance: GitProvenance = await collectGitProvenance(comfyUiDir);

    expect(provenance.comfyUiCommit).toBe(commit);
    expect(provenance.customNodes).toEqual([]);
  });

  it("git provenance sorts custom nodes and marks non-Git directories", async () => {
    const comfyUiDir = join(tempDir, "comfyui");
    const comfyCommit = await initGitRepo(comfyUiDir);

    const customNodesDir = join(comfyUiDir, "custom_nodes");
    await fsPromises.mkdir(customNodesDir, { recursive: true });

    // Create custom nodes in unsorted order
    const commitZ = await initGitRepo(join(customNodesDir, "custom-node-z"));
    const commitA = await initGitRepo(join(customNodesDir, "custom-node-a"));

    // Create a plain directory (not a git repo)
    await fsPromises.mkdir(join(customNodesDir, "plain-dir"));

    const provenance: GitProvenance = await collectGitProvenance(comfyUiDir);

    expect(provenance.comfyUiCommit).toBe(comfyCommit);
    expect(provenance.customNodes).toHaveLength(3);

    const expectedNodes: readonly CustomNodeGitRevision[] = [
      {
        name: "custom-node-a",
        commit: commitA,
        status: "tracked"
      },
      {
        name: "custom-node-z",
        commit: commitZ,
        status: "tracked"
      },
      {
        name: "plain-dir",
        commit: null,
        status: "not_git"
      }
    ];

    expect(provenance.customNodes).toEqual(expectedNodes);
  });

  it("git provenance tolerates a missing custom_nodes directory", async () => {
    const comfyUiDir = join(tempDir, "comfyui");
    const commit = await initGitRepo(comfyUiDir);

    const provenance = await collectGitProvenance(comfyUiDir);

    expect(provenance.comfyUiCommit).toBe(commit);
    expect(provenance.customNodes).toEqual([]);
  });

  it("git provenance fails when the ComfyUI base is not a Git repository", async () => {
    const nonRepoDir = join(tempDir, "plain-comfyui");
    await fsPromises.mkdir(nonRepoDir, { recursive: true });

    await expect(collectGitProvenance(nonRepoDir)).rejects.toThrow(/not a valid git repository/i);
  });

  it("git commit lookup treats metacharacters in paths as data", async () => {
    const specialDir = join(tempDir, "repo with spaces and $pecial & chars; (test) 'quote'");
    const commit = await initGitRepo(specialDir);

    const result = await readGitCommit(specialDir);

    expect(result).toBe(commit);
  });

  it("classifies corrupted or unresolvable custom-node repository as unavailable", async () => {
    const comfyUiDir = join(tempDir, "comfyui");
    await initGitRepo(comfyUiDir);

    const customNodesDir = join(comfyUiDir, "custom_nodes");
    const emptyRepoDir = join(customNodesDir, "empty-repo");
    await fsPromises.mkdir(emptyRepoDir, { recursive: true });
    // git init without any commits has an unborn HEAD
    await execFile("git", ["init"], { cwd: emptyRepoDir });

    const provenance = await collectGitProvenance(comfyUiDir);

    expect(provenance.customNodes).toEqual([
      {
        name: "empty-repo",
        commit: null,
        status: "unavailable"
      }
    ]);
  });
});
