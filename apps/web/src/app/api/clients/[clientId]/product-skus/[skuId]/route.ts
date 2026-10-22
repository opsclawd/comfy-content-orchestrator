import {
  forwardProductEvidenceRequest,
  validateRouteParams
} from "../../../../../../api/product-evidence-forwarder";
import { ProductSkuResponseSchema } from "@cco/contracts";

export const dynamic = "force-dynamic";

export interface RouteContext {
  params: Promise<{ clientId: string; skuId: string }>;
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
    upstreamPath: `/api/v1/clients/${encodeURIComponent(params.clientId)}/product-skus/${encodeURIComponent(params.skuId)}`,
    allowedMethods: ["GET"],
    responseSchema: ProductSkuResponseSchema
  });
}

export async function PATCH(request: Request, context: RouteContext): Promise<Response> {
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
    upstreamPath: `/api/v1/clients/${encodeURIComponent(params.clientId)}/product-skus/${encodeURIComponent(params.skuId)}`,
    allowedMethods: ["PATCH"],
    responseSchema: ProductSkuResponseSchema
  });
}
