import {
  ReviewCommandSchema,
  type ReviewAction,
  type ReviewCommand,
  type ReviewCommandResponse,
  type ReviewErrorResponse,
  type SceneReviewDetailReadModel
} from "@cco/contracts";

export type ReviewCommandPhase =
  | "idle"
  | "drafting"
  | "confirming"
  | "submitting"
  | "succeeded-syncing"
  | "stale-conflict"
  | "definitive-error"
  | "indeterminate-error";

export interface FrozenIntent {
  readonly command: ReviewCommand;
  readonly displayLabel: string;
}

export interface ReviewCommandDraft {
  readonly action: ReviewAction;
  readonly payload?: Record<string, unknown> | undefined;
  readonly displayLabel: string;
  readonly directorNotes?: string | undefined;
}

export interface IdleState {
  readonly phase: "idle";
  readonly detail: SceneReviewDetailReadModel;
}

export interface DraftingState {
  readonly phase: "drafting";
  readonly detail: SceneReviewDetailReadModel;
  readonly draft: ReviewCommandDraft;
}

export interface ConfirmingState {
  readonly phase: "confirming";
  readonly detail: SceneReviewDetailReadModel;
  readonly stagedAction: ReviewCommandDraft;
  readonly draft?: ReviewCommandDraft | undefined;
}

export interface SubmittingState {
  readonly phase: "submitting";
  readonly detail: SceneReviewDetailReadModel;
  readonly frozenIntent: FrozenIntent;
}

export interface SucceededSyncingState {
  readonly phase: "succeeded-syncing";
  readonly detail: SceneReviewDetailReadModel;
  readonly lastResponse: ReviewCommandResponse;
  readonly refreshError?: string | undefined;
}

export interface StaleConflictState {
  readonly phase: "stale-conflict";
  readonly detail: SceneReviewDetailReadModel;
  readonly expectedRevision: number;
  readonly currentRevision: number;
  readonly rejectedAction: ReviewAction;
  readonly displayLabel: string;
  readonly message?: string | undefined;
}

export interface DefinitiveErrorState {
  readonly phase: "definitive-error";
  readonly detail: SceneReviewDetailReadModel;
  readonly statusCode: number;
  readonly error: ReviewErrorResponse;
  readonly displayLabel?: string | undefined;
  readonly draft?: ReviewCommandDraft | undefined;
}

export interface IndeterminateErrorState {
  readonly phase: "indeterminate-error";
  readonly detail: SceneReviewDetailReadModel;
  readonly frozenIntent: FrozenIntent;
  readonly message: string;
  readonly statusCode?: number | undefined;
}

export type ReviewCommandState =
  | IdleState
  | DraftingState
  | ConfirmingState
  | SubmittingState
  | SucceededSyncingState
  | StaleConflictState
  | DefinitiveErrorState
  | IndeterminateErrorState;

export type ReviewCommandEffect =
  | { readonly type: "none" }
  | { readonly type: "submit"; readonly command: ReviewCommand }
  | { readonly type: "refresh"; readonly sceneId: string };

export type ReviewCommandEvent =
  | { readonly type: "START_DRAFT"; readonly draft: ReviewCommandDraft }
  | { readonly type: "UPDATE_DRAFT"; readonly draft: ReviewCommandDraft }
  | { readonly type: "CANCEL_DRAFT" }
  | {
      readonly type: "REQUEST_CONFIRMATION";
      readonly stagedAction?: ReviewCommandDraft | undefined;
    }
  | { readonly type: "CANCEL_CONFIRMATION" }
  | { readonly type: "CONFIRM"; readonly actionId: string }
  | { readonly type: "SUBMIT_SUCCESS"; readonly response: ReviewCommandResponse }
  | {
      readonly type: "SUBMIT_STALE_CONFLICT";
      readonly expectedRevision: number;
      readonly currentRevision: number;
      readonly message?: string | undefined;
    }
  | {
      readonly type: "SUBMIT_DEFINITIVE_ERROR";
      readonly statusCode: number;
      readonly error: ReviewErrorResponse;
    }
  | {
      readonly type: "SUBMIT_INDETERMINATE_ERROR";
      readonly message: string;
      readonly statusCode?: number | undefined;
    }
  | { readonly type: "RETRY" }
  | { readonly type: "DISMISS_ERROR" }
  | { readonly type: "LOAD_STALE_REVISION" }
  | { readonly type: "REFRESH_SUCCESS"; readonly detail: SceneReviewDetailReadModel }
  | { readonly type: "REFRESH_FAILURE"; readonly error: string }
  | { readonly type: "REQUEST_REFRESH" };

