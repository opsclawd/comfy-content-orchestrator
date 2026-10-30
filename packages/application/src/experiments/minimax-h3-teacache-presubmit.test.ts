import { describe, expect, it } from "vitest";
import {
  TEACACHE_LOCAL_ADAPTER_DIGEST,
  TEACACHE_LOCAL_ADAPTER_FILE_HASHES,
  TEACACHE_NODE_INPUT_SIGNATURE_HASH,
  TEACACHE_NODE_KEY,
  type MinimaxH3CapabilityHandshake,
  type MinimaxH3ExperimentDescriptorV2
} from "@cco/contracts";
import { validateCapabilityHandshake } from "./minimax-h3-experiment-service.js";
import { teaCacheCatalogVariantForMode } from "./minimax-h3-teacache-catalog.js";

const COMFY = "/opt/comfyui";
const PKG = `${COMFY}/custom_nodes/cco-minimax-h3-teacache`;

function makeDesc(mode: "off" | "raw-l1-v1" | null): MinimaxH3ExperimentDescriptorV2 {
  return {
    runId: "run-1",
    requiredRuntime: {
      instrumentationProtocol: "v2-jsonl",
      requiredNodes: [
        {
          name: TEACACHE_NODE_KEY,
          moduleHash: TEACACHE_LOCAL_ADAPTER_FILE_HASHES["nodes.py"],
          moduleFileHashes: { ...TEACACHE_LOCAL_ADAPTER_FILE_HASHES },
          expectedInputSignatureHash: TEACACHE_NODE_INPUT_SIGNATURE_HASH
        }
      ],
      hooks: [],
      sourceFileHashes: {}
    },
    ...(mode ? { teacacheRequest: { mode, adapterDigest: TEACACHE_LOCAL_ADAPTER_DIGEST } } : {})
  } as unknown as MinimaxH3ExperimentDescriptorV2;
}

function makeHandshake(
  overrides: Record<string, unknown> = {},
  nodeOverrides: Record<string, unknown> = {}
): MinimaxH3CapabilityHandshake {
  return {
    status: "ok",
    protocol: "v2-jsonl",
    runId: "run-1",
    pid: 1,
    nonce: "n",
    attemptToken: "t",
    installedHooks: [],
    registeredNodes: {
      [TEACACHE_NODE_KEY]: {
        className: TEACACHE_NODE_KEY,
        moduleHash: TEACACHE_LOCAL_ADAPTER_FILE_HASHES["nodes.py"],
        packageFileHashes: { ...TEACACHE_LOCAL_ADAPTER_FILE_HASHES },
        inputSignatureHash: TEACACHE_NODE_INPUT_SIGNATURE_HASH,
        ...nodeOverrides
      }
    },
    teacacheAdapterIdentity: {
      verified: true,
      packageDir: PKG,
      observedDigest: TEACACHE_LOCAL_ADAPTER_DIGEST
    },
    ...overrides
  } as unknown as MinimaxH3CapabilityHandshake;
}

function conflictsFor(mode: "off" | "raw-l1-v1" | null, hs: MinimaxH3CapabilityHandshake) {
  return validateCapabilityHandshake(hs, { descV2: makeDesc(mode), comfyUiDir: COMFY }).filter(
    (c) => /TeaCache|required node/.test(c)
  );
}

describe.each(["off", "raw-l1-v1"] as const)("pre-submit TeaCache provenance (%s)", (mode) => {
  it("accepts a fully matching handshake", () => {
    expect(conflictsFor(mode, makeHandshake())).toEqual([]);
  });

  it("rejects a missing identity", () => {
    expect(conflictsFor(mode, makeHandshake({ teacacheAdapterIdentity: null }))).toEqual([
      expect.stringContaining("no resolved TeaCache adapter")
    ]);
  });

  it("rejects an unverified identity", () => {
    const hs = makeHandshake({
      teacacheAdapterIdentity: {
        verified: false,
        reason: "digest_mismatch",
        packageDir: PKG,
        observedDigest: TEACACHE_LOCAL_ADAPTER_DIGEST
      }
    });
    expect(conflictsFor(mode, hs).join("\n")).toContain("digest_mismatch");
  });

  it("rejects an observedDigest mismatch", () => {
    const hs = makeHandshake({
      teacacheAdapterIdentity: { verified: true, packageDir: PKG, observedDigest: "a".repeat(64) }
    });
    expect(conflictsFor(mode, hs).join("\n")).toContain("adapter digest mismatch");
  });

  it("rejects a packageDir outside comfyUiDir, including prefix siblings", () => {
    for (const dir of ["/x/other/custom_nodes/pkg", `${COMFY}-evil/custom_nodes/pkg`]) {
      const hs = makeHandshake({
        teacacheAdapterIdentity: {
          verified: true,
          packageDir: dir,
          observedDigest: TEACACHE_LOCAL_ADAPTER_DIGEST
        }
      });
      expect(conflictsFor(mode, hs).join("\n")).toContain("outside the audited checkout");
    }
  });

  it("rejects a drifted teacache.py package file hash", () => {
    const hs = makeHandshake(
      {},
      {
        packageFileHashes: { ...TEACACHE_LOCAL_ADAPTER_FILE_HASHES, "teacache.py": "b".repeat(64) }
      }
    );
    expect(conflictsFor(mode, hs).join("\n")).toContain('package file "teacache.py" hash mismatch');
  });

  it("rejects missing packageFileHashes and input signature hash", () => {
    const hs = makeHandshake({}, { packageFileHashes: undefined, inputSignatureHash: undefined });
    const text = conflictsFor(mode, hs).join("\n");
    expect(text).toContain("lacks packageFileHashes");
    expect(text).toContain("lacks inputSignatureHash");
  });

  it("rejects an input signature hash mismatch", () => {
    const hs = makeHandshake({}, { inputSignatureHash: "c".repeat(64) });
    expect(conflictsFor(mode, hs).join("\n")).toContain("input signature hash mismatch");
  });
});

describe("non-TeaCache runs", () => {
  it("ignore a null or unverified adapter identity", () => {
    const desc = makeDesc(null);
    desc.requiredRuntime.requiredNodes = [];
    const hs = makeHandshake({ teacacheAdapterIdentity: { verified: false } });
    const conflicts = validateCapabilityHandshake(hs, { descV2: desc, comfyUiDir: COMFY });
    expect(conflicts.filter((c) => /TeaCache/.test(c))).toEqual([]);
  });
});

describe("teaCacheCatalogVariantForMode", () => {
  it("maps off to matched-control and raw-l1-v1 to teacache-raw-l1", () => {
    expect(teaCacheCatalogVariantForMode("off")).toBe("matched-control");
    expect(teaCacheCatalogVariantForMode("raw-l1-v1")).toBe("teacache-raw-l1");
  });
});
