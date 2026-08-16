import { describe, expect, it } from "vitest";
import {
  collectRunnerEnvironment,
  type RunnerEnvironmentDependencies
} from "./runner-environment.js";

const comfyUiPid = 4242;

function createDependencies(
  overrides: Partial<RunnerEnvironmentDependencies> = {}
): RunnerEnvironmentDependencies {
  return {
    os: {
      platform: () => "linux",
      arch: () => "x64",
      release: () => "6.8.0-40-generic",
      version: () => "#40-Ubuntu SMP PREEMPT_DYNAMIC",
      cpus: () => [
        { model: "AMD Ryzen 9 7950X" },
        { model: "AMD Ryzen 9 7950X" },
        { model: "AMD Ryzen 9 7950X" },
        { model: "AMD Ryzen 9 7950X" }
      ]
    },
    readFile: async (path) => {
      if (path === `/proc/${comfyUiPid}/cmdline`) {
        return "python3\u0000/opt/ComfyUI/main.py\u0000--listen\u00000.0.0.0\u0000--port\u00008188\u0000";
      }
      throw new Error(`Unexpected file read: ${path}`);
    },
    execFile: async (_file, args) => {
      if (args[0] === "--query-gpu=name,uuid,driver_version,memory.total") {
        return { stdout: "NVIDIA GeForce RTX 4090, GPU-abc, 550.54.14, 24564\n" };
      }
      return {
        stdout: "NVIDIA-SMI 550.54.14    Driver Version: 550.54.14    CUDA Version: 12.4\n"
      };
    },
    ...overrides
  };
}

describe("collectRunnerEnvironment", () => {
  // Behavioral invariant: environment-is-observed
  it("collects the complete reproducibility environment record", async () => {
    const environment = await collectRunnerEnvironment(
      {
        comfyUiPid
      },
      createDependencies()
    );

    expect(environment).toEqual({
      nodeVersion: process.version,
      platform: "linux",
      arch: "x64",
      osRelease: "6.8.0-40-generic",
      osVersion: "#40-Ubuntu SMP PREEMPT_DYNAMIC",
      cpuModel: "AMD Ryzen 9 7950X",
      cpuCount: 4,
      gpuName: "NVIDIA GeForce RTX 4090",
      gpuUuid: "GPU-abc",
      gpuDriverVersion: "550.54.14",
      gpuTotalMemoryMb: 24564,
      cudaVersion: "12.4",
      comfyUiPid,
      comfyUiArgs: ["python3", "/opt/ComfyUI/main.py", "--listen", "0.0.0.0", "--port", "8188"]
    });
  });

  // Behavioral invariant: argv-preserves-boundaries
  it("parses ComfyUI startup arguments without losing argument boundaries", async () => {
    const dependencies = createDependencies({
      readFile: async (path) => {
        if (path === `/proc/${comfyUiPid}/cmdline`) {
          return "python3\u0000main.py\u0000--extra-model-paths-config\u0000path with spaces.yaml\u0000--flag=value with spaces\u0000";
        }
        throw new Error(`Unexpected file read: ${path}`);
      }
    });

    const environment = await collectRunnerEnvironment({ comfyUiPid }, dependencies);

    expect(environment.comfyUiArgs).toEqual([
      "python3",
      "main.py",
      "--extra-model-paths-config",
      "path with spaces.yaml",
      "--flag=value with spaces"
    ]);
  });

  // Behavioral invariant: unsupported-gpu-is-data
  it("records the reported GPU identity verbatim", async () => {
    const dependencies = createDependencies({
      execFile: async (_file, args) => {
        if (args[0] === "--query-gpu=name,uuid,driver_version,memory.total") {
          return { stdout: "NVIDIA GeForce RTX 3080 Ti, GPU-unsupported, 535.129.03, 12288\n" };
        }
        return { stdout: "NVIDIA-SMI 535.129.03    Driver Version: 535.129.03\n" };
      }
    });

    const environment = await collectRunnerEnvironment({ comfyUiPid }, dependencies);

    expect(environment.gpuName).toBe("NVIDIA GeForce RTX 3080 Ti");
    expect(environment.gpuUuid).toBe("GPU-unsupported");
    expect(environment.gpuDriverVersion).toBe("535.129.03");
    expect(environment.gpuTotalMemoryMb).toBe(12288);
    expect(environment.cudaVersion).toBeNull();
  });

  // Behavioral invariant: missing-identity-is-loud
  it("rejects incomplete GPU or ComfyUI process identity", async () => {
    const malformedGpu = createDependencies({
      execFile: async (_file, args) => {
        if (args[0] === "--query-gpu=name,uuid,driver_version,memory.total") {
          return { stdout: "NVIDIA GeForce RTX 4090, , 550.54.14, 24564\n" };
        }
        return { stdout: "CUDA Version: 12.4\n" };
      }
    });
    await expect(collectRunnerEnvironment({ comfyUiPid }, malformedGpu)).rejects.toThrow(
      /GPU identity/i
    );

    const unreadableCmdline = createDependencies({
      readFile: async (path) => {
        if (path === `/proc/${comfyUiPid}/cmdline`) {
          throw new Error("EACCES: permission denied");
        }
        throw new Error(`Unexpected file read: ${path}`);
      }
    });
    await expect(collectRunnerEnvironment({ comfyUiPid }, unreadableCmdline)).rejects.toThrow(
      /ComfyUI command line/i
    );
  });
});
