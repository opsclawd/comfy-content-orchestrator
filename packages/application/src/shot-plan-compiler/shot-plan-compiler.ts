import { createHash } from "node:crypto";
import type { ShotPlanDocument, ShotPlanRoutingMode } from "@cco/contracts";
import type { ShotPlanSnapshot } from "@cco/domain";
import type { CanonicalReferenceEntry } from "./canonicalize-reference-bindings.js";

export class ShotPlanCompilerError extends Error {
  override readonly name = "ShotPlanCompilerError";
  readonly code: string;

  constructor(message: string, code: string = "COMPILATION_ERROR", options?: ErrorOptions) {
    super(message, options);
    this.code = code;
  }
}

export type ShotPlanInput = ShotPlanDocument | Readonly<ShotPlanSnapshot>;

export interface CompileShotPlanInput {
  readonly shotPlan: ShotPlanInput;
  readonly sceneSpec?:
    | {
        readonly revision: number;
        readonly actionContext?: string | undefined;
        readonly scriptContext?: string | undefined;
      }
    | undefined;
  readonly references?: readonly CanonicalReferenceEntry[] | undefined;
  readonly routingMode?: ShotPlanRoutingMode | undefined;
  readonly configuredDurationMs?: number | undefined;
  readonly allowUnapproved?: boolean | undefined;
}

export interface CompiledShotPlanInstruction {
  readonly instructionText: string;
  readonly instructionHashSha256: string;
  readonly instructionBytes: Uint8Array;
}

/**
 * Escapes control characters deterministically while preserving valid LF line-breaks and tabs.
 */
function sanitizeControlCharacters(input: string): string {
  // Normalize CRLF / CR to LF
  const normalizedNewlines = input.replace(/\r\n/g, "\n").replace(/\r/g, "\n");
  // Replace disallowed ASCII control characters (0x00-0x08, 0x0B, 0x0C, 0x0E-0x1F, 0x7F) with a space
  // eslint-disable-next-line no-control-regex
  return normalizedNewlines.replace(/[\x00-\x08\x0B\x0C\x0E-\x1F\x7F]/g, " ");
}

/**
 * Pure, deterministic compiler that transforms an approved ShotPlan and canonical ReferenceAssets
 * into an authoritative executed instruction surface for MiniMax-H3.
 */
