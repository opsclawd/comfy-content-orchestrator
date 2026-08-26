#!/bin/bash
# ==============================================================================
# Runs once, automatically, on first postgres initialization (mounted into
# /docker-entrypoint-initdb.d/ — postgres's official image executes every
# .sh/.sql file there, in filename order, only when the data directory is
# empty). Creates the least-privilege application role that the migration
# scripts (002_audit_protections.sql, 003_candidate_selection.sql) require to
# already exist before they GRANT permissions to it.
#
# DATABASE_APP_ROLE / DATABASE_APP_PASSWORD must be present in the postgres
# service's own environment for this to run — they are not part of postgres's
# built-in POSTGRES_* variables.
# ==============================================================================
set -euo pipefail

if [ -z "${DATABASE_APP_ROLE:-}" ] || [ -z "${DATABASE_APP_PASSWORD:-}" ]; then
  echo "postgres-init-app-role.sh: DATABASE_APP_ROLE/DATABASE_APP_PASSWORD not set, skipping" >&2
  exit 0
fi

psql -v ON_ERROR_STOP=1 --username "$POSTGRES_USER" --dbname "$POSTGRES_DB" <<-EOSQL
  DO \$\$
  BEGIN
    IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = '$DATABASE_APP_ROLE') THEN
      CREATE ROLE "$DATABASE_APP_ROLE" WITH LOGIN PASSWORD '$DATABASE_APP_PASSWORD' NOSUPERUSER NOCREATEDB NOCREATEROLE;
      GRANT CONNECT ON DATABASE "$POSTGRES_DB" TO "$DATABASE_APP_ROLE";
    END IF;
  END
  \$\$;
EOSQL
