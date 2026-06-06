import { Policy, type PolicyStatus } from '../domain/policy.entity';
import { PolicyOrmEntity } from './policy.orm-entity';

/**
 * Translates between the Policy aggregate and its TypeORM row. This is the only
 * place that knows both shapes, keeping the domain free of persistence concerns.
 *
 * The owning `tenant_id` is supplied by the repository from the ambient tenant
 * context (DESIGN §6) — a freshly published aggregate carries no tenantId, so the
 * repository passes it in; rehydrated aggregates already carry it from the row.
 */
export const PolicyMapper = {
  /** Aggregate -> ORM row (for persistence). `tenantId` comes from the context. */
  toOrm(policy: Policy, tenantId: string): PolicyOrmEntity {
    const orm = new PolicyOrmEntity();
    orm.id = policy.id.toString();
    orm.tenantId = tenantId;
    orm.scope = policy.scope.toString();
    orm.rule = policy.rule;
    orm.status = policy.status;
    orm.version = policy.version;
    orm.effectiveDate = policy.effectiveDate;
    orm.createdAt = policy.createdAt;
    orm.updatedAt = policy.updatedAt;
    return orm;
  },

  /** ORM row -> aggregate (rehydration via the aggregate's snapshot factory). */
  toDomain(orm: PolicyOrmEntity): Policy {
    return Policy.fromSnapshot({
      id: orm.id,
      tenantId: orm.tenantId,
      scope: orm.scope,
      rule: orm.rule,
      status: orm.status as PolicyStatus,
      version: orm.version,
      effectiveDate: orm.effectiveDate,
      createdAt: orm.createdAt,
      updatedAt: orm.updatedAt,
    });
  },
} as const;
