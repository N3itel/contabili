import { rateLimitKey } from './client-ip.js';

describe('clave de límite por IP', () => {
  it('IPv4 tal cual, también si viene mapeada en IPv6', () => {
    expect(rateLimitKey('190.42.10.7')).toBe('190.42.10.7');
    expect(rateLimitKey('::ffff:190.42.10.7')).toBe('190.42.10.7');
  });

  it('IPv6 agrupada por su /64', () => {
    expect(rateLimitKey('2800:200:e840:1a2b:1111:2222:3333:4444')).toBe('2800:200:e840:1a2b::/64');
    expect(rateLimitKey('2800:200:e840:1a2b::9')).toBe('2800:200:e840:1a2b::/64');
    expect(rateLimitKey('2800:0200:e840:1a2b:ffff::1')).toBe('2800:200:e840:1a2b::/64');
  });
});
