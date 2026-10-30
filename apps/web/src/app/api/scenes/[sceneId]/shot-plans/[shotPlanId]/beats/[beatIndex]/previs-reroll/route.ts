import { RerollPrevisBeatRequestSchema } from "@cco/contracts";
import { projectErrorForLogging } from "@cco/shared";
import {
  ApiClientError,
  ApiValidationError,
  RerollPrevisBeatApiError,
  rerollPrevisBeat
} from "../../../../../../../../../api/client";

export const dynamic = "force-dynamic";

const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export interface RouteContext {
  params: Promise<{
    sceneId: string;
    shotPlanId: string;
    beatIndex: string;
  }>;
}

export async function POST(request: Request, context: RouteContext): Promise<Response> {
  let body: unknown;
  try {
    body = JSON.parse(await request.text());
  } catch {
    return Response.json(
      { code: "VALIDATION_FAILURE", message: "Invalid JSON payload in request body" },
      { status: 400 }
    );
  }

  const parseResult = RerollPrevisBeatRequestSchema.safeParse(body);
  if (!parseResult.success) {
    return Response.json(
      {
        code: "VALIDATION_FAILURE",
        message: `Previs re-roll request failed validation: ${parseResult.error.message}`
      },
      { status: 400 }
    );
  }

  const { sceneId, shotPlanId, beatIndex: beatIndexRaw } = await context.params;
  const beatIndex = Number(beatIndexRaw);
  if (!UUID_REGEX.test(sceneId) || !UUID_REGEX.test(shotPlanId)) {
    return Response.json(
      { code: "VALIDATION_FAILURE", message: "Invalid sceneId or shotPlanId UUID" },
      { status: 400 }
    );
  }
  if (!Number.isInteger(beatIndex) || beatIndex < 1) {
    return Response.json(
      { code: "VALIDATION_FAILURE", message: `Invalid beatIndex: '${beatIndexRaw}'` },
      { status: 400 }
    );
  }

  try {
    const result = await rerollPrevisBeat({ sceneId, shotPlanId, beatIndex }, parseResult.data);
    return Response.json(result, { status: 202 });
  } catch (err) {
    if (err instanceof RerollPrevisBeatApiError) {
      return Response.json(err.error, { status: err.statusCode });
    }
    const projection = projectErrorForLogging(err);
    console.error("previs-reroll: upstream call failed", {
      sceneId,
      shotPlanId,
      beatIndex,
      errorType: projection.errorType,
      safeMessage: projection.safeMessage
    });
    if (err instanceof ApiClientError || err instanceof ApiValidationError) {
      return Response.json({ message: "Bad Gateway" }, { status: 502 });
    }
    return Response.json({ message: "Internal Server Error" }, { status: 500 });
  }
}
