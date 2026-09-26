import type { SceneId, ShotPlanId } from "./identifiers.js";

export type { ShotPlanId };

export const SHOT_PLAN_ROUTING_MODES = ["reference_directed", "frame_anchored"] as const;
export type ShotPlanRoutingMode = (typeof SHOT_PLAN_ROUTING_MODES)[number];

export const SHOT_PLAN_STATUSES = ["draft", "approved", "superseded", "rejected"] as const;
export type ShotPlanStatus = (typeof SHOT_PLAN_STATUSES)[number];

export const SHOT_FRAMINGS = [
  "extreme_wide",
  "wide",
  "full_shot",
  "medium_wide",
  "medium",
  "medium_close_up",
  "close_up",
  "extreme_close_up"
] as const;
export type ShotFraming = (typeof SHOT_FRAMINGS)[number];

export const CAMERA_ANGLES = [
  "eye_level",
  "low_angle",
  "high_angle",
  "bird_eye",
  "worm_eye",
  "dutch_angle",
  "over_the_shoulder"
] as const;
export type CameraAngle = (typeof CAMERA_ANGLES)[number];

export const CAMERA_MOVEMENTS = [
  "static",
  "pan_left",
  "pan_right",
  "tilt_up",
  "tilt_down",
  "dolly_in",
  "dolly_out",
  "tracking",
  "pedestal_up",
  "pedestal_down",
  "crane",
  "arc",
  "orbit",
  "whip_pan"
] as const;
export type CameraMovement = (typeof CAMERA_MOVEMENTS)[number];

export const MOVEMENT_SPEEDS = ["slow", "medium", "fast", "variable"] as const;
export type MovementSpeed = (typeof MOVEMENT_SPEEDS)[number];

export const LIGHTING_STYLES = [
  "natural_golden_hour",
  "high_key_commercial",
  "low_key_dramatic",
  "chiaroscuro",
  "softbox_studio",
  "neon_night",
  "overcast_diffused",
  "practical_interior"
] as const;
export type LightingStyle = (typeof LIGHTING_STYLES)[number];

export const BLOCKING_INITIAL_POSITIONS = [
  "screen_left",
  "screen_center",
  "screen_right",
  "foreground_left",
  "foreground_center",
  "foreground_right",
  "background_center"
] as const;
export type BlockingInitialPosition = (typeof BLOCKING_INITIAL_POSITIONS)[number];

export const FRAME_ANCHOR_TARGETS = ["none", "first_frame", "last_frame", "both"] as const;
export type FrameAnchorTarget = (typeof FRAME_ANCHOR_TARGETS)[number];

export const BLOCKING_ROLES = ["subject_identity", "product"] as const;
export type BlockingRole = (typeof BLOCKING_ROLES)[number];

export interface ShotPlanSubjectBlocking {
  readonly subjectId: string;
  readonly referenceAssetId?: string | null;
  readonly role: BlockingRole;
  readonly initialPosition: BlockingInitialPosition;
  readonly movementTrajectory: string;
  readonly interactionSummary?: string | null;
}

export interface ShotPlanTemporalBeat {
  readonly beatIndex: number;
  readonly startMs: number;
  readonly endMs: number;
  readonly description: string;
  readonly cameraAction: string;
  readonly subjectAction: string;
}

export interface ShotPlanDialogueIntent {
  readonly speaker?: string | null;
  readonly line?: string | null;
  readonly audioFxPrompt?: string | null;
  readonly voiceoverCue?: string | null;
  readonly deliveryEmotion?: string | null;
}

export interface ShotPlanContinuityConstraints {
  readonly incomingContinuityFromSceneId?: string | null;
  readonly persistentSubjectIds: readonly string[];
  readonly lightingContinuityNote?: string | null;
  readonly frameAnchorTarget: FrameAnchorTarget;
  readonly anchorCandidateId?: string | null;
  readonly anchorMediaHashSha256?: string | null;
}

