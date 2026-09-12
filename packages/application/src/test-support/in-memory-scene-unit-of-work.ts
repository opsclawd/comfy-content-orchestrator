import type { ReviewEvent } from "@cco/contracts";
import {
  Scene,
  type CampaignId,
  type CampaignRecord,
  type CampaignShellRecord,
  type CampaignStatus,
  type CandidateId,
  type ClientRecord,
  type JobKind,
  type RenderJob,
  type SceneId,
  type StoryboardCandidate
} from "@cco/domain";
import type {
  CampaignProductionRunRepository,
  CampaignRepository,
  CampaignShellPersistenceRecord,
  CampaignShellRepository,
  ClientRepository,
  DeliveryAssemblyJobQueuePort,
  EnqueueJobInput,
  GenerationManifestRepository,
  ReviewEventStore,
  SceneRepository,
  StoryboardCandidateRepository,
  TransactionalJobEnqueuer,
  UnitOfWork,
  UnitOfWorkContext
} from "../ports/index.js";
import { CampaignIdempotencyConflictError } from "../ports/index.js";

export class InMemorySceneUnitOfWork implements UnitOfWork {
  private readonly _seededScenes: Map<SceneId, Scene>;
  private readonly _seededCandidates: Map<CandidateId, StoryboardCandidate>;
  private readonly _seededReviewEvents: Map<string, ReviewEvent>;
  private readonly _seededCampaigns: Map<string, CampaignRecord>;
  private readonly _seededClients: Map<string, ClientRecord>;
  private readonly _campaignHashes = new Map<string, string>();
  private readonly _storyboardCompletionHashes = new Map<string, string>();
  private readonly _savedScenes: Scene[] = [];
  private readonly _reviewEvents: ReviewEvent[] = [];
  private readonly _savedCampaigns: CampaignRecord[] = [];
  private readonly _savedClients: ClientRecord[] = [];
  private readonly _enqueuedJobs: RenderJob[] = [];
  private _jobEnqueuer?: TransactionalJobEnqueuer | undefined;
  private _beforeSaveWithRequestHash?:
    ((campaign: CampaignShellRecord, hash: string) => Promise<void> | void) | undefined;

