import { hasRole, memberChangeProblem } from './roles.js';

describe('roles en la empresa', () => {
  it('ordena los permisos', () => {
    expect(hasRole('owner', 'accountant')).toBe(true);
    expect(hasRole('accountant', 'accountant')).toBe(true);
    expect(hasRole('accountant', 'owner')).toBe(false);
    expect(hasRole('viewer', 'accountant')).toBe(false);
  });

  it('no deja la empresa sin dueño', () => {
    expect(memberChangeProblem({ ownerCount: 1, current: 'owner', next: 'accountant' })).toBe(
      'last_owner',
    );
    expect(memberChangeProblem({ ownerCount: 1, current: 'owner', next: null })).toBe('last_owner');
    expect(memberChangeProblem({ ownerCount: 2, current: 'owner', next: null })).toBeNull();
    expect(memberChangeProblem({ ownerCount: 1, current: 'viewer', next: null })).toBeNull();
    expect(memberChangeProblem({ ownerCount: 1, current: 'owner', next: 'owner' })).toBeNull();
  });
});
