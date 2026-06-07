// @authz/pep — reusable PEP toolkit (DESIGN §3.2, §4, §7).
// A business service imports AuthzModule.forRootAsync, then @UseGuards(AuthzGuard)
// + @Authorize per route. All public building blocks are re-exported here.

// Module + options
export { AuthzModule } from './module/authz.module';
export {
  AUTHZ_OPTIONS,
  type AuthzModuleOptions,
  type AuthzModuleAsyncOptions,
} from './module/authz.options';

// PEP: guard, decorator, middleware, request context
export { AuthzGuard } from './pep/authz.guard';
export {
  Authorize,
  AUTHORIZE_METADATA,
  type AuthorizeOptions,
  type LoadedResource,
  type ResourceLoader,
  type ResourceLoaderContext,
} from './pep/authorize.decorator';
export { IdentityContextMiddleware } from './pep/identity-context.middleware';
export { type AuthzPrincipalContext, principalContextFromToken } from './pep/authz-request-context';
export { type AuthzDecisionContext } from './pep/express-augmentation';

// PDP client (Cerbos)
export { CerbosPdpClient } from './pdp/cerbos-pdp.client';

// PIP client (port + HTTP impl + cache)
export { type PipClient, PIP_CLIENT } from './pip/pip-client.port';
export { HttpPipClient } from './pip/http-pip.client';
export { TtlLruCache } from './pip/ttl-lru-cache';

// Audit sink (port + HTTP impl)
export { type AuditSink, AUDIT_SINK } from './audit/audit-sink.port';
export { HttpAuditSink } from './audit/http-audit.sink';

// Policy compiler (the policyCompileMapping, shared with the PAP-publish agent)
export { compilePolicyToCerbos } from './policy/compile-policy';
