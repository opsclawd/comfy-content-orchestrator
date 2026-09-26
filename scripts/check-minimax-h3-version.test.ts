import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";

const REPO_ROOT = path.resolve(import.meta.dirname, "..");
const CHECK_SCRIPT = path.join(REPO_ROOT, "scripts", "check-minimax-h3-version.sh");
const INSTALL_SCRIPT = path.join(REPO_ROOT, "scripts", "install-minimax-h3.sh");
const VERSION_FILE = path.join(REPO_ROOT, ".minimax-h3-version");

describe("MiniMax-H3 version and integrity validation", () => {
  let tempDir: string;

  beforeEach(() => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "minimax-h3-test-"));
  });

  afterEach(() => {
    if (fs.existsSync(tempDir)) {
      fs.rmSync(tempDir, { recursive: true, force: true });
    }
  });

  function setupMockComfyDir(baseDir: string): string {
    const fakeComfy = path.join(baseDir, "mock-comfy");
    fs.mkdirSync(path.join(fakeComfy, ".git"), { recursive: true });
    fs.mkdirSync(path.join(fakeComfy, "comfy_extras"), { recursive: true });
    fs.writeFileSync(path.join(fakeComfy, "comfy_extras", "nodes_minimax_h3.py"), "# mock");
    execFileSync("git", ["init", fakeComfy], { stdio: "ignore" });
    fs.writeFileSync(
      path.join(fakeComfy, ".git", "HEAD"),
      "55b6a9b11dffecdd65a3ccd5eb6a1b3a178c96dc\n"
    );
    return fakeComfy;
  }

  it(".minimax-h3-version file exists and has valid configuration", () => {
    expect(fs.existsSync(VERSION_FILE)).toBe(true);
    const content = fs.readFileSync(VERSION_FILE, "utf-8");
    expect(content).toContain("MINIMAX_H3_VERSION=");
    expect(content).toContain("MINIMAX_H3_REPO=Comfy-Org/MiniMax-H3");
    expect(content).toContain("MINIMAX_H3_REVISION=");
    expect(content).toContain("COMFYUI_CORE_REPO=");
    expect(content).toContain("COMFYUI_CORE_REVISION=55b6a9b11dffecdd65a3ccd5eb6a1b3a178c96dc");
    expect(content).toContain("MINIMAX_H3_DIFFUSION_FILE=");
    expect(content).toContain("MINIMAX_H3_DIFFUSION_SHA256=");
    expect(content).toContain("MINIMAX_H3_TEXT_ENCODER_FILE=");
    expect(content).toContain("MINIMAX_H3_TEXT_ENCODER_SHA256=");
    expect(content).toContain("MINIMAX_H3_VIDEO_VAE_FILE=");
    expect(content).toContain("MINIMAX_H3_VIDEO_VAE_SHA256=");
    expect(content).toContain("MINIMAX_H3_AUDIO_VAE_FILE=");
    expect(content).toContain("MINIMAX_H3_AUDIO_VAE_SHA256=");
  });

  it("install-minimax-h3.sh executes cleanly in --dry-run mode", () => {
    const output = execFileSync("bash", [INSTALL_SCRIPT, "--dry-run", "--models-dir", tempDir], {
      encoding: "utf-8"
    });
    expect(output).toContain("Installing MiniMax-H3 Models");
    expect(output).toContain("Comfy-Org/MiniMax-H3");
    expect(output).toContain("[dry-run] Would download");
  });

  it("check-minimax-h3-version.sh fails unconditionally when ComfyUI dir is not provided", () => {
    expect(() => {
      execFileSync("bash", [CHECK_SCRIPT, "--models-dir", tempDir], {
        encoding: "utf-8",
        stdio: "pipe",
        env: { ...process.env, COMFYUI_DIR: "" }
      });
    }).toThrow(/ComfyUI core directory must be provided/);
  });

  it("check-minimax-h3-version.sh fails when --comfy-dir is not a git repo", () => {
    const fakeComfy = path.join(tempDir, "fake-comfy");
    fs.mkdirSync(fakeComfy, { recursive: true });
    expect(() => {
      execFileSync("bash", [CHECK_SCRIPT, "--models-dir", tempDir, "--comfy-dir", fakeComfy], {
        encoding: "utf-8",
        stdio: "pipe"
      });
    }).toThrow(/is not a git repository/);
  });

  it("check-minimax-h3-version.sh fails when ComfyUI git revision mismatches", () => {
    const fakeComfy = path.join(tempDir, "fake-comfy");
    fs.mkdirSync(path.join(fakeComfy, ".git"), { recursive: true });
    fs.mkdirSync(path.join(fakeComfy, "comfy_extras"), { recursive: true });
    fs.writeFileSync(path.join(fakeComfy, "comfy_extras", "nodes_minimax_h3.py"), "# mock");

    execFileSync("git", ["init", fakeComfy], { stdio: "ignore" });
    fs.writeFileSync(
      path.join(fakeComfy, ".git", "HEAD"),
      "0000000000000000000000000000000000000000\n"
    );

    expect(() => {
      execFileSync("bash", [CHECK_SCRIPT, "--models-dir", tempDir, "--comfy-dir", fakeComfy], {
        encoding: "utf-8",
        stdio: "pipe"
      });
    }).toThrow(/ComfyUI core revision mismatch/);
  });

  it("check-minimax-h3-version.sh fails when comfy_extras/nodes_minimax_h3.py is missing", () => {
    const fakeComfy = path.join(tempDir, "fake-comfy");
    fs.mkdirSync(path.join(fakeComfy, ".git"), { recursive: true });

    execFileSync("git", ["init", fakeComfy], { stdio: "ignore" });
    fs.writeFileSync(
      path.join(fakeComfy, ".git", "HEAD"),
      "55b6a9b11dffecdd65a3ccd5eb6a1b3a178c96dc\n"
    );

    expect(() => {
      execFileSync("bash", [CHECK_SCRIPT, "--models-dir", tempDir, "--comfy-dir", fakeComfy], {
        encoding: "utf-8",
        stdio: "pipe"
      });
    }).toThrow(/nodes_minimax_h3\.py missing/);
  });

  it("check-minimax-h3-version.sh fails when models directory does not exist", () => {
    const mockComfy = setupMockComfyDir(tempDir);
    const nonExistentDir = path.join(tempDir, "does-not-exist");
    expect(() => {
      execFileSync(
        "bash",
        [CHECK_SCRIPT, "--comfy-dir", mockComfy, "--models-dir", nonExistentDir],
        {
          encoding: "utf-8",
          stdio: "pipe"
        }
      );
    }).toThrow(/Models directory not found/);
  });

  it("check-minimax-h3-version.sh fails when required model files are missing", () => {
    const mockComfy = setupMockComfyDir(tempDir);
    const modelsDir = path.join(tempDir, "models");
    fs.mkdirSync(modelsDir, { recursive: true });
    expect(() => {
      execFileSync("bash", [CHECK_SCRIPT, "--comfy-dir", mockComfy, "--models-dir", modelsDir], {
        encoding: "utf-8",
        stdio: "pipe"
      });
    }).toThrow(/model missing/i);
  });

  it("check-minimax-h3-version.sh fails when model file size mismatches", () => {
    const mockComfy = setupMockComfyDir(tempDir);
    const modelsDir = path.join(tempDir, "models");
    fs.mkdirSync(path.join(modelsDir, "diffusion_models"), { recursive: true });
    fs.mkdirSync(path.join(modelsDir, "text_encoders"), { recursive: true });
    fs.mkdirSync(path.join(modelsDir, "vae"), { recursive: true });

    // Write dummy files of incorrect sizes
    fs.writeFileSync(
      path.join(modelsDir, "diffusion_models", "minimax_h3_ref2va_pruned_int8_convrot.safetensors"),
      "small"
    );
    fs.writeFileSync(
      path.join(modelsDir, "text_encoders", "qwen3vl_32b_minimax_h3_nvfp4_awq.safetensors"),
      "small"
    );
    fs.writeFileSync(
      path.join(modelsDir, "vae", "minimax_h3_video_vae_int8_convrot.safetensors"),
      "small"
    );
    fs.writeFileSync(path.join(modelsDir, "vae", "minimax_h3_audio_vae_fp32.safetensors"), "small");

    expect(() => {
      execFileSync(
        "bash",
        [CHECK_SCRIPT, "--quick", "--comfy-dir", mockComfy, "--models-dir", modelsDir],
        {
          encoding: "utf-8",
          stdio: "pipe"
        }
      );
    }).toThrow(/size mismatch/i);
  });
});
