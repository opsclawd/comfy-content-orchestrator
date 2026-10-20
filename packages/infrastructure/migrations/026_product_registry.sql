-- ---------------------------------------------------------------------------
-- PRODUCT REGISTRY: SKUS, BATCHES, FACTS & COMMAND RECEIPTS
-- Issue #472 / VPM-P1.3 (ADR 0009 §6)
-- ---------------------------------------------------------------------------

-- 1. PRODUCT SKUS
CREATE TABLE IF NOT EXISTS product_skus (
  sku_id UUID PRIMARY KEY DEFAULT uuidv7(),
  client_id UUID NOT NULL,
  canonical_sku VARCHAR(64) NOT NULL,
  display_name VARCHAR(255) NOT NULL,
  version INT NOT NULL DEFAULT 1 CHECK (version > 0),
  created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  archived_at TIMESTAMPTZ,
  CONSTRAINT fk_product_skus_client FOREIGN KEY (client_id)
    REFERENCES clients(client_id) ON DELETE RESTRICT,
  CONSTRAINT uq_product_skus_client_sku UNIQUE (client_id, sku_id),
  CONSTRAINT uq_product_skus_canonical UNIQUE (client_id, canonical_sku),
  CONSTRAINT chk_canonical_sku_format CHECK (canonical_sku ~ '^[A-Z0-9_-]{3,64}$'),
  CONSTRAINT chk_product_skus_display_name CHECK (length(trim(display_name)) > 0),
  CONSTRAINT chk_product_skus_created_at CHECK (
    isfinite(created_at) AND
    created_at >= '0001-01-01 00:00:00+00'::timestamptz AND
    created_at <= '9999-12-31 23:59:59.999999+00'::timestamptz
  ),
  CONSTRAINT chk_product_skus_updated_at CHECK (
    isfinite(updated_at) AND
    updated_at >= created_at AND
    updated_at <= '9999-12-31 23:59:59.999999+00'::timestamptz
  ),
  CONSTRAINT chk_product_skus_archived_at CHECK (
    archived_at IS NULL OR (
      isfinite(archived_at) AND
      archived_at >= created_at AND
      archived_at <= updated_at AND
      archived_at <= '9999-12-31 23:59:59.999999+00'::timestamptz
    )
  )
);

CREATE INDEX IF NOT EXISTS idx_product_skus_client_active
  ON product_skus(client_id)
  WHERE archived_at IS NULL;

-- 2. PRODUCT BATCHES
CREATE TABLE IF NOT EXISTS product_batches (
  batch_id UUID PRIMARY KEY DEFAULT uuidv7(),
  client_id UUID NOT NULL,
  sku_id UUID NOT NULL,
  lot_identifier VARCHAR(128) NOT NULL,
  display_name VARCHAR(255) NOT NULL,
  version INT NOT NULL DEFAULT 1 CHECK (version > 0),
  current_facts_revision INT NOT NULL DEFAULT 1 CHECK (current_facts_revision > 0),
  created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  archived_at TIMESTAMPTZ,
  CONSTRAINT fk_product_batches_sku FOREIGN KEY (client_id, sku_id)
    REFERENCES product_skus(client_id, sku_id) ON DELETE RESTRICT,
  CONSTRAINT uq_product_batches_client_batch UNIQUE (client_id, batch_id),
  CONSTRAINT uq_product_batches_lot UNIQUE (client_id, sku_id, lot_identifier),
  CONSTRAINT chk_lot_identifier_format CHECK (lot_identifier ~ '^[A-Za-z0-9_.-]{1,128}$'),
  CONSTRAINT chk_product_batches_display_name CHECK (length(trim(display_name)) > 0),
  CONSTRAINT chk_product_batches_created_at CHECK (
    isfinite(created_at) AND
    created_at >= '0001-01-01 00:00:00+00'::timestamptz AND
    created_at <= '9999-12-31 23:59:59.999999+00'::timestamptz
  ),
  CONSTRAINT chk_product_batches_updated_at CHECK (
    isfinite(updated_at) AND
    updated_at >= created_at AND
    updated_at <= '9999-12-31 23:59:59.999999+00'::timestamptz
  ),
  CONSTRAINT chk_product_batches_archived_at CHECK (
    archived_at IS NULL OR (
      isfinite(archived_at) AND
      archived_at >= created_at AND
      archived_at <= updated_at AND
      archived_at <= '9999-12-31 23:59:59.999999+00'::timestamptz
    )
  )
);

