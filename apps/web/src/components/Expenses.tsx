import { useCallback, useEffect, useState } from 'react';

import { approveExpense, listExpenses } from '../api';
import { DEMO_EXPENSE_IDS } from '../config';
import type { ApproveResult, ErrorEnvelope, Expense } from '../types';

interface ExpensesProps {
  /** Bumped by the parent after a grant/revoke so the list + results refresh. */
  readonly refreshKey: number;
  /** Called after any approve attempt so the decision-log panel can refresh. */
  readonly onDecision: () => void;
}

/** Per-row outcome of an approve attempt — exactly what the server returned. */
type ApproveOutcome =
  | { readonly kind: 'allow'; readonly result: ApproveResult }
  | { readonly kind: 'deny'; readonly status: number; readonly error: ErrorEnvelope['error'] };

/** A row we render: either a real listed expense, or a known demo id we couldn't read. */
interface Row {
  readonly id: string;
  readonly expense: Expense | null;
}

function fmtAmount(e: Expense): string {
  return `${e.currency} ${e.amount.toLocaleString()}`;
}

/**
 * Screen 2 — Expenses (DESIGN §13). Lists what the caller may READ (PDP-filtered)
 * and renders an Approve button on every row. CRITICAL: we deliberately DO NOT
 * hide Approve for users who will be denied — we render it and show the server's
 * 403 + PDP reason. Hiding a button is UX, not security; the PEP is the real gate.
 */
export function Expenses({ refreshKey, onDecision }: ExpensesProps): JSX.Element {
  const [rows, setRows] = useState<Row[]>([]);
  const [loading, setLoading] = useState(true);
  const [listError, setListError] = useState<string | null>(null);
  const [pendingId, setPendingId] = useState<string | null>(null);
  const [outcomes, setOutcomes] = useState<Record<string, ApproveOutcome>>({});

  const load = useCallback(async (): Promise<void> => {
    setLoading(true);
    setListError(null);
    const result = await listExpenses();
    setLoading(false);

    const byId = new Map<string, Expense>();
    if (result.ok) {
      for (const e of result.data.items) {
        byId.set(e.id, e);
      }
    } else {
      setListError(`${result.error.code}: ${result.error.message}`);
    }

    // Union of the readable expenses and the canonical demo ids, so a denied user
    // (whose readable list is empty) STILL sees Approve buttons to attempt — that
    // is the whole point of the §13 security note.
    const ids = new Set<string>([...byId.keys(), ...DEMO_EXPENSE_IDS]);
    const merged: Row[] = [...ids].sort().map((id) => ({ id, expense: byId.get(id) ?? null }));
    setRows(merged);
  }, []);

  useEffect(() => {
    void load();
    // Re-load when an admin grant/revoke happened (refreshKey changes).
  }, [load, refreshKey]);

  async function onApprove(id: string): Promise<void> {
    setPendingId(id);
    const result = await approveExpense(id);
    setPendingId(null);

    setOutcomes((prev) => ({
      ...prev,
      [id]: result.ok
        ? { kind: 'allow', result: result.data }
        : { kind: 'deny', status: result.status, error: result.error },
    }));
    onDecision();
  }

  return (
    <article data-testid="expenses-screen">
      <header>
        <hgroup>
          <h2>Expenses</h2>
          <p>
            Every row has an Approve button — even ones you cannot approve. The server (PEP) decides;
            the UI only reflects the 200 or 403.
          </p>
        </hgroup>
      </header>

      {loading && <p aria-busy="true">Loading expenses…</p>}

      {listError !== null && (
        <p data-testid="expenses-list-error">
          <small>
            List was filtered/denied by the PDP ({listError}). The known demo expenses are still
            shown below so you can attempt an approve.
          </small>
        </p>
      )}

      <table data-testid="expenses-table">
        <thead>
          <tr>
            <th>ID</th>
            <th>Amount</th>
            <th>Dept</th>
            <th>Status</th>
            <th>Action</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => {
            const outcome = outcomes[row.id];
            return (
              <tr key={row.id} data-testid={`expense-row-${row.id}`}>
                <td data-testid={`expense-id-${row.id}`}>{row.id}</td>
                <td data-testid={`expense-amount-${row.id}`}>
                  {row.expense !== null ? fmtAmount(row.expense) : '—'}
                </td>
                <td>{row.expense?.department ?? '—'}</td>
                <td data-testid={`expense-status-${row.id}`}>{row.expense?.status ?? 'not readable'}</td>
                <td>
                  <button
                    data-testid={`approve-btn-${row.id}`}
                    aria-busy={pendingId === row.id}
                    disabled={pendingId !== null}
                    onClick={() => {
                      void onApprove(row.id);
                    }}
                  >
                    Approve
                  </button>
                  {outcome !== undefined && <Outcome id={row.id} outcome={outcome} />}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </article>
  );
}

/** Renders the server's verdict inline: the ALLOW success or the DENY envelope. */
function Outcome({ id, outcome }: { id: string; outcome: ApproveOutcome }): JSX.Element {
  if (outcome.kind === 'allow') {
    return (
      <div data-testid={`approve-success-${id}`} className="outcome allow">
        <ins>✓ Approved (200)</ins>
        <br />
        <small data-testid={`approve-decision-${id}`}>decisionId: {outcome.result.decisionId}</small>
        {' · '}
        <small>by {outcome.result.approvedBy}</small>
      </div>
    );
  }
  return (
    <div data-testid={`approve-denied-${id}`} className="outcome deny">
      <del>✗ Denied ({outcome.status})</del>
      <br />
      <small data-testid={`approve-reason-${id}`}>reason: {outcome.error.reason ?? outcome.error.message}</small>
      {outcome.error.decisionId !== undefined && (
        <>
          {' · '}
          <small data-testid={`approve-denied-decision-${id}`}>
            decisionId: {outcome.error.decisionId}
          </small>
        </>
      )}
    </div>
  );
}
