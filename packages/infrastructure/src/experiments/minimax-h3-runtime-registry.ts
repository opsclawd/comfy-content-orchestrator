import { execFile } from "node:child_process";
import { createHash } from "node:crypto";
import { readFile, readdir } from "node:fs/promises";
import { resolve } from "node:path";
import { promisify } from "node:util";
import {
  PINNED_COMFYUI_CORE_REVISION,
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

    if (revision !== requiredRuntime.coreRevision) {
      return {
        ok: false,
        status: "conflict",
        blocker: `ComfyUI checkout revision mismatch: expected ${requiredRuntime.coreRevision}, got ${revision}`
      };
    }

    // Check required nodes: allow canonical pinned H3 nodes; reject unverified sparse nodes
    const CANONICAL_H3_NODES = new Set([
      "MiniMaxH3ImageToVideo",
      "MiniMaxH3ReferenceToVideo",
      "EmptyMiniMaxH3LatentAV"
    ]);
    for (const node of requiredRuntime.requiredNodes) {
      if (!CANONICAL_H3_NODES.has(node.name)) {
        return {
          ok: false,
          status: "conflict",
          blocker: `Current pinned ComfyUI core (${PINNED_COMFYUI_CORE_REVISION}) does not provide required node "${node.name}". Requires isolated upgrade checkout.`
        };
      }
    }

    const nodesPath = resolve(resolvedDir, "comfy_extras/nodes_minimax_h3.py");
    try {
      const content = await readFile(nodesPath, "utf8");
      for (const node of requiredRuntime.requiredNodes) {
        if (!content.includes(node.name)) {
          return {
            ok: false,
            status: "conflict",
            blocker: `comfy_extras/nodes_minimax_h3.py does not define required node "${node.name}".`
          };
        }
      }
    } catch (err) {
      return {
        ok: false,
        status: "conflict",
        blocker: `Failed to find or read comfy_extras/nodes_minimax_h3.py in ${resolvedDir}: ${(err as Error).message}`
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

    if (revision !== requiredRuntime.coreRevision) {
      return {
        ok: false,
        status: "conflict",
        blocker: `ComfyUI checkout revision mismatch: expected isolated upgrade ${requiredRuntime.coreRevision}, got ${revision}. Target requires separate isolated ComfyUI checkout.`
      };
    }

    const CANONICAL_H3_NODES = new Set([
      "MiniMaxH3ImageToVideo",
      "MiniMaxH3ReferenceToVideo",
      "EmptyMiniMaxH3LatentAV"
    ]);
    for (const node of requiredRuntime.requiredNodes) {
      if (!this.supportedNodes.includes(node.name)) {
        return {
          ok: false,
          status: "conflict",
          blocker: `Isolated upgrade adapter "${this.adapterName}" does not provide required node "${node.name}".`
        };
      }
    }

    const nodesPath = resolve(resolvedDir, "comfy_extras/nodes_minimax_h3.py");
    try {
      const content = await readFile(nodesPath, "utf8");
      for (const node of requiredRuntime.requiredNodes) {
        if (CANONICAL_H3_NODES.has(node.name) && !content.includes(node.name)) {
          return {
            ok: false,
            status: "conflict",
            blocker: `comfy_extras/nodes_minimax_h3.py does not define required node "${node.name}".`
          };
        }
      }
    } catch (err) {
      return {
        ok: false,
        status: "conflict",
        blocker: `Failed to find or read comfy_extras/nodes_minimax_h3.py in ${resolvedDir}: ${(err as Error).message}`
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
