import {
  MIN_SCENE_COUNT,
  MAX_SCENE_COUNT,
  MIN_TARGET_DURATION_MS,
  MAX_TARGET_DURATION_MS,
  PlanCampaignStoryboardRequestSchema,
  canonicalizeCampaignRequest,
  type PlanCampaignStoryboardErrorResponse,
  type PlanCampaignStoryboardRequest,
  type PlanCampaignStoryboardResponse
} from "@cco/contracts";
import type { z } from "zod";

export const MIN_TARGET_DURATION_SECONDS = Math.ceil(MIN_TARGET_DURATION_MS / 1000);
export const MAX_TARGET_DURATION_SECONDS = Math.floor(MAX_TARGET_DURATION_MS / 1000);
export { MIN_SCENE_COUNT, MAX_SCENE_COUNT, MIN_TARGET_DURATION_MS, MAX_TARGET_DURATION_MS };

export interface CampaignCreationFormValues {
  readonly title: string;
  readonly clientId: string;
  readonly targetPlatform: string;
  readonly durationSeconds: string | number;
  readonly sceneCountMode: "auto" | "custom";
  readonly sceneCountOverride: string | number;
  readonly briefDescription: string;
  readonly briefVisualStyle: string;
}

export const INITIAL_CAMPAIGN_FORM_VALUES: CampaignCreationFormValues = {
  title: "",
  clientId: "",
  targetPlatform: "",
  durationSeconds: "15",
  sceneCountMode: "auto",
  sceneCountOverride: "",
  briefDescription: "",
  briefVisualStyle: ""
};

export type CampaignCreationPhase =
  "idle" | "validation-failed" | "submitting" | "succeeded" | "submit-error";

export interface CampaignCreationError {
  readonly statusCode: number;
  readonly code?: string | undefined;
  readonly message: string;
  readonly details?: unknown | undefined;
  readonly isConflict: boolean;
}

export interface CommittedIntent {
  readonly idempotencyKey: string;
  readonly fingerprint: string;
}

export interface IdleState {
  readonly phase: "idle";
  readonly values: CampaignCreationFormValues;
  readonly fieldErrors: Record<string, string>;
  readonly committedIntent?: CommittedIntent | undefined;
}

export interface ValidationFailedState {
  readonly phase: "validation-failed";
  readonly values: CampaignCreationFormValues;
  readonly fieldErrors: Record<string, string>;
  readonly issues: readonly z.ZodIssue[];
  readonly committedIntent?: CommittedIntent | undefined;
}

export interface SubmittingState {
  readonly phase: "submitting";
  readonly values: CampaignCreationFormValues;
  readonly idempotencyKey: string;
  readonly request: PlanCampaignStoryboardRequest;
  readonly committedIntent?: CommittedIntent | undefined;
}

export interface SucceededState {
  readonly phase: "succeeded";
  readonly values: CampaignCreationFormValues;
  readonly response: PlanCampaignStoryboardResponse;
  readonly committedIntent?: undefined;
}

export interface SubmitErrorState {
  readonly phase: "submit-error";
  readonly values: CampaignCreationFormValues;
  readonly error: CampaignCreationError;
  readonly fieldErrors: Record<string, string>;
  readonly committedIntent?: CommittedIntent | undefined;
}

export type CampaignCreationState =
  IdleState | ValidationFailedState | SubmittingState | SucceededState | SubmitErrorState;

export type CampaignCreationEffect =
  | { readonly type: "none" }
  | { readonly type: "submit"; readonly request: PlanCampaignStoryboardRequest };

export type CampaignCreationEvent =
  | { readonly type: "UPDATE_FIELDS"; readonly values: Partial<CampaignCreationFormValues> }
  | { readonly type: "SUBMIT"; readonly idempotencyKey: string }
  | { readonly type: "SUBMIT_SUCCESS"; readonly response: PlanCampaignStoryboardResponse }
  | {
      readonly type: "SUBMIT_ERROR";
      readonly statusCode: number;
      readonly error: PlanCampaignStoryboardErrorResponse;
    };

export interface TransitionResult {
  readonly state: CampaignCreationState;
  readonly effect: CampaignCreationEffect;
}

