# Database Migrations & Operations Runbook

This document describes the database migration architecture, operator runbooks, security boundaries, and rollback procedures for the Comfy Content Orchestrator PostgreSQL 18.6 persistence layer.

---

## 1. Prerequisites

Before running database migrations or local integration tests, ensure the following tools are installed and available:

- **Node.js**: `24.x` LTS (see `.nvmrc`)
- **pnpm**: `9.x` (`9.12.3` or higher as declared in `package.json`)
- **Docker**: Engine running and accessible via standard Docker daemon sockets (required by Testcontainers for integration tests)
- **PostgreSQL**: `18.6` (required target server version for production and staging migration environments)

---

## 2. Local & CI Testing (`pnpm test:db`)

Database integration tests run against an isolated, pinned PostgreSQL 18.6 container managed by Testcontainers.

To execute the database integration test suite:

```bash
pnpm test:db
```

This runs:
- `migration-runner.integration.test.ts`: verifies exact PostgreSQL 18.6 server detection, ordered idempotency, transactional rollback on error, and checksum drift rejection.
- `baseline-schema.integration.test.ts`: verifies complete 9-table schema instantiation, native UUIDv7 defaults, enum parity, relational constraints, foreign keys, and indexes.
- `audit-protections.integration.test.ts`: verifies `BEFORE UPDATE OR DELETE` immutability triggers on audit tables, one-job-one-manifest uniqueness, parent delete restrictions, and application-role least-privilege ACL enforcement.

> **Note:** Fast unit tests (`pnpm test`) exclude integration tests and do not require Docker. Only `pnpm test:db` starts the container.

---

## 3. Production Migration Invocations (`pnpm db:migrate`)

In staging and production environments, migrations are executed using the CLI entry point:

```bash
DATABASE_URL="postgres://migration_owner:secret@db.internal:5432/comfy_orchestrator" \
DATABASE_APP_ROLE="orchestrator_app" \
pnpm db:migrate
```

### Environment Variables

| Variable | Required | Description |
|---|---|---|
| `DATABASE_URL` | Yes | Connection string for the **migration owner** role. Must have DDL permissions on the target database. |
| `DATABASE_APP_ROLE` | Optional | Name of the pre-created application login role (e.g., `orchestrator_app`). When provided, migration `002_audit_protections.sql` configures least-privilege schema and table grants for this role. |

> **IMPORTANT:** Never commit credentials or connection strings to source control or `.env` files. In production and staging, inject `DATABASE_URL` and `DATABASE_APP_ROLE` securely via environment secrets or runtime secret managers (e.g., HashiCorp Vault, AWS Secrets Manager, or Doppler).

---

## 4. Role Separation & Application Role Bootstrap

The orchestration platform enforces a strict separation between the **migration owner** (DDL administrator) and the **application runtime role** (`orchestrator_app`).

### Bootstrap Provisioning (Outside Migrations)

The application login role must be created during database provisioning/bootstrap **before** running migrations with `DATABASE_APP_ROLE`. The role must not be granted superuser, database ownership, or global table creation privileges.

Example bootstrap SQL executed by a database administrator:

```sql
-- 1. Create the application login role without elevated privileges
CREATE ROLE orchestrator_app WITH LOGIN PASSWORD 'replace_with_secure_runtime_password' NOSUPERUSER NOCREATEDB NOCREATEROLE;

-- 2. Allow connecting to the database
GRANT CONNECT ON DATABASE comfy_orchestrator TO orchestrator_app;
```

### Role Grants & Behavior in Migrations

- **When `DATABASE_APP_ROLE` is set**:
  Migration `002_audit_protections.sql` verifies that the configured role exists in `pg_roles`. It then grants `USAGE` on schema `public`, grants `SELECT` and `INSERT` on audit tables (`generation_manifests`, `review_events`), and revokes `UPDATE` and `DELETE` on audit tables. If the role possesses residual `UPDATE` or `DELETE` permissions (e.g. through inherited roles), the migration will fail closed.
- **When `DATABASE_APP_ROLE` is omitted**:
  For local development or schema-only setups without a dedicated app role, the migration runner applies all schema tables and triggers while skipping role-specific ACL grants.

---

## 5. Migration Immutability & Checksum Rules

Migrations are stored under `packages/infrastructure/migrations/` as ordered SQL files:

```text
packages/infrastructure/migrations/
  001_baseline.sql
  002_audit_protections.sql
```

### Discovery & Ordering Rules
- Migration filenames must match the pattern `^\d+_[a-z0-9_]+\.sql$` (e.g., `001_baseline.sql`).
- Migrations are sorted and executed in ascending numeric prefix order (`1`, `2`, `3`, ...). Duplicate numeric prefixes are rejected.
- Each migration runs in an isolated transaction protected by a PostgreSQL session advisory lock (`7492840192840192`).
- Upon successful execution, the version and SHA-256 checksum are recorded in `schema_migrations(version, checksum, applied_at)`.

### Immutability & Checksum Drift
- **Once merged, migration files are immutable.**
- On each migration run, the runner computes the SHA-256 checksum of every local migration file and compares it against the recorded checksum in `schema_migrations`.
- If an already applied migration has been altered, the runner throws a checksum drift error and aborts immediately without executing subsequent migrations.
- **Rule:** Never edit, reorder, or delete an existing merged migration. Always author a new monotonically numbered migration (e.g. `003_add_feature.sql`) for changes.

---

## 6. Forward-Only Rollback Strategy

