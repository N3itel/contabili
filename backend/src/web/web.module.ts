import { Module } from '@nestjs/common';
import { AppConfigController, WebPagesController } from './web.controller.js';

/** El sitio público (portada, precios, descargas, Mi plan, legales) y la configuración de las apps. */
@Module({ controllers: [WebPagesController, AppConfigController] })
export class WebModule {}
