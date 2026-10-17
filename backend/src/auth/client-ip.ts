import { isIP } from 'node:net';

/**
 * Clave para los topes por IP. Las direcciones IPv6 se agrupan por su prefijo
 * /64: cada cliente suele tener un bloque entero y podría rotar direcciones.
 */
export function rateLimitKey(ip: string): string {
  const mapped = /^::ffff:(\d+\.\d+\.\d+\.\d+)$/i.exec(ip);
  if (mapped) return mapped[1];
  if (isIP(ip) !== 6) return ip;
  return `${expandIpv6(ip).slice(0, 4).join(':')}::/64`;
}

function expandIpv6(ip: string): string[] {
  const [head, tail = ''] = ip.toLowerCase().split('::');
  const left = head ? head.split(':') : [];
  const right = tail ? tail.split(':') : [];
  const zeros = Array<string>(8 - left.length - right.length).fill('0');
  return [...left, ...(ip.includes('::') ? zeros : []), ...right].map((g) =>
    g.replace(/^0+(?=.)/, ''),
  );
}
