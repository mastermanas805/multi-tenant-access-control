import { Column, CreateDateColumn, Entity, Index, PrimaryColumn, UpdateDateColumn } from 'typeorm';

/**
 * TypeORM persistence model for the `role_assignments` table (DESIGN §8 ER model).
 * Pure data shape: no behavior, no domain types — the mapper translates between
 * this and the RoleAssignment aggregate so the domain never imports TypeORM.
 *
 * TENANT-OWNED: carries `tenant_id` + an RLS policy (DESIGN §6) so every query is
 * scoped to the ambient tenant. The composite index on (tenant_id,user_id)
 * backs the hot "assignments for a user" query (DESIGN §8.6).
 */
@Entity({ name: 'role_assignments' })
@Index('ix_role_assignments_tenant_user', ['tenantId', 'userId'])
export class RoleAssignmentOrmEntity {
  @PrimaryColumn('uuid')
  public id!: string;

  @Column({ name: 'tenant_id', type: 'uuid' })
  public tenantId!: string;

  @Column({ name: 'user_id', type: 'varchar', length: 255 })
  public userId!: string;

  @Column({ name: 'role_id', type: 'varchar', length: 255 })
  public roleId!: string;

  /** Hierarchical org-unit scope path, e.g. `acme.finance.emea` (DESIGN §8.5). */
  @Column({ name: 'scope', type: 'varchar', length: 255 })
  public scope!: string;

  @Column({ type: 'varchar', length: 20 })
  public status!: string;

  /** Optional expiry for delegated/time-boxed grants (nullable). */
  @Column({ name: 'valid_until', type: 'timestamptz', nullable: true })
  public validUntil!: Date | null;

  /** The delegating user, when this assignment is a delegation (nullable). */
  @Column({ name: 'delegated_by', type: 'varchar', length: 255, nullable: true })
  public delegatedBy!: string | null;

  /** Optimistic-concurrency token surfaced as the API ETag (DESIGN §8.1). */
  @Column({ type: 'int' })
  public version!: number;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  public createdAt!: Date;

  @UpdateDateColumn({ name: 'updated_at', type: 'timestamptz' })
  public updatedAt!: Date;
}
