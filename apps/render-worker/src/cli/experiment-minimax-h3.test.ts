import { basename, isAbsolute, relative, resolve } from "node:path";
import { describe, expect, it } from "vitest";
import {
  runExperimentCli,
  parseArgs,
  type ExperimentCliDependencies
} from "./experiment-minimax-h3.js";
import {
  MinimaxH3ExperimentService,
  canonicalizeJson,
  sha256Hex,
  type MinimaxH3ComfyUiTransportPort,
  type MinimaxH3ExperimentStorePort,
  type MinimaxH3OutputProberPort,
  type MinimaxH3ProcessRunnerPort,
  type MinimaxH3TargetPreflightPort,
  type MinimaxH3TelemetrySamplerPort
} from "@cco/application";
import type {
  MinimaxH3ExperimentDescriptor,
  MinimaxH3ExperimentEvent,
  MinimaxH3ExperimentIntent,
  MinimaxH3ExperimentReceipt,
  MinimaxH3ExperimentResult,
  MinimaxH3TelemetrySample
} from "@cco/contracts";

const mockI2vTemplate = {
  "15": { class_type: "RandomNoise", inputs: { noise_seed: 0 } },
  "20": { class_type: "LoadImage", inputs: { image: "ref.png" } },
  "92": { class_type: "SaveVideo", inputs: { filename_prefix: "minimax_h3_720p_i2v_124f" } },
  "104": {
    class_type: "MiniMaxH3ImageToVideo",
    inputs: { length: 124, width: 1344, height: 768, prompt: "base" }
  }
};

class MockStore implements MinimaxH3ExperimentStorePort {
  public files = new Map<string, string>();
  public descriptor: MinimaxH3ExperimentDescriptor | null = null;
  public config: Record<string, unknown> | null = null;
  public intent: MinimaxH3ExperimentIntent | null = null;
  public receipt: MinimaxH3ExperimentReceipt | null = null;
  public result: MinimaxH3ExperimentResult | null = null;

  public measurementTemplate: MinimaxH3ExperimentResult | null = null;

  async createRunDirectory(_runDir: string): Promise<void> {}
  async writeProcessRecord(): Promise<void> {}
  async readProcessRecord(): Promise<null> {
    return null;
  }
  async writeTerminalEvidence(): Promise<void> {}
  async readTerminalEvidence(): Promise<null> {
    return null;
  }
  async inspectAsset(): Promise<{ width: number; height: number; mimeType: string }> {
    return { width: 1344, height: 768, mimeType: "image/png" };
  }
  public deleteRunFilesCalls: Array<{ runDir: string; removeOutputs?: boolean | undefined }> = [];
  async deleteRunFiles(runDir: string, removeOutputs?: boolean): Promise<void> {
    this.deleteRunFilesCalls.push({ runDir, removeOutputs });
  }

  async writeDescriptor(_runDir: string, descriptor: MinimaxH3ExperimentDescriptor): Promise<void> {
    this.descriptor = descriptor;
  }
  async readDescriptor(_runDir: string): Promise<MinimaxH3ExperimentDescriptor> {
    if (!this.descriptor) throw new Error("Descriptor not found");
    return this.descriptor;
  }
  async writeConfig(_runDir: string, config: Record<string, unknown>): Promise<string> {
    this.config = config;
    return "c".repeat(64);
  }
  async readConfig(_runDir: string): Promise<Record<string, unknown>> {
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
  async writeResult(_runDir: string, result: MinimaxH3ExperimentResult): Promise<void> {
    this.result = result;
  }
  async readResult(): Promise<MinimaxH3ExperimentResult | null> {
    return this.result;
  }
  verifyContainment(targetPath: string, rootDir: string): boolean {
    const resolvedTarget = resolve(targetPath);
    const resolvedRoot = resolve(rootDir);
    const rel = relative(resolvedRoot, resolvedTarget);
    return !rel.startsWith("..") && !isAbsolute(rel);
  }
  async stageInputFile(): Promise<void> {}
  async hashFile(): Promise<{ sha256: string; sizeBytes: number }> {
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
});
