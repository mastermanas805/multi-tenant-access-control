import { Column, CreateDateColumn, Entity, Index, PrimaryColumn, UpdateDateColumn } from 'typeorm';

/**
 * TypeORM persistence model for the `permissions` table. This is a pure data
 * shape: it carries NO behavior and NO domain types. The mapper translates
 * between this and the Permission aggregate so the domain never imports TypeORM.
 *
 * NOTE: the permission catalog is GLOBAL (platform-wide capability keys that
 * tenant roles reference — DESIGN §8). Like the `tenants` table, it is the ONE
 * kind of table that carries NO `tenant_id` column and has NO RLS policy.
 */
@Entity({ name: 'permissions' })
export class PermissionOrmEntity {
  @PrimaryColumn('uuid')
  public id!: string;

  @Index('uq_permissions_key', { unique: true })
  @Column({ type: 'varchar', length: 150 })
  public key!: string;

  @Column({ type: 'varchar', length: 500 })
  public description!: string;

  /** Optimistic-concurrency token surfaced as the API ETag (DESIGN §8.1). */
  @Column({ type: 'int' })
  public version!: number;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  public createdAt!: Date;

  @UpdateDateColumn({ name: 'updated_at', type: 'timestamptz' })
  public updatedAt!: Date;
}
