import { readFileSync } from "node:fs";
import { readFile } from "node:fs/promises";
import type { LicenseRegistryPort } from "@cco/application";
import {
  ComponentLicenseRegistrySchema,
  type ComponentLicenseRegistrySnapshot
} from "@cco/contracts";

export class ComponentLicenseRegistryLoadError extends Error {
  override readonly name = "ComponentLicenseRegistryLoadError";
  constructor(message: string, options?: ErrorOptions) {
    super(message, options);
  }
}

function validateAndCheckDuplicates(
  content: string,
  filePath: string
): ComponentLicenseRegistrySnapshot {
  let parsed: unknown;
  try {
    parsed = JSON.parse(content);
  } catch (err) {
    throw new ComponentLicenseRegistryLoadError(
      `Failed to parse component license registry JSON at "${filePath}": ${(err as Error).message}`,
      { cause: err }
    );
  }

  let validatedSnapshot: ComponentLicenseRegistrySnapshot;
  try {
    validatedSnapshot = ComponentLicenseRegistrySchema.parse(parsed);
  } catch (err) {
    throw new ComponentLicenseRegistryLoadError(
      `Invalid component license registry schema at "${filePath}": ${(err as Error).message}`,
      { cause: err }
    );
  }

  const seenIdentities = new Set<string>();
  for (const entry of validatedSnapshot.entries) {
    const identityKey = `${entry.componentId}::${entry.versionOrRevision}`;
    if (seenIdentities.has(identityKey)) {
      throw new ComponentLicenseRegistryLoadError(
        `Duplicate component license entry found for "${entry.componentId}" (version: "${entry.versionOrRevision}") in "${filePath}"`
      );
    }
    seenIdentities.add(identityKey);
  }

  return validatedSnapshot;
}

export async function loadComponentLicenseRegistry(
  filePath: string
): Promise<ComponentLicenseRegistrySnapshot> {
  let content: string;
  try {
    content = await readFile(filePath, "utf8");
  } catch (err) {
    throw new ComponentLicenseRegistryLoadError(
      `Failed to read component license registry at "${filePath}": ${(err as Error).message}`,
      { cause: err }
    );
  }

  return validateAndCheckDuplicates(content, filePath);
}

export function loadComponentLicenseRegistrySync(
  filePath: string
): ComponentLicenseRegistrySnapshot {
  let content: string;
  try {
    content = readFileSync(filePath, "utf8");
  } catch (err) {
    throw new ComponentLicenseRegistryLoadError(
      `Failed to read component license registry at "${filePath}": ${(err as Error).message}`,
      { cause: err }
    );
  }

  return validateAndCheckDuplicates(content, filePath);
}

export class JsonFileLicenseRegistryPort implements LicenseRegistryPort {
  constructor(private readonly snapshot: ComponentLicenseRegistrySnapshot) {}

  static async load(filePath: string): Promise<JsonFileLicenseRegistryPort> {
    const snapshot = await loadComponentLicenseRegistry(filePath);
    return new JsonFileLicenseRegistryPort(snapshot);
  }

  static fromFile(filePath: string): JsonFileLicenseRegistryPort {
    const snapshot = loadComponentLicenseRegistrySync(filePath);
    return new JsonFileLicenseRegistryPort(snapshot);
  }

  getSnapshot(): ComponentLicenseRegistrySnapshot {
    return this.snapshot;
  }
}
