/**
 * Application-layer query input for principal resolution. Plain data shape (no
 * framework decorators) handed from the controller to the use-case.
 */
export interface ResolvePrincipalQuery {
  /** The principal (end-user `sub`) to resolve. */
  userId: string;
  /** The org-tree scope to resolve inheritance against (DESIGN §8.5). */
  scope: string;
}
