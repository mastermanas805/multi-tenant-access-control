/**
 * The PIP's read-model: a principal's EFFECTIVE roles + attributes for one
 * (tenant, scope) context, materialized from the PAP (roles/assignments) and the
 * User/HR service (department, manager, status) per DESIGN §3.5/§3.6.
 *
 * This is the exact shape the PAP's principal-resolution endpoint returns and the
 * `PipClient` caches and supplies to the PEP:
 *   GET /v1/principals/:userId/effective?scope=&tenantId=
 *
 * `roles` + `attr` flow straight into `PdpPrincipal`; the PEP only adds the
 * resource-derived inputs and the in-request `tenantId` guardrail.
 */
export interface EffectivePrincipal {
  /** The principal (user) id this view is for. */
  readonly id: string;
  /** The owning tenant — must match the resource's `tenantId` (DESIGN §6 guardrail). */
  readonly tenantId: string;
  /** Effective role keys for the requested scope chain (most-specific-first inheritance). */
  readonly roles: string[];
  /**
   * Effective principal attributes (e.g. `department`, `manager`, `status`).
   * `tenantId` is also surfaced here so it can be copied onto `PdpPrincipal.attr`.
   */
  readonly attr: Record<string, unknown>;
}
