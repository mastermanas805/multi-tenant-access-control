-- Creates the AUDIT service's OWN database, separate from the OLTP `authz_admin`
-- database. The audit log is the compliance system of record and is intentionally
-- NOT in the OLTP path of other services (DESIGN §8.7 / App. C — "Never in the
-- OLTP DB"). Both databases live in this single local Postgres instance for the
-- demo; in production they are separate clusters (the audit store is replicated
-- cross-region as the system of record).
--
-- Runs once on first cluster init via the postgres image's
-- /docker-entrypoint-initdb.d hook (idempotent guard for re-runs).
SELECT 'CREATE DATABASE audit'
WHERE NOT EXISTS (SELECT FROM pg_database WHERE datname = 'audit')\gexec
