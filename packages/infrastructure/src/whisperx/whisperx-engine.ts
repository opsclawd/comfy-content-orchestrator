import child_process from "node:child_process";
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { WhisperXAlignmentError } from "./whisperx-error.js";

export interface PinnedWhisperXVersion {
  readonly pipVersion: string;
  readonly torchaudioVersion: string;
  readonly venvDir: string;
  readonly modelDir: string;
  readonly alignmentModelId: string;
  readonly alignmentModelRevision: string;
  readonly alignmentModelFile: string;
  readonly alignmentModelSha256: string;
}

export const PINNED_WHISPERX_PIP_VERSION = "3.3.1";
export const PINNED_WHISPERX_TORCHAUDIO_VERSION = "2.5.1";
export const DEFAULT_WHISPERX_VENV_DIR = "node_modules/.cache/whisperx-venv";
export const DEFAULT_WHISPERX_MODEL_DIR = "node_modules/.cache/whisperx-model";
export const PINNED_WHISPERX_ALIGNMENT_MODEL_ID = "WAV2VEC2_ASR_BASE_960H";
export const PINNED_WHISPERX_ALIGNMENT_MODEL_REVISION = "torchaudio-bundle-v1";
export const PINNED_WHISPERX_ALIGNMENT_MODEL_FILE = "wav2vec2_fairseq_base_ls960_asr_ls960.pth";
export const PINNED_WHISPERX_ALIGNMENT_MODEL_SHA256 =
  "488fd4f16de84438ffc945334278c1b9fb9b7159a806c1080b16111a958c945d";

export function findRepoRoot(startDir?: string): string {
  let curr = startDir ?? process.cwd();
  while (true) {
    if (
      fs.existsSync(path.join(curr, ".whisperx-version")) ||
      fs.existsSync(path.join(curr, ".kokoro-version")) ||
      fs.existsSync(path.join(curr, "pnpm-workspace.yaml"))
    ) {
      return curr;
    }
    const parent = path.dirname(curr);
    if (parent === curr) break;
    curr = parent;
  }
  return process.cwd();
}

export function loadPinnedWhisperXVersion(
  repoRoot: string = findRepoRoot()
): PinnedWhisperXVersion {
  const versionFile = path.join(repoRoot, ".whisperx-version");
  let pipVersion = PINNED_WHISPERX_PIP_VERSION;
  let torchaudioVersion = PINNED_WHISPERX_TORCHAUDIO_VERSION;
  let venvDir = DEFAULT_WHISPERX_VENV_DIR;
  let modelDir = DEFAULT_WHISPERX_MODEL_DIR;
  let alignmentModelId = PINNED_WHISPERX_ALIGNMENT_MODEL_ID;
  let alignmentModelRevision = PINNED_WHISPERX_ALIGNMENT_MODEL_REVISION;
  let alignmentModelFile = PINNED_WHISPERX_ALIGNMENT_MODEL_FILE;
  let alignmentModelSha256 = PINNED_WHISPERX_ALIGNMENT_MODEL_SHA256;

  if (fs.existsSync(versionFile)) {
    const content = fs.readFileSync(versionFile, "utf-8");
    const getVar = (name: string): string | undefined => {
      const match = content.match(
        new RegExp(`^\\s*${name}\\s*=\\s*["']?([^"'#\\r\\n]+)["']?`, "m")
      );
      const val = match?.[1];
      return val !== undefined ? val.trim() : undefined;
    };

    pipVersion = getVar("WHISPERX_PIP_VERSION") ?? pipVersion;
    torchaudioVersion = getVar("WHISPERX_TORCHAUDIO_VERSION") ?? torchaudioVersion;
    venvDir = getVar("WHISPERX_VENV_DIR") ?? venvDir;
    modelDir = getVar("WHISPERX_MODEL_DIR") ?? modelDir;
    alignmentModelId = getVar("WHISPERX_ALIGNMENT_MODEL_ID") ?? alignmentModelId;
    alignmentModelRevision = getVar("WHISPERX_ALIGNMENT_MODEL_REVISION") ?? alignmentModelRevision;
    alignmentModelFile = getVar("WHISPERX_ALIGNMENT_MODEL_FILE") ?? alignmentModelFile;
    alignmentModelSha256 = getVar("WHISPERX_ALIGNMENT_MODEL_SHA256") ?? alignmentModelSha256;
  }

  return {
    pipVersion,
    torchaudioVersion,
    venvDir,
    modelDir,
    alignmentModelId,
    alignmentModelRevision,
    alignmentModelFile,
    alignmentModelSha256
  };
}

