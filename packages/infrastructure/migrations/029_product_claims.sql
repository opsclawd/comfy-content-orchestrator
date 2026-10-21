-- ---------------------------------------------------------------------------
-- PRODUCT CLAIMS, EVIDENCE LINKS, DECISION EVENTS & CASCADE INVALIDATION
-- Issue #475 / VPM-P1.6 (ADR 0009 §2.8, §3, §6, §8)
-- ---------------------------------------------------------------------------

-- 1. CANDIDATE COMPOSITE KEYS FOR TENANT-SAFE BRIDGES
ALTER TABLE product_batches
  ADD CONSTRAINT uq_product_batches_client_batch_sku UNIQUE (client_id, batch_id, sku_id);

ALTER TABLE evidence_revisions
  ADD CONSTRAINT uq_evidence_revisions_source_object UNIQUE (client_id, evidence_id, revision, source_object_id);

ALTER TABLE source_objects
  ADD COLUMN IF NOT EXISTS quarantine_reason TEXT;

-- 2. PRODUCT CLAIMS (HEAD TABLE)
CREATE TABLE IF NOT EXISTS product_claims (
  claim_id UUID PRIMARY KEY DEFAULT uuidv7(),
  client_id UUID NOT NULL REFERENCES clients(client_id) ON DELETE RESTRICT,
  sku_id UUID NOT NULL,
  batch_id UUID NOT NULL,
  current_revision INT NOT NULL DEFAULT 1 CHECK (current_revision > 0),
  state VARCHAR(32) NOT NULL DEFAULT 'draft'
    CHECK (state IN ('draft', 'evidence_linked', 'reviewer_approved', 'rejected', 'invalidated')),
  version INT NOT NULL DEFAULT 1 CHECK (version > 0),
  invalidation_cause VARCHAR(64)
    CHECK (invalidation_cause IS NULL OR invalidation_cause IN (
      'source_superseded', 'source_disputed', 'source_archived',
      'source_quarantined', 'integrity_failure', 'batch_facts_changed'
    )),
  invalidation_source_ref TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  archived_at TIMESTAMPTZ,
  CONSTRAINT uq_product_claims_client_claim UNIQUE (client_id, claim_id),
  CONSTRAINT uq_product_claims_client_batch_claim UNIQUE (client_id, batch_id, claim_id),
  CONSTRAINT uq_product_claims_head_identity UNIQUE (client_id, claim_id, sku_id, batch_id),
  CONSTRAINT fk_product_claims_batch_sku FOREIGN KEY (client_id, batch_id, sku_id)
    REFERENCES product_batches(client_id, batch_id, sku_id) ON DELETE RESTRICT,
  CONSTRAINT fk_product_claims_sku FOREIGN KEY (client_id, sku_id)
    REFERENCES product_skus(client_id, sku_id) ON DELETE RESTRICT,
  CONSTRAINT chk_product_claims_created_at CHECK (
    isfinite(created_at) AND
    created_at >= '0001-01-01 00:00:00+00'::timestamptz AND
    created_at <= '9999-12-31 23:59:59.999999+00'::timestamptz
  ),
  CONSTRAINT chk_product_claims_updated_at CHECK (
    isfinite(updated_at) AND
    updated_at >= created_at AND
    updated_at <= '9999-12-31 23:59:59.999999+00'::timestamptz
  ),
  CONSTRAINT chk_product_claims_archived_at CHECK (
    archived_at IS NULL OR (
      isfinite(archived_at) AND
      archived_at >= created_at AND
      archived_at <= updated_at AND
      archived_at <= '9999-12-31 23:59:59.999999+00'::timestamptz
    )
  ),
  CONSTRAINT chk_product_claims_invalidation_metadata CHECK (
    (state != 'invalidated' AND invalidation_cause IS NULL) OR
    (state = 'invalidated' AND invalidation_cause IS NOT NULL)
  )
);

CREATE INDEX IF NOT EXISTS idx_product_claims_client_batch
  ON product_claims(client_id, batch_id)
  WHERE archived_at IS NULL;

CREATE INDEX IF NOT EXISTS idx_product_claims_client_sku
  ON product_claims(client_id, sku_id)
  WHERE archived_at IS NULL;

CREATE INDEX IF NOT EXISTS idx_product_claims_active
  ON product_claims(client_id, state)
  WHERE state IN ('evidence_linked', 'reviewer_approved');

