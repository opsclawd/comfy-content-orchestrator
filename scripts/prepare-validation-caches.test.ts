import { describe, it, expect } from "vitest";
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";

const REPO_ROOT = path.resolve(import.meta.dirname, "..");
const PREPARE_SCRIPT = path.join(REPO_ROOT, "scripts", "prepare-validation-caches.sh");

describe("prepare-validation-caches", () => {
  it("prepare script exists and is executable", () => {
    expect(fs.existsSync(PREPARE_SCRIPT)).toBe(true);
    const stats = fs.statSync(PREPARE_SCRIPT);
    expect(stats.mode & 0o111).toBeTruthy();
  });

  it("runs idempotently in repository root and exits 0", () => {
    const output = execFileSync("bash", [PREPARE_SCRIPT], {
      cwd: REPO_ROOT,
      encoding: "utf-8",
      env: {
        ...process.env,
        PATH: process.env.PATH
      }
    });

    expect(output).toContain("All validation caches prepared and verified successfully.");
    expect(output).toContain("Kokoro model cache already verified in current worktree.");
    expect(output).toContain("Piper voice cache already verified in current worktree.");
    expect(output).toContain("WhisperX model weights already present in current worktree.");
    expect(output).toContain("WhisperX virtualenv already verified in current worktree.");
  });

  it("respects CCO_SHARED_CACHE_DIR environment variable override", () => {
    const testBase = path.join(REPO_ROOT, ".ai-tmp", "test-shared-cache");
    fs.mkdirSync(testBase, { recursive: true });
    const tmpSharedDir = fs.mkdtempSync(path.join(testBase, "cache-"));
    try {
      const output = execFileSync("bash", [PREPARE_SCRIPT], {
        cwd: REPO_ROOT,
        encoding: "utf-8",
        env: {
          ...process.env,
          CCO_SHARED_CACHE_DIR: tmpSharedDir,
          PATH: process.env.PATH
        }
      });

      expect(output).toContain(`Shared cache store: ${tmpSharedDir}`);
      expect(output).toContain("All validation caches prepared and verified successfully.");
      // Verify subdirectories created in custom shared cache dir
      expect(fs.existsSync(path.join(tmpSharedDir, "kokoro-model"))).toBe(true);
      expect(fs.existsSync(path.join(tmpSharedDir, "piper-voice"))).toBe(true);
      expect(fs.existsSync(path.join(tmpSharedDir, "whisperx-model"))).toBe(true);
    } finally {
      fs.rmSync(tmpSharedDir, { recursive: true, force: true });
    }
  });

  it("seeds model caches into a fresh directory with gitdir reference", () => {
    const testBase = path.join(REPO_ROOT, ".ai-tmp", "test-worktree");
    fs.mkdirSync(testBase, { recursive: true });
    const tmpWorktree = fs.mkdtempSync(path.join(testBase, "wt-"));
    const worktreeName = path.basename(tmpWorktree);
    const dummyGitDir = path.join(REPO_ROOT, ".git", "worktrees", worktreeName);
    fs.mkdirSync(dummyGitDir, { recursive: true });
    try {
      // Set up minimal worktree structure with gitdir pointing to main repo
      fs.writeFileSync(path.join(tmpWorktree, ".git"), `gitdir: ${dummyGitDir}\n`, "utf-8");
      fs.mkdirSync(path.join(tmpWorktree, "scripts"), { recursive: true });
      fs.mkdirSync(path.join(tmpWorktree, "docker", "piper"), { recursive: true });

      // Copy required version descriptors and check scripts
      for (const file of [
        ".kokoro-version",
        ".piper-version",
        ".whisperx-version",
        "package.json"
      ]) {
        fs.copyFileSync(path.join(REPO_ROOT, file), path.join(tmpWorktree, file));
      }
      for (const file of [
        "check-kokoro-version.sh",
        "check-piper-version.sh",
        "check-whisperx-version.sh",
        "install-kokoro-model.sh",
        "install-piper-voice.sh",
        "install-whisperx.sh",
        "prepare-validation-caches.sh"
      ]) {
        fs.copyFileSync(
          path.join(REPO_ROOT, "scripts", file),
          path.join(tmpWorktree, "scripts", file)
        );
      }
      fs.copyFileSync(
        path.join(REPO_ROOT, "docker", "piper", "Dockerfile"),
        path.join(tmpWorktree, "docker", "piper", "Dockerfile")
      );

      // Pre-symlink whisperx-venv from main repo so test focuses on Kokoro, Piper, and WhisperX model weights
      const targetVenv = path.join(tmpWorktree, "node_modules", ".cache", "whisperx-venv");
      fs.mkdirSync(path.dirname(targetVenv), { recursive: true });
      const mainVenv = path.join(REPO_ROOT, "node_modules", ".cache", "whisperx-venv");
      if (fs.existsSync(mainVenv)) {
        fs.symlinkSync(mainVenv, targetVenv, "dir");
      }

      const output = execFileSync(
        "bash",
        [path.join(tmpWorktree, "scripts", "prepare-validation-caches.sh")],
        {
          cwd: tmpWorktree,
          encoding: "utf-8",
          env: {
            ...process.env,
            PATH: process.env.PATH
          }
        }
      );

      expect(output).toContain("All validation caches prepared and verified successfully.");

      // Verify cached files were seeded in the worktree
      const kokoroModel = path.join(
        tmpWorktree,
        "node_modules",
        ".cache",
        "kokoro-model",
        "onnx",
        "model_quantized.onnx"
      );
      const piperVoice = path.join(
        tmpWorktree,
        "node_modules",
        ".cache",
        "piper-voice",
        "en_US-lessac-medium.onnx"
      );
      const whisperxModel = path.join(
        tmpWorktree,
        "node_modules",
        ".cache",
        "whisperx-model",
        "wav2vec2_fairseq_base_ls960_asr_ls960.pth"
      );

      expect(fs.existsSync(kokoroModel)).toBe(true);
      expect(fs.existsSync(piperVoice)).toBe(true);
      expect(fs.existsSync(whisperxModel)).toBe(true);
    } finally {
      fs.rmSync(dummyGitDir, { recursive: true, force: true });
      fs.rmSync(tmpWorktree, { recursive: true, force: true });
    }
  });
});
