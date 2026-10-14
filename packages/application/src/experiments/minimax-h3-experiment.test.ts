import { readFileSync } from "node:fs";
import { basename } from "node:path";
import { describe, expect, it } from "vitest";
import {
  MinimaxH3ExperimentService,
  canonicalizeJson,
  sha256Hex,
  computeExecutionLatencyMs
} from "./minimax-h3-experiment-service.js";
import {
  validateRunnerVariantAndArgv,
  predictMemoryPolicyFromArgv,
  analyzeStartupDiagnostics
} from "./minimax-h3-cli-parser-semantics.js";
import {
  DEFAULT_MINIMAX_H3_STOP_POLICY,
  type MinimaxH3ExperimentIntent,
  type MinimaxH3ExperimentReceipt,
  type MinimaxH3ProcessRecord,
  type MinimaxH3TelemetrySample,
  type MinimaxH3TerminalEvidence,
  type MinimaxH3AnyExperimentDescriptor,
  type MinimaxH3AnyExperimentResult,
  type MinimaxH3ExperimentDescriptorV2,
  type MinimaxH3ExperimentResultV2,
  type MinimaxH3PhaseAccountingEvent
} from "@cco/contracts";
import { compareMinimaxH3Experiments } from "./minimax-h3-comparator.js";
import type {
  MinimaxH3ExperimentStorePort,
  MinimaxH3ComfyUiTransportPort,
  MinimaxH3OutputProberPort,
  MinimaxH3TargetPreflightPort,
  MinimaxH3ProcessRunnerPort
} from "../ports/minimax-h3-experiment-ports.js";

// Minimal mock templates
const mockI2vTemplate = {
  "15": { class_type: "RandomNoise", inputs: { noise_seed: 0 } },
  "20": { class_type: "LoadImage", inputs: { image: "ref.png" } },
  "92": { class_type: "SaveVideo", inputs: { filename_prefix: "minimax_h3_720p_i2v_124f" } },
  "104": {
    class_type: "MiniMaxH3ImageToVideo",
    inputs: { length: 124, width: 1344, height: 768, prompt: "base" }
  }
};

const mockRef2vTemplate = {
  "15": { class_type: "RandomNoise", inputs: { noise_seed: 0 } },
  "92": { class_type: "SaveVideo", inputs: { filename_prefix: "minimax_h3_720p_ref2v_124f" } },
  "105": {
    class_type: "MiniMaxH3ReferenceToVideo",
    inputs: {
      length: 124,
      width: 1344,
      height: 768,
      prompt: "base",
      ref_image_size: "max",
      "ref_images.ref_image_0": ["201", 0],
      "ref_images.ref_image_1": ["202", 0],
      "ref_images.ref_image_2": ["203", 0],
      "ref_images.ref_image_3": ["204", 0],
      "ref_images.ref_image_4": ["205", 0],
      "ref_images.ref_image_5": ["206", 0],
      "ref_images.ref_image_6": ["207", 0],
      "ref_images.ref_image_7": ["208", 0],
      "ref_images.ref_image_8": ["209", 0]
    }
  },
  "201": { class_type: "LoadImage", inputs: { image: "ref1.png" } },
  "202": { class_type: "LoadImage", inputs: { image: "ref2.png" } },
  "203": { class_type: "LoadImage", inputs: { image: "ref3.png" } },
  "204": { class_type: "LoadImage", inputs: { image: "ref4.png" } },
  "205": { class_type: "LoadImage", inputs: { image: "ref5.png" } },
  "206": { class_type: "LoadImage", inputs: { image: "ref6.png" } },
  "207": { class_type: "LoadImage", inputs: { image: "ref7.png" } },
  "208": { class_type: "LoadImage", inputs: { image: "ref8.png" } },
  "209": { class_type: "LoadImage", inputs: { image: "ref9.png" } }
};

// A valid provenance.json with real expectedWorkflowHash entries for both
// mock templates. The service now fails closed when a profile entry or its
// expectedWorkflowHash is missing (see "fails closed when provenance.json
// has no matching profile entry" below) — an empty `profiles: []` fixture
// would no longer exercise the happy path, it would exercise the
// vulnerability the fail-closed check exists to prevent.
const mockProvenanceJson = JSON.stringify({
  version: 1,
  profiles: [
    {
      workflowRelativePath: "minimax_h3_720p_i2v_124f_api.json",
      expectedWorkflowHash: sha256Hex(canonicalizeJson(mockI2vTemplate))
    },
    {
      workflowRelativePath: "minimax_h3_720p_ref2v_124f_api.json",
      expectedWorkflowHash: sha256Hex(canonicalizeJson(mockRef2vTemplate))
    }
  ]
});

class InMemoryStore implements MinimaxH3ExperimentStorePort {
  public files = new Map<string, string>();
  public staged = new Map<string, string>();
  public descriptor: MinimaxH3AnyExperimentDescriptor | null = null;
  public config: Record<string, unknown> | null = null;
  public inputManifest: unknown = null;
  public measurementTemplate: MinimaxH3AnyExperimentResult | null = null;
  public intent: MinimaxH3ExperimentIntent | null = null;
  public receipt: MinimaxH3ExperimentReceipt | null = null;
  public events: Array<{ timestamp: string; event: string; details?: unknown }> = [];
  public telemetry: MinimaxH3TelemetrySample[] = [];
  public result: MinimaxH3AnyExperimentResult | null = null;
  public phaseEvents: MinimaxH3PhaseAccountingEvent[] = [];

  async writeDescriptor(
    _runDir: string,
    descriptor: MinimaxH3AnyExperimentDescriptor
  ): Promise<void> {
    this.descriptor = descriptor;
  }
  async readDescriptor(_runDir: string): Promise<MinimaxH3AnyExperimentDescriptor> {
    if (!this.descriptor) throw new Error("Descriptor not found");
    return this.descriptor;
  }
  async writeConfig(_runDir: string, config: Record<string, unknown>): Promise<string> {
    this.config = config;
    return sha256Hex(canonicalizeJson(config));
  }
  async readConfig(_runDir: string): Promise<Record<string, unknown>> {
    if (!this.config) throw new Error("Config not found");
    return this.config;
  }
  async writeInputManifest(_runDir: string, manifest: unknown): Promise<void> {
    this.inputManifest = manifest;
  }
  async readInputManifest(_runDir: string): Promise<unknown> {
    return this.inputManifest;
  }
  async writeMeasurementTemplate(
    _runDir: string,
    template: MinimaxH3AnyExperimentResult
  ): Promise<void> {
    this.measurementTemplate = template;
  }
  async readMeasurementTemplate(_runDir: string): Promise<MinimaxH3AnyExperimentResult | null> {
    return this.measurementTemplate;
  }
  async writeIntent(_runDir: string, intent: MinimaxH3ExperimentIntent): Promise<void> {
    this.intent = intent;
  }
  async readIntent(_runDir: string): Promise<MinimaxH3ExperimentIntent | null> {
    return this.intent;
  }
  async writeReceipt(_runDir: string, receipt: MinimaxH3ExperimentReceipt): Promise<void> {
    this.receipt = receipt;
  }
  async readReceipt(_runDir: string): Promise<MinimaxH3ExperimentReceipt | null> {
    return this.receipt;
  }
  async appendEvent(
    _runDir: string,
    event: { timestamp: string; event: string; details?: unknown }
  ): Promise<void> {
    this.events.push(event);
  }
  async readEvents(
    _runDir: string
  ): Promise<Array<{ timestamp: string; event: string; details?: unknown }>> {
    return this.events;
  }
  async appendPhaseEvent(_runDir: string, event: MinimaxH3PhaseAccountingEvent): Promise<void> {
    this.phaseEvents.push(event);
  }
  async readPhaseEvents(_runDir: string): Promise<MinimaxH3PhaseAccountingEvent[]> {
    return this.phaseEvents;
  }
  async appendTelemetry(_runDir: string, sample: MinimaxH3TelemetrySample): Promise<void> {
    this.telemetry.push(sample);
  }
  async readTelemetry(_runDir: string): Promise<MinimaxH3TelemetrySample[]> {
    return this.telemetry;
  }
  async createRunDirectory(_runDir: string): Promise<void> {}
  async ensureRunSubdirectories(_runDir: string): Promise<void> {}
  public processRecord: MinimaxH3ProcessRecord | null = null;
  async writeProcessRecord(_runDir: string, record: MinimaxH3ProcessRecord): Promise<void> {
    this.processRecord = record;
  }
  async readProcessRecord(_runDir: string): Promise<MinimaxH3ProcessRecord | null> {
    return this.processRecord;
  }
  public terminalEvidence: MinimaxH3TerminalEvidence | null = null;
  async writeTerminalEvidence(_runDir: string, evidence: MinimaxH3TerminalEvidence): Promise<void> {
    this.terminalEvidence = evidence;
  }
  async readTerminalEvidence(_runDir: string): Promise<MinimaxH3TerminalEvidence | null> {
    return this.terminalEvidence;
  }
  async inspectAsset(
    _filePath: string
  ): Promise<{ width: number; height: number; mimeType: string }> {
    return { width: 1344, height: 768, mimeType: "image/png" };
  }
  async deleteRunFiles(_runDir: string, _keepOutputs?: boolean): Promise<void> {}
  async writeResult(_runDir: string, result: MinimaxH3AnyExperimentResult): Promise<void> {
    this.result = result;
  }
  async readResult(_runDir: string): Promise<MinimaxH3AnyExperimentResult | null> {
    return this.result;
  }
  verifyContainment(targetPath: string, rootDir: string): boolean {
    return targetPath.startsWith(rootDir);
  }
  async stageInputFile(sourcePath: string, destPath: string): Promise<void> {
    this.staged.set(destPath, sourcePath);
  }
  async hashFile(_filePath: string): Promise<{ sha256: string; sizeBytes: number }> {
    return { sha256: "0".repeat(64), sizeBytes: 1024 };
  }
  async readJsonFile<T = unknown>(filePath: string): Promise<T> {
    const content =
      this.files.get(filePath) ??
      this.files.get(basename(filePath)) ??
      this.files.get(`templates/${basename(filePath)}`);
    if (!content) throw new Error(`File not found: ${filePath}`);
    return JSON.parse(content);
  }
  async writeDurableJson(filePath: string, content: unknown): Promise<void> {
    this.files.set(filePath, JSON.stringify(content));
  }
  async writeTextFile(filePath: string, content: string): Promise<void> {
    this.files.set(filePath, content);
  }
  async readTextFile(filePath: string): Promise<string> {
    const content =
      this.files.get(filePath) ??
      this.files.get(basename(filePath)) ??
      this.files.get(`templates/${basename(filePath)}`);
    if (!content) throw new Error(`File not found: ${filePath}`);
    return content;
  }
}

function createInitializedStore(): InMemoryStore {
  const store = new InMemoryStore();
  store.files.set("templates/minimax_h3_720p_i2v_124f_api.json", JSON.stringify(mockI2vTemplate));
  store.files.set(
    "templates/minimax_h3_720p_ref2v_124f_api.json",
    JSON.stringify(mockRef2vTemplate)
  );
  store.files.set("templates/provenance.json", mockProvenanceJson);
  store.files.set(
    "manifest.json",
    JSON.stringify({
      referenceSetId: "ref-test-1",
      references: [
        {
          assetPath: "/tmp/ref1.png",
          stagedFilename: "ref1.png",
          role: "first_frame",
          tag: "<Picture 1>",
          order: 0
        }
      ]
    })
  );
  return store;
}

describe("computeExecutionLatencyMs", () => {
  it("derives latency from real started/terminated timestamps", () => {
    const result = computeExecutionLatencyMs(
      "2026-10-12T10:00:00.000Z",
      "2026-10-12T10:00:05.500Z",
      null
    );
    expect(result).toBe(5500);
  });

  it("falls back to the previous value when terminatedAt is missing", () => {
    // Guards against fabricating a latency measured against "now" (the
    // caller's own synthesized display fallback) when the engine never
    // actually recorded a real completion time.
    const result = computeExecutionLatencyMs("2026-10-12T10:00:00.000Z", null, 42);
    expect(result).toBe(42);
  });

  it("falls back to the previous value when startedAt is missing", () => {
    const result = computeExecutionLatencyMs(null, "2026-10-12T10:00:05.500Z", null);
    expect(result).toBeNull();
  });

  it("falls back rather than return a negative latency from an out-of-order pair", () => {
    const result = computeExecutionLatencyMs(
      "2026-10-12T10:00:05.000Z",
      "2026-10-12T10:00:00.000Z",
      7
    );
    expect(result).toBe(7);
  });
});

