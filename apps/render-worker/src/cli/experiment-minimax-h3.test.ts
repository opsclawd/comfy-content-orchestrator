import { basename, isAbsolute, relative, resolve } from "node:path";
import fs from "node:fs";
import path from "node:path";
import { execSync } from "node:child_process";
import { describe, expect, it, beforeAll, afterAll } from "vitest";
import {
  runExperimentCli,
  parseArgs,
  type ExperimentCliDependencies
} from "./experiment-minimax-h3.js";
import {
  MinimaxH3ExperimentService,
  canonicalizeJson,
  sha256Hex,
  getAttentionCatalogEntry,
  expandContinuityStudyPlan,
  type MinimaxH3ComfyUiTransportPort,
  type MinimaxH3ExperimentStorePort,
  type MinimaxH3OutputProberPort,
  type MinimaxH3ProcessRunnerPort,
  type MinimaxH3TargetPreflightPort,
  type MinimaxH3TelemetrySamplerPort
} from "@cco/application";
import {
  PINNED_COMFYUI_CORE_REVISION,
  buildRequiredRuntimeManifestFromAttentionCatalog,
  computeContinuityReferenceManifestDigest,
  computeContinuityReviewDigest,
  computeContinuityRubricDigest,
  computeContinuityStudyDigest,
  type MinimaxH3ExperimentEvent,
  type MinimaxH3ExperimentIntent,
  type MinimaxH3ExperimentReceipt,
  type MinimaxH3ExperimentResult,
  type MinimaxH3TelemetrySample,
  type MinimaxH3AnyExperimentDescriptor,
  type MinimaxH3AnyExperimentResult,
  type MinimaxH3ContinuityReviewSidecar,
  type ContinuityScenario
} from "@cco/contracts";
import {
  CurrentPinExperimentRuntimeAdapter,
  IsolatedUpgradeExperimentRuntimeAdapter,
  ExperimentRuntimeRegistry
} from "@cco/infrastructure";

const mockI2vTemplate = {
  "6": {
    class_type: "UNETLoader",
    inputs: { unet_name: "minimax_h3_ref2va_pruned_int8_convrot.safetensors" }
  },
  "9": {
    class_type: "BasicScheduler",
    inputs: { model: ["6", 0], scheduler: "simple", steps: 20 }
  },
  "14": {
    class_type: "SamplerCustomAdvanced",
    inputs: { guider: ["16", 0], sigmas: ["9", 0], latent_image: ["104", 1] }
  },
  "15": { class_type: "RandomNoise", inputs: { noise_seed: 0 } },
  "16": {
    class_type: "BasicGuider",
    inputs: { model: ["6", 0], conditioning: ["104", 0] }
  },
  "20": { class_type: "LoadImage", inputs: { image: "ref.png" } },
  "92": { class_type: "SaveVideo", inputs: { filename_prefix: "minimax_h3_720p_i2v_124f" } },
  "104": {
    class_type: "MiniMaxH3ImageToVideo",
    inputs: { length: 124, width: 1344, height: 768, prompt: "base", first_frame: ["20", 0] }
  }
};

class MockStore implements MinimaxH3ExperimentStorePort {
  public files = new Map<string, string>();
  public descriptor: MinimaxH3AnyExperimentDescriptor | null = null;
  public config: Record<string, unknown> | null = null;
  public intent: MinimaxH3ExperimentIntent | null = null;
  public receipt: MinimaxH3ExperimentReceipt | null = null;
  public result: MinimaxH3AnyExperimentResult | null = null;

  public measurementTemplate: MinimaxH3ExperimentResult | null = null;

  async createRunDirectory(_runDir: string): Promise<void> {}
  async ensureRunSubdirectories(_runDir: string): Promise<void> {}
  async writeProcessRecord(): Promise<void> {}
  async readProcessRecord(): Promise<null> {
    return null;
  }
  async writeTerminalEvidence(): Promise<void> {}
  async readTerminalEvidence(): Promise<null> {
    return null;
  }
  public customDimensions = new Map<string, { width: number; height: number; mimeType: string }>();
  async inspectAsset(
    filePath: string
  ): Promise<{ width: number; height: number; mimeType: string }> {
    return (
      this.customDimensions.get(filePath) ?? { width: 1024, height: 585, mimeType: "image/jpeg" }
    );
  }
  public deleteRunFilesCalls: Array<{ runDir: string; removeOutputs?: boolean | undefined }> = [];
  async deleteRunFiles(runDir: string, removeOutputs?: boolean): Promise<void> {
    this.deleteRunFilesCalls.push({ runDir, removeOutputs });
  }

  public descriptorsByRunDir = new Map<string, MinimaxH3AnyExperimentDescriptor>();
  public resultsByRunDir = new Map<string, MinimaxH3AnyExperimentResult>();
  public configsByRunDir = new Map<string, Record<string, unknown>>();

  async writeDescriptor(
    runDir: string,
    descriptor: MinimaxH3AnyExperimentDescriptor
  ): Promise<void> {
    this.descriptor = descriptor;
    this.descriptorsByRunDir.set(runDir, descriptor);
    this.descriptorsByRunDir.set(basename(runDir), descriptor);
  }
  async readDescriptor(runDir?: string): Promise<MinimaxH3AnyExperimentDescriptor> {
    if (runDir && this.descriptorsByRunDir.has(runDir)) {
      return this.descriptorsByRunDir.get(runDir)!;
    }
    if (runDir && this.descriptorsByRunDir.has(basename(runDir))) {
      return this.descriptorsByRunDir.get(basename(runDir))!;
    }
    if (!this.descriptor) throw new Error("Descriptor not found");
    return this.descriptor;
  }
  async writeConfig(runDir: string, config: Record<string, unknown>): Promise<string> {
    this.config = config;
    this.configsByRunDir.set(runDir, config);
    this.configsByRunDir.set(basename(runDir), config);
    return "c".repeat(64);
  }
  async readConfig(runDir?: string): Promise<Record<string, unknown>> {
    if (runDir && this.configsByRunDir.has(runDir)) {
      return this.configsByRunDir.get(runDir)!;
    }
    if (runDir && this.configsByRunDir.has(basename(runDir))) {
      return this.configsByRunDir.get(basename(runDir))!;
    }
    if (!this.config) throw new Error("Config not found");
    return this.config;
  }
  public inputManifest: unknown = null;
  async writeInputManifest(_runDir: string, manifest: unknown): Promise<void> {
    this.inputManifest = manifest;
  }
  async readInputManifest(): Promise<unknown> {
    return this.inputManifest;
  }
  async writeMeasurementTemplate(
    _runDir: string,
    template: MinimaxH3ExperimentResult
  ): Promise<void> {
    this.measurementTemplate = template;
  }
  async readMeasurementTemplate(): Promise<MinimaxH3ExperimentResult | null> {
    return this.measurementTemplate;
  }
  async writeIntent(_runDir: string, intent: MinimaxH3ExperimentIntent): Promise<void> {
    this.intent = intent;
  }
  async readIntent(): Promise<MinimaxH3ExperimentIntent | null> {
    return this.intent;
  }
  async writeReceipt(_runDir: string, receipt: MinimaxH3ExperimentReceipt): Promise<void> {
    this.receipt = receipt;
  }
  async readReceipt(): Promise<MinimaxH3ExperimentReceipt | null> {
    return this.receipt;
  }
  async appendEvent(): Promise<void> {}
  async readEvents(): Promise<MinimaxH3ExperimentEvent[]> {
    return [];
  }
  async appendTelemetry(): Promise<void> {}
  async readTelemetry(): Promise<MinimaxH3TelemetrySample[]> {
    return [];
  }
  async writeResult(runDir: string, result: MinimaxH3AnyExperimentResult): Promise<void> {
    this.result = result;
    this.resultsByRunDir.set(runDir, result);
    this.resultsByRunDir.set(basename(runDir), result);
  }
  async readResult(runDir?: string): Promise<MinimaxH3AnyExperimentResult | null> {
    if (runDir && this.resultsByRunDir.has(runDir)) {
      return this.resultsByRunDir.get(runDir)!;
    }
    if (runDir && this.resultsByRunDir.has(basename(runDir))) {
      return this.resultsByRunDir.get(basename(runDir))!;
    }
    return this.result;
  }
  verifyContainment(targetPath: string, rootDir: string): boolean {
    const resolvedTarget = resolve(targetPath);
    const resolvedRoot = resolve(rootDir);
    const rel = relative(resolvedRoot, resolvedTarget);
    return !rel.startsWith("..") && !isAbsolute(rel);
  }
  async stageInputFile(): Promise<void> {}
  fileHashes = new Map<string, { sha256: string; sizeBytes: number }>();
  async hashFile(filePath?: string): Promise<{ sha256: string; sizeBytes: number }> {
    if (filePath) {
      if (this.fileHashes.has(filePath)) {
        return this.fileHashes.get(filePath)!;
      }
      if (this.fileHashes.has(basename(filePath))) {
        return this.fileHashes.get(basename(filePath))!;
      }
      const content =
        this.files.get(filePath) ??
        this.files.get(basename(filePath)) ??
        this.files.get(`templates/${basename(filePath)}`);
      if (content) {
        return { sha256: sha256Hex(content), sizeBytes: Buffer.byteLength(content) };
      }
    }
    return { sha256: "0".repeat(64), sizeBytes: 1024 };
  }
  async readJsonFile<T = unknown>(filePath: string): Promise<T> {
    const content =
      this.files.get(filePath) ??
      this.files.get(basename(filePath)) ??
      this.files.get(`templates/${basename(filePath)}`);
    if (!content) throw new Error(`Not found: ${filePath}`);
    return JSON.parse(content);
  }
  async readTextFile(filePath: string): Promise<string> {
    const content =
      this.files.get(filePath) ??
      this.files.get(basename(filePath)) ??
      this.files.get(`templates/${basename(filePath)}`);
    if (!content) throw new Error(`Not found: ${filePath}`);
    return content;
  }
  async writeDurableJson(filePath: string, content: unknown): Promise<void> {
    this.files.set(filePath, JSON.stringify(content));
  }
  async writeTextFile(filePath: string, content: string): Promise<void> {
    this.files.set(filePath, content);
  }
}

function createMockDeps(): {
  deps: ExperimentCliDependencies;
  stdout: string[];
  stderr: string[];
  store: MockStore;
} {
  const stdout: string[] = [];
  const stderr: string[] = [];
  const store = new MockStore();
  store.files.set(
    "operator-stop-policy.json",
    JSON.stringify({
      policyId: "synthetic-test-policy",
      maxPeakVramMb: 24000,
      maxHostRamMb: 32000,
      maxSwapUsedMb: 4096,
      maxSwapDeltaMb: 2048,
      maxExecutionDurationMs: 1200000,
      requireCompleteTelemetry: true,
      requireConformantProbe: true,
      visualStopConditions: []
    })
  );

  store.files.set("templates/minimax_h3_720p_i2v_124f_api.json", JSON.stringify(mockI2vTemplate));
  // A real expectedWorkflowHash entry, not an empty profiles array — the
  // service now fails closed when provenance.json has no matching entry
  // for the template (see minimax-h3-experiment.test.ts for the dedicated
  // regression test of that behavior).
  store.files.set(
    "templates/provenance.json",
    JSON.stringify({
      version: 1,
      profiles: [
        {
          workflowRelativePath: "minimax_h3_720p_i2v_124f_api.json",
          expectedWorkflowHash: sha256Hex(canonicalizeJson(mockI2vTemplate))
        }
      ]
    })
  );
  store.files.set(
    "inputs.json",
    JSON.stringify({
      references: [
        {
          assetPath: "/tmp/ref.png",
          stagedFilename: "ref.png"
        }
      ]
    })
  );

  const preflight: MinimaxH3TargetPreflightPort = {
    checkTargetHost: async () => ({ ok: true }),
    acquireGpuLock: async () => ({ acquired: true, release: async () => {} }),
    checkPortAvailable: async () => ({ ok: true }),
    verifyCheckout: async () => ({
      ok: true,
      revision: "55b6a9b11dffecdd65a3ccd5eb6a1b3a178c96dc",
      nodesPresent: true
    }),
    verifyModels: async () => ({ ok: true, resolvedPaths: {} }),
    verifyDiskSpace: async () => ({ ok: true, freeGb: 100 })
  };

  const runner: MinimaxH3ProcessRunnerPort = {
    spawnChild: async () => ({
      pid: 12345,
      startTimeTicks: 100,
      address: "127.0.0.1",
      port: 8199,
      gpuUuid: "GPU-12345678-1234-1234-1234-123456789abc",
      getStdout: () => "[aimdo] Dynamic VRAM enabled",
      getStderr: () => "",
      isRunning: () => true,
      stop: async () => {},
      verifySocketOwnership: async () => ({ ok: true }),
      verifyChildEnvironment: async () => ({ ok: true })
    })
  };

  const transport: MinimaxH3ComfyUiTransportPort = {
    waitForReadiness: async () => ({ ok: true }),
    submitPrompt: async () => ({ ok: true, promptId: "prompt-cli-1" }),
    pollPromptHistory: async () => ({
      status: "completed",
      outputFilename: "output.mp4",
      rawHistory: { status: "success" }
    }),
    getQueue: async () => ({ running: [], pending: [] }),
    findPromptByWorkflowDigestOrClient: async () => null
  };

  const telemetry: MinimaxH3TelemetrySamplerPort = {
    start: () => ({
      stop: async () => {},
      setPhase: () => {}
    })
  };

  const prober: MinimaxH3OutputProberPort = {
    probeOutput: async (filePath) => ({
      status: "succeeded",
      outputFile: filePath,
      outputSha256: "d".repeat(64),
      outputSizeBytes: 1000000,
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
      toolIdentity: { ffprobePath: "/usr/bin/ffprobe" },
      errors: []
    })
  };

  const service = new MinimaxH3ExperimentService(
    store,
    preflight,
    runner,
    transport,
    telemetry,
    prober
  );

  const deps = {
    store,
    preflight,
    runner,
    transport,
    telemetry,
    prober,
    service,
    stdout: (msg: string) => stdout.push(msg),
    stderr: (msg: string) => stderr.push(msg)
  };

  return { deps, stdout, stderr, store };
}

