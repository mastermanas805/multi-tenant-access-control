import { randomBytes, scrypt, timingSafeEqual } from 'node:crypto';
import { promisify } from 'node:util';

import { Injectable } from '@nestjs/common';

import { type PasswordHasher } from '../domain/password-hasher.port';
import { PasswordHash } from '../domain/value-objects/password-hash.vo';

const scryptAsync = promisify(scrypt);

/** Encoded format: `scrypt$<saltHex>$<derivedKeyHex>`. */
const PREFIX = 'scrypt';
const KEY_LENGTH = 64;
const SALT_BYTES = 16;

/**
 * Password hasher using Node's scrypt KDF (memory-hard, no external deps) with a
 * per-password random salt and constant-time comparison. The encoded hash embeds
 * the salt so verification is self-contained.
 *
 * scrypt is a reasonable, dependency-free default for a reference IdP; a
 * production system would likely tune the cost params or use argon2id — swapping
 * is a one-adapter change behind the PasswordHasher port.
 */
@Injectable()
export class ScryptPasswordHasher implements PasswordHasher {
  /** A precomputed dummy hash so absent-user verifies still do real work. */
  private readonly dummy: PasswordHash;

  constructor() {
    // Deterministic dummy (fixed salt/key) — never matches a real password but
    // makes the verify path cost the same as a real comparison.
    const salt = Buffer.alloc(SALT_BYTES, 0).toString('hex');
    const key = Buffer.alloc(KEY_LENGTH, 0).toString('hex');
    this.dummy = PasswordHash.fromEncoded(`${PREFIX}$${salt}$${key}`);
  }

  public async hash(plaintext: string): Promise<PasswordHash> {
    const salt = randomBytes(SALT_BYTES);
    const derived = (await scryptAsync(plaintext, salt, KEY_LENGTH)) as Buffer;
    return PasswordHash.fromEncoded(
      `${PREFIX}$${salt.toString('hex')}$${derived.toString('hex')}`,
    );
  }

  public async verify(plaintext: string, hash: PasswordHash): Promise<boolean> {
    const parts = hash.toString().split('$');
    if (parts.length !== 3 || parts[0] !== PREFIX) {
      return false;
    }
    const [, saltHex, keyHex] = parts as [string, string, string];
    const salt = Buffer.from(saltHex, 'hex');
    const expected = Buffer.from(keyHex, 'hex');
    const derived = (await scryptAsync(plaintext, salt, expected.length)) as Buffer;
    // Lengths always match (we derive `expected.length`); compare in constant time.
    return derived.length === expected.length && timingSafeEqual(derived, expected);
  }

  public dummyHash(): PasswordHash {
    return this.dummy;
  }
}
