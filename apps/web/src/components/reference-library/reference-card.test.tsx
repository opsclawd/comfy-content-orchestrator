// @vitest-environment jsdom
import React from "react";
import { describe, expect, it, vi, afterEach } from "vitest";
import { fireEvent, render, screen, cleanup } from "@testing-library/react";
import type { ReferenceAssetResponse } from "@cco/contracts";
import { ReferenceCard } from "./reference-card.js";

afterEach(() => {
  cleanup();
});

describe("ReferenceCard", () => {
  const sampleReference: ReferenceAssetResponse = {
    id: "11111111-1111-1111-1111-111111111111",
    clientId: "22222222-2222-2222-2222-222222222222",
    assetType: "image",
    storageBucket: "cco-reference-assets",
    storageObjectKey: "clients/2222/references/hash1",
    contentHashSha256: "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855",
    width: 1024,
    height: 768,
    mimeType: "image/png",
    displayName: "Hero Character Model",
    libraryRole: "subject_identity",
    previewAvailability: "available",
    previewUrl: "https://s3.example.com/asset.png"
  };

  it("renders display name, role badge, image preview, and dimensions", () => {
    render(<ReferenceCard reference={sampleReference} />);

    expect(screen.getByTestId("reference-display-name").textContent).toBe("Hero Character Model");
    expect(screen.getByTestId("reference-role-badge").textContent).toBe("Subject Identity");
    expect(screen.getByTestId("reference-thumbnail")).toBeDefined();
    expect(screen.getByText("1024×768")).toBeDefined();
    expect(screen.getByText("PNG")).toBeDefined();
  });

  it("renders fallback UI when previewAvailability is unavailable", () => {
    const unavailableRef: ReferenceAssetResponse = {
      ...sampleReference,
      previewAvailability: "unavailable",
      previewUrl: null
    };

    render(<ReferenceCard reference={unavailableRef} />);
    expect(screen.getByTestId("reference-thumbnail-fallback")).toBeDefined();
    expect(screen.queryByTestId("reference-thumbnail")).toBeNull();
  });

  it("triggers onToggleSelect when clicked in selectable mode", () => {
    const handleToggle = vi.fn();
    render(
      <ReferenceCard
        reference={sampleReference}
        selectable={true}
        isSelected={false}
        onToggleSelect={handleToggle}
      />
    );

    const card = screen.getByTestId(`reference-card-${sampleReference.id}`);
    expect(card.getAttribute("aria-checked")).toBe("false");
    fireEvent.click(card);
    expect(handleToggle).toHaveBeenCalledWith(sampleReference.id);
  });

  it("calls onArchive when archive button is clicked", () => {
    const handleArchive = vi.fn();
    render(<ReferenceCard reference={sampleReference} onArchive={handleArchive} />);

    const archiveBtn = screen.getByTestId("archive-reference-button");
    fireEvent.click(archiveBtn);
    expect(handleArchive).toHaveBeenCalledWith(sampleReference);
  });
});
