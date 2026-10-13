import type { MinimaxH3ComfyUiTransportPort } from "@cco/application";

const MAX_RESPONSE_BODY_BYTES = 50 * 1024 * 1024;

// Reads a Response body incrementally, aborting as soon as the byte limit
// is exceeded instead of fully materializing it first. res.text()
// allocates the complete body before any size check can run — for a
// chunked response (no Content-Length) or one that lies about its
// Content-Length, that defeats the size guard entirely and lets an
// oversized or adversarial response exhaust memory before it's rejected.
async function readBodyWithLimit(res: Response, maxBytes: number): Promise<string> {
  if (!res.body) {
    // Some environments/responses have no readable stream (e.g. HEAD
    // responses, or test doubles); fall back to text() with a post-hoc
    // check — still better than nothing, and the Content-Length check
    // upstream already covers the common case this path represents.
    const text = await res.text();
    if (text.length > maxBytes) {
      throw new Error(`Response body exceeds maximum allowed size (${maxBytes} bytes)`);
    }
    return text;
  }

  const reader = res.body.getReader();
  const chunks: Uint8Array[] = [];
  let totalBytes = 0;
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      if (value) {
        totalBytes += value.byteLength;
        if (totalBytes > maxBytes) {
          throw new Error(`Response body exceeds maximum allowed size (${maxBytes} bytes)`);
        }
        chunks.push(value);
      }
    }
  } finally {
    try {
      await reader.cancel();
    } catch {
      // already closed/cancelled
    }
  }
  const combined = new Uint8Array(totalBytes);
  let offset = 0;
  for (const chunk of chunks) {
    combined.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return new TextDecoder("utf-8").decode(combined);
}

export class MinimaxH3ComfyUiAdapter implements MinimaxH3ComfyUiTransportPort {
  private readonly fetchFn: typeof globalThis.fetch;

  constructor(fetchFn?: typeof globalThis.fetch) {
    this.fetchFn = fetchFn ?? globalThis.fetch.bind(globalThis);
  }

  private async fetchJsonWithTimeout<T>(
    url: string,
    options: RequestInit = {},
    timeoutMs = 30000,
    externalSignal?: AbortSignal
  ): Promise<{ ok: boolean; status: number; statusText: string; data?: T; error?: string }> {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => {
      controller.abort(new Error(`HTTP request timed out after ${timeoutMs}ms`));
    }, timeoutMs);

    const onAbort = () => {
      controller.abort(new Error("Request aborted by caller signal"));
    };
    if (externalSignal) {
      if (externalSignal.aborted) {
        controller.abort(new Error("Request aborted by caller signal"));
      } else {
        externalSignal.addEventListener("abort", onAbort, { once: true });
      }
    }

