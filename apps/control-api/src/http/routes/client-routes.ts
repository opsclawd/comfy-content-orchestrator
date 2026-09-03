import type { FastifyInstance, FastifyPluginAsync } from "fastify";
import { ClientResponseSchema, CreateClientRequestSchema } from "@cco/contracts";
import type { ControlApiContainer } from "../types.js";

export interface ClientRoutesOptions {
  readonly container: ControlApiContainer;
}

export const clientRoutes: FastifyPluginAsync<ClientRoutesOptions> = async (
  fastify: FastifyInstance,
  opts: ClientRoutesOptions
): Promise<void> => {
  const { container } = opts;

  fastify.post("/api/clients", async (request, reply) => {
    if (!container.useCases.createClient) {
      throw new Error("CreateClientUseCase is not configured on container.");
    }
    const body = CreateClientRequestSchema.parse(request.body);

    const client = await container.useCases.createClient.execute({
      companyName: body.companyName,
      brandBibleJson: body.brandBibleJson,
      defaultAspectRatio: body.defaultAspectRatio,
      externalProcessingPolicy: body.externalProcessingPolicy
    });

    const response = ClientResponseSchema.parse({
      clientId: client.id,
      companyName: client.companyName,
      brandBibleJson: client.brandBibleJson,
      defaultAspectRatio: client.defaultAspectRatio,
      externalProcessingPolicy: client.externalProcessingPolicy,
      createdAt: client.createdAt,
      updatedAt: client.updatedAt
    });

    return reply.status(201).send(response);
  });
};
