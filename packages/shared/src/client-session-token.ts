import crypto from "crypto";

const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const TOKEN_PREFIX = "cco_s1";

export interface CreateClientSessionTokenOptions {
  readonly clientId: string;
  readonly secret: string;
  readonly issuedAt?: Date | number;
}

export function createClientSessionToken(options: CreateClientSessionTokenOptions): string {
  const { clientId, secret } = options;
  const trimmedId = clientId.trim().toLowerCase();
  if (!UUID_REGEX.test(trimmedId)) {
    throw new Error("Invalid clientId: must be a valid UUID");
  }
  if (!secret || secret.trim().length === 0) {
    throw new Error("Secret is required to create client session token");
  }
  const timestamp =
    typeof options.issuedAt === "number"
      ? options.issuedAt
      : options.issuedAt instanceof Date
        ? options.issuedAt.getTime()
        : Date.now();

  const payload = `${TOKEN_PREFIX}.${trimmedId}.${timestamp}`;
  const hmac = crypto.createHmac("sha256", secret).update(payload).digest("hex");
  return `${payload}.${hmac}`;
}