export interface TransitionResult {
  readonly state: ReviewCommandState;
  readonly effect: ReviewCommandEffect;
}

export function createInitialState(detail: SceneReviewDetailReadModel): IdleState {
  return {
    phase: "idle",
    detail
  };
}

export function createReviewCommand(
  detail: SceneReviewDetailReadModel,
  staged: ReviewCommandDraft,
  actionId: string
): ReviewCommand {
  const unvalidated = {
    actionId,
    sceneId: detail.sceneId,
    expectedSpecRevision: detail.specRevision,
    action: staged.action,
    payload: staged.payload ?? {},
    ...(staged.directorNotes !== undefined ? { directorNotes: staged.directorNotes } : {})
  };
  return ReviewCommandSchema.parse(unvalidated);
}

export function mergeCompactResponse(
  currentDetail: SceneReviewDetailReadModel,
  response: ReviewCommandResponse
): SceneReviewDetailReadModel {
  let selectedCandidateRevision: number | undefined = undefined;
  if (response.selectedCandidateId !== undefined) {
    if (response.selectedCandidateId === currentDetail.selectedCandidateId) {
      selectedCandidateRevision = currentDetail.selectedCandidateRevision;
    } else {
      const matchingGroup = currentDetail.candidatesByRevision?.find((group) =>
        group.candidates.some((c) => c.candidateId === response.selectedCandidateId)
      );
      selectedCandidateRevision =
        matchingGroup?.specRevision ?? currentDetail.selectedCandidateRevision;
    }
  }
  return {
    ...currentDetail,
    status: response.status,
    specRevision: response.specRevision,
    selectedCandidateId: response.selectedCandidateId,
    selectedCandidateRevision,
    approval: response.approval
  };
}

export function areCommandsDisabled(state: ReviewCommandState): boolean {
  switch (state.phase) {
    case "submitting":
    case "succeeded-syncing":
    case "stale-conflict":
      return true;
    case "idle":
    case "drafting":
    case "confirming":
    case "definitive-error":
    case "indeterminate-error":
      return false;
  }
}

