import { describe, expect, it } from "vitest";
import { InMemorySceneUnitOfWork } from "../test-support/in-memory-scene-unit-of-work.js";
import { StaleBibleEntryConflictError } from "./campaign-reference-bible-errors.js";

describe("CampaignReferenceBible in InMemorySceneUnitOfWork", () => {
  it("initializes snapshot atomically and returns existing snapshot on repeat", async () => {
    const uow = new InMemorySceneUnitOfWork();

    const campaignId = "campaign-1";
    const result1 = await uow.execute(async (ctx) => {
      return ctx.campaignReferenceBible!.initializeSnapshot({
        campaignId,
        entries: [
          {
            referenceAssetId: "asset-loc",
            role: "location",
            description: "A sunny beach",
            biblePromptTag: "<Picture 2>",
            sourceContentHashSha256: "h2"
          },
          {
            referenceAssetId: "asset-sub",
            role: "subject_identity",
            description: "A brave astronaut",
            biblePromptTag: "<Picture 1>",
            sourceContentHashSha256: "h1"
          }
        ]
      });
    });

    expect(result1.created).toBe(true);
    expect(result1.entries).toHaveLength(2);

    const result2 = await uow.execute(async (ctx) => {
      return ctx.campaignReferenceBible!.initializeSnapshot({
        campaignId,
        entries: [
          {
            referenceAssetId: "asset-sub",
            role: "subject_identity",
            description: "Divergent astronaut",
            biblePromptTag: "<Picture 1>",
            sourceContentHashSha256: "h1"
          }
        ]
      });
    });

    expect(result2.created).toBe(false);
    expect(result2.entries).toHaveLength(2);
    expect(result2.entries.find((e) => e.referenceAssetId === "asset-sub")?.description).toBe(
      "A brave astronaut"
    );
  });

  it("findByCampaignId orders entries by role priority (subject then location) then assetId", async () => {
    const uow = new InMemorySceneUnitOfWork();
    const campaignId = "campaign-order";

    await uow.execute(async (ctx) => {
      await ctx.campaignReferenceBible!.initializeSnapshot({
        campaignId,
        entries: [
          {
            referenceAssetId: "z-loc",
            role: "location",
            description: "Loc Z",
            biblePromptTag: "<Picture 3>",
            sourceContentHashSha256: "h3"
          },
          {
            referenceAssetId: "b-sub",
            role: "subject_identity",
            description: "Sub B",
            biblePromptTag: "<Picture 2>",
            sourceContentHashSha256: "h2"
          },
          {
            referenceAssetId: "a-sub",
            role: "subject_identity",
            description: "Sub A",
            biblePromptTag: "<Picture 1>",
            sourceContentHashSha256: "h1"
          }
        ]
      });
    });

    const entries = await uow.execute(async (ctx) => {
      return ctx.campaignReferenceBible!.findByCampaignId(campaignId);
    });

    expect(entries).toHaveLength(3);
    expect(entries[0]!.referenceAssetId).toBe("a-sub");
    expect(entries[1]!.referenceAssetId).toBe("b-sub");
    expect(entries[2]!.referenceAssetId).toBe("z-loc");
  });

  it("updates entry with audit and tracks history", async () => {
    const uow = new InMemorySceneUnitOfWork();
    const campaignId = "campaign-audit";

    await uow.execute(async (ctx) => {
      await ctx.campaignReferenceBible!.initializeSnapshot({
        campaignId,
        entries: [
          {
            referenceAssetId: "asset-1",
            role: "subject_identity",
            description: "Old description",
            biblePromptTag: "<Picture 1>",
            sourceContentHashSha256: "h1"
          }
        ]
      });
    });

    const updated = await uow.execute(async (ctx) => {
      const existing = await ctx.campaignReferenceBible!.findByCampaignAndAsset(
        campaignId,
        "asset-1"
      );
      return ctx.campaignReferenceBible!.updateEntryWithAudit({
        campaignId,
        referenceAssetId: "asset-1",
        expectedUpdatedAt: existing!.updatedAt,
        next: {
          role: "location",
          description: "New description",
          biblePromptTag: "<Picture 1>",
          sourceContentHashSha256: "h1"
        },
        change: {
          changeReason: "reclassified",
          sourceSceneId: "scene-1",
          sourceSpecRevision: 2,
          sourceBindingId: "scene-1:2:asset-1:location",
          actorKind: "director",
          actorId: "director-42"
        }
      });
    });

    expect(updated.role).toBe("location");
    expect(updated.description).toBe("New description");

    const changes = await uow.execute(async (ctx) => {
      return ctx.campaignReferenceBible!.listChanges(campaignId, "asset-1");
    });

    expect(changes).toHaveLength(1);
    expect(changes[0]!.oldRole).toBe("subject_identity");
    expect(changes[0]!.newRole).toBe("location");
    expect(changes[0]!.changeReason).toBe("reclassified");
    expect(changes[0]!.actorId).toBe("director-42");
  });

  it("rejects update with stale expectedUpdatedAt", async () => {
    const uow = new InMemorySceneUnitOfWork();
    const campaignId = "campaign-stale";

    await uow.execute(async (ctx) => {
      await ctx.campaignReferenceBible!.initializeSnapshot({
        campaignId,
        entries: [
          {
            referenceAssetId: "asset-1",
            role: "subject_identity",
            description: "Desc",
            biblePromptTag: "<Picture 1>",
            sourceContentHashSha256: "h1"
          }
        ]
      });
    });

    await expect(
      uow.execute(async (ctx) => {
        return ctx.campaignReferenceBible!.updateEntryWithAudit({
          campaignId,
          referenceAssetId: "asset-1",
          expectedUpdatedAt: "2020-01-01T00:00:00.000Z",
          next: {
            role: "location",
            description: "Desc",
            biblePromptTag: "<Picture 1>",
            sourceContentHashSha256: "h1"
          },
          change: {
            changeReason: "stale_edit",
            sourceSceneId: "scene-1",
            sourceSpecRevision: 2,
            sourceBindingId: "b-1",
            actorKind: "director"
          }
        });
      })
    ).rejects.toThrow(StaleBibleEntryConflictError);
  });

  it("rolls back staged changes if unit of work throws", async () => {
    const uow = new InMemorySceneUnitOfWork();
    const campaignId = "campaign-rollback";

    await expect(
      uow.execute(async (ctx) => {
        await ctx.campaignReferenceBible!.initializeSnapshot({
          campaignId,
          entries: [
            {
              referenceAssetId: "asset-1",
              role: "subject_identity",
              description: "Desc",
              biblePromptTag: "<Picture 1>",
              sourceContentHashSha256: "h1"
            }
          ]
        });
        throw new Error("Simulated failure inside transaction");
      })
    ).rejects.toThrow("Simulated failure inside transaction");

    const entries = await uow.execute(async (ctx) => {
      return ctx.campaignReferenceBible!.findByCampaignId(campaignId);
    });

    expect(entries).toHaveLength(0);
  });

  it("retains active entry with audit upon campaign-level removal and restores stable tag on re-addition", async () => {
    const uow = new InMemorySceneUnitOfWork();
    const campaignId = "campaign-rem-test";

    await uow.execute(async (ctx) => {
      await ctx.campaignReferenceBible!.initializeSnapshot({
        campaignId,
        entries: [
          {
            referenceAssetId: "asset-rem",
            role: "subject_identity",
            description: "To be removed",
            biblePromptTag: "<Picture 1>",
            sourceContentHashSha256: "h-rem"
          }
        ]
      });
    });

    const removed = await uow.execute(async (ctx) => {
      const existing = await ctx.campaignReferenceBible!.findByCampaignAndAsset(
        campaignId,
        "asset-rem"
      );
      return ctx.campaignReferenceBible!.updateEntryWithAudit({
        campaignId,
        referenceAssetId: "asset-rem",
        expectedUpdatedAt: existing!.updatedAt,
        next: null,
        change: {
          changeReason: "removed",
          sourceSceneId: "scene-1",
          sourceSpecRevision: 2,
          sourceBindingId: "scene-1:2:asset-rem:subject_identity",
          actorKind: "director",
          actorId: "director-alice"
        }
      });
    });

    expect(removed.referenceAssetId).toBe("asset-rem");

    const entries = await uow.execute(async (ctx) => {
      return ctx.campaignReferenceBible!.findByCampaignId(campaignId);
    });
    expect(entries).toHaveLength(1);
    expect(entries[0]!.referenceAssetId).toBe("asset-rem");
    expect(entries[0]!.biblePromptTag).toBe("<Picture 1>");

    const assetEntry = await uow.execute(async (ctx) => {
      return ctx.campaignReferenceBible!.findByCampaignAndAsset(campaignId, "asset-rem");
    });
    expect(assetEntry).not.toBeNull();
    expect(assetEntry?.biblePromptTag).toBe("<Picture 1>");

    let changes = await uow.execute(async (ctx) => {
      return ctx.campaignReferenceBible!.listChanges(campaignId, "asset-rem");
    });
    expect(changes).toHaveLength(1);
    expect(changes[0]!.changeReason).toBe("removed");
    expect(changes[0]!.oldRole).toBe("subject_identity");
    expect(changes[0]!.newRole).toBeNull();
    expect(changes[0]!.oldBiblePromptTag).toBe("<Picture 1>");
    expect(changes[0]!.newBiblePromptTag).toBeNull();

    // Re-addition restores the original stable tag
    const readded = await uow.execute(async (ctx) => {
      return ctx.campaignReferenceBible!.updateEntryWithAudit({
        campaignId,
        referenceAssetId: "asset-rem",
        expectedUpdatedAt: removed.updatedAt,
        next: {
          role: "subject_identity",
          description: "Re-added description",
          biblePromptTag: removed.biblePromptTag,
          sourceContentHashSha256: "h-rem"
        },
        change: {
          changeReason: "added",
          sourceSceneId: "scene-1",
          sourceSpecRevision: 3,
          sourceBindingId: "scene-1:3:asset-rem:subject_identity",
          actorKind: "director",
          actorId: "director-alice",
          oldRole: null,
          oldDescription: null,
          oldBiblePromptTag: null,
          oldSourceContentHashSha256: null
        }
      });
    });

    expect(readded.biblePromptTag).toBe("<Picture 1>");

    changes = await uow.execute(async (ctx) => {
      return ctx.campaignReferenceBible!.listChanges(campaignId, "asset-rem");
    });
    expect(changes).toHaveLength(2);
    expect(changes[1]!.changeReason).toBe("added");
    expect(changes[1]!.oldRole).toBeNull();
    expect(changes[1]!.newRole).toBe("subject_identity");
    expect(changes[1]!.newBiblePromptTag).toBe("<Picture 1>");
  });
});
