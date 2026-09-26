#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "${SCRIPT_DIR}/.." && pwd)"

VERSION_FILE="${REPO_ROOT}/.comfyui-version"

if [[ ! -f "${VERSION_FILE}" ]]; then
  echo "Error: .comfyui-version file not found at ${VERSION_FILE}" >&2
  exit 1
fi

source "${VERSION_FILE}"

TARGET_REVISION="${COMFYUI_REVISION:-${COMFYUI_CORE_REVISION:-${COMFYUI_VERSION:-}}}"
if [[ -z "${TARGET_REVISION}" ]]; then
  echo "Error: .comfyui-version must define COMFYUI_REVISION, COMFYUI_CORE_REVISION, or COMFYUI_VERSION" >&2
  exit 1
fi

QUICK_MODE=false
CUSTOM_COMFY_DIR=""

while [[ $# -gt 0 ]]; do
  case "$1" in
    --quick)
      QUICK_MODE=true
      shift
      ;;
    --comfy-dir)
      CUSTOM_COMFY_DIR="$2"
      shift 2
      ;;
    -h|--help)
      echo "Usage: $0 [--quick] [--comfy-dir <path>]"
      exit 0
      ;;
    *)
      echo "Unknown option: $1" >&2
      exit 1
      ;;
  esac
done

RESOLVED_COMFY_DIR=""
if [[ -n "${CUSTOM_COMFY_DIR}" ]]; then
  RESOLVED_COMFY_DIR="${CUSTOM_COMFY_DIR}"
elif [[ -n "${COMFYUI_DIR:-}" ]]; then
  RESOLVED_COMFY_DIR="${COMFYUI_DIR}"
elif [[ -d "${REPO_ROOT}/ComfyUI" ]]; then
  RESOLVED_COMFY_DIR="${REPO_ROOT}/ComfyUI"
elif [[ -d "${REPO_ROOT}/../ComfyUI" ]]; then
  RESOLVED_COMFY_DIR="${REPO_ROOT}/../ComfyUI"
fi

if [[ -z "${RESOLVED_COMFY_DIR}" ]]; then
  echo "Error: ComfyUI core directory must be provided via --comfy-dir or COMFYUI_DIR" >&2
  exit 1
fi

if [[ ! -d "${RESOLVED_COMFY_DIR}" ]]; then
  echo "Error: ComfyUI directory not found at ${RESOLVED_COMFY_DIR}" >&2
  exit 1
fi

if [[ ! -d "${RESOLVED_COMFY_DIR}/.git" ]]; then
  echo "Error: ComfyUI directory at ${RESOLVED_COMFY_DIR} is not a git repository" >&2
  exit 1
fi

ACTUAL_COMFY_REV="$(git -C "${RESOLVED_COMFY_DIR}" rev-parse --verify HEAD 2>/dev/null || true)"
if [[ -z "${ACTUAL_COMFY_REV}" ]]; then
  echo "Error: Failed to read Git commit in ComfyUI directory: ${RESOLVED_COMFY_DIR}" >&2
  exit 1
fi

if [[ "${ACTUAL_COMFY_REV}" != "${TARGET_REVISION}" ]]; then
  echo "Error: ComfyUI core revision mismatch at ${RESOLVED_COMFY_DIR}!" >&2
  echo "Expected: ${TARGET_REVISION}" >&2
  echo "Actual:   ${ACTUAL_COMFY_REV}" >&2
  exit 1
fi

if [[ ! -f "${RESOLVED_COMFY_DIR}/comfy_extras/nodes_minimax_h3.py" ]]; then
  echo "Error: comfy_extras/nodes_minimax_h3.py missing in ComfyUI directory: ${RESOLVED_COMFY_DIR}" >&2
  exit 1
fi

echo "ComfyUI core verification passed (revision: ${ACTUAL_COMFY_REV}, directory: ${RESOLVED_COMFY_DIR})"
