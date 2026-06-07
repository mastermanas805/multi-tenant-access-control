import { Column, CreateDateColumn, Entity, Index, PrimaryColumn, UpdateDateColumn } from 'typeorm';

/**
 * TypeORM persistence model for the `expenses` table. A pure data shape: NO
 * behavior and NO domain types. The mapper translates between this and the Expense
 * aggregate so the domain never imports TypeORM.
 *
 * TENANT-SCOPED: carries `tenant_id` + an RLS policy
 * (`USING (tenant_id = current_setting('app.current_tenant')::uuid)`) so a query
 * can only ever see the active tenant's rows (DESIGN §6 layer 1).
 */
@Entity({ name: 'expenses' })
export class ExpenseOrmEntity {
  /** Human-readable business id (e.g. `exp_42`), not a UUID. */
  @PrimaryColumn({ type: 'varchar', length: 64 })
  public id!: string;

  @Index('ix_expenses_tenant')
  @Column({ name: 'tenant_id', type: 'uuid' })
  public tenantId!: string;

  /** Monetary amount. numeric for exactness; mapped to a JS number at the boundary. */
  @Column({ type: 'numeric', precision: 14, scale: 2 })
  public amount!: string;

  @Column({ type: 'varchar', length: 3 })
  public currency!: string;

  @Column({ type: 'varchar', length: 100 })
  public department!: string;

  @Column({ name: 'owner_id', type: 'varchar', length: 255 })
  public ownerId!: string;

  @Column({ type: 'varchar', length: 20 })
  public status!: string;

  @Column({ type: 'varchar', length: 1000, default: '' })
  public description!: string;

  /** Org-tree scope path for PDP policy selection (e.g. `acme.finance`). */
  @Column({ type: 'varchar', length: 255 })
  public scope!: string;

  /** Optimistic-concurrency token surfaced as the API ETag (DESIGN §8.1). */
  @Column({ type: 'int' })
  public version!: number;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  public createdAt!: Date;

  @UpdateDateColumn({ name: 'updated_at', type: 'timestamptz' })
  public updatedAt!: Date;
}
