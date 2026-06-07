import {
  type CanActivate,
  type ExecutionContext,
  Inject,
  Injectable,
  NotFoundException,
  UnauthorizedException,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { type Request } from 'express';

import { ForbiddenError } from '@kernel/core';
import {
  type DecisionAuditRecord,
  type PdpActionResult,
  type PdpPrincipal,
  type PdpResource,
} from '@contracts/core';

import { AUDIT_SINK, type AuditSink } from '../audit/audit-sink.port';
import { CerbosPdpClient } from '../pdp/cerbos-pdp.client';
import { PIP_CLIENT, type PipClient } from '../pip/pip-client.port';
import { type AuthzPrincipalContext } from './authz-request-context';
import {
  AUTHORIZE_METADATA,
  type AuthorizeOptions,
  type LoadedResource,
} from './authorize.decorator';
import './express-augmentation';

/**
 * The PEP guard (DESIGN §3.2 PEP, §4.3 steps 3-7). For a route annotated with
 * `@Authorize`, it:
 *   1. reads the principal/tenant/actor from `req.authzPrincipal` (the internal
 *      identity token, populated by IdentityContextMiddleware);
 *   2. loads the resource via the route's pluggable loader (in-request attrs,
 *      always fresh — DESIGN §3.5);
 *   3. runs the CHEAP tenant guardrail (resource.tenantId === principal.tenantId)
 *      BEFORE calling the PDP (DESIGN §4.3 step 3, §6 layer 2);
 *   4. resolves the principal's effective roles/attrs via the PIP (DESIGN §3.5);
 *   5. calls the Cerbos PDP (DESIGN §4.3 step 5);
 *   6. on DENY throws a ForbiddenError carrying reason + decisionId so the global
 *      filter renders the §8.1 envelope; on ALLOW stores the decision on the
 *      request for the handler to read;
 *   7. emits the decision to the Audit sink (async — DESIGN §4.3 step 7).
 *
 * Fail-closed (DESIGN §9 D8): any error in resolving/deciding denies; missing
 * principal context = 401; a missing resource = 404 (never an implicit allow).
 */
@Injectable()
export class AuthzGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly pdp: CerbosPdpClient,
    @Inject(PIP_CLIENT) private readonly pip: PipClient,
    @Inject(AUDIT_SINK) private readonly audit: AuditSink,
  ) {}

  public async canActivate(context: ExecutionContext): Promise<boolean> {
    const options = this.reflector.get<AuthorizeOptions | undefined>(
      AUTHORIZE_METADATA,
      context.getHandler(),
    );
    // No @Authorize on this route: the guard is a no-op (defense: opt-in per route).
    if (!options) {
      return true;
    }

    const request = context.switchToHttp().getRequest<Request>();
    const principalCtx = request.authzPrincipal;
    if (!principalCtx) {
      throw new UnauthorizedException('No authenticated principal context on the request');
    }
    const traceId = request.traceId ?? '';
    const actions = Array.isArray(options.action) ? options.action : [options.action];

    // (2) Load the resource (in-request attrs, always fresh — DESIGN §3.5).
    const resource = await options.loadResource({ request, principal: principalCtx });
    if (resource === null) {
      throw new NotFoundException('Resource not found');
    }

    // (3) Cheap tenant guardrail BEFORE the PDP (DESIGN §4.3 step 3, §6).
    this.enforceTenantGuardrail(principalCtx, resource);

    // (4) Resolve effective roles/attrs via the PIP (DESIGN §3.5).
    const scope = resource.scope ?? '';
    const effective = await this.pip.resolve(
      principalCtx.principalId,
      principalCtx.tenantId,
      scope,
      options.sensitive ?? false,
    );

    // (5) Call the PDP (DESIGN §4.3 step 5).
    const pdpPrincipal: PdpPrincipal = {
      id: principalCtx.principalId,
      roles: effective.roles,
      attr: { ...effective.attr, tenantId: principalCtx.tenantId },
    };
    const pdpResource: PdpResource = {
      kind: options.resourceKind,
      id: resource.id,
      attr: resource.attr,
    };
    const decision = await this.pdp.check(pdpPrincipal, pdpResource, actions, resource.scope);

    // (7) Emit each action's decision to the Audit sink (async — DESIGN §4.3 step 7).
    for (const result of decision.results) {
      this.emitAudit(decision.decisionId, traceId, principalCtx, pdpResource, result);
    }

    // (6) Enforce: any DENY fails closed with the §8.1 reason + decisionId.
    const denied = decision.results.find((r) => r.effect === 'DENY');
    if (denied) {
      throw new ForbiddenError(
        this.denyMessage(options.resourceKind, denied),
        denied.reason ?? `no rule grants ${denied.action}`,
        decision.decisionId,
      );
    }

    // ALLOW: expose the decision so the handler can echo decisionId (DESIGN §8.2).
    request.authzDecision = { decisionId: decision.decisionId, results: decision.results };
    return true;
  }

  /** DESIGN §6 layer 2: a resource in another tenant is denied before the PDP. */
  private enforceTenantGuardrail(
    principal: AuthzPrincipalContext,
    resource: LoadedResource,
  ): void {
    if (resource.attr.tenantId !== principal.tenantId) {
      throw new ForbiddenError('Resource not in your tenant', 'tenant isolation guardrail');
    }
  }

  private denyMessage(resourceKind: string, denied: PdpActionResult): string {
    return `Cannot ${denied.action} this ${resourceKind.replace(/_/g, ' ')}`;
  }

  private emitAudit(
    decisionId: string,
    traceId: string,
    principal: AuthzPrincipalContext,
    resource: PdpResource,
    result: PdpActionResult,
  ): void {
    const record: DecisionAuditRecord = {
      decisionId,
      traceId,
      tenantId: principal.tenantId,
      principalId: principal.principalId,
      actorId: principal.actorId,
      resourceKind: resource.kind,
      resourceId: resource.id,
      action: result.action,
      effect: result.effect,
      ...(result.policy ? { policy: result.policy } : {}),
      ...(result.reason ? { reason: result.reason } : {}),
      decidedAt: new Date().toISOString(),
    };
    this.audit.record(record);
  }
}
