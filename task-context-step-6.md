# Task Context: Task 6

Title: Add the provenance CLI and package command
## Workspace & Scope Constraints

## WORKSPACE CONSTRAINTS

Your working directory is a dedicated git worktree with the repository's complete history. Run all commands from it. Do NOT cd to or read paths outside this directory — external-directory access is automatically rejected. git log, git diff, etc. work here directly.

.ai-orchestrator.local.json, if one exists, lives only in the main checkout and is intentionally not copied into your worktree — it is operator-machine-specific and not part of your task. Do not search for it or read it outside this directory. Reason about configuration using only .ai-orchestrator.json in your own working directory; treat it as the effective config for your task.

Working Directory: /home/gary/.openclaw/workspace/comfy-content-orchestrator/.ai-worktrees/issue-6
Repository: opsclawd/comfy-content-orchestrator
Branch: ai/issue-6
Start Commit: 6bab63e0967fb48d900dbf1fc191acb5bca5e477

## Task Requirements

**Files:**

- Create: `packages/infrastructure/src/comfyui/provenance/cli.test.ts`
- Create: `packages/infrastructure/src/comfyui/provenance/cli.ts`
- Modify: `packages/infrastructure/package.json` (`scripts` only)
- Reference only: `packages/infrastructure/src/comfyui/provenance/profile-manifest.ts`
- Reference only: `packages/infrastructure/src/comfyui/provenance/collector.ts`

**CLI contract:**

```text
pnpm --filter @cco/infrastructure provenance -- \
  --comfyui-dir "$COMFYUI_DIR" \
  --profile ltx-25-720p-97f \
  --manifest ../../templates/provenance.json
```

`--comfyui-dir` and `--profile` are required. `--manifest` is optional and defaults, via an `import.meta.url`-relative URL, to the repository's `templates/provenance.json`; the explicit form above documents execution from the infrastructure package script's working directory. `--help` prints usage to stdout and performs no filesystem/Git work. Unknown, duplicate, or value-less flags are errors.

**Exported API shape:**

```ts
export interface ProvenanceCliOptions {
  readonly comfyUiDir: string;
  readonly profileId: string;
  readonly manifestPath: string;
}

export interface ProvenanceCliDependencies {
  readonly loadCertificationProfile?: typeof loadCertificationProfile;
  readonly collectCertificationProvenance?: typeof collectCertificationProvenance;
}

export function parseCliArgs(argv: readonly string[]):
  | Readonly<{ kind: "help" }>
  | Readonly<{ kind: "run"; options: ProvenanceCliOptions }>;

export async function runCli(
  argv: readonly string[],
  io?: Readonly<{ stdout: (line: string) => void; stderr: (line: string) => void }>,
  dependencies?: ProvenanceCliDependencies
): Promise<number>;
```

The module entrypoint assigns the returned status to `process.exitCode`; it must not call `process.exit`. Progress callbacks become concise stderr lines. On success, call stdout once with `JSON.stringify(report)` and return 0. On any validation or collection failure, write one actionable stderr error, emit no stdout report, and return 1. Add `"provenance": "tsx src/comfyui/provenance/cli.ts"` under infrastructure scripts.

**Behavioral invariants and named tests:**

- `CLI requires comfyui-dir and profile and rejects unknown flags` — invalid invocation returns 1 without loading a manifest.
- `CLI help has no provenance side effects` — usage is printed and injected loaders/collectors are untouched.
- `CLI writes progress only to stderr and one JSON report to stdout` — successful machine output remains pipe-safe.
- `CLI returns failure without partial JSON when preflight or collection fails` — stderr includes the stable error message and stdout remains empty.
- `CLI forwards the selected profile and configured ComfyUI path` — no developer home path is hard-coded.
- `infrastructure provenance script exposes the TypeScript entrypoint` — package metadata points to the exact source file.

- [ ] **Step 1: Write the failing CLI tests.** Inject manifest/collector functions and stdout/stderr sinks. Include one successful report and one `DiskPreflightError` case.
- [ ] **Step 2: Verify the focused test fails.**

Run: `pnpm exec vitest run packages/infrastructure/src/comfyui/provenance/cli.test.ts`

Expected: FAIL because the CLI and package script do not exist.

- [ ] **Step 3: Implement parsing, output routing, entrypoint detection, and the package script.** Detect direct ESM execution with `process.argv[1]` plus `pathToFileURL`; importing the module from tests must not run it.
- [ ] **Step 4: Verify task acceptance.**

Run: `pnpm exec vitest run packages/infrastructure/src/comfyui/provenance/cli.test.ts`

Expected: PASS with all six named behaviors.

Run: `pnpm --filter @cco/infrastructure provenance -- --help`

Expected: PASS, displaying the three supported flags without touching ComfyUI.

Run: `pnpm exec eslint packages/infrastructure/src/comfyui/provenance/cli.ts packages/infrastructure/src/comfyui/provenance/cli.test.ts`

Expected: PASS with no lint errors.

Run: `pnpm exec prettier --check packages/infrastructure/src/comfyui/provenance/cli.ts packages/infrastructure/src/comfyui/provenance/cli.test.ts packages/infrastructure/package.json`

Expected: PASS with all three files formatted.

- [ ] **Step 5: Commit the CLI.**

```bash
git add packages/infrastructure/src/comfyui/provenance/cli.ts packages/infrastructure/src/comfyui/provenance/cli.test.ts packages/infrastructure/package.json
git commit -m "feat(infrastructure): add provenance certification CLI"
```

## Repository Targets

### Expected Files
- packages/infrastructure/src/comfyui/provenance/cli.test.ts
- packages/infrastructure/src/comfyui/provenance/cli.ts
- packages/infrastructure/package.json

### Reference Files
- packages/infrastructure/src/comfyui/provenance/profile-manifest.ts
- packages/infrastructure/src/comfyui/provenance/collector.ts

## Validation Commands

```bash
["pnpm","exec","vitest","run","packages/infrastructure/src/comfyui/provenance/cli.test.ts"]
["pnpm","--filter","@cco/infrastructure","provenance","--","--help"]
["pnpm","exec","eslint","packages/infrastructure/src/comfyui/provenance/cli.ts","packages/infrastructure/src/comfyui/provenance/cli.test.ts"]
["pnpm","exec","prettier","--check","packages/infrastructure/src/comfyui/provenance/cli.ts","packages/infrastructure/src/comfyui/provenance/cli.test.ts","packages/infrastructure/package.json"]
```

## Behavioral Invariants

You MUST implement the following behavioral invariants as named tests first (TDD):

- **required and closed flags**: Missing required flags, unknown flags, duplicate flags, and missing values fail before profile loading. (Test: `CLI requires comfyui-dir and profile and rejects unknown flags`)
- **help is side-effect free**: Help prints usage without loading a manifest or collecting provenance. (Test: `CLI help has no provenance side effects`)
- **pipe-safe success output**: Progress uses stderr and successful stdout receives exactly one JSON document. (Test: `CLI writes progress only to stderr and one JSON report to stdout`)
- **no partial failure report**: A failed collection returns 1, writes an actionable stderr error, and writes no stdout JSON. (Test: `CLI returns failure without partial JSON when preflight or collection fails`)
- **configured runtime path**: The selected profile and supplied ComfyUI directory are forwarded without a hard-coded home path. (Test: `CLI forwards the selected profile and configured ComfyUI path`)
- **package command wiring**: The infrastructure package script invokes the exact provenance TypeScript entrypoint. (Test: `infrastructure provenance script exposes the TypeScript entrypoint`)

