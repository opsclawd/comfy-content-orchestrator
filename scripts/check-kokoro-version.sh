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

REL_DIR="${KOKORO_MODEL_DIR:-node_modules/.cache/kokoro-model}"
TARGET_DIR="${REPO_ROOT}/${REL_DIR}"
MODEL_FILE="${TARGET_DIR}/onnx/model_quantized.onnx"
VOICE_FILE="${TARGET_DIR}/voices/af_heart.bin"
MANIFEST_FILE="${TARGET_DIR}/model_manifest.json"

if [[ ! -f "${MODEL_FILE}" ]]; then
  echo "Error: Pinned Kokoro model weights not found at ${MODEL_FILE}" >&2
  echo "Please run '${REPO_ROOT}/scripts/install-kokoro-model.sh' to download and verify the pinned Kokoro model." >&2
  exit 1
fi

if [[ ! -f "${VOICE_FILE}" ]]; then
  echo "Error: Pinned Kokoro voice artifact af_heart.bin not found at ${VOICE_FILE}" >&2
  echo "Please run '${REPO_ROOT}/scripts/install-kokoro-model.sh' to download and verify the pinned Kokoro model." >&2
  exit 1
fi

for REQUIRED in config.json tokenizer.json tokenizer_config.json; do
  if [[ ! -f "${TARGET_DIR}/${REQUIRED}" ]]; then
    echo "Error: Required model asset ${REQUIRED} missing in ${TARGET_DIR}" >&2
    echo "Please run '${REPO_ROOT}/scripts/install-kokoro-model.sh' to complete installation." >&2
    exit 1
  fi
done

if [[ ! -f "${MANIFEST_FILE}" ]]; then
  echo "Error: Kokoro model manifest missing at ${MANIFEST_FILE}" >&2
  echo "Please run '${REPO_ROOT}/scripts/install-kokoro-model.sh' to complete installation." >&2
  exit 1
fi