export interface ShotPlanPrevisAssociation {
  readonly candidateId: string;
  readonly storageBucket: string;
  readonly storageObjectKey: string;
  readonly contentHashSha256: string;
  readonly modelProfile: string;
  readonly generatedAt: string;
  readonly reviewNotes?: string | null;
}

export interface ShotPlanSnapshot {
  readonly id: ShotPlanId;
  readonly sceneId: SceneId;
  readonly specRevision: number;
  readonly variantOrdinal: number;
  readonly status: ShotPlanStatus;
  readonly routingMode: ShotPlanRoutingMode;
  readonly targetDurationMs: number;
  readonly targetFrameCount: number;
  readonly durationToleranceMs: number;
  readonly fps: 24;
  readonly framing: ShotFraming;
  readonly angle: CameraAngle;
  readonly lensIntent: string;
  readonly cameraPosition: string;
  readonly cameraMovement: CameraMovement;
  readonly movementSpeed: MovementSpeed;
  readonly cameraPromptDescription: string;
  readonly subjects: readonly ShotPlanSubjectBlocking[];
  readonly actionSummary: string;
  readonly beats: readonly ShotPlanTemporalBeat[];
  readonly lightingStyle: LightingStyle;
  readonly environmentDescription: string;
  readonly colorPalette: readonly string[];
  readonly atmosphere?: string | null;
  readonly dialogue?: ShotPlanDialogueIntent | null;
  readonly continuity: ShotPlanContinuityConstraints;
  readonly previs?: ShotPlanPrevisAssociation | null;
  readonly machineModel?: string | null;
  readonly createdAt: string;
  readonly updatedAt: string;
}

export interface ShotPlanCreateInput {
  readonly id: ShotPlanId;
  readonly sceneId: SceneId;
  readonly specRevision: number;
  readonly variantOrdinal: number;
  readonly status?: ShotPlanStatus;
  readonly routingMode?: ShotPlanRoutingMode;
  readonly targetDurationMs: number;
  readonly targetFrameCount: number;
  readonly durationToleranceMs?: number;
  readonly fps?: 24;
  readonly framing: ShotFraming;
  readonly angle: CameraAngle;
  readonly lensIntent: string;
  readonly cameraPosition: string;
  readonly cameraMovement: CameraMovement;
  readonly movementSpeed: MovementSpeed;
  readonly cameraPromptDescription: string;
  readonly subjects?: readonly ShotPlanSubjectBlocking[];
  readonly actionSummary: string;
  readonly beats?: readonly ShotPlanTemporalBeat[];
  readonly lightingStyle: LightingStyle;
  readonly environmentDescription: string;
  readonly colorPalette?: readonly string[];
  readonly atmosphere?: string | null;
  readonly dialogue?: ShotPlanDialogueIntent | null;
  readonly continuity?: ShotPlanContinuityConstraints;
  readonly previs?: ShotPlanPrevisAssociation | null;
  readonly machineModel?: string | null;
  readonly createdAt?: string;
  readonly updatedAt?: string;
}

export class ShotPlanValidationError extends Error {
  override readonly name = "ShotPlanValidationError";
  constructor(message: string) {
    super(message);
  }
}

