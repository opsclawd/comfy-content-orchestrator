/**
 * Strips `<think>...</think>` reasoning blocks (e.g. DeepSeek R1, MiniMax M3, Qwen)
 * from model output and trims surrounding whitespace.
 */
export function stripReasoningBlock(text: string): string {
  if (typeof text !== "string") {
    return "";
  }
  return text.replace(/<think>[\s\S]*?<\/think>/gi, "").trim();
}
