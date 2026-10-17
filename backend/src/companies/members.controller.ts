import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Inject,
  Param,
  Patch,
  Post,
} from '@nestjs/common';
import { z } from 'zod';
import { type AuthContext, CurrentAuth } from '../auth/auth.guard.js';
import { uuidParam, ZodPipe } from '../common/http.js';
import { MembersService } from './members.service.js';

const role = z.enum(['owner', 'accountant', 'viewer']);
const roleBody = z.object({ role });
const inviteBody = z.object({ phone: z.string().max(30), role });

@Controller('companies/:companyId')
export class MembersController {
  constructor(@Inject(MembersService) private readonly members: MembersService) {}

  @Get('members')
  list(@CurrentAuth() auth: AuthContext, @Param('companyId', uuidParam()) companyId: string) {
    return this.members.list(companyId, auth.userId);
  }

  @Patch('members/:userId')
  @HttpCode(HttpStatus.NO_CONTENT)
  async changeRole(
    @CurrentAuth() auth: AuthContext,
    @Param('companyId', uuidParam()) companyId: string,
    @Param('userId', uuidParam()) userId: string,
    @Body(new ZodPipe(roleBody)) body: z.infer<typeof roleBody>,
  ): Promise<void> {
    await this.members.changeRole(companyId, auth.userId, userId, body.role);
  }

  @Delete('members/:userId')
  @HttpCode(HttpStatus.NO_CONTENT)
  async remove(
    @CurrentAuth() auth: AuthContext,
    @Param('companyId', uuidParam()) companyId: string,
    @Param('userId', uuidParam()) userId: string,
  ): Promise<void> {
    await this.members.remove(companyId, auth.userId, userId);
  }

  @Post('invitations')
  invite(
    @CurrentAuth() auth: AuthContext,
    @Param('companyId', uuidParam()) companyId: string,
    @Body(new ZodPipe(inviteBody)) body: z.infer<typeof inviteBody>,
  ) {
    return this.members.invite(companyId, auth.userId, body.phone, body.role);
  }

  @Get('invitations')
  pending(@CurrentAuth() auth: AuthContext, @Param('companyId', uuidParam()) companyId: string) {
    return this.members.pendingInvitations(companyId, auth.userId);
  }

  @Delete('invitations/:invitationId')
  @HttpCode(HttpStatus.NO_CONTENT)
  async revoke(
    @CurrentAuth() auth: AuthContext,
    @Param('companyId', uuidParam()) companyId: string,
    @Param('invitationId', uuidParam()) invitationId: string,
  ): Promise<void> {
    await this.members.revokeInvitation(companyId, auth.userId, invitationId);
  }
}

/** Las invitaciones que recibiste en tu celular. */
@Controller('invitations')
export class InvitationsController {
  constructor(@Inject(MembersService) private readonly members: MembersService) {}

  @Get()
  mine(@CurrentAuth() auth: AuthContext) {
    return this.members.myInvitations(auth.userId);
  }

  @Post(':invitationId/accept')
  @HttpCode(HttpStatus.OK)
  accept(
    @CurrentAuth() auth: AuthContext,
    @Param('invitationId', uuidParam()) invitationId: string,
  ) {
    return this.members.respond(auth.userId, invitationId, true);
  }

  @Post(':invitationId/decline')
  @HttpCode(HttpStatus.OK)
  decline(
    @CurrentAuth() auth: AuthContext,
    @Param('invitationId', uuidParam()) invitationId: string,
  ) {
    return this.members.respond(auth.userId, invitationId, false);
  }
}
