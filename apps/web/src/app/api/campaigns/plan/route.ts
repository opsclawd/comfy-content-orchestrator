import { PlanCampaignStoryboardRequestSchema } from "@cco/contracts";
import { projectErrorForLogging } from "@cco/shared";
import {
  ApiClientError,
  ApiValidationError,
  PlanCampaignStoryboardApiError,
  planCampaignStoryboard
} from "../../../../api/client";

export const dynamic = "force-dynamic";

export async function POST(request: Request): Promise<Response> {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return Response.json({ message: "Invalid JSON payload in request body" }, { status: 400 });
  }

  const parseResult = PlanCampaignStoryboardRequestSchema.safeParse(body);
  if (!parseResult.success) {
    return Response.json(
      {
        code: "VALIDATION_FAILURE",
        message: `Campaign plan failed validation: ${parseResult.error.message}`,
        details: parseResult.error.issues
      },
      { status: 400 }
    );
  }

  try {
    const result = await planCampaignStoryboard(parseResult.data);
    return Response.json(result, { status: 201 });
  } catch (err) {
    if (err instanceof PlanCampaignStoryboardApiError) {
      return Response.json(err.error, { status: err.statusCode });
    }

    if (err instanceof ApiClientError || err instanceof ApiValidationError) {
      const projection = projectErrorForLogging(err);
      console.error("campaign-plan: upstream call failed, returning generic 502", {
        errorType: projection.errorType,
        safeMessage: projection.safeMessage,
        ...(projection.safeStack !== undefined ? { safeStack: projection.safeStack } : {}),
        ...(projection.cause !== undefined ? { cause: projection.cause } : {}),
        ...(err instanceof ApiClientError && err.statusCode !== undefined
          ? { upstreamStatusCode: err.statusCode }
          : {}),
        ...(err instanceof ApiValidationError
          ? { issueCount: Array.isArray(err.issues) ? err.issues.length : undefined }
          : {})
      });
      return Response.json({ message: "Bad Gateway" }, { status: 502 });
    }

    const projection = projectErrorForLogging(err);
    console.error("campaign-plan: unexpected error, returning generic 500", {
      errorType: projection.errorType,
      safeMessage: projection.safeMessage,
      ...(projection.safeStack !== undefined ? { safeStack: projection.safeStack } : {}),
      ...(projection.cause !== undefined ? { cause: projection.cause } : {})
    });
    return Response.json({ message: "Internal Server Error" }, { status: 500 });
  }
}
