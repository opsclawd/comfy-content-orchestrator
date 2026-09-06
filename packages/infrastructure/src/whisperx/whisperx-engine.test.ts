import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  loadPinnedWhisperXVersion,
  resolveWhisperXPythonPath,
  verifyWhisperXModelDir,
  PINNED_WHISPERX_PIP_VERSION,
  PINNED_WHISPERX_TORCHAUDIO_VERSION,
  DEFAULT_WHISPERX_VENV_DIR,
  DEFAULT_WHISPERX_MODEL_DIR,
  PINNED_WHISPERX_ALIGNMENT_MODEL_ID,
  PINNED_WHISPERX_ALIGNMENT_MODEL_REVISION,
  PINNED_WHISPERX_ALIGNMENT_MODEL_FILE,
  PINNED_WHISPERX_ALIGNMENT_MODEL_SHA256
} from "./whisperx-engine.js";
import { WhisperXAlignmentError } from "./whisperx-error.js";

describe("whisperx-engine", () => {
  let tmpDir: string;
  const originalEnv = process.env.WHISPERX_PYTHON_PATH;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "whisperx-engine-test-"));
    delete process.env.WHISPERX_PYTHON_PATH;
  });

  afterEach(() => {
    if (originalEnv !== undefined) {
      process.env.WHISPERX_PYTHON_PATH = originalEnv;
    } else {
      delete process.env.WHISPERX_PYTHON_PATH;
    }
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it("loads default pinned version when .whisperx-version does not exist", () => {
    const version = loadPinnedWhisperXVersion(tmpDir);
    expect(version.pipVersion).toBe(PINNED_WHISPERX_PIP_VERSION);
    expect(version.torchaudioVersion).toBe(PINNED_WHISPERX_TORCHAUDIO_VERSION);
    expect(version.venvDir).toBe(DEFAULT_WHISPERX_VENV_DIR);
    expect(version.modelDir).toBe(DEFAULT_WHISPERX_MODEL_DIR);
    expect(version.alignmentModelId).toBe(PINNED_WHISPERX_ALIGNMENT_MODEL_ID);
    expect(version.alignmentModelRevision).toBe(PINNED_WHISPERX_ALIGNMENT_MODEL_REVISION);
    expect(version.alignmentModelFile).toBe(PINNED_WHISPERX_ALIGNMENT_MODEL_FILE);
    expect(version.alignmentModelSha256).toBe(PINNED_WHISPERX_ALIGNMENT_MODEL_SHA256);
  });

  it("parses .whisperx-version file correctly", () => {
    const customVersionContent = `
# Custom pinned versions
WHISPERX_PIP_VERSION=3.5.0
WHISPERX_TORCHAUDIO_VERSION=2.5.1
WHISPERX_VENV_DIR=.custom-cache/whisperx-venv
WHISPERX_MODEL_DIR=.custom-cache/whisperx-model
WHISPERX_ALIGNMENT_MODEL_ID=custom/wav2vec2
WHISPERX_ALIGNMENT_MODEL_REVISION=rev-abc-123
WHISPERX_ALIGNMENT_MODEL_FILE=custom_model.pth
WHISPERX_ALIGNMENT_MODEL_SHA256=sha256-hash-xyz
`;
    fs.writeFileSync(path.join(tmpDir, ".whisperx-version"), customVersionContent, "utf-8");

    const version = loadPinnedWhisperXVersion(tmpDir);
    expect(version.pipVersion).toBe("3.5.0");
    expect(version.torchaudioVersion).toBe("2.5.1");
    expect(version.venvDir).toBe(".custom-cache/whisperx-venv");
    expect(version.modelDir).toBe(".custom-cache/whisperx-model");
    expect(version.alignmentModelId).toBe("custom/wav2vec2");
    expect(version.alignmentModelRevision).toBe("rev-abc-123");
    expect(version.alignmentModelFile).toBe("custom_model.pth");
    expect(version.alignmentModelSha256).toBe("sha256-hash-xyz");
  });

  describe("resolveWhisperXPythonPath", () => {
    it("prefers WHISPERX_PYTHON_PATH environment variable override", () => {
      process.env.WHISPERX_PYTHON_PATH = "/opt/custom/python3";
      const resolved = resolveWhisperXPythonPath(tmpDir);
      expect(resolved).toBe(path.resolve("/opt/custom/python3"));
    });

    it("falls back to pinned venv python path inside repo root when env is unset", () => {
      const resolved = resolveWhisperXPythonPath(tmpDir);
      const binDir = process.platform === "win32" ? "Scripts" : "bin";
      const pythonBin = process.platform === "win32" ? "python.exe" : "python3";
      const expected = path.join(tmpDir, DEFAULT_WHISPERX_VENV_DIR, binDir, pythonBin);
      expect(resolved).toBe(expected);
    });
  });

  describe("verifyWhisperXModelDir (F-35e8401e & F-99c71e77)", () => {
    function setupValidEnvironment() {
      const binDir = process.platform === "win32" ? "Scripts" : "bin";
      const pythonBin = process.platform === "win32" ? "python.exe" : "python3";
      const fullVenvBin = path.join(tmpDir, DEFAULT_WHISPERX_VENV_DIR, binDir);
      fs.mkdirSync(fullVenvBin, { recursive: true });
      fs.writeFileSync(path.join(fullVenvBin, pythonBin), "#!/bin/sh\nexit 0\n", { mode: 0o755 });

      const modelDir = path.join(tmpDir, DEFAULT_WHISPERX_MODEL_DIR);
      fs.mkdirSync(modelDir, { recursive: true });

      const fakeModelContent = "test-model-content";
      const modelSha256 = crypto.createHash("sha256").update(fakeModelContent).digest("hex");
      fs.writeFileSync(path.join(modelDir, PINNED_WHISPERX_ALIGNMENT_MODEL_FILE), fakeModelContent);

      const customVersion = `
WHISPERX_PIP_VERSION=${PINNED_WHISPERX_PIP_VERSION}
WHISPERX_TORCHAUDIO_VERSION=${PINNED_WHISPERX_TORCHAUDIO_VERSION}
WHISPERX_VENV_DIR=${DEFAULT_WHISPERX_VENV_DIR}
WHISPERX_MODEL_DIR=${DEFAULT_WHISPERX_MODEL_DIR}
WHISPERX_ALIGNMENT_MODEL_ID=${PINNED_WHISPERX_ALIGNMENT_MODEL_ID}
WHISPERX_ALIGNMENT_MODEL_REVISION=${PINNED_WHISPERX_ALIGNMENT_MODEL_REVISION}
WHISPERX_ALIGNMENT_MODEL_FILE=${PINNED_WHISPERX_ALIGNMENT_MODEL_FILE}
WHISPERX_ALIGNMENT_MODEL_SHA256=${modelSha256}
`;
      fs.writeFileSync(path.join(tmpDir, ".whisperx-version"), customVersion);

      const manifest = {
        pipVersion: PINNED_WHISPERX_PIP_VERSION,
        torchaudioVersion: PINNED_WHISPERX_TORCHAUDIO_VERSION,
        alignmentModelId: PINNED_WHISPERX_ALIGNMENT_MODEL_ID,
        alignmentModelRevision: PINNED_WHISPERX_ALIGNMENT_MODEL_REVISION,
        alignmentModelFile: PINNED_WHISPERX_ALIGNMENT_MODEL_FILE,
        sha256: modelSha256,
        installedAt: new Date().toISOString()
      };
      fs.writeFileSync(path.join(modelDir, "model_manifest.json"), JSON.stringify(manifest));

      return { modelDir, modelSha256 };
    }

    it("throws MODEL_LOAD_FAILED when python environment does not exist", () => {
      expect(() => verifyWhisperXModelDir(tmpDir)).toThrow(WhisperXAlignmentError);
      try {
        verifyWhisperXModelDir(tmpDir);
      } catch (err: unknown) {
        const alignErr = err as WhisperXAlignmentError;
        expect(alignErr.code).toBe("MODEL_LOAD_FAILED");
        expect(alignErr.message).toContain("scripts/install-whisperx.sh");
      }
    });

    it("throws MODEL_LOAD_FAILED when modelDir does not exist", () => {
      const binDir = process.platform === "win32" ? "Scripts" : "bin";
      const pythonBin = process.platform === "win32" ? "python.exe" : "python3";
      const fullVenvBin = path.join(tmpDir, DEFAULT_WHISPERX_VENV_DIR, binDir);
      fs.mkdirSync(fullVenvBin, { recursive: true });
      fs.writeFileSync(path.join(fullVenvBin, pythonBin), "#!/bin/sh\nexit 0\n", { mode: 0o755 });

      expect(() => verifyWhisperXModelDir(tmpDir)).toThrow(WhisperXAlignmentError);
    });

    it("throws MODEL_LOAD_FAILED when model_manifest.json is missing or corrupted", () => {
      const { modelDir } = setupValidEnvironment();
      fs.unlinkSync(path.join(modelDir, "model_manifest.json"));

      expect(() => verifyWhisperXModelDir(tmpDir)).toThrow(WhisperXAlignmentError);

      fs.writeFileSync(path.join(modelDir, "model_manifest.json"), "invalid-json");
      expect(() => verifyWhisperXModelDir(tmpDir)).toThrow(WhisperXAlignmentError);
    });

    it("throws MODEL_LOAD_FAILED when model_manifest.json has mismatched metadata", () => {
      const { modelDir, modelSha256 } = setupValidEnvironment();

      // Mismatched modelId
      const badIdManifest = {
        pipVersion: PINNED_WHISPERX_PIP_VERSION,
        torchaudioVersion: PINNED_WHISPERX_TORCHAUDIO_VERSION,
        alignmentModelId: "wrong-id",
        alignmentModelRevision: PINNED_WHISPERX_ALIGNMENT_MODEL_REVISION,
        alignmentModelFile: PINNED_WHISPERX_ALIGNMENT_MODEL_FILE,
        sha256: modelSha256
      };
      fs.writeFileSync(path.join(modelDir, "model_manifest.json"), JSON.stringify(badIdManifest));
      expect(() => verifyWhisperXModelDir(tmpDir)).toThrow(WhisperXAlignmentError);

      // Mismatched torchaudioVersion
      const badTaManifest = {
        pipVersion: PINNED_WHISPERX_PIP_VERSION,
        torchaudioVersion: "99.99.99",
        alignmentModelId: PINNED_WHISPERX_ALIGNMENT_MODEL_ID,
        alignmentModelRevision: PINNED_WHISPERX_ALIGNMENT_MODEL_REVISION,
        alignmentModelFile: PINNED_WHISPERX_ALIGNMENT_MODEL_FILE,
        sha256: modelSha256
      };
      fs.writeFileSync(path.join(modelDir, "model_manifest.json"), JSON.stringify(badTaManifest));
      expect(() => verifyWhisperXModelDir(tmpDir)).toThrow(WhisperXAlignmentError);

      // Mismatched SHA-256
      const badShaManifest = {
        pipVersion: PINNED_WHISPERX_PIP_VERSION,
        torchaudioVersion: PINNED_WHISPERX_TORCHAUDIO_VERSION,
        alignmentModelId: PINNED_WHISPERX_ALIGNMENT_MODEL_ID,
        alignmentModelRevision: PINNED_WHISPERX_ALIGNMENT_MODEL_REVISION,
        alignmentModelFile: PINNED_WHISPERX_ALIGNMENT_MODEL_FILE,
        sha256: "tampered-sha"
      };
      fs.writeFileSync(path.join(modelDir, "model_manifest.json"), JSON.stringify(badShaManifest));
      expect(() => verifyWhisperXModelDir(tmpDir)).toThrow(WhisperXAlignmentError);
    });

    it("throws MODEL_LOAD_FAILED when model file is missing or SHA-256 does not match", () => {
      const { modelDir } = setupValidEnvironment();
      const modelFile = path.join(modelDir, PINNED_WHISPERX_ALIGNMENT_MODEL_FILE);

      // Corrupt model file bytes
      fs.writeFileSync(modelFile, "corrupted-file-bytes");
      expect(() => verifyWhisperXModelDir(tmpDir)).toThrow(WhisperXAlignmentError);

      // Remove model file
      fs.unlinkSync(modelFile);
      expect(() => verifyWhisperXModelDir(tmpDir)).toThrow(WhisperXAlignmentError);
    });

    it("throws MODEL_LOAD_FAILED when Python interpreter fails package verification (F-35e8401e & AC-1)", () => {
      setupValidEnvironment();
      const binDir = process.platform === "win32" ? "Scripts" : "bin";
      const pythonBin = process.platform === "win32" ? "python.exe" : "python3";
      const fullVenvBin = path.join(tmpDir, DEFAULT_WHISPERX_VENV_DIR, binDir);
      fs.writeFileSync(
        path.join(fullVenvBin, pythonBin),
        "#!/bin/sh\necho \"ModuleNotFoundError: No module named 'whisperx'\" >&2\nexit 1\n",
        { mode: 0o755 }
      );

      expect(() => verifyWhisperXModelDir(tmpDir)).toThrow(WhisperXAlignmentError);
      try {
        verifyWhisperXModelDir(tmpDir);
      } catch (err: unknown) {
        const alignErr = err as WhisperXAlignmentError;
        expect(alignErr.code).toBe("MODEL_LOAD_FAILED");
        expect(alignErr.message).toContain("No module named 'whisperx'");
      }
    });

    it("succeeds when python binary, manifest, and verified model file exist", () => {
      setupValidEnvironment();
      expect(() => verifyWhisperXModelDir(tmpDir)).not.toThrow();
    });
  });
});