CREATE INDEX IF NOT EXISTS idx_product_batches_sku
  ON product_batches(client_id, sku_id)
  WHERE archived_at IS NULL;

-- 3. PRODUCT BATCH FACTS (APPEND-ONLY REVISIONS)
CREATE TABLE IF NOT EXISTS product_batch_facts (
  client_id UUID NOT NULL,
  batch_id UUID NOT NULL,
  revision INT NOT NULL CHECK (revision > 0),
  origin_kind VARCHAR(32) NOT NULL
    CHECK (origin_kind IN ('own_production', 'partner_origin', 'unknown')),
  producer_identity_as_claimed VARCHAR(255),
  production_start_date DATE,
  production_end_date DATE,
  origin_evidence_id UUID,
  origin_evidence_revision INT,
  asserted_by VARCHAR(128) NOT NULL,
  asserted_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  supersedes_revision INT,
  PRIMARY KEY (client_id, batch_id, revision),
  CONSTRAINT fk_batch_facts_batch FOREIGN KEY (client_id, batch_id)
    REFERENCES product_batches(client_id, batch_id) ON DELETE RESTRICT,
  CONSTRAINT fk_batch_facts_predecessor FOREIGN KEY (client_id, batch_id, supersedes_revision)
    REFERENCES product_batch_facts(client_id, batch_id, revision) ON DELETE RESTRICT,
  CONSTRAINT chk_batch_facts_monotonic_rev CHECK (
    (revision = 1 AND supersedes_revision IS NULL) OR
    (revision > 1 AND supersedes_revision IS NOT NULL AND supersedes_revision = revision - 1)
  ),
  CONSTRAINT uq_batch_facts_predecessor UNIQUE (client_id, batch_id, supersedes_revision),
  CONSTRAINT chk_batch_facts_origin_evidence_all_or_none CHECK (
    (origin_evidence_id IS NULL AND origin_evidence_revision IS NULL) OR
    (origin_evidence_id IS NOT NULL AND origin_evidence_revision IS NOT NULL)
  ),
  CONSTRAINT chk_batch_facts_origin_evidence_deferred CHECK (
    origin_evidence_id IS NULL AND origin_evidence_revision IS NULL
  ),
  CONSTRAINT chk_batch_facts_dates CHECK (
    production_start_date IS NULL OR production_end_date IS NULL OR production_start_date <= production_end_date
  ),
  CONSTRAINT chk_batch_facts_asserted_by_nonempty CHECK (
    length(trim(asserted_by)) > 0
  ),
  CONSTRAINT chk_batch_facts_asserted_at CHECK (
    isfinite(asserted_at) AND
    asserted_at >= '0001-01-01 00:00:00+00'::timestamptz AND
    asserted_at <= '9999-12-31 23:59:59.999999+00'::timestamptz
  ),
  CONSTRAINT chk_batch_facts_production_start_date CHECK (
    production_start_date IS NULL OR (
      isfinite(production_start_date) AND
      production_start_date >= '0001-01-01'::date AND
      production_start_date <= '9999-12-31'::date
    )
  ),
  CONSTRAINT chk_batch_facts_production_end_date CHECK (
    production_end_date IS NULL OR (
      isfinite(production_end_date) AND
      production_end_date >= '0001-01-01'::date AND
      production_end_date <= '9999-12-31'::date
    )
  ),
  CONSTRAINT chk_batch_facts_producer_identity CHECK (
    producer_identity_as_claimed IS NULL OR length(trim(producer_identity_as_claimed)) > 0
  ),
  CONSTRAINT chk_batch_facts_origin_evidence_revision CHECK (
    origin_evidence_revision IS NULL OR origin_evidence_revision > 0
  )
);

