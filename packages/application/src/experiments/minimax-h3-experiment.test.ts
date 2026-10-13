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
import type {
  MinimaxH3ExperimentDescriptor,
  MinimaxH3ExperimentIntent,
  MinimaxH3ExperimentReceipt,
  MinimaxH3ExperimentResult,
  MinimaxH3ProcessRecord,
  MinimaxH3TelemetrySample,
  MinimaxH3TerminalEvidence
} from "@cco/contracts";
import type {
  MinimaxH3ExperimentStorePort,
  MinimaxH3ComfyUiTransportPort,
  MinimaxH3OutputProberPort
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
  public descriptor: MinimaxH3ExperimentDescriptor | null = null;
  public config: Record<string, unknown> | null = null;
  public inputManifest: unknown = null;
  public measurementTemplate: MinimaxH3ExperimentResult | null = null;
  public intent: MinimaxH3ExperimentIntent | null = null;
  public receipt: MinimaxH3ExperimentReceipt | null = null;
  public events: Array<{ timestamp: string; event: string; details?: unknown }> = [];
  public telemetry: MinimaxH3TelemetrySample[] = [];
  public result: MinimaxH3ExperimentResult | null = null;

  async writeDescriptor(_runDir: string, descriptor: MinimaxH3ExperimentDescriptor): Promise<void> {
    this.descriptor = descriptor;
  }
  async readDescriptor(_runDir: string): Promise<MinimaxH3ExperimentDescriptor> {
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
    template: MinimaxH3ExperimentResult
  ): Promise<void> {
    this.measurementTemplate = template;
  }
  async readMeasurementTemplate(_runDir: string): Promise<MinimaxH3ExperimentResult | null> {
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
  async writeResult(_runDir: string, result: MinimaxH3ExperimentResult): Promise<void> {
    this.result = result;
  }
  async readResult(_runDir: string): Promise<MinimaxH3ExperimentResult | null> {
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
