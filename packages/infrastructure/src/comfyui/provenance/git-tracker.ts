import { execFile as execFileCallback } from "node:child_process";
import { type Dirent } from "node:fs";
import { readdir, stat } from "node:fs/promises";
import { join, resolve } from "node:path";
import { promisify } from "node:util";

const execFile = promisify(execFileCallback);

const GIT_COMMIT_HASH_REGEX = /^(?:[0-9a-f]{40}|[0-9a-f]{64})$/;

export interface CustomNodeGitRevision {
  readonly name: string;
  readonly commit: string | null;
  readonly status: "tracked" | "not_git" | "unavailable";
}

export interface GitProvenance {
  readonly comfyUiCommit: string;
  readonly customNodes: readonly CustomNodeGitRevision[];
}

export async function readGitCommit(repositoryDir: string): Promise<string> {
  const resolvedDir = resolve(repositoryDir);

  try {
    await stat(join(resolvedDir, ".git"));
  } catch {
    throw new Error(`Directory is not a Git repository: ${resolvedDir}`);
  }

  let stdout: string;
  try {
    const result = await execFile("git", ["-C", resolvedDir, "rev-parse", "--verify", "HEAD"]);
    stdout = result.stdout;
  } catch (err: unknown) {
    const error = err as { stderr?: string; message?: string };
    const errText = `${error.stderr ?? ""} ${error.message ?? ""}`.trim();
    throw new Error(`Failed to read Git commit in ${resolvedDir}: ${errText}`, {
      cause: err
    });
  }

  const commit = stdout.trim().toLowerCase();
  if (!GIT_COMMIT_HASH_REGEX.test(commit)) {
    throw new Error(`Invalid Git commit object ID: "${commit}"`);
  }

  return commit;
}

async function hasPythonPackageEntryPoint(nodePath: string): Promise<boolean> {
  try {
    const entryPoint = await stat(join(nodePath, "__init__.py"));
    return entryPoint.isFile();
  } catch {
    return false;
  }
}

export async function collectGitProvenance(comfyUiDir: string): Promise<GitProvenance> {
  let comfyUiCommit: string;
  try {
    comfyUiCommit = await readGitCommit(comfyUiDir);
  } catch (err) {
    throw new Error(`ComfyUI directory is not a valid Git repository: ${comfyUiDir}`, {
      cause: err
    });
  }

  const customNodesDir = join(comfyUiDir, "custom_nodes");
  let entries: Dirent[] = [];
  try {
    entries = await readdir(customNodesDir, { withFileTypes: true });
  } catch (err: unknown) {
    const error = err as NodeJS.ErrnoException;
    if (error.code === "ENOENT") {
      return Object.freeze({
        comfyUiCommit,
        customNodes: Object.freeze([])
      });
    }
    throw new Error(`Failed to read custom_nodes directory: ${customNodesDir}`, {
      cause: err
    });
  }

  const dirNames = entries
    .filter(
      (entry) =>
        (entry.isDirectory() || entry.isSymbolicLink()) &&
        !entry.name.startsWith(".") &&
        !entry.name.startsWith("__")
    )
    .map((entry) => entry.name)
    .sort((a, b) => (a < b ? -1 : a > b ? 1 : 0));

  const customNodes: CustomNodeGitRevision[] = [];

  for (const name of dirNames) {
    const nodePath = join(customNodesDir, name);
    try {
      const commit = await readGitCommit(nodePath);
      customNodes.push(
        Object.freeze({
          name,
          commit,
          status: "tracked"
        })
      );
    } catch (err: unknown) {
      const error = err as { stderr?: string; message?: string };
      const errText = `${error.stderr ?? ""} ${error.message ?? ""}`.toLowerCase();
      if (errText.includes("not a git repository")) {
        if (!(await hasPythonPackageEntryPoint(nodePath))) {
          continue;
        }

        customNodes.push(
          Object.freeze({
            name,
            commit: null,
            status: "not_git"
          })
        );
      } else {
        customNodes.push(
          Object.freeze({
            name,
            commit: null,
            status: "unavailable"
          })
        );
      }
    }
  }

  return Object.freeze({
    comfyUiCommit,
    customNodes: Object.freeze(customNodes)
  });
}