-- Circular deferred foreign key from batch head to current facts revision
ALTER TABLE product_batches
  ADD CONSTRAINT fk_product_batches_current_facts
  FOREIGN KEY (client_id, batch_id, current_facts_revision)
  REFERENCES product_batch_facts(client_id, batch_id, revision)
  ON DELETE RESTRICT
  DEFERRABLE INITIALLY DEFERRED;

-- 4. IDEMPOTENT COMMAND RECEIPTS LEDGER
CREATE TABLE IF NOT EXISTS product_evidence_command_receipts (
  client_id UUID NOT NULL,
  action_id UUID NOT NULL,
  command_name VARCHAR(128) NOT NULL,
  payload_sha256 CHAR(64) NOT NULL,
  actor_id VARCHAR(128) NOT NULL,
  response_body JSONB NOT NULL,
  committed_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (client_id, action_id),
  CONSTRAINT fk_receipts_client FOREIGN KEY (client_id)
    REFERENCES clients(client_id) ON DELETE RESTRICT,
  CONSTRAINT chk_receipt_hash_format CHECK (payload_sha256 ~ '^[0-9a-f]{64}$'),
  CONSTRAINT chk_receipt_command_nonempty CHECK (length(trim(command_name)) > 0),
  CONSTRAINT chk_receipt_actor_nonempty CHECK (length(trim(actor_id)) > 0),
  CONSTRAINT chk_receipt_committed_at CHECK (
    isfinite(committed_at) AND
    committed_at >= '0001-01-01 00:00:00+00'::timestamptz AND
    committed_at <= '9999-12-31 23:59:59.999999+00'::timestamptz
  )
);

-- ---------------------------------------------------------------------------
-- TRIGGERS & INTEGRITY GUARDS
-- ---------------------------------------------------------------------------

-- A. Append-only trigger for immutable facts and receipts
CREATE OR REPLACE FUNCTION prevent_modification_product_evidence_immutable()
RETURNS TRIGGER AS $$
BEGIN
  RAISE EXCEPTION 'CANNOT_MODIFY_IMMUTABLE_ENTITY: Table % is append-only and forbids UPDATE or DELETE', TG_TABLE_NAME
    USING ERRCODE = '23506';
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_protect_product_batch_facts
  BEFORE UPDATE OR DELETE ON product_batch_facts
  FOR EACH ROW EXECUTE FUNCTION prevent_modification_product_evidence_immutable();

CREATE TRIGGER trg_protect_product_evidence_command_receipts
  BEFORE UPDATE OR DELETE ON product_evidence_command_receipts
  FOR EACH ROW EXECUTE FUNCTION prevent_modification_product_evidence_immutable();

-- B. Head entity delete protection
CREATE OR REPLACE FUNCTION prevent_product_head_deletion()
RETURNS TRIGGER AS $$
BEGIN
  RAISE EXCEPTION 'CANNOT_DELETE_HEAD_ENTITY: Table % forbids DELETE', TG_TABLE_NAME
    USING ERRCODE = '23506';
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_protect_product_skus_delete
  BEFORE DELETE ON product_skus
  FOR EACH ROW EXECUTE FUNCTION prevent_product_head_deletion();

CREATE TRIGGER trg_protect_product_batches_delete
  BEFORE DELETE ON product_batches
  FOR EACH ROW EXECUTE FUNCTION prevent_product_head_deletion();