-- 3. PRODUCT CLAIM REVISIONS (APPEND-ONLY ASSERTIONS)
CREATE TABLE IF NOT EXISTS product_claim_revisions (
  client_id UUID NOT NULL,
  claim_id UUID NOT NULL,
  revision INT NOT NULL CHECK (revision > 0),
  batch_id UUID NOT NULL,
  canonical_kind VARCHAR(64) NOT NULL
    CHECK (canonical_kind IN (
      'factual_lot_identifier', 'packaged_or_harvest_date',
      'certificate_panel_measurement', 'cultivation_processing_lineage',
      'logged_process_timing', 'unsupported_manual'
    )),
  proof_category VARCHAR(64) NOT NULL
    CHECK (proof_category IN (
      'coa_measurement_backed', 'production_record_backed',
      'visual_evidence_backed', 'human_attested_unverified'
    )),
  parameters_json JSONB NOT NULL,
  display_wording TEXT,
  policy_version VARCHAR(64) NOT NULL,
  asserted_by VARCHAR(128) NOT NULL,
  asserted_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  supersedes_revision INT,
  PRIMARY KEY (client_id, claim_id, revision),
  CONSTRAINT uq_claim_revisions_batch UNIQUE (client_id, claim_id, revision, batch_id),
  CONSTRAINT fk_claim_revisions_claim FOREIGN KEY (client_id, claim_id)
    REFERENCES product_claims(client_id, claim_id) ON DELETE RESTRICT,
  CONSTRAINT fk_claim_revisions_head_identity FOREIGN KEY (client_id, claim_id, batch_id)
    REFERENCES product_claims(client_id, claim_id, batch_id) ON DELETE RESTRICT,
  CONSTRAINT fk_claim_revisions_batch FOREIGN KEY (client_id, batch_id)
    REFERENCES product_batches(client_id, batch_id) ON DELETE RESTRICT,
  CONSTRAINT fk_claim_revisions_predecessor FOREIGN KEY (client_id, claim_id, supersedes_revision)
    REFERENCES product_claim_revisions(client_id, claim_id, revision) ON DELETE RESTRICT,
  CONSTRAINT chk_claim_rev_monotonic CHECK (
    (revision = 1 AND supersedes_revision IS NULL) OR
    (revision > 1 AND supersedes_revision IS NOT NULL AND supersedes_revision = revision - 1)
  ),
  CONSTRAINT uq_claim_rev_predecessor UNIQUE (client_id, claim_id, supersedes_revision),
  CONSTRAINT chk_claim_revision_asserted_by_nonempty CHECK (length(trim(asserted_by)) > 0),
  CONSTRAINT chk_claim_revision_policy_nonempty CHECK (length(trim(policy_version)) > 0),
  CONSTRAINT chk_claim_revision_parameters_nonempty CHECK (parameters_json IS NOT NULL AND parameters_json != '{}'::jsonb),
  CONSTRAINT chk_claim_revisions_asserted_at CHECK (
    isfinite(asserted_at) AND
    asserted_at >= '0001-01-01 00:00:00+00'::timestamptz AND
    asserted_at <= '9999-12-31 23:59:59.999999+00'::timestamptz
  )
);

ALTER TABLE product_claims
  ADD CONSTRAINT fk_product_claims_current_rev
  FOREIGN KEY (client_id, claim_id, current_revision, batch_id)
  REFERENCES product_claim_revisions(client_id, claim_id, revision, batch_id)
  ON DELETE RESTRICT
  DEFERRABLE INITIALLY DEFERRED;

-- 4. CLAIM SOURCE LINKS (EVIDENCE & MEASUREMENT LINAGE)
CREATE TABLE IF NOT EXISTS claim_source_links (
  link_id UUID PRIMARY KEY DEFAULT uuidv7(),
  client_id UUID NOT NULL,
  claim_id UUID NOT NULL,
  claim_revision INT NOT NULL CHECK (claim_revision > 0),
  batch_id UUID NOT NULL,
  evidence_id UUID NOT NULL,
  evidence_revision INT NOT NULL CHECK (evidence_revision > 0),
  source_object_id UUID NOT NULL,
  source_sha256 CHAR(64) NOT NULL CHECK (source_sha256 ~ '^[0-9a-f]{64}$'),
  support_role VARCHAR(32) NOT NULL
    CHECK (support_role IN ('primary_measurement', 'corroborating_record', 'visual_reference')),
  report_id UUID,
  report_revision INT CHECK (report_revision IS NULL OR report_revision > 0),
  measurement_id UUID,
  pinned_facts_revision INT CHECK (pinned_facts_revision IS NULL OR pinned_facts_revision > 0),
  attestation_fact_kind VARCHAR(64),
  attestation_fact_value TEXT,
  attestation_field_locator TEXT,
  attestation_attribution TEXT,
  attestation_actor_id VARCHAR(128),
  attestation_occurred_at TIMESTAMPTZ,
  attestation_verification_event_id UUID,
  derivative_asset_id UUID,
  created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT fk_claim_sources_claim_rev FOREIGN KEY (client_id, claim_id, claim_revision, batch_id)
    REFERENCES product_claim_revisions(client_id, claim_id, revision, batch_id) ON DELETE RESTRICT,
  CONSTRAINT fk_claim_sources_batch_evidence FOREIGN KEY (client_id, batch_id, evidence_id, evidence_revision)
    REFERENCES batch_evidence_links(client_id, batch_id, evidence_id, evidence_revision) ON DELETE RESTRICT,
  CONSTRAINT fk_claim_sources_source_object FOREIGN KEY (client_id, source_object_id)
    REFERENCES source_objects(client_id, source_object_id) ON DELETE RESTRICT,
  CONSTRAINT fk_claim_sources_evidence_source_object FOREIGN KEY (client_id, evidence_id, evidence_revision, source_object_id)
    REFERENCES evidence_revisions(client_id, evidence_id, revision, source_object_id) ON DELETE RESTRICT,
  CONSTRAINT fk_claim_sources_measurement FOREIGN KEY (client_id, report_id, report_revision, measurement_id, batch_id, evidence_id, evidence_revision)
    REFERENCES coa_measurements(client_id, report_id, report_revision, measurement_id, batch_id, evidence_id, evidence_revision) ON DELETE RESTRICT,
  CONSTRAINT fk_claim_sources_derivative FOREIGN KEY (client_id, derivative_asset_id)
    REFERENCES reference_assets(client_id, asset_id) ON DELETE RESTRICT,
  CONSTRAINT chk_claim_measurement_all_or_none CHECK (
    (report_id IS NULL AND report_revision IS NULL AND measurement_id IS NULL) OR
    (report_id IS NOT NULL AND report_revision IS NOT NULL AND measurement_id IS NOT NULL)
  ),
  CONSTRAINT uq_claim_source_links UNIQUE NULLS NOT DISTINCT (
    client_id, claim_id, claim_revision, evidence_id, evidence_revision, measurement_id
  )
);

