import {
  ReviewCommandSchema,
  ReviewErrorResponseSchema,
  type ReviewErrorResponse
} from "@cco/contracts";
import {
  ApiClientError,
  ApiValidationError,
  ReviewCommandApiError,
  submitReviewCommand,
  type ReviewerIdentity
} from "../../../../../api/client";
import {
  createWhoisClient,
  resolveReviewerIdentity,
  ReviewerIdentityUnavailableError
} from "../../../../../api/reviewer-identity";

export const dynamic = "force-dynamic";

const whoisClient = createWhoisClient();

export interface RouteContext {
  params: Promise<{
    sceneId: string;
  }>;
}

export async function POST(request: Request, context: RouteContext): Promise<Response> {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    const errorResponse: ReviewErrorResponse = {
      code: "VALIDATION_FAILURE",
      message: "Invalid JSON payload in request body"
    };
    return Response.json(errorResponse, { status: 400 });
  }

  const parseResult = ReviewCommandSchema.safeParse(body);
  if (!parseResult.success) {
    const errorResponse: ReviewErrorResponse = {
      code: "VALIDATION_FAILURE",
      message: `Review command failed validation: ${parseResult.error.message}`,
      details: parseResult.error.issues
    };
    return Response.json(errorResponse, { status: 400 });
  }

  const { sceneId } = await context.params;
  const command = parseResult.data;

  if (sceneId !== command.sceneId) {
    const errorResponse: ReviewErrorResponse = {
      code: "VALIDATION_FAILURE",
      message: `Route sceneId "${sceneId}" does not match command body sceneId "${command.sceneId}"`,
      details: [
        {
          path: ["sceneId"],
          message: `Route sceneId "${sceneId}" does not match command body sceneId "${command.sceneId}"`
        }
      ]
    };
    return Response.json(errorResponse, { status: 400 });
  }

  let reviewerIdentity: ReviewerIdentity;
  try {
    reviewerIdentity = await resolveReviewerIdentity(request, whoisClient);
  } catch (err) {
    if (err instanceof ReviewerIdentityUnavailableError) {
      const errorResponse: ReviewErrorResponse = ReviewErrorResponseSchema.parse({
        code: "AUTHENTICATION_REQUIRED",
        message: "Reviewer identity could not be established."
      });
      return Response.json(errorResponse, { status: 401 });
    }
    throw err;
  }

  try {
    const result = await submitReviewCommand(sceneId, command, reviewerIdentity);
    return Response.json(result, { status: 200 });
  } catch (err) {
    if (err instanceof ReviewCommandApiError) {
      return Response.json(err.error, { status: err.statusCode });
    }

    if (err instanceof ApiClientError || err instanceof ApiValidationError) {
      return Response.json({ message: "Bad Gateway" }, { status: 502 });
    }

    return Response.json({ message: "Internal Server Error" }, { status: 500 });
  }
}
