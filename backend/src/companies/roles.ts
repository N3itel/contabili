import type { memberRole } from '../db/schema/index.js';

export type MemberRole = (typeof memberRole.enumValues)[number];

const RANK: Readonly<Record<MemberRole, number>> = { viewer: 0, accountant: 1, owner: 2 };

/** `owner` puede todo lo de `accountant`, y este todo lo de `viewer`. */
export function hasRole(role: MemberRole, min: MemberRole): boolean {
  return RANK[role] >= RANK[min];
}

/** Las invitaciones vencen a los 7 días sin respuesta. */
export const INVITATION_TTL_DAYS = 7;
/** Tope de invitaciones pendientes por empresa. */
export const MAX_PENDING_INVITATIONS = 20;

/**
 * Cambiar el rol de alguien o sacarlo de la empresa (`next` = null) no puede
 * dejarla sin dueño. La base lo vuelve a revisar al confirmar.
 */
export function memberChangeProblem(input: {
  ownerCount: number;
  current: MemberRole;
  next: MemberRole | null;
}): 'last_owner' | null {
  const losesOwner = input.current === 'owner' && input.next !== 'owner';
  return losesOwner && input.ownerCount <= 1 ? 'last_owner' : null;
}
