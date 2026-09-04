import { describe, it, expect, vi } from "vitest";
import {
  createWhoisClient,
  resolveReviewerIdentity,
  ReviewerIdentityUnavailableError,
  type ExecFileFunction,
  type WhoisClient
} from "./reviewer-identity";

describe("createWhoisClient", () => {
  it("resolves valid LoginName and DisplayName, trimming whitespace", async () => {
    const mockExecFile: ExecFileFunction = (_file, _args, _options, callback) => {
      const json = JSON.stringify({
        UserProfile: {
          LoginName: "  director@example.com  ",
          DisplayName: "  Creative Director  "
        }
      });
      callback(null, json, "");
    };

    const client = createWhoisClient(mockExecFile);
    const result = await client.resolve("100.64.0.5");

    expect(result).toEqual({
      login: "director@example.com",
      displayName: "Creative Director"
    });
  });

  it("resolves valid LoginName without DisplayName", async () => {
    const mockExecFile: ExecFileFunction = (_file, _args, _options, callback) => {
      const json = JSON.stringify({
        UserProfile: {
          LoginName: "director@example.com"
        }
      });
      callback(null, json, "");
    };

    const client = createWhoisClient(mockExecFile);
    const result = await client.resolve("100.64.0.5");

    expect(result).toEqual({
      login: "director@example.com"
    });
    expect(result.displayName).toBeUndefined();
  });

  it("omits DisplayName if empty or whitespace-only", async () => {
    const mockExecFile: ExecFileFunction = (_file, _args, _options, callback) => {
      const json = JSON.stringify({
        UserProfile: {
          LoginName: "director@example.com",
          DisplayName: "   "
        }
      });
      callback(null, json, "");
    };

    const client = createWhoisClient(mockExecFile);
    const result = await client.resolve("100.64.0.5");

    expect(result).toEqual({
      login: "director@example.com"
    });
  });

  it("omits DisplayName if exceeds 128 characters", async () => {
    const mockExecFile: ExecFileFunction = (_file, _args, _options, callback) => {
      const json = JSON.stringify({
        UserProfile: {
          LoginName: "director@example.com",
          DisplayName: "a".repeat(129)
        }
      });
      callback(null, json, "");
    };

    const client = createWhoisClient(mockExecFile);
    const result = await client.resolve("100.64.0.5");

    expect(result).toEqual({
      login: "director@example.com"
    });
  });

  it("throws ReviewerIdentityUnavailableError on ENOENT (binary or socket missing)", async () => {
    const mockExecFile: ExecFileFunction = (_file, _args, _options, callback) => {
      const err = new Error("spawn tailscale ENOENT");
      (err as unknown as { code: string }).code = "ENOENT";
      callback(err, "", "");
    };

    const client = createWhoisClient(mockExecFile);
    await expect(client.resolve("100.64.0.5")).rejects.toThrow(ReviewerIdentityUnavailableError);
  });

  it("throws ReviewerIdentityUnavailableError on non-zero exit code", async () => {
    const mockExecFile: ExecFileFunction = (_file, _args, _options, callback) => {
      const err = new Error("Command failed: tailscale whois");
      (err as unknown as { code: number }).code = 1;
      callback(err, "", "failed to connect to local tailscaled");
    };

    const client = createWhoisClient(mockExecFile);
    await expect(client.resolve("100.64.0.5")).rejects.toThrow(ReviewerIdentityUnavailableError);
  });

  it("throws ReviewerIdentityUnavailableError on timeout", async () => {
    const mockExecFile: ExecFileFunction = (_file, _args, _options, callback) => {
      const err = new Error("Command timed out");
      (err as unknown as { killed: boolean }).killed = true;
      callback(err, "", "");
    };

    const client = createWhoisClient(mockExecFile);
    await expect(client.resolve("100.64.0.5")).rejects.toThrow(ReviewerIdentityUnavailableError);
  });

  it("throws ReviewerIdentityUnavailableError on non-JSON stdout", async () => {
    const mockExecFile: ExecFileFunction = (_file, _args, _options, callback) => {
      callback(null, "plain text error output", "");
    };

    const client = createWhoisClient(mockExecFile);
    await expect(client.resolve("100.64.0.5")).rejects.toThrow(ReviewerIdentityUnavailableError);
  });

  it("throws ReviewerIdentityUnavailableError when UserProfile is missing", async () => {
    const mockExecFile: ExecFileFunction = (_file, _args, _options, callback) => {
      callback(null, JSON.stringify({ Node: { Hostname: "node1" } }), "");
    };

    const client = createWhoisClient(mockExecFile);
    await expect(client.resolve("100.64.0.5")).rejects.toThrow(ReviewerIdentityUnavailableError);
  });

  it("throws ReviewerIdentityUnavailableError when LoginName is missing or not a string", async () => {
    const mockExecFile: ExecFileFunction = (_file, _args, _options, callback) => {
      callback(null, JSON.stringify({ UserProfile: { DisplayName: "User" } }), "");
    };

    const client = createWhoisClient(mockExecFile);
    await expect(client.resolve("100.64.0.5")).rejects.toThrow(ReviewerIdentityUnavailableError);
  });

  it("throws ReviewerIdentityUnavailableError when LoginName is empty or whitespace-only", async () => {
    const mockExecFile: ExecFileFunction = (_file, _args, _options, callback) => {
      callback(null, JSON.stringify({ UserProfile: { LoginName: "   " } }), "");
    };

    const client = createWhoisClient(mockExecFile);
    await expect(client.resolve("100.64.0.5")).rejects.toThrow(ReviewerIdentityUnavailableError);
  });

  it("throws ReviewerIdentityUnavailableError when LoginName exceeds 128 characters", async () => {
    const mockExecFile: ExecFileFunction = (_file, _args, _options, callback) => {
      callback(null, JSON.stringify({ UserProfile: { LoginName: "a".repeat(129) } }), "");
    };

    const client = createWhoisClient(mockExecFile);
    await expect(client.resolve("100.64.0.5")).rejects.toThrow(ReviewerIdentityUnavailableError);
  });

  it("throws ReviewerIdentityUnavailableError on invalid IP input without executing whois", async () => {
    const mockExecFile = vi.fn();
    const client = createWhoisClient(mockExecFile);

    await expect(client.resolve("not-an-ip")).rejects.toThrow(ReviewerIdentityUnavailableError);
    expect(mockExecFile).not.toHaveBeenCalled();
  });
});

