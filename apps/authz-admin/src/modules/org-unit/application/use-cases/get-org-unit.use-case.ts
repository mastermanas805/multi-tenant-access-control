import { Inject, Injectable } from '@nestjs/common';

import { OrgUnitNotFoundError } from '../../domain/org-unit.errors';
import { type OrgUnitRepository, ORG_UNIT_REPOSITORY } from '../../domain/org-unit.repository.port';
import { OrgUnitId } from '../../domain/value-objects/org-unit-id.vo';
import { type GetOrgUnitQuery } from '../dto/org-unit.commands';
import { type OrgUnitView, toOrgUnitView } from '../dto/org-unit.view';

/** Loads a single org-unit by id, or raises a domain NotFound (mapped to 404). */
@Injectable()
export class GetOrgUnitUseCase {
  constructor(@Inject(ORG_UNIT_REPOSITORY) private readonly orgUnits: OrgUnitRepository) {}

  public async execute(query: GetOrgUnitQuery): Promise<OrgUnitView> {
    const id = OrgUnitId.fromString(query.orgUnitId);
    const orgUnit = await this.orgUnits.findById(id);
    if (!orgUnit) {
      throw new OrgUnitNotFoundError(query.orgUnitId);
    }
    return toOrgUnitView(orgUnit);
  }
}
