-- ---------------------------------------------------------------------------
-- COA REPORTS & TYPED ANALYTICAL MEASUREMENTS
-- Issue #474 / VPM-P1.5 (ADR 0009 §8, §3.3, §6.2, §6.3)
-- ---------------------------------------------------------------------------

-- 1. COA REPORTS (HEAD TABLE)
CREATE TABLE IF NOT EXISTS coa_reports (
  report_id UUID PRIMARY KEY DEFAULT uuidv7(),
  client_id UUID NOT NULL REFERENCES clients(client_id) ON DELETE RESTRICT,
  batch_id UUID NOT NULL,
  evidence_id UUID NOT NULL,
  current_revision INT NOT NULL DEFAULT 1 CHECK (current_revision > 0),
  version INT NOT NULL DEFAULT 1 CHECK (version > 0),
  created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  archived_at TIMESTAMPTZ,
  CONSTRAINT uq_coa_reports_client_report UNIQUE (client_id, report_id),
  CONSTRAINT uq_coa_reports_client_batch_evidence UNIQUE (client_id, batch_id, evidence_id),
  CONSTRAINT uq_coa_reports_head_identity UNIQUE (client_id, report_id, batch_id, evidence_id),
  CONSTRAINT fk_coa_reports_batch FOREIGN KEY (client_id, batch_id)
    REFERENCES product_batches(client_id, batch_id) ON DELETE RESTRICT,
  CONSTRAINT fk_coa_reports_evidence FOREIGN KEY (client_id, evidence_id)
    REFERENCES evidence_assets(client_id, evidence_id) ON DELETE RESTRICT,
  CONSTRAINT chk_coa_reports_created_at CHECK (
    isfinite(created_at) AND
    created_at >= '0001-01-01 00:00:00+00'::timestamptz AND
    created_at <= '9999-12-31 23:59:59.999999+00'::timestamptz
  ),
  CONSTRAINT chk_coa_reports_archived_at CHECK (
    archived_at IS NULL OR (
      isfinite(archived_at) AND
      archived_at >= created_at AND
      archived_at <= '9999-12-31 23:59:59.999999+00'::timestamptz
    )
  )
);

CREATE INDEX IF NOT EXISTS idx_coa_reports_client_batch
  ON coa_reports(client_id, batch_id)
  WHERE archived_at IS NULL;

