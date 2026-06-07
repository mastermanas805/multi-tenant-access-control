/**
 * The verified end-user identity the gateway derived from a cryptographically
 * validated user JWT (DESIGN §4.3 step 1, §5). It carries IDENTITY + TENANT only
 * — NO roles/permissions (D4): downstream PEPs resolve effective permissions
 * per-request from the PIP. This is the ONLY trusted source of who-the-caller-is;
 * the gateway re-derives it from the JWT on EVERY request and overwrites any
 * client-sent identity headers (confused-deputy defense, DESIGN §7).
 */
export interface GatewayIdentity {
  /** End-user subject — the verified JWT `sub` claim (the principal id). */
  readonly sub: string;
  /** Active tenant context — the verified JWT `tid` claim (never client-set). */
  readonly tid: string;
  /** Session id — the verified JWT `sid` claim; links a decision to a session. */
  readonly sessionId: string;
  /**
   * The acting caller — the JWT `act` claim, falling back to `sub` for a direct
   * user-initiated login (DESIGN §7 token-exchange semantics).
   */
  readonly actorId: string;
}
