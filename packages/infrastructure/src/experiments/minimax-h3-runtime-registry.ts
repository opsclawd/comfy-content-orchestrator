import { execFile } from "node:child_process";
import { createHash } from "node:crypto";
import { readFile, readdir } from "node:fs/promises";
import { resolve } from "node:path";
import { promisify } from "node:util";
import {
  PINNED_COMFYUI_CORE_REVISION,
  AUDITED_ATTENTION_KERNELS,
  resolveAuditedKernel,
  type MinimaxH3RequiredRuntimeManifest,
  type MinimaxH3ObservedProvenance
} from "@cco/contracts";

const execFileAsync = promisify(execFile);

export interface ExperimentRuntimeVerificationResult {
  ok: boolean;
  status: "verified" | "conflict" | "unknown";
  blocker?: string;
  observations?: MinimaxH3ObservedProvenance;
  adapterRegistered: boolean;
}

export interface ExperimentRuntimeAdapter {
  readonly coreRevision: string;
  readonly adapterName: string;
  verify(options: {
    comfyUiDir: string;
    pythonPath: string;
    requiredRuntime: MinimaxH3RequiredRuntimeManifest;
    expectedCheckpointHash?: string;
  }): Promise<{
    ok: boolean;
    status: "verified" | "conflict" | "unknown";
    blocker?: string;
    observations?: MinimaxH3ObservedProvenance;
  }>;
}

const FIXED_PACKAGE_INSPECTION_SCRIPT = `
import sys
import importlib
import importlib.metadata
import hashlib

dist_name = sys.argv[1]
expected_ver = sys.argv[2] if len(sys.argv) > 2 and sys.argv[2] else None
import_mod = sys.argv[3] if len(sys.argv) > 3 and sys.argv[3] else dist_name.replace("-", "_")
expected_hash = sys.argv[4] if len(sys.argv) > 4 and sys.argv[4] else None

try:
    mod = importlib.import_module(import_mod)
except Exception as e:
    print(f"import_error:{e}")
    sys.exit(1)

if expected_ver:
    try:
        installed_ver = importlib.metadata.version(dist_name)
    except Exception as e:
        print(f"metadata_error:failed_to_resolve_version_for_{dist_name}:{e}")
        sys.exit(1)
    if installed_ver != expected_ver:
        print(f"version_mismatch:expected_{expected_ver}_got_{installed_ver}")
        sys.exit(1)

if expected_hash:
    mod_file = getattr(mod, "__file__", None)
    if mod_file:
        try:
            h = hashlib.sha256()
            with open(mod_file, "rb") as f:
                while chunk := f.read(65536):
                    h.update(chunk)
            actual_file_hash = h.hexdigest()
            if actual_file_hash != expected_hash:
                print(f"hash_mismatch:expected_{expected_hash}_got_{actual_file_hash}")
                sys.exit(1)
        except Exception as e:
            print(f"hash_error:{e}")
            sys.exit(1)

print("ok")
`.trim();

async function verifyPythonPackage(
  pythonPath: string,
  pkg: {
    name: string;
    version?: string | undefined;
    importModule?: string | undefined;
    artifactHash?: string | undefined;
  }
): Promise<{ ok: boolean; blocker?: string }> {
  try {
    const { stdout, stderr } = await execFileAsync(pythonPath, [
      "-c",
      FIXED_PACKAGE_INSPECTION_SCRIPT,
      pkg.name,
      pkg.version ?? "",
      pkg.importModule ?? "",
      pkg.artifactHash ?? ""
    ]);
    const out = stdout.trim();
    if (out !== "ok") {
      return {
        ok: false,
        blocker: `Required Python package "${pkg.name}" verification failed: ${out || stderr.trim()}`
      };
    }
    return { ok: true };
  } catch (err) {
    return {
      ok: false,
      blocker: `Required Python package "${pkg.name}" is not installed or importable: ${(err as Error).message}`
    };
  }
}

