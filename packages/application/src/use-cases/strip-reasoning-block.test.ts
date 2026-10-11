import { describe, it, expect } from "vitest";
import { stripReasoningBlock } from "./strip-reasoning-block.js";

describe("stripReasoningBlock", () => {
  it("removes a single <think>...</think> block", () => {
    const input = "<think>Analyze the image</think>A person sitting at a desk.";
    expect(stripReasoningBlock(input)).toBe("A person sitting at a desk.");
  });

  it("removes multiline <think>...</think> blocks", () => {
    const input = `<think>
1. Identify subjects.
2. Note lighting and environment.
</think>
A golden retriever running across an open grassy meadow.`;
    expect(stripReasoningBlock(input)).toBe(
      "A golden retriever running across an open grassy meadow."
    );
  });

  it("removes multiple <think>...</think> blocks", () => {
    const input = "<think>First thought</think>Part one.<think>Second thought</think>Part two.";
    expect(stripReasoningBlock(input)).toBe("Part one.Part two.");
  });

  it("handles case-insensitivity in think tags", () => {
    const input = "<THINK>\nUppercase thought\n</THINK>Valid description.";
    expect(stripReasoningBlock(input)).toBe("Valid description.");

    const mixed = "<Think>Mixed</think>Description.";
    expect(stripReasoningBlock(mixed)).toBe("Description.");
  });

  it("trims surrounding whitespace from the remaining content", () => {
    const input = "  <think>Thought</think>   A landscape at sunset.   \n";
    expect(stripReasoningBlock(input)).toBe("A landscape at sunset.");
  });

  it("returns empty string when output contains only <think> blocks", () => {
    const input = `<think>
Just internal deliberations and no actual output.
</think>`;
    expect(stripReasoningBlock(input)).toBe("");
  });

  it("returns empty string for empty or whitespace-only input", () => {
    expect(stripReasoningBlock("")).toBe("");
    expect(stripReasoningBlock("   \n\t  ")).toBe("");
  });

  it("returns empty string for non-string input", () => {
    expect(stripReasoningBlock(null as unknown as string)).toBe("");
    expect(stripReasoningBlock(undefined as unknown as string)).toBe("");
  });

  it("returns text unchanged (trimmed) when no <think> block is present", () => {
    const input = "  A futuristic skyscraper reaching into cloudy skies.  ";
    expect(stripReasoningBlock(input)).toBe("A futuristic skyscraper reaching into cloudy skies.");
  });

  it("leaves unmatched opening or closing tags untouched", () => {
    const unmatchedOpen = "<think>This tag is never closed. Description text.";
    expect(stripReasoningBlock(unmatchedOpen)).toBe(
      "<think>This tag is never closed. Description text."
    );

    const unmatchedClose = "Some text</think> without opening tag.";
    expect(stripReasoningBlock(unmatchedClose)).toBe("Some text</think> without opening tag.");
  });
});