function validateBeats(
  beats: readonly ShotPlanTemporalBeat[],
  targetDurationMs: number,
  durationToleranceMs: number
): void {
  for (let i = 0; i < beats.length; i++) {
    const beat = beats[i]!;
    if (!Number.isInteger(beat.beatIndex) || beat.beatIndex <= 0) {
      throw new ShotPlanValidationError(
        `Beat at index ${i} must have a positive integer beatIndex`
      );
    }
    if (!Number.isFinite(beat.startMs) || beat.startMs < 0) {
      throw new ShotPlanValidationError(`Beat ${beat.beatIndex} must have a non-negative startMs`);
    }
    if (!Number.isFinite(beat.endMs) || beat.endMs <= beat.startMs) {
      throw new ShotPlanValidationError(
        `Beat ${beat.beatIndex} endMs (${beat.endMs}) must be strictly greater than startMs (${beat.startMs})`
      );
    }
    if (i > 0) {
      const prevBeat = beats[i - 1]!;
      if (beat.beatIndex <= prevBeat.beatIndex) {
        throw new ShotPlanValidationError(
          `Beat indices must be strictly increasing: ${prevBeat.beatIndex} -> ${beat.beatIndex}`
        );
      }
      if (beat.startMs < prevBeat.endMs) {
        throw new ShotPlanValidationError(
          `Beat ${beat.beatIndex} overlaps previous beat: startMs ${beat.startMs} < prev endMs ${prevBeat.endMs}`
        );
      }
    }
    if (beat.endMs > targetDurationMs + durationToleranceMs) {
      throw new ShotPlanValidationError(
        `Beat ${beat.beatIndex} endMs (${beat.endMs}) exceeds targetDurationMs (${targetDurationMs}) + tolerance (${durationToleranceMs})`
      );
    }
  }
}

export class ShotPlan {
  readonly #id: ShotPlanId;
  readonly #sceneId: SceneId;
  readonly #specRevision: number;
  readonly #variantOrdinal: number;
  #status: ShotPlanStatus;
  readonly #routingMode: ShotPlanRoutingMode;
  readonly #targetDurationMs: number;
  readonly #targetFrameCount: number;
  readonly #durationToleranceMs: number;
  readonly #fps: 24;
  readonly #framing: ShotFraming;
  readonly #angle: CameraAngle;
  readonly #lensIntent: string;
  readonly #cameraPosition: string;
  readonly #cameraMovement: CameraMovement;
  readonly #movementSpeed: MovementSpeed;
  readonly #cameraPromptDescription: string;
  readonly #subjects: readonly ShotPlanSubjectBlocking[];
  readonly #actionSummary: string;
  readonly #beats: readonly ShotPlanTemporalBeat[];
  readonly #lightingStyle: LightingStyle;
  readonly #environmentDescription: string;
  readonly #colorPalette: readonly string[];
  readonly #atmosphere?: string | null;
  readonly #dialogue?: ShotPlanDialogueIntent | null;
  readonly #continuity: ShotPlanContinuityConstraints;
  #previs?: ShotPlanPrevisAssociation | null;
  readonly #machineModel?: string | null;
  readonly #createdAt: string;
  #updatedAt: string;

  private constructor(input: ShotPlanSnapshot) {
    this.#id = input.id;
    this.#sceneId = input.sceneId;
    this.#specRevision = input.specRevision;
    this.#variantOrdinal = input.variantOrdinal;
    this.#status = input.status;
    this.#routingMode = input.routingMode;
    this.#targetDurationMs = input.targetDurationMs;
    this.#targetFrameCount = input.targetFrameCount;
    this.#durationToleranceMs = input.durationToleranceMs;
    this.#fps = input.fps;
    this.#framing = input.framing;
    this.#angle = input.angle;
    this.#lensIntent = input.lensIntent;
    this.#cameraPosition = input.cameraPosition;
    this.#cameraMovement = input.cameraMovement;
    this.#movementSpeed = input.movementSpeed;
    this.#cameraPromptDescription = input.cameraPromptDescription;
    this.#subjects = Object.freeze([...input.subjects]);
    this.#actionSummary = input.actionSummary;
    this.#beats = Object.freeze([...input.beats]);
    this.#lightingStyle = input.lightingStyle;
    this.#environmentDescription = input.environmentDescription;
    this.#colorPalette = Object.freeze([...input.colorPalette]);
    this.#atmosphere = input.atmosphere ?? null;
    this.#dialogue = input.dialogue ? Object.freeze({ ...input.dialogue }) : null;
    this.#continuity = Object.freeze({ ...input.continuity });
    this.#previs = input.previs ? Object.freeze({ ...input.previs }) : null;
    this.#machineModel = input.machineModel ?? null;
    this.#createdAt = input.createdAt;
    this.#updatedAt = input.updatedAt;
  }

