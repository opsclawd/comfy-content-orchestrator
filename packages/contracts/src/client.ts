import { z } from "zod";

// Requested/declared layer — exactly what the caller supplied.
export const CreateClientRequestSchema = z.object({
  companyName: z.string().min(1).max(255),
  brandBibleJson: z.record(z.string(), z.unknown()).optional(),
  defaultAspectRatio: z.string().min(1).max(16).optional(),
  externalProcessingPolicy: z.record(z.string(), z.unknown()).optional()
});
export type CreateClientRequest = z.infer<typeof CreateClientRequestSchema>;

// Configured/executed layer — what was actually persisted, defaults applied.
export const ClientResponseSchema = z.object({
  clientId: z.string().uuid(),
  companyName: z.string().min(1),
  brandBibleJson: z.record(z.string(), z.unknown()),
  defaultAspectRatio: z.string().min(1),
  externalProcessingPolicy: z.record(z.string(), z.unknown()),
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime()
});
export type ClientResponse = z.infer<typeof ClientResponseSchema>;

// Lightweight list item and response contracts for client selection
export const ClientListItemSchema = z.object({
  clientId: z.string().uuid(),
  companyName: z.string().min(1)
});
export type ClientListItem = z.infer<typeof ClientListItemSchema>;

export const ClientListResponseSchema = z.array(ClientListItemSchema);
export type ClientListResponse = z.infer<typeof ClientListResponseSchema>;
