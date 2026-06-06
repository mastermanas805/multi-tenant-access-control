import { AggregateRoot, Guard, UniqueEntityID } from '@kernel/core';

import { OrgUnitMovedEvent } from './org-unit.events';
import { OrgUnitDepthExceededError } from './org-unit.errors';
import { OrgPath } from './value-objects/org-path.vo';

/** Internal property bag for the OrgUnit aggregate. */
export interface OrgUnitProps {
  tenantId: string;
  parentId: string | null;
  path: OrgPath;
  name: string;
  version: number;
  createdAt: Date;
  updatedAt: Date;
}

/** Input for creating a root org-unit (no parent). */
export interface CreateRootOrgUnitProps {
  tenantId: string;
  name: string;
  /** The single root segment (e.g. "acme"). */
  segment: string;
  now: Date;
}

/** Input for creating a child org-unit under an existing parent. */
export interface CreateChildOrgUnitProps {
  tenantId: string;
  name: string;
  /** The leaf segment appended to the parent path (e.g. "finance"). */
  segment: string;
  parentId: string;
  parentPath: OrgPath;
  now: Date;
}

/** Snapshot used to rehydrate an org-unit from persistence (the mapper builds this). */
export interface OrgUnitSnapshot {
  id: string;
  tenantId: string;
  parentId: string | null;
  path: string;
  name: string;
  version: number;
  createdAt: Date;
  updatedAt: Date;
}

/**
 * OrgUnit aggregate root — a tenant-scoped node in the org hierarchy
 * (Company -> Department -> Team, DESIGN FR-3 / §8.5). The materialized `path`
 * IS the Cerbos scope (e.g. `acme.finance.emea`). Owns its own path/depth
 * invariants; cross-node invariants (uniqueness, cycles, subtree rewrite) are
 * orchestrated by the use-cases inside a transaction.
 */
export class OrgUnit extends AggregateRoot<OrgUnitProps> {
  private constructor(props: OrgUnitProps, id: UniqueEntityID) {
    super(props, id);
  }

  // --- Factories (new aggregate) ---------------------------------------------

  /** Creates a root node whose path is a single validated segment. */
  public static createRoot(props: CreateRootOrgUnitProps): OrgUnit {
    Guard.againstEmpty(props.name, 'name');
    Guard.invariant(props.name.length <= 200, 'name too long', 'name_too_long');
    const path = OrgPath.fromString(props.segment);

    return new OrgUnit(
      {
        tenantId: props.tenantId,
        parentId: null,
        path,
        name: props.name.trim(),
        version: 1,
        createdAt: props.now,
        updatedAt: props.now,
      },
      new UniqueEntityID(),
    );
  }

  /** Creates a child node, deriving its path from the parent (DESIGN §8.5). */
  public static createChild(props: CreateChildOrgUnitProps): OrgUnit {
    Guard.againstEmpty(props.name, 'name');
    Guard.invariant(props.name.length <= 200, 'name too long', 'name_too_long');
    const path = props.parentPath.child(props.segment);

    return new OrgUnit(
      {
        tenantId: props.tenantId,
        parentId: props.parentId,
        path,
        name: props.name.trim(),
        version: 1,
        createdAt: props.now,
        updatedAt: props.now,
      },
      new UniqueEntityID(),
    );
  }

  // --- Rehydration (from persistence) ----------------------------------------

  public static fromSnapshot(snapshot: OrgUnitSnapshot): OrgUnit {
    return new OrgUnit(
      {
        tenantId: snapshot.tenantId,
        parentId: snapshot.parentId,
        path: OrgPath.fromString(snapshot.path),
        name: snapshot.name,
        version: snapshot.version,
        createdAt: snapshot.createdAt,
        updatedAt: snapshot.updatedAt,
      },
      new UniqueEntityID(snapshot.id),
    );
  }

  // --- Getters ---------------------------------------------------------------

  public get tenantId(): string {
    return this.props.tenantId;
  }

  public get parentId(): string | null {
    return this.props.parentId;
  }

  public get path(): OrgPath {
    return this.props.path;
  }

  public get name(): string {
    return this.props.name;
  }

  public get version(): number {
    return this.props.version;
  }

  public get createdAt(): Date {
    return this.props.createdAt;
  }

  public get updatedAt(): Date {
    return this.props.updatedAt;
  }

  // --- Behavior (invariant-protected transitions) ----------------------------

  /**
   * Re-parents this node onto `newParentPath` (or to a root when null) and
   * recomputes ITS OWN path. The caller (MoveOrgUnitUseCase) is responsible for
   * rewriting descendant paths in the same transaction and for the cycle check;
   * here we only enforce this node's depth invariant and record the event.
   */
  public moveTo(newParentId: string | null, newParentPath: OrgPath | null, now: Date): void {
    const segment = this.props.path.leaf;
    const newPath =
      newParentPath === null ? OrgPath.fromString(segment) : newParentPath.child(segment);

    if (newPath.depth > OrgPath.MAX_DEPTH) {
      throw new OrgUnitDepthExceededError(
        `move would exceed max depth ${String(OrgPath.MAX_DEPTH)}`,
        'org_unit_depth_exceeded',
      );
    }

    const fromPath = this.props.path.toString();
    this.props.parentId = newParentId;
    this.props.path = newPath;
    this.touch(now);
    this.addDomainEvent(new OrgUnitMovedEvent(this.id, fromPath, newPath.toString(), newParentId));
  }

  /**
   * Rebases a descendant's path when an ancestor moves: replaces the old ancestor
   * prefix with the new one. Used by MoveOrgUnitUseCase for the subtree rewrite.
   */
  public rebasePath(oldAncestorPath: OrgPath, newAncestorPath: OrgPath, now: Date): void {
    const current = this.props.path.toString();
    const oldPrefix = oldAncestorPath.toString();
    const suffix = current.slice(oldPrefix.length); // includes the leading "."
    const rebased = OrgPath.fromString(`${newAncestorPath.toString()}${suffix}`);

    if (rebased.depth > OrgPath.MAX_DEPTH) {
      throw new OrgUnitDepthExceededError(
        `subtree rewrite would exceed max depth ${String(OrgPath.MAX_DEPTH)}`,
        'org_unit_depth_exceeded',
      );
    }

    this.props.path = rebased;
    this.touch(now);
  }

  private touch(now: Date): void {
    this.props.updatedAt = now;
    this.props.version += 1;
  }
}