-- 2. COA REPORT REVISIONS (APPEND-ONLY ASSERTIONS)
CREATE TABLE IF NOT EXISTS coa_report_revisions (
  client_id UUID NOT NULL,
  report_id UUID NOT NULL,
  revision INT NOT NULL CHECK (revision > 0),
  batch_id UUID NOT NULL,
  evidence_id UUID NOT NULL,
  evidence_revision INT NOT NULL CHECK (evidence_revision > 0),
  completeness_status VARCHAR(16) NOT NULL DEFAULT 'draft'
    CHECK (completeness_status IN ('draft', 'complete')),
  report_identifier_as_claimed VARCHAR(128),
  report_date DATE,
  lab_name_as_claimed VARCHAR(255),
  sample_identifier_as_claimed VARCHAR(128),
  scope_kind VARCHAR(32)
    CHECK (scope_kind IS NULL OR scope_kind IN ('sample_only', 'attributed_lot')),
  scope_description TEXT,
  sample_date DATE,
  sampling_method_description TEXT,
  sample_to_batch_association_attestation TEXT,
  sample_to_batch_association_confirmed BOOLEAN,
  verified_lab_identity_event_id UUID,
  asserted_by VARCHAR(128) NOT NULL,
  asserted_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  supersedes_revision INT,
  PRIMARY KEY (client_id, report_id, revision),
  CONSTRAINT uq_coa_report_revisions_lineage UNIQUE (client_id, report_id, revision, batch_id, evidence_id, evidence_revision),
  CONSTRAINT fk_coa_report_revisions_head FOREIGN KEY (client_id, report_id)
    REFERENCES coa_reports(client_id, report_id) ON DELETE RESTRICT,
  CONSTRAINT fk_coa_report_revisions_head_identity FOREIGN KEY (client_id, report_id, batch_id, evidence_id)
    REFERENCES coa_reports(client_id, report_id, batch_id, evidence_id) ON DELETE RESTRICT,
  CONSTRAINT fk_coa_report_batch_evidence FOREIGN KEY (client_id, batch_id, evidence_id, evidence_revision)
    REFERENCES batch_evidence_links(client_id, batch_id, evidence_id, evidence_revision) ON DELETE RESTRICT,
  CONSTRAINT fk_coa_report_verified_lab FOREIGN KEY (client_id, evidence_id, evidence_revision, verified_lab_identity_event_id)
    REFERENCES evidence_verification_events(client_id, evidence_id, evidence_revision, event_id) ON DELETE RESTRICT,
  CONSTRAINT fk_coa_report_predecessor FOREIGN KEY (client_id, report_id, supersedes_revision)
    REFERENCES coa_report_revisions(client_id, report_id, revision) ON DELETE RESTRICT,
  CONSTRAINT chk_coa_report_rev_monotonic CHECK (
    (revision = 1 AND supersedes_revision IS NULL) OR
    (revision > 1 AND supersedes_revision IS NOT NULL AND supersedes_revision = revision - 1)
  ),
  CONSTRAINT uq_coa_report_rev_predecessor UNIQUE (client_id, report_id, supersedes_revision),
  CONSTRAINT chk_coa_report_asserted_by_nonempty CHECK (length(trim(asserted_by)) > 0),
  CONSTRAINT chk_coa_report_asserted_at CHECK (
    isfinite(asserted_at) AND
    asserted_at >= '0001-01-01 00:00:00+00'::timestamptz AND
    asserted_at <= '9999-12-31 23:59:59.999999+00'::timestamptz
  ),
  CONSTRAINT chk_coa_report_dates_range CHECK (
    (report_date IS NULL OR (isfinite(report_date) AND report_date >= '0001-01-01'::date AND report_date <= '9999-12-31'::date)) AND
    (sample_date IS NULL OR (isfinite(sample_date) AND sample_date >= '0001-01-01'::date AND sample_date <= '9999-12-31'::date))
  ),
  CONSTRAINT chk_coa_report_sample_date_le_report_date CHECK (
    sample_date IS NULL OR report_date IS NULL OR sample_date <= report_date
  ),
  CONSTRAINT chk_coa_report_dates_le_asserted_at CHECK (
    (report_date IS NULL OR report_date <= (asserted_at AT TIME ZONE 'UTC')::date) AND
    (sample_date IS NULL OR sample_date <= (asserted_at AT TIME ZONE 'UTC')::date)
  ),
  CONSTRAINT chk_coa_report_complete_requirements CHECK (
    CASE
      WHEN completeness_status = 'complete' THEN
        report_identifier_as_claimed IS NOT NULL AND length(trim(report_identifier_as_claimed)) > 0 AND
        lab_name_as_claimed IS NOT NULL AND length(trim(lab_name_as_claimed)) > 0 AND
        sample_identifier_as_claimed IS NOT NULL AND length(trim(sample_identifier_as_claimed)) > 0 AND
        report_date IS NOT NULL AND
        scope_kind IS NOT NULL AND scope_kind IN ('sample_only', 'attributed_lot') AND
        scope_description IS NOT NULL AND length(trim(scope_description)) > 0 AND
        sample_to_batch_association_confirmed IS TRUE AND
        sample_to_batch_association_attestation IS NOT NULL AND length(trim(sample_to_batch_association_attestation)) > 0 AND
        (scope_kind = 'sample_only' OR (scope_kind = 'attributed_lot' AND sampling_method_description IS NOT NULL AND length(trim(sampling_method_description)) > 0))
      ELSE true
    END
  )
);

ALTER TABLE coa_reports
  ADD CONSTRAINT fk_coa_reports_current_rev
  FOREIGN KEY (client_id, report_id, current_revision)
  REFERENCES coa_report_revisions(client_id, report_id, revision)
  ON DELETE RESTRICT
  DEFERRABLE INITIALLY DEFERRED;

