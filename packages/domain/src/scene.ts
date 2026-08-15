export const SCENE_STATUSES = [
  "draft_pending",
  "generating_candidates",
  "director_review",
  "approved",
  "queued",
  "rendering",
  "qa",
  "completed",
  "failed",
  "cancelled"
] as const;

export type SceneStatus = (typeof SCENE_STATUSES)[number];

declare const SceneIdBrand: unique symbol;
export type SceneId = string & { readonly [SceneIdBrand]: true };

declare const CampaignIdBrand: unique symbol;
export type CampaignId = string & { readonly [CampaignIdBrand]: true };

export interface SceneConfiguration {
  readonly prompt: string;
  readonly referenceIds: readonly string[];
  readonly engineProfileId: string;
  readonly durationMs: number;
  readonly loraConfigurationId?: string;
}

export interface SceneCreateInput {
  readonly id: SceneId;
  readonly campaignId: CampaignId;
  readonly configuration: SceneConfiguration;
}

export interface SceneApproval {
  readonly revision: number;
  readonly approvedBy: string;
  readonly approvedAt: string;
}

export interface SceneApprovalInput {
  readonly approvedBy: string;
  readonly approvedAt: string;
}

export interface SceneSnapshot {
  readonly id: SceneId;
  readonly campaignId: CampaignId;
  readonly status: SceneStatus;
  readonly specRevision: number;
  readonly configuration: SceneConfiguration;
  readonly approval?: SceneApproval;
  readonly failedFrom?: SceneStatus;
}

export type SceneTransitionReason =
  | "candidate_generation_started"
  | "candidates_submitted"
  | "approved"
  | "reroll_requested"
  | "production_queued"
  | "rendering_started"
  | "submitted_for_qa"
  | "qa_accepted"
  | "qa_rejected"
  | "failed"
  | "recovered_to_review"
  | "cancelled"
  | "configuration_changed";

export interface SceneTransition {
  readonly sceneId: SceneId;
  readonly from: SceneStatus;
  readonly to: SceneStatus;
  readonly revision: number;
  readonly reason: SceneTransitionReason;
}

export class InvalidTransitionError extends Error {
  override readonly name = "InvalidTransitionError";
  readonly sceneId: SceneId;
  readonly currentStatus: SceneStatus;
  readonly attemptedAction: string;

  constructor(
    sceneId: SceneId,
    currentStatus: SceneStatus,
    attemptedAction: string,
    message?: string
  ) {
    super(
      message ??
        `Cannot perform '${attemptedAction}' on scene '${sceneId}' with status '${currentStatus}'.`
    );
    this.sceneId = sceneId;
    this.currentStatus = currentStatus;
    this.attemptedAction = attemptedAction;
  }
}

export class InvalidMutationError extends Error {
  override readonly name = "InvalidMutationError";
  readonly sceneId: SceneId;
  readonly currentStatus: SceneStatus;
  readonly field: string;

  constructor(sceneId: SceneId, currentStatus: SceneStatus, field: string, message?: string) {
    super(
      message ?? `Cannot mutate '${field}' on scene '${sceneId}' in status '${currentStatus}'.`
    );
    this.sceneId = sceneId;
    this.currentStatus = currentStatus;
    this.field = field;
  }
}

export class TerminalStateError extends Error {
  override readonly name = "TerminalStateError";
  readonly sceneId: SceneId;
  readonly terminalStatus: SceneStatus;
  readonly attemptedAction: string;

  constructor(
    sceneId: SceneId,
    terminalStatus: SceneStatus,
    attemptedAction: string,
    message?: string
  ) {
    super(
      message ??
        `Cannot perform '${attemptedAction}' on scene '${sceneId}' in terminal state '${terminalStatus}'.`
    );
    this.sceneId = sceneId;
    this.terminalStatus = terminalStatus;
    this.attemptedAction = attemptedAction;
  }
}

function freezeConfiguration(config: SceneConfiguration): Readonly<SceneConfiguration> {
  return Object.freeze({
    prompt: config.prompt,
    referenceIds: Object.freeze([...config.referenceIds]),
    engineProfileId: config.engineProfileId,
    durationMs: config.durationMs,
    ...(config.loraConfigurationId !== undefined
      ? { loraConfigurationId: config.loraConfigurationId }
      : {})
  });
}

export class Scene {
  readonly #id: SceneId;
  readonly #campaignId: CampaignId;
  readonly #status: SceneStatus;
  readonly #specRevision: number;
  readonly #configuration: Readonly<SceneConfiguration>;
  readonly #approval?: Readonly<SceneApproval>;
  readonly #failedFrom?: SceneStatus;

  private constructor(input: SceneCreateInput) {
    this.#id = input.id;
    this.#campaignId = input.campaignId;
    this.#status = "draft_pending";
    this.#specRevision = 1;
    this.#configuration = freezeConfiguration(input.configuration);
  }

  static create(input: SceneCreateInput): Scene {
    return new Scene(input);
  }

  get id(): SceneId {
    return this.#id;
  }

  get campaignId(): CampaignId {
    return this.#campaignId;
  }

  get status(): SceneStatus {
    return this.#status;
  }

  snapshot(): Readonly<SceneSnapshot> {
    return Object.freeze({
      id: this.#id,
      campaignId: this.#campaignId,
      status: this.#status,
      specRevision: this.#specRevision,
      configuration: this.#configuration,
      ...(this.#approval !== undefined ? { approval: this.#approval } : {}),
      ...(this.#failedFrom !== undefined ? { failedFrom: this.#failedFrom } : {})
    });
  }
}
