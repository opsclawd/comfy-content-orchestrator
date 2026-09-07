#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "${SCRIPT_DIR}/.." && pwd)"

VERSION_FILE="${REPO_ROOT}/.piper-version"

if [[ ! -f "${VERSION_FILE}" ]]; then
  echo "Error: .piper-version file not found at ${VERSION_FILE}" >&2
  exit 1
fi

source "${VERSION_FILE}"

if [[ -z "${PIPER_VERSION:-}" || -z "${PIPER_VOICE_ID:-}" || -z "${PIPER_VOICE_ONNX_SHA256:-}" || -z "${PIPER_VOICE_CONFIG_SHA256:-}" || -z "${PIPER_VOICE_HF_PATH:-}" ]]; then
  echo "Error: .piper-version must define PIPER_VERSION, PIPER_VOICE_ID, PIPER_VOICE_ONNX_SHA256, PIPER_VOICE_CONFIG_SHA256, and PIPER_VOICE_HF_PATH" >&2
  exit 1
fi

REL_DIR="${PIPER_VOICE_DIR:-node_modules/.cache/piper-voice}"
TARGET_DIR="${REPO_ROOT}/${REL_DIR}"
mkdir -p "${TARGET_DIR}"

echo "Installing Piper voice ${PIPER_VOICE_ID} (version: ${PIPER_VERSION})..."
echo "Target directory: ${TARGET_DIR}"

MANIFEST_FILE="${TARGET_DIR}/model_manifest.json"

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

# If an existing cache has a mismatched voiceId, version, or checksums, purge it to ensure clean provenance
if [[ -f "${MANIFEST_FILE}" ]]; then
  EXISTING_ID="$(grep '"voiceId"' "${MANIFEST_FILE}" | head -n 1 | sed -E 's/.*"voiceId": *"([^"]+)".*/\1/' || true)"
  EXISTING_VER="$(grep '"version"' "${MANIFEST_FILE}" | head -n 1 | sed -E 's/.*"version": *"([^"]+)".*/\1/' || true)"
  EXISTING_ONNX_SHA="$(grep '"onnxSha256"' "${MANIFEST_FILE}" | head -n 1 | sed -E 's/.*"onnxSha256": *"([^"]+)".*/\1/' || true)"
  EXISTING_CFG_SHA="$(grep '"configSha256"' "${MANIFEST_FILE}" | head -n 1 | sed -E 's/.*"configSha256": *"([^"]+)".*/\1/' || true)"

  if [[ -n "${EXISTING_ID}" && "${EXISTING_ID}" != "${PIPER_VOICE_ID}" ]] || \
     [[ -n "${EXISTING_VER}" && "${EXISTING_VER}" != "${PIPER_VERSION}" ]] || \
     [[ -n "${EXISTING_ONNX_SHA}" && "${EXISTING_ONNX_SHA}" != "${PIPER_VOICE_ONNX_SHA256}" ]] || \
     [[ -n "${EXISTING_CFG_SHA}" && "${EXISTING_CFG_SHA}" != "${PIPER_VOICE_CONFIG_SHA256}" ]]; then
    echo "Found existing cache with mismatched provenance metadata. Purging cache..."
    rm -rf "${TARGET_DIR:?}"/*
  fi
fi

HF_BASE="https://huggingface.co/rhasspy/piper-voices/resolve/main/${PIPER_VOICE_HF_PATH}"

# 1. Voice config JSON
CONFIG_FILE="${TARGET_DIR}/${PIPER_VOICE_ID}.onnx.json"
if [[ -f "${CONFIG_FILE}" ]]; then
  CURRENT_CONFIG_SHA="$(compute_sha256 "${CONFIG_FILE}")"
  if [[ "${CURRENT_CONFIG_SHA}" != "${PIPER_VOICE_CONFIG_SHA256}" ]]; then
    echo "Existing ${CONFIG_FILE} has mismatched checksum (${CURRENT_CONFIG_SHA}). Removing..."
    rm -f "${CONFIG_FILE}"
  fi
fi

if [[ ! -f "${CONFIG_FILE}" ]]; then
  echo "Downloading ${PIPER_VOICE_ID}.onnx.json..."
  download_file "${HF_BASE}/${PIPER_VOICE_ID}.onnx.json" "${CONFIG_FILE}"
fi

ACTUAL_CONFIG_SHA="$(compute_sha256 "${CONFIG_FILE}")"
if [[ "${ACTUAL_CONFIG_SHA}" != "${PIPER_VOICE_CONFIG_SHA256}" ]]; then
  echo "Error: SHA-256 checksum mismatch for ${CONFIG_FILE}!" >&2
  echo "Expected: ${PIPER_VOICE_CONFIG_SHA256}" >&2
  echo "Actual:   ${ACTUAL_CONFIG_SHA}" >&2
  rm -f "${CONFIG_FILE}"
  exit 1
fi
echo "SHA-256 checksum verified for ${PIPER_VOICE_ID}.onnx.json: ${ACTUAL_CONFIG_SHA}"

# 2. Voice ONNX model
MODEL_FILE="${TARGET_DIR}/${PIPER_VOICE_ID}.onnx"
if [[ -f "${MODEL_FILE}" ]]; then
  CURRENT_MODEL_SHA="$(compute_sha256 "${MODEL_FILE}")"
  if [[ "${CURRENT_MODEL_SHA}" != "${PIPER_VOICE_ONNX_SHA256}" ]]; then
    echo "Existing ${MODEL_FILE} has mismatched checksum (${CURRENT_MODEL_SHA}). Removing..."
    rm -f "${MODEL_FILE}"
  fi
fi

if [[ ! -f "${MODEL_FILE}" ]]; then
  echo "Downloading ${PIPER_VOICE_ID}.onnx..."
  download_file "${HF_BASE}/${PIPER_VOICE_ID}.onnx" "${MODEL_FILE}"
fi

ACTUAL_MODEL_SHA="$(compute_sha256 "${MODEL_FILE}")"
if [[ "${ACTUAL_MODEL_SHA}" != "${PIPER_VOICE_ONNX_SHA256}" ]]; then
  echo "Error: SHA-256 checksum mismatch for ${MODEL_FILE}!" >&2
  echo "Expected: ${PIPER_VOICE_ONNX_SHA256}" >&2
  echo "Actual:   ${ACTUAL_MODEL_SHA}" >&2
  rm -f "${MODEL_FILE}"
  exit 1
fi
echo "SHA-256 checksum verified for ${PIPER_VOICE_ID}.onnx: ${ACTUAL_MODEL_SHA}"

# 3. Write model manifest
cat > "${MANIFEST_FILE}" <<INNER_EOF
{
  "voiceId": "${PIPER_VOICE_ID}",
  "version": "${PIPER_VERSION}",
  "onnxSha256": "${PIPER_VOICE_ONNX_SHA256}",
  "configSha256": "${PIPER_VOICE_CONFIG_SHA256}",
  "installedAt": "$(date -u +"%Y-%m-%dT%H:%M:%SZ")"
}
INNER_EOF

echo "Piper voice ${PIPER_VOICE_ID} (${PIPER_VERSION}) successfully installed and verified in ${TARGET_DIR}."
