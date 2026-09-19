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
  echo "Error: .minimax-h3-version must define MINIMAX_H3_VERSION, MINIMAX_H3_REPO, MINIMAX_H3_REVISION, and all model parameters" >&2
  exit 1
fi

CUSTOM_MODELS_DIR=""
DRY_RUN=false
SKIP_CHECKSUM=false
DIFFUSION_FLAVOR="ref2va" # ref2va | fl2va | both
HF_TOKEN="${HF_TOKEN:-}"

while [[ $# -gt 0 ]]; do
  case "$1" in
    --models-dir)
      CUSTOM_MODELS_DIR="$2"
      shift 2
      ;;
    --dry-run)
      DRY_RUN=true
      shift
      ;;
    --skip-checksum)
      SKIP_CHECKSUM=true
      shift
      ;;
    --diffusion-flavor)
      DIFFUSION_FLAVOR="$2"
      shift 2
      ;;
    --token)
      HF_TOKEN="$2"
      shift 2
      ;;
    -h|--help)
      echo "Usage: $0 [options]"
      echo "  --models-dir <path>       Target directory for models (defaults to ComfyUI models dir or .cache)"
      echo "  --diffusion-flavor <kind> 'ref2va' (default), 'fl2va', or 'both'"
      echo "  --dry-run                 Show download plan without executing"
      echo "  --skip-checksum           Skip sha256 calculation after downloading"
      echo "  --token <token>           Optional Hugging Face access token"
      exit 0
      ;;
    *)
      echo "Unknown argument: $1" >&2
      exit 1
      ;;
  esac
done

# Resolve target models directory
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
else
  MODELS_DIR="${REPO_ROOT}/node_modules/.cache/minimax-h3-models"
fi

mkdir -p "${MODELS_DIR}/diffusion_models"
mkdir -p "${MODELS_DIR}/text_encoders"
mkdir -p "${MODELS_DIR}/vae"

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

download_hf_file() {
  local rel_path="$1"
  local dest_path="$2"
  local tmp_path="${dest_path}.download"
  local dest_dir
  dest_dir="$(dirname "${dest_path}")"
  local file_name
  file_name="$(basename "${dest_path}")"
  local download_url="https://huggingface.co/${MINIMAX_H3_REPO}/resolve/${MINIMAX_H3_REVISION}/${rel_path}"

  mkdir -p "${dest_dir}"

  echo "Downloading ${rel_path} from ${MINIMAX_H3_REPO} (rev: ${MINIMAX_H3_REVISION})..."

  if command -v aria2c >/dev/null 2>&1; then
    local aria_args=(-c -x 8 -s 8 -k 1M --disable-ipv6=true --dir="${dest_dir}" -o "${file_name}")
    if [[ -n "${HF_TOKEN}" ]]; then
      aria_args+=(--header="Authorization: Bearer ${HF_TOKEN}")
    fi
    aria2c "${aria_args[@]}" "${download_url}"
    return 0
  fi

  if command -v hf >/dev/null 2>&1; then
    local hf_args=(download "${MINIMAX_H3_REPO}" "${rel_path}" "--revision" "${MINIMAX_H3_REVISION}" "--local-dir" "${MODELS_DIR}")
    if [[ -n "${HF_TOKEN}" ]]; then
      hf_args+=("--token" "${HF_TOKEN}")
    fi
    hf "${hf_args[@]}"
    return 0
  fi

  # Fallback to curl / wget direct download
  local auth_header=()
  if [[ -n "${HF_TOKEN}" ]]; then
    auth_header=(-H "Authorization: Bearer ${HF_TOKEN}")
  fi

  if command -v curl >/dev/null 2>&1; then
    curl -4 -fSL "${auth_header[@]}" "${download_url}" -o "${tmp_path}"
    mv -f "${tmp_path}" "${dest_path}"
  elif command -v wget >/dev/null 2>&1; then
    local wget_auth=()
    if [[ -n "${HF_TOKEN}" ]]; then
      wget_auth=(--header="Authorization: Bearer ${HF_TOKEN}")
    fi
    wget -4 -q --show-progress "${wget_auth[@]}" -O "${tmp_path}" "${download_url}"
    mv -f "${tmp_path}" "${dest_path}"
  else
    echo "Error: Neither 'aria2c', 'hf', 'curl', nor 'wget' found." >&2
    exit 1
  fi
}

# Collect target model list based on flavor
TARGET_MODELS=()
if [[ "${DIFFUSION_FLAVOR}" == "ref2va" || "${DIFFUSION_FLAVOR}" == "both" ]]; then
  TARGET_MODELS+=("${MINIMAX_H3_DIFFUSION_REF2VA_FILE}:${MINIMAX_H3_DIFFUSION_REF2VA_SIZE}:${MINIMAX_H3_DIFFUSION_REF2VA_SHA256}:diffusion_ref2va")
fi
if [[ "${DIFFUSION_FLAVOR}" == "fl2va" || "${DIFFUSION_FLAVOR}" == "both" ]]; then
  TARGET_MODELS+=("${MINIMAX_H3_DIFFUSION_FL2VA_FILE}:${MINIMAX_H3_DIFFUSION_FL2VA_SIZE}:${MINIMAX_H3_DIFFUSION_FL2VA_SHA256}:diffusion_fl2va")
fi

