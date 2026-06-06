import { Inject, Injectable } from '@nestjs/common';

import {
  ConflictError,
  type Clock,
  CLOCK,
  type IDomainEventDispatcher,
  DOMAIN_EVENT_DISPATCHER,
} from '@kernel/core';

import { type OrgUnit } from '../../domain/org-unit.entity';
import {
  OrgUnitCycleError,
  OrgUnitNotFoundError,
  OrgUnitPathTakenError,
} from '../../domain/org-unit.errors';
import { type OrgUnitRepository, ORG_UNIT_REPOSITORY } from '../../domain/org-unit.repository.port';
import { OrgUnitId } from '../../domain/value-objects/org-unit-id.vo';
import { type MoveOrgUnitCommand } from '../dto/org-unit.commands';
import { type OrgUnitView, toOrgUnitView } from '../dto/org-unit.view';

/**
 * Re-parents an org-unit and recomputes the WHOLE subtree's materialized paths
 * in one transaction (DESIGN §8.5 — reorg is bounded and rare). Invariants:
 *   - no cycles: the new parent cannot be the node itself or a descendant,
 *   - depth <= 8: enforced by the aggregate/OrgPath on every rewritten node,
 *   - path unique per tenant: the moved node's new path must be free.
 * Honors optimistic concurrency via the `If-Match` expected version (DESIGN §8.1).
 */
@Injectable()
export class MoveOrgUnitUseCase {
  constructor(
    @Inject(ORG_UNIT_REPOSITORY) private readonly orgUnits: OrgUnitRepository,
    @Inject(CLOCK) private readonly clock: Clock,
    @Inject(DOMAIN_EVENT_DISPATCHER) private readonly dispatcher: IDomainEventDispatcher,
  ) {}

  public async execute(command: MoveOrgUnitCommand): Promise<OrgUnitView> {
    const node = await this.orgUnits.findById(OrgUnitId.fromString(command.orgUnitId));
    if (!node) {
      throw new OrgUnitNotFoundError(command.orgUnitId);
    }

    if (command.expectedVersion !== undefined && command.expectedVersion !== node.version) {
      throw new ConflictError('OrgUnit was modified by another request', 'version_mismatch');
    }

    const newParentId = command.newParentId ?? null;
    let newParent: OrgUnit | null = null;
    if (newParentId !== null) {
      newParent = await this.orgUnits.findById(OrgUnitId.fromString(newParentId));
      if (!newParent) {
        throw new OrgUnitNotFoundError(newParentId);
      }
      // Cycle guard: cannot re-parent a node under itself or its own descendant.
      if (node.path.isAncestorOf(newParent.path)) {
        throw new OrgUnitCycleError(
          'cannot move an org-unit under itself or a descendant',
          'org_unit_cycle',
        );
      }
    }

    const oldPath = node.path;
    const descendants = await this.orgUnits.findDescendants(oldPath);

    const now = this.clock.now();
    node.moveTo(newParentId, newParent ? newParent.path : null, now);

    // New path must be free (excluding the node's own descendants we're rebasing).
    const clash = await this.orgUnits.findByPath(node.path);
    if (clash && clash.id.toString() !== node.id.toString()) {
      throw new OrgUnitPathTakenError(node.path.toString());
    }

    // Rebase every descendant onto the node's new path, in the same transaction.
    for (const descendant of descendants) {
      descendant.rebasePath(oldPath, node.path, now);
    }

    await this.orgUnits.saveMany([node, ...descendants]);

    // Only the moved node raises an event (OrgUnitMovedEvent); descendants are
    // merely rebased. Publish after persistence (DESIGN §3.4 sequence).
    await this.dispatcher.dispatch(node.pullDomainEvents());

    return toOrgUnitView(node);
  }
}
