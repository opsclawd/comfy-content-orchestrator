import { describe, expect, it } from "vitest";
import type {
  CampaignRepository,
  CandidateRankerPort,
  GpuExecutionLeasePort,
  GpuLeaseHolder,
  GpuMemorySnapshot,
  GpuTelemetryPort,
  LicenseRegistryRepository,
  ManifestRepository,
  MediaAssemblerPort,
  ObjectLocator,
  ObjectStoragePort,
  PersistentObjectLocator,
  PlannerPort,
  PutObjectInput,
  QueueRenderInput,
  RenderEnginePort,
  RenderJobRepository,
  RenderLease,
  RenderQueueReceipt,
  RenderResult,
  ReviewEventStore,
  ReviewMediaDeliveryPort,
  SceneReviewCandidateGroup,
  SceneReviewDetail,
  SceneReviewQueries,
  StoryboardCandidateRepository,
  StoredObject,
  VoiceSynthesisPort
} from "./index.js";
import type { CampaignReviewSummary, ReviewAction, ReviewEvent, SceneStatus } from "@cco/contracts";
import type {
  CampaignId,
  CandidateId,
  SceneConfiguration,
  SceneId,
  StoryboardCandidate
} from "@cco/domain";
import { GpuLeaseOwnershipLostError, GpuLeaseUnavailableError } from "./index.js";

