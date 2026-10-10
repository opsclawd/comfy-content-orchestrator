import { projectErrorForLogging } from "@cco/shared";
import {
  ApiClientError,
  ApiValidationError,
  getSceneReviewDetail
} from "../../../../../api/client";

export const dynamic = "force-dynamic";

const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export interface RouteContext {
  params: Promise<{
    sceneId: string;
  }>;
}

export async function GET(_request: Request, context: RouteContext): Promise<Response> {
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
    const detail = await getSceneReviewDetail(sceneId);
    return Response.json(detail, { status: 200 });
  } catch (err) {
    if (err instanceof ApiClientError) {
      if (err.statusCode === 404) {
        return Response.json(
          { code: "NOT_FOUND", message: `Scene '${sceneId}' review detail was not found.` },
          { status: 404 }
        );
      }
      return Response.json({ message: "Bad Gateway" }, { status: 502 });
    }

    if (err instanceof ApiValidationError) {
      return Response.json({ message: "Bad Gateway" }, { status: 502 });
    }

    const projection = projectErrorForLogging(err);
    console.error("scene-review: unexpected error, returning generic 500", {
      sceneId,
      errorType: projection.errorType,
      safeMessage: projection.safeMessage
    });
    return Response.json({ message: "Internal Server Error" }, { status: 500 });
  }
}
