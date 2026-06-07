import { useCallback, useEffect, useState } from 'react';

import { grantFinanceManager, listAssignments, revokeAssignment } from '../api';
import { FINANCE_MANAGER_ROLE_ID, RIYA_USER_ID } from '../config';
import type { RoleAssignment } from '../types';

interface AdminProps {
  /** Called after a grant/revoke so the Expenses + decision-log panels refresh. */
  readonly onChange: () => void;
}

/**
 * Screen 3 — Admin (org_admin only; DESIGN §13). Lists Riya's role assignments and
 * lets the admin REVOKE / GRANT finance_manager through the gateway (PAP). The
 * change takes effect within seconds (FR-8) — the approve path re-resolves the
 * principal fresh, so re-trying Riya's approve flips immediately.
 */
export function Admin({ onChange }: AdminProps): JSX.Element {
  const [assignments, setAssignments] = useState<RoleAssignment[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);

  const load = useCallback(async (): Promise<void> => {
    setLoading(true);
    setError(null);
    const result = await listAssignments(RIYA_USER_ID);
    setLoading(false);
    if (result.ok) {
      setAssignments(result.data.items);
    } else {
      setError(`${result.error.code}: ${result.error.message}`);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  /** The active finance_manager grant on Riya, if any (drives REVOKE vs GRANT). */
  const financeGrant = assignments.find(
    (a) => a.roleId === FINANCE_MANAGER_ROLE_ID && a.status === 'active',
  );

  async function onRevoke(id: string): Promise<void> {
    setBusy(true);
    setNotice(null);
    const result = await revokeAssignment(id);
    setBusy(false);
    setNotice(
      result.ok
        ? "Revoked. Switch to Riya and retry an approve — it flips to 403 within seconds."
        : `Revoke failed — ${result.error.code}: ${result.error.message}`,
    );
    await load();
    onChange();
  }

  async function onGrant(): Promise<void> {
    setBusy(true);
    setNotice(null);
    const result = await grantFinanceManager(RIYA_USER_ID);
    setBusy(false);
    setNotice(
      result.ok
        ? "Granted finance_manager. Switch to Riya and retry — the $8.5k approve flips back to 200."
        : `Grant failed — ${result.error.code}: ${result.error.message}`,
    );
    await load();
    onChange();
  }

  return (
    <article data-testid="admin-screen">
      <header>
        <hgroup>
          <h2>Admin · Riya's role assignments</h2>
          <p>Grant / revoke finance_manager through the gateway (PAP).</p>
        </hgroup>
      </header>

      <p data-testid="admin-banner" className="banner">
        ⚡ Changes take effect in seconds (FR-8) — no redeploy. The approve path re-resolves the
        principal fresh, so a revoke flips the very next decision.
      </p>

      {loading && <p aria-busy="true">Loading assignments…</p>}
      {error !== null && <p data-testid="admin-error">{error}</p>}

      <table data-testid="admin-assignments-table">
        <thead>
          <tr>
            <th>Role ID</th>
            <th>Scope</th>
            <th>Status</th>
            <th>Action</th>
          </tr>
        </thead>
        <tbody>
          {assignments.map((a) => (
            <tr key={a.id} data-testid={`assignment-row-${a.id}`}>
              <td>
                <small>{a.roleId}</small>
                {a.roleId === FINANCE_MANAGER_ROLE_ID && <> (finance_manager)</>}
              </td>
              <td>{a.scope}</td>
              <td data-testid={`assignment-status-${a.id}`}>{a.status}</td>
              <td>
                {a.roleId === FINANCE_MANAGER_ROLE_ID && a.status === 'active' ? (
                  <button
                    className="secondary"
                    data-testid={`revoke-btn-${a.id}`}
                    disabled={busy}
                    aria-busy={busy}
                    onClick={() => {
                      void onRevoke(a.id);
                    }}
                  >
                    Revoke
                  </button>
                ) : (
                  <small>—</small>
                )}
              </td>
            </tr>
          ))}
          {assignments.length === 0 && !loading && (
            <tr>
              <td colSpan={4} data-testid="admin-no-assignments">
                No assignments.
              </td>
            </tr>
          )}
        </tbody>
      </table>

      <div className="grid">
        <button
          data-testid="grant-finance-manager-btn"
          disabled={busy || financeGrant !== undefined}
          aria-busy={busy}
          onClick={() => {
            void onGrant();
          }}
        >
          Grant finance_manager to Riya
        </button>
      </div>

      {notice !== null && <p data-testid="admin-notice">{notice}</p>}
    </article>
  );
}
