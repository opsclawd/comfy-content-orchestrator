import { timingSafeEqual } from "node:crypto";
import type { FastifyInstance, FastifyPluginAsync } from "fastify";
import type { UnitOfWorkContext } from "@cco/application";
import type { ControlApiContainer, ReviewerIdentityResolver } from "../types.js";
import { AcceptanceAssemblyManifestSchema, type AcceptanceAssemblyManifest } from "@cco/contracts";

export interface AcceptanceAssemblyRoutesOptions {
  readonly container: ControlApiContainer;
  readonly dispatchConfig?:
    | {
        readonly resolveWorkerStagingToken?: ((workerId: string) => string | undefined) | undefined;
      }
    | undefined;
  readonly reviewerIdentityResolver?: ReviewerIdentityResolver | undefined;
}

function timingSafeTokenMatch(expected: string, actual: string | undefined): boolean {
  if (!actual) {
    return false;
  }
  const expectedBuf = Buffer.from(expected, "utf8");
  const actualBuf = Buffer.from(actual, "utf8");
  if (expectedBuf.length !== actualBuf.length) {
    timingSafeEqual(expectedBuf, expectedBuf);
    return false;
  }
  return timingSafeEqual(expectedBuf, actualBuf);
}

export const acceptanceAssemblyRoutes: FastifyPluginAsync<AcceptanceAssemblyRoutesOptions> = async (
  fastify: FastifyInstance,
  opts: AcceptanceAssemblyRoutesOptions
): Promise<void> => {
  const { container, dispatchConfig } = opts;

  function verifyWorkerAuthForJob(
    job: { workerId?: string | undefined },
    headers: Record<string, unknown>
  ): void {
    if (job.workerId && dispatchConfig?.resolveWorkerStagingToken) {
      const expectedToken = dispatchConfig.resolveWorkerStagingToken(job.workerId);
      if (expectedToken) {
        const presentedToken = headers["x-worker-staging-token"] as string | undefined;
        if (!timingSafeTokenMatch(expectedToken, presentedToken)) {
          const authErr = new Error(
            "Staging worker authorization failed: invalid or missing x-worker-staging-token"
          );
          (authErr as { statusCode?: number }).statusCode = 401;
          throw authErr;
        }
      }
    }
  }

  // 1. Claim next job
  fastify.post<{
    Body: {
      workerId: string;
      leaseDurationMs?: number;
    };
  }>("/api/acceptance-assembly-jobs/claim", async (request, reply) => {
    const { workerId, leaseDurationMs } = request.body ?? {};
    if (!workerId || typeof workerId !== "string" || workerId.trim().length === 0) {
      return reply.status(400).send({
        code: "VALIDATION_ERROR",
        message: "workerId is required to claim an acceptance assembly job"
      });
    }

    const expectedToken = dispatchConfig?.resolveWorkerStagingToken?.(workerId);
    if (expectedToken) {
      const presentedToken = request.headers["x-worker-staging-token"] as string | undefined;
      if (!timingSafeTokenMatch(expectedToken, presentedToken)) {
        return reply.status(401).send({
          code: "UNAUTHORIZED",
          message: "Staging worker authorization failed: invalid or missing x-worker-staging-token"
        });
      }
    }

    const job = await container.dependencies.uow.execute(async (ctx: UnitOfWorkContext) => {
      if (!ctx.acceptanceAssemblyJobs) {
        throw new Error("UnitOfWorkContext.acceptanceAssemblyJobs is not configured");
      }
      return await ctx.acceptanceAssemblyJobs.claim(workerId, leaseDurationMs ?? 60_000);
    });

    if (!job) {
      return reply.status(204).send();
    }

    return reply.status(200).send(job);
  });

  // 2. Start job
  fastify.post<{
    Params: { jobId: string };
    Body: { leaseToken: string };
  }>("/api/acceptance-assembly-jobs/:jobId/start", async (request, reply) => {
    const { jobId } = request.params;
    const { leaseToken } = request.body ?? {};
    if (!leaseToken) {
      return reply.status(400).send({
        code: "VALIDATION_ERROR",
        message: "leaseToken is required to start an acceptance assembly job"
      });
    }

    try {
      await container.dependencies.uow.execute(async (ctx: UnitOfWorkContext) => {
        if (!ctx.acceptanceAssemblyJobs) {
          throw new Error("UnitOfWorkContext.acceptanceAssemblyJobs is not configured");
        }
        const job = await ctx.acceptanceAssemblyJobs.findById(jobId);
        if (!job) {
          throw new Error(`Acceptance assembly job ${jobId} not found`);
        }
        verifyWorkerAuthForJob(job, request.headers);
        await ctx.acceptanceAssemblyJobs.start(jobId, leaseToken);
      });
      return reply.status(200).send({ status: "started" });
    } catch (err) {
      const msg = (err as Error).message;
      if ((err as { statusCode?: number }).statusCode === 401) {
        return reply.status(401).send({ code: "UNAUTHORIZED", message: msg });
      }
      if (
        msg.includes("lease token mismatch") ||
        msg.includes("expired") ||
        msg.includes("leased/rendering")
      ) {
        return reply.status(409).send({ code: "LEASE_SUPERSEDED", message: msg });
      }
      if (msg.includes("not found")) {
        return reply.status(404).send({ code: "NOT_FOUND", message: msg });
      }
      throw err;
    }
  });

  // 3. Heartbeat job
  fastify.post<{
    Params: { jobId: string };
    Body: { leaseToken: string; leaseDurationMs?: number };
  }>("/api/acceptance-assembly-jobs/:jobId/heartbeat", async (request, reply) => {
    const { jobId } = request.params;
    const { leaseToken, leaseDurationMs } = request.body ?? {};
    if (!leaseToken) {
      return reply.status(400).send({
        code: "VALIDATION_ERROR",
        message: "leaseToken is required to heartbeat an acceptance assembly job"
      });
    }

    try {
      await container.dependencies.uow.execute(async (ctx: UnitOfWorkContext) => {
        if (!ctx.acceptanceAssemblyJobs) {
          throw new Error("UnitOfWorkContext.acceptanceAssemblyJobs is not configured");
        }
        const job = await ctx.acceptanceAssemblyJobs.findById(jobId);
        if (!job) {
          throw new Error(`Acceptance assembly job ${jobId} not found`);
        }
        verifyWorkerAuthForJob(job, request.headers);
        await ctx.acceptanceAssemblyJobs.heartbeat(jobId, leaseToken, leaseDurationMs ?? 60_000);
      });
      return reply.status(200).send({ status: "heartbeated" });
    } catch (err) {
      const msg = (err as Error).message;
      if ((err as { statusCode?: number }).statusCode === 401) {
        return reply.status(401).send({ code: "UNAUTHORIZED", message: msg });
      }
      if (
        msg.includes("lease token mismatch") ||
        msg.includes("expired") ||
        msg.includes("active")
      ) {
        return reply.status(409).send({ code: "LEASE_SUPERSEDED", message: msg });
      }
      if (msg.includes("not found")) {
        return reply.status(404).send({ code: "NOT_FOUND", message: msg });
      }
      throw err;
    }
  });

  // 4. Complete job
  fastify.post<{
    Params: { jobId: string };
    Body: {
      leaseToken: string;
      outputManifestId: string;
      acceptanceManifest: AcceptanceAssemblyManifest;
    };
  }>("/api/acceptance-assembly-jobs/:jobId/complete", async (request, reply) => {
    const { jobId } = request.params;
    const { leaseToken, outputManifestId, acceptanceManifest } = request.body ?? {};
    if (!leaseToken || !outputManifestId || !acceptanceManifest) {
      return reply.status(400).send({
        code: "VALIDATION_ERROR",
        message: "leaseToken, outputManifestId, and acceptanceManifest are required"
      });
    }

    const parsedManifest = AcceptanceAssemblyManifestSchema.parse(acceptanceManifest);

    try {
      await container.dependencies.uow.execute(async (ctx: UnitOfWorkContext) => {
        if (
          !ctx.acceptanceAssemblyManifests ||
          !ctx.acceptanceAssemblyJobs ||
          !ctx.operatorAcceptanceRuns
        ) {
          throw new Error("UnitOfWorkContext acceptance repositories not configured");
        }
        const job = await ctx.acceptanceAssemblyJobs.findById(jobId);
        if (!job) {
          throw new Error(`Acceptance assembly job ${jobId} not found`);
        }
        verifyWorkerAuthForJob(job, request.headers);

        // First validate and complete the job lease to prevent expired workers from writing manifests
        await ctx.acceptanceAssemblyJobs.complete(jobId, outputManifestId, leaseToken);
        await ctx.acceptanceAssemblyManifests.saveManifest(parsedManifest);
        await ctx.operatorAcceptanceRuns.updateRunStatus(
          parsedManifest.acceptanceRunId,
          "completed",
          jobId
        );
      });

      return reply.status(200).send({ status: "completed" });
    } catch (err) {
      const msg = (err as Error).message;
      if ((err as { statusCode?: number }).statusCode === 401) {
        return reply.status(401).send({ code: "UNAUTHORIZED", message: msg });
      }
      if (
        msg.includes("lease token mismatch") ||
        msg.includes("expired") ||
        msg.includes("superseded") ||
        msg.includes("different lease")
      ) {
        return reply.status(409).send({ code: "LEASE_SUPERSEDED", message: msg });
      }
      if (msg.includes("not found")) {
        return reply.status(404).send({ code: "NOT_FOUND", message: msg });
      }
      throw err;
    }
  });

  // 5. Fail job
  fastify.post<{
    Params: { jobId: string };
    Body: {
      leaseToken: string;
      acceptanceRunId: string;
      error: string;
    };
  }>("/api/acceptance-assembly-jobs/:jobId/fail", async (request, reply) => {
    const { jobId } = request.params;
    const { leaseToken, acceptanceRunId, error } = request.body ?? {};
    if (!leaseToken || !acceptanceRunId) {
      return reply.status(400).send({
        code: "VALIDATION_ERROR",
        message: "leaseToken and acceptanceRunId are required"
      });
    }

    try {
      await container.dependencies.uow.execute(async (ctx: UnitOfWorkContext) => {
        if (!ctx.acceptanceAssemblyJobs || !ctx.operatorAcceptanceRuns) {
          throw new Error("UnitOfWorkContext acceptance repositories not configured");
        }
        const job = await ctx.acceptanceAssemblyJobs.findById(jobId);
        if (!job) {
          throw new Error(`Acceptance assembly job ${jobId} not found`);
        }
        verifyWorkerAuthForJob(job, request.headers);

        await ctx.acceptanceAssemblyJobs.fail(jobId, error ?? "Unknown error", leaseToken);
        await ctx.operatorAcceptanceRuns.updateRunStatus(acceptanceRunId, "failed", jobId);
      });

      return reply.status(200).send({ status: "failed" });
    } catch (err) {
      const msg = (err as Error).message;
      if ((err as { statusCode?: number }).statusCode === 401) {
        return reply.status(401).send({ code: "UNAUTHORIZED", message: msg });
      }
      if (
        msg.includes("lease token mismatch") ||
        msg.includes("expired") ||
        msg.includes("active")
      ) {
        return reply.status(409).send({ code: "LEASE_SUPERSEDED", message: msg });
      }
      if (msg.includes("not found")) {
        return reply.status(404).send({ code: "NOT_FOUND", message: msg });
      }
      throw err;
    }
  });
};
