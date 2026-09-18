import { projectErrorForLogging } from "@cco/shared";
import { ApiClientError, ApiValidationError, getCampaign } from "../../../../api/client";

export const dynamic = "force-dynamic";

export interface RouteContext {
  params: Promise<{
    campaignId: string;
  }>;
}

export async function GET(_request: Request, context: RouteContext): Promise<Response> {
  const { campaignId } = await context.params;

  try {
    const campaign = await getCampaign(campaignId);
    return Response.json(campaign, { status: 200 });
  } catch (err) {
    if (err instanceof ApiClientError) {
      if (err.statusCode === 404) {
        return Response.json(
          { code: "NOT_FOUND", message: `Campaign '${campaignId}' was not found.` },
          { status: 404 }
        );
      }
      return Response.json({ message: "Bad Gateway" }, { status: 502 });
    }

    if (err instanceof ApiValidationError) {
      return Response.json({ message: "Bad Gateway" }, { status: 502 });
    }

    const projection = projectErrorForLogging(err);
    console.error("campaign-get: unexpected error, returning generic 500", {
      errorType: projection.errorType,
      safeMessage: projection.safeMessage
    });
    return Response.json({ message: "Internal Server Error" }, { status: 500 });
  }
}
