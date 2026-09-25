import { UpdateReferenceAssetRoleSchema } from "@cco/contracts";
import { projectErrorForLogging } from "@cco/shared";
import {
  authorizeDirectorClientSession,
  DirectorAuthenticationRequiredError,
  DirectorClientForbiddenError,
  ReviewHubConfigError
} from "../../../../../../api/director-client-access";
import { resolveControlApiBaseUrl } from "../../../../../../api/runtime-config";

export const dynamic = "force-dynamic";

const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export interface ItemRouteContext {
  params: Promise<{
    clientId: string;
    referenceId: string;
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

export async function DELETE(request: Request, context: ItemRouteContext): Promise<Response> {
  const { clientId, referenceId } = await context.params;
  if (!UUID_REGEX.test(clientId) || !UUID_REGEX.test(referenceId)) {
    return Response.json(
      { code: "VALIDATION_FAILURE", message: "Invalid UUID format in route parameters." },
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
    const upstreamRes = await fetch(
      `${controlApiUrl}/api/clients/${clientId}/references/${referenceId}`,
      {
        method: "DELETE",
        headers: {
          Authorization: `Bearer ${sessionToken}`
        },
        cache: "no-store"
      }
    );

    if (upstreamRes.status === 204) {
      return new Response(null, { status: 204, headers: { "Cache-Control": "no-store" } });
    }

    const data = await upstreamRes.json().catch(() => ({}));
    return Response.json(data, {
      status: upstreamRes.status,
      headers: { "Cache-Control": "no-store" }
    });
  } catch (err) {
    const projection = projectErrorForLogging(err);
    console.error("client-reference-delete: upstream error", {
      clientId,
      referenceId,
      errorType: projection.errorType,
      safeMessage: projection.safeMessage
    });
    return Response.json(
      { code: "BAD_GATEWAY", message: "Failed to communicate with Control API." },
      { status: 502, headers: { "Cache-Control": "no-store" } }
    );
  }
}

export async function PATCH(request: Request, context: ItemRouteContext): Promise<Response> {
  const { clientId, referenceId } = await context.params;
  if (!UUID_REGEX.test(clientId) || !UUID_REGEX.test(referenceId)) {
    return Response.json(
      { code: "VALIDATION_FAILURE", message: "Invalid UUID format in route parameters." },
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

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return Response.json(
      { code: "VALIDATION_FAILURE", message: "Invalid JSON payload in request body" },
      { status: 400, headers: { "Cache-Control": "no-store" } }
    );
  }

  const parseResult = UpdateReferenceAssetRoleSchema.safeParse(body);
  if (!parseResult.success) {
    return Response.json(
      { code: "VALIDATION_FAILURE", message: parseResult.error.message },
      { status: 400, headers: { "Cache-Control": "no-store" } }
    );
  }

  try {
    const controlApiUrl = resolveControlApiBaseUrl();
    const upstreamRes = await fetch(
      `${controlApiUrl}/api/clients/${clientId}/references/${referenceId}`,
      {
        method: "PATCH",
        headers: {
          Authorization: `Bearer ${sessionToken}`,
          "Content-Type": "application/json"
        },
        body: JSON.stringify(parseResult.data),
        cache: "no-store"
      }
    );

    const data = await upstreamRes.json();
    return Response.json(data, {
      status: upstreamRes.status,
      headers: { "Cache-Control": "no-store" }
    });
  } catch (err) {
    const projection = projectErrorForLogging(err);
    console.error("client-reference-patch: upstream error", {
      clientId,
      referenceId,
      errorType: projection.errorType,
      safeMessage: projection.safeMessage
    });
    return Response.json(
      { code: "BAD_GATEWAY", message: "Failed to communicate with Control API." },
      { status: 502, headers: { "Cache-Control": "no-store" } }
    );
  }
}
