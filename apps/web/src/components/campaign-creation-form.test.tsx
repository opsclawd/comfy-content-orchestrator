// @vitest-environment jsdom
import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { render, screen, fireEvent, waitFor, act, cleanup } from "@testing-library/react";
import { CampaignCreationForm } from "./campaign-creation-form.js";
import {
  transitionCampaignCreationState,
  type CampaignCreationFormValues,
  type CampaignCreationState
} from "./campaign-creation-state.js";
import {
  MIN_SCENE_COUNT,
  MAX_SCENE_COUNT,
  MIN_TARGET_DURATION_MS,
  MAX_TARGET_DURATION_MS,
  type PlanCampaignStoryboardResponse
} from "@cco/contracts";
import { PlanCampaignStoryboardApiError } from "../api/client.js";

const MIN_TARGET_DURATION_SECONDS = Math.ceil(MIN_TARGET_DURATION_MS / 1000);
const MAX_TARGET_DURATION_SECONDS = Math.floor(MAX_TARGET_DURATION_MS / 1000);

describe("CampaignCreationForm Component", () => {
  const validValues: CampaignCreationFormValues = {
    title: "Summer 2026 Collection",
    clientId: "11111111-1111-4111-8111-111111111111",
    targetPlatform: "tiktok",
    durationSeconds: "15",
    sceneCountMode: "auto",
    sceneCountOverride: "",
    briefDescription: "High energy summer apparel advertisement",
    briefVisualStyle: "golden hour cinematic"
  };

  const sampleSuccessResponse: PlanCampaignStoryboardResponse = {
    campaignId: "33333333-3333-4333-8333-333333333333",
    idempotencyKey: "99999999-9999-4999-8999-999999999999",
    status: "drafting",
    totalScenes: 5,
    targetTotalDurationMs: 15000,
    isIdempotentReplay: false,
    sceneCount: 4,
    scenes: [
      {
        sceneId: "44444444-4444-4444-8444-444444444441",
        ordinal: 1,
        status: "generating_candidates"
      },
      {
        sceneId: "44444444-4444-4444-8444-444444444442",
        ordinal: 2,
        status: "generating_candidates"
      },
      {
        sceneId: "44444444-4444-4444-8444-444444444443",
        ordinal: 3,
        status: "generating_candidates"
      },
      {
        sceneId: "44444444-4444-4444-8444-444444444444",
        ordinal: 4,
        status: "generating_candidates"
      }
    ],
    createdAt: "2026-09-11T12:00:00.000Z"
  };

  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    cleanup();
    vi.clearAllMocks();
  });

  it("renders the creation form in idle state with Auto scene count mode selected by default", () => {
    const html = renderToStaticMarkup(<CampaignCreationForm initialValues={validValues} />);

    expect(html).toContain('data-testid="campaign-creation-surface"');
    expect(html).toContain('data-testid="campaign-creation-form"');
    expect(html).toContain('data-testid="brief-description-input"');
    expect(html).toContain('data-testid="brief-visual-style-input"');
    expect(html).toContain('data-testid="campaign-title-input"');
    expect(html).toContain('data-testid="client-id-input"');
    expect(html).toContain('data-testid="target-platform-input"');
    expect(html).toContain('data-testid="target-duration-input"');
    expect(html).toContain('data-testid="scene-count-mode-auto"');
    expect(html).toContain('data-testid="scene-count-mode-custom"');
    expect(html).toContain('data-testid="scene-count-auto-hint"');
    expect(html).toContain("Scene count will be determined automatically");
    expect(html).not.toContain('data-testid="scene-count-override-input"');
    expect(html).toContain('data-testid="submit-campaign-button"');
    expect(html).toContain("Create &amp; Plan Campaign");
  });

  it("renders custom scene-count input when custom mode is selected", () => {
    const customValues: CampaignCreationFormValues = {
      ...validValues,
      sceneCountMode: "custom",
      sceneCountOverride: "5"
    };

    const html = renderToStaticMarkup(<CampaignCreationForm initialValues={customValues} />);

    expect(html).toContain('data-testid="scene-count-override-input"');
    expect(html).toContain('value="5"');
    expect(html).not.toContain('data-testid="scene-count-auto-hint"');
  });

  it("renders the creation form with shared bounds constants in attributes and copy (AC-2, F-88247ee4, F-3b919901)", () => {
    const html = renderToStaticMarkup(<CampaignCreationForm initialValues={validValues} />);

    // Derived seconds bounds from contracts
    expect(html).toContain(`min="${MIN_TARGET_DURATION_SECONDS}"`);
    expect(html).toContain(`max="${MAX_TARGET_DURATION_SECONDS}"`);
    expect(html).toContain(
      `Total storyboard duration (${MIN_TARGET_DURATION_SECONDS} to ${MAX_TARGET_DURATION_SECONDS} seconds).`
    );

    const customValues: CampaignCreationFormValues = {
      ...validValues,
      sceneCountMode: "custom",
      sceneCountOverride: "5"
    };
    const customHtml = renderToStaticMarkup(<CampaignCreationForm initialValues={customValues} />);
    expect(customHtml).toContain(
      `Custom Scene Count Override (${MIN_SCENE_COUNT} - ${MAX_SCENE_COUNT})`
    );
    expect(customHtml).toContain(`min="${MIN_SCENE_COUNT}"`);
    expect(customHtml).toContain(`max="${MAX_SCENE_COUNT}"`);
    expect(customHtml).toContain('required=""');
  });

  it("disables submit button and shows loading text while in submitting phase (AC-8)", () => {
    const submittingState: CampaignCreationState = {
      phase: "submitting",
      values: validValues,
      idempotencyKey: "99999999-9999-4999-8999-999999999999",
      request: {
        idempotencyKey: "99999999-9999-4999-8999-999999999999",
        clientId: validValues.clientId,
        title: validValues.title,
        targetTotalDurationMs: 15000,
        brief: { description: validValues.briefDescription }
      }
    };

    const html = renderToStaticMarkup(<CampaignCreationForm state={submittingState} />);

    expect(html).toContain('data-testid="submit-campaign-button"');
    expect(html).toContain("Planning Storyboard...");
    expect(html).toContain('disabled=""');
    // Inputs should also be disabled
    expect(html).toContain('id="brief-description"');
  });

  it("renders client validation errors when validation fails", () => {
    const validationFailedState: CampaignCreationState = {
      phase: "validation-failed",
      values: { ...validValues, title: "", clientId: "bad-client" },
      fieldErrors: {
        title: "Title must not be empty",
        clientId: "Client ID must be a valid UUID"
      },
      issues: []
    };

    const html = renderToStaticMarkup(<CampaignCreationForm state={validationFailedState} />);

    expect(html).toContain('data-testid="campaign-creation-validation-error"');
    expect(html).toContain('data-testid="field-error-title"');
    expect(html).toContain("Title must not be empty");
    expect(html).toContain('data-testid="field-error-client-id"');
    expect(html).toContain("Client ID must be a valid UUID");
    expect(html).toContain('data-testid="submit-campaign-button"');
    expect(html).not.toContain('disabled=""');
  });

  it("renders conflict banner on 409 error with no 'Try again' / 'Retry' control (Decision 7 / CONSUMER-249-AC-8)", () => {
    const conflictState: CampaignCreationState = {
      phase: "submit-error",
      values: validValues,
      error: {
        statusCode: 409,
        code: "IDEMPOTENCY_CONFLICT",
        message:
          "Idempotency key 99999999-9999-4999-8999-999999999999 was already committed with different parameters",
        isConflict: true
      },
      fieldErrors: {}
    };

    const html = renderToStaticMarkup(<CampaignCreationForm state={conflictState} />);

    expect(html).toContain('data-testid="campaign-creation-conflict"');
    expect(html).toContain("Campaign Conflict (IDEMPOTENCY_CONFLICT)");
    expect(html).toContain(
      "Idempotency key 99999999-9999-4999-8999-999999999999 was already committed"
    );

    // Critical negative assertion guarding against Finding 1 / retry-rotates-key regressing:
    expect(html).not.toContain("Try again");
    expect(html).not.toContain("Try Again");
    expect(html).not.toContain("Retry");
    expect(html).not.toContain("retry");

    // The standard Submit button remains present and enabled for user-driven resubmission:
    expect(html).toContain('data-testid="submit-campaign-button"');
    expect(html).toContain("Create &amp; Plan Campaign");
    expect(html).not.toContain('disabled=""');

    // Values are preserved in inputs:
    expect(html).toContain(validValues.title);
    expect(html).toContain(validValues.clientId);
    expect(html).toContain(validValues.briefDescription);
  });

  it("renders distinct conflict banner for STORYBOARD_MATERIALIZATION_CONFLICT (409)", () => {
    const conflictState: CampaignCreationState = {
      phase: "submit-error",
      values: validValues,
      error: {
        statusCode: 409,
        code: "STORYBOARD_MATERIALIZATION_CONFLICT",
        message:
          "Storyboard materialization conflict for campaign 33333333-3333-4333-8333-333333333333",
        isConflict: true
      },
      fieldErrors: {}
    };

    const html = renderToStaticMarkup(<CampaignCreationForm state={conflictState} />);

    expect(html).toContain('data-testid="campaign-creation-conflict"');
    expect(html).toContain("STORYBOARD_MATERIALIZATION_CONFLICT");
    expect(html).toContain("Storyboard materialization conflict for campaign");
    expect(html).not.toContain("Try again");
    expect(html).not.toContain("Retry");
  });

  it("renders generic rejection banner for 422 PLANNING_SAFETY_REFUSAL without retry button", () => {
    const refusalState: CampaignCreationState = {
      phase: "submit-error",
      values: validValues,
      error: {
        statusCode: 422,
        code: "PLANNING_SAFETY_REFUSAL",
        message: "Content flagged by safety policy",
        isConflict: false
      },
      fieldErrors: {}
    };

    const html = renderToStaticMarkup(<CampaignCreationForm state={refusalState} />);

    expect(html).toContain('data-testid="campaign-creation-error"');
    expect(html).toContain("Request Rejection (PLANNING_SAFETY_REFUSAL)");
    expect(html).toContain("The request could not be completed: Content flagged by safety policy");
    expect(html).not.toContain("Try again");
    expect(html).not.toContain("Retry");
  });

  it("renders success panel with separately labeled totalScenes and sceneCount fields (AC-3, AC-6, AC-7, F-9c70647d, F-789b57f8)", () => {
    const succeededState: CampaignCreationState = {
      phase: "succeeded",
      values: validValues,
      response: sampleSuccessResponse // totalScenes: 5, sceneCount: 4
    };

    const html = renderToStaticMarkup(<CampaignCreationForm state={succeededState} />);

    expect(html).toContain('data-testid="campaign-creation-success"');
    expect(html).toContain('data-testid="created-campaign-id"');
    expect(html).toContain(sampleSuccessResponse.campaignId);

    // Separately labeled server-owned fields
    expect(html).toContain("Total Planned Scenes:");
    expect(html).toContain('data-testid="created-total-scenes"');
    expect(html).toContain(">5<");

    expect(html).toContain("Materialized Scene Count:");
    expect(html).toContain('data-testid="created-scene-count"');
    expect(html).toContain(">4<");

    expect(html).toContain('data-testid="created-scenes-list"');
    expect(html).toContain('data-testid="created-scene-1"');
    expect(html).toContain('data-testid="created-scene-2"');
    expect(html).toContain('data-testid="created-scene-3"');
    expect(html).toContain('data-testid="created-scene-4"');
    expect(html).toContain('data-testid="view-campaign-link"');
    expect(html).toContain(`href="/campaigns/${sampleSuccessResponse.campaignId}"`);
  });

  it("in-flight duplicate submission suppression at state transition level (AC-8)", () => {
    const submittingState: CampaignCreationState = {
      phase: "submitting",
      values: validValues,
      idempotencyKey: "key-1",
      request: {
        idempotencyKey: "key-1",
        clientId: validValues.clientId,
        title: validValues.title,
        targetTotalDurationMs: 15000,
        brief: { description: validValues.briefDescription }
      }
    };

    // When submitting phase is active, a SUBMIT event is a no-op
    const result = transitionCampaignCreationState(submittingState, {
      type: "SUBMIT",
      idempotencyKey: "key-2"
    });

    expect(result.state).toBe(submittingState);
    expect(result.effect).toEqual({ type: "none" });
  });

  it("submitting from submit-error with unchanged values executes fresh submit without assuming same-intent reuse", () => {
    const errorState: CampaignCreationState = {
      phase: "submit-error",
      values: validValues,
      error: {
        statusCode: 500,
        message: "Internal error",
        isConflict: false
      },
      fieldErrors: {}
    };

    const freshKey = "22222222-2222-4222-8222-222222222222";
    const result = transitionCampaignCreationState(errorState, {
      type: "SUBMIT",
      idempotencyKey: freshKey
    });

    expect(result.state.phase).toBe("submitting");
    expect(result.effect.type).toBe("submit");
    if (result.state.phase === "submitting") {
      expect(result.state.idempotencyKey).toBe(freshKey);
      expect(result.state.request.idempotencyKey).toBe(freshKey);
    }
  });

  describe("Mounted Client Component DOM tests (F-eec23cde)", () => {
    it("submits Auto mode form without sceneCountOverride", async () => {
      const mockSubmit = vi.fn().mockResolvedValue(sampleSuccessResponse);
      render(<CampaignCreationForm submitCampaign={mockSubmit} initialValues={validValues} />);

      const submitBtn = screen.getByTestId("submit-campaign-button");
      fireEvent.click(submitBtn);

      await waitFor(() => {
        expect(mockSubmit).toHaveBeenCalledTimes(1);
      });

      const firstCall = mockSubmit.mock.calls[0];
      expect(firstCall).toBeDefined();
      if (!firstCall) return;
      const calledRequest = firstCall[0];
      expect("sceneCountOverride" in calledRequest).toBe(false);
      expect(calledRequest.sceneCountOverride).toBeUndefined();
      expect(calledRequest.title).toBe(validValues.title);
      expect(calledRequest.clientId).toBe(validValues.clientId);
      expect(calledRequest.targetTotalDurationMs).toBe(15000);
      expect(calledRequest.brief.description).toBe(validValues.briefDescription);
    });

    it("allows selecting Custom mode, entering integer, and submitting with sceneCountOverride", async () => {
      const mockSubmit = vi.fn().mockResolvedValue(sampleSuccessResponse);
      render(<CampaignCreationForm submitCampaign={mockSubmit} initialValues={validValues} />);

      const customRadio = screen.getByTestId("scene-count-mode-custom");
      fireEvent.click(customRadio);

      const overrideInput = screen.getByTestId("scene-count-override-input");
      expect(overrideInput.hasAttribute("required")).toBe(true);
      fireEvent.change(overrideInput, { target: { value: "3" } });

      const submitBtn = screen.getByTestId("submit-campaign-button");
      fireEvent.click(submitBtn);

      await waitFor(() => {
        expect(mockSubmit).toHaveBeenCalledTimes(1);
      });

      const firstCall = mockSubmit.mock.calls[0];
      expect(firstCall).toBeDefined();
      if (!firstCall) return;
      const calledRequest = firstCall[0];
      expect("sceneCountOverride" in calledRequest).toBe(true);
      expect(calledRequest.sceneCountOverride).toBe(3);
    });

    it("blocks duplicate submissions while a request is in flight and shows loading state (AC-8)", async () => {
      let resolveSubmit!: (res: PlanCampaignStoryboardResponse) => void;
      const pendingPromise = new Promise<PlanCampaignStoryboardResponse>((resolve) => {
        resolveSubmit = resolve;
      });
      const pendingSubmit = vi.fn().mockReturnValue(pendingPromise);

      render(<CampaignCreationForm submitCampaign={pendingSubmit} initialValues={validValues} />);

      const submitBtn = screen.getByTestId("submit-campaign-button") as HTMLButtonElement;
      fireEvent.click(submitBtn);

      await waitFor(() => {
        expect(pendingSubmit).toHaveBeenCalledTimes(1);
      });

      // Submit button is disabled and shows loading indicator
      expect(submitBtn.disabled).toBe(true);
      expect(submitBtn.textContent).toBe("Planning Storyboard...");

      // Attempt second submission while in flight
      fireEvent.click(submitBtn);
      // Still called only once
      expect(pendingSubmit).toHaveBeenCalledTimes(1);

      // Now resolve the promise
      act(() => {
        resolveSubmit(sampleSuccessResponse);
      });

      // Renders success UI
      await waitFor(() => {
        expect(screen.getByTestId("campaign-creation-success")).toBeTruthy();
      });

      expect(screen.getByTestId("created-total-scenes").textContent).toBe("5");
      expect(screen.getByTestId("created-scene-count").textContent).toBe("4");
    });

    it("surfaces rejection error in error banner and keeps submit available without Retry button", async () => {
      const conflictError = new PlanCampaignStoryboardApiError(409, {
        code: "IDEMPOTENCY_CONFLICT",
        message: "Key already committed with conflicting parameters"
      });
      const failingSubmit = vi.fn().mockRejectedValue(conflictError);

      render(<CampaignCreationForm submitCampaign={failingSubmit} initialValues={validValues} />);

      const submitBtn = screen.getByTestId("submit-campaign-button") as HTMLButtonElement;
      fireEvent.click(submitBtn);

      await waitFor(() => {
        expect(screen.getByTestId("campaign-creation-conflict")).toBeTruthy();
      });

      expect(screen.getByTestId("campaign-creation-conflict").textContent).toContain(
        "Key already committed with conflicting parameters"
      );

      // No retry control exists
      expect(screen.queryByText(/try again/i)).toBeNull();
      expect(screen.queryByText(/retry/i)).toBeNull();

      // Submit button is re-enabled for user editing/resubmission
      expect(submitBtn.disabled).toBe(false);
      expect(submitBtn.textContent).toBe("Create & Plan Campaign");

      // Input values remain unchanged
      expect((screen.getByTestId("campaign-title-input") as HTMLInputElement).value).toBe(
        validValues.title
      );
    });

    it("blocks submission and shows field error when Custom mode override is fractional in DOM", async () => {
      const mockSubmit = vi.fn().mockResolvedValue(sampleSuccessResponse);
      render(<CampaignCreationForm submitCampaign={mockSubmit} initialValues={validValues} />);

      const customRadio = screen.getByTestId("scene-count-mode-custom");
      fireEvent.click(customRadio);

      const overrideInput = screen.getByTestId("scene-count-override-input");
      expect(overrideInput.getAttribute("min")).toBe(String(MIN_SCENE_COUNT));
      expect(overrideInput.getAttribute("max")).toBe(String(MAX_SCENE_COUNT));
      fireEvent.change(overrideInput, { target: { value: "3.5" } });

      const form = screen.getByTestId("campaign-creation-form");
      fireEvent.submit(form);

      await waitFor(() => {
        expect(screen.getByTestId("field-error-scene-count-override")).toBeTruthy();
      });

      expect(screen.getByTestId("field-error-scene-count-override").textContent).toBe(
        "Custom scene count must be a whole integer"
      );
      expect(mockSubmit).not.toHaveBeenCalled();
    });

    it("surfaces 400 VALIDATION_FAILURE in validation banner and maps field errors", async () => {
      const validationError = new PlanCampaignStoryboardApiError(400, {
        code: "VALIDATION_FAILURE",
        message: "Invalid campaign parameters",
        details: [
          {
            path: ["brief", "description"],
            message: "Brief description is too short"
          }
        ]
      });
      const failingSubmit = vi.fn().mockRejectedValue(validationError);

      render(<CampaignCreationForm submitCampaign={failingSubmit} initialValues={validValues} />);

      const submitBtn = screen.getByTestId("submit-campaign-button");
      fireEvent.click(submitBtn);

      await waitFor(() => {
        expect(screen.getByTestId("campaign-creation-validation-error")).toBeTruthy();
      });

      expect(screen.getByTestId("campaign-creation-validation-error").textContent).toContain(
        "Invalid campaign parameters"
      );
      expect(screen.getByTestId("field-error-brief-description").textContent).toBe(
        "Brief description is too short"
      );
      expect(screen.queryByText(/retry/i)).toBeNull();
      expect(screen.queryByText(/try again/i)).toBeNull();
    });

    it("reuses the same idempotency key when retrying after a failed submission with unchanged form values", async () => {
      const networkError = new Error("Network timeout");
      const mockSubmit = vi
        .fn()
        .mockRejectedValueOnce(networkError)
        .mockResolvedValueOnce(sampleSuccessResponse);

      render(<CampaignCreationForm submitCampaign={mockSubmit} initialValues={validValues} />);

      const submitBtn = screen.getByTestId("submit-campaign-button") as HTMLButtonElement;
      fireEvent.click(submitBtn);

      await waitFor(() => {
        expect(mockSubmit).toHaveBeenCalledTimes(1);
      });

      const firstCall = mockSubmit.mock.calls[0];
      expect(firstCall).toBeDefined();
      if (!firstCall) return;
      const firstCallKey = firstCall[0].idempotencyKey;
      expect(firstCallKey).toBeDefined();

      // Submit button re-enabled after error
      await waitFor(() => {
        expect(submitBtn.disabled).toBe(false);
      });

      // User clicks submit again without changing form values
      fireEvent.click(submitBtn);

      await waitFor(() => {
        expect(mockSubmit).toHaveBeenCalledTimes(2);
      });

      const secondCall = mockSubmit.mock.calls[1];
      expect(secondCall).toBeDefined();
      if (!secondCall) return;
      const secondCallKey = secondCall[0].idempotencyKey;
      expect(secondCallKey).toBe(firstCallKey);
    });

    it("uses a new idempotency key when submitting after changing brief description following an error", async () => {
      const serverError = new Error("500 Internal Server Error");
      const mockSubmit = vi
        .fn()
        .mockRejectedValueOnce(serverError)
        .mockResolvedValueOnce(sampleSuccessResponse);

      render(<CampaignCreationForm submitCampaign={mockSubmit} initialValues={validValues} />);

      const submitBtn = screen.getByTestId("submit-campaign-button") as HTMLButtonElement;
      fireEvent.click(submitBtn);

      await waitFor(() => {
        expect(mockSubmit).toHaveBeenCalledTimes(1);
      });

      const firstCall = mockSubmit.mock.calls[0];
      expect(firstCall).toBeDefined();
      if (!firstCall) return;
      const firstCallKey = firstCall[0].idempotencyKey;

      await waitFor(() => {
        expect(submitBtn.disabled).toBe(false);
      });

      // User changes brief description
      const briefInput = screen.getByTestId("brief-description-input");
      fireEvent.change(briefInput, {
        target: { value: "New altered brief description for campaign" }
      });

      fireEvent.click(submitBtn);

      await waitFor(() => {
        expect(mockSubmit).toHaveBeenCalledTimes(2);
      });

      const secondCall = mockSubmit.mock.calls[1];
      expect(secondCall).toBeDefined();
      if (!secondCall) return;
      const secondCallKey = secondCall[0].idempotencyKey;
      expect(secondCallKey).not.toBe(firstCallKey);
      expect(secondCall[0].brief.description).toBe("New altered brief description for campaign");
    });
  });
});
