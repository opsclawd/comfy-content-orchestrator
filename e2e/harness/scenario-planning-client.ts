import type {
  PlanningModelClientPort,
  PlanningModelOutcome,
  PlanningModelRequest
} from "@cco/application";
import type { CreativeBrief } from "@cco/contracts";

export class ScenarioPlanningModelClient implements PlanningModelClientPort {
  beatSheetInvocations = 0;
  sceneConfigInvocations = 0;
  failCountRemaining = 0;
  shouldThrow = false;
  targetSceneCountOverride?: number | undefined;
  emittedBeats: Array<{ ordinal: number; brief: CreativeBrief; targetDurationMs: number }> = [];

  constructor(readonly providerName: "Anthropic" | "OpenAI" = "Anthropic") {}

  reset(): void {
    this.beatSheetInvocations = 0;
    this.sceneConfigInvocations = 0;
    this.failCountRemaining = 0;
    this.shouldThrow = false;
    this.targetSceneCountOverride = undefined;
    this.emittedBeats = [];
  }

  setFailNext(count: number = 1): void {
    this.failCountRemaining = count;
  }

  async complete(request: PlanningModelRequest): Promise<PlanningModelOutcome> {
    if (this.shouldThrow || this.failCountRemaining > 0) {
      if (this.failCountRemaining > 0) {
        this.failCountRemaining--;
      }
      return {
        kind: "retryable_failure",
        message: "Simulated planning provider outage"
      };
    }

    if (request.userPrompt.includes("Total Required Scenes:")) {
      this.beatSheetInvocations++;

      const totalScenesMatch = request.userPrompt.match(/Total Required Scenes:\s*(\d+)/);
      const totalDurationMatch = request.userPrompt.match(/Target Total Duration:\s*(\d+)\s*ms/);
      if (!totalScenesMatch) {
        throw new Error("Missing 'Total Required Scenes:' marker in planning request userPrompt");
      }
      if (!totalDurationMatch) {
        throw new Error("Missing 'Target Total Duration:' marker in planning request userPrompt");
      }
      const parsedScenes = parseInt(totalScenesMatch[1]!, 10);
      const totalScenes = this.targetSceneCountOverride ?? parsedScenes;
      const targetTotalDurationMs = parseInt(totalDurationMatch[1]!, 10);

      const baseDuration = Math.floor(targetTotalDurationMs / totalScenes);
      const remainder = targetTotalDurationMs - baseDuration * totalScenes;

      const beats = Array.from({ length: totalScenes }, (_, i) => ({
        ordinal: i + 1,
        brief: {
          title: `Scene Beat ${i + 1}`,
          description: `Visual description for scene beat ${i + 1}`
        },
        targetDurationMs: i === 0 ? baseDuration + remainder : baseDuration
      }));
      this.emittedBeats = beats;

      return {
        kind: "success",
        rawText: JSON.stringify({ beats })
      };
    }

    this.sceneConfigInvocations++;
    const durationMatch = request.systemPrompt.match(/must equal exactly (\d+)/);
    if (!durationMatch) {
      throw new Error(
        "Missing 'must equal exactly <duration>' marker in scene-config systemPrompt"
      );
    }
    const durationMs = parseInt(durationMatch[1]!, 10);

    return {
      kind: "success",
      rawText: JSON.stringify({
        prompt: `Scene visual prompt ${this.sceneConfigInvocations}`,
        referenceIds: [],
        engineProfileId: "LTX_25_720P_5S_V1",
        durationMs,
        loraConfigurationId: null
      })
    };
  }
}
