/**
 * Wire types mirroring the backend contracts (packages/contracts). Kept local
 * because the SPA is a browser bundle and cannot import the Node workspace
 * packages; these shapes match apps/{identity,expense,authz-admin,audit} DTOs.
 */

/** DESIGN §8.1 error envelope — EVERY 4xx/5xx response uses this exact shape. */
export interface ErrorEnvelope {
  readonly error: {
    readonly code: string;
    readonly message: string;
    readonly reason?: string;
    readonly decisionId?: string;
    readonly traceId?: string;
  };
}

/** POST /v1/auth/token success (identity TokenResponse). */
export interface TokenResponse {
  readonly accessToken: string;
  readonly refreshToken: string;
  readonly tokenType: string;
  readonly expiresIn: number;
  readonly sub: string;
  readonly tid: string;
  readonly sid: string;
}

/** A single expense (expense ExpenseResponse). */
export interface Expense {
  readonly id: string;
  readonly tenantId: string;
  readonly amount: number;
  readonly currency: string;
  readonly department: string;
  readonly ownerId: string;
  readonly status: 'pending' | 'approved' | 'rejected';
  readonly description: string;
  readonly createdAt: string;
  readonly updatedAt: string;
}

export interface ExpensePage {
  readonly items: Expense[];
  readonly nextCursor: string | null;
}

/** POST /v1/expenses/:id/approve success (expense ApproveExpenseResponseDto). */
export interface ApproveResult {
  readonly id: string;
  readonly status: 'pending' | 'approved' | 'rejected';
  readonly approvedBy: string;
  readonly decisionId: string;
  readonly at: string;
}

/** A role assignment (authz-admin RoleAssignmentResponse). */
export interface RoleAssignment {
  readonly id: string;
  readonly tenantId: string;
  readonly userId: string;
  readonly roleId: string;
  readonly scope: string;
  readonly status: string;
  readonly validUntil: string | null;
  readonly delegatedBy: string | null;
  readonly version: number;
  readonly createdAt: string;
  readonly updatedAt: string;
}

export interface RoleAssignmentPage {
  readonly items: RoleAssignment[];
  readonly nextCursor: string | null;
  readonly hasMore: boolean;
}

/** A recorded audit/decision event (audit AuditEventResponse). */
export interface AuditEvent {
  readonly id: string;
  readonly seq: number;
  readonly tenantId: string;
  readonly actor: string;
  readonly action: string;
  readonly decision: 'ALLOW' | 'DENY' | 'N/A';
  readonly resourceKind: string;
  readonly resourceId: string;
  readonly reason: string | null;
  readonly policy: string | null;
  readonly decisionId: string | null;
  readonly traceId: string | null;
  readonly occurredAt: string;
  readonly recordedAt: string;
  readonly prevHash: string;
  readonly recordHash: string;
}

export interface AuditEventPage {
  readonly items: AuditEvent[];
  readonly nextCursor: string | null;
  readonly hasMore: boolean;
}

/** The result of an HTTP call the UI renders: either an ok body or an envelope. */
export type ApiResult<T> =
  | { readonly ok: true; readonly status: number; readonly data: T }
  | { readonly ok: false; readonly status: number; readonly error: ErrorEnvelope['error'] };

/** The authenticated session — the JWT lives in memory only (see api.ts note). */
export interface Session {
  readonly token: string;
  readonly tenantId: string;
  readonly userId: string;
  readonly userKey: 'riya' | 'sam' | 'dev';
}
