import { type MinimaxH3AttentionVariantName } from "@cco/contracts";

export const UNAVAILABLE_UPSTREAM_CORE_REVISION = "94cfeb3a5d8985efaa7ea9f5e5dfad4184ec99bf";

export interface MinimaxH3CoreApiEvidence {
  kind: "core";
  comfyuiCoreRevision: string;
  supportedCliFlags: string[];
  sparseAttentionPresent: boolean;
  availableDispatchers?: string[] | undefined;
  auditedSourceFiles?: Record<string, string> | undefined;
  notes?: string | undefined;
}

export interface MinimaxH3SparseApiEvidence {
  kind: "sparse";
  status: string;
  candidateCoreRevision?: string | undefined;
  targetCoreRevision?: string | undefined;
  targetCoreStatus?: string | undefined;
  coreStatus?: string | undefined;
  apiUrl?: string | undefined;
  httpStatus?: number | undefined;
  checkedDate?: string | undefined;
  repository?: string | undefined;
  requestedRevision?: string | undefined;
  returnedMessage?: string | undefined;
  revision?: string | undefined;
  nodeId: string;
  classType: string;
  sourceFile?: string | undefined;
  sourceLines?: string | undefined;
  inputSignature: {
    required?: Record<string, unknown[]> | undefined;
    optional?: Record<string, unknown[]> | undefined;
  };
  returnTypes: string[];
  category?: string | undefined;
  exclusionHooks?:
    | {
        patchClass: string;
        sourceFile?: string | undefined;
        decisionMethods: string[];
        supportedExclusionReasons: string[];
      }
    | undefined;
  notes?: string | undefined;
}

export type MinimaxH3AttentionEvidence = MinimaxH3CoreApiEvidence | MinimaxH3SparseApiEvidence;

export const CONFIRMED_POSITIVE_SCHEMA_STATUSES: ReadonlySet<string> = new Set([
  "resolved",
  "schema_verified",
  "confirmed_available"
]);

export const CONFIRMED_POSITIVE_CORE_STATUSES: ReadonlySet<string> = new Set([
  "resolved",
  "commit_verified",
  "confirmed_available"
]);

export const KNOWN_SCHEMA_STATUSES: ReadonlySet<string> = new Set([
  "resolved",
  "schema_verified",
  "confirmed_available",
  "candidate_unresolved",
  "unresolved"
]);

export const KNOWN_CORE_STATUSES: ReadonlySet<string> = new Set([
  "resolved",
  "commit_verified",
  "confirmed_available",
  "candidate_unresolved",
  "unresolved"
]);

export function isCoreApiEvidence(raw: unknown): raw is MinimaxH3CoreApiEvidence {
  if (!raw || typeof raw !== "object") return false;
  const obj = raw as Record<string, unknown>;
  return (
    typeof obj.comfyuiCoreRevision === "string" &&
    typeof obj.sparseAttentionPresent === "boolean" &&
    Array.isArray(obj.supportedCliFlags)
  );
}

export function isSparseApiEvidence(raw: unknown): raw is MinimaxH3SparseApiEvidence {
  if (!raw || typeof raw !== "object") return false;
  const obj = raw as Record<string, unknown>;
  return (
    typeof obj.classType === "string" &&
    typeof obj.inputSignature === "object" &&
    obj.inputSignature !== null &&
    Array.isArray(obj.returnTypes)
  );
}