-- 3. COA MEASUREMENTS (APPEND-ONLY ANALYTICAL VALUES)
CREATE TABLE IF NOT EXISTS coa_measurements (
  measurement_id UUID PRIMARY KEY DEFAULT uuidv7(),
  client_id UUID NOT NULL,
  report_id UUID NOT NULL,
  report_revision INT NOT NULL CHECK (report_revision > 0),
  batch_id UUID NOT NULL,
  evidence_id UUID NOT NULL,
  evidence_revision INT NOT NULL CHECK (evidence_revision > 0),
  analyte VARCHAR(128) NOT NULL,
  result_kind VARCHAR(32) NOT NULL
    CHECK (result_kind IN ('quantified', 'below_limit', 'not_detected')),
  result_value TEXT,
  result_limit TEXT,
  result_qualifier VARCHAR(8)
    CHECK (result_qualifier IS NULL OR result_qualifier IN ('lt', 'lte')),
  unit VARCHAR(64) NOT NULL,
  basis VARCHAR(64) NOT NULL,
  context VARCHAR(64) NOT NULL,
  quantity_kind VARCHAR(64) NOT NULL,
  method_as_reported VARCHAR(128),
  uncertainty_absolute TEXT,
  detection_limit TEXT,
  quantification_limit TEXT,
  analytical_qualifier_code VARCHAR(64),
  analytical_qualifier_explanation TEXT,
  CONSTRAINT uq_coa_measurements_full UNIQUE (client_id, report_id, report_revision, measurement_id),
  CONSTRAINT uq_coa_measurements_lineage UNIQUE (client_id, report_id, report_revision, measurement_id, batch_id, evidence_id, evidence_revision),
  CONSTRAINT uq_coa_measurements_analyte_context UNIQUE (client_id, report_id, report_revision, analyte, basis, context),
  CONSTRAINT fk_coa_measurements_report FOREIGN KEY (client_id, report_id, report_revision, batch_id, evidence_id, evidence_revision)
    REFERENCES coa_report_revisions(client_id, report_id, revision, batch_id, evidence_id, evidence_revision) ON DELETE RESTRICT,
  CONSTRAINT chk_coa_measurement_strings_nonempty CHECK (
    length(trim(analyte)) > 0 AND analyte = trim(analyte) AND
    length(trim(unit)) > 0 AND unit = trim(unit) AND
    length(trim(basis)) > 0 AND basis = trim(basis) AND
    length(trim(context)) > 0 AND context = trim(context) AND
    length(trim(quantity_kind)) > 0 AND quantity_kind = trim(quantity_kind) AND
    (method_as_reported IS NULL OR (length(trim(method_as_reported)) > 0 AND method_as_reported = trim(method_as_reported))) AND
    (analytical_qualifier_code IS NULL OR (length(trim(analytical_qualifier_code)) > 0 AND analytical_qualifier_code = trim(analytical_qualifier_code))) AND
    (analytical_qualifier_explanation IS NULL OR (length(trim(analytical_qualifier_explanation)) > 0 AND analytical_qualifier_explanation = trim(analytical_qualifier_explanation)))
  ),
  CONSTRAINT chk_coa_measurement_quantified CHECK (
    result_kind != 'quantified' OR (
      result_value IS NOT NULL AND
      result_value ~ '^-?(0|[1-9][0-9]*)(\.[0-9]+)?$' AND
      result_limit IS NULL AND
      result_qualifier IS NULL AND
      (result_value !~ '^-' OR (analytical_qualifier_code = 'negative_as_reported' AND analytical_qualifier_explanation IS NOT NULL AND length(trim(analytical_qualifier_explanation)) > 0))
    )
  ),
  CONSTRAINT chk_coa_measurement_below_limit CHECK (
    result_kind != 'below_limit' OR (
      result_limit IS NOT NULL AND
      result_limit ~ '^(0|[1-9][0-9]*)(\.[0-9]+)?$' AND
      result_limit::numeric > 0 AND
      result_qualifier IS NOT NULL AND
      result_value IS NULL
    )
  ),
  CONSTRAINT chk_coa_measurement_not_detected CHECK (
    result_kind != 'not_detected' OR (
      result_value IS NULL AND
      result_limit IS NULL AND
      result_qualifier IS NULL
    )
  ),
  CONSTRAINT chk_coa_measurement_metadata CHECK (
    (uncertainty_absolute IS NULL OR (uncertainty_absolute ~ '^(0|[1-9][0-9]*)(\.[0-9]+)?$' AND uncertainty_absolute::numeric >= 0)) AND
    (detection_limit IS NULL OR (detection_limit ~ '^(0|[1-9][0-9]*)(\.[0-9]+)?$' AND detection_limit::numeric >= 0)) AND
    (quantification_limit IS NULL OR (quantification_limit ~ '^(0|[1-9][0-9]*)(\.[0-9]+)?$' AND quantification_limit::numeric >= 0)) AND
    (detection_limit IS NULL OR quantification_limit IS NULL OR detection_limit::numeric <= quantification_limit::numeric) AND
    ((analytical_qualifier_code IS NULL AND analytical_qualifier_explanation IS NULL) OR
     (analytical_qualifier_code IS NOT NULL AND length(trim(analytical_qualifier_code)) > 0 AND analytical_qualifier_explanation IS NOT NULL AND length(trim(analytical_qualifier_explanation)) > 0))
  ),
  CONSTRAINT chk_coa_measurement_percent_bounds CHECK (
    lower(trim(unit)) NOT IN ('percent', 'percent_w_w', 'percent_v_v', '%') OR (
      (result_value IS NULL OR (result_value::numeric >= 0 AND result_value::numeric <= 100)) AND
      (result_limit IS NULL OR (result_limit::numeric > 0 AND result_limit::numeric <= 100)) AND
      (uncertainty_absolute IS NULL OR (uncertainty_absolute::numeric >= 0 AND uncertainty_absolute::numeric <= 100)) AND
      (detection_limit IS NULL OR (detection_limit::numeric >= 0 AND detection_limit::numeric <= 100)) AND
      (quantification_limit IS NULL OR (quantification_limit::numeric >= 0 AND quantification_limit::numeric <= 100))
    )
  ),
  CONSTRAINT chk_coa_measurement_fraction_bounds CHECK (
    lower(trim(unit)) NOT IN ('fraction', 'fraction_w_w', 'fraction_v_v', 'normalized_fraction') OR (
      (result_value IS NULL OR (result_value::numeric >= 0 AND result_value::numeric <= 1)) AND
      (result_limit IS NULL OR (result_limit::numeric > 0 AND result_limit::numeric <= 1)) AND
      (uncertainty_absolute IS NULL OR (uncertainty_absolute::numeric >= 0 AND uncertainty_absolute::numeric <= 1)) AND
      (detection_limit IS NULL OR (detection_limit::numeric >= 0 AND detection_limit::numeric <= 1)) AND
      (quantification_limit IS NULL OR (quantification_limit::numeric >= 0 AND quantification_limit::numeric <= 1))
    )
  ),
  CONSTRAINT chk_coa_measurement_unit_contradictions CHECK (
    NOT (lower(trim(unit)) = 'percent_w_w' AND lower(trim(quantity_kind)) != 'mass_fraction') AND
    NOT (lower(trim(unit)) = 'percent_v_v' AND lower(trim(quantity_kind)) != 'volume_fraction') AND
    NOT (lower(trim(unit)) IN ('mg_per_g', 'g_per_kg') AND lower(trim(quantity_kind)) IN ('volume_fraction', 'mass_concentration')) AND
    NOT (lower(trim(unit)) IN ('mg_per_l', 'ug_per_ml', 'mg_per_ml') AND lower(trim(quantity_kind)) IN ('mass_fraction', 'volume_fraction'))
  )
);

