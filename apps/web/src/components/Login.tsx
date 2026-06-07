import { useState } from 'react';

import { login, setToken } from '../api';
import { SEED_USERS, type SeedUser } from '../config';
import type { Session } from '../types';

interface LoginProps {
  readonly onLogin: (session: Session) => void;
}

/**
 * Screen 1 — Login / user switch (DESIGN §13). Pick a seeded user and acquire a
 * real RS256 JWT via the gateway. The token is kept IN MEMORY only (see api.ts).
 */
export function Login({ onLogin }: LoginProps): JSX.Element {
  const [pending, setPending] = useState<SeedUser['key'] | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function pick(user: SeedUser): Promise<void> {
    setPending(user.key);
    setError(null);
    const result = await login(user.email, user.password);
    setPending(null);

    if (!result.ok) {
      setError(`${result.error.code}: ${result.error.message}`);
      return;
    }

    setToken(result.data.accessToken);
    onLogin({
      token: result.data.accessToken,
      tenantId: result.data.tid,
      userId: result.data.sub,
      userKey: user.key,
    });
  }

  return (
    <article data-testid="login-screen">
      <header>
        <hgroup>
          <h2>Sign in</h2>
          <p>Pick a seeded user. We call the gateway POST /v1/auth/token for a real JWT.</p>
        </hgroup>
      </header>

      <div className="grid">
        {SEED_USERS.map((user) => (
          <button
            key={user.key}
            data-testid={`login-as-${user.key}`}
            aria-busy={pending === user.key}
            disabled={pending !== null}
            onClick={() => {
              void pick(user);
            }}
          >
            <strong>{user.name}</strong>
            <br />
            <small data-testid={`login-role-${user.key}`}>{user.role}</small>
          </button>
        ))}
      </div>

      {error !== null && (
        <p data-testid="login-error" style={{ color: 'var(--pico-color-red-500, #c0392b)' }}>
          {error}
        </p>
      )}

      <footer>
        <small>
          The JWT is stored in JS memory only (never localStorage) so an XSS cannot exfiltrate a
          persisted token. Refreshing the page logs you out by design.
        </small>
      </footer>
    </article>
  );
}
