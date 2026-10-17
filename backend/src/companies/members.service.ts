import { HttpStatus, Inject, Injectable } from '@nestjs/common';
import { and, asc, count, eq, gt, sql } from 'drizzle-orm';
import { maskPhone, normalizePeruMobile } from '../auth/phone.js';
import { audit } from '../common/audit.js';
import { apiError } from '../common/http.js';
import { uniqueViolation } from '../common/pg.js';
import { DRIZZLE, type Database } from '../db/db.module.js';
import { companies, companyInvitations, companyMembers, users } from '../db/schema/index.js';
import { assertLicenseActive, CompanyAccess, memberRoom, planFull } from './company-access.js';
import {
  INVITATION_TTL_DAYS,
  MAX_PENDING_INVITATIONS,
  memberChangeProblem,
  type MemberRole,
} from './roles.js';

type Tx = Parameters<Parameters<Database['transaction']>[0]>[0];

export interface MemberDto {
  userId: string;
  fullName: string;
  /** Enmascarado: basta para reconocer a la persona. */
  phone: string;
  role: MemberRole;
}

const memberNotFound = () =>
  apiError(HttpStatus.NOT_FOUND, 'member_not_found', 'Esa persona no es parte de la empresa.');

const invitationNotFound = () =>
  apiError(HttpStatus.NOT_FOUND, 'invitation_not_found', 'La invitación ya no está disponible.');

@Injectable()
export class MembersService {
  constructor(
    @Inject(DRIZZLE) private readonly db: Database,
    @Inject(CompanyAccess) private readonly access: CompanyAccess,
  ) {}

  async list(companyId: string, actorId: string): Promise<MemberDto[]> {
    await this.access.require(companyId, actorId, 'viewer');
    const rows = await this.db
      .select({
        userId: companyMembers.userId,
        fullName: users.fullName,
        phone: users.phone,
        role: companyMembers.role,
      })
      .from(companyMembers)
      .innerJoin(users, eq(users.id, companyMembers.userId))
      .where(eq(companyMembers.companyId, companyId))
      .orderBy(asc(users.fullName));
    return rows.map((r) => ({ ...r, phone: maskPhone(r.phone) }));
  }

  /** Solo el dueño cambia roles, y nunca deja la empresa sin dueño. */
  async changeRole(
    companyId: string,
    actorId: string,
    userId: string,
    role: MemberRole,
  ): Promise<void> {
    await this.access.require(companyId, actorId, 'owner');
    await this.db.transaction(async (tx) => {
      const current = await this.lockMember(tx, companyId, userId);
      if (current.role === role) return;
      await this.assertKeepsOwner(tx, companyId, current.role, role);
      await tx
        .update(companyMembers)
        .set({ role })
        .where(and(eq(companyMembers.companyId, companyId), eq(companyMembers.userId, userId)));
      await audit(tx, {
        actorId,
        action: 'member.role_changed',
        entity: 'company',
        entityId: companyId,
        data: { userId, from: current.role, to: role },
      });
    });
  }

  /** El dueño saca a cualquiera; cada persona puede salir por su cuenta. */
  async remove(companyId: string, actorId: string, userId: string): Promise<void> {
    await this.access.require(companyId, actorId, actorId === userId ? 'viewer' : 'owner');
    await this.db.transaction(async (tx) => {
      const current = await this.lockMember(tx, companyId, userId);
      await this.assertKeepsOwner(tx, companyId, current.role, null);
      await tx
        .delete(companyMembers)
        .where(and(eq(companyMembers.companyId, companyId), eq(companyMembers.userId, userId)));
      await audit(tx, {
        actorId,
        action: actorId === userId ? 'member.left' : 'member.removed',
        entity: 'company',
        entityId: companyId,
        data: { userId, role: current.role },
      });
    });
  }

