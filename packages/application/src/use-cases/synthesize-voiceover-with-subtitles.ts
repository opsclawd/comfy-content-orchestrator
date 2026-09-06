import type { SubtitleCue, VoiceoverAssetRef } from "@cco/contracts";
import type { GenerateSubtitleCues, SubtitleCueGroupingOptions } from "./generate-subtitle-cues.js";
import type { SynthesizeVoiceover, SynthesizeVoiceoverParams } from "./synthesize-voiceover.js";

export interface SynthesizeVoiceoverWithSubtitlesDependencies {
  readonly synthesizeVoiceover: SynthesizeVoiceover;
  readonly generateSubtitleCues: GenerateSubtitleCues;
}

export interface SynthesizeVoiceoverWithSubtitlesParams extends SynthesizeVoiceoverParams {
  readonly language?: string | undefined;
  readonly cueOptions?: SubtitleCueGroupingOptions | undefined;
}

export interface SynthesizeVoiceoverWithSubtitlesResult {
  readonly voiceover: VoiceoverAssetRef;
  readonly subtitleCues: readonly SubtitleCue[];
}

export class SynthesizeVoiceoverWithSubtitles {
  constructor(private readonly deps: SynthesizeVoiceoverWithSubtitlesDependencies) {}

  async synthesize(
    params: SynthesizeVoiceoverWithSubtitlesParams
  ): Promise<SynthesizeVoiceoverWithSubtitlesResult> {
    const { ref, audio } = await this.deps.synthesizeVoiceover.synthesizeWithAudio(params);

    const subtitleCues = await this.deps.generateSubtitleCues.generate({
      audio,
      text: params.text,
      voiceoverStartMs: ref.startMs,
      voiceoverDurationMs: ref.expectedDurationMs,
      language: params.language,
      cueOptions: params.cueOptions
    });

    return {
      voiceover: ref,
      subtitleCues
    };
  }
}
