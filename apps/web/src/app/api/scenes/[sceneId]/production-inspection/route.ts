import { projectErrorForLogging } from "@cco/shared";
import {
  ApiClientError,
  ApiValidationError,
  getSceneProductionInspection
} from "../../../../../api/client";

export const dynamic = "force-dynamic";

const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export interface RouteContext {
  params: Promise<{
    sceneId: string;
  }>;
}

export async function GET(request: Request, context: RouteContext): Promise<Response> {
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

  const url = new URL(request.url);
  const shotPlanId = url.searchParams.get("shotPlanId") ?? undefined;
  if (shotPlanId !== undefined && !UUID_REGEX.test(shotPlanId)) {
    return Response.json(
      {
        code: "VALIDATION_FAILURE",
        message: `Invalid shotPlanId UUID: '${shotPlanId}'`
      },
      { status: 400 }
    );
  }

  try {
    const inspection = await getSceneProductionInspection(sceneId, shotPlanId);
    return Response.json(inspection, { status: 200 });
  } catch (err) {
    if (err instanceof ApiClientError) {
      if (err.statusCode === 404) {
        return Response.json(
          { code: "NOT_FOUND", message: `Scene '${sceneId}' production inspection was not found.` },
          { status: 404 }
        );
      }
      return Response.json({ message: "Bad Gateway" }, { status: 502 });
    }

    if (err instanceof ApiValidationError) {
      return Response.json({ message: "Bad Gateway" }, { status: 502 });
    }

    const projection = projectErrorForLogging(err);
    console.error("production-inspection: unexpected error, returning generic 500", {
      sceneId,
      errorType: projection.errorType,
      safeMessage: projection.safeMessage
    });
    return Response.json({ message: "Internal Server Error" }, { status: 500 });
  }
}
