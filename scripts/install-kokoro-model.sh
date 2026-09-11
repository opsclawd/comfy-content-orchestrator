#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "${SCRIPT_DIR}/.." && pwd)"

VERSION_FILE="${REPO_ROOT}/.kokoro-version"

if [[ ! -f "${VERSION_FILE}" ]]; then
  echo "Error: .kokoro-version file not found at ${VERSION_FILE}" >&2
  exit 1
fi

source "${VERSION_FILE}"

if [[ -z "${KOKORO_MODEL_ID:-}" || -z "${KOKORO_MODEL_REVISION:-}" || -z "${KOKORO_ONNX_QUANTIZED_SHA256:-}" || -z "${KOKORO_VOICE_AF_HEART_SHA256:-}" || -z "${KOKORO_CONFIG_SHA256:-}" || -z "${KOKORO_TOKENIZER_SHA256:-}" || -z "${KOKORO_TOKENIZER_CONFIG_SHA256:-}" ]]; then
  echo "Error: .kokoro-version must define KOKORO_MODEL_ID, KOKORO_MODEL_REVISION, KOKORO_ONNX_QUANTIZED_SHA256, KOKORO_VOICE_AF_HEART_SHA256, KOKORO_CONFIG_SHA256, KOKORO_TOKENIZER_SHA256, and KOKORO_TOKENIZER_CONFIG_SHA256" >&2
  exit 1
fi

