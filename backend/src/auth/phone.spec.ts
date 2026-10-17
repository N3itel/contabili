import { maskPhone, normalizePeruMobile } from './phone.js';

describe('celulares peruanos', () => {
  it.each([
    ['987654321', '+51987654321'],
    ['987 654 321', '+51987654321'],
    ['+51 987-654-321', '+51987654321'],
    ['51987654321', '+51987654321'],
    ['0051987654321', '+51987654321'],
    ['(+51) 987.654.321', '+51987654321'],
  ])('%s → %s', (input, expected) => {
    expect(normalizePeruMobile(input)).toBe(expected);
  });

  it.each(['887654321', '98765432', '9876543210', '+52987654321', '', 'hola', '01 4567890'])(
    'rechaza %j',
    (input) => {
      expect(normalizePeruMobile(input)).toBeNull();
    },
  );
});

describe('máscara', () => {
  it('oculta el medio del número', () => {
    expect(maskPhone('+51987654321')).toBe('+51 9•• ••• 321');
    expect(maskPhone('+393331234567')).toBe('+39 3•• ••• 567');
  });
});