  constructor(
    seededScenes?: Iterable<Scene> | ReadonlyMap<SceneId, Scene> | Record<string, Scene>,
    seededCandidates?:
      | Iterable<StoryboardCandidate>
      | ReadonlyMap<CandidateId, StoryboardCandidate>
      | Record<string, StoryboardCandidate>,
    seededReviewEvents?:
      Iterable<ReviewEvent> | ReadonlyMap<string, ReviewEvent> | Record<string, ReviewEvent>,
    seededCampaigns?:
      | Iterable<CampaignRecord>
      | ReadonlyMap<string, CampaignRecord>
      | Record<string, CampaignRecord>,
    seededClients?:
      Iterable<ClientRecord> | ReadonlyMap<string, ClientRecord> | Record<string, ClientRecord>
  ) {
    this._seededScenes = new Map<SceneId, Scene>();
    if (seededScenes !== undefined && seededScenes !== null) {
      if (seededScenes instanceof Map) {
        for (const [id, scene] of seededScenes.entries()) {
          this._seededScenes.set(id, scene);
        }
      } else if (Symbol.iterator in seededScenes) {
        for (const item of seededScenes) {
          if (Array.isArray(item) && item.length === 2 && typeof item[0] === "string") {
            this._seededScenes.set(item[0] as SceneId, item[1] as Scene);
          } else {
            const scene = item as Scene;
            this._seededScenes.set(scene.id, scene);
          }
        }
      } else if (typeof seededScenes === "object") {
        for (const [id, scene] of Object.entries(seededScenes)) {
          this._seededScenes.set(id as SceneId, scene as Scene);
        }
      }
    }

    this._seededCandidates = new Map<CandidateId, StoryboardCandidate>();
    if (seededCandidates !== undefined && seededCandidates !== null) {
      if (seededCandidates instanceof Map) {
        for (const [id, candidate] of seededCandidates.entries()) {
          this._seededCandidates.set(id, candidate);
        }
      } else if (Symbol.iterator in seededCandidates) {
        for (const item of seededCandidates) {
          if (Array.isArray(item) && item.length === 2 && typeof item[0] === "string") {
            this._seededCandidates.set(item[0] as CandidateId, item[1] as StoryboardCandidate);
          } else {
            const candidate = item as StoryboardCandidate;
            this._seededCandidates.set(candidate.id, candidate);
          }
        }
      } else if (typeof seededCandidates === "object") {
        for (const [id, candidate] of Object.entries(seededCandidates)) {
          this._seededCandidates.set(id as CandidateId, candidate as StoryboardCandidate);
        }
      }
    }

    this._seededReviewEvents = new Map<string, ReviewEvent>();
    if (seededReviewEvents !== undefined && seededReviewEvents !== null) {
      if (seededReviewEvents instanceof Map) {
        for (const [id, event] of seededReviewEvents.entries()) {
          this._seededReviewEvents.set(id, event);
        }
      } else if (Symbol.iterator in seededReviewEvents) {
        for (const item of seededReviewEvents) {
          if (Array.isArray(item) && item.length === 2 && typeof item[0] === "string") {
            this._seededReviewEvents.set(item[0], item[1] as ReviewEvent);
          } else {
            const event = item as ReviewEvent;
            this._seededReviewEvents.set(event.eventId, event);
          }
        }
      } else if (typeof seededReviewEvents === "object") {
        for (const [id, event] of Object.entries(seededReviewEvents)) {
          this._seededReviewEvents.set(id, event as ReviewEvent);
        }
      }
    }

    this._seededCampaigns = new Map<string, CampaignRecord>();
    if (seededCampaigns !== undefined && seededCampaigns !== null) {
      if (seededCampaigns instanceof Map) {
        for (const [id, campaign] of seededCampaigns.entries()) {
          this._seededCampaigns.set(id, campaign);
        }
      } else if (Symbol.iterator in seededCampaigns) {
        for (const item of seededCampaigns) {
          if (Array.isArray(item) && item.length === 2 && typeof item[0] === "string") {
            this._seededCampaigns.set(item[0], item[1] as CampaignRecord);
          } else {
            const campaign = item as CampaignRecord;
            this._seededCampaigns.set(campaign.id, campaign);
          }
        }
      } else if (typeof seededCampaigns === "object") {
        for (const [id, campaign] of Object.entries(seededCampaigns)) {
          this._seededCampaigns.set(id, campaign as CampaignRecord);
        }
      }
    }

    this._seededClients = new Map<string, ClientRecord>();
    if (seededClients !== undefined && seededClients !== null) {
      if (seededClients instanceof Map) {
        for (const [id, client] of seededClients.entries()) {
          this._seededClients.set(id, client);
        }
      } else if (Symbol.iterator in seededClients) {
        for (const item of seededClients) {
          if (Array.isArray(item) && item.length === 2 && typeof item[0] === "string") {
            this._seededClients.set(item[0], item[1] as ClientRecord);
          } else {
            const client = item as ClientRecord;
            this._seededClients.set(client.id, client);
          }
        }
      } else if (typeof seededClients === "object") {
        for (const [id, client] of Object.entries(seededClients)) {
          this._seededClients.set(id, client as ClientRecord);
        }
      }
    }
  }

  get savedScenes(): readonly Scene[] {
    return this._savedScenes;
  }

  get reviewEvents(): readonly ReviewEvent[] {
    return this._reviewEvents;
  }

  get savedCampaigns(): readonly CampaignRecord[] {
    return this._savedCampaigns;
  }

  get savedClients(): readonly ClientRecord[] {
    return this._savedClients;
  }

  get enqueuedJobs(): readonly RenderJob[] {
    return this._enqueuedJobs;
  }

  withJobs(enqueuer: TransactionalJobEnqueuer): this {
    this._jobEnqueuer = enqueuer;
    return this;
  }

  withBeforeSaveWithRequestHash(
    hook?: (campaign: CampaignShellRecord, hash: string) => Promise<void> | void
  ): this {
    this._beforeSaveWithRequestHash = hook;
    return this;
  }

  seedCampaignWithHash(
    campaign: CampaignRecord,
    requestHashSha256: string,
    storyboardCompletionHashSha256?: string
  ): this {
    const enriched: CampaignRecord = {
      ...campaign,
      ...(storyboardCompletionHashSha256 !== undefined ? { storyboardCompletionHashSha256 } : {})
    };
    this._seededCampaigns.set(campaign.id, enriched);
    this._campaignHashes.set(campaign.id, requestHashSha256);
    if (storyboardCompletionHashSha256 !== undefined) {
      this._storyboardCompletionHashes.set(campaign.id, storyboardCompletionHashSha256);
    }
    return this;
  }

