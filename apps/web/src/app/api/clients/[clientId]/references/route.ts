import { ReferenceRoleSchema } from "@cco/contracts";
import { projectErrorForLogging } from "@cco/shared";
import {
  authorizeDirectorClientSession,
  DirectorAuthenticationRequiredError,
  DirectorClientForbiddenError,
  ReviewHubConfigError
} from "../../../../../api/director-client-access";
import { resolveControlApiBaseUrl } from "../../../../../api/runtime-config";

export const dynamic = "force-dynamic";

const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const SUPPORTED_MIME_TYPES = new Set(["image/png", "image/jpeg", "image/webp"]);
const MAX_IMAGE_BYTES = 10 * 1024 * 1024; // 10 MiB

export interface RouteContext {
  params: Promise<{
    clientId: string;
  }>;
}

function handleAuthError(err: unknown): Response | null {
  if (err instanceof DirectorAuthenticationRequiredError) {
    return Response.json(
      { code: "AUTHENTICATION_REQUIRED", message: err.message },
      { status: 401, headers: { "Cache-Control": "no-store" } }
    );
  }
  if (err instanceof DirectorClientForbiddenError) {
    return Response.json(
      { code: "FORBIDDEN", message: err.message },
      { status: 403, headers: { "Cache-Control": "no-store" } }
    );
  }
  if (err instanceof ReviewHubConfigError) {
    return Response.json(
      { code: "INTERNAL_ERROR", message: err.message },
      { status: 500, headers: { "Cache-Control": "no-store" } }
    );
  }
  return null;
}

export async function GET(request: Request, context: RouteContext): Promise<Response> {
  const { clientId } = await context.params;
  if (!UUID_REGEX.test(clientId)) {
    return Response.json(
      { code: "VALIDATION_FAILURE", message: `Invalid clientId UUID: '${clientId}'` },
      { status: 400, headers: { "Cache-Control": "no-store" } }
    );
  }

  let sessionToken: string;
  try {
    const auth = await authorizeDirectorClientSession(request, clientId);
    sessionToken = auth.sessionToken;
  } catch (err) {
    const handled = handleAuthError(err);
    if (handled) return handled;
    throw err;
  }

  try {
    const controlApiUrl = resolveControlApiBaseUrl();
    const upstreamRes = await fetch(`${controlApiUrl}/api/clients/${clientId}/references`, {
      method: "GET",
      headers: {
        Authorization: `Bearer ${sessionToken}`
      },
      cache: "no-store"
    });

    const data = await upstreamRes.json();
    return Response.json(data, {
      status: upstreamRes.status,
      headers: { "Cache-Control": "no-store" }
    });
  } catch (err) {
    const projection = projectErrorForLogging(err);
    console.error("client-references-get: upstream error", {
      clientId,
      errorType: projection.errorType,
      safeMessage: projection.safeMessage
    });
    return Response.json(
      { code: "BAD_GATEWAY", message: "Failed to communicate with Control API." },
      { status: 502, headers: { "Cache-Control": "no-store" } }
    );
  }
}

class PayloadTooLargeError extends Error {
  constructor(message = "Payload exceeds 10 MiB limit.") {
    super(message);
    this.name = "PayloadTooLargeError";
  }
}

class StreamReadError extends Error {
  constructor(message = "Failed to read request body stream.") {
    super(message);
    this.name = "StreamReadError";
  }
}

async function readBoundedBody(request: Request, maxBytes: number): Promise<Uint8Array> {
  if (!request.body) {
    return new Uint8Array(0);
  }

  const reader = request.body.getReader();
  const chunks: Uint8Array[] = [];
  let totalBytes = 0;

  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) {
        break;
      }
      if (value) {
        totalBytes += value.byteLength;
        if (totalBytes > maxBytes) {
          try {
            await reader.cancel("Payload exceeds maximum allowed size");
          } catch {
            // ignore cancel errors
          }
          throw new PayloadTooLargeError();
        }
        chunks.push(value);
      }
    }
  } catch (err) {
    if (err instanceof PayloadTooLargeError) {
      throw err;
    }
    try {
      await reader.cancel("Stream read error");
    } catch {
      // ignore cancel errors
    }
    throw new StreamReadError(
      `Failed to read request body stream: ${err instanceof Error ? err.message : "Unknown error"}`
    );
  } finally {
    try {
      reader.releaseLock();
    } catch {
      // ignore release error if reader was already cancelled or closed
    }
  }

  const result = new Uint8Array(totalBytes);
  let offset = 0;
  for (const chunk of chunks) {
    result.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return result;
}

