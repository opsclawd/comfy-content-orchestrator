// @vitest-environment jsdom
import React from "react";
import { describe, expect, it, afterEach } from "vitest";
import { render, screen, cleanup } from "@testing-library/react";
import { ReferenceRoleBadge } from "./reference-role-badge.js";

afterEach(() => {
  cleanup();
});

describe("ReferenceRoleBadge", () => {
  it("renders formatted label for each role", () => {
    const { rerender } = render(<ReferenceRoleBadge role="subject_identity" />);
    expect(screen.getByTestId("reference-role-badge").textContent).toBe("Subject Identity");

    rerender(<ReferenceRoleBadge role="product" />);
    expect(screen.getByTestId("reference-role-badge").textContent).toBe("Product");

    rerender(<ReferenceRoleBadge role="location" />);
    expect(screen.getByTestId("reference-role-badge").textContent).toBe("Location");

    rerender(<ReferenceRoleBadge role="style" />);
    expect(screen.getByTestId("reference-role-badge").textContent).toBe("Style");

    rerender(<ReferenceRoleBadge role="composition" />);
    expect(screen.getByTestId("reference-role-badge").textContent).toBe("Composition");
  });

  it("renders Unassigned for null or undefined role", () => {
    const { rerender } = render(<ReferenceRoleBadge role={null} />);
    expect(screen.getByTestId("reference-role-badge").textContent).toBe("Unassigned");

    rerender(<ReferenceRoleBadge role={undefined} />);
    expect(screen.getByTestId("reference-role-badge").textContent).toBe("Unassigned");
  });
});
