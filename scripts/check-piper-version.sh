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

if [[ -z "${PIPER_VERSION:-}" || -z "${PIPER_VOICE_ID:-}" || -z "${PIPER_VOICE_ONNX_SHA256:-}" || -z "${PIPER_VOICE_CONFIG_SHA256:-}" || -z "${PIPER_BASE_IMAGE_DIGEST:-}" || -z "${PIPER_DOCKERFILE_SHA256:-}" ]]; then
  echo "Error: .piper-version must define PIPER_VERSION, PIPER_VOICE_ID, PIPER_VOICE_ONNX_SHA256, PIPER_VOICE_CONFIG_SHA256, PIPER_BASE_IMAGE_DIGEST, and PIPER_DOCKERFILE_SHA256" >&2
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

# 1. Verify Dockerfile exists and matches pinned hash
DOCKERFILE="${REPO_ROOT}/docker/piper/Dockerfile"
if [[ ! -f "${DOCKERFILE}" ]]; then
  echo "Error: Piper Dockerfile not found at ${DOCKERFILE}" >&2
  exit 1
fi

ACTUAL_DOCKERFILE_SHA="$(compute_sha256 "${DOCKERFILE}")"
if [[ "${ACTUAL_DOCKERFILE_SHA}" != "${PIPER_DOCKERFILE_SHA256}" ]]; then
  echo "Error: Piper Dockerfile SHA-256 mismatch!" >&2
  echo "Expected: ${PIPER_DOCKERFILE_SHA256}" >&2
  echo "Actual:   ${ACTUAL_DOCKERFILE_SHA}" >&2
  exit 1
fi

# 1b. Verify base image digest in Dockerfile matches PIPER_BASE_IMAGE_DIGEST pin
DOCKERFILE_BASE_DIGEST="$(grep -E '^FROM ' "${DOCKERFILE}" | head -n 1 | sed -E 's/.*@(sha256:[a-f0-9]+).*/\1/' || true)"
if [[ -z "${DOCKERFILE_BASE_DIGEST}" || "${DOCKERFILE_BASE_DIGEST}" != "${PIPER_BASE_IMAGE_DIGEST}" ]]; then
  echo "Error: Piper Dockerfile base image digest mismatch!" >&2
  echo "Expected: ${PIPER_BASE_IMAGE_DIGEST}" >&2
  echo "Found in Dockerfile: ${DOCKERFILE_BASE_DIGEST:-none}" >&2
  exit 1
fi

# 2. Verify static voice artifacts and manifest
REL_DIR="${PIPER_VOICE_DIR:-node_modules/.cache/piper-voice}"
TARGET_DIR="${REPO_ROOT}/${REL_DIR}"
MODEL_FILE="${TARGET_DIR}/${PIPER_VOICE_ID}.onnx"
CONFIG_FILE="${TARGET_DIR}/${PIPER_VOICE_ID}.onnx.json"
MANIFEST_FILE="${TARGET_DIR}/model_manifest.json"

if [[ ! -f "${MODEL_FILE}" ]]; then
  echo "Error: Pinned Piper voice ONNX model not found at ${MODEL_FILE}" >&2
  echo "Please run '${REPO_ROOT}/scripts/install-piper-voice.sh' to download and verify the pinned voice." >&2
  exit 1
fi

if [[ ! -f "${CONFIG_FILE}" ]]; then
  echo "Error: Pinned Piper voice config not found at ${CONFIG_FILE}" >&2
  echo "Please run '${REPO_ROOT}/scripts/install-piper-voice.sh' to download and verify the pinned voice." >&2
  exit 1
fi

if [[ ! -f "${MANIFEST_FILE}" ]]; then
  echo "Error: Piper voice manifest missing at ${MANIFEST_FILE}" >&2
  echo "Please run '${REPO_ROOT}/scripts/install-piper-voice.sh' to complete installation." >&2
  exit 1
fi