async function verifyRequiredKernelCapability(
  pythonPath: string,
  attentionKernel: string
): Promise<{ ok: boolean; blocker?: string }> {
  const audited = resolveAuditedKernel(attentionKernel);
  if (!audited) {
    return {
      ok: false,
      blocker: `Unknown or unaudited attention kernel "${attentionKernel}".`
    };
  }

  let checkSnippet: string;
  switch (audited.canonicalName) {
    case "torch_sdpa":
      checkSnippet =
        'import sys\ntry:\n    import torch\n    if not hasattr(torch.nn.functional, "scaled_dot_product_attention"):\n        print("sdpa_missing")\n        sys.exit(1)\n    print("ok")\nexcept Exception as e:\n    print(f"sdpa_error:{e}")\n    sys.exit(1)';
      break;
    case "sage":
      checkSnippet =
        'import sys\ntry:\n    import sageattention\n    print("ok")\nexcept Exception as e:\n    print(f"sage_error:{e}")\n    sys.exit(1)';
      break;
    case "sol_attn":
      checkSnippet =
        'import sys\ntry:\n    import comfy_kitchen\n    print("ok")\nexcept Exception as e:\n    print(f"sol_attn_error:{e}")\n    sys.exit(1)';
      break;
    case "veda":
      checkSnippet =
        'import sys\ntry:\n    import veda_sparse_attention\n    print("ok")\nexcept Exception as e:\n    print(f"veda_error:{e}")\n    sys.exit(1)';
      break;
    case "block_sparse_triton":
      checkSnippet =
        'import sys\ntry:\n    import torch\n    import comfy_kitchen\n    if not hasattr(comfy_kitchen, "sol_attn_chunked"):\n        print("sol_attn_chunked_missing")\n        sys.exit(1)\n    print("ok")\nexcept Exception as e:\n    print(f"block_sparse_error:{e}")\n    sys.exit(1)';
      break;
    default:
      checkSnippet = 'print("ok")';
  }

  try {
    const { stdout, stderr } = await execFileAsync(pythonPath, ["-c", checkSnippet]);
    const trimmed = stdout.trim();
    if (trimmed !== "ok") {
      return {
        ok: false,
        blocker: `Attention kernel capability check failed for "${attentionKernel}": ${trimmed || stderr.trim()}`
      };
    }
    return { ok: true };
  } catch (err) {
    return {
      ok: false,
      blocker: `Attention kernel "${attentionKernel}" is not available or failed import in target Python environment: ${(err as Error).message}`
    };
  }
}

const NODE_SOURCE_FILES: Record<string, string> = {
  MiniMaxH3ImageToVideo: "comfy_extras/nodes_minimax_h3.py",
  MiniMaxH3ReferenceToVideo: "comfy_extras/nodes_minimax_h3.py",
  EmptyMiniMaxH3LatentAV: "comfy_extras/nodes_minimax_h3.py",
  MiniMaxH3SigmaShift: "comfy_extras/nodes_minimax_h3.py",
  BlockSparseAttention: "comfy_extras/nodes_sparse_attention.py",
  ModelSparseAttention: "comfy_extras/nodes_sparse_attention.py",
  VedaSparseAttention: "comfy_extras/nodes_sparse_attention.py",
  ModelAttentionBackend: "comfy_extras/nodes_model_advanced.py",
  LoraLoaderModelOnly: "nodes.py"
};

function extractClassBlock(
  content: string,
  className: string
): { classHeader: string; classBody: string } | null {
  const classRegex = new RegExp(
    `^[ \t]*class\\s+${className}\\b([^(:]*(?:\\([^)]*\\))?):[ \t]*\r?\n?`,
    "m"
  );
  const match = classRegex.exec(content);
  if (!match) return null;

  const classHeader = match[1] ?? "";
  const startIndex = match.index + match[0].length;
  const remaining = content.slice(startIndex);
  const lines = remaining.split(/\r?\n/);

  const bodyLines: string[] = [];
  for (const line of lines) {
    if (line.trim().length === 0) {
      bodyLines.push(line);
      continue;
    }
    if (/^[ \t]+/.test(line)) {
      bodyLines.push(line);
    } else {
      break;
    }
  }
  return { classHeader, classBody: bodyLines.join("\n") };
}

function classHasSchema(block: { classHeader: string; classBody: string }): boolean {
  if (block.classHeader.includes("ComfyNode") || block.classHeader.includes("io.ComfyNode")) {
    if (
      block.classBody.includes("define_schema") ||
      block.classBody.includes("define_inputs") ||
      block.classBody.includes("INPUT_TYPES")
    ) {
      return true;
    }
  }
  return (
    block.classBody.includes("INPUT_TYPES") ||
    block.classBody.includes("define_schema") ||
    block.classBody.includes("define_inputs") ||
    (block.classBody.includes("RETURN_TYPES") && block.classBody.includes("FUNCTION"))
  );
}

