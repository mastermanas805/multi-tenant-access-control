import { Inject, Injectable } from '@nestjs/common';
import { DataSource, type EntityManager } from 'typeorm';

import { DATA_SOURCE } from '../../../shared/infrastructure/database/data-source';
import { TenantContextService } from '../../../shared/infrastructure/database/tenant-context';
import { RoleAssignmentOrmEntity } from '../../role-assignment/infrastructure/role-assignment.orm-entity';
import { RoleOrmEntity } from '../../role/infrastructure/role.orm-entity';
import {
  type PrincipalProjection,
  type PrincipalRoleGrant,
} from '../domain/principal-projection.port';

/**
 * TypeORM read-model adapter for the PrincipalProjection port. Joins
 * `role_assignments` to `roles` to project a principal's ACTIVE grants as role
 * KEYS (Cerbos consumes keys, not the role UUID) for a set of scopes (DESIGN §3.2,
 * §8.5).
 *
 * RLS: executes through the request-scoped EntityManager bound by the
 * RlsInterceptor (which ran `SET LOCAL app.current_tenant`), so every statement is
 * tenant-scoped; falls back to the DataSource manager when no request runner
 * exists. Tenant-agnostic — it never filters by tenant id itself (DESIGN §6).
 */
@Injectable()
export class TypeOrmPrincipalProjection implements PrincipalProjection {
  constructor(
    @Inject(DATA_SOURCE) private readonly dataSource: DataSource,
    private readonly tenantContext: TenantContextService,
  ) {}

  /** Resolve the manager through the tenant context so RLS applies. */
  private get manager(): EntityManager {
    const store = this.tenantContext.getStore();
    if (store?.queryRunner) {
      return store.queryRunner.manager;
    }
    return this.dataSource.manager;
  }

  public async findActiveGrants(
    userId: string,
    scopeChain: string[],
  ): Promise<PrincipalRoleGrant[]> {
    if (scopeChain.length === 0) {
      return [];
    }

    const now = new Date();
    const rows = await this.manager
      .createQueryBuilder(RoleAssignmentOrmEntity, 'ra')
      // Join on role_id -> roles.id to surface the role KEY (and to drop any
      // dangling assignment whose role was deleted). `roles.id` is a uuid column
      // while `role_assignments.role_id` is a varchar holding the role id (the
      // assignment treats it as an opaque string id), so cast the uuid side to
      // text — Postgres has no implicit uuid=varchar operator.
      .innerJoin(RoleOrmEntity, 'r', 'r.id::text = ra.role_id')
      .select('r.key', 'roleKey')
      .addSelect('ra.scope', 'scope')
      .where('ra.user_id = :userId', { userId })
      // Scope inheritance: only grants on the ancestor-or-self chain count.
      .andWhere('ra.scope IN (:...scopes)', { scopes: scopeChain })
      .andWhere('ra.status = :active', { active: 'active' })
      // Exclude expired delegated/time-boxed grants (DESIGN §3.4).
      .andWhere('(ra.valid_until IS NULL OR ra.valid_until > :now)', { now })
      .getRawMany<{ roleKey: string; scope: string }>();

    return rows.map((row) => ({ roleKey: row.roleKey, scope: row.scope }));
  }
}
