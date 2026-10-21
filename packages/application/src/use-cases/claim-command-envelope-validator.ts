import { canonicalizeUtcTimestamp, isValidUuid, normalizeAssertedBy } from "@cco/shared";
import { ProductValidationError } from "@cco/domain";
import type { CommandEnvelope } from "../ports/product-evidence-repository.js";

const UUID_V7_REGEX =
  /^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-7[0-9a-fA-F]{3}-[89abAB][0-9a-fA-F]{3}-[0-9a-fA-F]{12}$/;

const ALLOWED_ENVELOPE_KEYS = new Set(["actionId", "clientId", "actorId", "timestamp", "payload"]);

export function validateClaimCommandEnvelope<T>(cmd: CommandEnvelope<T>): void {
  if (typeof cmd !== "object" || cmd === null) {
    throw new ProductValidationError([
      {
        code: "INVALID_FIELD_COMBINATION",
        path: [],
        message: "Command envelope must be an object."
      }
    ]);
  }
  for (const key of Object.keys(cmd)) {
    if (!ALLOWED_ENVELOPE_KEYS.has(key)) {
      throw new ProductValidationError([
        {
          code: "INVALID_FIELD_COMBINATION",
          path: [key],
          message: `Unknown or unexpected field in envelope: "${key}".`
        }
      ]);
    }
  }

  if (!cmd.actionId || !UUID_V7_REGEX.test(cmd.actionId)) {
    throw new ProductValidationError([
      {
        code: "INVALID_IDENTIFIER",
        path: ["actionId"],
        message: "actionId must be a valid UUIDv7 string."
      }
    ]);
  }
  if (!cmd.clientId || !isValidUuid(cmd.clientId)) {
    throw new ProductValidationError([
      {
        code: "INVALID_IDENTIFIER",
        path: ["clientId"],
        message: "clientId must be a valid UUID string."
      }
    ]);
  }
  try {
    normalizeAssertedBy(cmd.actorId, "actorId");
  } catch (err) {
    throw new ProductValidationError([
      {
        code: "INVALID_TEXT",
        path: ["actorId"],
        message: err instanceof Error ? err.message : String(err)
      }
    ]);
  }
  if (!cmd.timestamp) {
    throw new ProductValidationError([
      {
        code: "INVALID_TIMESTAMP",
        path: ["timestamp"],
        message: "timestamp must be present."
      }
    ]);
  }
  try {
    canonicalizeUtcTimestamp(cmd.timestamp);
  } catch (err) {
    throw new ProductValidationError([
      {
        code: "INVALID_TIMESTAMP",
        path: ["timestamp"],
        message: err instanceof Error ? err.message : String(err)
      }
    ]);
  }
  if (typeof cmd.payload !== "object" || cmd.payload === null) {
    throw new ProductValidationError([
      {
        code: "INVALID_FIELD_COMBINATION",
        path: ["payload"],
        message: "Command payload must be an object."
      }
    ]);
  }
}
