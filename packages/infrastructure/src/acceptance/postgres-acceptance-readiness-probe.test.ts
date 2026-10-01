import { describe, expect, it, vi } from "vitest";
import type { Pool } from "pg";
import { PostgresAcceptanceReadinessProbe } from "./postgres-acceptance-readiness-probe.js";

describe("PostgresAcceptanceReadinessProbe", () => {
  it("reports ok:true when SELECT 1 succeeds, issuing no other query", async () => {
    const query = vi.fn(async () => ({ rows: [{ "?column?": 1 }] }));
    const pool = { query } as unknown as Pool;

    const probe = new PostgresAcceptanceReadinessProbe(pool);
    const result = await probe.probe();

    expect(result.ok).toBe(true);
    expect(query).toHaveBeenCalledTimes(1);
    expect(query).toHaveBeenCalledWith("SELECT 1");
  });

  it("reports ok:false with a detail message when the query rejects", async () => {
    const query = vi.fn(async () => {
      throw new Error("connection refused");
    });
    const pool = { query } as unknown as Pool;

    const probe = new PostgresAcceptanceReadinessProbe(pool);
    const result = await probe.probe();

    expect(result.ok).toBe(false);
    expect(result.detail).toContain("connection refused");
  });
});
