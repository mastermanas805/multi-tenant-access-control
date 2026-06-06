import { Column, CreateDateColumn, Entity, Index, PrimaryColumn, UpdateDateColumn } from 'typeorm';

/**
 * TypeORM persistence model for the `policies` table. This is a pure data shape:
 * it carries NO behavior and NO domain types. The mapper translates between this
 * and the Policy aggregate so the domain never imports TypeORM.
 *
 * TENANT-SCOPED (DESIGN §6, §8): carries a `tenant_id` column + a Postgres RLS
 * policy so every query is implicitly scoped to the ambient tenant:
 *   ALTER TABLE policies ENABLE ROW LEVEL SECURITY;
 *   CREATE POLICY policies_tenant_isolation ON policies
 *     USING (tenant_id = current_setting('app.current_tenant')::uuid);
 *
 * The PAP stores policy METADATA only (scope, version, effectiveDate); the rule
 * logic is authored in Git and shipped as signed Cerbos bundles (DESIGN §8.7).
 */
@Entity({ name: 'policies' })
@Index('uq_policies_scope_version', ['tenantId', 'scope', 'version'], { unique: true })
export class PolicyOrmEntity {
  @PrimaryColumn('uuid')
  public id!: string;

  @Column({ name: 'tenant_id', type: 'uuid' })
  public tenantId!: string;

  @Index('ix_policies_scope')
  @Column({ type: 'varchar', length: 255 })
  public scope!: string;

  /** Opaque JSON policy rule body (DESIGN §8.3 JSONB). */
  @Column({ type: 'jsonb' })
  public rule!: Record<string, unknown>;

  @Column({ type: 'varchar', length: 20 })
  public status!: string;

  /** Monotonic policy version for the scope; also surfaced as the API ETag. */
  @Column({ type: 'int' })
  public version!: number;

  @Column({ name: 'effective_date', type: 'timestamptz' })
  public effectiveDate!: Date;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  public createdAt!: Date;

  @UpdateDateColumn({ name: 'updated_at', type: 'timestamptz' })
  public updatedAt!: Date;
}