describe("MiniMax-H3 CLI Parser Semantics (CPU-only)", () => {
  it("validates baseline dynamicvram-offload-v1 runner configuration", () => {
    const result = validateRunnerVariantAndArgv({
      variantName: "dynamicvram-offload-v1",
      variantReason: null
    });
    expect(result.requestedPolicy).toBe("dynamic_vram");
    expect(result.predictedPolicy).toBe("dynamic_vram");
    expect(result.generatedArgv).toEqual([]);
  });

  it("rejects dynamicvram-offload-v1 when contradictory flags are passed", () => {
    expect(() =>
      validateRunnerVariantAndArgv({
        variantName: "dynamicvram-offload-v1",
        variantReason: null,
        customArgv: ["--disable-dynamic-vram"]
      })
    ).toThrow(/expects dynamic VRAM enabled/);

    expect(() =>
      validateRunnerVariantAndArgv({
        variantName: "dynamicvram-offload-v1",
        variantReason: null,
        customArgv: ["--lowvram"]
      })
    ).toThrow(/expects dynamic VRAM baseline/);
  });

  it("validates comparator static-lowvram-v1 generating both flags", () => {
    const result = validateRunnerVariantAndArgv({
      variantName: "static-lowvram-v1",
      variantReason: "Testing memory scaling comparator"
    });
    expect(result.requestedPolicy).toBe("static_lowvram");
    expect(result.predictedPolicy).toBe("static_lowvram");
    expect(result.generatedArgv).toContain("--disable-dynamic-vram");
    expect(result.generatedArgv).toContain("--lowvram");
  });

  it("rejects static-lowvram-v1 without operator reason", () => {
    expect(() =>
      validateRunnerVariantAndArgv({
        variantName: "static-lowvram-v1",
        variantReason: null
      })
    ).toThrow(/requires an explicit operator --variant-reason/);
  });

  it("rejects forbidden flags: --cpu, --gpu-only, --highvram, --enable-dynamic-vram", () => {
    expect(() =>
      validateRunnerVariantAndArgv({
        variantName: "dynamicvram-offload-v1",
        variantReason: null,
        customArgv: ["--cpu"]
      })
    ).toThrow(/Forbidden runner flag/);

    expect(() =>
      validateRunnerVariantAndArgv({
        variantName: "dynamicvram-offload-v1",
        variantReason: null,
        customArgv: ["--enable-dynamic-vram"]
      })
    ).toThrow(/Forbidden runner flag/);
  });

  it("predicts dynamic_vram when lone --lowvram is passed at pinned ComfyUI", () => {
    // Lone --lowvram does not disable dynamic VRAM
    const prediction = predictMemoryPolicyFromArgv(["--lowvram"]);
    expect(prediction.predictedPolicy).toBe("dynamic_vram");
  });

  it("predicts static_lowvram only when both --disable-dynamic-vram and --lowvram are present", () => {
    const prediction = predictMemoryPolicyFromArgv(["--disable-dynamic-vram", "--lowvram"]);
    expect(prediction.predictedPolicy).toBe("static_lowvram");
  });

  it("analyzes startup logs and identifies verified dynamic VRAM", () => {
    const logs = `
      [aimdo] Dynamic VRAM enabled
      Loaded ComfyUI models successfully
    `;
    const mode = analyzeStartupDiagnostics(logs, "dynamic_vram");
    expect(mode.status).toBe("verified");
    expect(mode.value).toBe("dynamic_vram");
    expect(mode.unknownReason).toBeNull();
  });

  it("identifies verified dynamic VRAM using exact pinned main.py:280 diagnostic", () => {
    const logs = `
      Python version: 3.12.2
      ComfyUI version: 0.3.10
      DynamicVRAM support detected and enabled
      Loaded ComfyUI models successfully
    `;
    const mode = analyzeStartupDiagnostics(logs, "dynamic_vram");
    expect(mode.status).toBe("verified");
    expect(mode.value).toBe("dynamic_vram");
    expect(mode.unknownReason).toBeNull();
  });

  it("detects fallback to legacy patcher in dynamic VRAM startup logs (main.py:282)", () => {
    const logs = `
      WARNING: No working comfy-aimdo install detected. DynamicVRAM support disabled. Falling back to legacy ModelPatcher. VRAM estimates may be unreliable especially on Windows
    `;
    const mode = analyzeStartupDiagnostics(logs, "dynamic_vram");
    expect(mode.status).toBe("unknown");
    expect(mode.value).toBeNull();
    expect(mode.unknownReason).toContain("Prerequisite failure");
  });

  it("analyzes startup logs and identifies verified static lowvram with exact pinned bytes", () => {
    const logs = `
      WARNING: Dynamic vram disabled with argument. If you have any issues with dynamic vram enabled please give us a detailed reports as this argument will be removed soon. If you use gguf we recommend keeping dynamic vram enabled and using native ComfyUI model formats instead. ComfyUI native formats like fp8 will be faster even if they are larger than your memory.
      INFO: Set vram state to: LOW_VRAM
    `;
    const mode = analyzeStartupDiagnostics(logs, "static_lowvram");
    expect(mode.status).toBe("verified");
    expect(mode.value).toBe("static_lowvram");
    expect(mode.unknownReason).toBeNull();
  });

  it("detects contradictory dynamic enablement when static_lowvram is requested", () => {
    const logs = `
      Dynamic vram disabled with argument.
      DynamicVRAM support detected and enabled
      Set vram state to: LOW_VRAM
    `;
    const mode = analyzeStartupDiagnostics(logs, "static_lowvram");
    expect(mode.status).toBe("unknown");
    expect(mode.value).toBeNull();
    expect(mode.unknownReason).toContain("Contradictory diagnostic");
  });
});

describe("MiniMax-H3 Experiment Service (Preparation & Validation)", () => {
  it("applies an operator-supplied timeouts override, keeping defaults for unspecified fields", async () => {
    // MinimaxH3ExperimentTimeoutsSchema's bounds exist specifically "to
    // allow operator tuning" above the defaults (e.g. a longer render
    // budget for a higher frame count) -- but prepareExperiment ignored
    // the option entirely and always wrote
    // DEFAULT_MINIMAX_H3_EXPERIMENT_TIMEOUTS verbatim, found live while
    // escalating a real run past the default 20-minute render budget.
    const store = createInitializedStore();
    const service = new MinimaxH3ExperimentService(store);

    const { descriptor } = await service.prepareExperiment({
      route: "i2v",
      frames: 124,
      seed: 42,
      prompt: "A sunset",
      operatorLabel: "operator-01",
      runId: "run-timeout-override",
      outputRoot: ".ai-runs/minimax-h3-experiments",
      targetHost: "render-worker-01",
      gpuUuid: "GPU-12345678-1234-1234-1234-123456789abc",
      comfyUiDir: "/opt/comfyui",
      pythonPath: "/usr/bin/python3",
      inputManifestPath: "manifest.json",
      timeouts: { totalRenderTimeoutMs: 1_800_000 }
    });

    expect(descriptor.timeouts.totalRenderTimeoutMs).toBe(1_800_000);
    // Unspecified fields keep their defaults.
    expect(descriptor.timeouts.startupTimeoutMs).toBe(120_000);
    expect(descriptor.timeouts.pollIntervalMs).toBe(1_000);
  });

  it("rejects a timeouts override that exceeds the schema's own upper bound", async () => {
    const store = createInitializedStore();
    const service = new MinimaxH3ExperimentService(store);

    await expect(
      service.prepareExperiment({
        route: "i2v",
        frames: 124,
        seed: 42,
        prompt: "A sunset",
        operatorLabel: "operator-01",
        runId: "run-timeout-over-bound",
        outputRoot: ".ai-runs/minimax-h3-experiments",
        targetHost: "render-worker-01",
        gpuUuid: "GPU-12345678-1234-1234-1234-123456789abc",
        comfyUiDir: "/opt/comfyui",
        pythonPath: "/usr/bin/python3",
        inputManifestPath: "manifest.json",
        // Schema caps totalRenderTimeoutMs at 3_600_000.
        timeouts: { totalRenderTimeoutMs: 3_600_001 }
      })
    ).rejects.toThrow();
  });

  it("fails closed when provenance.json has no matching profile entry (templates-dir trust-root bypass)", async () => {
    const store = createInitializedStore();
    // Simulate a caller-supplied --templates-dir with an empty/unrelated
    // provenance manifest — this must not let an unverified template
    // silently become the trusted base.
    store.files.set("templates/provenance.json", JSON.stringify({ version: 1, profiles: [] }));
    const service = new MinimaxH3ExperimentService(store);

    await expect(
      service.prepareExperiment({
        route: "i2v",
        frames: 124,
        seed: 42,
        prompt: "A cinematic shot of a sunset",
        operatorLabel: "operator-01",
        runId: "run-i2v-002",
        outputRoot: ".ai-runs/minimax-h3-experiments",
        targetHost: "render-worker-01",
        gpuUuid: "GPU-12345678-1234-1234-1234-123456789abc",
        comfyUiDir: "/opt/comfyui",
        pythonPath: "/usr/bin/python3",
        inputManifestPath: "manifest.json"
      })
    ).rejects.toThrow(/no expectedWorkflowHash entry/);
  });

  it("prepares and validates an isolated I2V experiment", async () => {
    const store = createInitializedStore();
    const service = new MinimaxH3ExperimentService(store);

    const { descriptor, runDir } = await service.prepareExperiment({
      route: "i2v",
      frames: 124,
      seed: 42,
      prompt: "A cinematic shot of a sunset",
      operatorLabel: "operator-01",
      runId: "run-i2v-001",
      outputRoot: ".ai-runs/minimax-h3-experiments",
      targetHost: "render-worker-01",
      gpuUuid: "GPU-12345678-1234-1234-1234-123456789abc",
      comfyUiDir: "/opt/comfyui",
      pythonPath: "/usr/bin/python3",
      inputManifestPath: "manifest.json"
    });

    expect(descriptor.runId).toBe("run-i2v-001");
    expect(descriptor.configuredFrames).toBe(124);
    expect(runDir).toBe(".ai-runs/minimax-h3-experiments/run-i2v-001");

    // Validation offline dry path
    const validation = await service.validateExperiment(runDir, {
      outputRoot: ".ai-runs/minimax-h3-experiments"
    });
    expect(validation.ok).toBe(true);
    expect(validation.errors).toHaveLength(0);
  });

  it("prepares Ref2V with 2 references and prunes unused slots 3..9", async () => {
    const store = createInitializedStore();
    store.files.set(
      "manifest-ref2v.json",
      JSON.stringify({
        referenceSetId: "ref2v-test",
        references: [
          {
            assetPath: "/tmp/ref1.png",
            stagedFilename: "ref1.png",
            tag: "<Picture 1>",
            order: 0
          },
          {
            assetPath: "/tmp/ref2.png",
            stagedFilename: "ref2.png",
            tag: "<Picture 2>",
            order: 1
          }
        ]
      })
    );

    const service = new MinimaxH3ExperimentService(store);
    const { descriptor, runDir } = await service.prepareExperiment({
      route: "ref2v",
      frames: 192,
      seed: 1234,
      prompt: "A video of <Picture 1> walking with <Picture 2>",
      operatorLabel: "operator-01",
      runId: "run-ref2v-001",
      outputRoot: ".ai-runs/minimax-h3-experiments",
      targetHost: "render-worker-01",
      gpuUuid: "GPU-12345678-1234-1234-1234-123456789abc",
      comfyUiDir: "/opt/comfyui",
      pythonPath: "/usr/bin/python3",
      inputManifestPath: "manifest-ref2v.json"
    });

    expect(descriptor.configuredFrames).toBe(192);
    expect(store.config).toBeDefined();

    // Check node 105 inputs
    const node105 = store.config!["105"] as { inputs: Record<string, unknown> };
    expect(node105.inputs.length).toBe(192);
    expect(node105.inputs["ref_images.ref_image_0"]).toBeDefined();
    expect(node105.inputs["ref_images.ref_image_1"]).toBeDefined();
    expect(node105.inputs["ref_images.ref_image_2"]).toBeUndefined();
    expect(store.config!["201"]).toBeDefined();
    expect(store.config!["202"]).toBeDefined();
    expect(store.config!["203"]).toBeUndefined();

    const validation = await service.validateExperiment(runDir, {
      outputRoot: ".ai-runs/minimax-h3-experiments"
    });
    expect(validation.ok).toBe(true);
  });

  it("rejects Ref2V prompt that references absent picture tag", async () => {
    const store = createInitializedStore();
    const service = new MinimaxH3ExperimentService(store);

    await expect(
      service.prepareExperiment({
        route: "ref2v",
        frames: 124,
        seed: 42,
        prompt: "A scene with <Picture 1> and <Picture 5>", // only 1 ref in manifest!
        operatorLabel: "operator-01",
        runId: "run-tag-err",
        outputRoot: ".ai-runs/minimax-h3-experiments",
        targetHost: "render-worker-01",
        gpuUuid: "GPU-12345678-1234-1234-1234-123456789abc",
        comfyUiDir: "/opt/comfyui",
        pythonPath: "/usr/bin/python3",
        inputManifestPath: "manifest.json"
      })
    ).rejects.toThrow(/Prompt references tag "<Picture 5>" but only 1 reference/);
  });

  it("rejects output paths that target forbidden directories", async () => {
    const store = createInitializedStore();
    const service = new MinimaxH3ExperimentService(store);

    await expect(
      service.prepareExperiment({
        route: "i2v",
        frames: 124,
        seed: 42,
        prompt: "A sunset",
        operatorLabel: "operator-01",
        runId: "run-forbidden",
        outputRoot: "certification/runs", // FORBIDDEN!
        targetHost: "render-worker-01",
        gpuUuid: "GPU-12345678-1234-1234-1234-123456789abc",
        comfyUiDir: "/opt/comfyui",
        pythonPath: "/usr/bin/python3",
        inputManifestPath: "manifest.json"
      })
    ).rejects.toThrow(/violates governance rules/);
  });

  it("detects tampered SaveVideo prefix in offline validation", async () => {
    const store = createInitializedStore();
    const service = new MinimaxH3ExperimentService(store);

    const { runDir } = await service.prepareExperiment({
      route: "i2v",
      frames: 124,
      seed: 42,
      prompt: "A sunset",
      operatorLabel: "operator-01",
      runId: "run-tamper-check",
      outputRoot: ".ai-runs/minimax-h3-experiments",
      targetHost: "render-worker-01",
      gpuUuid: "GPU-12345678-1234-1234-1234-123456789abc",
      comfyUiDir: "/opt/comfyui",
      pythonPath: "/usr/bin/python3",
      inputManifestPath: "manifest.json"
    });

    // Tamper with SaveVideo prefix
    (store.config!["92"] as { inputs: { filename_prefix: string } }).inputs.filename_prefix =
      "tampered_prefix";

    const validation = await service.validateExperiment(runDir, {
      outputRoot: ".ai-runs/minimax-h3-experiments"
    });
    expect(validation.ok).toBe(false);
    expect(validation.errors.some((e) => e.includes("tampered"))).toBe(true);
  });
});

