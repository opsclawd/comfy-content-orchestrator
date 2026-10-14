import { describe, expect, it, beforeAll, afterAll } from "vitest";
import {
  ExperimentRuntimeRegistry,
  CurrentPinExperimentRuntimeAdapter,
  IsolatedUpgradeExperimentRuntimeAdapter
} from "./minimax-h3-runtime-registry.js";
import {
  PINNED_COMFYUI_CORE_REVISION,
  type MinimaxH3RequiredRuntimeManifest,
  MinimaxH3ObservedProvenanceSchema
} from "@cco/contracts";
import { createHash } from "node:crypto";
import { execSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";

function computeManifestDigest(manifest: MinimaxH3RequiredRuntimeManifest): string {
  const canonical = (value: unknown): string => {
    if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
    if (value && typeof value === "object") {
      const entries = Object.entries(value as Record<string, unknown>).sort(([a], [b]) =>
        a.localeCompare(b)
      );
      return `{${entries.map(([key, item]) => `${JSON.stringify(key)}:${canonical(item)}`).join(",")}}`;
    }
    return JSON.stringify(value);
  };
  return createHash("sha256").update(canonical(manifest)).digest("hex");
}

describe("MiniMax-H3 Runtime Registry & Adapters", () => {
  const mockRootDir = path.resolve(".ai-tmp/test-runtime-mock");
  const mockComfyDir = path.join(mockRootDir, "comfyui");
  const mockPythonPath = path.join(mockRootDir, "mock-python.sh");
  let mockRev = "";

  beforeAll(() => {
    fs.mkdirSync(path.join(mockComfyDir, "comfy_extras"), { recursive: true });
    fs.writeFileSync(
      path.join(mockComfyDir, "comfy_extras", "nodes_minimax_h3.py"),
      "class MiniMaxH3ImageToVideo:\n    pass\nclass MiniMaxH3ReferenceToVideo:\n    pass\n"
    );
    execSync("git init -b main", { cwd: mockComfyDir });
    execSync('git config user.email "test@test.com"', { cwd: mockComfyDir });
    execSync('git config user.name "Test"', { cwd: mockComfyDir });
    execSync("git add .", { cwd: mockComfyDir });
    execSync('git commit -m "init"', { cwd: mockComfyDir });
    mockRev = execSync("git rev-parse HEAD", { cwd: mockComfyDir }).toString().trim();

    const mockPythonScript = `#!/bin/sh
if [ "$1" = "-c" ]; then
  if echo "$2" | grep -q "import torch"; then
    echo "2.5.1+cu124|12.4"
    exit 0
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

  const baseManifest: MinimaxH3RequiredRuntimeManifest = {
    coreRevision: PINNED_COMFYUI_CORE_REVISION,
    sourceFileHashes: {},
    requiredNodes: [],
    pythonPackages: [],
    pytorchBuild: "2.5.1+cu124",
    cudaBuild: "12.4",
    driverConstraints: [">=550.00"],
    attentionKernel: "torch_sdpa",
    instrumentationProtocol: "v2-jsonl",
    collectorDigest: "2222222222222222222222222222222222222222222222222222222222222222",
    hookManifestDigest: "3333333333333333333333333333333333333333333333333333333333333333",
    hooks: []
  };

  it("registers adapters for pinned core and sol-attn isolated upgrade", () => {
    const registry = new ExperimentRuntimeRegistry();
    expect(registry.hasAdapter(PINNED_COMFYUI_CORE_REVISION)).toBe(true);
    expect(registry.hasAdapter("94cfeb3a5d8985efaa7ea9f5e5dfad4184ec99bf")).toBe(true);
    expect(registry.hasAdapter("94cfeb3a0efdb9d6d7be76f2d48c8b6b2fa983eb")).toBe(false);
    expect(registry.hasAdapter("67e4eb5541b648555563144401ebaba832bd73ec")).toBe(false);
    expect(registry.hasAdapter("unknown-revision")).toBe(false);
  });

  it("fails verification when runtime manifest digest mismatches", async () => {
    const registry = new ExperimentRuntimeRegistry();
    const manifestDigest = computeManifestDigest(baseManifest);

    const result = await registry.verify({
      comfyUiDir: "/nonexistent/comfyui",
      pythonPath: "/usr/bin/python3",
      requiredRuntime: baseManifest,
      requiredRuntimeDigest: `${manifestDigest.slice(1)}0`
    });

    expect(result.ok).toBe(false);
    expect(result.status).toBe("conflict");
    expect(result.blocker).toContain("Required runtime manifest digest mismatch");
  });

  it("accepts canonical H3 nodes (I2V / Ref2V) on pinned adapter and returns schema-valid observations", async () => {
    const adapter = new CurrentPinExperimentRuntimeAdapter();
    const manifestWithCanonicalNodes: MinimaxH3RequiredRuntimeManifest = {
      ...baseManifest,
      coreRevision: mockRev,
      requiredNodes: [{ name: "MiniMaxH3ImageToVideo" }, { name: "MiniMaxH3ReferenceToVideo" }],
      pythonPackages: [{ name: "json", version: "" }]
    };

    const expectedCheckpointHash =
      "1234567890abcdef1234567890abcdef1234567890abcdef1234567890abcdef";
    const res = await adapter.verify({
      comfyUiDir: mockComfyDir,
      pythonPath: mockPythonPath,
      requiredRuntime: manifestWithCanonicalNodes,
      expectedCheckpointHash
    });

    expect(res.ok).toBe(true);
    expect(res.status).toBe("verified");
    expect(res.observations).toBeDefined();

    // Verify observations strictly match MinimaxH3ObservedProvenanceSchema
    const parsed = MinimaxH3ObservedProvenanceSchema.parse(res.observations);
    expect(parsed.actualCheckpointHash.expected).toBe(expectedCheckpointHash);
    expect(parsed.actualCheckpointHash.status).toBe("unknown");
    expect(parsed.observedAttentionBackend.status).toBe("unknown");
    expect(parsed.bootstrapHandshake.status).toBe("missing");
  });

  it("rejects requiredNodes when pinned adapter encounters sparse nodes", async () => {
    const adapter = new CurrentPinExperimentRuntimeAdapter();
    const manifestWithNode: MinimaxH3RequiredRuntimeManifest = {
      ...baseManifest,
      coreRevision: mockRev,
      requiredNodes: [{ name: "ModelSparseAttention" }]
    };

    const res = await adapter.verify({
      comfyUiDir: mockComfyDir,
      pythonPath: mockPythonPath,
      requiredRuntime: manifestWithNode
    });

    expect(res.ok).toBe(false);
    expect(res.status).toBe("conflict");
    expect(res.blocker).toContain('does not provide required node "ModelSparseAttention"');
    expect(res.blocker).toContain("Requires isolated upgrade checkout");
  });

  it("fails verification when comfy_extras/nodes_minimax_h3.py is missing", async () => {
    const adapter = new CurrentPinExperimentRuntimeAdapter();
    const nonExistentDir = path.join(mockRootDir, "empty-dir");
    fs.mkdirSync(nonExistentDir, { recursive: true });
    execSync("git init -b main", { cwd: nonExistentDir });
    execSync('git config user.email "test@test.com"', { cwd: nonExistentDir });
    execSync('git config user.name "Test"', { cwd: nonExistentDir });
    fs.writeFileSync(path.join(nonExistentDir, "dummy.txt"), "hello");
    execSync("git add .", { cwd: nonExistentDir });
    execSync('git commit -m "init"', { cwd: nonExistentDir });
    const emptyRev = execSync("git rev-parse HEAD", { cwd: nonExistentDir }).toString().trim();

    const res = await adapter.verify({
      comfyUiDir: nonExistentDir,
      pythonPath: mockPythonPath,
      requiredRuntime: {
        ...baseManifest,
        coreRevision: emptyRev,
        requiredNodes: [{ name: "MiniMaxH3ImageToVideo" }]
      }
    });

    expect(res.ok).toBe(false);
    expect(res.status).toBe("conflict");
    expect(res.blocker).toContain("comfy_extras/nodes_minimax_h3.py");
  });

  it("isolated upgrade adapter rejects when directory revision mismatches", async () => {
    const isolatedAdapter = new IsolatedUpgradeExperimentRuntimeAdapter(
      "94cfeb3a5d8985efaa7ea9f5e5dfad4184ec99bf",
      "upgraded-core-isolated-adapter-v1",
      ["ModelSparseAttention"]
    );
    const manifest: MinimaxH3RequiredRuntimeManifest = {
      ...baseManifest,
      coreRevision: "94cfeb3a5d8985efaa7ea9f5e5dfad4184ec99bf",
      requiredNodes: [{ name: "ModelSparseAttention" }]
    };

    const res = await isolatedAdapter.verify({
      comfyUiDir: mockComfyDir,
      pythonPath: mockPythonPath,
      requiredRuntime: manifest
    });

    expect(res.ok).toBe(false);
    expect(res.status).toBe("conflict");
    expect(res.blocker).toContain("revision mismatch: expected isolated upgrade");
  });

  it("safely handles python package names with injection attempts without executing injected code", async () => {
    const adapter = new CurrentPinExperimentRuntimeAdapter();
    const manifestWithInjection: MinimaxH3RequiredRuntimeManifest = {
      ...baseManifest,
      coreRevision: mockRev,
      requiredNodes: [],
      pythonPackages: [
        {
          name: 'os; open("/tmp/antigravity_injection_marker.tmp", "w").write("injected")',
          version: ""
        }
      ]
    };

    const res = await adapter.verify({
      comfyUiDir: mockComfyDir,
      pythonPath: mockPythonPath,
      requiredRuntime: manifestWithInjection
    });

    expect(res.ok).toBe(false);
    expect(res.status).toBe("conflict");
    expect(res.blocker).toContain("not installed or importable");
  });

  it("correctly handles hyphenated package distribution names", async () => {
    const adapter = new CurrentPinExperimentRuntimeAdapter();
    const manifestWithHyphen: MinimaxH3RequiredRuntimeManifest = {
      ...baseManifest,
      coreRevision: mockRev,
      requiredNodes: [],
      pythonPackages: [
        {
          name: "urllib3",
          version: ""
        }
      ]
    };

    const res = await adapter.verify({
      comfyUiDir: mockComfyDir,
      pythonPath: mockPythonPath,
      requiredRuntime: manifestWithHyphen
    });

    expect(res.ok).toBe(true);
    expect(res.status).toBe("verified");
  });
});
