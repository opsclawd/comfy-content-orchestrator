# S1-06 Design: Gold Master Workflows & Provenance Tooling

## 1. The Problem Being Solved and Why It Matters
Generative AI workflows in tools like ComfyUI often suffer from "prompt drift", missing node dependencies, and ambiguous model versions when configured manually. To certify the system architecture and ensure transactional reliability, the orchestration engine needs deterministic and reproducible inputs. This issue establishes the exact "Gold Master" API-format workflows for FLUX.1 [schnell] drafts and LTX-2.5 720p video. It also introduces provenance tooling to cryptographically pin the workflow structures, model weights, and execution environments (Git commits), ensuring that future hardware certifications and `RenderProfile` manifests are bound to an immutable context.

## 2. Key Design Decisions and Trade-offs Considered
- **Workflow Canonicalization:** ComfyUI JSON exports can vary in key order and whitespace depending on the exporter or manual edits. 
  - *Decision:* We will canonicalize the JSON by parsing it and re-stringifying with deterministically sorted keys (alphabetical) and no whitespace before hashing. This ensures semantically identical workflows yield the same SHA-256 hash.
- **File Hashing Strategy:** Model families like LTX-2.5 are approximately 69GB. 
  - *Decision:* The hashing utility must use Node.js `crypto` streams with `fs.createReadStream` to avoid buffering into RAM. Attempting to load 40GB diffusion models into memory would cause immediate OOM crashes on the 32GB target workstation.
- **Disk Preflight Measurement:** Hard-coding expected sizes makes the system fragile when models are updated or pruned.
  - *Decision:* Preflight will dynamically aggregate the disk footprint using `fs.stat` on target ComfyUI model directories. Free space will be verified against the partition mounting the ComfyUI directory using standard OS utilities (e.g., `fs.statfs`).

## 3. Proposed Approach with Rationale
- **Workflow Assets:** 
  - Create a `templates/` directory at the repository root to store `flux_schnell_draft_api.json` and `ltx_25_720p_97f_api.json`.
  - These files must be derived directly from the official upstream/validated instances.
- **Provenance Core (`packages/infrastructure/src/comfyui/provenance/`)**:
  - `hasher.ts`: Provide `hashFileStream(filePath)` for large files and `hashWorkflow(jsonString)` for canonicalized JSON strings.
  - `preflight.ts`: Implement footprint aggregation (scanning `diffusion_models`, `text_encoders`, `vae`, `loras`) and partition free-space validation.
  - `git-tracker.ts`: Execute `git rev-parse HEAD` safely to resolve the ComfyUI runtime commit and the commits of any subdirectories in `custom_nodes/`.
- **CLI Runner (`packages/infrastructure/src/comfyui/provenance/cli.ts`)**:
  - A command-line entrypoint (run via `tsx` or compiled script) that accepts a `--comfyui-dir` parameter.
  - It sequentially executes the preflight check, extracts git metadata, and computes SHA-256 hashes.
  - It outputs human-readable progress/logs to `stderr` and the final machine-readable JSON object (matching the `RenderProfile` properties) to `stdout`.

## 4. Assumptions Made
- The ComfyUI environment follows the standard directory layout (`models/diffusion_models`, `models/text_encoders`, `custom_nodes/`).
- The 100GB free-space requirement is verified against the filesystem partition hosting the specified ComfyUI directory.
- Model paths inside the ComfyUI directory are resolvable and the Node.js process has sufficient read permissions.
- Custom nodes are primarily installed via Git; the tool will safely fallback to "untracked" or skip gracefully if a `custom_nodes` subdirectory is not a git repository.
- Workflow templates are static and already in ComfyUI "API format" (not the GUI format).

## 5. In Scope
- Creation of the `templates/` directory containing the FLUX and LTX API-format templates.
- Implementation of deterministic workflow canonicalization and SHA-256 hashing.
- Streaming SHA-256 hash generation for multi-gigabyte model files.
- Disk footprint aggregation for the LTX model family.
- Free-space preflight validation (>= 100GB).
- Extraction of runtime Git commits (ComfyUI base and custom nodes).
- A CLI script outputting certification metadata matching `RenderProfile` requirements.
- Unit testing for canonical hashing and preflight logic using mock/small files.

## 6. Explicitly Out of Scope
- Actually executing the workflow in ComfyUI or triggering diffusion benchmarks (to be handled in #7/#8).
- Automatically downloading missing models if the preflight detects they are absent.
- GenerationManifest database persistence.
- Any GUI or Web UI for the provenance tooling; it remains a CLI/backend utility.

## 7. Risks or Concerns Identified from Code Analysis
- **I/O Bottlenecks:** Hashing ~69GB of models on a PCIe 4.0 NVMe SSD will take significant time. The CLI needs clear progress logging to `stderr` so operators don't assume the tool has hung.
- **Cross-Platform Free Space Checks:** Node's `fs.statfs` is available in newer Node versions (we are on Node 24 LTS, so it is fully supported) but requires precise usage to extract accurate available gigabytes.
- **Dynamic File Changes:** If ComfyUI is concurrently writing to cache or temporary files inside the targeted model directories, the footprint calculations might fluctuate. The tool should target exact model directories rather than the entire ComfyUI tree recursively to avoid capturing irrelevant volatile data.
