import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import type {
  AcceptanceEvidenceTemplateFinding,
  AcceptanceEvidenceTemplateProbePort,
  AcceptanceEvidenceTemplateProbeResult
} from "@cco/application";

const DEFAULT_REPO_ROOT = resolve(fileURLToPath(new URL(".", import.meta.url)), "../../../../");

export const ACCEPTANCE_EVIDENCE_SENTINEL = "TBD-OPERATOR";

export const DEFAULT_ACCEPTANCE_EVIDENCE_TEMPLATE_PATHS: readonly string[] = Object.freeze([
  "docs/evidence/h3-acceptance-storyboard-readability-evidence-template.md",
  "docs/evidence/h3-acceptance-multiscene-evidence-template.md"
]);

export interface FsEvidenceTemplateProbeOptions {
  readonly repoRoot?: string | undefined;
  readonly templatePaths?: readonly string[] | undefined;
}

/**
 * Read-only check that the operator evidence templates exist and contain ONLY empty
 * `TBD-OPERATOR` sentinel values in their fillable fields — never real measurements,
 * hashes, timestamps, or pass/fail verdicts. This guards against anyone (agent or human)
 * having accidentally pre-filled acceptance evidence before the physical campaign runs.
 */
export class FsEvidenceTemplateProbe implements AcceptanceEvidenceTemplateProbePort {
  private readonly repoRoot: string;
  private readonly templatePaths: readonly string[];

  constructor(options: FsEvidenceTemplateProbeOptions = {}) {
    this.repoRoot = options.repoRoot ?? DEFAULT_REPO_ROOT;
    this.templatePaths = options.templatePaths ?? DEFAULT_ACCEPTANCE_EVIDENCE_TEMPLATE_PATHS;
  }

  async probe(): Promise<AcceptanceEvidenceTemplateProbeResult> {
    const findings: AcceptanceEvidenceTemplateFinding[] = [];

    for (const templatePath of this.templatePaths) {
      const absolutePath = resolve(this.repoRoot, templatePath);
      let content: string | undefined;
      const issues: string[] = [];

      try {
        content = await readFile(absolutePath, "utf8");
      } catch (err) {
        findings.push({
          templatePath,
          exists: false,
          isEmptySentinel: false,
          issues: [`Failed to read template: ${err instanceof Error ? err.message : String(err)}`]
        });
        continue;
      }

      if (!content.includes(ACCEPTANCE_EVIDENCE_SENTINEL)) {
        issues.push(`Template does not contain any "${ACCEPTANCE_EVIDENCE_SENTINEL}" sentinel.`);
      }

      const fillableCells = this.extractFillableCells(content);
      const filledInCells = fillableCells.filter(
        (cell) => cell.length > 0 && cell !== ACCEPTANCE_EVIDENCE_SENTINEL
      );
      if (filledInCells.length > 0) {
        issues.push(
          `Template table cells appear filled in rather than left as "${ACCEPTANCE_EVIDENCE_SENTINEL}": ${filledInCells
            .slice(0, 5)
            .join(", ")}`
        );
      }

      findings.push({
        templatePath,
        exists: true,
        isEmptySentinel: issues.length === 0,
        issues
      });
    }

    return {
      ok: findings.every((f) => f.exists && f.isEmptySentinel),
      findings
    };
  }

  /**
   * Extracts every non-label markdown table cell (everything after the first column) from
   * each data row, excluding header/separator rows. Splits on the literal `|` delimiter
   * rather than regex-matching paired pipes, since adjacent cells share a delimiter pipe
   * and a greedy/lazy `\|...\|` pattern would silently skip every other cell.
   */
  private extractFillableCells(content: string): string[] {
    const cells: string[] = [];
    const lines = content.split("\n");
    const isSeparatorRow = (line: string): boolean => /^\|[\s:|-]+\|$/.test(line.trim());

    for (let i = 0; i < lines.length; i++) {
      const rawLine = lines[i];
      if (rawLine === undefined) continue;
      const trimmed = rawLine.trim();
      if (!trimmed.startsWith("|") || isSeparatorRow(trimmed)) {
        continue;
      }
      // A table header row is immediately followed by a separator row; skip it entirely.
      const nextLine = lines[i + 1];
      if (nextLine !== undefined && isSeparatorRow(nextLine)) {
        continue;
      }
      // "| a | b | c |".split("|") => ["", " a ", " b ", " c ", ""]; drop the empty
      // leading/trailing elements and the label column (first real cell).
      const rawCells = trimmed.split("|");
      const dataCells = rawCells.slice(1, rawCells.length - 1).map((c) => c.trim());
      for (const cell of dataCells.slice(1)) {
        cells.push(cell);
      }
    }

    return cells;
  }
}