function isNodeExplicitlyMapped(content: string, nodeName: string): boolean {
  const dictKey = new RegExp(`["']${nodeName}["']\\s*:`);
  const subscriptAssign = new RegExp(`NODE_CLASS_MAPPINGS\\[["']${nodeName}["']\\]`);
  return dictKey.test(content) || subscriptAssign.test(content);
}

async function verifyRequiredNodeDefinitions(
  resolvedDir: string,
  requiredNodes: ReadonlyArray<{ name: string }>
): Promise<{ ok: boolean; blocker?: string }> {
  for (const node of requiredNodes) {
    const relFile = NODE_SOURCE_FILES[node.name];
    if (!relFile) {
      return {
        ok: false,
        blocker: `Required node "${node.name}" has no mapped source file in runtime registry.`
      };
    }
    const fullPath = resolve(resolvedDir, relFile);
    try {
      const content = await readFile(fullPath, "utf8");
      const classBlock = extractClassBlock(content, node.name);
      const definesClassWithSchema = classBlock !== null && classHasSchema(classBlock);
      const registersMapping = isNodeExplicitlyMapped(content, node.name);

      if (!definesClassWithSchema && !registersMapping) {
        return {
          ok: false,
          blocker: `${relFile} does not define a schema-valid ComfyUI node class or register "${node.name}" in NODE_CLASS_MAPPINGS.`
        };
      }
    } catch (err) {
      return {
        ok: false,
        blocker: `Failed to find or read ${relFile} in ${resolvedDir}: ${(err as Error).message}`
      };
    }
  }
  return { ok: true };
}

export class CurrentPinExperimentRuntimeAdapter implements ExperimentRuntimeAdapter {
  public readonly coreRevision = PINNED_COMFYUI_CORE_REVISION;
  public readonly adapterName = "current-production-pin-adapter-v1";

