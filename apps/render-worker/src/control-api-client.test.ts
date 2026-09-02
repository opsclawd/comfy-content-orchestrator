import { describe, expect, it, vi } from "vitest";
import { StorageAdmissionError } from "@cco/application";
import type { JobId, LeaseToken, RenderJob, SceneId } from "@cco/domain";
import {
  ControlApiClientError,
  createControlApiClient,
  createDeliveryAssemblyControlApiClient,
  HttpControlApiClient
} from "./control-api-client.js";

const sampleJobId = "11111111-1111-4111-8111-111111111111" as JobId;
const sampleSceneId = "33333333-3333-4333-8333-333333333333" as SceneId;
const sampleLeaseToken = "22222222-2222-4222-8222-222222222222" as LeaseToken;

const sampleJob: RenderJob = {
  jobId: sampleJobId,
  sceneId: sampleSceneId,
  jobKind: "candidate",
  status: "leased",
  workflowTemplate: "candidate-preview",
  injectedPayload: { prompt: "test prompt" },
  workerId: "worker-1",
  leaseToken: sampleLeaseToken,
  leaseExpiresAt: new Date("2026-08-27T10:00:00.000Z"),
  retryCount: 0,
  maxRetries: 3,
  errorTrace: null,
  createdAt: new Date("2026-08-27T08:00:00.000Z"),
  updatedAt: new Date("2026-08-27T08:00:00.000Z")
};

