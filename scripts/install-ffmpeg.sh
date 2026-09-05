#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "${SCRIPT_DIR}/.." && pwd)"

VERSION_FILE="${REPO_ROOT}/.ffmpeg-version"

if [[ ! -f "${VERSION_FILE}" ]]; then
  echo "Error: .ffmpeg-version file not found at ${VERSION_FILE}" >&2
  exit 1
fi

source "${VERSION_FILE}"

if [[ -z "${FFMPEG_VERSION:-}" || -z "${FFMPEG_DOWNLOAD_URL:-}" ]]; then
  echo "Error: .ffmpeg-version must define FFMPEG_VERSION and FFMPEG_DOWNLOAD_URL" >&2
  exit 1
fi

TMP_DIR="$(mktemp -d)"
trap 'rm -rf "${TMP_DIR}"' EXIT

echo "Downloading FFmpeg ${FFMPEG_VERSION} static build from ${FFMPEG_DOWNLOAD_URL}..."
TARBALL="${TMP_DIR}/ffmpeg-static.tar.xz"

if command -v curl >/dev/null 2>&1; then
  curl -fsSL --retry 3 --retry-all-errors -A "Mozilla/5.0 (X11; Linux x86_64)" "${FFMPEG_DOWNLOAD_URL}" -o "${TARBALL}"
elif command -v wget >/dev/null 2>&1; then
  wget -qO "${TARBALL}" --user-agent="Mozilla/5.0 (X11; Linux x86_64)" "${FFMPEG_DOWNLOAD_URL}"
else
  echo "Error: neither curl nor wget found." >&2
  exit 1
fi

if [[ -n "${FFMPEG_ARCHIVE_MD5:-}" ]]; then
  echo "Verifying MD5 checksum of downloaded archive..."
  if command -v md5sum >/dev/null 2>&1; then
    ACTUAL_MD5="$(md5sum "${TARBALL}" | awk '{print $1}')"
  elif command -v md5 >/dev/null 2>&1; then
    ACTUAL_MD5="$(md5 -q "${TARBALL}")"
  else
    ACTUAL_MD5=""
  fi

  if [[ -n "${ACTUAL_MD5}" && "${ACTUAL_MD5}" != "${FFMPEG_ARCHIVE_MD5}" ]]; then
    echo "Error: MD5 checksum mismatch for downloaded FFmpeg archive!" >&2
    echo "Expected: ${FFMPEG_ARCHIVE_MD5}" >&2
    echo "Actual:   ${ACTUAL_MD5}" >&2
    exit 1
  fi
  echo "MD5 checksum verified."
fi

echo "Extracting FFmpeg binaries..."
tar -xf "${TARBALL}" -C "${TMP_DIR}"

FFMPEG_BIN="$(find "${TMP_DIR}" -type f -name ffmpeg | head -n 1)"
FFPROBE_BIN="$(find "${TMP_DIR}" -type f -name ffprobe | head -n 1)"

if [[ -z "${FFMPEG_BIN}" || -z "${FFPROBE_BIN}" ]]; then
  echo "Error: ffmpeg or ffprobe binary not found in extracted archive." >&2
  exit 1
fi

USE_SUDO=""

if [[ -n "${FFMPEG_INSTALL_DIR:-}" ]]; then
  # Explicit override (e.g. a CI cache directory) — always user-writable,
  # never needs sudo.
  INSTALL_DIR="${FFMPEG_INSTALL_DIR}"
  mkdir -p "${INSTALL_DIR}"
elif [[ $EUID -eq 0 ]]; then
  INSTALL_DIR="/usr/local/bin"
elif [[ -w "/usr/local/bin" ]]; then
  INSTALL_DIR="/usr/local/bin"
elif command -v sudo >/dev/null 2>&1 && sudo -n true 2>/dev/null; then
  INSTALL_DIR="/usr/local/bin"
  USE_SUDO="sudo"
elif command -v sudo >/dev/null 2>&1 && [ -t 0 ]; then
  INSTALL_DIR="/usr/local/bin"
  USE_SUDO="sudo"
else
  INSTALL_DIR="${HOME}/.local/bin"
  mkdir -p "${INSTALL_DIR}"
fi

echo "Installing ffmpeg and ffprobe into ${INSTALL_DIR}..."
if [[ -n "${USE_SUDO}" ]]; then
  sudo cp "${FFMPEG_BIN}" "${FFPROBE_BIN}" "${INSTALL_DIR}/"
  sudo chmod +x "${INSTALL_DIR}/ffmpeg" "${INSTALL_DIR}/ffprobe"
else
  cp "${FFMPEG_BIN}" "${FFPROBE_BIN}" "${INSTALL_DIR}/"
  chmod +x "${INSTALL_DIR}/ffmpeg" "${INSTALL_DIR}/ffprobe"
fi

if [[ -n "${GITHUB_PATH:-}" && -f "${GITHUB_PATH}" ]]; then
  echo "${INSTALL_DIR}" >> "${GITHUB_PATH}"
fi

echo "FFmpeg ${FFMPEG_VERSION} successfully installed to ${INSTALL_DIR}."
