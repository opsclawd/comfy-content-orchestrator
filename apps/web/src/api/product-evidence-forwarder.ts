import { projectErrorForLogging } from "@cco/shared";
import type { z } from "zod";
import { RegisterEvidenceAssetMultipartMetadataSchema } from "@cco/contracts";
import {
  authorizeDirectorClientSession,
  DirectorAuthenticationRequiredError,
  DirectorClientForbiddenError,
  ReviewHubConfigError
} from "./director-client-access";
import { resolveControlApiBaseUrl } from "./runtime-config";

export const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function validateRouteParams(
  params: Record<string, string | undefined>
): { valid: true } | { valid: false; error: string } {
  for (const [key, val] of Object.entries(params)) {
    if (!val || typeof val !== "string") {
      return { valid: false, error: `Missing route parameter '${key}'` };
    }
    if (key === "revision") {
      if (!/^[1-9][0-9]*$/.test(val)) {
        return {
          valid: false,
          error: `Invalid revision parameter '${val}': must be a positive integer`
        };
      }
    } else if (
      key === "clientId" ||
      key === "skuId" ||
      key === "batchId" ||
      key === "evidenceId" ||
      key === "reportId" ||
      key === "claimId"
    ) {
      if (!UUID_REGEX.test(val)) {
        return { valid: false, error: `Invalid UUID parameter '${key}': '${val}'` };
      }
    }
  }
  return { valid: true };
}

const MAX_BODY_BYTES = 64 * 1024 * 1024; // 64 MiB

export class PayloadTooLargeError extends Error {
  constructor(message = "Payload exceeds 64 MiB limit.") {
    super(message);
    this.name = "PayloadTooLargeError";
  }
}

export class StreamReadError extends Error {
  constructor(message = "Failed to read request body stream.") {
    super(message);
    this.name = "StreamReadError";
  }
}

export function validateUpstreamPath(upstreamPath: string): { valid: boolean; error?: string } {
  if (!upstreamPath.startsWith("/api/v1/clients/")) {
    return { valid: false, error: "Invalid upstream path root" };
  }
  if (upstreamPath.includes("..") || upstreamPath.includes("//")) {
    return { valid: false, error: "Path traversal detected" };
  }
  const segments = upstreamPath.split("/").filter(Boolean);
  if (
    segments.length < 4 ||
    segments[0] !== "api" ||
    segments[1] !== "v1" ||
    segments[2] !== "clients"
  ) {
    return { valid: false, error: "Invalid upstream path root structure" };
  }
  if (!UUID_REGEX.test(segments[3]!)) {
    return { valid: false, error: `Invalid clientId UUID segment: '${segments[3]}'` };
  }
  for (let i = 0; i < segments.length; i++) {
    const seg = segments[i];
    if (!seg) continue;
    const prev = i > 0 ? segments[i - 1] : "";
    if (prev === "clients" || prev === "evidence" || prev === "coa-reports" || prev === "claims") {
      if (!UUID_REGEX.test(seg)) {
        return { valid: false, error: `Invalid UUID segment after ${prev}: '${seg}'` };
      }
    } else if (prev === "product-skus") {
      if (!UUID_REGEX.test(seg)) {
        return { valid: false, error: `Invalid SKU ID segment: '${seg}'` };
      }
    } else if (prev === "batches") {
      if (!UUID_REGEX.test(seg)) {
        return { valid: false, error: `Invalid batch ID segment: '${seg}'` };
      }
    } else if (prev === "revisions") {
      if (!/^[1-9][0-9]*$/.test(seg)) {
        return { valid: false, error: `Invalid revision segment: '${seg}'` };
      }
    }

    if (i > 1 && prev && UUID_REGEX.test(prev)) {
      const parentResource = segments[i - 2];
      if (parentResource === "clients") {
        if (seg !== "product-skus" && seg !== "batches") {
          return { valid: false, error: `Invalid resource after client UUID: '${seg}'` };
        }
      } else if (parentResource === "product-skus") {
        if (seg !== "archive") {
          return { valid: false, error: `Invalid subresource after SKU UUID: '${seg}'` };
        }
      } else if (parentResource === "batches") {
        if (
          seg !== "archive" &&
          seg !== "facts" &&
          seg !== "dossier" &&
          seg !== "evidence" &&
          seg !== "coa-reports" &&
          seg !== "claims"
        ) {
          return { valid: false, error: `Invalid subresource after batch UUID: '${seg}'` };
        }
      } else if (parentResource === "evidence") {
        if (seg !== "revisions") {
          return { valid: false, error: `Invalid subresource after evidence UUID: '${seg}'` };
        }
      } else if (parentResource === "coa-reports") {
        if (seg !== "revisions" && seg !== "supersede" && seg !== "review" && seg !== "archive") {
          return { valid: false, error: `Invalid subresource after CoA report UUID: '${seg}'` };
        }
      } else if (parentResource === "claims") {
        if (
          seg !== "revisions" &&
          seg !== "evidence-links" &&
          seg !== "review" &&
          seg !== "invalidate"
        ) {
          return { valid: false, error: `Invalid subresource after claim UUID: '${seg}'` };
        }
      }
    }

    if (i > 1 && prev && /^[0-9]+$/.test(prev) && segments[i - 2] === "revisions") {
      const grandParent = segments[i - 4];
      if (grandParent === "evidence") {
        if (
          seg !== "derivative" &&
          seg !== "derivatives" &&
          seg !== "verification-events" &&
          seg !== "media"
        ) {
          return { valid: false, error: `Invalid subresource after evidence revision: '${seg}'` };
        }
      } else if (grandParent === "coa-reports" || grandParent === "claims") {
        return {
          valid: false,
          error: `No subresource allowed after ${grandParent} revision: '${seg}'`
        };
      }
    }
  }
  return { valid: true };
}

