import type {
  QueueRenderInput,
  RenderEnginePort,
  RenderQueueReceipt,
  RenderResult
} from "@cco/application";
import {
  ComfyUiClient,
  type ComfyUiHistoryEntry,
  type ComfyUiTransport
} from "./comfyui-client.js";
import { ComfyUiRenderEngineError } from "./comfyui-error.js";

export interface ComfyUiRenderEngineAdapterOptions {
  readonly baseUrl?: string;
  readonly timeoutMs?: number;
  readonly transport?: ComfyUiTransport;
  readonly createClientId?: () => string;
  readonly now?: () => Date;
}

type TrackingOutcome =
  | { readonly ok: true; readonly result: RenderResult }
  | { readonly ok: false; readonly error: ComfyUiRenderEngineError };

interface ComfyUiMessageEnvelope {
  readonly type?: string | undefined;
  readonly data?: Readonly<Record<string, unknown>> | undefined;
}

function outputKey(subfolder: string | undefined, filename: string): string {
  const normalized = subfolder?.replace(/^\/+|\/+$/g, "");
  return normalized ? `${normalized}/${filename}` : filename;
}

function mapHistoryToRenderResult(
  executionId: string,
  entry: ComfyUiHistoryEntry | undefined,
  now: () => Date
): RenderResult {
  if (entry === undefined || entry === null || typeof entry !== "object") {
    throw new ComfyUiRenderEngineError("HISTORY_MISSING", "ComfyUI history entry not found", {
      promptId: executionId
    });
  }

  const status = entry.status;
  if (
    typeof status !== "object" ||
    status === null ||
    status.completed !== true ||
    status.status_str !== "success"
  ) {
    throw new ComfyUiRenderEngineError(
      "HISTORY_NOT_SUCCESSFUL",
      "ComfyUI history status was not successful",
      { promptId: executionId }
    );
  }

  const outputObjectKeys: string[] = [];
  const outputs = entry.outputs;
  if (typeof outputs === "object" && outputs !== null) {
    for (const nodeOutput of Object.values(outputs)) {
      if (typeof nodeOutput === "object" && nodeOutput !== null) {
        const images = (nodeOutput as { images?: unknown }).images;
        if (Array.isArray(images)) {
          for (const item of images) {
            if (
              typeof item === "object" &&
              item !== null &&
              typeof item.filename === "string" &&
              item.filename.trim().length > 0
            ) {
              const subfolder =
                typeof item.subfolder === "string" ? item.subfolder.trim() : undefined;
              outputObjectKeys.push(outputKey(subfolder, item.filename.trim()));
            }
          }
        }

        const videos = (nodeOutput as { videos?: unknown }).videos;
        if (Array.isArray(videos)) {
          for (const item of videos) {
            if (
              typeof item === "object" &&
              item !== null &&
              typeof item.filename === "string" &&
              item.filename.trim().length > 0
            ) {
              const subfolder =
                typeof item.subfolder === "string" ? item.subfolder.trim() : undefined;
              outputObjectKeys.push(outputKey(subfolder, item.filename.trim()));
            }
          }
        }
      }
    }
  }

  return {
    executionId,
    status: "succeeded",
    outputObjectKeys,
    completedAt: now().toISOString()
  };
}

function parseMessageEnvelope(data: unknown): ComfyUiMessageEnvelope | undefined {
  if (typeof data !== "string") {
    return undefined;
  }
  try {
    const parsed = JSON.parse(data);
    if (typeof parsed === "object" && parsed !== null && typeof parsed.type === "string") {
      return {
        type: parsed.type,
        data:
          typeof parsed.data === "object" && parsed.data !== null
            ? (parsed.data as Record<string, unknown>)
            : undefined
      };
    }
  } catch {
    return undefined;
  }
  return undefined;
}

export class ComfyUiRenderEngineAdapter implements RenderEnginePort {
  private readonly client: ComfyUiClient;
  private readonly timeoutMs: number;
  private readonly createClientId: () => string;
  private readonly now: () => Date;
  private readonly activeTrackers = new Map<string, Promise<TrackingOutcome>>();

