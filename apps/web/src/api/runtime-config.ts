export class WebRuntimeConfigError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "WebRuntimeConfigError";
  }
}

export type WebConfigError = WebRuntimeConfigError;
export const WebConfigError = WebRuntimeConfigError;

export interface ResolveControlApiBaseUrlOptions {
  baseUrl?: string | undefined;
  env?: NodeJS.ProcessEnv | Record<string, string | undefined> | undefined;
  mode?: string | undefined;
}

function validateAndNormalizeUrl(urlStr: string, varName?: string): string {
  const trimmed = urlStr.trim();
  if (trimmed === "") {
    const name = varName ?? "baseUrl";
    throw new WebRuntimeConfigError(`Missing or empty required environment variable: ${name}`);
  }
  let parsed: URL;
  try {
    parsed = new URL(trimmed);
  } catch {
    const name = varName ?? "baseUrl";
    throw new WebRuntimeConfigError(
      `Invalid URL in variable: ${name} (must be a valid HTTP or HTTPS URL)`
    );
  }
  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
    const name = varName ?? "baseUrl";
    throw new WebRuntimeConfigError(
      `Invalid URL in variable: ${name} (must be an http:// or https:// URL)`
    );
  }
  return trimmed.replace(/\/+$/, "");
}

export function resolveControlApiBaseUrl(
  optionsOrBaseUrl?: string | ResolveControlApiBaseUrlOptions,
  envParam?: NodeJS.ProcessEnv | Record<string, string | undefined>,
  modeParam?: string
): string {
  let explicitBaseUrl: string | undefined;
  let env: NodeJS.ProcessEnv | Record<string, string | undefined>;
  let mode: string | undefined;

  if (typeof optionsOrBaseUrl === "string") {
    explicitBaseUrl = optionsOrBaseUrl;
    env = envParam ?? process.env;
    mode = modeParam ?? env.NODE_ENV ?? process.env.NODE_ENV;
  } else if (typeof optionsOrBaseUrl === "object" && optionsOrBaseUrl !== null) {
    explicitBaseUrl = optionsOrBaseUrl.baseUrl;
    env = optionsOrBaseUrl.env ?? envParam ?? process.env;
    mode = optionsOrBaseUrl.mode ?? modeParam ?? env.NODE_ENV ?? process.env.NODE_ENV;
  } else {
    explicitBaseUrl = undefined;
    env = envParam ?? process.env;
    mode = modeParam ?? env.NODE_ENV ?? process.env.NODE_ENV;
  }

  // 1. Explicitly supplied base URL wins without consulting environment
  if (explicitBaseUrl !== undefined && explicitBaseUrl !== null) {
    return validateAndNormalizeUrl(explicitBaseUrl, "baseUrl");
  }

  const effectiveMode = mode ?? "development";
  const isProduction = effectiveMode === "production";
  const rawUrl = env.CONTROL_API_URL;

  // 2. Production requires a valid CONTROL_API_URL
  if (isProduction) {
    if (
      rawUrl === undefined ||
      rawUrl === null ||
      (typeof rawUrl === "string" && rawUrl.trim() === "")
    ) {
      throw new WebRuntimeConfigError(
        "Missing or empty required environment variable: CONTROL_API_URL"
      );
    }
    return validateAndNormalizeUrl(rawUrl, "CONTROL_API_URL");
  }

  // 3. Non-production allows documented localhost default when missing or blank
  if (
    rawUrl === undefined ||
    rawUrl === null ||
    (typeof rawUrl === "string" && rawUrl.trim() === "")
  ) {
    return "http://localhost:3000";
  }

  return validateAndNormalizeUrl(rawUrl, "CONTROL_API_URL");
}
