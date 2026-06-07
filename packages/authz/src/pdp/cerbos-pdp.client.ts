import { randomUUID } from 'node:crypto';

import { GRPC } from '@cerbos/grpc';
import { Inject, Injectable, Logger, type OnModuleDestroy } from '@nestjs/common';

import {
  type AttributeBag,
  type PdpCheckResult,
  type PdpActionResult,
  type PdpPrincipal,
  type PdpResource,
} from '@contracts/core';

/**
 * Cerbos `attr` values are typed as a JSON `Value`; the platform's `AttributeBag`
 * is `Record<string, unknown>` but is JSON-serializable by contract (it comes
 * from the resource DB row / the PIP JSON). This mirrors Cerbos's `Value` so we
 * narrow at the SDK boundary only, with no extra dependency on `@cerbos/core`.
 */
type JsonValue = string | number | boolean | null | { [key: string]: JsonValue } | JsonValue[];
type CerbosAttr = Record<string, JsonValue>;
const asCerbosAttr = (attr: AttributeBag): CerbosAttr => attr as CerbosAttr;

import { AUTHZ_OPTIONS, type AuthzModuleOptions } from '../module/authz.options';

/**
 * Sentinel role for a principal with NO effective roles. Cerbos rejects an empty
 * `principal.roles` at request validation, but a role-less principal must still
 * yield a DENY (fail-closed), not an error — so we send this placeholder, which no
 * policy grants. Underscore-prefixed so it can never collide with a real role key.
 */
const NO_ROLES_SENTINEL = '_no_roles';

/**
 * The PDP client (DESIGN §3.2 PDP, §4.2). Wraps the Cerbos gRPC SDK and adapts
 * the platform's `@contracts/core` decision contract to Cerbos `checkResource`.
 *
 * In production this targets the CO-LOCATED Cerbos sidecar/DaemonSet over loopback
 * (DESIGN §3 D3, §9.2) so a decision is a sub-ms local call, never a network
 * fan-out. The address is `CERBOS_URL` (e.g. `localhost:3593`).
 *
 * The `scope` (org-tree path, DESIGN §8.5) is passed to Cerbos via the resource so
 * the most-specific-scoped policy on the chain decides (DESIGN §3.1 inheritance).
 */
@Injectable()
export class CerbosPdpClient implements OnModuleDestroy {
  private readonly logger = new Logger(CerbosPdpClient.name);
  private readonly cerbos: GRPC;

  constructor(@Inject(AUTHZ_OPTIONS) private readonly options: AuthzModuleOptions) {
    // tls:false — the sidecar is reached over loopback inside the pod's trust
    // boundary; the mesh (mTLS/SPIFFE) protects cross-pod traffic (DESIGN §7).
    this.cerbos = new GRPC(this.options.cerbosUrl, { tls: false });
  }

  /**
   * Evaluate `actions` for `principal` on `resource` (DESIGN §8.2). Returns the
   * uniform `PdpCheckResult` with one `decisionId` and a per-action effect +
   * deciding policy + reason. `scope` (optional) selects the scoped policy chain.
   *
   * Fail-closed (DESIGN §9 D8): any transport/SDK error throws — the PEP turns it
   * into a ForbiddenError, never an implicit allow.
   */
  public async check(
    principal: PdpPrincipal,
    resource: PdpResource,
    actions: string[],
    scope?: string,
  ): Promise<PdpCheckResult> {
    const decisionId = `dec_${randomUUID()}`;

    const result = await this.cerbos.checkResource({
      principal: {
        id: principal.id,
        // Cerbos REQUIRES at least one role on the principal (an empty array fails
        // request validation). A principal with NO effective roles — e.g. right
        // after a revocation (FR-8) — must still produce a DENY, not an error, so
        // substitute a sentinel role no policy grants. It matches no ALLOW rule,
        // so the decision is DENY by default (fail-closed, DESIGN §9 D8).
        roles: principal.roles.length > 0 ? principal.roles : [NO_ROLES_SENTINEL],
        attr: asCerbosAttr(principal.attr),
      },
      resource: {
        kind: resource.kind,
        id: resource.id,
        attr: asCerbosAttr(resource.attr),
        ...(scope !== undefined ? { scope } : {}),
      },
      actions,
      // Needed so the deciding policy + scope come back for the §8.1 `reason`/`policy`.
      includeMetadata: true,
    });

    const results: PdpActionResult[] = actions.map((action) => {
      const allowed = result.isAllowed(action) ?? false;
      const meta = result.metadata?.actions[action];
      const policy = this.formatPolicy(meta?.matchedPolicy);
      const base: PdpActionResult = {
        action,
        effect: allowed ? 'ALLOW' : 'DENY',
      };
      return {
        ...base,
        ...(policy ? { policy } : {}),
        ...(this.reasonFor(action, allowed, policy) !== undefined
          ? { reason: this.reasonFor(action, allowed, policy) }
          : {}),
      };
    });

    return { decisionId, results };
  }

  /**
   * Normalize Cerbos's matched-policy id into the §8.2 contract form
   * `<kind>/<scope>` (e.g. `expense_report/acme.finance`).
   *
   * Cerbos returns it as `resource.<kind>.v<version>[/<scope>]`, e.g.
   * `resource.expense_report.vdefault/acme.finance` or
   * `resource.expense_report.vdefault` (no scope). Parse out the kind and scope.
   */
  private formatPolicy(matched: string | undefined): string | undefined {
    if (!matched) {
      return undefined;
    }
    const slash = matched.indexOf('/');
    const fqn = slash === -1 ? matched : matched.slice(0, slash);
    const scope = slash === -1 ? undefined : matched.slice(slash + 1);
    // fqn = `resource.<kind>.v<version>`. Strip the `resource.` prefix and the
    // trailing `.v<version>` segment to recover `<kind>`.
    const withoutPrefix = fqn.startsWith('resource.') ? fqn.slice('resource.'.length) : fqn;
    const lastDot = withoutPrefix.lastIndexOf('.v');
    const kind = lastDot > 0 ? withoutPrefix.slice(0, lastDot) : withoutPrefix;
    return scope ? `${kind}/${scope}` : kind;
  }

  private reasonFor(action: string, allowed: boolean, policy?: string): string | undefined {
    if (allowed) {
      return policy ? `allowed by ${policy}` : undefined;
    }
    return policy ? `denied by ${policy}` : `no rule grants ${action}`;
  }

  public onModuleDestroy(): void {
    try {
      this.cerbos.close();
    } catch (err) {
      this.logger.warn(`Error closing Cerbos client: ${String(err)}`);
    }
  }
}
