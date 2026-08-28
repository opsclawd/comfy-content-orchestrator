import type { ComfyUiTransport } from "./comfyui-client.js";

export interface ComfyUiOutput {
  readonly bytes: Uint8Array;
  readonly contentType?: string | undefined;
}

export interface ComfyUiOutputReader {
  readOutput(outputObjectKey: string): Promise<ComfyUiOutput>;
}

export interface ComfyUiOutputReaderErrorContext {
  readonly outputObjectKey?: string | undefined;
  readonly statusCode?: number | undefined;
  readonly cause?: unknown;
}

export class ComfyUiOutputReaderError extends Error {
  override readonly name = "ComfyUiOutputReaderError";
  readonly outputObjectKey?: string | undefined;
  readonly statusCode?: number | undefined;
  readonly context: ComfyUiOutputReaderErrorContext;

  constructor(message: string, context: ComfyUiOutputReaderErrorContext = {}) {
    super(message, context.cause !== undefined ? { cause: context.cause } : undefined);
    this.outputObjectKey = context.outputObjectKey;
    this.statusCode = context.statusCode;
    this.context = context;
  }
}

export interface HttpComfyUiOutputReaderOptions {
  readonly baseUrl?: string | undefined;
  readonly transport?: Partial<ComfyUiTransport> | { fetch?: typeof globalThis.fetch } | undefined;
}

function hasControlCharacters(str: string): boolean {
  for (let i = 0; i < str.length; i++) {
    const code = str.charCodeAt(i);
    if ((code >= 0 && code <= 31) || code === 127) {
      return true;
    }
  }
  return false;
}

function parseAndValidateOutputKey(outputObjectKey: string): {
  filename: string;
  subfolder?: string | undefined;
} {
  if (typeof outputObjectKey !== "string" || outputObjectKey.trim().length === 0) {
    throw new ComfyUiOutputReaderError("Invalid ComfyUI output key: key cannot be empty", {
      outputObjectKey
    });
  }

  if (outputObjectKey.includes("?") || outputObjectKey.includes("#")) {
    throw new ComfyUiOutputReaderError(
      "Invalid ComfyUI output key: query parameters or fragments are not allowed",
      { outputObjectKey }
    );
  }

  if (hasControlCharacters(outputObjectKey)) {
    throw new ComfyUiOutputReaderError(
      "Invalid ComfyUI output key: control characters or null bytes are not allowed",
      { outputObjectKey }
    );
  }

  const normalizedKey = outputObjectKey.replace(/\\/g, "/");

  if (normalizedKey.startsWith("/") || /^[a-zA-Z]:\//.test(normalizedKey)) {
    throw new ComfyUiOutputReaderError(
      "Invalid ComfyUI output key: absolute paths are not allowed",
      { outputObjectKey }
    );
  }

  if (normalizedKey.endsWith("/")) {
    throw new ComfyUiOutputReaderError("Invalid ComfyUI output key: key must specify a filename", {
      outputObjectKey
    });
  }

  const segments = normalizedKey.split("/");
  for (const segment of segments) {
    if (segment.length === 0 || segment.trim().length === 0) {
      throw new ComfyUiOutputReaderError("Invalid ComfyUI output key: empty path segment", {
        outputObjectKey
      });
    }
    if (segment === "." || segment === "..") {
      throw new ComfyUiOutputReaderError(
        "Invalid ComfyUI output key: path traversal is not allowed",
        { outputObjectKey }
      );
    }
    if (segment.trim() !== segment) {
      throw new ComfyUiOutputReaderError(
        "Invalid ComfyUI output key: path segment has leading or trailing whitespace",
        { outputObjectKey }
      );
    }
  }

  const filename = segments[segments.length - 1]!;
  const subfolder = segments.slice(0, -1).join("/");

  return {
    filename,
    subfolder: subfolder.length > 0 ? subfolder : undefined
  };
}

export class HttpComfyUiOutputReader implements ComfyUiOutputReader {
  private readonly baseUrl: string;
  private readonly fetchFn: typeof globalThis.fetch;

  constructor(
    baseUrlOrOptions?: string | HttpComfyUiOutputReaderOptions,
    transport?: Partial<ComfyUiTransport> | { fetch?: typeof globalThis.fetch }
  ) {
    let rawBaseUrl: string;
    let effectiveTransport:
      Partial<ComfyUiTransport> | { fetch?: typeof globalThis.fetch } | undefined;

    if (typeof baseUrlOrOptions === "string") {
      rawBaseUrl = baseUrlOrOptions;
      effectiveTransport = transport;
    } else if (typeof baseUrlOrOptions === "object" && baseUrlOrOptions !== null) {
      rawBaseUrl = baseUrlOrOptions.baseUrl ?? "http://127.0.0.1:8188";
      effectiveTransport = baseUrlOrOptions.transport ?? transport;
    } else {
      rawBaseUrl = "http://127.0.0.1:8188";
      effectiveTransport = transport;
    }

    const trimmed = rawBaseUrl.trim();
    const urlWithScheme =
      trimmed.startsWith("http://") || trimmed.startsWith("https://")
        ? trimmed
        : `http://${trimmed}`;

    const parsed = new URL(urlWithScheme);
    const pathname = parsed.pathname.replace(/\/+$/, "");
    this.baseUrl = `${parsed.protocol}//${parsed.host}${pathname}`;

    this.fetchFn = effectiveTransport?.fetch ?? globalThis.fetch.bind(globalThis);
  }

  async readOutput(outputObjectKey: string): Promise<ComfyUiOutput> {
    const parsedKey = parseAndValidateOutputKey(outputObjectKey);

    const url = new URL(`${this.baseUrl}/view`);
    url.searchParams.set("filename", parsedKey.filename);
    url.searchParams.set("subfolder", parsedKey.subfolder ?? "");
    url.searchParams.set("type", "output");

    let response: Response;
    try {
      response = await this.fetchFn(url.toString(), {
        method: "GET"
      });
    } catch (cause) {
      throw new ComfyUiOutputReaderError("ComfyUI output fetch failed due to transport error", {
        outputObjectKey,
        cause
      });
    }

    if (!response.ok) {
      throw new ComfyUiOutputReaderError(
        `ComfyUI output fetch failed with HTTP status ${response.status}`,
        {
          outputObjectKey,
          statusCode: response.status
        }
      );
    }

    let arrayBuffer: ArrayBuffer;
    try {
      arrayBuffer = await response.arrayBuffer();
    } catch (cause) {
      throw new ComfyUiOutputReaderError("Failed to read ComfyUI output response body", {
        outputObjectKey,
        statusCode: response.status,
        cause
      });
    }

    const bytes = new Uint8Array(arrayBuffer);
    const rawContentType = response.headers.get("content-type");
    const contentType =
      rawContentType !== null && rawContentType.trim().length > 0 ? rawContentType : undefined;

    return {
      bytes,
      contentType
    };
  }
}
