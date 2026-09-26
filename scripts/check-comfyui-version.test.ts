import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";

const REPO_ROOT = path.resolve(import.meta.dirname, "..");
const CHECK_SCRIPT = path.join(REPO_ROOT, "scripts", "check-comfyui-version.sh");
const VERSION_FILE = path.join(REPO_ROOT, ".comfyui-version");

describe("ComfyUI version and integrity validation", () => {
  let tempDir: string;

  beforeEach(() => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "comfyui-test-"));
  });

  afterEach(() => {
    if (fs.existsSync(tempDir)) {
      fs.rmSync(tempDir, { recursive: true, force: true });
    }
  });

  it(".comfyui-version file exists and pins 55b6a9b11dffecdd65a3ccd5eb6a1b3a178c96dc", () => {
    expect(fs.existsSync(VERSION_FILE)).toBe(true);
    const content = fs.readFileSync(VERSION_FILE, "utf-8");
    expect(content).toContain("COMFYUI_VERSION=55b6a9b11dffecdd65a3ccd5eb6a1b3a178c96dc");
    expect(content).toContain("COMFYUI_REPO=https://github.com/comfyanonymous/ComfyUI");
    expect(content).toContain("COMFYUI_REVISION=55b6a9b11dffecdd65a3ccd5eb6a1b3a178c96dc");
    expect(content).toContain("COMFYUI_CORE_REVISION=55b6a9b11dffecdd65a3ccd5eb6a1b3a178c96dc");
  });

  it("check-comfyui-version.sh fails when ComfyUI dir is not provided and not found", () => {
    expect(() => {
      execFileSync("bash", [CHECK_SCRIPT], {
        encoding: "utf-8",
        stdio: "pipe",
        env: { ...process.env, COMFYUI_DIR: "" }
      });
    }).toThrow();
  });

  it("check-comfyui-version.sh fails when --comfy-dir does not exist", () => {
    const nonExistentDir = path.join(tempDir, "does-not-exist");
    expect(() => {
      execFileSync("bash", [CHECK_SCRIPT, "--comfy-dir", nonExistentDir], {
        encoding: "utf-8",
        stdio: "pipe"
      });
    }).toThrow();
  });

  it("check-comfyui-version.sh fails when --comfy-dir is not a git repo", () => {
    const fakeComfy = path.join(tempDir, "fake-comfy");
    fs.mkdirSync(fakeComfy, { recursive: true });
    expect(() => {
      execFileSync("bash", [CHECK_SCRIPT, "--comfy-dir", fakeComfy], {
        encoding: "utf-8",
        stdio: "pipe"
      });
    }).toThrow();
  });

  it("check-comfyui-version.sh fails when ComfyUI git revision mismatches", () => {
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
      execFileSync("bash", [CHECK_SCRIPT, "--comfy-dir", fakeComfy], {
        encoding: "utf-8",
        stdio: "pipe"
      });
    }).toThrow(/mismatch/);
  });

  it("check-comfyui-version.sh fails when comfy_extras/nodes_minimax_h3.py is missing", () => {
    const fakeComfy = path.join(tempDir, "fake-comfy");
    fs.mkdirSync(path.join(fakeComfy, ".git"), { recursive: true });

    execFileSync("git", ["init", fakeComfy], { stdio: "ignore" });
    fs.writeFileSync(
      path.join(fakeComfy, ".git", "HEAD"),
      "55b6a9b11dffecdd65a3ccd5eb6a1b3a178c96dc\n"
    );

    expect(() => {
      execFileSync("bash", [CHECK_SCRIPT, "--comfy-dir", fakeComfy], {
        encoding: "utf-8",
        stdio: "pipe"
      });
    }).toThrow(/nodes_minimax_h3\.py missing/);
  });

  it("check-comfyui-version.sh succeeds when git revision matches and nodes_minimax_h3.py exists", () => {
    const fakeComfy = path.join(tempDir, "fake-comfy");
    fs.mkdirSync(path.join(fakeComfy, ".git"), { recursive: true });
    fs.mkdirSync(path.join(fakeComfy, "comfy_extras"), { recursive: true });
    fs.writeFileSync(
      path.join(fakeComfy, "comfy_extras", "nodes_minimax_h3.py"),
      "# mock native nodes"
    );

    execFileSync("git", ["init", fakeComfy], { stdio: "ignore" });
    fs.writeFileSync(
      path.join(fakeComfy, ".git", "HEAD"),
      "55b6a9b11dffecdd65a3ccd5eb6a1b3a178c96dc\n"
    );

    const output = execFileSync("bash", [CHECK_SCRIPT, "--comfy-dir", fakeComfy], {
      encoding: "utf-8"
    });
    expect(output).toContain("ComfyUI core verification passed");
    expect(output).toContain("55b6a9b11dffecdd65a3ccd5eb6a1b3a178c96dc");
  });
});
