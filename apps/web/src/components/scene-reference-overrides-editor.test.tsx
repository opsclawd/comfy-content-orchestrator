// @vitest-environment jsdom
import React from "react";
import { describe, expect, it, vi, afterEach } from "vitest";
import { render, screen, fireEvent, cleanup } from "@testing-library/react";
import type { ReferenceAssetResponse } from "@cco/contracts";
import {
  SceneReferenceOverridesEditor,
  type VisualReferenceBindingItem
} from "./scene-reference-overrides-editor";

vi.mock("./reference-library/reference-library-drawer", () => ({
  ReferenceLibraryDrawer: ({
    isOpen,
    onSelectAsset
  }: {
    readonly isOpen: boolean;
    readonly onSelectAsset?: (asset: ReferenceAssetResponse) => void;
  }) => {
    if (!isOpen) return null;
    const asset1: ReferenceAssetResponse = {
      id: "11111111-1111-4111-8111-111111111111",
      clientId: "00000000-0000-4000-8000-000000000001",
      assetType: "image",
      storageBucket: "cco-reference-assets",
      storageObjectKey: "asset1.png",
      contentHashSha256: "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855",
      mimeType: "image/png",
      displayName: "Asset 1",
      libraryRole: "style",
      previewAvailability: "unavailable",
      previewUrl: null
    };
    const asset2: ReferenceAssetResponse = {
      id: "22222222-2222-4222-8222-222222222222",
      clientId: "00000000-0000-4000-8000-000000000001",
      assetType: "image",
      storageBucket: "cco-reference-assets",
      storageObjectKey: "asset2.png",
      contentHashSha256: "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855",
      mimeType: "image/png",
      displayName: "Asset 2",
      libraryRole: "location",
      previewAvailability: "unavailable",
      previewUrl: null
    };
    return (
      <div data-testid="mock-drawer">
        <button data-testid="mock-select-asset-1" onClick={() => onSelectAsset?.(asset1)}>
          Select Asset 1
        </button>
        <button data-testid="mock-select-asset-2" onClick={() => onSelectAsset?.(asset2)}>
          Select Asset 2
        </button>
      </div>
    );
  }
}));

