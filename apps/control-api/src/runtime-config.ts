import {
  parseReviewerIdentityConfig,
  TailscaleReviewerIdentityResolver,
  type TailscaleReviewerIdentityResolverConfig
} from "./http/reviewer-identity.js";

export interface ControlApiDatabaseConfig {
  readonly url: string;
}

export interface ControlApiS3Config {
  readonly storageEndpoint: string;
  readonly signingEndpoint: string;
  readonly credentials: {
    readonly accessKeyId: string;
    readonly secretAccessKey: string;
  };
  readonly region: string;
  readonly forcePathStyle: boolean;
  readonly readinessBucket: string;
  readonly defaultExpirySeconds: number;
}

export interface ControlApiHttpConfig {
  readonly host: string;
  readonly port: number;
}

export interface ControlApiRuntimeConfig {
  readonly database: ControlApiDatabaseConfig;
  readonly s3: ControlApiS3Config;
  readonly http: ControlApiHttpConfig;
  readonly reviewerIdentity: TailscaleReviewerIdentityResolverConfig;
}

export class ControlApiConfigError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ControlApiConfigError";
  }
}

function parseHttpUrl(val: unknown, varName: string): string {
  if (typeof val !== "string" || val.trim() === "") {
    throw new ControlApiConfigError(`Missing or empty required environment variable: ${varName}`);
  }
  const trimmed = val.trim();
  try {
    const url = new URL(trimmed);
    if (url.protocol !== "http:" && url.protocol !== "https:") {
      throw new ControlApiConfigError(
        `Invalid URL in variable: ${varName} (must be an http:// or https:// URL)`
      );
    }
    return trimmed;
  } catch (err) {
    if (err instanceof ControlApiConfigError) {
      throw err;
    }
    throw new ControlApiConfigError(
      `Invalid URL in variable: ${varName} (must be a valid HTTP or HTTPS URL)`
    );
  }
}

function parseDatabaseUrl(val: unknown, varName: string): string {
  if (typeof val !== "string" || val.trim() === "") {
    throw new ControlApiConfigError(`Missing or empty required environment variable: ${varName}`);
  }
  const trimmed = val.trim();
  try {
    new URL(trimmed);
    return trimmed;
  } catch {
    throw new ControlApiConfigError(
      `Invalid URL in variable: ${varName} (must be a valid connection URL)`
    );
  }
}

function parseRequiredString(val: unknown, varName: string): string {
  if (typeof val !== "string" || val.trim() === "") {
    throw new ControlApiConfigError(`Missing or empty required environment variable: ${varName}`);
  }
  return val.trim();
}

function parsePort(val: unknown, varName: string): number {
  if (typeof val !== "string" || val.trim() === "") {
    throw new ControlApiConfigError(`Missing or empty required environment variable: ${varName}`);
  }
  const trimmed = val.trim();
  if (!/^\d+$/.test(trimmed)) {
    throw new ControlApiConfigError(
      `Invalid integer port in variable: ${varName} (must be an integer between 1 and 65535)`
    );
  }
  const port = Number.parseInt(trimmed, 10);
  if (!Number.isInteger(port) || port < 1 || port > 65535) {
    throw new ControlApiConfigError(
      `Invalid integer port in variable: ${varName} (must be an integer between 1 and 65535)`
    );
  }
  return port;
}

function parseExpiry(val: unknown, varName: string, defaultValue: number): number {
  if (val === undefined || val === null) {
    return defaultValue;
  }
  if (typeof val === "string" && val.trim() === "") {
    return defaultValue;
  }
  if (typeof val !== "string") {
    throw new ControlApiConfigError(
      `Invalid expiry in variable: ${varName} (must be an integer between 1 and 900)`
    );
  }
  const trimmed = val.trim();
  if (!/^\d+$/.test(trimmed)) {
    throw new ControlApiConfigError(
      `Invalid expiry in variable: ${varName} (must be an integer between 1 and 900)`
    );
  }
  const expiry = Number.parseInt(trimmed, 10);
  if (!Number.isInteger(expiry) || expiry < 1 || expiry > 900) {
    throw new ControlApiConfigError(
      `Invalid expiry in variable: ${varName} (must be an integer between 1 and 900)`
    );
  }
  return expiry;
}

function parseBoolean(val: unknown, varName: string, defaultValue: boolean): boolean {
  if (val === undefined || val === null) {
    return defaultValue;
  }
  if (typeof val === "boolean") {
    return val;
  }
  if (typeof val === "string") {
    const trimmed = val.trim().toLowerCase();
    if (trimmed === "") {
      return defaultValue;
    }
    if (trimmed === "true" || trimmed === "1" || trimmed === "yes") {
      return true;
    }
    if (trimmed === "false" || trimmed === "0" || trimmed === "no") {
      return false;
    }
  }
  throw new ControlApiConfigError(
    `Invalid boolean flag in variable: ${varName} (expected 'true' or 'false')`
  );
}

