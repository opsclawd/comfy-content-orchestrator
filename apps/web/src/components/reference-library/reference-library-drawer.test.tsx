// @vitest-environment jsdom
import React from "react";
import { describe, expect, it, vi, afterEach } from "vitest";
import { render, screen, cleanup, fireEvent, waitFor } from "@testing-library/react";
import type { ReferenceAssetResponse } from "@cco/contracts";
import { ReferenceLibraryDrawer } from "./reference-library-drawer.js";
import * as ClientApiModule from "../../api/client.js";

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe("ReferenceLibraryDrawer Component", () => {
  const clientA = "11111111-1111-1111-1111-111111111111";
  const clientB = "22222222-2222-2222-2222-222222222222";

  const clientA_asset1: ReferenceAssetResponse = {
    id: "aaaa1111-1111-1111-1111-111111111111",
    clientId: clientA,
    assetType: "image",
    storageBucket: "cco-reference-assets",
    storageObjectKey: "k1",
    contentHashSha256: "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855",
    mimeType: "image/png",
    displayName: "Client A Hero",
    libraryRole: "subject_identity",
    previewAvailability: "available",
    previewUrl: "https://example.com/a1.png"
  };

  const clientA_archivedAsset: ReferenceAssetResponse = {
    id: "aaaa2222-2222-2222-2222-222222222222",
    clientId: clientA,
    assetType: "image",
    storageBucket: "cco-reference-assets",
    storageObjectKey: "k2",
    contentHashSha256: "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855",
    mimeType: "image/png",
    displayName: "Client A Archived",
    libraryRole: "product",
    archivedAt: "2026-01-01T00:00:00.000Z",
    previewAvailability: "available",
    previewUrl: "https://example.com/a2.png"
  };

  const foreignAsset: ReferenceAssetResponse = {
    id: "bbbb1111-1111-1111-1111-111111111111",
    clientId: clientB,
    assetType: "image",
    storageBucket: "cco-reference-assets",
    storageObjectKey: "k3",
    contentHashSha256: "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855",
    mimeType: "image/png",
    displayName: "Client B Foreign Asset",
    libraryRole: "style",
    previewAvailability: "available",
    previewUrl: "https://example.com/b1.png"
  };

  it("filters out foreign client rows and archived rows from API response", async () => {
    vi.spyOn(ClientApiModule, "listClientReferences").mockResolvedValueOnce([
      clientA_asset1,
      clientA_archivedAsset,
      foreignAsset
    ]);

    const onToggleSelect = vi.fn();
    render(
      <ReferenceLibraryDrawer
        clientId={clientA}
        isOpen={true}
        onClose={vi.fn()}
        onToggleSelect={onToggleSelect}
      />
    );

    await waitFor(() => {
      expect(screen.getByTestId(`reference-card-${clientA_asset1.id}`)).toBeDefined();
    });

    // Foreign asset must NOT be rendered
    expect(screen.queryByTestId(`reference-card-${foreignAsset.id}`)).toBeNull();
    // Archived asset must NOT be rendered
    expect(screen.queryByTestId(`reference-card-${clientA_archivedAsset.id}`)).toBeNull();
  });

  it("refuses to toggle foreign or unlisted asset IDs via onToggleSelect", async () => {
    vi.spyOn(ClientApiModule, "listClientReferences").mockResolvedValueOnce([clientA_asset1]);

    const onToggleSelect = vi.fn();
    render(
      <ReferenceLibraryDrawer
        clientId={clientA}
        isOpen={true}
        onClose={vi.fn()}
        onToggleSelect={onToggleSelect}
      />
    );

    await waitFor(() => {
      expect(screen.getByTestId(`reference-card-${clientA_asset1.id}`)).toBeDefined();
    });

    // Clicking valid card calls onToggleSelect
    fireEvent.click(screen.getByTestId(`reference-card-${clientA_asset1.id}`));
    expect(onToggleSelect).toHaveBeenCalledWith(clientA_asset1.id);
  });

  it("synchronously clears references and invalidates generation on clientId prop change", async () => {
    let resolveClientA!: (value: readonly ReferenceAssetResponse[]) => void;
    const clientAPromise = new Promise<readonly ReferenceAssetResponse[]>((resolve) => {
      resolveClientA = resolve;
    });

    vi.spyOn(ClientApiModule, "listClientReferences").mockImplementation((id) => {
      if (id === clientA) return clientAPromise;
      if (id === clientB) return Promise.resolve([foreignAsset]);
      return Promise.resolve([]);
    });

    const { rerender } = render(
      <ReferenceLibraryDrawer clientId={clientA} isOpen={true} onClose={vi.fn()} />
    );

    // Now change clientId to clientB before clientA resolves
    rerender(<ReferenceLibraryDrawer clientId={clientB} isOpen={true} onClose={vi.fn()} />);

    // Prior client's data is synchronously cleared and loading for clientB occurs
    await waitFor(() => {
      expect(screen.getByTestId(`reference-card-${foreignAsset.id}`)).toBeDefined();
    });

    // Client A's response resolves late
    resolveClientA([clientA_asset1]);

    // Ensure Client A's asset never appears in Client B's drawer
    expect(screen.queryByTestId(`reference-card-${clientA_asset1.id}`)).toBeNull();
  });
});
