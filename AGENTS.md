# Agent conventions

Repository-specific rules that are not inferable from the code. Read this before planning or implementing.

## FFmpeg Environment Setup

To eliminate version-mismatch bugs between local development and CI, FFmpeg is pinned to a specific static build across all environments:
- Use `./scripts/install-ffmpeg.sh` to download and install the pinned FFmpeg static build (`7.0.2-static` as defined in `.ffmpeg-version`).
- Run `./scripts/check-ffmpeg-version.sh` to verify that your local environment matches the pinned version.

## Kokoro Model Environment Setup

To ensure deterministic speech synthesis across local development and CI, the Kokoro-82M model is pinned in `.kokoro-version`:
- Use `./scripts/install-kokoro-model.sh` to fetch and verify the pinned Kokoro-82M ONNX model weights.
- Run `./scripts/check-kokoro-version.sh` to verify that your local environment has the pinned weights cached and verified.

## WhisperX Model Environment Setup

To ensure deterministic subtitle-cue forced alignment across local development and CI, WhisperX and wav2vec2 alignment dependencies are pinned in `.whisperx-version`:
- Use `./scripts/install-whisperx.sh` to set up the pinned virtual environment (`node_modules/.cache/whisperx-venv`) and model manifest.
- Run `./scripts/check-whisperx-version.sh` to verify that your local environment has the pinned virtualenv and model cache verified.
- The Python path resolution follows: `WHISPERX_PYTHON_PATH` environment variable override -> pinned venv interpreter at `node_modules/.cache/whisperx-venv/bin/python3` -> fail fast with `MODEL_LOAD_FAILED`. A stray host `python3` is never silently used.

## Piper Voice Environment Setup

To ensure deterministic speech synthesis and reproducible container builds across local development and CI, Piper TTS voice models and container definitions are pinned in `.piper-version`:
- Use `./scripts/install-piper-voice.sh` to fetch and verify the pinned Piper voice model ONNX weights and configuration.
- Run `./scripts/check-piper-version.sh` to verify that your local environment has the pinned voice artifacts cached and that `docker/piper/Dockerfile` matches its pinned SHA-256 digest.
- `check-piper-version.sh` performs only static, on-disk artifact verification and intentionally does not start or probe a live Piper HTTP service — service lifecycle and readiness checking belongs to the Testcontainers-managed integration test (`pnpm test:piper`).

## Running tests — two suites, two configs

This repository has **two** vitest configurations, and using the wrong one produces a command that can never pass.

| Suite | Command | Config | Covers |
| --- | --- | --- | --- |
| Unit | `pnpm test` | `vitest.config.ts` | `packages/*/src/**/*.test.ts`, `apps/*/src/**/*.test.ts` |
| Integration | `pnpm test:db` | `vitest.integration.config.ts` | `packages/infrastructure/src/postgres/**/*.integration.test.ts` |

`vitest.config.ts` **excludes** `**/*.integration.test.ts`. Invoking an integration test through the default config therefore fails with `No test files found, exiting with code 1` regardless of whether the code is correct.

```bash
# WRONG — the default config excludes this file, so it exits 1 forever
pnpm vitest run packages/infrastructure/src/postgres/baseline-schema.integration.test.ts

# RIGHT — whole integration suite
pnpm test:db

# RIGHT — single integration file
pnpm vitest run --config vitest.integration.config.ts \
  packages/infrastructure/src/postgres/baseline-schema.integration.test.ts
```

**This applies to task `validation_commands`.** A plan that points a per-task validation command at an `*.integration.test.ts` file without `--config vitest.integration.config.ts` creates an unsatisfiable gate. Run `0c9bfb4b` did exactly that in four of four tasks and burned an implement budget plus a terminal-fixer invocation before escalating; the code had been correct the whole time. See automation#930.

Integration tests use Testcontainers and require Docker. They are slower — roughly 40s for the suite — which is why the validation timeout is 900s.

## Validation commands

`pnpm test:db` is part of the effective validation set. Do not re-declare the commands inherited from the automation repository (`build`, `lint`, `typecheck`, `test`, `test:bash`, `boundaries`) in `.ai-orchestrator.json`; `validation.commands` concatenates across config layers rather than replacing.

### Validation Tiers & Concurrency

Validation commands are organized into 6 strictly ordered tiers in `.ai-orchestrator.json` via `validation.tiers`:
1. **Hygiene**: `["pnpm check:hooks", "pnpm install --frozen-lockfile"]` (parallel)
2. **Format Auto-fix**: `["pnpm format:fix"]` (isolated sequential Prettier write)
3. **Format Check**: `["pnpm format"]` (isolated Prettier verify)
4. **Cache & Build**: `["pnpm preValidation", "pnpm build"]` (parallel cache download/linking and monorepo build)
5. **Fast Deterministic Gates**: `["pnpm lint", "pnpm typecheck", "pnpm test", "pnpm test:bash", "pnpm boundaries", "pnpm check:control-plane"]` (parallel read-only static analysis and unit tests)
6. **Heavy Subsystems**: `["pnpm test:db", "pnpm test:assembly", "pnpm test:kokoro", "pnpm test:piper", "pnpm test:ltx-production", "pnpm test:whisperx"]` (parallel integration suites)

Commands within each tier execute concurrently via `Promise.all`; tiers execute sequentially. The heavy suites in Tier 6 are completely decoupled with zero shared state (isolated temp directories, dynamic Testcontainers host ports, and read-only model caches), cutting wall-clock validation time by ~60%. Whenever a new validation command is added, it must be mapped into `validation.tiers` to maintain complete tier coverage (enforced by `scripts/check-tiers.test.ts`).

## Evidence paths are never agent-authored

`certification/`, `baseline/`, and `config/render-profiles/` are listed in `forbiddenArtifactPaths`. A plan naming any of them as a task's expected output is rejected before implement.

These directories hold measurements of physical hardware. If a task appears to require producing one, the task is wrong: the work belongs to a human or operator agent with access to the render host, and the correct response is to say so rather than to generate a plausible file. A fabricated 43,414-line certification artifact reached review once before this rule existed.

## Architecture

Layer direction is enforced mechanically by `pnpm boundaries` (`.dependency-cruiser.cjs`), not by convention:

```
apps/control-api, apps/render-worker   composition roots
apps/web                               contracts + presentation-safe types
infrastructure                         domain types + application ports
application                            domain, contracts, shared
domain                                 shared
shared                                 nothing
```

Ports live in `packages/application/src/ports/`; their adapters live in `packages/infrastructure/`. Adding a port is application-layer work and does not constitute "adding persistence".
