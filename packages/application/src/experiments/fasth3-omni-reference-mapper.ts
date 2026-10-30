import {
  type FastH3OmniBindingManifest,
  FastH3OmniBindingManifestSchema,
  type FastH3OmniCampaignExportManifest,
  type FastH3OmniCapability,
  type FastH3OmniSlotBinding,
  computeFastH3OmniBindingDigest,
  sha256Hex
} from "@cco/contracts";

export interface MapFastH3OmniReferencesOptions {
  readonly manifest: FastH3OmniCampaignExportManifest;
  readonly prompt: string;
  readonly capability: FastH3OmniCapability;
}

export function mapCampaignReferencesToFastH3OmniBindings(
  options: MapFastH3OmniReferencesOptions
): FastH3OmniBindingManifest {
  const { manifest, prompt, capability } = options;

  if (!prompt || prompt.trim().length === 0) {
    throw new Error("Prompt cannot be empty for FastH3-Omni binding");
  }

  const refs = manifest.orderedReferences;
  if (!refs || refs.length === 0) {
    throw new Error("FastH3-Omni requires at least one ordered reference image");
  }

  if (refs.length < capability.minReferenceImages) {
    throw new Error(
      `Reference count ${refs.length} is below capability minimum ${capability.minReferenceImages}`
    );
  }

  if (refs.length > capability.maxReferenceImages) {
    throw new Error(
      `Reference count ${refs.length} exceeds capability maximum ${capability.maxReferenceImages}`
    );
  }

  // Reject remote URLs (privacy fence)
  for (const ref of refs) {
    if (
      ref.localPath &&
      (ref.localPath.startsWith("http://") || ref.localPath.startsWith("https://"))
    ) {
      throw new Error(
        `Remote URL "${ref.localPath}" is forbidden; only immutable local assets are permitted`
      );
    }
  }

  // Validate distinct reference entries (no duplicate asset IDs or content hashes)
  const seenAssetIds = new Set<string>();
  const seenHashes = new Set<string>();
  for (let i = 0; i < refs.length; i++) {
    const ref = refs[i]!;
    if (seenAssetIds.has(ref.assetId)) {
      throw new Error(
        `Duplicate reference asset ID "${ref.assetId}" detected at slot ${i}. Distinct references required.`
      );
    }
    seenAssetIds.add(ref.assetId);

    if (seenHashes.has(ref.contentHashSha256)) {
      throw new Error(
        `Duplicate reference content hash "${ref.contentHashSha256}" detected at slot ${i}. Distinct references required.`
      );
    }
    seenHashes.add(ref.contentHashSha256);
  }

  // Check keyframes against capability
  const hasFirst = Boolean(manifest.optionalFirstFrame);
  const hasLast = Boolean(manifest.optionalLastFrame);
  if ((hasFirst || hasLast) && !capability.supportsKeyframes) {
    throw new Error(
      "Keyframes (first/last frame) are not supported by the selected FastH3-Omni capability"
    );
  }

  // Check audio references against capability
  const audioRefs = manifest.optionalAudioReferences;
  if (audioRefs && audioRefs.length > 0 && !capability.supportsAudio) {
    throw new Error("Audio references are not supported by the selected FastH3-Omni capability");
  }

  // Construct ordered bindings: index i -> slotIndex: i, order: i, tag: <Picture i+1>
  const orderedBindings: FastH3OmniSlotBinding[] = refs.map((ref, idx) => ({
    slotIndex: idx,
    tag: `<Picture ${idx + 1}>`,
    assetId: ref.assetId,
    contentHashSha256: ref.contentHashSha256,
    semanticPurposes: [...ref.semanticPurposes],
    boundOrder: idx
  }));

  // Parse all <Picture N> tags in the prompt
  const tagMatches = Array.from(prompt.matchAll(/<Picture\s+(\d+)>/g));
  if (tagMatches.length === 0) {
    throw new Error(
      `Authored prompt lacks required <Picture N> binding tags for the ${refs.length} reference image(s)`
    );
  }

  const referencedNumbers = new Set<number>();
  for (const match of tagMatches) {
    const num = parseInt(match[1]!, 10);
    if (num < 1 || num > refs.length) {
      throw new Error(
        `Prompt references out-of-range tag <Picture ${num}>; valid range is 1 to ${refs.length}`
      );
    }
    referencedNumbers.add(num);
  }

  // Check for tag gaps
  for (let i = 1; i <= refs.length; i++) {
    if (!referencedNumbers.has(i)) {
      throw new Error(
        `Prompt has a tag gap or missing reference: <Picture ${i}> is not present in prompt text`
      );
    }
  }

  const renderedPrompt = prompt.trim();
  const promptDigest = sha256Hex(renderedPrompt);

  const baseManifest = {
    schemaVersion: 1 as const,
    campaignId: manifest.campaignId,
    sceneId: manifest.sceneId,
    specRevision: manifest.specRevision,
    referenceSetId: manifest.referenceSetId,
    orderedBindings,
    sourcePrompt: prompt,
    renderedPrompt,
    promptDigest,
    ...(hasFirst || hasLast
      ? {
          keyframes: {
            firstFrame: manifest.optionalFirstFrame ?? null,
            lastFrame: manifest.optionalLastFrame ?? null
          }
        }
      : {}),
    ...(audioRefs && audioRefs.length > 0 ? { audioReferences: audioRefs } : {})
  };

  const bindingDigest = computeFastH3OmniBindingDigest(baseManifest);

  const completeManifest = {
    ...baseManifest,
    bindingDigest
  };

  return FastH3OmniBindingManifestSchema.parse(completeManifest);
}
