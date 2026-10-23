import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import {
  BlockedBadge,
  DerivativeBadge,
  IndependentlyCorroboratedBadge,
  OperatorAttestedBadge,
  OperatorReviewedBadge,
  ReportedBadge,
  UnknownBadge
} from "./provenance-badges.js";

describe("provenance-badges", () => {
  it("renders ReportedBadge with default or custom detail", () => {
    const defaultHtml = renderToStaticMarkup(<ReportedBadge />);
    expect(defaultHtml).toContain("Reported");

    const customHtml = renderToStaticMarkup(
      <ReportedBadge detail="Lab Intake" testId="custom-reported" />
    );
    expect(customHtml).toContain("Lab Intake");
    expect(customHtml).toContain('data-testid="custom-reported"');
  });

  it("renders OperatorAttestedBadge with attestation label", () => {
    const html = renderToStaticMarkup(
      <OperatorAttestedBadge detail="Attested by Operator" testId="op-attest" />
    );
    expect(html).toContain("Operator-Attested");
    expect(html).toContain("Attested by Operator");
    expect(html).toContain('data-testid="op-attest"');
  });

  it("renders OperatorReviewedBadge indicating approved or rejected", () => {
    const approvedHtml = renderToStaticMarkup(
      <OperatorReviewedBadge isApproved={true} detail="Approved by Lead" />
    );
    expect(approvedHtml).toContain("Operator-Reviewed");
    expect(approvedHtml).toContain("Approved by Lead");

    const rejectedHtml = renderToStaticMarkup(
      <OperatorReviewedBadge isApproved={false} detail="Rejected by QA" />
    );
    expect(rejectedHtml).toContain("Operator-Reviewed");
    expect(rejectedHtml).toContain("Rejected by QA");
  });

  it("renders IndependentlyCorroboratedBadge", () => {
    const html = renderToStaticMarkup(
      <IndependentlyCorroboratedBadge detail="Lab Third-Party Audit" />
    );
    expect(html).toContain("Independently Sourced");
    expect(html).toContain("Lab Third-Party Audit");
  });

  it("renders UnknownBadge clearly alerting missing or unverified data", () => {
    const html = renderToStaticMarkup(<UnknownBadge detail="Missing Harvest Date" />);
    expect(html).toContain("Unknown");
    expect(html).toContain("Missing Harvest Date");
  });

  it("renders BlockedBadge indicating why a claim or asset is blocked", () => {
    const html = renderToStaticMarkup(<BlockedBadge detail="Mismatched SKU" />);
    expect(html).toContain("Blocked");
    expect(html).toContain("Mismatched SKU");
  });

  it("renders DerivativeBadge with transform info", () => {
    const html = renderToStaticMarkup(<DerivativeBadge detail="Thumbnail WebP" />);
    expect(html).toContain("Derivative");
    expect(html).toContain("Thumbnail WebP");
  });
});
