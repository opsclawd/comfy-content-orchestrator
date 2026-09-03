import type { ClientRepository } from "@cco/application";
import type { ClientRecord } from "@cco/domain";
import type { Pool, PoolClient } from "pg";

interface ClientRow {
  client_id: string;
  company_name: string;
  brand_bible_json: Record<string, unknown> | string;
  default_aspect_ratio: string;
  external_processing_policy: Record<string, unknown> | string;
  created_at: Date | string;
  updated_at: Date | string;
}

function mapRowToClient(row: ClientRow): ClientRecord {
  return {
    id: row.client_id,
    companyName: row.company_name,
    brandBibleJson:
      typeof row.brand_bible_json === "string"
        ? JSON.parse(row.brand_bible_json)
        : row.brand_bible_json,
    defaultAspectRatio: row.default_aspect_ratio,
    externalProcessingPolicy:
      typeof row.external_processing_policy === "string"
        ? JSON.parse(row.external_processing_policy)
        : row.external_processing_policy,
    createdAt:
      row.created_at instanceof Date
        ? row.created_at.toISOString()
        : new Date(row.created_at).toISOString(),
    updatedAt:
      row.updated_at instanceof Date
        ? row.updated_at.toISOString()
        : new Date(row.updated_at).toISOString()
  };
}

export class PostgresClientRepository implements ClientRepository<ClientRecord> {
  constructor(private readonly client: Pool | PoolClient) {}

  async findById(clientId: string): Promise<ClientRecord | undefined> {
    const result = await this.client.query<ClientRow>(
      `
      SELECT
        client_id,
        company_name,
        brand_bible_json,
        default_aspect_ratio,
        external_processing_policy,
        created_at,
        updated_at
      FROM clients
      WHERE client_id = $1 AND archived_at IS NULL
      `,
      [clientId]
    );

    const row = result.rows[0];
    if (!row) {
      return undefined;
    }

    return mapRowToClient(row);
  }

  async save(client: ClientRecord): Promise<void> {
    const createdAt = client.createdAt ? new Date(client.createdAt) : new Date();
    const updatedAt = client.updatedAt ? new Date(client.updatedAt) : new Date();

    await this.client.query(
      `
      INSERT INTO clients (
        client_id,
        company_name,
        brand_bible_json,
        default_aspect_ratio,
        external_processing_policy,
        created_at,
        updated_at
      ) VALUES (
        $1, $2, $3, $4, $5, $6, $7
      )
      ON CONFLICT (client_id) DO UPDATE SET
        company_name = EXCLUDED.company_name,
        brand_bible_json = EXCLUDED.brand_bible_json,
        default_aspect_ratio = EXCLUDED.default_aspect_ratio,
        external_processing_policy = EXCLUDED.external_processing_policy,
        updated_at = CURRENT_TIMESTAMP
      `,
      [
        client.id,
        client.companyName,
        JSON.stringify(client.brandBibleJson),
        client.defaultAspectRatio,
        JSON.stringify(client.externalProcessingPolicy),
        createdAt,
        updatedAt
      ]
    );
  }
}