describe("CLI argument parsing", () => {
  it("parses subcommands and flags correctly", () => {
    const { subcommand, flags, booleanFlags } = parseArgs([
      "prepare",
      "--route",
      "i2v",
      "--frames=124",
      "--keep-outputs"
    ]);

    expect(subcommand).toBe("prepare");
    expect(flags["route"]).toBe("i2v");
    expect(flags["frames"]).toBe("124");
    expect(booleanFlags.has("keep-outputs")).toBe(true);
  });
});

describe("experiment:minimax-h3 CLI", () => {
  it("prints help on --help or -h and exits with code 0", async () => {
    const { deps, stdout } = createMockDeps();

    const code = await runExperimentCli(["--help"], deps);
    expect(code).toBe(0);
    expect(stdout.some((line) => line.includes("Isolated Variable-Frame MiniMax-H3"))).toBe(true);
  });

  it("handles prepare subcommand successfully", async () => {
    const { deps, stdout } = createMockDeps();

    const code = await runExperimentCli(
      [
        "prepare",
        "--route",
        "i2v",
        "--frames",
        "124",
        "--seed",
        "42",
        "--inputs",
        "inputs.json",
        "--prompt",
        "A sunset",
        "--target-host",
        "render-worker-01",
        "--gpu-uuid",
        "GPU-12345678-1234-1234-1234-123456789abc",
        "--comfyui-dir",
        "/opt/comfyui",
        "--python",
        "/usr/bin/python3",
        "--run-id",
        "run-cli-test-01",
        "--output-root",
        ".ai-runs/minimax-h3-experiments"
      ],
      deps
    );
    expect(code).toBe(0);
    const output = JSON.parse(stdout[0]!);
    expect(output.status).toBe("prepared");
    expect(output.runId).toBe("run-cli-test-01");
  });

  it("handles validate subcommand successfully", async () => {
    const { deps, stdout } = createMockDeps();

    // First prepare
    await runExperimentCli(
      [
        "prepare",
        "--route",
        "i2v",
        "--frames",
        "124",
        "--seed",
        "42",
        "--inputs",
        "inputs.json",
        "--prompt",
        "A sunset",
        "--target-host",
        "render-worker-01",
        "--gpu-uuid",
        "GPU-12345678-1234-1234-1234-123456789abc",
        "--comfyui-dir",
        "/opt/comfyui",
        "--python",
        "/usr/bin/python3",
        "--run-id",
        "run-cli-test-01",
        "--output-root",
        ".ai-runs/minimax-h3-experiments"
      ],
      deps
    );

    const prepareOutput = JSON.parse(stdout[0]!);
    stdout.length = 0;

    const code = await runExperimentCli(
      [
        "validate",
        "--run-dir",
        prepareOutput.runDir,
        "--output-root",
        ".ai-runs/minimax-h3-experiments"
      ],
      deps
    );
    expect(code).toBe(0);
    const validateOutput = JSON.parse(stdout[0]!);
    expect(validateOutput.status).toBe("valid");
    expect(validateOutput.configuredFrames).toBe(124);
  });

  it("handles run subcommand and produces result", async () => {
    const { deps, stdout } = createMockDeps();

    // Prepare
    await runExperimentCli(
      [
        "prepare",
        "--route",
        "i2v",
        "--frames",
        "124",
        "--seed",
        "42",
        "--inputs",
        "inputs.json",
        "--prompt",
        "A sunset",
        "--target-host",
        "render-worker-01",
        "--gpu-uuid",
        "GPU-12345678-1234-1234-1234-123456789abc",
        "--comfyui-dir",
        "/opt/comfyui",
        "--python",
        "/usr/bin/python3",
        "--run-id",
        "run-cli-exec-01",
        "--output-root",
        ".ai-runs/minimax-h3-experiments"
      ],
      deps
    );

    const prepareOutput = JSON.parse(stdout[0]!);
    stdout.length = 0;

    const code = await runExperimentCli(
      [
        "run",
        "--run-dir",
        prepareOutput.runDir,
        "--output-root",
        ".ai-runs/minimax-h3-experiments",
        "--stop-policy",
        "operator-stop-policy.json"
      ],
      deps
    );
    expect(code).toBe(0);
    const runResult = JSON.parse(stdout[0]!);
    expect(runResult.execution.status).toBe("completed");
  });

  it("handles reconcile subcommand", async () => {
    const { deps, stdout } = createMockDeps();

    // Prepare
    await runExperimentCli(
      [
        "prepare",
        "--route",
        "i2v",
        "--frames",
        "124",
        "--seed",
        "42",
        "--inputs",
        "inputs.json",
        "--prompt",
        "A sunset",
        "--target-host",
        "render-worker-01",
        "--gpu-uuid",
        "GPU-12345678-1234-1234-1234-123456789abc",
        "--comfyui-dir",
        "/opt/comfyui",
        "--python",
        "/usr/bin/python3",
        "--run-id",
        "run-cli-reconcile-01",
        "--output-root",
        ".ai-runs/minimax-h3-experiments"
      ],
      deps
    );

    const prepareOutput = JSON.parse(stdout[0]!);
    stdout.length = 0;

    const code = await runExperimentCli(
      [
        "reconcile",
        "--run-dir",
        prepareOutput.runDir,
        "--output-root",
        ".ai-runs/minimax-h3-experiments"
      ],
      deps
    );
    expect(code).toBe(0);
    const result = JSON.parse(stdout[0]!);
    expect(result.runId).toBe("run-cli-reconcile-01");
  });

  it("handles cleanup subcommand", async () => {
    const { deps, stdout } = createMockDeps();

    // Prepare
    await runExperimentCli(
      [
        "prepare",
        "--route",
        "i2v",
        "--frames",
        "124",
        "--seed",
        "42",
        "--inputs",
        "inputs.json",
        "--prompt",
        "A sunset",
        "--target-host",
        "render-worker-01",
        "--gpu-uuid",
        "GPU-12345678-1234-1234-1234-123456789abc",
        "--comfyui-dir",
        "/opt/comfyui",
        "--python",
        "/usr/bin/python3",
        "--run-id",
        "run-cli-cleanup-01",
        "--output-root",
        ".ai-runs/minimax-h3-experiments"
      ],
      deps
    );

    const prepareOutput = JSON.parse(stdout[0]!);
    stdout.length = 0;

    const code = await runExperimentCli(
      [
        "cleanup",
        "--run-dir",
        prepareOutput.runDir,
        "--output-root",
        ".ai-runs/minimax-h3-experiments"
      ],
      deps
    );
    expect(code).toBe(0);
    const result = JSON.parse(stdout[0]!);
    expect(result.status).toBe("cleaned");
  });

  it("rejects cleanup when --run-dir matches --output-root", async () => {
    const { deps, stderr } = createMockDeps();

    const code = await runExperimentCli(
      [
        "cleanup",
        "--run-dir",
        ".ai-runs/minimax-h3-experiments",
        "--output-root",
        ".ai-runs/minimax-h3-experiments"
      ],
      deps
    );
    expect(code).toBe(1);
    expect(stderr.some((line) => line.includes("--run-dir cannot be the output root"))).toBe(true);
  });

  it("rejects cleanup when --run-dir violates containment", async () => {
    const { deps, stderr } = createMockDeps();

    const code = await runExperimentCli(
      [
        "cleanup",
        "--run-dir",
        "/outside/minimax-run",
        "--output-root",
        ".ai-runs/minimax-h3-experiments"
      ],
      deps
    );
    expect(code).toBe(1);
    expect(stderr.some((line) => line.includes("violates containment within output root"))).toBe(
      true
    );
  });

  it("rejects cleanup when descriptor is missing or unreadable", async () => {
    const { deps, stderr, store } = createMockDeps();
    store.descriptor = null;

    const code = await runExperimentCli(
      [
        "cleanup",
        "--run-dir",
        ".ai-runs/minimax-h3-experiments/non-existent-run",
        "--output-root",
        ".ai-runs/minimax-h3-experiments"
      ],
      deps
    );
    expect(code).toBe(1);
    expect(
      stderr.some((line) =>
        line.includes("Cannot clean up run directory with missing or unreadable descriptor")
      )
    ).toBe(true);
  });

  it("handles validate-sidecar subcommand", async () => {
    const { deps, stdout, store } = createMockDeps();

    store.files.set(
      "review.json",
      JSON.stringify({
        schemaVersion: 1,
        runId: "run-cli-test-01",
        route: "i2v",
        configuredFrames: 124,
        outputSha256: "0".repeat(64),
        status: "reviewed",
        reviewer: "reviewer-1",
        reviewedAt: new Date().toISOString(),
        findings: {
          continuity: "pass",
          identityFidelity: "pass",
          visualDegradation: "pass"
        },
        notes: "Looks clear",
        unavailableReason: null
      })
    );

    const code = await runExperimentCli(
      [
        "validate-sidecar",
        "--file",
        "review.json",
        "--output-root",
        ".ai-runs/minimax-h3-experiments"
      ],
      deps
    );
    expect(code).toBe(0);
    const result = JSON.parse(stdout[0]!);
    expect(result.status).toBe("valid");
    expect(result.sidecarType).toBe("visual_review");
  });

  it("returns exit code 1 on missing required flags, duplicates, or positional args", async () => {
    const { deps, stderr } = createMockDeps();

    const code1 = await runExperimentCli(["unknown-subcommand"], deps);
    expect(code1).toBe(1);
    expect(stderr.some((line) => line.includes("Unknown subcommand"))).toBe(true);

    stderr.length = 0;
    const codeMissingOutputRoot = await runExperimentCli(["prepare", "--route", "i2v"], deps);
    expect(codeMissingOutputRoot).toBe(1);
    expect(stderr.some((line) => line.includes("--output-root is required"))).toBe(true);

    stderr.length = 0;
    const code2 = await runExperimentCli(
      ["prepare", "--route", "i2v", "--output-root", ".ai-runs/minimax-h3-experiments"],
      deps
    );
    expect(code2).toBe(1);
    expect(stderr.some((line) => line.includes("Missing or invalid required flags"))).toBe(true);

    stderr.length = 0;
    const code3 = await runExperimentCli(
      [
        "prepare",
        "--route",
        "i2v",
        "--trim",
        "--frames",
        "124",
        "--output-root",
        ".ai-runs/minimax-h3-experiments"
      ],
      deps
    );
    expect(code3).toBe(1);
    expect(stderr.some((line) => line.includes('Unknown or unsupported flag "--trim"'))).toBe(true);

    stderr.length = 0;
    const code4 = await runExperimentCli(
      [
        "prepare",
        "--route",
        "i2v",
        "--frames",
        "124.9",
        "--seed",
        "42",
        "--inputs",
        "inputs.json",
        "--prompt",
        "A sunset",
        "--target-host",
        "render-worker-01",
        "--gpu-uuid",
        "GPU-12345678-1234-1234-1234-123456789abc",
        "--comfyui-dir",
        "/opt/comfyui",
        "--python",
        "/usr/bin/python3",
        "--run-id",
        "run-decimal",
        "--output-root",
        ".ai-runs/minimax-h3-experiments"
      ],
      deps
    );
    expect(code4).toBe(1);
    expect(stderr.some((line) => line.includes("Missing or invalid required flags"))).toBe(true);

    stderr.length = 0;
    const codePositional = await runExperimentCli(
      [
        "prepare",
        "unexpected-positional-token",
        "--route",
        "i2v",
        "--output-root",
        ".ai-runs/minimax-h3-experiments"
      ],
      deps
    );
    expect(codePositional).toBe(1);
    expect(stderr.some((line) => line.includes("Unexpected positional argument"))).toBe(true);

    stderr.length = 0;
    const codeDuplicate = await runExperimentCli(
      [
        "prepare",
        "--route",
        "i2v",
        "--route",
        "ref2v",
        "--output-root",
        ".ai-runs/minimax-h3-experiments"
      ],
      deps
    );
    expect(codeDuplicate).toBe(1);
    expect(stderr.some((line) => line.includes("Duplicate flag(s) specified"))).toBe(true);

    stderr.length = 0;
    const codeBareValue = await runExperimentCli(["prepare", "--seed"], deps);
    expect(codeBareValue).toBe(1);
    expect(stderr.some((line) => line.includes('Flag "--seed" requires a value'))).toBe(true);

    stderr.length = 0;
    const codeBothPrompts = await runExperimentCli(
      ["prepare", "--prompt", "p1", "--prompt-file", "p2.txt"],
      deps
    );
    expect(codeBothPrompts).toBe(1);
    expect(
      stderr.some((line) => line.includes("Cannot specify both --prompt and --prompt-file"))
    ).toBe(true);
  });

  it("handles import-sidecar subcommand", async () => {
    const { deps, stdout, store } = createMockDeps();

    await runExperimentCli(
      [
        "prepare",
        "--route",
        "i2v",
        "--frames",
        "124",
        "--seed",
        "42",
        "--inputs",
        "inputs.json",
        "--prompt",
        "A test prompt",
        "--target-host",
        "worker-01",
        "--gpu-uuid",
        "GPU-12345678-1234-1234-1234-123456789abc",
        "--comfyui-dir",
        "/opt/comfyui",
        "--python",
        "/usr/bin/python3",
        "--run-id",
        "run-sidecar-import",
        "--output-root",
        ".ai-runs/minimax-h3-experiments"
      ],
      deps
    );

    const prepareOutput = JSON.parse(stdout[0]!);
    const runDir = prepareOutput.runDir;
    stdout.length = 0;

    store.result = {
      schemaVersion: 1,
      runId: "run-sidecar-import",
      descriptorDigest: "0".repeat(64),
      configDigest: "0".repeat(64),
      comparisonKey: "key-1",
      lifecycle: "completed",
      observedRunner: {
        argv: [],
        env: {},
        pid: 1234,
        processStartTimeTicks: 100,
        targetGpuUuid: "GPU-12345678-1234-1234-1234-123456789abc",
        effectiveMode: {
          status: "verified",
          value: "dynamic_vram",
          unknownReason: null,
          evidence: null
        }
      },
      timestamps: {
        preparedAt: new Date().toISOString(),
        startedAt: new Date().toISOString(),
        submittedAt: new Date().toISOString(),
        terminatedAt: new Date().toISOString()
      },
      execution: {
        status: "completed",
        promptId: "prompt-1",
        terminalEvidence: { source: "history", status: "success" },
        engineError: null,
        latencyMs: 10000
      },
      collection: {
        status: "complete",
        phaseCoverage: { before: true, during: true, after: true },
        sampleCount: { attempted: 1, succeeded: 1, failed: 0 },
        metrics: {
          gpuPeakUsedVramMb: 12000,
          gpuAllocatableVramMb: 24000,
          hostPeakRamUsedMb: 16000,
          processPeakRssMb: 8000,
          hostSwapUsedMb: 0,
          hostSwapDeltaMb: 0
        },
        errors: []
      },
      probe: {
        status: "succeeded",
        outputFile: `${runDir}/outputs/video.mp4`,
        outputSha256: "a".repeat(64),
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
          audioCodec: null,
          audioChannels: null,
          audioSampleRate: null
        },
        discrepancyFlags: [],
        toolIdentity: null,
        errors: []
      },
      outputConformance: {
        status: "conformant",
        checks: {
          frameCountMatches: true,
          geometryMatches: true,
          fpsMatches: true,
          timingWithinTolerance: true
        },
        reasons: []
      },
      visualReview: {
        status: "pending",
        outputSha256: null,
        reviewedAt: null,
        reviewer: null,
        findings: null,
        notes: null,
        unavailableReason: null
      },
      operatorDecision: {
        status: "pending",
        operator: null,
        decidedAt: null,
        comparisonKey: null,
        reason: null
      },
      stopRecommendation: { recommended: false, reasons: [] }
    };

    store.files.set(
      "sidecar.json",
      JSON.stringify({
        schemaVersion: 1,
        runId: "run-sidecar-import",
        route: "i2v",
        configuredFrames: 124,
        outputSha256: "a".repeat(64),
        status: "reviewed",
        reviewer: "tester-1",
        reviewedAt: new Date().toISOString(),
        findings: {
          continuity: "pass",
          identityFidelity: "pass",
          visualDegradation: "pass"
        },
        notes: "Flawless rendering",
        unavailableReason: null
      })
    );

    const code = await runExperimentCli(
      [
        "import-sidecar",
        "--run-dir",
        runDir,
        "--sidecar",
        "sidecar.json",
        "--output-root",
        ".ai-runs/minimax-h3-experiments"
      ],
      deps
    );

    expect(code).toBe(0);
    const parsedOut = JSON.parse(stdout[0]!);
    expect(parsedOut.status).toBe("imported");
    expect(store.result!.visualReview.status).toBe("reviewed");
    expect(store.result!.visualReview.reviewer).toBe("tester-1");
  });

  it("validate-sidecar rejects an operator_decision sidecar claiming approve_candidate when the run's result doesn't meet the prerequisites", async () => {
    // The operator_decision sidecar schema only requires a non-empty
    // evidenceBundle of arbitrary strings -- an author could write
    // {"foo":"bar"} and satisfy it. This must not be enough to accept
    // "approve_candidate": the CLI needs to independently verify the
    // run's actual persisted result meets every prerequisite the
    // embedded operatorDecision field itself enforces.
    const { deps, stdout, stderr, store } = createMockDeps();

    await runExperimentCli(
      [
        "prepare",
        "--route",
        "i2v",
        "--frames",
        "124",
        "--seed",
        "42",
        "--inputs",
        "inputs.json",
        "--prompt",
        "A test prompt",
        "--target-host",
        "worker-01",
        "--gpu-uuid",
        "GPU-12345678-1234-1234-1234-123456789abc",
        "--comfyui-dir",
        "/opt/comfyui",
        "--python",
        "/usr/bin/python3",
        "--run-id",
        "run-approval-test",
        "--output-root",
        ".ai-runs/minimax-h3-experiments"
      ],
      deps
    );
    const prepareOutput = JSON.parse(stdout[0]!);
    const runDir = prepareOutput.runDir;
    const comparisonKey = store.descriptor!.comparisonKey;
    stdout.length = 0;

    // Result exists but execution never actually completed.
    store.result = {
      schemaVersion: 1,
      runId: "run-approval-test",
      descriptorDigest: "0".repeat(64),
      configDigest: "0".repeat(64),
      comparisonKey,
      lifecycle: "running",
      observedRunner: {
        argv: [],
        env: {},
        pid: 1234,
        processStartTimeTicks: 100,
        targetGpuUuid: "GPU-12345678-1234-1234-1234-123456789abc",
        effectiveMode: {
          status: "unknown",
          value: null,
          unknownReason: "not yet started",
          evidence: null
        }
      },
      timestamps: {
        preparedAt: new Date().toISOString(),
        startedAt: null,
        submittedAt: null,
        terminatedAt: new Date().toISOString()
      },
      execution: {
        status: "not_started",
        promptId: null,
        terminalEvidence: null,
        engineError: null,
        latencyMs: null
      },
      collection: {
        status: "not_started",
        phaseCoverage: { before: false, during: false, after: false },
        sampleCount: { attempted: 0, succeeded: 0, failed: 0 },
        metrics: {
          gpuPeakUsedVramMb: null,
          gpuAllocatableVramMb: null,
          hostPeakRamUsedMb: null,
          processPeakRssMb: null,
          hostSwapUsedMb: null,
          hostSwapDeltaMb: null
        },
        errors: []
      },
      probe: {
        status: "not_started",
        outputFile: null,
        outputSha256: null,
        outputSizeBytes: null,
        measuredFacts: {
          measuredFrames: null,
          countedFramesSource: null,
          declaredNbFrames: null,
          measuredVideoDurationMs: null,
          measuredContainerDurationMs: null,
          width: null,
          height: null,
          fps: null,
          rFrameRate: null,
          avgFrameRate: null,
          videoCodec: null,
          audioCodec: null,
          audioChannels: null,
          audioSampleRate: null
        },
        discrepancyFlags: [],
        toolIdentity: null,
        errors: []
      },
      outputConformance: {
        status: "unknown",
        checks: {
          frameCountMatches: null,
          geometryMatches: null,
          fpsMatches: null,
          timingWithinTolerance: null
        },
        reasons: ["probe_not_succeeded"]
      },
      visualReview: {
        status: "pending",
        outputSha256: null,
        reviewedAt: null,
        reviewer: null,
        findings: null,
        notes: null,
        unavailableReason: null
      },
      operatorDecision: {
        status: "pending",
        operator: null,
        decidedAt: null,
        comparisonKey: null,
        reason: null
      },
      stopRecommendation: { recommended: false, reasons: [] }
    };

    store.files.set(
      "approval.json",
      JSON.stringify({
        schemaVersion: 1,
        runId: "run-approval-test",
        route: "i2v",
        configuredFrames: 124,
        comparisonKey,
        status: "approve_candidate",
        operator: "operator-1",
        decidedAt: new Date().toISOString(),
        reason: "Looks great, ship it",
        evidenceBundle: { foo: "bar" }
      })
    );

    const code = await runExperimentCli(
      [
        "validate-sidecar",
        "--file",
        "approval.json",
        "--run-dir",
        runDir,
        "--output-root",
        ".ai-runs/minimax-h3-experiments"
      ],
      deps
    );

    expect(code).toBe(1);
    expect(
      stderr.some(
        (line) =>
          line.includes("approve_candidate") && line.includes('execution status is "not_started"')
      )
    ).toBe(true);
  });

  it("validate-sidecar accepts an operator_decision sidecar claiming approve_candidate when the run's result genuinely meets every prerequisite", async () => {
    const { deps, stdout, store } = createMockDeps();

    await runExperimentCli(
      [
        "prepare",
        "--route",
        "i2v",
        "--frames",
        "124",
        "--seed",
        "42",
        "--inputs",
        "inputs.json",
        "--prompt",
        "A test prompt",
        "--target-host",
        "worker-01",
        "--gpu-uuid",
        "GPU-12345678-1234-1234-1234-123456789abc",
        "--comfyui-dir",
        "/opt/comfyui",
        "--python",
        "/usr/bin/python3",
        "--run-id",
        "run-approval-pass-test",
        "--output-root",
        ".ai-runs/minimax-h3-experiments"
      ],
      deps
    );
    const prepareOutput = JSON.parse(stdout[0]!);
    const runDir = prepareOutput.runDir;
    const comparisonKey = store.descriptor!.comparisonKey;
    stdout.length = 0;

    store.result = {
      schemaVersion: 1,
      runId: "run-approval-pass-test",
      descriptorDigest: "0".repeat(64),
      configDigest: "0".repeat(64),
      comparisonKey,
      lifecycle: "completed",
      observedRunner: {
        argv: [],
        env: {},
        pid: 1234,
        processStartTimeTicks: 100,
        targetGpuUuid: "GPU-12345678-1234-1234-1234-123456789abc",
        effectiveMode: {
          status: "verified",
          value: "dynamic_vram",
          unknownReason: null,
          evidence: null
        }
      },
      timestamps: {
        preparedAt: new Date().toISOString(),
        startedAt: new Date().toISOString(),
        submittedAt: new Date().toISOString(),
        terminatedAt: new Date().toISOString()
      },
      execution: {
        status: "completed",
        promptId: "prompt-1",
        terminalEvidence: { source: "history", status: "success" },
        engineError: null,
        latencyMs: 10000
      },
      collection: {
        status: "complete",
        phaseCoverage: { before: true, during: true, after: true },
        sampleCount: { attempted: 1, succeeded: 1, failed: 0 },
        metrics: {
          gpuPeakUsedVramMb: 12000,
          gpuAllocatableVramMb: 24000,
          hostPeakRamUsedMb: 16000,
          processPeakRssMb: 8000,
          hostSwapUsedMb: 0,
          hostSwapDeltaMb: 0
        },
        errors: []
      },
      probe: {
        status: "succeeded",
        outputFile: `${runDir}/outputs/video.mp4`,
        outputSha256: "a".repeat(64),
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
          audioCodec: null,
          audioChannels: null,
          audioSampleRate: null
        },
        discrepancyFlags: [],
        toolIdentity: null,
        errors: []
      },
      outputConformance: {
        status: "conformant",
        checks: {
          frameCountMatches: true,
          geometryMatches: true,
          fpsMatches: true,
          timingWithinTolerance: true
        },
        reasons: []
      },
      visualReview: {
        status: "reviewed",
        outputSha256: "a".repeat(64),
        reviewedAt: new Date().toISOString(),
        reviewer: "tester-1",
        findings: { continuity: "pass", identityFidelity: "pass", visualDegradation: "pass" },
        notes: "Flawless",
        unavailableReason: null
      },
      operatorDecision: {
        status: "pending",
        operator: null,
        decidedAt: null,
        comparisonKey: null,
        reason: null
      },
      stopRecommendation: { recommended: false, reasons: [] }
    };

    store.files.set(
      "approval.json",
      JSON.stringify({
        schemaVersion: 1,
        runId: "run-approval-pass-test",
        route: "i2v",
        configuredFrames: 124,
        comparisonKey,
        status: "approve_candidate",
        operator: "operator-1",
        decidedAt: new Date().toISOString(),
        reason: "Looks great, ship it",
        evidenceBundle: { foo: "bar" }
      })
    );

    const code = await runExperimentCli(
      [
        "validate-sidecar",
        "--file",
        "approval.json",
        "--run-dir",
        runDir,
        "--output-root",
        ".ai-runs/minimax-h3-experiments"
      ],
      deps
    );

    expect(code).toBe(0);
  });

  it("validate-sidecar rejects an operator_decision sidecar claiming approve_candidate when the effective mode doesn't match the requested memory policy", async () => {
    // "some effective mode was verified" is a weaker claim than "the
    // policy that was actually requested was verified" -- a run that
    // silently fell back to a different memory policy than what was
    // asked for must not be approvable just because *a* mode got
    // verified.
    const { deps, stdout, stderr, store } = createMockDeps();

    await runExperimentCli(
      [
        "prepare",
        "--route",
        "i2v",
        "--frames",
        "124",
        "--seed",
        "42",
        "--inputs",
        "inputs.json",
        "--prompt",
        "A test prompt",
        "--target-host",
        "worker-01",
        "--gpu-uuid",
        "GPU-12345678-1234-1234-1234-123456789abc",
        "--comfyui-dir",
        "/opt/comfyui",
        "--python",
        "/usr/bin/python3",
        "--run-id",
        "run-policy-mismatch-test",
        "--output-root",
        ".ai-runs/minimax-h3-experiments"
      ],
      deps
    );
    const prepareOutput = JSON.parse(stdout[0]!);
    const runDir = prepareOutput.runDir;
    const comparisonKey = store.descriptor!.comparisonKey;
    const requestedPolicy = store.descriptor!.requestedRunner.memoryPolicy;
    const mismatchedPolicy = requestedPolicy === "dynamic_vram" ? "static_lowvram" : "dynamic_vram";
    stdout.length = 0;

    store.result = {
      schemaVersion: 1,
      runId: "run-policy-mismatch-test",
      descriptorDigest: "0".repeat(64),
      configDigest: "0".repeat(64),
      comparisonKey,
      lifecycle: "completed",
      observedRunner: {
        argv: [],
        env: {},
        pid: 1234,
        processStartTimeTicks: 100,
        targetGpuUuid: "GPU-12345678-1234-1234-1234-123456789abc",
        effectiveMode: {
          status: "verified",
          value: mismatchedPolicy,
          unknownReason: null,
          evidence: null
        }
      },
      timestamps: {
        preparedAt: new Date().toISOString(),
        startedAt: new Date().toISOString(),
        submittedAt: new Date().toISOString(),
        terminatedAt: new Date().toISOString()
      },
      execution: {
        status: "completed",
        promptId: "prompt-1",
        terminalEvidence: { source: "history", status: "success" },
        engineError: null,
        latencyMs: 10000
      },
      collection: {
        status: "complete",
        phaseCoverage: { before: true, during: true, after: true },
        sampleCount: { attempted: 1, succeeded: 1, failed: 0 },
        metrics: {
          gpuPeakUsedVramMb: 12000,
          gpuAllocatableVramMb: 24000,
          hostPeakRamUsedMb: 16000,
          processPeakRssMb: 8000,
          hostSwapUsedMb: 0,
          hostSwapDeltaMb: 0
        },
        errors: []
      },
      probe: {
        status: "succeeded",
        outputFile: `${runDir}/outputs/video.mp4`,
        outputSha256: "a".repeat(64),
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
          audioCodec: null,
          audioChannels: null,
          audioSampleRate: null
        },
        discrepancyFlags: [],
        toolIdentity: null,
        errors: []
      },
      outputConformance: {
        status: "conformant",
        checks: {
          frameCountMatches: true,
          geometryMatches: true,
          fpsMatches: true,
          timingWithinTolerance: true
        },
        reasons: []
      },
      visualReview: {
        status: "reviewed",
        outputSha256: "a".repeat(64),
        reviewedAt: new Date().toISOString(),
        reviewer: "tester-1",
        findings: { continuity: "pass", identityFidelity: "pass", visualDegradation: "pass" },
        notes: "Flawless",
        unavailableReason: null
      },
      operatorDecision: {
        status: "pending",
        operator: null,
        decidedAt: null,
        comparisonKey: null,
        reason: null
      },
      stopRecommendation: { recommended: false, reasons: [] }
    };

    store.files.set(
      "approval.json",
      JSON.stringify({
        schemaVersion: 1,
        runId: "run-policy-mismatch-test",
        route: "i2v",
        configuredFrames: 124,
        comparisonKey,
        status: "approve_candidate",
        operator: "operator-1",
        decidedAt: new Date().toISOString(),
        reason: "Looks great, ship it",
        evidenceBundle: { foo: "bar" }
      })
    );

    const code = await runExperimentCli(
      [
        "validate-sidecar",
        "--file",
        "approval.json",
        "--run-dir",
        runDir,
        "--output-root",
        ".ai-runs/minimax-h3-experiments"
      ],
      deps
    );

    expect(code).toBe(1);
    expect(stderr.some((line) => line.includes("does not match the requested memory policy"))).toBe(
      true
    );
  });

  it("import-sidecar imports an operator_decision sidecar into result.json's operatorDecision field", async () => {
    // import-sidecar used to only understand visual review sidecars --
    // an operator_decision had no supported way to reach result.json at
    // all except a hand-edit that bypassed every check. This mirrors
    // the same approve_candidate prerequisite verification validate-
    // sidecar already enforces.
    const { deps, stdout, store } = createMockDeps();

    await runExperimentCli(
      [
        "prepare",
        "--route",
        "i2v",
        "--frames",
        "124",
        "--seed",
        "42",
        "--inputs",
        "inputs.json",
        "--prompt",
        "A test prompt",
        "--target-host",
        "worker-01",
        "--gpu-uuid",
        "GPU-12345678-1234-1234-1234-123456789abc",
        "--comfyui-dir",
        "/opt/comfyui",
        "--python",
        "/usr/bin/python3",
        "--run-id",
        "run-import-decision-test",
        "--output-root",
        ".ai-runs/minimax-h3-experiments"
      ],
      deps
    );
    const prepareOutput = JSON.parse(stdout[0]!);
    const runDir = prepareOutput.runDir;
    const comparisonKey = store.descriptor!.comparisonKey;
    stdout.length = 0;

    store.result = {
      schemaVersion: 1,
      runId: "run-import-decision-test",
      descriptorDigest: "0".repeat(64),
      configDigest: "0".repeat(64),
      comparisonKey,
      lifecycle: "completed",
      observedRunner: {
        argv: [],
        env: {},
        pid: 1234,
        processStartTimeTicks: 100,
        targetGpuUuid: "GPU-12345678-1234-1234-1234-123456789abc",
        effectiveMode: {
          status: "verified",
          value: "dynamic_vram",
          unknownReason: null,
          evidence: null
        }
      },
      timestamps: {
        preparedAt: new Date().toISOString(),
        startedAt: new Date().toISOString(),
        submittedAt: new Date().toISOString(),
        terminatedAt: new Date().toISOString()
      },
      execution: {
        status: "completed",
        promptId: "prompt-1",
        terminalEvidence: { source: "history", status: "success" },
        engineError: null,
        latencyMs: 10000
      },
      collection: {
        status: "complete",
        phaseCoverage: { before: true, during: true, after: true },
        sampleCount: { attempted: 1, succeeded: 1, failed: 0 },
        metrics: {
          gpuPeakUsedVramMb: 12000,
          gpuAllocatableVramMb: 24000,
          hostPeakRamUsedMb: 16000,
          processPeakRssMb: 8000,
          hostSwapUsedMb: 0,
          hostSwapDeltaMb: 0
        },
        errors: []
      },
      probe: {
        status: "succeeded",
        outputFile: `${runDir}/outputs/video.mp4`,
        outputSha256: "a".repeat(64),
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
          audioCodec: null,
          audioChannels: null,
          audioSampleRate: null
        },
        discrepancyFlags: [],
        toolIdentity: null,
        errors: []
      },
      outputConformance: {
        status: "conformant",
        checks: {
          frameCountMatches: true,
          geometryMatches: true,
          fpsMatches: true,
          timingWithinTolerance: true
        },
        reasons: []
      },
      visualReview: {
        status: "reviewed",
        outputSha256: "a".repeat(64),
        reviewedAt: new Date().toISOString(),
        reviewer: "tester-1",
        findings: { continuity: "pass", identityFidelity: "pass", visualDegradation: "pass" },
        notes: "Flawless",
        unavailableReason: null
      },
      operatorDecision: {
        status: "pending",
        operator: null,
        decidedAt: null,
        comparisonKey: null,
        reason: null
      },
      stopRecommendation: { recommended: false, reasons: [] }
    };

    store.files.set(
      "approval.json",
      JSON.stringify({
        schemaVersion: 1,
        runId: "run-import-decision-test",
        route: "i2v",
        configuredFrames: 124,
        comparisonKey,
        status: "approve_candidate",
        operator: "operator-1",
        decidedAt: new Date().toISOString(),
        reason: "Looks great, ship it",
        evidenceBundle: { foo: "bar" }
      })
    );

    const code = await runExperimentCli(
      [
        "import-sidecar",
        "--run-dir",
        runDir,
        "--sidecar",
        "approval.json",
        "--output-root",
        ".ai-runs/minimax-h3-experiments"
      ],
      deps
    );

    expect(code).toBe(0);
    const parsedOut = JSON.parse(stdout[0]!);
    expect(parsedOut.status).toBe("imported");
    expect(parsedOut.operatorDecisionStatus).toBe("approve_candidate");
    expect(store.result!.operatorDecision.status).toBe("approve_candidate");
    expect(store.result!.operatorDecision.operator).toBe("operator-1");
  });

  it("import-sidecar rejects an operator_decision sidecar claiming approve_candidate when the run's result doesn't meet the prerequisites", async () => {
    const { deps, stdout, stderr, store } = createMockDeps();

    await runExperimentCli(
      [
        "prepare",
        "--route",
        "i2v",
        "--frames",
        "124",
        "--seed",
        "42",
        "--inputs",
        "inputs.json",
        "--prompt",
        "A test prompt",
        "--target-host",
        "worker-01",
        "--gpu-uuid",
        "GPU-12345678-1234-1234-1234-123456789abc",
        "--comfyui-dir",
        "/opt/comfyui",
        "--python",
        "/usr/bin/python3",
        "--run-id",
        "run-import-decision-reject-test",
        "--output-root",
        ".ai-runs/minimax-h3-experiments"
      ],
      deps
    );
    const prepareOutput = JSON.parse(stdout[0]!);
    const runDir = prepareOutput.runDir;
    const comparisonKey = store.descriptor!.comparisonKey;
    stdout.length = 0;

    store.result = {
      schemaVersion: 1,
      runId: "run-import-decision-reject-test",
      descriptorDigest: "0".repeat(64),
      configDigest: "0".repeat(64),
      comparisonKey,
      lifecycle: "running",
      observedRunner: {
        argv: [],
        env: {},
        pid: 1234,
        processStartTimeTicks: 100,
        targetGpuUuid: "GPU-12345678-1234-1234-1234-123456789abc",
        effectiveMode: {
          status: "unknown",
          value: null,
          unknownReason: "not yet started",
          evidence: null
        }
      },
      timestamps: {
        preparedAt: new Date().toISOString(),
        startedAt: null,
        submittedAt: null,
        terminatedAt: new Date().toISOString()
      },
      execution: {
        status: "not_started",
        promptId: null,
        terminalEvidence: null,
        engineError: null,
        latencyMs: null
      },
      collection: {
        status: "not_started",
        phaseCoverage: { before: false, during: false, after: false },
        sampleCount: { attempted: 0, succeeded: 0, failed: 0 },
        metrics: {
          gpuPeakUsedVramMb: null,
          gpuAllocatableVramMb: null,
          hostPeakRamUsedMb: null,
          processPeakRssMb: null,
          hostSwapUsedMb: null,
          hostSwapDeltaMb: null
        },
        errors: []
      },
      probe: {
        status: "not_started",
        outputFile: null,
        outputSha256: null,
        outputSizeBytes: null,
        measuredFacts: {
          measuredFrames: null,
          countedFramesSource: null,
          declaredNbFrames: null,
          measuredVideoDurationMs: null,
          measuredContainerDurationMs: null,
          width: null,
          height: null,
          fps: null,
          rFrameRate: null,
          avgFrameRate: null,
          videoCodec: null,
          audioCodec: null,
          audioChannels: null,
          audioSampleRate: null
        },
        discrepancyFlags: [],
        toolIdentity: null,
        errors: []
      },
      outputConformance: {
        status: "unknown",
        checks: {
          frameCountMatches: null,
          geometryMatches: null,
          fpsMatches: null,
          timingWithinTolerance: null
        },
        reasons: ["probe_not_succeeded"]
      },
      visualReview: {
        status: "pending",
        outputSha256: null,
        reviewedAt: null,
        reviewer: null,
        findings: null,
        notes: null,
        unavailableReason: null
      },
      operatorDecision: {
        status: "pending",
        operator: null,
        decidedAt: null,
        comparisonKey: null,
        reason: null
      },
      stopRecommendation: { recommended: false, reasons: [] }
    };

    store.files.set(
      "approval.json",
      JSON.stringify({
        schemaVersion: 1,
        runId: "run-import-decision-reject-test",
        route: "i2v",
        configuredFrames: 124,
        comparisonKey,
        status: "approve_candidate",
        operator: "operator-1",
        decidedAt: new Date().toISOString(),
        reason: "Looks great, ship it",
        evidenceBundle: { foo: "bar" }
      })
    );

    const code = await runExperimentCli(
      [
        "import-sidecar",
        "--run-dir",
        runDir,
        "--sidecar",
        "approval.json",
        "--output-root",
        ".ai-runs/minimax-h3-experiments"
      ],
      deps
    );

    expect(code).toBe(1);
    expect(
      stderr.some(
        (line) =>
          line.includes("approve_candidate") && line.includes('execution status is "not_started"')
      )
    ).toBe(true);
    // The result must not have been mutated by the rejected import.
    expect(store.result!.operatorDecision.status).toBe("pending");
  });

  it("cleanup preserves outputs by default and deletes them when --remove-outputs is passed", async () => {
    const { deps, store } = createMockDeps();

    await runExperimentCli(
      [
        "prepare",
        "--route",
        "i2v",
        "--frames",
        "124",
        "--seed",
        "42",
        "--inputs",
        "inputs.json",
        "--prompt",
        "A test prompt",
        "--target-host",
        "worker-01",
        "--gpu-uuid",
        "GPU-12345678-1234-1234-1234-123456789abc",
        "--comfyui-dir",
        "/opt/comfyui",
        "--python",
        "/usr/bin/python3",
        "--run-id",
        "run-cleanup-outputs",
        "--output-root",
        ".ai-runs/minimax-h3-experiments"
      ],
      deps
    );

    const runDir = ".ai-runs/minimax-h3-experiments/run-cleanup-outputs";

    // 1. Default cleanup: removeOutputs should be false (preserve outputs)
    await runExperimentCli(
      ["cleanup", "--run-dir", runDir, "--output-root", ".ai-runs/minimax-h3-experiments"],
      deps
    );
    expect(store.deleteRunFilesCalls.length).toBe(1);
    expect(store.deleteRunFilesCalls[0]!.removeOutputs).toBe(false);

    // 2. Cleanup with --remove-outputs: removeOutputs should be true
    await runExperimentCli(
      [
        "cleanup",
        "--run-dir",
        runDir,
        "--remove-outputs",
        "--output-root",
        ".ai-runs/minimax-h3-experiments"
      ],
      deps
    );
    expect(store.deleteRunFilesCalls.length).toBe(2);
    expect(store.deleteRunFilesCalls[1]!.removeOutputs).toBe(true);
  });

  it("prepare subcommand supports --step-override and --variant-purpose", async () => {
    const { deps, stdout, store } = createMockDeps();

    const code = await runExperimentCli(
      [
        "prepare",
        "--route",
        "i2v",
        "--frames",
        "124",
        "--seed",
        "42",
        "--step-override",
        "15",
        "--variant-purpose",
        "performance",
        "--variant-reason",
        "Evaluate 15-step sampling",
        "--inputs",
        "inputs.json",
        "--prompt",
        "A sunset",
        "--target-host",
        "render-worker-01",
        "--gpu-uuid",
        "GPU-12345678-1234-1234-1234-123456789abc",
        "--comfyui-dir",
        "/opt/comfyui",
        "--python",
        "/usr/bin/python3",
        "--run-id",
        "run-cli-step-override",
        "--output-root",
        ".ai-runs/minimax-h3-experiments"
      ],
      deps
    );
    expect(code).toBe(0);
    const prepareOutput = JSON.parse(stdout[0]!);
    expect(prepareOutput.status).toBe("prepared");

    // Inspect the written descriptor
    const descriptor = store.descriptorsByRunDir.get(prepareOutput.runDir);
    expect(descriptor).toBeDefined();
    expect(descriptor!.schemaVersion).toBe(2);
    if (descriptor!.schemaVersion === 2) {
      expect(descriptor!.experimentVariant.purpose).toBe("performance");
      expect(descriptor!.experimentVariant.variantReason).toBe("Evaluate 15-step sampling");
      expect(descriptor!.experimentVariant.changedFactors).toContainEqual(
        expect.objectContaining({ path: "sampling.settings" })
      );
    }
  });

  it("compare subcommand admits single-factor variant against baseline", async () => {
    const { deps, stdout } = createMockDeps();

    // Prepare & run baseline (20 steps)
    await runExperimentCli(
      [
        "prepare",
        "--route",
        "i2v",
        "--frames",
        "124",
        "--seed",
        "42",
        "--inputs",
        "inputs.json",
        "--prompt",
        "A sunset",
        "--target-host",
        "render-worker-01",
        "--gpu-uuid",
        "GPU-12345678-1234-1234-1234-123456789abc",
        "--comfyui-dir",
        "/opt/comfyui",
        "--python",
        "/usr/bin/python3",
        "--run-id",
        "run-baseline-for-compare",
        "--output-root",
        ".ai-runs/minimax-h3-experiments"
      ],
      deps
    );
    const baselineRunDir = ".ai-runs/minimax-h3-experiments/run-baseline-for-compare";
    await runExperimentCli(
      [
        "run",
        "--run-dir",
        baselineRunDir,
        "--output-root",
        ".ai-runs/minimax-h3-experiments",
        "--stop-policy",
        "operator-stop-policy.json"
      ],
      deps
    );

    // Prepare & run candidate (15 steps)
    await runExperimentCli(
      [
        "prepare",
        "--route",
        "i2v",
        "--frames",
        "124",
        "--seed",
        "42",
        "--step-override",
        "15",
        "--variant-purpose",
        "performance",
        "--variant-reason",
        "Evaluate 15-step sampling",
        "--inputs",
        "inputs.json",
        "--prompt",
        "A sunset",
        "--target-host",
        "render-worker-01",
        "--gpu-uuid",
        "GPU-12345678-1234-1234-1234-123456789abc",
        "--comfyui-dir",
        "/opt/comfyui",
        "--python",
        "/usr/bin/python3",
        "--run-id",
        "run-candidate-for-compare",
        "--output-root",
        ".ai-runs/minimax-h3-experiments"
      ],
      deps
    );
    const candidateRunDir = ".ai-runs/minimax-h3-experiments/run-candidate-for-compare";
    await runExperimentCli(
      [
        "run",
        "--run-dir",
        candidateRunDir,
        "--output-root",
        ".ai-runs/minimax-h3-experiments",
        "--stop-policy",
        "operator-stop-policy.json"
      ],
      deps
    );

    stdout.length = 0;
    const compareCode = await runExperimentCli(
      [
        "compare",
        "--baseline",
        baselineRunDir,
        "--candidate",
        candidateRunDir,
        "--output-root",
        ".ai-runs/minimax-h3-experiments"
      ],
      deps
    );
    expect(compareCode).toBe(0);
    const comparison = JSON.parse(stdout[0]!);
    expect(comparison.structuralAdmission.eligible).toBe(true);
    expect(comparison.factorDifferences).toContainEqual(
      expect.objectContaining({ path: "sampling.settings" })
    );
  });

  it("compare subcommand exits with code 1 when runs differ on invariants", async () => {
    const { deps, stdout } = createMockDeps();

    // Prepare baseline
    await runExperimentCli(
      [
        "prepare",
        "--route",
        "i2v",
        "--frames",
        "124",
        "--seed",
        "42",
        "--inputs",
        "inputs.json",
        "--prompt",
        "A sunset",
        "--target-host",
        "render-worker-01",
        "--gpu-uuid",
        "GPU-12345678-1234-1234-1234-123456789abc",
        "--comfyui-dir",
        "/opt/comfyui",
        "--python",
        "/usr/bin/python3",
        "--run-id",
        "run-baseline-invar-1",
        "--output-root",
        ".ai-runs/minimax-h3-experiments"
      ],
      deps
    );
    const baselineRunDir = ".ai-runs/minimax-h3-experiments/run-baseline-invar-1";
    await runExperimentCli(
      [
        "run",
        "--run-dir",
        baselineRunDir,
        "--output-root",
        ".ai-runs/minimax-h3-experiments",
        "--stop-policy",
        "operator-stop-policy.json"
      ],
      deps
    );

    // Prepare candidate with different seed (confounder)
    await runExperimentCli(
      [
        "prepare",
        "--route",
        "i2v",
        "--frames",
        "124",
        "--seed",
        "999",
        "--inputs",
        "inputs.json",
        "--prompt",
        "A sunset",
        "--target-host",
        "render-worker-01",
        "--gpu-uuid",
        "GPU-12345678-1234-1234-1234-123456789abc",
        "--comfyui-dir",
        "/opt/comfyui",
        "--python",
        "/usr/bin/python3",
        "--run-id",
        "run-candidate-invar-diff",
        "--output-root",
        ".ai-runs/minimax-h3-experiments"
      ],
      deps
    );
    const candidateRunDir = ".ai-runs/minimax-h3-experiments/run-candidate-invar-diff";
    await runExperimentCli(
      [
        "run",
        "--run-dir",
        candidateRunDir,
        "--output-root",
        ".ai-runs/minimax-h3-experiments",
        "--stop-policy",
        "operator-stop-policy.json"
      ],
      deps
    );

    stdout.length = 0;
    const compareCode = await runExperimentCli(
      [
        "compare",
        "--baseline",
        baselineRunDir,
        "--candidate",
        candidateRunDir,
        "--output-root",
        ".ai-runs/minimax-h3-experiments"
      ],
      deps
    );
    expect(compareCode).toBe(1);
    const comparison = JSON.parse(stdout[0]!);
    expect(comparison.structuralAdmission.eligible).toBe(false);
    expect(comparison.structuralAdmission.reasons.length).toBeGreaterThan(0);
  });

  describe("Attention Variant CLI Flags", () => {
    it("rejects invalid --attention-variant option", async () => {
      const { deps, stderr } = createMockDeps();
      const exitCode = await runExperimentCli(
        [
          "prepare",
          "--route",
          "i2v",
          "--frames",
          "124",
          "--seed",
          "42",
          "--inputs",
          "inputs.json",
          "--prompt",
          "A test prompt",
          "--target-host",
          "render-worker-01",
          "--gpu-uuid",
          "GPU-12345678-1234-1234-1234-123456789abc",
          "--comfyui-dir",
          "/opt/comfyui",
          "--python",
          "/usr/bin/python3",
          "--run-id",
          "run-invalid-attn",
          "--output-root",
          ".ai-runs/minimax-h3-experiments",
          "--attention-variant",
          "invalid-kernel"
        ],
        deps
      );
      expect(exitCode).toBe(1);
      expect(
        stderr.some((e) =>
          e.includes("--attention-variant must be 'dense', 'sage', 'native-sol-attn', or 'veda'")
        )
      ).toBe(true);
    });

    it("prepares experiment with --attention-variant sage successfully", async () => {
      const { deps, stdout, store } = createMockDeps();
      const exitCode = await runExperimentCli(
        [
          "prepare",
          "--route",
          "i2v",
          "--frames",
          "124",
          "--seed",
          "42",
          "--inputs",
          "inputs.json",
          "--prompt",
          "A test prompt",
          "--target-host",
          "render-worker-01",
          "--gpu-uuid",
          "GPU-12345678-1234-1234-1234-123456789abc",
          "--comfyui-dir",
          "/opt/comfyui",
          "--python",
          "/usr/bin/python3",
          "--run-id",
          "run-sage-attn",
          "--output-root",
          ".ai-runs/minimax-h3-experiments",
          "--attention-variant",
          "sage"
        ],
        deps
      );
      expect(exitCode).toBe(0);
      const parsed = JSON.parse(stdout[0]!);
      expect(parsed.status).toBe("prepared");
      expect(parsed.runId).toBe("run-sage-attn");

      const desc = store.descriptorsByRunDir.get(parsed.runDir);
      expect(desc).toBeDefined();
      expect(desc!.schemaVersion).toBe(2);
      const descV2 = desc as unknown as {
        attentionRequest?: { attentionVariant: string };
        configuredRunner?: { argv?: string[] };
      };
      expect(descV2.attentionRequest?.attentionVariant).toBe("sage");
      expect(descV2.configuredRunner?.argv).toContain("--use-sage-attention");
    });

    it("prepares and validates experiment with --attention-variant sage with zero errors [F-0e112829]", async () => {
      const { deps, stdout } = createMockDeps();
      const prepExit = await runExperimentCli(
        [
          "prepare",
          "--route",
          "i2v",
          "--frames",
          "124",
          "--seed",
          "42",
          "--inputs",
          "inputs.json",
          "--prompt",
          "A test prompt",
          "--target-host",
          "render-worker-01",
          "--gpu-uuid",
          "GPU-12345678-1234-1234-1234-123456789abc",
          "--comfyui-dir",
          "/opt/comfyui",
          "--python",
          "/usr/bin/python3",
          "--run-id",
          "run-sage-validate",
          "--output-root",
          ".ai-runs/minimax-h3-experiments",
          "--attention-variant",
          "sage"
        ],
        deps
      );
      expect(prepExit).toBe(0);
      const parsed = JSON.parse(stdout[0]!);
      expect(parsed.status).toBe("prepared");

      const valExit = await runExperimentCli(
        [
          "validate",
          "--run-dir",
          parsed.runDir,
          "--output-root",
          ".ai-runs/minimax-h3-experiments"
        ],
        deps
      );
      expect(valExit).toBe(0);
      const valOutput = JSON.parse(stdout[1]!);
      expect(valOutput.status).toBe("valid");
      expect(valOutput.graphValid).toBe(true);
      expect(valOutput.runId).toBe("run-sage-validate");
    });
  });

  describe("Sampling Recipe CLI Flags", () => {
    it("lists all recipes with catalog --recipes", async () => {
      const { deps, stdout } = createMockDeps();
      const exitCode = await runExperimentCli(["catalog", "--recipes"], deps);
      expect(exitCode).toBe(0);
      const parsed = JSON.parse(stdout[0]!);
      expect(Array.isArray(parsed)).toBe(true);
      expect(parsed).toHaveLength(5);
      const names = parsed.map((r: { name: string }) => r.name);
      expect(names).toContain("canonical-base-20");
      expect(names).toContain("fl2va-base-20");
      expect(names).toContain("fl2va-turbo-8");
      expect(names).toContain("ref2va-turbo-4");
      expect(names).toContain("fasth3-i2v-8");
    });

    it("filters recipes by route with catalog --recipes --route ref2v", async () => {
      const { deps, stdout } = createMockDeps();
      const exitCode = await runExperimentCli(["catalog", "--recipes", "--route", "ref2v"], deps);
      expect(exitCode).toBe(0);
      const parsed = JSON.parse(stdout[0]!);
      expect(Array.isArray(parsed)).toBe(true);
      const names = parsed.map((r: { name: string }) => r.name);
      expect(names).toContain("canonical-base-20");
      expect(names).toContain("ref2va-turbo-4");
      expect(names).not.toContain("fl2va-turbo-8");
      expect(names).not.toContain("fasth3-i2v-8");
    });

    it("rejects invalid --sampling-recipe option", async () => {
      const { deps, stderr } = createMockDeps();
      const exitCode = await runExperimentCli(
        [
          "prepare",
          "--route",
          "i2v",
          "--frames",
          "124",
          "--seed",
          "42",
          "--inputs",
          "inputs.json",
          "--prompt",
          "A test prompt",
          "--target-host",
          "render-worker-01",
          "--gpu-uuid",
          "GPU-12345678-1234-1234-1234-123456789abc",
          "--comfyui-dir",
          "/opt/comfyui",
          "--python",
          "/usr/bin/python3",
          "--run-id",
          "run-bad-recipe",
          "--output-root",
          ".ai-runs/minimax-h3-experiments",
          "--sampling-recipe",
          "non-existent"
        ],
        deps
      );
      expect(exitCode).toBe(1);
      expect(stderr[0]).toContain('Unknown --sampling-recipe "non-existent"');
    });

    it("rejects --step-override when combined with --sampling-recipe", async () => {
      const { deps, stderr } = createMockDeps();
      const exitCode = await runExperimentCli(
        [
          "prepare",
          "--route",
          "i2v",
          "--frames",
          "124",
          "--seed",
          "42",
          "--inputs",
          "inputs.json",
          "--prompt",
          "A test prompt",
          "--target-host",
          "render-worker-01",
          "--gpu-uuid",
          "GPU-12345678-1234-1234-1234-123456789abc",
          "--comfyui-dir",
          "/opt/comfyui",
          "--python",
          "/usr/bin/python3",
          "--run-id",
          "run-conflict",
          "--output-root",
          ".ai-runs/minimax-h3-experiments",
          "--sampling-recipe",
          "fl2va-turbo-8",
          "--step-override",
          "20"
        ],
        deps
      );
      expect(exitCode).toBe(1);
      expect(stderr[0]).toContain(
        "Cannot specify --step-override when using a distillation --sampling-recipe"
      );
    });

    it("rejects route incompatibility (e.g. fasth3-i2v-8 on ref2v route)", async () => {
      const { deps, stderr } = createMockDeps();
      const exitCode = await runExperimentCli(
        [
          "prepare",
          "--route",
          "ref2v",
          "--frames",
          "124",
          "--seed",
          "42",
          "--inputs",
          "inputs.json",
          "--prompt",
          "A test prompt",
          "--target-host",
          "render-worker-01",
          "--gpu-uuid",
          "GPU-12345678-1234-1234-1234-123456789abc",
          "--comfyui-dir",
          "/opt/comfyui",
          "--python",
          "/usr/bin/python3",
          "--run-id",
          "run-incompat-route",
          "--output-root",
          ".ai-runs/minimax-h3-experiments",
          "--sampling-recipe",
          "fasth3-i2v-8"
        ],
        deps
      );
      expect(exitCode).toBe(1);
      expect(stderr[0]).toContain(
        "FastH3 8-step is strictly restricted to I2V / frame-anchored route; Ref2V is rejected"
      );
    });

    it("prepares and validates experiment with --sampling-recipe fl2va-turbo-8", async () => {
      const { deps, stdout } = createMockDeps();
      const prepExit = await runExperimentCli(
        [
          "prepare",
          "--route",
          "i2v",
          "--frames",
          "124",
          "--seed",
          "42",
          "--inputs",
          "inputs.json",
          "--prompt",
          "A test prompt",
          "--target-host",
          "render-worker-01",
          "--gpu-uuid",
          "GPU-12345678-1234-1234-1234-123456789abc",
          "--comfyui-dir",
          "/opt/comfyui",
          "--python",
          "/usr/bin/python3",
          "--run-id",
          "run-fl2va-turbo-8",
          "--output-root",
          ".ai-runs/minimax-h3-experiments",
          "--sampling-recipe",
          "fl2va-turbo-8"
        ],
        deps
      );
      expect(prepExit).toBe(0);
      const parsed = JSON.parse(stdout[0]!);
      expect(parsed.status).toBe("prepared");

      const valExit = await runExperimentCli(
        [
          "validate",
          "--run-dir",
          parsed.runDir,
          "--output-root",
          ".ai-runs/minimax-h3-experiments"
        ],
        deps
      );
      expect(valExit).toBe(0);
      const valOutput = JSON.parse(stdout[1]!);
      expect(valOutput.status).toBe("valid");
      expect(valOutput.graphValid).toBe(true);
    });

    it("prepares and validates experiment with --sampling-recipe fasth3-i2v-8", async () => {
      const { deps, stdout } = createMockDeps();
      const prepExit = await runExperimentCli(
        [
          "prepare",
          "--route",
          "i2v",
          "--frames",
          "124",
          "--seed",
          "42",
          "--inputs",
          "inputs.json",
          "--prompt",
          "A test prompt",
          "--target-host",
          "render-worker-01",
          "--gpu-uuid",
          "GPU-12345678-1234-1234-1234-123456789abc",
          "--comfyui-dir",
          "/opt/comfyui",
          "--python",
          "/usr/bin/python3",
          "--run-id",
          "run-fasth3-i2v-8",
          "--output-root",
          ".ai-runs/minimax-h3-experiments",
          "--sampling-recipe",
          "fasth3-i2v-8"
        ],
        deps
      );
      expect(prepExit).toBe(0);
      const parsed = JSON.parse(stdout[0]!);
      expect(parsed.status).toBe("prepared");

      const valExit = await runExperimentCli(
        [
          "validate",
          "--run-dir",
          parsed.runDir,
          "--output-root",
          ".ai-runs/minimax-h3-experiments"
        ],
        deps
      );
      expect(valExit).toBe(0);
      const valOutput = JSON.parse(stdout[1]!);
      expect(valOutput.status).toBe("valid");
      expect(valOutput.graphValid).toBe(true);
    });
  });
});

