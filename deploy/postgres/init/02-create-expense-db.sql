-- Creates the EXPENSE (PEP) service's OWN database, separate from the OLTP
-- `authz_admin` (PAP) database and the `audit` database. The Expense service owns
-- its business data (the `expenses` table) and loads resource attributes from it
-- in-request (DESIGN §3.5/§4.3) — it is NOT in the PAP's control-plane DB.
-- Both databases live in this single local Postgres instance for the demo; in
-- production they are separate clusters.
--
-- Runs once on first cluster init via the postgres image's
-- /docker-entrypoint-initdb.d hook (idempotent guard for re-runs).
SELECT 'CREATE DATABASE expense'
WHERE NOT EXISTS (SELECT FROM pg_database WHERE datname = 'expense')\gexec
