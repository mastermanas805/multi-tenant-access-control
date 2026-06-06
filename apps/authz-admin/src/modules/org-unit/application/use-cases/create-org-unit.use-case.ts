import { Inject, Injectable } from '@nestjs/common';

import { type Clock, CLOCK } from '@kernel/core';

import { TenantContextService } from '../../../../shared/infrastructure/database/tenant-context';
import { OrgUnit } from '../../domain/org-unit.entity';
import { OrgUnitNotFoundError, OrgUnitPathTakenError } from '../../domain/org-unit.errors';
import { type OrgUnitRepository, ORG_UNIT_REPOSITORY } from '../../domain/org-unit.repository.port';
import { OrgUnitId } from '../../domain/value-objects/org-unit-id.vo';
import { type CreateOrgUnitCommand } from '../dto/org-unit.commands';
import { type OrgUnitView, toOrgUnitView } from '../dto/org-unit.view';

/**
 * Creates an org-unit node. When `parentId` is supplied the path is DERIVED from
 * the parent (parent.path + segment, DESIGN §8.5); otherwise a root node is
 * created. Enforces path uniqueness per tenant; depth (<= 8) is enforced by the
 * OrgPath VO inside the aggregate. The new row is stamped with the ambient
 * tenant id (the ONLY place the use-case touches tenant context — for stamping,
 * not filtering; RLS still scopes every statement).
 */
@Injectable()
export class CreateOrgUnitUseCase {
  constructor(
    @Inject(ORG_UNIT_REPOSITORY) private readonly orgUnits: OrgUnitRepository,
    @Inject(CLOCK) private readonly clock: Clock,
    private readonly tenantContext: TenantContextService,
  ) {}

  public async execute(command: CreateOrgUnitCommand): Promise<OrgUnitView> {
    const tenantId = this.tenantContext.getTenantId();
    const now = this.clock.now();

    let orgUnit: OrgUnit;
    if (command.parentId !== undefined) {
      const parent = await this.orgUnits.findById(OrgUnitId.fromString(command.parentId));
      if (!parent) {
        throw new OrgUnitNotFoundError(command.parentId);
      }
      orgUnit = OrgUnit.createChild({
        tenantId,
        name: command.name,
        segment: command.segment,
        parentId: parent.id.toString(),
        parentPath: parent.path,
        now,
      });
    } else {
      orgUnit = OrgUnit.createRoot({
        tenantId,
        name: command.name,
        segment: command.segment,
        now,
      });
    }

    const existing = await this.orgUnits.findByPath(orgUnit.path);
    if (existing) {
      throw new OrgUnitPathTakenError(orgUnit.path.toString());
    }

    await this.orgUnits.save(orgUnit);

    return toOrgUnitView(orgUnit);
  }
}