describe("MiniMax-H3 Experiment Service (Reconcile Crash Recovery)", () => {
  it("reconstructs result.json from scratch when result.json never existed", async () => {
    const store = new InMemoryStore();
    store.files.set("templates/minimax_h3_720p_i2v_124f_api.json", JSON.stringify(mockI2vTemplate));
    store.files.set("templates/provenance.json", mockProvenanceJson);
    store.files.set(
      "manifest.json",
      JSON.stringify({
        referenceSetId: "ref-test-1",
        references: [
          {
            assetPath: "/tmp/ref1.png",
            stagedFilename: "ref1.png",
            role: "first_frame",
            tag: "<Picture 1>",
            order: 0
          }
        ]
      })
    );

    const mockTransport: MinimaxH3ComfyUiTransportPort = {
      waitForReadiness: async () => ({ ok: true }),
      submitPrompt: async () => ({ ok: true, promptId: "prompt-reconcile-1" }),
      pollPromptHistory: async () => ({
        status: "completed",
        outputFilename: "output.mp4",
        rawHistory: { status: "success" }
      }),
      getQueue: async () => ({ running: [], pending: [] }),
      findPromptByWorkflowDigestOrClient: async () => null
    };

    const mockProber: MinimaxH3OutputProberPort = {
      probeOutput: async (filePath) => ({
        status: "succeeded",
        outputFile: filePath,
        outputSha256: "c".repeat(64),
        outputSizeBytes: 5000000,
        measuredFacts: {
          measuredFrames: 124,
          countedFramesSource: "nb_read_frames",
          declaredNbFrames: 124,
          measuredVideoDurationMs: 5167,
          measuredContainerDurationMs: 5167,
          width: 1344,
          height: 768,
          fps: 24,
          rFrameRate: "24/1",
          avgFrameRate: "24/1",
          videoCodec: "h264",
          audioCodec: "aac",
          audioChannels: 2,
          audioSampleRate: 44100
        },
        discrepancyFlags: [],
        toolIdentity: { ffprobePath: "/usr/bin/ffprobe", version: "7.0.2-static" },
        errors: []
      })
    };

    const service = new MinimaxH3ExperimentService(
      store,
      undefined,
      undefined,
      mockTransport,
      undefined,
      mockProber
    );

    const { runDir, descriptor } = await service.prepareExperiment({
      route: "i2v",
      frames: 124,
      seed: 42,
      prompt: "A sunset",
      operatorLabel: "operator-01",
      runId: "run-crash-test",
      outputRoot: ".ai-runs/minimax-h3-experiments",
      targetHost: "render-worker-01",
      gpuUuid: "GPU-12345678-1234-1234-1234-123456789abc",
      comfyUiDir: "/opt/comfyui",
      pythonPath: "/usr/bin/python3",
      inputManifestPath: "manifest.json"
    });

    // Simulate crash after intent and receipt were written, before result.json was created
    await store.writeIntent(runDir, {
      runId: descriptor.runId,
      clientId: "client-1",
      workflowDigest: descriptor.derivedWorkflowDigest,
      requestFingerprint: "fp-1",
      timestamp: new Date().toISOString()
    });
    await store.writeReceipt(runDir, {
      runId: descriptor.runId,
      promptId: "prompt-reconcile-1",
      acceptedAt: new Date().toISOString()
    });

    // Ensure result.json is null (never existed)
    expect(await store.readResult(runDir)).toBeNull();

    // Reconcile
    const reconstructed = await service.reconcileExperiment(runDir, {
      outputRoot: ".ai-runs/minimax-h3-experiments"
    });

    expect(reconstructed).toBeDefined();
    expect(reconstructed.execution.status).toBe("completed");
    expect(reconstructed.execution.promptId).toBe("prompt-reconcile-1");
    expect(reconstructed.probe.status).toBe("succeeded");
    expect(reconstructed.outputConformance.status).toBe("conformant");
    expect(await store.readResult(runDir)).not.toBeNull();
  });

  it("reports nonconformant (not unknown) when a measured fact is missing but another fact already establishes a mismatch", async () => {
    // fps is unmeasurable (null) here, which previously forced
    // conformanceStatus all the way to "unknown" with reason
    // "missing_measured_facts" -- masking the fact that frame count was
    // already measured and definitively wrong. An established mismatch
    // must win over an unrelated missing fact.
    const store = new InMemoryStore();
    store.files.set("templates/minimax_h3_720p_i2v_124f_api.json", JSON.stringify(mockI2vTemplate));
    store.files.set("templates/provenance.json", mockProvenanceJson);
    store.files.set(
      "manifest.json",
      JSON.stringify({
        referenceSetId: "ref-test-1",
        references: [
          {
            assetPath: "/tmp/ref1.png",
            stagedFilename: "ref1.png",
            role: "first_frame",
            tag: "<Picture 1>",
            order: 0
          }
        ]
      })
    );

    const mockTransport: MinimaxH3ComfyUiTransportPort = {
      waitForReadiness: async () => ({ ok: true }),
      submitPrompt: async () => ({ ok: true, promptId: "prompt-masking-1" }),
      pollPromptHistory: async () => ({
        status: "completed",
        outputFilename: "output.mp4",
        rawHistory: { status: "success" }
      }),
      getQueue: async () => ({ running: [], pending: [] }),
      findPromptByWorkflowDigestOrClient: async () => null
    };

    const mockProber: MinimaxH3OutputProberPort = {
      probeOutput: async (filePath) => ({
        status: "succeeded",
        outputFile: filePath,
        outputSha256: "c".repeat(64),
        outputSizeBytes: 5000000,
        measuredFacts: {
          measuredFrames: 1, // definitively wrong vs. descriptor's 124
          countedFramesSource: "nb_read_frames",
          declaredNbFrames: 1,
          measuredVideoDurationMs: 5167,
          measuredContainerDurationMs: 5167,
          width: 1344,
          height: 768,
          fps: null, // unmeasurable -- must not mask the frame-count mismatch
          rFrameRate: null,
          avgFrameRate: null,
          videoCodec: "h264",
          audioCodec: "aac",
          audioChannels: 2,
          audioSampleRate: 44100
        },
        discrepancyFlags: [],
        toolIdentity: { ffprobePath: "/usr/bin/ffprobe", version: "7.0.2-static" },
        errors: []
      })
    };

    const service = new MinimaxH3ExperimentService(
      store,
      undefined,
      undefined,
      mockTransport,
      undefined,
      mockProber
    );

    const { runDir, descriptor } = await service.prepareExperiment({
      route: "i2v",
      frames: 124,
      seed: 42,
      prompt: "A sunset",
      operatorLabel: "operator-01",
      runId: "run-masking-test",
      outputRoot: ".ai-runs/minimax-h3-experiments",
      targetHost: "render-worker-01",
      gpuUuid: "GPU-12345678-1234-1234-1234-123456789abc",
      comfyUiDir: "/opt/comfyui",
      pythonPath: "/usr/bin/python3",
      inputManifestPath: "manifest.json"
    });

    await store.writeIntent(runDir, {
      runId: descriptor.runId,
      clientId: "client-1",
      workflowDigest: descriptor.derivedWorkflowDigest,
      requestFingerprint: "fp-1",
      timestamp: new Date().toISOString()
    });
    await store.writeReceipt(runDir, {
      runId: descriptor.runId,
      promptId: "prompt-masking-1",
      acceptedAt: new Date().toISOString()
    });

    const reconstructed = await service.reconcileExperiment(runDir, {
      outputRoot: ".ai-runs/minimax-h3-experiments"
    });

    expect(reconstructed.outputConformance.status).toBe("nonconformant");
    expect(reconstructed.outputConformance.reasons).toContain("frame_count_mismatch");
    expect(reconstructed.outputConformance.reasons).not.toContain("missing_measured_facts");
  });

  it("does not count a telemetry sample with mismatched process identity toward collection success or peak metrics", async () => {
    // A host sample whose pid/startTimeTicks don't match this run's own
    // stored process record must not be trusted, even though the sample
    // itself is well-formed (gpu/host both present, no error string) --
    // the only lower-layer protection against this is the host telemetry
    // adapter's own identity check at the moment of sampling, and that
    // depends on every call site wiring an expected start-time tick
    // through. This test bypasses that layer entirely (directly
    // injecting the sample) to prove the aggregation step itself also
    // verifies identity rather than blindly trusting sample.host !== null.
    const store = new InMemoryStore();
    store.files.set("templates/minimax_h3_720p_i2v_124f_api.json", JSON.stringify(mockI2vTemplate));
    store.files.set("templates/provenance.json", mockProvenanceJson);
    store.files.set(
      "manifest.json",
      JSON.stringify({
        referenceSetId: "ref-test-1",
        references: [
          {
            assetPath: "/tmp/ref1.png",
            stagedFilename: "ref1.png",
            role: "first_frame",
            tag: "<Picture 1>",
            order: 0
          }
        ]
      })
    );

    const offlineTransport: MinimaxH3ComfyUiTransportPort = {
      waitForReadiness: async () => {
        throw new Error("ECONNREFUSED");
      },
      submitPrompt: async () => {
        throw new Error("ECONNREFUSED");
      },
      pollPromptHistory: async () => {
        throw new Error("ECONNREFUSED");
      },
      getQueue: async () => {
        throw new Error("ECONNREFUSED");
      },
      findPromptByWorkflowDigestOrClient: async () => null
    };

    const service = new MinimaxH3ExperimentService(
      store,
      undefined,
      undefined,
      offlineTransport,
      undefined,
      undefined
    );

    const { runDir, descriptor } = await service.prepareExperiment({
      route: "i2v",
      frames: 124,
      seed: 42,
      prompt: "A sunset",
      operatorLabel: "operator-01",
      runId: "run-identity-mismatch-test",
      outputRoot: ".ai-runs/minimax-h3-experiments",
      targetHost: "render-worker-01",
      gpuUuid: "GPU-12345678-1234-1234-1234-123456789abc",
      comfyUiDir: "/opt/comfyui",
      pythonPath: "/usr/bin/python3",
      inputManifestPath: "manifest.json"
    });

    await store.writeProcessRecord(runDir, {
      pid: 1111,
      startTimeTicks: 5000,
      address: "127.0.0.1",
      port: 8199,
      gpuUuid: descriptor.target.gpuUuid,
      commandLine: "python3 main.py",
      startedAt: new Date().toISOString()
    });

    const goodHostSample = {
      timestamp: "2026-10-12T10:00:00.000Z",
      totalRamMb: 16000,
      availableRamMb: 8000,
      usedRamMb: 8000,
      processPid: 1111,
      processStartTimeTicks: 5000,
      processRssMb: 100,
      swapTotalMb: 0,
      swapUsedMb: 0,
      swapInPages: 0,
      swapOutPages: 0
    };
    const mismatchedHostSample = {
      ...goodHostSample,
      timestamp: "2026-10-12T10:00:05.000Z",
      processPid: 9999, // a different process entirely
      processStartTimeTicks: 1234,
      processRssMb: 999999, // deliberately large so a contamination bug would be obvious
      swapUsedMb: 999999
    };
    const gpuSample = {
      timestamp: "2026-10-12T10:00:00.000Z",
      deviceUuid: descriptor.target.gpuUuid,
      totalVramMb: 8192,
      usedVramMb: 1024,
      freeVramMb: 7168,
      allocatableVramMb: 8192
    };

    store.telemetry = [
      {
        timestamp: "2026-10-12T10:00:00.000Z",
        phase: "before",
        gpu: gpuSample,
        host: goodHostSample,
        error: null
      },
      {
        timestamp: "2026-10-12T10:00:05.000Z",
        phase: "during",
        gpu: gpuSample,
        host: mismatchedHostSample,
        error: null
      },
      {
        timestamp: "2026-10-12T10:00:10.000Z",
        phase: "after",
        gpu: gpuSample,
        host: goodHostSample,
        error: null
      }
    ];

    const reconstructed = await service.reconcileExperiment(runDir, {
      outputRoot: ".ai-runs/minimax-h3-experiments"
    });

    // The mismatched sample must not have been trusted for peak RAM/swap
    // -- if it had, these would read 999999.
    expect(reconstructed.collection.metrics.hostPeakRamUsedMb).toBe(8000);
    expect(reconstructed.collection.metrics.processPeakRssMb).toBe(100);
    expect(reconstructed.collection.metrics.hostSwapUsedMb).toBe(0);
    // It must count as a failure, with the mismatch surfaced in errors.
    expect(reconstructed.collection.sampleCount.failed).toBe(1);
    expect(
      reconstructed.collection.errors.some((e) => e.message.includes("identity mismatch"))
    ).toBe(true);
  });

  it("surfaces an events.jsonl read failure as a collection error instead of silently treating it as 'no events happened'", async () => {
    // A read failure (not ENOENT -- an actual I/O or parse failure) used
    // to be swallowed into an empty array, indistinguishable from "this
    // run never crossed a stop threshold". That could hide a genuine
    // safety-relevant stop_threshold_crossed event behind what looks
    // like a clean run.
    class EventsReadFailureStore extends InMemoryStore {
      override async readEvents(): Promise<
        Array<{ timestamp: string; event: string; details?: unknown }>
      > {
        throw new Error("EIO: I/O error reading events.jsonl");
      }
    }

    const store = new EventsReadFailureStore();
    store.files.set("templates/minimax_h3_720p_i2v_124f_api.json", JSON.stringify(mockI2vTemplate));
    store.files.set("templates/provenance.json", mockProvenanceJson);
    store.files.set(
      "manifest.json",
      JSON.stringify({
        referenceSetId: "ref-test-1",
        references: [
          {
            assetPath: "/tmp/ref1.png",
            stagedFilename: "ref1.png",
            role: "first_frame",
            tag: "<Picture 1>",
            order: 0
          }
        ]
      })
    );

    const service = new MinimaxH3ExperimentService(store);

    const { runDir, descriptor } = await service.prepareExperiment({
      route: "i2v",
      frames: 124,
      seed: 42,
      prompt: "A sunset",
      operatorLabel: "operator-01",
      runId: "run-events-read-failure",
      outputRoot: ".ai-runs/minimax-h3-experiments",
      targetHost: "render-worker-01",
      gpuUuid: "GPU-12345678-1234-1234-1234-123456789abc",
      comfyUiDir: "/opt/comfyui",
      pythonPath: "/usr/bin/python3",
      inputManifestPath: "manifest.json"
    });

    // Give collection something to have actually started with -- the
    // read-failure must only surface as a collection error once
    // collection isn't "not_started" (the schema forbids a non-empty
    // errors array for that status, since nothing was ever collected
    // to have hidden a failure about).
    store.telemetry = [
      {
        timestamp: "2026-10-12T10:00:00.000Z",
        phase: "before",
        gpu: {
          timestamp: "2026-10-12T10:00:00.000Z",
          deviceUuid: descriptor.target.gpuUuid,
          totalVramMb: 8192,
          usedVramMb: 1024,
          freeVramMb: 7168,
          allocatableVramMb: 8192
        },
        host: {
          timestamp: "2026-10-12T10:00:00.000Z",
          totalRamMb: 16000,
          availableRamMb: 8000,
          usedRamMb: 8000,
          processPid: 1111,
          processStartTimeTicks: 5000,
          processRssMb: 100,
          swapTotalMb: 0,
          swapUsedMb: 0,
          swapInPages: 0,
          swapOutPages: 0
        },
        error: null
      }
    ];

    // reconcileExperiment must still complete (degrade, not throw)...
    const reconstructed = await service.reconcileExperiment(runDir, {
      outputRoot: ".ai-runs/minimax-h3-experiments"
    });

    // ...but the failure must be visible in the result, not erased.
    expect(
      reconstructed.collection.errors.some((e) => e.message.includes("Failed to read events.jsonl"))
    ).toBe(true);
  });

  it("reconstructs failed result with offline server when stored terminal evidence contains CUDA OOM error", async () => {
    const store = new InMemoryStore();
    store.files.set("templates/minimax_h3_720p_i2v_124f_api.json", JSON.stringify(mockI2vTemplate));
    store.files.set("templates/provenance.json", mockProvenanceJson);
    store.files.set(
      "manifest.json",
      JSON.stringify({
        referenceSetId: "ref-test-1",
        references: [
          {
            assetPath: "/tmp/ref1.png",
            stagedFilename: "ref1.png",
            role: "first_frame",
            tag: "<Picture 1>",
            order: 0
          }
        ]
      })
    );

    const offlineTransport: MinimaxH3ComfyUiTransportPort = {
      waitForReadiness: async () => {
        throw new Error("ECONNREFUSED");
      },
      submitPrompt: async () => {
        throw new Error("ECONNREFUSED");
      },
      pollPromptHistory: async () => {
        throw new Error("ECONNREFUSED");
      },
      getQueue: async () => {
        throw new Error("ECONNREFUSED");
      },
      findPromptByWorkflowDigestOrClient: async () => null
    };

    const service = new MinimaxH3ExperimentService(
      store,
      undefined,
      undefined,
      offlineTransport,
      undefined,
      undefined
    );

    const { runDir, descriptor } = await service.prepareExperiment({
      route: "i2v",
      frames: 124,
      seed: 42,
      prompt: "A sunset",
      operatorLabel: "operator-01",
      runId: "run-oom-crash-test",
      outputRoot: ".ai-runs/minimax-h3-experiments",
      targetHost: "render-worker-01",
      gpuUuid: "GPU-12345678-1234-1234-1234-123456789abc",
      comfyUiDir: "/opt/comfyui",
      pythonPath: "/usr/bin/python3",
      inputManifestPath: "manifest.json"
    });

    await store.writeIntent(runDir, {
      runId: descriptor.runId,
      clientId: "client-1",
      workflowDigest: descriptor.derivedWorkflowDigest,
      requestFingerprint: "fp-1",
      timestamp: new Date().toISOString()
    });
    await store.writeReceipt(runDir, {
      runId: descriptor.runId,
      promptId: "prompt-reconcile-oom",
      acceptedAt: new Date().toISOString()
    });

    // Write terminal evidence recording CUDA OOM error before server went offline
    await store.writeTerminalEvidence(runDir, {
      status: "error",
      source: "history",
      rawDetails: {
        "prompt-reconcile-oom": {
          status: {
            status_str: "error",
            completed: true,
            messages: [
              [
                "execution_error",
                {
                  node_id: "104",
                  node_type: "MiniMaxH3ImageToVideo",
                  exception_message: "CUDA out of memory. Tried to allocate 2.00 GiB",
                  exception_type: "torch.cuda.OutOfMemoryError",
                  traceback: ["..."]
                }
              ]
            ]
          },
          outputs: {}
        }
      },
      error: {
        message:
          "torch.cuda.OutOfMemoryError: CUDA out of memory. Tried to allocate 2.00 GiB (node 104)"
      }
    });

    const reconstructed = await service.reconcileExperiment(runDir, {
      outputRoot: ".ai-runs/minimax-h3-experiments"
    });

    expect(reconstructed).toBeDefined();
    expect(reconstructed.execution.status).toBe("failed");
    expect(reconstructed.execution.engineError?.message).toContain("CUDA out of memory");
    expect(reconstructed.probe.status).toBe("not_started");
    expect(reconstructed.lifecycle).toBe("failed");
  });

  it("reconstructs a deliberate stop (terminal evidence status 'interrupted') as unknown, not failed, with no engineError", async () => {
    // A deliberate stop -- our own abort signal firing, or ComfyUI
    // itself reporting the execution as interrupted -- must not be
    // indistinguishable from a genuine engine failure. This exercises
    // the consumer side of that distinction (reconcileExperiment's
    // interpretation of a stored terminalEvidence.status of
    // "interrupted"); the producer side (the write sites in
    // executeExperiment/pollPromptHistory that must actually produce
    // this status instead of "error" for an aborted run) has no
    // dedicated test, for the reason noted in prior commits:
    // executeExperiment has no test harness.
    const store = new InMemoryStore();
    store.files.set("templates/minimax_h3_720p_i2v_124f_api.json", JSON.stringify(mockI2vTemplate));
    store.files.set("templates/provenance.json", mockProvenanceJson);
    store.files.set(
      "manifest.json",
      JSON.stringify({
        referenceSetId: "ref-test-1",
        references: [
          {
            assetPath: "/tmp/ref1.png",
            stagedFilename: "ref1.png",
            role: "first_frame",
            tag: "<Picture 1>",
            order: 0
          }
        ]
      })
    );

    const offlineTransport: MinimaxH3ComfyUiTransportPort = {
      waitForReadiness: async () => {
        throw new Error("ECONNREFUSED");
      },
      submitPrompt: async () => {
        throw new Error("ECONNREFUSED");
      },
      pollPromptHistory: async () => {
        throw new Error("ECONNREFUSED");
      },
      getQueue: async () => {
        throw new Error("ECONNREFUSED");
      },
      findPromptByWorkflowDigestOrClient: async () => null
    };

    const service = new MinimaxH3ExperimentService(
      store,
      undefined,
      undefined,
      offlineTransport,
      undefined,
      undefined
    );

    const { runDir, descriptor } = await service.prepareExperiment({
      route: "i2v",
      frames: 124,
      seed: 42,
      prompt: "A sunset",
      operatorLabel: "operator-01",
      runId: "run-interrupted-test",
      outputRoot: ".ai-runs/minimax-h3-experiments",
      targetHost: "render-worker-01",
      gpuUuid: "GPU-12345678-1234-1234-1234-123456789abc",
      comfyUiDir: "/opt/comfyui",
      pythonPath: "/usr/bin/python3",
      inputManifestPath: "manifest.json"
    });

    await store.writeIntent(runDir, {
      runId: descriptor.runId,
      clientId: "client-1",
      workflowDigest: descriptor.derivedWorkflowDigest,
      requestFingerprint: "fp-1",
      timestamp: new Date().toISOString()
    });
    await store.writeReceipt(runDir, {
      runId: descriptor.runId,
      promptId: "prompt-reconcile-interrupted",
      acceptedAt: new Date().toISOString()
    });

    await store.writeTerminalEvidence(runDir, {
      status: "interrupted",
      source: "history",
      rawDetails: {
        "prompt-reconcile-interrupted": {
          status: { status_str: "interrupted", completed: false },
          outputs: {}
        }
      },
      error: { message: "Polling aborted by operator signal" }
    });

    const reconstructed = await service.reconcileExperiment(runDir, {
      outputRoot: ".ai-runs/minimax-h3-experiments"
    });

    expect(reconstructed.execution.status).toBe("unknown");
    expect(reconstructed.execution.engineError).toBeNull();
  });

  it("reconstructs completed result with offline server when stored terminal evidence indicates success with output", async () => {
    const store = new InMemoryStore();
    store.files.set("templates/minimax_h3_720p_i2v_124f_api.json", JSON.stringify(mockI2vTemplate));
    store.files.set("templates/provenance.json", mockProvenanceJson);
    store.files.set(
      "manifest.json",
      JSON.stringify({
        referenceSetId: "ref-test-1",
        references: [
          {
            assetPath: "/tmp/ref1.png",
            stagedFilename: "ref1.png",
            role: "first_frame",
            tag: "<Picture 1>",
            order: 0
          }
        ]
      })
    );

    const offlineTransport: MinimaxH3ComfyUiTransportPort = {
      waitForReadiness: async () => {
        throw new Error("ECONNREFUSED");
      },
      submitPrompt: async () => {
        throw new Error("ECONNREFUSED");
      },
      pollPromptHistory: async () => {
        throw new Error("ECONNREFUSED");
      },
      getQueue: async () => {
        throw new Error("ECONNREFUSED");
      },
      findPromptByWorkflowDigestOrClient: async () => null
    };

    const mockProber: MinimaxH3OutputProberPort = {
      probeOutput: async (filePath) => ({
        status: "succeeded",
        outputFile: filePath,
        outputSha256: "c".repeat(64),
        outputSizeBytes: 5000000,
        measuredFacts: {
          measuredFrames: 124,
          countedFramesSource: "nb_read_frames",
          declaredNbFrames: 124,
          measuredVideoDurationMs: 5167,
          measuredContainerDurationMs: 5167,
          width: 1344,
          height: 768,
          fps: 24,
          rFrameRate: "24/1",
          avgFrameRate: "24/1",
          videoCodec: "h264",
          audioCodec: "aac",
          audioChannels: 2,
          audioSampleRate: 44100
        },
        discrepancyFlags: [],
        toolIdentity: { ffprobePath: "/usr/bin/ffprobe", version: "7.0.2-static" },
        errors: []
      })
    };

    const service = new MinimaxH3ExperimentService(
      store,
      undefined,
      undefined,
      offlineTransport,
      undefined,
      mockProber
    );

    const { runDir, descriptor } = await service.prepareExperiment({
      route: "i2v",
      frames: 124,
      seed: 42,
      prompt: "A sunset",
      operatorLabel: "operator-01",
      runId: "run-success-offline-test",
      outputRoot: ".ai-runs/minimax-h3-experiments",
      targetHost: "render-worker-01",
      gpuUuid: "GPU-12345678-1234-1234-1234-123456789abc",
      comfyUiDir: "/opt/comfyui",
      pythonPath: "/usr/bin/python3",
      inputManifestPath: "manifest.json"
    });

    await store.writeIntent(runDir, {
      runId: descriptor.runId,
      clientId: "client-1",
      workflowDigest: descriptor.derivedWorkflowDigest,
      requestFingerprint: "fp-1",
      timestamp: new Date().toISOString()
    });
    await store.writeReceipt(runDir, {
      runId: descriptor.runId,
      promptId: "prompt-reconcile-success",
      acceptedAt: new Date().toISOString()
    });

    // Write terminal evidence recording success before server was stopped
    await store.writeTerminalEvidence(runDir, {
      status: "success",
      source: "history",
      outputFilename: "output.mp4",
      rawDetails: {
        "prompt-reconcile-success": {
          status: {
            status_str: "success",
            completed: true,
            messages: []
          },
          outputs: {
            "92": {
              videos: [{ filename: "output.mp4" }]
            }
          }
        }
      }
    });

    const reconstructed = await service.reconcileExperiment(runDir, {
      outputRoot: ".ai-runs/minimax-h3-experiments"
    });

    expect(reconstructed).toBeDefined();
    expect(reconstructed.execution.status).toBe("completed");
    expect(reconstructed.probe.status).toBe("succeeded");
    expect(reconstructed.lifecycle).toBe("completed");
    expect(reconstructed.outputConformance.status).toBe("conformant");
  });

  it("reconstructs completed result with offline server using pinned PreviewVideo images output contract", async () => {
    const store = new InMemoryStore();
    store.files.set("templates/minimax_h3_720p_i2v_124f_api.json", JSON.stringify(mockI2vTemplate));
    store.files.set("templates/provenance.json", mockProvenanceJson);
    store.files.set(
      "manifest.json",
      JSON.stringify({
        referenceSetId: "ref-test-pinned-1",
        references: [
          {
            assetPath: "/tmp/ref1.png",
            stagedFilename: "ref1.png",
            role: "first_frame",
            tag: "<Picture 1>",
            order: 0
          }
        ]
      })
    );

    const offlineTransport: MinimaxH3ComfyUiTransportPort = {
      waitForReadiness: async () => {
        throw new Error("ECONNREFUSED");
      },
      submitPrompt: async () => {
        throw new Error("ECONNREFUSED");
      },
      pollPromptHistory: async () => {
        throw new Error("ECONNREFUSED");
      },
      getQueue: async () => {
        throw new Error("ECONNREFUSED");
      },
      findPromptByWorkflowDigestOrClient: async () => null
    };

    const mockProber: MinimaxH3OutputProberPort = {
      probeOutput: async (filePath) => ({
        status: "succeeded",
        outputFile: filePath,
        outputSha256: "d".repeat(64),
        outputSizeBytes: 5000000,
        measuredFacts: {
          measuredFrames: 124,
          countedFramesSource: "nb_read_frames",
          declaredNbFrames: 124,
          measuredVideoDurationMs: 5167,
          measuredContainerDurationMs: 5167,
          width: 1344,
          height: 768,
          fps: 24,
          rFrameRate: "24/1",
          avgFrameRate: "24/1",
          videoCodec: "h264",
          audioCodec: "aac",
          audioChannels: 2,
          audioSampleRate: 44100
        },
        discrepancyFlags: [],
        toolIdentity: { ffprobePath: "/usr/bin/ffprobe", version: "7.0.2-static" },
        errors: []
      })
    };

    const service = new MinimaxH3ExperimentService(
      store,
      undefined,
      undefined,
      offlineTransport,
      undefined,
      mockProber
    );

    const { runDir, descriptor } = await service.prepareExperiment({
      route: "i2v",
      frames: 124,
      seed: 42,
      prompt: "A sunset",
      operatorLabel: "operator-01",
      runId: "run-pinned-images-offline-test",
      outputRoot: ".ai-runs/minimax-h3-experiments",
      targetHost: "render-worker-01",
      gpuUuid: "GPU-12345678-1234-1234-1234-123456789abc",
      comfyUiDir: "/opt/comfyui",
      pythonPath: "/usr/bin/python3",
      inputManifestPath: "manifest.json"
    });

    await store.writeIntent(runDir, {
      runId: descriptor.runId,
      clientId: "client-1",
      workflowDigest: descriptor.derivedWorkflowDigest,
      requestFingerprint: "fp-1",
      timestamp: new Date().toISOString()
    });
    await store.writeReceipt(runDir, {
      runId: descriptor.runId,
      promptId: "prompt-pinned-images",
      acceptedAt: new Date().toISOString()
    });

    // Pinned ComfyUI PreviewVideo outputs under "images" array
    await store.writeTerminalEvidence(runDir, {
      status: "success",
      source: "history",
      outputFilename: "minimax_h3_i2v_run-pinned-images-offline-test_00001_.mp4",
      rawDetails: {
        "prompt-pinned-images": {
          status: {
            status_str: "success",
            completed: true,
            messages: []
          },
          outputs: {
            "92": {
              images: [
                {
                  filename: "minimax_h3_i2v_run-pinned-images-offline-test_00001_.mp4",
                  subfolder: "",
                  type: "output"
                }
              ]
            }
          }
        }
      }
    });

    const reconstructed = await service.reconcileExperiment(runDir, {
      outputRoot: ".ai-runs/minimax-h3-experiments"
    });

    expect(reconstructed).toBeDefined();
    expect(reconstructed.execution.status).toBe("completed");
    expect(reconstructed.probe.status).toBe("succeeded");
    expect(reconstructed.lifecycle).toBe("completed");
    expect(reconstructed.outputConformance.status).toBe("conformant");
  });

  it("retains engine execution success and adds stop recommendation when stop policy threshold is crossed", async () => {
    const store = new InMemoryStore();
    store.files.set("templates/minimax_h3_720p_i2v_124f_api.json", JSON.stringify(mockI2vTemplate));
    store.files.set("templates/provenance.json", mockProvenanceJson);
    store.files.set(
      "manifest.json",
      JSON.stringify({
        referenceSetId: "ref-test-1",
        references: [
          {
            assetPath: "/tmp/ref1.png",
            stagedFilename: "ref1.png",
            role: "first_frame",
            tag: "<Picture 1>",
            order: 0
          }
        ]
      })
    );

    const mockTransport: MinimaxH3ComfyUiTransportPort = {
      waitForReadiness: async () => ({ ok: true }),
      submitPrompt: async () => ({ ok: true, promptId: "prompt-stop-1" }),
      pollPromptHistory: async () => ({
        status: "completed",
        outputFilename: "output.mp4",
        rawHistory: { status: "success" }
      }),
      getQueue: async () => ({ running: [], pending: [] }),
      findPromptByWorkflowDigestOrClient: async () => null
    };

    const mockProber: MinimaxH3OutputProberPort = {
      probeOutput: async (filePath) => ({
        status: "succeeded",
        outputFile: filePath,
        outputSha256: "c".repeat(64),
        outputSizeBytes: 5000000,
        measuredFacts: {
          measuredFrames: 124,
          countedFramesSource: "nb_read_frames",
          declaredNbFrames: 124,
          measuredVideoDurationMs: 5167,
          measuredContainerDurationMs: 5167,
          width: 1344,
          height: 768,
          fps: 24,
          rFrameRate: "24/1",
          avgFrameRate: "24/1",
          videoCodec: "h264",
          audioCodec: "aac",
          audioChannels: 2,
          audioSampleRate: 44100
        },
        discrepancyFlags: [],
        toolIdentity: { ffprobePath: "/usr/bin/ffprobe", version: "7.0.2-static" },
        errors: []
      })
    };

    const service = new MinimaxH3ExperimentService(
      store,
      undefined,
      undefined,
      mockTransport,
      undefined,
      mockProber
    );

    const { runDir, descriptor } = await service.prepareExperiment({
      route: "i2v",
      frames: 124,
      seed: 42,
      prompt: "A sunset",
      operatorLabel: "operator-01",
      runId: "run-stop-threshold-test",
      outputRoot: ".ai-runs/minimax-h3-experiments",
      targetHost: "render-worker-01",
      gpuUuid: "GPU-12345678-1234-1234-1234-123456789abc",
      comfyUiDir: "/opt/comfyui",
      pythonPath: "/usr/bin/python3",
      inputManifestPath: "manifest.json"
    });

    await store.writeIntent(runDir, {
      runId: descriptor.runId,
      clientId: "client-1",
      workflowDigest: descriptor.derivedWorkflowDigest,
      requestFingerprint: "fp-1",
      timestamp: new Date().toISOString()
    });
    await store.writeReceipt(runDir, {
      runId: descriptor.runId,
      promptId: "prompt-stop-1",
      acceptedAt: new Date().toISOString()
    });

    // Append stop threshold crossed event
    await store.appendEvent(runDir, {
      timestamp: new Date().toISOString(),
      event: "stop_threshold_crossed",
      details: { metric: "peak_vram", value: 24500, limit: 24000 }
    });

    const reconstructed = await service.reconcileExperiment(runDir, {
      outputRoot: ".ai-runs/minimax-h3-experiments"
    });

    expect(reconstructed).toBeDefined();
    // Engine execution status must remain completed, NOT overridden to error
    expect(reconstructed.execution.status).toBe("completed");
    expect(reconstructed.stopRecommendation.recommended).toBe(true);
    expect(reconstructed.stopRecommendation.reasons).toContain("stop_threshold_crossed_peak_vram");
  });
});