CREATE INDEX IF NOT EXISTS idx_claim_source_links_evidence
  ON claim_source_links(client_id, evidence_id, evidence_revision);

CREATE INDEX IF NOT EXISTS idx_claim_source_links_report
  ON claim_source_links(client_id, report_id, report_revision);

CREATE INDEX IF NOT EXISTS idx_claim_source_links_source_obj
  ON claim_source_links(client_id, source_object_id);

CREATE INDEX IF NOT EXISTS idx_claim_source_links_derivative
  ON claim_source_links(client_id, derivative_asset_id)
  WHERE derivative_asset_id IS NOT NULL;

-- 5. CLAIM DECISION EVENTS (IMMUTABLE AUDIT LEDGER)
CREATE TABLE IF NOT EXISTS claim_decision_events (
  event_id UUID PRIMARY KEY DEFAULT uuidv7(),
  client_id UUID NOT NULL,
  claim_id UUID NOT NULL,
  claim_revision INT NOT NULL CHECK (claim_revision > 0),
  decision VARCHAR(32) NOT NULL
    CHECK (decision IN ('link_evidence', 'approve', 'reject', 'invalidate')),
  actor_id VARCHAR(128) NOT NULL,
  occurred_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  reason TEXT NOT NULL,
  policy_version VARCHAR(64) NOT NULL,
  dependency_fingerprint VARCHAR(128),
  invalidation_cause VARCHAR(64)
    CHECK (invalidation_cause IS NULL OR invalidation_cause IN (
      'source_superseded', 'source_disputed', 'source_archived',
      'source_quarantined', 'integrity_failure', 'batch_facts_changed'
    )),
  source_event_id TEXT,
  CONSTRAINT uq_claim_events_client_event UNIQUE (client_id, event_id),
  CONSTRAINT fk_claim_events_revision FOREIGN KEY (client_id, claim_id, claim_revision)
    REFERENCES product_claim_revisions(client_id, claim_id, revision) ON DELETE RESTRICT,
  CONSTRAINT chk_claim_decision_events_actor_nonempty CHECK (length(trim(actor_id)) > 0),
  CONSTRAINT chk_claim_decision_events_reason_nonempty CHECK (length(trim(reason)) > 0),
  CONSTRAINT chk_claim_decision_events_policy_nonempty CHECK (length(trim(policy_version)) > 0),
  CONSTRAINT chk_claim_decision_events_occurred_at CHECK (
    isfinite(occurred_at) AND
    occurred_at >= '0001-01-01 00:00:00+00'::timestamptz AND
    occurred_at <= '9999-12-31 23:59:59.999999+00'::timestamptz
  )
);

CREATE INDEX IF NOT EXISTS idx_claim_decision_events_claim_rev
  ON claim_decision_events(client_id, claim_id, claim_revision);

-- ---------------------------------------------------------------------------
-- TRIGGERS & INTEGRITY GUARDS
-- ---------------------------------------------------------------------------

-- Append-only trigger for immutable revisions, links, decision events
CREATE TRIGGER trg_protect_product_claim_revisions
  BEFORE UPDATE OR DELETE ON product_claim_revisions
  FOR EACH ROW EXECUTE FUNCTION prevent_modification_product_evidence_immutable();

CREATE TRIGGER trg_protect_claim_source_links
  BEFORE UPDATE OR DELETE ON claim_source_links
  FOR EACH ROW EXECUTE FUNCTION prevent_modification_product_evidence_immutable();

CREATE TRIGGER trg_protect_claim_decision_events
  BEFORE UPDATE OR DELETE ON claim_decision_events
  FOR EACH ROW EXECUTE FUNCTION prevent_modification_product_evidence_immutable();

-- Head entity delete protection
CREATE TRIGGER trg_protect_product_claims_delete
  BEFORE DELETE ON product_claims
  FOR EACH ROW EXECUTE FUNCTION prevent_product_head_deletion();

