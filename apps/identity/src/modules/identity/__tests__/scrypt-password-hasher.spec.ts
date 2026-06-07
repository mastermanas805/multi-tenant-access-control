import { ScryptPasswordHasher } from '../infrastructure/scrypt-password-hasher';
import { PasswordHash } from '../domain/value-objects/password-hash.vo';

describe('ScryptPasswordHasher', () => {
  const hasher = new ScryptPasswordHasher();

  it('verifies a correct password and rejects a wrong one', async () => {
    const hash = await hasher.hash('Password123!');
    await expect(hasher.verify('Password123!', hash)).resolves.toBe(true);
    await expect(hasher.verify('wrong', hash)).resolves.toBe(false);
  });

  it('produces a salted, self-describing encoding (different salt each time)', async () => {
    const a = await hasher.hash('same');
    const b = await hasher.hash('same');
    expect(a.toString()).not.toBe(b.toString());
    expect(a.toString().startsWith('scrypt$')).toBe(true);
    // Both still verify against the same plaintext.
    await expect(hasher.verify('same', a)).resolves.toBe(true);
    await expect(hasher.verify('same', b)).resolves.toBe(true);
  });

  it('never matches the dummy hash (absent-user timing guard)', async () => {
    await expect(hasher.verify('anything', hasher.dummyHash())).resolves.toBe(false);
  });

  it('returns false (does not throw) for a malformed hash encoding', async () => {
    await expect(hasher.verify('x', PasswordHash.fromEncoded('garbage'))).resolves.toBe(false);
  });
});
