import { useCallback, useEffect, useState } from 'react';

import { listAuditEvents } from '../api';
import type { AuditEvent } from '../types';

interface DecisionLogProps {
  /** The tenant whose decisions to show (the logged-in user's tenant). */
  readonly tenantId: string;
  /** Bumped by the parent after each approve/grant/revoke to trigger a refresh. */
  readonly refreshKey: number;
}

/**
 * Screen 4 — Decision-log panel (DESIGN §13). Shows the latest decisions
 * (allow/deny + reason + decisionId) read from the audit service THROUGH the
 * gateway. Mirrors the tamper-evident audit log / decision explainer.
 */
export function DecisionLog({ tenantId, refreshKey }: DecisionLogProps): JSX.Element {
  const [events, setEvents] = useState<AuditEvent[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async (): Promise<void> => {
    setLoading(true);
    setError(null);
    const result = await listAuditEvents(tenantId);
    setLoading(false);
    if (result.ok) {
      setEvents(result.data.items);
    } else {
      setError(`${result.error.code}: ${result.error.message}`);
    }
  }, [tenantId]);

  useEffect(() => {
    void load();
  }, [load, refreshKey]);

  return (
    <article data-testid="decision-log-panel">
      <header>
        <hgroup>
          <h2>Decision log</h2>
          <p>Latest authorization decisions (allow / deny + reason + decisionId).</p>
        </hgroup>
        <button
          className="outline"
          data-testid="decision-log-refresh"
          aria-busy={loading}
          onClick={() => {
            void load();
          }}
        >
          Refresh
        </button>
      </header>

      {error !== null && <p data-testid="decision-log-error">{error}</p>}
      {!loading && events.length === 0 && error === null && (
        <p data-testid="decision-log-empty">No decisions recorded yet.</p>
      )}

      <table data-testid="decision-log-table">
        <thead>
          <tr>
            <th>Decision</th>
            <th>Action</th>
            <th>Resource</th>
            <th>Reason</th>
            <th>decisionId</th>
          </tr>
        </thead>
        <tbody>
          {events.map((e) => (
            <tr key={e.id} data-testid={`decision-row-${e.seq}`}>
              <td>
                <span data-testid={`decision-effect-${e.seq}`} className={`badge ${e.decision}`}>
                  {e.decision}
                </span>
              </td>
              <td>{e.action}</td>
              <td>
                <small>
                  {e.resourceKind}/{e.resourceId}
                </small>
              </td>
              <td data-testid={`decision-reason-${e.seq}`}>
                <small>{e.reason ?? '—'}</small>
              </td>
              <td data-testid={`decision-id-${e.seq}`}>
                <small>{e.decisionId ?? '—'}</small>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </article>
  );
}
