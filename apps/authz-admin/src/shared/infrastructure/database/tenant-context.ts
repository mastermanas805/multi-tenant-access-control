import { AsyncLocalStorage } from 'node:async_hooks';

import { Injectable } from '@nestjs/common';
import { type QueryRunner } from 'typeorm';

/**
 * Per-request context carried implicitly through the call stack via
 * AsyncLocalStorage. It holds:
 *  - tenantId: the validated tenant (from the JWT `tid` claim; here the
 *    x-tenant-id header placeholder — DESIGN §6).
 *  - queryRunner: the request-scoped QueryRunner whose transaction has had
 *    `SET LOCAL app.current_tenant` applied, so Postgres RLS sees the tenant.
 */
export interface TenantContextStore {
  readonly tenantId: string;
  /**
   * Whether the verified principal holds the PLATFORM-ADMIN scope (DESIGN §6 /
   * App. A SoD on admin roles). In production this comes from a verified JWT
   * scope/role claim — never client-settable; here it is the documented
   * `x-platform-admin` header placeholder. Gates platform-wide surfaces (tenant
   * lifecycle, global permission-catalog writes) so one tenant cannot act on
   * another's records or pollute the shared catalog.
   */
  readonly isPlatformAdmin: boolean;
  /**
   * The authenticated CALLER's identity (the actor). In production this is the
   * verified JWT `sub` claim, set by the IdP and never client-settable; here it is
   * the documented `x-actor-id` header placeholder (DESIGN §6). Used to stamp
   * security/audit-relevant attributes server-side (e.g. role-assignment
   * `delegatedBy`) so a caller cannot forge who performed a privileged action.
   * Null when no actor was presented.
   */
  readonly actorId: string | null;
  queryRunner?: QueryRunner;
}

@Injectable()
export class TenantContextService {
  private readonly als = new AsyncLocalStorage<TenantContextStore>();

  /** Runs `fn` with the given store bound to the current async context. */
  public run<T>(store: TenantContextStore, fn: () => T): T {
    return this.als.run(store, fn);
  }

  /**
   * Binds `store` to the current async context for the remainder of the flow
   * (used by the guard, which cannot wrap the whole request in a callback).
   */
  public enterWith(store: TenantContextStore): void {
    this.als.enterWith(store);
  }

  /** The current store, or undefined if called outside a tenant-scoped request. */
  public getStore(): TenantContextStore | undefined {
    return this.als.getStore();
  }

  /** The current tenant id. Throws if there is no active tenant context. */
  public getTenantId(): string {
    const store = this.als.getStore();
    if (!store) {
      throw new Error('No tenant context bound to the current request');
    }
    return store.tenantId;
  }

  /**
   * Whether the current principal holds the platform-admin scope. False when
   * there is no active context (fail-closed). Read by the PlatformAdminGuard.
   */
  public isPlatformAdmin(): boolean {
    return this.als.getStore()?.isPlatformAdmin ?? false;
  }

  /**
   * The authenticated caller's identity (the actor — the JWT `sub` placeholder).
   * Null when no actor is bound. Use to stamp audit attributes server-side so a
   * client cannot forge who performed an action (DESIGN §6).
   */
  public getActorId(): string | null {
    return this.als.getStore()?.actorId ?? null;
  }

  /**
   * The request-scoped QueryRunner whose transaction is RLS-scoped to the
   * tenant. Repositories MUST use this manager so RLS applies. Throws if absent.
   */
  public getQueryRunner(): QueryRunner {
    const store = this.als.getStore();
    if (!store?.queryRunner) {
      throw new Error('No tenant-scoped QueryRunner bound to the current request');
    }
    return store.queryRunner;
  }
}

/** DI token for the tenant context service (also usable as the class). */
export const TENANT_CONTEXT = TenantContextService;
