import { ClientListResponseSchema } from "@cco/contracts";
import { projectErrorForLogging } from "@cco/shared";
import { resolveControlApiBaseUrl } from "../../../api/runtime-config";

export const dynamic = "force-dynamic";

export async function GET(): Promise<Response> {
  let controlApiUrl: string;
  try {
    controlApiUrl = resolveControlApiBaseUrl();
  } catch (err) {
    const projection = projectErrorForLogging(err);
    console.error("clients-get: runtime config error", {
      errorType: projection.errorType,
      safeMessage: projection.safeMessage
    });
    return Response.json(
      { code: "BAD_GATEWAY", message: "Failed to communicate with Control API." },
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
    console.error("clients-get: upstream network error", {
      errorType: projection.errorType,
      safeMessage: projection.safeMessage
    });
    return Response.json(
      { code: "BAD_GATEWAY", message: "Failed to communicate with Control API." },
      { status: 502, headers: { "Cache-Control": "no-store" } }
    );
  }

  if (!upstreamRes.ok) {
    let errorData: unknown;
    try {
      errorData = await upstreamRes.json();
    } catch {
      errorData = {
        code: "UPSTREAM_ERROR",
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
    console.error("clients-get: invalid json from upstream", {
      errorType: projection.errorType,
      safeMessage: projection.safeMessage
    });
    return Response.json(
      { code: "BAD_GATEWAY", message: "Failed to communicate with Control API." },
      { status: 502, headers: { "Cache-Control": "no-store" } }
    );
  }

  const parseResult = ClientListResponseSchema.safeParse(data);
  if (!parseResult.success) {
    const projection = projectErrorForLogging(parseResult.error);
    console.error("clients-get: upstream data failed schema validation", {
      errorType: projection.errorType,
      safeMessage: projection.safeMessage
    });
    return Response.json(
      { code: "BAD_GATEWAY", message: "Failed to communicate with Control API." },
      { status: 502, headers: { "Cache-Control": "no-store" } }
    );
  }

  return Response.json(parseResult.data, {
    status: 200,
    headers: { "Cache-Control": "no-store" }
  });
}
