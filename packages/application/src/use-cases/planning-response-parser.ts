export type ParsePlanningResponseResult =
  { readonly ok: true; readonly value: unknown } | { readonly ok: false; readonly reason: string };

export function parsePlanningResponse(rawText: string): ParsePlanningResponseResult {
  if (typeof rawText !== "string" || rawText.trim().length === 0) {
    return { ok: false, reason: "Response text is empty" };
  }

  let text = rawText.trim();

  // Strip reasoning blocks like <think>...</think> (e.g. DeepSeek R1, MiniMax M3, Qwen)
  text = text.replace(/<think>[\s\S]*?<\/think>/gi, "").trim();

  const codeBlockMatch = text.match(/```(?:json)?\s*([\s\S]*?)\s*```/i);
  if (codeBlockMatch && codeBlockMatch[1]) {
    text = codeBlockMatch[1].trim();
  } else if (text.startsWith("```")) {
    text = text.replace(/^```(?:json)?\s*\n?/i, "");
    text = text.replace(/\n?```\s*$/i, "");
    text = text.trim();
  }

  try {
    const value = JSON.parse(text);
    return { ok: true, value };
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error);
    return { ok: false, reason: `Failed to parse JSON: ${reason}` };
  }
}