-- Enforce Claim Head updates
CREATE OR REPLACE FUNCTION enforce_product_claim_head_update()
RETURNS TRIGGER AS $$
BEGIN
  -- Rejection of changes to permanent columns
  IF OLD.claim_id IS DISTINCT FROM NEW.claim_id OR
     OLD.client_id IS DISTINCT FROM NEW.client_id OR
     OLD.sku_id IS DISTINCT FROM NEW.sku_id OR
     OLD.batch_id IS DISTINCT FROM NEW.batch_id OR
     OLD.created_at IS DISTINCT FROM NEW.created_at THEN
    RAISE EXCEPTION 'Permanent product claim identity columns cannot be updated'
      USING ERRCODE = '23506';
  END IF;

  -- One-step version advancement
  IF NEW.version IS DISTINCT FROM (OLD.version + 1) THEN
    RAISE EXCEPTION 'Product claim version must advance by exactly 1'
      USING ERRCODE = '23506';
  END IF;

  -- Legal revision pointer progression: must stay same or advance by exactly 1
  IF NEW.current_revision < OLD.current_revision OR
     NEW.current_revision > (OLD.current_revision + 1) THEN
    RAISE EXCEPTION 'Product claim current_revision must be monotonically nondecreasing and advance by at most 1'
      USING ERRCODE = '23506';
  END IF;

  -- Terminal archive check
  IF OLD.archived_at IS NOT NULL THEN
    IF NEW.archived_at IS DISTINCT FROM OLD.archived_at THEN
      RAISE EXCEPTION 'Archived product claim cannot be unarchived or have archived_at modified'
        USING ERRCODE = '23506';
    END IF;
    IF NEW.current_revision IS DISTINCT FROM OLD.current_revision THEN
      RAISE EXCEPTION 'Archived product claim cannot be revised'
        USING ERRCODE = '23506';
    END IF;
  END IF;

  -- New revision always resets state to draft
  IF NEW.current_revision = (OLD.current_revision + 1) THEN
    IF NEW.state != 'draft' THEN
      RAISE EXCEPTION 'Appending a new claim revision must reset state to draft'
        USING ERRCODE = '23514';
    END IF;
    IF NEW.invalidation_cause IS NOT NULL OR NEW.invalidation_source_ref IS NOT NULL THEN
      RAISE EXCEPTION 'Appending a new claim revision must clear invalidation metadata'
        USING ERRCODE = '23514';
    END IF;
  ELSE
    -- Same revision state transitions
    IF OLD.state = 'draft' AND NEW.state NOT IN ('draft', 'evidence_linked') THEN
      RAISE EXCEPTION 'Illegal state transition from draft to %', NEW.state
        USING ERRCODE = '23514';
    ELSIF OLD.state = 'evidence_linked' AND NEW.state NOT IN ('evidence_linked', 'reviewer_approved', 'rejected', 'invalidated') THEN
      RAISE EXCEPTION 'Illegal state transition from evidence_linked to %', NEW.state
        USING ERRCODE = '23514';
    ELSIF OLD.state = 'reviewer_approved' AND NEW.state NOT IN ('reviewer_approved', 'invalidated') THEN
      RAISE EXCEPTION 'Illegal state transition from reviewer_approved to %', NEW.state
        USING ERRCODE = '23514';
    ELSIF OLD.state IN ('rejected', 'invalidated') AND NEW.state != OLD.state THEN
      RAISE EXCEPTION 'Terminal state % cannot transition to % within the same revision', OLD.state, NEW.state
        USING ERRCODE = '23514';
    END IF;
  END IF;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_enforce_product_claim_head_update
  BEFORE UPDATE ON product_claims
  FOR EACH ROW EXECUTE FUNCTION enforce_product_claim_head_update();

-- Single sealed link set trigger: reject insertions if claim not in draft or already has decision events
CREATE OR REPLACE FUNCTION enforce_claim_source_links_insert()
RETURNS TRIGGER AS $$
DECLARE
  v_state VARCHAR(32);
  v_current_rev INT;
  v_decision_count INT;
BEGIN
  SELECT state, current_revision
    INTO v_state, v_current_rev
    FROM product_claims
   WHERE client_id = NEW.client_id
     AND claim_id = NEW.claim_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Parent product claim does not exist'
      USING ERRCODE = '23503';
  END IF;

  IF NEW.claim_revision != v_current_rev THEN
    RAISE EXCEPTION 'Cannot insert source links for a non-current claim revision'
      USING ERRCODE = '23514';
  END IF;

  IF v_state != 'draft' THEN
    RAISE EXCEPTION 'Cannot link evidence to claim in state %', v_state
      USING ERRCODE = '23514';
  END IF;

  SELECT count(*) INTO v_decision_count
    FROM claim_decision_events
   WHERE client_id = NEW.client_id
     AND claim_id = NEW.claim_id
     AND claim_revision = NEW.claim_revision;

  IF v_decision_count > 0 THEN
    RAISE EXCEPTION 'Cannot insert links into an already sealed claim revision'
      USING ERRCODE = '23514';
  END IF;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_enforce_claim_source_links_insert
  BEFORE INSERT ON claim_source_links
  FOR EACH ROW EXECUTE FUNCTION enforce_claim_source_links_insert();

-- Review event approval invariants and separation of duties
CREATE OR REPLACE FUNCTION check_claim_decision_event_invariants()
RETURNS TRIGGER AS $$
DECLARE
  v_asserted_by VARCHAR(128);
  v_state VARCHAR(32);
  v_has_links BOOLEAN;
BEGIN
  SELECT asserted_by INTO v_asserted_by
    FROM product_claim_revisions
   WHERE client_id = NEW.client_id
     AND claim_id = NEW.claim_id
     AND revision = NEW.claim_revision;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Target product claim revision not found'
      USING ERRCODE = '23503';
  END IF;

  SELECT state INTO v_state
    FROM product_claims
   WHERE client_id = NEW.client_id
     AND claim_id = NEW.claim_id;

  IF NEW.decision = 'approve' THEN
    -- Separation of duties: Reviewer cannot be claim author
    IF lower(trim(NEW.actor_id)) = lower(trim(v_asserted_by)) THEN
      RAISE EXCEPTION 'Self-approval forbidden: reviewer cannot be the claim author'
        USING ERRCODE = '23514';
    END IF;

    -- Separation of duties: Reviewer cannot be source fact attester
    IF EXISTS (
      SELECT 1 FROM claim_source_links
      WHERE client_id = NEW.client_id
        AND claim_id = NEW.claim_id
        AND claim_revision = NEW.claim_revision
        AND attestation_actor_id IS NOT NULL
        AND lower(trim(attestation_actor_id)) = lower(trim(NEW.actor_id))
    ) THEN
      RAISE EXCEPTION 'Self-approval forbidden: reviewer cannot be the source fact attester'
        USING ERRCODE = '23514';
    END IF;

    IF v_state != 'evidence_linked' THEN
      RAISE EXCEPTION 'Cannot approve claim revision unless state is evidence_linked (current: %)', v_state
        USING ERRCODE = '23514';
    END IF;
  ELSIF NEW.decision = 'reject' THEN
    IF v_state != 'evidence_linked' THEN
      RAISE EXCEPTION 'Cannot reject claim revision unless state is evidence_linked (current: %)', v_state
        USING ERRCODE = '23514';
    END IF;
  ELSIF NEW.decision = 'link_evidence' THEN
    IF v_state != 'draft' THEN
      RAISE EXCEPTION 'Cannot link evidence unless claim is in draft (current: %)', v_state
        USING ERRCODE = '23514';
    END IF;
  ELSIF NEW.decision = 'invalidate' THEN
    IF v_state NOT IN ('evidence_linked', 'reviewer_approved') THEN
      RAISE EXCEPTION 'Cannot invalidate claim unless state is active (current: %)', v_state
        USING ERRCODE = '23514';
    END IF;
    IF NEW.invalidation_cause IS NULL THEN
      RAISE EXCEPTION 'Invalidation decision event must specify invalidation_cause'
        USING ERRCODE = '23514';
    END IF;
  END IF;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_check_claim_decision_event_invariants
  BEFORE INSERT ON claim_decision_events
  FOR EACH ROW EXECUTE FUNCTION check_claim_decision_event_invariants();

