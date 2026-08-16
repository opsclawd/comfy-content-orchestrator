# Implementation Log - Task 2: Implement hybrid custom-node candidate filtering

## Overview
Implemented hybrid filtering in `packages/infrastructure/src/comfyui/provenance/git-tracker.ts` to exclude non-node directory entries (hidden directories, dunder-prefixed directories, and non-git directories lacking a Python package `__init__.py` file).

## Changes Made
- Added `hasPythonPackageEntryPoint(nodePath: string): Promise<boolean>` helper to check whether `__init__.py` exists and is a regular file.
- Updated the directory entries filter to exclude names starting with `.` or `__`.
- Gated the `not_git` fallback branch in `collectGitProvenance` so only directories with a regular `__init__.py` are recorded as `not_git`, while others are skipped.

## Verification
- Ran vitest on `packages/infrastructure/src/comfyui/provenance/git-tracker.test.ts`: all 8 tests passed.
- Ran eslint and prettier checks on `packages/infrastructure/src/comfyui/provenance/git-tracker.ts` and `git-tracker.test.ts`: passed cleanly.
- Ran workspace-wide `pnpm -r typecheck`: passed with no errors.
- Ran full test suite across workspace (`pnpm test`): 239 passed across 35 test files.
