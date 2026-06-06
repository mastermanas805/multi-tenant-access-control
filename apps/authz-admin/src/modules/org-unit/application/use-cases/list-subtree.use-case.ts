import { Inject, Injectable } from '@nestjs/common';

import { PageQuery } from '@kernel/core';

import { type OrgUnitRepository, ORG_UNIT_REPOSITORY } from '../../domain/org-unit.repository.port';
import { OrgPath } from '../../domain/value-objects/org-path.vo';
import { type ListSubtreeQuery } from '../dto/org-unit.commands';
import { type OrgUnitPageView, toOrgUnitPageView } from '../dto/org-unit.view';

/**
 * Cursor-paginated listing of an org-unit subtree (the root path + descendants,
 * DESIGN §8.5 — an indexed prefix query at the DB layer).
 */
@Injectable()
export class ListSubtreeUseCase {
  constructor(@Inject(ORG_UNIT_REPOSITORY) private readonly orgUnits: OrgUnitRepository) {}

  public async execute(query: ListSubtreeQuery): Promise<OrgUnitPageView> {
    const rootPath = OrgPath.fromString(query.rootPath);
    const page = PageQuery.from({ limit: query.limit, cursor: query.cursor });
    const result = await this.orgUnits.listSubtree(rootPath, page);
    return toOrgUnitPageView(result);
  }
}
