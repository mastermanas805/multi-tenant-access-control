/**
 * Command to authenticate an inbound request: the raw `Authorization` header
 * value. The use-case parses it (BearerToken VO), verifies the JWT and derives
 * the trusted identity. Transport details (Express Request) stay in presentation.
 */
export interface AuthenticateRequestCommand {
  readonly authorizationHeader: string | undefined;
}