    try {
      const res = await this.fetchFn(url, {
        ...options,
        signal: controller.signal
      });
      if (!res.ok) {
        let errorBody = "";
        try {
          errorBody = await readBodyWithLimit(res, MAX_RESPONSE_BODY_BYTES);
        } catch {
          // ignore error reading body (including an over-limit body —
          // readBodyWithLimit's own abort already bounded the memory cost)
        }
        return {
          ok: false,
          status: res.status,
          statusText: res.statusText,
          error: errorBody
            ? `HTTP ${res.status}: ${errorBody}`
            : `HTTP ${res.status}: ${res.statusText}`
        };
      }
      // The Content-Length check is a fast-path rejection for the common
      // case; readBodyWithLimit enforces the real bound regardless of
      // whether Content-Length is present, absent, or understated (e.g. a
      // chunked response).
      const contentLengthHeader = res.headers?.get?.("content-length");
      if (contentLengthHeader) {
        const len = parseInt(contentLengthHeader, 10);
        if (!Number.isNaN(len) && len > MAX_RESPONSE_BODY_BYTES) {
          throw new Error(
            `Response body exceeds maximum allowed size (${MAX_RESPONSE_BODY_BYTES} bytes): ${len} bytes`
          );
        }
      }
      const text = await readBodyWithLimit(res, MAX_RESPONSE_BODY_BYTES);
      const data = JSON.parse(text) as T;
      return { ok: true, status: res.status, statusText: res.statusText, data };
    } catch (err) {
      return {
        ok: false,
        status: 0,
        statusText: (err as Error).message,
        error: (err as Error).message
      };
    } finally {
      clearTimeout(timeoutId);
      if (externalSignal) {
        externalSignal.removeEventListener("abort", onAbort);
      }
    }
  }

  async waitForReadiness(
    baseUrl: string,
    timeoutMs: number,
    abortSignal?: AbortSignal
  ): Promise<{ ok: boolean; blocker?: string }> {
    const start = Date.now();
    const pollIntervalMs = 500;

    while (Date.now() - start < timeoutMs) {
      if (abortSignal?.aborted) {
        return { ok: false, blocker: "Aborted by signal during readiness wait" };
      }
      const res = await this.fetchJsonWithTimeout(
        `${baseUrl}/system_stats`,
        { method: "GET" },
        2000,
        abortSignal
      );
      if (res.ok) {
        return { ok: true };
      }
      await new Promise((r) => setTimeout(r, pollIntervalMs));
    }

    return {
      ok: false,
      blocker: `ComfyUI child at ${baseUrl} failed to become ready within ${timeoutMs}ms`
    };
  }

  async submitPrompt(
    baseUrl: string,
    prompt: Record<string, unknown>,
    clientId: string,
    timeoutMs: number,
    abortSignal?: AbortSignal
  ): Promise<{ ok: boolean; promptId?: string; error?: string }> {
    if (abortSignal?.aborted) {
      return { ok: false, error: "Prompt submission cancelled by abort signal before POST" };
    }
    try {
      const res = await this.fetchJsonWithTimeout<{ prompt_id?: string | number }>(
        `${baseUrl}/prompt`,
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json"
          },
          body: JSON.stringify({
            prompt,
            client_id: clientId
          })
        },
        timeoutMs,
        abortSignal
      );

      if (!res.ok) {
        return {
          ok: false,
          error: res.error ?? `POST /prompt rejected with HTTP ${res.status}: ${res.statusText}`
        };
      }

      if (!res.data?.prompt_id) {
        return {
          ok: false,
          error: "POST /prompt returned JSON without prompt_id"
        };
      }

      return {
        ok: true,
        promptId: String(res.data.prompt_id)
      };
    } catch (err) {
      return {
        ok: false,
        error: `POST /prompt transport error: ${(err as Error).message}`
      };
    }
  }

  async pollPromptHistory(
    baseUrl: string,
    promptId: string,
    timeoutMs: number,
    pollIntervalMs: number,
    abortSignal?: AbortSignal
  ): Promise<{
    status: "completed" | "failed" | "timeout";
    outputFilename?: string;
    outputSubfolder?: string;
    outputType?: "output" | "temp";
    rawHistory?: unknown;
    error?: string;
    interrupted?: boolean;
  }> {
    const start = Date.now();

    while (Date.now() - start < timeoutMs) {
      if (abortSignal?.aborted) {
        return {
          status: "failed",
          error: "Polling aborted by operator signal",
          interrupted: true
        };
      }
      const remainingMs = Math.max(100, timeoutMs - (Date.now() - start));
      const pollBudgetMs = Math.min(5000, remainingMs);
      const res = await this.fetchJsonWithTimeout<
        Record<
          string,
          {
            status?: { status_str?: string; completed?: boolean; messages?: unknown[] };
            outputs?: Record<
              string,
              {
                videos?: Array<{ filename?: string; subfolder?: string; type?: string }>;
                images?: Array<{ filename?: string; subfolder?: string; type?: string }>;
              }
            >;
          }
        >
      >(
        `${baseUrl}/history/${encodeURIComponent(promptId)}`,
        { method: "GET" },
        pollBudgetMs,
        abortSignal
      );

      if (res.ok && res.data) {
        const entry = res.data[promptId];

        if (entry) {
          const status = entry.status;

          // Check failure and interruption conditions FIRST (ComfyUI may set completed: true even on execution error / OOM)
          const isInterrupted =
            status?.status_str === "interrupted" ||
            (Array.isArray(status?.messages) &&
              status.messages.some(
                (m: unknown) => Array.isArray(m) && m[0] === "execution_interrupted"
              ));

          if (isInterrupted) {
            return {
              status: "failed",
              rawHistory: entry,
              error: "ComfyUI execution interrupted",
              interrupted: true
            };
          }

          const isError =
            status?.status_str === "error" ||
            (Array.isArray(status?.messages) &&
              status.messages.some((m: unknown) => Array.isArray(m) && m[0] === "execution_error"));

          if (isError) {
            const errorMsg =
              status?.messages?.map((m: unknown) => JSON.stringify(m)).join("; ") ||
              "ComfyUI execution error";
            return {
              status: "failed",
              rawHistory: entry,
              error: errorMsg
            };
          }

          if (status?.status_str === "success") {
            // Target SaveVideo node 92 outputs only, validating safe filename and type.
            // Pinned ComfyUI PreviewVideo/SaveVideo serializes outputs under "images",
            // while some custom nodes serialize under "videos". We support both, preferring "images".
            let outputFilename: string | undefined;
            let outputSubfolder: string | undefined;
            let outputType: "output" | "temp" | undefined;
            const node92Output = entry.outputs?.["92"];
            const mediaList = Array.isArray(node92Output?.images)
              ? node92Output.images
              : Array.isArray(node92Output?.videos)
                ? node92Output.videos
                : null;

            if (mediaList && mediaList.length === 1) {
              const media = mediaList[0];
              const rawFilename = media?.filename;
              const subfolder = media?.subfolder ?? "";
              const mediaType = media?.type ?? "output";

              if (
                rawFilename &&
                !rawFilename.includes("..") &&
                !rawFilename.includes("/") &&
                !rawFilename.includes("\\") &&
                !subfolder.includes("..") &&
                (mediaType === "output" || mediaType === "temp")
              ) {
                outputFilename = rawFilename;
                // subfolder/type must be carried alongside outputFilename —
                // callers that assume every output lives flat in the
                // top-level outputs directory will look in the wrong place
                // (or the wrong directory entirely for type: "temp", which
                // ComfyUI writes to --temp-directory, not
                // --output-directory) and silently fail to find the real
                // file.
                outputSubfolder = subfolder;
                outputType = mediaType;
              }
            }

            return {
              status: "completed",
              ...(outputFilename !== undefined ? { outputFilename } : {}),
              ...(outputSubfolder !== undefined ? { outputSubfolder } : {}),
              ...(outputType !== undefined ? { outputType } : {}),
              rawHistory: entry
            };
          }
        }
      }

      await new Promise((r) => setTimeout(r, pollIntervalMs));
    }

    return {
      status: "timeout",
      error: `Poll prompt history timed out after ${timeoutMs}ms`
    };
  }

  async getQueue(baseUrl: string): Promise<{ running: unknown[]; pending: unknown[] }> {
    const res = await this.fetchJsonWithTimeout<{
      queue_running?: unknown[];
      queue_pending?: unknown[];
    }>(`${baseUrl}/queue`, { method: "GET" }, 5000);

    if (res.ok && res.data) {
      return {
        running: res.data.queue_running || [],
        pending: res.data.queue_pending || []
      };
    }
    return { running: [], pending: [] };
  }

  async findPromptByWorkflowDigestOrClient(
    baseUrl: string,
    clientId: string
  ): Promise<{
    promptId?: string;
    status?: "completed" | "failed" | "running" | "queued";
    outputFilename?: string;
    outputSubfolder?: string;
    outputType?: "output" | "temp";
  } | null> {
    // 1. Check history
    const res = await this.fetchJsonWithTimeout<
      Record<
        string,
        {
          prompt?: unknown[];
          client_id?: string;
          status?: { status_str?: string; completed?: boolean; messages?: unknown[] };
          outputs?: Record<
            string,
            {
              videos?: Array<{ filename?: string; subfolder?: string; type?: string }>;
              images?: Array<{ filename?: string; subfolder?: string; type?: string }>;
            }
          >;
        }
      >
    >(`${baseUrl}/history`, { method: "GET" }, 5000);

    if (res.ok && res.data) {
      for (const [pId, entry] of Object.entries(res.data)) {
        const promptPayload = entry.prompt?.[3] as { client_id?: string } | undefined;
        if (promptPayload?.client_id === clientId || entry.client_id === clientId) {
          const isInterrupted =
            entry.status?.status_str === "interrupted" ||
            (Array.isArray(entry.status?.messages) &&
              entry.status.messages.some(
                (m: unknown) => Array.isArray(m) && m[0] === "execution_interrupted"
              ));
          const isError =
            entry.status?.status_str === "error" ||
            (Array.isArray(entry.status?.messages) &&
              entry.status.messages.some(
                (m: unknown) => Array.isArray(m) && m[0] === "execution_error"
              ));
          const isSuccess = entry.status?.status_str === "success";

          let outputFilename: string | undefined;
          let outputSubfolder: string | undefined;
          let outputType: "output" | "temp" | undefined;
          if (isSuccess && !isError && !isInterrupted) {
            const node92Output = entry.outputs?.["92"];
            const mediaList = Array.isArray(node92Output?.images)
              ? node92Output.images
              : Array.isArray(node92Output?.videos)
                ? node92Output.videos
                : null;
            if (mediaList && mediaList.length === 1) {
              const media = mediaList[0];
              const rawFilename = media?.filename;
              const subfolder = media?.subfolder ?? "";
              const mediaType = media?.type ?? "output";
              if (
                rawFilename &&
                !rawFilename.includes("..") &&
                !rawFilename.includes("/") &&
                !rawFilename.includes("\\") &&
                !subfolder.includes("..") &&
                (mediaType === "output" || mediaType === "temp")
              ) {
                outputFilename = rawFilename;
                outputSubfolder = subfolder;
                outputType = mediaType;
              }
            }
          }

          return {
            promptId: pId,
            status: isError || isInterrupted ? "failed" : isSuccess ? "completed" : "running",
            ...(outputFilename ? { outputFilename } : {}),
            ...(outputSubfolder !== undefined ? { outputSubfolder } : {}),
            ...(outputType !== undefined ? { outputType } : {})
          };
        }
      }
    }

    // 2. Check queue
    const queue = await this.getQueue(baseUrl);
    for (const rawItem of queue.running) {
      const item = rawItem as [unknown, string, unknown, { client_id?: string }?];
      if (item?.[3]?.client_id === clientId || item?.[1] === clientId) {
        return { promptId: item[1], status: "running" };
      }
    }
    for (const rawItem of queue.pending) {
      const item = rawItem as [unknown, string, unknown, { client_id?: string }?];
      if (item?.[3]?.client_id === clientId || item?.[1] === clientId) {
        return { promptId: item[1], status: "queued" };
      }
    }

    return null;
  }
}