RECORDED_ID="$(grep '"voiceId"' "${MANIFEST_FILE}" | head -n 1 | sed -E 's/.*"voiceId": *"([^"]+)".*/\1/' || true)"
if [[ -z "${RECORDED_ID}" || "${RECORDED_ID}" != "${PIPER_VOICE_ID}" ]]; then
  echo "Error: Piper voice ID mismatch in manifest!" >&2
  echo "Expected: ${PIPER_VOICE_ID}" >&2
  echo "Recorded: ${RECORDED_ID:-none}" >&2
  echo "Please run '${REPO_ROOT}/scripts/install-piper-voice.sh' to align your cache." >&2
  exit 1
fi

RECORDED_VER="$(grep '"version"' "${MANIFEST_FILE}" | head -n 1 | sed -E 's/.*"version": *"([^"]+)".*/\1/' || true)"
if [[ -z "${RECORDED_VER}" || "${RECORDED_VER}" != "${PIPER_VERSION}" ]]; then
  echo "Error: Piper voice version mismatch in manifest!" >&2
  echo "Expected: ${PIPER_VERSION}" >&2
  echo "Recorded: ${RECORDED_VER:-none}" >&2
  echo "Please run '${REPO_ROOT}/scripts/install-piper-voice.sh' to align your cache." >&2
  exit 1
fi

RECORDED_ONNX_SHA="$(grep '"onnxSha256"' "${MANIFEST_FILE}" | head -n 1 | sed -E 's/.*"onnxSha256": *"([^"]+)".*/\1/' || true)"
if [[ -z "${RECORDED_ONNX_SHA}" || "${RECORDED_ONNX_SHA}" != "${PIPER_VOICE_ONNX_SHA256}" ]]; then
  echo "Error: Piper voice ONNX SHA-256 mismatch in manifest!" >&2
  echo "Expected: ${PIPER_VOICE_ONNX_SHA256}" >&2
  echo "Recorded: ${RECORDED_ONNX_SHA:-none}" >&2
  echo "Please run '${REPO_ROOT}/scripts/install-piper-voice.sh' to align your cache." >&2
  exit 1
fi

RECORDED_CFG_SHA="$(grep '"configSha256"' "${MANIFEST_FILE}" | head -n 1 | sed -E 's/.*"configSha256": *"([^"]+)".*/\1/' || true)"
if [[ -z "${RECORDED_CFG_SHA}" || "${RECORDED_CFG_SHA}" != "${PIPER_VOICE_CONFIG_SHA256}" ]]; then
  echo "Error: Piper voice config SHA-256 mismatch in manifest!" >&2
  echo "Expected: ${PIPER_VOICE_CONFIG_SHA256}" >&2
  echo "Recorded: ${RECORDED_CFG_SHA:-none}" >&2
  echo "Please run '${REPO_ROOT}/scripts/install-piper-voice.sh' to align your cache." >&2
  exit 1
fi

ACTUAL_CONFIG_SHA="$(compute_sha256 "${CONFIG_FILE}")"
if [[ "${ACTUAL_CONFIG_SHA}" != "${PIPER_VOICE_CONFIG_SHA256}" ]]; then
  echo "Error: Piper config.json SHA-256 checksum mismatch!" >&2
  echo "Expected: ${PIPER_VOICE_CONFIG_SHA256}" >&2
  echo "Actual:   ${ACTUAL_CONFIG_SHA}" >&2
  exit 1
fi

ACTUAL_MODEL_SHA="$(compute_sha256 "${MODEL_FILE}")"
if [[ "${ACTUAL_MODEL_SHA}" != "${PIPER_VOICE_ONNX_SHA256}" ]]; then
  echo "Error: Piper model SHA-256 checksum mismatch!" >&2
  echo "Expected: ${PIPER_VOICE_ONNX_SHA256}" >&2
  echo "Actual:   ${ACTUAL_MODEL_SHA}" >&2
  exit 1
fi

echo "Piper check passed: ${PIPER_VOICE_ID} @ ${PIPER_VERSION} (model: ${ACTUAL_MODEL_SHA}, config: ${ACTUAL_CONFIG_SHA}, dockerfile: ${ACTUAL_DOCKERFILE_SHA})"