-- C. SKU Head BEFORE UPDATE trigger: protect immutable identity, version progression, archive status
CREATE OR REPLACE FUNCTION enforce_product_sku_head_update()
RETURNS TRIGGER AS $$
BEGIN
  -- Rejection of changes to permanent columns
  IF OLD.sku_id IS DISTINCT FROM NEW.sku_id OR
     OLD.client_id IS DISTINCT FROM NEW.client_id OR
     OLD.canonical_sku IS DISTINCT FROM NEW.canonical_sku OR
     OLD.created_at IS DISTINCT FROM NEW.created_at THEN
    RAISE EXCEPTION 'Permanent SKU identity columns cannot be updated'
      USING ERRCODE = '23506';
  END IF;

  -- One-step version advancement
  IF NEW.version IS DISTINCT FROM (OLD.version + 1) THEN
    RAISE EXCEPTION 'SKU version must advance by exactly 1'
      USING ERRCODE = '23506';
  END IF;

  -- Non-decreasing update timestamp
  IF NEW.updated_at < OLD.updated_at THEN
    RAISE EXCEPTION 'SKU updated_at must be nondecreasing'
      USING ERRCODE = '23506';
  END IF;

  -- Terminal archive check
  IF OLD.archived_at IS NOT NULL THEN
    IF NEW.archived_at IS DISTINCT FROM OLD.archived_at THEN
      RAISE EXCEPTION 'Archived SKU cannot be unarchived or have archived_at modified'
        USING ERRCODE = '23506';
    END IF;
    IF NEW.display_name IS DISTINCT FROM OLD.display_name THEN
      RAISE EXCEPTION 'Archived SKU metadata cannot be updated'
        USING ERRCODE = '23506';
    END IF;
  END IF;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_enforce_product_sku_head_update
  BEFORE UPDATE ON product_skus
  FOR EACH ROW EXECUTE FUNCTION enforce_product_sku_head_update();

-- D. Batch Head BEFORE UPDATE trigger: protect immutable identity, version progression, facts pointer, archive status
CREATE OR REPLACE FUNCTION enforce_product_batch_head_update()
RETURNS TRIGGER AS $$
BEGIN
  -- Rejection of changes to permanent columns
  IF OLD.batch_id IS DISTINCT FROM NEW.batch_id OR
     OLD.client_id IS DISTINCT FROM NEW.client_id OR
     OLD.sku_id IS DISTINCT FROM NEW.sku_id OR
     OLD.lot_identifier IS DISTINCT FROM NEW.lot_identifier OR
     OLD.created_at IS DISTINCT FROM NEW.created_at THEN
    RAISE EXCEPTION 'Permanent Batch identity columns cannot be updated'
      USING ERRCODE = '23506';
  END IF;

  -- One-step version advancement
  IF NEW.version IS DISTINCT FROM (OLD.version + 1) THEN
    RAISE EXCEPTION 'Batch version must advance by exactly 1'
      USING ERRCODE = '23506';
  END IF;

  -- Non-decreasing update timestamp
  IF NEW.updated_at < OLD.updated_at THEN
    RAISE EXCEPTION 'Batch updated_at must be nondecreasing'
      USING ERRCODE = '23506';
  END IF;

  -- Legal facts pointer progression: facts pointer can stay same (metadata/archive) or advance by exactly 1 (append)
  IF NEW.current_facts_revision < OLD.current_facts_revision OR
     NEW.current_facts_revision > (OLD.current_facts_revision + 1) THEN
    RAISE EXCEPTION 'Batch facts pointer must be monotonically nondecreasing and advance by at most 1'
      USING ERRCODE = '23506';
  END IF;

  -- Terminal archive check
  IF OLD.archived_at IS NOT NULL THEN
    IF NEW.archived_at IS DISTINCT FROM OLD.archived_at THEN
      RAISE EXCEPTION 'Archived Batch cannot be unarchived or have archived_at modified'
        USING ERRCODE = '23506';
    END IF;
    IF NEW.display_name IS DISTINCT FROM OLD.display_name OR
       NEW.current_facts_revision IS DISTINCT FROM OLD.current_facts_revision THEN
      RAISE EXCEPTION 'Archived Batch metadata cannot be updated'
        USING ERRCODE = '23506';
    END IF;
  END IF;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_enforce_product_batch_head_update
  BEFORE UPDATE ON product_batches
  FOR EACH ROW EXECUTE FUNCTION enforce_product_batch_head_update();

