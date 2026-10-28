import { execFile } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync } from "node:fs";
import { readFile, readdir } from "node:fs/promises";
import { resolve } from "node:path";
import { promisify } from "node:util";
import { fileURLToPath } from "node:url";
import {
  PINNED_COMFYUI_CORE_REVISION,
  AUDITED_ATTENTION_KERNELS,
  resolveAuditedKernel,
  type MinimaxH3RequiredRuntimeManifest,
  type MinimaxH3ObservedProvenance,
  compareDottedVersions,
  satisfiesDriverConstraint,
  TEACACHE_LOCAL_ADAPTER_DIGEST,
  computeLocalTeaCacheAdapterDigest
} from "@cco/contracts";

const execFileAsync = promisify(execFile);

function resolvePackageInspectorPath(): string {
  const direct = fileURLToPath(new URL("./minimax-h3-package-inspector.py", import.meta.url));
  if (existsSync(direct)) {
    return direct;
  }
  const fromSrc = resolve(
    fileURLToPath(new URL(".", import.meta.url)),
    "../../src/experiments/minimax-h3-package-inspector.py"
  );
  if (existsSync(fromSrc)) {
    return fromSrc;
  }
  return direct;
}

export const PACKAGE_INSPECTOR_PATH = resolvePackageInspectorPath();

let _testDriverQueryCommand: { command: string; args?: string[] } | null = null;
export function setTestDriverQueryCommand(cmd: { command: string; args?: string[] } | null): void {
  _testDriverQueryCommand = cmd;
}

export interface ExperimentRuntimeVerificationResult {
  ok: boolean;
  status: "verified" | "conflict" | "unknown";
  blocker?: string | undefined;
  observations?: MinimaxH3ObservedProvenance | undefined;
  adapterRegistered: boolean;
}

export interface ExperimentRuntimeVerifyOptions {
  comfyUiDir: string;
  pythonPath: string;
  requiredRuntime: MinimaxH3RequiredRuntimeManifest;
  expectedCheckpointHash?: string | undefined;
  driverQueryCommand?:
    | {
        command: string;
        args?: string[] | undefined;
      }
    | undefined;
  timeoutMs?: number | undefined;
  signal?: AbortSignal | undefined;
}

export interface ExperimentRuntimeAdapter {
  readonly coreRevision: string;
  readonly adapterName: string;
  verify(options: ExperimentRuntimeVerifyOptions): Promise<{
    ok: boolean;
    status: "verified" | "conflict" | "unknown";
    blocker?: string | undefined;
    observations?: MinimaxH3ObservedProvenance | undefined;
  }>;
}

export interface VerifiedPackageResult {
  ok: boolean;
  blocker?: string | undefined;
  name?: string | undefined;
  version?: string | undefined;
  artifactHash?: string | undefined;
  artifactMethod?: string | undefined;
}

export interface VerifyPythonPackageOptions {
  timeoutMs?: number | undefined;
  signal?: AbortSignal | undefined;
}

