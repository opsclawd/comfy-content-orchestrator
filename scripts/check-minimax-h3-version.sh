#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "${SCRIPT_DIR}/.." && pwd)"

VERSION_FILE="${REPO_ROOT}/.minimax-h3-version"

if [[ ! -f "${VERSION_FILE}" ]]; then
  echo "Error: .minimax-h3-version file not found at ${VERSION_FILE}" >&2
  exit 1
fi

source "${VERSION_FILE}"

if [[ -z "${MINIMAX_H3_VERSION:-}" || -z "${MINIMAX_H3_REPO:-}" || -z "${MINIMAX_H3_REVISION:-}" || \
      -z "${MINIMAX_H3_DIFFUSION_FILE:-}" || -z "${MINIMAX_H3_DIFFUSION_SHA256:-}" || -z "${MINIMAX_H3_DIFFUSION_SIZE:-}" || \
      -z "${MINIMAX_H3_TEXT_ENCODER_FILE:-}" || -z "${MINIMAX_H3_TEXT_ENCODER_SHA256:-}" || -z "${MINIMAX_H3_TEXT_ENCODER_SIZE:-}" || \
      -z "${MINIMAX_H3_VIDEO_VAE_FILE:-}" || -z "${MINIMAX_H3_VIDEO_VAE_SHA256:-}" || -z "${MINIMAX_H3_VIDEO_VAE_SIZE:-}" || \
      -z "${MINIMAX_H3_AUDIO_VAE_FILE:-}" || -z "${MINIMAX_H3_AUDIO_VAE_SHA256:-}" || -z "${MINIMAX_H3_AUDIO_VAE_SIZE:-}" ]]; then
  echo "Error: .minimax-h3-version must define MINIMAX_H3_VERSION, MINIMAX_H3_REPO, MINIMAX_H3_REVISION, and all model files/hashes/sizes" >&2
  exit 1
fi

QUICK_MODE=false
CUSTOM_MODELS_DIR=""

while [[ $# -gt 0 ]]; do
  case "$1" in
    --quick)
      QUICK_MODE=true
      shift
      ;;
    --models-dir)
      CUSTOM_MODELS_DIR="$2"
      shift 2
      ;;
    -h|--help)
      echo "Usage: $0 [--quick] [--models-dir <path>]"
      echo "  --quick       Verify file existence and size without computing full SHA-256 hashes"
      echo "  --models-dir  Explicit path to ComfyUI models directory containing diffusion_models, text_encoders, vae"
      exit 0
      ;;
    *)
      echo "Unknown argument: $1" >&2
      exit 1
      ;;
  esac
done

# Resolve models directory
MODELS_DIR=""
if [[ -n "${CUSTOM_MODELS_DIR}" ]]; then
  MODELS_DIR="${CUSTOM_MODELS_DIR}"
elif [[ -n "${MINIMAX_H3_MODELS_DIR:-}" && -d "${MINIMAX_H3_MODELS_DIR}" ]]; then
  MODELS_DIR="${MINIMAX_H3_MODELS_DIR}"
elif [[ -n "${COMFYUI_MODELS_DIR:-}" && -d "${COMFYUI_MODELS_DIR}" ]]; then
  MODELS_DIR="${COMFYUI_MODELS_DIR}"
elif [[ -n "${COMFYUI_DIR:-}" && -d "${COMFYUI_DIR}/models" ]]; then
  MODELS_DIR="${COMFYUI_DIR}/models"
elif [[ -d "/home/gpoontip/ComfyUI/models" ]]; then
  MODELS_DIR="/home/gpoontip/ComfyUI/models"
elif [[ -d "${REPO_ROOT}/node_modules/.cache/minimax-h3-models" ]]; then
  MODELS_DIR="${REPO_ROOT}/node_modules/.cache/minimax-h3-models"
else
  MODELS_DIR="${REPO_ROOT}/models"
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

get_file_size() {
  local target_file="$1"
  if [[ "$OSTYPE" == "darwin"* ]]; then
    stat -f%z "${target_file}"
  else
    stat -c%s "${target_file}"
  fi
}

# 1. Check directory existence
if [[ ! -d "${MODELS_DIR}" ]]; then
  echo "Error: Models directory not found at ${MODELS_DIR}" >&2
  echo "Please specify --models-dir or run '${REPO_ROOT}/scripts/install-minimax-h3.sh'." >&2
  exit 1
fi

