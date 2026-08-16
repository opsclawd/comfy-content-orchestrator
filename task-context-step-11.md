# Task Context: Task 11

Title: Document hardware operation and metric semantics
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

- Create: `docs/ltx-hardware-certification.md`
- Modify: `README.md`
- Reference only: `templates/README.md`

**Steps:**

- [ ] Document prerequisites, the required approved Gold Master report, required environment values, the exact default command, exit codes 0/1/77, output layout, and the rule that video outputs remain external while object keys/paths are recorded.
- [ ] Define each metric's semantics: 200 ms paired samples; MB derived from Linux kB and NVIDIA nounits values; system/process counters as window deltas; peak host used RAM as total minus available; process RSS from `VmRSS`; and post-unload VRAM as the explicit sample after a fixed five-second settle.
- [ ] Document that system-wide memory/swap/fault deltas assume an idle host, while process RSS/faults are bound to PID/start time. Explain that a sampling error or counter reset makes the run fail rather than becoming zero.
- [ ] Document DynamicVRAM as the first/default baseline. Give the comparator command with `--highvram` and a different run ID, and state that one comparator result cannot change production policy.
- [ ] Document the hardware acceptance checklist and current blocker: checked-in authored/unpinned provenance is not approved Gold Master evidence. No hardware-dependent issue checkbox is complete until the target-host artifacts exist and parse.
- [ ] Link the guide from `README.md`, run the scoped check, then commit.

**Acceptance/verification:**

- `pnpm exec prettier --check docs/ltx-hardware-certification.md README.md` — expected: both Markdown files conform.

**Commit:** `docs: add LTX certification runbook`

## Repository Targets

### Expected Files
- docs/ltx-hardware-certification.md
- README.md

### Reference Files
- templates/README.md

## Validation Commands

```bash
["pnpm","exec","prettier","--check","docs/ltx-hardware-certification.md","README.md"]
```

