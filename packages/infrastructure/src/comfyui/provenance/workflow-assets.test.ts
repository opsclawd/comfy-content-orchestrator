import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { hashWorkflow, VALID_MODEL_CATEGORIES } from "./hasher.js";
import { loadCertificationProfile } from "./profile-manifest.js";

describe("Workflow Assets and Provenance Records", () => {
  const manifestPath = fileURLToPath(
    new URL("../../../../../templates/provenance.json", import.meta.url)
  );

  it("Gold Master workflows are API-format object maps with pinned canonical hashes", async () => {
    const profileIds = ["flux-schnell-draft", "ltx-25-720p-97f"] as const;

    for (const profileId of profileIds) {
      const profile = await loadCertificationProfile(manifestPath, profileId);
      const rawContent = await readFile(profile.workflowPath, "utf8");
      const parsed = JSON.parse(rawContent) as unknown;

      // Assert API format (plain object map, not an array or GUI format with 'nodes' array)
      expect(typeof parsed).toBe("object");
      expect(parsed).not.toBeNull();
      expect(Array.isArray(parsed)).toBe(false);
      expect(Array.isArray((parsed as Record<string, unknown>).nodes)).toBe(false);

      // Verify every entry is a valid node map entry
      const entries = Object.entries(parsed as Record<string, unknown>);
      expect(entries.length).toBeGreaterThan(0);
      for (const [nodeId, nodeData] of entries) {
        expect(typeof nodeId).toBe("string");
        expect(typeof nodeData).toBe("object");
        expect(nodeData).not.toBeNull();
        const nodeObj = nodeData as Record<string, unknown>;
        expect(typeof nodeObj.class_type).toBe("string");
        expect(typeof nodeObj.inputs).toBe("object");
        expect(nodeObj.inputs).not.toBeNull();
      }

      // Recompute canonical hash and assert match
      const actualHash = hashWorkflow(rawContent);
      expect(actualHash).toBe(profile.expectedWorkflowHash);
      expect(actualHash).toMatch(/^[0-9a-f]{64}$/);
    }
  });

  it("FLUX Gold Master pins the validated four-step sampler node", async () => {
    const profile = await loadCertificationProfile(manifestPath, "flux-schnell-draft");
    const rawContent = await readFile(profile.workflowPath, "utf8");
    const workflow = JSON.parse(rawContent) as Record<
      string,
      { class_type: string; inputs: Record<string, unknown> }
    >;

    expect(profile.assertions.length).toBeGreaterThan(0);

    for (const assertion of profile.assertions) {
      const node = workflow[assertion.nodeId];
      expect(node, `Node ${assertion.nodeId} must exist in workflow`).toBeDefined();
      expect(node?.class_type).toBe(assertion.classType);
      expect(node?.inputs[assertion.input]).toEqual(assertion.equals);
    }

    // Explicitly assert sampler steps is 4 and matches baseline
    expect(profile.baseline.steps).toBe(4);
    const samplerAssertion = profile.assertions.find((a) => a.input === "steps" && a.equals === 4);
    expect(samplerAssertion).toBeDefined();
    const samplerNode = workflow[samplerAssertion!.nodeId];
    expect(samplerNode).toBeDefined();
    expect(samplerNode?.inputs.steps).toBe(4);
  });

  it("LTX Gold Master pins 720p 97-frame eight-step baseline nodes", async () => {
    const profile = await loadCertificationProfile(manifestPath, "ltx-25-720p-97f");
    const rawContent = await readFile(profile.workflowPath, "utf8");
    const workflow = JSON.parse(rawContent) as Record<
      string,
      { class_type: string; inputs: Record<string, unknown> }
    >;

    expect(profile.assertions.length).toBeGreaterThan(0);

    for (const assertion of profile.assertions) {
      const node = workflow[assertion.nodeId];
      expect(node, `Node ${assertion.nodeId} must exist in workflow`).toBeDefined();
      expect(node?.class_type).toBe(assertion.classType);
      expect(node?.inputs[assertion.input]).toEqual(assertion.equals);
    }

    // Assert baseline values
    expect(profile.baseline.steps).toBe(8);
    expect(profile.baseline.frames).toBe(97);
    expect(profile.baseline.width).toBe(1280);
    expect(profile.baseline.height).toBe(720);
    expect(profile.baseline.approximateDurationSeconds).toBe(5);

    // Assert node assertions resolve to 720p, 97 frames, 8 steps
    const stepsAssertion = profile.assertions.find((a) => a.input === "steps" && a.equals === 8);
    expect(stepsAssertion).toBeDefined();
    const stepsNode = workflow[stepsAssertion!.nodeId];
    expect(stepsNode).toBeDefined();
    expect(stepsNode?.inputs.steps).toBe(8);

    const framesAssertion = profile.assertions.find(
      (a) =>
        (a.input === "length" ||
          a.input === "frame_count" ||
          a.input === "num_frames" ||
          a.input === "frames") &&
        a.equals === 97
    );
    expect(framesAssertion).toBeDefined();
    const framesNode = workflow[framesAssertion!.nodeId];
    expect(framesNode).toBeDefined();
    expect(framesNode?.inputs[framesAssertion!.input]).toBe(97);

    const widthAssertion = profile.assertions.find((a) => a.input === "width" && a.equals === 1280);
    expect(widthAssertion).toBeDefined();
    const widthNode = workflow[widthAssertion!.nodeId];
    expect(widthNode).toBeDefined();
    expect(widthNode?.inputs.width).toBe(1280);

    const heightAssertion = profile.assertions.find(
      (a) => a.input === "height" && a.equals === 720
    );
    expect(heightAssertion).toBeDefined();
    const heightNode = workflow[heightAssertion!.nodeId];
    expect(heightNode).toBeDefined();
    expect(heightNode?.inputs.height).toBe(720);
  });

  it("Gold Master profiles identify every referenced certification model file", async () => {
    const profileIds = ["flux-schnell-draft", "ltx-25-720p-97f"] as const;
    const validCategorySet = new Set<string>(VALID_MODEL_CATEGORIES);

    for (const profileId of profileIds) {
      const profile = await loadCertificationProfile(manifestPath, profileId);
      expect(profile.models.length).toBeGreaterThan(0);

      const seenKeys = new Set<string>();
      for (const model of profile.models) {
        expect(validCategorySet.has(model.category)).toBe(true);
        expect(model.relativePath.trim().length).toBeGreaterThan(0);
        expect(model.relativePath.startsWith("/")).toBe(false);
        expect(model.relativePath.includes("..")).toBe(false);

        const key = `${model.category}/${model.relativePath}`;
        expect(seenKeys.has(key)).toBe(false);
        seenKeys.add(key);
      }
    }
  });

  it("Gold Master provenance contains immutable source and license evidence", async () => {
    const profileIds = ["flux-schnell-draft", "ltx-25-720p-97f"] as const;
    const placeholderPatterns = [/placeholder/i, /todo/i, /example\.com/i, /<.*>/, /^\.+$/];

    for (const profileId of profileIds) {
      const profile = await loadCertificationProfile(manifestPath, profileId);

      expect(["official_upstream", "validated_host_export", "authored_from_spec"]).toContain(
        profile.source.kind
      );
      expect(profile.source.uri.trim().length).toBeGreaterThan(0);
      expect(profile.source.revision.trim().length).toBeGreaterThan(0);
      expect(profile.source.license.trim().length).toBeGreaterThan(0);

      for (const pattern of placeholderPatterns) {
        expect(profile.source.uri).not.toMatch(pattern);
        expect(profile.source.revision).not.toMatch(pattern);
        expect(profile.source.license).not.toMatch(pattern);
      }
    }

    // Assert README.md exists and contains explanations without placeholders
    const readmePath = fileURLToPath(
      new URL("../../../../../templates/README.md", import.meta.url)
    );
    const readmeContent = await readFile(readmePath, "utf8");
    expect(readmeContent.trim().length).toBeGreaterThan(0);
    for (const pattern of placeholderPatterns) {
      expect(readmeContent).not.toMatch(pattern);
    }
    expect(readmeContent).toContain("flux-schnell-draft");
    expect(readmeContent).toContain("ltx-25-720p-97f");
    expect(readmeContent).toContain("SHA-256");
    expect(readmeContent).toContain("DynamicVRAM");
  });

  it("LTX Gold Master enforces the 100 GB DynamicVRAM profile", async () => {
    const profile = await loadCertificationProfile(manifestPath, "ltx-25-720p-97f");

    expect(profile.minFreeDiskGb).toBe(100);
    expect(profile.runnerProfile).toBe("dynamicvram-offload-v1");
    expect(profile.renderProfileIdentity).toEqual({
      key: "LTX_25_720P_5S_V1",
      version: 1
    });

    const fluxProfile = await loadCertificationProfile(manifestPath, "flux-schnell-draft");
    expect(fluxProfile.renderProfileIdentity).toEqual({
      key: "FLUX_SCHNELL_DRAFT_V1",
      version: 1
    });
    expect(fluxProfile.minFreeDiskGb).toBe(0);
  });
});
