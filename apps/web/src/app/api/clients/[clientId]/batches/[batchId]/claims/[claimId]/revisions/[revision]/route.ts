import {
  forwardProductEvidenceRequest,
  validateRouteParams
} from "../../../../../../../../../../api/product-evidence-forwarder";
import { ProductClaimContractSchema } from "@cco/contracts";

export const dynamic = "force-dynamic";

export interface RouteContext {
  params: Promise<{ clientId: string; batchId: string; claimId: string; revision: string }>;
}

export async function GET(request: Request, context: RouteContext): Promise<Response> {
  const params = await context.params;
  const paramValidation = validateRouteParams(params);
  if (!paramValidation.valid) {
    return Response.json(
      { error: "VALIDATION_FAILURE", message: paramValidation.error },
      { status: 400, headers: { "Cache-Control": "no-store" } }
    );
  }
  return forwardProductEvidenceRequest(request, {
    clientId: params.clientId,
    params,
    upstreamPath: `/api/v1/clients/${encodeURIComponent(params.clientId)}/batches/${encodeURIComponent(params.batchId)}/claims/${encodeURIComponent(params.claimId)}/revisions/${encodeURIComponent(params.revision)}`,
    allowedMethods: ["GET"],
    responseSchema: ProductClaimContractSchema
  });
}
