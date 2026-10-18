import { readFileSync } from 'node:fs';
import { Controller, Get, Header, Inject, Res } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { Response } from 'express';
import { Public } from '../auth/auth.guard.js';
import { PLAN_CODES, PLANS, TRIAL_DAYS } from '../billing/plans.js';
import type { Env } from '../config/env.js';
import { TERMS_VERSION } from '../users/consent.js';
import type { WebPage } from './layout.js';
import { privacyPage, termsPage } from './legal-pages.js';
import { MY_PLAN_PAGE } from './my-plan-page.js';
import { type DownloadLinks, downloadsPage, HOME_PAGE, PRICING_PAGE } from './site-pages.js';

function send(res: Response, page: WebPage, cache: string): void {
  res
    .status(200)
    .set({
      'Content-Type': 'text/html; charset=utf-8',
      'Content-Security-Policy': page.csp,
      'Cache-Control': cache,
      'Referrer-Policy': 'no-referrer',
      'X-Content-Type-Options': 'nosniff',
    })
    .send(page.html);
}

function downloadLinks(config: ConfigService<Env, true>): DownloadLinks {
  const get = <K extends keyof Env>(key: K) => (config.get(key, { infer: true }) as string) ?? null;
  return {
    version: get('DESKTOP_VERSION'),
    windows: get('DOWNLOAD_WINDOWS_URL'),
    macos: get('DOWNLOAD_MACOS_URL'),
    linux: get('DOWNLOAD_LINUX_URL'),
    android: get('APP_ANDROID_URL'),
    ios: get('APP_IOS_URL'),
  };
}

/** La letra del sitio (Figtree, licencia OFL), servida por nosotros: sin recursos de terceros. */
const FIGTREE = readFileSync(new URL('./assets/Figtree-Variable.ttf', import.meta.url));

/** El sitio público, fuera del prefijo de la API. */
@Public()
@Controller()
export class WebPagesController {
  private readonly downloads: WebPage;
  private readonly terms: WebPage;
  private readonly privacy: WebPage;

  constructor(@Inject(ConfigService) config: ConfigService<Env, true>) {
    const seller = {
      legalName: config.get('COMPANY_LEGAL_NAME', { infer: true }),
      ruc: config.get('COMPANY_RUC', { infer: true }) ?? null,
      supportEmail: config.get('SUPPORT_EMAIL', { infer: true }),
    };
    this.downloads = downloadsPage(downloadLinks(config));
    this.terms = termsPage(seller);
    this.privacy = privacyPage(seller);
  }

  @Get()
  home(@Res() res: Response): void {
    send(res, HOME_PAGE, 'public, max-age=3600');
  }

  @Get('precios')
  pricing(@Res() res: Response): void {
    send(res, PRICING_PAGE, 'public, max-age=3600');
  }

  @Get('descargas')
  downloadsPage(@Res() res: Response): void {
    send(res, this.downloads, 'public, max-age=600');
  }

  @Get('mi-plan')
  myPlan(@Res() res: Response): void {
    send(res, MY_PLAN_PAGE, 'no-store');
  }

  @Get('fonts/figtree.ttf')
  font(@Res() res: Response): void {
    // Con @Res y end(): Nest no convierte el archivo en JSON ni Express le agrega charset.
    res.writeHead(200, {
      'Content-Type': 'font/ttf',
      'Content-Length': FIGTREE.length,
      'Cache-Control': 'public, max-age=31536000, immutable',
      'X-Content-Type-Options': 'nosniff',
    });
    res.end(FIGTREE);
  }

  @Get('terminos')
  termsPage(@Res() res: Response): void {
    send(res, this.terms, 'public, max-age=3600');
  }

  @Get('privacidad')
  privacyPage(@Res() res: Response): void {
    send(res, this.privacy, 'public, max-age=3600');
  }
}

/** Lo que las apps consultan al abrirse: versión de los términos, planes y descargas. */
@Public()
@Controller('app')
export class AppConfigController {
  constructor(@Inject(ConfigService) private readonly config: ConfigService<Env, true>) {}

  @Get('config')
  @Header('Cache-Control', 'no-store')
  get() {
    return {
      termsVersion: TERMS_VERSION,
      supportEmail: this.config.get('SUPPORT_EMAIL', { infer: true }),
      publicWebUrl: this.config.get('PUBLIC_WEB_URL', { infer: true }),
      trialDays: TRIAL_DAYS,
      plans: PLAN_CODES.map((code) => PLANS[code]),
      downloads: downloadLinks(this.config),
    };
  }
}
