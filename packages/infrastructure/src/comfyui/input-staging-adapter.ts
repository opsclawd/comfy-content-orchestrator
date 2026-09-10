import { unlink } from "node:fs/promises";
import path from "node:path";
import type { ComfyUiInputStagingPort, StagedComfyUiInput } from "@cco/application";
import type { ComfyUiClient } from "./comfyui-client.js";

export interface HttpComfyUiInputStagingAdapterOptions {
  readonly client: ComfyUiClient;
  readonly comfyUiDir?: string | undefined;
  readonly uploadTimeoutMs?: number | undefined;
  readonly unlinkFn?: ((path: string) => Promise<void>) | undefined;
}

function containsPathTraversal(segment: string): boolean {
  return (
    segment.includes("/") || segment.includes("\\") || segment.includes("..") || segment === "."
  );
}

export class HttpComfyUiInputStagingAdapter implements ComfyUiInputStagingPort {
  private readonly client: ComfyUiClient;
  private readonly comfyUiDir?: string | undefined;
  private readonly uploadTimeoutMs?: number | undefined;
  private readonly unlinkFn: (path: string) => Promise<void>;

  constructor(options: HttpComfyUiInputStagingAdapterOptions) {
    this.client = options.client;
    this.comfyUiDir = options.comfyUiDir?.trim() || undefined;
    this.uploadTimeoutMs = options.uploadTimeoutMs;
    this.unlinkFn = options.unlinkFn ?? unlink;
  }

  async stage(input: {
    filename: string;
    bytes: Uint8Array;
    contentType: string;
  }): Promise<StagedComfyUiInput> {
    if (containsPathTraversal(input.filename)) {
      throw new Error(
        `Input filename contains invalid path traversal characters: "${input.filename}"`
      );
    }

    const uploaded = await this.client.uploadImage(input.filename, input.bytes, input.contentType, {
      overwrite: true,
      ...(this.uploadTimeoutMs !== undefined ? { timeoutMs: this.uploadTimeoutMs } : {})
    });

    if (containsPathTraversal(uploaded.name)) {
      throw new Error(
        `Uploaded image returned invalid path traversal characters in name: "${uploaded.name}"`
      );
    }

    if (uploaded.name !== input.filename) {
      throw new Error(
        `Uploaded image returned name "${uploaded.name}" did not match requested filename "${input.filename}"`
      );
    }

    if (uploaded.subfolder && containsPathTraversal(uploaded.subfolder)) {
      throw new Error(
        `Uploaded image returned invalid path traversal characters in subfolder: "${uploaded.subfolder}"`
      );
    }

    return {
      name: uploaded.name,
      subfolder: uploaded.subfolder ?? ""
    };
  }

  async cleanup(staged: StagedComfyUiInput): Promise<void> {
    if (!this.comfyUiDir) {
      return;
    }

    if (containsPathTraversal(staged.name)) {
      return;
    }

    if (staged.subfolder && containsPathTraversal(staged.subfolder)) {
      return;
    }

    const targetPath = path.join(
      this.comfyUiDir,
      "input",
      ...(staged.subfolder ? [staged.subfolder] : []),
      staged.name
    );

    try {
      await this.unlinkFn(targetPath);
    } catch {
      // Swallowed: best-effort cleanup, never affects render correctness.
    }
  }
}
