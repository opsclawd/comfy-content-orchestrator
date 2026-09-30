import { CreateShotPlanVariationRequestSchema } from "@cco/contracts";
import { projectErrorForLogging } from "@cco/shared";
import {
  ApiClientError,
  ApiValidationError,
  CreateShotPlanVariationApiError,
  createShotPlanVariation
} from "../../../../../../api/client";

export const dynamic = "force-dynamic";

const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export interface RouteContext {
  params: Promise<{
    sceneId: string;
  }>;
}

export async function POST(request: Request, context: RouteContext): Promise<Response> {
  let body: unknown;
  try {
    const text = await request.text();
    body = text.trim() === "" ? {} : JSON.parse(text);
  } catch {
    return Response.json(
      {
        code: "VALIDATION_FAILURE",
        message: "Invalid JSON payload in request body"
      },
      { status: 400 }
    );
  }

  const parseResult = CreateShotPlanVariationRequestSchema.safeParse(body ?? {});
  if (!parseResult.success) {
    return Response.json(
      {
        code: "VALIDATION_FAILURE",
        message: `Shot plan variation request failed validation: ${parseResult.error.message}`,
        details: parseResult.error.issues
      },
      { status: 400 }
    );
  }

  const { sceneId } = await context.params;
  if (!UUID_REGEX.test(sceneId)) {
    return Response.json(
      {
        code: "VALIDATION_FAILURE",
        message: `Invalid sceneId UUID: '${sceneId}'`
      },
      { status: 400 }
    );
  }

  try {
    const result = await createShotPlanVariation(sceneId, parseResult.data);
    return Response.json(result, { status: 200 });
  } catch (err) {
    if (err instanceof CreateShotPlanVariationApiError) {
      return Response.json(err.error, { status: err.statusCode });
    }

    if (err instanceof ApiClientError || err instanceof ApiValidationError) {
      const projection = projectErrorForLogging(err);
      console.error("shot-plans/variations: upstream call failed, returning generic 502", {
        sceneId,
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
    console.error("shot-plans/variations: unexpected error, returning generic 500", {
      sceneId,
      errorType: projection.errorType,
      safeMessage: projection.safeMessage,
      ...(projection.safeStack !== undefined ? { safeStack: projection.safeStack } : {}),
      ...(projection.cause !== undefined ? { cause: projection.cause } : {})
    });
    return Response.json({ message: "Internal Server Error" }, { status: 500 });
  }
}
