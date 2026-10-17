import { describe, expect, it } from "vitest";
import type { ClientRecord } from "@cco/domain";
import { InMemorySceneUnitOfWork } from "../test-support/in-memory-scene-unit-of-work.js";
import { ListClientsUseCase } from "./list-clients.js";
import type { UnitOfWork, UnitOfWorkContext } from "../ports/index.js";

describe("ListClientsUseCase", () => {
  const createClientRecord = (id: string, companyName: string): ClientRecord => ({
    id,
    companyName,
    brandBibleJson: {},
    defaultAspectRatio: "9:16",
    externalProcessingPolicy: {},
    createdAt: "2026-09-01T00:00:00.000Z",
    updatedAt: "2026-09-01T00:00:00.000Z"
  });

  it("returns empty array when no clients are registered", async () => {
    const uow = new InMemorySceneUnitOfWork();
    const useCase = new ListClientsUseCase(uow);

    const result = await useCase.execute();
    expect(result).toEqual([]);
  });

  it("returns lightweight client summaries sorted deterministically by companyName ASC then clientId ASC", async () => {
    const clientB = createClientRecord("018e69e0-8a6a-72cb-b1b7-ec79a1f73802", "Beta Studios");
    const clientA2 = createClientRecord("018e69e0-8a6a-72cb-b1b7-ec79a1f73809", "Acme Corp");
    const clientA1 = createClientRecord("018e69e0-8a6a-72cb-b1b7-ec79a1f73801", "Acme Corp");
    const clientZ = createClientRecord("018e69e0-8a6a-72cb-b1b7-ec79a1f73800", "Zenith Media");

    const uow = new InMemorySceneUnitOfWork(undefined, undefined, undefined, undefined, [
      clientB,
      clientA2,
      clientA1,
      clientZ
    ]);
    const useCase = new ListClientsUseCase(uow);

    const result = await useCase.execute();

    expect(result).toEqual([
      {
        clientId: "018e69e0-8a6a-72cb-b1b7-ec79a1f73801",
        companyName: "Acme Corp"
      },
      {
        clientId: "018e69e0-8a6a-72cb-b1b7-ec79a1f73809",
        companyName: "Acme Corp"
      },
      {
        clientId: "018e69e0-8a6a-72cb-b1b7-ec79a1f73802",
        companyName: "Beta Studios"
      },
      {
        clientId: "018e69e0-8a6a-72cb-b1b7-ec79a1f73800",
        companyName: "Zenith Media"
      }
    ]);
  });

  it("includes staged client mutations within the transaction", async () => {
    const seededClient = createClientRecord(
      "018e69e0-8a6a-72cb-b1b7-ec79a1f73801",
      "Old Name Corp"
    );
    const uow = new InMemorySceneUnitOfWork(undefined, undefined, undefined, undefined, [
      seededClient
    ]);

    const result = await uow.execute(async (context) => {
      // Update seeded client's name in staged collection
      await context.clients!.save({
        ...seededClient,
        companyName: "Updated Name Corp"
      });
      // Add a new client in staged collection
      await context.clients!.save(
        createClientRecord("018e69e0-8a6a-72cb-b1b7-ec79a1f73802", "Alpha Corp")
      );

      return context.clients!.listActive();
    });

    expect(result).toEqual([
      {
        clientId: "018e69e0-8a6a-72cb-b1b7-ec79a1f73802",
        companyName: "Alpha Corp"
      },
      {
        clientId: "018e69e0-8a6a-72cb-b1b7-ec79a1f73801",
        companyName: "Updated Name Corp"
      }
    ]);
  });

  it("throws when context.clients is undefined", async () => {
    const brokenUow: UnitOfWork = {
      execute: async <T>(work: (context: UnitOfWorkContext) => Promise<T>): Promise<T> => {
        return work({} as unknown as UnitOfWorkContext);
      }
    };
    const useCase = new ListClientsUseCase(brokenUow);

    await expect(useCase.execute()).rejects.toThrow(
      "UnitOfWorkContext.clients is not configured for this UnitOfWork implementation."
    );
  });
});
