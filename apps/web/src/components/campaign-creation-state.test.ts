import { describe, expect, it } from "vitest";
import {
  buildRequestFromForm,
  computeClientRequestFingerprint,
  createInitialState,
  omitIfBlank,
  transitionCampaignCreationState,
  MIN_SCENE_COUNT,
  MAX_SCENE_COUNT,
  MIN_TARGET_DURATION_MS,
  MAX_TARGET_DURATION_MS,
  MIN_TARGET_DURATION_SECONDS,
  MAX_TARGET_DURATION_SECONDS,
  type CampaignCreationEvent,
  type CampaignCreationFormValues,
  type SubmittingState,
  type SubmitErrorState,
  type ValidationFailedState,
  type SucceededState
} from "./campaign-creation-state.js";
import {
  PlanCampaignStoryboardRequestSchema,
  canonicalizeCampaignRequest,
  type PlanCampaignStoryboardRequest,
  MIN_SCENE_COUNT as CONTRACT_MIN_SCENE_COUNT,
  MAX_SCENE_COUNT as CONTRACT_MAX_SCENE_COUNT,
  MIN_TARGET_DURATION_MS as CONTRACT_MIN_TARGET_DURATION_MS,
  MAX_TARGET_DURATION_MS as CONTRACT_MAX_TARGET_DURATION_MS
} from "@cco/contracts";

