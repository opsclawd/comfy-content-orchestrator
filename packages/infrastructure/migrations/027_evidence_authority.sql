-- ---------------------------------------------------------------------------
-- EVIDENCE AUTHORITY: SOURCE OBJECTS, EVIDENCE ASSETS, REVISIONS, LINKS,
-- DERIVATIVES, VERIFICATION EVENTS & DURABLE INGEST RESERVATIONS
-- Issue #473 / VPM-P1.4 (ADR 0009 §4, §5, §6)
-- ---------------------------------------------------------------------------

-- 1. CANDIDATE COMPOSITE KEY ON REFERENCE ASSETS FOR TENANT-SAFE BRIDGES
ALTER TABLE reference_assets
  ADD CONSTRAINT uq_reference_assets_client_asset UNIQUE (client_id, asset_id);

-- 2. SOURCE OBJECTS (IMMUTABLE ORIGINAL BINARIES)
CREATE TABLE IF NOT EXISTS source_objects (
  source_object_id UUID PRIMARY KEY DEFAULT uuidv7(),
  client_id UUID NOT NULL REFERENCES clients(client_id) ON DELETE RESTRICT,
  storage_bucket VARCHAR(128) NOT NULL,
  storage_object_key TEXT NOT NULL,
  original_sha256 CHAR(64) NOT NULL,
  detected_mime_type VARCHAR(128) NOT NULL,
  byte_length BIGINT NOT NULL CHECK (byte_length > 0),
  uploaded_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  uploader_id VARCHAR(128) NOT NULL,
  access_class VARCHAR(64) NOT NULL DEFAULT 'restricted_original'
    CHECK (access_class = 'restricted_original'),
  retention_class VARCHAR(64) NOT NULL DEFAULT 'source_evidence_archive'
    CHECK (retention_class = 'source_evidence_archive'),
  retention_policy_version VARCHAR(64) NOT NULL,
  availability VARCHAR(32) NOT NULL DEFAULT 'available'
    CHECK (availability IN ('available', 'archived', 'quarantined', 'deleted_under_retention')),
  storage_version_id VARCHAR(128),
  CONSTRAINT uq_source_objects_client_obj UNIQUE (client_id, source_object_id),
  CONSTRAINT uq_source_objects_client_hash UNIQUE (client_id, original_sha256),
  CONSTRAINT uq_source_objects_storage UNIQUE (storage_bucket, storage_object_key),
  CONSTRAINT chk_sha256_format CHECK (original_sha256 ~ '^[0-9a-f]{64}$'),
  CONSTRAINT chk_source_objects_uploader_nonempty CHECK (length(trim(uploader_id)) > 0),
  CONSTRAINT chk_source_objects_policy_nonempty CHECK (length(trim(retention_policy_version)) > 0),
  CONSTRAINT chk_source_objects_mime_nonempty CHECK (length(trim(detected_mime_type)) > 0),
  CONSTRAINT chk_source_objects_bucket_nonempty CHECK (length(trim(storage_bucket)) > 0),
  CONSTRAINT chk_source_objects_key_nonempty CHECK (length(trim(storage_object_key)) > 0),
  CONSTRAINT chk_source_objects_uploaded_at CHECK (
    isfinite(uploaded_at) AND
    uploaded_at >= '0001-01-01 00:00:00+00'::timestamptz AND
    uploaded_at <= '9999-12-31 23:59:59.999999+00'::timestamptz
  )
);

CREATE INDEX IF NOT EXISTS idx_source_objects_hash
  ON source_objects(client_id, original_sha256);

