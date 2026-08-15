import { createHash } from "node:crypto";
import * as fsPromises from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  canonicalizeWorkflow,
  hashFileStream,
  hashModelFiles,
  hashWorkflow,
  resolveModelFilePath,
  type ModelCategory,
  type ModelFileSpec,
  type ModelHashProgress
} from "./hasher.js";

let mutatePostStat = false;
let statForMutatingFileCount = 0;

vi.mock("node:fs/promises", async (importOriginal) => {
  const actual = (await importOriginal()) as typeof fsPromises;
  return {
    ...actual,
    stat: async (
      path: Parameters<typeof fsPromises.stat>[0],
      options?: Parameters<typeof fsPromises.stat>[1]
    ) => {
      const result = await actual.stat(path, options);
      if (mutatePostStat && typeof path === "string" && path.includes("mutating.safetensors")) {
        statForMutatingFileCount += 1;
        if (statForMutatingFileCount === 2) {
          return {
            ...result,
            size: Number(result.size) + 1024,
            mtimeMs: Number(result.mtimeMs) + 5000
          };
        }
      }
      return result;
    }
  };
});

describe("Workflow and Model Provenance Hasher", () => {
  let tempDir: string;

  beforeEach(async () => {
    tempDir = await fsPromises.mkdtemp(join(tmpdir(), "hasher-test-"));
  });

  afterEach(async () => {
    await fsPromises.rm(tempDir, { recursive: true, force: true });
  });

  it("canonical workflow hashing ignores object key order and whitespace", () => {
    const workflowA = JSON.stringify(
      {
        nodes: {
          sampler: {
            class_type: "KSampler",
            inputs: {
              seed: 42,
              steps: 20,
              cfg: 8.0,
              denoise: 1.0
            }
          },
          loader: {
            class_type: "CheckpointLoaderSimple",
            inputs: {
              ckpt_name: "v1-5-pruned-emaonly.safetensors"
            }
          }
        },
        links: [
          [1, "loader", 0, "sampler", 0, "MODEL"],
          [2, "loader", 1, "sampler", 1, "CLIP"]
        ]
      },
      null,
      2
    );

    const workflowB = JSON.stringify({
      links: [
        [1, "loader", 0, "sampler", 0, "MODEL"],
        [2, "loader", 1, "sampler", 1, "CLIP"]
      ],
      nodes: {
        loader: {
          inputs: {
            ckpt_name: "v1-5-pruned-emaonly.safetensors"
          },
          class_type: "CheckpointLoaderSimple"
        },
        sampler: {
          inputs: {
            denoise: 1.0,
            cfg: 8.0,
            steps: 20,
            seed: 42
          },
          class_type: "KSampler"
        }
      }
    });

    const canonicalA = canonicalizeWorkflow(workflowA);
    const canonicalB = canonicalizeWorkflow(workflowB);

    expect(canonicalA).toBe(canonicalB);

    const hashA = hashWorkflow(workflowA);
    const hashB = hashWorkflow(workflowB);

    expect(hashA).toBe(hashB);
    expect(hashA).toMatch(/^[0-9a-f]{64}$/);
    expect(hashA).toBe(createHash("sha256").update(canonicalA, "utf8").digest("hex"));
  });

  it("canonical workflow hashing preserves array semantics", () => {
    const workflowA = JSON.stringify({
      node: {
        inputs: {
          channels: ["red", "green", "blue"],
          connections: [1, 2, 3]
        }
      }
    });

    const workflowB = JSON.stringify({
      node: {
        inputs: {
          channels: ["blue", "green", "red"],
          connections: [1, 2, 3]
        }
      }
    });

    const workflowC = JSON.stringify({
      node: {
        inputs: {
          channels: ["red", "green", "blue"],
          connections: [3, 2, 1]
        }
      }
    });

    const canonicalA = canonicalizeWorkflow(workflowA);
    const canonicalB = canonicalizeWorkflow(workflowB);
    const canonicalC = canonicalizeWorkflow(workflowC);

    expect(canonicalA).not.toBe(canonicalB);
    expect(canonicalA).not.toBe(canonicalC);
    expect(canonicalB).not.toBe(canonicalC);

    const hashA = hashWorkflow(workflowA);
    const hashB = hashWorkflow(workflowB);
    const hashC = hashWorkflow(workflowC);

    expect(hashA).not.toBe(hashB);
    expect(hashA).not.toBe(hashC);
  });

  it("canonical workflow hashing handles __proto__ keys without prototype pollution", () => {
    const workflowA = '{"__proto__":{"polluted":true},"nodes":{"a":1}}';
    const workflowB = '{"nodes":{"a":1},"__proto__":{"polluted":true}}';

    const canonicalA = canonicalizeWorkflow(workflowA);
    const canonicalB = canonicalizeWorkflow(workflowB);

    expect(canonicalA).toBe(canonicalB);
    expect(canonicalA).toContain('"__proto__"');

    const hashA = hashWorkflow(workflowA);
    const hashB = hashWorkflow(workflowB);
    expect(hashA).toBe(hashB);
  });

  it("streamed file hashing matches the known SHA-256 without reading the whole file", async () => {
    const filePath = join(tempDir, "sample-stream.bin");
    const chunk = Buffer.from("Deterministic chunk payload for streaming hash validation test\n");
    const totalChunks = 1000;
    const fullBuffer = Buffer.concat(Array.from({ length: totalChunks }, () => chunk));
    await fsPromises.writeFile(filePath, fullBuffer);

    const expectedSha256 = createHash("sha256").update(fullBuffer).digest("hex");

    const digest = await hashFileStream(filePath);
    expect(digest).toBe(expectedSha256);
    expect(digest).toMatch(/^[0-9a-f]{64}$/);
  });

  it("model hashing returns stable keys and sorted results", async () => {
    const comfyUiDir = tempDir;
    await fsPromises.mkdir(join(comfyUiDir, "models", "checkpoints"), { recursive: true });
    await fsPromises.mkdir(join(comfyUiDir, "models", "diffusion_models"), { recursive: true });
    await fsPromises.mkdir(join(comfyUiDir, "models", "loras", "subfolder"), { recursive: true });

    const ckptPath = join(comfyUiDir, "models", "checkpoints", "model-b.safetensors");
    const diffPath = join(comfyUiDir, "models", "diffusion_models", "model-a.safetensors");
    const loraPath = join(comfyUiDir, "models", "loras", "subfolder", "lora-c.safetensors");

    const ckptContent = Buffer.from("checkpoint content");
    const diffContent = Buffer.from("diffusion model content");
    const loraContent = Buffer.from("lora content");

    await fsPromises.writeFile(ckptPath, ckptContent);
    await fsPromises.writeFile(diffPath, diffContent);
    await fsPromises.writeFile(loraPath, loraContent);

    const specCkpt: ModelFileSpec = {
      category: "checkpoints",
      relativePath: "model-b.safetensors"
    };
    const specDiff: ModelFileSpec = {
      category: "diffusion_models",
      relativePath: "model-a.safetensors"
    };
    const specLora: ModelFileSpec = {
      category: "loras",
      relativePath: "subfolder/lora-c.safetensors"
    };

    const specsForward = [specLora, specCkpt, specDiff];
    const specsReversed = [specDiff, specCkpt, specLora];

    const eventsForward: ModelHashProgress[] = [];
    const eventsReversed: ModelHashProgress[] = [];

    const resultsForward = await hashModelFiles(comfyUiDir, specsForward, (e) =>
      eventsForward.push(e)
    );
    const resultsReversed = await hashModelFiles(comfyUiDir, specsReversed, (e) =>
      eventsReversed.push(e)
    );

    const expectedKeys = [
      "models/checkpoints/model-b.safetensors",
      "models/diffusion_models/model-a.safetensors",
      "models/loras/subfolder/lora-c.safetensors"
    ];

    expect(resultsForward.map((r) => r.key)).toEqual(expectedKeys);
    expect(resultsReversed.map((r) => r.key)).toEqual(expectedKeys);
    expect(resultsForward).toEqual(resultsReversed);

    expect(Object.isFrozen(resultsForward)).toBe(true);
    resultsForward.forEach((item) => {
      expect(Object.isFrozen(item)).toBe(true);
    });

    expect(resultsForward[0]).toEqual({
      category: "checkpoints",
      relativePath: "model-b.safetensors",
      key: "models/checkpoints/model-b.safetensors",
      bytes: ckptContent.length,
      sha256: createHash("sha256").update(ckptContent).digest("hex")
    });

    expect(eventsForward).toEqual([
      { status: "started", key: "models/checkpoints/model-b.safetensors" },
      { status: "completed", key: "models/checkpoints/model-b.safetensors" },
      { status: "started", key: "models/diffusion_models/model-a.safetensors" },
      { status: "completed", key: "models/diffusion_models/model-a.safetensors" },
      { status: "started", key: "models/loras/subfolder/lora-c.safetensors" },
      { status: "completed", key: "models/loras/subfolder/lora-c.safetensors" }
    ]);
    expect(eventsReversed).toEqual(eventsForward);
  });

  it("model hashing reports a missing required file with its manifest key", async () => {
    const comfyUiDir = tempDir;
    await fsPromises.mkdir(join(comfyUiDir, "models", "vae"), { recursive: true });

    const missingSpec: ModelFileSpec = {
      category: "vae",
      relativePath: "missing-vae.safetensors"
    };

    await expect(hashModelFiles(comfyUiDir, [missingSpec])).rejects.toThrow(
      /models\/vae\/missing-vae\.safetensors/
    );

    try {
      await hashModelFiles(comfyUiDir, [missingSpec]);
      expect.unreachable("should have rejected");
    } catch (err: unknown) {
      expect(err).toBeInstanceOf(Error);
      const error = err as Error;
      expect(error.message).toContain("models/vae/missing-vae.safetensors");
      expect(error.cause).toBeDefined();
    }
  });

  it("model path resolution rejects absolute and parent traversal paths", () => {
    const comfyUiDir = tempDir;

    const invalidSpecs: ModelFileSpec[] = [
      { category: "checkpoints", relativePath: "/etc/passwd" },
      { category: "diffusion_models", relativePath: "../outside.safetensors" },
      { category: "vae", relativePath: "nested/../../outside.safetensors" },
      { category: "loras", relativePath: "" },
      { category: "clip", relativePath: "   " },
      { category: "model_patches", relativePath: "..\\win-style-traversal" }
    ];

    for (const spec of invalidSpecs) {
      expect(() => resolveModelFilePath(comfyUiDir, spec)).toThrow();
    }

    const validSpec: ModelFileSpec = {
      category: "checkpoints",
      relativePath: "folder/model.safetensors"
    };
    expect(resolveModelFilePath(comfyUiDir, validSpec)).toBe(
      join(comfyUiDir, "models", "checkpoints", "folder", "model.safetensors")
    );
  });

  it("model path resolution rejects invalid and path traversal categories", () => {
    const comfyUiDir = tempDir;

    const invalidCategorySpecs: ModelFileSpec[] = [
      { category: "../../etc" as ModelCategory, relativePath: "model.safetensors" },
      { category: "../checkpoints" as ModelCategory, relativePath: "model.safetensors" },
      { category: "invalid_category" as ModelCategory, relativePath: "model.safetensors" },
      { category: "" as ModelCategory, relativePath: "model.safetensors" }
    ];

    for (const spec of invalidCategorySpecs) {
      expect(() => resolveModelFilePath(comfyUiDir, spec)).toThrow(/Invalid model category/);
    }
  });

  it("model hashing rejects a file that changes while it is read", async () => {
    const comfyUiDir = tempDir;
    await fsPromises.mkdir(join(comfyUiDir, "models", "checkpoints"), { recursive: true });
    const filePath = join(comfyUiDir, "models", "checkpoints", "mutating.safetensors");
    await fsPromises.writeFile(filePath, "initial content");

    const spec: ModelFileSpec = {
      category: "checkpoints",
      relativePath: "mutating.safetensors"
    };

    mutatePostStat = true;
    statForMutatingFileCount = 0;
    try {
      await expect(hashModelFiles(comfyUiDir, [spec])).rejects.toThrow(
        /models\/checkpoints\/mutating\.safetensors/
      );
      expect(statForMutatingFileCount).toBe(2);
    } finally {
      mutatePostStat = false;
    }
  });
});