  async verify(options: {
    comfyUiDir: string;
    pythonPath: string;
    requiredRuntime: MinimaxH3RequiredRuntimeManifest;
    expectedCheckpointHash?: string;
  }): Promise<{
    ok: boolean;
    status: "verified" | "conflict" | "unknown";
    blocker?: string;
    observations?: MinimaxH3ObservedProvenance;
  }> {
    const { comfyUiDir, pythonPath, requiredRuntime } = options;
    const resolvedDir = resolve(comfyUiDir);

    let revision = "";
    try {
      const { stdout } = await execFileAsync("git", ["-C", resolvedDir, "rev-parse", "HEAD"]);
      revision = stdout.trim();
    } catch (err) {
      return {
        ok: false,
        status: "unknown",
        blocker: `Failed to inspect git commit revision from ComfyUI directory: ${(err as Error).message}`
      };
    }

    if (requiredRuntime.coreRevision !== this.coreRevision) {
      return {
        ok: false,
        status: "conflict",
        blocker: `Current pinned adapter expected manifest revision ${this.coreRevision}, got ${requiredRuntime.coreRevision}`
      };
    }
    if (revision !== this.coreRevision) {
      return {
        ok: false,
        status: "conflict",
        blocker: `ComfyUI checkout revision mismatch: expected ${this.coreRevision}, got ${revision}`
      };
    }

    if (requiredRuntime.attentionKernel) {
      const audited = resolveAuditedKernel(requiredRuntime.attentionKernel);
      if (!audited || !audited.supportedCoreRevisions.includes(this.coreRevision)) {
        const supported = AUDITED_ATTENTION_KERNELS.filter((k) =>
          k.supportedCoreRevisions.includes(this.coreRevision)
        )
          .map((k) => k.canonicalName)
          .join(", ");
        return {
          ok: false,
          status: "conflict",
          blocker: `Current pinned ComfyUI core (${PINNED_COMFYUI_CORE_REVISION}) does not support attention kernel "${requiredRuntime.attentionKernel}". Supported on this revision: ${supported}.`
        };
      }
    }

    // Check required nodes: allow canonical pinned H3 nodes and core LoRA nodes; reject unverified sparse nodes
    const CANONICAL_H3_NODES = new Set([
      "MiniMaxH3ImageToVideo",
      "MiniMaxH3ReferenceToVideo",
      "EmptyMiniMaxH3LatentAV"
    ]);
    const SUPPORTED_NODES = new Set([...CANONICAL_H3_NODES, "LoraLoaderModelOnly"]);
    for (const node of requiredRuntime.requiredNodes) {
      if (!SUPPORTED_NODES.has(node.name)) {
        return {
          ok: false,
          status: "conflict",
          blocker: `Current pinned ComfyUI core (${PINNED_COMFYUI_CORE_REVISION}) does not provide required node "${node.name}". Requires isolated upgrade checkout.`
        };
      }
    }

    const nodeCheck = await verifyRequiredNodeDefinitions(
      resolvedDir,
      requiredRuntime.requiredNodes
    );
    if (!nodeCheck.ok) {
      return {
        ok: false,
        status: "conflict",
        blocker: nodeCheck.blocker ?? "Required node definition check failed."
      };
    }

    // Inspect Python version
    let pythonVersion = "";
    try {
      const { stdout } = await execFileAsync(pythonPath, [
        "-c",
        "import sys; print(sys.version.split()[0])"
      ]);
      pythonVersion = stdout.trim();
    } catch (err) {
      return {
        ok: false,
        status: "conflict",
        blocker: `Failed to inspect Python version from target environment: ${(err as Error).message}`
      };
    }
    if (!pythonVersion) {
      return {
        ok: false,
        status: "conflict",
        blocker: "Failed to inspect Python version: empty output from Python interpreter"
      };
    }

    // Inspect PyTorch and CUDA versions
    let pytorchVersion = "";
    let cudaRuntimeVersion = "";
    try {
      const { stdout } = await execFileAsync(pythonPath, [
        "-c",
        "import torch; print(f'{torch.__version__}|{torch.version.cuda}')"
      ]);
      const [pt, cu] = stdout.trim().split("|");
      pytorchVersion = pt || "";
      cudaRuntimeVersion = cu || "unknown";
    } catch (err) {
      return {
        ok: false,
        status: "conflict",
        blocker: `Failed to inspect PyTorch and CUDA version from target environment: ${(err as Error).message}`
      };
    }
    if (!pytorchVersion) {
      return {
        ok: false,
        status: "conflict",
        blocker: "Failed to inspect PyTorch version: empty output from PyTorch"
      };
    }
    if (requiredRuntime.pytorchBuild && pytorchVersion !== requiredRuntime.pytorchBuild) {
      return {
        ok: false,
        status: "conflict",
        blocker: `PyTorch build version mismatch: expected ${requiredRuntime.pytorchBuild}, got ${pytorchVersion}`
      };
    }

    let driverVersion = "unknown";
    try {
      const { stdout } = await execFileAsync("nvidia-smi", [
        "--query-gpu=driver_version",
        "--format=csv,noheader"
      ]);
      const trimmed = stdout.trim();
      if (trimmed) {
        driverVersion = trimmed.split(/\r?\n/)[0]!.trim();
      }
    } catch {
      // Tolerate absence in non-GPU test environment
    }

    if (driverVersion !== "unknown" && requiredRuntime.driverConstraints?.length) {
      for (const constraint of requiredRuntime.driverConstraints) {
        const match = constraint.match(/^([><]=?|=)\s*([0-9.]+)/);
        if (match) {
          const op = match[1];
          const reqVer = parseFloat(match[2]!);
          const actualVer = parseFloat(driverVersion);
          if (!isNaN(reqVer) && !isNaN(actualVer)) {
            if (op === ">=" && actualVer < reqVer) {
              return {
                ok: false,
                status: "conflict",
                blocker: `Host NVIDIA driver version ${driverVersion} does not satisfy required constraint "${constraint}".`
              };
            } else if (op === ">" && actualVer <= reqVer) {
              return {
                ok: false,
                status: "conflict",
                blocker: `Host NVIDIA driver version ${driverVersion} does not satisfy required constraint "${constraint}".`
              };
            }
          }
        }
      }
    }

    // Inspect required Python packages safely via fixed script and argv parameterization
    for (const pkg of requiredRuntime.pythonPackages) {
      const pkgCheck = await verifyPythonPackage(pythonPath, pkg);
      if (!pkgCheck.ok) {
        return {
          ok: false,
          status: "conflict",
          ...(pkgCheck.blocker ? { blocker: pkgCheck.blocker } : {})
        };
      }
    }

    if (requiredRuntime.attentionKernel) {
      const capCheck = await verifyRequiredKernelCapability(
        pythonPath,
        requiredRuntime.attentionKernel
      );
      if (!capCheck.ok) {
        return {
          ok: false,
          status: "conflict",
          ...(capCheck.blocker ? { blocker: capCheck.blocker } : {})
        };
      }
    }

    // Verify actual source file hashes on disk
    const actualSourceHashes: Record<string, string> = {};
    for (const [relPath, expectedHash] of Object.entries(requiredRuntime.sourceFileHashes)) {
      const fullPath = resolve(resolvedDir, relPath);
      try {
        const content = await readFile(fullPath);
        const actualHash = createHash("sha256").update(content).digest("hex");
        if (actualHash !== expectedHash) {
          return {
            ok: false,
            status: "conflict",
            blocker: `Source file hash mismatch for "${relPath}": expected ${expectedHash}, computed ${actualHash}`
          };
        }
        actualSourceHashes[relPath] = actualHash;
      } catch (err) {
        return {
          ok: false,
          status: "conflict",
          blocker: `Required source file "${relPath}" not found or readable in ComfyUI directory: ${(err as Error).message}`
        };
      }
    }

    const customNodesDir = resolve(resolvedDir, "custom_nodes");
    let discoveredCustomNodes: string[] = [];
    try {
      const entries = await readdir(customNodesDir, { withFileTypes: true });
      discoveredCustomNodes = entries
        .filter((e) => e.isDirectory() && !e.name.startsWith(".") && e.name !== "__pycache__")
        .map((e) => e.name);
    } catch {
      // directory does not exist or unreadable -> empty
    }

    const customNodeInventory =
      discoveredCustomNodes.length === 0
        ? {
            status: "verified_empty" as const,
            nodes: []
          }
        : {
            status: "inventory" as const,
            nodes: discoveredCustomNodes.map((name) => ({ name }))
          };

    const effectiveCudaBuild =
      cudaRuntimeVersion && cudaRuntimeVersion !== "unknown" && cudaRuntimeVersion !== "None"
        ? cudaRuntimeVersion
        : null;
    const effectiveCudaRuntime =
      cudaRuntimeVersion && cudaRuntimeVersion !== "unknown" && cudaRuntimeVersion !== "None"
        ? cudaRuntimeVersion
        : null;
    const effectiveDriverVersion = driverVersion !== "unknown" ? driverVersion : null;

    const observations: MinimaxH3ObservedProvenance = {
      actualCheckpointHash: {
        status: "unknown",
        value: null,
        expected:
          options.expectedCheckpointHash && options.expectedCheckpointHash.length === 64
            ? options.expectedCheckpointHash
            : "0000000000000000000000000000000000000000000000000000000000000000",
        unknownReason: "preflight_not_loaded"
      },
      loadedModelHashes: {},
      comfyuiCoreRevision: {
        status: "verified",
        value: revision,
        expected: requiredRuntime.coreRevision
      },
      sourceIdentities: {
        status: "verified",
        values: actualSourceHashes
      },
      customNodeInventory,
      runtimeVersions: {
        status: "verified",
        pythonVersion,
        pytorchVersion,
        cudaBuildVersion: effectiveCudaBuild,
        cudaRuntimeVersion: effectiveCudaRuntime,
        driverVersion: effectiveDriverVersion
      },
      observedAttentionBackend: {
        status: "unknown",
        effectiveBackend: null,
        dispatchImplementation: null,
        unknownReason: "preflight_prior_to_dispatch"
      },
      bootstrapHandshake: {
        status: "missing",
        protocol: null,
        collectorDigest: null,
        hookManifestDigest: null
      },
      conflicts: []
    };

    return {
      ok: true,
      status: "verified",
      observations
    };
  }
}

