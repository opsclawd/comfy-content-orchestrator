import { describe, it, expect, afterAll } from "vitest";
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";

const REPO_ROOT = path.resolve(import.meta.dirname, "..");
const PREPARE_SCRIPT = path.join(REPO_ROOT, "scripts", "prepare-validation-caches.sh");
const TEST_TMP_DIR = path.join(REPO_ROOT, ".ai-tmp", `test-prepare-${Date.now()}`);

function createMockScripts(targetDir: string, failOnInstall = false) {
  const scriptsDir = path.join(targetDir, "scripts");
  fs.mkdirSync(scriptsDir, { recursive: true });

  // check-kokoro-version.sh: passes if model weights and manifest exist
  fs.writeFileSync(
    path.join(scriptsDir, "check-kokoro-version.sh"),
    `#!/usr/bin/env bash
REPO_DIR="$(cd "$(dirname "\${BASH_SOURCE[0]}")/.." && pwd)"
[[ -f "\${REPO_DIR}/node_modules/.cache/kokoro-model/onnx/model_quantized.onnx" && -f "\${REPO_DIR}/node_modules/.cache/kokoro-model/model_manifest.json" ]]
`,
    { mode: 0o755 }
  );

  // check-piper-version.sh: passes if voice onnx and manifest exist
  fs.writeFileSync(
    path.join(scriptsDir, "check-piper-version.sh"),
    `#!/usr/bin/env bash
REPO_DIR="$(cd "$(dirname "\${BASH_SOURCE[0]}")/.." && pwd)"
[[ -f "\${REPO_DIR}/node_modules/.cache/piper-voice/en_US-lessac-medium.onnx" && -f "\${REPO_DIR}/node_modules/.cache/piper-voice/model_manifest.json" ]]
`,
    { mode: 0o755 }
  );

  // check-whisperx-version.sh: passes if alignment model, manifest, and venv python3 exist
  fs.writeFileSync(
    path.join(scriptsDir, "check-whisperx-version.sh"),
    `#!/usr/bin/env bash
REPO_DIR="$(cd "$(dirname "\${BASH_SOURCE[0]}")/.." && pwd)"
PYTHON_EXEC="\${WHISPERX_PYTHON_PATH:-\${REPO_DIR}/node_modules/.cache/whisperx-venv/bin/python3}"
[[ -x "\${PYTHON_EXEC}" && -f "\${REPO_DIR}/node_modules/.cache/whisperx-model/wav2vec2_fairseq_base_ls960_asr_ls960.pth" && -f "\${REPO_DIR}/node_modules/.cache/whisperx-model/model_manifest.json" ]]
`,
    { mode: 0o755 }
  );

  if (failOnInstall) {
    for (const script of [
      "install-kokoro-model.sh",
      "install-piper-voice.sh",
      "install-whisperx.sh"
    ]) {
      fs.writeFileSync(
        path.join(scriptsDir, script),
        `#!/usr/bin/env bash
echo "FAIL: ${script} was unexpectedly called!" >&2
exit 1
`,
        { mode: 0o755 }
      );
    }
  } else {
    fs.writeFileSync(
      path.join(scriptsDir, "install-kokoro-model.sh"),
      `#!/usr/bin/env bash
REPO_DIR="$(cd "$(dirname "\${BASH_SOURCE[0]}")/.." && pwd)"
TARGET="\${REPO_DIR}/node_modules/.cache/kokoro-model"
mkdir -p "\${TARGET}/onnx"
touch "\${TARGET}/onnx/model_quantized.onnx"
touch "\${TARGET}/model_manifest.json"
echo "Kokoro mock installed"
`,
      { mode: 0o755 }
    );

    fs.writeFileSync(
      path.join(scriptsDir, "install-piper-voice.sh"),
      `#!/usr/bin/env bash
REPO_DIR="$(cd "$(dirname "\${BASH_SOURCE[0]}")/.." && pwd)"
TARGET="\${REPO_DIR}/node_modules/.cache/piper-voice"
mkdir -p "\${TARGET}"
touch "\${TARGET}/en_US-lessac-medium.onnx"
touch "\${TARGET}/model_manifest.json"
echo "Piper mock installed"
`,
      { mode: 0o755 }
    );

    fs.writeFileSync(
      path.join(scriptsDir, "install-whisperx.sh"),
      `#!/usr/bin/env bash
REPO_DIR="$(cd "$(dirname "\${BASH_SOURCE[0]}")/.." && pwd)"
mkdir -p "\${REPO_DIR}/node_modules/.cache/whisperx-model"
mkdir -p "\${REPO_DIR}/node_modules/.cache/whisperx-venv/bin"
touch "\${REPO_DIR}/node_modules/.cache/whisperx-model/wav2vec2_fairseq_base_ls960_asr_ls960.pth"
touch "\${REPO_DIR}/node_modules/.cache/whisperx-model/model_manifest.json"
touch "\${REPO_DIR}/node_modules/.cache/whisperx-venv/bin/python3"
chmod +x "\${REPO_DIR}/node_modules/.cache/whisperx-venv/bin/python3"
echo "WhisperX mock installed"
`,
      { mode: 0o755 }
    );
  }

  // Copy the real prepare script
  fs.copyFileSync(PREPARE_SCRIPT, path.join(scriptsDir, "prepare-validation-caches.sh"));
  fs.chmodSync(path.join(scriptsDir, "prepare-validation-caches.sh"), 0o755);
}

