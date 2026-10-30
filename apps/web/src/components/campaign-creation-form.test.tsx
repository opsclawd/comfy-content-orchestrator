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
  type PlanCampaignStoryboardResponse,
  type ReferenceAssetResponse
} from "@cco/contracts";
import * as ClientApiModule from "../api/client.js";
const { PlanCampaignStoryboardApiError } = ClientApiModule;

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

const mockPush = vi.fn();
vi.mock("next/navigation", () => ({
  useRouter: () => ({
    push: mockPush,
    refresh: vi.fn()
  })
}));

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
    briefVisualStyle: "golden hour cinematic",
    targetEngineProfileId: "MINIMAX_H3_720P_5S_I2V_V1"
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

  const defaultClients = [
    {
      clientId: "11111111-1111-4111-8111-111111111111",
      companyName: "Acme Corporation"
    },
    {
      clientId: "33333333-3333-3333-3333-333333333333",
      companyName: "Beta Studios"
    }
  ];

  beforeEach(() => {
    vi.clearAllMocks();
    vi.spyOn(ClientApiModule, "listClients").mockResolvedValue(defaultClients);
  });

  afterEach(() => {
    cleanup();
    vi.clearAllMocks();
  });

  it("renders the creation form in idle state with Auto scene count mode and MiniMax-H3 selected by default", () => {
    const html = renderToStaticMarkup(<CampaignCreationForm initialValues={validValues} />);

    expect(html).toContain('data-testid="campaign-creation-surface"');
    expect(html).toContain('data-testid="campaign-creation-form"');
    expect(html).toContain('data-testid="brief-description-input"');
    expect(html).toContain('data-testid="brief-visual-style-input"');
    expect(html).toContain('data-testid="campaign-title-input"');
    expect(html).toContain('data-testid="client-select"');
    expect(html).toContain("Client *");
    expect(html).toContain("Loading clients...");
    expect(html).toContain('data-testid="target-platform-input"');
    expect(html).toContain('data-testid="target-duration-input"');
    expect(html).toContain('data-testid="scene-count-mode-auto"');
    expect(html).toContain('data-testid="scene-count-mode-custom"');
    expect(html).toContain('data-testid="scene-count-auto-hint"');
    expect(html).toContain("Scene count will be determined automatically");
    expect(html).not.toContain('data-testid="scene-count-override-input"');
    expect(html).toContain('data-testid="engine-selection-group"');
    expect(html).toContain('data-testid="engine-card-minimax-h3"');
    expect(html).toContain('data-testid="engine-radio-minimax-h3"');
    expect(html).toContain('data-testid="engine-card-ltx-25"');
    expect(html).toContain('data-testid="engine-radio-ltx-25"');
    expect(html).toContain("MiniMax-H3");
    expect(html).toContain("Photorealistic Hero");
    expect(html).toContain("LTX-Video 2.5");
    expect(html).toContain("Fast Animatics");
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

    const html = renderToStaticMarkup(
      <CampaignCreationForm
        state={validationFailedState}
        initialClients={[
          { clientId: "bad-client", companyName: "Bad Client Inc" },
          ...defaultClients
        ]}
      />
    );

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

    const html = renderToStaticMarkup(
      <CampaignCreationForm state={conflictState} initialClients={defaultClients} />
    );

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
      render(
        <CampaignCreationForm
          submitCampaign={mockSubmit}
          initialValues={validValues}
          initialClients={defaultClients}
        />
      );

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
      expect(calledRequest.targetEngineProfileId).toBe("MINIMAX_H3_720P_5S_I2V_V1");
    });

    it("allows selecting LTX-Video 2.5 engine profile radio card and submitting with chosen profile", async () => {
      const mockSubmit = vi.fn().mockResolvedValue(sampleSuccessResponse);
      render(
        <CampaignCreationForm
          submitCampaign={mockSubmit}
          initialValues={validValues}
          initialClients={defaultClients}
        />
      );

      const ltxRadio = screen.getByTestId("engine-radio-ltx-25");
      fireEvent.click(ltxRadio);

      const submitBtn = screen.getByTestId("submit-campaign-button");
      fireEvent.click(submitBtn);

      await waitFor(() => {
        expect(mockSubmit).toHaveBeenCalledTimes(1);
      });

      const firstCall = mockSubmit.mock.calls[0];
      expect(firstCall).toBeDefined();
      if (!firstCall) return;
      const calledRequest = firstCall[0];
      expect(calledRequest.targetEngineProfileId).toBe("LTX_25_720P_5S_V1");
    });

    it("renders MiniMax-H3 Turbo toggle unchecked by default and submits with base profile", async () => {
      const mockSubmit = vi.fn().mockResolvedValue(sampleSuccessResponse);
      render(
        <CampaignCreationForm
          submitCampaign={mockSubmit}
          initialValues={validValues}
          initialClients={defaultClients}
        />
      );

      const turboToggle = screen.getByTestId("minimax-h3-turbo-toggle") as HTMLInputElement;
      expect(turboToggle).not.toBeNull();
      expect(turboToggle.checked).toBe(false);

      const submitBtn = screen.getByTestId("submit-campaign-button");
      fireEvent.click(submitBtn);

      await waitFor(() => {
        expect(mockSubmit).toHaveBeenCalledTimes(1);
      });

      const firstCall = mockSubmit.mock.calls[0];
      expect(firstCall![0].targetEngineProfileId).toBe("MINIMAX_H3_720P_5S_I2V_V1");
    });

    it("checking turbo toggle updates targetEngineProfileId to turbo and submits with turbo profile", async () => {
      const mockSubmit = vi.fn().mockResolvedValue(sampleSuccessResponse);
      render(
        <CampaignCreationForm
          submitCampaign={mockSubmit}
          initialValues={validValues}
          initialClients={defaultClients}
        />
      );

      const turboToggle = screen.getByTestId("minimax-h3-turbo-toggle") as HTMLInputElement;
      expect(turboToggle.checked).toBe(false);

      fireEvent.click(turboToggle);
      expect(turboToggle.checked).toBe(true);

      const submitBtn = screen.getByTestId("submit-campaign-button");
      fireEvent.click(submitBtn);

      await waitFor(() => {
        expect(mockSubmit).toHaveBeenCalledTimes(1);
      });

      const firstCall = mockSubmit.mock.calls[0];
      expect(firstCall![0].targetEngineProfileId).toBe("MINIMAX_H3_720P_5S_REF2V_TURBO4_V1");
    });

    it("unchecking turbo toggle restores base MiniMax-H3 profile", async () => {
      const mockSubmit = vi.fn().mockResolvedValue(sampleSuccessResponse);
      render(
        <CampaignCreationForm
          submitCampaign={mockSubmit}
          initialValues={{
            ...validValues,
            targetEngineProfileId: "MINIMAX_H3_720P_5S_REF2V_TURBO4_V1"
          }}
          initialClients={defaultClients}
        />
      );

      const turboToggle = screen.getByTestId("minimax-h3-turbo-toggle") as HTMLInputElement;
      expect(turboToggle.checked).toBe(true);

      fireEvent.click(turboToggle);
      expect(turboToggle.checked).toBe(false);

      const submitBtn = screen.getByTestId("submit-campaign-button");
      fireEvent.click(submitBtn);

      await waitFor(() => {
        expect(mockSubmit).toHaveBeenCalledTimes(1);
      });

      const firstCall = mockSubmit.mock.calls[0];
      expect(firstCall![0].targetEngineProfileId).toBe("MINIMAX_H3_720P_5S_I2V_V1");
    });

    it("switching to LTX-Video 2.5 hides the turbo toggle and switching back selects base MiniMax-H3", async () => {
      render(
        <CampaignCreationForm
          submitCampaign={vi.fn().mockResolvedValue(sampleSuccessResponse)}
          initialValues={validValues}
          initialClients={defaultClients}
        />
      );

      expect(screen.getByTestId("minimax-h3-turbo-toggle")).not.toBeNull();

      const ltxRadio = screen.getByTestId("engine-radio-ltx-25");
      fireEvent.click(ltxRadio);

      expect(screen.queryByTestId("minimax-h3-turbo-toggle")).toBeNull();

      const minimaxRadio = screen.getByTestId("engine-radio-minimax-h3");
      fireEvent.click(minimaxRadio);

      const restoredToggle = screen.getByTestId("minimax-h3-turbo-toggle") as HTMLInputElement;
      expect(restoredToggle).not.toBeNull();
      expect(restoredToggle.checked).toBe(false);
    });

    it("allows selecting Custom mode, entering integer, and submitting with sceneCountOverride", async () => {
      const mockSubmit = vi.fn().mockResolvedValue(sampleSuccessResponse);
      render(
        <CampaignCreationForm
          submitCampaign={mockSubmit}
          initialValues={validValues}
          initialClients={defaultClients}
        />
      );

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

      render(
        <CampaignCreationForm
          submitCampaign={pendingSubmit}
          initialValues={validValues}
          initialClients={defaultClients}
        />
      );

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
        expect(mockPush).toHaveBeenCalledWith(`/campaigns/${sampleSuccessResponse.campaignId}`);
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

      render(
        <CampaignCreationForm
          submitCampaign={failingSubmit}
          initialValues={validValues}
          initialClients={defaultClients}
        />
      );

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
      render(
        <CampaignCreationForm
          submitCampaign={mockSubmit}
          initialValues={validValues}
          initialClients={defaultClients}
        />
      );

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

      render(
        <CampaignCreationForm
          submitCampaign={failingSubmit}
          initialValues={validValues}
          initialClients={defaultClients}
        />
      );

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

      render(
        <CampaignCreationForm
          submitCampaign={mockSubmit}
          initialValues={validValues}
          initialClients={defaultClients}
        />
      );

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

      render(
        <CampaignCreationForm
          submitCampaign={mockSubmit}
          initialValues={validValues}
          initialClients={defaultClients}
        />
      );

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

    it("navigates automatically to the campaign review route on successful submission", async () => {
      const mockSubmit = vi.fn().mockResolvedValue(sampleSuccessResponse);
      render(
        <CampaignCreationForm
          submitCampaign={mockSubmit}
          initialValues={validValues}
          initialClients={defaultClients}
        />
      );

      const submitBtn = screen.getByTestId("submit-campaign-button");
      fireEvent.click(submitBtn);

      await waitFor(() => {
        expect(mockPush).toHaveBeenCalledWith(`/campaigns/${sampleSuccessResponse.campaignId}`);
      });
    });
  });

  describe("Reference Library and Campaign Selection Integration", () => {
    const sampleRef1: ReferenceAssetResponse = {
      id: "11111111-1111-1111-1111-111111111111",
      clientId: validValues.clientId,
      assetType: "image",
      storageBucket: "cco-reference-assets",
      storageObjectKey: "refs/ref-1.png",
      contentHashSha256: "1111111111111111111111111111111111111111111111111111111111111111",
      mimeType: "image/png",
      displayName: "Hero Character Model",
      libraryRole: "subject_identity",
      previewAvailability: "available",
      previewUrl: "https://example.com/ref-1.png",
      width: 1024,
      height: 1024
    };

    const sampleRef2: ReferenceAssetResponse = {
      id: "22222222-2222-2222-2222-222222222222",
      clientId: validValues.clientId,
      assetType: "image",
      storageBucket: "cco-reference-assets",
      storageObjectKey: "refs/ref-2.png",
      contentHashSha256: "2222222222222222222222222222222222222222222222222222222222222222",
      mimeType: "image/png",
      displayName: "Branded Product Bottle",
      libraryRole: "product",
      previewAvailability: "available",
      previewUrl: "https://example.com/ref-2.png",
      width: 1920,
      height: 1080
    };

    it("renders prompt when client ID is not entered or invalid", () => {
      render(
        <CampaignCreationForm
          initialValues={{ ...validValues, clientId: "" }}
          initialReferences={[]}
        />
      );

      expect(screen.getByTestId("reference-library-prompt")).toBeTruthy();
      expect(screen.getByTestId("reference-library-prompt").textContent).toContain(
        "Enter a valid Client ID above"
      );
    });

    it("renders active reference assets with thumbnails and role badges", () => {
      render(
        <CampaignCreationForm
          initialValues={validValues}
          initialReferences={[sampleRef1, sampleRef2]}
        />
      );

      const card1 = screen.getByTestId(`reference-card-${sampleRef1.id}`);
      const card2 = screen.getByTestId(`reference-card-${sampleRef2.id}`);
      expect(card1).toBeTruthy();
      expect(card2).toBeTruthy();

      expect(card1.textContent).toContain("Hero Character Model");
      expect(card1.textContent).toContain("Subject Identity");
      expect(card2.textContent).toContain("Branded Product Bottle");
      expect(card2.textContent).toContain("Product");
    });

    it("toggles reference selection on card click and submits candidateReferenceAssetIds", async () => {
      const mockSubmit = vi.fn().mockResolvedValue(sampleSuccessResponse);
      render(
        <CampaignCreationForm
          submitCampaign={mockSubmit}
          initialValues={validValues}
          initialReferences={[sampleRef1, sampleRef2]}
          initialClients={defaultClients}
        />
      );

      const card1 = screen.getByTestId(`reference-card-${sampleRef1.id}`);
      expect(card1.getAttribute("data-selected")).toBe("false");

      fireEvent.click(card1);
      expect(card1.getAttribute("data-selected")).toBe("true");
      expect(screen.getByTestId("selected-reference-count").textContent).toContain("1 selected");

      const submitBtn = screen.getByTestId("submit-campaign-button");
      fireEvent.click(submitBtn);

      await waitFor(() => {
        expect(mockSubmit).toHaveBeenCalledTimes(1);
      });

      const submittedRequest = mockSubmit.mock.calls[0]![0];
      expect(submittedRequest.candidateReferenceAssetIds).toEqual([sampleRef1.id]);
    });

    it("toggles multiple references and deselects", async () => {
      const mockSubmit = vi.fn().mockResolvedValue(sampleSuccessResponse);
      render(
        <CampaignCreationForm
          submitCampaign={mockSubmit}
          initialValues={validValues}
          initialReferences={[sampleRef1, sampleRef2]}
          initialClients={defaultClients}
        />
      );

      const card1 = screen.getByTestId(`reference-card-${sampleRef1.id}`);
      const card2 = screen.getByTestId(`reference-card-${sampleRef2.id}`);

      // Select both
      fireEvent.click(card1);
      fireEvent.click(card2);
      expect(card1.getAttribute("data-selected")).toBe("true");
      expect(card2.getAttribute("data-selected")).toBe("true");
      expect(screen.getByTestId("selected-reference-count").textContent).toContain("2 selected");

      // Deselect card1
      fireEvent.click(card1);
      expect(card1.getAttribute("data-selected")).toBe("false");
      expect(card2.getAttribute("data-selected")).toBe("true");
      expect(screen.getByTestId("selected-reference-count").textContent).toContain("1 selected");

      const submitBtn = screen.getByTestId("submit-campaign-button");
      fireEvent.click(submitBtn);

      await waitFor(() => {
        expect(mockSubmit).toHaveBeenCalledTimes(1);
      });

      expect(mockSubmit.mock.calls[0]![0].candidateReferenceAssetIds).toEqual([sampleRef2.id]);
    });

    it("client isolation: changing client ID clears selected references and loaded references", async () => {
      render(
        <CampaignCreationForm
          initialValues={validValues}
          initialReferences={[sampleRef1, sampleRef2]}
        />
      );

      const card1 = screen.getByTestId(`reference-card-${sampleRef1.id}`);
      fireEvent.click(card1);
      expect(screen.getByTestId("selected-reference-count").textContent).toContain("1 selected");

      // Change client ID to a different client
      const clientSelect = await screen.findByTestId("client-select");
      fireEvent.change(clientSelect, {
        target: { value: "33333333-3333-3333-3333-333333333333" }
      });

      // Selected reference count should be gone
      expect(screen.queryByTestId("selected-reference-count")).toBeNull();
      // Prior client cards should no longer be displayed
      expect(screen.queryByTestId(`reference-card-${sampleRef1.id}`)).toBeNull();
    });

    it("opens Reference Library Drawer when clicking Manage Library / Upload", async () => {
      render(<CampaignCreationForm initialValues={validValues} initialReferences={[sampleRef1]} />);

      const manageBtn = screen.getByTestId("manage-references-button");
      fireEvent.click(manageBtn);

      expect(screen.getByTestId("reference-library-drawer")).toBeTruthy();
      expect(screen.getByText("Client Reference Library")).toBeTruthy();
    });

    it("filters out foreign client rows from listClientReferences response", async () => {
      const foreignRef: ReferenceAssetResponse = {
        ...sampleRef1,
        id: "foreign-id-9999",
        clientId: "99999999-9999-9999-9999-999999999999",
        displayName: "Foreign Client Asset"
      };

      vi.spyOn(ClientApiModule, "listClientReferences").mockResolvedValueOnce([
        sampleRef1,
        foreignRef
      ]);

      render(<CampaignCreationForm initialValues={validValues} />);

      await waitFor(() => {
        expect(screen.getByTestId(`reference-card-${sampleRef1.id}`)).toBeDefined();
      });

      expect(screen.queryByTestId(`reference-card-${foreignRef.id}`)).toBeNull();
      expect(screen.queryByText("Foreign Client Asset")).toBeNull();
    });

    it("race condition: invalidates fetch generation when client selection is cleared", async () => {
      let resolveClientA!: (refs: readonly ReferenceAssetResponse[]) => void;
      const clientAPromise = new Promise<readonly ReferenceAssetResponse[]>((resolve) => {
        resolveClientA = resolve;
      });

      vi.spyOn(ClientApiModule, "listClientReferences").mockReturnValueOnce(clientAPromise);

      render(<CampaignCreationForm initialValues={validValues} />);

      // Clear client selection to placeholder while fetch is in-flight
      const clientSelect = await screen.findByTestId("client-select");
      fireEvent.change(clientSelect, { target: { value: "" } });

      // Client A's fetch resolves late
      resolveClientA([sampleRef1]);

      // Verify Client A's reference is NOT rendered and prompt is displayed
      await waitFor(() => {
        expect(screen.getByTestId("reference-library-prompt")).toBeDefined();
      });
      expect(screen.queryByTestId(`reference-card-${sampleRef1.id}`)).toBeNull();
    });

    it("refuses submission and shows error when client references failed to load", async () => {
      vi.spyOn(ClientApiModule, "listClientReferences").mockRejectedValueOnce(
        new Error("Network connection lost")
      );

      const mockSubmit = vi.fn().mockResolvedValue(sampleSuccessResponse);
      render(
        <CampaignCreationForm
          submitCampaign={mockSubmit}
          initialValues={{
            ...validValues,
            candidateReferenceAssetIds: [sampleRef1.id]
          }}
          initialClients={defaultClients}
        />
      );

      await waitFor(() => {
        expect(screen.getByTestId("reference-gallery-error")).toBeDefined();
      });

      const submitBtn = screen.getByTestId("submit-campaign-button");
      fireEvent.click(submitBtn);

      expect(mockSubmit).not.toHaveBeenCalled();
    });

    it("refuses submission when client references load empty but candidateReferenceAssetIds are present", async () => {
      vi.spyOn(ClientApiModule, "listClientReferences").mockResolvedValueOnce([]);

      const mockSubmit = vi.fn().mockResolvedValue(sampleSuccessResponse);
      render(
        <CampaignCreationForm
          submitCampaign={mockSubmit}
          initialValues={{
            ...validValues,
            candidateReferenceAssetIds: [sampleRef1.id]
          }}
          initialClients={defaultClients}
        />
      );

      await waitFor(() => {
        expect(screen.getByTestId("reference-gallery-empty")).toBeDefined();
      });

      const submitBtn = screen.getByTestId("submit-campaign-button");
      fireEvent.click(submitBtn);

      expect(mockSubmit).not.toHaveBeenCalled();
      expect(screen.getByTestId("reference-gallery-error")).toBeDefined();
      expect(screen.getByTestId("reference-gallery-error").textContent).toContain(
        "selected reference asset(s) are not active references"
      );
    });

    it("refuses submission when candidateReferenceAssetIds contains an ID outside loaded active references", async () => {
      const mockSubmit = vi.fn().mockResolvedValue(sampleSuccessResponse);
      render(
        <CampaignCreationForm
          submitCampaign={mockSubmit}
          initialValues={{
            ...validValues,
            candidateReferenceAssetIds: ["unknown-id-8888"]
          }}
          initialReferences={[sampleRef1]}
          initialClients={defaultClients}
        />
      );

      const submitBtn = screen.getByTestId("submit-campaign-button");
      fireEvent.click(submitBtn);

      expect(mockSubmit).not.toHaveBeenCalled();
      expect(screen.getByTestId("reference-gallery-error")).toBeDefined();
      expect(screen.getByTestId("reference-gallery-error").textContent).toContain(
        "selected reference asset(s) are not active references"
      );
    });
  });

  describe("Client Selection Dropdown Integration (#430)", () => {
    const clientsFixture = [
      {
        clientId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
        companyName: "Acme Studios"
      },
      {
        clientId: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
        companyName: "Beta Brand"
      },
      {
        clientId: "cccccccc-cccc-4ccc-8ccc-cccccccccccc",
        companyName: "Beta Brand"
      }
    ];

    it("populates dropdown with company names and client IDs returned by listClients", async () => {
      vi.spyOn(ClientApiModule, "listClients").mockResolvedValueOnce(clientsFixture);

      render(<CampaignCreationForm initialValues={{ ...validValues, clientId: "" }} />);

      const select = screen.getByTestId("client-select") as HTMLSelectElement;
      expect(select).toBeDefined();

      await waitFor(() => {
        expect(screen.queryByText("Loading clients...")).toBeNull();
      });

      const options = Array.from(select.querySelectorAll("option"));
      expect(options.map((o) => ({ value: o.value, text: o.textContent }))).toEqual([
        { value: "", text: "Select a client" },
        { value: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa", text: "Acme Studios" },
        { value: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb", text: "Beta Brand" },
        { value: "cccccccc-cccc-4ccc-8ccc-cccccccccccc", text: "Beta Brand" }
      ]);
    });

    it("regression: selecting a client from dropdown submits the selected clientId", async () => {
      vi.spyOn(ClientApiModule, "listClients").mockResolvedValueOnce(clientsFixture);
      const mockSubmit = vi.fn().mockResolvedValue(sampleSuccessResponse);

      render(
        <CampaignCreationForm
          submitCampaign={mockSubmit}
          initialValues={{
            ...validValues,
            clientId: ""
          }}
        />
      );

      const select = (await screen.findByTestId("client-select")) as HTMLSelectElement;
      await waitFor(() => {
        expect(screen.getByText("Acme Studios")).toBeDefined();
      });

      fireEvent.change(select, {
        target: { value: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa" }
      });

      expect(select.value).toBe("aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa");

      const submitBtn = screen.getByTestId("submit-campaign-button");
      fireEvent.click(submitBtn);

      await waitFor(() => {
        expect(mockSubmit).toHaveBeenCalledTimes(1);
      });

      const callArgs = mockSubmit.mock.calls[0]![0];
      expect(callArgs.clientId).toBe("aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa");
    });

    it("handles empty client list: renders guidance and disables select", async () => {
      vi.spyOn(ClientApiModule, "listClients").mockResolvedValueOnce([]);

      render(<CampaignCreationForm initialValues={{ ...validValues, clientId: "" }} />);

      const select = (await screen.findByTestId("client-select")) as HTMLSelectElement;
      await waitFor(() => {
        expect(screen.getByTestId("no-clients-message")).toBeDefined();
      });

      expect(screen.getByText("No clients available")).toBeDefined();
      expect(select.disabled).toBe(true);
    });

    it("handles client fetch error and supports retry", async () => {
      const listSpy = vi
        .spyOn(ClientApiModule, "listClients")
        .mockRejectedValueOnce(new Error("Network timeout fetching clients"))
        .mockResolvedValueOnce(clientsFixture);

      render(<CampaignCreationForm initialValues={{ ...validValues, clientId: "" }} />);

      await waitFor(() => {
        expect(screen.getByTestId("client-list-error")).toBeDefined();
      });

      expect(screen.getByTestId("client-list-error").textContent).toContain(
        "Network timeout fetching clients"
      );
      const retryBtn = screen.getByTestId("retry-clients-button");
      expect(retryBtn).toBeDefined();

      fireEvent.click(retryBtn);

      await waitFor(() => {
        expect(screen.queryByTestId("client-list-error")).toBeNull();
        expect(screen.getByText("Acme Studios")).toBeDefined();
      });

      expect(listSpy).toHaveBeenCalledTimes(2);
    });

    it("handles initial client not found in loaded list: shows unavailable warning and blocks submit", async () => {
      vi.spyOn(ClientApiModule, "listClients").mockResolvedValueOnce(clientsFixture);
      const mockSubmit = vi.fn().mockResolvedValue(sampleSuccessResponse);

      render(
        <CampaignCreationForm
          submitCampaign={mockSubmit}
          initialValues={{
            ...validValues,
            clientId: "99999999-9999-4999-8999-999999999999"
          }}
        />
      );

      await waitFor(() => {
        expect(screen.getByTestId("client-unavailable-message")).toBeDefined();
      });

      expect(screen.getByTestId("client-unavailable-message").textContent).toContain(
        "The selected client account is unavailable. Please select an existing client."
      );
      expect(screen.getByText("Selected client unavailable")).toBeDefined();

      const submitBtn = screen.getByTestId("submit-campaign-button");
      fireEvent.click(submitBtn);

      expect(mockSubmit).not.toHaveBeenCalled();
    });

    it("clears selected references when changing client selection", async () => {
      vi.spyOn(ClientApiModule, "listClients").mockResolvedValueOnce(clientsFixture);

      const ref1: ReferenceAssetResponse = {
        id: "ref-1111",
        clientId: clientsFixture[0]!.clientId,
        assetType: "image",
        storageBucket: "b",
        storageObjectKey: "k",
        contentHashSha256: "h",
        mimeType: "image/png",
        displayName: "Asset 1",
        libraryRole: "style",
        previewAvailability: "available",
        previewUrl: "https://example.com/1.png"
      };

      render(
        <CampaignCreationForm
          initialValues={{
            ...validValues,
            clientId: clientsFixture[0]!.clientId
          }}
          initialReferences={[ref1]}
        />
      );

      await waitFor(() => {
        expect(screen.getByText("Acme Studios")).toBeDefined();
      });

      const card = screen.getByTestId(`reference-card-${ref1.id}`);
      fireEvent.click(card);
      expect(screen.getByTestId("selected-reference-count").textContent).toContain("1 selected");

      const select = screen.getByTestId("client-select");
      fireEvent.change(select, {
        target: { value: clientsFixture[1]!.clientId }
      });

      expect(screen.queryByTestId("selected-reference-count")).toBeNull();
    });

    it("regression: populates dropdown via GET /api/clients and submits selected clientId via default POST /api/campaigns/plan", async () => {
      vi.mocked(ClientApiModule.listClients).mockRestore();

      vi.spyOn(globalThis, "fetch").mockImplementation(
        async (input: RequestInfo | URL, _init?: RequestInit) => {
          const url =
            typeof input === "string" ? input : input instanceof URL ? input.toString() : input.url;
          if (url === "/api/clients" || url.endsWith("/api/clients")) {
            return new Response(JSON.stringify(clientsFixture), {
              status: 200,
              headers: { "Content-Type": "application/json" }
            });
          }
          if (url === "/api/campaigns/plan" || url.endsWith("/api/campaigns/plan")) {
            return new Response(JSON.stringify(sampleSuccessResponse), {
              status: 200,
              headers: { "Content-Type": "application/json" }
            });
          }
          if (url.includes("/references")) {
            return new Response(JSON.stringify({ references: [] }), {
              status: 200,
              headers: { "Content-Type": "application/json" }
            });
          }
          return new Response("Not Found", { status: 404 });
        }
      );

      render(<CampaignCreationForm initialValues={{ ...validValues, clientId: "" }} />);

      const select = screen.getByTestId("client-select") as HTMLSelectElement;
      const submitBtn = screen.getByTestId("submit-campaign-button") as HTMLButtonElement;

      // During loading phase: both select and submit button are disabled
      expect(select.disabled).toBe(true);
      expect(submitBtn.disabled).toBe(true);

      // Await clients to load
      await waitFor(() => {
        expect(screen.getByText("Acme Studios")).toBeDefined();
      });

      expect(select.disabled).toBe(false);
      // Still disabled because no client is selected
      expect(submitBtn.disabled).toBe(true);

      // Select a client
      fireEvent.change(select, {
        target: { value: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa" }
      });

      expect(select.value).toBe("aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa");
      expect(submitBtn.disabled).toBe(false);

      // Submit the form
      fireEvent.click(submitBtn);

      await waitFor(() => {
        const calls = vi.mocked(globalThis.fetch).mock.calls;
        const postCall = calls.find((c) => String(c[0]).includes("/api/campaigns/plan"));
        expect(postCall).toBeDefined();
      });

      const calls = vi.mocked(globalThis.fetch).mock.calls;
      const postCall = calls.find((c) => String(c[0]).includes("/api/campaigns/plan"));
      expect(postCall).toBeDefined();
      const requestBody = JSON.parse(postCall?.[1]?.body as string) as {
        clientId: string;
        title: string;
        targetPlatform: string;
      };
      expect(requestBody.clientId).toBe("aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa");
      expect(requestBody.title).toBe(validValues.title);
      expect(requestBody.targetPlatform).toBe(validValues.targetPlatform);
    });

    it("disables select and submit button during loading phase and blocks programmatic submit", async () => {
      let resolveClients!: (data: typeof clientsFixture) => void;
      const pendingPromise = new Promise<typeof clientsFixture>((resolve) => {
        resolveClients = resolve;
      });
      vi.spyOn(ClientApiModule, "listClients").mockReturnValue(pendingPromise);

      const mockSubmit = vi.fn().mockResolvedValue(sampleSuccessResponse);
      render(
        <CampaignCreationForm
          submitCampaign={mockSubmit}
          initialValues={{
            ...validValues,
            clientId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa"
          }}
        />
      );

      const select = screen.getByTestId("client-select") as HTMLSelectElement;
      const submitBtn = screen.getByTestId("submit-campaign-button") as HTMLButtonElement;
      const form = screen.getByTestId("campaign-creation-form");

      expect(select.disabled).toBe(true);
      expect(submitBtn.disabled).toBe(true);

      fireEvent.submit(form);
      expect(mockSubmit).not.toHaveBeenCalled();

      await act(async () => {
        resolveClients(clientsFixture);
      });

      expect(select.disabled).toBe(false);
      expect(submitBtn.disabled).toBe(false);
    });

    it("disables select and submit button during error phase and blocks programmatic submit", async () => {
      vi.spyOn(ClientApiModule, "listClients").mockRejectedValue(
        new Error("Failed to load clients")
      );

      const mockSubmit = vi.fn().mockResolvedValue(sampleSuccessResponse);
      render(
        <CampaignCreationForm
          submitCampaign={mockSubmit}
          initialValues={{
            ...validValues,
            clientId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa"
          }}
        />
      );

      await waitFor(() => {
        expect(screen.getByTestId("client-list-error")).toBeDefined();
      });

      const select = screen.getByTestId("client-select") as HTMLSelectElement;
      const submitBtn = screen.getByTestId("submit-campaign-button") as HTMLButtonElement;
      const form = screen.getByTestId("campaign-creation-form");

      expect(select.disabled).toBe(true);
      expect(submitBtn.disabled).toBe(true);

      fireEvent.submit(form);
      expect(mockSubmit).not.toHaveBeenCalled();
    });

    it("disables select and submit button when client list is empty and blocks programmatic submit", async () => {
      vi.spyOn(ClientApiModule, "listClients").mockResolvedValue([]);

      const mockSubmit = vi.fn().mockResolvedValue(sampleSuccessResponse);
      render(
        <CampaignCreationForm
          submitCampaign={mockSubmit}
          initialValues={{
            ...validValues,
            clientId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa"
          }}
        />
      );

      await waitFor(() => {
        expect(screen.getByTestId("no-clients-message")).toBeDefined();
      });

      const select = screen.getByTestId("client-select") as HTMLSelectElement;
      const submitBtn = screen.getByTestId("submit-campaign-button") as HTMLButtonElement;
      const form = screen.getByTestId("campaign-creation-form");

      expect(select.disabled).toBe(true);
      expect(submitBtn.disabled).toBe(true);

      fireEvent.submit(form);
      expect(mockSubmit).not.toHaveBeenCalled();
    });

    it("disables select and submit button while submission is in flight", async () => {
      vi.spyOn(ClientApiModule, "listClients").mockResolvedValue(clientsFixture);

      let resolveSubmit!: (res: PlanCampaignStoryboardResponse) => void;
      const pendingSubmit = new Promise<PlanCampaignStoryboardResponse>((resolve) => {
        resolveSubmit = resolve;
      });
      const mockSubmit = vi.fn().mockReturnValue(pendingSubmit);

      render(
        <CampaignCreationForm
          submitCampaign={mockSubmit}
          initialValues={{
            ...validValues,
            clientId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa"
          }}
        />
      );

      await waitFor(() => {
        expect(screen.getByText("Acme Studios")).toBeDefined();
      });

      const select = screen.getByTestId("client-select") as HTMLSelectElement;
      const submitBtn = screen.getByTestId("submit-campaign-button") as HTMLButtonElement;

      expect(select.disabled).toBe(false);
      expect(submitBtn.disabled).toBe(false);

      fireEvent.click(submitBtn);

      expect(submitBtn.disabled).toBe(true);
      expect(select.disabled).toBe(true);

      await act(async () => {
        resolveSubmit(sampleSuccessResponse);
      });
    });

    it("preserves initial client ID without displaying raw UUID during deferred loading for known client", async () => {
      let resolveClients!: (data: typeof clientsFixture) => void;
      const pendingPromise = new Promise<typeof clientsFixture>((resolve) => {
        resolveClients = resolve;
      });
      vi.spyOn(ClientApiModule, "listClients").mockReturnValue(pendingPromise);

      render(
        <CampaignCreationForm
          initialValues={{
            ...validValues,
            clientId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa"
          }}
        />
      );

      const select = screen.getByTestId("client-select") as HTMLSelectElement;
      expect(select.disabled).toBe(true);

      expect(select.options.length).toBe(1);
      expect(select.options[0]!.text).toBe("Loading clients...");
      expect(select.value).toBe("");
      expect(screen.queryByText("aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa")).toBeNull();

      await act(async () => {
        resolveClients(clientsFixture);
      });

      expect(select.disabled).toBe(false);
      expect(select.value).toBe("aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa");
      expect(select.selectedOptions[0]!.text).toBe("Acme Studios");
    });

    it("handles unknown initial client ID during deferred loading and after resolution", async () => {
      let resolveClients!: (data: typeof clientsFixture) => void;
      const pendingPromise = new Promise<typeof clientsFixture>((resolve) => {
        resolveClients = resolve;
      });
      vi.spyOn(ClientApiModule, "listClients").mockReturnValue(pendingPromise);

      render(
        <CampaignCreationForm
          initialValues={{
            ...validValues,
            clientId: "99999999-9999-4999-8999-999999999999"
          }}
        />
      );

      const select = screen.getByTestId("client-select") as HTMLSelectElement;
      expect(select.disabled).toBe(true);
      expect(select.options.length).toBe(1);
      expect(select.options[0]!.text).toBe("Loading clients...");
      expect(screen.queryByText("99999999-9999-4999-8999-999999999999")).toBeNull();

      await act(async () => {
        resolveClients(clientsFixture);
      });

      expect(select.disabled).toBe(false);
      expect(screen.getByText("Selected client unavailable")).toBeDefined();
      expect(screen.queryByText("99999999-9999-4999-8999-999999999999")).toBeNull();
      expect(screen.getByTestId("client-unavailable-message")).toBeDefined();

      const submitBtn = screen.getByTestId("submit-campaign-button") as HTMLButtonElement;
      expect(submitBtn.disabled).toBe(true);
    });

    it("safely ignores in-flight client list response after component unmount", async () => {
      let resolveClients!: (data: typeof clientsFixture) => void;
      const pendingPromise = new Promise<typeof clientsFixture>((resolve) => {
        resolveClients = resolve;
      });
      vi.spyOn(ClientApiModule, "listClients").mockReturnValue(pendingPromise);

      const { unmount } = render(
        <CampaignCreationForm initialValues={{ ...validValues, clientId: "" }} />
      );

      unmount();

      expect(() => {
        act(() => {
          resolveClients(clientsFixture);
        });
      }).not.toThrow();
    });

    it("safely ignores in-flight client list rejection after component unmount", async () => {
      let rejectClients!: (err: unknown) => void;
      const pendingPromise = new Promise<typeof clientsFixture>((_, reject) => {
        rejectClients = reject;
      });
      vi.spyOn(ClientApiModule, "listClients").mockReturnValue(pendingPromise);

      const { unmount } = render(
        <CampaignCreationForm initialValues={{ ...validValues, clientId: "" }} />
      );

      unmount();

      expect(() => {
        act(() => {
          rejectClients(new Error("Network failed"));
        });
      }).not.toThrow();
    });
  });
});
