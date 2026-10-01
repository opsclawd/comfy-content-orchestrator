import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  ACCEPTANCE_EVIDENCE_SENTINEL,
  DEFAULT_ACCEPTANCE_EVIDENCE_TEMPLATE_PATHS,
  FsEvidenceTemplateProbe
} from "./fs-evidence-template-probe.js";

const REPO_ROOT = resolve(fileURLToPath(new URL(".", import.meta.url)), "../../../../");

describe("FsEvidenceTemplateProbe", () => {
  it("passes for the real, blank evidence templates checked into docs/evidence", async () => {
    const probe = new FsEvidenceTemplateProbe({ repoRoot: REPO_ROOT });

    const result = await probe.probe();

    expect(result.ok).toBe(true);
    expect(result.findings).toHaveLength(DEFAULT_ACCEPTANCE_EVIDENCE_TEMPLATE_PATHS.length);
    for (const finding of result.findings) {
      expect(finding.exists).toBe(true);
      expect(finding.isEmptySentinel).toBe(true);
      expect(finding.issues).toEqual([]);
    }
  });

  describe("with a temporary fixture directory", () => {
    let tempDir: string;

    beforeEach(() => {
      tempDir = mkdtempSync(join(tmpdir(), "acceptance-evidence-probe-"));
    });

    afterEach(() => {
      rmSync(tempDir, { recursive: true, force: true });
    });

    it("fails when a template file is missing", async () => {
      const probe = new FsEvidenceTemplateProbe({
        repoRoot: tempDir,
        templatePaths: ["missing.md"]
      });

      const result = await probe.probe();

      expect(result.ok).toBe(false);
      expect(result.findings[0]?.exists).toBe(false);
    });

    it("fails when a template has been filled in with real-looking data", async () => {
      const filledPath = join(tempDir, "filled.md");
      writeFileSync(
        filledPath,
        [
          `# Evidence (contains ${ACCEPTANCE_EVIDENCE_SENTINEL} once, but also filled cells)`,
          "",
          "| Field | Value |",
          "| --- | --- |",
          `| Operator name | ${ACCEPTANCE_EVIDENCE_SENTINEL} |`,
          "| Overall verdict | pass |"
        ].join("\n")
      );

      const probe = new FsEvidenceTemplateProbe({
        repoRoot: tempDir,
        templatePaths: ["filled.md"]
      });

      const result = await probe.probe();

      expect(result.ok).toBe(false);
      expect(result.findings[0]?.isEmptySentinel).toBe(false);
      expect(result.findings[0]?.issues.length).toBeGreaterThan(0);
    });

    it("fails when a template contains no sentinel at all", async () => {
      const emptyPath = join(tempDir, "no-sentinel.md");
      writeFileSync(emptyPath, "# Evidence\n\nNothing here.\n");

      const probe = new FsEvidenceTemplateProbe({
        repoRoot: tempDir,
        templatePaths: ["no-sentinel.md"]
      });

      const result = await probe.probe();

      expect(result.ok).toBe(false);
      expect(result.findings[0]?.issues.some((i) => i.includes("does not contain"))).toBe(true);
    });

    it("passes for a correctly blank template with multiple table rows", async () => {
      const blankPath = join(tempDir, "blank.md");
      writeFileSync(
        blankPath,
        [
          "# Evidence",
          "",
          "| Field | Value |",
          "| --- | --- |",
          `| Operator name | ${ACCEPTANCE_EVIDENCE_SENTINEL} |`,
          `| Overall verdict | ${ACCEPTANCE_EVIDENCE_SENTINEL} |`,
          "",
          "| Scene | Readable | Notes |",
          "| --- | --- | --- |",
          `| wide_establishing | ${ACCEPTANCE_EVIDENCE_SENTINEL} | ${ACCEPTANCE_EVIDENCE_SENTINEL} |`
        ].join("\n")
      );

      const probe = new FsEvidenceTemplateProbe({
        repoRoot: tempDir,
        templatePaths: ["blank.md"]
      });

      const result = await probe.probe();

      expect(result.ok).toBe(true);
    });
  });
});