export function createInitialState(initialValues?: Partial<CampaignCreationFormValues>): IdleState {
  return {
    phase: "idle",
    values: {
      ...INITIAL_CAMPAIGN_FORM_VALUES,
      ...initialValues
    },
    fieldErrors: {},
    committedIntent: undefined
  };
}

export function omitIfBlank(value: string | undefined): string | undefined {
  if (value === undefined) return undefined;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : undefined;
}

export function mapZodIssuesToFields(issues: readonly z.ZodIssue[]): Record<string, string> {
  const errors: Record<string, string> = {};
  for (const issue of issues) {
    const pathStr = issue.path.join(".");
    if (pathStr === "title") {
      errors.title = errors.title ?? issue.message;
    } else if (pathStr === "clientId") {
      errors.clientId =
        errors.clientId ??
        (issue.message.toLowerCase().includes("uuid")
          ? "Client ID must be a valid UUID"
          : issue.message);
    } else if (pathStr === "targetPlatform") {
      errors.targetPlatform = errors.targetPlatform ?? issue.message;
    } else if (pathStr === "targetTotalDurationMs") {
      errors.durationSeconds = errors.durationSeconds ?? issue.message;
    } else if (pathStr === "sceneCountOverride") {
      if (
        issue.message.toLowerCase().includes("nan") ||
        issue.message.toLowerCase().includes("expected number")
      ) {
        errors.sceneCountOverride =
          errors.sceneCountOverride ?? "Custom scene count must be a valid integer";
      } else if (
        issue.message.toLowerCase().includes("float") ||
        issue.message.toLowerCase().includes("expected integer")
      ) {
        errors.sceneCountOverride =
          errors.sceneCountOverride ?? "Custom scene count must be a whole integer";
      } else {
        errors.sceneCountOverride = errors.sceneCountOverride ?? issue.message;
      }
    } else if (pathStr === "brief.description") {
      errors.briefDescription = errors.briefDescription ?? issue.message;
    } else if (pathStr === "brief.visualStyle") {
      errors.briefVisualStyle = errors.briefVisualStyle ?? issue.message;
    } else {
      errors[pathStr || "form"] = errors[pathStr || "form"] ?? issue.message;
    }
  }
  return errors;
}

export type BuildRequestResult =
  | { readonly ok: true; readonly request: PlanCampaignStoryboardRequest }
  | {
      readonly ok: false;
      readonly issues: readonly z.ZodIssue[];
      readonly fieldErrors: Record<string, string>;
    };

export function buildRequestFromForm(
  values: CampaignCreationFormValues,
  idempotencyKey: string
): BuildRequestResult {
  const targetPlatform = omitIfBlank(values.targetPlatform);
  const visualStyle = omitIfBlank(values.briefVisualStyle);
  const briefDescription = values.briefDescription.trim();
  const title = values.title.trim();
  const clientId = values.clientId.trim();

  const rawSeconds =
    typeof values.durationSeconds === "number"
      ? values.durationSeconds
      : Number(String(values.durationSeconds).trim());

  const targetTotalDurationMs = Number.isFinite(rawSeconds) ? Math.round(rawSeconds * 1000) : NaN;

  let sceneCountOverride: number | undefined = undefined;
  if (values.sceneCountMode === "custom") {
    const rawOverride =
      typeof values.sceneCountOverride === "number"
        ? values.sceneCountOverride
        : String(values.sceneCountOverride ?? "").trim();

    if (typeof rawOverride === "number") {
      sceneCountOverride = Number.isFinite(rawOverride) ? rawOverride : NaN;
    } else if (rawOverride.length === 0) {
      sceneCountOverride = NaN;
    } else {
      const parsed = Number(rawOverride);
      sceneCountOverride = Number.isFinite(parsed) ? parsed : NaN;
    }
  }

  // Construct the candidate object strictly omitting absent keys
  const briefCandidate = {
    description: briefDescription,
    ...(visualStyle !== undefined ? { visualStyle } : {})
  };

  const candidate = {
    idempotencyKey,
    clientId,
    title,
    targetTotalDurationMs,
    ...(targetPlatform !== undefined ? { targetPlatform } : {}),
    ...(values.sceneCountMode === "custom" ? { sceneCountOverride } : {}),
    brief: briefCandidate
  };

  const parsed = PlanCampaignStoryboardRequestSchema.safeParse(candidate);
  if (parsed.success) {
    return { ok: true, request: parsed.data };
  }

  return {
    ok: false,
    issues: parsed.error.issues,
    fieldErrors: mapZodIssuesToFields(parsed.error.issues)
  };
}