# 2. Check model manifest if present
MANIFEST_FILE="${MODELS_DIR}/minimax_h3_manifest.json"
if [[ -f "${MANIFEST_FILE}" ]]; then
  RECORDED_VERSION="$(grep '"version"' "${MANIFEST_FILE}" | head -n 1 | sed -E 's/.*"version": *"([^"]+)".*/\1/' || true)"
  if [[ -n "${RECORDED_VERSION}" && "${RECORDED_VERSION}" != "${MINIMAX_H3_VERSION}" ]]; then
    echo "Error: MiniMax-H3 manifest version mismatch!" >&2
    echo "Expected: ${MINIMAX_H3_VERSION}" >&2
    echo "Recorded: ${RECORDED_VERSION}" >&2
    exit 1
  fi

  RECORDED_REPO="$(grep '"repository"' "${MANIFEST_FILE}" | head -n 1 | sed -E 's/.*"repository": *"([^"]+)".*/\1/' || true)"
  if [[ -n "${RECORDED_REPO}" && "${RECORDED_REPO}" != "${MINIMAX_H3_REPO}" ]]; then
    echo "Error: MiniMax-H3 manifest repository mismatch!" >&2
    echo "Expected: ${MINIMAX_H3_REPO}" >&2
    echo "Recorded: ${RECORDED_REPO}" >&2
    exit 1
  fi

  RECORDED_REVISION="$(grep '"revision"' "${MANIFEST_FILE}" | head -n 1 | sed -E 's/.*"revision": *"([^"]+)".*/\1/' || true)"
  if [[ -n "${RECORDED_REVISION}" && "${RECORDED_REVISION}" != "${MINIMAX_H3_REVISION}" ]]; then
    echo "Error: MiniMax-H3 manifest revision mismatch!" >&2
    echo "Expected: ${MINIMAX_H3_REVISION}" >&2
    echo "Recorded: ${RECORDED_REVISION}" >&2
    exit 1
  fi
fi

# 3. Verify each required model artifact
REQUIRED_MODELS=(
  "${MINIMAX_H3_DIFFUSION_FILE}:${MINIMAX_H3_DIFFUSION_SIZE}:${MINIMAX_H3_DIFFUSION_SHA256}:diffusion"
  "${MINIMAX_H3_TEXT_ENCODER_FILE}:${MINIMAX_H3_TEXT_ENCODER_SIZE}:${MINIMAX_H3_TEXT_ENCODER_SHA256}:text_encoder"
  "${MINIMAX_H3_VIDEO_VAE_FILE}:${MINIMAX_H3_VIDEO_VAE_SIZE}:${MINIMAX_H3_VIDEO_VAE_SHA256}:video_vae"
  "${MINIMAX_H3_AUDIO_VAE_FILE}:${MINIMAX_H3_AUDIO_VAE_SIZE}:${MINIMAX_H3_AUDIO_VAE_SHA256}:audio_vae"
)

for ENTRY in "${REQUIRED_MODELS[@]}"; do
  REL_FILE="$(echo "${ENTRY}" | cut -d: -f1)"
  EXPECTED_SIZE="$(echo "${ENTRY}" | cut -d: -f2)"
  EXPECTED_SHA="$(echo "${ENTRY}" | cut -d: -f3)"
  LABEL="$(echo "${ENTRY}" | cut -d: -f4)"

  FULL_PATH="${MODELS_DIR}/${REL_FILE}"

  if [[ ! -f "${FULL_PATH}" ]]; then
    echo "Error: Required MiniMax-H3 ${LABEL} model missing: ${FULL_PATH}" >&2
    echo "Please run '${REPO_ROOT}/scripts/install-minimax-h3.sh' to download pinned model weights." >&2
    exit 1
  fi

  ACTUAL_SIZE="$(get_file_size "${FULL_PATH}")"
  if [[ "${ACTUAL_SIZE}" -ne "${EXPECTED_SIZE}" ]]; then
    echo "Error: MiniMax-H3 ${LABEL} size mismatch for ${FULL_PATH}!" >&2
    echo "Expected: ${EXPECTED_SIZE} bytes" >&2
    echo "Actual:   ${ACTUAL_SIZE} bytes" >&2
    exit 1
  fi

  if [[ "${QUICK_MODE}" == false ]]; then
    ACTUAL_SHA="$(compute_sha256 "${FULL_PATH}")"
    if [[ "${ACTUAL_SHA}" != "${EXPECTED_SHA}" ]]; then
      echo "Error: MiniMax-H3 ${LABEL} SHA-256 mismatch for ${FULL_PATH}!" >&2
      echo "Expected: ${EXPECTED_SHA}" >&2
      echo "Actual:   ${ACTUAL_SHA}" >&2
      exit 1
    fi
  fi
done

echo "MiniMax-H3 check passed: repo=${MINIMAX_H3_REPO} rev=${MINIMAX_H3_REVISION} (models verified in ${MODELS_DIR}, quick=${QUICK_MODE})"