RECORDED_MODEL_ID="$(grep '"modelId"' "${MANIFEST_FILE}" | head -n 1 | sed -E 's/.*"modelId": *"([^"]+)".*/\1/' || true)"
if [[ -z "${RECORDED_MODEL_ID}" || "${RECORDED_MODEL_ID}" != "${KOKORO_MODEL_ID}" ]]; then
  echo "Error: Kokoro model ID mismatch!" >&2
  echo "Expected model ID: ${KOKORO_MODEL_ID}" >&2
  echo "Installed model ID: ${RECORDED_MODEL_ID:-none}" >&2
  echo "Please run '${REPO_ROOT}/scripts/install-kokoro-model.sh' to align your model cache." >&2
  exit 1
fi

RECORDED_REVISION="$(grep '"revision"' "${MANIFEST_FILE}" | head -n 1 | sed -E 's/.*"revision": *"([^"]+)".*/\1/' || true)"
if [[ -z "${RECORDED_REVISION}" || "${RECORDED_REVISION}" != "${KOKORO_MODEL_REVISION}" ]]; then
  echo "Error: Kokoro model revision mismatch!" >&2
  echo "Expected revision: ${KOKORO_MODEL_REVISION}" >&2
  echo "Installed revision: ${RECORDED_REVISION:-none}" >&2
  echo "Please run '${REPO_ROOT}/scripts/install-kokoro-model.sh' to align your model cache." >&2
  exit 1
fi

RECORDED_SHA256="$(grep '"sha256"' "${MANIFEST_FILE}" | head -n 1 | sed -E 's/.*"sha256": *"([^"]+)".*/\1/' || true)"
if [[ -z "${RECORDED_SHA256}" || "${RECORDED_SHA256}" != "${KOKORO_ONNX_QUANTIZED_SHA256}" ]]; then
  echo "Error: Kokoro model manifest SHA-256 mismatch!" >&2
  echo "Expected: ${KOKORO_ONNX_QUANTIZED_SHA256}" >&2
  echo "Installed: ${RECORDED_SHA256:-none}" >&2
  echo "Please run '${REPO_ROOT}/scripts/install-kokoro-model.sh' to align your model cache." >&2
  exit 1
fi

RECORDED_CONFIG_SHA256="$(grep '"configSha256"' "${MANIFEST_FILE}" | head -n 1 | sed -E 's/.*"configSha256": *"([^"]+)".*/\1/' || true)"
if [[ -z "${RECORDED_CONFIG_SHA256}" || "${RECORDED_CONFIG_SHA256}" != "${KOKORO_CONFIG_SHA256}" ]]; then
  echo "Error: Kokoro model manifest config SHA-256 mismatch!" >&2
  echo "Expected: ${KOKORO_CONFIG_SHA256}" >&2
  echo "Installed: ${RECORDED_CONFIG_SHA256:-none}" >&2
  echo "Please run '${REPO_ROOT}/scripts/install-kokoro-model.sh' to align your model cache." >&2
  exit 1
fi

RECORDED_TOKENIZER_SHA256="$(grep '"tokenizerSha256"' "${MANIFEST_FILE}" | head -n 1 | sed -E 's/.*"tokenizerSha256": *"([^"]+)".*/\1/' || true)"
if [[ -z "${RECORDED_TOKENIZER_SHA256}" || "${RECORDED_TOKENIZER_SHA256}" != "${KOKORO_TOKENIZER_SHA256}" ]]; then
  echo "Error: Kokoro model manifest tokenizer SHA-256 mismatch!" >&2
  echo "Expected: ${KOKORO_TOKENIZER_SHA256}" >&2
  echo "Installed: ${RECORDED_TOKENIZER_SHA256:-none}" >&2
  echo "Please run '${REPO_ROOT}/scripts/install-kokoro-model.sh' to align your model cache." >&2
  exit 1
fi

RECORDED_TOKENIZER_CONFIG_SHA256="$(grep '"tokenizerConfigSha256"' "${MANIFEST_FILE}" | head -n 1 | sed -E 's/.*"tokenizerConfigSha256": *"([^"]+)".*/\1/' || true)"
if [[ -z "${RECORDED_TOKENIZER_CONFIG_SHA256}" || "${RECORDED_TOKENIZER_CONFIG_SHA256}" != "${KOKORO_TOKENIZER_CONFIG_SHA256}" ]]; then
  echo "Error: Kokoro model manifest tokenizer_config SHA-256 mismatch!" >&2
  echo "Expected: ${KOKORO_TOKENIZER_CONFIG_SHA256}" >&2
  echo "Installed: ${RECORDED_TOKENIZER_CONFIG_SHA256:-none}" >&2
  echo "Please run '${REPO_ROOT}/scripts/install-kokoro-model.sh' to align your model cache." >&2
  exit 1
fi

RECORDED_VOICE_SHA256="$(grep -A 5 '"voices"' "${MANIFEST_FILE}" | grep '"af_heart"' | head -n 1 | sed -E 's/.*"af_heart": *"([^"]+)".*/\1/' || true)"
if [[ -z "${RECORDED_VOICE_SHA256}" || "${RECORDED_VOICE_SHA256}" != "${KOKORO_VOICE_AF_HEART_SHA256}" ]]; then
  echo "Error: Kokoro model manifest voice SHA-256 mismatch for af_heart!" >&2
  echo "Expected: ${KOKORO_VOICE_AF_HEART_SHA256}" >&2
  echo "Installed: ${RECORDED_VOICE_SHA256:-none}" >&2
  echo "Please run '${REPO_ROOT}/scripts/install-kokoro-model.sh' to align your model cache." >&2
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

ACTUAL_CONFIG_SHA256="$(compute_sha256 "${TARGET_DIR}/config.json")"
if [[ "${ACTUAL_CONFIG_SHA256}" != "${KOKORO_CONFIG_SHA256}" ]]; then
  echo "Error: Kokoro config.json SHA-256 checksum mismatch!" >&2
  echo "Expected: ${KOKORO_CONFIG_SHA256}" >&2
  echo "Actual:   ${ACTUAL_CONFIG_SHA256}" >&2
  echo "Please run '${REPO_ROOT}/scripts/install-kokoro-model.sh' to align your model cache." >&2
  exit 1
fi

ACTUAL_TOKENIZER_SHA256="$(compute_sha256 "${TARGET_DIR}/tokenizer.json")"
if [[ "${ACTUAL_TOKENIZER_SHA256}" != "${KOKORO_TOKENIZER_SHA256}" ]]; then
  echo "Error: Kokoro tokenizer.json SHA-256 checksum mismatch!" >&2
  echo "Expected: ${KOKORO_TOKENIZER_SHA256}" >&2
  echo "Actual:   ${ACTUAL_TOKENIZER_SHA256}" >&2
  echo "Please run '${REPO_ROOT}/scripts/install-kokoro-model.sh' to align your model cache." >&2
  exit 1
fi

ACTUAL_TOKENIZER_CONFIG_SHA256="$(compute_sha256 "${TARGET_DIR}/tokenizer_config.json")"
if [[ "${ACTUAL_TOKENIZER_CONFIG_SHA256}" != "${KOKORO_TOKENIZER_CONFIG_SHA256}" ]]; then
  echo "Error: Kokoro tokenizer_config.json SHA-256 checksum mismatch!" >&2
  echo "Expected: ${KOKORO_TOKENIZER_CONFIG_SHA256}" >&2
  echo "Actual:   ${ACTUAL_TOKENIZER_CONFIG_SHA256}" >&2
  echo "Please run '${REPO_ROOT}/scripts/install-kokoro-model.sh' to align your model cache." >&2
  exit 1
fi

ACTUAL_SHA256="$(compute_sha256 "${MODEL_FILE}")"
if [[ "${ACTUAL_SHA256}" != "${KOKORO_ONNX_QUANTIZED_SHA256}" ]]; then
  echo "Error: Kokoro model SHA-256 checksum mismatch!" >&2
  echo "Expected: ${KOKORO_ONNX_QUANTIZED_SHA256}" >&2
  echo "Actual:   ${ACTUAL_SHA256}" >&2
  echo "Please run '${REPO_ROOT}/scripts/install-kokoro-model.sh' to align your model cache." >&2
  exit 1
fi

ACTUAL_VOICE_SHA256="$(compute_sha256 "${VOICE_FILE}")"
if [[ "${ACTUAL_VOICE_SHA256}" != "${KOKORO_VOICE_AF_HEART_SHA256}" ]]; then
  echo "Error: Kokoro voice af_heart SHA-256 checksum mismatch!" >&2
  echo "Expected: ${KOKORO_VOICE_AF_HEART_SHA256}" >&2
  echo "Actual:   ${ACTUAL_VOICE_SHA256}" >&2
  echo "Please run '${REPO_ROOT}/scripts/install-kokoro-model.sh' to align your model cache." >&2
  exit 1
fi

if [[ -n "${KOKORO_ONNX_QUANTIZED_MD5:-}" ]]; then
  if command -v md5sum >/dev/null 2>&1; then
    ACTUAL_MD5="$(md5sum "${MODEL_FILE}" | awk '{print $1}')"
  elif command -v md5 >/dev/null 2>&1; then
    ACTUAL_MD5="$(md5 -q "${MODEL_FILE}")"
  else
    ACTUAL_MD5=""
  fi

  if [[ -n "${ACTUAL_MD5}" && "${ACTUAL_MD5}" != "${KOKORO_ONNX_QUANTIZED_MD5}" ]]; then
    echo "Error: Kokoro model MD5 checksum mismatch!" >&2
    echo "Expected: ${KOKORO_ONNX_QUANTIZED_MD5}" >&2
    echo "Actual:   ${ACTUAL_MD5}" >&2
    echo "Please run '${REPO_ROOT}/scripts/install-kokoro-model.sh' to align your model cache." >&2
    exit 1
  fi
fi

echo "Kokoro model check passed: ${KOKORO_MODEL_ID} @ ${KOKORO_MODEL_REVISION} (model: ${ACTUAL_SHA256}, af_heart: ${ACTUAL_VOICE_SHA256}, config: ${ACTUAL_CONFIG_SHA256}, tokenizer: ${ACTUAL_TOKENIZER_SHA256})"
