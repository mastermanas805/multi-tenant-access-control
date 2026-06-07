import { FINANCE_MANAGER_ROLE_ID, FINANCE_SCOPE, GATEWAY_URL } from './config';
import type {
  ApiResult,
  ApproveResult,
  AuditEventPage,
  ErrorEnvelope,
  ExpensePage,
  RoleAssignment,
  RoleAssignmentPage,
  TokenResponse,
} from './types';

/**
 * The ONLY backend boundary of the SPA: every call goes to the API Gateway
 * (GATEWAY_URL). No downstream service is ever addressed directly — the gateway
 * verifies the JWT, mints the internal identity token and routes (DESIGN §4/§13).
 *
 * ── Why the JWT is held in MEMORY, never localStorage/sessionStorage ──────────
 * An access token in localStorage is readable by ANY JavaScript on the origin, so
 * a single XSS turns into long-lived token theft (the attacker exfiltrates it and
 * replays it from anywhere). Keeping it in a module-scoped variable means it lives
 * only for the page session, is gone on refresh/close, and is never persisted to
 * disk — it cannot be stolen by reading storage. The tradeoff (re-login on
 * refresh) is acceptable for a demo and is the same posture a production SPA would
 * take (short-lived access token in memory; a refresh token in an HttpOnly,
 * SameSite cookie the JS can't read — out of scope here). This mirrors the §13
 * principle: the client is never the security boundary.
 */
let accessToken: string | null = null;

export function setToken(token: string | null): void {
  accessToken = token;
}

function authHeaders(): Record<string, string> {
  const headers: Record<string, string> = { 'Content-Type': 'application/json' };
  if (accessToken !== null) {
    headers['Authorization'] = `Bearer ${accessToken}`;
  }
  return headers;
}

/**
 * Normalises a fetch Response into an ApiResult the UI renders directly. A 2xx
 * yields `{ ok: true, data }`; any 4xx/5xx is parsed as the §8.1 error envelope so
 * the PDP reason + decisionId survive intact to the screen. A network/parse
 * failure becomes a synthetic envelope (so the UI never throws raw).
 */
async function toResult<T>(res: Response): Promise<ApiResult<T>> {
  const text = await res.text();
  const body: unknown = text.length > 0 ? safeJson(text) : null;

  if (res.ok) {
    return { ok: true, status: res.status, data: body as T };
  }

  const envelope = body as Partial<ErrorEnvelope> | null;
  const error = envelope?.error ?? {
    code: `http_${String(res.status)}`,
    message: text.length > 0 ? text : `Request failed with status ${String(res.status)}`,
  };
  return { ok: false, status: res.status, error };
}

function safeJson(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch {
    return { error: { code: 'bad_response', message: text } };
  }
}

async function request<T>(path: string, init?: RequestInit): Promise<ApiResult<T>> {
  try {
    const res = await fetch(`${GATEWAY_URL}${path}`, {
      ...init,
      headers: { ...authHeaders(), ...(init?.headers ?? {}) },
    });
    return await toResult<T>(res);
  } catch (err) {
    return {
      ok: false,
      status: 0,
      error: {
        code: 'network_error',
        message: err instanceof Error ? err.message : 'Network request failed (is the gateway up?)',
      },
    };
  }
}

// ── Auth (public — gateway routes /v1/auth/* to identity) ────────────────────

/** Password grant via the gateway. The tenant comes from the token `tid`. */
export function login(email: string, password: string): Promise<ApiResult<TokenResponse>> {
  return request<TokenResponse>('/v1/auth/token', {
    method: 'POST',
    body: JSON.stringify({ email, password }),
  });
}

// ── Expenses (authenticated — gateway routes /v1/expenses* to the PEP) ────────

/** PDP-filtered list of expenses the caller may read (empty if denied all). */
export function listExpenses(): Promise<ApiResult<ExpensePage>> {
  return request<ExpensePage>('/v1/expenses', { method: 'GET' });
}

/**
 * Attempt to approve an expense. The PEP is the real gate: ALLOW -> 200 with the
 * decisionId; DENY -> 403 with the §8.1 envelope (reason + decisionId). The UI
 * renders whichever the server returns — it never pre-decides.
 */
export function approveExpense(id: string): Promise<ApiResult<ApproveResult>> {
  return request<ApproveResult>(`/v1/expenses/${encodeURIComponent(id)}/approve`, {
    method: 'POST',
    body: JSON.stringify({}),
  });
}

// ── Admin / PAP (authenticated — gateway routes /v1/role-assignments*) ────────

/**
 * List a user's role assignments. The gateway injects the tenant from the admin's
 * JWT, so the tenant is never client-asserted (DESIGN §8.1).
 */
export function listAssignments(userId: string): Promise<ApiResult<RoleAssignmentPage>> {
  return request<RoleAssignmentPage>(
    `/v1/role-assignments?userId=${encodeURIComponent(userId)}&limit=50`,
    { method: 'GET' },
  );
}

/** Revoke a single role assignment (drives the FR-8 dynamic-change demo). */
export function revokeAssignment(assignmentId: string): Promise<ApiResult<RoleAssignment>> {
  return request<RoleAssignment>(
    `/v1/role-assignments/${encodeURIComponent(assignmentId)}/revoke`,
    {
      method: 'POST',
      body: JSON.stringify({}),
    },
  );
}

/** Grant finance_manager (at acme.finance) to a user — re-adds a revoked grant. */
export function grantFinanceManager(userId: string): Promise<ApiResult<RoleAssignment>> {
  return request<RoleAssignment>('/v1/role-assignments', {
    method: 'POST',
    body: JSON.stringify({
      userId,
      roleId: FINANCE_MANAGER_ROLE_ID,
      scope: FINANCE_SCOPE,
    }),
  });
}

// ── Audit (authenticated — gateway routes /v1/audit* to the audit service) ────

/**
 * The latest decisions for a tenant (allow/deny + reason + decisionId). The audit
 * read endpoint scopes by `?tenantId=`; the admin passes their own tenant id.
 */
export function listAuditEvents(tenantId: string): Promise<ApiResult<AuditEventPage>> {
  return request<AuditEventPage>(
    `/v1/audit/events?tenantId=${encodeURIComponent(tenantId)}&limit=15`,
    { method: 'GET' },
  );
}
