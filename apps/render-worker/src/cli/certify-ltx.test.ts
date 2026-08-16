import { describe, expect, it } from "vitest";
import { parseCertifyLtxCliArgs, runCertificationCli } from "./certify-ltx.js";
import { parseCertifyCliArgs, runCertificationCli as runCertifyCli } from "./certify.js";

describe("certify-ltx backwards-compatible wrapper", () => {
  it("exports parseCertifyLtxCliArgs and runCertificationCli matching certify.js", () => {
    expect(parseCertifyLtxCliArgs).toBe(parseCertifyCliArgs);
    expect(runCertificationCli).toBe(runCertifyCli);
  });
});