describe("MiniMax-H3 Experiment Service V2 & Phase Accounting", () => {
  it("prepares, validates, and reconciles an instrumented v2 experiment with phase accounting", async () => {
    const store = createInitializedStore();

    const service = new MinimaxH3ExperimentService(store);
    const { descriptor, runDir } = await service.prepareExperiment({
      route: "i2v",
      frames: 124,
      seed: 42,
      prompt: "A neon cyborg in rainy Tokyo",
      operatorLabel: "operator-v2",
      runId: "run-v2-test",
      outputRoot: ".ai-runs/minimax-h3-experiments",
      targetHost: "render-worker-01",
      gpuUuid: "GPU-12345678-1234-1234-1234-123456789abc",
      comfyUiDir: "/opt/comfyui",
      pythonPath: "/usr/bin/python3",
      inputManifestPath: "manifest.json",
      stepOverride: 15,
      variantPurpose: "performance"
    });

    expect(descriptor.schemaVersion).toBe(2);
    if (descriptor.schemaVersion !== 2) throw new Error("Expected schemaVersion 2");
    expect(descriptor.experimentVariant.purpose).toBe("performance");
    expect(descriptor.provenance.samplerSettings.steps).toBe(15);
    expect(descriptor.conditioning.positivePrompt.text).toBe("A neon cyborg in rainy Tokyo");
    expect(descriptor.compatibility.state).toBe("supported");

    // Offline validation
    const validation = await service.validateExperiment(runDir);
    expect(validation.ok).toBe(true);
    if (!validation.ok) throw new Error("Expected validation to pass");
    expect(validation.descriptor.schemaVersion).toBe(2);

    // Populate execution facts for reconciliation
    await store.writeIntent(runDir, {
      runId: descriptor.runId,
      clientId: "client-v2",
      workflowDigest: descriptor.derivedWorkflowDigest,
      requestFingerprint: "fp-v2",
      timestamp: "2026-10-12T10:00:00.000Z"
    });
    await store.writeReceipt(runDir, {
      runId: descriptor.runId,
      promptId: "prompt-v2-1",
      acceptedAt: "2026-10-12T10:00:01.000Z"
    });
    await store.writeTerminalEvidence(runDir, {
      source: "history",
      status: "success",
      outputFilename: "output.mp4",
      rawDetails: {
        "prompt-v2-1": {
          status: {
            status_str: "success",
            completed: true,
            messages: []
          },
          outputs: {
            "92": {
              videos: [{ filename: "output.mp4" }]
            }
          }
        }
      }
    });

    // Populate phase events using start/end spans
    let seq = 0;
    const addSpan = async (
      phase: MinimaxH3PhaseAccountingEvent["phase"],
      spanId: string,
      startMs: number,
      endMs: number,
      extra: Record<string, unknown> = {}
    ) => {
      seq++;
      await store.appendPhaseEvent(runDir, {
        protocolVersion: "v2-jsonl",
        sequence: seq,
        runId: descriptor.runId,
        attemptToken: "att-v2-1",
        spanId,
        phase,
        type: "span_start",
        boundarySource: "child_bootstrap",
        clockDomain: "mono_child",
        monotonicMs: startMs,
        ...extra
      });
      seq++;
      await store.appendPhaseEvent(runDir, {
        protocolVersion: "v2-jsonl",
        sequence: seq,
        runId: descriptor.runId,
        attemptToken: "att-v2-1",
        spanId,
        phase,
        type: "span_end",
        boundarySource: "child_bootstrap",
        clockDomain: "mono_child",
        monotonicMs: endMs,
        outcome: "success",
        ...extra
      });
    };

    await addSpan("environment_startup", "span-1", 100, 5100);
    await addSpan("model_loading", "span-2", 5100, 15100);
    await addSpan("sampling_step", "span-3", 15100, 25100, { stepIndex: 1 });
    await addSpan("sampling_step", "span-4", 25100, 35100, { stepIndex: 2 });
    await addSpan("vae_decode_video", "span-5", 35100, 42100);

    const reconciled = await service.reconcileExperiment(runDir, {
      outputRoot: ".ai-runs/minimax-h3-experiments"
    });

    expect(reconciled.schemaVersion).toBe(2);
    if (reconciled.schemaVersion !== 2) throw new Error("Expected reconciled schemaVersion 2");
    expect(reconciled.phaseAccounting.phases.environment_startup!.status).toBe("measured");
    expect(reconciled.phaseAccounting.phases.environment_startup!.durationMs).toBe(5000);
    expect(reconciled.phaseAccounting.phases.model_loading!.status).toBe("measured");
    expect(reconciled.phaseAccounting.phases.model_loading!.durationMs).toBe(10000);
    expect(reconciled.phaseAccounting.phases.sampling_step!.status).toBe("measured");
    expect(reconciled.phaseAccounting.phases.sampling_step!.durationMs).toBe(20000);
    expect(reconciled.phaseAccounting.phases.vae_decode_audio!.status).toBe("unknown");
    expect(reconciled.phaseAccounting.phases.vae_decode_audio!.durationMs).toBeNull();
  });

  it("detects tampered prompt conditioning or factor changes in offline validation", async () => {
    const store = createInitializedStore();

    const service = new MinimaxH3ExperimentService(store);
    const { descriptor, runDir } = await service.prepareExperiment({
      route: "i2v",
      frames: 124,
      seed: 42,
      prompt: "A neon cyborg in rainy Tokyo",
      operatorLabel: "operator-v2",
      runId: "run-v2-tamper",
      outputRoot: ".ai-runs/minimax-h3-experiments",
      targetHost: "render-worker-01",
      gpuUuid: "GPU-12345678-1234-1234-1234-123456789abc",
      comfyUiDir: "/opt/comfyui",
      pythonPath: "/usr/bin/python3",
      inputManifestPath: "manifest.json",
      stepOverride: 15
    });

    if (descriptor.schemaVersion !== 2) throw new Error("Expected v2 descriptor");

    // Tamper with prompt text in descriptor without re-hashing
    const tamperedDescriptor = {
      ...descriptor,
      conditioning: {
        ...descriptor.conditioning,
        positivePrompt: {
          text: "Tampered prompt text",
          digest: descriptor.conditioning.positivePrompt.digest
        }
      }
    };
    await store.writeDescriptor(runDir, tamperedDescriptor);

    const validation = await service.validateExperiment(runDir);
    expect(validation.ok).toBe(false);
    expect(validation.errors.some((e) => e.includes("Prompt digest mismatch"))).toBe(true);
  });

  it("fails closed when runtime compatibility state is conflict before child spawn (Witness F2)", async () => {
    const store = createInitializedStore();
    store.files.set(
      ".ai-runs/minimax-h3-experiments/stop-policy.json",
      JSON.stringify(DEFAULT_MINIMAX_H3_STOP_POLICY)
    );

    let childSpawned = false;
    const mockRunner: MinimaxH3ProcessRunnerPort = {
      spawnChild: async () => {
        childSpawned = true;
        throw new Error("Should not be called");
      }
    };

    const mockPreflight: MinimaxH3TargetPreflightPort = {
      checkTargetHost: async () => ({ ok: true }),
      checkPortAvailable: async () => ({ ok: true }),
      verifyCheckout: async () => ({ ok: true, revision: "55b6a9b1", nodesPresent: true }),
      verifyModels: async () => ({ ok: true, resolvedPaths: {} }),
      verifyDiskSpace: async () => ({ ok: true, freeGb: 100 }),
      acquireGpuLock: async () => ({
        acquired: true,
        release: async () => {}
      }),
      verifyExperimentRuntime: async () => ({
        ok: false,
        status: "conflict",
        blocker:
          "Runtime conflict: unpinned custom nodes detected conflicting with attention kernel",
        adapterRegistered: true
      })
    };

    const mockTransport: MinimaxH3ComfyUiTransportPort = {
      waitForReadiness: async () => ({ ok: true }),
      submitPrompt: async () => ({ ok: true, promptId: "p-1" }),
      pollPromptHistory: async () => ({ status: "completed" }),
      getQueue: async () => ({ running: [], pending: [] }),
      findPromptByWorkflowDigestOrClient: async () => null
    };

    const mockTelemetry = {
      start: () => ({
        stop: async () => {},
        setPhase: () => {}
      })
    };

    const service = new MinimaxH3ExperimentService(
      store,
      mockPreflight,
      mockRunner,
      mockTransport,
      mockTelemetry
    );
    const { runDir } = await service.prepareExperiment({
      route: "i2v",
      frames: 124,
      seed: 42,
      prompt: "A prompt",
      operatorLabel: "operator-f2",
      runId: "run-f2-conflict",
      outputRoot: ".ai-runs/minimax-h3-experiments",
      targetHost: "render-worker-01",
      gpuUuid: "GPU-12345678-1234-1234-1234-123456789abc",
      comfyUiDir: "/opt/comfyui",
      pythonPath: "/usr/bin/python3",
      inputManifestPath: "manifest.json",
      stepOverride: 15
    });

    await expect(
      service.executeExperiment(runDir, {
        stopPolicyPath: ".ai-runs/minimax-h3-experiments/stop-policy.json",
        outputRoot: ".ai-runs/minimax-h3-experiments"
      })
    ).rejects.toThrow(/Preflight experiment runtime verification failed: Runtime conflict/);

    expect(childSpawned).toBe(false);
  });

  it("completes full lifecycle: prepare, child bootstrap handshake event, reconcile and compare with zero conflicts using unmodified descriptor [F-f78eab0f]", async () => {
    const store = new InMemoryStore();
    store.files.set("templates/minimax_h3_720p_i2v_124f_api.json", JSON.stringify(mockI2vTemplate));
    store.files.set("templates/provenance.json", mockProvenanceJson);
    store.files.set(
      "manifest.json",
      JSON.stringify({
        referenceSetId: "ref-test-1",
        references: [
          {
            assetPath: "/tmp/ref1.png",
            stagedFilename: "ref1.png",
            role: "first_frame",
            tag: "<Picture 1>",
            order: 0
          }
        ]
      })
    );

    const service = new MinimaxH3ExperimentService(store);

    // 1. Prepare baseline experiment without manual descriptor manipulation
    const { runDir: baseRunDir, descriptor: baseDescriptor } = await service.prepareExperiment({
      route: "i2v",
      frames: 124,
      seed: 42,
      prompt: "A test prompt",
      operatorLabel: "operator-01",
      runId: "run-e2e-base-test",
      outputRoot: ".ai-runs/minimax-h3-experiments",
      targetHost: "render-worker-01",
      gpuUuid: "GPU-12345678-1234-1234-1234-123456789abc",
      comfyUiDir: "/opt/comfyui",
      pythonPath: "/usr/bin/python3",
      inputManifestPath: "manifest.json",
      schemaVersion: 2
    });

    const v2BaseDesc = baseDescriptor as MinimaxH3ExperimentDescriptorV2;
    // Genuine digests must be present in provenance and requiredRuntime, not placeholder strings
    expect(v2BaseDesc.provenance.collectorDigest).toBe(v2BaseDesc.requiredRuntime.collectorDigest);
    expect(v2BaseDesc.provenance.hookManifestDigest).toBe(
      v2BaseDesc.requiredRuntime.hookManifestDigest
    );

    const attemptTokenBase = "attempt-token-base-1";
    await store.writeDurableJson(`${baseRunDir}/attempt.json`, { attemptToken: attemptTokenBase });
    await store.writeReceipt(baseRunDir, {
      runId: v2BaseDesc.runId,
      promptId: "prompt-base-1",
      acceptedAt: "2026-10-12T10:00:01.000Z"
    });
    await store.writeTerminalEvidence(baseRunDir, {
      source: "history",
      status: "success",
      outputFilename: "output.mp4",
      rawDetails: {
        "prompt-base-1": {
          status: { status_str: "success", completed: true, messages: [] },
          outputs: {}
        }
      }
    });

    // Write child events matching the genuine handshake digests reported by collector
    store.phaseEvents = [
      {
        protocolVersion: "v2-jsonl",
        sequence: 1,
        runId: v2BaseDesc.runId,
        attemptToken: attemptTokenBase,
        spanId: "span-boot-1",
        phase: "environment_startup",
        type: "point_event",
        boundarySource: "child_bootstrap",
        clockDomain: "mono_child",
        monotonicMs: 100.0,
        metadata: {
          handshake: "v2-jsonl",
          collectorDigest: v2BaseDesc.requiredRuntime.collectorDigest,
          hookManifestDigest: v2BaseDesc.requiredRuntime.hookManifestDigest
        }
      },
      {
        protocolVersion: "v2-jsonl",
        sequence: 2,
        runId: v2BaseDesc.runId,
        attemptToken: attemptTokenBase,
        spanId: "span-samp-1",
        phase: "sampling",
        type: "span_start",
        boundarySource: "child_bootstrap",
        clockDomain: "mono_child",
        monotonicMs: 200.0
      },
      {
        protocolVersion: "v2-jsonl",
        sequence: 3,
        runId: v2BaseDesc.runId,
        attemptToken: attemptTokenBase,
        spanId: "span-samp-1",
        phase: "sampling",
        type: "span_end",
        boundarySource: "child_bootstrap",
        clockDomain: "mono_child",
        monotonicMs: 1200.0,
        outcome: "success"
      }
    ];

    const baseResult = (await service.reconcileExperiment(baseRunDir, {
      outputRoot: ".ai-runs/minimax-h3-experiments"
    })) as MinimaxH3ExperimentResultV2;

    // Reconciliation must succeed with zero conflicts and verified handshake
    expect(baseResult.observedProvenance.conflicts).toEqual([]);
    expect(baseResult.observedProvenance.bootstrapHandshake?.status).toBe("verified");

    // 2. Prepare candidate experiment
    const { runDir: candRunDir, descriptor: candDescriptor } = await service.prepareExperiment({
      route: "i2v",
      frames: 124,
      seed: 42,
      prompt: "A test prompt",
      operatorLabel: "operator-01",
      runId: "run-e2e-cand-test",
      outputRoot: ".ai-runs/minimax-h3-experiments",
      targetHost: "render-worker-01",
      gpuUuid: "GPU-12345678-1234-1234-1234-123456789abc",
      comfyUiDir: "/opt/comfyui",
      pythonPath: "/usr/bin/python3",
      inputManifestPath: "manifest.json",
      schemaVersion: 2,
      stepOverride: 15
    });

    const v2CandDesc = candDescriptor as MinimaxH3ExperimentDescriptorV2;
    expect(v2CandDesc.provenance.collectorDigest).toBe(v2CandDesc.requiredRuntime.collectorDigest);

    const attemptTokenCand = "attempt-token-cand-1";
    await store.writeDurableJson(`${candRunDir}/attempt.json`, { attemptToken: attemptTokenCand });
    await store.writeReceipt(candRunDir, {
      runId: v2CandDesc.runId,
      promptId: "prompt-cand-1",
      acceptedAt: "2026-10-12T10:05:01.000Z"
    });
    await store.writeTerminalEvidence(candRunDir, {
      source: "history",
      status: "success",
      outputFilename: "output.mp4",
      rawDetails: {
        "prompt-cand-1": {
          status: { status_str: "success", completed: true, messages: [] },
          outputs: {}
        }
      }
    });

    store.phaseEvents = [
      {
        protocolVersion: "v2-jsonl",
        sequence: 1,
        runId: v2CandDesc.runId,
        attemptToken: attemptTokenCand,
        spanId: "span-boot-2",
        phase: "environment_startup",
        type: "point_event",
        boundarySource: "child_bootstrap",
        clockDomain: "mono_child",
        monotonicMs: 100.0,
        metadata: {
          handshake: "v2-jsonl",
          collectorDigest: v2CandDesc.requiredRuntime.collectorDigest,
          hookManifestDigest: v2CandDesc.requiredRuntime.hookManifestDigest
        }
      },
      {
        protocolVersion: "v2-jsonl",
        sequence: 2,
        runId: v2CandDesc.runId,
        attemptToken: attemptTokenCand,
        spanId: "span-samp-2",
        phase: "sampling",
        type: "span_start",
        boundarySource: "child_bootstrap",
        clockDomain: "mono_child",
        monotonicMs: 200.0
      },
      {
        protocolVersion: "v2-jsonl",
        sequence: 3,
        runId: v2CandDesc.runId,
        attemptToken: attemptTokenCand,
        spanId: "span-samp-2",
        phase: "sampling",
        type: "span_end",
        boundarySource: "child_bootstrap",
        clockDomain: "mono_child",
        monotonicMs: 1000.0,
        outcome: "success"
      }
    ];

    const candResult = (await service.reconcileExperiment(candRunDir, {
      outputRoot: ".ai-runs/minimax-h3-experiments"
    })) as MinimaxH3ExperimentResultV2;

    expect(candResult.observedProvenance.conflicts).toEqual([]);
    expect(candResult.observedProvenance.bootstrapHandshake?.status).toBe("verified");

    // 3. Compare baseline and candidate
    const report = compareMinimaxH3Experiments({
      baselineDescriptor: v2BaseDesc,
      baselineResult: baseResult,
      variantDescriptor: v2CandDesc,
      variantResult: candResult
    });

    expect(report.structuralAdmission.eligible).toBe(true);
    expect(report.metricEligibility.wallTimeEligible).toBe(true);
  });
});

