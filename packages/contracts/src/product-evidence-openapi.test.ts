import { describe, it, expect } from "vitest";
import { readFileSync, existsSync } from "node:fs";
import { resolve } from "node:path";
import { createRequire } from "node:module";
import {
  SafeSourceObjectResponseSchema,
  EvidenceMediaDeliveryResponseSchema,
  InvalidateClaimRequestSchema,
  InvalidateClaimResponseSchema,
  BatchEvidenceDossierSchema,
  ProductSkuResponseSchema,
  ProductBatchResponseSchema,
  BatchFactsRevisionResponseSchema,
  ProductClaimDetailResponseSchema,
  ProductBatchCreationResultResponseSchema,
  ProductSkuListResponseSchema,
  ProductBatchListResponseSchema,
  ProductBatchHistoryResponseSchema,
  EvidenceAssetListResponseSchema,
  EvidenceVerificationEventListResponseSchema,
  CoaReportListResponseSchema,
  ProductClaimListResponseSchema
} from "./index.js";

interface SchemaRef {
  readonly $ref: string;
}

interface MediaTypeObject {
  readonly schema: SchemaRef;
}

interface ResponseObject {
  readonly content?: Record<string, MediaTypeObject>;
}

interface OperationObject {
  readonly responses: Record<string, ResponseObject>;
}

interface SchemaObject {
  readonly example?: unknown;
  readonly properties?: Record<string, unknown>;
}

interface OpenApiDoc {
  readonly paths: Record<string, Record<string, OperationObject>>;
  readonly components: {
    readonly schemas: Record<string, SchemaObject>;
  };
}

const nodeRequire = createRequire(import.meta.url);
const prettierPath = nodeRequire.resolve("prettier");
const prettierRequire = createRequire(prettierPath);
const yaml = prettierRequire("yaml") as { parse: (s: string) => OpenApiDoc };

function getResponseRef(
  doc: OpenApiDoc,
  path: string,
  method: string,
  status: string
): string | undefined {
  return doc.paths[path]?.[method]?.responses[status]?.content?.["application/json"]?.schema.$ref;
}

function hasResponse(doc: OpenApiDoc, path: string, method: string, status: string): boolean {
  return doc.paths[path]?.[method]?.responses[status] !== undefined;
}

function getSchemaProps(doc: OpenApiDoc, schemaName: string): Record<string, unknown> {
  return doc.components.schemas[schemaName]?.properties ?? {};
}

function getSchemaExample(doc: OpenApiDoc, schemaName: string): unknown {
  return doc.components.schemas[schemaName]?.example;
}