-- E. Parent archive guards
CREATE OR REPLACE FUNCTION check_product_batch_parent_active()
RETURNS TRIGGER AS $$
DECLARE
  v_archived_at TIMESTAMPTZ;
BEGIN
  SELECT archived_at INTO v_archived_at
  FROM product_skus
  WHERE client_id = NEW.client_id AND sku_id = NEW.sku_id
  FOR UPDATE;

  IF FOUND AND v_archived_at IS NOT NULL THEN
    RAISE EXCEPTION 'Cannot create batch under archived SKU'
      USING ERRCODE = '23506';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_product_batches_parent_active
  BEFORE INSERT ON product_batches
  FOR EACH ROW EXECUTE FUNCTION check_product_batch_parent_active();

CREATE OR REPLACE FUNCTION check_product_batch_facts_parent_active()
RETURNS TRIGGER AS $$
DECLARE
  v_archived_at TIMESTAMPTZ;
BEGIN
  SELECT archived_at INTO v_archived_at
  FROM product_batches
  WHERE client_id = NEW.client_id AND batch_id = NEW.batch_id
  FOR UPDATE;

  IF FOUND AND v_archived_at IS NOT NULL THEN
    RAISE EXCEPTION 'Cannot append facts to archived batch'
      USING ERRCODE = '23506';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_product_batch_facts_parent_active
  BEFORE INSERT ON product_batch_facts
  FOR EACH ROW EXECUTE FUNCTION check_product_batch_facts_parent_active();

-- ---------------------------------------------------------------------------
-- LEAST-PRIVILEGE ROLE CONFIGURATION & ACL ASSERTIONS
-- ---------------------------------------------------------------------------

-- Always revoke all from PUBLIC as defense in depth
REVOKE ALL ON product_skus, product_batches, product_batch_facts, product_evidence_command_receipts FROM PUBLIC;

DO $$
DECLARE
  v_app_role text := nullif(trim(current_setting('orchestrator.app_role', true)), '');
  v_role_exists boolean;
