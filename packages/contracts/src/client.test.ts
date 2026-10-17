import { describe, expect, it } from "vitest";
import {
  CreateClientRequestSchema,
  ClientResponseSchema,
  ClientListItemSchema,
  ClientListResponseSchema
} from "./client.js";

describe("Client Creation Contracts", () => {
  describe("CreateClientRequestSchema", () => {
    it("parses valid payload with all fields", () => {
      const payload = {
        companyName: "Acme Corp",
        brandBibleJson: {
          palette: ["#ff0000", "#00ff00"],
          tone: "bold"
        },
        defaultAspectRatio: "16:9",
        externalProcessingPolicy: {
          allowCloudPlanning: true,
          allowedProviders: ["OpenAI"]
        }
      };

      const parsed = CreateClientRequestSchema.parse(payload);
      expect(parsed).toEqual(payload);
    });

    it("parses valid payload with only required fields (companyName)", () => {
      const payload = {
        companyName: "Acme Corp"
      };

      const parsed = CreateClientRequestSchema.parse(payload);
      expect(parsed).toEqual({
        companyName: "Acme Corp"
      });
    });

    it("rejects empty companyName", () => {
      expect(() =>
        CreateClientRequestSchema.parse({
          companyName: ""
        })
      ).toThrow();
    });

    it("rejects missing companyName", () => {
      expect(() =>
        CreateClientRequestSchema.parse({
          brandBibleJson: {}
        })
      ).toThrow();
    });

    it("rejects non-string companyName", () => {
      expect(() =>
        CreateClientRequestSchema.parse({
          companyName: 123
        })
      ).toThrow();
    });

    it("rejects empty defaultAspectRatio", () => {
      expect(() =>
        CreateClientRequestSchema.parse({
          companyName: "Acme Corp",
          defaultAspectRatio: ""
        })
      ).toThrow();
    });

    it("rejects non-object brandBibleJson", () => {
      expect(() =>
        CreateClientRequestSchema.parse({
          companyName: "Acme Corp",
          brandBibleJson: "not an object"
        })
      ).toThrow();

      expect(() =>
        CreateClientRequestSchema.parse({
          companyName: "Acme Corp",
          brandBibleJson: ["not an object"]
        })
      ).toThrow();
    });

    it("rejects non-object externalProcessingPolicy", () => {
      expect(() =>
        CreateClientRequestSchema.parse({
          companyName: "Acme Corp",
          externalProcessingPolicy: "invalid"
        })
      ).toThrow();
    });
  });

  describe("ClientResponseSchema", () => {
    it("parses valid client response with all required fields present", () => {
      const payload = {
        clientId: "018e69e0-8a6a-72cb-b1b7-ec79a1f73801",
        companyName: "Acme Corp",
        brandBibleJson: {
          palette: ["#ff0000"]
        },
        defaultAspectRatio: "9:16",
        externalProcessingPolicy: {
          allowCloudPlanning: true,
          allowCloudVisualQA: true,
          allowCloudVoice: true,
          allowedProviders: ["Anthropic", "OpenAI", "Google", "ElevenLabs"],
          sensitiveDataMasking: true
        },
        createdAt: "2026-09-03T12:00:00.000Z",
        updatedAt: "2026-09-03T12:00:00.000Z"
      };

      const parsed = ClientResponseSchema.parse(payload);
      expect(parsed).toEqual(payload);
    });

    it("rejects invalid clientId (non-UUID)", () => {
      expect(() =>
        ClientResponseSchema.parse({
          clientId: "not-a-uuid",
          companyName: "Acme Corp",
          brandBibleJson: {},
          defaultAspectRatio: "9:16",
          externalProcessingPolicy: {},
          createdAt: "2026-09-03T12:00:00.000Z",
          updatedAt: "2026-09-03T12:00:00.000Z"
        })
      ).toThrow();
    });

    it("rejects missing brandBibleJson in response", () => {
      expect(() =>
        ClientResponseSchema.parse({
          clientId: "018e69e0-8a6a-72cb-b1b7-ec79a1f73801",
          companyName: "Acme Corp",
          defaultAspectRatio: "9:16",
          externalProcessingPolicy: {},
          createdAt: "2026-09-03T12:00:00.000Z",
          updatedAt: "2026-09-03T12:00:00.000Z"
        })
      ).toThrow();
    });

    it("rejects invalid createdAt / updatedAt (non-datetime)", () => {
      expect(() =>
        ClientResponseSchema.parse({
          clientId: "018e69e0-8a6a-72cb-b1b7-ec79a1f73801",
          companyName: "Acme Corp",
          brandBibleJson: {},
          defaultAspectRatio: "9:16",
          externalProcessingPolicy: {},
          createdAt: "not-a-datetime",
          updatedAt: "2026-09-03T12:00:00.000Z"
        })
      ).toThrow();

      expect(() =>
        ClientResponseSchema.parse({
          clientId: "018e69e0-8a6a-72cb-b1b7-ec79a1f73801",
          companyName: "Acme Corp",
          brandBibleJson: {},
          defaultAspectRatio: "9:16",
          externalProcessingPolicy: {},
          createdAt: "2026-09-03T12:00:00.000Z",
          updatedAt: "not-a-datetime"
        })
      ).toThrow();
    });
  });

  describe("ClientListItemSchema", () => {
    it("parses valid client list item", () => {
      const item = {
        clientId: "018e69e0-8a6a-72cb-b1b7-ec79a1f73801",
        companyName: "Acme Corp"
      };
      const parsed = ClientListItemSchema.parse(item);
      expect(parsed).toEqual(item);
    });

    it("rejects invalid clientId (non-UUID)", () => {
      expect(() =>
        ClientListItemSchema.parse({
          clientId: "not-a-uuid",
          companyName: "Acme Corp"
        })
      ).toThrow();
    });

    it("rejects empty companyName", () => {
      expect(() =>
        ClientListItemSchema.parse({
          clientId: "018e69e0-8a6a-72cb-b1b7-ec79a1f73801",
          companyName: ""
        })
      ).toThrow();
    });

    it("rejects missing fields", () => {
      expect(() =>
        ClientListItemSchema.parse({
          clientId: "018e69e0-8a6a-72cb-b1b7-ec79a1f73801"
        })
      ).toThrow();

      expect(() =>
        ClientListItemSchema.parse({
          companyName: "Acme Corp"
        })
      ).toThrow();
    });
  });

  describe("ClientListResponseSchema", () => {
    it("parses populated array of clients", () => {
      const payload = [
        {
          clientId: "018e69e0-8a6a-72cb-b1b7-ec79a1f73801",
          companyName: "Acme Corp"
        },
        {
          clientId: "018e69e0-8a6a-72cb-b1b7-ec79a1f73802",
          companyName: "Beta LLC"
        }
      ];
      const parsed = ClientListResponseSchema.parse(payload);
      expect(parsed).toEqual(payload);
    });

    it("parses empty array", () => {
      const parsed = ClientListResponseSchema.parse([]);
      expect(parsed).toEqual([]);
    });

    it("allows duplicate company names across different client IDs", () => {
      const payload = [
        {
          clientId: "018e69e0-8a6a-72cb-b1b7-ec79a1f73801",
          companyName: "Acme Corp"
        },
        {
          clientId: "018e69e0-8a6a-72cb-b1b7-ec79a1f73802",
          companyName: "Acme Corp"
        }
      ];
      const parsed = ClientListResponseSchema.parse(payload);
      expect(parsed).toEqual(payload);
    });

    it("rejects non-array payloads", () => {
      expect(() => ClientListResponseSchema.parse({})).toThrow();
      expect(() => ClientListResponseSchema.parse("invalid")).toThrow();
      expect(() => ClientListResponseSchema.parse(null)).toThrow();
    });

    it("rejects array with invalid item shapes", () => {
      expect(() =>
        ClientListResponseSchema.parse([
          {
            clientId: "not-a-uuid",
            companyName: "Acme Corp"
          }
        ])
      ).toThrow();
    });
  });
});
