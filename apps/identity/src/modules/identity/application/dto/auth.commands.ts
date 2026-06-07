/**
 * Application-layer command inputs. Plain data shapes (no framework decorators)
 * handed from the controller to the use-cases. HTTP-facing validation lives on
 * the presentation request DTOs.
 */

/** OIDC password grant: authenticate by email + password. */
export interface IssueTokenCommand {
  email: string;
  password: string;
}

/** OIDC refresh grant: exchange a refresh token for a new token pair. */
export interface RefreshTokenCommand {
  refreshToken: string;
}
