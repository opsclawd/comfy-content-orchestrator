-- ---------------------------------------------------------------------------
-- IMMUTABLE AUDIT RECORD TRIGGERS
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION reject_audit_mutation()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  RAISE EXCEPTION '% is append-only/immutable; % is not permitted',
    TG_TABLE_NAME, TG_OP;
END;
$$;

CREATE TRIGGER trg_generation_manifests_immutable
BEFORE UPDATE OR DELETE ON generation_manifests
FOR EACH ROW EXECUTE FUNCTION reject_audit_mutation();

CREATE TRIGGER trg_review_events_append_only
BEFORE UPDATE OR DELETE ON review_events
FOR EACH ROW EXECUTE FUNCTION reject_audit_mutation();

-- ---------------------------------------------------------------------------
-- LEAST-PRIVILEGE AUDIT ROLE GRANTS & REVOKES
-- ---------------------------------------------------------------------------

-- Always revoke UPDATE and DELETE on audit tables from PUBLIC as defense in depth
REVOKE UPDATE, DELETE ON generation_manifests FROM PUBLIC;
REVOKE UPDATE, DELETE ON review_events FROM PUBLIC;

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

    -- Grant USAGE on schema public
    EXECUTE format('GRANT USAGE ON SCHEMA public TO %I', v_app_role);

    -- Grant full application-level operational privileges on all tables in public schema
    EXECUTE format('GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO %I', v_app_role);

    -- Revoke UPDATE and DELETE on audit tables
    EXECUTE format('REVOKE UPDATE, DELETE ON generation_manifests FROM %I', v_app_role);
    EXECUTE format('REVOKE UPDATE, DELETE ON review_events FROM %I', v_app_role);

    -- Grant SELECT and INSERT on audit tables
    EXECUTE format('GRANT SELECT, INSERT ON generation_manifests TO %I', v_app_role);
    EXECUTE format('GRANT SELECT, INSERT ON review_events TO %I', v_app_role);

    -- Verify the role does not have effective UPDATE or DELETE privilege
    IF has_table_privilege(v_app_role, 'generation_manifests', 'UPDATE') OR
       has_table_privilege(v_app_role, 'generation_manifests', 'DELETE') OR
       has_table_privilege(v_app_role, 'review_events', 'UPDATE') OR
       has_table_privilege(v_app_role, 'review_events', 'DELETE') THEN
      RAISE EXCEPTION 'Application role % still has effective UPDATE or DELETE privilege on audit tables', v_app_role;
    END IF;
  END IF;
END;
$$;
