import { useState } from 'react';

import { setToken } from './api';
import { SEED_USERS } from './config';
import { Admin } from './components/Admin';
import { DecisionLog } from './components/DecisionLog';
import { Expenses } from './components/Expenses';
import { Login } from './components/Login';
import type { Session } from './types';

/**
 * The demo shell (DESIGN §13). Holds the in-memory session and a monotonically
 * increasing `refreshKey` that any mutation (approve / grant / revoke) bumps so
 * the Expenses list and the Decision-log panel re-fetch and stay consistent.
 */
export function App(): JSX.Element {
  const [session, setSession] = useState<Session | null>(null);
  const [refreshKey, setRefreshKey] = useState(0);

  function bump(): void {
    setRefreshKey((n) => n + 1);
  }

  function logout(): void {
    setToken(null);
    setSession(null);
    setRefreshKey(0);
  }

  const currentUser =
    session !== null ? SEED_USERS.find((u) => u.key === session.userKey) ?? null : null;

  return (
    <>
      <nav className="container" data-testid="app-nav">
        <ul>
          <li>
            <strong>Access Control — Demo UI</strong>
          </li>
        </ul>
        <ul>
          {session !== null && currentUser !== null && (
            <>
              <li data-testid="current-user">
                {currentUser.name} · <small>{currentUser.role}</small>
              </li>
              <li>
                <button className="secondary" data-testid="logout-btn" onClick={logout}>
                  Switch user
                </button>
              </li>
            </>
          )}
        </ul>
      </nav>

      <main className="container">
        {session === null ? (
          <Login
            onLogin={(s) => {
              setSession(s);
              bump();
            }}
          />
        ) : (
          <div data-testid="app-authenticated">
            <Expenses refreshKey={refreshKey} onDecision={bump} />
            {currentUser?.isAdmin === true && <Admin onChange={bump} />}
            <DecisionLog tenantId={session.tenantId} refreshKey={refreshKey} />
          </div>
        )}
      </main>

      <footer className="container">
        <small>
          A thin client to the API Gateway that never makes authz decisions — it only reflects them.
          UI hiding is UX, not security; the PEP/PDP is the real gate.
        </small>
      </footer>
    </>
  );
}
