import type { CandidateId } from "./storyboard-candidate.js";

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
  readonly selectedCandidateId?: CandidateId;
  readonly selectedCandidateRevision?: number;
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
  | "configuration_changed"
  | "candidate_selected";

export interface SceneTransition {
  readonly sceneId: SceneId;
  readonly from: SceneStatus;
  readonly to: SceneStatus;
  readonly revision: number;
  readonly reason: SceneTransitionReason;
}

export class InvalidCandidateError extends Error {
  override readonly name = "InvalidCandidateError";
  readonly sceneId: SceneId;
  readonly candidateId: CandidateId;
  readonly reason: string;

  constructor(sceneId: SceneId, candidateId: CandidateId, reason: string) {
    super(`Candidate '${candidateId}' is invalid for scene '${sceneId}': ${reason}`);
    this.sceneId = sceneId;
    this.candidateId = candidateId;
    this.reason = reason;
  }
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
  #status: SceneStatus;
  #specRevision: number;
  #configuration: Readonly<SceneConfiguration>;
  #approval?: Readonly<SceneApproval> | undefined;
  #failedFrom?: SceneStatus | undefined;
  #selectedCandidateId?: CandidateId | undefined;
  #selectedCandidateRevision?: number | undefined;

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

  #isTerminal(): boolean {
    return this.#status === "completed" || this.#status === "cancelled";
  }

  #transition(
    actionName: string,
    allowedSources: readonly SceneStatus[],
    targetStatus: SceneStatus,
    reason: SceneTransitionReason,
    onSuccess?: () => void
  ): SceneTransition {
    if (this.#isTerminal()) {
      throw new TerminalStateError(this.#id, this.#status, actionName);
    }

    if (!allowedSources.includes(this.#status)) {
      throw new InvalidTransitionError(this.#id, this.#status, actionName);
    }

    const from = this.#status;
    this.#status = targetStatus;

    if (from === "failed") {
      this.#failedFrom = undefined;
    }

    if (onSuccess) {
      onSuccess();
    }

    return Object.freeze({
      sceneId: this.#id,
      from,
      to: targetStatus,
      revision: this.#specRevision,
      reason
    });
  }

  #updateConfiguration(
    actionName: string,
    field: string,
    newConfig: SceneConfiguration
  ): SceneTransition {
    if (this.#isTerminal()) {
      throw new TerminalStateError(this.#id, this.#status, actionName);
    }

    const editableStatuses: readonly SceneStatus[] = [
      "draft_pending",
      "director_review",
      "approved"
    ];

    if (!editableStatuses.includes(this.#status)) {
      throw new InvalidMutationError(this.#id, this.#status, field);
    }

    const frozenConfig = freezeConfiguration(newConfig);
    const from = this.#status;
    const to: SceneStatus = from === "approved" ? "director_review" : from;
    const newRevision = this.#specRevision + 1;

    this.#configuration = frozenConfig;
    this.#specRevision = newRevision;
    this.#status = to;
    this.#selectedCandidateId = undefined;
    this.#selectedCandidateRevision = undefined;
    if (from === "approved") {
      this.#approval = undefined;
    }

    return Object.freeze({
      sceneId: this.#id,
      from,
      to,
      revision: newRevision,
      reason: "configuration_changed"
    });
  }

  updatePrompt(prompt: string): SceneTransition {
    return this.#updateConfiguration("updatePrompt", "prompt", {
      prompt,
      referenceIds: this.#configuration.referenceIds,
      engineProfileId: this.#configuration.engineProfileId,
      durationMs: this.#configuration.durationMs,
      ...(this.#configuration.loraConfigurationId !== undefined
        ? { loraConfigurationId: this.#configuration.loraConfigurationId }
        : {})
    });
  }

  updateReferences(referenceIds: readonly string[]): SceneTransition {
    return this.#updateConfiguration("updateReferences", "references", {
      prompt: this.#configuration.prompt,
      referenceIds: [...referenceIds],
      engineProfileId: this.#configuration.engineProfileId,
      durationMs: this.#configuration.durationMs,
      ...(this.#configuration.loraConfigurationId !== undefined
        ? { loraConfigurationId: this.#configuration.loraConfigurationId }
        : {})
    });
  }

  updateEngine(engineProfileId: string): SceneTransition {
    return this.#updateConfiguration("updateEngine", "engine", {
      prompt: this.#configuration.prompt,
      referenceIds: this.#configuration.referenceIds,
      engineProfileId,
      durationMs: this.#configuration.durationMs,
      ...(this.#configuration.loraConfigurationId !== undefined
        ? { loraConfigurationId: this.#configuration.loraConfigurationId }
        : {})
    });
  }

  updateDuration(durationMs: number): SceneTransition {
    return this.#updateConfiguration("updateDuration", "duration", {
      prompt: this.#configuration.prompt,
      referenceIds: this.#configuration.referenceIds,
      engineProfileId: this.#configuration.engineProfileId,
      durationMs,
      ...(this.#configuration.loraConfigurationId !== undefined
        ? { loraConfigurationId: this.#configuration.loraConfigurationId }
        : {})
    });
  }

  updateLora(loraConfigurationId?: string): SceneTransition {
    return this.#updateConfiguration("updateLora", "lora", {
      prompt: this.#configuration.prompt,
      referenceIds: this.#configuration.referenceIds,
      engineProfileId: this.#configuration.engineProfileId,
      durationMs: this.#configuration.durationMs,
      ...(loraConfigurationId !== undefined ? { loraConfigurationId } : {})
    });
  }

  beginCandidateGeneration(): SceneTransition {
    return this.#transition(
      "beginCandidateGeneration",
      ["draft_pending", "director_review"],
      "generating_candidates",
      "candidate_generation_started"
    );
  }

  submitCandidatesForReview(): SceneTransition {
    return this.#transition(
      "submitCandidatesForReview",
      ["generating_candidates"],
      "director_review",
      "candidates_submitted"
    );
  }

  selectCandidate(
    candidateId: CandidateId,
    candidateRevision: number,
    candidateSceneId: SceneId
  ): SceneTransition {
    if (this.#isTerminal()) {
      throw new TerminalStateError(this.#id, this.#status, "selectCandidate");
    }

    if (this.#status !== "director_review") {
      throw new InvalidTransitionError(this.#id, this.#status, "selectCandidate");
    }

    if (candidateSceneId !== this.#id) {
      throw new InvalidCandidateError(
        this.#id,
        candidateId,
        "Candidate belongs to a different scene"
      );
    }

    if (candidateRevision !== this.#specRevision) {
      throw new InvalidCandidateError(
        this.#id,
        candidateId,
        "Candidate revision does not match current scene revision"
      );
    }

    return this.#transition(
      "selectCandidate",
      ["director_review"],
      "director_review",
      "candidate_selected",
      () => {
        this.#selectedCandidateId = candidateId;
        this.#selectedCandidateRevision = candidateRevision;
      }
    );
  }

  approve(input: SceneApprovalInput): SceneTransition {
    if (this.#isTerminal()) {
      throw new TerminalStateError(this.#id, this.#status, "approve");
    }

    if (this.#status !== "director_review") {
      throw new InvalidTransitionError(this.#id, this.#status, "approve");
    }

    if (
      this.#selectedCandidateId === undefined ||
      this.#selectedCandidateRevision !== this.#specRevision
    ) {
      throw new InvalidTransitionError(
        this.#id,
        this.#status,
        "approve",
        `Approval requires a valid candidate selection from revision ${this.#specRevision}.`
      );
    }

    const approval: Readonly<SceneApproval> = Object.freeze({
      revision: this.#specRevision,
      approvedBy: input.approvedBy,
      approvedAt: input.approvedAt
    });

    return this.#transition("approve", ["director_review"], "approved", "approved", () => {
      this.#approval = approval;
    });
  }

  requestReroll(): SceneTransition {
    return this.#transition(
      "requestReroll",
      ["director_review"],
      "generating_candidates",
      "reroll_requested",
      () => {
        this.#selectedCandidateId = undefined;
        this.#selectedCandidateRevision = undefined;
      }
    );
  }

  queueForProduction(): SceneTransition {
    if (this.#isTerminal()) {
      throw new TerminalStateError(this.#id, this.#status, "queueForProduction");
    }

    if (this.#status === "failed") {
      const allowedFailedFrom: readonly SceneStatus[] = ["queued", "rendering", "qa"];
      const isRecoverableProductionFailure =
        this.#failedFrom !== undefined &&
        allowedFailedFrom.includes(this.#failedFrom) &&
        this.#approval !== undefined &&
        this.#approval.revision === this.#specRevision;

      if (!isRecoverableProductionFailure) {
        throw new InvalidTransitionError(this.#id, this.#status, "queueForProduction");
      }
    } else if (this.#status !== "approved") {
      throw new InvalidTransitionError(this.#id, this.#status, "queueForProduction");
    }

    return this.#transition(
      "queueForProduction",
      ["approved", "failed"],
      "queued",
      "production_queued"
    );
  }

  startRendering(): SceneTransition {
    return this.#transition("startRendering", ["queued"], "rendering", "rendering_started");
  }

  submitForQA(): SceneTransition {
    return this.#transition("submitForQA", ["rendering"], "qa", "submitted_for_qa");
  }

  acceptQA(): SceneTransition {
    return this.#transition("acceptQA", ["qa"], "completed", "qa_accepted");
  }

  rejectQA(): SceneTransition {
    return this.#transition("rejectQA", ["qa"], "director_review", "qa_rejected", () => {
      this.#approval = undefined;
    });
  }

  fail(): SceneTransition {
    if (this.#isTerminal()) {
      throw new TerminalStateError(this.#id, this.#status, "fail");
    }

    const allowedSources: readonly SceneStatus[] = [
      "generating_candidates",
      "queued",
      "rendering",
      "qa"
    ];

    if (!allowedSources.includes(this.#status)) {
      throw new InvalidTransitionError(this.#id, this.#status, "fail");
    }

    const failedSource = this.#status;
    return this.#transition("fail", allowedSources, "failed", "failed", () => {
      this.#failedFrom = failedSource;
    });
  }

  recoverToReview(): SceneTransition {
    return this.#transition(
      "recoverToReview",
      ["failed"],
      "director_review",
      "recovered_to_review",
      () => {
        this.#approval = undefined;
      }
    );
  }

  cancel(): SceneTransition {
    return this.#transition(
      "cancel",
      [
        "draft_pending",
        "generating_candidates",
        "director_review",
        "approved",
        "queued",
        "rendering",
        "failed"
      ],
      "cancelled",
      "cancelled"
    );
  }

  snapshot(): Readonly<SceneSnapshot> {
    return Object.freeze({
      id: this.#id,
      campaignId: this.#campaignId,
      status: this.#status,
      specRevision: this.#specRevision,
      configuration: this.#configuration,
      ...(this.#approval !== undefined ? { approval: this.#approval } : {}),
      ...(this.#failedFrom !== undefined ? { failedFrom: this.#failedFrom } : {}),
      ...(this.#selectedCandidateId !== undefined
        ? { selectedCandidateId: this.#selectedCandidateId }
        : {}),
      ...(this.#selectedCandidateRevision !== undefined
        ? { selectedCandidateRevision: this.#selectedCandidateRevision }
        : {})
    });
  }
}