describe("MiniMax-H3 Real Attention Catalog Runtime Manifest Verification (F-6d0e1377)", () => {
  const mockRootDir = path.resolve(".ai-tmp/test-cli-runtime-mock");
  const mockComfyDir = path.join(mockRootDir, "comfyui-pinned");
  const mockUpgradeComfyDir = path.join(mockRootDir, "comfyui-upgrade");
  const mockPythonPath = path.join(mockRootDir, "mock-python.sh");

  beforeAll(() => {
    // Setup pinned ComfyUI dir
    fs.mkdirSync(path.join(mockComfyDir, "comfy_extras"), { recursive: true });
    fs.writeFileSync(
      path.join(mockComfyDir, "comfy_extras", "nodes_minimax_h3.py"),
      "class MiniMaxH3ImageToVideo:\n    INPUT_TYPES = {}\nclass MiniMaxH3ReferenceToVideo:\n    INPUT_TYPES = {}\nclass MiniMaxH3SigmaShift:\n    INPUT_TYPES = {}\n"
    );
    fs.writeFileSync(
      path.join(mockComfyDir, "nodes.py"),
      "class LoraLoaderModelOnly:\n    INPUT_TYPES = {}\n"
    );
    fs.writeFileSync(
      path.join(mockComfyDir, "comfy_extras", "nodes_model_advanced.py"),
      "class ModelAttentionBackend:\n    INPUT_TYPES = {}\n"
    );
    fs.writeFileSync(
      path.join(mockComfyDir, "comfy_extras", "nodes_sparse_attention.py"),
      "class BlockSparseAttention:\n    INPUT_TYPES = {}\nclass ModelSparseAttention:\n    INPUT_TYPES = {}\nclass VedaSparseAttention:\n    INPUT_TYPES = {}\n"
    );
    execSync("git init -b main", { cwd: mockComfyDir });
    execSync('git config user.email "test@test.com"', { cwd: mockComfyDir });
    execSync('git config user.name "Test"', { cwd: mockComfyDir });
    execSync("git add .", { cwd: mockComfyDir });
    execSync('git commit -m "init"', { cwd: mockComfyDir });
    fs.writeFileSync(path.join(mockComfyDir, ".git", "HEAD"), `${PINNED_COMFYUI_CORE_REVISION}\n`);

    // Setup isolated upgrade ComfyUI dir (revision 94cfeb3a5d8985efaa7ea9f5e5dfad4184ec99bf)
    fs.mkdirSync(path.join(mockUpgradeComfyDir, "comfy_extras"), { recursive: true });
    fs.writeFileSync(
      path.join(mockUpgradeComfyDir, "comfy_extras", "nodes_minimax_h3.py"),
      "class MiniMaxH3ImageToVideo:\n    INPUT_TYPES = {}\nclass MiniMaxH3ReferenceToVideo:\n    INPUT_TYPES = {}\nclass MiniMaxH3SigmaShift:\n    INPUT_TYPES = {}\n"
    );
    fs.writeFileSync(
      path.join(mockUpgradeComfyDir, "nodes.py"),
      "class LoraLoaderModelOnly:\n    INPUT_TYPES = {}\n"
    );
    fs.writeFileSync(
      path.join(mockUpgradeComfyDir, "comfy_extras", "nodes_model_advanced.py"),
      "class ModelAttentionBackend:\n    INPUT_TYPES = {}\n"
    );
    fs.writeFileSync(
      path.join(mockUpgradeComfyDir, "comfy_extras", "nodes_sparse_attention.py"),
      "class BlockSparseAttention:\n    INPUT_TYPES = {}\nclass ModelSparseAttention:\n    INPUT_TYPES = {}\nclass VedaSparseAttention:\n    INPUT_TYPES = {}\n"
    );
    execSync("git init -b main", { cwd: mockUpgradeComfyDir });
    execSync('git config user.email "test@test.com"', { cwd: mockUpgradeComfyDir });
    execSync('git config user.name "Test"', { cwd: mockUpgradeComfyDir });
    execSync("git add .", { cwd: mockUpgradeComfyDir });
    execSync('git commit -m "init"', { cwd: mockUpgradeComfyDir });
    fs.writeFileSync(
      path.join(mockUpgradeComfyDir, ".git", "HEAD"),
      "94cfeb3a5d8985efaa7ea9f5e5dfad4184ec99bf\n"
    );

    const mockPythonScript = `#!/bin/sh
if [ "$1" = "-c" ]; then
  if echo "$2" | grep -q "torch.__version__"; then
    echo "2.5.1+cu124|12.4"
    exit 0
  fi
  if echo "$2" | grep -q "scaled_dot_product_attention" || echo "$2" | grep -q "sageattention" || echo "$2" | grep -q "comfy_kitchen" || echo "$2" | grep -q "veda_sparse_attention" || echo "$2" | grep -q "block_sparse"; then
    echo "ok"
    exit 0
  fi
  if echo "$2" | grep -q "dist_name = sys.argv\\[1\\]"; then
    if [ "$3" = "comfy-kitchen" ]; then
      if [ -n "$4" ] && [ "$4" != "0.2.34" ] && [ "$4" != "0.2.31" ]; then
        echo "version_mismatch:expected_$4_got_0.2.31"
        exit 1
      fi
      echo "ok"
      exit 0
    fi
    if [ "$3" = "sageattention" ] || [ "$3" = "veda-sparse-attention" ] || [ "$3" = "triton" ] || [ "$3" = "torch" ]; then
      echo "ok"
      exit 0
    fi
  fi
fi
exec /usr/bin/python3 "$@"
`;
    fs.writeFileSync(mockPythonPath, mockPythonScript, { mode: 0o755 });
  });

  afterAll(() => {
    if (fs.existsSync(mockRootDir)) {
      fs.rmSync(mockRootDir, { recursive: true, force: true });
    }
  });

  it("verifies real dense catalog entry against CurrentPinExperimentRuntimeAdapter with torch_sdpa alias", async () => {
    const entry = getAttentionCatalogEntry("dense", "i2v");
    const manifest = buildRequiredRuntimeManifestFromAttentionCatalog(entry, "i2v", {
      sourceFileHashes: {}
    });
    expect(manifest.attentionKernel).toBe("torch.nn.functional.scaled_dot_product_attention");

    const adapter = new CurrentPinExperimentRuntimeAdapter();
    const res = await adapter.verify({
      comfyUiDir: mockComfyDir,
      pythonPath: mockPythonPath,
      requiredRuntime: manifest
    });

    expect(res.ok).toBe(true);
    expect(res.status).toBe("verified");
  });

  it("verifies real sage catalog entry against CurrentPinExperimentRuntimeAdapter with sageattention alias", async () => {
    const entry = getAttentionCatalogEntry("sage", "i2v");
    const manifest = buildRequiredRuntimeManifestFromAttentionCatalog(entry, "i2v", {
      sourceFileHashes: {}
    });
    expect(manifest.attentionKernel).toBe("sageattention.sageattn");

    const adapter = new CurrentPinExperimentRuntimeAdapter();
    const res = await adapter.verify({
      comfyUiDir: mockComfyDir,
      pythonPath: mockPythonPath,
      requiredRuntime: manifest
    });

    expect(res.ok).toBe(true);
    expect(res.status).toBe("verified");
  });

  it("verifies CurrentPinExperimentRuntimeAdapter rejects real native-sol-attn catalog entry (requires isolated upgrade)", async () => {
    const entry = getAttentionCatalogEntry("native-sol-attn", "i2v", {
      coreRevision: "94cfeb3a5d8985efaa7ea9f5e5dfad4184ec99bf"
    });
    const manifest = buildRequiredRuntimeManifestFromAttentionCatalog(entry, "i2v", {
      sourceFileHashes: {}
    });
    expect(manifest.attentionKernel).toBe("comfy_kitchen.sol_attn");

    const adapter = new CurrentPinExperimentRuntimeAdapter();
    const res = await adapter.verify({
      comfyUiDir: mockComfyDir,
      pythonPath: mockPythonPath,
      requiredRuntime: manifest
    });

    expect(res.ok).toBe(false);
    expect(res.status).toBe("conflict");
  });

  it("verifies real native-sol-attn catalog entry against IsolatedUpgradeExperimentRuntimeAdapter", async () => {
    const entry = getAttentionCatalogEntry("native-sol-attn", "i2v", {
      coreRevision: "94cfeb3a5d8985efaa7ea9f5e5dfad4184ec99bf"
    });
    const manifest = buildRequiredRuntimeManifestFromAttentionCatalog(entry, "i2v", {
      sourceFileHashes: {}
    });
    expect(manifest.attentionKernel).toBe("comfy_kitchen.sol_attn");

    const adapter = new IsolatedUpgradeExperimentRuntimeAdapter(
      "94cfeb3a5d8985efaa7ea9f5e5dfad4184ec99bf",
      "sol-attn-upgrade-adapter",
      ["ModelSparseAttention"]
    );
    const res = await adapter.verify({
      comfyUiDir: mockUpgradeComfyDir,
      pythonPath: mockPythonPath,
      requiredRuntime: manifest
    });

    expect(res.ok).toBe(true);
    expect(res.status).toBe("verified");
  });

  it("verifies real veda catalog entry against IsolatedUpgradeExperimentRuntimeAdapter", async () => {
    const entry = getAttentionCatalogEntry("veda", "i2v");
    const manifest = buildRequiredRuntimeManifestFromAttentionCatalog(entry, "i2v", {
      sourceFileHashes: {}
    });
    expect(manifest.attentionKernel).toBe("veda_sparse_attention.triton_kernel");

    const adapter = new IsolatedUpgradeExperimentRuntimeAdapter(
      "94cfeb3a5d8985efaa7ea9f5e5dfad4184ec99bf",
      "veda-upgrade-adapter",
      ["VedaSparseAttention"]
    );
    const res = await adapter.verify({
      comfyUiDir: mockUpgradeComfyDir,
      pythonPath: mockPythonPath,
      requiredRuntime: manifest
    });

    expect(res.ok).toBe(true);
    expect(res.status).toBe("verified");
  });

  it("verifies ExperimentRuntimeRegistry dispatches real catalog manifests to the correct adapter", async () => {
    const registry = new ExperimentRuntimeRegistry();

    const denseEntry = getAttentionCatalogEntry("dense", "i2v");
    const denseManifest = buildRequiredRuntimeManifestFromAttentionCatalog(denseEntry, "i2v", {
      sourceFileHashes: {}
    });
    const denseRes = await registry.verify({
      comfyUiDir: mockComfyDir,
      pythonPath: mockPythonPath,
      requiredRuntime: denseManifest,
      requiredRuntimeDigest: sha256Hex(canonicalizeJson(denseManifest))
    });
    expect(denseRes.ok).toBe(true);
    expect(denseRes.status).toBe("verified");

    const solEntry = getAttentionCatalogEntry("native-sol-attn", "i2v", {
      coreRevision: "94cfeb3a5d8985efaa7ea9f5e5dfad4184ec99bf"
    });
    const solManifest = buildRequiredRuntimeManifestFromAttentionCatalog(solEntry, "i2v", {
      sourceFileHashes: {}
    });
    const solRes = await registry.verify({
      comfyUiDir: mockUpgradeComfyDir,
      pythonPath: mockPythonPath,
      requiredRuntime: solManifest,
      requiredRuntimeDigest: sha256Hex(canonicalizeJson(solManifest))
    });
    expect(solRes.ok).toBe(true);
    expect(solRes.status).toBe("verified");
  });

  describe("CLI continuity study commands and sidecar handling", () => {
    const refManifest = {
      referenceSetId: "refset-i2v-1",
      manifestDigest: "",
      references: [
        {
          slotIndex: 0,
          role: "first_frame",
          sourceAssetPath: "/test-assets/trinidad_subject_16x9.jpg",
          sourceSha256: "0".repeat(64),
          sourceSizeBytes: 1024,
          mimeType: "image/jpeg" as const,
          width: 1024,
          height: 585
        }
      ]
    };
    refManifest.manifestDigest = computeContinuityReferenceManifestDigest(refManifest);

    const dummyScenario: ContinuityScenario = {
      scenarioId: "sc-i2v-yellow",
      scenarioRole: "historical_baseline",
      subjectMotionIntent: "moving",
      route: "i2v",
      conditioningMode: "frame_anchored",
      status: "resolved",
      originalPrompt: {
        text: "A dancer in orange robe against a seamless yellow backdrop",
        digest: sha256Hex("A dancer in orange robe against a seamless yellow backdrop")
      },
      constrainedPrompts: [
        {
          promptId: "tight_01",
          label: "Tight wardrobe and background continuity",
          text: "A dancer in orange robe against a seamless yellow backdrop, maintaining constant bright studio lighting and exact yellow hue",
          digest: sha256Hex(
            "A dancer in orange robe against a seamless yellow backdrop, maintaining constant bright studio lighting and exact yellow hue"
          ),
          constraintsApplied: [
            "fixed_lighting",
            "fixed_background",
            "fixed_wardrobe",
            "camera_push_only"
          ]
        }
      ],
      referenceManifest: refManifest
    };

    const syntheticStudy = expandContinuityStudyPlan({
      studyId: "study-cli-test",
      sourceEvidenceReferences: [
        { url: "https://example.com/obs", assertion: "Observed lighting collapse at 3.3s" }
      ],
      scenarios: [dummyScenario],
      includeCheckpointArms: true
    });

    it("plan-study: emits deterministic study plan JSON and writes output", async () => {
      const { deps, stdout, stderr, store } = createMockDeps();
      store.files.set("study.json", JSON.stringify(syntheticStudy));

      const code = await runExperimentCli(
        [
          "plan-study",
          "--study",
          "study.json",
          "--output",
          "planned.json",
          "--output-root",
          ".ai-runs"
        ],
        deps
      );

      expect(code).toBe(0);
      expect(stderr).toEqual([]);
      expect(stdout.length).toBeGreaterThan(0);
      const parsed = JSON.parse(stdout[0]!);
      expect(parsed.studyId).toBe("study-cli-test");
      expect(parsed.cells.length).toBeGreaterThanOrEqual(8);
      expect(Array.from(store.files.keys()).some((k) => k.endsWith("planned.json"))).toBe(true);
    });

    it("plan-study: rejects when --study is missing", async () => {
      const { deps, stderr } = createMockDeps();
      const code = await runExperimentCli(["plan-study", "--output-root", ".ai-runs"], deps);
      expect(code).toBe(1);
      expect(stderr.some((e) => e.includes("--study (or --file) is required"))).toBe(true);
    });

    it("review-plan: builds storyboard plan with defect beats and review manifest pairs", async () => {
      const { deps, stdout, stderr, store } = createMockDeps();
      store.files.set("study.json", JSON.stringify(syntheticStudy));

      const code = await runExperimentCli(
        ["review-plan", "--study", "study.json", "--output-root", ".ai-runs"],
        deps
      );

      expect(code).toBe(0);
      expect(stderr).toEqual([]);
      const parsed = JSON.parse(stdout[0]!);
      expect(parsed.studyId).toBe("study-cli-test");
      expect(parsed.storyboardPlan.panels.length).toBe(syntheticStudy.cells.length);
      expect(parsed.reviewManifest.comparisonPairs.length).toBe(
        syntheticStudy.comparisonEdges.length
      );

      // Verify observation beats in planned samples
      const panel362f = parsed.storyboardPlan.panels.find(
        (p: { frames: number }) => p.frames === 362
      );
      expect(panel362f).toBeDefined();
      const sampleReasons = panel362f.plannedSamples.map(
        (s: { sampleReason: string }) => s.sampleReason
      );
      expect(sampleReasons).toContain("362f_collapse_window");
      expect(sampleReasons).toContain("362f_recovery");
    });

    it("prepare-study: rejects when target flags are missing", async () => {
      const { deps, stderr, store } = createMockDeps();
      store.files.set("study.json", JSON.stringify(syntheticStudy));

      const code = await runExperimentCli(
        ["prepare-study", "--study", "study.json", "--output-root", ".ai-runs"],
        deps
      );

      expect(code).toBe(1);
      expect(stderr.some((e) => e.includes("Missing required target flags"))).toBe(true);
    });

    it("prepare-study: prepares a specific cell when --cell is specified", async () => {
      const { deps, stdout, stderr, store } = createMockDeps();
      store.files.set("study.json", JSON.stringify(syntheticStudy));
      store.files.set(
        "templates/minimax_h3_720p_i2v_124f_api.json",
        JSON.stringify(mockI2vTemplate)
      );

      const targetCell = syntheticStudy.cells[0]!;
      const code = await runExperimentCli(
        [
          "prepare-study",
          "--study",
          "study.json",
          "--cell",
          targetCell.cellId,
          "--target-host",
          "rtx4090",
          "--gpu-uuid",
          "GPU-12345678-1234-1234-1234-123456789abc",
          "--comfyui-dir",
          "/opt/ComfyUI",
          "--python",
          "/opt/ComfyUI/.venv/bin/python3",
          "--output-root",
          ".ai-runs"
        ],
        deps
      );

      expect(stderr).toEqual([]);
      expect(code).toBe(0);
      const parsed = JSON.parse(stdout[0]!);
      expect(parsed.status).toBe("prepared");
      expect(parsed.preparedCount).toBe(1);
      expect(parsed.receipts[0].cellId).toBe(targetCell.cellId);
    });

    it("prepare-study: rejects when --cell flag is missing", async () => {
      const { deps, stderr, store } = createMockDeps();
      store.files.set("study.json", JSON.stringify(syntheticStudy));

      const code = await runExperimentCli(
        [
          "prepare-study",
          "--study",
          "study.json",
          "--target-host",
          "rtx4090",
          "--gpu-uuid",
          "GPU-12345678-1234-1234-1234-123456789abc",
          "--comfyui-dir",
          "/opt/ComfyUI",
          "--python",
          "/opt/ComfyUI/.venv/bin/python3",
          "--output-root",
          ".ai-runs"
        ],
        deps
      );

      expect(code).toBe(1);
      expect(stderr.some((e) => e.includes("--cell is required"))).toBe(true);
    });

    it("prepare-study: rejects combined arm without prerequisite reviews", async () => {
      const { deps, stderr, store } = createMockDeps();
      const combinedCell = {
        cellId: "cell-combined-test",
        scenarioId: syntheticStudy.scenarios[0]!.scenarioId,
        frames: 124 as const,
        arm: "combined" as const,
        promptVariantId: "tight_01",
        prompt: "Test prompt",
        promptDigest: sha256Hex("Test prompt"),
        status: "resolved" as const,
        prerequisiteCellIds: [syntheticStudy.cells[0]!.cellId]
      };
      const combinedStudyDraft = {
        ...syntheticStudy,
        cells: [...syntheticStudy.cells, combinedCell]
      };
      const combinedStudy = {
        ...combinedStudyDraft,
        studyDigest: computeContinuityStudyDigest(combinedStudyDraft)
      };
      store.files.set("study.json", JSON.stringify(combinedStudy));

      const code = await runExperimentCli(
        [
          "prepare-study",
          "--study",
          "study.json",
          "--cell",
          "cell-combined-test",
          "--target-host",
          "rtx4090",
          "--gpu-uuid",
          "GPU-12345678-1234-1234-1234-123456789abc",
          "--comfyui-dir",
          "/opt/ComfyUI",
          "--python",
          "/opt/ComfyUI/.venv/bin/python3",
          "--output-root",
          ".ai-runs"
        ],
        deps
      );

      expect(code).toBe(1);
      expect(stderr.some((e) => e.includes("without independent evaluations"))).toBe(true);
    });

    it("review-plan: binds observed run results when --runs is supplied", async () => {
      const { deps, stdout, stderr, store } = createMockDeps();
      store.files.set("study.json", JSON.stringify(syntheticStudy));

      const targetCell = syntheticStudy.cells[0]!;
      const runDir = resolve(".ai-runs", `${syntheticStudy.studyId}-${targetCell.cellId}`);
      const mockDescriptor = {
        schemaVersion: 2,
        runId: `${syntheticStudy.studyId}-${targetCell.cellId}`
          .toLowerCase()
          .replace(/[^a-z0-9._-]/g, "-"),
        route: "i2v",
        configuredFrames: targetCell.frames,
        descriptorDigest: sha256Hex("descriptor-digest"),
        operatorLabel: `${syntheticStudy.studyId}:${targetCell.cellId}`,
        attentionRequest: { attentionVariant: "dense" }
      };
      const mockResult = {
        execution: { status: "completed" },
        probe: {
          outputFile: "output.mp4",
          outputSha256: "0".repeat(64),
          outputSizeBytes: 1024,
          measuredFacts: { fps: 24, measuredFrames: targetCell.frames }
        }
      };

      await store.writeDescriptor(
        runDir,
        mockDescriptor as unknown as MinimaxH3AnyExperimentDescriptor
      );
      await store.writeResult(runDir, mockResult as unknown as MinimaxH3AnyExperimentResult);
      await store.writeDurableJson(`${runDir}/study_link.json`, {
        studyId: syntheticStudy.studyId,
        cellId: targetCell.cellId
      });

      const code = await runExperimentCli(
        ["review-plan", "--study", "study.json", "--runs", runDir, "--output-root", ".ai-runs"],
        deps
      );

      expect(code).toBe(0);
      expect(stderr).toEqual([]);
      const parsed = JSON.parse(stdout[0]!);
      const boundPanel = parsed.storyboardPlan.panels.find(
        (p: { cellId: string }) => p.cellId === targetCell.cellId
      );
      expect(boundPanel).toBeDefined();
      expect(boundPanel.mediaBinding.collectionStatus).toBe("available");
      expect(boundPanel.mediaBinding.outputSha256).toBe("0".repeat(64));
    });

    it("validate-sidecar & import-sidecar: validates and imports continuity_review sidecar idempotently", async () => {
      const { deps, stdout, stderr, store } = createMockDeps();
      const runId = "test-continuity-sidecar-run";
      await runExperimentCli(
        [
          "prepare",
          "--route",
          "i2v",
          "--frames",
          "124",
          "--seed",
          "42",
          "--inputs",
          "inputs.json",
          "--prompt",
          "A dancer in orange robe",
          "--target-host",
          "rtx4090",
          "--gpu-uuid",
          "GPU-12345678-1234-1234-1234-123456789abc",
          "--comfyui-dir",
          "/opt/comfyui",
          "--python",
          "/usr/bin/python3",
          "--run-id",
          runId,
          "--output-root",
          ".ai-runs"
        ],
        deps
      );
      expect(stderr).toEqual([]);
      const prepareOutput = JSON.parse(stdout[0]!);
      const runDir = prepareOutput.runDir;
      const descriptor = store.descriptor!;
      const descriptorDigest =
        ("descriptorDigest" in descriptor && descriptor.descriptorDigest) ||
        sha256Hex("descriptor");
      stdout.length = 0;

      const outputSha = sha256Hex("rendered-video");
      const currentResult = {
        schemaVersion: 1,
        runId,
        descriptorDigest,
        configDigest: sha256Hex("config"),
        comparisonKey: descriptor.comparisonKey,
        lifecycle: "completed",
        observedRunner: {
          argv: [],
          env: {},
          pid: 1234,
          processStartTimeTicks: 100,
          targetGpuUuid: "GPU-12345678-1234-1234-1234-123456789abc",
          effectiveMode: {
            status: "verified" as const,
            value: "dynamic_vram" as const,
            unknownReason: null,
            evidence: null
          }
        },
        timestamps: {
          preparedAt: new Date().toISOString(),
          startedAt: new Date().toISOString(),
          submittedAt: new Date().toISOString(),
          terminatedAt: new Date().toISOString()
        },
        execution: {
          status: "completed" as const,
          promptId: "prompt-1",
          terminalEvidence: { source: "history", status: "success" },
          engineError: null,
          latencyMs: 10000
        },
        collection: {
          status: "complete" as const,
          phaseCoverage: { before: true, during: true, after: true },
          sampleCount: { attempted: 1, succeeded: 1, failed: 0 },
          metrics: {
            gpuPeakUsedVramMb: 12000,
            gpuAllocatableVramMb: 24000,
            hostPeakRamUsedMb: 16000,
            processPeakRssMb: 8000,
            hostSwapUsedMb: 0,
            hostSwapDeltaMb: 0
          },
          errors: []
        },
        probe: {
          status: "succeeded" as const,
          outputFile: `${runDir}/outputs/video.mp4`,
          outputSha256: outputSha,
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
            audioSampleRate: 48000
          },
          discrepancyFlags: [],
          toolIdentity: null,
          errors: []
        },
        outputConformance: {
          status: "conformant" as const,
          checks: {
            frameCountMatches: true,
            geometryMatches: true,
            fpsMatches: true,
            timingWithinTolerance: true
          },
          reasons: []
        },
        visualReview: {
          status: "pending" as const,
          outputSha256: null,
          reviewedAt: null,
          reviewer: null,
          findings: null,
          notes: null,
          unavailableReason: null
        },
        operatorDecision: {
          status: "pending" as const,
          operator: null,
          decidedAt: null,
          comparisonKey: null,
          reason: null
        }
      };
      await store.writeResult(runDir, currentResult as unknown as MinimaxH3AnyExperimentResult);

      const passDimension = {
        assessment: "pass" as const,
        rationale: "Meets criteria",
        fullClipAssessment: true
      };
      const sidecarDraft = {
        schemaVersion: 1 as const,
        kind: "continuity-review-sidecar" as const,
        reviewId: "rev-cli-001",
        reviewRevision: 1,
        rubricVersion: 1 as const,
        rubricDigest: computeContinuityRubricDigest(),
        studyId: "study-cli-test",
        cellId: "cell-cli-001",
        runId,
        descriptorDigest,
        sourceOutputSha256: outputSha,
        route: "i2v" as const,
        configuredFrames: 124 as const,
        reviewer: "reviewer-alice",
        reviewedAt: new Date().toISOString(),
        reviewCoverage: {
          playbackExamined: true,
          audioExamined: true,
          fullClipExamined: true,
          storyboardSampled: true
        },
        dimensions: {
          identity: passDimension,
          wardrobe: passDimension,
          backgroundLightingPersistence: passDimension,
          cameraFidelity: passDimension,
          subjectAnatomy: passDimension,
          faceAndHands: passDimension,
          unnaturalCuts: passDimension,
          temporalFlicker: passDimension,
          referenceFidelity: passDimension,
          motionCoherence: passDimension,
          sound: passDimension,
          overallAdUsability: passDimension
        },
        sceneSubstitution: { detected: false, rationale: "Original scene preserved" },
        firstFrameAdherence: { status: "pass" as const, rationale: "Faithful start frame" },
        lastFrameAdherence: { status: "pass" as const, rationale: "Faithful end frame" },
        defectSpecificInspections: {
          wardrobe243fDepartureInspected: false,
          yellowBackdrop243fDepartureInspected: false,
          environment362fBlackoutInspected: false,
          environment362fRecoveryInspected: false,
          sceneSubstitution362fInspected: false,
          camera124fPushInspected: true,
          notes: "124f push inspected"
        },
        overallOutcome: "pass" as const,
        notes: "Excellent continuity"
      };
      const sidecar: MinimaxH3ContinuityReviewSidecar = {
        ...sidecarDraft,
        reviewDigest: computeContinuityReviewDigest(sidecarDraft)
      };

      store.files.set("review-sidecar.json", JSON.stringify(sidecar));
      store.fileHashes.set(`${runDir}/outputs/video.mp4`, {
        sha256: outputSha,
        sizeBytes: 5000000
      });

      // 1. validate-sidecar
      const valCode = await runExperimentCli(
        [
          "validate-sidecar",
          "--file",
          "review-sidecar.json",
          "--run-dir",
          runDir,
          "--output-root",
          ".ai-runs"
        ],
        deps
      );
      expect(valCode).toBe(0);
      expect(stderr).toEqual([]);
      const valOut = JSON.parse(stdout[stdout.length - 1]!);
      expect(valOut.status).toBe("valid");
      expect(valOut.sidecarType).toBe("continuity_review");

      // 2. import-sidecar
      const importCode = await runExperimentCli(
        [
          "import-sidecar",
          "--run-dir",
          runDir,
          "--sidecar",
          "review-sidecar.json",
          "--output-root",
          ".ai-runs"
        ],
        deps
      );
      expect(stderr).toEqual([]);
      expect(importCode).toBe(0);
      const importOut = JSON.parse(stdout[stdout.length - 1]!);
      expect(importOut.status).toBe("imported");
      expect(importOut.idempotent).toBe(false);

      // Verify result.visualReview was mapped
      const updatedResult = await store.readResult(runDir);
      expect(updatedResult?.visualReview.status).toBe("reviewed");
      expect(updatedResult?.visualReview.findings?.continuity).toBe("pass");
      expect(updatedResult?.visualReview.findings?.identityFidelity).toBe("pass");

      // 3. Idempotent re-import
      const reimportCode = await runExperimentCli(
        [
          "import-sidecar",
          "--run-dir",
          runDir,
          "--sidecar",
          "review-sidecar.json",
          "--output-root",
          ".ai-runs"
        ],
        deps
      );
      expect(reimportCode).toBe(0);
      const reimportOut = JSON.parse(stdout[stdout.length - 1]!);
      expect(reimportOut.idempotent).toBe(true);
    });

    it("validate-sidecar: rejects 243f review without wardrobe inspection", async () => {
      const { deps, stderr, store } = createMockDeps();
      const passDimension = { assessment: "pass" as const, rationale: "Pass" };
      const invalid243fReviewDraft = {
        schemaVersion: 1 as const,
        kind: "continuity-review-sidecar" as const,
        reviewId: "rev-243f",
        reviewRevision: 1,
        rubricVersion: 1 as const,
        rubricDigest: computeContinuityRubricDigest(),
        studyId: "study-cli-test",
        cellId: "cell-243f",
        runId: "run-243f",
        descriptorDigest: sha256Hex("desc"),
        sourceOutputSha256: sha256Hex("video"),
        route: "i2v" as const,
        configuredFrames: 243 as const,
        reviewer: "reviewer",
        reviewedAt: new Date().toISOString(),
        reviewCoverage: {
          playbackExamined: true,
          audioExamined: true,
          fullClipExamined: true,
          storyboardSampled: true
        },
        dimensions: {
          identity: passDimension,
          wardrobe: passDimension,
          backgroundLightingPersistence: passDimension,
          cameraFidelity: passDimension,
          subjectAnatomy: passDimension,
          faceAndHands: passDimension,
          unnaturalCuts: passDimension,
          temporalFlicker: passDimension,
          referenceFidelity: passDimension,
          motionCoherence: passDimension,
          sound: passDimension,
          overallAdUsability: passDimension
        },
        sceneSubstitution: { detected: false, rationale: "No substitution" },
        firstFrameAdherence: { status: "pass" as const, rationale: "Adhered" },
        lastFrameAdherence: { status: "pass" as const, rationale: "Adhered" },
        defectSpecificInspections: {
          wardrobe243fDepartureInspected: false, // Fails 243f requirement!
          yellowBackdrop243fDepartureInspected: false,
          environment362fBlackoutInspected: false,
          environment362fRecoveryInspected: false,
          sceneSubstitution362fInspected: false,
          camera124fPushInspected: false
        },
        overallOutcome: "pass" as const
      };
      const invalid243fReview = {
        ...invalid243fReviewDraft,
        reviewDigest: computeContinuityReviewDigest(invalid243fReviewDraft)
      };

      store.files.set("bad-243f-review.json", JSON.stringify(invalid243fReview));

      const code = await runExperimentCli(
        ["validate-sidecar", "--file", "bad-243f-review.json", "--output-root", ".ai-runs"],
        deps
      );

      expect(code).toBe(1);
      expect(stderr.some((e) => e.includes("wardrobe243fDepartureInspected"))).toBe(true);
    });

    it("validate-sidecar: rejects pass overallOutcome when scene substitution is detected", async () => {
      const { deps, stderr, store } = createMockDeps();
      const passDimension = { assessment: "pass" as const, rationale: "Pass" };
      const sceneSubReviewDraft = {
        schemaVersion: 1 as const,
        kind: "continuity-review-sidecar" as const,
        reviewId: "rev-sub",
        reviewRevision: 1,
        rubricVersion: 1 as const,
        rubricDigest: computeContinuityRubricDigest(),
        studyId: "study-cli-test",
        cellId: "cell-sub",
        runId: "run-sub",
        descriptorDigest: sha256Hex("desc"),
        sourceOutputSha256: sha256Hex("video"),
        route: "i2v" as const,
        configuredFrames: 124 as const,
        reviewer: "reviewer",
        reviewedAt: new Date().toISOString(),
        reviewCoverage: {
          playbackExamined: true,
          audioExamined: true,
          fullClipExamined: true,
          storyboardSampled: true
        },
        dimensions: {
          identity: passDimension,
          wardrobe: passDimension,
          backgroundLightingPersistence: passDimension,
          cameraFidelity: passDimension,
          subjectAnatomy: passDimension,
          faceAndHands: passDimension,
          unnaturalCuts: passDimension,
          temporalFlicker: passDimension,
          referenceFidelity: passDimension,
          motionCoherence: passDimension,
          sound: passDimension,
          overallAdUsability: passDimension
        },
        sceneSubstitution: {
          detected: true, // Scene substitution!
          intervals: [{ startSec: 1.0, endSec: 2.0 }],
          rationale: "Complete departure to different room"
        },
        firstFrameAdherence: { status: "defect" as const, rationale: "Not adhered" },
        lastFrameAdherence: { status: "defect" as const, rationale: "Not adhered" },
        defectSpecificInspections: {
          wardrobe243fDepartureInspected: false,
          yellowBackdrop243fDepartureInspected: false,
          environment362fBlackoutInspected: false,
          environment362fRecoveryInspected: false,
          sceneSubstitution362fInspected: false,
          camera124fPushInspected: true
        },
        overallOutcome: "pass" as const // Contradiction: scene substitution detected but marked as pass!
      };
      const sceneSubReview = {
        ...sceneSubReviewDraft,
        reviewDigest: computeContinuityReviewDigest(sceneSubReviewDraft)
      };

      store.files.set("scene-sub-review.json", JSON.stringify(sceneSubReview));

      const code = await runExperimentCli(
        ["validate-sidecar", "--file", "scene-sub-review.json", "--output-root", ".ai-runs"],
        deps
      );

      expect(code).toBe(1);
      expect(stderr.some((e) => e.includes("Scene substitution detected"))).toBe(true);
    });
  });
});
