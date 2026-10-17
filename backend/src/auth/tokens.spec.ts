import type { ConfigService } from '@nestjs/config';
import { SignJWT } from 'jose';
import type { Env } from '../config/env.js';
import { TokenService, deriveKey, hashRefreshToken } from './tokens.js';

const SECRET = 'k'.repeat(48);
const config = { get: () => SECRET } as unknown as ConfigService<Env, true>;
const tokens = new TokenService(config);

describe('tokens', () => {
  it('firma y verifica el token de acceso', async () => {
    const jwt = await tokens.signAccess({ userId: 'u1', sessionId: 's1' });
    expect(await tokens.verifyAccess(jwt)).toMatchObject({ userId: 'u1', sessionId: 's1' });
    const expiresAt = (await tokens.verifyAccess(jwt))?.expiresAt.getTime() ?? 0;
    expect(Math.abs(expiresAt - (Date.now() + 15 * 60_000))).toBeLessThan(5000);
  });

  it('no acepta un token de registro como token de acceso, ni al revés', async () => {
    const registration = await tokens.signRegistration('+51987654321');
    expect(await tokens.verifyAccess(registration)).toBeNull();
    expect(await tokens.verifyRegistration(registration)).toBe('+51987654321');

    const access = await tokens.signAccess({ userId: 'u1', sessionId: 's1' });
    expect(await tokens.verifyRegistration(access)).toBeNull();
  });

  it('rechaza tokens firmados con otra clave o alterados', async () => {
    const other = new TokenService({ get: () => 'z'.repeat(48) } as unknown as ConfigService<
      Env,
      true
    >);
    const foreign = await other.signAccess({ userId: 'u1', sessionId: 's1' });
    expect(await tokens.verifyAccess(foreign)).toBeNull();

    const jwt = await tokens.signAccess({ userId: 'u1', sessionId: 's1' });
    const [h, , s] = jwt.split('.');
    const forgedPayload = Buffer.from(
      JSON.stringify({ sub: 'admin', sid: 's1', aud: 'contabili-api', iss: 'contabili' }),
    ).toString('base64url');
    expect(await tokens.verifyAccess(`${h}.${forgedPayload}.${s}`)).toBeNull();
    expect(await tokens.verifyAccess('basura')).toBeNull();
  });

  it('rechaza tokens vencidos', async () => {
    const key = new Uint8Array(deriveKey(SECRET, 'jwt'));
    const expired = await new SignJWT({ sid: 's1' })
      .setProtectedHeader({ alg: 'HS256' })
      .setSubject('u1')
      .setIssuer('contabili')
      .setAudience('contabili-api')
      .setIssuedAt(Math.floor(Date.now() / 1000) - 3600)
      .setExpirationTime(Math.floor(Date.now() / 1000) - 60)
      .sign(key);
    expect(await tokens.verifyAccess(expired)).toBeNull();
  });

  it('el refresh token es aleatorio y solo se guarda su hash', () => {
    const a = tokens.newRefreshToken();
    const b = tokens.newRefreshToken();
    expect(a.token).not.toBe(b.token);
    expect(a.token.length).toBeGreaterThanOrEqual(43);
    expect(a.hash).toBe(hashRefreshToken(a.token));
    expect(a.hash).toMatch(/^[0-9a-f]{64}$/);
  });

  it('la clave de los códigos es distinta de la de los JWT', () => {
    expect(tokens.otpSecret).not.toBe(SECRET);
    expect(tokens.otpSecret).not.toBe(deriveKey(SECRET, 'jwt').toString('hex'));
  });
});