-- 3. EVIDENCE ASSETS (HEAD TABLE)
CREATE TABLE IF NOT EXISTS evidence_assets (
  evidence_id UUID PRIMARY KEY DEFAULT uuidv7(),
  client_id UUID NOT NULL REFERENCES clients(client_id) ON DELETE RESTRICT,
  current_revision INT NOT NULL DEFAULT 1 CHECK (current_revision > 0),
  version INT NOT NULL DEFAULT 1 CHECK (version > 0),
  created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  archived_at TIMESTAMPTZ,
  CONSTRAINT uq_evidence_assets_client_evidence UNIQUE (client_id, evidence_id),
  CONSTRAINT chk_evidence_assets_created_at CHECK (
    isfinite(created_at) AND
    created_at >= '0001-01-01 00:00:00+00'::timestamptz AND
    created_at <= '9999-12-31 23:59:59.999999+00'::timestamptz
  ),
  CONSTRAINT chk_evidence_assets_archived_at CHECK (
    archived_at IS NULL OR (
      isfinite(archived_at) AND
      archived_at >= created_at AND
      archived_at <= '9999-12-31 23:59:59.999999+00'::timestamptz
    )
  )
);

CREATE INDEX IF NOT EXISTS idx_evidence_assets_client_active
  ON evidence_assets(client_id)
  WHERE archived_at IS NULL;

-- 4. EVIDENCE REVISIONS (APPEND-ONLY ASSERTIONS)
CREATE TABLE IF NOT EXISTS evidence_revisions (
  client_id UUID NOT NULL,
  evidence_id UUID NOT NULL,
  revision INT NOT NULL CHECK (revision > 0),
  source_object_id UUID NOT NULL,
  source_class VARCHAR(32) NOT NULL
    CHECK (source_class IN ('photo', 'video', 'raw', 'document', 'coa', 'process_record')),
  acquisition_method VARCHAR(32) NOT NULL
    CHECK (acquisition_method IN ('direct_upload', 'supplier_submission', 'field_capture', 'lab_transfer')),
  submitted_by VARCHAR(128) NOT NULL,
  submitted_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  assertion_text TEXT NOT NULL,
  reported_capture_date DATE,
  reported_capture_timestamp TIMESTAMPTZ,
  reported_capture_precision VARCHAR(16)
    CHECK (reported_capture_precision IS NULL OR reported_capture_precision IN ('date', 'minute', 'second', 'millisecond')),
  capture_context TEXT,
  rights_status VARCHAR(16) NOT NULL DEFAULT 'unknown'
    CHECK (rights_status IN ('unknown', 'granted', 'restricted', 'denied')),
  consent_status VARCHAR(16) NOT NULL DEFAULT 'unknown'
    CHECK (consent_status IN ('unknown', 'granted', 'restricted', 'denied')),
  rights_attribution TEXT,
  rights_document_locator TEXT,
  supersedes_revision INT,
  PRIMARY KEY (client_id, evidence_id, revision),
  CONSTRAINT fk_evidence_revisions_asset FOREIGN KEY (client_id, evidence_id)
    REFERENCES evidence_assets(client_id, evidence_id) ON DELETE RESTRICT,
  CONSTRAINT fk_evidence_revisions_source FOREIGN KEY (client_id, source_object_id)
    REFERENCES source_objects(client_id, source_object_id) ON DELETE RESTRICT,
  CONSTRAINT fk_evidence_revisions_predecessor FOREIGN KEY (client_id, evidence_id, supersedes_revision)
    REFERENCES evidence_revisions(client_id, evidence_id, revision) ON DELETE RESTRICT,
  CONSTRAINT chk_evidence_rev_monotonic CHECK (
    (revision = 1 AND supersedes_revision IS NULL) OR
    (revision > 1 AND supersedes_revision IS NOT NULL AND supersedes_revision = revision - 1)
  ),
  CONSTRAINT uq_evidence_rev_predecessor UNIQUE (client_id, evidence_id, supersedes_revision),
  CONSTRAINT chk_evidence_revisions_assertion_nonempty CHECK (length(trim(assertion_text)) > 0),
  CONSTRAINT chk_evidence_revisions_submitted_by_nonempty CHECK (length(trim(submitted_by)) > 0),
  CONSTRAINT chk_evidence_revisions_submitted_at CHECK (
    isfinite(submitted_at) AND
    submitted_at >= '0001-01-01 00:00:00+00'::timestamptz AND
    submitted_at <= '9999-12-31 23:59:59.999999+00'::timestamptz
  ),
  CONSTRAINT chk_evidence_revisions_capture_date CHECK (
    reported_capture_date IS NULL OR (
      isfinite(reported_capture_date) AND
      reported_capture_date >= '0001-01-01'::date AND
      reported_capture_date <= '9999-12-31'::date
    )
  ),
  CONSTRAINT chk_evidence_revisions_capture_timestamp CHECK (
    reported_capture_timestamp IS NULL OR (
      isfinite(reported_capture_timestamp) AND
      reported_capture_timestamp >= '0001-01-01 00:00:00+00'::timestamptz AND
      reported_capture_timestamp <= '9999-12-31 23:59:59.999999+00'::timestamptz
    )
  ),
  CONSTRAINT chk_evidence_revisions_capture_date_match CHECK (
    reported_capture_date IS NULL OR
    reported_capture_timestamp IS NULL OR
    reported_capture_date = (reported_capture_timestamp AT TIME ZONE 'UTC')::date
  )
);

