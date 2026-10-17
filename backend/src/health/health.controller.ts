import { Controller, Get, Inject, ServiceUnavailableException } from '@nestjs/common';
import { sql } from 'drizzle-orm';
import { DRIZZLE, type Database } from '../db/db.module.js';

export interface HealthStatus {
  status: 'ok';
  database: 'ok';
}

/** Para el balanceador y el monitoreo: responde 200 solo si la base responde. */
@Controller('health')
export class HealthController {
  constructor(@Inject(DRIZZLE) private readonly db: Database) {}

  @Get()
  async check(): Promise<HealthStatus> {
    try {
      await this.db.execute(sql`select 1`);
      return { status: 'ok', database: 'ok' };
    } catch {
      throw new ServiceUnavailableException({ status: 'error', database: 'unreachable' });
    }
  }
}
