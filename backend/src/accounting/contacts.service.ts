import { HttpStatus, Inject, Injectable } from '@nestjs/common';
import { and, asc, desc, eq, isNull, like, sql, type SQL } from 'drizzle-orm';
import { audit } from '../common/audit.js';
import { apiError } from '../common/http.js';
import { uniqueViolation } from '../common/pg.js';
import { CompanyAccess } from '../companies/company-access.js';
import { DRIZZLE, type Database } from '../db/db.module.js';
import { accounts, contacts, journalEntries, journalLines } from '../db/schema/index.js';
import { isValidRuc } from '../tax/ruc.js';
import type { Cents } from './money.js';

export type ContactKind = 'customer' | 'supplier';

export interface ContactDto {
  id: string;
  kind: ContactKind;
  name: string;
  ruc: string | null;
  /** Cliente: lo que te debe. Proveedor: lo que le debes. Negativo si es al revés. */
  balance: Cents;
  archived: boolean;
}

/** Movimientos de un contacto que se muestran a la vez. */
export const CONTACT_MOVEMENTS_LIMIT = 200;

const contactNotFound = () =>
  apiError(HttpStatus.NOT_FOUND, 'contact_not_found', 'No encontramos ese cliente o proveedor.');

/** Cuenta que lleva el saldo de cada tipo: por cobrar (12) o por pagar (42). */
const ledgerPrefix = (kind: ContactKind) => (kind === 'customer' ? '12' : '42');

/** Saldo del lado que importa: lo que el cliente debe o lo que se le debe al proveedor. */
const balanceSql = sql<number>`coalesce(sum(
  case when ${contacts.kind} = 'customer'
    then case when ${accounts.code} like '12%' then ${journalLines.debitCents} - ${journalLines.creditCents} else 0 end
    else case when ${accounts.code} like '42%' then ${journalLines.creditCents} - ${journalLines.debitCents} else 0 end
  end), 0)`.mapWith(Number);

@Injectable()
export class ContactsService {
  constructor(
    @Inject(DRIZZLE) private readonly db: Database,
    @Inject(CompanyAccess) private readonly access: CompanyAccess,
  ) {}

  /** Clientes o proveedores con su saldo, los que más deben primero. */
  async list(
    companyId: string,
    actorId: string,
    filter: { kind?: ContactKind; archived?: boolean } = {},
  ): Promise<ContactDto[]> {
    await this.access.require(companyId, actorId, 'viewer');
    const conditions: SQL[] = [eq(contacts.companyId, companyId)];
    if (filter.kind) conditions.push(eq(contacts.kind, filter.kind));
    if (!filter.archived) conditions.push(isNull(contacts.archivedAt));
    const rows = await this.db
      .select({
        id: contacts.id,
        kind: contacts.kind,
        name: contacts.name,
        ruc: contacts.ruc,
        archivedAt: contacts.archivedAt,
        balance: balanceSql,
      })
      .from(contacts)
      .leftJoin(journalLines, eq(journalLines.contactId, contacts.id))
      .leftJoin(accounts, eq(accounts.id, journalLines.accountId))
      .where(and(...conditions))
      .groupBy(contacts.id)
      .orderBy(desc(balanceSql), asc(contacts.name));
    return rows.map(({ archivedAt, ...r }) => ({ ...r, archived: archivedAt !== null }));
  }

  async create(
    companyId: string,
    actorId: string,
    input: { kind: ContactKind; name: string; ruc?: string },
  ): Promise<ContactDto> {
    await this.access.requireWritable(companyId, actorId, 'accountant');
    if (input.ruc && !isValidRuc(input.ruc)) {
      throw apiError(HttpStatus.BAD_REQUEST, 'invalid_ruc', 'El RUC no es válido.');
    }
    try {
      const [row] = await this.db
        .insert(contacts)
        .values({ companyId, kind: input.kind, name: input.name, ruc: input.ruc ?? null })
        .returning({ id: contacts.id });
      await audit(this.db, {
        actorId,
        action: 'contact.created',
        entity: 'company',
        entityId: companyId,
        data: { contactId: row.id, kind: input.kind },
      });
      return {
        id: row.id,
        kind: input.kind,
        name: input.name,
        ruc: input.ruc ?? null,
        balance: 0,
        archived: false,
      };
    } catch (error) {
      if (uniqueViolation(error) === 'contacts_ruc_uq') {
        throw apiError(
          HttpStatus.CONFLICT,
          'contact_exists',
          input.kind === 'customer'
            ? 'Ya tienes un cliente con ese RUC.'
            : 'Ya tienes un proveedor con ese RUC.',
        );
      }
      throw error;
    }
  }

  /** Cambia el nombre o lo archiva (deja de aparecer al anotar; su historia queda). */
  async update(
    companyId: string,
    actorId: string,
    contactId: string,
    patch: { name?: string; archived?: boolean },
  ): Promise<ContactDto> {
    await this.access.requireWritable(companyId, actorId, 'accountant');
    const [row] = await this.db
      .update(contacts)
      .set({
        ...(patch.name ? { name: patch.name } : {}),
        ...(patch.archived === undefined ? {} : { archivedAt: patch.archived ? new Date() : null }),
      })
      .where(and(eq(contacts.id, contactId), eq(contacts.companyId, companyId)))
      .returning({ id: contacts.id });
    if (!row) throw contactNotFound();
    return this.get(companyId, actorId, contactId).then((d) => d.contact);
  }

  /** Un contacto con sus movimientos y el saldo después de cada uno. */
  async get(companyId: string, actorId: string, contactId: string) {
    await this.access.require(companyId, actorId, 'viewer');
    const [contact] = (await this.list(companyId, actorId, { archived: true })).filter(
      (c) => c.id === contactId,
    );
    if (!contact) throw contactNotFound();
    const sign = contact.kind === 'customer' ? 1 : -1;
    const rows = await this.db
      .select({
        entryId: journalEntries.id,
        entryDate: journalEntries.entryDate,
        description: journalEntries.description,
        debit: journalLines.debitCents,
        credit: journalLines.creditCents,
      })
      .from(journalLines)
      .innerJoin(accounts, eq(accounts.id, journalLines.accountId))
      .innerJoin(journalEntries, eq(journalEntries.id, journalLines.entryId))
      .where(
        and(
          eq(journalLines.contactId, contactId),
          like(accounts.code, `${ledgerPrefix(contact.kind)}%`),
        ),
      )
      .orderBy(
        asc(journalEntries.entryDate),
        asc(journalEntries.fiscalYear),
        asc(journalEntries.number),
      )
      .limit(CONTACT_MOVEMENTS_LIMIT);
    let balance = 0;
    const movements = rows.map((r) => {
      // Para un cliente sube con lo que vende al crédito; para un proveedor, con lo que compras.
      const amount = sign * (r.debit - r.credit);
      balance += amount;
      return {
        entryId: r.entryId,
        entryDate: r.entryDate,
        description: r.description,
        amount,
        balance,
      };
    });
    return { contact, movements };
  }
}
