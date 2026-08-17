import { z } from "zod";

export const STORAGE_WATERMARK_STATES = ["normal", "warning", "degraded", "critical"] as const;

export const StorageWatermarkStateSchema = z.enum(STORAGE_WATERMARK_STATES);
export type StorageWatermarkState = z.infer<typeof StorageWatermarkStateSchema>;