  constructor(options: ComfyUiRenderEngineAdapterOptions = {}) {
    const baseUrl = options.baseUrl ?? "http://127.0.0.1:8188";
    this.client = new ComfyUiClient(baseUrl, options.transport);
    this.timeoutMs = options.timeoutMs ?? 300_000;
    this.createClientId = options.createClientId ?? (() => crypto.randomUUID());
    this.now = options.now ?? (() => new Date());
  }

  async queueRender(input: QueueRenderInput): Promise<RenderQueueReceipt> {
    const clientId = this.createClientId();
    const socket = this.client.connect(clientId);

    let promptId: string | undefined;
    let settled = false;
    let state: "connecting" | "submitting" | "tracking" | "verifying_history" | "settled" =
      "connecting";
    const messageBuffer: ComfyUiMessageEnvelope[] = [];

    let resolveOutcome!: (outcome: TrackingOutcome) => void;
    const outcomePromise = new Promise<TrackingOutcome>((res) => {
      resolveOutcome = res;
    });

    let timeoutTimer: ReturnType<typeof setTimeout> | undefined;

    let resolveQueue: ((receipt: RenderQueueReceipt) => void) | undefined;
    let rejectQueue: ((err: unknown) => void) | undefined;

    const queuePromise = new Promise<RenderQueueReceipt>((resolve, reject) => {
      resolveQueue = resolve;
      rejectQueue = reject;
    });

    const settle = (outcome: TrackingOutcome) => {
      if (settled) return;
      settled = true;
      state = "settled";

      if (timeoutTimer !== undefined) {
        clearTimeout(timeoutTimer);
        timeoutTimer = undefined;
      }

      socket.removeEventListener("open", onOpen);
      socket.removeEventListener("message", onMessage);
      socket.removeEventListener("error", onError);
      socket.removeEventListener("close", onClose);

      if (socket.readyState === 0 || socket.readyState === 1) {
        socket.close();
      }

      resolveOutcome(outcome);
    };

    const handleTrackingMessage = (envelope: ComfyUiMessageEnvelope) => {
      const { type, data } = envelope;
      if (!data) return;

      const eventPromptId = typeof data.prompt_id === "string" ? data.prompt_id : undefined;
      if (eventPromptId !== promptId) {
        return;
      }

      if (type === "progress") {
        // Recognized but non-terminal
        return;
      }

      if (type === "executing") {
        if (data.node === null) {
          state = "verifying_history";
          void (async () => {
            try {
              const entry = await this.client.getHistory(promptId!);
              const result = mapHistoryToRenderResult(promptId!, entry, this.now);
              settle({ ok: true, result });
            } catch (err) {
              if (err instanceof ComfyUiRenderEngineError) {
                settle({ ok: false, error: err });
              } else {
                settle({
                  ok: false,
                  error: new ComfyUiRenderEngineError(
                    "HISTORY_REQUEST_FAILED",
                    "ComfyUI history request failed",
                    { promptId: promptId! }
                  )
                });
              }
            }
          })();
        }
        return;
      }

      if (type === "execution_error") {
        const nodeId =
          typeof data.node_id === "string"
            ? data.node_id
            : typeof data.nodeId === "string"
              ? data.nodeId
              : undefined;
        const nodeType =
          typeof data.node_type === "string"
            ? data.node_type
            : typeof data.nodeType === "string"
              ? data.nodeType
              : undefined;

        settle({
          ok: false,
          error: new ComfyUiRenderEngineError(
            "NODE_EXECUTION_FAILED",
            "ComfyUI node execution failed",
            { promptId, nodeId, nodeType }
          )
        });
        return;
      }

      if (type === "execution_interrupted") {
        const nodeId =
          typeof data.node_id === "string"
            ? data.node_id
            : typeof data.nodeId === "string"
              ? data.nodeId
              : undefined;
        const nodeType =
          typeof data.node_type === "string"
            ? data.node_type
            : typeof data.nodeType === "string"
              ? data.nodeType
              : undefined;

        settle({
          ok: false,
          error: new ComfyUiRenderEngineError(
            "EXECUTION_INTERRUPTED",
            "ComfyUI execution was interrupted",
            { promptId, nodeId, nodeType }
          )
        });
      }
    };

    const startSubmission = () => {
      void (async () => {
        try {
          const id = await this.client.queuePrompt(clientId, input.workflow);
          if (settled) {
            return;
          }
          promptId = id;
          this.activeTrackers.set(promptId, outcomePromise);
          state = "tracking";

          while (messageBuffer.length > 0 && !settled) {
            const buffered = messageBuffer.shift()!;
            handleTrackingMessage(buffered);
          }

          resolveQueue!({
            executionId: promptId,
            acceptedAt: this.now().toISOString()
          });
        } catch (err) {
          if (settled) return;
          const finalError =
            err instanceof ComfyUiRenderEngineError
              ? err
              : new ComfyUiRenderEngineError(
                  "QUEUE_SUBMISSION_FAILED",
                  "ComfyUI prompt submission failed"
                );
          settle({ ok: false, error: finalError });
          rejectQueue!(finalError);
        }
      })();
    };

    const onOpen = () => {
      // Socket open alone does not transition to submitting
    };

    const onMessage = (evt: unknown) => {
      if (settled) return;
      const rawData = (evt as { data?: unknown })?.data;
      const envelope = parseMessageEnvelope(rawData);
      if (!envelope) return;

      if (state === "connecting") {
        if (envelope.type === "status") {
          state = "submitting";
          startSubmission();
        }
        return;
      }

      if (state === "submitting") {
        messageBuffer.push(envelope);
        return;
      }

      if (state === "tracking") {
        handleTrackingMessage(envelope);
      }
    };

    const onError = () => {
      if (settled || state === "verifying_history") return;
      const err = new ComfyUiRenderEngineError(
        "WEBSOCKET_CONNECTION_FAILED",
        state === "tracking"
          ? "WebSocket disconnected during execution tracking"
          : "WebSocket connection failed before readiness",
        promptId ? { promptId } : {}
      );
      settle({ ok: false, error: err });
      if (rejectQueue) {
        rejectQueue(err);
      }
    };

    const onClose = () => {
      if (settled || state === "verifying_history") return;
      const err = new ComfyUiRenderEngineError(
        "WEBSOCKET_CONNECTION_FAILED",
        state === "tracking"
          ? "WebSocket disconnected during execution tracking"
          : "WebSocket closed before readiness",
        promptId ? { promptId } : {}
      );
      settle({ ok: false, error: err });
      if (rejectQueue) {
        rejectQueue(err);
      }
    };

    timeoutTimer = setTimeout(() => {
      if (settled) return;
      const err = new ComfyUiRenderEngineError("RENDER_TIMEOUT", "Render execution timed out", {
        timeoutMs: this.timeoutMs,
        ...(promptId ? { promptId } : {})
      });
      settle({ ok: false, error: err });
      if (rejectQueue) {
        rejectQueue(err);
      }
    }, this.timeoutMs);

    socket.addEventListener("open", onOpen);
    socket.addEventListener("message", onMessage);
    socket.addEventListener("error", onError);
    socket.addEventListener("close", onClose);

    return queuePromise;
  }

  async getRenderResult(executionId: string): Promise<RenderResult | undefined> {
    const activeTracker = this.activeTrackers.get(executionId);
    if (activeTracker !== undefined) {
      this.activeTrackers.delete(executionId);
      const outcome = await activeTracker;
      if (outcome.ok) {
        return outcome.result;
      }
      throw outcome.error;
    }

    const entry = await this.client.getHistory(executionId);
    return mapHistoryToRenderResult(executionId, entry, this.now);
  }

  async unloadModels(): Promise<void> {
    await this.client.unloadModels();
  }
}
