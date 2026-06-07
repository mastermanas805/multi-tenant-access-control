import { UnauthenticatedError } from '@kernel/core';

import { BearerToken } from '../domain/value-objects/bearer-token.vo';

describe('BearerToken VO', () => {
  it('parses a well-formed Bearer header (case-insensitive scheme)', () => {
    const token = BearerToken.fromAuthorizationHeader('Bearer aaa.bbb.ccc');
    expect(token.toString()).toBe('aaa.bbb.ccc');
    expect(BearerToken.fromAuthorizationHeader('bearer aaa.bbb.ccc').toString()).toBe('aaa.bbb.ccc');
  });

  it('rejects a missing header with a GENERIC 401 (no auth oracle)', () => {
    expect(() => BearerToken.fromAuthorizationHeader(undefined)).toThrow(UnauthenticatedError);
    expect(() => BearerToken.fromAuthorizationHeader('')).toThrow(UnauthenticatedError);
  });

  it('rejects a non-Bearer scheme', () => {
    expect(() => BearerToken.fromAuthorizationHeader('Basic abc')).toThrow(UnauthenticatedError);
  });

  it('rejects a token that is not a 3-segment compact JWS', () => {
    expect(() => BearerToken.fromAuthorizationHeader('Bearer not-a-jwt')).toThrow(
      UnauthenticatedError,
    );
    expect(() => BearerToken.fromAuthorizationHeader('Bearer a.b')).toThrow(UnauthenticatedError);
    expect(() => BearerToken.fromAuthorizationHeader('Bearer a..c')).toThrow(UnauthenticatedError);
  });
});