CREATE INDEX IF NOT EXISTS idx_coa_measurements_analyte
  ON coa_measurements(client_id, report_id, report_revision, analyte);

CREATE UNIQUE INDEX IF NOT EXISTS uq_coa_measurements_analyte_context_norm
  ON coa_measurements(client_id, report_id, report_revision, lower(trim(analyte)), lower(trim(basis)), lower(trim(context)));

-- 4. COA REPORT REVIEW EVENTS (APPEND-ONLY AUDIT LEDGER)
CREATE TABLE IF NOT EXISTS coa_report_review_events (
  event_id UUID PRIMARY KEY DEFAULT uuidv7(),
  client_id UUID NOT NULL,
  report_id UUID NOT NULL,
  report_revision INT NOT NULL CHECK (report_revision > 0),
  decision VARCHAR(16) NOT NULL
    CHECK (decision IN ('approved', 'rejected')),
  actor_id VARCHAR(128) NOT NULL,
  occurred_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  reason TEXT NOT NULL,
  assessed_scope VARCHAR(32) NOT NULL
    CHECK (assessed_scope IN ('sample_only', 'attributed_lot')),
  CONSTRAINT uq_coa_review_events_client_event UNIQUE (client_id, event_id),
  CONSTRAINT uq_coa_review_events_decision_per_rev UNIQUE (client_id, report_id, report_revision),
  CONSTRAINT fk_coa_review_events_revision FOREIGN KEY (client_id, report_id, report_revision)
    REFERENCES coa_report_revisions(client_id, report_id, revision) ON DELETE RESTRICT,
  CONSTRAINT chk_coa_review_events_reason_nonempty CHECK (length(trim(reason)) > 0),
  CONSTRAINT chk_coa_review_events_actor_nonempty CHECK (length(trim(actor_id)) > 0),
  CONSTRAINT chk_coa_review_events_occurred_at CHECK (
    isfinite(occurred_at) AND
    occurred_at >= '0001-01-01 00:00:00+00'::timestamptz AND
    occurred_at <= '9999-12-31 23:59:59.999999+00'::timestamptz
  )
);