export async function POST(request: Request, context: RouteContext): Promise<Response> {
  const { clientId } = await context.params;
  if (!UUID_REGEX.test(clientId)) {
    return Response.json(
      { code: "VALIDATION_FAILURE", message: `Invalid clientId UUID: '${clientId}'` },
      { status: 400, headers: { "Cache-Control": "no-store" } }
    );
  }

  let sessionToken: string;
  try {
    const auth = await authorizeDirectorClientSession(request, clientId);
    sessionToken = auth.sessionToken;
  } catch (err) {
    const handled = handleAuthError(err);
    if (handled) return handled;
    throw err;
  }

  const rawContentType = request.headers.get("content-type");
  const contentType = rawContentType?.split(";")[0]?.trim().toLowerCase();
  if (!contentType || !SUPPORTED_MIME_TYPES.has(contentType)) {
    return Response.json(
      {
        code: "VALIDATION_FAILURE",
        message: `Unsupported Content-Type '${rawContentType ?? ""}'. Must be one of image/png, image/jpeg, image/webp.`
      },
      { status: 400, headers: { "Cache-Control": "no-store" } }
    );
  }

  const roleHeader =
    request.headers.get("x-reference-role") ?? request.headers.get("x-library-role");
  if (!roleHeader || !roleHeader.trim()) {
    return Response.json(
      {
        code: "VALIDATION_FAILURE",
        message: "Missing required 'x-reference-role' header."
      },
      { status: 400, headers: { "Cache-Control": "no-store" } }
    );
  }

  const roleParse = ReferenceRoleSchema.safeParse(roleHeader.trim());
  if (!roleParse.success) {
    return Response.json(
      {
        code: "VALIDATION_FAILURE",
        message: `Invalid 'x-reference-role' header '${roleHeader}'.`
      },
      { status: 400, headers: { "Cache-Control": "no-store" } }
    );
  }

  const contentLengthHeader = request.headers.get("content-length");
  if (contentLengthHeader !== null) {
    const contentLength = Number(contentLengthHeader);
    if (Number.isFinite(contentLength) && contentLength > MAX_IMAGE_BYTES) {
      return Response.json(
        { code: "VALIDATION_FAILURE", message: "Payload exceeds 10 MiB limit." },
        { status: 400, headers: { "Cache-Control": "no-store" } }
      );
    }
  }

  let bodyBuffer: Uint8Array;
  try {
    bodyBuffer = await readBoundedBody(request, MAX_IMAGE_BYTES);
  } catch (err) {
    if (err instanceof PayloadTooLargeError) {
      return Response.json(
        { code: "VALIDATION_FAILURE", message: err.message },
        { status: 400, headers: { "Cache-Control": "no-store" } }
      );
    }
    if (err instanceof StreamReadError) {
      return Response.json(
        { code: "VALIDATION_FAILURE", message: err.message },
        { status: 400, headers: { "Cache-Control": "no-store" } }
      );
    }
    throw err;
  }

  if (bodyBuffer.byteLength === 0) {
    return Response.json(
      { code: "VALIDATION_FAILURE", message: "Request body is empty." },
      { status: 400, headers: { "Cache-Control": "no-store" } }
    );
  }

  const displayName = request.headers.get("x-display-name")?.trim();

  try {
    const controlApiUrl = resolveControlApiBaseUrl();
    const upstreamHeaders: Record<string, string> = {
      Authorization: `Bearer ${sessionToken}`,
      "Content-Type": contentType,
      "x-reference-role": roleParse.data
    };
    if (displayName) {
      upstreamHeaders["X-Display-Name"] = displayName;
    }

    const upstreamRes = await fetch(`${controlApiUrl}/api/clients/${clientId}/references`, {
      method: "POST",
      headers: upstreamHeaders,
      body: bodyBuffer as unknown as BodyInit,
      cache: "no-store"
    });

    const data = await upstreamRes.json();
    return Response.json(data, {
      status: upstreamRes.status,
      headers: { "Cache-Control": "no-store" }
    });
  } catch (err) {
    const projection = projectErrorForLogging(err);
    console.error("client-references-post: upstream error", {
      clientId,
      errorType: projection.errorType,
      safeMessage: projection.safeMessage
    });
    return Response.json(
      { code: "BAD_GATEWAY", message: "Failed to communicate with Control API." },
      { status: 502, headers: { "Cache-Control": "no-store" } }
    );
  }
}
