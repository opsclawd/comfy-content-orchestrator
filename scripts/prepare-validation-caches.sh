#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "${SCRIPT_DIR}/.." && pwd)"

# 1. Resolve main repo root (escapes git worktrees if we are inside one)
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

# 2. Resolve persistent shared cache and pip cache directories
SHARED_CACHE_DIR="${CCO_SHARED_CACHE_DIR:-${MAIN_REPO}/.ai-cache}"
mkdir -p "${SHARED_CACHE_DIR}/kokoro-model" \
         "${SHARED_CACHE_DIR}/piper-voice" \
         "${SHARED_CACHE_DIR}/whisperx-model" \
         "${SHARED_CACHE_DIR}/pip" \
         "${SHARED_CACHE_DIR}/tmp"

export PIP_CACHE_DIR="${PIP_CACHE_DIR:-${SHARED_CACHE_DIR}/pip}"
export TMPDIR="${TMPDIR:-${SHARED_CACHE_DIR}/tmp}"

# Seed PIP_CACHE_DIR from ~/.cache/pip if PIP_CACHE_DIR is currently empty
if [[ -n "${HOME:-}" && -d "${HOME}/.cache/pip" && "${PIP_CACHE_DIR}" != "${HOME}/.cache/pip" ]]; then
  if [[ -z "$(ls -A "${PIP_CACHE_DIR}" 2>/dev/null)" ]]; then
    echo "Seeding shared pip cache from ${HOME}/.cache/pip via hardlinks..."
    cp -al "${HOME}/.cache/pip/." "${PIP_CACHE_DIR}/" 2>/dev/null || true
  fi
fi

# Helper: link or copy directory contents recursively
link_or_copy_dir() {
  local src_dir="$1"
  local dst_dir="$2"
  if [[ ! -d "${src_dir}" ]]; then
    return 0
  fi
  mkdir -p "${dst_dir}"
  (
    cd "${src_dir}"
    find . -type f | while IFS= read -r rel_file; do
      local clean_rel="${rel_file#./}"
      local dst_file="${dst_dir}/${clean_rel}"
      local src_file="${src_dir}/${clean_rel}"
      mkdir -p "$(dirname "${dst_file}")"
      if [[ ! -f "${dst_file}" ]]; then
        ln -f "${src_file}" "${dst_file}" 2>/dev/null || cp -f "${src_file}" "${dst_file}"
      fi
    done
  )
}

echo "=================================================="
echo "Preparing validation caches in ${REPO_ROOT}"
echo "Shared cache store: ${SHARED_CACHE_DIR}"
echo "=================================================="

# --------------------------------------------------
# 3. Kokoro model preparation
# --------------------------------------------------
TARGET_KOKORO_DIR="${REPO_ROOT}/node_modules/.cache/kokoro-model"
if bash "${REPO_ROOT}/scripts/check-kokoro-version.sh" >/dev/null 2>&1; then
  echo "Kokoro model cache already verified in current worktree."
  # Ensure shared cache is populated
  if [[ "${SHARED_CACHE_DIR}/kokoro-model" != "${TARGET_KOKORO_DIR}" ]]; then
    link_or_copy_dir "${TARGET_KOKORO_DIR}" "${SHARED_CACHE_DIR}/kokoro-model"
  fi
else
  echo "Kokoro cache missing or unverified in current worktree. Searching for existing caches..."
  KOKORO_SOURCE=""
  CANDIDATES=(
    "${SHARED_CACHE_DIR}/kokoro-model"
    "${MAIN_REPO}/node_modules/.cache/kokoro-model"
  )
  if [[ -d "${MAIN_REPO}/.ai-worktrees" ]]; then
    while IFS= read -r found_dir; do
      if [[ -n "${found_dir}" ]]; then
        CANDIDATES+=("${found_dir}")
      fi
    done < <(find "${MAIN_REPO}/.ai-worktrees" -maxdepth 4 -type d -name "kokoro-model" 2>/dev/null || true)
  fi

  for candidate in "${CANDIDATES[@]}"; do
    if [[ -d "${candidate}" && -f "${candidate}/onnx/model_quantized.onnx" && -f "${candidate}/model_manifest.json" ]]; then
      KOKORO_SOURCE="${candidate}"
      break
    fi
  done

  if [[ -n "${KOKORO_SOURCE}" ]]; then
    echo "Seeding Kokoro cache from ${KOKORO_SOURCE}..."
    link_or_copy_dir "${KOKORO_SOURCE}" "${TARGET_KOKORO_DIR}"
  fi

  if ! bash "${REPO_ROOT}/scripts/check-kokoro-version.sh" >/dev/null 2>&1; then
    echo "Running install-kokoro-model.sh..."
    bash "${REPO_ROOT}/scripts/install-kokoro-model.sh"
  fi

  if [[ "${SHARED_CACHE_DIR}/kokoro-model" != "${TARGET_KOKORO_DIR}" ]]; then
    link_or_copy_dir "${TARGET_KOKORO_DIR}" "${SHARED_CACHE_DIR}/kokoro-model"
  fi
  echo "Kokoro model cache ready."