export function parseAttentionEvidence(raw: unknown): MinimaxH3AttentionEvidence {
  if (!raw || typeof raw !== "object") {
    throw new Error("Attention API evidence must be a non-null object.");
  }
  const obj = raw as Record<string, unknown>;

  if (isCoreApiEvidence(obj)) {
    return {
      kind: "core",
      comfyuiCoreRevision: obj.comfyuiCoreRevision as string,
      supportedCliFlags: obj.supportedCliFlags as string[],
      sparseAttentionPresent: Boolean(obj.sparseAttentionPresent),
      availableDispatchers: Array.isArray(obj.availableDispatchers)
        ? (obj.availableDispatchers as string[])
        : undefined,
      auditedSourceFiles:
        obj.auditedSourceFiles && typeof obj.auditedSourceFiles === "object"
          ? (obj.auditedSourceFiles as Record<string, string>)
          : undefined,
      notes: typeof obj.notes === "string" ? obj.notes : undefined
    };
  }

  if (isSparseApiEvidence(obj)) {
    if (typeof obj.status !== "string" || obj.status.trim() === "") {
      throw new Error("Sparse API evidence missing required string field 'status'.");
    }
    if (!KNOWN_SCHEMA_STATUSES.has(obj.status)) {
      throw new Error(
        `Invalid sparse API evidence status: "${obj.status}". Must be one of: ${Array.from(KNOWN_SCHEMA_STATUSES).join(", ")}.`
      );
    }
    if (obj.targetCoreStatus !== undefined) {
      if (
        typeof obj.targetCoreStatus !== "string" ||
        !KNOWN_CORE_STATUSES.has(obj.targetCoreStatus)
      ) {
        throw new Error(
          `Invalid targetCoreStatus: "${String(obj.targetCoreStatus)}". Must be one of: ${Array.from(KNOWN_CORE_STATUSES).join(", ")}.`
        );
      }
    }
    if (obj.coreStatus !== undefined) {
      if (typeof obj.coreStatus !== "string" || !KNOWN_CORE_STATUSES.has(obj.coreStatus)) {
        throw new Error(
          `Invalid coreStatus: "${String(obj.coreStatus)}". Must be one of: ${Array.from(KNOWN_CORE_STATUSES).join(", ")}.`
        );
      }
    }

    // Validate returnTypes
    if (
      !Array.isArray(obj.returnTypes) ||
      obj.returnTypes.length === 0 ||
      !obj.returnTypes.every((t) => typeof t === "string")
    ) {
      throw new Error("Invalid returnTypes: must be a non-empty array of strings.");
    }

    // Validate inputSignature
    const sig = obj.inputSignature as Record<string, unknown>;
    if (!sig.required && !sig.optional) {
      throw new Error("Invalid inputSignature: must declare 'required' or 'optional' section.");
    }
    for (const section of ["required", "optional"] as const) {
      if (sig[section] !== undefined) {
        if (!sig[section] || typeof sig[section] !== "object" || Array.isArray(sig[section])) {
          throw new Error(`Invalid inputSignature.${section}: must be an object.`);
        }
        for (const [k, v] of Object.entries(sig[section] as Record<string, unknown>)) {
          if (!Array.isArray(v) || v.length === 0) {
            throw new Error(
              `Invalid inputSignature.${section}.${k}: entry must be a non-empty spec array.`
            );
          }
        }
      }
    }

    return {
      kind: "sparse",
      status: obj.status,
      candidateCoreRevision:
        typeof obj.candidateCoreRevision === "string" ? obj.candidateCoreRevision : undefined,
      targetCoreRevision:
        typeof obj.targetCoreRevision === "string" ? obj.targetCoreRevision : undefined,
      targetCoreStatus: typeof obj.targetCoreStatus === "string" ? obj.targetCoreStatus : undefined,
      coreStatus: typeof obj.coreStatus === "string" ? obj.coreStatus : undefined,
      apiUrl: typeof obj.apiUrl === "string" ? obj.apiUrl : undefined,
      httpStatus: typeof obj.httpStatus === "number" ? obj.httpStatus : undefined,
      checkedDate: typeof obj.checkedDate === "string" ? obj.checkedDate : undefined,
      repository: typeof obj.repository === "string" ? obj.repository : undefined,
      requestedRevision:
        typeof obj.requestedRevision === "string" ? obj.requestedRevision : undefined,
      returnedMessage: typeof obj.returnedMessage === "string" ? obj.returnedMessage : undefined,
      revision: typeof obj.revision === "string" ? obj.revision : undefined,
      nodeId: typeof obj.nodeId === "string" ? obj.nodeId : (obj.classType as string),
      classType: obj.classType as string,
      sourceFile: typeof obj.sourceFile === "string" ? obj.sourceFile : undefined,
      sourceLines: typeof obj.sourceLines === "string" ? obj.sourceLines : undefined,
      inputSignature: obj.inputSignature as {
        required?: Record<string, unknown[]>;
        optional?: Record<string, unknown[]>;
      },
      returnTypes: obj.returnTypes as string[],
      category: typeof obj.category === "string" ? obj.category : undefined,
      exclusionHooks:
        obj.exclusionHooks && typeof obj.exclusionHooks === "object"
          ? (obj.exclusionHooks as MinimaxH3SparseApiEvidence["exclusionHooks"])
          : undefined,
      notes: typeof obj.notes === "string" ? obj.notes : undefined
    };
  }

  throw new Error(
    "Unrecognized attention API evidence format: must be either core attention evidence or sparse node API evidence."
  );
}