describe("campaign creation state machine & form mapping", () => {
  it("imports and exports shared numeric bounds consistently with contracts", () => {
    expect(MIN_SCENE_COUNT).toBe(CONTRACT_MIN_SCENE_COUNT);
    expect(MAX_SCENE_COUNT).toBe(CONTRACT_MAX_SCENE_COUNT);
    expect(MIN_TARGET_DURATION_MS).toBe(CONTRACT_MIN_TARGET_DURATION_MS);
    expect(MAX_TARGET_DURATION_MS).toBe(CONTRACT_MAX_TARGET_DURATION_MS);
    expect(MIN_TARGET_DURATION_SECONDS).toBe(Math.ceil(CONTRACT_MIN_TARGET_DURATION_MS / 1000));
    expect(MAX_TARGET_DURATION_SECONDS).toBe(Math.floor(CONTRACT_MAX_TARGET_DURATION_MS / 1000));
  });
  const validFormValues: CampaignCreationFormValues = {
    title: "Summer 2026 Collection",
    clientId: "11111111-1111-4111-8111-111111111111",
    targetPlatform: "tiktok",
    durationSeconds: "15",
    sceneCountMode: "auto",
    sceneCountOverride: "",
    briefDescription: "High energy summer apparel advertisement",
    briefVisualStyle: "cinematic warm golden hour"
  };

  const dummyIdempotencyKey = "99999999-9999-4999-8999-999999999999";

  describe("omitIfBlank helper", () => {
    it("returns undefined for undefined, empty string, or whitespace-only string", () => {
      expect(omitIfBlank(undefined)).toBeUndefined();
      expect(omitIfBlank("")).toBeUndefined();
      expect(omitIfBlank("   ")).toBeUndefined();
      expect(omitIfBlank("\t\n")).toBeUndefined();
    });

    it("returns trimmed string for non-empty string", () => {
      expect(omitIfBlank("hello")).toBe("hello");
      expect(omitIfBlank("  hello world  ")).toBe("hello world");
    });
  });

  describe("buildRequestFromForm", () => {
    it("Auto mode omits sceneCountOverride key entirely", () => {
      const result = buildRequestFromForm(validFormValues, dummyIdempotencyKey);
      expect(result.ok).toBe(true);
      if (!result.ok) return;

      expect("sceneCountOverride" in result.request).toBe(false);
      expect(result.request.sceneCountOverride).toBeUndefined();
    });

    it("Custom mode sets sceneCountOverride correctly", () => {
      const values: CampaignCreationFormValues = {
        ...validFormValues,
        sceneCountMode: "custom",
        sceneCountOverride: "3"
      };

      const result = buildRequestFromForm(values, dummyIdempotencyKey);
      expect(result.ok).toBe(true);
      if (!result.ok) return;

      expect("sceneCountOverride" in result.request).toBe(true);
      expect(result.request.sceneCountOverride).toBe(3);
    });

    it("Custom mode maps valid exponent integer notation to integer accurately", () => {
      const values: CampaignCreationFormValues = {
        ...validFormValues,
        sceneCountMode: "custom",
        sceneCountOverride: "1e1"
      };

      const result = buildRequestFromForm(values, dummyIdempotencyKey);
      expect(result.ok).toBe(true);
      if (!result.ok) return;

      expect("sceneCountOverride" in result.request).toBe(true);
      expect(result.request.sceneCountOverride).toBe(10);
    });

    it("Custom mode with empty string fails validation and produces sceneCountOverride field error without falling back to Auto", () => {
      const values: CampaignCreationFormValues = {
        ...validFormValues,
        sceneCountMode: "custom",
        sceneCountOverride: ""
      };

      const result = buildRequestFromForm(values, dummyIdempotencyKey);
      expect(result.ok).toBe(false);
      if (result.ok) return;

      expect(result.fieldErrors.sceneCountOverride).toBeDefined();
      expect(result.fieldErrors.sceneCountOverride).toBe(
        "Custom scene count must be a valid integer"
      );
    });

    it("Custom mode with whitespace string fails validation and produces sceneCountOverride field error", () => {
      const values: CampaignCreationFormValues = {
        ...validFormValues,
        sceneCountMode: "custom",
        sceneCountOverride: "   "
      };

      const result = buildRequestFromForm(values, dummyIdempotencyKey);
      expect(result.ok).toBe(false);
      if (result.ok) return;

      expect(result.fieldErrors.sceneCountOverride).toBeDefined();
      expect(result.fieldErrors.sceneCountOverride).toBe(
        "Custom scene count must be a valid integer"
      );
    });

    it("Custom mode rejects fractional values with sceneCountOverride field error", () => {
      const values: CampaignCreationFormValues = {
        ...validFormValues,
        sceneCountMode: "custom",
        sceneCountOverride: "3.5"
      };

      const result = buildRequestFromForm(values, dummyIdempotencyKey);
      expect(result.ok).toBe(false);
      if (result.ok) return;

      expect(result.fieldErrors.sceneCountOverride).toBeDefined();
      expect(result.fieldErrors.sceneCountOverride).toBe(
        "Custom scene count must be a whole integer"
      );
    });

    it("Custom mode rejects trailing-character values without partial parsing", () => {
      const values: CampaignCreationFormValues = {
        ...validFormValues,
        sceneCountMode: "custom",
        sceneCountOverride: "3abc"
      };

      const result = buildRequestFromForm(values, dummyIdempotencyKey);
      expect(result.ok).toBe(false);
      if (result.ok) return;

      expect(result.fieldErrors.sceneCountOverride).toBeDefined();
      expect(result.fieldErrors.sceneCountOverride).toBe(
        "Custom scene count must be a valid integer"
      );
    });

    it("Custom mode rejects non-finite values with sceneCountOverride field error", () => {
      const stringInfinityValues: CampaignCreationFormValues = {
        ...validFormValues,
        sceneCountMode: "custom",
        sceneCountOverride: "Infinity"
      };

      const stringResult = buildRequestFromForm(stringInfinityValues, dummyIdempotencyKey);
      expect(stringResult.ok).toBe(false);
      if (!stringResult.ok) {
        expect(stringResult.fieldErrors.sceneCountOverride).toBe(
          "Custom scene count must be a valid integer"
        );
      }

      const numInfinityValues: CampaignCreationFormValues = {
        ...validFormValues,
        sceneCountMode: "custom",
        sceneCountOverride: Infinity
      };

      const numResult = buildRequestFromForm(numInfinityValues, dummyIdempotencyKey);
      expect(numResult.ok).toBe(false);
      if (!numResult.ok) {
        expect(numResult.fieldErrors.sceneCountOverride).toBe(
          "Custom scene count must be a valid integer"
        );
      }
    });

    it("Custom mode rejects out-of-bounds scene count overrides", () => {
      const belowMin: CampaignCreationFormValues = {
        ...validFormValues,
        sceneCountMode: "custom",
        sceneCountOverride: "0"
      };
      const resultBelow = buildRequestFromForm(belowMin, dummyIdempotencyKey);
      expect(resultBelow.ok).toBe(false);
      if (!resultBelow.ok) {
        expect(resultBelow.fieldErrors.sceneCountOverride).toBeDefined();
      }

      const aboveMax: CampaignCreationFormValues = {
        ...validFormValues,
        sceneCountMode: "custom",
        sceneCountOverride: "61"
      };
      const resultAbove = buildRequestFromForm(aboveMax, dummyIdempotencyKey);
      expect(resultAbove.ok).toBe(false);
      if (!resultAbove.ok) {
        expect(resultAbove.fieldErrors.sceneCountOverride).toBeDefined();
      }
    });

    it("converts seconds to milliseconds accurately", () => {
      const values: CampaignCreationFormValues = {
        ...validFormValues,
        durationSeconds: "15.5"
      };

      const result = buildRequestFromForm(values, dummyIdempotencyKey);
      expect(result.ok).toBe(true);
      if (!result.ok) return;

      expect(result.request.targetTotalDurationMs).toBe(15500);
    });

    it("omits empty string and whitespace-only optional fields (targetPlatform and briefVisualStyle)", () => {
      const valuesWithBlankOptionals: CampaignCreationFormValues = {
        ...validFormValues,
        targetPlatform: "   ",
        briefVisualStyle: ""
      };

      const result = buildRequestFromForm(valuesWithBlankOptionals, dummyIdempotencyKey);
      expect(result.ok).toBe(true);
      if (!result.ok) return;

      // Assert keys are entirely absent from candidate/request
      expect("targetPlatform" in result.request).toBe(false);
      expect("visualStyle" in result.request.brief).toBe(false);

      // Verify PlanCampaignStoryboardRequestSchema validates cleanly on it
      const parseCheck = PlanCampaignStoryboardRequestSchema.safeParse(result.request);
      expect(parseCheck.success).toBe(true);
    });

    it("fails validation with field error when duration is below minimum (5s)", () => {
      const invalidValues: CampaignCreationFormValues = {
        ...validFormValues,
        durationSeconds: "4" // 4000ms < 5000ms
      };

      const result = buildRequestFromForm(invalidValues, dummyIdempotencyKey);
      expect(result.ok).toBe(false);
      if (result.ok) return;

      expect(result.fieldErrors.durationSeconds).toBeDefined();
    });

    it("fails validation when targetTotalDurationMs and sceneCountOverride imply unsupported per-scene duration", () => {
      // 5000ms duration with 60 scenes = ~83ms/scene, which is < 1000ms minimum
      const invalidCombination: CampaignCreationFormValues = {
        ...validFormValues,
        durationSeconds: "5",
        sceneCountMode: "custom",
        sceneCountOverride: "60"
      };

      const result = buildRequestFromForm(invalidCombination, dummyIdempotencyKey);
      expect(result.ok).toBe(false);
      if (result.ok) return;

      expect(result.fieldErrors.sceneCountOverride).toContain(
        "targetTotalDurationMs and sceneCountOverride imply an unsupported per-scene duration"
      );
    });

    it("fails validation when clientId is not a UUID", () => {
      const invalidValues: CampaignCreationFormValues = {
        ...validFormValues,
        clientId: "non-uuid-client-123"
      };

      const result = buildRequestFromForm(invalidValues, dummyIdempotencyKey);
      expect(result.ok).toBe(false);
      if (result.ok) return;

      expect(result.fieldErrors.clientId).toBeDefined();
    });

    it("fails validation when title or brief description is blank or whitespace-only", () => {
      const blankTitle: CampaignCreationFormValues = {
        ...validFormValues,
        title: "   "
      };

      const resultTitle = buildRequestFromForm(blankTitle, dummyIdempotencyKey);
      expect(resultTitle.ok).toBe(false);
      if (!resultTitle.ok) {
        expect(resultTitle.fieldErrors.title).toBeDefined();
      }

      const blankBrief: CampaignCreationFormValues = {
        ...validFormValues,
        briefDescription: "   "
      };

      const resultBrief = buildRequestFromForm(blankBrief, dummyIdempotencyKey);
      expect(resultBrief.ok).toBe(false);
      if (!resultBrief.ok) {
        expect(resultBrief.fieldErrors.briefDescription).toBeDefined();
      }
    });
  });

  describe("transitionCampaignCreationState", () => {
    it("transitions from idle to submitting on valid SUBMIT", () => {
      const initial = createInitialState(validFormValues);
      const { state, effect } = transitionCampaignCreationState(initial, {
        type: "SUBMIT",
        idempotencyKey: dummyIdempotencyKey
      });

      expect(state.phase).toBe("submitting");
      const submitting = state as SubmittingState;
      expect(submitting.idempotencyKey).toBe(dummyIdempotencyKey);
      expect(submitting.request.title).toBe(validFormValues.title);
      expect(effect).toEqual({
        type: "submit",
        request: submitting.request
      });
    });

    it("transitions from idle to validation-failed on invalid SUBMIT", () => {
      const invalidValues: CampaignCreationFormValues = {
        ...validFormValues,
        title: ""
      };
      const initial = createInitialState(invalidValues);
      const { state, effect } = transitionCampaignCreationState(initial, {
        type: "SUBMIT",
        idempotencyKey: dummyIdempotencyKey
      });

      expect(state.phase).toBe("validation-failed");
      const validationFailed = state as ValidationFailedState;
      expect(validationFailed.fieldErrors.title).toBeDefined();
      expect(effect).toEqual({ type: "none" });
    });

    it("ignores SUBMIT while already in submitting phase (AC-8 duplicate in-flight guard)", () => {
      const initial = createInitialState(validFormValues);
      const { state: submittingState } = transitionCampaignCreationState(initial, {
        type: "SUBMIT",
        idempotencyKey: dummyIdempotencyKey
      });
      expect(submittingState.phase).toBe("submitting");

      // Attempt second submission while in-flight
      const { state: secondState, effect: secondEffect } = transitionCampaignCreationState(
        submittingState,
        {
          type: "SUBMIT",
          idempotencyKey: "another-key-8888-8888-8888-888888888888"
        }
      );

      // Must remain identical submitting state with no new effect
      expect(secondState).toBe(submittingState);
      expect(secondEffect).toEqual({ type: "none" });
    });

    it("transitions from submitting to succeeded on SUBMIT_SUCCESS", () => {
      const initial = createInitialState(validFormValues);
      const { state: submittingState } = transitionCampaignCreationState(initial, {
        type: "SUBMIT",
        idempotencyKey: dummyIdempotencyKey
      });

      const responsePayload = {
        campaignId: "44444444-4444-4444-8444-444444444444",
        idempotencyKey: dummyIdempotencyKey,
        status: "drafting" as const,
        totalScenes: 3,
        targetTotalDurationMs: 15000,
        isIdempotentReplay: false,
        sceneCount: 3,
        scenes: [],
        createdAt: "2026-09-11T12:00:00.000Z"
      };

      const { state, effect } = transitionCampaignCreationState(submittingState, {
        type: "SUBMIT_SUCCESS",
        response: responsePayload
      });

      expect(state.phase).toBe("succeeded");
      const succeeded = state as SucceededState;
      expect(succeeded.response).toEqual(responsePayload);
      expect(effect).toEqual({ type: "none" });
    });

    it("transitions from submitting to submit-error on SUBMIT_ERROR", () => {
      const initial = createInitialState(validFormValues);
      const { state: submittingState } = transitionCampaignCreationState(initial, {
        type: "SUBMIT",
        idempotencyKey: dummyIdempotencyKey
      });

      const { state, effect } = transitionCampaignCreationState(submittingState, {
        type: "SUBMIT_ERROR",
        statusCode: 502,
        error: {
          code: "PLANNING_PROVIDER_EXHAUSTED",
          message: "All provider quota exhausted"
        }
      });

      expect(state.phase).toBe("submit-error");
      const submitError = state as SubmitErrorState;
      expect(submitError.error.statusCode).toBe(502);
      expect(submitError.error.code).toBe("PLANNING_PROVIDER_EXHAUSTED");
      expect(submitError.error.isConflict).toBe(false);
      expect(submitError.values).toEqual(validFormValues);
      expect(effect).toEqual({ type: "none" });
    });

    it("marks 409 status as isConflict: true", () => {
      const initial = createInitialState(validFormValues);
      const { state: submittingState } = transitionCampaignCreationState(initial, {
        type: "SUBMIT",
        idempotencyKey: dummyIdempotencyKey
      });

      const { state } = transitionCampaignCreationState(submittingState, {
        type: "SUBMIT_ERROR",
        statusCode: 409,
        error: {
          code: "STORYBOARD_MATERIALIZATION_CONFLICT",
          message: "Conflict with concurrent materialization"
        }
      });

      expect(state.phase).toBe("submit-error");
      const submitError = state as SubmitErrorState;
      expect(submitError.error.isConflict).toBe(true);
      expect(submitError.error.statusCode).toBe(409);
    });

    it("extracts field errors from 400 VALIDATION_FAILURE details", () => {
      const initial = createInitialState(validFormValues);
      const { state: submittingState } = transitionCampaignCreationState(initial, {
        type: "SUBMIT",
        idempotencyKey: dummyIdempotencyKey
      });

      const { state } = transitionCampaignCreationState(submittingState, {
        type: "SUBMIT_ERROR",
        statusCode: 400,
        error: {
          code: "VALIDATION_FAILURE",
          message: "Validation failed",
          details: [{ path: ["brief", "description"], message: "Brief is too vague" }]
        }
      });

      expect(state.phase).toBe("submit-error");
      const submitError = state as SubmitErrorState;
      expect(submitError.fieldErrors.briefDescription).toBe("Brief is too vague");
    });

    it("reuses the original idempotency key when resubmitting an unchanged intent after submit-error without special retry action (Decision 7)", () => {
      const initial = createInitialState(validFormValues);
      const { state: submittingState } = transitionCampaignCreationState(initial, {
        type: "SUBMIT",
        idempotencyKey: dummyIdempotencyKey
      });

      const { state: errorState } = transitionCampaignCreationState(submittingState, {
        type: "SUBMIT_ERROR",
        statusCode: 500,
        error: { message: "Internal server error" }
      });
      expect(errorState.phase).toBe("submit-error");

      // Submitting again uses standard SUBMIT with candidate fresh key; reducer reuses original key
      const freshKey = "88888888-8888-4888-8888-888888888888";
      const { state: resubmittedState, effect } = transitionCampaignCreationState(errorState, {
        type: "SUBMIT",
        idempotencyKey: freshKey
      });

      expect(resubmittedState.phase).toBe("submitting");
      const resubmitted = resubmittedState as SubmittingState;
      expect(resubmitted.idempotencyKey).toBe(dummyIdempotencyKey);
      expect(resubmitted.request.idempotencyKey).toBe(dummyIdempotencyKey);
      expect(effect).toEqual({
        type: "submit",
        request: resubmitted.request
      });
    });

    it("asserts event union contains no RETRY or TRY_AGAIN type", () => {
      type EventTypes = CampaignCreationEvent["type"];
      // Compile-time check: the types 'RETRY' and 'TRY_AGAIN' must not be in EventTypes
      type HasRetry = "RETRY" extends EventTypes ? true : false;
      type HasTryAgain = "TRY_AGAIN" extends EventTypes ? true : false;
      const hasRetry: HasRetry = false;
      const hasTryAgain: HasTryAgain = false;
      expect(hasRetry).toBe(false);
      expect(hasTryAgain).toBe(false);
    });

    it("UPDATE_FIELDS updates values and clears errors in error/validation-failed phases", () => {
      const initial = createInitialState({ ...validFormValues, title: "" });
      const { state: failedState } = transitionCampaignCreationState(initial, {
        type: "SUBMIT",
        idempotencyKey: dummyIdempotencyKey
      });
      expect(failedState.phase).toBe("validation-failed");

      const { state: updatedState } = transitionCampaignCreationState(failedState, {
        type: "UPDATE_FIELDS",
        values: { title: "New Title" }
      });

      expect(updatedState.phase).toBe("idle");
      if (updatedState.phase === "idle") {
        expect(updatedState.values.title).toBe("New Title");
        expect(Object.keys(updatedState.fieldErrors)).toHaveLength(0);
      }
    });
  });

  describe("creation-intent lifecycle & idempotent retry UX (#249)", () => {
    const freshCandidateKey = "88888888-8888-4888-8888-888888888888";
    const secondCandidateKey = "77777777-7777-4777-8777-777777777777";

    it("first submit for a new creation intent assigns and retains the initial idempotency identity", () => {
      const initial = createInitialState(validFormValues);
      expect(initial.committedIntent).toBeUndefined();

      const { state } = transitionCampaignCreationState(initial, {
        type: "SUBMIT",
        idempotencyKey: dummyIdempotencyKey
      });

      expect(state.phase).toBe("submitting");
      const submitting = state as SubmittingState;
      expect(submitting.idempotencyKey).toBe(dummyIdempotencyKey);
      expect(submitting.request.idempotencyKey).toBe(dummyIdempotencyKey);
      expect(submitting.committedIntent).toBeDefined();
      expect(submitting.committedIntent?.idempotencyKey).toBe(dummyIdempotencyKey);
      expect(typeof submitting.committedIntent?.fingerprint).toBe("string");
    });

    it("retrying after ambiguous transport outcome (502 / network drop) reuses the identical idempotency identity", () => {
      const initial = createInitialState(validFormValues);
      const { state: submittingState } = transitionCampaignCreationState(initial, {
        type: "SUBMIT",
        idempotencyKey: dummyIdempotencyKey
      });

      // Transport drops response or fails with 502
      const { state: errorState } = transitionCampaignCreationState(submittingState, {
        type: "SUBMIT_ERROR",
        statusCode: 502,
        error: { message: "A network or server error occurred while planning the campaign." }
      });

      expect(errorState.phase).toBe("submit-error");
      const submitError = errorState as SubmitErrorState;
      expect(submitError.committedIntent?.idempotencyKey).toBe(dummyIdempotencyKey);

      // User retries without changing form values; component dispatches SUBMIT with fresh UUID candidate
      const { state: retryState, effect } = transitionCampaignCreationState(errorState, {
        type: "SUBMIT",
        idempotencyKey: freshCandidateKey
      });

      expect(retryState.phase).toBe("submitting");
      const retrying = retryState as SubmittingState;
      // Key must be reused from committedIntent, candidate key discarded
      expect(retrying.idempotencyKey).toBe(dummyIdempotencyKey);
      expect(retrying.request.idempotencyKey).toBe(dummyIdempotencyKey);
      expect(retrying.committedIntent?.idempotencyKey).toBe(dummyIdempotencyKey);
      expect(effect).toEqual({
        type: "submit",
        request: retrying.request
      });
    });

    it("same-intent retry retains the same identity across multiple consecutive failures", () => {
      const initial = createInitialState(validFormValues);
      // Attempt 1: submit
      const { state: sub1 } = transitionCampaignCreationState(initial, {
        type: "SUBMIT",
        idempotencyKey: dummyIdempotencyKey
      });
      expect((sub1 as SubmittingState).idempotencyKey).toBe(dummyIdempotencyKey);

      // Attempt 1 fails (502)
      const { state: err1 } = transitionCampaignCreationState(sub1, {
        type: "SUBMIT_ERROR",
        statusCode: 502,
        error: { message: "Timeout" }
      });

      // Attempt 2: retry with freshCandidateKey
      const { state: sub2 } = transitionCampaignCreationState(err1, {
        type: "SUBMIT",
        idempotencyKey: freshCandidateKey
      });
      expect((sub2 as SubmittingState).idempotencyKey).toBe(dummyIdempotencyKey);

      // Attempt 2 fails (500)
      const { state: err2 } = transitionCampaignCreationState(sub2, {
        type: "SUBMIT_ERROR",
        statusCode: 500,
        error: { message: "Internal error" }
      });

      // Attempt 3: retry with secondCandidateKey
      const { state: sub3 } = transitionCampaignCreationState(err2, {
        type: "SUBMIT",
        idempotencyKey: secondCandidateKey
      });
      expect((sub3 as SubmittingState).idempotencyKey).toBe(dummyIdempotencyKey);
    });

    it("materially changing the creative brief description after an error causes the next submit to use a new identity", () => {
      const initial = createInitialState(validFormValues);
      const { state: submittingState } = transitionCampaignCreationState(initial, {
        type: "SUBMIT",
        idempotencyKey: dummyIdempotencyKey
      });

      const { state: errorState } = transitionCampaignCreationState(submittingState, {
        type: "SUBMIT_ERROR",
        statusCode: 500,
        error: { message: "Internal error" }
      });

      // User changes the brief description
      const updatedDescription =
        "Completely rewritten campaign concept focusing on winter activewear";
      const { state: idleState } = transitionCampaignCreationState(errorState, {
        type: "UPDATE_FIELDS",
        values: { briefDescription: updatedDescription }
      });
      expect(idleState.phase).toBe("idle");

      // Next submit must mint a new identity because intent changed
      const { state: resubmittedState } = transitionCampaignCreationState(idleState, {
        type: "SUBMIT",
        idempotencyKey: freshCandidateKey
      });

      expect(resubmittedState.phase).toBe("submitting");
      const resubmitted = resubmittedState as SubmittingState;
      expect(resubmitted.idempotencyKey).toBe(freshCandidateKey);
      expect(resubmitted.request.idempotencyKey).toBe(freshCandidateKey);
      expect(resubmitted.request.brief.description).toBe(updatedDescription);
      expect(resubmitted.committedIntent?.idempotencyKey).toBe(freshCandidateKey);
    });

    it("materially changing creative brief visual style after an error causes the next submit to use a new identity", () => {
      const initial = createInitialState(validFormValues);
      const { state: submittingState } = transitionCampaignCreationState(initial, {
        type: "SUBMIT",
        idempotencyKey: dummyIdempotencyKey
      });

      const { state: errorState } = transitionCampaignCreationState(submittingState, {
        type: "SUBMIT_ERROR",
        statusCode: 500,
        error: { message: "Internal error" }
      });

      const { state: idleState } = transitionCampaignCreationState(errorState, {
        type: "UPDATE_FIELDS",
        values: { briefVisualStyle: "noir high contrast monochrome" }
      });

      const { state: resubmittedState } = transitionCampaignCreationState(idleState, {
        type: "SUBMIT",
        idempotencyKey: freshCandidateKey
      });

      expect(resubmittedState.phase).toBe("submitting");
      const resubmitted = resubmittedState as SubmittingState;
      expect(resubmitted.idempotencyKey).toBe(freshCandidateKey);
      expect(resubmitted.request.brief.visualStyle).toBe("noir high contrast monochrome");
    });

    it("materially changing scene-count override mode from Auto to Custom causes next submit to use a new identity", () => {
      // Auto mode by default
      const initial = createInitialState({ ...validFormValues, sceneCountMode: "auto" });
      const { state: submittingState } = transitionCampaignCreationState(initial, {
        type: "SUBMIT",
        idempotencyKey: dummyIdempotencyKey
      });

      const { state: errorState } = transitionCampaignCreationState(submittingState, {
        type: "SUBMIT_ERROR",
        statusCode: 500,
        error: { message: "Internal error" }
      });

      // Switch to Custom mode with override 3
      const { state: idleState } = transitionCampaignCreationState(errorState, {
        type: "UPDATE_FIELDS",
        values: { sceneCountMode: "custom", sceneCountOverride: "3" }
      });

      const { state: resubmittedState } = transitionCampaignCreationState(idleState, {
        type: "SUBMIT",
        idempotencyKey: freshCandidateKey
      });

      expect(resubmittedState.phase).toBe("submitting");
      const resubmitted = resubmittedState as SubmittingState;
      expect(resubmitted.idempotencyKey).toBe(freshCandidateKey);
      expect(resubmitted.request.sceneCountOverride).toBe(3);
    });

    it("materially changing scene-count override value in Custom mode causes next submit to use a new identity", () => {
      const customValues: CampaignCreationFormValues = {
        ...validFormValues,
        sceneCountMode: "custom",
        sceneCountOverride: "3"
      };
      const initial = createInitialState(customValues);
      const { state: submittingState } = transitionCampaignCreationState(initial, {
        type: "SUBMIT",
        idempotencyKey: dummyIdempotencyKey
      });

      const { state: errorState } = transitionCampaignCreationState(submittingState, {
        type: "SUBMIT_ERROR",
        statusCode: 500,
        error: { message: "Internal error" }
      });

      // Change custom scene count from 3 to 4
      const { state: idleState } = transitionCampaignCreationState(errorState, {
        type: "UPDATE_FIELDS",
        values: { sceneCountOverride: "4" }
      });

      const { state: resubmittedState } = transitionCampaignCreationState(idleState, {
        type: "SUBMIT",
        idempotencyKey: freshCandidateKey
      });

      expect(resubmittedState.phase).toBe("submitting");
      const resubmitted = resubmittedState as SubmittingState;
      expect(resubmitted.idempotencyKey).toBe(freshCandidateKey);
      expect(resubmitted.request.sceneCountOverride).toBe(4);
    });

    it("unchanged / equivalent canonical request input retains the same identity for retry", () => {
      const initial = createInitialState(validFormValues);
      const { state: submittingState } = transitionCampaignCreationState(initial, {
        type: "SUBMIT",
        idempotencyKey: dummyIdempotencyKey
      });

      const { state: errorState } = transitionCampaignCreationState(submittingState, {
        type: "SUBMIT_ERROR",
        statusCode: 500,
        error: { message: "Temporary failure" }
      });

      // Update fields with non-material / cosmetic whitespace and numeric string equivalent
      const { state: idleState } = transitionCampaignCreationState(errorState, {
        type: "UPDATE_FIELDS",
        values: {
          title: "  Summer 2026 Collection  ",
          briefDescription: "High energy summer apparel advertisement\n",
          durationSeconds: 15 // number vs string "15"
        }
      });

      const { state: resubmittedState } = transitionCampaignCreationState(idleState, {
        type: "SUBMIT",
        idempotencyKey: freshCandidateKey
      });

      expect(resubmittedState.phase).toBe("submitting");
      const resubmitted = resubmittedState as SubmittingState;
      // Equivalent canonical inputs must not create false conflicts
      expect(resubmitted.idempotencyKey).toBe(dummyIdempotencyKey);
      expect(resubmitted.request.idempotencyKey).toBe(dummyIdempotencyKey);
    });

    it("409 IDEMPOTENCY_CONFLICT is surfaced explicitly and does not silently rotate the key on its own", () => {
      const initial = createInitialState(validFormValues);
      const { state: submittingState } = transitionCampaignCreationState(initial, {
        type: "SUBMIT",
        idempotencyKey: dummyIdempotencyKey
      });

      const { state: errorState, effect: errorEffect } = transitionCampaignCreationState(
        submittingState,
        {
          type: "SUBMIT_ERROR",
          statusCode: 409,
          error: {
            code: "IDEMPOTENCY_CONFLICT",
            message: "Key already committed with conflicting parameters"
          }
        }
      );

      // Explicit error surfaced; no auto-resubmission effect
      expect(errorState.phase).toBe("submit-error");
      const submitError = errorState as SubmitErrorState;
      expect(submitError.error.isConflict).toBe(true);
      expect(submitError.error.code).toBe("IDEMPOTENCY_CONFLICT");
      expect(submitError.error.statusCode).toBe(409);
      expect(submitError.committedIntent).toBeUndefined(); // invalidated
      expect(errorEffect).toEqual({ type: "none" });

      // User must explicitly submit again; next explicit submit produces fresh key
      const { state: resubmittedState } = transitionCampaignCreationState(errorState, {
        type: "SUBMIT",
        idempotencyKey: freshCandidateKey
      });

      expect(resubmittedState.phase).toBe("submitting");
      const resubmitted = resubmittedState as SubmittingState;
      expect(resubmitted.idempotencyKey).toBe(freshCandidateKey);
      expect(resubmitted.request.idempotencyKey).toBe(freshCandidateKey);
      expect(resubmitted.committedIntent?.idempotencyKey).toBe(freshCandidateKey);
    });

    it("successful submission consumes the identity, preventing reuse on subsequent workflows", () => {
      const initial = createInitialState(validFormValues);
      const { state: submittingState } = transitionCampaignCreationState(initial, {
        type: "SUBMIT",
        idempotencyKey: dummyIdempotencyKey
      });

      const mockResponse = {
        campaignId: "33333333-3333-4333-8333-333333333333",
        idempotencyKey: dummyIdempotencyKey,
        status: "drafting" as const,
        totalScenes: 5,
        targetTotalDurationMs: 15000,
        isIdempotentReplay: false,
        sceneCount: 4,
        scenes: [],
        createdAt: "2026-09-11T12:00:00.000Z"
      };

      const { state: succeededState } = transitionCampaignCreationState(submittingState, {
        type: "SUBMIT_SUCCESS",
        response: mockResponse
      });

      expect(succeededState.phase).toBe("succeeded");
      expect((succeededState as SucceededState).committedIntent).toBeUndefined();

      // Subsequent submit from succeeded state creates a new intent and uses candidate key
      const { state: nextState } = transitionCampaignCreationState(succeededState, {
        type: "SUBMIT",
        idempotencyKey: freshCandidateKey
      });

      expect(nextState.phase).toBe("submitting");
      const nextSubmitting = nextState as SubmittingState;
      expect(nextSubmitting.idempotencyKey).toBe(freshCandidateKey);
      expect(nextSubmitting.request.idempotencyKey).toBe(freshCandidateKey);
    });

    it("client-side state cannot accidentally pair an old idempotency key with a materially changed request payload", () => {
      const initial = createInitialState(validFormValues);
      const { state: submittingState } = transitionCampaignCreationState(initial, {
        type: "SUBMIT",
        idempotencyKey: dummyIdempotencyKey
      });

      const { state: errorState } = transitionCampaignCreationState(submittingState, {
        type: "SUBMIT_ERROR",
        statusCode: 500,
        error: { message: "Server error" }
      });

      // Change title
      const { state: idleState } = transitionCampaignCreationState(errorState, {
        type: "UPDATE_FIELDS",
        values: { title: "Completely Different Campaign Title" }
      });

      const { state: resubmittedState } = transitionCampaignCreationState(idleState, {
        type: "SUBMIT",
        idempotencyKey: freshCandidateKey
      });

      const resubmitted = resubmittedState as SubmittingState;
      expect(resubmitted.idempotencyKey).not.toBe(dummyIdempotencyKey);
      expect(resubmitted.idempotencyKey).toBe(freshCandidateKey);
      expect(resubmitted.request.idempotencyKey).toBe(freshCandidateKey);
      expect(resubmitted.request.title).toBe("Completely Different Campaign Title");
    });

    it("preserves retryability on deterministic planning safety refusal (422) without creating duplicates", () => {
      const initial = createInitialState(validFormValues);
      const { state: submittingState } = transitionCampaignCreationState(initial, {
        type: "SUBMIT",
        idempotencyKey: dummyIdempotencyKey
      });

      const { state: errorState } = transitionCampaignCreationState(submittingState, {
        type: "SUBMIT_ERROR",
        statusCode: 422,
        error: {
          code: "PLANNING_SAFETY_REFUSAL",
          message: "Prompt was rejected by safety policy"
        }
      });

      expect(errorState.phase).toBe("submit-error");
      const submitError = errorState as SubmitErrorState;
      expect(submitError.error.isConflict).toBe(false);
      expect(submitError.committedIntent?.idempotencyKey).toBe(dummyIdempotencyKey);

      // Retrying unchanged reuses key
      const { state: resubmittedState } = transitionCampaignCreationState(errorState, {
        type: "SUBMIT",
        idempotencyKey: freshCandidateKey
      });

      expect((resubmittedState as SubmittingState).idempotencyKey).toBe(dummyIdempotencyKey);
    });

    describe("computeClientRequestFingerprint", () => {
      it("computes canonical fingerprint matching canonicalizeCampaignRequest", () => {
        const fixture: Omit<PlanCampaignStoryboardRequest, "idempotencyKey"> = {
          clientId: "11111111-1111-4111-8111-111111111111",
          title: "Summer 2026 Collection",
          targetPlatform: "tiktok",
          targetTotalDurationMs: 15000,
          sceneCountOverride: 3,
          brief: {
            description: "High energy summer apparel advertisement",
            visualStyle: "cinematic warm golden hour"
          },
          candidateReferenceAssetIds: ["asset-b", "asset-a", "asset-b"]
        };

        const fingerprint = computeClientRequestFingerprint(fixture);
        expect(fingerprint).toBe(canonicalizeCampaignRequest(fixture));
      });
    });
  });
});
