import type { ComfyUiTransport, ComfyUiWebSocket } from "../comfyui-client.js";

export interface RecordedWebSocketCloseCall {
  readonly code?: number | undefined;
  readonly reason?: string | undefined;
}

export class FakeComfyUiWebSocket implements ComfyUiWebSocket {
  static readonly CONNECTING = 0;
  static readonly OPEN = 1;
  static readonly CLOSING = 2;
  static readonly CLOSED = 3;

  readonly CONNECTING = 0;
  readonly OPEN = 1;
  readonly CLOSING = 2;
  readonly CLOSED = 3;

  public readyState: number = FakeComfyUiWebSocket.CONNECTING;
  public readonly url: string;
  public readonly closeCalls: RecordedWebSocketCloseCall[] = [];

  private listeners: {
    open: Array<(event: unknown) => void>;
    message: Array<(event: unknown) => void>;
    error: Array<(event: unknown) => void>;
    close: Array<(event: unknown) => void>;
  } = {
    open: [],
    message: [],
    error: [],
    close: []
  };

  constructor(url: string) {
    this.url = url;
  }

  addEventListener(
    type: "open" | "message" | "error" | "close",
    listener: (event: unknown) => void
  ): void {
    this.listeners[type].push(listener);
  }

  removeEventListener(
    type: "open" | "message" | "error" | "close",
    listener: (event: unknown) => void
  ): void {
    this.listeners[type] = this.listeners[type].filter((l) => l !== listener);
  }

  close(code?: number, reason?: string): void {
    this.readyState = FakeComfyUiWebSocket.CLOSED;
    this.closeCalls.push({ code, reason });
  }

  // Synchronous test helpers
  open(): void {
    this.readyState = FakeComfyUiWebSocket.OPEN;
    const evt = { type: "open" };
    for (const listener of [...this.listeners.open]) {
      listener(evt);
    }
  }

  message(payload: unknown): void {
    const data = typeof payload === "string" ? payload : JSON.stringify(payload);
    const evt = { type: "message", data };
    for (const listener of [...this.listeners.message]) {
      listener(evt);
    }
  }

  error(errorObj: unknown = new Error("Fake WebSocket error")): void {
    const evt = { type: "error", error: errorObj };
    for (const listener of [...this.listeners.error]) {
      listener(evt);
    }
  }

  serverClose(code = 1000, reason = "Normal Closure"): void {
    this.readyState = FakeComfyUiWebSocket.CLOSED;
    const evt = { type: "close", code, reason };
    for (const listener of [...this.listeners.close]) {
      listener(evt);
    }
  }

  getListenerCount(type: "open" | "message" | "error" | "close"): number {
    return this.listeners[type].length;
  }
}

export interface RecordedFetchCall {
  readonly url: string | URL | Request;
  readonly init?: RequestInit | undefined;
}

export class FakeComfyUiFetch {
  readonly calls: RecordedFetchCall[] = [];
  private queuedResponses: Response[] = [];
  private defaultResponseHandler?: (
    url: string | URL | Request,
    init?: RequestInit | undefined
  ) => Promise<Response> | Response;

  queueResponse(response: Response): void {
    this.queuedResponses.push(response);
  }

  queueJsonResponse(data: unknown, init?: ResponseInit): void {
    const body = JSON.stringify(data);
    const headers = new Headers(init?.headers);
    if (!headers.has("Content-Type")) {
      headers.set("Content-Type", "application/json");
    }
    const responseInit: ResponseInit = {
      status: init?.status ?? 200,
      statusText: init?.statusText ?? "OK",
      headers
    };
    const res = new Response(body, responseInit);
    this.queuedResponses.push(res);
  }

  queueTextResponse(text: string, init?: ResponseInit): void {
    const responseInit: ResponseInit = {
      status: init?.status ?? 200,
      statusText: init?.statusText ?? "OK",
      ...(init?.headers !== undefined ? { headers: init.headers } : {})
    };
    const res = new Response(text, responseInit);
    this.queuedResponses.push(res);
  }

  setDefaultResponseHandler(
    handler: (
      url: string | URL | Request,
      init?: RequestInit | undefined
    ) => Promise<Response> | Response
  ): void {
    this.defaultResponseHandler = handler;
  }

  fetch: typeof globalThis.fetch = async (input, init) => {
    this.calls.push({ url: input, init });
    if (this.queuedResponses.length > 0) {
      return this.queuedResponses.shift()!;
    }
    if (this.defaultResponseHandler) {
      return this.defaultResponseHandler(input, init);
    }
    throw new Error(`FakeComfyUiFetch: No response queued for ${String(input)}`);
  };
}

export class FakeComfyUiTransport implements ComfyUiTransport {
  readonly fakeFetch = new FakeComfyUiFetch();
  readonly createdWebSockets: FakeComfyUiWebSocket[] = [];

  get fetch(): typeof globalThis.fetch {
    return this.fakeFetch.fetch;
  }

  createWebSocket = (url: string): FakeComfyUiWebSocket => {
    const ws = new FakeComfyUiWebSocket(url);
    this.createdWebSockets.push(ws);
    return ws;
  };
}