export async function verifyPythonPackage(
  pythonPath: string,
  pkg: {
    name: string;
    version?: string | undefined;
    importModule?: string | undefined;
    artifactHash?: string | undefined;
    artifactMethod?: string | undefined;
  },
  options?: VerifyPythonPackageOptions
): Promise<VerifiedPackageResult> {
  const timeoutMs = options?.timeoutMs ?? 30_000;
  if (pkg.artifactHash && !pkg.artifactMethod) {
    return {
      ok: false,
      blocker: `Required Python package "${pkg.name}" specifies artifactHash without explicit artifactMethod`
    };
  }
  const args = [
    PACKAGE_INSPECTOR_PATH,
    pkg.name,
    pkg.version ?? "",
    pkg.importModule ?? "",
    pkg.artifactHash ?? "",
    pkg.artifactMethod ?? ""
  ];
  try {
    const { stdout, stderr } = await execFileAsync(pythonPath, args, {
      timeout: timeoutMs,
      signal: options?.signal
    });
    const out = stdout.trim();
    if (!out.startsWith("ok:")) {
      return {
        ok: false,
        blocker: `Required Python package "${pkg.name}" verification failed: ${out || stderr.trim()}`
      };
    }
    const payload = JSON.parse(out.slice(3)) as {
      name: string;
      version: string;
      artifactHash: string;
      artifactMethod: string;
    };
    return {
      ok: true,
      name: payload.name,
      version: payload.version,
      artifactHash: payload.artifactHash,
      artifactMethod: payload.artifactMethod
    };
  } catch (err) {
    if (options?.signal?.aborted) {
      return {
        ok: false,
        blocker: `Required Python package "${pkg.name}" verification was aborted`
      };
    }
    const errObj = err as {
      stdout?: Buffer | string;
      stderr?: Buffer | string;
      message?: string;
      killed?: boolean;
      signal?: string;
    };
    if (
      errObj.killed ||
      errObj.signal === "SIGTERM" ||
      (errObj.message && errObj.message.includes("timed out"))
    ) {
      return {
        ok: false,
        blocker: `Required Python package "${pkg.name}" verification timed out after ${timeoutMs}ms`
      };
    }
    const errOutput =
      (errObj.stdout ? errObj.stdout.toString() : "") +
      (errObj.stderr ? errObj.stderr.toString() : "");
    return {
      ok: false,
      blocker: `Required Python package "${pkg.name}" is not installed or importable: ${errOutput.trim() || errObj.message || String(err)}`
    };
  }
}

export { compareDottedVersions, satisfiesDriverConstraint };

