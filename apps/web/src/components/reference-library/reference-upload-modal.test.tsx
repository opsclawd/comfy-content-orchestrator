// @vitest-environment jsdom
import React from "react";
import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import { fireEvent, render, screen, cleanup, waitFor } from "@testing-library/react";
import { ReferenceUploadModal } from "./reference-upload-modal.js";
import * as ClientModule from "../../api/client.js";

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe("ReferenceUploadModal", () => {
  const testClientId = "11111111-1111-1111-1111-111111111111";

  beforeEach(() => {
    global.URL.createObjectURL = vi.fn().mockReturnValue("blob:mock-url");
    global.URL.revokeObjectURL = vi.fn();
  });

  it("does not render when isOpen is false", () => {
    render(
      <ReferenceUploadModal
        clientId={testClientId}
        isOpen={false}
        onClose={vi.fn()}
        onUploadSuccess={vi.fn()}
      />
    );
    expect(screen.queryByTestId("reference-upload-modal")).toBeNull();
  });

  it("validates file format and rejects unsupported formats", async () => {
    render(
      <ReferenceUploadModal
        clientId={testClientId}
        isOpen={true}
        onClose={vi.fn()}
        onUploadSuccess={vi.fn()}
      />
    );

    const fileInput = screen.getByTestId("reference-file-input");
    const badFile = new File(["bad content"], "test.txt", { type: "text/plain" });

    fireEvent.change(fileInput, { target: { files: [badFile] } });

    expect(screen.getByTestId("upload-error-banner").textContent).toContain("Unsupported format");
  });

  it("creates object URL preview and auto-populates display name", async () => {
    render(
      <ReferenceUploadModal
        clientId={testClientId}
        isOpen={true}
        onClose={vi.fn()}
        onUploadSuccess={vi.fn()}
      />
    );

    const fileInput = screen.getByTestId("reference-file-input");
    const validFile = new File(["pngdata"], "Hero-Shot.png", { type: "image/png" });

    fireEvent.change(fileInput, { target: { files: [validFile] } });

    expect(global.URL.createObjectURL).toHaveBeenCalledWith(validFile);
    expect(screen.getByTestId("upload-image-preview")).toBeDefined();

    const nameInput = screen.getByTestId("upload-display-name-input") as HTMLInputElement;
    expect(nameInput.value).toBe("Hero-Shot");
  });

  it("submits valid upload and calls onUploadSuccess", async () => {
    const mockUpload = vi.spyOn(ClientModule, "uploadClientReference").mockResolvedValueOnce({
      id: "22222222-2222-2222-2222-222222222222",
      clientId: testClientId,
      assetType: "image",
      storageBucket: "cco-reference-assets",
      storageObjectKey: "k1",
      contentHashSha256: "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855",
      mimeType: "image/png",
      displayName: "Hero Shot",
      libraryRole: "product",
      previewAvailability: "available",
      previewUrl: "https://example.com/asset.png"
    });

    const handleSuccess = vi.fn();
    const handleClose = vi.fn();

    render(
      <ReferenceUploadModal
        clientId={testClientId}
        isOpen={true}
        onClose={handleClose}
        onUploadSuccess={handleSuccess}
      />
    );

    const fileInput = screen.getByTestId("reference-file-input");
    const validFile = new File(["pngdata"], "Hero Shot.png", { type: "image/png" });
    fireEvent.change(fileInput, { target: { files: [validFile] } });

    const roleSelect = screen.getByTestId("upload-role-select");
    fireEvent.change(roleSelect, { target: { value: "product" } });

    const submitBtn = screen.getByTestId("upload-submit-button");
    fireEvent.click(submitBtn);

    await waitFor(() => {
      expect(mockUpload).toHaveBeenCalledWith(
        testClientId,
        expect.objectContaining({
          mimeType: "image/png",
          displayName: "Hero Shot",
          libraryRole: "product"
        })
      );
      expect(handleSuccess).toHaveBeenCalledTimes(1);
      expect(handleClose).toHaveBeenCalledTimes(1);
    });
  });
});
