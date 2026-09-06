#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "${SCRIPT_DIR}/.." && pwd)"

VERSION_FILE="${REPO_ROOT}/.whisperx-version"

if [[ ! -f "${VERSION_FILE}" ]]; then
  echo "Error: .whisperx-version file not found at ${VERSION_FILE}" >&2
  exit 1
fi

source "${VERSION_FILE}"

if [[ -z "${WHISPERX_PIP_VERSION:-}" || -z "${WHISPERX_TORCHAUDIO_VERSION:-}" || -z "${WHISPERX_VENV_DIR:-}" || -z "${WHISPERX_MODEL_DIR:-}" || -z "${WHISPERX_ALIGNMENT_MODEL_ID:-}" || -z "${WHISPERX_ALIGNMENT_MODEL_REVISION:-}" || -z "${WHISPERX_ALIGNMENT_MODEL_FILE:-}" || -z "${WHISPERX_ALIGNMENT_MODEL_SHA256:-}" ]]; then
  echo "Error: .whisperx-version must define WHISPERX_PIP_VERSION, WHISPERX_TORCHAUDIO_VERSION, WHISPERX_VENV_DIR, WHISPERX_MODEL_DIR, WHISPERX_ALIGNMENT_MODEL_ID, WHISPERX_ALIGNMENT_MODEL_REVISION, WHISPERX_ALIGNMENT_MODEL_FILE, and WHISPERX_ALIGNMENT_MODEL_SHA256" >&2
  exit 1
fi

TARGET_VENV_DIR="${REPO_ROOT}/${WHISPERX_VENV_DIR}"
TARGET_MODEL_DIR="${REPO_ROOT}/${WHISPERX_MODEL_DIR}"
MANIFEST_FILE="${TARGET_MODEL_DIR}/model_manifest.json"
MODEL_FILE="${TARGET_MODEL_DIR}/${WHISPERX_ALIGNMENT_MODEL_FILE}"

PYTHON_BIN="${TARGET_VENV_DIR}/bin/python3"
if [[ ! -f "${PYTHON_BIN}" ]]; then
  PYTHON_BIN="${TARGET_VENV_DIR}/bin/python"
fi

if [[ ! -f "${PYTHON_BIN}" ]]; then
  echo "Error: Pinned WhisperX virtualenv not found at ${TARGET_VENV_DIR}" >&2
  echo "Please run '${REPO_ROOT}/scripts/install-whisperx.sh' to install the pinned WhisperX environment." >&2
  exit 1
fi

if [[ ! -f "${MANIFEST_FILE}" ]]; then
  echo "Error: WhisperX model manifest missing at ${MANIFEST_FILE}" >&2
  echo "Please run '${REPO_ROOT}/scripts/install-whisperx.sh' to complete installation." >&2
  exit 1
fi

if [[ ! -f "${MODEL_FILE}" ]]; then
  echo "Error: Pinned WhisperX alignment model file missing at ${MODEL_FILE}" >&2
  echo "Please run '${REPO_ROOT}/scripts/install-whisperx.sh' to download and verify the model." >&2
  exit 1
fi