export function transitionReviewCommandState(
  state: ReviewCommandState,
  event: ReviewCommandEvent
): TransitionResult {
  switch (state.phase) {
    case "idle": {
      switch (event.type) {
        case "START_DRAFT":
          return {
            state: {
              phase: "drafting",
              detail: state.detail,
              draft: event.draft
            },
            effect: { type: "none" }
          };
        case "REQUEST_CONFIRMATION": {
          if (!event.stagedAction) {
            return { state, effect: { type: "none" } };
          }
          return {
            state: {
              phase: "confirming",
              detail: state.detail,
              stagedAction: event.stagedAction
            },
            effect: { type: "none" }
          };
        }
        case "REQUEST_REFRESH":
          return {
            state,
            effect: { type: "refresh", sceneId: state.detail.sceneId }
          };
        case "REFRESH_SUCCESS":
          return {
            state: {
              phase: "idle",
              detail: event.detail
            },
            effect: { type: "none" }
          };
        default:
          return { state, effect: { type: "none" } };
      }
    }

    case "drafting": {
      switch (event.type) {
        case "START_DRAFT":
        case "UPDATE_DRAFT":
          return {
            state: {
              phase: "drafting",
              detail: state.detail,
              draft: event.draft
            },
            effect: { type: "none" }
          };
        case "CANCEL_DRAFT":
          return {
            state: {
              phase: "idle",
              detail: state.detail
            },
            effect: { type: "none" }
          };
        case "REQUEST_CONFIRMATION": {
          const staged = event.stagedAction ?? state.draft;
          return {
            state: {
              phase: "confirming",
              detail: state.detail,
              stagedAction: staged,
              draft: state.draft
            },
            effect: { type: "none" }
          };
        }
        case "REQUEST_REFRESH":
          return {
            state,
            effect: { type: "refresh", sceneId: state.detail.sceneId }
          };
        case "REFRESH_SUCCESS":
          return {
            state: {
              phase: "drafting",
              detail: event.detail,
              draft: state.draft
            },
            effect: { type: "none" }
          };
        default:
          return { state, effect: { type: "none" } };
      }
    }

    case "confirming": {
      switch (event.type) {
        case "CANCEL_CONFIRMATION": {
          if (state.draft) {
            return {
              state: {
                phase: "drafting",
                detail: state.detail,
                draft: state.draft
              },
              effect: { type: "none" }
            };
          }
          return {
            state: {
              phase: "idle",
              detail: state.detail
            },
            effect: { type: "none" }
          };
        }
        case "CONFIRM": {
          const command = createReviewCommand(state.detail, state.stagedAction, event.actionId);
          const frozenIntent: FrozenIntent = {
            command,
            displayLabel: state.stagedAction.displayLabel
          };
          return {
            state: {
              phase: "submitting",
              detail: state.detail,
              frozenIntent
            },
            effect: {
              type: "submit",
              command
            }
          };
        }
        default:
          return { state, effect: { type: "none" } };
      }
    }

    case "submitting": {
      switch (event.type) {
        case "CONFIRM":
          // Invariant: pending submission ignores a second local submit
          return { state, effect: { type: "none" } };
        case "SUBMIT_SUCCESS": {
          const mergedDetail = mergeCompactResponse(state.detail, event.response);
          return {
            state: {
              phase: "succeeded-syncing",
              detail: mergedDetail,
              lastResponse: event.response
            },
            effect: {
              type: "refresh",
              sceneId: state.detail.sceneId
            }
          };
        }
        case "SUBMIT_STALE_CONFLICT":
          return {
            state: {
              phase: "stale-conflict",
              detail: state.detail,
              expectedRevision: event.expectedRevision,
              currentRevision: event.currentRevision,
              rejectedAction: state.frozenIntent.command.action,
              displayLabel: state.frozenIntent.displayLabel,
              message: event.message
            },
            effect: { type: "none" }
          };
        case "SUBMIT_DEFINITIVE_ERROR":
          return {
            state: {
              phase: "definitive-error",
              detail: state.detail,
              statusCode: event.statusCode,
              error: event.error,
              displayLabel: state.frozenIntent.displayLabel
            },
            effect: { type: "none" }
          };
        case "SUBMIT_INDETERMINATE_ERROR":
          return {
            state: {
              phase: "indeterminate-error",
              detail: state.detail,
              frozenIntent: state.frozenIntent,
              message: event.message,
              statusCode: event.statusCode
            },
            effect: { type: "none" }
          };
        default:
          return { state, effect: { type: "none" } };
      }
    }

    case "succeeded-syncing": {
      switch (event.type) {
        case "REFRESH_SUCCESS":
          return {
            state: {
              phase: "idle",
              detail: event.detail
            },
            effect: { type: "none" }
          };
        case "REFRESH_FAILURE":
          return {
            state: {
              ...state,
              refreshError: event.error
            },
            effect: { type: "none" }
          };
        case "REQUEST_REFRESH":
          return {
            state,
            effect: {
              type: "refresh",
              sceneId: state.detail.sceneId
            }
          };
        default:
          return { state, effect: { type: "none" } };
      }
    }

    case "stale-conflict": {
      switch (event.type) {
        case "LOAD_STALE_REVISION":
        case "REQUEST_REFRESH":
          return {
            state: {
              phase: "idle",
              detail: state.detail
            },
            effect: {
              type: "refresh",
              sceneId: state.detail.sceneId
            }
          };
        case "RETRY":
          return { state, effect: { type: "none" } };
        default:
          return { state, effect: { type: "none" } };
      }
    }

    case "definitive-error": {
      switch (event.type) {
        case "DISMISS_ERROR":
          return {
            state: {
              phase: "idle",
              detail: state.detail
            },
            effect: { type: "none" }
          };
        case "START_DRAFT":
          return {
            state: {
              phase: "drafting",
              detail: state.detail,
              draft: event.draft
            },
            effect: { type: "none" }
          };
        case "RETRY":
          return { state, effect: { type: "none" } };
        default:
          return { state, effect: { type: "none" } };
      }
    }

    case "indeterminate-error": {
      switch (event.type) {
        case "RETRY":
          return {
            state: {
              phase: "submitting",
              detail: state.detail,
              frozenIntent: state.frozenIntent
            },
            effect: {
              type: "submit",
              command: state.frozenIntent.command
            }
          };
        case "DISMISS_ERROR":
        case "CANCEL_DRAFT":
          return {
            state: {
              phase: "idle",
              detail: state.detail
            },
            effect: { type: "none" }
          };
        case "START_DRAFT":
          return {
            state: {
              phase: "drafting",
              detail: state.detail,
              draft: event.draft
            },
            effect: { type: "none" }
          };
        default:
          return { state, effect: { type: "none" } };
      }
    }
  }
}
