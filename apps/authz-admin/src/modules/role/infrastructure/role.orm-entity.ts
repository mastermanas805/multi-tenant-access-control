import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  OneToMany,
  PrimaryColumn,
  UpdateDateColumn,
} from 'typeorm';

import { RolePermissionOrmEntity } from './role-permission.orm-entity';

/**
 * TypeORM persistence model for the `roles` table (DESIGN §8 data model:
 * ROLE { uuid id; uuid tenant_id; string key; string scope }). Pure data shape:
 * NO behavior, NO domain types. The mapper translates between this and the Role
 * aggregate so the domain never imports TypeORM.
 *
 * TENANT-SCOPED: carries `tenant_id` + needs a Postgres RLS policy
 *   ALTER TABLE roles ENABLE ROW LEVEL SECURITY;
 *   CREATE POLICY roles_tenant_isolation ON roles
 *     USING (tenant_id = current_setting('app.current_tenant')::uuid);
 *
 * Uniqueness of `key` is per tenant: composite unique (tenant_id, key) — DESIGN
 * §8 "roles(tenant_id,key) unique".
 */
@Entity({ name: 'roles' })
@Index('uq_roles_tenant_key', ['tenantId', 'key'], { unique: true })
export class RoleOrmEntity {
  @PrimaryColumn('uuid')
  public id!: string;

  @Column({ name: 'tenant_id', type: 'uuid' })
  public tenantId!: string;

  @Column({ type: 'varchar', length: 100 })
  public key!: string;

  @Column({ type: 'varchar', length: 255 })
  public scope!: string;

  @Column({ type: 'varchar', length: 500, default: '' })
  public description!: string;

  /** Granted permissions (join rows in `role_permissions`). Cascaded with the role. */
  @OneToMany(() => RolePermissionOrmEntity, (rp) => rp.role, {
    cascade: true,
    eager: true,
  })
  public permissions!: RolePermissionOrmEntity[];

  /** Optimistic-concurrency token surfaced as the API ETag (DESIGN §8.1). */
  @Column({ type: 'int' })
  public version!: number;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  public createdAt!: Date;

  @UpdateDateColumn({ name: 'updated_at', type: 'timestamptz' })
  public updatedAt!: Date;
}