RECORDED_PIP_VERSION="$(grep '"pipVersion"' "${MANIFEST_FILE}" | head -n 1 | sed -E 's/.*"pipVersion": *"([^"]+)".*/\1/' || true)"
if [[ -z "${RECORDED_PIP_VERSION}" || "${RECORDED_PIP_VERSION}" != "${WHISPERX_PIP_VERSION}" ]]; then
  echo "Error: WhisperX pip version mismatch!" >&2
  echo "Expected pip version: ${WHISPERX_PIP_VERSION}" >&2
  echo "Installed pip version: ${RECORDED_PIP_VERSION:-none}" >&2
  echo "Please run '${REPO_ROOT}/scripts/install-whisperx.sh' to align your virtualenv." >&2
  exit 1
fi

RECORDED_TORCHAUDIO_VERSION="$(grep '"torchaudioVersion"' "${MANIFEST_FILE}" | head -n 1 | sed -E 's/.*"torchaudioVersion": *"([^"]+)".*/\1/' || true)"
if [[ -z "${RECORDED_TORCHAUDIO_VERSION}" || "${RECORDED_TORCHAUDIO_VERSION}" != "${WHISPERX_TORCHAUDIO_VERSION}" ]]; then
  echo "Error: torchaudio version mismatch in manifest!" >&2
  echo "Expected torchaudio version: ${WHISPERX_TORCHAUDIO_VERSION}" >&2
  echo "Installed torchaudio version: ${RECORDED_TORCHAUDIO_VERSION:-none}" >&2
  echo "Please run '${REPO_ROOT}/scripts/install-whisperx.sh' to align your virtualenv." >&2
  exit 1
fi

RECORDED_MODEL_ID="$(grep '"alignmentModelId"' "${MANIFEST_FILE}" | head -n 1 | sed -E 's/.*"alignmentModelId": *"([^"]+)".*/\1/' || true)"
if [[ -z "${RECORDED_MODEL_ID}" || "${RECORDED_MODEL_ID}" != "${WHISPERX_ALIGNMENT_MODEL_ID}" ]]; then
  echo "Error: WhisperX alignment model ID mismatch!" >&2
  echo "Expected model ID: ${WHISPERX_ALIGNMENT_MODEL_ID}" >&2
  echo "Installed model ID: ${RECORDED_MODEL_ID:-none}" >&2
  echo "Please run '${REPO_ROOT}/scripts/install-whisperx.sh' to align your model cache." >&2
  exit 1
fi

RECORDED_REVISION="$(grep '"alignmentModelRevision"' "${MANIFEST_FILE}" | head -n 1 | sed -E 's/.*"alignmentModelRevision": *"([^"]+)".*/\1/' || true)"
if [[ -z "${RECORDED_REVISION}" || "${RECORDED_REVISION}" != "${WHISPERX_ALIGNMENT_MODEL_REVISION}" ]]; then
  echo "Error: WhisperX alignment model revision mismatch!" >&2
  echo "Expected revision: ${WHISPERX_ALIGNMENT_MODEL_REVISION}" >&2
  echo "Installed revision: ${RECORDED_REVISION:-none}" >&2
  echo "Please run '${REPO_ROOT}/scripts/install-whisperx.sh' to align your model cache." >&2
  exit 1
fi

RECORDED_SHA256="$(grep '"sha256"' "${MANIFEST_FILE}" | head -n 1 | sed -E 's/.*"sha256": *"([^"]+)".*/\1/' || true)"
if [[ -z "${RECORDED_SHA256}" || "${RECORDED_SHA256}" != "${WHISPERX_ALIGNMENT_MODEL_SHA256}" ]]; then
  echo "Error: WhisperX model manifest SHA-256 mismatch!" >&2
  echo "Expected: ${WHISPERX_ALIGNMENT_MODEL_SHA256}" >&2
  echo "Installed: ${RECORDED_SHA256:-none}" >&2
  echo "Please run '${REPO_ROOT}/scripts/install-whisperx.sh' to align your model cache." >&2
  exit 1
fi

compute_sha256() {
  local target_file="$1"
  if command -v sha256sum >/dev/null 2>&1; then
    sha256sum "${target_file}" | awk '{print $1}'
  elif command -v shasum >/dev/null 2>&1; then
    shasum -a 256 "${target_file}" | awk '{print $1}'
  else
    echo "Error: neither sha256sum nor shasum found." >&2
    exit 1
  fi
}

ACTUAL_SHA256="$(compute_sha256 "${MODEL_FILE}")"
if [[ "${ACTUAL_SHA256}" != "${WHISPERX_ALIGNMENT_MODEL_SHA256}" ]]; then
  echo "Error: WhisperX model file SHA-256 checksum mismatch!" >&2
  echo "Expected: ${WHISPERX_ALIGNMENT_MODEL_SHA256}" >&2
  echo "Actual:   ${ACTUAL_SHA256}" >&2
  echo "Please run '${REPO_ROOT}/scripts/install-whisperx.sh' to align your model cache." >&2
  exit 1
fi

# Verify Python virtualenv package and versions
if ! "${PYTHON_BIN}" -c "import whisperx; import torchaudio; import importlib.metadata; wx=importlib.metadata.version('whisperx'); ta=importlib.metadata.version('torchaudio'); assert wx == '${WHISPERX_PIP_VERSION}', f'whisperx {wx} != ${WHISPERX_PIP_VERSION}'; assert ta.startswith('${WHISPERX_TORCHAUDIO_VERSION}'), f'torchaudio {ta} != ${WHISPERX_TORCHAUDIO_VERSION}'" 2>/dev/null; then
  echo "Error: Python environment at ${PYTHON_BIN} failed to verify whisperx (${WHISPERX_PIP_VERSION}) or torchaudio (${WHISPERX_TORCHAUDIO_VERSION})." >&2
  echo "Please run '${REPO_ROOT}/scripts/install-whisperx.sh' to re-install dependencies." >&2
  exit 1
fi

echo "WhisperX version verification passed (${WHISPERX_PIP_VERSION}, torchaudio: ${WHISPERX_TORCHAUDIO_VERSION}, ${WHISPERX_ALIGNMENT_MODEL_ID}@${WHISPERX_ALIGNMENT_MODEL_REVISION}, model: ${ACTUAL_SHA256})."
exit 0
