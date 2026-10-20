#!/bin/sh
set -eu
case "$FLYNEXT_DOCKER_PASSWORD" in *[!0-9a-f]*|'') exit 1;; esac
case "$FLYNEXT_DOCKER_INSTANCE_ID" in *[!0-9a-f-]*|'') exit 1;; esac
psql -v ON_ERROR_STOP=1 --username "$POSTGRES_USER" --dbname "$POSTGRES_DB" <<'SQL'
\getenv app_password FLYNEXT_DOCKER_PASSWORD
\getenv instance_id FLYNEXT_DOCKER_INSTANCE_ID
CREATE ROLE flynext_docker LOGIN PASSWORD :'app_password' NOSUPERUSER NOCREATEDB NOCREATEROLE;
ALTER DATABASE flynext_docker_demo OWNER TO flynext_docker;
ALTER SCHEMA public OWNER TO flynext_docker;
CREATE SCHEMA flynext_local;
REVOKE ALL ON SCHEMA flynext_local FROM PUBLIC;
CREATE TABLE flynext_local.instance AS SELECT :'instance_id'::text AS id, system_identifier::text AS system_id FROM pg_control_system();
CREATE FUNCTION flynext_local.identity() RETURNS TABLE(id text, system_id text, actual_system_id text)
LANGUAGE sql SECURITY DEFINER SET search_path = pg_catalog AS $$
  SELECT i.id, i.system_id, c.system_identifier::text FROM flynext_local.instance i CROSS JOIN pg_control_system() c
$$;
REVOKE ALL ON FUNCTION flynext_local.identity() FROM PUBLIC;
GRANT USAGE ON SCHEMA flynext_local TO flynext_docker;
GRANT EXECUTE ON FUNCTION flynext_local.identity() TO flynext_docker;
SQL
