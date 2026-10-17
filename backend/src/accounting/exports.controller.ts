import { Body, Controller, Get, Inject, Param, Post, Res } from '@nestjs/common';
import type { Response } from 'express';
import { z } from 'zod';
import { type AuthContext, CurrentAuth, Public } from '../auth/auth.guard.js';
import { apiError, uuidParam, ZodPipe } from '../common/http.js';
import { ExportsService } from './exports.service.js';
import { isValidDate } from './lima.js';

const date = z.string().refine(isValidDate, 'Usa el formato AAAA-MM-DD');
const linkBody = z
  .object({ kind: z.enum(['journal', 'trial_balance']), from: date, to: date })
  .refine((b) => b.from <= b.to, 'La fecha inicial es posterior a la final');

/** Pedir el enlace de descarga (con sesión). */
@Controller('companies/:companyId/exports')
export class ExportLinksController {
  constructor(@Inject(ExportsService) private readonly exports: ExportsService) {}

  @Post()
  create(
    @CurrentAuth() auth: AuthContext,
    @Param('companyId', uuidParam()) companyId: string,
    @Body(new ZodPipe(linkBody)) body: z.infer<typeof linkBody>,
  ) {
    const days = (Date.parse(body.to) - Date.parse(body.from)) / 86_400_000;
    if (days > 366) {
      throw apiError(400, 'range_too_large', 'Descarga como máximo un año a la vez.');
    }
    return this.exports.createLink(companyId, auth.userId, body);
  }
}

/** La descarga en sí: la protege el enlace firmado, no la sesión. */
@Public()
@Controller('exports')
export class ExportDownloadController {
  constructor(@Inject(ExportsService) private readonly exports: ExportsService) {}

  @Get(':token')
  async download(@Param('token') token: string, @Res() res: Response): Promise<void> {
    if (token.length > 2000) throw apiError(404, 'export_expired', 'El enlace venció.');
    const file = await this.exports.download(token);
    res
      .status(200)
      .set({
        'Content-Type': 'text/csv; charset=utf-8',
        'Content-Disposition': `attachment; filename="${file.filename}"`,
        'Cache-Control': 'no-store',
        'Referrer-Policy': 'no-referrer',
        'X-Content-Type-Options': 'nosniff',
      })
      .send(file.body);
  }
}
