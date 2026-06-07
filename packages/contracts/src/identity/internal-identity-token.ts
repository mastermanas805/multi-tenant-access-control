/**
 * The signed INTERNAL identity token the API gateway mints after validating the
 * end-user JWT (DESIGN §4.3 step 1, §5, §7). It is what travels across the mTLS
 * mesh on every internal hop and is what each callee's PEP re-authorizes against
 * — never a forgeable plaintext header (DESIGN §7, confused-deputy defense).
 *
 * It carries IDENTITY + TENANT only — NO permissions/roles (DESIGN §5, D4): the
 * PEP resolves the principal's effective roles/attrs per-request from the PIP, so
 * a revocation is enforced within the staleness bound rather than waiting on
 * token expiry.
 */
export interface InternalIdentityToken {
  /** End-user subject — the verified JWT `sub` claim (the principal id). */
  readonly sub: string;
  /**
   * Active tenant context — the verified JWT `tid` claim, set by the IdP and
   * NEVER client-settable (DESIGN §5, §6). One token = one active tenant context.
   */
  readonly tid: string;
  /**
   * The authenticated CALLER acting on the principal's behalf. For a direct
   * user-initiated call this equals `sub`; for a system-initiated chain it is the
   * constrained service identity (DESIGN §7, the `act` claim semantics). Used to
   * stamp audit attributes server-side so the caller cannot forge "who did this".
   */
  readonly actorId: string;
  /** End-user session id — the verified JWT `sid` claim; links a decision to a session. */
  readonly sessionId: string;
}
