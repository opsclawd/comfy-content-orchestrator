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
