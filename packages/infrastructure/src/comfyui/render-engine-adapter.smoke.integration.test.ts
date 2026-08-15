import { readFile } from "node:fs/promises";
import type { RenderWorkflow } from "@cco/application";
import { describe, expect, it } from "vitest";
import { ComfyUiRenderEngineAdapter } from "./render-engine-adapter.js";

interface SmokeConfig {
  readonly url: string;
  readonly workflowPath: string;
  readonly timeoutMs: number;
}

function resolveSmokeConfig(env: NodeJS.ProcessEnv = process.env): SmokeConfig {
  const url = env.COMFYUI_URL?.trim();
  const workflowPath = env.COMFYUI_WORKFLOW_PATH?.trim();

  if (!url || !workflowPath) {
    throw new Error(
      "Missing required environment configuration: COMFYUI_URL and COMFYUI_WORKFLOW_PATH must be set to run the ComfyUI smoke test."
    );
  }

  const timeoutMs = env.COMFYUI_TIMEOUT_MS ? Number.parseInt(env.COMFYUI_TIMEOUT_MS, 10) : 600_000;

  return {
    url,
    workflowPath,
    timeoutMs: Number.isNaN(timeoutMs) || timeoutMs <= 0 ? 600_000 : timeoutMs
  };
}

describe("ComfyUiRenderEngineAdapter smoke integration", () => {
  it("requires explicit ComfyUI URL and workflow path before touching the render service", () => {
    expect(() => resolveSmokeConfig({})).toThrow(
      "Missing required environment configuration: COMFYUI_URL and COMFYUI_WORKFLOW_PATH must be set to run the ComfyUI smoke test."
    );
    expect(() =>
      resolveSmokeConfig({ COMFYUI_URL: "http://127.0.0.1:8188", COMFYUI_WORKFLOW_PATH: "   " })
    ).toThrow(
      "Missing required environment configuration: COMFYUI_URL and COMFYUI_WORKFLOW_PATH must be set to run the ComfyUI smoke test."
    );
    expect(() =>
      resolveSmokeConfig({ COMFYUI_URL: "  ", COMFYUI_WORKFLOW_PATH: "./workflow.json" })
    ).toThrow(
      "Missing required environment configuration: COMFYUI_URL and COMFYUI_WORKFLOW_PATH must be set to run the ComfyUI smoke test."
    );
    expect(
      resolveSmokeConfig({
        COMFYUI_URL: "http://127.0.0.1:8188",
        COMFYUI_WORKFLOW_PATH: "./workflow.json",
        COMFYUI_TIMEOUT_MS: "300000"
      })
    ).toEqual({
      url: "http://127.0.0.1:8188",
      workflowPath: "./workflow.json",
      timeoutMs: 300_000
    });
  });

  it("submits waits verifies outputs and unloads models against the configured ComfyUI host", async () => {
    const config = resolveSmokeConfig();
    const workflowRaw = await readFile(config.workflowPath, "utf-8");
    const workflow = JSON.parse(workflowRaw) as RenderWorkflow;

    const adapter = new ComfyUiRenderEngineAdapter({
      baseUrl: config.url,
      timeoutMs: config.timeoutMs
    });

    const receipt = await adapter.queueRender({
      renderJobId: "comfyui-smoke",
      sceneId: "comfyui-smoke",
      renderProfileKey: "operator-supplied-smoke",
      workflow
    });

    const result = await adapter.getRenderResult(receipt.executionId);
    expect(result?.status).toBe("succeeded");
    expect(result?.outputObjectKeys.length).toBeGreaterThan(0);
    await expect(adapter.unloadModels()).resolves.toBeUndefined();
  });
});
