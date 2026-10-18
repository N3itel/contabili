import { randomBytes } from 'node:crypto';
import { FieldCipher } from './field-cipher.js';

describe('cifrado de campos', () => {
  const cipher = new FieldCipher(randomBytes(32));

  it('cifra y descifra; cada vez con otro resultado', () => {
    const a = cipher.encrypt('token-secreto');
    const b = cipher.encrypt('token-secreto');
    expect(a).not.toBe(b);
    expect(a).not.toContain('token-secreto');
    expect(cipher.decrypt(a)).toBe('token-secreto');
  });

  it('rechaza un valor alterado o con otra llave', () => {
    const stored = cipher.encrypt('token-secreto');
    const parts = stored.split(':');
    const data = Buffer.from(parts[3], 'base64url');
    data[0] ^= 1;
    parts[3] = data.toString('base64url');
    expect(() => cipher.decrypt(parts.join(':'))).toThrow();
    expect(() => new FieldCipher(randomBytes(32)).decrypt(stored)).toThrow();
    expect(() => cipher.decrypt('basura')).toThrow();
  });

  it('exige una llave de 32 bytes', () => {
    expect(() => new FieldCipher(randomBytes(16))).toThrow();
  });
});
