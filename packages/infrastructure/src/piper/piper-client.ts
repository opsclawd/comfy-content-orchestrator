import { PiperSynthesisError } from "./piper-error.js";

export interface PiperSynthesisRequest {
  readonly text: string;
  readonly voice?: string | undefined;
  readonly lengthScale?: number | undefined;
  readonly timeoutMs?: number | undefined;
  readonly signal?: AbortSignal | undefined;
}

export interface PiperClientTransport {
  readonly fetch: typeof globalThis.fetch;
}

export interface PiperHttpClientOptions {
  readonly timeoutMs?: number | undefined;
}

function executeWithSignal<T>(
  operation: () => Promise<T>,
  signal: AbortSignal,
  timeoutMessage: string
): Promise<T> {
  if (signal.aborted) {
    return Promise.reject(signal.reason ?? new Error(timeoutMessage));
  }
  return new Promise<T>((resolve, reject) => {
    let settled = false;
    const onAbort = () => {
      if (settled) return;
      settled = true;
      signal.removeEventListener("abort", onAbort);
      reject(signal.reason ?? new Error(timeoutMessage));
    };
    signal.addEventListener("abort", onAbort, { once: true });

    operation().then(
      (res) => {
        if (settled) return;
        settled = true;
        signal.removeEventListener("abort", onAbort);
        resolve(res);
      },
      (err) => {
        if (settled) return;
        settled = true;
        signal.removeEventListener("abort", onAbort);
        reject(err);
      }
    );
  });
}

export class PiperHttpClient {
  readonly baseUrl: string;
  readonly timeoutMs: number;
  private readonly transport: PiperClientTransport;

  constructor(
    baseUrl?: string,
    transport?: Partial<PiperClientTransport>,
    options?: PiperHttpClientOptions | number
  ) {
    const rawUrl = (baseUrl ?? "http://localhost:5000").trim();
    const urlWithScheme =
      rawUrl.startsWith("http://") || rawUrl.startsWith("https://") ? rawUrl : `http://${rawUrl}`;

    const parsed = new URL(urlWithScheme);
    const pathname = parsed.pathname.replace(/\/+$/, "");
    this.baseUrl = `${parsed.protocol}//${parsed.host}${pathname}`;

    this.transport = {
      fetch: transport?.fetch ?? globalThis.fetch.bind(globalThis)
    };

    const timeoutCandidate =
      typeof options === "number"
        ? options
        : (options?.timeoutMs ?? (transport as Record<string, unknown> | undefined)?.["timeoutMs"]);
    this.timeoutMs =
      typeof timeoutCandidate === "number" &&
      Number.isFinite(timeoutCandidate) &&
      timeoutCandidate > 0
        ? timeoutCandidate
        : 30_000;
  }

