import { describe, expect, it, vi } from "vitest";
import {
  getStageCandidateUsage,
  parseStageCandidateCliArgs,
  stageCandidateRenderCli
} from "./stage-candidate.js";

describe("stage-candidate CLI", () => {
  it("parses CLI arguments correctly", () => {
    const args = [
      "--scene-id=11111111-1111-4111-8111-111111111111",
      "--candidate-profile-key=H3_CANDIDATE_abcdef_V1",
      "--grant-path=/path/to/grant.json",
      "--request-id=req-123",
      "--dry-run",
      "--database-url=postgresql://localhost:5432/cco"
    ];

    const parsed = parseStageCandidateCliArgs(args, {});
    expect(parsed.sceneId).toBe("11111111-1111-4111-8111-111111111111");
    expect(parsed.candidateProfileKey).toBe("H3_CANDIDATE_abcdef_V1");
    expect(parsed.grantPath).toBe("/path/to/grant.json");
    expect(parsed.requestId).toBe("req-123");
    expect(parsed.dryRun).toBe(true);
    expect(parsed.databaseUrl).toBe("postgresql://localhost:5432/cco");
    expect(parsed.help).toBe(false);
  });

  it("falls back to environment variables when CLI arguments are omitted", () => {
    const env: NodeJS.ProcessEnv = {
      SCENE_ID: "22222222-2222-4222-8222-222222222222",
      CANDIDATE_PROFILE_KEY: "H3_CANDIDATE_123456_V1",
      H3_AUTHORIZATION_GRANT_FILE: "/env/grant.json",
      DATABASE_URL: "postgresql://envhost:5432/cco",
      STAGING_DRY_RUN: "true"
    };

    const parsed = parseStageCandidateCliArgs([], env);
    expect(parsed.sceneId).toBe("22222222-2222-4222-8222-222222222222");
    expect(parsed.candidateProfileKey).toBe("H3_CANDIDATE_123456_V1");
    expect(parsed.grantPath).toBe("/env/grant.json");
    expect(parsed.databaseUrl).toBe("postgresql://envhost:5432/cco");
    expect(parsed.dryRun).toBe(true);
  });

  it("provides helpful usage instructions", () => {
    const usage = getStageCandidateUsage();
    expect(usage).toContain("Usage:");
    expect(usage).toContain("--scene-id");
    expect(usage).toContain("--candidate-profile-key");
    expect(usage).toContain("--grant-path");
  });

  it("exits with 0 when --help is passed", async () => {
    const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});
    try {
      const exitCode = await stageCandidateRenderCli(["--help"], {});
      expect(exitCode).toBe(0);
      expect(logSpy).toHaveBeenCalled();
    } finally {
      logSpy.mockRestore();
    }
  });

  it("fails with exit code 1 when required arguments are missing", async () => {
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    try {
      const exitCode = await stageCandidateRenderCli([], {});
      expect(exitCode).toBe(1);
      expect(errorSpy).toHaveBeenCalledWith(
        expect.stringContaining("Error: --scene-id is required")
      );
    } finally {
      errorSpy.mockRestore();
    }
  });
});
