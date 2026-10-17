import { NestFactory } from '@nestjs/core';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { AppModule } from './app.module.js';

async function bootstrap() {
  const app = await NestFactory.create<NestExpressApplication>(AppModule);
  // Detrás de un balanceador, la IP real del cliente llega en X-Forwarded-For.
  // Sin esto, el tope de códigos por IP trataría a todos los usuarios como uno solo.
  const hops = Number(process.env.TRUST_PROXY_HOPS ?? 0);
  if (hops > 0) app.set('trust proxy', hops);
  app.enableShutdownHooks();
  await app.listen(process.env.PORT ?? 3000);
}
await bootstrap();