function extractMultipartMetadata(buffer: Uint8Array, contentType: string): unknown {
  const boundaryMatch = contentType.match(/boundary=([^;]+)/i);
  if (!boundaryMatch) {
    throw new Error("Missing boundary in multipart Content-Type header");
  }
  const boundary = boundaryMatch[1]!.trim().replace(/^"(.*)"$/, "$1");
  const text = new TextDecoder().decode(buffer);
  const parts = text.split(`--${boundary}`);
  for (const part of parts) {
    if (part.includes('name="metadata"') || part.includes("name='metadata'")) {
      const headerEndIndex = part.indexOf("\r\n\r\n");
      const altHeaderEndIndex = part.indexOf("\n\n");
      const splitIdx =
        headerEndIndex !== -1
          ? headerEndIndex + 4
          : altHeaderEndIndex !== -1
            ? altHeaderEndIndex + 2
            : -1;
      if (splitIdx !== -1) {
        const body = part.slice(splitIdx).trim();
        return JSON.parse(body);
      }
    }
  }
  return null;
}

export async function readBoundedBody(
  request: Request,
  maxBytes: number = MAX_BODY_BYTES
): Promise<Uint8Array> {
  if (!request.body) {
    return new Uint8Array(0);
  }

  const reader = request.body.getReader();
  const chunks: Uint8Array[] = [];
  let totalBytes = 0;

  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
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
      // ignore release error
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

export function handleAuthError(err: unknown): Response | null {
  if (err instanceof DirectorAuthenticationRequiredError) {
    return Response.json(
      { error: "AUTHENTICATION_REQUIRED", message: err.message },
      { status: 401, headers: { "Cache-Control": "no-store" } }
    );
  }
  if (err instanceof DirectorClientForbiddenError) {
    return Response.json(
      { error: "FORBIDDEN", message: err.message },
      { status: 403, headers: { "Cache-Control": "no-store" } }
    );
  }
  if (err instanceof ReviewHubConfigError) {
    return Response.json(
      { error: "INTERNAL_ERROR", message: err.message },
      { status: 500, headers: { "Cache-Control": "no-store" } }
    );
  }
  return null;
}

export interface ForwardOptions {
  readonly clientId: string;
  readonly upstreamPath: string;
  readonly allowedMethods?: readonly string[];
  readonly maxBytes?: number;
  readonly params?: Record<string, string | undefined>;
  readonly responseSchema?: z.ZodType<unknown>;
}

export async function forwardProductEvidenceRequest(
  request: Request,
  options: ForwardOptions
): Promise<Response> {
  const { clientId, upstreamPath, allowedMethods, maxBytes = MAX_BODY_BYTES } = options;

  if (options.params) {
    const paramValidation = validateRouteParams(options.params);
    if (!paramValidation.valid) {
      return Response.json(
        { error: "VALIDATION_FAILURE", message: paramValidation.error },
        { status: 400, headers: { "Cache-Control": "no-store" } }
      );
    }
  }

  if (!UUID_REGEX.test(clientId)) {
    return Response.json(
      { error: "VALIDATION_FAILURE", message: `Invalid clientId UUID: '${clientId}'` },
      { status: 400, headers: { "Cache-Control": "no-store" } }
    );
  }

  const pathCheck = validateUpstreamPath(upstreamPath);
  if (!pathCheck.valid) {
    return Response.json(
      { error: "VALIDATION_FAILURE", message: pathCheck.error ?? "Invalid upstream path." },
      { status: 400, headers: { "Cache-Control": "no-store" } }
    );
  }

  if (allowedMethods && !allowedMethods.includes(request.method)) {
    return Response.json(
      {
        error: "METHOD_NOT_ALLOWED",
        message: `Method ${request.method} not allowed on this route.`
      },
      { status: 405, headers: { "Cache-Control": "no-store" } }
    );
  }

  let sessionToken: string;
  let directorLogin: string;
  try {
    const auth = await authorizeDirectorClientSession(request, clientId);
    sessionToken = auth.sessionToken;
    directorLogin = auth.directorLogin;
  } catch (err) {
    const handled = handleAuthError(err);
    if (handled) return handled;
    throw err;
  }

  let controlApiUrl: string;
  try {
    controlApiUrl = resolveControlApiBaseUrl();
  } catch (err) {
    const projection = projectErrorForLogging(err);
    console.error("forwardProductEvidenceRequest: runtime config error", {
      errorType: projection.errorType,
      safeMessage: projection.safeMessage
    });
    return Response.json(
      { error: "BAD_GATEWAY", message: "Failed to communicate with Control API." },
      { status: 502, headers: { "Cache-Control": "no-store" } }
    );
  }

  const incomingUrl = new URL(request.url);
  const targetUrl = `${controlApiUrl}${upstreamPath}${incomingUrl.search}`;

  const headers: Record<string, string> = {
    Authorization: `Bearer ${sessionToken}`,
    "tailscale-user-login": directorLogin,
    Accept: "application/json"
  };

  let body: BodyInit | undefined;
  if (request.method !== "GET" && request.method !== "HEAD") {
    const contentType = request.headers.get("content-type");
    if (contentType) {
      headers["Content-Type"] = contentType;
    }

    try {
      const buffer = await readBoundedBody(request, maxBytes);
      if (buffer.byteLength > 0) {
        body = buffer as unknown as BodyInit;
      }
      if (contentType?.includes("multipart/form-data") && upstreamPath.endsWith("/evidence")) {
        try {
          const metadata = extractMultipartMetadata(buffer, contentType);
          if (!metadata) {
            return Response.json(
              {
                error: "VALIDATION_FAILURE",
                message: "Multipart request missing required 'metadata' part."
              },
              { status: 400, headers: { "Cache-Control": "no-store" } }
            );
          }
          const parsedMetadata = RegisterEvidenceAssetMultipartMetadataSchema.safeParse(metadata);
          if (!parsedMetadata.success) {
            return Response.json(
              {
                error: "VALIDATION_FAILURE",
                message: "Invalid multipart evidence metadata",
                issues: parsedMetadata.error.issues
              },
              { status: 400, headers: { "Cache-Control": "no-store" } }
            );
          }
        } catch (parseErr) {
          return Response.json(
            {
              error: "VALIDATION_FAILURE",
              message:
                parseErr instanceof Error ? parseErr.message : "Failed to parse multipart metadata."
            },
            { status: 400, headers: { "Cache-Control": "no-store" } }
          );
        }
      }
    } catch (err) {
      if (err instanceof PayloadTooLargeError) {
        return Response.json(
          { error: "PAYLOAD_TOO_LARGE", message: err.message },
          { status: 413, headers: { "Cache-Control": "no-store" } }
        );
      }
      return Response.json(
        {
          error: "VALIDATION_FAILURE",
          message: err instanceof Error ? err.message : "Stream read error"
        },
        { status: 400, headers: { "Cache-Control": "no-store" } }
      );
    }
  }

  try {
    const upstreamRes = await fetch(targetUrl, {
      method: request.method,
      headers,
      ...(body !== undefined ? { body } : {}),
      cache: "no-store"
    });

    let responseData: unknown;
    const contentTypeHeader = upstreamRes.headers.get("content-type") || "";
    if (contentTypeHeader.includes("application/json")) {
      try {
        responseData = await upstreamRes.json();
      } catch {
        return Response.json(
          {
            error: "BAD_GATEWAY",
            message: "Upstream returned status with unparseable JSON."
          },
          { status: 502, headers: { "Cache-Control": "no-store" } }
        );
      }
      if (!upstreamRes.ok) {
        const errorObj =
          typeof responseData === "object" && responseData !== null
            ? (responseData as Record<string, unknown>)
            : null;
        const rawErrCode =
          errorObj && typeof errorObj.error === "string"
            ? errorObj.error
            : errorObj && typeof errorObj.code === "string"
              ? errorObj.code
              : null;
        // Only trust a recognized, well-formed structured error shape (an
        // explicit `error` or `code` string). When neither is present we
        // cannot tell whether `details`/`issues` are safe, recognized
        // diagnostic data or an arbitrary/unexpected upstream payload, so
        // those fields must not be forwarded to the browser verbatim.
        const isRecognizedErrorShape = rawErrCode !== null;
        const errCode = rawErrCode ?? "UPSTREAM_ERROR";
        const errMsg =
          isRecognizedErrorShape && typeof errorObj?.message === "string"
            ? errorObj.message
            : `Upstream service returned error status ${upstreamRes.status}`;

        responseData = {
          error: errCode,
          message: errMsg,
          ...(isRecognizedErrorShape && errorObj?.details !== undefined
            ? { details: errorObj.details }
            : {}),
          ...(isRecognizedErrorShape && errorObj?.issues !== undefined
            ? { issues: errorObj.issues }
            : {})
        };
      } else if (options.responseSchema) {
        const parsed = options.responseSchema.safeParse(responseData);
        if (!parsed.success) {
          return Response.json(
            {
              error: "BAD_GATEWAY",
              message: "Upstream returned malformed response not matching contract schema.",
              issues: parsed.error.issues
            },
            { status: 502, headers: { "Cache-Control": "no-store" } }
          );
        }
        responseData = parsed.data;
      }
    } else {
      return Response.json(
        {
          error: "BAD_GATEWAY",
          message: "Failed to communicate with Control API."
        },
        { status: 502, headers: { "Cache-Control": "no-store" } }
      );
    }

    return Response.json(responseData, {
      status: upstreamRes.status,
      headers: { "Cache-Control": "no-store" }
    });
  } catch (err) {
    const projection = projectErrorForLogging(err);
    console.error("forwardProductEvidenceRequest: network error", {
      clientId,
      targetUrl,
      errorType: projection.errorType,
      safeMessage: projection.safeMessage
    });
    return Response.json(
      { error: "BAD_GATEWAY", message: "Failed to communicate with Control API." },
      { status: 502, headers: { "Cache-Control": "no-store" } }
    );
  }
}
