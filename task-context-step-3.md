# Task Context: Task 3

Title: Add the host telemetry port and Linux adapter together
## Workspace & Scope Constraints

## WORKSPACE CONSTRAINTS

Your working directory is a dedicated git worktree with the repository's complete history. Run all commands from it. Do NOT cd to or read paths outside this directory — external-directory access is automatically rejected. git log, git diff, etc. work here directly.

.ai-orchestrator.local.json, if one exists, lives only in the main checkout and is intentionally not copied into your worktree — it is operator-machine-specific and not part of your task. Do not search for it or read it outside this directory. Reason about configuration using only .ai-orchestrator.json in your own working directory; treat it as the effective config for your task.

Working Directory: /home/gary/.openclaw/workspace/comfy-content-orchestrator/.ai-worktrees/issue-7
Repository: opsclawd/comfy-content-orchestrator
Branch: ai/issue-7
Start Commit: 27bbf2d699970a5f188cd3e8acf284c622494c3a

## Task Requirements

**Files:**

- Create: `packages/application/src/ports/host-telemetry-port.ts`
- Modify: `packages/application/src/ports/index.ts`
- Create: `packages/infrastructure/src/telemetry/linux-host-telemetry-adapter.ts`
- Create: `packages/infrastructure/src/telemetry/linux-host-telemetry-adapter.test.ts`
- Modify: `packages/infrastructure/src/index.ts`

**Behavioral invariants — write these named tests first:**

- `linux-units-are-normalized` — `/proc` kB values become MB consistently and `hostRamUsedMb` is `MemTotal - MemAvailable`. Test case: `normalizes meminfo RAM swap and RSS values to MB`.
- `counter-fields-are-exact` — `/proc/vmstat` `pswpin`/`pswpout`/`pgmajfault`/`pgfault` and `/proc/<pid>/stat` fields 10/12 are read as cumulative integer counters. Test case: `reads system swap activity and process page fault counters`.
- `process-identity-is-stable` — every snapshot verifies the configured PID still has the expected `/proc/<pid>/stat` start-time field, preventing PID reuse from mixing processes. Test case: `rejects telemetry when the configured process identity changes`.
- `required-source-failure-is-loud` — absent/malformed required keys or inaccessible process files reject the sample and never substitute zero. Test case: `rejects missing malformed or inaccessible proc telemetry`.

**Steps:**

- [ ] Define `HostTelemetrySnapshot` and `HostTelemetryPort.readHostMemory()` in the application port. Include total/available/used RAM, total/used swap, system swap-in/swap-out activity, system faults, process RSS, process faults, PID/start-time identity, and `measuredAt`.
- [ ] In the same task, implement every method of the new port in `LinuxHostTelemetryAdapter`; inject `readFile` and `now` for unit tests. Implement and export pure parsers `parseProcMeminfo`, `parseProcVmstat`, `parseProcPidStatus`, and `parseProcPidStat`.
- [ ] Parse `/proc/meminfo`, `/proc/vmstat`, `/proc/<pid>/status`, and the parenthesized-command-safe `/proc/<pid>/stat` format. Capture the process start time once in the constructor factory and verify it on subsequent samples.
- [ ] Export the new port from `packages/application/src/ports/index.ts` and the adapter/parsers (`LinuxHostTelemetryAdapter`, `parseProcMeminfo`, `parseProcVmstat`, `parseProcPidStatus`, `parseProcPidStat`) from `packages/infrastructure/src/index.ts`. This keeps the port and its only adapter type-correct in one commit.
- [ ] Run the scoped checks, then commit.

**Acceptance/verification:**

- `pnpm exec vitest run packages/infrastructure/src/telemetry/linux-host-telemetry-adapter.test.ts` — expected: unit normalization, counter extraction, PID-reuse rejection, and malformed input tests pass.
- `pnpm exec eslint packages/application/src/ports/host-telemetry-port.ts packages/application/src/ports/index.ts packages/infrastructure/src/telemetry/linux-host-telemetry-adapter.ts packages/infrastructure/src/telemetry/linux-host-telemetry-adapter.test.ts packages/infrastructure/src/index.ts` — expected: no errors.
- `pnpm exec prettier --check packages/application/src/ports/host-telemetry-port.ts packages/application/src/ports/index.ts packages/infrastructure/src/telemetry/linux-host-telemetry-adapter.ts packages/infrastructure/src/telemetry/linux-host-telemetry-adapter.test.ts packages/infrastructure/src/index.ts` — expected: all files conform.

**Commit:** `feat(telemetry): read Linux host resource counters`

## Repository Targets

### Expected Files
- packages/application/src/ports/host-telemetry-port.ts
- packages/application/src/ports/index.ts
- packages/infrastructure/src/telemetry/linux-host-telemetry-adapter.ts
- packages/infrastructure/src/telemetry/linux-host-telemetry-adapter.test.ts
- packages/infrastructure/src/index.ts

## Validation Commands

```bash
["pnpm","exec","vitest","run","packages/infrastructure/src/telemetry/linux-host-telemetry-adapter.test.ts"]
["pnpm","exec","eslint","packages/application/src/ports/host-telemetry-port.ts","packages/application/src/ports/index.ts","packages/infrastructure/src/telemetry/linux-host-telemetry-adapter.ts","packages/infrastructure/src/telemetry/linux-host-telemetry-adapter.test.ts","packages/infrastructure/src/index.ts"]
["pnpm","exec","prettier","--check","packages/application/src/ports/host-telemetry-port.ts","packages/application/src/ports/index.ts","packages/infrastructure/src/telemetry/linux-host-telemetry-adapter.ts","packages/infrastructure/src/telemetry/linux-host-telemetry-adapter.test.ts","packages/infrastructure/src/index.ts"]
```

## Behavioral Invariants

You MUST implement the following behavioral invariants as named tests first (TDD):

- **linux-units-are-normalized**: Linux kB values are converted consistently and host used RAM is total minus available. (Test: `normalizes meminfo RAM swap and RSS values to MB`)
- **counter-fields-are-exact**: System swap/page-fault and process major/minor fault counters are read from their exact proc fields. (Test: `reads system swap activity and process page fault counters`)
- **process-identity-is-stable**: A changed process start-time identity rejects the sample to prevent PID-reuse contamination. (Test: `rejects telemetry when the configured process identity changes`)
- **required-source-failure-is-loud**: Missing, malformed, or inaccessible proc data rejects the sample without zero substitution. (Test: `rejects missing malformed or inaccessible proc telemetry`)