describe("Product Evidence OpenAPI Specification & Authoritative Contracts", () => {
  const openApiPath = resolve(process.cwd(), "docs/openapi/product-evidence-v1.yaml");

  it("OpenAPI specification file exists and defines all required routes and schemas", () => {
    expect(existsSync(openApiPath)).toBe(true);
    const content = readFileSync(openApiPath, "utf-8");
    expect(content.length).toBeGreaterThan(1000);

    const doc = yaml.parse(content);

    // Verify key route definitions
    expect(doc.paths["/product-skus"]).toBeDefined();
    expect(doc.paths["/batches"]).toBeDefined();
    expect(doc.paths["/batches/{batchId}/facts"]).toBeDefined();
    expect(doc.paths["/batches/{batchId}/evidence"]).toBeDefined();
    expect(
      doc.paths["/batches/{batchId}/evidence/{evidenceId}/revisions/{revision}/derivative"]
    ).toBeDefined();
    expect(
      doc.paths["/batches/{batchId}/evidence/{evidenceId}/revisions/{revision}/verification-events"]
    ).toBeDefined();
    expect(
      doc.paths["/batches/{batchId}/evidence/{evidenceId}/revisions/{revision}/media"]
    ).toBeDefined();
    expect(doc.paths["/batches/{batchId}/coa-reports"]).toBeDefined();
    expect(doc.paths["/batches/{batchId}/coa-reports/{reportId}/supersede"]).toBeDefined();
    expect(doc.paths["/batches/{batchId}/coa-reports/{reportId}/review"]).toBeDefined();
    expect(doc.paths["/batches/{batchId}/claims"]).toBeDefined();
    expect(doc.paths["/batches/{batchId}/claims/{claimId}/evidence-links"]).toBeDefined();
    expect(doc.paths["/batches/{batchId}/claims/{claimId}/review"]).toBeDefined();
    expect(doc.paths["/batches/{batchId}/claims/{claimId}/invalidate"]).toBeDefined();
    expect(doc.paths["/batches/{batchId}/dossier"]).toBeDefined();
  });

  it("declares object envelope responses and canonical HTTP status codes across routes", () => {
    const content = readFileSync(openApiPath, "utf-8");
    const doc = yaml.parse(content);

    // 7 list / history endpoints use object envelopes
    expect(getResponseRef(doc, "/product-skus", "get", "200")).toBe(
      "#/components/schemas/ProductSkuListResponse"
    );
    expect(getResponseRef(doc, "/batches", "post", "201")).toBe(
      "#/components/schemas/CreateBatchResponse"
    );
    expect(getResponseRef(doc, "/batches", "get", "200")).toBe(
      "#/components/schemas/ProductBatchListResponse"
    );
    expect(getResponseRef(doc, "/batches/{batchId}/facts", "get", "200")).toBe(
      "#/components/schemas/BatchFactsRevisionHistoryResponse"
    );
    expect(getResponseRef(doc, "/batches/{batchId}/evidence", "get", "200")).toBe(
      "#/components/schemas/EvidenceAssetListResponse"
    );
    expect(
      getResponseRef(
        doc,
        "/batches/{batchId}/evidence/{evidenceId}/revisions/{revision}/verification-events",
        "get",
        "200"
      )
    ).toBe("#/components/schemas/EvidenceVerificationEventListResponse");
    expect(getResponseRef(doc, "/batches/{batchId}/coa-reports", "get", "200")).toBe(
      "#/components/schemas/CoaReportListResponse"
    );
    expect(getResponseRef(doc, "/batches/{batchId}/claims", "get", "200")).toBe(
      "#/components/schemas/ProductClaimListResponse"
    );

    // Correct status codes for non-creating operations (200, not 201)
    expect(
      hasResponse(
        doc,
        "/batches/{batchId}/evidence/{evidenceId}/revisions/{revision}/verification-events",
        "post",
        "200"
      )
    ).toBe(true);
    expect(
      hasResponse(
        doc,
        "/batches/{batchId}/evidence/{evidenceId}/revisions/{revision}/verification-events",
        "post",
        "201"
      )
    ).toBe(false);

    expect(hasResponse(doc, "/batches/{batchId}/claims/{claimId}/revisions", "post", "200")).toBe(
      true
    );
    expect(hasResponse(doc, "/batches/{batchId}/claims/{claimId}/revisions", "post", "201")).toBe(
      false
    );
  });

  it("validates SafeSourceObjectResponse directly from OpenAPI example against authoritative schema", () => {
    const content = readFileSync(openApiPath, "utf-8");
    const doc = yaml.parse(content);
    const example = getSchemaExample(doc, "SafeSourceObjectResponse");
    expect(example).toBeDefined();

    const parsed = SafeSourceObjectResponseSchema.safeParse(example);
    expect(parsed.success).toBe(true);

    // Ensure internal storage credentials cannot leak
    const withLeak = {
      ...(example as Record<string, unknown>),
      storageBucket: "internal-s3",
      storageObjectKey: "secret/path"
    };
    const leakParsed = SafeSourceObjectResponseSchema.safeParse(withLeak);
    expect(leakParsed.success).toBe(false);
  });

  it("validates EvidenceMediaDeliveryResponse directly from OpenAPI example against authoritative schema", () => {
    const content = readFileSync(openApiPath, "utf-8");
    const doc = yaml.parse(content);
    const example = getSchemaExample(doc, "EvidenceMediaDeliveryResponse");
    expect(example).toBeDefined();

    const parsed = EvidenceMediaDeliveryResponseSchema.safeParse(example);
    expect(parsed.success).toBe(true);
  });

  it("validates InvalidateClaim request and response schemas directly from OpenAPI examples", () => {
    const content = readFileSync(openApiPath, "utf-8");
    const doc = yaml.parse(content);

    const reqExample = getSchemaExample(doc, "InvalidateClaimRequest");
    expect(reqExample).toBeDefined();
    expect(InvalidateClaimRequestSchema.safeParse(reqExample).success).toBe(true);

    const resExample = getSchemaExample(doc, "InvalidateClaimResponse");
    expect(resExample).toBeDefined();
    expect(InvalidateClaimResponseSchema.safeParse(resExample).success).toBe(true);
  });

  it("validates ProductSkuResponse and ProductBatchResponse directly from OpenAPI examples", () => {
    const content = readFileSync(openApiPath, "utf-8");
    const doc = yaml.parse(content);

    const skuExample = getSchemaExample(doc, "ProductSkuResponse");
    expect(skuExample).toBeDefined();
    expect(ProductSkuResponseSchema.safeParse(skuExample).success).toBe(true);

    const batchExample = getSchemaExample(doc, "ProductBatchResponse");
    expect(batchExample).toBeDefined();
    expect(ProductBatchResponseSchema.safeParse(batchExample).success).toBe(true);

    const factsExample = getSchemaExample(doc, "BatchFactsRevisionResponse");
    expect(factsExample).toBeDefined();
    expect(BatchFactsRevisionResponseSchema.safeParse(factsExample).success).toBe(true);
  });

  it("validates deep BatchEvidenceDossier directly from OpenAPI example against authoritative schema", () => {
    const content = readFileSync(openApiPath, "utf-8");
    const doc = yaml.parse(content);

    const dossierExample = getSchemaExample(doc, "BatchEvidenceDossier");
    expect(dossierExample).toBeDefined();

    const parsed = BatchEvidenceDossierSchema.safeParse(dossierExample);
    expect(parsed.success).toBe(true);
  });

  it("validates ProductClaimDetail and CreateBatchResponse directly from OpenAPI examples", () => {
    const content = readFileSync(openApiPath, "utf-8");
    const doc = yaml.parse(content);

    const claimDetailExample = getSchemaExample(doc, "ProductClaimDetail");
    expect(claimDetailExample).toBeDefined();
    const claimDetailParsed = ProductClaimDetailResponseSchema.safeParse(claimDetailExample);
    expect(claimDetailParsed.success).toBe(true);

    const createBatchExample = getSchemaExample(doc, "CreateBatchResponse");
    expect(createBatchExample).toBeDefined();
    const createBatchParsed =
      ProductBatchCreationResultResponseSchema.safeParse(createBatchExample);
    expect(createBatchParsed.success).toBe(true);
  });

  it("validates list and history response envelopes directly from OpenAPI examples", () => {
    const content = readFileSync(openApiPath, "utf-8");
    const doc = yaml.parse(content);

    const skuListExample = getSchemaExample(doc, "ProductSkuListResponse");
    expect(skuListExample).toBeDefined();
    expect(ProductSkuListResponseSchema.safeParse(skuListExample).success).toBe(true);

    const batchListExample = getSchemaExample(doc, "ProductBatchListResponse");
    expect(batchListExample).toBeDefined();
    expect(ProductBatchListResponseSchema.safeParse(batchListExample).success).toBe(true);

    const factsHistoryExample = getSchemaExample(doc, "BatchFactsRevisionHistoryResponse");
    expect(factsHistoryExample).toBeDefined();
    expect(ProductBatchHistoryResponseSchema.safeParse(factsHistoryExample).success).toBe(true);

    const evidenceListExample = getSchemaExample(doc, "EvidenceAssetListResponse");
    expect(evidenceListExample).toBeDefined();
    expect(EvidenceAssetListResponseSchema.safeParse(evidenceListExample).success).toBe(true);

    const eventListExample = getSchemaExample(doc, "EvidenceVerificationEventListResponse");
    expect(eventListExample).toBeDefined();
    expect(EvidenceVerificationEventListResponseSchema.safeParse(eventListExample).success).toBe(
      true
    );

    const coaListExample = getSchemaExample(doc, "CoaReportListResponse");
    expect(coaListExample).toBeDefined();
    expect(CoaReportListResponseSchema.safeParse(coaListExample).success).toBe(true);

    const claimListExample = getSchemaExample(doc, "ProductClaimListResponse");
    expect(claimListExample).toBeDefined();
    expect(ProductClaimListResponseSchema.safeParse(claimListExample).success).toBe(true);
  });

  it("verifies component schemas exclude non-authoritative fields", () => {
    const content = readFileSync(openApiPath, "utf-8");
    const doc = yaml.parse(content);

    // isArchived does not exist on SKU, Batch, or EvidenceAssetSummary
    expect(getSchemaProps(doc, "ProductSkuResponse")["isArchived"]).toBeUndefined();
    expect(getSchemaProps(doc, "ProductBatchResponse")["isArchived"]).toBeUndefined();
    expect(getSchemaProps(doc, "EvidenceAssetSummary")["isArchived"]).toBeUndefined();

    // EvidenceDerivative uses createdBy/createdAt, not linkedBy/linkedAt
    expect(getSchemaProps(doc, "EvidenceDerivative")["linkedBy"]).toBeUndefined();
    expect(getSchemaProps(doc, "EvidenceDerivative")["linkedAt"]).toBeUndefined();
    expect(getSchemaProps(doc, "EvidenceDerivative")["createdBy"]).toBeDefined();
    expect(getSchemaProps(doc, "EvidenceDerivative")["createdAt"]).toBeDefined();

    // EvidenceVerificationEvent uses canonical fields, not notes/isWithdrawn
    expect(getSchemaProps(doc, "EvidenceVerificationEvent")["notes"]).toBeUndefined();
    expect(getSchemaProps(doc, "EvidenceVerificationEvent")["isWithdrawn"]).toBeUndefined();
    expect(getSchemaProps(doc, "EvidenceVerificationEvent")["outcome"]).toBeDefined();
    expect(getSchemaProps(doc, "EvidenceVerificationEvent")["factScope"]).toBeDefined();

    // CoaReport does not have state or updatedAt
    expect(getSchemaProps(doc, "CoaReport")["state"]).toBeUndefined();
    expect(getSchemaProps(doc, "CoaReport")["updatedAt"]).toBeUndefined();

    // CreateCoaReportRequest does not permit client reportId
    expect(getSchemaProps(doc, "CreateCoaReportRequest")["reportId"]).toBeUndefined();

    // ProductClaimRevision uses assertedBy/assertedAt
    expect(getSchemaProps(doc, "ProductClaimRevision")["createdBy"]).toBeUndefined();
    expect(getSchemaProps(doc, "ProductClaimRevision")["createdAt"]).toBeUndefined();
    expect(getSchemaProps(doc, "ProductClaimRevision")["assertedBy"]).toBeDefined();
    expect(getSchemaProps(doc, "ProductClaimRevision")["assertedAt"]).toBeDefined();
  });
});
