import { execFileSync } from "node:child_process";
import { existsSync, accessSync, constants } from "node:fs";
import { resolve } from "node:path";
import process from "node:process";
import console from "node:console";

try {
  // If .githooks/pre-commit exists, ensure worktreeConfig is enabled and core.hooksPath is set to .githooks
  if (existsSync(resolve(process.cwd(), ".githooks/pre-commit"))) {
    try {
      execFileSync("git", ["config", "extensions.worktreeConfig", "true"]);
    } catch {
      // non-fatal if outside git repo
    }
    try {
      execFileSync("git", ["config", "--worktree", "core.hooksPath", ".githooks"]);
    } catch {
      // non-fatal if not in worktree or worktreeConfig extension not enabled yet
    }
    try {
      execFileSync("git", ["config", "core.hooksPath", ".githooks"]);
    } catch {
      // non-fatal
    }
  }

  const resolvedHooksPath = execFileSync("git", ["rev-parse", "--git-path", "hooks"], {
    encoding: "utf8"
  }).trim();

  if (!resolvedHooksPath) {
    console.error("[check-hooks] ERROR: git rev-parse --git-path hooks returned an empty path");
    process.exit(1);
  }

  const hooksDir = resolve(process.cwd(), resolvedHooksPath);
  const preCommitPath = resolve(hooksDir, "pre-commit");

  if (!existsSync(preCommitPath)) {
    console.error(
      `[check-hooks] ERROR: resolved hooks path "${resolvedHooksPath}" does not contain "pre-commit" (checked ${preCommitPath})`
    );
    process.exit(1);
  }

  try {
    accessSync(preCommitPath, constants.X_OK);
  } catch {
    console.error(`[check-hooks] ERROR: pre-commit hook at "${preCommitPath}" is not executable`);
    process.exit(1);
  }

  console.log(`[check-hooks] verified git pre-commit hook at ${preCommitPath}`);
} catch (err) {
  const message = err instanceof Error ? err.message : String(err);
  console.error("[check-hooks] ERROR: failed to verify git hooks path:", message);
  process.exit(1);
}
