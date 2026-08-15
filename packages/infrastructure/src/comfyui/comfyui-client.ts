import { ComfyUiRenderEngineError } from "./comfyui-error.js";

export interface ComfyUiWebSocket {
  readonly readyState: number;
  addEventListener(
    type: "open" | "message" | "error" | "close",
    listener: (event: unknown) => void
  ): void;
  removeEventListener(
    type: "open" | "message" | "error" | "close",
    listener: (event: unknown) => void
  ): void;
  close(): void;
}

export interface ComfyUiTransport {
  readonly fetch: typeof globalThis.fetch;
  readonly createWebSocket: (url: string) => ComfyUiWebSocket;
}

export interface ComfyUiHistoryEntry {
  readonly outputs?: Readonly<Record<string, unknown>> | undefined;
  readonly status?: Readonly<Record<string, unknown>> | undefined;
}

export class ComfyUiClient {
  private readonly baseUrl: string;
  private readonly wsBaseUrl: string;
  private readonly transport: ComfyUiTransport;

  constructor(baseUrl: string, transport?: Partial<ComfyUiTransport>) {
    const rawUrl = baseUrl.trim();
    const urlWithScheme =
      rawUrl.startsWith("http://") || rawUrl.startsWith("https://") ? rawUrl : `http://${rawUrl}`;

    const parsed = new URL(urlWithScheme);
    const pathname = parsed.pathname.replace(/\/+$/, "");
    this.baseUrl = `${parsed.protocol}//${parsed.host}${pathname}`;

    const wsProtocol = parsed.protocol === "https:" ? "wss:" : "ws:";
    this.wsBaseUrl = `${wsProtocol}//${parsed.host}${pathname}`;

    this.transport = {
      fetch: transport?.fetch ?? globalThis.fetch.bind(globalThis),
      createWebSocket:
        transport?.createWebSocket ?? ((url: string): ComfyUiWebSocket => new WebSocket(url))
    };
  }

  connect(clientId: string): ComfyUiWebSocket {
    const wsUrl = `${this.wsBaseUrl}/ws?clientId=${encodeURIComponent(clientId)}`;
    return this.transport.createWebSocket(wsUrl);
  }

  async queuePrompt(
    clientId: string,
    workflow: Readonly<Record<string, unknown>>
  ): Promise<string> {
    let res: Response;
    try {
      res = await this.transport.fetch(`${this.baseUrl}/prompt`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json"
        },
        body: JSON.stringify({
          prompt: workflow,
          client_id: clientId
        })
      });
    } catch {
      throw new ComfyUiRenderEngineError(
        "QUEUE_SUBMISSION_FAILED",
        "ComfyUI prompt submission failed"
      );
    }

    if (!res.ok) {
      throw new ComfyUiRenderEngineError(
        "QUEUE_SUBMISSION_FAILED",
        "ComfyUI prompt submission failed",
        { statusCode: res.status }
      );
    }

    let data: unknown;
    try {
      data = await res.json();
    } catch {
      throw new ComfyUiRenderEngineError(
        "PROTOCOL_ERROR",
        "ComfyUI returned invalid JSON protocol response",
        { statusCode: res.status }
      );
    }

    if (
      typeof data !== "object" ||
      data === null ||
      !("prompt_id" in data) ||
      (typeof (data as { prompt_id: unknown }).prompt_id !== "string" &&
        typeof (data as { prompt_id: unknown }).prompt_id !== "number")
    ) {
      throw new ComfyUiRenderEngineError("PROTOCOL_ERROR", "ComfyUI response missing prompt_id", {
        statusCode: res.status
      });
    }

    const promptId = String((data as { prompt_id: unknown }).prompt_id).trim();
    if (promptId.length === 0) {
      throw new ComfyUiRenderEngineError(
        "PROTOCOL_ERROR",
        "ComfyUI response contained empty prompt_id",
        { statusCode: res.status }
      );
    }

    return promptId;
  }

  async getHistory(promptId: string): Promise<ComfyUiHistoryEntry | undefined> {
    let res: Response;
    try {
      res = await this.transport.fetch(`${this.baseUrl}/history/${encodeURIComponent(promptId)}`, {
        method: "GET"
      });
    } catch {
      throw new ComfyUiRenderEngineError(
        "HISTORY_REQUEST_FAILED",
        "ComfyUI history request failed",
        { promptId }
      );
    }

    if (!res.ok) {
      throw new ComfyUiRenderEngineError(
        "HISTORY_REQUEST_FAILED",
        "ComfyUI history request failed",
        { promptId, statusCode: res.status }
      );
    }

    let data: unknown;
    try {
      data = await res.json();
    } catch {
      throw new ComfyUiRenderEngineError(
        "PROTOCOL_ERROR",
        "ComfyUI returned invalid JSON protocol response",
        { promptId, statusCode: res.status }
      );
    }

    if (typeof data !== "object" || data === null || Array.isArray(data)) {
      throw new ComfyUiRenderEngineError(
        "PROTOCOL_ERROR",
        "ComfyUI returned invalid history payload format",
        { promptId, statusCode: res.status }
      );
    }

    const payload = data as Record<string, unknown>;
    const entry = payload[promptId];
    if (entry === undefined || entry === null) {
      return undefined;
    }

    return entry as ComfyUiHistoryEntry;
  }

  async unloadModels(): Promise<void> {
    let res: Response;
    try {
      res = await this.transport.fetch(`${this.baseUrl}/free`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json"
        },
        body: JSON.stringify({
          free_memory: true,
          unload_models: true
        })
      });
    } catch {
      throw new ComfyUiRenderEngineError("VRAM_UNLOAD_FAILED", "ComfyUI VRAM unload failed");
    }

    if (!res.ok) {
      throw new ComfyUiRenderEngineError("VRAM_UNLOAD_FAILED", "ComfyUI VRAM unload failed", {
        statusCode: res.status
      });
    }
  }
}
