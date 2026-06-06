import { Column, CreateDateColumn, Entity, Index, PrimaryColumn, UpdateDateColumn } from 'typeorm';

/**
 * TypeORM persistence model for the `tenants` table. This is a pure data shape:
 * it carries NO behavior and NO domain types. The mapper translates between this
 * and the Tenant aggregate so the domain never imports TypeORM.
 *
 * NOTE: the `tenants` row IS the tenant, so its own `id` is the tenant boundary;
 * feature tables that belong TO a tenant carry a separate `tenant_id` column +
 * an RLS policy (see ARCHITECTURE.md "RLS pattern").
 */
@Entity({ name: 'tenants' })
export class TenantOrmEntity {
  @PrimaryColumn('uuid')
  public id!: string;

  @Column({ type: 'varchar', length: 200 })
  public name!: string;

  @Index('uq_tenants_slug', { unique: true })
  @Column({ type: 'varchar', length: 100 })
  public slug!: string;

  @Column({ type: 'varchar', length: 20 })
  public status!: string;

  @Column({ name: 'isolation_tier', type: 'varchar', length: 20 })
  public isolationTier!: string;

  /** Optimistic-concurrency token surfaced as the API ETag (DESIGN §8.1). */
  @Column({ type: 'int' })
  public version!: number;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  public createdAt!: Date;

  @UpdateDateColumn({ name: 'updated_at', type: 'timestamptz' })
  public updatedAt!: Date;
}