CREATE INDEX IF NOT EXISTS idx_coa_review_events_revision
  ON coa_report_review_events(client_id, report_id, report_revision);

-- ---------------------------------------------------------------------------
-- TRIGGERS & INTEGRITY GUARDS
-- ---------------------------------------------------------------------------

-- Append-only trigger for immutable revisions, measurements, review events
CREATE TRIGGER trg_protect_coa_report_revisions
  BEFORE UPDATE OR DELETE ON coa_report_revisions
  FOR EACH ROW EXECUTE FUNCTION prevent_modification_product_evidence_immutable();

CREATE TRIGGER trg_protect_coa_measurements
  BEFORE UPDATE OR DELETE ON coa_measurements
  FOR EACH ROW EXECUTE FUNCTION prevent_modification_product_evidence_immutable();

CREATE TRIGGER trg_protect_coa_report_review_events
  BEFORE UPDATE OR DELETE ON coa_report_review_events
  FOR EACH ROW EXECUTE FUNCTION prevent_modification_product_evidence_immutable();

-- Head entity delete protections
CREATE TRIGGER trg_protect_coa_reports_delete
  BEFORE DELETE ON coa_reports
  FOR EACH ROW EXECUTE FUNCTION prevent_product_head_deletion();

-- Coa Report Head BEFORE UPDATE trigger: protect immutable identity, version progression, archive status
CREATE OR REPLACE FUNCTION enforce_coa_report_head_update()
RETURNS TRIGGER AS $$
BEGIN
  -- Rejection of changes to permanent columns
  IF OLD.report_id IS DISTINCT FROM NEW.report_id OR
     OLD.client_id IS DISTINCT FROM NEW.client_id OR
     OLD.batch_id IS DISTINCT FROM NEW.batch_id OR
     OLD.evidence_id IS DISTINCT FROM NEW.evidence_id OR
     OLD.created_at IS DISTINCT FROM NEW.created_at THEN
    RAISE EXCEPTION 'Permanent CoA report identity columns cannot be updated'
      USING ERRCODE = '23506';
  END IF;

  -- One-step version advancement
  IF NEW.version IS DISTINCT FROM (OLD.version + 1) THEN
    RAISE EXCEPTION 'CoA report version must advance by exactly 1'
      USING ERRCODE = '23506';
  END IF;

  -- Legal revision pointer progression: must stay same (review/archive) or advance by exactly 1 (supersede)
  IF NEW.current_revision < OLD.current_revision OR
     NEW.current_revision > (OLD.current_revision + 1) THEN
    RAISE EXCEPTION 'CoA report current_revision must be monotonically nondecreasing and advance by at most 1'
      USING ERRCODE = '23506';
  END IF;

  -- Terminal archive check
  IF OLD.archived_at IS NOT NULL THEN
    IF NEW.archived_at IS DISTINCT FROM OLD.archived_at THEN
      RAISE EXCEPTION 'Archived CoA report cannot be unarchived or have archived_at modified'
        USING ERRCODE = '23506';
    END IF;
    IF NEW.current_revision IS DISTINCT FROM OLD.current_revision THEN
      RAISE EXCEPTION 'Archived CoA report cannot be superseded'
        USING ERRCODE = '23506';
    END IF;
  END IF;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_enforce_coa_report_head_update
  BEFORE UPDATE ON coa_reports
  FOR EACH ROW EXECUTE FUNCTION enforce_coa_report_head_update();

