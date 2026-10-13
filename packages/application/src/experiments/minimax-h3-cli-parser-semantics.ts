import type { MinimaxH3MemoryPolicy, MinimaxH3ObservedEffectiveMode } from "@cco/contracts";

export interface PinnedSourceIdentities {
  readonly comfyuiRevision: string;
  readonly cliArgsSha256: string;
  readonly mainSha256: string;
  readonly modelManagementSha256: string;
}

export const PINNED_COMFYUI_CORE_REVISION = "55b6a9b11dffecdd65a3ccd5eb6a1b3a178c96dc";

export const PINNED_COMFYUI_SOURCE_HASHES = Object.freeze({
  cliArgsSha256: "139324c0ed7d0f70431a097032fec6fbe34e8b26f42d896e5364704b139defe8",
  mainSha256: "1ae7e09238355bcc2b415662e2baf2becdccb148ec27a46d053fabbd9a6b0e08",
  modelManagementSha256: "ddf5fe6399398d9101850d42604dce20eec0a6b6cba18135ea4ad5d3da3de99e"
});

export const FORBIDDEN_RUNNER_FLAGS = [
  "--highvram",
  "--gpu-only",
  "--novram",
  "--normalvram",
  "--cpu",
  "--enable-dynamic-vram"
] as const;

export function matchesFlag(arg: string, flag: string): boolean {
  return arg === flag || arg.startsWith(`${flag}=`);
}

export function hasFlag(argv: readonly string[], flag: string): boolean {
  return argv.some((arg) => matchesFlag(arg, flag));
}

export function validateRunnerVariantAndArgv(options: {
  variantName: string;
  variantReason: string | null;
  customArgv?: readonly string[];
}): {
  requestedPolicy: MinimaxH3MemoryPolicy;
  generatedArgv: readonly string[];
  predictedPolicy: MinimaxH3MemoryPolicy;
} {
  const { variantName, variantReason, customArgv = [] } = options;

  for (const forbidden of FORBIDDEN_RUNNER_FLAGS) {
    if (hasFlag(customArgv, forbidden)) {
      throw new Error(
        `Forbidden runner flag "${forbidden}" is not allowed in feasibility experiments.`
      );
    }
  }

  if (variantName === "dynamicvram-offload-v1") {
    if (hasFlag(customArgv, "--disable-dynamic-vram")) {
      throw new Error(
        `Runner variant "${variantName}" expects dynamic VRAM enabled, but --disable-dynamic-vram was passed.`
      );
    }
    if (hasFlag(customArgv, "--lowvram")) {
      throw new Error(
        `Runner variant "${variantName}" expects dynamic VRAM baseline, but --lowvram was passed.`
      );
    }

    return {
      requestedPolicy: "dynamic_vram",
      generatedArgv: Object.freeze([...customArgv]),
      predictedPolicy: "dynamic_vram"
    };
  }

  if (variantName === "static-lowvram-v1") {
    if (!variantReason || variantReason.trim().length === 0) {
      throw new Error(
        `Comparator variant "${variantName}" requires an explicit operator --variant-reason.`
      );
    }

    if (customArgv.length > 0) {
      const hasDisable = hasFlag(customArgv, "--disable-dynamic-vram");
      const hasLow = hasFlag(customArgv, "--lowvram");
      if (hasLow && !hasDisable) {
        throw new Error(
          `Lone --lowvram flag without --disable-dynamic-vram does not disable dynamic VRAM at pinned revision; comparator requires both flags.`
        );
      }
      if (hasDisable && !hasLow) {
        throw new Error(
          `--disable-dynamic-vram without --lowvram does not configure LOW_VRAM; comparator requires both flags.`
        );
      }
      if (!hasDisable || !hasLow) {
        throw new Error(
          `Comparator variant "${variantName}" requires both --disable-dynamic-vram and --lowvram.`
        );
      }
      return {
        requestedPolicy: "static_lowvram",
        generatedArgv: Object.freeze([...customArgv]),
        predictedPolicy: "static_lowvram"
      };
    }

    return {
      requestedPolicy: "static_lowvram",
      generatedArgv: Object.freeze(["--disable-dynamic-vram", "--lowvram"]),
      predictedPolicy: "static_lowvram"
    };
  }

  throw new Error(
    `Unsupported runner variant: "${variantName}". Supported variants: "dynamicvram-offload-v1", "static-lowvram-v1".`
  );
}

export function predictMemoryPolicyFromArgv(argv: readonly string[]): {
  predictedPolicy: MinimaxH3MemoryPolicy;
  flags: {
    disableDynamicVram: boolean;
    enableDynamicVram: boolean;
    lowvram: boolean;
    cpu: boolean;
  };
} {
  const cpu = hasFlag(argv, "--cpu");
  if (cpu) {
    throw new Error("--cpu flag is unsupported for GPU variable-frame feasibility experiments.");
  }

  const disableDynamicVram = hasFlag(argv, "--disable-dynamic-vram");
  const enableDynamicVram = hasFlag(argv, "--enable-dynamic-vram");
  const lowvram = hasFlag(argv, "--lowvram");

  if (enableDynamicVram) {
    throw new Error(
      "--enable-dynamic-vram is forbidden in this harness; dynamic VRAM is default at the pinned revision."
    );
  }

  // If lowvram is passed alone without disableDynamicVram, in pinned ComfyUI cli_args.py
  // dynamic VRAM is still enabled!
  if (lowvram && !disableDynamicVram) {
    return {
      predictedPolicy: "dynamic_vram",
      flags: { disableDynamicVram, enableDynamicVram, lowvram, cpu }
    };
  }

  if (disableDynamicVram && lowvram) {
    return {
      predictedPolicy: "static_lowvram",
      flags: { disableDynamicVram, enableDynamicVram, lowvram, cpu }
    };
  }

  return {
    predictedPolicy: "dynamic_vram",
    flags: { disableDynamicVram, enableDynamicVram, lowvram, cpu }
  };
}