describe("prepare-validation-caches", () => {
  afterAll(() => {
    fs.rmSync(TEST_TMP_DIR, { recursive: true, force: true });
  });

  it("prepare script exists and is executable", () => {
    expect(fs.existsSync(PREPARE_SCRIPT)).toBe(true);
    const stats = fs.statSync(PREPARE_SCRIPT);
    expect(stats.mode & 0o111).toBeTruthy();
  });

  it("installs missing caches and syncs to shared cache on initial run, then is idempotent", () => {
    const fixtureDir = path.join(TEST_TMP_DIR, "fixture-initial");
    const sharedCacheDir = path.join(TEST_TMP_DIR, "shared-cache");
    fs.mkdirSync(path.join(fixtureDir, ".git"), { recursive: true });
    createMockScripts(fixtureDir, false);

    // Initial run on empty fixture: invokes installers
    const run1 = execFileSync(
      "bash",
      [path.join(fixtureDir, "scripts", "prepare-validation-caches.sh")],
      {
        cwd: fixtureDir,
        encoding: "utf-8",
        env: {
          ...process.env,
          CCO_SHARED_CACHE_DIR: sharedCacheDir,
          PATH: process.env.PATH
        }
      }
    );

    expect(run1).toContain("Kokoro cache missing or unverified in current worktree.");
    expect(run1).toContain("Running install-kokoro-model.sh...");
    expect(run1).toContain("Piper voice cache missing or unverified in current worktree.");
    expect(run1).toContain("Running install-piper-voice.sh...");
    expect(run1).toContain("WhisperX model weights missing in current worktree.");
    expect(run1).toContain("WhisperX virtualenv missing or unverified in current worktree.");
    expect(run1).toContain("All validation caches prepared and verified successfully.");

    // Verify files created in worktree
    const kokoroModel = path.join(
      fixtureDir,
      "node_modules",
      ".cache",
      "kokoro-model",
      "onnx",
      "model_quantized.onnx"
    );
    const piperModel = path.join(
      fixtureDir,
      "node_modules",
      ".cache",
      "piper-voice",
      "en_US-lessac-medium.onnx"
    );
    const whisperxModel = path.join(
      fixtureDir,
      "node_modules",
      ".cache",
      "whisperx-model",
      "wav2vec2_fairseq_base_ls960_asr_ls960.pth"
    );
    const whisperxVenv = path.join(
      fixtureDir,
      "node_modules",
      ".cache",
      "whisperx-venv",
      "bin",
      "python3"
    );
    expect(fs.existsSync(kokoroModel)).toBe(true);
    expect(fs.existsSync(piperModel)).toBe(true);
    expect(fs.existsSync(whisperxModel)).toBe(true);
    expect(fs.existsSync(whisperxVenv)).toBe(true);

    // Verify files synced to shared cache
    expect(
      fs.existsSync(path.join(sharedCacheDir, "kokoro-model", "onnx", "model_quantized.onnx"))
    ).toBe(true);
    expect(
      fs.existsSync(path.join(sharedCacheDir, "piper-voice", "en_US-lessac-medium.onnx"))
    ).toBe(true);
    expect(
      fs.existsSync(
        path.join(sharedCacheDir, "whisperx-model", "wav2vec2_fairseq_base_ls960_asr_ls960.pth")
      )
    ).toBe(true);
    expect(fs.existsSync(path.join(sharedCacheDir, "whisperx-venv", "bin", "python3"))).toBe(true);

    // Second run: should be completely idempotent and skip installers
    const run2 = execFileSync(
      "bash",
      [path.join(fixtureDir, "scripts", "prepare-validation-caches.sh")],
      {
        cwd: fixtureDir,
        encoding: "utf-8",
        env: {
          ...process.env,
          CCO_SHARED_CACHE_DIR: sharedCacheDir,
          PATH: process.env.PATH
        }
      }
    );

    expect(run2).toContain("Kokoro model cache already verified in current worktree.");
    expect(run2).toContain("Piper voice cache already verified in current worktree.");
    expect(run2).toContain("WhisperX model weights already present in current worktree.");
    expect(run2).toContain("WhisperX virtualenv already verified in current worktree.");
    expect(run2).toContain("All validation caches prepared and verified successfully.");
    expect(run2).not.toContain("Running install-kokoro-model.sh");
    expect(run2).not.toContain("Running install-piper-voice.sh");
  });

  it("seeds model caches from shared cache into a fresh worktree via hardlinks", () => {
    const sharedCacheDir = path.join(TEST_TMP_DIR, "shared-cache");
    const freshWorktree = path.join(TEST_TMP_DIR, "fresh-worktree-shared");
    fs.mkdirSync(freshWorktree, { recursive: true });

    // In freshWorktree, installers fail if called
    createMockScripts(freshWorktree, true);

    const output = execFileSync(
      "bash",
      [path.join(freshWorktree, "scripts", "prepare-validation-caches.sh")],
      {
        cwd: freshWorktree,
        encoding: "utf-8",
        env: {
          ...process.env,
          CCO_SHARED_CACHE_DIR: sharedCacheDir,
          PATH: process.env.PATH
        }
      }
    );

    expect(output).toContain("Seeding Kokoro cache from");
    expect(output).toContain("Seeding Piper voice cache from");
    expect(output).toContain("Seeding WhisperX model weights from");
    expect(output).toContain("Linking WhisperX virtualenv from");
    expect(output).toContain("All validation caches prepared and verified successfully.");

    // Verify files in fresh worktree share inodes with shared cache (zero-copy hardlinks)
    const wtKokoro = path.join(
      freshWorktree,
      "node_modules",
      ".cache",
      "kokoro-model",
      "onnx",
      "model_quantized.onnx"
    );
    const sharedKokoro = path.join(sharedCacheDir, "kokoro-model", "onnx", "model_quantized.onnx");
    expect(fs.existsSync(wtKokoro)).toBe(true);
    expect(fs.statSync(wtKokoro).ino).toBe(fs.statSync(sharedKokoro).ino);

    const wtPiper = path.join(
      freshWorktree,
      "node_modules",
      ".cache",
      "piper-voice",
      "en_US-lessac-medium.onnx"
    );
    const sharedPiper = path.join(sharedCacheDir, "piper-voice", "en_US-lessac-medium.onnx");
    expect(fs.existsSync(wtPiper)).toBe(true);
    expect(fs.statSync(wtPiper).ino).toBe(fs.statSync(sharedPiper).ino);
  });

  it("seeds caches and symlinks virtualenv from main repo via gitdir reference", () => {
    const mainRepo = path.join(TEST_TMP_DIR, "main-repo");
    const worktreeDir = path.join(TEST_TMP_DIR, "worktree-gitdir");
    const gitWorktreeDir = path.join(mainRepo, ".git", "worktrees", "worktree-gitdir");

    fs.mkdirSync(mainRepo, { recursive: true });
    fs.mkdirSync(worktreeDir, { recursive: true });
    fs.mkdirSync(gitWorktreeDir, { recursive: true });

    // Populate main repo caches
    const mainKokoroDir = path.join(mainRepo, "node_modules", ".cache", "kokoro-model", "onnx");
    fs.mkdirSync(mainKokoroDir, { recursive: true });
    fs.writeFileSync(path.join(mainKokoroDir, "model_quantized.onnx"), "kokoro-onnx-bytes");
    fs.writeFileSync(
      path.join(mainRepo, "node_modules", ".cache", "kokoro-model", "model_manifest.json"),
      "{}"
    );

    const mainPiperDir = path.join(mainRepo, "node_modules", ".cache", "piper-voice");
    fs.mkdirSync(mainPiperDir, { recursive: true });
    fs.writeFileSync(path.join(mainPiperDir, "en_US-lessac-medium.onnx"), "piper-onnx-bytes");
    fs.writeFileSync(path.join(mainPiperDir, "model_manifest.json"), "{}");

    const mainWhisperxDir = path.join(mainRepo, "node_modules", ".cache", "whisperx-model");
    fs.mkdirSync(mainWhisperxDir, { recursive: true });
    fs.writeFileSync(
      path.join(mainWhisperxDir, "wav2vec2_fairseq_base_ls960_asr_ls960.pth"),
      "w2v-bytes"
    );
    fs.writeFileSync(path.join(mainWhisperxDir, "model_manifest.json"), "{}");

    const mainVenvBin = path.join(mainRepo, "node_modules", ".cache", "whisperx-venv", "bin");
    fs.mkdirSync(mainVenvBin, { recursive: true });
    fs.writeFileSync(path.join(mainVenvBin, "python3"), "#!/bin/sh\nexit 0\n", { mode: 0o755 });

    // Worktree setup with .git gitdir pointing to main repo
    fs.writeFileSync(path.join(worktreeDir, ".git"), `gitdir: ${gitWorktreeDir}\n`);

    // In worktreeDir, installers fail if called
    createMockScripts(worktreeDir, true);
    createMockScripts(mainRepo, true);

    const isolatedSharedDir = path.join(TEST_TMP_DIR, "isolated-shared-dir");

    const output = execFileSync(
      "bash",
      [path.join(worktreeDir, "scripts", "prepare-validation-caches.sh")],
      {
        cwd: worktreeDir,
        encoding: "utf-8",
        env: {
          ...process.env,
          CCO_SHARED_CACHE_DIR: isolatedSharedDir,
          PATH: process.env.PATH
        }
      }
    );

    expect(output).toContain("Seeding Kokoro cache from");
    expect(output).toContain("Seeding Piper voice cache from");
    expect(output).toContain("Seeding WhisperX model weights from");
    expect(output).toContain("Linking WhisperX virtualenv from");
    expect(output).toContain("All validation caches prepared and verified successfully.");

    // Verify virtualenv was symlinked
    const wtVenv = path.join(worktreeDir, "node_modules", ".cache", "whisperx-venv");
    expect(fs.lstatSync(wtVenv).isSymbolicLink()).toBe(true);
    expect(fs.realpathSync(wtVenv)).toBe(
      fs.realpathSync(path.join(mainRepo, "node_modules", ".cache", "whisperx-venv"))
    );
  });
});
