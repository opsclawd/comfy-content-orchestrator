import { describe, expect, it } from "vitest";
import type { UnitOfWork } from "@cco/application";
import { HealthResponseSchema } from "@cco/contracts";
import { createControlApiApp } from "./app.js";

describe("GET /api/health", () => {
  it("returns 200 with schema-conforming health status", async () => {
    const app = createControlApiApp({ uow: {} as UnitOfWork });
    const response = await app.inject({
      method: "GET",
      url: "/api/health"
    });

    expect(response.statusCode).toBe(200);
    const body = JSON.parse(response.body);
    const parsed = HealthResponseSchema.parse(body);
    expect(parsed.status).toBe("ok");
    expect(typeof parsed.timestamp).toBe("string");
    await app.close();
  });
});
