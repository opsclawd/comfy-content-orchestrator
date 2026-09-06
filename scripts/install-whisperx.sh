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

if [[ -z "${WHISPERX_PIP_VERSION:-}" || -z "${WHISPERX_TORCHAUDIO_VERSION:-}" || -z "${WHISPERX_MATPLOTLIB_VERSION:-}" || -z "${WHISPERX_VENV_DIR:-}" || -z "${WHISPERX_MODEL_DIR:-}" || -z "${WHISPERX_ALIGNMENT_MODEL_ID:-}" || -z "${WHISPERX_ALIGNMENT_MODEL_REVISION:-}" || -z "${WHISPERX_ALIGNMENT_MODEL_FILE:-}" || -z "${WHISPERX_ALIGNMENT_MODEL_SHA256:-}" || -z "${WHISPERX_ALIGNMENT_MODEL_URL:-}" ]]; then
  echo "Error: .whisperx-version must define WHISPERX_PIP_VERSION, WHISPERX_TORCHAUDIO_VERSION, WHISPERX_MATPLOTLIB_VERSION, WHISPERX_VENV_DIR, WHISPERX_MODEL_DIR, WHISPERX_ALIGNMENT_MODEL_ID, WHISPERX_ALIGNMENT_MODEL_REVISION, WHISPERX_ALIGNMENT_MODEL_FILE, WHISPERX_ALIGNMENT_MODEL_SHA256, and WHISPERX_ALIGNMENT_MODEL_URL" >&2
  exit 1
fi

TARGET_VENV_DIR="${REPO_ROOT}/${WHISPERX_VENV_DIR}"
TARGET_MODEL_DIR="${REPO_ROOT}/${WHISPERX_MODEL_DIR}"
MODEL_FILE="${TARGET_MODEL_DIR}/${WHISPERX_ALIGNMENT_MODEL_FILE}"

echo "Installing WhisperX environment (${WHISPERX_PIP_VERSION}, torchaudio: ${WHISPERX_TORCHAUDIO_VERSION})..."
echo "Target venv: ${TARGET_VENV_DIR}"
echo "Target model dir: ${TARGET_MODEL_DIR}"

