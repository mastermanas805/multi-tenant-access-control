import {
  type CallHandler,
  type ExecutionContext,
  Inject,
  Injectable,
  type NestInterceptor,
} from '@nestjs/common';
import { type Observable, from } from 'rxjs';
import { DataSource } from 'typeorm';

import { ConfigService } from '../../../config/config.service';
import { DATA_SOURCE } from './data-source';
import { TenantContextService } from './tenant-context';

/**
 * Per-request transactional + RLS boundary (DESIGN §6, §8.3).
 *
 * For each request that has a tenant context (bound by the IdentityTenantContext
 * middleware from the internal token `tid`) this interceptor:
 *   1. opens a QueryRunner and starts a transaction,
 *   2. runs `SET LOCAL app.current_tenant = <tenantId>` so Postgres RLS
 *      policies (`USING (tenant_id = current_setting('app.current_tenant')::uuid)`)
 *      scope every query to the tenant,
 *   3. binds the QueryRunner into the tenant context so repositories use it,
 *   4. commits on success / rolls back on error, and always releases the runner.
 *
 * Repositories MUST execute through `TenantContextService.getQueryRunner().manager`
 * so their statements run inside this RLS-scoped transaction.
 *
 * When DB is disabled (DB_ENABLED=false) the interceptor is a pass-through, so
 * the HTTP layer still works without Postgres.
 */
@Injectable()
export class RlsInterceptor implements NestInterceptor {
  constructor(
    @Inject(DATA_SOURCE) private readonly dataSource: DataSource,
    private readonly tenantContext: TenantContextService,
    private readonly config: ConfigService,
  ) {}

  public intercept(_context: ExecutionContext, next: CallHandler): Observable<unknown> {
    const store = this.tenantContext.getStore();

    // No tenant context (e.g. health checks) or DB disabled -> pass through.
    if (!store || !this.config.values.DB_ENABLED) {
      return next.handle();
    }

    return from(this.runWithRls(store.tenantId, next));
  }

  private async runWithRls(tenantId: string, next: CallHandler): Promise<unknown> {
    const queryRunner = this.dataSource.createQueryRunner();
    await queryRunner.connect();
    await queryRunner.startTransaction();
    try {
      // SET LOCAL is scoped to this transaction; parameterized to avoid injection.
      await queryRunner.query('SELECT set_config($1, $2, true)', ['app.current_tenant', tenantId]);

      // Bind the RLS-scoped runner so repositories use it within this request.
      const store = this.tenantContext.getStore();
      if (store) {
        store.queryRunner = queryRunner;
      }

      const result = await firstValueFromHandle(next);
      await queryRunner.commitTransaction();
      return result;
    } catch (err) {
      if (queryRunner.isTransactionActive) {
        await queryRunner.rollbackTransaction();
      }
      throw err;
    } finally {
      const store = this.tenantContext.getStore();
      if (store) {
        store.queryRunner = undefined;
      }
      await queryRunner.release();
    }
  }
}

/** Awaits a Nest handler's Observable as a promise of its first emitted value. */
async function firstValueFromHandle(next: CallHandler): Promise<unknown> {
  return new Promise<unknown>((resolve, reject) => {
    let settled = false;
    next.handle().subscribe({
      next: (value: unknown) => {
        if (!settled) {
          settled = true;
          resolve(value);
        }
      },
      error: (err: unknown) => {
        reject(err instanceof Error ? err : new Error(String(err)));
      },
    });
  });
}
