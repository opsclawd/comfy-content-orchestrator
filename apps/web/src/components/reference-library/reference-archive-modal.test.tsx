// @vitest-environment jsdom
import React from "react";
import { describe, expect, it, vi, afterEach } from "vitest";
import { fireEvent, render, screen, cleanup, waitFor } from "@testing-library/react";
import { ReferenceArchiveModal } from "./reference-archive-modal.js";
import * as ClientModule from "../../api/client.js";
import type { ReferenceAssetResponse } from "@cco/contracts";

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe("ReferenceArchiveModal", () => {
  const sampleReference: ReferenceAssetResponse = {
    id: "22222222-2222-2222-2222-222222222222",
    clientId: "11111111-1111-1111-1111-111111111111",
    assetType: "image",
    storageBucket: "cco-reference-assets",
    storageObjectKey: "k1",
    contentHashSha256: "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855",
    mimeType: "image/png",
    displayName: "Hero Shot",
    libraryRole: "product",
    previewAvailability: "available",
    previewUrl: "https://example.com/asset.png"
  };

  it("does not render when isOpen is false or reference is null", () => {
    const { rerender } = render(
      <ReferenceArchiveModal
        reference={sampleReference}
        isOpen={false}
        onClose={vi.fn()}
        onArchiveSuccess={vi.fn()}
      />
    );
    expect(screen.queryByTestId("reference-archive-modal")).toBeNull();

    rerender(
      <ReferenceArchiveModal
        reference={null}
        isOpen={true}
        onClose={vi.fn()}
        onArchiveSuccess={vi.fn()}
      />
    );
    expect(screen.queryByTestId("reference-archive-modal")).toBeNull();
  });

  it("shows asset display name and confirms archive on click", async () => {
    const mockArchive = vi.spyOn(ClientModule, "archiveClientReference").mockResolvedValueOnce();
    const handleSuccess = vi.fn();
    const handleClose = vi.fn();

    render(
      <ReferenceArchiveModal
        reference={sampleReference}
        isOpen={true}
        onClose={handleClose}
        onArchiveSuccess={handleSuccess}
      />
    );

    expect(screen.getByText(/Hero Shot/)).toBeDefined();

    const confirmBtn = screen.getByTestId("archive-confirm-button");
    fireEvent.click(confirmBtn);

    await waitFor(() => {
      expect(mockArchive).toHaveBeenCalledWith(sampleReference.clientId, sampleReference.id);
      expect(handleSuccess).toHaveBeenCalledWith(sampleReference.id);
      expect(handleClose).toHaveBeenCalledTimes(1);
    });
  });
});
