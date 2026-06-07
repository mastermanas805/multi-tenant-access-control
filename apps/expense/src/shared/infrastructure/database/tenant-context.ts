import { AsyncLocalStorage } from 'node:async_hooks';

import { Injectable } from '@nestjs/common';
import { type QueryRunner } from 'typeorm';

/**
 * Per-request context carried implicitly through the call stack via
 * AsyncLocalStorage. It holds:
 *  - tenantId: the active tenant (from the internal identity token `tid` claim,
 *    populated by the PEP's IdentityContextMiddleware — DESIGN §6).
 *  - queryRunner: the request-scoped QueryRunner whose transaction has had
 *    `SET LOCAL app.current_tenant` applied, so Postgres RLS sees the tenant.
 */
export interface TenantContextStore {
  readonly tenantId: string;
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
