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

if [[ -z "${FFMPEG_VERSION:-}" ]]; then
  echo "Error: .ffmpeg-version must define FFMPEG_VERSION" >&2
  exit 1
fi

if ! command -v ffmpeg >/dev/null 2>&1; then
  echo "Error: ffmpeg binary is not installed or not in PATH." >&2
  echo "Please run '${REPO_ROOT}/scripts/install-ffmpeg.sh' to install the pinned FFmpeg version." >&2
  exit 1
fi

INSTALLED_VERSION_OUTPUT="$(ffmpeg -version | head -n 1)"

if [[ "${INSTALLED_VERSION_OUTPUT}" != *"${FFMPEG_VERSION}"* ]]; then
  echo "Error: FFmpeg version mismatch!" >&2
  echo "Expected version matching: ${FFMPEG_VERSION}" >&2
  echo "Installed version: ${INSTALLED_VERSION_OUTPUT}" >&2
  echo "Please run '${REPO_ROOT}/scripts/install-ffmpeg.sh' to align your local environment." >&2
  exit 1
fi

echo "FFmpeg version check passed: ${INSTALLED_VERSION_OUTPUT}"
