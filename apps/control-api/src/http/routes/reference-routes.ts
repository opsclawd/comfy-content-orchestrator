import type { FastifyInstance, FastifyPluginAsync, FastifyRequest } from "fastify";
import {
  ReferenceAssetListResponseSchema,
  ReferenceAssetResponseSchema,
  ReferenceRoleSchema,
  UpdateReferenceAssetRoleSchema,
  type ReferenceAssetListResponse,
  type ReferenceAssetResponse,
  type ReferenceRole
} from "@cco/contracts";
import type { ReferenceAssetId } from "@cco/domain";
import {
  ImageValidationError,
  type ClientContextResolver,
  type SupportedReferenceMimeType
} from "@cco/application";
import { ClientAuthenticationRequiredError, ClientForbiddenError } from "../errors.js";
import type { ControlApiAppOptions, ControlApiContainer } from "../types.js";

export interface ReferenceRoutesOptions {
  readonly container: ControlApiContainer;
  readonly appOptions?: ControlApiAppOptions | undefined;
  readonly clientContextResolver?: ClientContextResolver<FastifyRequest> | undefined;
}

export const clientReferenceParamsSchema = {
  params: {
    type: "object",
    required: ["clientId"],
    properties: {
      clientId: {
        type: "string",
        format: "uuid"
      }
    },
    additionalProperties: false
  }
} as const;

export const clientReferenceItemParamsSchema = {
  params: {
    type: "object",
    required: ["clientId", "referenceId"],
    properties: {
      clientId: {
        type: "string",
        format: "uuid"
      },
      referenceId: {
        type: "string",
        format: "uuid"
      }
    },
    additionalProperties: false
  }
} as const;

const SUPPORTED_MIME_TYPES = new Set<string>(["image/png", "image/jpeg", "image/webp"]);

async function authenticateClient(
  resolver: ClientContextResolver<FastifyRequest> | undefined,
  request: FastifyRequest,
  routeClientId: string
): Promise<string> {
  if (!resolver) {
    throw new ClientAuthenticationRequiredError(
      "Client authentication resolver is not configured."
    );
  }
  const principalClientId = await resolver.resolve(request);
  if (!principalClientId) {
    throw new ClientAuthenticationRequiredError("Client authentication required.");
  }
  if (principalClientId !== routeClientId) {
    throw new ClientForbiddenError(
      `Authenticated client '${principalClientId}' cannot access resources for client '${routeClientId}'.`
    );
  }
  return principalClientId;
}

function hasControlCharacters(text: string): boolean {
  for (let i = 0; i < text.length; i++) {
    const code = text.charCodeAt(i);
    if ((code >= 0 && code <= 31) || code === 127) {
      return true;
    }
  }
  return false;
}

function parseDisplayNameHeader(rawHeader: string | string[] | undefined): string | undefined {
  if (rawHeader === undefined) {
    return undefined;
  }
  const headerValue = Array.isArray(rawHeader) ? rawHeader[0] : rawHeader;
  if (typeof headerValue !== "string" || headerValue.trim().length === 0) {
    throw new ImageValidationError(
      "Invalid 'x-display-name' header: must be non-empty printable text."
    );
  }
  const trimmed = headerValue.trim();
  if (Buffer.byteLength(trimmed, "utf8") > 255) {
    throw new ImageValidationError("Invalid 'x-display-name' header: exceeds 255 UTF-8 bytes.");
  }
  if (hasControlCharacters(trimmed)) {
    throw new ImageValidationError(
      "Invalid 'x-display-name' header: must contain printable characters only."
    );
  }
  return trimmed;
}

function parseReferenceRoleHeader(rawHeader: string | string[] | undefined): ReferenceRole {
  if (rawHeader === undefined) {
    throw new ImageValidationError(
      "Missing required 'x-reference-role' header: must be one of 'subject_identity', 'product', 'location', 'style', 'composition'."
    );
  }
  const headerValue = Array.isArray(rawHeader) ? rawHeader[0] : rawHeader;
  if (typeof headerValue !== "string" || headerValue.trim().length === 0) {
    throw new ImageValidationError("Invalid 'x-reference-role' header: must be non-empty.");
  }
  const trimmed = headerValue.trim();
  const parseResult = ReferenceRoleSchema.safeParse(trimmed);
  if (!parseResult.success) {
    throw new ImageValidationError(
      `Invalid 'x-reference-role' header '${trimmed}': must be one of 'subject_identity', 'product', 'location', 'style', 'composition'.`
    );
  }
  return parseResult.data;
}

