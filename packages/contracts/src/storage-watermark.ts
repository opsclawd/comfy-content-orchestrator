import { STORAGE_WATERMARK_STATES } from "@cco/shared";
import { z } from "zod";

export { STORAGE_WATERMARK_STATES };
export const StorageWatermarkStateSchema = z.enum(STORAGE_WATERMARK_STATES);
export type StorageWatermarkState = z.infer<typeof StorageWatermarkStateSchema>;