describe("SceneReferenceOverridesEditor Component", () => {
  afterEach(() => {
    cleanup();
  });
  const sampleBindings: readonly VisualReferenceBindingItem[] = [
    {
      referenceAssetId: "11111111-1111-4111-8111-111111111111",
      role: "subject_identity",
      displayName: "Elena Front",
      libraryRole: "subject_identity",
      previewUrl: "https://example.com/elena.png",
      previewAvailability: "available"
    },
    {
      referenceAssetId: "22222222-2222-4222-8222-222222222222",
      role: "product",
      displayName: "Hero Bottle",
      libraryRole: "product",
      previewUrl: null,
      previewAvailability: "unavailable"
    }
  ];

  it("renders empty message when bindings array is empty", () => {
    render(
      <SceneReferenceOverridesEditor clientId="client-123" bindings={[]} onChange={vi.fn()} />
    );

    expect(screen.getByTestId("empty-references-message")).toBeDefined();
    expect(screen.getByTestId("add-reference-button")).toBeDefined();
  });

  it("renders visual cards for current scene reference overrides", () => {
    render(
      <SceneReferenceOverridesEditor
        clientId="client-123"
        bindings={sampleBindings}
        onChange={vi.fn()}
      />
    );

    expect(
      screen.getByTestId("reference-override-card-11111111-1111-4111-8111-111111111111")
    ).toBeDefined();
    expect(
      screen.getByTestId("reference-override-card-22222222-2222-4222-8222-222222222222")
    ).toBeDefined();

    expect(
      screen.getByTestId("reference-name-11111111-1111-4111-8111-111111111111").textContent
    ).toBe("Elena Front");
    expect(
      screen.getByTestId("reference-library-role-11111111-1111-4111-8111-111111111111").textContent
    ).toContain("subject_identity");

    const select = screen.getByTestId(
      "scene-role-select-11111111-1111-4111-8111-111111111111"
    ) as HTMLSelectElement;
    expect(select.value).toBe("subject_identity");
  });

  it("updates scene role when selector changes and notifies onChange", () => {
    const onChange = vi.fn();
    render(
      <SceneReferenceOverridesEditor
        clientId="client-123"
        bindings={sampleBindings}
        onChange={onChange}
      />
    );

    const select = screen.getByTestId(
      "scene-role-select-11111111-1111-4111-8111-111111111111"
    ) as HTMLSelectElement;
    fireEvent.change(select, { target: { value: "location" } });

    expect(onChange).toHaveBeenCalledTimes(1);
    const updated = onChange.mock.calls[0]?.[0];
    expect(updated[0].role).toBe("location");
    expect(updated[1].role).toBe("product");
  });

  it("removes a reference binding when Remove button is clicked", () => {
    const onChange = vi.fn();
    render(
      <SceneReferenceOverridesEditor
        clientId="client-123"
        bindings={sampleBindings}
        onChange={onChange}
      />
    );

    const removeBtn = screen.getByTestId("remove-reference-11111111-1111-4111-8111-111111111111");
    fireEvent.click(removeBtn);

    expect(onChange).toHaveBeenCalledTimes(1);
    const updated = onChange.mock.calls[0]?.[0];
    expect(updated.length).toBe(1);
    expect(updated[0].referenceAssetId).toBe("22222222-2222-4222-8222-222222222222");
  });

  it("displays maximum reached banner and hides add button when 9 bindings exist", () => {
    const nineBindings: VisualReferenceBindingItem[] = Array.from({ length: 9 }, (_, i) => ({
      referenceAssetId: `ref-${i}`,
      role: "subject_identity",
      displayName: `Ref ${i}`
    }));

    render(
      <SceneReferenceOverridesEditor
        clientId="client-123"
        bindings={nineBindings}
        onChange={vi.fn()}
      />
    );

    expect(screen.getByTestId("max-references-reached")).toBeDefined();
    expect(screen.queryByTestId("add-reference-button")).toBeNull();
  });

  it("displays warning if clientId is missing", () => {
    render(<SceneReferenceOverridesEditor bindings={[]} onChange={vi.fn()} />);

    expect(screen.getByTestId("no-client-warning")).toBeDefined();
    expect(screen.queryByTestId("add-reference-button")).toBeNull();
  });

  it("resets scene role to initialRole across consecutive asset selections from the drawer", () => {
    const onChange = vi.fn();
    render(
      <SceneReferenceOverridesEditor clientId="client-123" bindings={[]} onChange={onChange} />
    );

    // 1. Open drawer
    fireEvent.click(screen.getByTestId("add-reference-button"));
    expect(screen.getByTestId("mock-drawer")).toBeDefined();

    // 2. Select first asset (libraryRole: "style")
    fireEvent.click(screen.getByTestId("mock-select-asset-1"));

    // Modal should now be open for asset 1
    expect(screen.getByTestId("scene-role-picker-modal")).toBeDefined();
    expect(screen.getByTestId("role-picker-asset-name").textContent).toBe("Asset 1");
    const roleSelect1 = screen.getByTestId("scene-role-select") as HTMLSelectElement;
    expect(roleSelect1.value).toBe("style");

    // Director changes role to "product"
    fireEvent.change(roleSelect1, { target: { value: "product" } });
    expect(roleSelect1.value).toBe("product");

    // Close without applying
    fireEvent.click(screen.getByTestId("close-role-picker-button"));
    expect(screen.queryByTestId("scene-role-picker-modal")).toBeNull();

    // 3. Open drawer again and select second asset (libraryRole: "location")
    fireEvent.click(screen.getByTestId("add-reference-button"));
    fireEvent.click(screen.getByTestId("mock-select-asset-2"));

    // Modal should now be open for asset 2 and role must be "location", NOT retained "product"
    expect(screen.getByTestId("scene-role-picker-modal")).toBeDefined();
    expect(screen.getByTestId("role-picker-asset-name").textContent).toBe("Asset 2");
    const roleSelect2 = screen.getByTestId("scene-role-select") as HTMLSelectElement;
    expect(roleSelect2.value).toBe("location");

    // Confirm and apply
    fireEvent.click(screen.getByTestId("confirm-scene-role-button"));
    expect(onChange).toHaveBeenCalledTimes(1);
    const addedItem = onChange.mock.calls[0]?.[0]?.[0];
    expect(addedItem.referenceAssetId).toBe("22222222-2222-4222-8222-222222222222");
    expect(addedItem.role).toBe("location");
  });
});