ALTER TABLE evidence_assets
  ADD CONSTRAINT fk_evidence_assets_current_rev
  FOREIGN KEY (client_id, evidence_id, current_revision)
  REFERENCES evidence_revisions(client_id, evidence_id, revision)
  ON DELETE RESTRICT
  DEFERRABLE INITIALLY DEFERRED;

-- 5. BATCH EVIDENCE LINKS (EXPLICIT LOT-LEVEL ATTESTATIONS)
CREATE TABLE IF NOT EXISTS batch_evidence_links (
  client_id UUID NOT NULL,
  batch_id UUID NOT NULL,
  evidence_id UUID NOT NULL,
  evidence_revision INT NOT NULL,
  purpose VARCHAR(32) NOT NULL
    CHECK (purpose IN (
      'macro_hero_photo', 'coa_test_report', 'cultivation_log',
      'processing_record', 'packaging_spec', 'general_supporting_evidence'
    )),
  asserted_by VARCHAR(128) NOT NULL,
  asserted_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (client_id, batch_id, evidence_id, evidence_revision),
  CONSTRAINT uq_batch_evidence_links_full UNIQUE (client_id, batch_id, evidence_id, evidence_revision),
  CONSTRAINT fk_batch_evidence_batch FOREIGN KEY (client_id, batch_id)
    REFERENCES product_batches(client_id, batch_id) ON DELETE RESTRICT,
  CONSTRAINT fk_batch_evidence_revision FOREIGN KEY (client_id, evidence_id, evidence_revision)
    REFERENCES evidence_revisions(client_id, evidence_id, revision) ON DELETE RESTRICT,
  CONSTRAINT chk_batch_evidence_asserted_by_nonempty CHECK (length(trim(asserted_by)) > 0),
  CONSTRAINT chk_batch_evidence_asserted_at CHECK (
    isfinite(asserted_at) AND
    asserted_at >= '0001-01-01 00:00:00+00'::timestamptz AND
    asserted_at <= '9999-12-31 23:59:59.999999+00'::timestamptz
  )
);

CREATE INDEX IF NOT EXISTS idx_batch_evidence_links_batch
  ON batch_evidence_links(client_id, batch_id);

-- 6. REPLACE DEFERRED ORIGIN EVIDENCE RESTRICTION WITH EXACT BATCH LINK FK
ALTER TABLE product_batch_facts
  DROP CONSTRAINT IF EXISTS chk_batch_facts_origin_evidence_deferred;

ALTER TABLE product_batch_facts
  ADD CONSTRAINT fk_batch_facts_origin_evidence
  FOREIGN KEY (client_id, batch_id, origin_evidence_id, origin_evidence_revision)
  REFERENCES batch_evidence_links(client_id, batch_id, evidence_id, evidence_revision)
  ON DELETE RESTRICT;