fi

# --------------------------------------------------
# 4. Piper voice preparation
# --------------------------------------------------
TARGET_PIPER_DIR="${REPO_ROOT}/node_modules/.cache/piper-voice"
if bash "${REPO_ROOT}/scripts/check-piper-version.sh" >/dev/null 2>&1; then
  echo "Piper voice cache already verified in current worktree."
  if [[ "${SHARED_CACHE_DIR}/piper-voice" != "${TARGET_PIPER_DIR}" ]]; then
    link_or_copy_dir "${TARGET_PIPER_DIR}" "${SHARED_CACHE_DIR}/piper-voice"
  fi
else
  echo "Piper voice cache missing or unverified in current worktree. Searching for existing caches..."
  PIPER_SOURCE=""
  CANDIDATES=(
    "${SHARED_CACHE_DIR}/piper-voice"
    "${MAIN_REPO}/node_modules/.cache/piper-voice"
  )
  if [[ -d "${MAIN_REPO}/.ai-worktrees" ]]; then
    while IFS= read -r found_dir; do
      if [[ -n "${found_dir}" ]]; then
        CANDIDATES+=("${found_dir}")
      fi
    done < <(find "${MAIN_REPO}/.ai-worktrees" -maxdepth 4 -type d -name "piper-voice" 2>/dev/null || true)
  fi

  for candidate in "${CANDIDATES[@]}"; do
    if [[ -d "${candidate}" && -f "${candidate}/model_manifest.json" ]]; then
      PIPER_SOURCE="${candidate}"
      break
    fi
  done

  if [[ -n "${PIPER_SOURCE}" ]]; then
    echo "Seeding Piper voice cache from ${PIPER_SOURCE}..."
    link_or_copy_dir "${PIPER_SOURCE}" "${TARGET_PIPER_DIR}"
  fi

  if ! bash "${REPO_ROOT}/scripts/check-piper-version.sh" >/dev/null 2>&1; then
    echo "Running install-piper-voice.sh..."
    bash "${REPO_ROOT}/scripts/install-piper-voice.sh"
  fi

  if [[ "${SHARED_CACHE_DIR}/piper-voice" != "${TARGET_PIPER_DIR}" ]]; then
    link_or_copy_dir "${TARGET_PIPER_DIR}" "${SHARED_CACHE_DIR}/piper-voice"
  fi
  echo "Piper voice cache ready."
fi

# --------------------------------------------------
# 5. WhisperX model weights preparation
# --------------------------------------------------
TARGET_WHISPERX_MODEL_DIR="${REPO_ROOT}/node_modules/.cache/whisperx-model"
mkdir -p "${TARGET_WHISPERX_MODEL_DIR}"
MODEL_VERSION_FILE="${REPO_ROOT}/.whisperx-version"
ALIGNMENT_FILE=""
if [[ -f "${MODEL_VERSION_FILE}" ]]; then
  ALIGNMENT_FILE="$(grep 'WHISPERX_ALIGNMENT_MODEL_FILE=' "${MODEL_VERSION_FILE}" | head -n 1 | cut -d= -f2 || true)"
fi
ALIGNMENT_FILE="${ALIGNMENT_FILE:-wav2vec2_fairseq_base_ls960_asr_ls960.pth}"

if [[ -f "${TARGET_WHISPERX_MODEL_DIR}/${ALIGNMENT_FILE}" && -f "${TARGET_WHISPERX_MODEL_DIR}/model_manifest.json" ]]; then
  echo "WhisperX model weights already present in current worktree."
  if [[ "${SHARED_CACHE_DIR}/whisperx-model" != "${TARGET_WHISPERX_MODEL_DIR}" ]]; then
    link_or_copy_dir "${TARGET_WHISPERX_MODEL_DIR}" "${SHARED_CACHE_DIR}/whisperx-model"
  fi