describe("ControlApiClient", () => {
  describe("defer", () => {
    it("defer posts the current token and reason to the job defer route", async () => {
      const mockFetch = vi.fn().mockResolvedValue({
        ok: true,
        status: 200,
        json: async () => ({
          outcome: "deferred",
          job: {
            ...sampleJob,
            status: "queued",
            workerId: null,
            leaseExpiresAt: null
          }
        })
      });

      const client = createControlApiClient({
        baseUrl: "http://localhost:3000",
        fetch: mockFetch
      });

      const reason = "Storage admission denied at write time";
      const result = await client.defer(sampleJobId, sampleLeaseToken, reason);

      expect(mockFetch).toHaveBeenCalledTimes(1);
      expect(mockFetch).toHaveBeenCalledWith(
        `http://localhost:3000/api/jobs/${sampleJobId}/defer`,
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Accept: "application/json"
          },
          body: JSON.stringify({
            leaseToken: sampleLeaseToken,
            reason
          })
        }
      );

      expect(result).toEqual({
        outcome: "deferred",
        job: expect.objectContaining({
          jobId: sampleJobId,
          status: "queued"
        })
      });
    });

    it("defer preserves already-applied and fencing outcomes", async () => {
      // 1. Replay 200 already_applied
      const mockFetchReplay = vi.fn().mockResolvedValue({
        ok: true,
        status: 200,
        json: async () => ({
          outcome: "already_applied",
          job: {
            ...sampleJob,
            status: "queued"
          }
        })
      });

      const clientReplay = new HttpControlApiClient("http://localhost:3000", mockFetchReplay);
      const replayResult = await clientReplay.defer(
        sampleJobId,
        sampleLeaseToken,
        "Replay defer reason"
      );

      expect(replayResult).toEqual({
        outcome: "already_applied",
        job: expect.objectContaining({
          jobId: sampleJobId,
          status: "queued"
        })
      });

      // 2. Superseded 409
      const mockFetchSuperseded = vi.fn().mockResolvedValue({
        ok: false,
        status: 409,
        json: async () => ({
          code: "LEASE_SUPERSEDED",
          message: "The job lease has been superseded."
        })
      });

      const clientSuperseded = new HttpControlApiClient(
        "http://localhost:3000",
        mockFetchSuperseded
      );
      const supersededResult = await clientSuperseded.defer(
        sampleJobId,
        sampleLeaseToken,
        "Stale token"
      );

      expect(supersededResult).toEqual({
        outcome: "superseded"
      });

      // 3. Missing job 404
      const mockFetchNotFound = vi.fn().mockResolvedValue({
        ok: false,
        status: 404,
        json: async () => ({
          code: "NOT_FOUND",
          message: "Job not found."
        })
      });

      const clientNotFound = new HttpControlApiClient("http://localhost:3000", mockFetchNotFound);
      const notFoundResult = await clientNotFound.defer(sampleJobId, sampleLeaseToken, "Job gone");

      expect(notFoundResult).toEqual({
        outcome: "not_found"
      });
    });
  });

  describe("complete with storage admission decoding", () => {
    it("completion 507 reconstructs StorageAdmissionError context", async () => {
      const operations = [
        "candidate_upload",
        "proxy_upload",
        "delivery_write",
        "cleanup",
        "repair"
      ] as const;
      const states = ["normal", "warning", "degraded", "critical"] as const;

      for (const operationClass of operations) {
        for (const watermarkState of states) {
          const serverMessage = `Storage admission denied for operation "${operationClass}": watermark state is "${watermarkState}" (85.0% disk usage)`;
          const mockFetch = vi.fn().mockResolvedValue({
            ok: false,
            status: 507,
            headers: new Headers({ "content-type": "application/json" }),
            json: async () => ({
              code: "STORAGE_ADMISSION_DENIED",
              message: serverMessage,
              operationClass,
              watermarkState,
              usedRatio: 0.85,
              totalBytes: 1_000_000_000,
              freeBytes: 150_000_000
            })
          });

          const client = createControlApiClient({
            baseUrl: "http://localhost:3000",
            fetch: mockFetch
          });

          let caughtError: unknown;
          try {
            await client.complete(sampleJobId, sampleLeaseToken, {
              candidatePayload: { variantOrdinal: 1 }
            });
          } catch (err) {
            caughtError = err;
          }

          expect(caughtError).toBeInstanceOf(StorageAdmissionError);
          const admissionErr = caughtError as StorageAdmissionError;
          expect(admissionErr.operationClass).toBe(operationClass);
          expect(admissionErr.watermarkState).toBe(watermarkState);
          expect(admissionErr.usedRatio).toBe(0.85);
          expect(admissionErr.totalBytes).toBe(1_000_000_000);
          expect(admissionErr.freeBytes).toBe(150_000_000);
          expect(admissionErr.message).toBe(serverMessage);
        }
      }
    });

    it("malformed 507 is not treated as typed admission refusal", async () => {
      const malformedPayloads = [
        // Wrong code
        {
          code: "SOME_OTHER_ERROR",
          message: "Disk full",
          operationClass: "candidate_upload",
          watermarkState: "degraded",
          usedRatio: 0.85,
          totalBytes: 100,
          freeBytes: 15
        },
        // Invalid operationClass
        {
          code: "STORAGE_ADMISSION_DENIED",
          message: "Admission denied",
          operationClass: "invalid_operation",
          watermarkState: "degraded",
          usedRatio: 0.85,
          totalBytes: 100,
          freeBytes: 15
        },
        // Missing operationClass
        {
          code: "STORAGE_ADMISSION_DENIED",
          message: "Admission denied",
          watermarkState: "degraded",
          usedRatio: 0.85,
          totalBytes: 100,
          freeBytes: 15
        },
        // Invalid watermarkState ("nominal" instead of "normal")
        {
          code: "STORAGE_ADMISSION_DENIED",
          message: "Admission denied",
          operationClass: "candidate_upload",
          watermarkState: "nominal",
          usedRatio: 0.85,
          totalBytes: 100,
          freeBytes: 15
        },
        // Missing watermarkState
        {
          code: "STORAGE_ADMISSION_DENIED",
          message: "Admission denied",
          operationClass: "candidate_upload",
          usedRatio: 0.85,
          totalBytes: 100,
          freeBytes: 15
        },
        // Non-number usedRatio
        {
          code: "STORAGE_ADMISSION_DENIED",
          message: "Admission denied",
          operationClass: "candidate_upload",
          watermarkState: "degraded",
          usedRatio: "0.85",
          totalBytes: 100,
          freeBytes: 15
        },
        // Non-number totalBytes
        {
          code: "STORAGE_ADMISSION_DENIED",
          message: "Admission denied",
          operationClass: "candidate_upload",
          watermarkState: "degraded",
          usedRatio: 0.85,
          totalBytes: "100",
          freeBytes: 15
        },
        // Non-number freeBytes
        {
          code: "STORAGE_ADMISSION_DENIED",
          message: "Admission denied",
          operationClass: "candidate_upload",
          watermarkState: "degraded",
          usedRatio: 0.85,
          totalBytes: 100,
          freeBytes: null
        }
      ];

      for (const payload of malformedPayloads) {
        const mockFetch = vi.fn().mockResolvedValue({
          ok: false,
          status: 507,
          headers: new Headers({ "content-type": "application/json" }),
          json: async () => payload
        });

        const client = createControlApiClient({
          baseUrl: "http://localhost:3000",
          fetch: mockFetch
        });

        let capturedError: unknown;
        try {
          await client.complete(sampleJobId, sampleLeaseToken);
        } catch (err) {
          capturedError = err;
        }

        expect(capturedError).toBeInstanceOf(ControlApiClientError);
        expect(capturedError).not.toBeInstanceOf(StorageAdmissionError);
        expect((capturedError as ControlApiClientError).statusCode).toBe(507);
      }

      // Non-JSON 507 response
      const nonJsonFetch = vi.fn().mockResolvedValue({
        ok: false,
        status: 507,
        statusText: "Insufficient Storage",
        headers: new Headers({ "content-type": "text/html" }),
        json: async () => {
          throw new SyntaxError("Unexpected token < in JSON");
        }
      });

      const clientNonJson = createControlApiClient({
        baseUrl: "http://localhost:3000",
        fetch: nonJsonFetch
      });

      let nonJsonError: unknown;
      try {
        await clientNonJson.complete(sampleJobId, sampleLeaseToken);
      } catch (err) {
        nonJsonError = err;
      }

      expect(nonJsonError).toBeInstanceOf(ControlApiClientError);
      expect(nonJsonError).not.toBeInstanceOf(StorageAdmissionError);
      expect((nonJsonError as ControlApiClientError).statusCode).toBe(507);
    });

    it("non-507 completion failures retain existing behavior", async () => {
      // 400 Validation failure
      const mockFetch400 = vi.fn().mockResolvedValue({
        ok: false,
        status: 400,
        headers: new Headers({ "content-type": "application/json" }),
        json: async () => ({
          code: "VALIDATION_FAILURE",
          message: "Candidate jobs do not accept manifest payload"
        })
      });

      const client400 = createControlApiClient({
        baseUrl: "http://localhost:3000",
        fetch: mockFetch400
      });

      let err400: unknown;
      try {
        await client400.complete(sampleJobId, sampleLeaseToken);
      } catch (err) {
        err400 = err;
      }
      expect(err400).toBeInstanceOf(ControlApiClientError);
      expect(err400).not.toBeInstanceOf(StorageAdmissionError);
      expect((err400 as ControlApiClientError).statusCode).toBe(400);
      expect((err400 as ControlApiClientError).message).toContain(
        "Candidate jobs do not accept manifest payload"
      );
      expect((err400 as ControlApiClientError).responseDetail).toBe(
        "Candidate jobs do not accept manifest payload"
      );

      // 503 Telemetry unavailable
      const mockFetch503 = vi.fn().mockResolvedValue({
        ok: false,
        status: 503,
        headers: new Headers({ "content-type": "application/json" }),
        json: async () => ({
          code: "STORAGE_TELEMETRY_UNAVAILABLE",
          message: "Storage telemetry is unavailable."
        })
      });

      const client503 = createControlApiClient({
        baseUrl: "http://localhost:3000",
        fetch: mockFetch503
      });

      let err503: unknown;
      try {
        await client503.complete(sampleJobId, sampleLeaseToken);
      } catch (err) {
        err503 = err;
      }
      expect(err503).toBeInstanceOf(ControlApiClientError);
      expect(err503).not.toBeInstanceOf(StorageAdmissionError);
      expect((err503 as ControlApiClientError).statusCode).toBe(503);

      // 500 Internal server error
      const mockFetch500 = vi.fn().mockResolvedValue({
        ok: false,
        status: 500,
        statusText: "Internal Server Error",
        headers: new Headers({ "content-type": "application/json" }),
        json: async () => ({
          message: "Internal Server Error"
        })
      });

      const client500 = createControlApiClient({
        baseUrl: "http://localhost:3000",
        fetch: mockFetch500
      });

      let err500: unknown;
      try {
        await client500.complete(sampleJobId, sampleLeaseToken);
      } catch (err) {
        err500 = err;
      }
      expect(err500).toBeInstanceOf(ControlApiClientError);
      expect(err500).not.toBeInstanceOf(StorageAdmissionError);
      expect((err500 as ControlApiClientError).statusCode).toBe(500);

      // Network failure
      const mockFetchNetwork = vi.fn().mockRejectedValue(new Error("ECONNREFUSED"));
      const clientNetwork = createControlApiClient({
        baseUrl: "http://localhost:3000",
        fetch: mockFetchNetwork
      });

      let errNetwork: unknown;
      try {
        await clientNetwork.complete(sampleJobId, sampleLeaseToken);
      } catch (err) {
        errNetwork = err;
      }
      expect(errNetwork).toBeInstanceOf(ControlApiClientError);
      expect((errNetwork as ControlApiClientError).statusCode).toBeUndefined();
    });
  });

  describe("claim, start, heartbeat, complete, fail operations", () => {
    it("claim returns RenderJob on 200 and undefined on 204", async () => {
      const mockFetch200 = vi.fn().mockResolvedValue({
        ok: true,
        status: 200,
        json: async () => sampleJob
      });

      const client200 = createControlApiClient({
        baseUrl: "http://localhost:3000",
        fetch: mockFetch200
      });

      const job = await client200.claim("worker-1");
      expect(job).toEqual(sampleJob);
      expect(mockFetch200).toHaveBeenCalledWith(
        "http://localhost:3000/api/jobs/claim",
        expect.objectContaining({
          method: "POST",
          body: JSON.stringify({ workerId: "worker-1" })
        })
      );

      const mockFetch204 = vi.fn().mockResolvedValue({
        ok: true,
        status: 204,
        json: async () => undefined
      });

      const client204 = createControlApiClient({
        baseUrl: "http://localhost:3000",
        fetch: mockFetch204
      });

      const noJob = await client204.claim("worker-1");
      expect(noJob).toBeUndefined();
    });

    it("claim passes allowedJobKinds in body when supplied and omits it when absent", async () => {
      const mockFetch = vi.fn().mockResolvedValue({
        ok: true,
        status: 200,
        json: async () => sampleJob
      });

      const client = createControlApiClient({
        baseUrl: "http://control",
        fetch: mockFetch
      });

      await client.claim("worker-a", ["candidate"]);

      expect(mockFetch).toHaveBeenLastCalledWith(
        "http://control/api/jobs/claim",
        expect.objectContaining({
          method: "POST",
          body: JSON.stringify({ workerId: "worker-a", allowedJobKinds: ["candidate"] })
        })
      );

      await client.claim("worker-a");

      expect(mockFetch).toHaveBeenLastCalledWith(
        "http://control/api/jobs/claim",
        expect.objectContaining({
          method: "POST",
          body: JSON.stringify({ workerId: "worker-a" })
        })
      );
    });

    it("claim throws ControlApiClientError on 503 telemetry unavailable", async () => {
      const mockFetch503 = vi.fn().mockResolvedValue({
        ok: false,
        status: 503,
        headers: new Headers({ "content-type": "application/json" }),
        json: async () => ({
          code: "STORAGE_TELEMETRY_UNAVAILABLE",
          message: "Storage telemetry is unavailable."
        })
      });

      const client = createControlApiClient({
        baseUrl: "http://localhost:3000",
        fetch: mockFetch503
      });

      await expect(client.claim("worker-1")).rejects.toThrow(ControlApiClientError);
      try {
        await client.claim("worker-1");
      } catch (err) {
        expect(err).toBeInstanceOf(ControlApiClientError);
        const clientErr = err as ControlApiClientError;
        expect(clientErr.statusCode).toBe(503);
        expect(clientErr.message).toContain("Storage telemetry is unavailable.");
        expect(clientErr.responseDetail).toBe("Storage telemetry is unavailable.");
      }
    });

    it("claim throws ControlApiClientError on malformed JSON", async () => {
      const mockFetchMalformed = vi.fn().mockResolvedValue({
        ok: true,
        status: 200,
        json: async () => {
          throw new SyntaxError("Unexpected token < in JSON");
        }
      });

      const client = createControlApiClient({
        baseUrl: "http://localhost:3000",
        fetch: mockFetchMalformed
      });

      await expect(client.claim("worker-1")).rejects.toThrow(ControlApiClientError);
      try {
        await client.claim("worker-1");
      } catch (err) {
        expect(err).toBeInstanceOf(ControlApiClientError);
        expect((err as ControlApiClientError).statusCode).toBe(200);
        expect((err as ControlApiClientError).message).toContain(
          "Failed to parse response JSON from Control API"
        );
      }
    });

    it("claim throws ControlApiClientError on connection failure", async () => {
      const mockFetchReject = vi.fn().mockRejectedValue(new Error("ECONNREFUSED"));

      const client = createControlApiClient({
        baseUrl: "http://localhost:3000",
        fetch: mockFetchReject
      });

      await expect(client.claim("worker-1")).rejects.toThrow(ControlApiClientError);
      try {
        await client.claim("worker-1");
      } catch (err) {
        expect(err).toBeInstanceOf(ControlApiClientError);
        expect((err as ControlApiClientError).statusCode).toBeUndefined();
        expect((err as ControlApiClientError).message).toContain(
          "Failed to connect to Control API"
        );
      }
    });

    it("start posts token and returns mutation result, handling 200, 404, and 409", async () => {
      const mockFetch200 = vi.fn().mockResolvedValue({
        ok: true,
        status: 200,
        json: async () => ({
          outcome: "applied",
          job: { ...sampleJob, status: "rendering" }
        })
      });

      const client200 = createControlApiClient({
        baseUrl: "http://localhost:3000",
        fetch: mockFetch200
      });

      const result = await client200.start(sampleJobId, sampleLeaseToken);
      expect(result).toEqual({
        outcome: "applied",
        job: expect.objectContaining({ status: "rendering" })
      });
      expect(mockFetch200).toHaveBeenCalledWith(
        `http://localhost:3000/api/jobs/${sampleJobId}/start`,
        expect.objectContaining({
          method: "POST",
          body: JSON.stringify({ leaseToken: sampleLeaseToken })
        })
      );

      const mockFetch404 = vi.fn().mockResolvedValue({
        ok: false,
        status: 404,
        json: async () => ({ code: "NOT_FOUND", message: "Job not found." })
      });
      const client404 = createControlApiClient({
        baseUrl: "http://localhost:3000",
        fetch: mockFetch404
      });
      expect(await client404.start(sampleJobId, sampleLeaseToken)).toEqual({
        outcome: "not_found"
      });

      const mockFetch409 = vi.fn().mockResolvedValue({
        ok: false,
        status: 409,
        json: async () => ({ code: "LEASE_SUPERSEDED", message: "Superseded" })
      });
      const client409 = createControlApiClient({
        baseUrl: "http://localhost:3000",
        fetch: mockFetch409
      });
      expect(await client409.start(sampleJobId, sampleLeaseToken)).toEqual({
        outcome: "superseded"
      });
    });

    it("heartbeat posts token and returns mutation result, handling 200, 404, and 409", async () => {
      const mockFetch200 = vi.fn().mockResolvedValue({
        ok: true,
        status: 200,
        json: async () => ({
          outcome: "applied",
          job: sampleJob
        })
      });

      const client200 = createControlApiClient({
        baseUrl: "http://localhost:3000",
        fetch: mockFetch200
      });

      const result = await client200.heartbeat(sampleJobId, sampleLeaseToken);
      expect(result).toEqual({
        outcome: "applied",
        job: expect.objectContaining({ jobId: sampleJobId })
      });

      const mockFetch404 = vi.fn().mockResolvedValue({
        ok: false,
        status: 404,
        json: async () => ({ code: "NOT_FOUND" })
      });
      const client404 = createControlApiClient({
        baseUrl: "http://localhost:3000",
        fetch: mockFetch404
      });
      expect(await client404.heartbeat(sampleJobId, sampleLeaseToken)).toEqual({
        outcome: "not_found"
      });

      const mockFetch409 = vi.fn().mockResolvedValue({
        ok: false,
        status: 409,
        json: async () => ({ code: "LEASE_SUPERSEDED" })
      });
      const client409 = createControlApiClient({
        baseUrl: "http://localhost:3000",
        fetch: mockFetch409
      });
      expect(await client409.heartbeat(sampleJobId, sampleLeaseToken)).toEqual({
        outcome: "superseded"
      });
    });

    it("fail posts token and errorTrace and returns mutation result, handling 200, 404, and 409", async () => {
      const mockFetch200 = vi.fn().mockResolvedValue({
        ok: true,
        status: 200,
        json: async () => ({
          outcome: "applied",
          job: { ...sampleJob, status: "failed", errorTrace: "CUDA error" }
        })
      });

      const client200 = createControlApiClient({
        baseUrl: "http://localhost:3000",
        fetch: mockFetch200
      });

      const result = await client200.fail(sampleJobId, sampleLeaseToken, "CUDA error");
      expect(result).toEqual({
        outcome: "applied",
        job: expect.objectContaining({ status: "failed", errorTrace: "CUDA error" })
      });
      expect(mockFetch200).toHaveBeenCalledWith(
        `http://localhost:3000/api/jobs/${sampleJobId}/fail`,
        expect.objectContaining({
          method: "POST",
          body: JSON.stringify({ leaseToken: sampleLeaseToken, errorTrace: "CUDA error" })
        })
      );

      const mockFetch404 = vi.fn().mockResolvedValue({
        ok: false,
        status: 404,
        json: async () => ({ code: "NOT_FOUND" })
      });
      const client404 = createControlApiClient({
        baseUrl: "http://localhost:3000",
        fetch: mockFetch404
      });
      expect(await client404.fail(sampleJobId, sampleLeaseToken, "err")).toEqual({
        outcome: "not_found"
      });

      const mockFetch409 = vi.fn().mockResolvedValue({
        ok: false,
        status: 409,
        json: async () => ({ code: "LEASE_SUPERSEDED" })
      });
      const client409 = createControlApiClient({
        baseUrl: "http://localhost:3000",
        fetch: mockFetch409
      });
      expect(await client409.fail(sampleJobId, sampleLeaseToken, "err")).toEqual({
        outcome: "superseded"
      });
    });

    it("complete posts payload and returns mutation result, handling 200, 404, and 409", async () => {
      const mockFetch200 = vi.fn().mockResolvedValue({
        ok: true,
        status: 200,
        json: async () => ({
          outcome: "applied",
          job: { ...sampleJob, status: "completed" }
        })
      });

      const client200 = createControlApiClient({
        baseUrl: "http://localhost:3000",
        fetch: mockFetch200
      });

      const manifestPayload = { promptId: "prompt-123" };
      const result = await client200.complete(sampleJobId, sampleLeaseToken, { manifestPayload });
      expect(result).toEqual({
        outcome: "applied",
        job: expect.objectContaining({ status: "completed" })
      });
      expect(mockFetch200).toHaveBeenCalledWith(
        `http://localhost:3000/api/jobs/${sampleJobId}/complete`,
        expect.objectContaining({
          method: "POST",
          body: JSON.stringify({ leaseToken: sampleLeaseToken, manifestPayload })
        })
      );

      const mockFetch404 = vi.fn().mockResolvedValue({
        ok: false,
        status: 404,
        json: async () => ({ code: "NOT_FOUND" })
      });
      const client404 = createControlApiClient({
        baseUrl: "http://localhost:3000",
        fetch: mockFetch404
      });
      expect(await client404.complete(sampleJobId, sampleLeaseToken)).toEqual({
        outcome: "not_found"
      });

      const mockFetch409 = vi.fn().mockResolvedValue({
        ok: false,
        status: 409,
        json: async () => ({ code: "LEASE_SUPERSEDED" })
      });
      const client409 = createControlApiClient({
        baseUrl: "http://localhost:3000",
        fetch: mockFetch409
      });
      expect(await client409.complete(sampleJobId, sampleLeaseToken)).toEqual({
        outcome: "superseded"
      });
    });

    it("mutation endpoints handle malformed JSON on 200 and connection failures", async () => {
      const mockFetchMalformed = vi.fn().mockResolvedValue({
        ok: true,
        status: 200,
        json: async () => {
          throw new SyntaxError("Unexpected token in JSON");
        }
      });

      const clientMalformed = createControlApiClient({
        baseUrl: "http://localhost:3000",
        fetch: mockFetchMalformed
      });

      await expect(clientMalformed.start(sampleJobId, sampleLeaseToken)).rejects.toThrow(
        ControlApiClientError
      );

      const mockFetchReject = vi.fn().mockRejectedValue(new Error("ECONNRESET"));
      const clientReject = createControlApiClient({
        baseUrl: "http://localhost:3000",
        fetch: mockFetchReject
      });

      await expect(clientReject.heartbeat(sampleJobId, sampleLeaseToken)).rejects.toThrow(
        ControlApiClientError
      );
    });

    it("non-JSON error response (e.g. HTML 502/500) does not invoke res.json()", async () => {
      const jsonSpy = vi.fn();
      const mockFetchHtml = vi.fn().mockResolvedValue({
        ok: false,
        status: 502,
        statusText: "Bad Gateway",
        headers: new Headers({ "content-type": "text/html" }),
        json: jsonSpy
      });

      const client = createControlApiClient({
        baseUrl: "http://localhost:3000",
        fetch: mockFetchHtml
      });

      let caught: unknown;
      try {
        await client.claim("worker-1");
      } catch (err) {
        caught = err;
      }

      expect(caught).toBeInstanceOf(ControlApiClientError);
      expect((caught as ControlApiClientError).statusCode).toBe(502);
      expect((caught as ControlApiClientError).message).toBe(
        "Control API returned HTTP 502: Bad Gateway"
      );
      expect((caught as ControlApiClientError).responseDetail).toBeUndefined();
      expect(jsonSpy).not.toHaveBeenCalled();
    });

    it("non-JSON 507 response does not invoke res.json() and throws malformed error", async () => {
      const jsonSpy = vi.fn();
      const mockFetch507Html = vi.fn().mockResolvedValue({
        ok: false,
        status: 507,
        statusText: "Insufficient Storage",
        headers: new Headers({ "content-type": "text/html" }),
        json: jsonSpy
      });

      const client = createControlApiClient({
        baseUrl: "http://localhost:3000",
        fetch: mockFetch507Html
      });

      let caught: unknown;
      try {
        await client.complete(sampleJobId, sampleLeaseToken);
      } catch (err) {
        caught = err;
      }

      expect(caught).toBeInstanceOf(ControlApiClientError);
      expect((caught as ControlApiClientError).statusCode).toBe(507);
      expect((caught as ControlApiClientError).message).toBe(
        "Control API returned HTTP 507: Insufficient Storage (malformed admission error payload)"
      );
      expect(jsonSpy).not.toHaveBeenCalled();
    });
  });
});

