import type { FastifyInstance, FastifyPluginAsync } from "fastify";
import { evaluateStorageWatermark } from "@cco/domain";
import type { ControlApiContainer } from "../types.js";

export interface MetricsRoutesOptions {
  readonly container: ControlApiContainer;
}

export const metricsRoutes: FastifyPluginAsync<MetricsRoutesOptions> = async (
  fastify: FastifyInstance,
  opts: MetricsRoutesOptions
): Promise<void> => {
  const { container } = opts;

  fastify.get("/metrics", async (_request, reply) => {
    const telemetry = container.dependencies.storageTelemetry;
    const registry = container.dependencies.storageMetricsRegistry;

    if (!telemetry || !registry) {
      return reply.status(503).send({
        code: "STORAGE_TELEMETRY_UNAVAILABLE",
        message: "Storage telemetry is unavailable."
      });
    }

    try {
      const snapshot = await telemetry.getStorageTelemetry();
      const watermarkState = evaluateStorageWatermark(snapshot.usedBytes, snapshot.totalBytes);
      registry.recordTelemetry(snapshot, watermarkState);
      const formatted = registry.formatPrometheusMetrics();

      return reply.status(200).type("text/plain; version=0.0.4; charset=utf-8").send(formatted);
    } catch {
      return reply.status(503).send({
        code: "STORAGE_TELEMETRY_UNAVAILABLE",
        message: "Storage telemetry is unavailable."
      });
    }
  });
};