  async execute<TResult>(work: (context: UnitOfWorkContext) => Promise<TResult>): Promise<TResult> {
    const scopedSceneCopies = new Map<SceneId, Scene>();
    for (const [id, scene] of this._seededScenes.entries()) {
      scopedSceneCopies.set(id, Scene.reconstitute(scene.snapshot()));
    }

    const stagedScenes: Scene[] = [];
    const stagedReviewEvents: ReviewEvent[] = [];
    const stagedCandidates: StoryboardCandidate[] = [];
    const stagedCampaigns: CampaignRecord[] = [];
    const stagedCampaignHashes = new Map<string, string>();
    const stagedCompletionHashes = new Map<string, string>();
    const stagedClients: ClientRecord[] = [];
    const stagedJobs: RenderJob[] = [];

    let scopedJobs: TransactionalJobEnqueuer | undefined;
    if (this._jobEnqueuer !== undefined) {
      const enqueuer = this._jobEnqueuer;
      const isStagingQueue = (
        candidate: unknown
      ): candidate is {
        createJob(input: EnqueueJobInput): RenderJob;
        commitJob(job: RenderJob): void;
        areAllJobsTerminal?(sceneId: SceneId, jobKind: JobKind): Promise<boolean>;
      } => {
        return (
          typeof (candidate as Record<string, unknown>)?.createJob === "function" &&
          typeof (candidate as Record<string, unknown>)?.commitJob === "function"
        );
      };

      if (isStagingQueue(enqueuer)) {
        scopedJobs = {
          enqueue: async (input: EnqueueJobInput): Promise<RenderJob> => {
            const job = enqueuer.createJob(input);
            stagedJobs.push(job);
            return job;
          },
          areAllJobsTerminal: async (sceneId: SceneId, jobKind: JobKind): Promise<boolean> => {
            if (typeof enqueuer.areAllJobsTerminal === "function") {
              return enqueuer.areAllJobsTerminal(sceneId, jobKind);
            }
            const matching = stagedJobs.filter(
              (j) => j.sceneId === sceneId && j.jobKind === jobKind
            );
            if (matching.length === 0) return false;
            return matching.every(
              (j) => j.status !== "queued" && j.status !== "leased" && j.status !== "rendering"
            );
          }
        };
      } else {
        scopedJobs = {
          enqueue: async (input: EnqueueJobInput): Promise<RenderJob> => {
            const job = await enqueuer.enqueue(input);
            stagedJobs.push(job);
            return job;
          },
          areAllJobsTerminal: async (sceneId: SceneId, jobKind: JobKind): Promise<boolean> => {
            return enqueuer.areAllJobsTerminal(sceneId, jobKind);
          }
        };
      }
    }

    const scopedScenes: SceneRepository = {
      findById: async (sceneId: SceneId): Promise<Scene | undefined> => {
        return stagedScenes.find((scene) => scene.id === sceneId) ?? scopedSceneCopies.get(sceneId);
      },
      save: async (scene: Scene): Promise<void> => {
        stagedScenes.push(scene);
      },
      findByCampaignId: async (
        campaignId: CampaignId,
        _options?: { readonly forUpdate?: boolean }
      ): Promise<Scene[]> => {
        const scenesMap = new Map<SceneId, Scene>(scopedSceneCopies);
        for (const scene of stagedScenes) {
          scenesMap.set(scene.id, scene);
        }
        return Array.from(scenesMap.values())
          .filter((s) => s.campaignId === campaignId)
          .sort((a, b) => a.sequenceIndex - b.sequenceIndex);
      },
      findCampaignIdBySceneId: async (sceneId: SceneId): Promise<CampaignId | undefined> => {
        const scene = stagedScenes.find((s) => s.id === sceneId) ?? scopedSceneCopies.get(sceneId);
        return scene?.campaignId;
      }
    };

    const scopedCandidates: StoryboardCandidateRepository = {
      findById: async (candidateId: CandidateId): Promise<StoryboardCandidate | undefined> => {
        return (
          stagedCandidates.find((c) => c.id === candidateId) ??
          this._seededCandidates.get(candidateId)
        );
      },
      insert: async (candidate: StoryboardCandidate): Promise<void> => {
        stagedCandidates.push(candidate);
      },
      listBySceneAndRevision: async (
        sceneId: SceneId,
        specRevision: number
      ): Promise<readonly StoryboardCandidate[]> => {
        const candidatesMap = new Map<CandidateId, StoryboardCandidate>(this._seededCandidates);
        for (const candidate of stagedCandidates) {
          candidatesMap.set(candidate.id, candidate);
        }
        return Array.from(candidatesMap.values())
          .filter(
            (candidate) => candidate.sceneId === sceneId && candidate.specRevision === specRevision
          )
          .sort((a, b) => a.variantOrdinal - b.variantOrdinal);
      }
    };

    const scopedReviewEvents: ReviewEventStore = {
      append: async (event: ReviewEvent): Promise<void> => {
        stagedReviewEvents.push(event);
      },
      findById: async (eventId: string): Promise<ReviewEvent | undefined> => {
        return (
          stagedReviewEvents.find((e) => e.eventId === eventId) ??
          this._reviewEvents.find((e) => e.eventId === eventId) ??
          this._seededReviewEvents.get(eventId)
        );
      }
    };

    const scopedCampaigns: CampaignRepository<CampaignRecord> & CampaignShellRepository = {
      findById: async (campaignId: string): Promise<CampaignRecord | undefined> => {
        const found =
          stagedCampaigns.find((c) => c.id === campaignId) ?? this._seededCampaigns.get(campaignId);
        if (!found) return undefined;
        const completionHash =
          stagedCompletionHashes.get(found.id) ?? this._storyboardCompletionHashes.get(found.id);
        return completionHash !== undefined
          ? { ...found, storyboardCompletionHashSha256: completionHash }
          : found;
      },
      findByIdForUpdate: async (campaignId: string): Promise<CampaignRecord | undefined> => {
        const found =
          stagedCampaigns.find((c) => c.id === campaignId) ?? this._seededCampaigns.get(campaignId);
        if (!found) return undefined;
        const completionHash =
          stagedCompletionHashes.get(found.id) ?? this._storyboardCompletionHashes.get(found.id);
        return completionHash !== undefined
          ? { ...found, storyboardCompletionHashSha256: completionHash }
          : found;
      },
      findByIdempotencyKey: async (
        idempotencyKey: string
      ): Promise<CampaignShellPersistenceRecord | undefined> => {
        const found =
          stagedCampaigns.find((c) => c.idempotencyKey === idempotencyKey) ??
          Array.from(this._seededCampaigns.values()).find(
            (c) => c.idempotencyKey === idempotencyKey
          );
        if (
          !found ||
          found.idempotencyKey === undefined ||
          found.targetTotalDurationMs === undefined
        ) {
          return undefined;
        }
        const hash = stagedCampaignHashes.get(found.id) ?? this._campaignHashes.get(found.id);
        if (hash === undefined) {
          return undefined;
        }
        const completionHash =
          stagedCompletionHashes.get(found.id) ?? this._storyboardCompletionHashes.get(found.id);
        return {
          ...found,
          idempotencyKey: found.idempotencyKey,
          targetTotalDurationMs: found.targetTotalDurationMs,
          requestHashSha256: hash,
          ...(completionHash !== undefined
            ? { storyboardCompletionHashSha256: completionHash }
            : {})
        };
      },
      recordStoryboardCompletion: async (
        campaignId: string,
        completionHashSha256: string
      ): Promise<void> => {
        stagedCompletionHashes.set(campaignId, completionHashSha256);
        const existingIdx = stagedCampaigns.findIndex((c) => c.id === campaignId);
        if (existingIdx >= 0) {
          stagedCampaigns[existingIdx] = {
            ...stagedCampaigns[existingIdx]!,
            storyboardCompletionHashSha256: completionHashSha256
          };
        } else {
          const seeded = this._seededCampaigns.get(campaignId);
          if (seeded) {
            stagedCampaigns.push({
              ...seeded,
              storyboardCompletionHashSha256: completionHashSha256
            });
          }
        }
      },
      save: async (campaign: CampaignRecord): Promise<void> => {
        const existingIdx = stagedCampaigns.findIndex((c) => c.id === campaign.id);
        if (existingIdx >= 0) {
          stagedCampaigns[existingIdx] = campaign;
        } else {
          stagedCampaigns.push(campaign);
        }
      },
      saveWithRequestHash: async (
        campaign: CampaignShellRecord,
        requestHashSha256: string
      ): Promise<void> => {
        if (this._beforeSaveWithRequestHash !== undefined) {
          await this._beforeSaveWithRequestHash(campaign, requestHashSha256);
        }
        if (campaign.idempotencyKey !== undefined) {
          const conflict =
            stagedCampaigns.find(
              (c) => c.idempotencyKey === campaign.idempotencyKey && c.id !== campaign.id
            ) ??
            Array.from(this._seededCampaigns.values()).find(
              (c) => c.idempotencyKey === campaign.idempotencyKey && c.id !== campaign.id
            );
          if (conflict) {
            throw new CampaignIdempotencyConflictError(campaign.idempotencyKey);
          }
        }
        const existingIdx = stagedCampaigns.findIndex((c) => c.id === campaign.id);
        if (existingIdx >= 0) {
          stagedCampaigns[existingIdx] = campaign;
        } else {
          stagedCampaigns.push(campaign);
        }
        stagedCampaignHashes.set(campaign.id, requestHashSha256);
      },
      transitionStatusIf: async (
        campaignId: string,
        expectedStatus: CampaignStatus | readonly CampaignStatus[],
        nextStatus: CampaignStatus,
        options?: { readonly approvedScenes?: number }
      ): Promise<boolean> => {
        const campaign =
          stagedCampaigns.find((c) => c.id === campaignId) ?? this._seededCampaigns.get(campaignId);
        if (!campaign) return false;
        const statuses = Array.isArray(expectedStatus) ? expectedStatus : [expectedStatus];
        if (statuses.includes(campaign.status)) {
          const updated: CampaignRecord = {
            ...campaign,
            status: nextStatus,
            ...(options?.approvedScenes !== undefined
              ? { approvedScenes: options.approvedScenes }
              : {})
          };
          const existingIdx = stagedCampaigns.findIndex((c) => c.id === campaign.id);
          if (existingIdx >= 0) {
            stagedCampaigns[existingIdx] = updated;
          } else {
            stagedCampaigns.push(updated);
          }
          return true;
        }
        return false;
      }
    };

    const scopedClients: ClientRepository<ClientRecord> = {
      findById: async (clientId: string): Promise<ClientRecord | undefined> => {
        return stagedClients.find((c) => c.id === clientId) ?? this._seededClients.get(clientId);
      },
      save: async (client: ClientRecord): Promise<void> => {
        const existingIdx = stagedClients.findIndex((c) => c.id === client.id);
        if (existingIdx >= 0) {
          stagedClients[existingIdx] = client;
        } else {
          stagedClients.push(client);
        }
      }
    };

    const defaultCampaignProductionRuns: CampaignProductionRunRepository = {
      createIfAbsent: async () => {
        throw new Error("CampaignProductionRuns not configured in InMemorySceneUnitOfWork");
      },
      findById: async () => undefined,
      findByAssemblyJobId: async () => undefined,
      findRunSceneByProductionJobId: async () => undefined,
      findRunScenes: async () => [],
      insertRunScenes: async () => {},
      countIncompleteRunScenes: async () => 0,
      claimForProductionReview: async () => undefined,
      claimForAssembly: async () => undefined,
      setAssemblyJobId: async () => {},
      claimCompletion: async () => undefined,
      claimFailure: async () => undefined
    };

    const defaultAssemblyJobs: Pick<DeliveryAssemblyJobQueuePort, "enqueue"> = {
      enqueue: async () => {
        throw new Error("AssemblyJobs not configured in InMemorySceneUnitOfWork");
      }
    };

    const defaultGenerationManifests: GenerationManifestRepository = {
      getComponentIdentityById: async () => undefined,
      findVideoStemSourceByJobId: async () => undefined
    };

    const context: UnitOfWorkContext = {
      scenes: scopedScenes,
      reviewEvents: scopedReviewEvents,
      candidates: scopedCandidates,
      campaigns: scopedCampaigns,
      clients: scopedClients,
      jobs: scopedJobs,
      campaignProductionRuns: defaultCampaignProductionRuns,
      assemblyJobs: defaultAssemblyJobs,
      generationManifests: defaultGenerationManifests
    };

    const result = await work(context);

    this._savedScenes.push(...stagedScenes);
    this._reviewEvents.push(...stagedReviewEvents);
    this._savedCampaigns.push(...stagedCampaigns);
    this._savedClients.push(...stagedClients);
    this._enqueuedJobs.push(...stagedJobs);
    if (this._jobEnqueuer !== undefined) {
      const enqueuer = this._jobEnqueuer as Record<string, unknown>;
      if (typeof enqueuer.commitJob === "function") {
        for (const job of stagedJobs) {
          (enqueuer.commitJob as (j: RenderJob) => void)(job);
        }
      }
    }
    for (const scene of stagedScenes) {
      this._seededScenes.set(scene.id, scene);
    }
    for (const candidate of stagedCandidates) {
      this._seededCandidates.set(candidate.id, candidate);
    }
    for (const event of stagedReviewEvents) {
      this._seededReviewEvents.set(event.eventId, event);
    }
    for (const campaign of stagedCampaigns) {
      this._seededCampaigns.set(campaign.id, campaign);
    }
    for (const [id, hash] of stagedCampaignHashes.entries()) {
      this._campaignHashes.set(id, hash);
    }
    for (const [id, hash] of stagedCompletionHashes.entries()) {
      this._storyboardCompletionHashes.set(id, hash);
    }
    for (const client of stagedClients) {
      this._seededClients.set(client.id, client);
    }

    return result;
  }
}