# 1. Purge mismatched cache if existing manifest has different provenance
if [[ -f "${TARGET_MODEL_DIR}/model_manifest.json" ]]; then
  EXISTING_REV="$(grep '"alignmentModelRevision"' "${TARGET_MODEL_DIR}/model_manifest.json" | head -n 1 | sed -E 's/.*"alignmentModelRevision": *"([^"]+)".*/\1/' || true)"
  EXISTING_ID="$(grep '"alignmentModelId"' "${TARGET_MODEL_DIR}/model_manifest.json" | head -n 1 | sed -E 's/.*"alignmentModelId": *"([^"]+)".*/\1/' || true)"
  EXISTING_SHA="$(grep '"sha256"' "${TARGET_MODEL_DIR}/model_manifest.json" | head -n 1 | sed -E 's/.*"sha256": *"([^"]+)".*/\1/' || true)"
  EXISTING_FILE="$(grep '"alignmentModelFile"' "${TARGET_MODEL_DIR}/model_manifest.json" | head -n 1 | sed -E 's/.*"alignmentModelFile": *"([^"]+)".*/\1/' || true)"
  EXISTING_TA="$(grep '"torchaudioVersion"' "${TARGET_MODEL_DIR}/model_manifest.json" | head -n 1 | sed -E 's/.*"torchaudioVersion": *"([^"]+)".*/\1/' || true)"

  if [[ -n "${EXISTING_REV}" && "${EXISTING_REV}" != "${WHISPERX_ALIGNMENT_MODEL_REVISION}" ]] || \
     [[ -n "${EXISTING_ID}" && "${EXISTING_ID}" != "${WHISPERX_ALIGNMENT_MODEL_ID}" ]] || \
     [[ -n "${EXISTING_SHA}" && "${EXISTING_SHA}" != "${WHISPERX_ALIGNMENT_MODEL_SHA256}" ]] || \
     [[ -n "${EXISTING_FILE}" && "${EXISTING_FILE}" != "${WHISPERX_ALIGNMENT_MODEL_FILE}" ]] || \
     [[ -n "${EXISTING_TA}" && "${EXISTING_TA}" != "${WHISPERX_TORCHAUDIO_VERSION}" ]]; then
    echo "Found existing cache with mismatched provenance metadata. Purging cache..."
    rm -rf "${TARGET_MODEL_DIR:?}"/*
  fi
fi

mkdir -p "${TARGET_MODEL_DIR}"

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

download_file() {
  local url="$1"
  local dest="$2"
  if command -v curl >/dev/null 2>&1; then
    curl -fsSL "${url}" -o "${dest}"
  elif command -v wget >/dev/null 2>&1; then
    wget -qO "${dest}" "${url}"
  else
    echo "Error: neither curl nor wget found." >&2
    exit 1
  fi
}

# 2. Verify or download model artifact
if [[ -f "${MODEL_FILE}" ]]; then
  CURRENT_SHA256="$(compute_sha256 "${MODEL_FILE}")"
  if [[ "${CURRENT_SHA256}" != "${WHISPERX_ALIGNMENT_MODEL_SHA256}" ]]; then
    echo "Existing model file has mismatched checksum (${CURRENT_SHA256}). Removing..."
    rm -f "${MODEL_FILE}"
  fi
fi

if [[ ! -f "${MODEL_FILE}" ]]; then
  # Check if model can be seeded from .ai-tmp or other cache
  if [[ -f "${REPO_ROOT}/.ai-tmp/${WHISPERX_ALIGNMENT_MODEL_FILE}" ]]; then
    TMP_SHA256="$(compute_sha256 "${REPO_ROOT}/.ai-tmp/${WHISPERX_ALIGNMENT_MODEL_FILE}")"
    if [[ "${TMP_SHA256}" == "${WHISPERX_ALIGNMENT_MODEL_SHA256}" ]]; then
      echo "Copying verified cached model weights into target directory..."
      cp "${REPO_ROOT}/.ai-tmp/${WHISPERX_ALIGNMENT_MODEL_FILE}" "${MODEL_FILE}"
    fi
  fi
fi

if [[ ! -f "${MODEL_FILE}" ]]; then
  echo "Downloading alignment model weights (${WHISPERX_ALIGNMENT_MODEL_ID})..."
  download_file "${WHISPERX_ALIGNMENT_MODEL_URL}" "${MODEL_FILE}"
fi

echo "Verifying SHA-256 checksum of alignment model weights..."
ACTUAL_SHA256="$(compute_sha256 "${MODEL_FILE}")"
if [[ "${ACTUAL_SHA256}" != "${WHISPERX_ALIGNMENT_MODEL_SHA256}" ]]; then
  echo "Error: SHA-256 checksum mismatch for alignment model weights!" >&2
  echo "Expected: ${WHISPERX_ALIGNMENT_MODEL_SHA256}" >&2
  echo "Actual:   ${ACTUAL_SHA256}" >&2
  rm -f "${MODEL_FILE}"
  exit 1
fi
echo "SHA-256 checksum verified: ${ACTUAL_SHA256}"

# 3. Write model manifest
MANIFEST_FILE="${TARGET_MODEL_DIR}/model_manifest.json"
cat > "${MANIFEST_FILE}" <<EOF
{
  "pipVersion": "${WHISPERX_PIP_VERSION}",
  "torchaudioVersion": "${WHISPERX_TORCHAUDIO_VERSION}",
  "alignmentModelId": "${WHISPERX_ALIGNMENT_MODEL_ID}",
  "alignmentModelRevision": "${WHISPERX_ALIGNMENT_MODEL_REVISION}",
  "alignmentModelFile": "${WHISPERX_ALIGNMENT_MODEL_FILE}",
  "sha256": "${WHISPERX_ALIGNMENT_MODEL_SHA256}",
  "installedAt": "$(date -u +"%Y-%m-%dT%H:%M:%SZ")"
}
EOF
echo "Manifest written to ${MANIFEST_FILE}."

# 4. Setup Python virtualenv
HOST_PYTHON=""
for candidate in python3.12 python3.11 python3.10 python3.9 python3; do
  if command -v "${candidate}" >/dev/null 2>&1; then
    HOST_PYTHON="$(command -v "${candidate}")"
    break
  fi
done

if [[ -z "${HOST_PYTHON}" ]]; then
  echo "Error: python3 binary is required to create virtualenv." >&2
  exit 1
fi

if [[ ! -d "${TARGET_VENV_DIR}" ]]; then
  echo "Creating virtual environment at ${TARGET_VENV_DIR} using ${HOST_PYTHON}..."
  "${HOST_PYTHON}" -m venv "${TARGET_VENV_DIR}"
fi

PYTHON_BIN="${TARGET_VENV_DIR}/bin/python3"
PIP_BIN="${TARGET_VENV_DIR}/bin/pip"

if [[ ! -f "${PYTHON_BIN}" ]]; then
  PYTHON_BIN="${TARGET_VENV_DIR}/bin/python"
fi

echo "Upgrading pip and installing whisperx==${WHISPERX_PIP_VERSION} torchaudio==${WHISPERX_TORCHAUDIO_VERSION} matplotlib==${WHISPERX_MATPLOTLIB_VERSION}..."
"${PIP_BIN}" install --upgrade pip
"${PIP_BIN}" install "whisperx==${WHISPERX_PIP_VERSION}" "torchaudio==${WHISPERX_TORCHAUDIO_VERSION}" "matplotlib==${WHISPERX_MATPLOTLIB_VERSION}"

echo "WhisperX installation and model verification complete."
