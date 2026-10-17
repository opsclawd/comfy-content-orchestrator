import { describe, expect, it, beforeAll, afterAll } from "vitest";
import {
  ExperimentRuntimeRegistry,
  CurrentPinExperimentRuntimeAdapter,
  IsolatedUpgradeExperimentRuntimeAdapter,
  setTestDriverQueryCommand
} from "./minimax-h3-runtime-registry.js";
import {
  PINNED_COMFYUI_CORE_REVISION,
  FASTH3_ISOLATED_CORE_REVISION,
  buildRequiredRuntimeManifestFromAttentionCatalog,
  type MinimaxH3AttentionCatalogEntry,
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

  beforeAll(() => {
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
    setTestDriverQueryCommand({ command: "echo", args: ["550.54.14"] });

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
fi
if echo "$1" | grep -q "minimax-h3-package-inspector.py"; then
  dist="$2"
  ver="$3"
  mod="$4"
  hash="$5"
  if [ "$dist" = "comfy-kitchen" ]; then
    if [ -n "$ver" ] && [ "$ver" != "0.2.34" ] && [ "$ver" != "0.2.31" ]; then
      echo "version_mismatch:expected_\${ver}_got_0.2.34"
      exit 1
    fi
    if [ -n "$hash" ] && [ "$hash" != "__MEASURE__" ] && [ "$hash" != "1111111111111111111111111111111111111111111111111111111111111111" ]; then
      echo "hash_mismatch:expected_\${hash}_got_1111111111111111111111111111111111111111111111111111111111111111"
      exit 1
    fi
    echo 'ok:{"ok":true,"name":"comfy-kitchen","version":"0.2.34","artifactHash":"1111111111111111111111111111111111111111111111111111111111111111","artifactMethod":"installed_record_sha256_v1","fileCount":5}'
    exit 0
  fi
  if [ "$dist" = "sageattention" ] || [ "$dist" = "veda-sparse-attention" ] || [ "$dist" = "triton" ] || [ "$dist" = "torch" ] || [ "$dist" = "json" ] || [ "$dist" = "urllib3" ]; then
    echo "ok:{\\"ok\\":true,\\"name\\":\\"$dist\\",\\"version\\":\\"1.0.0\\",\\"artifactHash\\":\\"2222222222222222222222222222222222222222222222222222222222222222\\",\\"artifactMethod\\":\\"installed_record_sha256_v1\\",\\"fileCount\\":3}"
    exit 0
  fi
fi
exec /usr/bin/python3 "$@"
`;
    fs.writeFileSync(mockPythonPath, mockPythonScript, { mode: 0o755 });
  });

  afterAll(() => {
    setTestDriverQueryCommand(null);
    delete process.env.CCO_DRIVER_VERSION_OVERRIDE;
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

  it("registers adapters for pinned core and FastH3 isolated upgrades (no speculative sol-attn adapter)", () => {
    const registry = new ExperimentRuntimeRegistry();
    expect(registry.hasAdapter(PINNED_COMFYUI_CORE_REVISION)).toBe(true);
    expect(registry.hasAdapter("94cfeb3a5d8985efaa7ea9f5e5dfad4184ec99bf")).toBe(false);
    expect(registry.hasAdapter("ee71d5c4993f29086b27fde1629a945ae48425bf")).toBe(true);
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

  it("audits torch even when a manifest declares no pythonPackages (AC-1, F-b4902dfa)", async () => {
    // torch provides the scaled_dot_product_attention dense fallback every
    // attention backend can hit, so it must be in the mandatory audit set
    // regardless of whether the manifest declared it — a manifest that
    // omits torch must not be able to skip verifying it.
    const adapter = new CurrentPinExperimentRuntimeAdapter();
    const manifestWithoutTorch: MinimaxH3RequiredRuntimeManifest = {
      ...baseManifest,
      coreRevision: PINNED_COMFYUI_CORE_REVISION,
      requiredNodes: [],
      pythonPackages: []
    };

    const res = await adapter.verify({
      comfyUiDir: mockComfyDir,
      pythonPath: mockPythonPath,
      requiredRuntime: manifestWithoutTorch
    });

    expect(res.ok).toBe(true);
    const parsed = MinimaxH3ObservedProvenanceSchema.parse(res.observations);
    const torchEntry = parsed.packageIdentities?.find((p) => p.name === "torch");
    expect(torchEntry).toBeDefined();
    expect(torchEntry?.artifactHash).toBeDefined();
  });

  it("accepts canonical H3 nodes (I2V / Ref2V) on pinned adapter and returns schema-valid observations", async () => {
    const adapter = new CurrentPinExperimentRuntimeAdapter();
    const manifestWithCanonicalNodes: MinimaxH3RequiredRuntimeManifest = {
      ...baseManifest,
      coreRevision: PINNED_COMFYUI_CORE_REVISION,
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
      coreRevision: PINNED_COMFYUI_CORE_REVISION,
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
    fs.writeFileSync(
      path.join(nonExistentDir, ".git", "HEAD"),
      `${PINNED_COMFYUI_CORE_REVISION}\n`
    );

    const res = await adapter.verify({
      comfyUiDir: nonExistentDir,
      pythonPath: mockPythonPath,
      requiredRuntime: {
        ...baseManifest,
        coreRevision: PINNED_COMFYUI_CORE_REVISION,
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
      coreRevision: PINNED_COMFYUI_CORE_REVISION,
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
      coreRevision: PINNED_COMFYUI_CORE_REVISION,
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

  it("accepts LoraLoaderModelOnly on pinned adapter", async () => {
    const adapter = new CurrentPinExperimentRuntimeAdapter();
    const manifestWithLora: MinimaxH3RequiredRuntimeManifest = {
      ...baseManifest,
      coreRevision: PINNED_COMFYUI_CORE_REVISION,
      requiredNodes: [{ name: "MiniMaxH3ImageToVideo" }, { name: "LoraLoaderModelOnly" }],
      pythonPackages: [{ name: "json", version: "" }]
    };

    const res = await adapter.verify({
      comfyUiDir: mockComfyDir,
      pythonPath: mockPythonPath,
      requiredRuntime: manifestWithLora
    });

    expect(res.ok).toBe(true);
    expect(res.status).toBe("verified");
  });

  it("FastH3 isolated upgrade adapter verifies supported nodes", async () => {
    const registry = new ExperimentRuntimeRegistry();
    const adapter = registry.getAdapter(FASTH3_ISOLATED_CORE_REVISION);
    expect(adapter).toBeDefined();

    const fasth3NodesDir = path.join(mockRootDir, "fasth3-nodes-dir");
    fs.mkdirSync(path.join(fasth3NodesDir, "comfy_extras"), { recursive: true });
    fs.writeFileSync(
      path.join(fasth3NodesDir, "comfy_extras", "nodes_minimax_h3.py"),
      "class MiniMaxH3SigmaShift:\n    INPUT_TYPES = {}\n"
    );
    fs.writeFileSync(
      path.join(fasth3NodesDir, "comfy_extras", "nodes_model_advanced.py"),
      "class ModelAttentionBackend:\n    INPUT_TYPES = {}\n"
    );
    fs.writeFileSync(
      path.join(fasth3NodesDir, "comfy_extras", "nodes_sparse_attention.py"),
      "class BlockSparseAttention:\n    INPUT_TYPES = {}\n"
    );
    execSync("git init -b main", { cwd: fasth3NodesDir });
    execSync('git config user.email "test@test.com"', { cwd: fasth3NodesDir });
    execSync('git config user.name "Test"', { cwd: fasth3NodesDir });
    execSync("git add .", { cwd: fasth3NodesDir });
    execSync('git commit -m "init"', { cwd: fasth3NodesDir });
    fs.writeFileSync(
      path.join(fasth3NodesDir, ".git", "HEAD"),
      `${FASTH3_ISOLATED_CORE_REVISION}\n`
    );

    const manifest: MinimaxH3RequiredRuntimeManifest = {
      ...baseManifest,
      coreRevision: FASTH3_ISOLATED_CORE_REVISION,
      requiredNodes: [
        { name: "MiniMaxH3SigmaShift" },
        { name: "ModelAttentionBackend" },
        { name: "BlockSparseAttention" }
      ],
      attentionKernel: "block_sparse_triton"
    };

    const res = await adapter!.verify({
      comfyUiDir: fasth3NodesDir,
      pythonPath: mockPythonPath,
      requiredRuntime: manifest
    });

    expect(res.ok).toBe(true);
    expect(res.status).toBe("verified");
  });

  it("rejects when required node is not defined in source file", async () => {
    const adapter = new CurrentPinExperimentRuntimeAdapter();
    const missingNodeDir = path.join(mockRootDir, "missing-node-dir");
    fs.mkdirSync(path.join(missingNodeDir, "comfy_extras"), { recursive: true });
    fs.writeFileSync(path.join(missingNodeDir, "nodes.py"), "# Empty nodes\n");
    fs.writeFileSync(
      path.join(missingNodeDir, "comfy_extras", "nodes_minimax_h3.py"),
      "class MiniMaxH3ImageToVideo:\n    pass\n"
    );
    execSync("git init -b main", { cwd: missingNodeDir });
    execSync('git config user.email "test@test.com"', { cwd: missingNodeDir });
    execSync('git config user.name "Test"', { cwd: missingNodeDir });
    execSync("git add .", { cwd: missingNodeDir });
    execSync('git commit -m "init"', { cwd: missingNodeDir });
    fs.writeFileSync(
      path.join(missingNodeDir, ".git", "HEAD"),
      `${PINNED_COMFYUI_CORE_REVISION}\n`
    );

    const manifest: MinimaxH3RequiredRuntimeManifest = {
      ...baseManifest,
      coreRevision: PINNED_COMFYUI_CORE_REVISION,
      requiredNodes: [{ name: "LoraLoaderModelOnly" }]
    };

    const res = await adapter.verify({
      comfyUiDir: missingNodeDir,
      pythonPath: mockPythonPath,
      requiredRuntime: manifest
    });

    expect(res.ok).toBe(false);
    expect(res.status).toBe("conflict");
    expect(res.blocker).toContain(
      'nodes.py does not define a schema-valid ComfyUI node class or register "LoraLoaderModelOnly" in NODE_CLASS_MAPPINGS.'
    );
  });

  it("rejects when required node class exists but lacks schema attributes", async () => {
    const adapter = new CurrentPinExperimentRuntimeAdapter();
    const noSchemaDir = path.join(mockRootDir, "no-schema-dir");
    fs.mkdirSync(path.join(noSchemaDir, "comfy_extras"), { recursive: true });
    fs.writeFileSync(path.join(noSchemaDir, "nodes.py"), "class LoraLoaderModelOnly:\n    pass\n");
    execSync("git init -b main", { cwd: noSchemaDir });
    execSync('git config user.email "test@test.com"', { cwd: noSchemaDir });
    execSync('git config user.name "Test"', { cwd: noSchemaDir });
    execSync("git add .", { cwd: noSchemaDir });
    execSync('git commit -m "init"', { cwd: noSchemaDir });
    fs.writeFileSync(path.join(noSchemaDir, ".git", "HEAD"), `${PINNED_COMFYUI_CORE_REVISION}\n`);

    const manifest: MinimaxH3RequiredRuntimeManifest = {
      ...baseManifest,
      coreRevision: PINNED_COMFYUI_CORE_REVISION,
      requiredNodes: [{ name: "LoraLoaderModelOnly" }]
    };

    const res = await adapter.verify({
      comfyUiDir: noSchemaDir,
      pythonPath: mockPythonPath,
      requiredRuntime: manifest
    });

    expect(res.ok).toBe(false);
    expect(res.status).toBe("conflict");
    expect(res.blocker).toContain(
      'nodes.py does not define a schema-valid ComfyUI node class or register "LoraLoaderModelOnly" in NODE_CLASS_MAPPINGS.'
    );
  });

  it("rejects when required node has no mapped source file in runtime registry", async () => {
    const adapter = new CurrentPinExperimentRuntimeAdapter();
    const manifest: MinimaxH3RequiredRuntimeManifest = {
      ...baseManifest,
      coreRevision: PINNED_COMFYUI_CORE_REVISION,
      requiredNodes: [{ name: "UnmappedFakeNode" }]
    };

    const res = await adapter.verify({
      comfyUiDir: mockComfyDir,
      pythonPath: mockPythonPath,
      requiredRuntime: manifest
    });

    expect(res.ok).toBe(false);
    expect(res.status).toBe("conflict");
    expect(res.blocker).toContain('does not provide required node "UnmappedFakeNode"');
  });

  it("CurrentPin adapter rejects when attentionKernel is not torch_sdpa", async () => {
    const adapter = new CurrentPinExperimentRuntimeAdapter();
    const manifest: MinimaxH3RequiredRuntimeManifest = {
      ...baseManifest,
      coreRevision: PINNED_COMFYUI_CORE_REVISION,
      attentionKernel: "block_sparse_triton"
    };

    const res = await adapter.verify({
      comfyUiDir: mockComfyDir,
      pythonPath: mockPythonPath,
      requiredRuntime: manifest
    });

    expect(res.ok).toBe(false);
    expect(res.status).toBe("conflict");
    expect(res.blocker).toContain('does not support attention kernel "block_sparse_triton"');
  });

  it("CurrentPin adapter rejects when manifest coreRevision does not match PINNED_COMFYUI_CORE_REVISION", async () => {
    const adapter = new CurrentPinExperimentRuntimeAdapter();
    const manifest: MinimaxH3RequiredRuntimeManifest = {
      ...baseManifest,
      coreRevision: "0000000000000000000000000000000000000000"
    };

    const res = await adapter.verify({
      comfyUiDir: mockComfyDir,
      pythonPath: mockPythonPath,
      requiredRuntime: manifest
    });

    expect(res.ok).toBe(false);
    expect(res.status).toBe("conflict");
    expect(res.blocker).toContain("Current pinned adapter expected manifest revision");
  });

  it("CurrentPin adapter rejects when checkout revision does not match PINNED_COMFYUI_CORE_REVISION", async () => {
    const adapter = new CurrentPinExperimentRuntimeAdapter();
    const mismatchedCheckoutDir = path.join(mockRootDir, "mismatched-checkout");
    fs.mkdirSync(mismatchedCheckoutDir, { recursive: true });
    execSync("git init -b main", { cwd: mismatchedCheckoutDir });
    execSync('git config user.email "test@test.com"', { cwd: mismatchedCheckoutDir });
    execSync('git config user.name "Test"', { cwd: mismatchedCheckoutDir });
    fs.writeFileSync(path.join(mismatchedCheckoutDir, "test.txt"), "hello");
    execSync("git add .", { cwd: mismatchedCheckoutDir });
    execSync('git commit -m "init"', { cwd: mismatchedCheckoutDir });
    fs.writeFileSync(
      path.join(mismatchedCheckoutDir, ".git", "HEAD"),
      "1111111111111111111111111111111111111111\n"
    );

    const res = await adapter.verify({
      comfyUiDir: mismatchedCheckoutDir,
      pythonPath: mockPythonPath,
      requiredRuntime: baseManifest
    });

    expect(res.ok).toBe(false);
    expect(res.status).toBe("conflict");
    expect(res.blocker).toContain("ComfyUI checkout revision mismatch");
  });

  it("IsolatedUpgrade adapter rejects unsupported attentionKernel", async () => {
    const adapter = new IsolatedUpgradeExperimentRuntimeAdapter(
      FASTH3_ISOLATED_CORE_REVISION,
      "fasth3-isolated-upgrade-adapter-v1",
      [
        "MiniMaxH3ImageToVideo",
        "MiniMaxH3ReferenceToVideo",
        "EmptyMiniMaxH3LatentAV",
        "MiniMaxH3SigmaShift",
        "ModelAttentionBackend",
        "BlockSparseAttention"
      ]
    );
    const isoDir = path.join(mockRootDir, "iso-kernel-dir");
    fs.mkdirSync(isoDir, { recursive: true });
    execSync("git init -b main", { cwd: isoDir });
    execSync('git config user.email "test@test.com"', { cwd: isoDir });
    execSync('git config user.name "Test"', { cwd: isoDir });
    fs.writeFileSync(path.join(isoDir, "test.txt"), "hello");
    execSync("git add .", { cwd: isoDir });
    execSync('git commit -m "init"', { cwd: isoDir });
    fs.writeFileSync(path.join(isoDir, ".git", "HEAD"), `${FASTH3_ISOLATED_CORE_REVISION}\n`);

    const manifest: MinimaxH3RequiredRuntimeManifest = {
      ...baseManifest,
      coreRevision: FASTH3_ISOLATED_CORE_REVISION,
      attentionKernel: "unknown_kernel"
    };

    const res = await adapter.verify({
      comfyUiDir: isoDir,
      pythonPath: mockPythonPath,
      requiredRuntime: manifest
    });

    expect(res.ok).toBe(false);
    expect(res.status).toBe("conflict");
    expect(res.blocker).toContain('does not support attention kernel "unknown_kernel"');
  });

  it("IsolatedUpgrade adapter rejects when manifest coreRevision does not match this.coreRevision", async () => {
    const adapter = new IsolatedUpgradeExperimentRuntimeAdapter(
      FASTH3_ISOLATED_CORE_REVISION,
      "fasth3-isolated-upgrade-adapter-v1",
      [
        "MiniMaxH3ImageToVideo",
        "MiniMaxH3ReferenceToVideo",
        "EmptyMiniMaxH3LatentAV",
        "MiniMaxH3SigmaShift",
        "ModelAttentionBackend",
        "BlockSparseAttention"
      ]
    );
    const manifest: MinimaxH3RequiredRuntimeManifest = {
      ...baseManifest,
      coreRevision: PINNED_COMFYUI_CORE_REVISION
    };

    const res = await adapter.verify({
      comfyUiDir: mockComfyDir,
      pythonPath: mockPythonPath,
      requiredRuntime: manifest
    });

    expect(res.ok).toBe(false);
    expect(res.status).toBe("conflict");
    expect(res.blocker).toContain("expected manifest revision");
  });

  it("FastH3 isolated upgrade adapter verifies with authentic FastH3 fixtures", async () => {
    const registry = new ExperimentRuntimeRegistry();
    const adapter = registry.getAdapter(FASTH3_ISOLATED_CORE_REVISION);
    expect(adapter).toBeDefined();

    const fastH3Dir = path.join(mockRootDir, "fasth3-checkout");
    fs.mkdirSync(path.join(fastH3Dir, "comfy"), { recursive: true });
    fs.mkdirSync(path.join(fastH3Dir, "comfy_extras"), { recursive: true });

    const files: Record<string, string> = {
      "comfy/model_management.py": "# model_management\n",
      "main.py": "# main\n",
      "comfy/cli_args.py": "# cli_args\n",
      "comfy_extras/nodes_minimax_h3.py":
        "class MiniMaxH3SigmaShift:\n    INPUT_TYPES = {}\n\nclass MiniMaxH3ImageToVideo:\n    INPUT_TYPES = {}\n",
      "comfy_extras/nodes_model_advanced.py":
        "class ModelAttentionBackend:\n    INPUT_TYPES = {}\n",
      "comfy_extras/nodes_sparse_attention.py":
        "class BlockSparseAttention:\n    INPUT_TYPES = {}\n"
    };

    const sourceFileHashes: Record<string, string> = {};
    for (const [relPath, content] of Object.entries(files)) {
      const full = path.join(fastH3Dir, relPath);
      fs.writeFileSync(full, content);
      sourceFileHashes[relPath] = createHash("sha256").update(Buffer.from(content)).digest("hex");
    }

    execSync("git init -b main", { cwd: fastH3Dir });
    execSync('git config user.email "test@test.com"', { cwd: fastH3Dir });
    execSync('git config user.name "Test"', { cwd: fastH3Dir });
    execSync("git add .", { cwd: fastH3Dir });
    execSync('git commit -m "init"', { cwd: fastH3Dir });
    fs.writeFileSync(path.join(fastH3Dir, ".git", "HEAD"), `${FASTH3_ISOLATED_CORE_REVISION}\n`);

    const manifest: MinimaxH3RequiredRuntimeManifest = {
      ...baseManifest,
      coreRevision: FASTH3_ISOLATED_CORE_REVISION,
      sourceFileHashes,
      requiredNodes: [
        { name: "MiniMaxH3ImageToVideo" },
        { name: "BlockSparseAttention" },
        { name: "MiniMaxH3SigmaShift" },
        { name: "ModelAttentionBackend" }
      ],
      pythonPackages: [{ name: "comfy-kitchen", version: "0.2.34" }],
      attentionKernel: "block_sparse_triton"
    };

    const res = await adapter!.verify({
      comfyUiDir: fastH3Dir,
      pythonPath: mockPythonPath,
      requiredRuntime: manifest
    });

    expect(res.ok).toBe(true);
    expect(res.status).toBe("verified");
  });

  it("accepts node registered via NODE_CLASS_MAPPINGS dictionary", async () => {
    const adapter = new CurrentPinExperimentRuntimeAdapter();
    const mappingNodeDir = path.join(mockRootDir, "mapping-node-dir");
    fs.mkdirSync(path.join(mappingNodeDir, "comfy_extras"), { recursive: true });
    fs.writeFileSync(
      path.join(mappingNodeDir, "nodes.py"),
      'NODE_CLASS_MAPPINGS = {\n    "LoraLoaderModelOnly": SomeClass\n}\n'
    );
    fs.writeFileSync(
      path.join(mappingNodeDir, "comfy_extras", "nodes_minimax_h3.py"),
      "class MiniMaxH3ImageToVideo:\n    INPUT_TYPES = {}\n"
    );
    execSync("git init -b main", { cwd: mappingNodeDir });
    execSync('git config user.email "test@test.com"', { cwd: mappingNodeDir });
    execSync('git config user.name "Test"', { cwd: mappingNodeDir });
    execSync("git add .", { cwd: mappingNodeDir });
    execSync('git commit -m "init"', { cwd: mappingNodeDir });
    fs.writeFileSync(
      path.join(mappingNodeDir, ".git", "HEAD"),
      `${PINNED_COMFYUI_CORE_REVISION}\n`
    );

    const manifest: MinimaxH3RequiredRuntimeManifest = {
      ...baseManifest,
      coreRevision: PINNED_COMFYUI_CORE_REVISION,
      requiredNodes: [{ name: "LoraLoaderModelOnly" }],
      pythonPackages: [{ name: "json", version: "" }]
    };

    const res = await adapter.verify({
      comfyUiDir: mappingNodeDir,
      pythonPath: mockPythonPath,
      requiredRuntime: manifest
    });

    expect(res.ok).toBe(true);
    expect(res.status).toBe("verified");
  });

  it("accepts node defined via native io.ComfyNode define_schema and ComfyExtension", async () => {
    const adapter = new CurrentPinExperimentRuntimeAdapter();
    const nativeNodeDir = path.join(mockRootDir, "native-node-dir");
    fs.mkdirSync(path.join(nativeNodeDir, "comfy_extras"), { recursive: true });
    fs.writeFileSync(
      path.join(nativeNodeDir, "comfy_extras", "nodes_minimax_h3.py"),
      `import comfy.io as io

class MiniMaxH3ImageToVideo(io.ComfyNode):
    @classmethod
    def define_schema(cls):
        return {}

class MiniMaxH3Extension(io.ComfyExtension):
    pass
`
    );
    execSync("git init -b main", { cwd: nativeNodeDir });
    execSync('git config user.email "test@test.com"', { cwd: nativeNodeDir });
    execSync('git config user.name "Test"', { cwd: nativeNodeDir });
    execSync("git add .", { cwd: nativeNodeDir });
    execSync('git commit -m "init"', { cwd: nativeNodeDir });
    fs.writeFileSync(path.join(nativeNodeDir, ".git", "HEAD"), `${PINNED_COMFYUI_CORE_REVISION}\n`);

    const manifest: MinimaxH3RequiredRuntimeManifest = {
      ...baseManifest,
      coreRevision: PINNED_COMFYUI_CORE_REVISION,
      requiredNodes: [{ name: "MiniMaxH3ImageToVideo" }],
      pythonPackages: [{ name: "json", version: "" }]
    };

    const res = await adapter.verify({
      comfyUiDir: nativeNodeDir,
      pythonPath: mockPythonPath,
      requiredRuntime: manifest
    });

    expect(res.ok).toBe(true);
    expect(res.status).toBe("verified");
  });

  describe("Catalog-Generated Manifest Verification Across Adapters", () => {
    const upgradedCoreRevision = "94cfeb3a5d8985efaa7ea9f5e5dfad4184ec99bf";
    const upgradedDir = path.join(mockRootDir, "upgraded-core-comfyui");

    beforeAll(() => {
      fs.mkdirSync(path.join(upgradedDir, "comfy_extras"), { recursive: true });
      fs.writeFileSync(
        path.join(upgradedDir, "comfy_extras", "nodes_minimax_h3.py"),
        "class MiniMaxH3ImageToVideo:\n    INPUT_TYPES = {}\nclass MiniMaxH3ReferenceToVideo:\n    INPUT_TYPES = {}\n"
      );
      fs.writeFileSync(
        path.join(upgradedDir, "comfy_extras", "nodes_sparse_attention.py"),
        "class ModelSparseAttention:\n    INPUT_TYPES = {}\nclass VedaSparseAttention:\n    INPUT_TYPES = {}\n"
      );
      fs.writeFileSync(
        path.join(upgradedDir, "comfy_extras", "nodes_model_advanced.py"),
        "class ModelAttentionBackend:\n    INPUT_TYPES = {}\n"
      );
      execSync("git init -b main", { cwd: upgradedDir });
      execSync('git config user.email "test@test.com"', { cwd: upgradedDir });
      execSync('git config user.name "Test"', { cwd: upgradedDir });
      execSync("git add .", { cwd: upgradedDir });
      execSync('git commit -m "init"', { cwd: upgradedDir });
      fs.writeFileSync(path.join(upgradedDir, ".git", "HEAD"), `${upgradedCoreRevision}\n`);
    });

    const createMockCatalogEntry = (
      overrides: Partial<MinimaxH3AttentionCatalogEntry>
    ): MinimaxH3AttentionCatalogEntry => ({
      variantName: "dense",
      route: "i2v",
      compatibilityState: "supported",
      scope: "test-scope",
      comfyuiCoreRevision: PINNED_COMFYUI_CORE_REVISION,
      runnable: true,
      backend: "torch_sdpa",
      kernel: "torch.nn.functional.scaled_dot_product_attention",
      requiredNodes: [],
      pythonPackages: [{ name: "torch", version: "2.5.1+cu124" }],
      cudaRequirement: ">=12.4",
      computeCapability: "sm_89",
      supportedDtypes: ["float16", "bfloat16"],
      checkpointCompatibility: {
        filename: "minimax_h3_ref2va_pruned_int8_convrot.safetensors",
        sha256: "9255f52b6677845ad238f20dfaafa94727053694127ab7f255c048f0f9365779",
        taskMode: "ref2va_pruned_int8"
      },
      licensing: {
        status: "approved",
        licenseSourceRef: "https://example.com/license",
        securityReviewStatus: "passed"
      },
      denseRegionPolicy: {
        allowPlannedDense: true,
        description: "Dense test"
      },
      isolationInstructions: {
        venvSetup: "Standard",
        installRecipe: "None",
        teardownRecipe: "None"
      },
      blockers: [],
      evidence: [
        {
          url: "https://example.com",
          assertion: "Test assertion"
        }
      ],
      catalogDigest: "0000000000000000000000000000000000000000000000000000000000000000",
      ...overrides
    });

    it("CurrentPin adapter accepts Dense catalog manifest with torch.nn.functional.scaled_dot_product_attention", async () => {
      const adapter = new CurrentPinExperimentRuntimeAdapter();
      const entry = createMockCatalogEntry({
        variantName: "dense",
        kernel: "torch.nn.functional.scaled_dot_product_attention",
        comfyuiCoreRevision: PINNED_COMFYUI_CORE_REVISION
      });
      const manifest = buildRequiredRuntimeManifestFromAttentionCatalog(entry, "i2v", {
        sourceFileHashes: {}
      });

      const res = await adapter.verify({
        comfyUiDir: mockComfyDir,
        pythonPath: mockPythonPath,
        requiredRuntime: manifest
      });

      expect(res.ok).toBe(true);
      expect(res.status).toBe("verified");
    });

    it("CurrentPin adapter accepts SageAttention catalog manifest with sageattention.sageattn", async () => {
      const adapter = new CurrentPinExperimentRuntimeAdapter();
      const entry = createMockCatalogEntry({
        variantName: "sage",
        backend: "sage",
        kernel: "sageattention.sageattn",
        comfyuiCoreRevision: PINNED_COMFYUI_CORE_REVISION,
        pythonPackages: [
          { name: "sageattention", version: "2.1.1" },
          { name: "torch", version: "2.5.1+cu124" }
        ]
      });
      const manifest = buildRequiredRuntimeManifestFromAttentionCatalog(entry, "i2v", {
        sourceFileHashes: {}
      });

      const res = await adapter.verify({
        comfyUiDir: mockComfyDir,
        pythonPath: mockPythonPath,
        requiredRuntime: manifest
      });

      expect(res.ok).toBe(true);
      expect(res.status).toBe("verified");
    });

    it("CurrentPin adapter rejects Sol-Attn catalog manifest (requires isolated upgrade)", async () => {
      const adapter = new CurrentPinExperimentRuntimeAdapter();
      const entry = createMockCatalogEntry({
        variantName: "native-sol-attn",
        backend: "sol_attn",
        kernel: "comfy_kitchen.sol_attn",
        comfyuiCoreRevision: PINNED_COMFYUI_CORE_REVISION,
        requiredNodes: [{ name: "ModelSparseAttention", classType: "ModelSparseAttention" }]
      });
      const manifest = buildRequiredRuntimeManifestFromAttentionCatalog(entry, "i2v", {
        sourceFileHashes: {}
      });

      const res = await adapter.verify({
        comfyUiDir: mockComfyDir,
        pythonPath: mockPythonPath,
        requiredRuntime: manifest
      });

      expect(res.ok).toBe(false);
      expect(res.status).toBe("conflict");
      expect(res.blocker).toContain('does not support attention kernel "comfy_kitchen.sol_attn"');
    });

    it("IsolatedUpgrade adapter accepts Dense catalog manifest on upgraded core", async () => {
      const adapter = new IsolatedUpgradeExperimentRuntimeAdapter(
        upgradedCoreRevision,
        "upgraded-core-isolated-adapter-v1",
        ["ModelSparseAttention", "VedaSparseAttention"]
      );
      const entry = createMockCatalogEntry({
        variantName: "dense",
        kernel: "torch.nn.functional.scaled_dot_product_attention",
        comfyuiCoreRevision: upgradedCoreRevision
      });
      const upgradedSourceHash = createHash("sha256")
        .update(fs.readFileSync(path.join(upgradedDir, "comfy_extras", "nodes_minimax_h3.py")))
        .digest("hex");

      const manifest = buildRequiredRuntimeManifestFromAttentionCatalog(entry, "i2v", {
        sourceFileHashes: {
          "comfy_extras/nodes_minimax_h3.py": upgradedSourceHash
        },
        collectorDigest: "2222222222222222222222222222222222222222222222222222222222222222",
        hookManifestDigest: "3333333333333333333333333333333333333333333333333333333333333333",
        pytorchBuild: "2.5.1+cu124",
        cudaBuild: "12.4"
      });

      const res = await adapter.verify({
        comfyUiDir: upgradedDir,
        pythonPath: mockPythonPath,
        requiredRuntime: manifest
      });

      expect(res.ok).toBe(true);
      expect(res.status).toBe("verified");
    });

    it("IsolatedUpgrade adapter accepts Sol-Attn catalog manifest on upgraded core", async () => {
      const adapter = new IsolatedUpgradeExperimentRuntimeAdapter(
        upgradedCoreRevision,
        "upgraded-core-isolated-adapter-v1",
        ["ModelSparseAttention", "VedaSparseAttention"]
      );
      const entry = createMockCatalogEntry({
        variantName: "native-sol-attn",
        backend: "sol_attn",
        kernel: "comfy_kitchen.sol_attn",
        comfyuiCoreRevision: upgradedCoreRevision,
        requiredNodes: [{ name: "ModelSparseAttention", classType: "ModelSparseAttention" }],
        pythonPackages: [
          { name: "comfy-kitchen", version: "0.2.31" },
          { name: "torch", version: "2.5.1+cu124" }
        ]
      });
      const upgradedSourceHash = createHash("sha256")
        .update(fs.readFileSync(path.join(upgradedDir, "comfy_extras", "nodes_minimax_h3.py")))
        .digest("hex");

      const manifest = buildRequiredRuntimeManifestFromAttentionCatalog(entry, "i2v", {
        sourceFileHashes: {
          "comfy_extras/nodes_minimax_h3.py": upgradedSourceHash
        },
        collectorDigest: "2222222222222222222222222222222222222222222222222222222222222222",
        hookManifestDigest: "3333333333333333333333333333333333333333333333333333333333333333",
        pytorchBuild: "2.5.1+cu124",
        cudaBuild: "12.4"
      });

      const res = await adapter.verify({
        comfyUiDir: upgradedDir,
        pythonPath: mockPythonPath,
        requiredRuntime: manifest
      });

      expect(res.ok).toBe(true);
      expect(res.status).toBe("verified");
    });

    it("IsolatedUpgrade adapter accepts Veda catalog manifest on upgraded core", async () => {
      const adapter = new IsolatedUpgradeExperimentRuntimeAdapter(
        upgradedCoreRevision,
        "upgraded-core-isolated-adapter-v1",
        ["ModelSparseAttention", "VedaSparseAttention"]
      );
      const entry = createMockCatalogEntry({
        variantName: "veda",
        backend: "veda",
        kernel: "veda_sparse_attention.triton_kernel",
        comfyuiCoreRevision: upgradedCoreRevision,
        requiredNodes: [{ name: "VedaSparseAttention", classType: "VedaSparseAttention" }],
        pythonPackages: [
          { name: "veda-sparse-attention", version: "1.0.0" },
          { name: "torch", version: "2.5.1+cu124" }
        ]
      });
      const upgradedSourceHash = createHash("sha256")
        .update(fs.readFileSync(path.join(upgradedDir, "comfy_extras", "nodes_minimax_h3.py")))
        .digest("hex");

      const manifest = buildRequiredRuntimeManifestFromAttentionCatalog(entry, "i2v", {
        sourceFileHashes: {
          "comfy_extras/nodes_minimax_h3.py": upgradedSourceHash
        },
        collectorDigest: "2222222222222222222222222222222222222222222222222222222222222222",
        hookManifestDigest: "3333333333333333333333333333333333333333333333333333333333333333",
        pytorchBuild: "2.5.1+cu124",
        cudaBuild: "12.4"
      });

      const res = await adapter.verify({
        comfyUiDir: upgradedDir,
        pythonPath: mockPythonPath,
        requiredRuntime: manifest
      });

      expect(res.ok).toBe(true);
      expect(res.status).toBe("verified");
    });

    it("Cross-adapter: FastH3 adapter rejects Veda manifest (unsupported kernel on FastH3 revision)", async () => {
      const adapter = new IsolatedUpgradeExperimentRuntimeAdapter(
        FASTH3_ISOLATED_CORE_REVISION,
        "fasth3-isolated-upgrade-adapter-v1",
        ["MiniMaxH3ImageToVideo", "BlockSparseAttention"]
      );
      const entry = createMockCatalogEntry({
        variantName: "veda",
        backend: "veda",
        kernel: "veda_sparse_attention.triton_kernel",
        comfyuiCoreRevision: FASTH3_ISOLATED_CORE_REVISION
      });
      const manifest = buildRequiredRuntimeManifestFromAttentionCatalog(entry, "i2v", {
        sourceFileHashes: {
          "comfy_extras/nodes_minimax_h3.py": "1".repeat(64)
        },
        collectorDigest: "1".repeat(64),
        hookManifestDigest: "1".repeat(64),
        pytorchBuild: "2.5.1+cu124",
        cudaBuild: "12.4"
      });

      const res = await adapter.verify({
        comfyUiDir: path.join(mockRootDir, "fasth3-checkout"),
        pythonPath: mockPythonPath,
        requiredRuntime: manifest
      });

      expect(res.ok).toBe(false);
      expect(res.status).toBe("conflict");
      expect(res.blocker).toContain(
        'does not support attention kernel "veda_sparse_attention.triton_kernel"'
      );
    });

    it("Cross-adapter: CurrentPin adapter rejects FastH3 manifest", async () => {
      const adapter = new CurrentPinExperimentRuntimeAdapter();
      const manifest: MinimaxH3RequiredRuntimeManifest = {
        ...baseManifest,
        coreRevision: FASTH3_ISOLATED_CORE_REVISION,
        attentionKernel: "block_sparse_triton"
      };

      const res = await adapter.verify({
        comfyUiDir: mockComfyDir,
        pythonPath: mockPythonPath,
        requiredRuntime: manifest
      });

      expect(res.ok).toBe(false);
      expect(res.status).toBe("conflict");
      expect(res.blocker).toContain("Current pinned adapter expected manifest revision");
    });
  });

  it("rejects when class exists in file alongside other valid classes but lacks class-scoped schema", async () => {
    const adapter = new CurrentPinExperimentRuntimeAdapter();
    const multiClassDir = path.join(mockRootDir, "multi-class-dir");
    fs.mkdirSync(path.join(multiClassDir, "comfy_extras"), { recursive: true });
    // MiniMaxH3ImageToVideo has valid schema, but MiniMaxH3ReferenceToVideo is a bare class without schema or mapping
    fs.writeFileSync(
      path.join(multiClassDir, "comfy_extras", "nodes_minimax_h3.py"),
      `class MiniMaxH3ImageToVideo:
    @classmethod
    def INPUT_TYPES(s):
        return {}

class MiniMaxH3ReferenceToVideo:
    pass
`
    );
    execSync("git init -b main", { cwd: multiClassDir });
    execSync('git config user.email "test@test.com"', { cwd: multiClassDir });
    execSync('git config user.name "Test"', { cwd: multiClassDir });
    execSync("git add .", { cwd: multiClassDir });
    execSync('git commit -m "init"', { cwd: multiClassDir });
    fs.writeFileSync(path.join(multiClassDir, ".git", "HEAD"), `${PINNED_COMFYUI_CORE_REVISION}\n`);

    const manifest: MinimaxH3RequiredRuntimeManifest = {
      ...baseManifest,
      coreRevision: PINNED_COMFYUI_CORE_REVISION,
      requiredNodes: [{ name: "MiniMaxH3ReferenceToVideo" }]
    };

    const res = await adapter.verify({
      comfyUiDir: multiClassDir,
      pythonPath: mockPythonPath,
      requiredRuntime: manifest
    });

    expect(res.ok).toBe(false);
    expect(res.status).toBe("conflict");
    expect(res.blocker).toContain(
      'nodes_minimax_h3.py does not define a schema-valid ComfyUI node class or register "MiniMaxH3ReferenceToVideo" in NODE_CLASS_MAPPINGS.'
    );
  });

  it("rejects block_sparse_triton when comfy_kitchen.sol_attn_chunked is missing", async () => {
    const adapter = new IsolatedUpgradeExperimentRuntimeAdapter(
      FASTH3_ISOLATED_CORE_REVISION,
      "fasth3-isolated-upgrade-adapter-v1",
      ["MiniMaxH3ImageToVideo", "BlockSparseAttention"]
    );
    const mockFailingPython = path.join(mockRootDir, "failing-python.sh");
    // Mock python that simulates missing sol_attn_chunked
    const script = `#!/bin/sh
if [ "$1" = "-c" ]; then
  if echo "$2" | grep -q "torch.__version__"; then
    echo "2.5.1+cu124|12.4"
    exit 0
  fi
  if echo "$2" | grep -q "sol_attn_chunked"; then
    echo "sol_attn_chunked_missing"
    exit 1
  fi
  if echo "$2" | grep -q "dist_name = sys.argv\\[1\\]"; then
    echo "ok"
    exit 0
  fi
fi
if echo "$1" | grep -q "minimax-h3-package-inspector.py"; then
  echo 'ok:{"ok":true,"name":"torch","version":"2.5.1","artifactHash":"2222222222222222222222222222222222222222222222222222222222222222","artifactMethod":"installed_record_sha256_v1","fileCount":3}'
  exit 0
fi
exec /usr/bin/python3 "$@"
`;
    fs.writeFileSync(mockFailingPython, script, { mode: 0o755 });

    const manifest: MinimaxH3RequiredRuntimeManifest = {
      ...baseManifest,
      coreRevision: FASTH3_ISOLATED_CORE_REVISION,
      requiredNodes: [{ name: "MiniMaxH3ImageToVideo" }],
      attentionKernel: "block_sparse_triton"
    };

    const res = await adapter.verify({
      comfyUiDir: path.join(mockRootDir, "fasth3-checkout"),
      pythonPath: mockFailingPython,
      requiredRuntime: manifest
    });

    expect(res.ok).toBe(false);
    expect(res.status).toBe("conflict");
    expect(res.blocker).toContain('Attention kernel "block_sparse_triton"');
  });

  describe("Independently Verified Identity & Acceptance Criteria", () => {
    it("fails verification when python package module lacks __file__ attribute", async () => {
      const adapter = new CurrentPinExperimentRuntimeAdapter();
      // Built-in 'sys' module has no __file__ attribute
      const manifest: MinimaxH3RequiredRuntimeManifest = {
        ...baseManifest,
        coreRevision: PINNED_COMFYUI_CORE_REVISION,
        requiredNodes: [],
        pythonPackages: [{ name: "sys", importModule: "sys", version: "" }]
      };

      const res = await adapter.verify({
        comfyUiDir: mockComfyDir,
        pythonPath: mockPythonPath,
        requiredRuntime: manifest
      });

      expect(res.ok).toBe(false);
      expect(res.status).toBe("conflict");
      expect(res.blocker).toContain("missing_file_attribute");
    });

    it("rejects when PyTorch environment cudaBuild does not match required manifest", async () => {
      const adapter = new CurrentPinExperimentRuntimeAdapter();
      const mockCudaMismatchPython = path.join(mockRootDir, "cuda-mismatch-python.sh");
      const script = `#!/bin/sh
if [ "$1" = "-c" ]; then
  if echo "$2" | grep -q "torch.__version__"; then
    echo "2.5.1+cu124|12.1"
    exit 0
  fi
  if echo "$2" | grep -q "scaled_dot_product_attention"; then
    echo "ok"
    exit 0
  fi
fi
exec /usr/bin/python3 "$@"
`;
      fs.writeFileSync(mockCudaMismatchPython, script, { mode: 0o755 });

      const manifest: MinimaxH3RequiredRuntimeManifest = {
        ...baseManifest,
        coreRevision: PINNED_COMFYUI_CORE_REVISION,
        cudaBuild: "12.4"
      };

      const res = await adapter.verify({
        comfyUiDir: mockComfyDir,
        pythonPath: mockCudaMismatchPython,
        requiredRuntime: manifest
      });

      expect(res.ok).toBe(false);
      expect(res.status).toBe("conflict");
      expect(res.blocker).toContain("CUDA build version mismatch: expected 12.4, got 12.1");
    });

    it("blocks verified status with 'unknown' when host driver evidence is missing", async () => {
      const adapter = new CurrentPinExperimentRuntimeAdapter();
      // Temporarily remove driver override
      const savedDriver = process.env.CCO_DRIVER_VERSION_OVERRIDE;
      delete process.env.CCO_DRIVER_VERSION_OVERRIDE;
      try {
        const res = await adapter.verify({
          comfyUiDir: mockComfyDir,
          pythonPath: mockPythonPath,
          requiredRuntime: baseManifest,
          driverQueryCommand: {
            command: "false" // fails immediately
          }
        });

        expect(res.ok).toBe(false);
        expect(res.status).toBe("unknown");
        expect(res.blocker).toContain("Missing NVIDIA driver evidence");
      } finally {
        if (savedDriver) process.env.CCO_DRIVER_VERSION_OVERRIDE = savedDriver;
      }
    });

    it("rejects with conflict when host driver violates constraint with dotted numeric comparison", async () => {
      const adapter = new CurrentPinExperimentRuntimeAdapter();
      const manifest: MinimaxH3RequiredRuntimeManifest = {
        ...baseManifest,
        coreRevision: PINNED_COMFYUI_CORE_REVISION,
        driverConstraints: [">=555.42.02"]
      };

      const res = await adapter.verify({
        comfyUiDir: mockComfyDir,
        pythonPath: mockPythonPath,
        requiredRuntime: manifest,
        driverQueryCommand: { command: "echo", args: ["550.54.14"] } // 550 < 555
      });

      expect(res.ok).toBe(false);
      expect(res.status).toBe("conflict");
      expect(res.blocker).toContain(
        'Host NVIDIA driver version 550.54.14 does not satisfy required constraint ">=555.42.02"'
      );
    });

    it("accepts when host driver satisfies dotted numeric constraint with multi-segment versions", async () => {
      const adapter = new CurrentPinExperimentRuntimeAdapter();
      const manifest: MinimaxH3RequiredRuntimeManifest = {
        ...baseManifest,
        coreRevision: PINNED_COMFYUI_CORE_REVISION,
        driverConstraints: [">=550.54.10", "<=550.54.20"]
      };

      const res = await adapter.verify({
        comfyUiDir: mockComfyDir,
        pythonPath: mockPythonPath,
        requiredRuntime: manifest,
        driverQueryCommand: { command: "echo", args: ["550.54.14"] }
      });

      expect(res.ok).toBe(true);
      expect(res.status).toBe("verified");
    });

    it("rejects malformed driver constraints", async () => {
      const adapter = new CurrentPinExperimentRuntimeAdapter();
      const manifest: MinimaxH3RequiredRuntimeManifest = {
        ...baseManifest,
        coreRevision: PINNED_COMFYUI_CORE_REVISION,
        driverConstraints: ["~=550.00"] // unsupported operator
      };

      const res = await adapter.verify({
        comfyUiDir: mockComfyDir,
        pythonPath: mockPythonPath,
        requiredRuntime: manifest,
        driverQueryCommand: { command: "echo", args: ["550.54.14"] }
      });

      expect(res.ok).toBe(false);
      expect(res.status).toBe("conflict");
      expect(res.blocker).toContain('Malformed or unsupported driver constraint "~=550.00"');
    });

    it("rejects malformed driver versions and constraints with doubled, leading, or trailing dots (F-780279b3)", async () => {
      const adapter = new CurrentPinExperimentRuntimeAdapter();

      // Doubled dot in constraint
      const resConstraint = await adapter.verify({
        comfyUiDir: mockComfyDir,
        pythonPath: mockPythonPath,
        requiredRuntime: {
          ...baseManifest,
          coreRevision: PINNED_COMFYUI_CORE_REVISION,
          driverConstraints: [">=550..00"]
        },
        driverQueryCommand: { command: "echo", args: ["560.35.03"] }
      });
      expect(resConstraint.ok).toBe(false);
      expect(resConstraint.status).toBe("conflict");
      expect(resConstraint.blocker).toContain("Malformed or unsupported driver constraint");

      // Doubled dot in observed driver
      const resDriver = await adapter.verify({
        comfyUiDir: mockComfyDir,
        pythonPath: mockPythonPath,
        requiredRuntime: {
          ...baseManifest,
          coreRevision: PINNED_COMFYUI_CORE_REVISION,
          driverConstraints: [">=550.00.00"]
        },
        driverQueryCommand: { command: "echo", args: ["560..35.03"] }
      });
      expect(resDriver.ok).toBe(false);
      expect(resDriver.status).toBe("conflict");
      expect(resDriver.blocker).toContain('Malformed driver version "560..35.03"');
    });

    it("IsolatedUpgrade adapter admits sparse nodes based on source definitions, not hardcoded constructor list", async () => {
      // Create adapter with empty constructor list
      const adapter = new IsolatedUpgradeExperimentRuntimeAdapter(
        FASTH3_ISOLATED_CORE_REVISION,
        "fasth3-isolated-upgrade-adapter-v1",
        [] // empty extra nodes in constructor!
      );

      const fasth3NodesDir = path.join(mockRootDir, "fasth3-nodes-dir");
      const manifest: MinimaxH3RequiredRuntimeManifest = {
        ...baseManifest,
        coreRevision: FASTH3_ISOLATED_CORE_REVISION,
        requiredNodes: [
          { name: "MiniMaxH3SigmaShift" },
          { name: "ModelAttentionBackend" },
          { name: "BlockSparseAttention" }
        ],
        attentionKernel: "block_sparse_triton"
      };

      const res = await adapter.verify({
        comfyUiDir: fasth3NodesDir,
        pythonPath: mockPythonPath,
        requiredRuntime: manifest
      });

      expect(res.ok).toBe(true);
      expect(res.status).toBe("verified");
    });

    it("package inspector audits RECORD and detects hash modification", () => {
      const tempPkgDir = path.join(mockRootDir, "fake-pkg-site");
      fs.mkdirSync(path.join(tempPkgDir, "sample_pkg"), { recursive: true });
      fs.mkdirSync(path.join(tempPkgDir, "sample_pkg-1.0.0.dist-info"), { recursive: true });

      const pyContent = 'def hello():\n    return "world"\n';
      const pyPath = path.join(tempPkgDir, "sample_pkg", "__init__.py");
      fs.writeFileSync(pyPath, pyContent);

      const pyHashRaw = createHash("sha256").update(pyContent).digest();
      const pyHashB64 = Buffer.from(pyHashRaw).toString("base64url").replace(/=+$/, "");

      const metadataContent = "Metadata-Version: 2.1\nName: sample-pkg\nVersion: 1.0.0\n";
      const metaPath = path.join(tempPkgDir, "sample_pkg-1.0.0.dist-info", "METADATA");
      fs.writeFileSync(metaPath, metadataContent);
      const metaHashRaw = createHash("sha256").update(metadataContent).digest();
      const metaHashB64 = Buffer.from(metaHashRaw).toString("base64url").replace(/=+$/, "");

      const recordContent = `sample_pkg/__init__.py,sha256=${pyHashB64},${pyContent.length}\nsample_pkg-1.0.0.dist-info/METADATA,sha256=${metaHashB64},${metadataContent.length}\nsample_pkg-1.0.0.dist-info/RECORD,,\n`;
      fs.writeFileSync(
        path.join(tempPkgDir, "sample_pkg-1.0.0.dist-info", "RECORD"),
        recordContent
      );

      const expectedHash = "ea2090faad2cf7663e8421955a60b4603e745e8482d63b9b9c1c75384c561e78";

      // 1. Valid inspector run
      const inspectorCmd = `PYTHONPATH="${tempPkgDir}:$PYTHONPATH" python3 packages/infrastructure/src/experiments/minimax-h3-package-inspector.py sample-pkg 1.0.0 sample_pkg ${expectedHash} installed_record_sha256_v1`;
      const out = execSync(inspectorCmd, { encoding: "utf8" });
      expect(out).toContain("ok:");
      const parsed = JSON.parse(out.trim().slice(3));
      expect(parsed.name).toBe("sample-pkg");
      expect(parsed.artifactMethod).toBe("installed_record_sha256_v1");
      expect(parsed.fileCount).toBe(2);

      // 2. Tampered file fails with record_hash_mismatch
      fs.writeFileSync(pyPath, 'def hello():\n    return "tampered"\n');
      let failed = false;
      try {
        execSync(inspectorCmd, { encoding: "utf8" });
      } catch (err) {
        failed = true;
        const errObj = err as { stdout?: string; stderr?: string };
        expect((errObj.stdout ?? "") + (errObj.stderr ?? "")).toContain("record_hash_mismatch");
      }
      expect(failed).toBe(true);

      // 3. Missing RECORD fails with missing_record
      fs.rmSync(path.join(tempPkgDir, "sample_pkg-1.0.0.dist-info", "RECORD"));
      let missingRecordFailed = false;
      try {
        execSync(inspectorCmd, { encoding: "utf8" });
      } catch (err) {
        missingRecordFailed = true;
        const errObj = err as { stdout?: string; stderr?: string };
        expect((errObj.stdout ?? "") + (errObj.stderr ?? "")).toContain("missing_record");
      }
      expect(missingRecordFailed).toBe(true);

      // 4. Missing expected hash fails closed with missing_expected_hash
      const noExpectedCmd = `PYTHONPATH="${tempPkgDir}:$PYTHONPATH" python3 packages/infrastructure/src/experiments/minimax-h3-package-inspector.py sample-pkg 1.0.0 sample_pkg`;
      let missingExpectedFailed = false;
      try {
        execSync(noExpectedCmd, { encoding: "utf8" });
      } catch (err) {
        missingExpectedFailed = true;
        const errObj = err as { stdout?: string; stderr?: string };
        expect((errObj.stdout ?? "") + (errObj.stderr ?? "")).toContain("missing_expected_hash");
      }
      expect(missingExpectedFailed).toBe(true);

      // 5. Empty RECORD fails closed with empty_record
      fs.writeFileSync(path.join(tempPkgDir, "sample_pkg-1.0.0.dist-info", "RECORD"), "\n");
      let emptyRecordFailed = false;
      try {
        execSync(inspectorCmd, { encoding: "utf8" });
      } catch (err) {
        emptyRecordFailed = true;
        const errObj = err as { stdout?: string; stderr?: string };
        expect((errObj.stdout ?? "") + (errObj.stderr ?? "")).toContain("empty_record");
      }
      expect(emptyRecordFailed).toBe(true);

      // 6. Shadowed module fails closed with unverified_import_ownership
      fs.writeFileSync(pyPath, pyContent);
      fs.writeFileSync(
        path.join(tempPkgDir, "sample_pkg-1.0.0.dist-info", "RECORD"),
        recordContent
      );
      const shadowDir = path.join(mockRootDir, "shadow-site");
      fs.mkdirSync(path.join(shadowDir, "sample_pkg"), { recursive: true });
      fs.writeFileSync(
        path.join(shadowDir, "sample_pkg", "__init__.py"),
        'def hello(): return "shadow"\n'
      );
      const shadowCmd = `PYTHONPATH="${shadowDir}:${tempPkgDir}:$PYTHONPATH" python3 packages/infrastructure/src/experiments/minimax-h3-package-inspector.py sample-pkg 1.0.0 sample_pkg ${expectedHash} installed_record_sha256_v1`;
      let shadowFailed = false;
      try {
        execSync(shadowCmd, { encoding: "utf8" });
      } catch (err) {
        shadowFailed = true;
        const errObj = err as { stdout?: string; stderr?: string };
        expect((errObj.stdout ?? "") + (errObj.stderr ?? "")).toContain("import_shadowing");
      }
      expect(shadowFailed).toBe(true);

      // 7. Unsupported RECORD hash algorithm fails with unsupported_record_hash_algorithm
      const sha1Record = `sample_pkg/__init__.py,sha1=da39a3ee5e6b4b0d3255bfef95601890afd80709,${pyContent.length}\nsample_pkg-1.0.0.dist-info/RECORD,,\n`;
      fs.writeFileSync(path.join(tempPkgDir, "sample_pkg-1.0.0.dist-info", "RECORD"), sha1Record);
      let algoFailed = false;
      try {
        execSync(inspectorCmd, { encoding: "utf8" });
      } catch (err) {
        algoFailed = true;
        const errObj = err as { stdout?: string; stderr?: string };
        expect((errObj.stdout ?? "") + (errObj.stderr ?? "")).toContain(
          "unsupported_record_hash_algorithm"
        );
      }
      expect(algoFailed).toBe(true);

      // 8. Empty RECORD hash declaration fails with missing_record_hash_declaration
      const emptyHashRecord = `sample_pkg/__init__.py,sha256=,${pyContent.length}\nsample_pkg-1.0.0.dist-info/RECORD,,\n`;
      fs.writeFileSync(
        path.join(tempPkgDir, "sample_pkg-1.0.0.dist-info", "RECORD"),
        emptyHashRecord
      );
      let emptyHashFailed = false;
      try {
        execSync(inspectorCmd, { encoding: "utf8" });
      } catch (err) {
        emptyHashFailed = true;
        const errObj = err as { stdout?: string; stderr?: string };
        expect((errObj.stdout ?? "") + (errObj.stderr ?? "")).toContain(
          "missing_record_hash_declaration"
        );
      }
      expect(emptyHashFailed).toBe(true);

      // 9. RECORD file size mismatch fails with record_size_mismatch
      const mismatchedSizeRecord = `sample_pkg/__init__.py,sha256=${pyHashB64},99999\nsample_pkg-1.0.0.dist-info/RECORD,,\n`;
      fs.writeFileSync(
        path.join(tempPkgDir, "sample_pkg-1.0.0.dist-info", "RECORD"),
        mismatchedSizeRecord
      );
      let sizeMismatchFailed = false;
      try {
        execSync(inspectorCmd, { encoding: "utf8" });
      } catch (err) {
        sizeMismatchFailed = true;
        const errObj = err as { stdout?: string; stderr?: string };
        expect((errObj.stdout ?? "") + (errObj.stderr ?? "")).toContain("record_size_mismatch");
      }
      expect(sizeMismatchFailed).toBe(true);

      // 10. Unsupported editable install fails with unsupported_editable_install
      fs.writeFileSync(
        path.join(tempPkgDir, "sample_pkg-1.0.0.dist-info", "RECORD"),
        recordContent
      );
      fs.writeFileSync(
        path.join(tempPkgDir, "sample_pkg-1.0.0.dist-info", "direct_url.json"),
        JSON.stringify({ url: "file:///local/path", dir_info: { editable: true } })
      );
      let editableFailed = false;
      try {
        execSync(inspectorCmd, { encoding: "utf8" });
      } catch (err) {
        editableFailed = true;
        const errObj = err as { stdout?: string; stderr?: string };
        expect((errObj.stdout ?? "") + (errObj.stderr ?? "")).toContain(
          "unsupported_editable_install"
        );
      }
      expect(editableFailed).toBe(true);
      fs.unlinkSync(path.join(tempPkgDir, "sample_pkg-1.0.0.dist-info", "direct_url.json"));
    });

    it("handles verifyPythonPackage timeout and abort signal", async () => {
      const stallingPython = path.join(mockRootDir, "stalling-python.sh");
      fs.writeFileSync(
        stallingPython,
        `#!/bin/sh
sleep 10
exit 0
`,
        { mode: 0o755 }
      );

      const { verifyPythonPackage } = await import("./minimax-h3-runtime-registry.js");
      const pkg = {
        name: "test-pkg",
        version: "1.0.0",
        artifactHash: "1111111111111111111111111111111111111111111111111111111111111111",
        artifactMethod: "installed_record_sha256_v1"
      };

      // 1. Timeout
      const timeoutRes = await verifyPythonPackage(stallingPython, pkg, { timeoutMs: 100 });
      expect(timeoutRes.ok).toBe(false);
      expect(timeoutRes.blocker).toContain("timed out");

      // 2. AbortSignal
      const controller = new AbortController();
      setTimeout(() => controller.abort(), 50);
      const abortRes = await verifyPythonPackage(stallingPython, pkg, {
        signal: controller.signal,
        timeoutMs: 5000
      });
      expect(abortRes.ok).toBe(false);
      expect(abortRes.blocker).toContain("aborted");
    });

    it("built-package contains packaged inspector asset and runs successfully against fixture", () => {
      const builtInspectorPath = path.resolve(
        "packages/infrastructure/dist/experiments/minimax-h3-package-inspector.py"
      );
      expect(fs.existsSync(builtInspectorPath)).toBe(true);

      const tempPkgDir = path.join(mockRootDir, "fake-pkg-site");
      const pyContent = 'def hello():\n    return "world"\n';
      fs.writeFileSync(path.join(tempPkgDir, "sample_pkg", "__init__.py"), pyContent);
      const pyHashRaw = createHash("sha256").update(pyContent).digest();
      const pyHashB64 = Buffer.from(pyHashRaw).toString("base64url").replace(/=+$/, "");
      const metadataContent = "Metadata-Version: 2.1\nName: sample-pkg\nVersion: 1.0.0\n";
      fs.writeFileSync(
        path.join(tempPkgDir, "sample_pkg-1.0.0.dist-info", "METADATA"),
        metadataContent
      );
      const metaHashRaw = createHash("sha256").update(metadataContent).digest();
      const metaHashB64 = Buffer.from(metaHashRaw).toString("base64url").replace(/=+$/, "");
      const recordContent = `sample_pkg/__init__.py,sha256=${pyHashB64},${pyContent.length}\nsample_pkg-1.0.0.dist-info/METADATA,sha256=${metaHashB64},${metadataContent.length}\nsample_pkg-1.0.0.dist-info/RECORD,,\n`;
      fs.writeFileSync(
        path.join(tempPkgDir, "sample_pkg-1.0.0.dist-info", "RECORD"),
        recordContent
      );

      const expectedHash = "ea2090faad2cf7663e8421955a60b4603e745e8482d63b9b9c1c75384c561e78";
      const cmd = `PYTHONPATH="${tempPkgDir}:$PYTHONPATH" python3 "${builtInspectorPath}" sample-pkg 1.0.0 sample_pkg ${expectedHash} installed_record_sha256_v1`;
      const out = execSync(cmd, { encoding: "utf8" });
      expect(out).toContain("ok:");
      const parsed = JSON.parse(out.trim().slice(3));
      expect(parsed.name).toBe("sample-pkg");
      expect(parsed.artifactHash).toBe(expectedHash);
    });
  });
});
