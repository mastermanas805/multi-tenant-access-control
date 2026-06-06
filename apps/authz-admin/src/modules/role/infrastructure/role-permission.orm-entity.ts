import { Column, Entity, Index, JoinColumn, ManyToOne, PrimaryColumn } from 'typeorm';

import { RoleOrmEntity } from './role.orm-entity';

/**
 * TypeORM persistence model for the `role_permissions` join table (DESIGN §8:
 * ROLE ||--o{ ROLE_PERMISSION; PERMISSION ||--o{ ROLE_PERMISSION). Each row binds
 * a role to a permission key (`service:resource:action`).
 *
 * Modeled as an owned child of the Role aggregate (cascade from RoleOrmEntity),
 * so a role's permission set is persisted/loaded atomically with the role. Pure
 * data shape: NO behavior, NO domain types.
 *
 * TENANT-SCOPED: carries `tenant_id` + needs a Postgres RLS policy
 *   ALTER TABLE role_permissions ENABLE ROW LEVEL SECURITY;
 *   CREATE POLICY role_permissions_tenant_isolation ON role_permissions
 *     USING (tenant_id = current_setting('app.current_tenant')::uuid);
 *
 * A permission appears at most once per role: composite PK (role_id, permission).
 */
@Entity({ name: 'role_permissions' })
@Index('idx_role_permissions_tenant', ['tenantId'])
export class RolePermissionOrmEntity {
  @PrimaryColumn({ name: 'role_id', type: 'uuid' })
  public roleId!: string;

  @PrimaryColumn({ type: 'varchar', length: 255 })
  public permission!: string;

  @Column({ name: 'tenant_id', type: 'uuid' })
  public tenantId!: string;

  @ManyToOne(() => RoleOrmEntity, (role) => role.permissions, {
    onDelete: 'CASCADE',
    orphanedRowAction: 'delete',
  })
  @JoinColumn({ name: 'role_id' })
  public role!: RoleOrmEntity;
}