describe("resolveReviewerIdentity", () => {
  it("resolves identity when x-cco-tailscale-peer-ip header is valid IPv4", async () => {
    const mockWhois: WhoisClient = {
      resolve: vi.fn().mockResolvedValue({ login: "director@example.com" })
    };

    const request = new Request("http://localhost/api/test", {
      headers: {
        "x-cco-tailscale-peer-ip": "100.64.0.5"
      }
    });

    const result = await resolveReviewerIdentity(request, mockWhois);
    expect(result).toEqual({ login: "director@example.com" });
    expect(mockWhois.resolve).toHaveBeenCalledWith("100.64.0.5");
  });

  it("resolves identity when x-cco-tailscale-peer-ip header is valid IPv6", async () => {
    const mockWhois: WhoisClient = {
      resolve: vi.fn().mockResolvedValue({ login: "director@example.com" })
    };

    const request = new Request("http://localhost/api/test", {
      headers: {
        "x-cco-tailscale-peer-ip": "fd7a:115c:a1e0::1"
      }
    });

    const result = await resolveReviewerIdentity(request, mockWhois);
    expect(result).toEqual({ login: "director@example.com" });
    expect(mockWhois.resolve).toHaveBeenCalledWith("fd7a:115c:a1e0::1");
  });

  it("throws ReviewerIdentityUnavailableError and does not call whois if header is missing", async () => {
    const mockWhois: WhoisClient = {
      resolve: vi.fn()
    };

    const request = new Request("http://localhost/api/test");

    await expect(resolveReviewerIdentity(request, mockWhois)).rejects.toThrow(
      ReviewerIdentityUnavailableError
    );
    expect(mockWhois.resolve).not.toHaveBeenCalled();
  });

  it("throws ReviewerIdentityUnavailableError and does not call whois if header is empty or whitespace", async () => {
    const mockWhois: WhoisClient = {
      resolve: vi.fn()
    };

    const request = new Request("http://localhost/api/test", {
      headers: {
        "x-cco-tailscale-peer-ip": "   "
      }
    });

    await expect(resolveReviewerIdentity(request, mockWhois)).rejects.toThrow(
      ReviewerIdentityUnavailableError
    );
    expect(mockWhois.resolve).not.toHaveBeenCalled();
  });

  it("throws ReviewerIdentityUnavailableError and does not call whois if header is not a valid IP", async () => {
    const mockWhois: WhoisClient = {
      resolve: vi.fn()
    };

    const request = new Request("http://localhost/api/test", {
      headers: {
        "x-cco-tailscale-peer-ip": "evil.domain.com"
      }
    });

    await expect(resolveReviewerIdentity(request, mockWhois)).rejects.toThrow(
      ReviewerIdentityUnavailableError
    );
    expect(mockWhois.resolve).not.toHaveBeenCalled();
  });

  it("converts a whois lookup failure into ReviewerIdentityUnavailableError", async () => {
    const mockWhois: WhoisClient = {
      resolve: vi.fn().mockRejectedValue(new Error("tailscaled unavailable"))
    };

    const request = new Request("http://localhost/api/test", {
      headers: {
        "x-cco-tailscale-peer-ip": "100.64.0.5"
      }
    });

    await expect(resolveReviewerIdentity(request, mockWhois)).rejects.toThrow(
      ReviewerIdentityUnavailableError
    );
  });
});
