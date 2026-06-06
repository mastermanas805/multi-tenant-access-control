/**
 * Application-layer command/query inputs. These are plain data shapes (no
 * framework decorators) handed from the controller to the use-cases. HTTP-facing
 * validation lives on the presentation request DTOs.
 */

export interface CreateOrgUnitCommand {
  /** The node's own leaf segment, e.g. "finance" (lower-kebab). */
  segment: string;
  /** Human-readable display name. */
  name: string;
  /**
   * Parent org-unit id. When omitted, a ROOT node is created and `segment`
   * becomes the whole path (e.g. "acme").
   */
  parentId?: string;
}

export interface GetOrgUnitQuery {
  orgUnitId: string;
}

export interface ListSubtreeQuery {
  /** Materialized path of the subtree root, e.g. "acme.finance". */
  rootPath: string;
  limit?: number;
  cursor?: string | null;
}

export interface MoveOrgUnitCommand {
  orgUnitId: string;
  /** New parent id; null/omitted promotes the node to a root. */
  newParentId?: string | null;
  /** Optimistic-concurrency guard from the `If-Match` ETag (DESIGN §8.1). */
  expectedVersion?: number;
}
