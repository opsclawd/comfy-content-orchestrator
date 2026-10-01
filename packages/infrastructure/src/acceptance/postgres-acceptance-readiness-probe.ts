import type { Pool } from "pg";
import type {
  AcceptanceDatabaseReadinessProbePort,
  AcceptanceReadinessProbeResult
} from "@cco/application";

/**
 * Read-only PostgreSQL reachability probe (`SELECT 1`). Performs no schema migration,
 * no writes, and no acceptance-campaign-specific queries — purely a connectivity check
 * ahead of handing preparation tooling off to a human operator.
 */
export class PostgresAcceptanceReadinessProbe implements AcceptanceDatabaseReadinessProbePort {
  constructor(private readonly pool: Pool) {}

  async probe(): Promise<AcceptanceReadinessProbeResult> {
    try {
      await this.pool.query("SELECT 1");
      return { ok: true };
    } catch (err) {
      return {
        ok: false,
        detail: err instanceof Error ? err.message : String(err)
      };
    }
  }
}
