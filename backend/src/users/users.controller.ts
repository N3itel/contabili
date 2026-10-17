import { Controller, Get, HttpStatus, Inject } from '@nestjs/common';
import { type AuthContext, CurrentAuth } from '../auth/auth.guard.js';
import { apiError } from '../common/http.js';
import { DRIZZLE, type Database } from '../db/db.module.js';
import { loadMe, type MeDto } from './me.js';

@Controller('me')
export class UsersController {
  constructor(@Inject(DRIZZLE) private readonly db: Database) {}

  @Get()
  async me(@CurrentAuth() auth: AuthContext): Promise<MeDto> {
    const me = await loadMe(this.db, auth.userId);
    if (!me)
      throw apiError(HttpStatus.UNAUTHORIZED, 'unauthorized', 'Inicia sesión para continuar.');
    return me;
  }
}
