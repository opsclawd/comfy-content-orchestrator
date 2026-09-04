import { execFile } from "node:child_process";
import net from "node:net";

export interface WhoisResult {
  readonly login: string;
  readonly displayName?: string;
}

export interface WhoisClient {
  resolve(ip: string): Promise<WhoisResult>;
}

export class ReviewerIdentityUnavailableError extends Error {
  override readonly name = "ReviewerIdentityUnavailableError";

  constructor(message = "Reviewer identity could not be established.") {
    super(message);
  }
}

export type ExecFileFunction = (
  file: string,
  args: readonly string[],
  options: { timeout?: number },
  callback: (error: Error | null, stdout: string, stderr: string) => void
) => unknown;

export function createWhoisClient(
  execFileImpl: ExecFileFunction = execFile as unknown as ExecFileFunction
): WhoisClient {
  return {
    async resolve(ip: string): Promise<WhoisResult> {
      const trimmedIp = ip.trim();
      if (net.isIP(trimmedIp) === 0) {
        throw new ReviewerIdentityUnavailableError(`Invalid peer IP: '${ip}'`);
      }

      return new Promise<WhoisResult>((res, rej) => {
        execFileImpl(
          "tailscale",
          ["whois", "--json", trimmedIp],
          { timeout: 5000 },
          (error, stdout) => {
            if (error) {
              return rej(
                new ReviewerIdentityUnavailableError(
                  `Tailscale whois execution failed: ${error.message}`
                )
              );
            }

            let parsed: unknown;
            try {
              parsed = JSON.parse(stdout);
            } catch {
              return rej(
                new ReviewerIdentityUnavailableError("Failed to parse tailscale whois JSON output.")
              );
            }

            if (typeof parsed !== "object" || parsed === null) {
              return rej(
                new ReviewerIdentityUnavailableError(
                  "tailscale whois output is not a valid JSON object."
                )
              );
            }

            const userProfile = (parsed as { UserProfile?: unknown }).UserProfile;
            if (typeof userProfile !== "object" || userProfile === null) {
              return rej(
                new ReviewerIdentityUnavailableError("tailscale whois output missing UserProfile.")
              );
            }

            const rawLogin = (userProfile as { LoginName?: unknown }).LoginName;
            if (typeof rawLogin !== "string") {
              return rej(
                new ReviewerIdentityUnavailableError("tailscale UserProfile missing LoginName.")
              );
            }

            const trimmedLogin = rawLogin.trim();
            if (trimmedLogin === "" || trimmedLogin.length > 128) {
              return rej(
                new ReviewerIdentityUnavailableError(
                  `Invalid LoginName length: ${trimmedLogin.length}`
                )
              );
            }

            const rawDisplayName = (userProfile as { DisplayName?: unknown }).DisplayName;
            let displayName: string | undefined;
            if (typeof rawDisplayName === "string") {
              const trimmedDisplayName = rawDisplayName.trim();
              if (trimmedDisplayName !== "" && trimmedDisplayName.length <= 128) {
                displayName = trimmedDisplayName;
              }
            }

            res({
              login: trimmedLogin,
              ...(displayName !== undefined ? { displayName } : {})
            });
          }
        );
      });
    }
  };
}

export async function resolveReviewerIdentity(
  request: Request,
  whois: WhoisClient
): Promise<{ login: string; displayName?: string }> {
  const peerIpHeader = request.headers.get("x-cco-tailscale-peer-ip");
  if (!peerIpHeader) {
    throw new ReviewerIdentityUnavailableError("Missing x-cco-tailscale-peer-ip header.");
  }

  const trimmedIp = peerIpHeader.trim();
  if (trimmedIp === "" || net.isIP(trimmedIp) === 0) {
    throw new ReviewerIdentityUnavailableError(
      `Malformed x-cco-tailscale-peer-ip header: '${peerIpHeader}'`
    );
  }

  try {
    return await whois.resolve(trimmedIp);
  } catch (error) {
    if (error instanceof ReviewerIdentityUnavailableError) {
      throw error;
    }

    throw new ReviewerIdentityUnavailableError(
      `Tailscale identity lookup failed: ${error instanceof Error ? error.message : String(error)}`
    );
  }
}
