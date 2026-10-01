import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

/**
 * Static source-scan guard for issue #373's acceptance-campaign preparation use cases.
 *
 * These use cases are preparation-only tooling for a FUTURE GPU-based operator
 * acceptance campaign. They must never themselves acquire a GPU lease, talk to ComfyUI,
 * dispatch a render job, or read/write a ShotPlan, StoryboardCandidate,
 * ProductionAttempt, or GenerationManifest repository — those are exclusively the
 * concern of the render worker and the human operator running the physical campaign.
 *
 * This test scans the actual source text of the two use-case files rather than mocking
 * imports, so it fails loudly the moment anyone wires in a forbidden dependency.
 */
const FORBIDDEN_PATTERNS: readonly RegExp[] = [
  /comfyui/i,
  /\bgpu\b/i,
  /nvidia/i,
  /RenderEnginePort/,
  /GpuExecutionLeasePort/,
  /GpuTelemetryPort/,
  /ShotPlanRepository/,
  /StoryboardCandidateRepository/,
  /GenerationManifestRepository/,
  /ManifestRepository/,
  /RenderJobRepository/,
  /JobQueuePort/,
  /ExecuteProfileRenderUseCase/
];

const FILES_UNDER_TEST = [
  "./install-acceptance-campaign-fixture.ts",
  "./evaluate-acceptance-preflight.ts"
];

/**
 * Strips `//` line comments and `/* ... *\/` block comments so documentation prose
 * (which legitimately explains what this code deliberately does NOT do, using words
 * like "GPU-free") cannot produce a false positive. Only executable code — imports,
 * type references, identifiers — is scanned for forbidden dependencies.
 */
function stripComments(source: string): string {
  return source.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/.*$/gm, "");
}

describe("acceptance-campaign use cases: GPU/production-authority isolation", () => {
  for (const relativePath of FILES_UNDER_TEST) {
    it(`"${relativePath}" contains no GPU, ComfyUI, or production-authority repository references in executable code`, () => {
      const absolutePath = fileURLToPath(new URL(relativePath, import.meta.url));
      const source = stripComments(readFileSync(absolutePath, "utf8"));

      for (const pattern of FORBIDDEN_PATTERNS) {
        expect(
          pattern.test(source),
          `Forbidden pattern ${pattern} unexpectedly matched in ${relativePath}`
        ).toBe(false);
      }
    });
  }
});