export interface AttentionEvidenceValidationResult {
  valid: boolean;
  isResolved: boolean;
  errors: string[];
  evidence?: MinimaxH3AttentionEvidence | undefined;
}

export interface ResolveAttentionEvidenceOptions {
  variant: MinimaxH3AttentionVariantName;
  evidence: unknown;
  coreRevision?: string | undefined;
  customNode?:
    | {
        repository?: string | undefined;
        revision?: string | undefined;
      }
    | undefined;
}

export function resolveAttentionEvidence(
  options: ResolveAttentionEvidenceOptions
): AttentionEvidenceValidationResult {
  const { variant, evidence: rawEvidence, coreRevision, customNode } = options;
  const errors: string[] = [];

  let evidence: MinimaxH3AttentionEvidence;
  try {
    evidence = parseAttentionEvidence(rawEvidence);
  } catch (err) {
    return {
      valid: false,
      isResolved: false,
      errors: [(err as Error).message]
    };
  }

  if (variant === "dense") {
    if (evidence.kind !== "core") {
      errors.push(`Variant "dense" requires core API evidence, got ${evidence.kind}.`);
      return { valid: false, isResolved: false, errors, evidence };
    }
    if (evidence.sparseAttentionPresent) {
      errors.push('Variant "dense" core evidence indicates sparseAttentionPresent is true.');
    }
    if (customNode) {
      errors.push(
        'Variant "dense" is a core ComfyUI mode and does not support a custom node definition.'
      );
    }
    if (coreRevision && coreRevision === UNAVAILABLE_UPSTREAM_CORE_REVISION) {
      errors.push(
        `ComfyUI core revision "${UNAVAILABLE_UPSTREAM_CORE_REVISION}" is unavailable upstream (HTTP 422 from GitHub API). Dense control cannot run on unavailable core.`
      );
    } else if (evidence.comfyuiCoreRevision === UNAVAILABLE_UPSTREAM_CORE_REVISION) {
      errors.push(
        `ComfyUI core revision "${UNAVAILABLE_UPSTREAM_CORE_REVISION}" is unavailable upstream (HTTP 422 from GitHub API). Dense control cannot run on unavailable core.`
      );
    } else if (coreRevision && evidence.comfyuiCoreRevision !== coreRevision) {
      errors.push(
        `Core revision mismatch: evidence declares "${evidence.comfyuiCoreRevision}", requested "${coreRevision}".`
      );
    }
    return {
      valid: errors.length === 0,
      isResolved: errors.length === 0,
      errors,
      evidence
    };
  }

  if (variant === "sage") {
    if (evidence.kind !== "core") {
      errors.push(`Variant "sage" requires core API evidence, got ${evidence.kind}.`);
      return { valid: false, isResolved: false, errors, evidence };
    }
    if (evidence.sparseAttentionPresent) {
      errors.push('Variant "sage" core evidence indicates sparseAttentionPresent is true.');
    }
    if (customNode) {
      errors.push(
        'Variant "sage" is a core ComfyUI mode and does not support a custom node definition.'
      );
    }
    if (!evidence.supportedCliFlags.includes("--use-sage-attention")) {
      errors.push(
        'Variant "sage" core evidence missing "--use-sage-attention" in supportedCliFlags.'
      );
    }
    if (coreRevision && coreRevision === UNAVAILABLE_UPSTREAM_CORE_REVISION) {
      errors.push(
        `ComfyUI core revision "${UNAVAILABLE_UPSTREAM_CORE_REVISION}" is unavailable upstream (HTTP 422 from GitHub API).`
      );
    } else if (evidence.comfyuiCoreRevision === UNAVAILABLE_UPSTREAM_CORE_REVISION) {
      errors.push(
        `ComfyUI core revision "${UNAVAILABLE_UPSTREAM_CORE_REVISION}" is unavailable upstream (HTTP 422 from GitHub API).`
      );
    } else if (coreRevision && evidence.comfyuiCoreRevision !== coreRevision) {
      errors.push(
        `Core revision mismatch: evidence declares "${evidence.comfyuiCoreRevision}", requested "${coreRevision}".`
      );
    }
    return {
      valid: errors.length === 0,
      isResolved: errors.length === 0,
      errors,
      evidence
    };
  }

  if (variant === "native-sol-attn") {
    if (evidence.kind !== "sparse") {
      errors.push(`Variant "native-sol-attn" requires sparse API evidence, got ${evidence.kind}.`);
      return { valid: false, isResolved: false, errors, evidence };
    }
    if (evidence.classType !== "ModelSparseAttention") {
      errors.push(
        `Variant "native-sol-attn" requires classType "ModelSparseAttention", got "${evidence.classType}".`
      );
    }
    if (evidence.returnTypes.indexOf("MODEL") === -1) {
      errors.push('Variant "native-sol-attn" evidence returnTypes must include "MODEL".');
    }

    // Explicit positive schema resolution state check
    if (!CONFIRMED_POSITIVE_SCHEMA_STATUSES.has(evidence.status)) {
      errors.push(
        `Attention candidate "native-sol-attn" schema status is not positively confirmed (got "${evidence.status}").`
      );
    }

    // Explicit positive core resolution status check
    const coreStatus = evidence.targetCoreStatus ?? evidence.coreStatus;
    if (!coreStatus || !CONFIRMED_POSITIVE_CORE_STATUSES.has(coreStatus)) {
      errors.push(
        `Attention candidate "native-sol-attn" core status is not positively confirmed (got "${coreStatus ?? "missing"}").`
      );
    }

    // Core revision match check
    const evCore = evidence.candidateCoreRevision ?? evidence.targetCoreRevision;
    if (!evCore) {
      errors.push('Variant "native-sol-attn" evidence does not declare a candidate core revision.');
    } else if (coreRevision && evCore !== coreRevision) {
      errors.push(
        `Core revision mismatch: evidence declares "${evCore}", requested "${coreRevision}".`
      );
    } else if (
      evCore === UNAVAILABLE_UPSTREAM_CORE_REVISION ||
      coreRevision === UNAVAILABLE_UPSTREAM_CORE_REVISION ||
      evidence.httpStatus === 422
    ) {
      errors.push(
        `Attention candidate "native-sol-attn" is unresolved upstream: commit "${evCore}" returned HTTP 422 ("No commit found for SHA"). Candidate cannot be constructed or validated.`
      );
    }

    // Custom node check
    if (customNode) {
      errors.push(
        'Variant "native-sol-attn" is a core ComfyUI node and does not support a custom node definition.'
      );
    }
    if (!evidence.repository || evidence.repository !== "https://github.com/Comfy-Org/ComfyUI") {
      errors.push(
        `Variant "native-sol-attn" repository mismatch: expected "https://github.com/Comfy-Org/ComfyUI", got "${evidence.repository ?? "missing"}".`
      );
    }

    if (!evidence.inputSignature?.required?.model) {
      errors.push('Variant "native-sol-attn" evidence missing required input "model".');
    }
    if (!evidence.inputSignature?.required?.sparse_type) {
      errors.push('Variant "native-sol-attn" evidence missing required input "sparse_type".');
    }

    return {
      valid: errors.length === 0,
      isResolved: errors.length === 0,
      errors,
      evidence
    };
  }

  if (variant === "veda") {
    if (evidence.kind !== "sparse") {
      errors.push(`Variant "veda" requires sparse API evidence, got ${evidence.kind}.`);
      return { valid: false, isResolved: false, errors, evidence };
    }
    if (evidence.classType !== "VedaSparseAttention") {
      errors.push(
        `Variant "veda" requires classType "VedaSparseAttention", got "${evidence.classType}".`
      );
    }
    if (evidence.returnTypes.indexOf("MODEL") === -1) {
      errors.push('Variant "veda" evidence returnTypes must include "MODEL".');
    }

    // Explicit positive schema resolution state check
    if (!CONFIRMED_POSITIVE_SCHEMA_STATUSES.has(evidence.status)) {
      errors.push(
        `Attention candidate "veda" schema status is not positively confirmed (got "${evidence.status}").`
      );
    }

    // Explicit positive core resolution status check
    const coreStatus = evidence.targetCoreStatus ?? evidence.coreStatus;
    if (!coreStatus || !CONFIRMED_POSITIVE_CORE_STATUSES.has(coreStatus)) {
      errors.push(
        `Attention candidate "veda" target core status is not positively confirmed (got "${coreStatus ?? "missing"}"). Target ComfyUI core revision "${evidence.targetCoreRevision ?? "unknown"}" is unresolved upstream.`
      );
    }

    // Core revision match check
    const evCore = evidence.targetCoreRevision ?? evidence.candidateCoreRevision;
    if (!evCore) {
      errors.push('Variant "veda" evidence does not declare a target core revision.');
    } else if (coreRevision && evCore !== coreRevision) {
      errors.push(
        `Core revision mismatch: evidence declares "${evCore}", requested "${coreRevision}".`
      );
    } else if (
      evCore === UNAVAILABLE_UPSTREAM_CORE_REVISION ||
      coreRevision === UNAVAILABLE_UPSTREAM_CORE_REVISION ||
      evidence.httpStatus === 422
    ) {
      errors.push(
        `Attention candidate "veda" has verified node schema but target ComfyUI core revision "${evCore}" is unresolved upstream (HTTP 422). Candidate cannot be constructed or validated.`
      );
    }

    // Custom node repository and revision binding
    if (!evidence.repository) {
      errors.push('Variant "veda" evidence missing required repository field.');
    } else if (customNode?.repository && evidence.repository !== customNode.repository) {
      errors.push(
        `Custom node repository mismatch: evidence declares "${evidence.repository}", requested "${customNode.repository}".`
      );
    }

    if (!evidence.revision) {
      errors.push('Variant "veda" evidence missing required revision field.');
    } else if (customNode?.revision && evidence.revision !== customNode.revision) {
      errors.push(
        `Custom node revision mismatch: evidence declares "${evidence.revision}", requested "${customNode.revision}".`
      );
    }

    const requiredKeys = [
      "model",
      "predictor",
      "generated_sparsity",
      "reference_sparsity",
      "full_attention_layers",
      "full_attention_steps",
      "verbose"
    ];
    for (const key of requiredKeys) {
      if (!evidence.inputSignature?.required?.[key]) {
        errors.push(`Variant "veda" evidence missing required input "${key}".`);
      }
    }

    return {
      valid: errors.length === 0,
      isResolved: errors.length === 0,
      errors,
      evidence
    };
  }

  errors.push(`Unsupported attention variant: "${variant}".`);
  return {
    valid: false,
    isResolved: false,
    errors,
    evidence
  };
}

