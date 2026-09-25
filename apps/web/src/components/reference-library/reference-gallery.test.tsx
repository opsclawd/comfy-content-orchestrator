// @vitest-environment jsdom
import React from "react";
import { describe, expect, it, afterEach } from "vitest";
import { render, screen, cleanup } from "@testing-library/react";
import type { ReferenceAssetResponse } from "@cco/contracts";
import { ReferenceGallery } from "./reference-gallery.js";

afterEach(() => {
  cleanup();
});

describe("ReferenceGallery", () => {
  const activeAsset: ReferenceAssetResponse = {
    id: "11111111-1111-1111-1111-111111111111",
    clientId: "22222222-2222-2222-2222-222222222222",
    assetType: "image",
    storageBucket: "cco-reference-assets",
    storageObjectKey: "k1",
    contentHashSha256: "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855",
    mimeType: "image/png",
    displayName: "Active Asset",
    libraryRole: "subject_identity",
    previewAvailability: "available",
    previewUrl: "https://example.com/active.png"
  };

  const archivedAsset: ReferenceAssetResponse = {
    id: "33333333-3333-3333-3333-333333333333",
    clientId: "22222222-2222-2222-2222-222222222222",
    assetType: "image",
    storageBucket: "cco-reference-assets",
    storageObjectKey: "k2",
    contentHashSha256: "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855",
    mimeType: "image/png",
    displayName: "Archived Asset",
    libraryRole: "product",
    archivedAt: "2026-01-01T00:00:00.000Z",
    previewAvailability: "available",
    previewUrl: "https://example.com/archived.png"
  };

  it("filters out archived references and displays active ones", () => {
    render(<ReferenceGallery references={[activeAsset, archivedAsset]} />);

    expect(screen.getByTestId(`reference-card-${activeAsset.id}`)).toBeDefined();
    expect(screen.queryByTestId(`reference-card-${archivedAsset.id}`)).toBeNull();
  });

  it("renders loading state", () => {
    render(<ReferenceGallery references={[]} isLoading={true} />);
    expect(screen.getByTestId("reference-gallery-loading")).toBeDefined();
  });

  it("renders error state", () => {
    render(<ReferenceGallery references={[]} error="Failed to fetch" />);
    expect(screen.getByTestId("reference-gallery-error").textContent).toContain("Failed to fetch");
  });

  it("renders empty state when no active references exist", () => {
    render(<ReferenceGallery references={[]} />);
    expect(screen.getByTestId("reference-gallery-empty")).toBeDefined();
  });
});
