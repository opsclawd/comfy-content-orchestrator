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

MAIN_REPO=""
if [[ -f "${REPO_ROOT}/.git" ]]; then
  GITDIR="$(sed -n 's/^gitdir: //p' "${REPO_ROOT}/.git" | head -n 1 || true)"
  if [[ -n "${GITDIR}" && -d "${GITDIR}" ]]; then
    MAIN_GIT_DIR="$(cd "${GITDIR}/../.." && pwd)"
    MAIN_REPO="$(cd "${MAIN_GIT_DIR}/.." && pwd)"
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

TARGET_VENV_DIR="${REPO_ROOT}/${WHISPERX_VENV_DIR}"
TARGET_MODEL_DIR="${REPO_ROOT}/${WHISPERX_MODEL_DIR}"
MODEL_FILE="${TARGET_MODEL_DIR}/${WHISPERX_ALIGNMENT_MODEL_FILE}"

echo "Installing WhisperX environment (${WHISPERX_PIP_VERSION}, torchaudio: ${WHISPERX_TORCHAUDIO_VERSION})..."
echo "Target venv: ${TARGET_VENV_DIR}"
echo "Target model dir: ${TARGET_MODEL_DIR}"
echo "Shared cache dir: ${SHARED_CACHE_DIR}"

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
  # Check if model can be seeded from shared cache, main repo, or .ai-tmp
  SHARED_MODEL_FILE="${SHARED_CACHE_DIR}/whisperx-model/${WHISPERX_ALIGNMENT_MODEL_FILE}"
  MAIN_MODEL_FILE="${MAIN_REPO}/node_modules/.cache/whisperx-model/${WHISPERX_ALIGNMENT_MODEL_FILE}"
  SEED_CANDIDATE=""
  if [[ -f "${SHARED_MODEL_FILE}" ]]; then
    SEED_CANDIDATE="${SHARED_MODEL_FILE}"
  elif [[ -f "${MAIN_MODEL_FILE}" ]]; then
    SEED_CANDIDATE="${MAIN_MODEL_FILE}"
  elif [[ -f "${REPO_ROOT}/.ai-tmp/${WHISPERX_ALIGNMENT_MODEL_FILE}" ]]; then
    SEED_CANDIDATE="${REPO_ROOT}/.ai-tmp/${WHISPERX_ALIGNMENT_MODEL_FILE}"
  fi

  if [[ -n "${SEED_CANDIDATE}" ]]; then
    TMP_SHA256="$(compute_sha256 "${SEED_CANDIDATE}")"
    if [[ "${TMP_SHA256}" == "${WHISPERX_ALIGNMENT_MODEL_SHA256}" ]]; then
      echo "Seeding verified alignment model weights from ${SEED_CANDIDATE}..."
      ln -f "${SEED_CANDIDATE}" "${MODEL_FILE}" 2>/dev/null || cp "${SEED_CANDIDATE}" "${MODEL_FILE}"
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

# Sync to shared cache if running in worktree or outside shared cache
if [[ "${TARGET_MODEL_DIR}" != "${SHARED_CACHE_DIR}/whisperx-model" ]]; then
  mkdir -p "${SHARED_CACHE_DIR}/whisperx-model"
  ln -f "${MODEL_FILE}" "${SHARED_CACHE_DIR}/whisperx-model/${WHISPERX_ALIGNMENT_MODEL_FILE}" 2>/dev/null || cp -f "${MODEL_FILE}" "${SHARED_CACHE_DIR}/whisperx-model/${WHISPERX_ALIGNMENT_MODEL_FILE}"
  cp -f "${MANIFEST_FILE}" "${SHARED_CACHE_DIR}/whisperx-model/model_manifest.json"
fi

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

PIP_CACHE_DIR="${PIP_CACHE_DIR:-${SHARED_CACHE_DIR}/pip}"
mkdir -p "${PIP_CACHE_DIR}"

TMPDIR="${TMPDIR:-${SHARED_CACHE_DIR}/tmp}"
mkdir -p "${TMPDIR}"
export TMPDIR

# If ~/.cache/pip exists and PIP_CACHE_DIR is empty, seed hardlinks from ~/.cache/pip
if [[ -d "${HOME}/.cache/pip" && "${PIP_CACHE_DIR}" != "${HOME}/.cache/pip" ]]; then
  if [[ -z "$(ls -A "${PIP_CACHE_DIR}" 2>/dev/null)" ]]; then
    echo "Seeding pip cache from ${HOME}/.cache/pip..."
    cp -al "${HOME}/.cache/pip/." "${PIP_CACHE_DIR}/" 2>/dev/null || true
  fi