-- Complete report revision requires at least one measurement at commit time
CREATE OR REPLACE FUNCTION check_coa_report_complete_measurements()
RETURNS TRIGGER AS $$
BEGIN
  IF NEW.completeness_status = 'complete' THEN
    IF NOT EXISTS (
      SELECT 1 FROM coa_measurements
      WHERE client_id = NEW.client_id
        AND report_id = NEW.report_id
        AND report_revision = NEW.revision
    ) THEN
      RAISE EXCEPTION 'Complete CoA report revisions must contain at least one measurement'
        USING ERRCODE = '23514';
    END IF;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE CONSTRAINT TRIGGER trg_check_coa_report_complete_measurements
  AFTER INSERT OR UPDATE ON coa_report_revisions
  DEFERRABLE INITIALLY DEFERRED
  FOR EACH ROW EXECUTE FUNCTION check_coa_report_complete_measurements();

-- Measurement panel sealing: reject INSERT if report archived, revision != current_revision, already reviewed, or revision committed in prior transaction
CREATE OR REPLACE FUNCTION enforce_coa_measurements_insert()
RETURNS TRIGGER AS $$
DECLARE
  v_archived_at TIMESTAMPTZ;
  v_current_rev INT;
  v_reviewed BOOLEAN;
  v_rev_xmin XID;
BEGIN
  SELECT archived_at, current_revision
    INTO v_archived_at, v_current_rev
    FROM coa_reports
   WHERE client_id = NEW.client_id
     AND report_id = NEW.report_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Parent CoA report does not exist'
      USING ERRCODE = '23503';
  END IF;

  IF v_archived_at IS NOT NULL THEN
    RAISE EXCEPTION 'Cannot insert measurements into an archived CoA report'
      USING ERRCODE = '23514';
  END IF;

  IF NEW.report_revision != v_current_rev THEN
    RAISE EXCEPTION 'Cannot insert measurements into a non-current CoA report revision'
      USING ERRCODE = '23514';
  END IF;

  SELECT xmin INTO v_rev_xmin
    FROM coa_report_revisions
   WHERE client_id = NEW.client_id
     AND report_id = NEW.report_id
     AND revision = NEW.report_revision;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Parent CoA report revision does not exist'
      USING ERRCODE = '23503';
  END IF;

  SELECT EXISTS (
    SELECT 1 FROM coa_report_review_events
     WHERE client_id = NEW.client_id
       AND report_id = NEW.report_id
       AND report_revision = NEW.report_revision
  ) INTO v_reviewed;

  IF v_reviewed THEN
    RAISE EXCEPTION 'Cannot insert measurements into an already reviewed CoA report revision'
      USING ERRCODE = '23514';
  END IF;

  -- Seal measurement set: measurements can only be inserted in the exact transaction that created the revision
  IF v_rev_xmin::text IS DISTINCT FROM (pg_current_xact_id()::xid)::text THEN
    RAISE EXCEPTION 'Cannot insert measurements into a previously committed CoA report revision'
      USING ERRCODE = '23514';
  END IF;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_enforce_coa_measurements_insert
  BEFORE INSERT ON coa_measurements
  FOR EACH ROW EXECUTE FUNCTION enforce_coa_measurements_insert();

-- Review event approval invariants: revision must be complete, assessed scope cannot exceed report scope
CREATE OR REPLACE FUNCTION check_coa_report_review_event_invariants()
RETURNS TRIGGER AS $$
DECLARE
  v_completeness VARCHAR(16);
  v_scope_kind VARCHAR(32);
  v_asserted_by VARCHAR(128);
BEGIN
  SELECT completeness_status, scope_kind, asserted_by
    INTO v_completeness, v_scope_kind, v_asserted_by
    FROM coa_report_revisions
   WHERE client_id = NEW.client_id
     AND report_id = NEW.report_id
     AND revision = NEW.report_revision;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Target CoA report revision not found'
      USING ERRCODE = '23503';
  END IF;

  -- Separation of duties: reviewer cannot be the recorder who asserted this report revision
  IF NEW.decision = 'approved' AND lower(trim(NEW.actor_id)) = lower(trim(v_asserted_by)) THEN
    RAISE EXCEPTION 'Self-approval forbidden: reviewer cannot be the recorder who asserted this report revision'
      USING ERRCODE = '23514';
  END IF;

  IF NEW.decision = 'approved' THEN
    IF v_completeness != 'complete' THEN
      RAISE EXCEPTION 'Cannot approve a draft CoA report revision'
        USING ERRCODE = '23514';
    END IF;

    IF v_scope_kind = 'sample_only' AND NEW.assessed_scope = 'attributed_lot' THEN
      RAISE EXCEPTION 'Assessed scope cannot be attributed_lot for a sample_only report'
        USING ERRCODE = '23514';
    END IF;
  END IF;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_check_coa_report_review_event_invariants
  BEFORE INSERT ON coa_report_review_events
  FOR EACH ROW EXECUTE FUNCTION check_coa_report_review_event_invariants();