/**
 * Computes a canonical fingerprint string representing the client-side creation intent.
 * Consumes the shared canonicalizer from @cco/contracts.
 */
export function computeClientRequestFingerprint(
  request: Omit<PlanCampaignStoryboardRequest, "idempotencyKey">
): string {
  return canonicalizeCampaignRequest(request);
}

export function transitionCampaignCreationState(
  state: CampaignCreationState,
  event: CampaignCreationEvent
): TransitionResult {
  switch (event.type) {
    case "UPDATE_FIELDS": {
      if (state.phase === "submitting") {
        // Form inputs are locked during submission
        return { state, effect: { type: "none" } };
      }

      const updatedValues: CampaignCreationFormValues = {
        ...state.values,
        ...event.values
      };

      if (state.phase === "validation-failed") {
        return {
          state: {
            phase: "idle",
            values: updatedValues,
            fieldErrors: {},
            committedIntent: state.committedIntent
          },
          effect: { type: "none" }
        };
      }

      if (state.phase === "submit-error") {
        return {
          state: {
            phase: "idle",
            values: updatedValues,
            fieldErrors: {},
            committedIntent: state.committedIntent
          },
          effect: { type: "none" }
        };
      }

      return {
        state: {
          ...state,
          values: updatedValues
        },
        effect: { type: "none" }
      };
    }

    case "SUBMIT": {
      // Invariant: pending submission ignores a second local submit (AC-8)
      if (state.phase === "submitting") {
        return { state, effect: { type: "none" } };
      }

      const buildResult = buildRequestFromForm(state.values, event.idempotencyKey);
      if (!buildResult.ok) {
        return {
          state: {
            phase: "validation-failed",
            values: state.values,
            fieldErrors: buildResult.fieldErrors,
            issues: buildResult.issues,
            committedIntent: state.committedIntent
          },
          effect: { type: "none" }
        };
      }

      const fingerprint = computeClientRequestFingerprint(buildResult.request);

      let resolvedKey: string;
      if (
        state.committedIntent !== undefined &&
        state.committedIntent.fingerprint === fingerprint
      ) {
        resolvedKey = state.committedIntent.idempotencyKey;
      } else {
        resolvedKey = event.idempotencyKey;
      }

      const finalRequest: PlanCampaignStoryboardRequest = {
        ...buildResult.request,
        idempotencyKey: resolvedKey
      };

      const committedIntent: CommittedIntent = {
        idempotencyKey: resolvedKey,
        fingerprint
      };

      return {
        state: {
          phase: "submitting",
          values: state.values,
          idempotencyKey: resolvedKey,
          request: finalRequest,
          committedIntent
        },
        effect: {
          type: "submit",
          request: finalRequest
        }
      };
    }

    case "SUBMIT_SUCCESS": {
      return {
        state: {
          phase: "succeeded",
          values: state.values,
          response: event.response
        },
        effect: { type: "none" }
      };
    }

    case "SUBMIT_ERROR": {
      const isConflict = event.statusCode === 409;
      let fieldErrors: Record<string, string> = {};

      if (event.error.code === "VALIDATION_FAILURE" && Array.isArray(event.error.details)) {
        fieldErrors = mapZodIssuesToFields(event.error.details as z.ZodIssue[]);
      }

      const committedIntent =
        event.error.code === "IDEMPOTENCY_CONFLICT" ? undefined : state.committedIntent;

      return {
        state: {
          phase: "submit-error",
          values: state.values,
          error: {
            statusCode: event.statusCode,
            code: event.error.code,
            message: event.error.message,
            details: event.error.details,
            isConflict
          },
          fieldErrors,
          committedIntent
        },
        effect: { type: "none" }
      };
    }
  }
}