describe("Application capability ports contract tests", () => {
  describe("Render and Telemetry capability family", () => {
    it("satisfies RenderEnginePort contract with an API-format workflow", async () => {
      const workflow = {
        "3": {
          class_type: "KSampler",
          inputs: { seed: 42 }
        }
      } satisfies Readonly<Record<string, unknown>>;

      const renderEnginePort = {
        async queueRender(input: QueueRenderInput): Promise<RenderQueueReceipt> {
          return {
            executionId: `exec-for-${input.renderJobId}`,
            acceptedAt: "2026-08-15T06:00:00.000Z"
          };
        },
        async getRenderResult(executionId: string): Promise<RenderResult | undefined> {
          if (executionId === "exec-for-job-1") {
            return {
              executionId,
              status: "succeeded",
              outputObjectKeys: ["renders/job-1/output.mp4"],
              completedAt: "2026-08-15T06:01:00.000Z"
            };
          }
          return undefined;
        },
        async unloadModels(): Promise<void> {}
      } satisfies RenderEnginePort;

      const queueInput: QueueRenderInput = {
        renderJobId: "job-1",
        sceneId: "scene-1",
        renderProfileKey: "LTX_25_720P_5S_V1",
        workflow
      };

      const receipt = await renderEnginePort.queueRender(queueInput);
      expect(receipt.executionId).toBe("exec-for-job-1");
      expect(receipt.acceptedAt).toBe("2026-08-15T06:00:00.000Z");

      const result = await renderEnginePort.getRenderResult(receipt.executionId);
      expect(result).toEqual({
        executionId: "exec-for-job-1",
        status: "succeeded",
        outputObjectKeys: ["renders/job-1/output.mp4"],
        completedAt: "2026-08-15T06:01:00.000Z"
      });

      await expect(renderEnginePort.unloadModels()).resolves.toBeUndefined();
    });

    it("satisfies GpuTelemetryPort contract returning memory measurements", async () => {
      const gpuTelemetryPort = {
        async readMemory(): Promise<GpuMemorySnapshot> {
          return {
            totalVramMb: 24576,
            usedVramMb: 8192,
            freeVramMb: 16384,
            reservedVramMb: 0,
            measuredAt: "2026-08-15T06:00:00.000Z"
          };
        }
      } satisfies GpuTelemetryPort;

      const memory = await gpuTelemetryPort.readMemory();
      expect(memory.totalVramMb).toBe(24576);
      expect(memory.usedVramMb).toBe(8192);
      expect(memory.freeVramMb).toBe(16384);
      expect(memory.reservedVramMb).toBe(0);
      expect(memory.measuredAt).toBe("2026-08-15T06:00:00.000Z");
    });

    it("satisfies GpuExecutionLeasePort contract with an immutable holder and callable release", async () => {
      let released = false;
      const fakeHolder: GpuLeaseHolder = Object.freeze({
        version: 1,
        pid: 1234,
        startedAt: "2026-08-15T06:00:00.000Z",
        hostname: "test-host",
        leaseId: "lease-test-1"
      });

      const leasePort = {
        async acquireLease(): Promise<RenderLease> {
          return {
            holder: fakeHolder,
            async release(): Promise<void> {
              released = true;
            }
          };
        }
      } satisfies GpuExecutionLeasePort;

      const lease = await leasePort.acquireLease();
      expect(lease.holder).toEqual(fakeHolder);
      await lease.release();
      expect(released).toBe(true);

      const unavailError = new GpuLeaseUnavailableError("contention", fakeHolder);
      expect(unavailError.name).toBe("GpuLeaseUnavailableError");
      expect(unavailError.holder).toEqual(fakeHolder);

      const lostError = new GpuLeaseOwnershipLostError("ownership lost");
      expect(lostError.name).toBe("GpuLeaseOwnershipLostError");
    });
  });

  describe("Repository capability family", () => {
    it("satisfies generic repository port contracts", async () => {
      interface TestCampaign {
        readonly id: string;
        readonly name: string;
      }
      interface TestRenderJob {
        readonly id: string;
        readonly status: string;
      }
      interface TestManifest {
        readonly jobId: string;
        readonly files: readonly string[];
      }
      interface TestLicenseRecord {
        readonly componentKey: string;
        readonly license: string;
      }

      const campaignRepo = {
        async findById(campaignId: string): Promise<TestCampaign | undefined> {
          return campaignId === "camp-1" ? { id: "camp-1", name: "Summer Campaign" } : undefined;
        },
        async save(_campaign: TestCampaign): Promise<void> {}
      } satisfies CampaignRepository<TestCampaign>;

      const renderJobRepo = {
        async findById(renderJobId: string): Promise<TestRenderJob | undefined> {
          return renderJobId === "job-1" ? { id: "job-1", status: "queued" } : undefined;
        },
        async save(_renderJob: TestRenderJob): Promise<void> {}
      } satisfies RenderJobRepository<TestRenderJob>;

      const manifestRepo = {
        async findByJobId(renderJobId: string): Promise<TestManifest | undefined> {
          return renderJobId === "job-1" ? { jobId: "job-1", files: ["scene-1.mp4"] } : undefined;
        },
        async append(_manifest: TestManifest): Promise<void> {}
      } satisfies ManifestRepository<TestManifest>;

      const licenseRegistryRepo = {
        async findByComponentKey(componentKey: string): Promise<TestLicenseRecord | undefined> {
          return componentKey === "ltx-video"
            ? { componentKey: "ltx-video", license: "Apache-2.0" }
            : undefined;
        }
      } satisfies LicenseRegistryRepository<TestLicenseRecord>;

      const campaign = await campaignRepo.findById("camp-1");
      expect(campaign?.name).toBe("Summer Campaign");
      await expect(
        campaignRepo.save({ id: "camp-1", name: "Summer Campaign" })
      ).resolves.toBeUndefined();

      const renderJob = await renderJobRepo.findById("job-1");
      expect(renderJob?.status).toBe("queued");
      await expect(
        renderJobRepo.save({ id: "job-1", status: "rendering" })
      ).resolves.toBeUndefined();

      const manifest = await manifestRepo.findByJobId("job-1");
      expect(manifest?.files).toEqual(["scene-1.mp4"]);
      await expect(
        manifestRepo.append({ jobId: "job-1", files: ["scene-1.mp4"] })
      ).resolves.toBeUndefined();

      const candidateList: StoryboardCandidate[] = [
        {
          id: "cand-1" as CandidateId,
          sceneId: "scene-1" as SceneId,
          specRevision: 1,
          variantOrdinal: 1,
          locator: "godzspeed-temp/candidates/cand-1.webp",
          contentHash: "hash123",
          generationMetadata: {},
          createdAt: "2026-08-15T00:00:00.000Z"
        }
      ];

      const candidateRepo = {
        async findById(candidateId: CandidateId): Promise<StoryboardCandidate | undefined> {
          return candidateList.find((c) => c.id === candidateId);
        },
        async insert(candidate: StoryboardCandidate): Promise<void> {
          candidateList.push(candidate);
        },
        async listBySceneAndRevision(
          sceneId: SceneId,
          specRevision: number
        ): Promise<readonly StoryboardCandidate[]> {
          return candidateList
            .filter((c) => c.sceneId === sceneId && c.specRevision === specRevision)
            .sort((a, b) => a.variantOrdinal - b.variantOrdinal);
        }
      } satisfies StoryboardCandidateRepository;

      const candidate = await candidateRepo.findById("cand-1" as CandidateId);
      expect(candidate?.id).toBe("cand-1");

      const newCand: StoryboardCandidate = {
        id: "cand-2" as CandidateId,
        sceneId: "scene-1" as SceneId,
        specRevision: 1,
        variantOrdinal: 2,
        locator: "godzspeed-temp/candidates/cand-2.webp",
        contentHash: "hash456",
        generationMetadata: {},
        createdAt: "2026-08-15T00:01:00.000Z"
      };
      await candidateRepo.insert(newCand);
      const listed = await candidateRepo.listBySceneAndRevision("scene-1" as SceneId, 1);
      expect(listed).toHaveLength(2);
      expect(listed[0]?.id).toBe("cand-1");
      expect(listed[1]?.id).toBe("cand-2");

      const events: ReviewEvent[] = [];
      const eventStore = {
        async append(event: ReviewEvent): Promise<void> {
          events.push(event);
        },
        async findById(eventId: string): Promise<ReviewEvent | undefined> {
          return events.find((e) => e.eventId === eventId);
        }
      } satisfies ReviewEventStore;

      const reviewEvent: ReviewEvent = {
        eventId: "event-1",
        sceneId: "scene-1",
        reviewerName: "Director Alice",
        action: "approve",
        directorNotes: "LGTM",
        mutationPayload: {},
        priorSceneStatus: "director_review",
        resultingSceneStatus: "approved",
        occurredAt: "2026-08-15T00:00:00.000Z"
      };
      await eventStore.append(reviewEvent);
      const foundEvent = await eventStore.findById("event-1");
      expect(foundEvent).toEqual(reviewEvent);
      expect(await eventStore.findById("missing-event")).toBeUndefined();

      const config: SceneConfiguration = {
        prompt: "sunrise",
        referenceIds: [],
        engineProfileId: "ltx_25",
        durationMs: 5000
      };

      const sceneReviewQueries = {
        async getSceneReviewDetail(sceneId: SceneId): Promise<SceneReviewDetail | undefined> {
          if (sceneId === ("scene-1" as SceneId)) {
            const candidateGroup: SceneReviewCandidateGroup = {
              specRevision: 1,
              candidates: candidateList
            };
            return {
              sceneId: "scene-1" as SceneId,
              campaignId: "camp-1" as CampaignId,
              status: "director_review" as SceneStatus,
              specRevision: 1,
              configuration: config,
              candidatesByRevision: [candidateGroup],
              allowedActions: ["approve", "reroll"] as readonly ReviewAction[]
            };
          }
          return undefined;
        },
        async getCampaignReviewSummary(
          campaignId: CampaignId
        ): Promise<CampaignReviewSummary | undefined> {
          if (campaignId === ("camp-1" as CampaignId)) {
            return {
              campaignId: "camp-1",
              campaignName: "Summer Campaign",
              totalScenes: 1,
              scenesByStatus: { director_review: 1 },
              pendingReviewCount: 1,
              approvedCount: 0,
              completedCount: 0,
              updatedAt: "2026-08-15T00:00:00.000Z"
            };
          }
          return undefined;
        }
      } satisfies SceneReviewQueries;

      const detail = await sceneReviewQueries.getSceneReviewDetail("scene-1" as SceneId);
      expect(detail?.sceneId).toBe("scene-1");
      expect(detail?.candidatesByRevision[0]?.candidates).toHaveLength(2);
      expect(await sceneReviewQueries.getSceneReviewDetail("missing" as SceneId)).toBeUndefined();

      const summary = await sceneReviewQueries.getCampaignReviewSummary("camp-1" as CampaignId);
      expect(summary?.campaignId).toBe("camp-1");
      expect(summary?.totalScenes).toBe(1);
      expect(summary?.pendingReviewCount).toBe(1);
      expect(
        await sceneReviewQueries.getCampaignReviewSummary("missing" as CampaignId)
      ).toBeUndefined();

      const license = await licenseRegistryRepo.findByComponentKey("ltx-video");
      expect(license?.license).toBe("Apache-2.0");
    });
  });

  describe("Generic AI and Media capability family", () => {
    it("satisfies generic Planner, Ranker, VoiceSynthesis, and MediaAssembler port contracts", async () => {
      interface TestPlanInput {
        readonly prompt: string;
      }
      interface TestPlanOutput {
        readonly sceneCount: number;
      }
      const plannerPort = {
        async plan(input: TestPlanInput): Promise<TestPlanOutput> {
          return { sceneCount: input.prompt.length > 10 ? 3 : 1 };
        }
      } satisfies PlannerPort<TestPlanInput, TestPlanOutput>;

      interface TestCandidate {
        readonly id: string;
        readonly score: number;
      }
      interface TestRankContext {
        readonly minScore: number;
      }
      const candidateRankerPort = {
        async rank(
          candidates: readonly TestCandidate[],
          context: TestRankContext
        ): Promise<readonly TestCandidate[]> {
          return candidates.filter((candidate) => candidate.score >= context.minScore);
        }
      } satisfies CandidateRankerPort<TestCandidate, TestRankContext>;

      interface TestVoiceInput {
        readonly text: string;
        readonly speaker: string;
      }
      interface TestVoiceOutput {
        readonly audio: Uint8Array;
      }
      const voiceSynthesisPort = {
        async synthesize(input: TestVoiceInput): Promise<TestVoiceOutput> {
          return { audio: new Uint8Array([input.text.length, input.speaker.length]) };
        }
      } satisfies VoiceSynthesisPort<TestVoiceInput, TestVoiceOutput>;

      interface TestAssembleInput {
        readonly videoKeys: readonly string[];
        readonly audioKey: string;
      }
      interface TestAssembleOutput {
        readonly outputKey: string;
      }
      const mediaAssemblerPort = {
        async assemble(input: TestAssembleInput): Promise<TestAssembleOutput> {
          return { outputKey: `assembled/${input.audioKey}` };
        }
      } satisfies MediaAssemblerPort<TestAssembleInput, TestAssembleOutput>;

      const plan = await plannerPort.plan({ prompt: "A long enough prompt" });
      expect(plan.sceneCount).toBe(3);

      const ranked = await candidateRankerPort.rank(
        [
          { id: "c1", score: 10 },
          { id: "c2", score: 5 }
        ],
        { minScore: 8 }
      );
      expect(ranked).toEqual([{ id: "c1", score: 10 }]);

      const voice = await voiceSynthesisPort.synthesize({ text: "Hello", speaker: "Narrator" });
      expect(voice.audio).toEqual(new Uint8Array([5, 8]));

      const assembled = await mediaAssemblerPort.assemble({
        videoKeys: ["v1.mp4"],
        audioKey: "a1.mp3"
      });
      expect(assembled.outputKey).toBe("assembled/a1.mp3");
    });
  });

  describe("Object Storage capability family", () => {
    it("satisfies ObjectStoragePort contract with ObjectLocator and Uint8Array payload", async () => {
      const storedData = new Map<string, StoredObject>();

      const objectStoragePort = {
        async putObject(input: PutObjectInput): Promise<ObjectLocator> {
          const locator: ObjectLocator = {
            bucket: input.bucket,
            key: input.key
          };
          const stored: StoredObject = {
            bucket: input.bucket,
            key: input.key,
            body: input.body,
            ...(input.contentType !== undefined ? { contentType: input.contentType } : {}),
            ...(input.checksumSha256 !== undefined ? { checksumSha256: input.checksumSha256 } : {})
          };
          storedData.set(`${input.bucket}/${input.key}`, stored);
          return locator;
        },
        async getObject(locator: ObjectLocator): Promise<StoredObject | undefined> {
          return storedData.get(`${locator.bucket}/${locator.key}`);
        }
      } satisfies ObjectStoragePort;

      const testBytes = new Uint8Array([1, 2, 3, 4]);
      const putInput: PutObjectInput = {
        bucket: "cco-renders",
        key: "job-1/scene-1.mp4",
        body: testBytes,
        contentType: "video/mp4",
        checksumSha256: "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855"
      };

      const locator = await objectStoragePort.putObject(putInput);
      expect(locator).toEqual({
        bucket: "cco-renders",
        key: "job-1/scene-1.mp4"
      });

      const retrieved = await objectStoragePort.getObject(locator);
      expect(retrieved).toEqual({
        bucket: "cco-renders",
        key: "job-1/scene-1.mp4",
        body: testBytes,
        contentType: "video/mp4",
        checksumSha256: "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855"
      });

      const absent = await objectStoragePort.getObject({
        bucket: "cco-renders",
        key: "nonexistent.mp4"
      });
      expect(absent).toBeUndefined();
    });
  });

  describe("Review Media Delivery capability family", () => {
    it("satisfies ReviewMediaDeliveryPort contract generating ephemeral read URLs from persistent locators", async () => {
      const mediaDeliveryPort = {
        async generatePresignedReadUrl(
          locator: PersistentObjectLocator,
          expiresInSeconds?: number
        ): Promise<string> {
          const expiry = expiresInSeconds ?? 3600;
          return `https://storage-01.godzspeed-internal.ts.net/${locator.bucket}/${locator.key}?hash=${locator.contentHash}&exp=${expiry}`;
        }
      } satisfies ReviewMediaDeliveryPort;

      const locator: PersistentObjectLocator = {
        bucket: "godzspeed-review",
        key: "candidates/scene-1/rev-1-var-1.webp",
        contentHash: "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855"
      };

      const url = await mediaDeliveryPort.generatePresignedReadUrl(locator, 1800);
      expect(url).toContain("storage-01.godzspeed-internal.ts.net/godzspeed-review");
      expect(url).toContain(
        "hash=e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855"
      );
      expect(url).toContain("exp=1800");
    });
  });
});
