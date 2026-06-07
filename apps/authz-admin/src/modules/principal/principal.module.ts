import { Module } from '@nestjs/common';

import { PRINCIPAL_PROJECTION } from './domain/principal-projection.port';
import { ResolvePrincipalUseCase } from './application/use-cases/resolve-principal.use-case';
import { TypeOrmPrincipalProjection } from './infrastructure/typeorm-principal.projection';
import { PrincipalController } from './presentation/principal.controller';
import { PipTenantContextGuard } from './presentation/pip-tenant-context.guard';

/**
 * Wires the Principal (PIP) feature module:
 *   - controller (presentation) + the PIP tenant-context guard,
 *   - the ResolvePrincipal use-case (application),
 *   - the projection PORT token -> its TypeORM read-model adapter (infrastructure).
 *
 * The DATA_SOURCE + TenantContextService come from the global DatabaseModule; the
 * role/role-assignment ORM entities the projection joins are auto-discovered by
 * the DataSource entity glob, so this module owns no persistence registry. Mirrors
 * the repository-port wiring the reference modules establish.
 */
@Module({
  controllers: [PrincipalController],
  providers: [
    ResolvePrincipalUseCase,
    PipTenantContextGuard,
    { provide: PRINCIPAL_PROJECTION, useClass: TypeOrmPrincipalProjection },
  ],
})
export class PrincipalModule {}