MAIN_REPO=""
if [[ -f "${REPO_ROOT}/.git" ]]; then
  GITDIR="$(sed -n 's/^gitdir: //p' "${REPO_ROOT}/.git" | head -n 1 || true)"
  if [[ -n "${GITDIR}" ]]; then
    if [[ "${GITDIR}" != /* ]]; then
      GITDIR="${REPO_ROOT}/${GITDIR}"
    fi
    if [[ -d "${GITDIR}" ]]; then
      MAIN_GIT_DIR="$(cd "${GITDIR}/../.." && pwd)"
      MAIN_REPO="$(cd "${MAIN_GIT_DIR}/.." && pwd)"
    elif [[ -d "$(dirname "${GITDIR}")/.." ]]; then
      MAIN_GIT_DIR="$(cd "$(dirname "${GITDIR}")/.." && pwd)"
      MAIN_REPO="$(cd "${MAIN_GIT_DIR}/.." && pwd)"
    fi
  fi
elif [[ -d "${REPO_ROOT}/.git" ]]; then
  MAIN_REPO="${REPO_ROOT}"
fi
if [[ -z "${MAIN_REPO}" ]] && command -v git >/dev/null 2>&1 && git -C "${REPO_ROOT}" rev-parse --git-common-dir >/dev/null 2>&1; then
  COMMON_DIR="$(git -C "${REPO_ROOT}" rev-parse --git-common-dir)"
  MAIN_REPO="$(cd "${COMMON_DIR}/.." && pwd)"
fi
if [[ -z "${MAIN_REPO}" ]]; then
  MAIN_REPO="${REPO_ROOT}"
fi

SHARED_CACHE_DIR="${CCO_SHARED_CACHE_DIR:-${MAIN_REPO}/.ai-cache}"

# Copies src onto dst, but treats dst already being the same file as src
# (e.g. because an earlier step already hardlinked it in from the shared
# cache before this script rewrote it in place) as a no-op success rather
# than letting `cp` fail with "are the same file".
sync_to_shared_cache() {
  local src="$1" dst="$2"
  if [[ -e "${dst}" ]]; then
    local src_id dst_id
    src_id="$(stat -c '%d:%i' "${src}" 2>/dev/null || true)"
    dst_id="$(stat -c '%d:%i' "${dst}" 2>/dev/null || true)"
    if [[ -n "${src_id}" && "${src_id}" == "${dst_id}" ]]; then
      return 0
    fi
  fi
  ln -f "${src}" "${dst}" 2>/dev/null || cp -f "${src}" "${dst}"
}

REL_DIR="${KOKORO_MODEL_DIR:-node_modules/.cache/kokoro-model}"
TARGET_DIR="${REPO_ROOT}/${REL_DIR}"
mkdir -p "${TARGET_DIR}/onnx"
mkdir -p "${TARGET_DIR}/voices"

echo "Installing Kokoro model ${KOKORO_MODEL_ID} (revision: ${KOKORO_MODEL_REVISION})..."
echo "Target directory: ${TARGET_DIR}"
echo "Shared cache dir: ${SHARED_CACHE_DIR}"

# If an existing cache has a mismatched revision, modelId, or checksums, purge it to ensure clean provenance
if [[ -f "${TARGET_DIR}/model_manifest.json" ]]; then
  EXISTING_REV="$(grep '"revision"' "${TARGET_DIR}/model_manifest.json" | head -n 1 | sed -E 's/.*"revision": *"([^"]+)".*/\1/' || true)"
  EXISTING_ID="$(grep '"modelId"' "${TARGET_DIR}/model_manifest.json" | head -n 1 | sed -E 's/.*"modelId": *"([^"]+)".*/\1/' || true)"
  EXISTING_CFG="$(grep '"configSha256"' "${TARGET_DIR}/model_manifest.json" | head -n 1 | sed -E 's/.*"configSha256": *"([^"]+)".*/\1/' || true)"
  EXISTING_TOK="$(grep '"tokenizerSha256"' "${TARGET_DIR}/model_manifest.json" | head -n 1 | sed -E 's/.*"tokenizerSha256": *"([^"]+)".*/\1/' || true)"
  EXISTING_TCFG="$(grep '"tokenizerConfigSha256"' "${TARGET_DIR}/model_manifest.json" | head -n 1 | sed -E 's/.*"tokenizerConfigSha256": *"([^"]+)".*/\1/' || true)"

  if [[ -n "${EXISTING_REV}" && "${EXISTING_REV}" != "${KOKORO_MODEL_REVISION}" ]] || \
     [[ -n "${EXISTING_ID}" && "${EXISTING_ID}" != "${KOKORO_MODEL_ID}" ]] || \
     [[ -n "${EXISTING_CFG}" && "${EXISTING_CFG}" != "${KOKORO_CONFIG_SHA256}" ]] || \
     [[ -n "${EXISTING_TOK}" && "${EXISTING_TOK}" != "${KOKORO_TOKENIZER_SHA256}" ]] || \
     [[ -n "${EXISTING_TCFG}" && "${EXISTING_TCFG}" != "${KOKORO_TOKENIZER_CONFIG_SHA256}" ]]; then
    echo "Found existing cache with mismatched provenance metadata. Purging cache..."
    rm -rf "${TARGET_DIR:?}"/*
    mkdir -p "${TARGET_DIR}/onnx"
    mkdir -p "${TARGET_DIR}/voices"
  fi
fi

HF_BASE_RAW="https://huggingface.co/${KOKORO_MODEL_ID}/raw/${KOKORO_MODEL_REVISION}"
HF_BASE_RESOLVE="https://huggingface.co/${KOKORO_MODEL_ID}/resolve/${KOKORO_MODEL_REVISION}"

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

for ASSET in config.json tokenizer.json tokenizer_config.json; do
  if [[ "${ASSET}" == "config.json" ]]; then
    EXPECTED_HASH="${KOKORO_CONFIG_SHA256}"
  elif [[ "${ASSET}" == "tokenizer.json" ]]; then
    EXPECTED_HASH="${KOKORO_TOKENIZER_SHA256}"
  else
    EXPECTED_HASH="${KOKORO_TOKENIZER_CONFIG_SHA256}"
  fi

  ASSET_FILE="${TARGET_DIR}/${ASSET}"
  if [[ -f "${ASSET_FILE}" ]]; then
    CURRENT_HASH="$(sha256sum "${ASSET_FILE}" 2>/dev/null | awk '{print $1}' || shasum -a 256 "${ASSET_FILE}" 2>/dev/null | awk '{print $1}' || true)"
    if [[ "${CURRENT_HASH}" != "${EXPECTED_HASH}" ]]; then
      echo "Existing ${ASSET} has mismatched checksum (${CURRENT_HASH}). Removing..."
      rm -f "${ASSET_FILE}"
    fi
  fi

  if [[ ! -f "${ASSET_FILE}" ]]; then
    for candidate in "${SHARED_CACHE_DIR}/kokoro-model/${ASSET}" "${MAIN_REPO}/node_modules/.cache/kokoro-model/${ASSET}"; do
      if [[ -f "${candidate}" ]]; then
        cand_hash="$(sha256sum "${candidate}" 2>/dev/null | awk '{print $1}' || shasum -a 256 "${candidate}" 2>/dev/null | awk '{print $1}' || true)"
        if [[ "${cand_hash}" == "${EXPECTED_HASH}" ]]; then
          echo "Seeding ${ASSET} from ${candidate}..."
          ln -f "${candidate}" "${ASSET_FILE}" 2>/dev/null || cp "${candidate}" "${ASSET_FILE}"
          break
        fi
      fi
    done
  fi

  if [[ ! -f "${ASSET_FILE}" ]]; then
    echo "Fetching ${ASSET} (${KOKORO_MODEL_REVISION})..."
    download_file "${HF_BASE_RAW}/${ASSET}" "${ASSET_FILE}"
  fi

  if command -v sha256sum >/dev/null 2>&1; then
    ACTUAL_HASH="$(sha256sum "${ASSET_FILE}" | awk '{print $1}')"
  elif command -v shasum >/dev/null 2>&1; then
    ACTUAL_HASH="$(shasum -a 256 "${ASSET_FILE}" | awk '{print $1}')"
  else
    echo "Error: neither sha256sum nor shasum found." >&2
    exit 1
  fi

  if [[ "${ACTUAL_HASH}" != "${EXPECTED_HASH}" ]]; then
    echo "Error: SHA-256 checksum mismatch for ${ASSET}!" >&2
    echo "Expected: ${EXPECTED_HASH}" >&2
    echo "Actual:   ${ACTUAL_HASH}" >&2
    rm -f "${ASSET_FILE}"
    exit 1
  fi
  echo "SHA-256 checksum verified for ${ASSET}: ${ACTUAL_HASH}"
done

MODEL_FILE="${TARGET_DIR}/onnx/model_quantized.onnx"

# If model_quantized.onnx exists but has mismatched checksum, delete it so it gets refreshed
if [[ -f "${MODEL_FILE}" ]]; then
  CURRENT_SHA256="$(sha256sum "${MODEL_FILE}" 2>/dev/null | awk '{print $1}' || shasum -a 256 "${MODEL_FILE}" 2>/dev/null | awk '{print $1}' || true)"
  if [[ "${CURRENT_SHA256}" != "${KOKORO_ONNX_QUANTIZED_SHA256}" ]]; then
    echo "Existing model_quantized.onnx has mismatched checksum (${CURRENT_SHA256}). Removing..."
    rm -f "${MODEL_FILE}"
  fi
fi

# Check if model_quantized.onnx can be seeded from an existing verified cache
if [[ ! -f "${MODEL_FILE}" ]]; then
  for candidate in "${SHARED_CACHE_DIR}/kokoro-model/onnx/model_quantized.onnx" "${MAIN_REPO}/node_modules/.cache/kokoro-model/onnx/model_quantized.onnx"; do
    if [[ -f "${candidate}" ]]; then
      CACHED_SHA256="$(sha256sum "${candidate}" 2>/dev/null | awk '{print $1}' || shasum -a 256 "${candidate}" 2>/dev/null | awk '{print $1}' || true)"
      if [[ "${CACHED_SHA256}" == "${KOKORO_ONNX_QUANTIZED_SHA256}" ]]; then
        echo "Seeding verified cached model weights from ${candidate}..."
        ln -f "${candidate}" "${MODEL_FILE}" 2>/dev/null || cp "${candidate}" "${MODEL_FILE}"
        break
      fi
    fi
  done
fi

if [[ ! -f "${MODEL_FILE}" ]]; then
  EXISTING_CACHE_FILE="$(find "${REPO_ROOT}/node_modules" -type f -name "model_quantized.onnx" 2>/dev/null | grep -v "${REL_DIR}" | head -n 1 || true)"
  if [[ -n "${EXISTING_CACHE_FILE}" && -f "${EXISTING_CACHE_FILE}" ]]; then
    CACHED_SHA256="$(sha256sum "${EXISTING_CACHE_FILE}" 2>/dev/null | awk '{print $1}' || shasum -a 256 "${EXISTING_CACHE_FILE}" 2>/dev/null | awk '{print $1}' || true)"
    if [[ "${CACHED_SHA256}" == "${KOKORO_ONNX_QUANTIZED_SHA256}" ]]; then
      echo "Copying verified cached model weights into target directory..."
      cp "${EXISTING_CACHE_FILE}" "${MODEL_FILE}"
    fi
  fi
fi

if [[ ! -f "${MODEL_FILE}" ]]; then
  echo "Downloading model_quantized.onnx (${KOKORO_MODEL_REVISION})..."
  download_file "${HF_BASE_RESOLVE}/onnx/model_quantized.onnx" "${MODEL_FILE}"
fi

echo "Verifying SHA-256 checksum of Kokoro model weights..."
if command -v sha256sum >/dev/null 2>&1; then
  ACTUAL_SHA256="$(sha256sum "${MODEL_FILE}" | awk '{print $1}')"
elif command -v shasum >/dev/null 2>&1; then
  ACTUAL_SHA256="$(shasum -a 256 "${MODEL_FILE}" | awk '{print $1}')"
else
  echo "Error: neither sha256sum nor shasum found." >&2
  exit 1
fi

if [[ "${ACTUAL_SHA256}" != "${KOKORO_ONNX_QUANTIZED_SHA256}" ]]; then
  echo "Error: SHA-256 checksum mismatch for Kokoro model weights!" >&2
  echo "Expected: ${KOKORO_ONNX_QUANTIZED_SHA256}" >&2
  echo "Actual:   ${ACTUAL_SHA256}" >&2
  rm -f "${MODEL_FILE}"
  exit 1
fi

echo "SHA-256 checksum verified: ${ACTUAL_SHA256}"

if [[ -n "${KOKORO_ONNX_QUANTIZED_MD5:-}" ]]; then
  if command -v md5sum >/dev/null 2>&1; then
    ACTUAL_MD5="$(md5sum "${MODEL_FILE}" | awk '{print $1}')"
  elif command -v md5 >/dev/null 2>&1; then
    ACTUAL_MD5="$(md5 -q "${MODEL_FILE}")"
  else
    ACTUAL_MD5=""
  fi

  if [[ -n "${ACTUAL_MD5}" && "${ACTUAL_MD5}" != "${KOKORO_ONNX_QUANTIZED_MD5}" ]]; then
    echo "Error: MD5 checksum mismatch for Kokoro model weights!" >&2
    echo "Expected: ${KOKORO_ONNX_QUANTIZED_MD5}" >&2
    echo "Actual:   ${ACTUAL_MD5}" >&2
    rm -f "${MODEL_FILE}"
    exit 1
  fi
  echo "MD5 checksum verified: ${ACTUAL_MD5}"
fi

VOICE_FILE="${TARGET_DIR}/voices/af_heart.bin"

# If voices/af_heart.bin exists but has mismatched checksum, delete it so it gets refreshed
if [[ -f "${VOICE_FILE}" ]]; then
  CURRENT_VOICE_SHA256="$(sha256sum "${VOICE_FILE}" 2>/dev/null | awk '{print $1}' || shasum -a 256 "${VOICE_FILE}" 2>/dev/null | awk '{print $1}' || true)"
  if [[ "${CURRENT_VOICE_SHA256}" != "${KOKORO_VOICE_AF_HEART_SHA256}" ]]; then
    echo "Existing voices/af_heart.bin has mismatched checksum (${CURRENT_VOICE_SHA256}). Removing..."
    rm -f "${VOICE_FILE}"
  fi
fi

# Check if af_heart.bin can be seeded from an existing verified cache
if [[ ! -f "${VOICE_FILE}" ]]; then
  for candidate in "${SHARED_CACHE_DIR}/kokoro-model/voices/af_heart.bin" "${MAIN_REPO}/node_modules/.cache/kokoro-model/voices/af_heart.bin"; do
    if [[ -f "${candidate}" ]]; then
      CACHED_VOICE_SHA256="$(sha256sum "${candidate}" 2>/dev/null | awk '{print $1}' || shasum -a 256 "${candidate}" 2>/dev/null | awk '{print $1}' || true)"
      if [[ "${CACHED_VOICE_SHA256}" == "${KOKORO_VOICE_AF_HEART_SHA256}" ]]; then
        echo "Seeding verified cached af_heart.bin from ${candidate}..."
        ln -f "${candidate}" "${VOICE_FILE}" 2>/dev/null || cp "${candidate}" "${VOICE_FILE}"
        break
      fi
    fi
  done
fi

if [[ ! -f "${VOICE_FILE}" ]]; then
  EXISTING_CACHE_VOICE="$(find "${REPO_ROOT}/node_modules" -type f -name "af_heart.bin" 2>/dev/null | grep -v "${REL_DIR}" | head -n 1 || true)"
  if [[ -n "${EXISTING_CACHE_VOICE}" && -f "${EXISTING_CACHE_VOICE}" ]]; then
    CACHED_VOICE_SHA256="$(sha256sum "${EXISTING_CACHE_VOICE}" 2>/dev/null | awk '{print $1}' || shasum -a 256 "${EXISTING_CACHE_VOICE}" 2>/dev/null | awk '{print $1}' || true)"
    if [[ "${CACHED_VOICE_SHA256}" == "${KOKORO_VOICE_AF_HEART_SHA256}" ]]; then
      echo "Copying verified cached af_heart.bin into target directory..."
      cp "${EXISTING_CACHE_VOICE}" "${VOICE_FILE}"
    fi
  fi
fi

if [[ ! -f "${VOICE_FILE}" ]]; then
  echo "Downloading voices/af_heart.bin (${KOKORO_MODEL_REVISION})..."
  download_file "${HF_BASE_RESOLVE}/voices/af_heart.bin" "${VOICE_FILE}"
fi

echo "Verifying SHA-256 checksum of af_heart voice weights..."
if command -v sha256sum >/dev/null 2>&1; then
  ACTUAL_VOICE_SHA256="$(sha256sum "${VOICE_FILE}" | awk '{print $1}')"
elif command -v shasum >/dev/null 2>&1; then
  ACTUAL_VOICE_SHA256="$(shasum -a 256 "${VOICE_FILE}" | awk '{print $1}')"
else
  echo "Error: neither sha256sum nor shasum found." >&2
  exit 1
fi

if [[ "${ACTUAL_VOICE_SHA256}" != "${KOKORO_VOICE_AF_HEART_SHA256}" ]]; then
  echo "Error: SHA-256 checksum mismatch for Kokoro af_heart voice!" >&2
  echo "Expected: ${KOKORO_VOICE_AF_HEART_SHA256}" >&2
  echo "Actual:   ${ACTUAL_VOICE_SHA256}" >&2
  rm -f "${VOICE_FILE}"
  exit 1
fi

echo "SHA-256 checksum verified for af_heart: ${ACTUAL_VOICE_SHA256}"

# Seed any other voice files from kokoro-js package into TARGET_DIR/voices if present
EXISTING_VOICES_DIR="$(find "${REPO_ROOT}/node_modules" -type d -path "*/kokoro-js/voices" 2>/dev/null | head -n 1 || true)"
if [[ -n "${EXISTING_VOICES_DIR}" && -d "${EXISTING_VOICES_DIR}" ]]; then
  for vfile in "${EXISTING_VOICES_DIR}"/*.bin; do
    if [[ -f "${vfile}" ]]; then
      vname="$(basename "${vfile}")"
      if [[ ! -f "${TARGET_DIR}/voices/${vname}" ]]; then
        cp "${vfile}" "${TARGET_DIR}/voices/${vname}"
      fi
    fi
  done
fi

cat > "${TARGET_DIR}/model_manifest.json" <<EOF
{
  "modelId": "${KOKORO_MODEL_ID}",
  "revision": "${KOKORO_MODEL_REVISION}",
  "sha256": "${KOKORO_ONNX_QUANTIZED_SHA256}",
  "md5": "${KOKORO_ONNX_QUANTIZED_MD5:-}",
  "configSha256": "${KOKORO_CONFIG_SHA256}",
  "tokenizerSha256": "${KOKORO_TOKENIZER_SHA256}",
  "tokenizerConfigSha256": "${KOKORO_TOKENIZER_CONFIG_SHA256}",
  "installedAt": "$(date -u +"%Y-%m-%dT%H:%M:%SZ")",
  "voices": {
    "af_heart": "${KOKORO_VOICE_AF_HEART_SHA256}"
  }
}
EOF

# Sync to shared cache if running in worktree or outside shared cache
if [[ "${TARGET_DIR}" != "${SHARED_CACHE_DIR}/kokoro-model" ]]; then
  mkdir -p "${SHARED_CACHE_DIR}/kokoro-model/onnx" "${SHARED_CACHE_DIR}/kokoro-model/voices"
  for f in config.json tokenizer.json tokenizer_config.json model_manifest.json; do
    if [[ -f "${TARGET_DIR}/${f}" ]]; then
      sync_to_shared_cache "${TARGET_DIR}/${f}" "${SHARED_CACHE_DIR}/kokoro-model/${f}"
    fi
  done
  if [[ -f "${MODEL_FILE}" ]]; then
    sync_to_shared_cache "${MODEL_FILE}" "${SHARED_CACHE_DIR}/kokoro-model/onnx/model_quantized.onnx"
  fi
  if [[ -d "${TARGET_DIR}/voices" ]]; then
    for vf in "${TARGET_DIR}/voices"/*; do
      if [[ -f "${vf}" ]]; then
        vfn="$(basename "${vf}")"
        sync_to_shared_cache "${vf}" "${SHARED_CACHE_DIR}/kokoro-model/voices/${vfn}"
      fi
    done
  fi
fi

echo "Kokoro model ${KOKORO_MODEL_ID} (${KOKORO_MODEL_REVISION}) successfully installed and verified in ${TARGET_DIR}."
