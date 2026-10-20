#!/bin/sh
set -eu
case "$AFS_DOCKER_PASSWORD" in *[!0-9a-f]*|'') exit 1;; esac
case "$AFS_DOCKER_INSTANCE_ID" in *[!0-9a-f-]*|'') exit 1;; esac
psql -v ON_ERROR_STOP=1 --username "$POSTGRES_USER" --dbname "$POSTGRES_DB" <<'SQL'
\getenv app_password AFS_DOCKER_PASSWORD
\getenv instance_id AFS_DOCKER_INSTANCE_ID
CREATE ROLE afs_docker LOGIN PASSWORD :'app_password' NOSUPERUSER NOCREATEDB NOCREATEROLE;
ALTER DATABASE afs_docker_demo OWNER TO afs_docker;
ALTER SCHEMA public OWNER TO afs_docker;
CREATE SCHEMA afs_local;
REVOKE ALL ON SCHEMA afs_local FROM PUBLIC;
CREATE TABLE afs_local.instance AS SELECT :'instance_id'::text AS id, system_identifier::text AS system_id FROM pg_control_system();
CREATE FUNCTION afs_local.identity() RETURNS TABLE(id text, system_id text, actual_system_id text)
LANGUAGE sql SECURITY DEFINER SET search_path = pg_catalog AS $$
  SELECT i.id, i.system_id, c.system_identifier::text FROM afs_local.instance i CROSS JOIN pg_control_system() c
$$;
REVOKE ALL ON FUNCTION afs_local.identity() FROM PUBLIC;
GRANT USAGE ON SCHEMA afs_local TO afs_docker;
GRANT EXECUTE ON FUNCTION afs_local.identity() TO afs_docker;
SQL