describe("MiniMax-H3 Upgraded Dense Attention Validation (F-437dab51)", () => {
  it("prepares and validates an upgraded dense attention experiment against real canonical templates", async () => {
    const store = new InMemoryStore();
    store.files.set(
      "templates/minimax_h3_720p_i2v_124f_api.json",
      readFileSync("templates/minimax_h3_720p_i2v_124f_api.json", "utf-8")
    );
    store.files.set(
      "templates/provenance.json",
      readFileSync("templates/provenance.json", "utf-8")
    );
    store.files.set(
      "manifest.json",
      JSON.stringify({
        referenceSetId: "ref-test-real-1",
        references: [
          {
            assetPath: "/tmp/ref1.png",
            stagedFilename: "ref1.png",
            role: "first_frame",
            tag: "<Picture 1>",
            order: 0
          }
        ]
      })
    );

    const service = new MinimaxH3ExperimentService(store);

    const { runDir, descriptor } = await service.prepareExperiment({
      route: "i2v",
      frames: 124,
      seed: 42,
      prompt:
        "A cinematic shot of a person smiling warmly, natural lighting, highly detailed skin texture, 8k hyperrealistic",
      operatorLabel: "operator-01",
      runId: "run-upgraded-dense-regression",
      outputRoot: ".ai-runs/minimax-h3-experiments",
      targetHost: "render-worker-01",
      gpuUuid: "GPU-12345678-1234-1234-1234-123456789abc",
      comfyUiDir: "/opt/comfyui-experimental",
      pythonPath: "/usr/bin/python3",
      inputManifestPath: "manifest.json",
      attentionVariant: "dense",
      coreRevision: "94cfeb3a5d8985efaa7ea9f5e5dfad4184ec99bf"
    });

    const descV2 = descriptor as MinimaxH3ExperimentDescriptorV2;
    expect(descV2.attentionRequest?.attentionVariant).toBe("dense");
    expect(descV2.compatibility?.scope).toBe("upgraded-dense-attention-control-i2v");
    expect(descV2.provenance?.comfyuiCoreRevision).toBe("94cfeb3a5d8985efaa7ea9f5e5dfad4184ec99bf");

    const validation = await service.validateExperiment(runDir, {
      outputRoot: ".ai-runs/minimax-h3-experiments"
    });

    expect(validation.errors).toEqual([]);
    expect(validation.ok).toBe(true);
  });

  it("prepares and validates a matched dense attention experiment (matchedVariant: sol-attn)", async () => {
    const store = new InMemoryStore();
    store.files.set(
      "templates/minimax_h3_720p_i2v_124f_api.json",
      readFileSync("templates/minimax_h3_720p_i2v_124f_api.json", "utf-8")
    );
    store.files.set(
      "templates/provenance.json",
      readFileSync("templates/provenance.json", "utf-8")
    );
    store.files.set(
      "manifest.json",
      JSON.stringify({
        referenceSetId: "ref-test-real-2",
        references: [
          {
            assetPath: "/tmp/ref1.png",
            stagedFilename: "ref1.png",
            role: "first_frame",
            tag: "<Picture 1>",
            order: 0
          }
        ]
      })
    );

    const service = new MinimaxH3ExperimentService(store);

    const { runDir, descriptor } = await service.prepareExperiment({
      route: "i2v",
      frames: 124,
      seed: 42,
      prompt:
        "A cinematic shot of a person smiling warmly, natural lighting, highly detailed skin texture, 8k hyperrealistic",
      operatorLabel: "operator-01",
      runId: "run-sol-attn-matched-dense-regression",
      outputRoot: ".ai-runs/minimax-h3-experiments",
      targetHost: "render-worker-01",
      gpuUuid: "GPU-12345678-1234-1234-1234-123456789abc",
      comfyUiDir: "/opt/comfyui-experimental",
      pythonPath: "/usr/bin/python3",
      inputManifestPath: "manifest.json",
      attentionVariant: "dense",
      matchedVariant: "native-sol-attn"
    });

    const descV2 = descriptor as MinimaxH3ExperimentDescriptorV2;
    expect(descV2.attentionRequest?.attentionVariant).toBe("dense");
    expect(descV2.compatibility?.scope).toBe("sol-attn-matched-dense-attention-i2v");
    expect(descV2.provenance?.comfyuiCoreRevision).toBe("94cfeb3a5d8985efaa7ea9f5e5dfad4184ec99bf");

    const validation = await service.validateExperiment(runDir, {
      outputRoot: ".ai-runs/minimax-h3-experiments"
    });

    expect(validation.errors).toEqual([]);
    expect(validation.ok).toBe(true);
  });
});

