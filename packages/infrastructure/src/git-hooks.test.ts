import { describe, it, expect } from "vitest";
import { execFileSync } from "node:child_process";
import {
  existsSync,
  accessSync,
  constants,
  mkdtempSync,
  rmSync,
  copyFileSync,
  mkdirSync,
  writeFileSync
} from "node:fs";
import { resolve, join } from "node:path";
import { tmpdir } from "node:os";

describe("git hooks verification", () => {
  it("has executable .githooks/pre-commit tracked in repository root", () => {
    const repoRoot = resolve(__dirname, "../../../");
    const preCommitPath = resolve(repoRoot, ".githooks/pre-commit");

    expect(existsSync(preCommitPath)).toBe(true);
    expect(() => accessSync(preCommitPath, constants.X_OK)).not.toThrow();
  });

  it("scripts/check-hooks.js succeeds on configured repository", () => {
    const repoRoot = resolve(__dirname, "../../../");
    const checkHooksScript = resolve(repoRoot, "scripts/check-hooks.js");

    const output = execFileSync("node", [checkHooksScript], {
      cwd: repoRoot,
      encoding: "utf8"
    });

    expect(output).toContain("[check-hooks] verified git pre-commit hook");
  });

  it("scripts/check-hooks.js configures core.hooksPath when run in a fresh clone without existing local git config", () => {
    const repoRoot = resolve(__dirname, "../../../");
    const tmpClone = mkdtempSync(join(tmpdir(), "git-hooks-test-clone-"));
    try {
      execFileSync("git", ["clone", "--no-checkout", repoRoot, tmpClone]);
      mkdirSync(join(tmpClone, ".githooks"), { recursive: true });
      mkdirSync(join(tmpClone, "scripts"), { recursive: true });
      copyFileSync(
        resolve(repoRoot, ".githooks/pre-commit"),
        join(tmpClone, ".githooks/pre-commit")
      );
      copyFileSync(
        resolve(repoRoot, "scripts/check-hooks.js"),
        join(tmpClone, "scripts/check-hooks.js")
      );

      const checkHooksScript = resolve(tmpClone, "scripts/check-hooks.js");
      const output = execFileSync("node", [checkHooksScript], {
        cwd: tmpClone,
        encoding: "utf8"
      });

      expect(output).toContain("[check-hooks] verified git pre-commit hook");

      const resolved = execFileSync("git", ["rev-parse", "--git-path", "hooks"], {
        cwd: tmpClone,
        encoding: "utf8"
      }).trim();
      expect(resolved).toBe(".githooks");
    } finally {
      rmSync(tmpClone, { recursive: true, force: true });
    }
  });

  it("scripts/check-hooks.js protects worktree hook resolution even if legacy husky overwrites shared config", () => {
    const repoRoot = resolve(__dirname, "../../../");
    const testRoot = mkdtempSync(join(tmpdir(), "git-hooks-wt-test-"));
    try {
      const tmpRepo = join(testRoot, "main-repo");
      const tmpWtPost = join(testRoot, "wt-post");
      const tmpWtLegacy = join(testRoot, "wt-legacy");

      // Initialize an isolated git repository so host workspace is never polluted with test branches/worktrees
      mkdirSync(tmpRepo, { recursive: true });
      execFileSync("git", ["init", "-b", "main"], { cwd: tmpRepo });
      execFileSync("git", ["config", "user.email", "test@example.com"], { cwd: tmpRepo });
      execFileSync("git", ["config", "user.name", "Test User"], { cwd: tmpRepo });

      // Copy tracked hooks and scripts into isolated repo
      mkdirSync(join(tmpRepo, ".githooks"), { recursive: true });
      mkdirSync(join(tmpRepo, "scripts"), { recursive: true });
      copyFileSync(
        resolve(repoRoot, ".githooks/pre-commit"),
        join(tmpRepo, ".githooks/pre-commit")
      );
      copyFileSync(
        resolve(repoRoot, "scripts/check-hooks.js"),
        join(tmpRepo, "scripts/check-hooks.js")
      );

      writeFileSync(join(tmpRepo, "README.md"), "# Test\n");
      execFileSync("git", ["add", "."], { cwd: tmpRepo });
      execFileSync("git", ["commit", "-m", "initial commit"], { cwd: tmpRepo });

      // Create detached worktrees in the isolated repo
      execFileSync("git", ["worktree", "add", "--detach", tmpWtPost, "HEAD"], { cwd: tmpRepo });
      execFileSync("git", ["worktree", "add", "--detach", tmpWtLegacy, "HEAD"], { cwd: tmpRepo });

      // Run check-hooks in post-merge worktree
      const checkHooksScript = resolve(tmpWtPost, "scripts/check-hooks.js");
      execFileSync("node", [checkHooksScript], { cwd: tmpWtPost });

      // Simulate legacy worktree setting core.hooksPath = .husky/_
      execFileSync("git", ["config", "core.hooksPath", ".husky/_"], { cwd: tmpWtLegacy });

      // Post-merge worktree should remain resolved to .githooks via worktreeConfig
      const resolvedPost = execFileSync("git", ["rev-parse", "--git-path", "hooks"], {
        cwd: tmpWtPost,
        encoding: "utf8"
      }).trim();
      expect(resolvedPost).toBe(".githooks");
    } finally {
      rmSync(testRoot, { recursive: true, force: true });
    }
  });
});