export function parseControlApiRuntimeConfig(
  env: NodeJS.ProcessEnv = process.env
): ControlApiRuntimeConfig {
  // 1. Validate Database URL
  const rawDbUrl = env.DATABASE_URL ?? env.CONTROL_API_DATABASE_URL;
  const dbVarName =
    env.DATABASE_URL !== undefined || env.CONTROL_API_DATABASE_URL === undefined
      ? "DATABASE_URL"
      : "CONTROL_API_DATABASE_URL";
  const databaseUrl = parseDatabaseUrl(rawDbUrl, dbVarName);

  // 2. Validate S3 Storage and Signing Endpoints
  const storageEndpoint = parseHttpUrl(env.S3_STORAGE_ENDPOINT, "S3_STORAGE_ENDPOINT");
  const signingEndpoint = parseHttpUrl(env.S3_SIGNING_ENDPOINT, "S3_SIGNING_ENDPOINT");

  // 3. Validate S3 Credentials
  const rawAccessKey = env.AWS_ACCESS_KEY_ID ?? env.S3_ACCESS_KEY_ID ?? env.S3_ACCESS_KEY;
  const accessKeyVarName =
    env.AWS_ACCESS_KEY_ID !== undefined ||
    (env.S3_ACCESS_KEY_ID === undefined && env.S3_ACCESS_KEY === undefined)
      ? "AWS_ACCESS_KEY_ID"
      : env.S3_ACCESS_KEY_ID !== undefined
        ? "S3_ACCESS_KEY_ID"
        : "S3_ACCESS_KEY";
  const accessKeyId = parseRequiredString(rawAccessKey, accessKeyVarName);

  const rawSecretKey = env.AWS_SECRET_ACCESS_KEY ?? env.S3_SECRET_ACCESS_KEY ?? env.S3_SECRET_KEY;
  const secretKeyVarName =
    env.AWS_SECRET_ACCESS_KEY !== undefined ||
    (env.S3_SECRET_ACCESS_KEY === undefined && env.S3_SECRET_KEY === undefined)
      ? "AWS_SECRET_ACCESS_KEY"
      : env.S3_SECRET_ACCESS_KEY !== undefined
        ? "S3_SECRET_ACCESS_KEY"
        : "S3_SECRET_KEY";
  const secretAccessKey = parseRequiredString(rawSecretKey, secretKeyVarName);

  // 4. Optional S3 settings
  const rawRegion = (env.AWS_REGION ?? env.S3_REGION)?.trim();
  const region = rawRegion && rawRegion !== "" ? rawRegion : "us-east-1";

  const forcePathStyle = parseBoolean(env.S3_FORCE_PATH_STYLE, "S3_FORCE_PATH_STYLE", true);

  const rawReadinessBucket = (env.S3_READINESS_BUCKET ?? env.S3_BUCKET)?.trim();
  const readinessBucket =
    rawReadinessBucket && rawReadinessBucket !== "" ? rawReadinessBucket : "godzspeed-review";

  const rawExpiry =
    env.S3_PRESIGNED_EXPIRY_SECONDS ??
    env.S3_DEFAULT_EXPIRY_SECONDS ??
    env.PRESIGNED_EXPIRY_SECONDS;
  const expiryVarName =
    env.S3_PRESIGNED_EXPIRY_SECONDS !== undefined ||
    (env.S3_DEFAULT_EXPIRY_SECONDS === undefined && env.PRESIGNED_EXPIRY_SECONDS === undefined)
      ? "S3_PRESIGNED_EXPIRY_SECONDS"
      : env.S3_DEFAULT_EXPIRY_SECONDS !== undefined
        ? "S3_DEFAULT_EXPIRY_SECONDS"
        : "PRESIGNED_EXPIRY_SECONDS";
  const defaultExpirySeconds = parseExpiry(rawExpiry, expiryVarName, 300);

  // 5. Validate HTTP Host & Port
  const rawHost = env.CONTROL_API_HOST ?? env.HOST ?? env.CONTROL_API_BIND_HOST;
  const hostVarName =
    env.CONTROL_API_HOST !== undefined ||
    (env.HOST === undefined && env.CONTROL_API_BIND_HOST === undefined)
      ? "CONTROL_API_HOST"
      : env.HOST !== undefined
        ? "HOST"
        : "CONTROL_API_BIND_HOST";
  const host = parseRequiredString(rawHost, hostVarName);

  const rawPort = env.CONTROL_API_PORT ?? env.PORT;
  const portVarName =
    env.CONTROL_API_PORT !== undefined || env.PORT === undefined ? "CONTROL_API_PORT" : "PORT";
  const port = parsePort(rawPort, portVarName);

  // 6. Parse and validate Reviewer Identity
  const reviewerIdentity = parseReviewerIdentityConfig(env);
  // Verify configuration consistency (e.g. cannot combine fallback identity with trusted proxies)
  try {
    new TailscaleReviewerIdentityResolver(reviewerIdentity);
  } catch (err) {
    throw new ControlApiConfigError(
      `Invalid reviewer identity configuration: ${err instanceof Error ? err.message : String(err)}`
    );
  }

  return {
    database: {
      url: databaseUrl
    },
    s3: {
      storageEndpoint,
      signingEndpoint,
      credentials: {
        accessKeyId,
        secretAccessKey
      },
      region,
      forcePathStyle,
      readinessBucket,
      defaultExpirySeconds
    },
    http: {
      host,
      port
    },
    reviewerIdentity
  };
}
