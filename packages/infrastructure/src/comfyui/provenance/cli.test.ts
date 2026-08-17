import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it, vi } from "vitest";
import { parseCliArgs, runCli, type ProvenanceCliDependencies } from "./cli.js";
import { DiskPreflightError, evaluateFreeSpaceReservation } from "./preflight.js";
import type { CertificationProfile } from "./profile-manifest.js";
import type { CertificationProvenanceReport } from "./collector.js";

describe("Provenance CLI", () => {
  const mockProfile: CertificationProfile = Object.freeze({
    id: "ltx-25-720p-97f",
    engine: "ltx_25",
    workflowPath: "/manifests/ltx_25_720p_97f_api.json",
    workflowRelativePath: "ltx_25_720p_97f_api.json",
    expectedWorkflowHash: "a".repeat(64),
    source: Object.freeze({
      kind: "official_upstream",
      uri: "https://github.com/Comfy-Org/ComfyUI_examples/tree/master/ltx_video",
      revision: "main",
      license: "Apache-2.0"
    }),
    baseline: Object.freeze({
      width: 1280,
      height: 720,
      frames: 97,
      steps: 8,
      approximateDurationSeconds: 5
    }),
    minFreeDiskGb: 100,
    runnerProfile: "dynamicvram-offload-v1",
    models: Object.freeze([
      {
        category: "diffusion_models" as const,
        relativePath: "ltx-video-2b-v0.9.1.safetensors"
      }
    ]),
    assertions: Object.freeze([
      {
        nodeId: "6",
        classType: "CLIPTextEncode",
        input: "text",
        equals: "prompt text"
      }
    ]),
    renderProfileIdentity: Object.freeze({
      key: "LTX_25_720P_5S_V1" as const,
      version: 1 as const
    })
  });

  const mockReport: CertificationProvenanceReport = Object.freeze({
    version: 1,
    profileId: "ltx-25-720p-97f",
    generatedAt: "2026-08-15T12:00:00.000Z",
    workflow: Object.freeze({
      relativePath: "ltx_25_720p_97f_api.json",
      sha256: "a".repeat(64),
      source: mockProfile.source
    }),
    models: Object.freeze([
      {
        category: "diffusion_models" as const,
        relativePath: "ltx-video-2b-v0.9.1.safetensors",
        key: "models/diffusion_models/ltx-video-2b-v0.9.1.safetensors",
        sha256: "c".repeat(64),
        bytes: 1000
      }
    ]),
    git: Object.freeze({
      comfyUiCommit: "d".repeat(40),
      customNodes: Object.freeze([])
    }),
    disk: Object.freeze({
      modelFootprintBytes: 1000,
      availableBytes: 200_000_000_000,
      requiredFreeBytes: 100_000_000_000,
      modelFootprintGb: 0.000001,
      availableGb: 200,
      minFreeDiskGb: 100,
      passes: true
    }),
    renderProfileProvenance: Object.freeze({
      key: "LTX_25_720P_5S_V1",
      version: 1,
      engine: "ltx_25" as const,
      workflowHash: "a".repeat(64),
      modelHashes: Object.freeze({
        "models/diffusion_models/ltx-video-2b-v0.9.1.safetensors": "c".repeat(64)
      }),
      frames: 97,
      steps: 8,
      runnerProfile: "dynamicvram-offload-v1",
      measuredDiskFootprintGb: 0.000001,
      minFreeDiskGb: 100
    })
  });

  const createMockIo = () => {
    const stdoutLines: string[] = [];
    const stderrLines: string[] = [];
    return {
      io: {
        stdout: (line: string) => stdoutLines.push(line),
        stderr: (line: string) => stderrLines.push(line)
      },
      stdoutLines,
      stderrLines
    };
  };

  it("CLI requires comfyui-dir and profile and rejects unknown flags", async () => {
    const loadProfileMock = vi.fn().mockResolvedValue(mockProfile);
    const collectMock = vi.fn().mockResolvedValue(mockReport);
    const deps: ProvenanceCliDependencies = {
      loadCertificationProfile: loadProfileMock,
      collectCertificationProvenance: collectMock
    };

    // Missing all required flags
    const { io: io1, stdoutLines: out1, stderrLines: err1 } = createMockIo();
    const code1 = await runCli([], io1, deps);
    expect(code1).toBe(1);
    expect(out1).toHaveLength(0);
    expect(err1.length).toBeGreaterThan(0);
    expect(err1[0]).toMatch(/missing required flag/i);
    expect(loadProfileMock).not.toHaveBeenCalled();

    // Missing --profile
    const { io: io2, stdoutLines: out2, stderrLines: err2 } = createMockIo();
    const code2 = await runCli(["--comfyui-dir", "/opt/comfyui"], io2, deps);
    expect(code2).toBe(1);
    expect(out2).toHaveLength(0);
    expect(err2.length).toBeGreaterThan(0);
    expect(err2[0]).toMatch(/--profile/i);
    expect(loadProfileMock).not.toHaveBeenCalled();

    // Missing --comfyui-dir
    const { io: io3, stdoutLines: out3, stderrLines: err3 } = createMockIo();
    const code3 = await runCli(["--profile", "ltx-25-720p-97f"], io3, deps);
    expect(code3).toBe(1);
    expect(out3).toHaveLength(0);
    expect(err3.length).toBeGreaterThan(0);
    expect(err3[0]).toMatch(/--comfyui-dir/i);
    expect(loadProfileMock).not.toHaveBeenCalled();

    // Unknown flag
    const { io: io4, stdoutLines: out4, stderrLines: err4 } = createMockIo();
    const code4 = await runCli(
      ["--comfyui-dir", "/opt/comfyui", "--profile", "ltx-25-720p-97f", "--unexpected"],
      io4,
      deps
    );
    expect(code4).toBe(1);
    expect(out4).toHaveLength(0);
    expect(err4.length).toBeGreaterThan(0);
    expect(err4[0]).toMatch(/unknown flag.*--unexpected/i);
    expect(loadProfileMock).not.toHaveBeenCalled();

    // Duplicate flag
    const { io: io5, stdoutLines: out5, stderrLines: err5 } = createMockIo();
    const code5 = await runCli(
      [
        "--comfyui-dir",
        "/opt/comfyui",
        "--profile",
        "ltx-25-720p-97f",
        "--profile",
        "flux-schnell-draft"
      ],
      io5,
      deps
    );
    expect(code5).toBe(1);
    expect(out5).toHaveLength(0);
    expect(err5.length).toBeGreaterThan(0);
    expect(err5[0]).toMatch(/duplicate flag.*--profile/i);
    expect(loadProfileMock).not.toHaveBeenCalled();

    // Flag with missing value at end of argv
    const { io: io6, stdoutLines: out6, stderrLines: err6 } = createMockIo();
    const code6 = await runCli(["--comfyui-dir", "/opt/comfyui", "--profile"], io6, deps);
    expect(code6).toBe(1);
    expect(out6).toHaveLength(0);
    expect(err6.length).toBeGreaterThan(0);
    expect(err6[0]).toMatch(/requires a value/i);
    expect(loadProfileMock).not.toHaveBeenCalled();

    // Flag with next arg being a flag (missing value)
    const { io: io7, stdoutLines: out7, stderrLines: err7 } = createMockIo();
    const code7 = await runCli(["--comfyui-dir", "--profile", "ltx-25-720p-97f"], io7, deps);
    expect(code7).toBe(1);
    expect(out7).toHaveLength(0);
    expect(err7.length).toBeGreaterThan(0);
    expect(err7[0]).toMatch(/requires a value/i);
    expect(loadProfileMock).not.toHaveBeenCalled();

    // parseCliArgs throws on invalid args
    expect(() => parseCliArgs([])).toThrow(/missing required flag/i);
    expect(() => parseCliArgs(["--comfyui-dir", "/path"])).toThrow(/--profile/i);
    expect(() => parseCliArgs(["--unknown"])).toThrow(/unknown flag/i);
  });

  it("CLI help has no provenance side effects", async () => {
    const loadProfileMock = vi.fn().mockResolvedValue(mockProfile);
    const collectMock = vi.fn().mockResolvedValue(mockReport);
    const deps: ProvenanceCliDependencies = {
      loadCertificationProfile: loadProfileMock,
      collectCertificationProvenance: collectMock
    };

    const { io, stdoutLines, stderrLines } = createMockIo();
    const exitCode = await runCli(["--help"], io, deps);

    expect(exitCode).toBe(0);
    expect(stderrLines).toHaveLength(0);
    expect(stdoutLines).toHaveLength(1);
    expect(stdoutLines[0]).toContain("--comfyui-dir");
    expect(stdoutLines[0]).toContain("--profile");
    expect(stdoutLines[0]).toContain("--manifest");
    expect(loadProfileMock).not.toHaveBeenCalled();
    expect(collectMock).not.toHaveBeenCalled();

    // Short flag -h also works
    const { io: ioShort, stdoutLines: outShort, stderrLines: errShort } = createMockIo();
    const codeShort = await runCli(["-h"], ioShort, deps);
    expect(codeShort).toBe(0);
    expect(errShort).toHaveLength(0);
    expect(outShort).toHaveLength(1);
    expect(loadProfileMock).not.toHaveBeenCalled();
    expect(collectMock).not.toHaveBeenCalled();

    // parseCliArgs returns kind: "help"
    expect(parseCliArgs(["--help"])).toEqual({ kind: "help" });
    expect(parseCliArgs(["-h"])).toEqual({ kind: "help" });
  });

  it("CLI writes progress only to stderr and one JSON report to stdout", async () => {
    const loadProfileMock = vi.fn().mockResolvedValue(mockProfile);
    const collectMock = vi.fn().mockImplementation(async ({ onProgress }) => {
      onProgress?.({ phase: "preflight", status: "started" });
      onProgress?.({ phase: "preflight", status: "completed" });
      onProgress?.({ phase: "git", status: "started" });
      onProgress?.({ phase: "git", status: "completed" });
      onProgress?.({ phase: "workflow_hash", status: "started" });
      onProgress?.({ phase: "workflow_hash", status: "completed" });
      onProgress?.({
        phase: "model_hash",
        status: "started",
        detail: "models/diffusion_models/ltx.safetensors"
      });
      onProgress?.({
        phase: "model_hash",
        status: "completed",
        detail: "models/diffusion_models/ltx.safetensors"
      });
      return mockReport;
    });

    const deps: ProvenanceCliDependencies = {
      loadCertificationProfile: loadProfileMock,
      collectCertificationProvenance: collectMock
    };

    const { io, stdoutLines, stderrLines } = createMockIo();
    const exitCode = await runCli(
      [
        "--comfyui-dir",
        "/opt/comfyui",
        "--profile",
        "ltx-25-720p-97f",
        "--manifest",
        "/tmp/custom-manifest.json"
      ],
      io,
      deps
    );

    expect(exitCode).toBe(0);
    expect(stdoutLines).toHaveLength(1);

    const firstLine = stdoutLines[0];
    expect(firstLine).toBeDefined();
    const parsedJson = JSON.parse(firstLine!);
    expect(parsedJson).toEqual(mockReport);

    expect(stderrLines.length).toBeGreaterThanOrEqual(4);
    for (const line of stderrLines) {
      expect(line).toMatch(/preflight|git|workflow_hash|model_hash/);
    }
  });

  it("CLI returns failure without partial JSON when preflight or collection fails", async () => {
    // Case 1: DiskPreflightError
    const preflightResult = evaluateFreeSpaceReservation(10_000_000_000, 5_000_000_000, 100);
    const preflightError = new DiskPreflightError(preflightResult);

    const loadProfileMock1 = vi.fn().mockResolvedValue(mockProfile);
    const collectMock1 = vi.fn().mockRejectedValue(preflightError);

    const deps1: ProvenanceCliDependencies = {
      loadCertificationProfile: loadProfileMock1,
      collectCertificationProvenance: collectMock1
    };

    const { io: io1, stdoutLines: out1, stderrLines: err1 } = createMockIo();
    const exitCode1 = await runCli(
      ["--comfyui-dir", "/opt/comfyui", "--profile", "ltx-25-720p-97f"],
      io1,
      deps1
    );

    expect(exitCode1).toBe(1);
    expect(out1).toHaveLength(0);
    expect(err1).toHaveLength(1);
    expect(err1[0]).toContain(preflightError.message);

    // Case 2: Manifest loading error (profile not found)
    const manifestError = new Error('Profile "missing-profile" not found in manifest');
    const loadProfileMock2 = vi.fn().mockRejectedValue(manifestError);
    const collectMock2 = vi.fn().mockResolvedValue(mockReport);

    const deps2: ProvenanceCliDependencies = {
      loadCertificationProfile: loadProfileMock2,
      collectCertificationProvenance: collectMock2
    };

    const { io: io2, stdoutLines: out2, stderrLines: err2 } = createMockIo();
    const exitCode2 = await runCli(
      ["--comfyui-dir", "/opt/comfyui", "--profile", "missing-profile"],
      io2,
      deps2
    );

    expect(exitCode2).toBe(1);
    expect(out2).toHaveLength(0);
    expect(err2).toHaveLength(1);
    expect(err2[0]).toContain(manifestError.message);
    expect(collectMock2).not.toHaveBeenCalled();
  });

  it("CLI forwards the selected profile and configured ComfyUI path", async () => {
    const loadProfileMock = vi.fn().mockResolvedValue(mockProfile);
    const collectMock = vi.fn().mockResolvedValue(mockReport);
    const deps: ProvenanceCliDependencies = {
      loadCertificationProfile: loadProfileMock,
      collectCertificationProvenance: collectMock
    };

    const customComfyDir = "/custom/isolated/comfyui";
    const customProfileId = "flux-schnell-draft";
    const customManifest = "/custom/path/manifest.json";

    const { io, stdoutLines, stderrLines } = createMockIo();
    const exitCode = await runCli(
      ["--comfyui-dir", customComfyDir, "--profile", customProfileId, "--manifest", customManifest],
      io,
      deps
    );

    expect(exitCode).toBe(0);
    expect(stderrLines).toHaveLength(0);
    expect(stdoutLines).toHaveLength(1);

    expect(loadProfileMock).toHaveBeenCalledWith(customManifest, customProfileId);
    expect(collectMock).toHaveBeenCalledWith(
      expect.objectContaining({
        comfyUiDir: customComfyDir,
        profile: mockProfile
      })
    );

    // Test parseCliArgs option extraction and default manifest path
    const parsed = parseCliArgs(["--comfyui-dir", customComfyDir, "--profile", customProfileId]);

    expect(parsed.kind).toBe("run");
    if (parsed.kind === "run") {
      expect(parsed.options.comfyUiDir).toBe(customComfyDir);
      expect(parsed.options.profileId).toBe(customProfileId);
      expect(parsed.options.manifestPath).toMatch(/templates\/provenance\.json$/);
    }

    // Test --flag=value format
    const parsedEquals = parseCliArgs([
      `--comfyui-dir=${customComfyDir}`,
      `--profile=${customProfileId}`,
      `--manifest=${customManifest}`
    ]);

    expect(parsedEquals).toEqual({
      kind: "run",
      options: {
        comfyUiDir: customComfyDir,
        profileId: customProfileId,
        manifestPath: customManifest
      }
    });

    // Test pnpm argument separator --
    const parsedWithSeparator = parseCliArgs([
      "--",
      "--comfyui-dir",
      customComfyDir,
      "--profile",
      customProfileId
    ]);

    expect(parsedWithSeparator.kind).toBe("run");
    if (parsedWithSeparator.kind === "run") {
      expect(parsedWithSeparator.options.comfyUiDir).toBe(customComfyDir);
      expect(parsedWithSeparator.options.profileId).toBe(customProfileId);
    }
  });

  it("infrastructure provenance script exposes the TypeScript entrypoint", async () => {
    const packageJsonPath = resolve(
      fileURLToPath(new URL("../../../package.json", import.meta.url))
    );
    const content = await readFile(packageJsonPath, "utf8");
    const parsed = JSON.parse(content);

    expect(parsed.scripts).toBeDefined();
    expect(parsed.scripts.provenance).toBe("tsx src/comfyui/provenance/cli.ts");
  });
});