export function validatePatchNodeAgainstFixture(
  node: { inputs?: Record<string, unknown>; class_type?: string; [key: string]: unknown },
  evidence: MinimaxH3SparseApiEvidence,
  unetLoaderId = "6"
): { valid: boolean; errors: string[] } {
  const errors: string[] = [];
  const nodeInputs = node.inputs ?? {};

  // 0. Check class_type
  if (node.class_type !== evidence.classType) {
    errors.push(
      `Patch node class_type mismatch: expected '${evidence.classType}', got '${String(node.class_type)}'.`
    );
  }

  // 1. Check returnTypes includes MODEL
  const modelSlot = evidence.returnTypes.indexOf("MODEL");
  if (modelSlot === -1) {
    errors.push(
      `Authoritative API fixture for ${evidence.classType} does not declare returnType "MODEL".`
    );
  }

  // 2. Check undeclared inputs
  const declared = new Set([
    ...Object.keys(evidence.inputSignature?.required ?? {}),
    ...Object.keys(evidence.inputSignature?.optional ?? {})
  ]);
  for (const inputKey of Object.keys(nodeInputs)) {
    if (!declared.has(inputKey)) {
      errors.push(
        `${evidence.classType} has undeclared input '${inputKey}' not present in authoritative API fixture schema.`
      );
    }
  }

  // 3. Check all required inputs
  const requiredInputs = evidence.inputSignature?.required ?? {};
  for (const [key, spec] of Object.entries(requiredInputs)) {
    if (nodeInputs[key] === undefined) {
      errors.push(`${evidence.classType} is missing required input '${key}'.`);
      continue;
    }
    const val = nodeInputs[key];
    validateInputType(key, val, spec, evidence.classType, unetLoaderId, errors);
  }

  // 4. Check provided optional inputs
  const optionalInputs = evidence.inputSignature?.optional ?? {};
  for (const [key, spec] of Object.entries(optionalInputs)) {
    if (nodeInputs[key] !== undefined) {
      const val = nodeInputs[key];
      validateInputType(key, val, spec, evidence.classType, unetLoaderId, errors);
    }
  }

  return {
    valid: errors.length === 0,
    errors
  };
}