BEGIN
  IF v_app_role IS NOT NULL THEN
    -- Verify the configured role exists in pg_roles
    SELECT EXISTS (
      SELECT 1 FROM pg_roles WHERE rolname = v_app_role
    ) INTO v_role_exists;

    IF NOT v_role_exists THEN
      RAISE EXCEPTION 'Configured application role % does not exist in pg_roles', v_app_role;
    END IF;

    -- Revoke existing privileges on new tables
    EXECUTE format('REVOKE ALL ON product_skus, product_batches, product_batch_facts, product_evidence_command_receipts FROM %I', v_app_role);

    -- Grant SELECT and INSERT on all 4 tables
    EXECUTE format('GRANT SELECT, INSERT ON product_skus, product_batches, product_batch_facts, product_evidence_command_receipts TO %I', v_app_role);

    -- Explicitly revoke table-level UPDATE, DELETE, TRUNCATE
    EXECUTE format('REVOKE UPDATE, DELETE, TRUNCATE ON product_skus, product_batches, product_batch_facts, product_evidence_command_receipts FROM %I', v_app_role);

    -- Grant column-level UPDATE on allowed mutable columns only
    EXECUTE format('GRANT UPDATE (display_name, version, updated_at, archived_at) ON product_skus TO %I', v_app_role);
    EXECUTE format('GRANT UPDATE (display_name, current_facts_revision, version, updated_at, archived_at) ON product_batches TO %I', v_app_role);

    -- Assertions: effective immutable table privileges
    IF has_table_privilege(v_app_role, 'product_batch_facts', 'UPDATE') OR
       has_table_privilege(v_app_role, 'product_batch_facts', 'DELETE') OR
       has_table_privilege(v_app_role, 'product_batch_facts', 'TRUNCATE') OR
       has_table_privilege(v_app_role, 'product_evidence_command_receipts', 'UPDATE') OR
       has_table_privilege(v_app_role, 'product_evidence_command_receipts', 'DELETE') OR
       has_table_privilege(v_app_role, 'product_evidence_command_receipts', 'TRUNCATE') THEN
      RAISE EXCEPTION 'Application role % still has effective UPDATE, DELETE, or TRUNCATE privilege on immutable product tables', v_app_role;
    END IF;

    -- Assertions: effective head table DELETE and TRUNCATE privileges
    IF has_table_privilege(v_app_role, 'product_skus', 'DELETE') OR
       has_table_privilege(v_app_role, 'product_skus', 'TRUNCATE') OR
       has_table_privilege(v_app_role, 'product_batches', 'DELETE') OR
       has_table_privilege(v_app_role, 'product_batches', 'TRUNCATE') THEN
      RAISE EXCEPTION 'Application role % still has effective DELETE or TRUNCATE privilege on product head tables', v_app_role;
    END IF;

    -- Assertions: table-level UPDATE must be absent on head tables
    IF has_table_privilege(v_app_role, 'product_skus', 'UPDATE') OR
       has_table_privilege(v_app_role, 'product_batches', 'UPDATE') THEN
      RAISE EXCEPTION 'Application role % still has table-level UPDATE privilege on product head tables', v_app_role;
    END IF;

    -- Assertions: column-level UPDATE must NOT be granted on immutable columns
    IF has_column_privilege(v_app_role, 'product_skus', 'sku_id', 'UPDATE') OR
       has_column_privilege(v_app_role, 'product_skus', 'client_id', 'UPDATE') OR
       has_column_privilege(v_app_role, 'product_skus', 'canonical_sku', 'UPDATE') OR
       has_column_privilege(v_app_role, 'product_skus', 'created_at', 'UPDATE') OR
       has_column_privilege(v_app_role, 'product_batches', 'batch_id', 'UPDATE') OR
       has_column_privilege(v_app_role, 'product_batches', 'client_id', 'UPDATE') OR
       has_column_privilege(v_app_role, 'product_batches', 'sku_id', 'UPDATE') OR
       has_column_privilege(v_app_role, 'product_batches', 'lot_identifier', 'UPDATE') OR
       has_column_privilege(v_app_role, 'product_batches', 'created_at', 'UPDATE') THEN
      RAISE EXCEPTION 'Application role % has forbidden UPDATE privilege on immutable identity columns', v_app_role;
    END IF;

    -- Assertions: column-level UPDATE MUST be granted on allowed mutable columns
    IF NOT has_column_privilege(v_app_role, 'product_skus', 'display_name', 'UPDATE') OR
       NOT has_column_privilege(v_app_role, 'product_skus', 'version', 'UPDATE') OR
       NOT has_column_privilege(v_app_role, 'product_skus', 'updated_at', 'UPDATE') OR
       NOT has_column_privilege(v_app_role, 'product_skus', 'archived_at', 'UPDATE') OR
       NOT has_column_privilege(v_app_role, 'product_batches', 'display_name', 'UPDATE') OR
       NOT has_column_privilege(v_app_role, 'product_batches', 'current_facts_revision', 'UPDATE') OR
       NOT has_column_privilege(v_app_role, 'product_batches', 'version', 'UPDATE') OR
       NOT has_column_privilege(v_app_role, 'product_batches', 'updated_at', 'UPDATE') OR
       NOT has_column_privilege(v_app_role, 'product_batches', 'archived_at', 'UPDATE') THEN
      RAISE EXCEPTION 'Application role % lacks required column-level UPDATE privileges on product head tables', v_app_role;
    END IF;

  END IF;
END;
$$;