export async function verifyRequiredKernelCapability(
  pythonPath: string,
  attentionKernel: string,
  options?: { timeoutMs?: number | undefined; signal?: AbortSignal | undefined }
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
    const { stdout, stderr } = await execFileAsync(pythonPath, ["-c", checkSnippet], {
      timeout: options?.timeoutMs ?? 30_000,
      signal: options?.signal
    });
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
  LoraLoaderModelOnly: "nodes.py",
  CCOMiniMaxH3TeaCache: "custom_nodes/ComfyUI-MiniMaxH3-TeaCache/nodes.py"
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
    if (node.name === "CCOMiniMaxH3TeaCache") {
      // Deliberately only the TARGET comfyUiDir's own custom_nodes
      // directory -- a repository-relative fallback here would let this
      // check pass just because the orchestrator's own dev checkout has
      // the adapter, which proves nothing about whether it is actually
      // staged on the target host that will execute the render.
      const candidates = [
        resolve(resolvedDir, "custom_nodes/cco-minimax-h3-teacache"),
        resolve(resolvedDir, "custom_nodes/ComfyUI-MiniMaxH3-TeaCache"),
        resolve(resolvedDir, "custom_nodes/minimax-h3-teacache")
      ];
      let foundDir: string | null = null;
      for (const cand of candidates) {
        if (existsSync(cand) && existsSync(resolve(cand, "nodes.py"))) {
          foundDir = cand;
          break;
        }
      }
      if (!foundDir) {
        return {
          ok: false,
          blocker: `Required node "CCOMiniMaxH3TeaCache" source files not found staged in ${resolvedDir}'s custom_nodes directory.`
        };
      }
      const fullPath = resolve(foundDir, "nodes.py");
      try {
        const content = await readFile(fullPath, "utf8");
        const classBlock =
          extractClassBlock(content, "CCOMiniMaxH3TeaCacheNode") ??
          extractClassBlock(content, "CCOMiniMaxH3TeaCache");
        const definesClassWithSchema = classBlock !== null && classHasSchema(classBlock);
        const registersMapping = isNodeExplicitlyMapped(content, "CCOMiniMaxH3TeaCache");

        if (!definesClassWithSchema && !registersMapping) {
          return {
            ok: false,
            blocker: `${fullPath} does not define a schema-valid ComfyUI node class or register "CCOMiniMaxH3TeaCache" in NODE_CLASS_MAPPINGS.`
          };
        }

        const requiredFiles = ["__init__.py", "nodes.py", "teacache.py"];
        const observedHashes: Record<string, string> = {};
        for (const rf of requiredFiles) {
          const fPath = resolve(foundDir, rf);
          if (!existsSync(fPath)) {
            return {
              ok: false,
              blocker: `TeaCache adapter missing required file "${rf}" in ${foundDir}`
            };
          }
          const buf = await readFile(fPath);
          observedHashes[rf] = createHash("sha256").update(buf).digest("hex");
        }
        const digest = computeLocalTeaCacheAdapterDigest(observedHashes);
        if (digest !== TEACACHE_LOCAL_ADAPTER_DIGEST) {
          return {
            ok: false,
            blocker: `TeaCache local adapter digest mismatch in ${foundDir}: expected ${TEACACHE_LOCAL_ADAPTER_DIGEST}, computed ${digest}`
          };
        }
      } catch (err) {
        return {
          ok: false,
          blocker: `Failed to verify CCOMiniMaxH3TeaCache in ${foundDir}: ${(err as Error).message}`
        };
      }
      continue;
    }

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

async function verifyRuntimeSubstrate(
  adapter: ExperimentRuntimeAdapter,
  options: ExperimentRuntimeVerifyOptions,
  customNodeValidator?: (requiredNodes: ReadonlyArray<{ name: string }>) => {
    ok: boolean;
    blocker?: string;
  }
): Promise<{
  ok: boolean;
  status: "verified" | "conflict" | "unknown";
  blocker?: string;
  observations?: MinimaxH3ObservedProvenance;
}> {
  const { comfyUiDir, pythonPath, requiredRuntime } = options;
  const resolvedDir = resolve(comfyUiDir);

  let revision = "";
  try {
    const { stdout } = await execFileAsync("git", ["-C", resolvedDir, "rev-parse", "HEAD"], {
      timeout: options.timeoutMs ?? 30_000,
      signal: options.signal
    });
    revision = stdout.trim();
  } catch (err) {
    if (options.signal?.aborted) {
      return { ok: false, status: "unknown", blocker: "Inspection aborted by operator signal" };
    }
    return {
      ok: false,
      status: "unknown",
      blocker: `Failed to inspect git commit revision from ComfyUI directory: ${(err as Error).message}`
    };
  }

  if (requiredRuntime.coreRevision !== adapter.coreRevision) {
    const isPinned = adapter.coreRevision === PINNED_COMFYUI_CORE_REVISION;
    return {
      ok: false,
      status: "conflict",
      blocker: isPinned
        ? `Current pinned adapter expected manifest revision ${adapter.coreRevision}, got ${requiredRuntime.coreRevision}`
        : `Isolated upgrade adapter "${adapter.adapterName}" expected manifest revision ${adapter.coreRevision}, got ${requiredRuntime.coreRevision}.`
    };
  }
  if (revision !== adapter.coreRevision) {
    const isPinned = adapter.coreRevision === PINNED_COMFYUI_CORE_REVISION;
    return {
      ok: false,
      status: "conflict",
      blocker: isPinned
        ? `ComfyUI checkout revision mismatch: expected ${adapter.coreRevision}, got ${revision}`
        : `ComfyUI checkout revision mismatch: expected isolated upgrade ${adapter.coreRevision}, got ${revision}. Target requires separate isolated ComfyUI checkout.`
    };
  }

  if (requiredRuntime.attentionKernel) {
    const audited = resolveAuditedKernel(requiredRuntime.attentionKernel);
    if (!audited || !audited.supportedCoreRevisions.includes(adapter.coreRevision)) {
      const supported = AUDITED_ATTENTION_KERNELS.filter((k) =>
        k.supportedCoreRevisions.includes(adapter.coreRevision)
      )
        .map((k) => k.canonicalName)
        .join(", ");
      return {
        ok: false,
        status: "conflict",
        blocker: `ComfyUI core revision (${adapter.coreRevision}) does not support attention kernel "${requiredRuntime.attentionKernel}". Supported on this revision: ${supported}.`
      };
    }
  }

  if (customNodeValidator) {
    const nodeValidation = customNodeValidator(requiredRuntime.requiredNodes);
    if (!nodeValidation.ok) {
      return {
        ok: false,
        status: "conflict",
        ...(nodeValidation.blocker ? { blocker: nodeValidation.blocker } : {})
      };
    }
  }

  const nodeCheck = await verifyRequiredNodeDefinitions(resolvedDir, requiredRuntime.requiredNodes);
  if (!nodeCheck.ok) {
    return {
      ok: false,
      status: "conflict",
      blocker: nodeCheck.blocker ?? "Required node definition check failed."
    };
  }

  // Registration is dynamic and is established only by the owned child's
  // capability handshake after ComfyUI completes node registration.

  const timeoutMs = options.timeoutMs ?? 30_000;
  let pythonVersion = "";
  let pythonExecutable = "";
  let pythonAbi = "";
  let pythonCompiler = "";
  try {
    const { stdout } = await execFileAsync(
      pythonPath,
      [
        "-c",
        'import sys, sysconfig, platform; print(f\'{sys.version.split()[0]}|{sys.executable}|{getattr(sys, "abiflags", "") or sysconfig.get_config_var("SOABI") or ""}|{platform.python_compiler()}\')'
      ],
      { timeout: timeoutMs, signal: options.signal }
    );
    const [ver, execPath, abi, comp] = stdout.trim().split("|");
    pythonVersion = ver || "";
    pythonExecutable = execPath || "";
    pythonAbi = abi || "";
    pythonCompiler = comp || "";
  } catch (err) {
    if (options.signal?.aborted) {
      return { ok: false, status: "unknown", blocker: "Inspection aborted by operator signal" };
    }
    return {
      ok: false,
      status: "conflict",
      blocker: `Failed to inspect Python interpreter from target environment: ${(err as Error).message}`
    };
  }
  if (!pythonVersion) {
    return {
      ok: false,
      status: "conflict",
      blocker: "Failed to inspect Python version: empty output from Python interpreter"
    };
  }

  let pythonExecutableHash: string | null = null;
  if (pythonExecutable) {
    try {
      const content = await readFile(pythonExecutable);
      pythonExecutableHash = createHash("sha256").update(content).digest("hex");
    } catch (err) {
      if (requiredRuntime.interpreter?.pythonExecutableHash) {
        return {
          ok: false,
          status: "conflict",
          blocker: `Failed to read Python executable at ${pythonExecutable}: ${(err as Error).message}`
        };
      }
    }
  }

  if (requiredRuntime.interpreter) {
    if (
      requiredRuntime.interpreter.pythonVersion &&
      pythonVersion !== requiredRuntime.interpreter.pythonVersion
    ) {
      return {
        ok: false,
        status: "conflict",
        blocker: `Python version mismatch: expected ${requiredRuntime.interpreter.pythonVersion}, got ${pythonVersion}`
      };
    }
    if (
      requiredRuntime.interpreter.pythonExecutableHash &&
      pythonExecutableHash !== requiredRuntime.interpreter.pythonExecutableHash
    ) {
      return {
        ok: false,
        status: "conflict",
        blocker: `Python executable hash mismatch: expected ${requiredRuntime.interpreter.pythonExecutableHash}, got ${pythonExecutableHash}`
      };
    }
    if (
      requiredRuntime.interpreter.pythonAbi &&
      pythonAbi !== requiredRuntime.interpreter.pythonAbi
    ) {
      return {
        ok: false,
        status: "conflict",
        blocker: `Python ABI mismatch: expected ${requiredRuntime.interpreter.pythonAbi}, got ${pythonAbi}`
      };
    }
    if (
      requiredRuntime.interpreter.pythonCompiler &&
      pythonCompiler !== requiredRuntime.interpreter.pythonCompiler
    ) {
      return {
        ok: false,
        status: "conflict",
        blocker: `Python compiler mismatch: expected ${requiredRuntime.interpreter.pythonCompiler}, got ${pythonCompiler}`
      };
    }
  }

  let pytorchVersion = "";
  let cudaCompiledVersion = "";
  try {
    const { stdout } = await execFileAsync(
      pythonPath,
      ["-c", "import torch; print(f'{torch.__version__}|{torch.version.cuda}')"],
      { timeout: timeoutMs, signal: options.signal }
    );
    const [pt, cu] = stdout.trim().split("|");
    pytorchVersion = pt || "";
    cudaCompiledVersion = cu || "unknown";
  } catch (err) {
    if (options.signal?.aborted) {
      return { ok: false, status: "unknown", blocker: "Inspection aborted by operator signal" };
    }
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

  if (requiredRuntime.cudaBuild) {
    if (
      !cudaCompiledVersion ||
      cudaCompiledVersion === "unknown" ||
      cudaCompiledVersion === "None"
    ) {
      return {
        ok: false,
        status: "conflict",
        blocker: `CUDA build evidence missing: PyTorch environment does not report torch.version.cuda, expected ${requiredRuntime.cudaBuild}`
      };
    }
    if (cudaCompiledVersion !== requiredRuntime.cudaBuild) {
      return {
        ok: false,
        status: "conflict",
        blocker: `CUDA build version mismatch: expected ${requiredRuntime.cudaBuild}, got ${cudaCompiledVersion}`
      };
    }
  }

  let driverVersion: string | null = null;
  try {
    const testCmd = options.driverQueryCommand ?? _testDriverQueryCommand;
    const cmd = testCmd?.command ?? "nvidia-smi";
    const args = testCmd?.args ?? ["--query-gpu=driver_version", "--format=csv,noheader"];
    const { stdout } = await execFileAsync(cmd, args, {
      timeout: options.timeoutMs ?? 30_000,
      signal: options.signal
    });
    const trimmed = stdout.trim();
    if (trimmed) {
      driverVersion = trimmed.split(/\r?\n/)[0]!.trim();
    }
  } catch {
    // Driver query failed or unobservable
  }

  if (!driverVersion || driverVersion === "unknown") {
    return {
      ok: false,
      status: "unknown",
      blocker:
        "Missing NVIDIA driver evidence: nvidia-smi failed or is unavailable in the environment."
    };
  }

  if (requiredRuntime.driverConstraints && requiredRuntime.driverConstraints.length > 0) {
    for (const constraint of requiredRuntime.driverConstraints) {
      const check = satisfiesDriverConstraint(driverVersion, constraint);
      if (check.error) {
        return {
          ok: false,
          status: "conflict",
          blocker: check.error
        };
      }
      if (!check.satisfied) {
        return {
          ok: false,
          status: "conflict",
          blocker: `Host NVIDIA driver version ${driverVersion} does not satisfy required constraint "${constraint}".`
        };
      }
    }
  }

  if (requiredRuntime.attentionKernel) {
    const capCheck = await verifyRequiredKernelCapability(
      pythonPath,
      requiredRuntime.attentionKernel,
      {
        ...(options.timeoutMs !== undefined ? { timeoutMs: options.timeoutMs } : {}),
        ...(options.signal !== undefined ? { signal: options.signal } : {})
      }
    );
    if (!capCheck.ok) {
      return {
        ok: false,
        status: "conflict",
        ...(capCheck.blocker ? { blocker: capCheck.blocker } : {})
      };
    }
  }

  const verifiedPackages: Array<{
    name: string;
    version: string;
    artifactHash?: string;
    artifactMethod?: string;
  }> = [];

  // torch is always part of the dense-dispatch surface (it provides the
  // scaled_dot_product_attention fallback every attention backend may hit),
  // so it must be in the mandatory audit set regardless of whether the
  // manifest declared it explicitly — a manifest that omits torch must not
  // be able to skip verifying it (AC-1, F-b4902dfa).
  const packagesToAudit = [...requiredRuntime.pythonPackages];
  if (!packagesToAudit.some((p) => p.name === "torch")) {
    packagesToAudit.push({ name: "torch", version: "" });
  }

  for (const pkg of packagesToAudit) {
    const pkgCheck = await verifyPythonPackage(pythonPath, pkg, {
      ...(options.timeoutMs !== undefined ? { timeoutMs: options.timeoutMs } : {}),
      ...(options.signal !== undefined ? { signal: options.signal } : {})
    });
    if (!pkgCheck.ok) {
      return {
        ok: false,
        status: "conflict",
        ...(pkgCheck.blocker ? { blocker: pkgCheck.blocker } : {})
      };
    }
    if (!pkgCheck.artifactHash) {
      return {
        ok: false,
        status: "conflict",
        blocker: `Required Python package "${pkg.name}" is missing verified artifactHash`
      };
    }
    if (pkg.artifactHash && pkgCheck.artifactHash !== pkg.artifactHash) {
      return {
        ok: false,
        status: "conflict",
        blocker: `Required Python package "${pkg.name}" artifactHash mismatch: expected ${pkg.artifactHash}, got ${pkgCheck.artifactHash}`
      };
    }
    verifiedPackages.push({
      name: pkgCheck.name ?? pkg.name,
      version: pkgCheck.version ?? pkg.version ?? "",
      artifactHash: pkgCheck.artifactHash,
      artifactMethod: pkgCheck.artifactMethod ?? "installed_record_sha256_v1"
    });
  }

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
    cudaCompiledVersion && cudaCompiledVersion !== "unknown" && cudaCompiledVersion !== "None"
      ? cudaCompiledVersion
      : null;
  const effectiveCudaRuntime = null; // torch.version.cuda is compiled CUDA; CUDA runtime requires separate probe

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
      driverVersion
    },
    interpreter: {
      status: "verified",
      pythonVersion,
      pythonExecutableHash,
      pythonAbi,
      pythonCompiler
    },
    packageIdentities: verifiedPackages,
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

export class CurrentPinExperimentRuntimeAdapter implements ExperimentRuntimeAdapter {
  public readonly coreRevision = PINNED_COMFYUI_CORE_REVISION;
  public readonly adapterName = "current-production-pin-adapter-v1";

  async verify(options: ExperimentRuntimeVerifyOptions): Promise<{
    ok: boolean;
    status: "verified" | "conflict" | "unknown";
    blocker?: string;
    observations?: MinimaxH3ObservedProvenance;
  }> {
    const CANONICAL_H3_NODES = new Set([
      "MiniMaxH3ImageToVideo",
      "MiniMaxH3ReferenceToVideo",
      "EmptyMiniMaxH3LatentAV"
    ]);
    const SUPPORTED_NODES = new Set([
      ...CANONICAL_H3_NODES,
      "LoraLoaderModelOnly",
      "CCOMiniMaxH3TeaCache"
    ]);

    return verifyRuntimeSubstrate(this, options, (requiredNodes) => {
      for (const node of requiredNodes) {
        if (!SUPPORTED_NODES.has(node.name)) {
          return {
            ok: false,
            blocker: `Current pinned ComfyUI core (${PINNED_COMFYUI_CORE_REVISION}) does not provide required node "${node.name}". Requires isolated upgrade checkout.`
          };
        }
      }
      return { ok: true };
    });
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
      "EmptyMiniMaxH3LatentAV",
      "CCOMiniMaxH3TeaCache"
    ];
    this.supportedNodes = Array.from(new Set([...CANONICAL_H3_NODES, ...supportedNodes]));
  }

  async verify(options: ExperimentRuntimeVerifyOptions): Promise<{
    ok: boolean;
    status: "verified" | "conflict" | "unknown";
    blocker?: string;
    observations?: MinimaxH3ObservedProvenance;
  }> {
    // Sparse node support is established by actual node registration via capability handshake,
    // not by checking a hardcoded constructor list. verifyRuntimeSubstrate verifies
    // source file definitions exist on disk.
    return verifyRuntimeSubstrate(this, options);
  }
}

export class ExperimentRuntimeRegistry {
  private adapters = new Map<string, ExperimentRuntimeAdapter>();

  constructor() {
    this.registerAdapter(new CurrentPinExperimentRuntimeAdapter());
    this.registerAdapter(
      new IsolatedUpgradeExperimentRuntimeAdapter(
        "ee71d5c4993f29086b27fde1629a945ae48425bf",
        "fasth3-isolated-upgrade-adapter-v1"
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
    driverQueryCommand?: {
      command: string;
      args?: string[];
    };
    timeoutMs?: number;
    signal?: AbortSignal;
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