export function resolveWhisperXPythonPath(repoRoot: string = findRepoRoot()): string {
  if (process.env.WHISPERX_PYTHON_PATH && process.env.WHISPERX_PYTHON_PATH.trim().length > 0) {
    return path.resolve(process.env.WHISPERX_PYTHON_PATH.trim());
  }

  const pinned = loadPinnedWhisperXVersion(repoRoot);
  const binDir = process.platform === "win32" ? "Scripts" : "bin";
  const pythonBin = process.platform === "win32" ? "python.exe" : "python3";
  return path.join(repoRoot, pinned.venvDir, binDir, pythonBin);
}

export function verifyWhisperXModelDir(
  repoRoot: string = findRepoRoot(),
  pythonPathOverride?: string,
  modelDirOverride?: string
): void {
  const pinned = loadPinnedWhisperXVersion(repoRoot);
  const pythonPath = pythonPathOverride ?? resolveWhisperXPythonPath(repoRoot);
  const modelDir = modelDirOverride ?? path.resolve(repoRoot, pinned.modelDir);

  if (!fs.existsSync(pythonPath)) {
    throw new WhisperXAlignmentError(
      "MODEL_LOAD_FAILED",
      `WhisperX Python environment not found at: ${pythonPath}. Please run 'scripts/install-whisperx.sh' to install the pinned WhisperX virtualenv.`,
      {
        pythonPath,
        venvDir: pinned.venvDir
      }
    );
  }

  if (!fs.existsSync(modelDir)) {
    throw new WhisperXAlignmentError(
      "MODEL_LOAD_FAILED",
      `WhisperX model directory does not exist: ${modelDir}. Please run 'scripts/install-whisperx.sh' first.`,
      { modelDir }
    );
  }

  const manifestPath = path.join(modelDir, "model_manifest.json");
  if (!fs.existsSync(manifestPath)) {
    throw new WhisperXAlignmentError(
      "MODEL_LOAD_FAILED",
      `WhisperX model manifest missing at ${manifestPath}. Please run 'scripts/install-whisperx.sh' first.`,
      { modelDir, manifestPath }
    );
  }

  let manifest: {
    pipVersion?: string;
    torchaudioVersion?: string;
    alignmentModelId?: string;
    alignmentModelRevision?: string;
    alignmentModelFile?: string;
    sha256?: string;
  };
  try {
    manifest = JSON.parse(fs.readFileSync(manifestPath, "utf-8"));
  } catch (err) {
    throw new WhisperXAlignmentError(
      "MODEL_LOAD_FAILED",
      `WhisperX model manifest is invalid JSON at ${manifestPath}: ${err instanceof Error ? err.message : String(err)}. Please run 'scripts/install-whisperx.sh' first.`,
      { modelDir, manifestPath, details: err }
    );
  }

  if (manifest.pipVersion !== pinned.pipVersion) {
    throw new WhisperXAlignmentError(
      "MODEL_LOAD_FAILED",
      `WhisperX pip version mismatch in manifest: expected ${pinned.pipVersion}, found ${manifest.pipVersion ?? "none"}. Please run 'scripts/install-whisperx.sh' to align.`,
      { modelDir, expected: pinned.pipVersion, actual: manifest.pipVersion }
    );
  }

  if (manifest.torchaudioVersion !== pinned.torchaudioVersion) {
    throw new WhisperXAlignmentError(
      "MODEL_LOAD_FAILED",
      `WhisperX torchaudio version mismatch in manifest: expected ${pinned.torchaudioVersion}, found ${manifest.torchaudioVersion ?? "none"}. Please run 'scripts/install-whisperx.sh' to align.`,
      { modelDir, expected: pinned.torchaudioVersion, actual: manifest.torchaudioVersion }
    );
  }

  if (manifest.alignmentModelId !== pinned.alignmentModelId) {
    throw new WhisperXAlignmentError(
      "MODEL_LOAD_FAILED",
      `WhisperX alignment model ID mismatch: expected ${pinned.alignmentModelId}, found ${manifest.alignmentModelId ?? "none"}. Please run 'scripts/install-whisperx.sh' to align.`,
      { modelDir, expected: pinned.alignmentModelId, actual: manifest.alignmentModelId }
    );
  }

  if (manifest.alignmentModelRevision !== pinned.alignmentModelRevision) {
    throw new WhisperXAlignmentError(
      "MODEL_LOAD_FAILED",
      `WhisperX alignment model revision mismatch: expected ${pinned.alignmentModelRevision}, found ${manifest.alignmentModelRevision ?? "none"}. Please run 'scripts/install-whisperx.sh' to align.`,
      { modelDir, expected: pinned.alignmentModelRevision, actual: manifest.alignmentModelRevision }
    );
  }

  if (manifest.sha256 !== pinned.alignmentModelSha256) {
    throw new WhisperXAlignmentError(
      "MODEL_LOAD_FAILED",
      `WhisperX model manifest SHA-256 mismatch: expected ${pinned.alignmentModelSha256}, found ${manifest.sha256 ?? "none"}. Please run 'scripts/install-whisperx.sh' to align.`,
      { modelDir, expectedSha256: pinned.alignmentModelSha256, actualSha256: manifest.sha256 }
    );
  }

  const modelFile = path.join(modelDir, pinned.alignmentModelFile);
  if (!fs.existsSync(modelFile)) {
    throw new WhisperXAlignmentError(
      "MODEL_LOAD_FAILED",
      `WhisperX alignment model file missing at ${modelFile}. Please run 'scripts/install-whisperx.sh' first.`,
      { modelDir, modelFile }
    );
  }

  const fileBytes = fs.readFileSync(modelFile);
  const actualSha256 = crypto.createHash("sha256").update(fileBytes).digest("hex");
  if (actualSha256 !== pinned.alignmentModelSha256) {
    throw new WhisperXAlignmentError(
      "MODEL_LOAD_FAILED",
      `WhisperX alignment model SHA-256 checksum mismatch: expected ${pinned.alignmentModelSha256}, got ${actualSha256}. Please run 'scripts/install-whisperx.sh' to align.`,
      { modelDir, modelFile, expectedSha256: pinned.alignmentModelSha256, actualSha256 }
    );
  }

  const checkCode =
    "import whisperx; import torchaudio; import importlib.metadata; " +
    `wx = importlib.metadata.version('whisperx'); assert wx == '${pinned.pipVersion}', f'whisperx version mismatch: expected ${pinned.pipVersion}, got {wx}'; ` +
    `ta = importlib.metadata.version('torchaudio'); assert ta.startswith('${pinned.torchaudioVersion}'), f'torchaudio version mismatch: expected ${pinned.torchaudioVersion}, got {ta}'`;

  const pyCheck = child_process.spawnSync(pythonPath, ["-c", checkCode], {
    encoding: "utf-8",
    timeout: 10_000
  });

  if (pyCheck.error || pyCheck.status !== 0) {
    const errorDetail =
      pyCheck.error?.message ??
      (pyCheck.stderr && pyCheck.stderr.trim().length > 0
        ? pyCheck.stderr.trim()
        : "Process exited with non-zero status");
    throw new WhisperXAlignmentError(
      "MODEL_LOAD_FAILED",
      `WhisperX Python environment verification failed at ${pythonPath}: ${errorDetail}. Please run 'scripts/install-whisperx.sh' to install the pinned WhisperX virtualenv.`,
      {
        pythonPath,
        modelDir,
        exitCode: pyCheck.status ?? undefined,
        stderr: pyCheck.stderr,
        stdout: pyCheck.stdout
      },
      pyCheck.error ? { cause: pyCheck.error } : undefined
    );
  }
}
