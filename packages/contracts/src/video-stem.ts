import { z } from "zod";
import { PersistentMediaRefSchema, type PersistentMediaRef } from "./persistent-media.js";

export const VideoStemRefSchema = z.object({
  sceneId: z.string().min(1, "sceneId must not be empty"),
  generationManifestId: z.string().min(1, "generationManifestId must not be empty"),
  order: z.number().int("order must be an integer").nonnegative("order must be non-negative"),
  media: PersistentMediaRefSchema,
  expectedDurationMs: z
    .number()
    .int("expectedDurationMs must be an integer")
    .positive("expectedDurationMs must be positive")
});

export type VideoStemRef = {
  readonly sceneId: string;
  readonly generationManifestId: string;
  readonly order: number;
  readonly media: PersistentMediaRef;
  readonly expectedDurationMs: number;
};

export const ExecutedVideoStemRefSchema = z.object({
  sceneId: z.string().min(1, "sceneId must not be empty"),
  generationManifestId: z.string().min(1, "generationManifestId must not be empty"),
  order: z.number().int("order must be an integer").nonnegative("order must be non-negative"),
  media: PersistentMediaRefSchema,
  actualDurationMs: z
    .number()
    .int("actualDurationMs must be an integer")
    .positive("actualDurationMs must be positive")
});

export type ExecutedVideoStemRef = {
  readonly sceneId: string;
  readonly generationManifestId: string;
  readonly order: number;
  readonly media: PersistentMediaRef;
  readonly actualDurationMs: number;
};
