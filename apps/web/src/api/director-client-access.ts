import { createClientSessionToken } from "@cco/shared";
import {
  createWhoisClient,
  resolveReviewerIdentity,
  ReviewerIdentityUnavailableError,
  type WhoisClient
} from "./reviewer-identity";

const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export class DirectorAuthenticationRequiredError extends Error {
  override readonly name = "DirectorAuthenticationRequiredError";
  readonly code = "AUTHENTICATION_REQUIRED";

  constructor(message = "Director identity could not be established.") {
    super(message);
  }
}

export class DirectorClientForbiddenError extends Error {
  override readonly name = "DirectorClientForbiddenError";
  readonly code = "FORBIDDEN";

  constructor(message = "Director is not authorized to access resources for this client.") {
    super(message);
  }
}

export class ReviewHubConfigError extends Error {
  override readonly name = "ReviewHubConfigError";
  readonly code = "INTERNAL_ERROR";

  constructor(message = "Review Hub server configuration error.") {
    super(message);
  }
}

export function parseDirectorClientMappings(rawConfig?: string | null): Map<string, Set<string>> {
  const map = new Map<string, Set<string>>();
  if (!rawConfig || typeof rawConfig !== "string" || rawConfig.trim() === "") {
    return map;
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(rawConfig);
  } catch {
    console.error("Failed to parse REVIEW_HUB_DIRECTOR_CLIENT_MAPPINGS JSON; failing closed.");
    return map;
  }

  if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
    return map;
  }

  for (const [key, val] of Object.entries(parsed)) {
    const director = key.trim().toLowerCase();
    if (!director) continue;
    const clientSet = new Set<string>();
    if (Array.isArray(val)) {
      for (const item of val) {
        if (typeof item === "string" && item.trim()) {
          clientSet.add(item.trim().toLowerCase());
        }
      }
    } else if (typeof val === "string" && val.trim()) {
      clientSet.add(val.trim().toLowerCase());
    }
    map.set(director, clientSet);
  }

  return map;
}

export function isDirectorAuthorizedForClient(
  directorLogin: string,
  clientId: string,
  mappings: Map<string, Set<string>> | Record<string, readonly string[]>
): boolean {
  const normalizedDirector = directorLogin.trim().toLowerCase();
  const normalizedClient = clientId.trim().toLowerCase();

  if (mappings instanceof Map) {
    const allowed = mappings.get(normalizedDirector);
    if (!allowed) return false;
    return allowed.has(normalizedClient) || allowed.has("*");
  }

  const allowed = mappings[normalizedDirector] ?? mappings[directorLogin];
  if (!allowed || !Array.isArray(allowed)) return false;
  return allowed.some((c) => c.trim().toLowerCase() === normalizedClient || c.trim() === "*");
}

export interface AuthorizeDirectorClientSessionOptions {
  readonly whoisClient?: WhoisClient;
  readonly mappings?: Map<string, Set<string>> | Record<string, readonly string[]>;
  readonly secret?: string;
}

export interface AuthorizedDirectorClientSession {
  readonly sessionToken: string;
  readonly directorLogin: string;
}

const defaultWhoisClient = createWhoisClient();

export async function authorizeDirectorClientSession(
  request: Request,
  clientId: string,
  options?: AuthorizeDirectorClientSessionOptions
): Promise<AuthorizedDirectorClientSession> {
  const trimmedClientId = clientId.trim().toLowerCase();
  if (!UUID_REGEX.test(trimmedClientId)) {
    throw new DirectorClientForbiddenError(`Invalid clientId format: '${clientId}'`);
  }

  const secret = options?.secret ?? process.env.CONTROL_API_CLIENT_SESSION_SECRET;
  if (!secret || secret.trim() === "") {
    throw new ReviewHubConfigError("CONTROL_API_CLIENT_SESSION_SECRET is not configured.");
  }

  const whois = options?.whoisClient ?? defaultWhoisClient;
  let directorLogin: string;
  try {
    const identity = await resolveReviewerIdentity(request, whois);
    directorLogin = identity.login;
  } catch (err) {
    if (err instanceof ReviewerIdentityUnavailableError) {
      throw new DirectorAuthenticationRequiredError("Director identity could not be established.");
    }
    throw err;
  }

  const mappings =
    options?.mappings ??
    parseDirectorClientMappings(process.env.REVIEW_HUB_DIRECTOR_CLIENT_MAPPINGS);

  if (!isDirectorAuthorizedForClient(directorLogin, trimmedClientId, mappings)) {
    throw new DirectorClientForbiddenError(
      `Director '${directorLogin}' is not authorized for client '${clientId}'.`
    );
  }

  const sessionToken = createClientSessionToken({
    clientId: trimmedClientId,
    secret
  });

  return {
    sessionToken,
    directorLogin
  };
}