function validateInputType(
  key: string,
  val: unknown,
  spec: unknown[],
  classType: string,
  unetLoaderId: string,
  errors: string[]
): void {
  const typeSpec = spec[0];
  const opts =
    spec.length > 1 && spec[1] && typeof spec[1] === "object"
      ? (spec[1] as Record<string, unknown>)
      : undefined;

  // Unaudited placeholder check
  if (typeof val === "string" && val.includes("not independently audited")) {
    errors.push(`${classType} input '${key}' uses invalid placeholder '${val}'.`);
    return;
  }

  if (typeSpec === "MODEL") {
    if (
      !Array.isArray(val) ||
      val.length !== 2 ||
      String(val[0]) !== unetLoaderId ||
      val[1] !== 0
    ) {
      errors.push(
        `${classType} input '${key}' must connect to UNETLoader (node ${unetLoaderId}) slot 0, got: ${JSON.stringify(val)}.`
      );
    }
  } else if (typeSpec === "BOOLEAN") {
    if (typeof val !== "boolean") {
      errors.push(
        `${classType} input '${key}' must be a boolean, got ${typeof val} (${JSON.stringify(val)}).`
      );
    }
  } else if (typeSpec === "INT") {
    if (typeof val !== "number" || !Number.isInteger(val)) {
      errors.push(
        `${classType} input '${key}' must be an integer, got ${typeof val} (${JSON.stringify(val)}).`
      );
    }
  } else if (typeSpec === "FLOAT") {
    if (typeof val !== "number") {
      errors.push(
        `${classType} input '${key}' must be a number (FLOAT), got ${typeof val} (${JSON.stringify(val)}).`
      );
    }
  } else if (typeSpec === "STRING") {
    if (typeof val !== "string") {
      errors.push(
        `${classType} input '${key}' must be a string, got ${typeof val} (${JSON.stringify(val)}).`
      );
    } else if (opts && Array.isArray(opts.options)) {
      if (!opts.options.includes(val)) {
        errors.push(
          `${classType} input '${key}' value '${val}' is not in allowed options: [${opts.options.join(", ")}].`
        );
      }
    }
  } else if (Array.isArray(typeSpec)) {
    // COMBO array of strings
    if (typeof val !== "string" || !typeSpec.includes(val)) {
      errors.push(
        `${classType} input '${key}' value ${JSON.stringify(val)} is not in allowed COMBO choices: [${typeSpec.join(", ")}].`
      );
    }
  } else if (typeSpec === "COMBO") {
    if (typeof val !== "string") {
      errors.push(
        `${classType} input '${key}' must be a string (COMBO option), got ${typeof val} (${JSON.stringify(val)}).`
      );
    } else if (opts && Array.isArray(opts.options) && opts.options.length > 0) {
      if (!opts.options.includes(val)) {
        errors.push(
          `${classType} input '${key}' value ${JSON.stringify(val)} is not in allowed COMBO options: [${opts.options.join(", ")}].`
        );
      }
    }
  } else {
    errors.push(
      `${classType} input '${key}' has unsupported schema type spec: ${JSON.stringify(typeSpec)}.`
    );
  }
}