-- ---------------------------------------------------------------------------
-- ATOMIC CASCADE INVALIDATION ROUTINE & TRIGGERS
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION process_claim_invalidation(
  p_client_id UUID,
  p_claim_id UUID,
  p_cause VARCHAR,
  p_reason TEXT,
  p_source_ref TEXT
) RETURNS VOID AS $$
DECLARE
  v_claim RECORD;
BEGIN
  -- Row lock in sorted claim order
  SELECT client_id, claim_id, current_revision, state, version
    INTO v_claim
    FROM product_claims
   WHERE client_id = p_client_id
     AND claim_id = p_claim_id
     FOR UPDATE;

  IF NOT FOUND THEN
    RETURN;
  END IF;

  -- Only active claim states are invalidated
  IF v_claim.state NOT IN ('evidence_linked', 'reviewer_approved') THEN
    RETURN;
  END IF;

  -- Append immutable decision event
  INSERT INTO claim_decision_events (
    client_id,
    claim_id,
    claim_revision,
    decision,
    actor_id,
    occurred_at,
    reason,
    policy_version,
    invalidation_cause,
    source_event_id
  ) VALUES (
    v_claim.client_id,
    v_claim.claim_id,
    v_claim.current_revision,
    'invalidate',
    'system:cascade-invalidator',
    CURRENT_TIMESTAMP,
    p_reason,
    'claim_policy_v1',
    p_cause,
    p_source_ref
  );

  -- Advance head state to invalidated and increment version
  UPDATE product_claims
     SET state = 'invalidated',
         version = version + 1,
         invalidation_cause = p_cause,
         invalidation_source_ref = p_source_ref,
         updated_at = CURRENT_TIMESTAMP
   WHERE client_id = v_claim.client_id
     AND claim_id = v_claim.claim_id
     AND version = v_claim.version;
END;
$$ LANGUAGE plpgsql;

CREATE OR REPLACE FUNCTION cascade_invalidate_claims_for_list(
  p_client_id UUID,
  p_claim_ids UUID[],
  p_cause VARCHAR,
  p_reason TEXT,
  p_source_ref TEXT
) RETURNS VOID AS $$
DECLARE
  v_sorted_ids UUID[];
  v_id UUID;
BEGIN
  IF p_claim_ids IS NULL OR array_length(p_claim_ids, 1) IS NULL THEN
    RETURN;
  END IF;

  -- Sort unique claim IDs deterministically to eliminate deadlocks
  SELECT array_agg(DISTINCT id ORDER BY id)
    INTO v_sorted_ids
    FROM unnest(p_claim_ids) AS id;

  FOREACH v_id IN ARRAY v_sorted_ids
  LOOP
    PERFORM process_claim_invalidation(p_client_id, v_id, p_cause, p_reason, p_source_ref);
  END LOOP;
END;
$$ LANGUAGE plpgsql;

-- 1. CoA Report triggers: supersession & archival
CREATE OR REPLACE FUNCTION trg_cascade_invalidate_on_coa_report()
RETURNS TRIGGER AS $$
DECLARE
  v_claim_ids UUID[];
BEGIN
  IF NEW.current_revision > OLD.current_revision THEN
    SELECT array_agg(DISTINCT c.claim_id) INTO v_claim_ids
      FROM product_claims c
      JOIN claim_source_links l ON l.client_id = c.client_id AND l.claim_id = c.claim_id AND l.claim_revision = c.current_revision
     WHERE c.client_id = NEW.client_id
       AND c.state IN ('evidence_linked', 'reviewer_approved')
       AND l.report_id = NEW.report_id
       AND l.report_revision < NEW.current_revision;

    PERFORM cascade_invalidate_claims_for_list(
      NEW.client_id,
      v_claim_ids,
      'source_superseded',
      'Underlying CoA report revision was superseded',
      NEW.report_id::text || ':rev:' || NEW.current_revision::text
    );
  END IF;

  IF OLD.archived_at IS NULL AND NEW.archived_at IS NOT NULL THEN
    SELECT array_agg(DISTINCT c.claim_id) INTO v_claim_ids
      FROM product_claims c
      JOIN claim_source_links l ON l.client_id = c.client_id AND l.claim_id = c.claim_id AND l.claim_revision = c.current_revision
     WHERE c.client_id = NEW.client_id
       AND c.state IN ('evidence_linked', 'reviewer_approved')
       AND l.report_id = NEW.report_id;

    PERFORM cascade_invalidate_claims_for_list(
      NEW.client_id,
      v_claim_ids,
      'source_archived',
      'Underlying CoA report was archived',
      NEW.report_id::text
    );
  END IF;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_cascade_invalidate_coa_reports
  AFTER UPDATE ON coa_reports
  FOR EACH ROW EXECUTE FUNCTION trg_cascade_invalidate_on_coa_report();