else
  echo "WhisperX model weights missing in current worktree. Searching for existing caches..."
  WHISPERX_SOURCE=""
  CANDIDATES=(
    "${SHARED_CACHE_DIR}/whisperx-model"
    "${MAIN_REPO}/node_modules/.cache/whisperx-model"
  )
  if [[ -d "${MAIN_REPO}/.ai-worktrees" ]]; then
    while IFS= read -r found_dir; do
      if [[ -n "${found_dir}" ]]; then
        CANDIDATES+=("${found_dir}")
      fi
    done < <(find "${MAIN_REPO}/.ai-worktrees" -maxdepth 4 -type d -name "whisperx-model" 2>/dev/null || true)
  fi

  for candidate in "${CANDIDATES[@]}"; do
    if [[ -d "${candidate}" && -f "${candidate}/${ALIGNMENT_FILE}" && -f "${candidate}/model_manifest.json" ]]; then
      WHISPERX_SOURCE="${candidate}"
      break
    fi
  done

  if [[ -n "${WHISPERX_SOURCE}" ]]; then
    echo "Seeding WhisperX model weights from ${WHISPERX_SOURCE}..."
    link_or_copy_dir "${WHISPERX_SOURCE}" "${TARGET_WHISPERX_MODEL_DIR}"
  fi

  if [[ "${SHARED_CACHE_DIR}/whisperx-model" != "${TARGET_WHISPERX_MODEL_DIR}" && -f "${TARGET_WHISPERX_MODEL_DIR}/${ALIGNMENT_FILE}" ]]; then
    link_or_copy_dir "${TARGET_WHISPERX_MODEL_DIR}" "${SHARED_CACHE_DIR}/whisperx-model"
  fi
  echo "WhisperX model weights ready."
fi

# --------------------------------------------------
# 6. WhisperX virtual environment preparation
# --------------------------------------------------
TARGET_WHISPERX_VENV_DIR="${REPO_ROOT}/node_modules/.cache/whisperx-venv"
if bash "${REPO_ROOT}/scripts/check-whisperx-version.sh" >/dev/null 2>&1; then
  echo "WhisperX virtualenv already verified in current worktree."
else
  echo "WhisperX virtualenv missing or unverified in current worktree. Searching for existing environments..."
  VENV_SOURCE=""
  CANDIDATES=(
    "${SHARED_CACHE_DIR}/whisperx-venv"
    "${MAIN_REPO}/node_modules/.cache/whisperx-venv"
  )
  if [[ -d "${MAIN_REPO}/.ai-worktrees" ]]; then
    while IFS= read -r found_dir; do
      if [[ -n "${found_dir}" ]]; then
        CANDIDATES+=("${found_dir}")
      fi
    done < <(find "${MAIN_REPO}/.ai-worktrees" -maxdepth 4 -type d -name "whisperx-venv" 2>/dev/null || true)
  fi

  for candidate in "${CANDIDATES[@]}"; do
    if [[ -d "${candidate}" && -x "${candidate}/bin/python3" && "${candidate}" != "${TARGET_WHISPERX_VENV_DIR}" ]]; then
      if WHISPERX_PYTHON_PATH="${candidate}/bin/python3" bash "${REPO_ROOT}/scripts/check-whisperx-version.sh" >/dev/null 2>&1; then
        VENV_SOURCE="${candidate}"
        break
      fi
    fi
  done

  if [[ -n "${VENV_SOURCE}" ]]; then
    echo "Linking WhisperX virtualenv from ${VENV_SOURCE}..."
    mkdir -p "$(dirname "${TARGET_WHISPERX_VENV_DIR}")"
    ln -sfn "${VENV_SOURCE}" "${TARGET_WHISPERX_VENV_DIR}"
  fi

  if ! bash "${REPO_ROOT}/scripts/check-whisperx-version.sh" >/dev/null 2>&1; then
    echo "WhisperX virtualenv missing or unverified. Building environment..."
    bash "${REPO_ROOT}/scripts/install-whisperx.sh"
  fi
  if [[ "${SHARED_CACHE_DIR}/whisperx-model" != "${TARGET_WHISPERX_MODEL_DIR}" && -d "${TARGET_WHISPERX_MODEL_DIR}" ]]; then
    link_or_copy_dir "${TARGET_WHISPERX_MODEL_DIR}" "${SHARED_CACHE_DIR}/whisperx-model"
  fi
  echo "WhisperX virtualenv ready."
fi

# Final check to guarantee all three subsystem gates pass
echo "Verifying all validation gates pass..."
bash "${REPO_ROOT}/scripts/check-kokoro-version.sh"
bash "${REPO_ROOT}/scripts/check-piper-version.sh"
bash "${REPO_ROOT}/scripts/check-whisperx-version.sh"

echo "All validation caches prepared and verified successfully."
exit 0