export class IsolatedUpgradeExperimentRuntimeAdapter implements ExperimentRuntimeAdapter {
  public readonly supportedNodes: string[];

  constructor(
    public readonly coreRevision: string,
    public readonly adapterName: string,
    supportedNodes: string[] = []
  ) {
    const CANONICAL_H3_NODES = [
      "MiniMaxH3ImageToVideo",
      "MiniMaxH3ReferenceToVideo",
      "EmptyMiniMaxH3LatentAV"
    ];
    this.supportedNodes = Array.from(new Set([...CANONICAL_H3_NODES, ...supportedNodes]));
  }

  async verify(options: {
    comfyUiDir: string;
    pythonPath: string;
    requiredRuntime: MinimaxH3RequiredRuntimeManifest;
    expectedCheckpointHash?: string;
  }): Promise<{
    ok: boolean;
    status: "verified" | "conflict" | "unknown";
    blocker?: string;
    observations?: MinimaxH3ObservedProvenance;
  }> {
    const { comfyUiDir, pythonPath, requiredRuntime } = options;
    const resolvedDir = resolve(comfyUiDir);

    let revision = "";
    try {
      const { stdout } = await execFileAsync("git", ["-C", resolvedDir, "rev-parse", "HEAD"]);
      revision = stdout.trim();
    } catch (err) {
      return {
        ok: false,
        status: "unknown",
        blocker: `Failed to inspect git commit revision from ComfyUI directory: ${(err as Error).message}`
      };
    }

    if (requiredRuntime.coreRevision !== this.coreRevision) {
      return {
        ok: false,
        status: "conflict",
        blocker: `Isolated upgrade adapter "${this.adapterName}" expected manifest revision ${this.coreRevision}, got ${requiredRuntime.coreRevision}.`
      };
    }
    if (revision !== this.coreRevision) {
      return {
        ok: false,
        status: "conflict",
        blocker: `ComfyUI checkout revision mismatch: expected isolated upgrade ${this.coreRevision}, got ${revision}. Target requires separate isolated ComfyUI checkout.`
      };
    }

    if (requiredRuntime.attentionKernel) {
      const audited = resolveAuditedKernel(requiredRuntime.attentionKernel);
      if (!audited || !audited.supportedCoreRevisions.includes(this.coreRevision)) {
        const supported = AUDITED_ATTENTION_KERNELS.filter((k) =>
          k.supportedCoreRevisions.includes(this.coreRevision)
        )
          .map((k) => k.canonicalName)
          .join(", ");
        return {
          ok: false,
          status: "conflict",
          blocker: `Isolated upgrade adapter "${this.adapterName}" does not support attention kernel "${requiredRuntime.attentionKernel}". Supported: ${supported}.`
        };
      }
    }

    for (const node of requiredRuntime.requiredNodes) {
      if (!this.supportedNodes.includes(node.name)) {
        return {
          ok: false,
          status: "conflict",
          blocker: `Isolated upgrade adapter "${this.adapterName}" does not provide required node "${node.name}".`
        };
      }
    }

    const nodeCheck = await verifyRequiredNodeDefinitions(
      resolvedDir,
      requiredRuntime.requiredNodes
    );
    if (!nodeCheck.ok) {
      return {
        ok: false,
        status: "conflict",
        blocker: nodeCheck.blocker ?? "Required node definition check failed."
      };
    }

    let pythonVersion = "";
    try {
      const { stdout } = await execFileAsync(pythonPath, [
        "-c",
        "import sys; print(sys.version.split()[0])"
      ]);
      pythonVersion = stdout.trim();
    } catch (err) {
      return {
        ok: false,
        status: "conflict",
        blocker: `Failed to inspect Python version from target environment: ${(err as Error).message}`
      };
    }
    if (!pythonVersion) {
      return {
        ok: false,
        status: "conflict",
        blocker: "Failed to inspect Python version: empty output from Python interpreter"
      };
    }

    let pytorchVersion = "";
    let cudaRuntimeVersion = "";
    try {
      const { stdout } = await execFileAsync(pythonPath, [
        "-c",
        "import torch; print(f'{torch.__version__}|{torch.version.cuda}')"
      ]);
      const [pt, cu] = stdout.trim().split("|");
      pytorchVersion = pt || "";
      cudaRuntimeVersion = cu || "unknown";
    } catch (err) {
      return {
        ok: false,
        status: "conflict",
        blocker: `Failed to inspect PyTorch and CUDA version from target environment: ${(err as Error).message}`
      };
    }
    if (!pytorchVersion) {
      return {
        ok: false,
        status: "conflict",
        blocker: "Failed to inspect PyTorch version: empty output from PyTorch"
      };
    }
    if (requiredRuntime.pytorchBuild && pytorchVersion !== requiredRuntime.pytorchBuild) {
      return {
        ok: false,
        status: "conflict",
        blocker: `PyTorch build version mismatch: expected ${requiredRuntime.pytorchBuild}, got ${pytorchVersion}`
      };
    }

    let driverVersion = "unknown";
    try {
      const { stdout } = await execFileAsync("nvidia-smi", [
        "--query-gpu=driver_version",
        "--format=csv,noheader"
      ]);
      const trimmed = stdout.trim();
      if (trimmed) {
        driverVersion = trimmed.split(/\r?\n/)[0]!.trim();
      }
    } catch {
      // Tolerate absence in non-GPU test environment
    }

    if (driverVersion !== "unknown" && requiredRuntime.driverConstraints?.length) {
      for (const constraint of requiredRuntime.driverConstraints) {
        const match = constraint.match(/^([><]=?|=)\s*([0-9.]+)/);
        if (match) {
          const op = match[1];
          const reqVer = parseFloat(match[2]!);
          const actualVer = parseFloat(driverVersion);
          if (!isNaN(reqVer) && !isNaN(actualVer)) {
            if (op === ">=" && actualVer < reqVer) {
              return {
                ok: false,
                status: "conflict",
                blocker: `Host NVIDIA driver version ${driverVersion} does not satisfy required constraint "${constraint}".`
              };
            } else if (op === ">" && actualVer <= reqVer) {
              return {
                ok: false,
                status: "conflict",
                blocker: `Host NVIDIA driver version ${driverVersion} does not satisfy required constraint "${constraint}".`
              };
            }
          }
        }
      }
    }

    for (const pkg of requiredRuntime.pythonPackages) {
      const pkgCheck = await verifyPythonPackage(pythonPath, pkg);
      if (!pkgCheck.ok) {
        return {
          ok: false,
          status: "conflict",
          ...(pkgCheck.blocker ? { blocker: pkgCheck.blocker } : {})
        };
      }
    }

    if (requiredRuntime.attentionKernel) {
      const capCheck = await verifyRequiredKernelCapability(
        pythonPath,
        requiredRuntime.attentionKernel
      );
      if (!capCheck.ok) {
        return {
          ok: false,
          status: "conflict",
          ...(capCheck.blocker ? { blocker: capCheck.blocker } : {})
        };
      }
    }

    // Verify actual source file hashes on disk
    const actualSourceHashes: Record<string, string> = {};
    for (const [relPath, expectedHash] of Object.entries(requiredRuntime.sourceFileHashes)) {
      const fullPath = resolve(resolvedDir, relPath);
      try {
        const content = await readFile(fullPath);
        const actualHash = createHash("sha256").update(content).digest("hex");
        if (actualHash !== expectedHash) {
          return {
            ok: false,
            status: "conflict",
            blocker: `Source file hash mismatch for "${relPath}": expected ${expectedHash}, computed ${actualHash}`
          };
        }
        actualSourceHashes[relPath] = actualHash;
      } catch (err) {
        return {
          ok: false,
          status: "conflict",
          blocker: `Required source file "${relPath}" not found or readable in ComfyUI directory: ${(err as Error).message}`
        };
      }
    }

    const customNodesDir = resolve(resolvedDir, "custom_nodes");
    let discoveredCustomNodes: string[] = [];
    try {
      const entries = await readdir(customNodesDir, { withFileTypes: true });
      discoveredCustomNodes = entries
        .filter((e) => e.isDirectory() && !e.name.startsWith(".") && e.name !== "__pycache__")
        .map((e) => e.name);
    } catch {
      // directory does not exist or unreadable -> empty
    }

    const customNodeInventory =
      discoveredCustomNodes.length === 0
        ? {
            status: "verified_empty" as const,
            nodes: []
          }
        : {
            status: "inventory" as const,
            nodes: discoveredCustomNodes.map((name) => ({ name }))
          };

    const effectiveCudaBuild =
      cudaRuntimeVersion && cudaRuntimeVersion !== "unknown" && cudaRuntimeVersion !== "None"
        ? cudaRuntimeVersion
        : null;
    const effectiveCudaRuntime =
      cudaRuntimeVersion && cudaRuntimeVersion !== "unknown" && cudaRuntimeVersion !== "None"
        ? cudaRuntimeVersion
        : null;
    const effectiveDriverVersion = driverVersion !== "unknown" ? driverVersion : null;

    const observations: MinimaxH3ObservedProvenance = {
      actualCheckpointHash: {
        status: "unknown",
        value: null,
        expected:
          options.expectedCheckpointHash && options.expectedCheckpointHash.length === 64
            ? options.expectedCheckpointHash
            : "0000000000000000000000000000000000000000000000000000000000000000",
        unknownReason: "preflight_not_loaded"
      },
      loadedModelHashes: {},
      comfyuiCoreRevision: {
        status: "verified",
        value: revision,
        expected: requiredRuntime.coreRevision
      },
      sourceIdentities: {
        status: "verified",
        values: actualSourceHashes
      },
      customNodeInventory,
      runtimeVersions: {
        status: "verified",
        pythonVersion,
        pytorchVersion,
        cudaBuildVersion: effectiveCudaBuild,
        cudaRuntimeVersion: effectiveCudaRuntime,
        driverVersion: effectiveDriverVersion
      },
      observedAttentionBackend: {
        status: "unknown",
        effectiveBackend: null,
        dispatchImplementation: null,
        unknownReason: "preflight_prior_to_dispatch"
      },
      bootstrapHandshake: {
        status: "missing",
        protocol: null,
        collectorDigest: null,
        hookManifestDigest: null
      },
      conflicts: []
    };

    return {
      ok: true,
      status: "verified",
      observations
    };
  }
}

