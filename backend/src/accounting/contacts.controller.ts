import { Body, Controller, Get, Inject, Param, Patch, Post, Query } from '@nestjs/common';
import { z } from 'zod';
import { type AuthContext, CurrentAuth } from '../auth/auth.guard.js';
import { uuidParam, ZodPipe } from '../common/http.js';
import { ContactsService } from './contacts.service.js';

const kind = z.enum(['customer', 'supplier']);
const name = z.string().trim().min(2).max(120);
const createBody = z.object({
  kind,
  name,
  ruc: z
    .string()
    .trim()
    .regex(/^\d{11}$/, 'El RUC tiene 11 dígitos')
    .optional(),
});
const updateBody = z
  .object({ name: name.optional(), archived: z.boolean().optional() })
  .refine((b) => b.name !== undefined || b.archived !== undefined, 'Nada que cambiar');
const listQuery = z.object({
  kind: kind.optional(),
  archived: z.enum(['true', 'false']).optional(),
});

/** Clientes y proveedores de una empresa. */
@Controller('companies/:companyId/contacts')
export class ContactsController {
  constructor(@Inject(ContactsService) private readonly contacts: ContactsService) {}

  @Get()
  list(
    @CurrentAuth() auth: AuthContext,
    @Param('companyId', uuidParam()) companyId: string,
    @Query(new ZodPipe(listQuery)) query: z.infer<typeof listQuery>,
  ) {
    return this.contacts.list(companyId, auth.userId, {
      kind: query.kind,
      archived: query.archived === 'true',
    });
  }

  @Post()
  create(
    @CurrentAuth() auth: AuthContext,
    @Param('companyId', uuidParam()) companyId: string,
    @Body(new ZodPipe(createBody)) body: z.infer<typeof createBody>,
  ) {
    return this.contacts.create(companyId, auth.userId, body);
  }

  @Get(':contactId')
  get(
    @CurrentAuth() auth: AuthContext,
    @Param('companyId', uuidParam()) companyId: string,
    @Param('contactId', uuidParam()) contactId: string,
  ) {
    return this.contacts.get(companyId, auth.userId, contactId);
  }

  @Patch(':contactId')
  update(
    @CurrentAuth() auth: AuthContext,
    @Param('companyId', uuidParam()) companyId: string,
    @Param('contactId', uuidParam()) contactId: string,
    @Body(new ZodPipe(updateBody)) body: z.infer<typeof updateBody>,
  ) {
    return this.contacts.update(companyId, auth.userId, contactId, body);
  }
}