  async synthesize(request: PiperSynthesisRequest): Promise<Uint8Array> {
    const body: Record<string, unknown> = {
      text: request.text
    };
    if (request.voice !== undefined) {
      body.voice = request.voice;
    }
    if (request.lengthScale !== undefined) {
      if (
        typeof request.lengthScale !== "number" ||
        !Number.isFinite(request.lengthScale) ||
        request.lengthScale <= 0
      ) {
        throw new PiperSynthesisError(
          "INVALID_INPUT",
          `lengthScale must be a positive finite number, received ${request.lengthScale}`
        );
      }
      body.length_scale = request.lengthScale;
    }

    const timeoutMs =
      typeof request.timeoutMs === "number" &&
      Number.isFinite(request.timeoutMs) &&
      request.timeoutMs > 0
        ? request.timeoutMs
        : this.timeoutMs;

    const controller = new AbortController();
    let timedOut = false;
    const timeoutId = setTimeout(() => {
      timedOut = true;
      controller.abort(new Error(`Piper synthesis request timed out after ${timeoutMs}ms`));
    }, timeoutMs);

    const onCallerAbort = () => {
      controller.abort(request.signal?.reason ?? new Error("Aborted by caller"));
    };
    if (request.signal) {
      if (request.signal.aborted) {
        controller.abort(request.signal.reason ?? new Error("Aborted by caller"));
      } else {
        request.signal.addEventListener("abort", onCallerAbort, { once: true });
      }
    }

    let res: Response;
    let onSignalAbort: (() => void) | undefined;
    try {
      try {
        res = await executeWithSignal(
          () =>
            this.transport.fetch(`${this.baseUrl}/synthesize`, {
              method: "POST",
              headers: {
                "Content-Type": "application/json"
              },
              body: JSON.stringify(body),
              signal: controller.signal
            }),
          controller.signal,
          `Piper synthesis request timed out after ${timeoutMs}ms`
        );
      } catch (err) {
        if (timedOut || controller.signal.aborted) {
          throw new PiperSynthesisError(
            "SERVICE_UNAVAILABLE",
            `Piper synthesis request timed out after ${timeoutMs}ms`,
            { baseUrl: this.baseUrl, details: err }
          );
        }
        throw new PiperSynthesisError(
          "SERVICE_UNAVAILABLE",
          `Piper synthesis service unavailable at ${this.baseUrl}`,
          { baseUrl: this.baseUrl, details: err }
        );
      }

      onSignalAbort = () => {
        if (res.body && typeof res.body.cancel === "function") {
          res.body.cancel().catch(() => {});
        }
      };
      controller.signal.addEventListener("abort", onSignalAbort, { once: true });

      if (!res.ok) {
        try {
          if (res.body && typeof res.body.cancel === "function") {
            await executeWithSignal(
              () => res.body!.cancel(),
              controller.signal,
              `Piper synthesis timed out cancelling response body after ${timeoutMs}ms`
            );
          } else if (typeof res.arrayBuffer === "function") {
            await executeWithSignal(
              () => res.arrayBuffer(),
              controller.signal,
              `Piper synthesis timed out draining response body after ${timeoutMs}ms`
            );
          }
        } catch {
          // Drain/cancel errors must not mask the underlying HTTP status error
        }

        if (res.status === 404) {
          throw new PiperSynthesisError(
            "VOICE_NOT_FOUND",
            `Piper voice not found (HTTP 404) at ${this.baseUrl}`,
            { baseUrl: this.baseUrl, statusCode: 404, voiceId: request.voice }
          );
        }
        throw new PiperSynthesisError(
          "INFERENCE_FAILED",
          `Piper synthesis failed with status ${res.status}`,
          { baseUrl: this.baseUrl, statusCode: res.status }
        );
      }

      let arrayBuffer: ArrayBuffer;
      try {
        arrayBuffer = await executeWithSignal(
          () => res.arrayBuffer(),
          controller.signal,
          `Piper synthesis timed out reading response body after ${timeoutMs}ms`
        );
      } catch (err) {
        if (timedOut || controller.signal.aborted) {
          throw new PiperSynthesisError(
            "SERVICE_UNAVAILABLE",
            `Piper synthesis timed out reading response body after ${timeoutMs}ms`,
            { baseUrl: this.baseUrl, details: err }
          );
        }
        throw new PiperSynthesisError(
          "DECODE_FAILED",
          "Failed to read Piper audio response buffer",
          {
            baseUrl: this.baseUrl,
            details: err
          }
        );
      }

      const audio = new Uint8Array(arrayBuffer);
      if (audio.length === 0) {
        throw new PiperSynthesisError("DECODE_FAILED", "Piper returned empty response body", {
          baseUrl: this.baseUrl
        });
      }

      return audio;
    } finally {
      clearTimeout(timeoutId);
      if (onSignalAbort) {
        controller.signal.removeEventListener("abort", onSignalAbort);
      }
      if (request.signal) {
        request.signal.removeEventListener("abort", onCallerAbort);
      }
    }
  }
}