-- 7. EVIDENCE DERIVATIVES (REFERENCE ASSET BRIDGE)
CREATE TABLE IF NOT EXISTS evidence_derivatives (
  derivative_id UUID PRIMARY KEY DEFAULT uuidv7(),
  client_id UUID NOT NULL,
  evidence_id UUID NOT NULL,
  evidence_revision INT NOT NULL,
  reference_asset_id UUID NOT NULL,
  derivative_sha256 CHAR(64) NOT NULL,
  transform_description TEXT NOT NULL,
  transform_tool_version VARCHAR(128),
  created_by VARCHAR(128) NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT uq_evidence_derivatives_client_deriv UNIQUE (client_id, derivative_id),
  CONSTRAINT uq_evidence_derivatives_bridge UNIQUE (client_id, evidence_id, evidence_revision, reference_asset_id),
  CONSTRAINT fk_evidence_derivatives_revision FOREIGN KEY (client_id, evidence_id, evidence_revision)
    REFERENCES evidence_revisions(client_id, evidence_id, revision) ON DELETE RESTRICT,
  CONSTRAINT fk_evidence_derivatives_reference FOREIGN KEY (client_id, reference_asset_id)
    REFERENCES reference_assets(client_id, asset_id) ON DELETE RESTRICT,
  CONSTRAINT chk_derivative_sha256_format CHECK (derivative_sha256 ~ '^[0-9a-f]{64}$'),
  CONSTRAINT chk_derivative_transform_nonempty CHECK (length(trim(transform_description)) > 0),
  CONSTRAINT chk_derivative_created_by_nonempty CHECK (length(trim(created_by)) > 0),
  CONSTRAINT chk_derivative_created_at CHECK (
    isfinite(created_at) AND
    created_at >= '0001-01-01 00:00:00+00'::timestamptz AND
    created_at <= '9999-12-31 23:59:59.999999+00'::timestamptz
  )
);

CREATE INDEX IF NOT EXISTS idx_evidence_derivatives_evidence
  ON evidence_derivatives(client_id, evidence_id, evidence_revision);

-- 8. EVIDENCE VERIFICATION EVENTS (INDEPENDENT AUDIT LEDGER)
CREATE TABLE IF NOT EXISTS evidence_verification_events (
  event_id UUID PRIMARY KEY DEFAULT uuidv7(),
  client_id UUID NOT NULL,
  evidence_id UUID NOT NULL,
  evidence_revision INT NOT NULL,
  outcome VARCHAR(16) NOT NULL
    CHECK (outcome IN ('verified', 'rejected', 'disputed', 'withdrawn')),
  verification_kind VARCHAR(64) NOT NULL
    CHECK (verification_kind IN (
      'submitter_attestation', 'human_internal_review', 'independent_third_party_corroboration'
    )),
  fact_scope VARCHAR(64) NOT NULL
    CHECK (fact_scope IN (
      'provenance_metadata', 'capture_circumstances', 'lab_identity', 'chain_of_custody', 'full_document_authenticity'
    )),
  actor_id VARCHAR(128) NOT NULL,
  occurred_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  method TEXT NOT NULL,
  reason TEXT NOT NULL,
  verified_party_reference TEXT,
  withdrawal_event_id UUID,
  CONSTRAINT uq_verification_events_client_event UNIQUE (client_id, event_id),
  CONSTRAINT uq_verification_events_full UNIQUE (client_id, evidence_id, evidence_revision, event_id),
  CONSTRAINT fk_verification_events_revision FOREIGN KEY (client_id, evidence_id, evidence_revision)
    REFERENCES evidence_revisions(client_id, evidence_id, revision) ON DELETE RESTRICT,
  CONSTRAINT fk_verification_events_withdrawal FOREIGN KEY (client_id, evidence_id, evidence_revision, withdrawal_event_id)
    REFERENCES evidence_verification_events(client_id, evidence_id, evidence_revision, event_id) ON DELETE RESTRICT,
  CONSTRAINT chk_verification_events_withdrawal_no_self CHECK (withdrawal_event_id IS NULL OR withdrawal_event_id != event_id),
  CONSTRAINT chk_verification_events_method_nonempty CHECK (length(trim(method)) > 0),
  CONSTRAINT chk_verification_events_reason_nonempty CHECK (length(trim(reason)) > 0),
  CONSTRAINT chk_verification_events_actor_nonempty CHECK (length(trim(actor_id)) > 0),
  CONSTRAINT chk_verification_events_occurred_at CHECK (
    isfinite(occurred_at) AND
    occurred_at >= '0001-01-01 00:00:00+00'::timestamptz AND
    occurred_at <= '9999-12-31 23:59:59.999999+00'::timestamptz
  )
);