-- ---------------------------------------------------------------------------
-- LEAST-PRIVILEGE ROLE CONFIGURATION & ACL ASSERTIONS
-- ---------------------------------------------------------------------------

-- Always revoke all from PUBLIC as defense in depth
REVOKE ALL ON coa_reports, coa_report_revisions, coa_measurements, coa_report_review_events FROM PUBLIC;

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
    EXECUTE format('REVOKE ALL ON coa_reports, coa_report_revisions, coa_measurements, coa_report_review_events FROM %I', v_app_role);

    -- Grant SELECT and INSERT on all tables
    EXECUTE format('GRANT SELECT, INSERT ON coa_reports, coa_report_revisions, coa_measurements, coa_report_review_events TO %I', v_app_role);

    -- Explicitly revoke table-level UPDATE, DELETE, TRUNCATE
    EXECUTE format('REVOKE UPDATE, DELETE, TRUNCATE ON coa_reports, coa_report_revisions, coa_measurements, coa_report_review_events FROM %I', v_app_role);

    -- Grant column-level UPDATE on allowed mutable columns only
    EXECUTE format('GRANT UPDATE (current_revision, version, archived_at) ON coa_reports TO %I', v_app_role);

    -- Assertions: effective immutable table privileges
    IF has_table_privilege(v_app_role, 'coa_report_revisions', 'UPDATE') OR
       has_table_privilege(v_app_role, 'coa_report_revisions', 'DELETE') OR
       has_table_privilege(v_app_role, 'coa_report_revisions', 'TRUNCATE') OR
       has_table_privilege(v_app_role, 'coa_measurements', 'UPDATE') OR
       has_table_privilege(v_app_role, 'coa_measurements', 'DELETE') OR
       has_table_privilege(v_app_role, 'coa_measurements', 'TRUNCATE') OR
       has_table_privilege(v_app_role, 'coa_report_review_events', 'UPDATE') OR
       has_table_privilege(v_app_role, 'coa_report_review_events', 'DELETE') OR
       has_table_privilege(v_app_role, 'coa_report_review_events', 'TRUNCATE') THEN
      RAISE EXCEPTION 'Security assertion failed: app_role % has forbidden privileges on immutable CoA tables', v_app_role;
    END IF;

    -- Assertions: effective head table privileges
    IF has_table_privilege(v_app_role, 'coa_reports', 'DELETE') OR
       has_table_privilege(v_app_role, 'coa_reports', 'TRUNCATE') THEN
      RAISE EXCEPTION 'Security assertion failed: app_role % has forbidden DELETE or TRUNCATE on coa_reports', v_app_role;
    END IF;

    -- Table-level UPDATE must be absent on coa_reports
    IF has_table_privilege(v_app_role, 'coa_reports', 'UPDATE') THEN
      RAISE EXCEPTION 'Security assertion failed: app_role % has forbidden table-level UPDATE on coa_reports', v_app_role;
    END IF;

    IF has_column_privilege(v_app_role, 'coa_reports', 'report_id', 'UPDATE') OR
       has_column_privilege(v_app_role, 'coa_reports', 'client_id', 'UPDATE') OR
       has_column_privilege(v_app_role, 'coa_reports', 'batch_id', 'UPDATE') OR
       has_column_privilege(v_app_role, 'coa_reports', 'evidence_id', 'UPDATE') OR
       has_column_privilege(v_app_role, 'coa_reports', 'created_at', 'UPDATE') THEN
      RAISE EXCEPTION 'Security assertion failed: app_role % has forbidden UPDATE on permanent identity columns of coa_reports', v_app_role;
    END IF;

    -- Assertions: column-level UPDATE MUST be granted on allowed mutable columns
    IF NOT has_column_privilege(v_app_role, 'coa_reports', 'current_revision', 'UPDATE') OR
       NOT has_column_privilege(v_app_role, 'coa_reports', 'version', 'UPDATE') OR
       NOT has_column_privilege(v_app_role, 'coa_reports', 'archived_at', 'UPDATE') THEN
      RAISE EXCEPTION 'Security assertion failed: app_role % lacks required column-level UPDATE privileges on coa_reports', v_app_role;
    END IF;

  END IF;
END;
$$;