describe("HttpDeliveryAssemblyControlApiClient request timeout", () => {
  // A hung Control API request never rejects or resolves on its own — no
  // network error, no HTTP response. Without a bounded timeout, an awaited
  // call would block DeliveryAssemblyWorker's retry loops (and shutdown
  // drain) forever. This mocks that exact shape: the fetch promise only
  // settles when the AbortSignal passed to it fires.
  function makeHangingFetch() {
    return vi.fn().mockImplementation((_url: string, init?: RequestInit) => {
      return new Promise((_resolve, reject) => {
        init?.signal?.addEventListener("abort", () => {
          const err = new Error("This operation was aborted");
          err.name = "AbortError";
          reject(err);
        });
      });
    });
  }

  it("aborts a hung claim() request after timeoutMs and surfaces a typed error", async () => {
    const hangingFetch = makeHangingFetch();
    const client = createDeliveryAssemblyControlApiClient({
      baseUrl: "http://localhost:3000",
      fetch: hangingFetch as unknown as typeof fetch,
      timeoutMs: 20
    });

    await expect(client.claim("worker-1")).rejects.toThrow(ControlApiClientError);
    await expect(client.claim("worker-1")).rejects.toThrow(/timed out after 20ms/);
  });

  it("aborts a hung heartbeat() request after timeoutMs", async () => {
    const hangingFetch = makeHangingFetch();
    const client = createDeliveryAssemblyControlApiClient({
      baseUrl: "http://localhost:3000",
      fetch: hangingFetch as unknown as typeof fetch,
      timeoutMs: 20
    });

    await expect(client.heartbeat(sampleJobId, sampleLeaseToken)).rejects.toThrow(
      /timed out after 20ms/
    );
  });

  it("aborts a hung getJob() request after timeoutMs", async () => {
    const hangingFetch = makeHangingFetch();
    const client = createDeliveryAssemblyControlApiClient({
      baseUrl: "http://localhost:3000",
      fetch: hangingFetch as unknown as typeof fetch,
      timeoutMs: 20
    });

    await expect(client.getJob(sampleJobId)).rejects.toThrow(/timed out after 20ms/);
  });

  it("does not time out a request that resolves before timeoutMs", async () => {
    const fastFetch = vi.fn().mockResolvedValue({ ok: true, status: 204 });
    const client = createDeliveryAssemblyControlApiClient({
      baseUrl: "http://localhost:3000",
      fetch: fastFetch as unknown as typeof fetch,
      timeoutMs: 5000
    });

    await expect(client.claim("worker-1")).resolves.toBeUndefined();
  });

  it("defaults to DEFAULT_CONTROL_API_TIMEOUT_MS when timeoutMs is not provided", async () => {
    const fastFetch = vi.fn().mockResolvedValue({ ok: true, status: 204 });
    const client = createDeliveryAssemblyControlApiClient({
      baseUrl: "http://localhost:3000",
      fetch: fastFetch as unknown as typeof fetch
    });

    await expect(client.claim("worker-1")).resolves.toBeUndefined();
    const passedInit = fastFetch.mock.calls[0]?.[1] as RequestInit | undefined;
    expect(passedInit?.signal).toBeInstanceOf(AbortSignal);
  });

  it("aborts a request whose response body never completes, even though fetch() itself resolved", async () => {
    // A server can send headers and then never finish the body — fetch()
    // resolves, but res.json() hangs forever. The deadline must stay armed
    // through body consumption, not just connection establishment: this
    // mock's json() only settles when the same AbortSignal fires.
    const hangingBodyFetch = vi.fn().mockImplementation((_url: string, init?: RequestInit) => {
      const signal = init?.signal;
      return Promise.resolve({
        ok: true,
        status: 200,
        json: () =>
          new Promise((_resolve, reject) => {
            signal?.addEventListener("abort", () => {
              const err = new Error("The operation was aborted");
              err.name = "AbortError";
              reject(err);
            });
          })
      });
    });

    const client = createDeliveryAssemblyControlApiClient({
      baseUrl: "http://localhost:3000",
      fetch: hangingBodyFetch as unknown as typeof fetch,
      timeoutMs: 20
    });

    await expect(client.heartbeat(sampleJobId, sampleLeaseToken)).rejects.toThrow(
      /timed out after 20ms/
    );
  });
});