  /**
   * Invita a un celular. La respuesta no dice si ese número ya tiene cuenta:
   * la persona verá la invitación cuando ingrese con él.
   */
  async invite(companyId: string, actorId: string, phoneInput: string, role: MemberRole) {
    await this.access.requireWritable(companyId, actorId, 'owner');
    const phone = normalizePeruMobile(phoneInput);
    if (!phone) {
      throw apiError(
        HttpStatus.BAD_REQUEST,
        'invalid_phone',
        'Ingresa un celular peruano de 9 dígitos.',
      );
    }
    const now = new Date();
    return this.db.transaction(async (tx) => {
      await this.lockCompany(tx, companyId);
      const [member] = await tx
        .select({ userId: companyMembers.userId })
        .from(companyMembers)
        .innerJoin(users, eq(users.id, companyMembers.userId))
        .where(and(eq(companyMembers.companyId, companyId), eq(users.phone, phone)));
      if (member) {
        throw apiError(
          HttpStatus.CONFLICT,
          'already_member',
          'Esa persona ya es parte de la empresa.',
        );
      }
      // Las vencidas se cierran aquí para no ocupar el cupo.
      await tx
        .update(companyInvitations)
        .set({ status: 'expired', resolvedAt: now })
        .where(
          and(
            eq(companyInvitations.companyId, companyId),
            eq(companyInvitations.status, 'pending'),
            sql`${companyInvitations.expiresAt} <= ${now}`,
          ),
        );
      const [pending] = await tx
        .select({ n: count() })
        .from(companyInvitations)
        .where(
          and(
            eq(companyInvitations.companyId, companyId),
            eq(companyInvitations.status, 'pending'),
          ),
        );
      // Las invitaciones pendientes también ocupan lugar en el plan.
      const room = await memberRoom(tx, companyId, await assertLicenseActive(tx, companyId));
      if (room.members + pending.n >= room.max) throw planFull(room.max);
      if (pending.n >= MAX_PENDING_INVITATIONS) {
        throw apiError(
          HttpStatus.TOO_MANY_REQUESTS,
          'too_many_invitations',
          `Hay ${MAX_PENDING_INVITATIONS} invitaciones pendientes. Revoca alguna antes de invitar a otra persona.`,
        );
      }
      try {
        const [invitation] = await tx
          .insert(companyInvitations)
          .values({
            companyId,
            phone,
            role,
            invitedBy: actorId,
            expiresAt: new Date(now.getTime() + INVITATION_TTL_DAYS * 86_400_000),
          })
          .returning({
            id: companyInvitations.id,
            role: companyInvitations.role,
            expiresAt: companyInvitations.expiresAt,
          });
        await audit(tx, {
          actorId,
          action: 'invitation.created',
          entity: 'company',
          entityId: companyId,
          data: { invitationId: invitation.id, role },
        });
        return { ...invitation, phone: maskPhone(phone) };
      } catch (error) {
        if (uniqueViolation(error) === 'company_invitations_pending_uq') {
          throw apiError(
            HttpStatus.CONFLICT,
            'already_invited',
            'Ya hay una invitación pendiente para ese celular.',
          );
        }
        throw error;
      }
    });
  }

  async pendingInvitations(companyId: string, actorId: string) {
    await this.access.require(companyId, actorId, 'owner');
    const rows = await this.db
      .select({
        id: companyInvitations.id,
        phone: companyInvitations.phone,
        role: companyInvitations.role,
        expiresAt: companyInvitations.expiresAt,
      })
      .from(companyInvitations)
      .where(
        and(
          eq(companyInvitations.companyId, companyId),
          eq(companyInvitations.status, 'pending'),
          gt(companyInvitations.expiresAt, new Date()),
        ),
      )
      .orderBy(asc(companyInvitations.createdAt));
    return rows.map((r) => ({ ...r, phone: maskPhone(r.phone) }));
  }

  async revokeInvitation(companyId: string, actorId: string, invitationId: string): Promise<void> {
    await this.access.require(companyId, actorId, 'owner');
    await this.db.transaction(async (tx) => {
      const [revoked] = await tx
        .update(companyInvitations)
        .set({ status: 'revoked', resolvedBy: actorId, resolvedAt: new Date() })
        .where(
          and(
            eq(companyInvitations.id, invitationId),
            eq(companyInvitations.companyId, companyId),
            eq(companyInvitations.status, 'pending'),
          ),
        )
        .returning({ id: companyInvitations.id });
      if (!revoked) throw invitationNotFound();
      await audit(tx, {
        actorId,
        action: 'invitation.revoked',
        entity: 'company',
        entityId: companyId,
        data: { invitationId },
      });
    });
  }

