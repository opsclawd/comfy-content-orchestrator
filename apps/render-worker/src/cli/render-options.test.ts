import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { getRenderUsageHelp, parseRenderCliArgs, type RenderCliOptions } from "./render-options.js";

const defaultManifestPath = resolve(
  fileURLToPath(new URL("../../../../templates/provenance.json", import.meta.url))
);

const requiredOptions = {
  profile: "ltx-25-720p-97f",
  comfyUiDir: "/opt/ComfyUI",
  comfyUiUrl: "http://127.0.0.1:8188",
  goldMasterProvenance: "/var/lib/comfy/gold-master.json"
} as const;

function requiredArgs(): string[] {
  return [
    "--profile",
    requiredOptions.profile,
    "--comfyui-dir",
    requiredOptions.comfyUiDir,
    "--comfyui-url",
    requiredOptions.comfyUiUrl,
    "--gold-master-provenance",
    requiredOptions.goldMasterProvenance
  ];
}

function runOptions(parsed: ReturnType<typeof parseRenderCliArgs>): RenderCliOptions {
  expect(parsed.kind).toBe("run");
  if (parsed.kind !== "run") {
    throw new Error("expected run options");
  }
  return parsed.options;
}

describe("render CLI options", () => {
  it("returns help without requiring render options", () => {
    expect(parseRenderCliArgs(["--help"])).toEqual({ kind: "help" });
    expect(parseRenderCliArgs(["-h", "--unknown", "--profile"])).toEqual({ kind: "help" });

    const usage = getRenderUsageHelp();
    expect(usage).toContain("lock path must be on a local filesystem");
    expect(usage).toContain("contention returns non-zero immediately");
  });

  it("parses the required host and provenance options", () => {
    const separated = runOptions(parseRenderCliArgs(requiredArgs()));
    const equals = runOptions(
      parseRenderCliArgs([
        `--profile=${requiredOptions.profile}`,
        `--comfyui-dir=${requiredOptions.comfyUiDir}`,
        `--comfyui-url=${requiredOptions.comfyUiUrl}`,
        `--gold-master-provenance=${requiredOptions.goldMasterProvenance}`
      ])
    );

    expect(separated).toEqual(equals);
    expect(Object.isFrozen(separated)).toBe(true);
    expect(Object.isFrozen(equals)).toBe(true);
  });

  it("uses stable manifest gpu lease and timeout defaults", () => {
    const options = runOptions(parseRenderCliArgs(requiredArgs()));

    expect(options).toMatchObject({
      manifestPath: defaultManifestPath,
      licenseRegistryPath: resolve(
        fileURLToPath(
          new URL("../../../../config/component-license-registry.json", import.meta.url)
        )
      ),
      gpuIndex: 0,
      leasePath: join(tmpdir(), "comfy-content-orchestrator-gpu-0.lock"),
      renderTimeoutMs: 300_000
    });
  });

  it("rejects unknown duplicate missing and positional arguments", () => {
    expect(() => parseRenderCliArgs([...requiredArgs(), "--unknown"])).toThrow(
      "Unknown flag: --unknown"
    );
    expect(() => parseRenderCliArgs([...requiredArgs(), "--profile", "other-profile"])).toThrow(
      "Duplicate flag: --profile"
    );
    expect(() => parseRenderCliArgs(["--profile"])).toThrow('Flag "--profile" requires a value');
    expect(() => parseRenderCliArgs([...requiredArgs(), "unexpected"])).toThrow(
      "Unexpected argument: unexpected"
    );
  });

  it("rejects invalid gpu indices and render timeouts", () => {
    expect(() => parseRenderCliArgs([...requiredArgs(), "--gpu-index", "-1"])).toThrow(
      'non-negative integer, received: "-1"'
    );
    expect(() => parseRenderCliArgs([...requiredArgs(), "--gpu-index", "1.5"])).toThrow(
      'non-negative integer, received: "1.5"'
    );
    expect(() => parseRenderCliArgs([...requiredArgs(), "--render-timeout-ms", "0"])).toThrow(
      'positive integer, received: "0"'
    );
    expect(() => parseRenderCliArgs([...requiredArgs(), "--render-timeout-ms", "nope"])).toThrow(
      'positive integer, received: "nope"'
    );
  });

  it("derives stable job and scene identities from the selected profile", () => {
    const options = runOptions(
      parseRenderCliArgs([
        "--profile=flux-schnell-draft",
        `--comfyui-dir=${requiredOptions.comfyUiDir}`,
        `--comfyui-url=${requiredOptions.comfyUiUrl}`,
        `--gold-master-provenance=${requiredOptions.goldMasterProvenance}`
      ])
    );

    expect(options.renderJobId).toBe("cli-render-flux-schnell-draft");
    expect(options.sceneId).toBe("cli-scene-flux-schnell-draft");
  });

  it("accepts explicit relative lease and manifest paths", () => {
    const options = runOptions(
      parseRenderCliArgs([
        ...requiredArgs(),
        "--manifest",
        "./local/provenance.json",
        "--lease-path=./local/gpu.lock",
        "--gpu-index=2",
        "--render-job-id=render-local",
        "--scene-id=scene-local"
      ])
    );

    expect(options.manifestPath).toBe("./local/provenance.json");
    expect(options.licenseRegistryPath).toBe(
      resolve(
        fileURLToPath(
          new URL("../../../../config/component-license-registry.json", import.meta.url)
        )
      )
    );
    expect(options.leasePath).toBe("./local/gpu.lock");
    expect(options.gpuIndex).toBe(2);
    expect(options.renderJobId).toBe("render-local");
    expect(options.sceneId).toBe("scene-local");
  });

  it("accepts explicit custom license-registry-path", () => {
    const options = runOptions(
      parseRenderCliArgs([
        ...requiredArgs(),
        "--license-registry-path",
        "./custom/license-registry.json"
      ])
    );
    expect(options.licenseRegistryPath).toBe("./custom/license-registry.json");
  });
});