-- 2. Evidence Asset triggers: supersession & archival
CREATE OR REPLACE FUNCTION trg_cascade_invalidate_on_evidence_asset()
RETURNS TRIGGER AS $$
DECLARE
  v_claim_ids UUID[];
BEGIN
  IF NEW.current_revision > OLD.current_revision THEN
    SELECT array_agg(DISTINCT c.claim_id) INTO v_claim_ids
      FROM product_claims c
      JOIN claim_source_links l ON l.client_id = c.client_id AND l.claim_id = c.claim_id AND l.claim_revision = c.current_revision
     WHERE c.client_id = NEW.client_id
       AND c.state IN ('evidence_linked', 'reviewer_approved')
       AND l.evidence_id = NEW.evidence_id
       AND l.evidence_revision < NEW.current_revision;

    PERFORM cascade_invalidate_claims_for_list(
      NEW.client_id,
      v_claim_ids,
      'source_superseded',
      'Underlying evidence asset revision was superseded',
      NEW.evidence_id::text || ':rev:' || NEW.current_revision::text
    );
  END IF;

  IF OLD.archived_at IS NULL AND NEW.archived_at IS NOT NULL THEN
    SELECT array_agg(DISTINCT c.claim_id) INTO v_claim_ids
      FROM product_claims c
      JOIN claim_source_links l ON l.client_id = c.client_id AND l.claim_id = c.claim_id AND l.claim_revision = c.current_revision
     WHERE c.client_id = NEW.client_id
       AND c.state IN ('evidence_linked', 'reviewer_approved')
       AND l.evidence_id = NEW.evidence_id;

    PERFORM cascade_invalidate_claims_for_list(
      NEW.client_id,
      v_claim_ids,
      'source_archived',
      'Underlying evidence asset was archived',
      NEW.evidence_id::text
    );
  END IF;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_cascade_invalidate_evidence_assets
  AFTER UPDATE ON evidence_assets
  FOR EACH ROW EXECUTE FUNCTION trg_cascade_invalidate_on_evidence_asset();

-- 3. Product Batch triggers: facts revision & archival
CREATE OR REPLACE FUNCTION trg_cascade_invalidate_on_product_batch()
RETURNS TRIGGER AS $$
DECLARE
  v_claim_ids UUID[];
BEGIN
  IF NEW.current_facts_revision > OLD.current_facts_revision THEN
    SELECT array_agg(DISTINCT c.claim_id) INTO v_claim_ids
      FROM product_claims c
      JOIN claim_source_links l ON l.client_id = c.client_id AND l.claim_id = c.claim_id AND l.claim_revision = c.current_revision
     WHERE c.client_id = NEW.client_id
       AND c.batch_id = NEW.batch_id
       AND c.state IN ('evidence_linked', 'reviewer_approved')
       AND l.pinned_facts_revision IS NOT NULL
       AND l.pinned_facts_revision < NEW.current_facts_revision;

    PERFORM cascade_invalidate_claims_for_list(
      NEW.client_id,
      v_claim_ids,
      'batch_facts_changed',
      'Underlying batch facts revision was superseded',
      NEW.batch_id::text || ':facts:' || NEW.current_facts_revision::text
    );
  END IF;

  IF OLD.archived_at IS NULL AND NEW.archived_at IS NOT NULL THEN
    SELECT array_agg(DISTINCT c.claim_id) INTO v_claim_ids
      FROM product_claims c
     WHERE c.client_id = NEW.client_id
       AND c.batch_id = NEW.batch_id
       AND c.state IN ('evidence_linked', 'reviewer_approved');

    PERFORM cascade_invalidate_claims_for_list(
      NEW.client_id,
      v_claim_ids,
      'source_archived',
      'Parent product batch was archived',
      NEW.batch_id::text
    );
  END IF;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_cascade_invalidate_product_batches
  AFTER UPDATE ON product_batches
  FOR EACH ROW EXECUTE FUNCTION trg_cascade_invalidate_on_product_batch();

-- 4. Product SKU triggers: archival
CREATE OR REPLACE FUNCTION trg_cascade_invalidate_on_product_sku()
RETURNS TRIGGER AS $$
DECLARE
  v_claim_ids UUID[];
BEGIN
  IF OLD.archived_at IS NULL AND NEW.archived_at IS NOT NULL THEN
    SELECT array_agg(DISTINCT c.claim_id) INTO v_claim_ids
      FROM product_claims c
     WHERE c.client_id = NEW.client_id
       AND c.sku_id = NEW.sku_id
       AND c.state IN ('evidence_linked', 'reviewer_approved');

    PERFORM cascade_invalidate_claims_for_list(
      NEW.client_id,
      v_claim_ids,
      'source_archived',
      'Parent product SKU was archived',
      NEW.sku_id::text
    );
  END IF;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_cascade_invalidate_product_skus
  AFTER UPDATE ON product_skus
  FOR EACH ROW EXECUTE FUNCTION trg_cascade_invalidate_on_product_sku();