  static create(input: ShotPlanCreateInput): ShotPlan {
    if (!Number.isInteger(input.variantOrdinal) || input.variantOrdinal <= 0) {
      throw new ShotPlanValidationError("variantOrdinal must be a positive integer");
    }
    if (!Number.isInteger(input.specRevision) || input.specRevision <= 0) {
      throw new ShotPlanValidationError("specRevision must be a positive integer");
    }
    if (!Number.isFinite(input.targetDurationMs) || input.targetDurationMs <= 0) {
      throw new ShotPlanValidationError("targetDurationMs must be a positive finite number");
    }
    if (!Number.isInteger(input.targetFrameCount) || input.targetFrameCount <= 0) {
      throw new ShotPlanValidationError("targetFrameCount must be a positive integer");
    }

    const tolerance = input.durationToleranceMs ?? 355;
    const beats = input.beats ?? [];
    validateBeats(beats, input.targetDurationMs, tolerance);

    const now = new Date().toISOString();
    const continuity: ShotPlanContinuityConstraints = input.continuity ?? {
      incomingContinuityFromSceneId: null,
      persistentSubjectIds: [],
      lightingContinuityNote: null,
      frameAnchorTarget: "none",
      anchorCandidateId: null,
      anchorMediaHashSha256: null
    };

    return new ShotPlan({
      id: input.id,
      sceneId: input.sceneId,
      specRevision: input.specRevision,
      variantOrdinal: input.variantOrdinal,
      status: input.status ?? "draft",
      routingMode: input.routingMode ?? "reference_directed",
      targetDurationMs: input.targetDurationMs,
      targetFrameCount: input.targetFrameCount,
      durationToleranceMs: tolerance,
      fps: input.fps ?? 24,
      framing: input.framing,
      angle: input.angle,
      lensIntent: input.lensIntent,
      cameraPosition: input.cameraPosition,
      cameraMovement: input.cameraMovement,
      movementSpeed: input.movementSpeed,
      cameraPromptDescription: input.cameraPromptDescription,
      subjects: input.subjects ?? [],
      actionSummary: input.actionSummary,
      beats,
      lightingStyle: input.lightingStyle,
      environmentDescription: input.environmentDescription,
      colorPalette: input.colorPalette ?? [],
      atmosphere: input.atmosphere ?? null,
      dialogue: input.dialogue ?? null,
      continuity,
      previs: input.previs ?? null,
      machineModel: input.machineModel ?? null,
      createdAt: input.createdAt ?? now,
      updatedAt: input.updatedAt ?? now
    });
  }

  static reconstitute(snapshot: ShotPlanSnapshot): ShotPlan {
    return new ShotPlan(snapshot);
  }

  get id(): ShotPlanId {
    return this.#id;
  }

  get sceneId(): SceneId {
    return this.#sceneId;
  }

  get specRevision(): number {
    return this.#specRevision;
  }

  get variantOrdinal(): number {
    return this.#variantOrdinal;
  }

  get status(): ShotPlanStatus {
    return this.#status;
  }

  get routingMode(): ShotPlanRoutingMode {
    return this.#routingMode;
  }

  get targetDurationMs(): number {
    return this.#targetDurationMs;
  }

  get targetFrameCount(): number {
    return this.#targetFrameCount;
  }

  get durationToleranceMs(): number {
    return this.#durationToleranceMs;
  }

  get fps(): 24 {
    return this.#fps;
  }

  get framing(): ShotFraming {
    return this.#framing;
  }

  get angle(): CameraAngle {
    return this.#angle;
  }

  get lensIntent(): string {
    return this.#lensIntent;
  }

  get cameraPosition(): string {
    return this.#cameraPosition;
  }