export const referenceRoutes: FastifyPluginAsync<ReferenceRoutesOptions> = async (
  fastify: FastifyInstance,
  opts: ReferenceRoutesOptions
): Promise<void> => {
  const { container, appOptions } = opts;
  const resolver = opts.clientContextResolver ?? appOptions?.clientContextResolver;

  fastify.addContentTypeParser(
    ["image/png", "image/jpeg", "image/webp"],
    { parseAs: "buffer", bodyLimit: 10 * 1024 * 1024 },
    (_req, body, done) => {
      done(null, body);
    }
  );

  fastify.post<{
    Params: { clientId: string };
  }>(
    "/api/clients/:clientId/references",
    {
      schema: clientReferenceParamsSchema,
      bodyLimit: 10 * 1024 * 1024
    },
    async (request, reply) => {
      const clientId = await authenticateClient(resolver, request, request.params.clientId);

      const rawContentType = request.headers["content-type"];
      const contentType = rawContentType?.split(";")[0]?.trim();
      if (!contentType || !SUPPORTED_MIME_TYPES.has(contentType)) {
        throw new ImageValidationError(
          `Unsupported Content-Type '${rawContentType ?? ""}'. Must be one of image/png, image/jpeg, image/webp.`
        );
      }

      if (!Buffer.isBuffer(request.body) && !(request.body instanceof Uint8Array)) {
        throw new ImageValidationError("Request body must be a binary image buffer.");
      }

      const bodyBuffer = Buffer.isBuffer(request.body) ? request.body : Buffer.from(request.body);
      if (bodyBuffer.length === 0) {
        throw new ImageValidationError("Request body is empty.");
      }

      const displayName = parseDisplayNameHeader(request.headers["x-display-name"]);
      const roleHeader = request.headers["x-reference-role"] ?? request.headers["x-library-role"];
      const libraryRole = parseReferenceRoleHeader(roleHeader);

      if (!container.useCases.uploadReferenceAsset) {
        throw new Error("UploadReferenceAssetUseCase is not configured on container.");
      }

      const result = await container.useCases.uploadReferenceAsset.execute({
        clientId,
        body: bodyBuffer,
        declaredMimeType: contentType as SupportedReferenceMimeType,
        displayName,
        libraryRole
      });

      const response: ReferenceAssetResponse = ReferenceAssetResponseSchema.parse(result);
      return reply.status(201).send(response);
    }
  );

  fastify.get<{
    Params: { clientId: string };
  }>(
    "/api/clients/:clientId/references",
    {
      schema: clientReferenceParamsSchema
    },
    async (request, reply) => {
      const clientId = await authenticateClient(resolver, request, request.params.clientId);

      if (!container.useCases.listClientReferences) {
        throw new Error("ListClientReferencesUseCase is not configured on container.");
      }

      const result = await container.useCases.listClientReferences.execute({ clientId });
      const response: ReferenceAssetListResponse = ReferenceAssetListResponseSchema.parse(result);
      return reply.status(200).send(response);
    }
  );

  fastify.delete<{
    Params: { clientId: string; referenceId: string };
  }>(
    "/api/clients/:clientId/references/:referenceId",
    {
      schema: clientReferenceItemParamsSchema
    },
    async (request, reply) => {
      const clientId = await authenticateClient(resolver, request, request.params.clientId);

      if (!container.useCases.archiveReferenceAsset) {
        throw new Error("ArchiveReferenceAssetUseCase is not configured on container.");
      }

      await container.useCases.archiveReferenceAsset.execute({
        clientId,
        referenceId: request.params.referenceId as ReferenceAssetId
      });

      return reply.status(204).send();
    }
  );

  fastify.patch<{
    Params: { clientId: string; referenceId: string };
    Body: unknown;
  }>(
    "/api/clients/:clientId/references/:referenceId",
    {
      schema: clientReferenceItemParamsSchema
    },
    async (request, reply) => {
      const clientId = await authenticateClient(resolver, request, request.params.clientId);

      if (!container.useCases.updateReferenceAssetRole) {
        throw new Error("UpdateReferenceAssetRoleUseCase is not configured on container.");
      }

      const bodyParseResult = UpdateReferenceAssetRoleSchema.safeParse(request.body);
      if (!bodyParseResult.success) {
        throw new ImageValidationError(
          `Invalid payload for role update: ${bodyParseResult.error.message}`
        );
      }

      const result = await container.useCases.updateReferenceAssetRole.execute({
        clientId,
        referenceId: request.params.referenceId as ReferenceAssetId,
        role: bodyParseResult.data.libraryRole
      });

      const response: ReferenceAssetResponse = ReferenceAssetResponseSchema.parse(result);
      return reply.status(200).send(response);
    }
  );
};