-- 5. Source Object triggers: quarantine, archive, deletion
CREATE OR REPLACE FUNCTION trg_cascade_invalidate_on_source_object()
RETURNS TRIGGER AS $$
DECLARE
  v_claim_ids UUID[];
  v_cause VARCHAR(64);
  v_reason TEXT;
  v_tx_reason TEXT;
BEGIN
  IF OLD.availability = 'available' AND NEW.availability != 'available' THEN
    SELECT array_agg(DISTINCT c.claim_id) INTO v_claim_ids
      FROM product_claims c
      JOIN claim_source_links l ON l.client_id = c.client_id AND l.claim_id = c.claim_id AND l.claim_revision = c.current_revision
     WHERE c.client_id = NEW.client_id
       AND c.state IN ('evidence_linked', 'reviewer_approved')
       AND l.source_object_id = NEW.source_object_id;

    IF NEW.availability = 'quarantined' THEN
      v_tx_reason := current_setting('orchestrator.quarantine_reason', true);
      IF NEW.quarantine_reason ~* 'integrity|mismatch|digest' OR
         v_tx_reason ~* 'integrity|mismatch|digest' THEN
        v_cause := 'integrity_failure';
        v_reason := 'Underlying source object quarantined due to cryptographic integrity failure';
      ELSE
        v_cause := 'source_quarantined';
        v_reason := 'Underlying source object was quarantined';
      END IF;
    ELSIF NEW.availability = 'archived' THEN
      v_cause := 'source_archived';
      v_reason := 'Underlying source object was archived';
    ELSIF NEW.availability = 'deleted_under_retention' THEN
      v_cause := 'source_archived';
      v_reason := 'Underlying source object was deleted under retention policy';
    ELSE
      v_cause := 'source_archived';
      v_reason := 'Underlying source object availability became ' || NEW.availability;
    END IF;

    PERFORM cascade_invalidate_claims_for_list(
      NEW.client_id,
      v_claim_ids,
      v_cause,
      v_reason,
      NEW.source_object_id::text
    );
  END IF;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_cascade_invalidate_source_objects
  AFTER UPDATE ON source_objects
  FOR EACH ROW EXECUTE FUNCTION trg_cascade_invalidate_on_source_object();

-- 6. Verification Events triggers: disputes, rejections, withdrawals
CREATE OR REPLACE FUNCTION trg_cascade_invalidate_on_verification_event()
RETURNS TRIGGER AS $$
DECLARE
  v_claim_ids UUID[];
BEGIN
  IF NEW.outcome IN ('disputed', 'rejected') THEN
    SELECT array_agg(DISTINCT c.claim_id) INTO v_claim_ids
      FROM product_claims c
      JOIN claim_source_links l ON l.client_id = c.client_id AND l.claim_id = c.claim_id AND l.claim_revision = c.current_revision
     WHERE c.client_id = NEW.client_id
       AND c.state IN ('evidence_linked', 'reviewer_approved')
       AND l.evidence_id = NEW.evidence_id
       AND l.evidence_revision = NEW.evidence_revision;

    PERFORM cascade_invalidate_claims_for_list(
      NEW.client_id,
      v_claim_ids,
      'source_disputed',
      'Underlying evidence received dispute or rejection verification event: ' || NEW.event_id::text,
      NEW.event_id::text
    );
  ELSIF NEW.outcome = 'withdrawn' AND NEW.withdrawal_event_id IS NOT NULL THEN
    -- Check claims relying on this verification event directly or via CoA lab identity
    SELECT array_agg(DISTINCT c.claim_id) INTO v_claim_ids
      FROM product_claims c
      JOIN claim_source_links l ON l.client_id = c.client_id AND l.claim_id = c.claim_id AND l.claim_revision = c.current_revision
      LEFT JOIN coa_report_revisions cr ON cr.client_id = l.client_id AND cr.report_id = l.report_id AND cr.revision = l.report_revision
     WHERE c.client_id = NEW.client_id
       AND c.state IN ('evidence_linked', 'reviewer_approved')
       AND (
         l.attestation_verification_event_id = NEW.withdrawal_event_id OR
         cr.verified_lab_identity_event_id = NEW.withdrawal_event_id
       );

    PERFORM cascade_invalidate_claims_for_list(
      NEW.client_id,
      v_claim_ids,
      'source_disputed',
      'Relied-on verification event was withdrawn: ' || NEW.withdrawal_event_id::text,
      NEW.event_id::text
    );
  END IF;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_cascade_invalidate_verification_events
  AFTER INSERT ON evidence_verification_events
  FOR EACH ROW EXECUTE FUNCTION trg_cascade_invalidate_on_verification_event();

-- 7. Reference Asset Derivative trigger: archival
CREATE OR REPLACE FUNCTION trg_cascade_invalidate_on_reference_asset()
RETURNS TRIGGER AS $$
DECLARE
  v_claim_ids UUID[];
BEGIN
  IF OLD.archived_at IS NULL AND NEW.archived_at IS NOT NULL THEN
    SELECT array_agg(DISTINCT c.claim_id) INTO v_claim_ids
      FROM product_claims c
      JOIN claim_source_links l ON l.client_id = c.client_id AND l.claim_id = c.claim_id AND l.claim_revision = c.current_revision
     WHERE c.client_id = NEW.client_id
       AND c.state IN ('evidence_linked', 'reviewer_approved')
       AND l.derivative_asset_id = NEW.asset_id;

    PERFORM cascade_invalidate_claims_for_list(
      NEW.client_id,
      v_claim_ids,
      'source_archived',
      'Pinned visual reference derivative was archived',
      NEW.asset_id::text
    );
  END IF;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_cascade_invalidate_reference_assets
  AFTER UPDATE ON reference_assets
  FOR EACH ROW EXECUTE FUNCTION trg_cascade_invalidate_on_reference_asset();