fi

echo "Upgrading pip and installing whisperx==${WHISPERX_PIP_VERSION} torchaudio==${WHISPERX_TORCHAUDIO_VERSION} matplotlib==${WHISPERX_MATPLOTLIB_VERSION}..."
"${PIP_BIN}" install --cache-dir "${PIP_CACHE_DIR}" --upgrade pip
"${PIP_BIN}" install --cache-dir "${PIP_CACHE_DIR}" "whisperx==${WHISPERX_PIP_VERSION}" "torchaudio==${WHISPERX_TORCHAUDIO_VERSION}" "matplotlib==${WHISPERX_MATPLOTLIB_VERSION}"

# Clear executable stack flag from ctranslate2 shared libraries if present to prevent
# "cannot enable executable stack as shared object requires: Invalid argument" on strict kernels
"${PYTHON_BIN}" -c "
import glob, os, struct, sys

venv_dir = sys.argv[1]
pattern = os.path.join(venv_dir, 'lib', '*', 'site-packages', 'ctranslate2.libs', 'libctranslate2*.so*')
so_files = glob.glob(pattern)

if not so_files:
    raise FileNotFoundError(f'No ctranslate2 shared libraries found matching {pattern}')

for so_file in so_files:
    found_gnu_stack = False
    file_size = os.path.getsize(so_file)
    if file_size < 64:
        raise ValueError(f'File too small to be a valid ELF binary: {so_file} ({file_size} bytes)')
    with open(so_file, 'r+b') as f:
        magic = f.read(4)
        if magic != b'\x7fELF':
            raise ValueError(f'Invalid ELF magic in {so_file}: {magic!r}')
        ei_class = f.read(1)[0]
        ei_data = f.read(1)[0]
        if ei_data == 1:
            endian = '<'
        elif ei_data == 2:
            endian = '>'
        else:
            raise ValueError(f'Invalid ELF endianness in {so_file}: {ei_data}')

        if ei_class == 2:
            f.seek(32)
            e_phoff = struct.unpack(endian + 'Q', f.read(8))[0]
            f.seek(54)
            e_phentsize = struct.unpack(endian + 'H', f.read(2))[0]
            e_phnum = struct.unpack(endian + 'H', f.read(2))[0]
            flags_offset_in_ph = 4
        elif ei_class == 1:
            f.seek(28)
            e_phoff = struct.unpack(endian + 'I', f.read(4))[0]
            f.seek(42)
            e_phentsize = struct.unpack(endian + 'H', f.read(2))[0]
            e_phnum = struct.unpack(endian + 'H', f.read(2))[0]
            flags_offset_in_ph = 24
        else:
            raise ValueError(f'Invalid ELF class in {so_file}: {ei_class}')

        if e_phoff + e_phnum * e_phentsize > file_size:
            raise ValueError(f'Program header table exceeds file bounds in {so_file}')

        for i in range(e_phnum):
            ph_start = e_phoff + i * e_phentsize
            f.seek(ph_start)
            p_type = struct.unpack(endian + 'I', f.read(4))[0]
            if p_type == 0x6474e551: # PT_GNU_STACK
                found_gnu_stack = True
                f.seek(ph_start + flags_offset_in_ph)
                p_flags = struct.unpack(endian + 'I', f.read(4))[0]
                if p_flags & 1:
                    f.seek(ph_start + flags_offset_in_ph)
                    f.write(struct.pack(endian + 'I', p_flags & ~1))
                    f.flush()
                # Postcondition check: verify executable stack flag was cleared
                f.seek(ph_start + flags_offset_in_ph)
                verified_flags = struct.unpack(endian + 'I', f.read(4))[0]
                if verified_flags & 1:
                    raise RuntimeError(f'Failed to clear executable stack flag on {so_file}')

    if not found_gnu_stack:
        raise RuntimeError(f'No PT_GNU_STACK program header found in {so_file}')
" "${TARGET_VENV_DIR}"

# Verify Python virtualenv imports WhisperX and dependencies
"${PYTHON_BIN}" -c "import whisperx; import torchaudio; import matplotlib"

echo "WhisperX installation and model verification complete."