TARGET_MODELS+=(
  "${MINIMAX_H3_TEXT_ENCODER_FILE}:${MINIMAX_H3_TEXT_ENCODER_SIZE}:${MINIMAX_H3_TEXT_ENCODER_SHA256}:text_encoder"
  "${MINIMAX_H3_VIDEO_VAE_FILE}:${MINIMAX_H3_VIDEO_VAE_SIZE}:${MINIMAX_H3_VIDEO_VAE_SHA256}:video_vae"
  "${MINIMAX_H3_AUDIO_VAE_FILE}:${MINIMAX_H3_AUDIO_VAE_SIZE}:${MINIMAX_H3_AUDIO_VAE_SHA256}:audio_vae"
)

echo "=================================================="
echo "Installing MiniMax-H3 Models"
echo "Repository:   ${MINIMAX_H3_REPO}"
echo "Revision:     ${MINIMAX_H3_REVISION}"
echo "Target Dir:   ${MODELS_DIR}"
echo "Flavor:       ${DIFFUSION_FLAVOR}"
echo "=================================================="

for ENTRY in "${TARGET_MODELS[@]}"; do
  REL_FILE="$(echo "${ENTRY}" | cut -d: -f1)"
  EXPECTED_SIZE="$(echo "${ENTRY}" | cut -d: -f2)"
  EXPECTED_SHA="$(echo "${ENTRY}" | cut -d: -f3)"
  LABEL="$(echo "${ENTRY}" | cut -d: -f4)"

  DEST="${MODELS_DIR}/${REL_FILE}"

  if [[ -f "${DEST}" ]]; then
    ACTUAL_SIZE="$(get_file_size "${DEST}")"
    if [[ "${ACTUAL_SIZE}" -eq "${EXPECTED_SIZE}" ]]; then
      echo "Found existing ${LABEL} at ${DEST} (${ACTUAL_SIZE} bytes)."
      if [[ "${SKIP_CHECKSUM}" == false ]]; then
        ACTUAL_SHA="$(compute_sha256 "${DEST}")"
        if [[ "${ACTUAL_SHA}" == "${EXPECTED_SHA}" ]]; then
          echo "Verified checksum for ${REL_FILE}: ${ACTUAL_SHA}"
          continue
        else
          echo "Checksum mismatch for existing ${DEST}. Re-downloading..."
          rm -f "${DEST}"
        fi
      else
        continue
      fi
    else
      echo "Size mismatch for existing ${DEST} (expected ${EXPECTED_SIZE}, got ${ACTUAL_SIZE}). Re-downloading..."
      rm -f "${DEST}"
    fi
  fi

  if [[ "${DRY_RUN}" == true ]]; then
    echo "[dry-run] Would download ${REL_FILE} (${EXPECTED_SIZE} bytes) to ${DEST}"
    continue
  fi

  download_hf_file "${REL_FILE}" "${DEST}"

  ACTUAL_SIZE="$(get_file_size "${DEST}")"
  if [[ "${ACTUAL_SIZE}" -ne "${EXPECTED_SIZE}" ]]; then
    echo "Error: Downloaded file size mismatch for ${DEST}!" >&2
    echo "Expected: ${EXPECTED_SIZE} bytes" >&2
    echo "Actual:   ${ACTUAL_SIZE} bytes" >&2
    rm -f "${DEST}"
    exit 1
  fi

  if [[ "${SKIP_CHECKSUM}" == false ]]; then
    echo "Verifying SHA-256 for ${REL_FILE}..."
    ACTUAL_SHA="$(compute_sha256 "${DEST}")"
    if [[ "${ACTUAL_SHA}" != "${EXPECTED_SHA}" ]]; then
      echo "Error: SHA-256 mismatch for ${DEST}!" >&2
      echo "Expected: ${EXPECTED_SHA}" >&2
      echo "Actual:   ${ACTUAL_SHA}" >&2
      rm -f "${DEST}"
      exit 1
    fi
    echo "Checksum verified: ${ACTUAL_SHA}"
  fi
done

if [[ "${DRY_RUN}" == false ]]; then
  MANIFEST_FILE="${MODELS_DIR}/minimax_h3_manifest.json"
  cat > "${MANIFEST_FILE}" <<EOF
{
  "version": "${MINIMAX_H3_VERSION}",
  "repository": "${MINIMAX_H3_REPO}",
  "revision": "${MINIMAX_H3_REVISION}",
  "models": {
    "${MINIMAX_H3_DIFFUSION_FILE}": {
      "sha256": "${MINIMAX_H3_DIFFUSION_SHA256}",
      "size": ${MINIMAX_H3_DIFFUSION_SIZE}
    },
    "${MINIMAX_H3_TEXT_ENCODER_FILE}": {
      "sha256": "${MINIMAX_H3_TEXT_ENCODER_SHA256}",
      "size": ${MINIMAX_H3_TEXT_ENCODER_SIZE}
    },
    "${MINIMAX_H3_VIDEO_VAE_FILE}": {
      "sha256": "${MINIMAX_H3_VIDEO_VAE_SHA256}",
      "size": ${MINIMAX_H3_VIDEO_VAE_SIZE}
    },
    "${MINIMAX_H3_AUDIO_VAE_FILE}": {
      "sha256": "${MINIMAX_H3_AUDIO_VAE_SHA256}",
      "size": ${MINIMAX_H3_AUDIO_VAE_SIZE}
    }
  },
  "installedAt": "$(date -u +"%Y-%m-%dT%H:%M:%SZ")"
}
EOF
  echo "Wrote manifest to ${MANIFEST_FILE}"
fi

echo "MiniMax-H3 model provisioning complete in ${MODELS_DIR}."
