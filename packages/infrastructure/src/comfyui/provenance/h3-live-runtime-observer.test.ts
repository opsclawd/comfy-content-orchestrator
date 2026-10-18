import { describe, expect, it, vi } from "vitest";
import { H3LiveRuntimeObserver } from "./h3-live-runtime-observer.js";

describe("H3LiveRuntimeObserver", () => {
  it("observes live runtime with matching host and GPU", async () => {
    const observer = new H3LiveRuntimeObserver({
      getHostname: () => "render-node-01",
      queryGpuUuids: async () => [
        "GPU-11111111-1111-1111-1111-111111111111",
        "GPU-22222222-2222-2222-2222-222222222222"
      ],
      inspectProcess: async (pid: number) => ({
        pid,
        startTimeTicks: 1234567,
        executable: "/opt/venv/bin/python3",
        cmdline: ["python3", "main.py", "--dynamicvram"]
      }),
      getProcessCwd: async () => "/home/comfy/ComfyUI",
      getProcessGpuUuids: async () => ["GPU-22222222-2222-2222-2222-222222222222"],
      getComfyUiRevision: async () => "55b6a9b11dffecdd65a3ccd5eb6a1b3a178c96dc",
      inspectCustomNodes: async () => ({
        "comfyui-sageattention": {
          revision: "rev-1",
          sourceHash: "abcdefabcdefabcdefabcdefabcdefabcdefabcdefabcdefabcdefabcdefabcd"
        }
      }),
      inspectPackageVersions: async () => ({
        torch: "2.5.1+cu124",
        sageattention: "0.2.1"
      })
    });

    const result = await observer.observeCurrentRuntime({
      hostname: "render-node-01",
      gpuUuid: "GPU-22222222-2222-2222-2222-222222222222",
      pid: 4567,
      comfyUiDir: "/home/comfy/ComfyUI"
    });

    expect(result.ok).toBe(true);
    expect(result.observation).toBeDefined();
    if (result.observation) {
      expect(result.observation.hostname).toBe("render-node-01");
      expect(result.observation.gpuUuid).toBe("GPU-22222222-2222-2222-2222-222222222222");
      expect(result.observation.pid).toBe(4567);
      expect(result.observation.processStartTimeTicks).toBe(1234567);
      expect(result.observation.comfyUiCoreRevision).toBe(
        "55b6a9b11dffecdd65a3ccd5eb6a1b3a178c96dc"
      );
      expect(result.observation.customNodes["comfyui-sageattention"]?.revision).toBe("rev-1");
      expect(result.observation.packageVersions.torch).toBe("2.5.1+cu124");
    }
  });

  it("fails closed when target GPU UUID is not found among host GPUs", async () => {
    const observer = new H3LiveRuntimeObserver({
      getHostname: () => "render-node-01",
      queryGpuUuids: async () => ["GPU-11111111-1111-1111-1111-111111111111"]
    });

    const result = await observer.observeCurrentRuntime({
      hostname: "render-node-01",
      gpuUuid: "GPU-nonexistent-gpu",
      pid: 1234
    });

    expect(result.ok).toBe(false);
    expect(result.blocker).toMatch(/was not found among host GPUs/i);
  });

  it("fails closed when GPU observation fails (e.g. nvidia-smi missing / error - no ENOENT tolerance)", async () => {
    const observer = new H3LiveRuntimeObserver({
      getHostname: () => "render-node-01",
      queryGpuUuids: async () => {
        throw new Error("Command failed: nvidia-smi: not found (ENOENT)");
      }
    });

    const result = await observer.observeCurrentRuntime({
      hostname: "render-node-01",
      gpuUuid: "GPU-1234",
      pid: 1234
    });

    expect(result.ok).toBe(false);
    expect(result.blocker).toMatch(/GPU observation failed.*nvidia-smi must be available/i);
  });

  it("fails closed when target process inspection fails", async () => {
    const observer = new H3LiveRuntimeObserver({
      getHostname: () => "render-node-01",
      queryGpuUuids: async () => ["GPU-1234"],
      inspectProcess: async () => {
        throw new Error("Process 99999 not running (ENOENT)");
      }
    });

    const result = await observer.observeCurrentRuntime({
      hostname: "render-node-01",
      gpuUuid: "GPU-1234",
      pid: 99999
    });

    expect(result.ok).toBe(false);
    expect(result.blocker).toMatch(/failed to inspect target process/i);
  });

  it("fails closed when ComfyUI git revision inspection fails", async () => {
    const observer = new H3LiveRuntimeObserver({
      getHostname: () => "render-node-01",
      queryGpuUuids: async () => ["GPU-1234"],
      inspectProcess: async (pid) => ({
        pid,
        startTimeTicks: 1000,
        executable: "/bin/python3",
        cmdline: ["python3"]
      }),
      getProcessCwd: async () => "/home/comfy/ComfyUI",
      getProcessGpuUuids: async () => ["GPU-1234"],
      getComfyUiRevision: async () => {
        throw new Error("fatal: not a git repository");
      }
    });

    const result = await observer.observeCurrentRuntime({
      hostname: "render-node-01",
      gpuUuid: "GPU-1234",
      pid: 100,
      comfyUiDir: "/home/comfy/ComfyUI"
    });

    expect(result.ok).toBe(false);
    expect(result.blocker).toMatch(/failed to inspect ComfyUI git revision/i);
  });

  it("fails closed when observed hostname mismatches target hostname", async () => {
    const observer = new H3LiveRuntimeObserver({
      getHostname: () => "actual-host-01"
    });

    const result = await observer.observeCurrentRuntime({
      hostname: "expected-host-02",
      gpuUuid: "GPU-1234",
      pid: 100
    });

    expect(result.ok).toBe(false);
    expect(result.blocker).toMatch(
      /Observed hostname "actual-host-01" does not match target hostname "expected-host-02"/i
    );
  });

  it("fails closed when comfyUiEndpoint is remote", async () => {
    const observer = new H3LiveRuntimeObserver({
      getHostname: () => "render-node-01"
    });

    const result = await observer.observeCurrentRuntime({
      hostname: "render-node-01",
      gpuUuid: "GPU-1234",
      pid: 100,
      comfyUiEndpoint: "http://remote-server.corp:8188"
    });

    expect(result.ok).toBe(false);
    expect(result.blocker).toMatch(
      /is remote.*live runtime observation requires local process access/i
    );
  });

  it("fails closed when target pid is missing", async () => {
    const observer = new H3LiveRuntimeObserver({
      getHostname: () => "render-node-01",
      queryGpuUuids: async () => ["GPU-1234"]
    });

    const result = await observer.observeCurrentRuntime({
      hostname: "render-node-01",
      gpuUuid: "GPU-1234"
    });

    expect(result.ok).toBe(false);
    expect(result.blocker).toMatch(/Target PID is required/i);
  });

  it("detects process continuity and restarts/drift", async () => {
    const inspectMock = vi
      .fn()
      .mockResolvedValueOnce({
        pid: 1234,
        startTimeTicks: 5000,
        executable: "/bin/python3",
        cmdline: []
      })
      .mockResolvedValueOnce({
        pid: 1234,
        startTimeTicks: 6000, // Start time changed! Process was restarted/recycled
        executable: "/bin/python3",
        cmdline: []
      })
      .mockRejectedValueOnce(new Error("Process no longer exists"));

    const observer = new H3LiveRuntimeObserver({
      inspectProcess: inspectMock
    });

    // 1. Same start time -> continuous
    const passResult = await observer.verifyProcessContinuity(1234, 5000);
    expect(passResult.continuous).toBe(true);

    // 2. Different start time -> drift detected
    const driftResult = await observer.verifyProcessContinuity(1234, 5000);
    expect(driftResult.continuous).toBe(false);
    expect(driftResult.blocker).toMatch(/PID recycled or process restarted/i);

    // 3. Process dead -> failure
    const deadResult = await observer.verifyProcessContinuity(1234, 5000);
    expect(deadResult.continuous).toBe(false);
    expect(deadResult.blocker).toMatch(/no longer accessible/i);
  });

  it("fails closed when target PID is an arbitrary non-python process", async () => {
    const observer = new H3LiveRuntimeObserver({
      getHostname: () => "render-node-01",
      queryGpuUuids: async () => ["GPU-1234"],
      inspectProcess: async (pid) => ({
        pid,
        startTimeTicks: 1000,
        executable: "/usr/bin/node",
        cmdline: ["node", "server.js"]
      }),
      getProcessCwd: async () => "/home/comfy/ComfyUI",
      getProcessGpuUuids: async () => ["GPU-1234"]
    });

    const result = await observer.observeCurrentRuntime({
      hostname: "render-node-01",
      gpuUuid: "GPU-1234",
      pid: 1234,
      comfyUiDir: "/home/comfy/ComfyUI"
    });

    expect(result.ok).toBe(false);
    expect(result.blocker).toMatch(/is not a python interpreter/i);
  });

  it("fails closed when target comfyUiDir does not match observed process cwd", async () => {
    const observer = new H3LiveRuntimeObserver({
      getHostname: () => "render-node-01",
      queryGpuUuids: async () => ["GPU-1234"],
      inspectProcess: async (pid) => ({
        pid,
        startTimeTicks: 1000,
        executable: "/opt/venv/bin/python3",
        cmdline: ["python3", "main.py"]
      }),
      getProcessGpuUuids: async () => ["GPU-1234"],
      getProcessCwd: async () => "/opt/other-repo/wrong-checkout"
    });

    const result = await observer.observeCurrentRuntime({
      hostname: "render-node-01",
      gpuUuid: "GPU-1234",
      pid: 1234,
      comfyUiDir: "/home/comfy/ComfyUI"
    });

    expect(result.ok).toBe(false);
    expect(result.blocker).toMatch(/does not match observed process cwd/i);
  });

  it("fails closed when target PID does not match endpoint listener PID", async () => {
    const observer = new H3LiveRuntimeObserver({
      getHostname: () => "render-node-01",
      queryGpuUuids: async () => ["GPU-1234"],
      resolveListeningPid: async () => 9999
    });

    const result = await observer.observeCurrentRuntime({
      hostname: "render-node-01",
      gpuUuid: "GPU-1234",
      comfyUiEndpoint: "http://127.0.0.1:8188",
      pid: 1234
    });

    expect(result.ok).toBe(false);
    expect(result.blocker).toMatch(/does not match listening process PID/i);
  });

  it("resolves listening PID from local comfyUiEndpoint when PID is omitted", async () => {
    const observer = new H3LiveRuntimeObserver({
      getHostname: () => "render-node-01",
      queryGpuUuids: async () => ["GPU-1234"],
      resolveListeningPid: async () => 5678,
      inspectProcess: async (pid) => ({
        pid,
        startTimeTicks: 1234,
        executable: "/opt/venv/bin/python3",
        cmdline: ["python3", "main.py"]
      }),
      getProcessCwd: async () => "/home/comfy/ComfyUI",
      getProcessGpuUuids: async () => ["GPU-1234"],
      getComfyUiRevision: async () => "55b6a9b11dffecdd65a3ccd5eb6a1b3a178c96dc",
      inspectCustomNodes: async () => ({}),
      inspectPackageVersions: async () => ({ torch: "2.5.1" })
    });

    const result = await observer.observeCurrentRuntime({
      hostname: "render-node-01",
      gpuUuid: "GPU-1234",
      comfyUiEndpoint: "http://localhost:8188",
      comfyUiDir: "/home/comfy/ComfyUI"
    });

    expect(result.ok).toBe(true);
    expect(result.observation?.pid).toBe(5678);
  });

  it("fails closed when target process is bound to a different GPU", async () => {
    const observer = new H3LiveRuntimeObserver({
      getHostname: () => "render-node-01",
      queryGpuUuids: async () => [
        "GPU-11111111-1111-1111-1111-111111111111",
        "GPU-22222222-2222-2222-2222-222222222222"
      ],
      inspectProcess: async (pid) => ({
        pid,
        startTimeTicks: 1000,
        executable: "/opt/venv/bin/python3",
        cmdline: ["python3", "main.py"]
      }),
      getProcessGpuUuids: async () => ["GPU-11111111-1111-1111-1111-111111111111"]
    });

    const result = await observer.observeCurrentRuntime({
      hostname: "render-node-01",
      gpuUuid: "GPU-22222222-2222-2222-2222-222222222222",
      pid: 1234,
      comfyUiDir: "/home/comfy/ComfyUI"
    });

    expect(result.ok).toBe(false);
    expect(result.blocker).toMatch(/bound to GPU\(s\).*which does not include target GPU/i);
  });

  it("fails closed when default probes fail without injected test mocks", async () => {
    const observer = new H3LiveRuntimeObserver();

    const result = await observer.observeCurrentRuntime({
      hostname: "non-existent-host-9999",
      gpuUuid: "GPU-nonexistent-1234",
      pid: 999999
    });

    expect(result.ok).toBe(false);
    expect(result.blocker).toMatch(/Observed hostname ".*" does not match target hostname/i);
  });

  it("fails closed when target comfyUiEndpoint has no resolvable listening PID", async () => {
    const observer = new H3LiveRuntimeObserver({
      getHostname: () => "render-node-01",
      queryGpuUuids: async () => ["GPU-1234"],
      resolveListeningPid: async () => undefined
    });

    const result = await observer.observeCurrentRuntime({
      hostname: "render-node-01",
      gpuUuid: "GPU-1234",
      comfyUiEndpoint: "http://localhost:8188"
    });

    expect(result.ok).toBe(false);
    expect(result.blocker).toMatch(/Could not resolve listening process PID for endpoint/i);
  });

  it("fails closed when target PID is provided but endpoint listening PID cannot be resolved", async () => {
    const observer = new H3LiveRuntimeObserver({
      getHostname: () => "render-node-01",
      queryGpuUuids: async () => ["GPU-1234"],
      resolveListeningPid: async () => undefined
    });

    const result = await observer.observeCurrentRuntime({
      hostname: "render-node-01",
      gpuUuid: "GPU-1234",
      comfyUiEndpoint: "http://localhost:8188",
      pid: 1234
    });

    expect(result.ok).toBe(false);
    expect(result.blocker).toMatch(/Could not resolve listening process PID for endpoint/i);
  });

  it("fails closed when target process has no observable GPU binding", async () => {
    const observer = new H3LiveRuntimeObserver({
      getHostname: () => "render-node-01",
      queryGpuUuids: async () => ["GPU-1234"],
      inspectProcess: async (pid) => ({
        pid,
        startTimeTicks: 1000,
        executable: "/opt/venv/bin/python3",
        cmdline: ["python3", "main.py"]
      }),
      getProcessGpuUuids: async () => [] // No GPU binding observed!
    });

    const result = await observer.observeCurrentRuntime({
      hostname: "render-node-01",
      gpuUuid: "GPU-1234",
      pid: 1234,
      comfyUiDir: "/home/comfy/ComfyUI"
    });

    expect(result.ok).toBe(false);
    expect(result.blocker).toMatch(/has no observable GPU binding/i);
  });

  it("fails closed when inspecting process cwd throws an error", async () => {
    const observer = new H3LiveRuntimeObserver({
      getHostname: () => "render-node-01",
      queryGpuUuids: async () => ["GPU-1234"],
      inspectProcess: async (pid) => ({
        pid,
        startTimeTicks: 1000,
        executable: "/opt/venv/bin/python3",
        cmdline: ["python3", "main.py"]
      }),
      getProcessGpuUuids: async () => ["GPU-1234"],
      getProcessCwd: async () => {
        throw new Error("Permission denied inspecting /proc/1234/cwd (EACCES)");
      }
    });

    const result = await observer.observeCurrentRuntime({
      hostname: "render-node-01",
      gpuUuid: "GPU-1234",
      pid: 1234,
      comfyUiDir: "/home/comfy/ComfyUI"
    });

    expect(result.ok).toBe(false);
    expect(result.blocker).toMatch(/Failed to inspect process cwd/i);
  });

  it("derives comfyUiDir from process cwd when comfyUiDir is omitted", async () => {
    const observer = new H3LiveRuntimeObserver({
      getHostname: () => "render-node-01",
      queryGpuUuids: async () => ["GPU-1234"],
      inspectProcess: async (pid) => ({
        pid,
        startTimeTicks: 1000,
        executable: "/opt/venv/bin/python3",
        cmdline: ["python3", "main.py"]
      }),
      getProcessGpuUuids: async () => ["GPU-1234"],
      getProcessCwd: async () => "/home/comfy/DerivedComfyUI",
      getComfyUiRevision: async (dir) => {
        if (dir === "/home/comfy/DerivedComfyUI") return "55b6a9b11dffecdd65a3ccd5eb6a1b3a178c96dc";
        throw new Error("Wrong directory passed to getComfyUiRevision");
      },
      inspectCustomNodes: async () => ({}),
      inspectPackageVersions: async () => ({ torch: "2.5.1" })
    });

    const result = await observer.observeCurrentRuntime({
      hostname: "render-node-01",
      gpuUuid: "GPU-1234",
      pid: 1234
      // comfyUiDir omitted
    });

    expect(result.ok).toBe(true);
    expect(result.observation?.comfyUiCoreRevision).toBe(
      "55b6a9b11dffecdd65a3ccd5eb6a1b3a178c96dc"
    );
  });

  it("fails closed when package versions inspection returns empty package list", async () => {
    const observer = new H3LiveRuntimeObserver({
      getHostname: () => "render-node-01",
      queryGpuUuids: async () => ["GPU-1234"],
      inspectProcess: async (pid) => ({
        pid,
        startTimeTicks: 1000,
        executable: "/opt/venv/bin/python3",
        cmdline: ["python3", "main.py"]
      }),
      getProcessGpuUuids: async () => ["GPU-1234"],
      getProcessCwd: async () => "/home/comfy/ComfyUI",
      getComfyUiRevision: async () => "55b6a9b11dffecdd65a3ccd5eb6a1b3a178c96dc",
      inspectCustomNodes: async () => ({}),
      inspectPackageVersions: async () => ({}) // Empty package list!
    });

    const result = await observer.observeCurrentRuntime({
      hostname: "render-node-01",
      gpuUuid: "GPU-1234",
      pid: 1234,
      comfyUiDir: "/home/comfy/ComfyUI"
    });

    expect(result.ok).toBe(false);
    expect(result.blocker).toMatch(/Package versions inspection returned empty package list/i);
  });
});