describe("MiniMax-H3 Step Reduction Sampling Recipe Validation & Tampering Detection", () => {
  function createRealTemplateStore(): InMemoryStore {
    const store = new InMemoryStore();
    store.files.set(
      "templates/minimax_h3_720p_i2v_124f_api.json",
      readFileSync("templates/minimax_h3_720p_i2v_124f_api.json", "utf-8")
    );
    store.files.set(
      "templates/minimax_h3_720p_ref2v_124f_api.json",
      readFileSync("templates/minimax_h3_720p_ref2v_124f_api.json", "utf-8")
    );
    store.files.set(
      "templates/provenance.json",
      readFileSync("templates/provenance.json", "utf-8")
    );
    store.files.set(
      "manifest-i2v.json",
      JSON.stringify({
        referenceSetId: "ref-test-i2v",
        references: [
          {
            assetPath: "/tmp/ref1.png",
            stagedFilename: "ref1.png",
            role: "first_frame",
            tag: "<Picture 1>",
            order: 0
          }
        ]
      })
    );
    store.files.set(
      "manifest-ref2v.json",
      JSON.stringify({
        referenceSetId: "ref-test-ref2v",
        references: [
          {
            assetPath: "/tmp/ref1.png",
            stagedFilename: "ref1.png",
            role: "reference",
            tag: "<Picture 1>",
            order: 0
          },
          {
            assetPath: "/tmp/ref2.png",
            stagedFilename: "ref2.png",
            role: "reference",
            tag: "<Picture 2>",
            order: 1
          }
        ]
      })
    );
    return store;
  }

  it("prepares and validates an isolated I2V experiment with fl2va-turbo-8 recipe against canonical templates", async () => {
    const store = createRealTemplateStore();
    const service = new MinimaxH3ExperimentService(store);

    const { runDir, descriptor } = await service.prepareExperiment({
      route: "i2v",
      frames: 124,
      seed: 42,
      prompt:
        "A cinematic shot of a person smiling warmly, natural lighting, highly detailed skin texture, 8k hyperrealistic",
      operatorLabel: "operator-01",
      runId: "run-fl2va-turbo-8-prep-val",
      outputRoot: ".ai-runs/minimax-h3-experiments",
      targetHost: "render-worker-01",
      gpuUuid: "GPU-12345678-1234-1234-1234-123456789abc",
      comfyUiDir: "/opt/comfyui",
      pythonPath: "/usr/bin/python3",
      inputManifestPath: "manifest-i2v.json",
      samplingRecipe: "fl2va-turbo-8"
    });

    const descV2 = descriptor as MinimaxH3ExperimentDescriptorV2;
    expect(descV2.samplingRecipe?.name).toBe("fl2va-turbo-8");
    expect(descV2.samplingRecipe?.expectedSteps).toBe(8);
    expect(descV2.samplingRecipe?.lora?.filename).toBe(
      "minimax_h3_fl2v_turbo_8step_v1.0_comfyui_bf16.safetensors"
    );
    expect(descV2.samplingRecipe?.lora?.strengthModel).toBe(1.0);
    expect(
      descV2.requiredRuntime?.requiredNodes.some((n) => n.name === "LoraLoaderModelOnly")
    ).toBe(true);

    // Factors must declare models.auxiliary, sampling.settings, and runtime.manifest
    const factorPaths = descV2.experimentVariant.changedFactors.map((f) => f.path);
    expect(factorPaths).toContain("models.auxiliary");
    expect(factorPaths).toContain("sampling.settings");
    expect(factorPaths).toContain("runtime.manifest");

    // Config graph must contain node 301 LoraLoaderModelOnly wired to BasicGuider
    const config = store.config!;
    expect(config["301"]).toBeDefined();
    expect((config["301"] as { class_type: string }).class_type).toBe("LoraLoaderModelOnly");
    expect((config["16"] as { inputs: { model: unknown } }).inputs.model).toEqual(["301", 0]);
    expect((config["9"] as { inputs: { steps: number } }).inputs.steps).toBe(8);

    const validation = await service.validateExperiment(runDir, {
      outputRoot: ".ai-runs/minimax-h3-experiments"
    });
    expect(validation.errors).toEqual([]);
    expect(validation.ok).toBe(true);
  });

  it("prepares and validates an isolated Ref2V experiment with ref2va-turbo-4 recipe against canonical templates", async () => {
    const store = createRealTemplateStore();
    const service = new MinimaxH3ExperimentService(store);

    const { runDir, descriptor } = await service.prepareExperiment({
      route: "ref2v",
      frames: 124,
      seed: 42,
      prompt: "A scene with <Picture 1> and <Picture 2>",
      operatorLabel: "operator-01",
      runId: "run-ref2va-turbo-4-prep-val",
      outputRoot: ".ai-runs/minimax-h3-experiments",
      targetHost: "render-worker-01",
      gpuUuid: "GPU-12345678-1234-1234-1234-123456789abc",
      comfyUiDir: "/opt/comfyui",
      pythonPath: "/usr/bin/python3",
      inputManifestPath: "manifest-ref2v.json",
      samplingRecipe: "ref2va-turbo-4"
    });

    const descV2 = descriptor as MinimaxH3ExperimentDescriptorV2;
    expect(descV2.samplingRecipe?.name).toBe("ref2va-turbo-4");
    expect(descV2.samplingRecipe?.expectedSteps).toBe(4);
    expect(descV2.samplingRecipe?.lora?.filename).toBe(
      "minimax_h3_ref2v_turbo_4step_v0.1_comfyui_bf16.safetensors"
    );
    expect(descV2.samplingRecipe?.lora?.strengthModel).toBe(1.0);

    const config = store.config!;
    expect(config["301"]).toBeDefined();
    expect((config["9"] as { inputs: { steps: number } }).inputs.steps).toBe(4);

    const validation = await service.validateExperiment(runDir, {
      outputRoot: ".ai-runs/minimax-h3-experiments"
    });
    expect(validation.errors).toEqual([]);
    expect(validation.ok).toBe(true);
  });

  it("prepares and validates an isolated I2V experiment with fasth3-i2v-8 recipe against canonical templates", async () => {
    const store = createRealTemplateStore();
    const service = new MinimaxH3ExperimentService(store);

    const { runDir, descriptor } = await service.prepareExperiment({
      route: "i2v",
      frames: 124,
      seed: 42,
      prompt:
        "A cinematic shot of a person smiling warmly, natural lighting, highly detailed skin texture, 8k hyperrealistic",
      operatorLabel: "operator-01",
      runId: "run-fasth3-i2v-8-prep-val",
      outputRoot: ".ai-runs/minimax-h3-experiments",
      targetHost: "render-worker-01",
      gpuUuid: "GPU-12345678-1234-1234-1234-123456789abc",
      comfyUiDir: "/opt/comfyui",
      pythonPath: "/usr/bin/python3",
      inputManifestPath: "manifest-i2v.json",
      samplingRecipe: "fasth3-i2v-8"
    });

    const descV2 = descriptor as MinimaxH3ExperimentDescriptorV2;
    expect(descV2.samplingRecipe?.name).toBe("fasth3-i2v-8");
    expect(descV2.samplingRecipe?.expectedSteps).toBe(8);
    expect(descV2.samplingRecipe?.sigmaShift?.enabled).toBe(true);
    expect(descV2.samplingRecipe?.sigmaShift?.videoShift).toBe(10.0);
    expect(descV2.requiredRuntime?.coreRevision).toBe("ee71d5c4993f29086b27fde1629a945ae48425bf");
    expect(descV2.requiredRuntime?.attentionKernel).toBe("block_sparse_triton");

    const fastH3FactorPaths = descV2.experimentVariant.changedFactors.map((f) => f.path);
    expect(fastH3FactorPaths).toContain("attention.configuration");
    expect(fastH3FactorPaths).toContain("runtime.manifest");

    const config = store.config!;
    expect(config["301"]).toBeDefined();
    expect((config["301"] as { class_type: string }).class_type).toBe("MiniMaxH3SigmaShift");
    expect(config["302"]).toBeDefined();
    expect((config["302"] as { class_type: string }).class_type).toBe("ModelAttentionBackend");
    expect(config["303"]).toBeDefined();
    expect((config["303"] as { class_type: string }).class_type).toBe("BlockSparseAttention");
    expect((config["6"] as { inputs: { unet_name: string } }).inputs.unet_name).toBe(
      "fastvideo_fasth3_8step_v2_pruned_int8_convrot.safetensors"
    );
    expect((config["9"] as { inputs: { steps: number } }).inputs.steps).toBe(8);

    const validation = await service.validateExperiment(runDir, {
      outputRoot: ".ai-runs/minimax-h3-experiments"
    });
    expect(validation.errors).toEqual([]);
    expect(validation.ok).toBe(true);
  });

  describe("Adversarial Tampering Detection", () => {
    it("detects tampered descriptor diffusion model filename/hash", async () => {
      const store = createRealTemplateStore();
      const service = new MinimaxH3ExperimentService(store);

      const { runDir, descriptor } = await service.prepareExperiment({
        route: "i2v",
        frames: 124,
        seed: 42,
        prompt: "A test prompt",
        operatorLabel: "operator-01",
        runId: "run-tamper-diff-model",
        outputRoot: ".ai-runs/minimax-h3-experiments",
        targetHost: "render-worker-01",
        gpuUuid: "GPU-12345678-1234-1234-1234-123456789abc",
        comfyUiDir: "/opt/comfyui",
        pythonPath: "/usr/bin/python3",
        inputManifestPath: "manifest-i2v.json",
        samplingRecipe: "fl2va-turbo-8"
      });

      const tamperedDesc = structuredClone(descriptor as MinimaxH3ExperimentDescriptorV2);
      tamperedDesc.samplingRecipe!.diffusionModel.filename = "tampered_checkpoint.safetensors";
      store.descriptor = tamperedDesc;

      const validation = await service.validateExperiment(runDir, {
        outputRoot: ".ai-runs/minimax-h3-experiments"
      });
      expect(validation.ok).toBe(false);
      expect(
        validation.errors.some(
          (e) =>
            e.toLowerCase().includes("diffusionmodel") ||
            e.toLowerCase().includes("diffusion model") ||
            e.toLowerCase().includes("digest mismatch") ||
            e.includes("Descriptor validation failed")
        )
      ).toBe(true);
    });

    it("detects tampered descriptor expectedSteps", async () => {
      const store = createRealTemplateStore();
      const service = new MinimaxH3ExperimentService(store);

      const { runDir, descriptor } = await service.prepareExperiment({
        route: "i2v",
        frames: 124,
        seed: 42,
        prompt: "A test prompt",
        operatorLabel: "operator-01",
        runId: "run-tamper-steps",
        outputRoot: ".ai-runs/minimax-h3-experiments",
        targetHost: "render-worker-01",
        gpuUuid: "GPU-12345678-1234-1234-1234-123456789abc",
        comfyUiDir: "/opt/comfyui",
        pythonPath: "/usr/bin/python3",
        inputManifestPath: "manifest-i2v.json",
        samplingRecipe: "fl2va-turbo-8"
      });

      const tamperedDesc = structuredClone(descriptor as MinimaxH3ExperimentDescriptorV2);
      tamperedDesc.samplingRecipe!.expectedSteps = 4;
      store.descriptor = tamperedDesc;

      const validation = await service.validateExperiment(runDir, {
        outputRoot: ".ai-runs/minimax-h3-experiments"
      });
      expect(validation.ok).toBe(false);
      expect(
        validation.errors.some(
          (e) =>
            e.toLowerCase().includes("expectedsteps") ||
            e.toLowerCase().includes("digest mismatch") ||
            e.includes("Descriptor validation failed")
        )
      ).toBe(true);
    });

    it("detects tampered descriptor LoRA strength", async () => {
      const store = createRealTemplateStore();
      const service = new MinimaxH3ExperimentService(store);

      const { runDir, descriptor } = await service.prepareExperiment({
        route: "i2v",
        frames: 124,
        seed: 42,
        prompt: "A test prompt",
        operatorLabel: "operator-01",
        runId: "run-tamper-lora-strength",
        outputRoot: ".ai-runs/minimax-h3-experiments",
        targetHost: "render-worker-01",
        gpuUuid: "GPU-12345678-1234-1234-1234-123456789abc",
        comfyUiDir: "/opt/comfyui",
        pythonPath: "/usr/bin/python3",
        inputManifestPath: "manifest-i2v.json",
        samplingRecipe: "fl2va-turbo-8"
      });

      const tamperedDesc = structuredClone(descriptor as MinimaxH3ExperimentDescriptorV2);
      tamperedDesc.samplingRecipe!.lora!.strengthModel = 0.5;
      store.descriptor = tamperedDesc;

      const validation = await service.validateExperiment(runDir, {
        outputRoot: ".ai-runs/minimax-h3-experiments"
      });
      expect(validation.ok).toBe(false);
      expect(
        validation.errors.some(
          (e) =>
            e.toLowerCase().includes("lora") ||
            e.toLowerCase().includes("digest mismatch") ||
            e.includes("Descriptor validation failed")
        )
      ).toBe(true);
    });

    it("detects tampered descriptor sigmaShift parameters", async () => {
      const store = createRealTemplateStore();
      const service = new MinimaxH3ExperimentService(store);

      const { runDir, descriptor } = await service.prepareExperiment({
        route: "i2v",
        frames: 124,
        seed: 42,
        prompt: "A test prompt",
        operatorLabel: "operator-01",
        runId: "run-tamper-sigmashift",
        outputRoot: ".ai-runs/minimax-h3-experiments",
        targetHost: "render-worker-01",
        gpuUuid: "GPU-12345678-1234-1234-1234-123456789abc",
        comfyUiDir: "/opt/comfyui",
        pythonPath: "/usr/bin/python3",
        inputManifestPath: "manifest-i2v.json",
        samplingRecipe: "fasth3-i2v-8"
      });

      const tamperedDesc = structuredClone(descriptor as MinimaxH3ExperimentDescriptorV2);
      tamperedDesc.samplingRecipe!.sigmaShift!.videoShift = 2.0;
      store.descriptor = tamperedDesc;

      const validation = await service.validateExperiment(runDir, {
        outputRoot: ".ai-runs/minimax-h3-experiments"
      });
      expect(validation.ok).toBe(false);
      expect(
        validation.errors.some(
          (e) =>
            e.toLowerCase().includes("sigmashift") ||
            e.toLowerCase().includes("digest mismatch") ||
            e.includes("Descriptor validation failed")
        )
      ).toBe(true);
    });

    it("detects tampered descriptor requiredRuntime coreRevision", async () => {
      const store = createRealTemplateStore();
      const service = new MinimaxH3ExperimentService(store);

      const { runDir, descriptor } = await service.prepareExperiment({
        route: "i2v",
        frames: 124,
        seed: 42,
        prompt: "A test prompt",
        operatorLabel: "operator-01",
        runId: "run-tamper-core-rev",
        outputRoot: ".ai-runs/minimax-h3-experiments",
        targetHost: "render-worker-01",
        gpuUuid: "GPU-12345678-1234-1234-1234-123456789abc",
        comfyUiDir: "/opt/comfyui",
        pythonPath: "/usr/bin/python3",
        inputManifestPath: "manifest-i2v.json",
        samplingRecipe: "fasth3-i2v-8"
      });

      const tamperedDesc = structuredClone(descriptor as MinimaxH3ExperimentDescriptorV2);
      tamperedDesc.requiredRuntime!.coreRevision = "55b6a9b11dffecdd65a3ccd5eb6a1b3a178c96dc";
      store.descriptor = tamperedDesc;

      const validation = await service.validateExperiment(runDir, {
        outputRoot: ".ai-runs/minimax-h3-experiments"
      });
      expect(validation.ok).toBe(false);
      expect(
        validation.errors.some(
          (e) => e.includes("coreRevision") || e.includes("Descriptor validation failed")
        )
      ).toBe(true);
    });

    it("detects bypassed LoRA node 301 in workflow config", async () => {
      const store = createRealTemplateStore();
      const service = new MinimaxH3ExperimentService(store);

      const { runDir } = await service.prepareExperiment({
        route: "i2v",
        frames: 124,
        seed: 42,
        prompt: "A test prompt",
        operatorLabel: "operator-01",
        runId: "run-tamper-bypass-lora",
        outputRoot: ".ai-runs/minimax-h3-experiments",
        targetHost: "render-worker-01",
        gpuUuid: "GPU-12345678-1234-1234-1234-123456789abc",
        comfyUiDir: "/opt/comfyui",
        pythonPath: "/usr/bin/python3",
        inputManifestPath: "manifest-i2v.json",
        samplingRecipe: "fl2va-turbo-8"
      });

      // Rewire node 16 model input directly to node 6, bypassing node 301 LoRA
      const tamperedConfig = structuredClone(store.config!);
      (tamperedConfig["16"] as { inputs: { model: unknown } }).inputs.model = ["6", 0];
      store.config = tamperedConfig;

      const validation = await service.validateExperiment(runDir, {
        outputRoot: ".ai-runs/minimax-h3-experiments"
      });
      expect(validation.ok).toBe(false);
      expect(
        validation.errors.some(
          (e) =>
            e.includes("Config.json on disk does not match") ||
            e.includes("guider model connection")
        )
      ).toBe(true);
    });

    it("detects altered scheduler steps in workflow config", async () => {
      const store = createRealTemplateStore();
      const service = new MinimaxH3ExperimentService(store);

      const { runDir } = await service.prepareExperiment({
        route: "i2v",
        frames: 124,
        seed: 42,
        prompt: "A test prompt",
        operatorLabel: "operator-01",
        runId: "run-tamper-config-steps",
        outputRoot: ".ai-runs/minimax-h3-experiments",
        targetHost: "render-worker-01",
        gpuUuid: "GPU-12345678-1234-1234-1234-123456789abc",
        comfyUiDir: "/opt/comfyui",
        pythonPath: "/usr/bin/python3",
        inputManifestPath: "manifest-i2v.json",
        samplingRecipe: "fl2va-turbo-8"
      });

      // Change node 9 steps from 8 to 20
      const tamperedConfig = structuredClone(store.config!);
      (tamperedConfig["9"] as { inputs: { steps: number } }).inputs.steps = 20;
      store.config = tamperedConfig;

      const validation = await service.validateExperiment(runDir, {
        outputRoot: ".ai-runs/minimax-h3-experiments"
      });
      expect(validation.ok).toBe(false);
      expect(
        validation.errors.some(
          (e) => e.includes("Config.json on disk does not match") || e.includes("scheduler steps")
        )
      ).toBe(true);
    });

    it("detects altered UNETLoader unet_name in workflow config", async () => {
      const store = createRealTemplateStore();
      const service = new MinimaxH3ExperimentService(store);

      const { runDir } = await service.prepareExperiment({
        route: "i2v",
        frames: 124,
        seed: 42,
        prompt: "A test prompt",
        operatorLabel: "operator-01",
        runId: "run-tamper-config-unet",
        outputRoot: ".ai-runs/minimax-h3-experiments",
        targetHost: "render-worker-01",
        gpuUuid: "GPU-12345678-1234-1234-1234-123456789abc",
        comfyUiDir: "/opt/comfyui",
        pythonPath: "/usr/bin/python3",
        inputManifestPath: "manifest-i2v.json",
        samplingRecipe: "fl2va-turbo-8"
      });

      // Change node 6 unet_name to something else
      const tamperedConfig = structuredClone(store.config!);
      (tamperedConfig["6"] as { inputs: { unet_name: string } }).inputs.unet_name =
        "nonexistent_unet.safetensors";
      store.config = tamperedConfig;

      const validation = await service.validateExperiment(runDir, {
        outputRoot: ".ai-runs/minimax-h3-experiments"
      });
      expect(validation.ok).toBe(false);
      expect(
        validation.errors.some(
          (e) => e.includes("Config.json on disk does not match") || e.includes("unet_name")
        )
      ).toBe(true);
    });

    it("detects removed SigmaShift node in FastH3 workflow config", async () => {
      const store = createRealTemplateStore();
      const service = new MinimaxH3ExperimentService(store);

      const { runDir } = await service.prepareExperiment({
        route: "i2v",
        frames: 124,
        seed: 42,
        prompt: "A test prompt",
        operatorLabel: "operator-01",
        runId: "run-tamper-remove-sigmashift",
        outputRoot: ".ai-runs/minimax-h3-experiments",
        targetHost: "render-worker-01",
        gpuUuid: "GPU-12345678-1234-1234-1234-123456789abc",
        comfyUiDir: "/opt/comfyui",
        pythonPath: "/usr/bin/python3",
        inputManifestPath: "manifest-i2v.json",
        samplingRecipe: "fasth3-i2v-8"
      });

      // Delete node 301 (MiniMaxH3SigmaShift) and rewire node 302 model input back to node 6
      const tamperedConfig = structuredClone(store.config!);
      delete tamperedConfig["301"];
      (tamperedConfig["302"] as { inputs: { model: unknown } }).inputs.model = ["6", 0];
      store.config = tamperedConfig;

      const validation = await service.validateExperiment(runDir, {
        outputRoot: ".ai-runs/minimax-h3-experiments"
      });
      expect(validation.ok).toBe(false);
      expect(
        validation.errors.some(
          (e) =>
            e.includes("Config.json on disk does not match") || e.includes("MiniMaxH3SigmaShift")
        )
      ).toBe(true);
    });
  });
});
