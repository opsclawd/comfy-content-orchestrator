import { describe, expect, it } from "vitest";
import { AccessDeniedError, createClientId } from "@cco/domain";
import { ConfiguredReviewerAuthorizationAdapter } from "./configured-reviewer-authorization-adapter.js";

describe("ConfiguredReviewerAuthorizationAdapter", () => {
  const clientA = createClientId("11111111-1111-4111-8111-111111111111");
  const clientB = createClientId("22222222-2222-4222-8222-222222222222");

  const adapter = new ConfiguredReviewerAuthorizationAdapter({
    [clientA]: {
      coaReviewers: ["actor-coa-1"],
      claimReviewers: ["actor-claim-1"],
      evidenceVerifiers: ["actor-verifier-1"]
    }
  });

  it("permits authorized actors for configured client and role", async () => {
    await expect(adapter.assertCanReviewCoaReport(clientA, "actor-coa-1")).resolves.toBeUndefined();
    await expect(adapter.assertCanReviewClaim(clientA, "actor-claim-1")).resolves.toBeUndefined();
    await expect(
      adapter.assertCanVerifyEvidence(clientA, "actor-verifier-1")
    ).resolves.toBeUndefined();
  });

  it("denies unconfigured actor for known client", async () => {
    await expect(adapter.assertCanReviewCoaReport(clientA, "intruder")).rejects.toThrow(
      AccessDeniedError
    );
    await expect(adapter.assertCanReviewClaim(clientA, "intruder")).rejects.toThrow(
      AccessDeniedError
    );
    await expect(adapter.assertCanVerifyEvidence(clientA, "intruder")).rejects.toThrow(
      AccessDeniedError
    );
  });

  it("denies actor for client with no grants", async () => {
    await expect(adapter.assertCanReviewCoaReport(clientB, "actor-coa-1")).rejects.toThrow(
      AccessDeniedError
    );
  });
});
