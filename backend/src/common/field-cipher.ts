import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto';

/**
 * Cifra campos sensibles (como el token del proveedor de facturación) con
 * AES-256-GCM. Se guarda «v1:<iv>:<etiqueta>:<cifrado>» en base64url; si
 * alguien cambia un byte, descifrar falla en vez de devolver basura.
 */
export class FieldCipher {
  constructor(private readonly key: Buffer) {
    if (key.length !== 32) throw new Error('La llave de cifrado tiene que tener 32 bytes.');
  }

  encrypt(plain: string): string {
    const iv = randomBytes(12);
    const cipher = createCipheriv('aes-256-gcm', this.key, iv);
    const data = Buffer.concat([cipher.update(plain, 'utf8'), cipher.final()]);
    const tag = cipher.getAuthTag();
    return ['v1', iv, tag, data]
      .map((p) => (typeof p === 'string' ? p : p.toString('base64url')))
      .join(':');
  }

  decrypt(stored: string): string {
    const [version, iv, tag, data] = stored.split(':');
    if (version !== 'v1' || !iv || !tag || data === undefined)
      throw new Error('Campo cifrado inválido.');
    const decipher = createDecipheriv('aes-256-gcm', this.key, Buffer.from(iv, 'base64url'));
    decipher.setAuthTag(Buffer.from(tag, 'base64url'));
    return Buffer.concat([
      decipher.update(Buffer.from(data, 'base64url')),
      decipher.final(),
    ]).toString('utf8');
  }
}
