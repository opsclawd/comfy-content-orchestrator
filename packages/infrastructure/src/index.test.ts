import { describe, expect, it } from "vitest";
import {
  ComfyUiRenderEngineAdapter,
  ComfyUiRenderEngineError,
  collectCertificationProvenance,
  infrastructureName,
  loadCertificationProfile,
  VALID_MODEL_CATEGORIES,
  canonicalizeWorkflow,
  hashWorkflow,
  resolveModelFilePath,
  hashModelFiles,
  runDiskPreflight,
  collectGitProvenance,
  LocalFsGpuLeaseAdapter,
  S3ObjectStorage,
  type S3ObjectStorageOptions,
  S3ReviewMediaDelivery
} from "./index.js";
import { FakeComfyUiTransport } from "./comfyui/test-support/fake-comfyui.js";

describe("infrastructure package exports", () => {
  it("should load skeleton name", () => {
    expect(infrastructureName).toBe("infrastructure");
  });

  it("instantiates ComfyUiRenderEngineAdapter with a fake transport", () => {
    const transport = new FakeComfyUiTransport();
    const adapter = new ComfyUiRenderEngineAdapter({
      baseUrl: "http://127.0.0.1:8188",
      transport
    });
    expect(adapter).toBeInstanceOf(ComfyUiRenderEngineAdapter);
  });

  it("retains stable error code on ComfyUiRenderEngineError", () => {
    const error = new ComfyUiRenderEngineError("WEBSOCKET_CONNECTION_FAILED", "WebSocket failed", {
      promptId: "prompt-test-123"
    });
    expect(error.code).toBe("WEBSOCKET_CONNECTION_FAILED");
    expect(error.context.promptId).toBe("prompt-test-123");
    expect(error.name).toBe("ComfyUiRenderEngineError");
  });

  it("exports provenance collection and manifest functions from composition root", () => {
    expect(typeof collectCertificationProvenance).toBe("function");
    expect(typeof loadCertificationProfile).toBe("function");
    expect(typeof canonicalizeWorkflow).toBe("function");
    expect(typeof hashWorkflow).toBe("function");
    expect(typeof resolveModelFilePath).toBe("function");
    expect(typeof hashModelFiles).toBe("function");
    expect(typeof runDiskPreflight).toBe("function");
    expect(typeof collectGitProvenance).toBe("function");
    expect(VALID_MODEL_CATEGORIES).toContain("clip");
    expect(VALID_MODEL_CATEGORIES).not.toContain("text_encoders");
  });

  it("exports LocalFsGpuLeaseAdapter from composition root", () => {
    expect(typeof LocalFsGpuLeaseAdapter).toBe("function");
  });

  it("exports S3ObjectStorage from composition root and instantiates with options", () => {
    expect(typeof S3ObjectStorage).toBe("function");
    const options: S3ObjectStorageOptions = {
      endpoint: "http://127.0.0.1:9000",
      region: "us-east-1",
      credentials: {
        accessKeyId: "test-key",
        secretAccessKey: "test-secret"
      },
      forcePathStyle: true
    };
    const storage = new S3ObjectStorage(options);
    expect(storage).toBeInstanceOf(S3ObjectStorage);
  });

  it("exports S3ReviewMediaDelivery from composition root and instantiates with options", () => {
    expect(typeof S3ReviewMediaDelivery).toBe("function");
    const delivery = new S3ReviewMediaDelivery({
      signingEndpoint: "https://storage-01.godzspeed-internal.ts.net",
      credentials: {
        accessKeyId: "test-key",
        secretAccessKey: "test-secret"
      }
    });
    expect(delivery).toBeInstanceOf(S3ReviewMediaDelivery);
  });
});
