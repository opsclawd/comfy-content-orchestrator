import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import {
  ACCEPTANCE_CAMPAIGN_FIXTURE_ID,
  ACCEPTANCE_CAMPAIGN_SCENES,
  ACCEPTANCE_COVERAGE_REQUIREMENTS
} from "./acceptance-campaign.js";

const REPO_ROOT = resolve(fileURLToPath(new URL(".", import.meta.url)), "../../../");

function readDoc(relativePath: string): string {
  return readFileSync(resolve(REPO_ROOT, relativePath), "utf8");
}

const SENTINEL = "TBD-OPERATOR";

describe("acceptance-campaign docs consistency", () => {
  it("the spec doc mentions the exact fixture id", () => {
    const doc = readDoc("docs/h3-acceptance-campaign.md");
    expect(doc).toContain(ACCEPTANCE_CAMPAIGN_FIXTURE_ID);
    expect(ACCEPTANCE_CAMPAIGN_FIXTURE_ID).toBe("ACCEPTANCE-H3-REPRESENTATIVE-V1");
  });

  it("the spec doc mentions every representative scene case id", () => {
    const doc = readDoc("docs/h3-acceptance-campaign.md");
    for (const scene of ACCEPTANCE_CAMPAIGN_SCENES) {
      expect(
        doc,
        `docs/h3-acceptance-campaign.md should mention scene "${scene.caseId}"`
      ).toContain(scene.caseId);
    }
  });

  it("the spec doc mentions every coverage requirement id", () => {
    const doc = readDoc("docs/h3-acceptance-campaign.md");
    for (const requirement of ACCEPTANCE_COVERAGE_REQUIREMENTS) {
      expect(doc, `docs/h3-acceptance-campaign.md should mention ${requirement.id}`).toMatch(
        new RegExp(`\\b${requirement.id}\\b`)
      );
    }
  });

  it("the operator runbook references both evidence templates and the preflight command", () => {
    const doc = readDoc("docs/h3-acceptance-operator-runbook.md");
    expect(doc).toContain(
      "docs/evidence/h3-acceptance-storyboard-readability-evidence-template.md"
    );
    expect(doc).toContain("docs/evidence/h3-acceptance-multiscene-evidence-template.md");
    expect(doc).toContain("pnpm acceptance:preflight");
  });

  it("both evidence templates reference every coverage requirement id and contain only sentinels", () => {
    const storyboardDoc = readDoc(
      "docs/evidence/h3-acceptance-storyboard-readability-evidence-template.md"
    );
    const multisceneDoc = readDoc("docs/evidence/h3-acceptance-multiscene-evidence-template.md");
    const combined = `${storyboardDoc}\n${multisceneDoc}`;

    for (const requirement of ACCEPTANCE_COVERAGE_REQUIREMENTS) {
      expect(combined, `evidence templates should mention ${requirement.id}`).toMatch(
        new RegExp(`\\b${requirement.id}\\b`)
      );
    }

    expect(storyboardDoc).toContain(SENTINEL);
    expect(multisceneDoc).toContain(SENTINEL);
  });

  it("CONTEXT.md documents issue #373", () => {
    const doc = readDoc("docs/CONTEXT.md");
    expect(doc).toContain("#373");
    expect(doc).toContain(ACCEPTANCE_CAMPAIGN_FIXTURE_ID);
  });

  it("the deployment runbook cross-links issue #373", () => {
    const doc = readDoc("docs/deployment-runbook.md");
    expect(doc).toContain("#373");
  });
});
