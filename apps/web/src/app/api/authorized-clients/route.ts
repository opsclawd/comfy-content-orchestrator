import { ClientListResponseSchema, type ClientListItem } from "@cco/contracts";
import { projectErrorForLogging } from "@cco/shared";
import {
  isDirectorAuthorizedForClient,
  parseDirectorClientMappings
} from "../../../api/director-client-access";
import {
  createWhoisClient,
  resolveReviewerIdentity,
  ReviewerIdentityUnavailableError
} from "../../../api/reviewer-identity";
import { resolveControlApiBaseUrl } from "../../../api/runtime-config";

export const dynamic = "force-dynamic";

const whoisClient = createWhoisClient();

export interface AuthorizedClientsResponse {
  readonly clients: readonly ClientListItem[];
  readonly directorLogin: string;
}

export async function GET(request: Request): Promise<Response> {
  let directorLogin: string;
  try {
    const identity = await resolveReviewerIdentity(request, whoisClient);
    directorLogin = identity.login;
  } catch (err) {
    if (err instanceof ReviewerIdentityUnavailableError) {
      return Response.json(
        {
          error: "AUTHENTICATION_REQUIRED",
          message: "Director identity could not be established."
        },
        { status: 401, headers: { "Cache-Control": "no-store" } }
      );
    }
    const projection = projectErrorForLogging(err);
    console.error("authorized-clients-get: identity error", {
      errorType: projection.errorType,
      safeMessage: projection.safeMessage
    });
    return Response.json(
      { error: "AUTHENTICATION_REQUIRED", message: "Director identity could not be established." },
      { status: 401, headers: { "Cache-Control": "no-store" } }
    );
  }

  let controlApiUrl: string;
  try {
    controlApiUrl = resolveControlApiBaseUrl();
  } catch (err) {
    const projection = projectErrorForLogging(err);
    console.error("authorized-clients-get: runtime config error", {
      errorType: projection.errorType,
      safeMessage: projection.safeMessage
    });
    return Response.json(
      { error: "BAD_GATEWAY", message: "Failed to communicate with Control API." },
      { status: 502, headers: { "Cache-Control": "no-store" } }
    );
  }

  let upstreamRes: Response;
  try {
    upstreamRes = await fetch(`${controlApiUrl}/api/clients`, {
      method: "GET",
      headers: {
        Accept: "application/json"
      },
      cache: "no-store"
    });
  } catch (err) {
    const projection = projectErrorForLogging(err);
    console.error("authorized-clients-get: upstream network error", {
      errorType: projection.errorType,
      safeMessage: projection.safeMessage
    });
    return Response.json(
      { error: "BAD_GATEWAY", message: "Failed to communicate with Control API." },
      { status: 502, headers: { "Cache-Control": "no-store" } }
    );
  }

  if (!upstreamRes.ok) {
    let errorData: unknown;
    try {
      errorData = await upstreamRes.json();
    } catch {
      errorData = {
        error: "UPSTREAM_ERROR",
        message: `Upstream returned status ${upstreamRes.status}`
      };
    }
    return Response.json(errorData, {
      status: upstreamRes.status,
      headers: { "Cache-Control": "no-store" }
    });
  }

  let data: unknown;
  try {
    data = await upstreamRes.json();
  } catch (err) {
    const projection = projectErrorForLogging(err);
    console.error("authorized-clients-get: invalid json from upstream", {
      errorType: projection.errorType,
      safeMessage: projection.safeMessage
    });
    return Response.json(
      { error: "BAD_GATEWAY", message: "Failed to communicate with Control API." },
      { status: 502, headers: { "Cache-Control": "no-store" } }
    );
  }

  const parseResult = ClientListResponseSchema.safeParse(data);
  if (!parseResult.success) {
    const projection = projectErrorForLogging(parseResult.error);
    console.error("authorized-clients-get: upstream data failed schema validation", {
      errorType: projection.errorType,
      safeMessage: projection.safeMessage
    });
    return Response.json(
      { error: "BAD_GATEWAY", message: "Failed to communicate with Control API." },
      { status: 502, headers: { "Cache-Control": "no-store" } }
    );
  }

  const mappings = parseDirectorClientMappings(process.env.REVIEW_HUB_DIRECTOR_CLIENT_MAPPINGS);

  const authorizedClients = parseResult.data.filter((client) =>
    isDirectorAuthorizedForClient(directorLogin, client.clientId, mappings)
  );

  const responseBody: AuthorizedClientsResponse = {
    clients: authorizedClients,
    directorLogin
  };

  return Response.json(responseBody, {
    status: 200,
    headers: { "Cache-Control": "no-store" }
  });
}
