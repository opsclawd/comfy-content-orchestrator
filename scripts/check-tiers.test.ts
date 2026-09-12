import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const REPO_ROOT = resolve(import.meta.dirname, "..");
const CONFIG_PATH = resolve(REPO_ROOT, ".ai-orchestrator.json");

// Inherited commands from automation repository base configuration
const AUTOMATION_BASE_COMMANDS = [
  "pnpm build",
  "pnpm lint",
  "pnpm typecheck",
  "pnpm test",
  "pnpm test:bash",
  "pnpm boundaries"
];

// The 6 independent heavy suites that must execute concurrently
const PARALLEL_HEAVY_SUITES = [
  "pnpm test:db",
  "pnpm test:assembly",
  "pnpm test:kokoro",
  "pnpm test:piper",
  "pnpm test:ltx-production",
  "pnpm test:whisperx"
];

describe("validation.tiers configuration invariants", () => {
  const config = JSON.parse(readFileSync(CONFIG_PATH, "utf8"));
  const validation = config.validation;
  const tiers: string[][] = validation.tiers;
  const additionalCommands: string[] = validation.additionalCommands;

  it("defines validation.tiers as a non-empty 2D string array", () => {
    expect(Array.isArray(tiers)).toBe(true);
    expect(tiers.length).toBeGreaterThanOrEqual(1);
    for (const tier of tiers) {
      expect(Array.isArray(tier)).toBe(true);
      expect(tier.length).toBeGreaterThanOrEqual(1);
      for (const cmd of tier) {
        expect(typeof cmd).toBe("string");
        expect(cmd.trim().length).toBeGreaterThan(0);
      }
    }
  });

  it("contains no duplicate commands across any tier", () => {
    const seen = new Set<string>();
    const duplicates: string[] = [];

    for (const tier of tiers) {
      for (const cmd of tier) {
        if (seen.has(cmd)) {
          duplicates.push(cmd);
        }
        seen.add(cmd);
      }
    }

    expect(duplicates).toEqual([]);
  });

  it("covers all inherited base commands and target additionalCommands without omissions", () => {
    const effectiveCommands = Array.from(
      new Set([...AUTOMATION_BASE_COMMANDS, ...additionalCommands])
    );
    const allTierCommands = tiers.flat();

    const missingInTiers = effectiveCommands.filter((cmd) => !allTierCommands.includes(cmd));
    const unexpectedInTiers = allTierCommands.filter((cmd) => !effectiveCommands.includes(cmd));

    expect(missingInTiers).toEqual([]);
    expect(unexpectedInTiers).toEqual([]);
    expect(allTierCommands).toHaveLength(effectiveCommands.length);
  });

  it("runs preparation and hygiene tiers before test execution tiers", () => {
    const tierIndices = new Map<string, number>();
    tiers.forEach((tier, index) => {
      for (const cmd of tier) {
        tierIndices.set(cmd, index);
      }
    });

    const checkHooksIndex = tierIndices.get("pnpm check:hooks")!;
    const installIndex = tierIndices.get("pnpm install --frozen-lockfile")!;
    const formatFixIndex = tierIndices.get("pnpm format:fix")!;
    const formatIndex = tierIndices.get("pnpm format")!;
    const preValidationIndex = tierIndices.get("pnpm preValidation")!;
    const buildIndex = tierIndices.get("pnpm build")!;

    // Format auto-fix must precede format check
    expect(formatFixIndex).toBeLessThan(formatIndex);

    // Preparation/hygiene must precede all heavy parallel test suites
    for (const testCmd of PARALLEL_HEAVY_SUITES) {
      const testIndex = tierIndices.get(testCmd)!;
      expect(checkHooksIndex).toBeLessThan(testIndex);
      expect(installIndex).toBeLessThan(testIndex);
      expect(formatFixIndex).toBeLessThan(testIndex);
      expect(formatIndex).toBeLessThan(testIndex);
      expect(preValidationIndex).toBeLessThan(testIndex);
      expect(buildIndex).toBeLessThan(testIndex);
    }
  });

  it("groups all 6 heavy independent subsystem test suites in a single parallel tier", () => {
    const heavyTier = tiers.find((tier) =>
      PARALLEL_HEAVY_SUITES.every((cmd) => tier.includes(cmd))
    );

    expect(heavyTier).toBeDefined();
    expect(heavyTier).toEqual(expect.arrayContaining(PARALLEL_HEAVY_SUITES));
  });
});
