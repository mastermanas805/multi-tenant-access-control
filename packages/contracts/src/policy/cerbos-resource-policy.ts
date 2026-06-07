/**
 * Typed model of the Cerbos `resourcePolicy` document a published Policy version
 * compiles to (DESIGN §3.1, §8.7). This is the COMPILATION TARGET for the
 * PAP-publish agent: it builds this object from a `PolicyRuleBody` + the Policy
 * row's scope/version, serializes it to YAML, and writes it to the Cerbos disk
 * storage dir (`deploy/cerbos/policies/`) where `watchForChanges` hot-reloads it.
 *
 * Shape follows the Cerbos policy schema (apiVersion `api.cerbos.dev/v1`).
 */

/** A CEL match block (mirrors `@contracts/core` PolicyCondition, in Cerbos spelling). */
export interface CerbosMatch {
  readonly all?: { readonly of: CerbosMatchOperand[] };
  readonly any?: { readonly of: CerbosMatchOperand[] };
  readonly expr?: string;
}

export type CerbosMatchOperand = { readonly expr: string } | CerbosMatch;

/** The Cerbos rule effect enum. */
export type CerbosEffect = 'EFFECT_ALLOW' | 'EFFECT_DENY';

/** A single compiled rule (`resourcePolicy.rules[]`). */
export interface CerbosResourceRule {
  readonly actions: string[];
  readonly effect: CerbosEffect;
  readonly roles: string[];
  readonly condition?: { readonly match: CerbosMatch };
  /** Stable rule name; Cerbos surfaces it in the decision so the PEP can build `reason`. */
  readonly name?: string;
}

/** The `resourcePolicy` object inside a Cerbos policy document. */
export interface CerbosResourcePolicy {
  readonly resource: string;
  /**
   * Cerbos resource-policy version (the policy-schema version, NOT the PAP's
   * monotonic Policy.version). The PAP always emits `default`; the scope chain is
   * what differentiates tenant policies (DESIGN §3.1).
   */
  readonly version?: string;
  /** Maps 1:1 to the Policy row's `scope` (the org-tree path, DESIGN §8.5). */
  readonly scope?: string;
  /** Optional derived-role import names referenced by `rules[].derivedRoles`. */
  readonly importDerivedRoles?: string[];
  readonly rules: CerbosResourceRule[];
}

/** A full Cerbos policy document ready to serialize to YAML and drop on disk. */
export interface CerbosPolicyDocument {
  readonly apiVersion: 'api.cerbos.dev/v1';
  /**
   * Optional provenance metadata. The PAP stamps the source Policy id + version so
   * an operator can trace a loaded bundle back to a DB row (DESIGN §9.2 bundle
   * versioning / version-skew monitoring).
   */
  readonly metadata?: {
    readonly storeIdentifier?: string;
    readonly annotations?: Record<string, string>;
  };
  readonly resourcePolicy: CerbosResourcePolicy;
}