  get cameraMovement(): CameraMovement {
    return this.#cameraMovement;
  }

  get movementSpeed(): MovementSpeed {
    return this.#movementSpeed;
  }

  get cameraPromptDescription(): string {
    return this.#cameraPromptDescription;
  }

  get subjects(): readonly ShotPlanSubjectBlocking[] {
    return this.#subjects;
  }

  get actionSummary(): string {
    return this.#actionSummary;
  }

  get beats(): readonly ShotPlanTemporalBeat[] {
    return this.#beats;
  }

  get lightingStyle(): LightingStyle {
    return this.#lightingStyle;
  }

  get environmentDescription(): string {
    return this.#environmentDescription;
  }

  get colorPalette(): readonly string[] {
    return this.#colorPalette;
  }

  get atmosphere(): string | null | undefined {
    return this.#atmosphere;
  }

  get dialogue(): ShotPlanDialogueIntent | null | undefined {
    return this.#dialogue;
  }

  get continuity(): ShotPlanContinuityConstraints {
    return this.#continuity;
  }

  get previs(): ShotPlanPrevisAssociation | null | undefined {
    return this.#previs;
  }

  get machineModel(): string | null | undefined {
    return this.#machineModel;
  }

  get createdAt(): string {
    return this.#createdAt;
  }

  get updatedAt(): string {
    return this.#updatedAt;
  }

  approve(): void {
    if (this.#status !== "draft") {
      throw new Error(`Cannot transition ShotPlan from '${this.#status}' to 'approved'.`);
    }
    this.#status = "approved";
    this.#updatedAt = new Date().toISOString();
  }

  supersede(): void {
    if (this.#status !== "draft" && this.#status !== "approved") {
      throw new Error(`Cannot transition ShotPlan from '${this.#status}' to 'superseded'.`);
    }
    this.#status = "superseded";
    this.#updatedAt = new Date().toISOString();
  }

  reject(): void {
    if (this.#status !== "draft") {
      throw new Error(`Cannot transition ShotPlan from '${this.#status}' to 'rejected'.`);
    }
    this.#status = "rejected";
    this.#updatedAt = new Date().toISOString();
  }

  attachPrevis(previs: ShotPlanPrevisAssociation): void {
    this.#previs = Object.freeze({ ...previs });
    this.#updatedAt = new Date().toISOString();
  }

  snapshot(): Readonly<ShotPlanSnapshot> {
    return Object.freeze({
      id: this.#id,
      sceneId: this.#sceneId,
      specRevision: this.#specRevision,
      variantOrdinal: this.#variantOrdinal,
      status: this.#status,
      routingMode: this.#routingMode,
      targetDurationMs: this.#targetDurationMs,
      targetFrameCount: this.#targetFrameCount,
      durationToleranceMs: this.#durationToleranceMs,
      fps: this.#fps,
      framing: this.#framing,
      angle: this.#angle,
      lensIntent: this.#lensIntent,
      cameraPosition: this.#cameraPosition,
      cameraMovement: this.#cameraMovement,
      movementSpeed: this.#movementSpeed,
      cameraPromptDescription: this.#cameraPromptDescription,
      subjects: this.#subjects,
      actionSummary: this.#actionSummary,
      beats: this.#beats,
      lightingStyle: this.#lightingStyle,
      environmentDescription: this.#environmentDescription,
      colorPalette: this.#colorPalette,
      ...(this.#atmosphere !== undefined ? { atmosphere: this.#atmosphere } : {}),
      ...(this.#dialogue !== undefined ? { dialogue: this.#dialogue } : {}),
      continuity: this.#continuity,
      ...(this.#previs !== undefined ? { previs: this.#previs } : {}),
      ...(this.#machineModel !== undefined ? { machineModel: this.#machineModel } : {}),
      createdAt: this.#createdAt,
      updatedAt: this.#updatedAt
    });
  }
}
