import { type MigrationInterface, type QueryRunner } from 'typeorm';

/**
 * Initial schema for the Audit service — the append-only, tamper-evident
 * decision/admin log (DESIGN §10, App. C).
 *
 * The audit log is the compliance system of record and lives in its OWN database,
 * intentionally NOT in the OLTP path of the other services (DESIGN §8.7:
 * "Never in the OLTP DB"). A single `audit_events` table stores one immutable row
 * per recorded event with a per-record hash chain:
 *
 *   record_hash = sha256( prev_hash || canonical(event) )
 *
 * where `seq` is a strictly increasing chain position (the chain order) and
 * `prev_hash` is the previous record's `record_hash` (the genesis row uses a
 * fixed all-zero prev_hash). Any mutation/deletion/reordering of a historical row
 * breaks every subsequent `record_hash`, so the chain is tamper-evident even
 * against an insider with DB access (App. C — "Immutability"). In production the
 * chain head is periodically anchored to external/WORM storage; here the chain is
 * self-contained and re-verifiable end to end.
 *
 * Append-only enforcement: a trigger rejects UPDATE and DELETE on the table, and
 * the application only ever INSERTs. `tenant_id` is a plain column (the log is
 * tenant-scoped for filtering/export per App. C) — there is NO RLS here because
 * the audit DB is a separate trust boundary written only by this service.
 */
export class InitialSchema1717100000000 implements MigrationInterface {
  public name = 'InitialSchema1717100000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    const isPostgres = queryRunner.connection.options.type === 'postgres';

    if (isPostgres) {
      await queryRunner.query('CREATE EXTENSION IF NOT EXISTS pgcrypto').catch(() => undefined);
    }

    // --- audit_events (append-only, hash-chained) -------------------------
    // `seq` is the chain position: a single BIGSERIAL so ordering is total and
    // gap-free per insert order, which is exactly what the hash chain links over.
    await queryRunner.query(`
      CREATE TABLE "audit_events" (
        "seq"          bigserial    NOT NULL,
        "id"           uuid         NOT NULL,
        "tenant_id"    uuid         NOT NULL,
        "actor"        varchar(255) NOT NULL,
        "action"       varchar(255) NOT NULL,
        "decision"     varchar(20)  NOT NULL,
        "resource_kind" varchar(255) NOT NULL,
        "resource_id"  varchar(255) NOT NULL,
        "reason"       varchar(1024) NULL,
        "policy"       varchar(512) NULL,
        "decision_id"  varchar(255) NULL,
        "trace_id"     varchar(255) NULL,
        "occurred_at"  timestamptz  NOT NULL,
        "recorded_at"  timestamptz  NOT NULL DEFAULT now(),
        "prev_hash"    char(64)     NOT NULL,
        "record_hash"  char(64)     NOT NULL,
        CONSTRAINT "pk_audit_events" PRIMARY KEY ("seq")
      )
    `);

    // The event id and the record hash are each globally unique.
    await queryRunner.query('CREATE UNIQUE INDEX "uq_audit_events_id" ON "audit_events" ("id")');
    await queryRunner.query(
      'CREATE UNIQUE INDEX "uq_audit_events_record_hash" ON "audit_events" ("record_hash")',
    );
    // Hot path for the explainer/decision-log UI: per-tenant, newest first.
    await queryRunner.query(
      'CREATE INDEX "ix_audit_events_tenant_seq" ON "audit_events" ("tenant_id", "seq" DESC)',
    );
    // Cross-service correlation by trace id.
    await queryRunner.query(
      'CREATE INDEX "ix_audit_events_trace" ON "audit_events" ("trace_id")',
    );

    // --- Append-only enforcement at the database ---------------------------
    // Even the owning role cannot UPDATE or DELETE a recorded event, so the log
    // is immutable in fact and not just by convention (DESIGN §10 / App. C).
    if (isPostgres) {
      await queryRunner.query(`
        CREATE OR REPLACE FUNCTION audit_events_no_mutate() RETURNS trigger AS $$
        BEGIN
          RAISE EXCEPTION 'audit_events is append-only: % is not permitted', TG_OP;
        END;
        $$ LANGUAGE plpgsql;
      `);
      await queryRunner.query(`
        CREATE TRIGGER audit_events_block_update_delete
          BEFORE UPDATE OR DELETE ON "audit_events"
          FOR EACH ROW EXECUTE FUNCTION audit_events_no_mutate();
      `);
    }
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    const isPostgres = queryRunner.connection.options.type === 'postgres';
    if (isPostgres) {
      await queryRunner.query(
        'DROP TRIGGER IF EXISTS audit_events_block_update_delete ON "audit_events"',
      );
      await queryRunner.query('DROP FUNCTION IF EXISTS audit_events_no_mutate()');
    }
    await queryRunner.query('DROP TABLE IF EXISTS "audit_events"');
  }
}