export function compileShotPlan(input: CompileShotPlanInput): CompiledShotPlanInstruction {
  const {
    shotPlan,
    sceneSpec,
    references = [],
    routingMode = shotPlan.routingMode ?? "reference_directed",
    configuredDurationMs = shotPlan.targetDurationMs,
    allowUnapproved = false
  } = input;

  // 1. Validate ShotPlan approval status
  if (!allowUnapproved && shotPlan.status !== "approved") {
    throw new ShotPlanCompilerError(
      `Cannot compile unapproved ShotPlan "${shotPlan.id}" (status: "${shotPlan.status}"). ShotPlans must be approved.`,
      "SHOT_PLAN_NOT_APPROVED"
    );
  }

  // 2. Validate routing mode alignment
  if (shotPlan.routingMode && shotPlan.routingMode !== routingMode) {
    throw new ShotPlanCompilerError(
      `Routing mode mismatch: requested "${routingMode}", but ShotPlan "${shotPlan.id}" declared "${shotPlan.routingMode}"`,
      "ROUTING_MODE_MISMATCH"
    );
  }

  // 3. Validate scene specification revision alignment if provided
  if (sceneSpec && sceneSpec.revision !== shotPlan.specRevision) {
    throw new ShotPlanCompilerError(
      `Revision mismatch: ShotPlan "${shotPlan.id}" is at specRevision ${shotPlan.specRevision}, but SceneSpec is at revision ${sceneSpec.revision}`,
      "SPEC_REVISION_MISMATCH"
    );
  }

  // 4. Validate beats: unique indices and half-open intervals [startMs, endMs) within duration limits
  const seenBeatIndices = new Set<number>();
  const sortedBeats = [...shotPlan.beats].sort((a, b) => a.beatIndex - b.beatIndex);

  for (const beat of sortedBeats) {
    if (seenBeatIndices.has(beat.beatIndex)) {
      throw new ShotPlanCompilerError(
        `Duplicate beatIndex ${beat.beatIndex} found in ShotPlan beats`,
        "DUPLICATE_BEAT_INDEX"
      );
    }
    seenBeatIndices.add(beat.beatIndex);

    if (beat.startMs < 0 || beat.endMs <= beat.startMs || beat.endMs > configuredDurationMs) {
      throw new ShotPlanCompilerError(
        `Beat ${beat.beatIndex} interval [${beat.startMs}ms, ${beat.endMs}ms) violates configured duration window [0ms, ${configuredDurationMs}ms]`,
        "BEAT_RANGE_OUT_OF_BOUNDS"
      );
    }
  }

  // 5. Build section components in fixed, documented sequence
  const lines: string[] = [];

  const getUsableDescription = (ref: CanonicalReferenceEntry): string | undefined => {
    const desc = ref.asset.description?.replace(/[\r\n\t]+/g, " ").trim();
    return desc && desc.length > 0 ? desc : undefined;
  };

  const boundSubjectIdentityRefs = references.filter((r) => r.role === "subject_identity");
  const boundLocationRefs = references.filter((r) => r.role === "location");

  const usableSubjectIdentityRefs = boundSubjectIdentityRefs.filter(
    (r) => getUsableDescription(r) !== undefined
  );
  const usableLocationRefs = boundLocationRefs.filter((r) => getUsableDescription(r) !== undefined);

  // Section 1: Scene Context
  const contextText =
    sceneSpec?.actionContext?.trim() ||
    sceneSpec?.scriptContext?.trim() ||
    shotPlan.actionSummary.trim();
  lines.push(`[Scene Context]: ${contextText}`);

  // Section 2: Camera & Framing
  lines.push(
    `[Camera]: Framing: ${shotPlan.framing} | Angle: ${shotPlan.angle} | Lens: ${shotPlan.lensIntent} | Position: ${shotPlan.cameraPosition} | Movement: ${shotPlan.cameraMovement} (${shotPlan.movementSpeed}) | Notes: ${shotPlan.cameraPromptDescription}`
  );

  // Section 3: Subject Identity (when active subject_identity reference with description exists)
  if (usableSubjectIdentityRefs.length > 0) {
    const subjectClauses = usableSubjectIdentityRefs.map(
      (r) => `${r.promptTag}: ${getUsableDescription(r)!}`
    );
    lines.push(`[Subject Identity]: ${subjectClauses.join("; ")}`);
  }

  // Section 4: Subjects & Blocking
  if (shotPlan.subjects.length > 0) {
    const subjectDescriptions = shotPlan.subjects.map((sub) => {
      if (sub.role === "subject_identity") {
        let matchingRef: CanonicalReferenceEntry | undefined;
        if (sub.referenceAssetId) {
          matchingRef = boundSubjectIdentityRefs.find(
            (r) => r.referenceAssetId.toLowerCase() === sub.referenceAssetId?.toLowerCase()
          );
        } else if (
          boundSubjectIdentityRefs.some(
            (r) => r.referenceAssetId.toLowerCase() === sub.subjectId.toLowerCase()
          )
        ) {
          matchingRef = boundSubjectIdentityRefs.find(
            (r) => r.referenceAssetId.toLowerCase() === sub.subjectId.toLowerCase()
          );
        } else if (boundSubjectIdentityRefs.length === 1) {
          matchingRef = boundSubjectIdentityRefs[0];
        }

        if (matchingRef) {
          let desc = `${matchingRef.promptTag} (${sub.role}): Initial: ${sub.initialPosition}, Path: ${sub.movementTrajectory}`;
          if (sub.interactionSummary) {
            desc += `, Interaction: ${sub.interactionSummary}`;
          }
          return desc;
        }

        // When bound subject_identity references exist, suppress planner-authored subjectId
        if (boundSubjectIdentityRefs.length > 0) {
          let desc = `(${sub.role}): Initial: ${sub.initialPosition}, Path: ${sub.movementTrajectory}`;
          if (sub.interactionSummary) {
            desc += `, Interaction: ${sub.interactionSummary}`;
          }
          return desc;
        }
      }

      let desc = `${sub.subjectId} (${sub.role}): Initial: ${sub.initialPosition}, Path: ${sub.movementTrajectory}`;
      if (sub.interactionSummary) {
        desc += `, Interaction: ${sub.interactionSummary}`;
      }
      if (sub.referenceAssetId) {
        const matchingRef = references.find(
          (r) => r.referenceAssetId.toLowerCase() === sub.referenceAssetId?.toLowerCase()
        );
        if (matchingRef) {
          desc += ` (visual reference: ${matchingRef.promptTag})`;
        }
      }
      return desc;
    });
    lines.push(`[Subjects]: ${subjectDescriptions.join("; ")}`);
  }

  // Section 5: Action Summary
  lines.push(`[Action Summary]: ${shotPlan.actionSummary.trim()}`);

  // Section 6: Temporal Beats
  if (sortedBeats.length > 0) {
    const beatDescriptions = sortedBeats.map(
      (b) =>
        `Beat ${b.beatIndex} [${b.startMs}ms-${b.endMs}ms): ${b.description} (Camera: ${b.cameraAction}, Subject: ${b.subjectAction})`
    );
    lines.push(`[Temporal Beats]:\n${beatDescriptions.join("\n")}`);
  }

  // Section 7: Location (when active location reference with description exists)
  if (usableLocationRefs.length > 0) {
    const locationClauses = usableLocationRefs.map(
      (r) => `${r.promptTag}: ${getUsableDescription(r)!}`
    );
    lines.push(`[Location]: ${locationClauses.join("; ")}`);
  }

  // Section 8: Environment & Lighting
  let envText = `[Environment & Lighting]: Style: ${shotPlan.lightingStyle}`;
  if (boundLocationRefs.length === 0) {
    envText += ` | Environment: ${shotPlan.environmentDescription}`;
  }
  if (shotPlan.colorPalette && shotPlan.colorPalette.length > 0) {
    envText += ` | Palette: ${shotPlan.colorPalette.join(", ")}`;
  }
  if (shotPlan.atmosphere) {
    envText += ` | Atmosphere: ${shotPlan.atmosphere}`;
  }
  lines.push(envText);

  // Section 9: Continuity
  let persistentSubjectsText = "none";
  if (shotPlan.continuity.persistentSubjectIds.length > 0) {
    const mappedPersistentIds = shotPlan.continuity.persistentSubjectIds.map((id) => {
      // 1. Direct asset ID match against bound subject references
      const directAssetRef = boundSubjectIdentityRefs.find(
        (r) => r.referenceAssetId.toLowerCase() === id.toLowerCase()
      );
      if (directAssetRef) {
        return directAssetRef.promptTag;
      }

      const matchingSub = shotPlan.subjects.find(
        (s) => s.subjectId.toLowerCase() === id.toLowerCase()
      );

      if (matchingSub && matchingSub.role === "subject_identity") {
        if (matchingSub.referenceAssetId) {
          const matchingRef = boundSubjectIdentityRefs.find(
            (r) => r.referenceAssetId.toLowerCase() === matchingSub.referenceAssetId?.toLowerCase()
          );
          if (matchingRef) {
            return matchingRef.promptTag;
          }
          return boundSubjectIdentityRefs.length > 0 ? "unspecified_subject" : id;
        }
        if (boundSubjectIdentityRefs.length === 1) {
          return boundSubjectIdentityRefs[0]!.promptTag;
        }
        return boundSubjectIdentityRefs.length > 0 ? "unspecified_subject" : id;
      }

      if (!matchingSub) {
        if (boundSubjectIdentityRefs.length === 1) {
          return boundSubjectIdentityRefs[0]!.promptTag;
        }
        if (boundSubjectIdentityRefs.length > 1) {
          return "unspecified_subject";
        }
        return id;
      }

      return id;
    });
    persistentSubjectsText = mappedPersistentIds.join(", ");
  }

  let contText = `[Continuity]: Persistent Subjects: ${persistentSubjectsText}`;
  if (shotPlan.continuity.lightingContinuityNote) {
    contText += ` | Lighting Note: ${shotPlan.continuity.lightingContinuityNote}`;
  }
  lines.push(contText);

  // Section 10: Dialogue & Performance
  if (shotPlan.dialogue) {
    const d = shotPlan.dialogue;
    const parts: string[] = [];
    if (d.speaker) parts.push(`Speaker: ${d.speaker}`);
    if (d.line) parts.push(`Line: "${d.line}"`);
    if (d.deliveryEmotion) parts.push(`Emotion: ${d.deliveryEmotion}`);
    if (d.audioFxPrompt) parts.push(`Audio FX: ${d.audioFxPrompt}`);
    if (parts.length > 0) {
      lines.push(`[Dialogue]: ${parts.join(" | ")}`);
    }
  }

  // Section 11: Reference Visuals / Picture Tag Declarations
  if (references.length > 0) {
    const refDeclarations = references.map((r) => {
      const label = r.asset.displayName || r.referenceAssetId;
      return `${r.promptTag} represents ${r.role.replace(/_/g, " ")} (${label})`;
    });
    lines.push(`[Reference Visuals]:\n${refDeclarations.join("\n")}`);
  }

  // 6. Format, normalize line-endings to LF, and sanitize control characters
  const rawInstructionText = lines.join("\n\n");
  const sanitizedText = sanitizeControlCharacters(rawInstructionText)
    .split("\n")
    .map((line) => line.trimEnd())
    .join("\n")
    .trim();

  // 7. Tag-to-reference bijection check:
  //    Every <Picture n> tag in the text must correspond to a reference in `references`,
  //    and every active reference must appear in the text.
  const tagRegex = /<Picture\s+(\d+)>/g;
  const foundSlots = new Set<number>();
  let match: RegExpExecArray | null;

  while ((match = tagRegex.exec(sanitizedText)) !== null) {
    const slot = Number.parseInt(match[1]!, 10);
    foundSlots.add(slot);
    const hasMatchingRef = references.some((r) => r.slotIndex === slot);
    if (!hasMatchingRef) {
      throw new ShotPlanCompilerError(
        `Instruction references undefined tag "<Picture ${slot}>" without a corresponding active staged reference asset`,
        "ORPHAN_PICTURE_TAG"
      );
    }
  }

  for (const ref of references) {
    if (!foundSlots.has(ref.slotIndex)) {
      throw new ShotPlanCompilerError(
        `Staged reference at slot ${ref.slotIndex} ("${ref.promptTag}") is not referenced in the compiled instruction`,
        "UNREFERENCED_STAGED_REFERENCE"
      );
    }
  }

  const instructionBytes = Buffer.from(sanitizedText, "utf8");
  const instructionHashSha256 = createHash("sha256").update(instructionBytes).digest("hex");

  return Object.freeze({
    instructionText: sanitizedText,
    instructionHashSha256,
    instructionBytes
  });
}
