// @vitest-environment jsdom
import React from "react";
import { describe, expect, it, vi, afterEach } from "vitest";
import { render, screen, fireEvent, cleanup } from "@testing-library/react";
import { SceneRolePickerModal } from "./scene-role-picker-modal";

describe("SceneRolePickerModal Component", () => {
  afterEach(() => {
    cleanup();
  });
  const sampleAsset = {
    id: "11111111-1111-4111-8111-111111111111",
    displayName: "Hero Bottle",
    libraryRole: "product",
    previewUrl: "https://example.com/bottle.png",
    previewAvailability: "available"
  };

  it("does not render when isOpen is false or asset is null", () => {
    const { container: c1 } = render(
      <SceneRolePickerModal
        isOpen={false}
        onClose={vi.fn()}
        onConfirm={vi.fn()}
        asset={sampleAsset}
      />
    );
    expect(c1.firstChild).toBeNull();

    const { container: c2 } = render(
      <SceneRolePickerModal isOpen={true} onClose={vi.fn()} onConfirm={vi.fn()} asset={null} />
    );
    expect(c2.firstChild).toBeNull();
  });

  it("renders asset preview, display name, and library role", () => {
    render(
      <SceneRolePickerModal
        isOpen={true}
        onClose={vi.fn()}
        onConfirm={vi.fn()}
        asset={sampleAsset}
      />
    );

    expect(screen.getByTestId("scene-role-picker-modal")).toBeDefined();
    expect(screen.getByTestId("role-picker-asset-name").textContent).toBe("Hero Bottle");
    expect(screen.getByTestId("modal-library-role").textContent).toContain("product");
    const preview = screen.getByTestId("role-picker-asset-preview") as HTMLImageElement;
    expect(preview.src).toBe("https://example.com/bottle.png");
  });

  it("distinguishes libraryRole from sceneRole and allows selecting explicit scene role", () => {
    const onConfirm = vi.fn();
    render(
      <SceneRolePickerModal
        isOpen={true}
        onClose={vi.fn()}
        onConfirm={onConfirm}
        asset={sampleAsset}
        initialRole="subject_identity"
      />
    );

    const select = screen.getByTestId("scene-role-select") as HTMLSelectElement;
    expect(select.value).toBe("subject_identity");

    fireEvent.change(select, { target: { value: "style" } });
    expect(select.value).toBe("style");

    fireEvent.click(screen.getByTestId("confirm-scene-role-button"));
    expect(onConfirm).toHaveBeenCalledWith("style");
  });

  it("calls onClose when cancel or close button is clicked", () => {
    const onClose = vi.fn();
    render(
      <SceneRolePickerModal
        isOpen={true}
        onClose={onClose}
        onConfirm={vi.fn()}
        asset={sampleAsset}
      />
    );

    fireEvent.click(screen.getByTestId("cancel-scene-role-button"));
    expect(onClose).toHaveBeenCalledTimes(1);

    fireEvent.click(screen.getByTestId("close-role-picker-button"));
    expect(onClose).toHaveBeenCalledTimes(2);
  });

  it("resets selectedRole when asset or initialRole changes", () => {
    const onConfirm = vi.fn();
    const { rerender } = render(
      <SceneRolePickerModal
        isOpen={true}
        onClose={vi.fn()}
        onConfirm={onConfirm}
        asset={sampleAsset}
        initialRole="subject_identity"
      />
    );

    const select = screen.getByTestId("scene-role-select") as HTMLSelectElement;
    expect(select.value).toBe("subject_identity");

    // Director changes the role in the dropdown
    fireEvent.change(select, { target: { value: "style" } });
    expect(select.value).toBe("style");

    // Re-render modal with a different asset / initialRole
    const secondAsset = {
      id: "22222222-2222-4222-8222-222222222222",
      displayName: "Elena Profile",
      libraryRole: "location",
      previewUrl: "https://example.com/elena.png",
      previewAvailability: "available"
    };

    rerender(
      <SceneRolePickerModal
        isOpen={true}
        onClose={vi.fn()}
        onConfirm={onConfirm}
        asset={secondAsset}
        initialRole="location"
      />
    );

    // selectedRole must reset to the new asset's initialRole ("location"), not stay "style"
    expect(select.value).toBe("location");

    fireEvent.click(screen.getByTestId("confirm-scene-role-button"));
    expect(onConfirm).toHaveBeenCalledWith("location");
  });
});
