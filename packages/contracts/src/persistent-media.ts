import { z } from "zod";

export const sha256HashSchema = z
  .string()
  .regex(/^[0-9a-f]{64}$/, "Must be a lowercase 64-character hexadecimal SHA-256 hash");

export const PersistentMediaRefSchema = z.object({
  bucket: z.string().min(1, "Bucket must not be empty"),
  key: z.string().min(1, "Object key must not be empty"),
  sha256: sha256HashSchema,
  contentType: z.string().min(1, "Content type must not be empty")
});

export type PersistentMediaRef = {
  readonly bucket: string;
  readonly key: string;
  readonly sha256: string;
  readonly contentType: string;
};