The Comfy Content Orchestrator persistence architecture uses a **forward-only** rollback model. Destructive `down` migrations are intentionally not supported to protect audit history and ensure deterministic state.

If a migration failure, deployment issue, or bug requires reversal:

1. **Stop Writers**:
   Immediately stop or scale down all active writing services (Hetzner control plane API and Trinidad render workers) to prevent new transactions and state drift.
2. **Preserve Evidence**:
   Preserve existing database state, WAL logs, and audit records for forensic analysis.
3. **Recovery Options**:
   - **For Non-Destructive Corrections**: Author, review, test, and deploy a new forward migration (e.g., `003_fix_constraint.sql`) that alters the schema forward.
   - **For Destructive Reversals**: When a schema or data change must be rolled back and cannot be corrected forward, restore the entire database from a known-good backup or Point-in-Time Recovery (PITR) target prior to the migration timestamp.

---

## 7. Audit Protections & Prohibitions

The `generation_manifests` and `review_events` tables store immutable forensic and governance records required for model safety, legal compliance, and creative review provenance.

### Prohibitions

Operators and database administrators are strictly prohibited from performing the following actions as a rollback, maintenance, or troubleshooting mechanism:

1. **Do NOT disable or drop audit triggers** (`trg_generation_manifests_immutable` or `trg_review_events_append_only`).
2. **Do NOT execute `DELETE` or `UPDATE` queries** against `generation_manifests` or `review_events`.
3. **Do NOT grant `UPDATE` or `DELETE` privileges** on audit tables to the application role or any service account.
4. **Do NOT cascade-delete parent records** (campaigns, scenes, jobs) that reference audit records; foreign keys are set to `ON DELETE RESTRICT` to prevent accidental history loss.

---

## 8. PostgreSQL 18.6 Specifics

- **Native UUIDv7**: Primary keys use PostgreSQL 18's native `DEFAULT uuidv7()` function. The legacy `uuid-ossp` extension is intentionally absent and must not be loaded.
- **PostgreSQL AIO Tuning**: Asynchronous I/O settings (`io_method`, `io_workers`) are intentionally unconfigured and absent, adhering to standard PostgreSQL 18 defaults.

---

## 9. Product & Batch Registry (Migration 026 / Issue #472 / VPM-P1.3)

Migration `026_product_registry.sql` establishes the durable PostgreSQL SKU and lot registry:

### Tables and Lifecycle

| Table | Nature | Identity & Uniqueness | Allowed Mutations |
|---|---|---|---|
| `product_skus` | Mutable Head | Native UUIDv7 `sku_id`; scoped `UNIQUE (client_id, canonical_sku)` | `display_name`, `version`, `updated_at`, `archived_at` via version-fenced UPDATE |
| `product_batches` | Mutable Head | Native UUIDv7 `batch_id`; scoped `UNIQUE (client_id, sku_id, lot_identifier)` | `display_name`, `current_facts_revision`, `version`, `updated_at`, `archived_at` via version-fenced UPDATE |
| `product_batch_facts` | Append-only Revisions | Composite PK `(client_id, batch_id, revision)`; contiguous predecessor FK | INSERT and SELECT only; UPDATE/DELETE strictly forbidden by triggers and role ACLs |
| `product_evidence_command_receipts` | Immutable Ledger | Composite PK `(client_id, action_id)` | INSERT and SELECT only; records command, payload SHA-256, actor, exact response JSONB |

### Integrity & Security Invariants

1. **Permanent Uniqueness**:
   `canonical_sku` and `lot_identifier` uniqueness constraints span both active and archived rows. Archiving a SKU or Batch permanently reserves its identifier and does not release it for reuse.
2. **Atomic Batch Creation & Circular Deferred FK**:
   `fk_product_batches_current_facts` is `DEFERRABLE INITIALLY DEFERRED`. Batch creation atomically inserts the batch head (version 1, facts revision 1), the initial facts row (revision 1), and the command receipt. Committing a head without its matching facts revision fails closed.
3. **Database-Boundary Immutability & Archive Triggers**:
   - `prevent_product_head_deletion`: Blocks `DELETE` on `product_skus` and `product_batches`.
   - `prevent_modification_product_evidence_immutable`: Blocks `UPDATE` and `DELETE` on `product_batch_facts` and `product_evidence_command_receipts`.
   - `enforce_product_sku_head_update` & `enforce_product_batch_head_update`: Block updates to immutable commercial identity columns (`client_id`, `sku_id`, `batch_id`, `canonical_sku`, `lot_identifier`, `created_at`), enforce one-step version advancement, nondecreasing update timestamps, and terminal archive state (archived heads cannot be unarchived or have metadata mutated).
   - Parent archive triggers block creating batches under archived SKUs and appending facts to archived batches.
4. **Least-Privilege Application Role Permissions**:
   The runtime role (`orchestrator_app`) is granted table-level `SELECT` and `INSERT` across all 4 tables, and strictly column-level `UPDATE` on allowed mutable columns of `product_skus` and `product_batches`. Table-level `UPDATE`, `DELETE`, and `TRUNCATE` are revoked from the application role and `PUBLIC`.
5. **Temporary Origin Evidence Link Deferral**:
   `chk_batch_facts_origin_evidence_deferred` ensures `origin_evidence_id` and `origin_evidence_revision` remain NULL until the downstream evidence association migration (#473) provides relational foreign keys.
6. **Active List Semantics**:
   Default batch queries join active parent SKUs, returning only selectable batches where both the batch and its parent SKU are unarchived. Historical catalog reads (`includeArchived: true`) return all batches regardless of parent archive status.

