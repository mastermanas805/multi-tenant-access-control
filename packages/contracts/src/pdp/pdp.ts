/**
 * The uniform decision-API contract (DESIGN §8.2 `POST /pdp/v1/check`, FR-6).
 * These are the request/response shapes the PEP assembles and the PDP returns —
 * shared verbatim by every service's PEP and by the Cerbos client wrapper so the
 * "can principal P do action A on resource R?" question is identical everywhere.
 *
 * The §8.2 wire example:
 *   { "principal": { "id", "roles":[…], "attr":{…} },
 *     "resource":  { "kind", "id", "attr":{…} },
 *     "actions": ["read","approve","delete"] }
 *   → { "decisionId", "results":[ { "action", "effect", "policy?", "reason?" } ] }
 */

/** An arbitrary, JSON-serializable attribute bag (principal/resource attrs). */
export type AttributeBag = Record<string, unknown>;

/**
 * The principal under evaluation. `roles` + `attr` are RESOLVED PER-REQUEST by
 * the PEP from the PIP (never from the token — DESIGN §5/D4). `attr` MUST carry
 * `tenantId` so the tenant-isolation guardrail and ABAC conditions can fire
 * (DESIGN §3.1, §6).
 */
export interface PdpPrincipal {
  readonly id: string;
  readonly roles: string[];
  readonly attr: AttributeBag;
}

/**
 * The resource under evaluation. `attr` is loaded IN-REQUEST by the PEP from the
 * owning service's own DB (always fresh, never cached — DESIGN §3.5) and MUST
 * carry `tenantId` for the isolation guardrail (DESIGN §3.1, §6).
 */
export interface PdpResource {
  /** Cerbos resource kind, e.g. `expense_report` (DESIGN §3.1). */
  readonly kind: string;
  readonly id: string;
  readonly attr: AttributeBag;
}

/** A bulk check: many actions for one principal+resource in a single call (DESIGN §8.2). */
export interface PdpCheckRequest {
  readonly principal: PdpPrincipal;
  readonly resource: PdpResource;
  readonly actions: string[];
}

/** The verdict for a single action. */
export type PdpEffect = 'ALLOW' | 'DENY';

/** One action's outcome within a decision (DESIGN §8.2 `results[]`). */
export interface PdpActionResult {
  readonly action: string;
  readonly effect: PdpEffect;
  /** The deciding policy id, e.g. `expense_report/acme.finance` (present on a matched rule). */
  readonly policy?: string;
  /** The deciding rule/condition in human terms (DESIGN §11 "why denied?"). */
  readonly reason?: string;
}

/** The full decision (DESIGN §8.2 response). One `decisionId` per check call. */
export interface PdpCheckResult {
  readonly decisionId: string;
  readonly results: PdpActionResult[];
}