export function analyzeStartupDiagnostics(
  logs: string,
  requestedPolicy: MinimaxH3MemoryPolicy,
  pinnedIdentities?: { sourceRevision: string; sourcePath: string; sourceDigest: string }
): MinimaxH3ObservedEffectiveMode {
  const normalized = logs.toLowerCase();
  const rawLines = logs.split(/\r?\n/).filter((l) => l.trim().length > 0);

  const fallbackIndicators = [
    "falling back to legacy model patcher",
    "falling back to legacy modelpatcher",
    "no working comfy-aimdo install detected",
    "failed to enable dynamic vram",
    "falling back to static",
    "dynamic vram disabled due to missing prerequisites"
  ];

  const hasFallback = fallbackIndicators.some((ind) => normalized.includes(ind));

  const dynamicEnabledIndicators = [
    "dynamicvram support detected and enabled",
    "dynamic vram is enabled",
    "using dynamic vram",
    "[aimdo] dynamic vram enabled"
  ];

  // Note: main.py:280 emits: "DynamicVRAM support detected and enabled"
  // Note: main.py:578-582 contains advisory text:
  // "Dynamic vram disabled with argument. If you have any issues with dynamic vram enabled please give us a detailed reports as this argument will be removed soon. If you use gguf we recommend keeping dynamic vram enabled..."
  // Advisory text in the disable warning must NOT be treated as positive dynamic enablement.
  const isPositiveDynamicLine = (lower: string): boolean => {
    if (
      lower.includes("disabled with argument") ||
      lower.includes("issues with dynamic vram") ||
      lower.includes("keeping dynamic vram")
    ) {
      return false;
    }
    return (
      dynamicEnabledIndicators.some((ind) => lower.includes(ind)) ||
      (lower.includes("dynamic vram enabled") && !lower.includes("disabled"))
    );
  };
  const hasDynamicEnabled = rawLines.some((l) => isPositiveDynamicLine(l.toLowerCase()));

  const dynamicDisabledIndicators = [
    "dynamic vram disabled with argument",
    "dynamic vram disabled",
    "disabling dynamic vram",
    "[aimdo] dynamic vram disabled"
  ];
  const hasDynamicDisabled = dynamicDisabledIndicators.some((ind) => normalized.includes(ind));

  const lowvramIndicators = [
    "set vram state to: low_vram",
    "set vram mode to: low_vram",
    "low_vram mode enabled",
    "vram state: low_vram",
    "lowvram mode"
  ];
  const hasLowVram = lowvramIndicators.some((ind) => normalized.includes(ind));

  const matchedDiagnostics = rawLines.filter((l) => {
    const lower = l.toLowerCase();
    return (
      isPositiveDynamicLine(lower) ||
      dynamicDisabledIndicators.some((ind) => lower.includes(ind)) ||
      lowvramIndicators.some((ind) => lower.includes(ind)) ||
      fallbackIndicators.some((ind) => lower.includes(ind))
    );
  });

  const evidence = {
    diagnostics: matchedDiagnostics,
    sourceRevision: pinnedIdentities?.sourceRevision ?? PINNED_COMFYUI_CORE_REVISION,
    sourcePath: pinnedIdentities?.sourcePath ?? "comfy/cli_args.py",
    sourceDigest: pinnedIdentities?.sourceDigest ?? PINNED_COMFYUI_SOURCE_HASHES.cliArgsSha256
  };

  if (requestedPolicy === "dynamic_vram") {
    if (hasFallback) {
      return {
        status: "unknown",
        value: null,
        unknownReason:
          "Prerequisite failure: ComfyUI logged fallback from dynamic VRAM to legacy patcher",
        evidence
      };
    }
    if (hasDynamicDisabled) {
      return {
        status: "unknown",
        value: null,
        unknownReason:
          "Contradictory diagnostic: dynamic VRAM was reported disabled when dynamic_vram was requested",
        evidence
      };
    }
    if (!hasDynamicEnabled) {
      return {
        status: "unknown",
        value: null,
        unknownReason:
          "Missing diagnostic: positive dynamic VRAM enablement was not observed in startup logs",
        evidence
      };
    }

    return {
      status: "verified",
      value: "dynamic_vram",
      unknownReason: null,
      evidence
    };
  }

  if (requestedPolicy === "static_lowvram") {
    if (!hasDynamicDisabled) {
      return {
        status: "unknown",
        value: null,
        unknownReason:
          "Missing diagnostic: explicit dynamic VRAM disablement was not observed in startup logs",
        evidence
      };
    }
    if (!hasLowVram) {
      return {
        status: "unknown",
        value: null,
        unknownReason:
          "Missing diagnostic: model_management LOW_VRAM mode was not observed in startup logs",
        evidence
      };
    }
    if (hasDynamicEnabled) {
      return {
        status: "unknown",
        value: null,
        unknownReason:
          "Contradictory diagnostic: dynamic VRAM reported enabled despite static_lowvram request",
        evidence
      };
    }

    return {
      status: "verified",
      value: "static_lowvram",
      unknownReason: null,
      evidence
    };
  }

  return {
    status: "unknown",
    value: null,
    unknownReason: `Unrecognized memory policy: ${String(requestedPolicy)}`,
    evidence
  };
}
