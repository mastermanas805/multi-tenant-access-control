import { Column, CreateDateColumn, Entity, Index, PrimaryColumn, UpdateDateColumn } from 'typeorm';

/**
 * TypeORM persistence model for the `org_units` table. Pure data shape — no
 * behavior, no domain types; the mapper translates to/from the OrgUnit aggregate.
 *
 * TENANT-SCOPED: carries `tenant_id` + a Postgres RLS policy (ARCHITECTURE.md
 * "RLS pattern", DESIGN §6). Path uniqueness is per-tenant.
 *
 * INTEGRATION NOTE (DESIGN §8.5): `path` should be a Postgres `ltree` column with
 * a GiST index (or, if kept as text, a `text_pattern_ops` btree index) so subtree
 * prefix queries (`<@` / `LIKE 'root.%'`) stay indexed. The column is declared as
 * varchar here for portability; swap the type/index in the migration.
 */
@Entity({ name: 'org_units' })
@Index('uq_org_units_tenant_path', ['tenantId', 'path'], { unique: true })
@Index('ix_org_units_tenant_path_prefix', ['tenantId', 'path'])
export class OrgUnitOrmEntity {
  @PrimaryColumn('uuid')
  public id!: string;

  @Column({ name: 'tenant_id', type: 'uuid' })
  public tenantId!: string;

  @Column({ name: 'parent_id', type: 'uuid', nullable: true })
  public parentId!: string | null;

  /** Materialized path, e.g. "acme.finance.emea" (ltree/GiST at the DB layer). */
  @Column({ type: 'varchar', length: 1024 })
  public path!: string;

  @Column({ type: 'varchar', length: 200 })
  public name!: string;

  /** Optimistic-concurrency token surfaced as the API ETag (DESIGN §8.1). */
  @Column({ type: 'int' })
  public version!: number;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  public createdAt!: Date;

  @UpdateDateColumn({ name: 'updated_at', type: 'timestamptz' })
  public updatedAt!: Date;
}
