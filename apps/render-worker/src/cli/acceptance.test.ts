import { describe, expect, it } from "vitest";
import {
  AcceptanceCliError,
  getAcceptanceUsageHelp,
  parseAcceptanceCliArgs
} from "./acceptance.js";

describe("parseAcceptanceCliArgs", () => {
  it("defaults to help when no subcommand is given", () => {
    expect(parseAcceptanceCliArgs([])).toEqual({
      subcommand: "help",
      clientId: undefined,
      idempotencyKey: undefined
    });
  });

  it("parses the verify subcommand with no flags", () => {
    expect(parseAcceptanceCliArgs(["verify"])).toEqual({
      subcommand: "verify",
      clientId: undefined,
      idempotencyKey: undefined
    });
  });

  it("parses the preflight subcommand with no flags", () => {
    expect(parseAcceptanceCliArgs(["preflight"])).toEqual({
      subcommand: "preflight",
      clientId: undefined,
      idempotencyKey: undefined
    });
  });

  it("parses install with --client-id and --idempotency-key", () => {
    const result = parseAcceptanceCliArgs([
      "install",
      "--client-id",
      "11111111-1111-1111-1111-111111111111",
      "--idempotency-key",
      "22222222-2222-2222-2222-222222222222"
    ]);

    expect(result).toEqual({
      subcommand: "install",
      clientId: "11111111-1111-1111-1111-111111111111",
      idempotencyKey: "22222222-2222-2222-2222-222222222222"
    });
  });

  it("parses install with only --client-id", () => {
    const result = parseAcceptanceCliArgs([
      "install",
      "--client-id",
      "11111111-1111-1111-1111-111111111111"
    ]);

    expect(result.clientId).toBe("11111111-1111-1111-1111-111111111111");
    expect(result.idempotencyKey).toBeUndefined();
  });

  it("rejects an unknown subcommand", () => {
    expect(() => parseAcceptanceCliArgs(["launch-rockets"])).toThrow(AcceptanceCliError);
  });

  it("rejects an unknown flag", () => {
    expect(() => parseAcceptanceCliArgs(["install", "--bogus-flag"])).toThrow(AcceptanceCliError);
  });
});

describe("getAcceptanceUsageHelp", () => {
  it("documents all three subcommands", () => {
    const help = getAcceptanceUsageHelp();
    expect(help).toContain("verify");
    expect(help).toContain("preflight");
    expect(help).toContain("install");
  });
});