  /** Invitaciones pendientes al celular de quien consulta. */
  async myInvitations(userId: string) {
    return this.db
      .select({
        id: companyInvitations.id,
        companyId: companies.id,
        legalName: companies.legalName,
        ruc: companies.ruc,
        role: companyInvitations.role,
        invitedBy: sql<string>`(select full_name from users where id = ${companyInvitations.invitedBy})`,
        expiresAt: companyInvitations.expiresAt,
      })
      .from(companyInvitations)
      .innerJoin(users, eq(users.phone, companyInvitations.phone))
      .innerJoin(companies, eq(companies.id, companyInvitations.companyId))
      .where(
        and(
          eq(users.id, userId),
          eq(companyInvitations.status, 'pending'),
          gt(companyInvitations.expiresAt, new Date()),
        ),
      )
      .orderBy(asc(companyInvitations.createdAt));
  }

  /** Acepta o rechaza una invitación a tu propio celular. */
  async respond(userId: string, invitationId: string, accept: boolean) {
    const now = new Date();
    return this.db.transaction(async (tx) => {
      // Primero la empresa, como al invitar: así dos transacciones nunca se esperan en cruz.
      const [target] = await tx
        .select({ companyId: companyInvitations.companyId })
        .from(companyInvitations)
        .where(eq(companyInvitations.id, invitationId));
      if (!target) throw invitationNotFound();
      await this.lockCompany(tx, target.companyId);
      const [resolved] = await tx
        .update(companyInvitations)
        .set({ status: accept ? 'accepted' : 'declined', resolvedBy: userId, resolvedAt: now })
        .where(
          and(
            eq(companyInvitations.id, invitationId),
            eq(companyInvitations.status, 'pending'),
            gt(companyInvitations.expiresAt, now),
            sql`${companyInvitations.phone} = (select phone from users where id = ${userId})`,
          ),
        )
        .returning({ companyId: companyInvitations.companyId, role: companyInvitations.role });
      if (!resolved) throw invitationNotFound();
      if (accept) {
        const room = await memberRoom(
          tx,
          resolved.companyId,
          await assertLicenseActive(tx, resolved.companyId),
        );
        if (room.members >= room.max) throw planFull(room.max);
        // Si ya era parte (entró por otra invitación), conserva su rol.
        await tx
          .insert(companyMembers)
          .values({ companyId: resolved.companyId, userId, role: resolved.role })
          .onConflictDoNothing();
      }
      await audit(tx, {
        actorId: userId,
        action: accept ? 'invitation.accepted' : 'invitation.declined',
        entity: 'company',
        entityId: resolved.companyId,
        data: { invitationId, role: resolved.role },
      });
      return { companyId: resolved.companyId, accepted: accept };
    });
  }

  /** Bloquea la empresa: los cambios de miembros e invitaciones van de uno en uno. */
  private async lockCompany(tx: Tx, companyId: string): Promise<void> {
    await tx
      .select({ id: companies.id })
      .from(companies)
      .where(eq(companies.id, companyId))
      .for('update');
  }

  private async lockMember(tx: Tx, companyId: string, userId: string) {
    await this.lockCompany(tx, companyId);
    const [member] = await tx
      .select({ role: companyMembers.role })
      .from(companyMembers)
      .where(and(eq(companyMembers.companyId, companyId), eq(companyMembers.userId, userId)));
    if (!member) throw memberNotFound();
    return member;
  }

  private async assertKeepsOwner(
    tx: Tx,
    companyId: string,
    current: MemberRole,
    next: MemberRole | null,
  ): Promise<void> {
    const [owners] = await tx
      .select({ n: count() })
      .from(companyMembers)
      .where(and(eq(companyMembers.companyId, companyId), eq(companyMembers.role, 'owner')));
    if (memberChangeProblem({ ownerCount: owners.n, current, next })) {
      throw apiError(
        HttpStatus.CONFLICT,
        'last_owner',
        'La empresa necesita al menos un dueño. Nombra a otra persona antes.',
      );
    }
  }
}
