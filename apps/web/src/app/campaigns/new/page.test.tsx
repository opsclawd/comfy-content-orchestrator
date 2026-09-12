import { describe, expect, it, vi } from "vitest";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import NewCampaignPage, { dynamic } from "./page.js";

vi.mock("next/navigation", () => ({
  useRouter: () => ({
    push: vi.fn(),
    refresh: vi.fn()
  })
}));

describe("NewCampaignPage Component", () => {
  it("exports dynamic = 'force-dynamic'", () => {
    expect(dynamic).toBe("force-dynamic");
  });

  it("renders the CampaignCreationForm inside container", () => {
    const html = renderToStaticMarkup(<NewCampaignPage />);
    expect(html).toContain('class="campaign-page-container"');
    expect(html).toContain('data-testid="campaign-creation-surface"');
    expect(html).toContain('data-testid="campaign-creation-form"');
    expect(html).toContain("Create &amp; Plan Campaign");
  });
});