export class ExperimentRuntimeRegistry {
  private adapters = new Map<string, ExperimentRuntimeAdapter>();

  constructor() {
    this.registerAdapter(new CurrentPinExperimentRuntimeAdapter());
    this.registerAdapter(
      new IsolatedUpgradeExperimentRuntimeAdapter(
        "94cfeb3a5d8985efaa7ea9f5e5dfad4184ec99bf",
        "upgraded-core-isolated-adapter-v1",
        ["ModelSparseAttention", "VedaSparseAttention"]
      )
    );
    this.registerAdapter(
      new IsolatedUpgradeExperimentRuntimeAdapter(
        "ee71d5c4993f29086b27fde1629a945ae48425bf",
        "fasth3-isolated-upgrade-adapter-v1",
        [
          "MiniMaxH3ImageToVideo",
          "MiniMaxH3ReferenceToVideo",
          "EmptyMiniMaxH3LatentAV",
          "MiniMaxH3SigmaShift",
          "ModelAttentionBackend",
          "BlockSparseAttention"
        ]
      )
    );
  }

  registerAdapter(adapter: ExperimentRuntimeAdapter): void {
    this.adapters.set(adapter.coreRevision, adapter);
  }

  getAdapter(coreRevision: string): ExperimentRuntimeAdapter | undefined {
    return this.adapters.get(coreRevision);
  }