-- ---------------------------------------------------------------------------
-- LEAST-PRIVILEGE ROLE CONFIGURATION & ACL ASSERTIONS
-- ---------------------------------------------------------------------------

REVOKE ALL ON product_claims, product_claim_revisions, claim_source_links, claim_decision_events FROM PUBLIC;

DO $$
DECLARE
  v_app_role text := nullif(trim(current_setting('orchestrator.app_role', true)), '');
  v_role_exists boolean;
BEGIN
  IF v_app_role IS NOT NULL THEN
    SELECT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = v_app_role) INTO v_role_exists;
    IF NOT v_role_exists THEN
      RAISE EXCEPTION 'Configured application role % does not exist in pg_roles', v_app_role;
    END IF;

    -- Revoke existing privileges on new tables
    EXECUTE format('REVOKE ALL ON product_claims, product_claim_revisions, claim_source_links, claim_decision_events FROM %I', v_app_role);

    -- Grant SELECT and INSERT on all 4 tables
    EXECUTE format('GRANT SELECT, INSERT ON product_claims, product_claim_revisions, claim_source_links, claim_decision_events TO %I', v_app_role);

    -- Explicitly revoke table-level UPDATE, DELETE, TRUNCATE
    EXECUTE format('REVOKE UPDATE, DELETE, TRUNCATE ON product_claims, product_claim_revisions, claim_source_links, claim_decision_events FROM %I', v_app_role);

    -- Grant column-level UPDATE on allowed mutable columns of product_claims only
    EXECUTE format('GRANT UPDATE (current_revision, state, version, invalidation_cause, invalidation_source_ref, updated_at, archived_at) ON product_claims TO %I', v_app_role);

    -- Grant column-level UPDATE on source_objects.quarantine_reason
    EXECUTE format('GRANT UPDATE (quarantine_reason) ON source_objects TO %I', v_app_role);

    -- Assertions: effective immutable table privileges
    IF has_table_privilege(v_app_role, 'product_claim_revisions', 'UPDATE') OR
       has_table_privilege(v_app_role, 'product_claim_revisions', 'DELETE') OR
       has_table_privilege(v_app_role, 'product_claim_revisions', 'TRUNCATE') OR
       has_table_privilege(v_app_role, 'claim_source_links', 'UPDATE') OR
       has_table_privilege(v_app_role, 'claim_source_links', 'DELETE') OR
       has_table_privilege(v_app_role, 'claim_source_links', 'TRUNCATE') OR
       has_table_privilege(v_app_role, 'claim_decision_events', 'UPDATE') OR
       has_table_privilege(v_app_role, 'claim_decision_events', 'DELETE') OR
       has_table_privilege(v_app_role, 'claim_decision_events', 'TRUNCATE') THEN
      RAISE EXCEPTION 'Application role % still has effective UPDATE, DELETE, or TRUNCATE privilege on immutable claim tables', v_app_role;
    END IF;

    -- Assertions: effective head table DELETE and TRUNCATE privileges
    IF has_table_privilege(v_app_role, 'product_claims', 'DELETE') OR
       has_table_privilege(v_app_role, 'product_claims', 'TRUNCATE') THEN
      RAISE EXCEPTION 'Application role % still has effective DELETE or TRUNCATE privilege on product_claims', v_app_role;
    END IF;

    -- Assertions: table-level UPDATE must be absent on head table
    IF has_table_privilege(v_app_role, 'product_claims', 'UPDATE') THEN
      RAISE EXCEPTION 'Application role % still has table-level UPDATE privilege on product_claims', v_app_role;
    END IF;

    -- Assertions: column-level UPDATE must NOT be granted on immutable columns
    IF has_column_privilege(v_app_role, 'product_claims', 'claim_id', 'UPDATE') OR
       has_column_privilege(v_app_role, 'product_claims', 'client_id', 'UPDATE') OR
       has_column_privilege(v_app_role, 'product_claims', 'sku_id', 'UPDATE') OR
       has_column_privilege(v_app_role, 'product_claims', 'batch_id', 'UPDATE') OR
       has_column_privilege(v_app_role, 'product_claims', 'created_at', 'UPDATE') THEN
      RAISE EXCEPTION 'Application role % has forbidden UPDATE privilege on immutable identity columns of product_claims', v_app_role;
    END IF;

    -- Assertions: column-level UPDATE MUST be granted on allowed mutable columns
    IF NOT has_column_privilege(v_app_role, 'product_claims', 'current_revision', 'UPDATE') OR
       NOT has_column_privilege(v_app_role, 'product_claims', 'state', 'UPDATE') OR
       NOT has_column_privilege(v_app_role, 'product_claims', 'version', 'UPDATE') OR
       NOT has_column_privilege(v_app_role, 'product_claims', 'invalidation_cause', 'UPDATE') OR
       NOT has_column_privilege(v_app_role, 'product_claims', 'invalidation_source_ref', 'UPDATE') OR
       NOT has_column_privilege(v_app_role, 'product_claims', 'updated_at', 'UPDATE') OR
       NOT has_column_privilege(v_app_role, 'product_claims', 'archived_at', 'UPDATE') THEN
      RAISE EXCEPTION 'Application role % lacks required column-level UPDATE privileges on product_claims', v_app_role;
    END IF;
  END IF;
END;
$$;