CREATE INDEX IF NOT EXISTS idx_verification_events_evidence
  ON evidence_verification_events(client_id, evidence_id, evidence_revision);

-- 9. DURABLE INGEST RESERVATIONS (INFLIGHT QUOTA & RECOVERY)
CREATE TABLE IF NOT EXISTS evidence_ingest_reservations (
  reservation_id UUID PRIMARY KEY DEFAULT uuidv7(),
  client_id UUID NOT NULL REFERENCES clients(client_id) ON DELETE RESTRICT,
  sha256 CHAR(64) NOT NULL,
  reserved_bytes BIGINT NOT NULL CHECK (reserved_bytes > 0),
  status VARCHAR(32) NOT NULL DEFAULT 'active'
    CHECK (status IN ('active', 'committed', 'released', 'abandoned')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  expires_at TIMESTAMPTZ NOT NULL,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT chk_reservation_sha256_format CHECK (sha256 ~ '^[0-9a-f]{64}$'),
  CONSTRAINT chk_reservation_timestamps CHECK (
    isfinite(created_at) AND isfinite(expires_at) AND isfinite(updated_at) AND
    expires_at >= created_at AND updated_at >= created_at
  )
);

CREATE INDEX IF NOT EXISTS idx_evidence_reservations_active
  ON evidence_ingest_reservations(client_id, status)
  WHERE status = 'active';

-- ---------------------------------------------------------------------------
-- TRIGGERS & INTEGRITY GUARDS
-- ---------------------------------------------------------------------------

-- Append-only trigger for immutable evidence revisions, links, derivatives, events
CREATE TRIGGER trg_protect_evidence_revisions
  BEFORE UPDATE OR DELETE ON evidence_revisions
  FOR EACH ROW EXECUTE FUNCTION prevent_modification_product_evidence_immutable();

CREATE TRIGGER trg_protect_batch_evidence_links
  BEFORE UPDATE OR DELETE ON batch_evidence_links
  FOR EACH ROW EXECUTE FUNCTION prevent_modification_product_evidence_immutable();

CREATE TRIGGER trg_protect_evidence_derivatives
  BEFORE UPDATE OR DELETE ON evidence_derivatives
  FOR EACH ROW EXECUTE FUNCTION prevent_modification_product_evidence_immutable();

CREATE TRIGGER trg_protect_evidence_verification_events
  BEFORE UPDATE OR DELETE ON evidence_verification_events
  FOR EACH ROW EXECUTE FUNCTION prevent_modification_product_evidence_immutable();

-- Head entity delete protections
CREATE TRIGGER trg_protect_evidence_assets_delete
  BEFORE DELETE ON evidence_assets
  FOR EACH ROW EXECUTE FUNCTION prevent_product_head_deletion();

CREATE TRIGGER trg_protect_source_objects_delete
  BEFORE DELETE ON source_objects
  FOR EACH ROW EXECUTE FUNCTION prevent_product_head_deletion();

-- Evidence Asset Head BEFORE UPDATE trigger: protect immutable identity, version progression, archive status
CREATE OR REPLACE FUNCTION enforce_evidence_asset_head_update()
RETURNS TRIGGER AS $$
BEGIN
  -- Rejection of changes to permanent columns
  IF OLD.evidence_id IS DISTINCT FROM NEW.evidence_id OR
     OLD.client_id IS DISTINCT FROM NEW.client_id OR
     OLD.created_at IS DISTINCT FROM NEW.created_at THEN
    RAISE EXCEPTION 'Permanent evidence asset identity columns cannot be updated'
      USING ERRCODE = '23506';
  END IF;

  -- One-step version advancement
  IF NEW.version IS DISTINCT FROM (OLD.version + 1) THEN
    RAISE EXCEPTION 'Evidence asset version must advance by exactly 1'
      USING ERRCODE = '23506';
  END IF;

  -- Legal revision pointer progression: must stay same (archive) or advance by exactly 1 (supersede)
  IF NEW.current_revision < OLD.current_revision OR
     NEW.current_revision > (OLD.current_revision + 1) THEN
    RAISE EXCEPTION 'Evidence asset current_revision must be monotonically nondecreasing and advance by at most 1'
      USING ERRCODE = '23506';
  END IF;

  -- Terminal archive check
  IF OLD.archived_at IS NOT NULL THEN
    IF NEW.archived_at IS DISTINCT FROM OLD.archived_at THEN
      RAISE EXCEPTION 'Archived evidence asset cannot be unarchived or have archived_at modified'
        USING ERRCODE = '23506';
    END IF;
    IF NEW.current_revision IS DISTINCT FROM OLD.current_revision THEN
      RAISE EXCEPTION 'Archived evidence asset cannot be superseded'
        USING ERRCODE = '23506';
    END IF;
  END IF;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_enforce_evidence_asset_head_update
  BEFORE UPDATE ON evidence_assets
  FOR EACH ROW EXECUTE FUNCTION enforce_evidence_asset_head_update();

-- Source Object BEFORE UPDATE trigger: protect immutable file binary properties
CREATE OR REPLACE FUNCTION enforce_source_object_update()
RETURNS TRIGGER AS $$
BEGIN
  -- Rejection of changes to permanent file binary columns
  IF OLD.source_object_id IS DISTINCT FROM NEW.source_object_id OR
     OLD.client_id IS DISTINCT FROM NEW.client_id OR
     OLD.storage_bucket IS DISTINCT FROM NEW.storage_bucket OR
     OLD.storage_object_key IS DISTINCT FROM NEW.storage_object_key OR
     OLD.original_sha256 IS DISTINCT FROM NEW.original_sha256 OR
     OLD.detected_mime_type IS DISTINCT FROM NEW.detected_mime_type OR
     OLD.byte_length IS DISTINCT FROM NEW.byte_length OR
     OLD.uploaded_at IS DISTINCT FROM NEW.uploaded_at OR
     OLD.uploader_id IS DISTINCT FROM NEW.uploader_id OR
     OLD.access_class IS DISTINCT FROM NEW.access_class OR
     OLD.retention_class IS DISTINCT FROM NEW.retention_class OR
     OLD.retention_policy_version IS DISTINCT FROM NEW.retention_policy_version THEN
    RAISE EXCEPTION 'Permanent source object binary columns cannot be updated'
      USING ERRCODE = '23506';
  END IF;

  -- Refuse reviving archived, quarantined, or retention-deleted source
  IF OLD.availability = 'archived' THEN
    RAISE EXCEPTION 'Archived source objects cannot be reactivated or updated'
      USING ERRCODE = '23506';
  END IF;
  IF OLD.availability = 'deleted_under_retention' THEN
    RAISE EXCEPTION 'Deleted source objects cannot be reactivated or updated'
      USING ERRCODE = '23506';
  END IF;
  IF OLD.availability = 'quarantined' AND NEW.availability = 'available' THEN
    RAISE EXCEPTION 'Quarantined, archived, or deleted source objects cannot be reactivated'
      USING ERRCODE = '23506';
  END IF;

  -- Prevent storage_version_id from being overwritten once set
  IF OLD.storage_version_id IS NOT NULL AND OLD.storage_version_id IS DISTINCT FROM NEW.storage_version_id THEN
    RAISE EXCEPTION 'Storage version ID cannot be changed once set'
      USING ERRCODE = '23506';
  END IF;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_enforce_source_object_update
  BEFORE UPDATE ON source_objects
  FOR EACH ROW EXECUTE FUNCTION enforce_source_object_update();

-- ---------------------------------------------------------------------------
-- LEAST-PRIVILEGE ROLE CONFIGURATION & ACL ASSERTIONS
-- ---------------------------------------------------------------------------

-- Always revoke all from PUBLIC as defense in depth
REVOKE ALL ON source_objects, evidence_assets, evidence_revisions, batch_evidence_links,
  evidence_derivatives, evidence_verification_events, evidence_ingest_reservations FROM PUBLIC;

DO $$
DECLARE
  v_app_role text := nullif(trim(current_setting('orchestrator.app_role', true)), '');
  v_role_exists boolean;
BEGIN
  IF v_app_role IS NOT NULL THEN
    SELECT EXISTS (
      SELECT 1 FROM pg_roles WHERE rolname = v_app_role
    ) INTO v_role_exists;

    IF NOT v_role_exists THEN
      RAISE EXCEPTION 'Configured application role % does not exist in pg_roles', v_app_role;
    END IF;

    -- Revoke existing privileges on new tables
    EXECUTE format('REVOKE ALL ON source_objects, evidence_assets, evidence_revisions, batch_evidence_links, evidence_derivatives, evidence_verification_events, evidence_ingest_reservations FROM %I', v_app_role);

    -- Grant SELECT and INSERT on all tables
    EXECUTE format('GRANT SELECT, INSERT ON source_objects, evidence_assets, evidence_revisions, batch_evidence_links, evidence_derivatives, evidence_verification_events, evidence_ingest_reservations TO %I', v_app_role);

    -- Explicitly revoke table-level UPDATE, DELETE, TRUNCATE
    EXECUTE format('REVOKE UPDATE, DELETE, TRUNCATE ON source_objects, evidence_assets, evidence_revisions, batch_evidence_links, evidence_derivatives, evidence_verification_events, evidence_ingest_reservations FROM %I', v_app_role);

    -- Grant column-level UPDATE on allowed mutable columns only
    EXECUTE format('GRANT UPDATE (availability, storage_version_id) ON source_objects TO %I', v_app_role);
    EXECUTE format('GRANT UPDATE (current_revision, version, archived_at) ON evidence_assets TO %I', v_app_role);
    EXECUTE format('GRANT UPDATE (status, updated_at) ON evidence_ingest_reservations TO %I', v_app_role);

    -- Assertions: effective immutable table privileges
    IF has_table_privilege(v_app_role, 'evidence_revisions', 'UPDATE') OR
       has_table_privilege(v_app_role, 'evidence_revisions', 'DELETE') OR
       has_table_privilege(v_app_role, 'evidence_revisions', 'TRUNCATE') OR
       has_table_privilege(v_app_role, 'batch_evidence_links', 'UPDATE') OR
       has_table_privilege(v_app_role, 'batch_evidence_links', 'DELETE') OR
       has_table_privilege(v_app_role, 'batch_evidence_links', 'TRUNCATE') OR
       has_table_privilege(v_app_role, 'evidence_derivatives', 'UPDATE') OR
       has_table_privilege(v_app_role, 'evidence_derivatives', 'DELETE') OR
       has_table_privilege(v_app_role, 'evidence_derivatives', 'TRUNCATE') OR
       has_table_privilege(v_app_role, 'evidence_verification_events', 'UPDATE') OR
       has_table_privilege(v_app_role, 'evidence_verification_events', 'DELETE') OR
       has_table_privilege(v_app_role, 'evidence_verification_events', 'TRUNCATE') THEN
      RAISE EXCEPTION 'Application role % still has effective UPDATE, DELETE, or TRUNCATE privilege on immutable evidence tables', v_app_role;
    END IF;

    -- Assertions: effective head table DELETE and TRUNCATE privileges
    IF has_table_privilege(v_app_role, 'source_objects', 'DELETE') OR
       has_table_privilege(v_app_role, 'source_objects', 'TRUNCATE') OR
       has_table_privilege(v_app_role, 'evidence_assets', 'DELETE') OR
       has_table_privilege(v_app_role, 'evidence_assets', 'TRUNCATE') OR
       has_table_privilege(v_app_role, 'evidence_ingest_reservations', 'DELETE') OR
       has_table_privilege(v_app_role, 'evidence_ingest_reservations', 'TRUNCATE') THEN
      RAISE EXCEPTION 'Application role % still has effective DELETE or TRUNCATE privilege on evidence head/operational tables', v_app_role;
    END IF;

    -- Assertions: table-level UPDATE must be absent on head tables
    IF has_table_privilege(v_app_role, 'source_objects', 'UPDATE') OR
       has_table_privilege(v_app_role, 'evidence_assets', 'UPDATE') OR
       has_table_privilege(v_app_role, 'evidence_ingest_reservations', 'UPDATE') THEN
      RAISE EXCEPTION 'Application role % still has table-level UPDATE privilege on evidence head/operational tables', v_app_role;
    END IF;

    -- Assertions: column-level UPDATE must NOT be granted on immutable columns
    IF has_column_privilege(v_app_role, 'source_objects', 'source_object_id', 'UPDATE') OR
       has_column_privilege(v_app_role, 'source_objects', 'client_id', 'UPDATE') OR
       has_column_privilege(v_app_role, 'source_objects', 'original_sha256', 'UPDATE') OR
       has_column_privilege(v_app_role, 'source_objects', 'storage_bucket', 'UPDATE') OR
       has_column_privilege(v_app_role, 'source_objects', 'storage_object_key', 'UPDATE') OR
       has_column_privilege(v_app_role, 'source_objects', 'byte_length', 'UPDATE') OR
       has_column_privilege(v_app_role, 'source_objects', 'uploader_id', 'UPDATE') OR
       has_column_privilege(v_app_role, 'source_objects', 'uploaded_at', 'UPDATE') OR
       has_column_privilege(v_app_role, 'evidence_assets', 'evidence_id', 'UPDATE') OR
       has_column_privilege(v_app_role, 'evidence_assets', 'client_id', 'UPDATE') OR
       has_column_privilege(v_app_role, 'evidence_assets', 'created_at', 'UPDATE') OR
       has_column_privilege(v_app_role, 'evidence_ingest_reservations', 'reservation_id', 'UPDATE') OR
       has_column_privilege(v_app_role, 'evidence_ingest_reservations', 'client_id', 'UPDATE') OR
       has_column_privilege(v_app_role, 'evidence_ingest_reservations', 'sha256', 'UPDATE') OR
       has_column_privilege(v_app_role, 'evidence_ingest_reservations', 'reserved_bytes', 'UPDATE') OR
       has_column_privilege(v_app_role, 'evidence_ingest_reservations', 'created_at', 'UPDATE') OR
       has_column_privilege(v_app_role, 'evidence_ingest_reservations', 'expires_at', 'UPDATE') THEN
      RAISE EXCEPTION 'Application role % has forbidden UPDATE privilege on immutable identity columns of evidence tables', v_app_role;
    END IF;

    -- Assertions: column-level UPDATE MUST be granted on allowed mutable columns
    IF NOT has_column_privilege(v_app_role, 'source_objects', 'availability', 'UPDATE') OR
       NOT has_column_privilege(v_app_role, 'source_objects', 'storage_version_id', 'UPDATE') OR
       NOT has_column_privilege(v_app_role, 'evidence_assets', 'current_revision', 'UPDATE') OR
       NOT has_column_privilege(v_app_role, 'evidence_assets', 'version', 'UPDATE') OR
       NOT has_column_privilege(v_app_role, 'evidence_assets', 'archived_at', 'UPDATE') OR
       NOT has_column_privilege(v_app_role, 'evidence_ingest_reservations', 'status', 'UPDATE') OR
       NOT has_column_privilege(v_app_role, 'evidence_ingest_reservations', 'updated_at', 'UPDATE') THEN
      RAISE EXCEPTION 'Application role % lacks required column-level UPDATE privileges on evidence tables', v_app_role;
    END IF;
  END IF;
END;
$$;