  hasAdapter(coreRevision: string): boolean {
    return this.adapters.has(coreRevision);
  }

  async verify(options: {
    comfyUiDir: string;
    pythonPath: string;
    requiredRuntime: MinimaxH3RequiredRuntimeManifest;
    requiredRuntimeDigest: string;
    expectedCheckpointHash?: string;
  }): Promise<ExperimentRuntimeVerificationResult> {
    const { requiredRuntime } = options;
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
    const actualDigest = createHash("sha256").update(canonical(requiredRuntime)).digest("hex");
    if (actualDigest !== options.requiredRuntimeDigest) {
      return {
        ok: false,
        status: "conflict",
        blocker: `Required runtime manifest digest mismatch: expected ${options.requiredRuntimeDigest}, computed ${actualDigest}`,
        adapterRegistered: false
      };
    }
    const adapter = this.getAdapter(requiredRuntime.coreRevision);

    if (!adapter) {
      return {
        ok: false,
        status: "conflict",
        blocker: `No registered experiment adapter found for required runtime core revision ${requiredRuntime.coreRevision}. Requires isolated upgrade profile.`,
        adapterRegistered: false
      };
    }

    const result = await adapter.verify(options);
    return {
      ...result,
      adapterRegistered: true
    };
  }
}

export const defaultExperimentRuntimeRegistry = new ExperimentRuntimeRegistry();
