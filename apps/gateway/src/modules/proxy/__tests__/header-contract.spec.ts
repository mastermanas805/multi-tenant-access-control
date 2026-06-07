import { IdentityContextMiddleware } from '@authz/pep';

import { INTERNAL_IDENTITY_HEADER } from '../domain/forwarded-headers';

/**
 * Contract guard: the header the gateway WRITES must equal the header the
 * downstream PEP READS. If @authz/pep ever renames TOKEN_HEADER, this fails and
 * forces the gateway to follow — the two are a single wire contract (DESIGN §7).
 */
describe('internal-identity header contract with @authz/pep', () => {
  it('matches IdentityContextMiddleware.TOKEN_HEADER', () => {
    expect(INTERNAL_IDENTITY_HEADER).toBe(IdentityContextMiddleware.TOKEN_HEADER);
  });
});
