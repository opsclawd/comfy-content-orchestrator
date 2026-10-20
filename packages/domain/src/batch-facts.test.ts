import { describe, expect, it } from "vitest";
import {
  appendBatchFactsRevision,
  createInitialBatchFacts,
  rehydrateBatchFactsRevision,
  type BatchFactsRevision
} from "./batch-facts.js";
import { createBatchId, createClientId, createEvidenceId } from "./identifiers.js";
import { NonMonotonicRevisionError, ProductValidationError } from "./product-evidence-errors.js";

describe("BatchFactsRevision domain model", () => {
  const clientId = createClientId("018f0000-0000-7000-8000-000000000001");
  const batchId = createBatchId("018f0000-0002-7000-8000-000000000001");
  const evidenceId = createEvidenceId("018f0000-0007-7000-8000-000000000001");
  const actor = "ops@example.com";
  const timestamp1 = "2026-10-19T10:00:00.000Z";
  const timestamp2 = "2026-10-19T11:00:00.000Z";

  describe("Initial facts creation", () => {
    it("defaults to originKind unknown with explicit nulls when input is omitted", () => {
      const facts = createInitialBatchFacts(clientId, batchId, actor, timestamp1);

      expect(facts.clientId).toBe(clientId);
      expect(facts.batchId).toBe(batchId);
      expect(facts.revision).toBe(1);
      expect(facts.originKind).toBe("unknown");
      expect(facts.producerIdentityAsClaimed).toBeNull();
      expect(facts.productionStartDate).toBeNull();
      expect(facts.productionEndDate).toBeNull();
      expect(facts.originEvidenceId).toBeNull();
      expect(facts.originEvidenceRevision).toBeNull();
      expect(facts.assertedBy).toBe(actor);
      expect(facts.assertedAt).toBe(timestamp1);
      expect(facts.supersedesRevision).toBeNull();
    });

    it("populates explicit initial facts with own_production", () => {
      const facts = createInitialBatchFacts(clientId, batchId, actor, timestamp1, {
        originKind: "own_production",
        producerIdentityAsClaimed: "Internal Facility A",
        productionStartDate: "2026-05-01",
        productionEndDate: "2026-05-15",
        originEvidenceId: evidenceId,
        originEvidenceRevision: 1
      });

      expect(facts.originKind).toBe("own_production");
      expect(facts.producerIdentityAsClaimed).toBe("Internal Facility A");
      expect(facts.productionStartDate).toBe("2026-05-01");
      expect(facts.productionEndDate).toBe("2026-05-15");
      expect(facts.originEvidenceId).toBe(evidenceId);
      expect(facts.originEvidenceRevision).toBe(1);
    });

    it("supports partner_origin without asserting verified truth", () => {
      const facts = createInitialBatchFacts(clientId, batchId, actor, timestamp1, {
        originKind: "partner_origin",
        producerIdentityAsClaimed: "Partner Grower LLC"
      });

      expect(facts.originKind).toBe("partner_origin");
      expect(facts.producerIdentityAsClaimed).toBe("Partner Grower LLC");
      expect(facts.originEvidenceId).toBeNull();
    });

    it("enforces paired originEvidenceId and originEvidenceRevision", () => {
      expect(() =>
        createInitialBatchFacts(clientId, batchId, actor, timestamp1, {
          originKind: "own_production",
          originEvidenceId: evidenceId,
          originEvidenceRevision: null
        })
      ).toThrow(ProductValidationError);

      expect(() =>
        createInitialBatchFacts(clientId, batchId, actor, timestamp1, {
          originKind: "own_production",
          originEvidenceId: null,
          originEvidenceRevision: 1
        })
      ).toThrow(ProductValidationError);
    });

    it("enforces date ordering (startDate <= endDate)", () => {
      expect(() =>
        createInitialBatchFacts(clientId, batchId, actor, timestamp1, {
          originKind: "own_production",
          productionStartDate: "2026-06-01",
          productionEndDate: "2026-05-01" // start > end
        })
      ).toThrow(ProductValidationError);
    });
  });

  describe("Appending facts revisions", () => {
    it("advances revision monotonically and records supersedesRevision", () => {
      const rev1 = createInitialBatchFacts(clientId, batchId, actor, timestamp1);

      const rev2 = appendBatchFactsRevision(rev1, {
        originKind: "partner_origin",
        producerIdentityAsClaimed: "Verified Farm B",
        productionStartDate: "2026-01-01",
        productionEndDate: "2026-01-10",
        assertedBy: "lead_auditor@example.com",
        assertedAt: timestamp2
      });

      expect(rev2.revision).toBe(2);
      expect(rev2.supersedesRevision).toBe(1);
      expect(rev2.originKind).toBe("partner_origin");
      expect(rev2.producerIdentityAsClaimed).toBe("Verified Farm B");
      expect(rev2.assertedBy).toBe("lead_auditor@example.com");
      expect(rev2.assertedAt).toBe(timestamp2);

      // Verify rev1 was immutable
      expect(rev1.revision).toBe(1);
      expect(rev1.originKind).toBe("unknown");
    });

    it("rejects assertedAt earlier than previous facts", () => {
      const rev1 = createInitialBatchFacts(clientId, batchId, actor, timestamp2);

      expect(() =>
        appendBatchFactsRevision(rev1, {
          originKind: "partner_origin",
          assertedBy: actor,
          assertedAt: timestamp1 // earlier
        })
      ).toThrow(ProductValidationError);
    });
  });

  describe("Rehydration and invariants", () => {
    it("rehydrates valid revision sequence", () => {
      const rev1 = createInitialBatchFacts(clientId, batchId, actor, timestamp1);
      const rehydrated = rehydrateBatchFactsRevision(rev1);
      expect(rehydrated).toEqual(rev1);
    });

    it("rejects non-monotonic supersedesRevision during rehydration", () => {
      const invalid = {
        clientId,
        batchId,
        revision: 2,
        originKind: "own_production",
        producerIdentityAsClaimed: null,
        productionStartDate: null,
        productionEndDate: null,
        originEvidenceId: null,
        originEvidenceRevision: null,
        assertedBy: actor,
        assertedAt: timestamp1,
        supersedesRevision: null // revision 2 must supersede revision 1
      };

      expect(() => rehydrateBatchFactsRevision(invalid as unknown as BatchFactsRevision)).toThrow(
        NonMonotonicRevisionError
      );
    });
  });
});
