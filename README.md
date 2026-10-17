# Contabili

Contabilidad y finanzas para pymes peruanas, tan fácil que la pueda llevar un
dueño sin experiencia: anota «vendí», «gasté», «cobré» o «pagué» y Contabili
arma los asientos del PCGE, separa el IGV según su régimen y le dice cómo va
su negocio. Se usa en el celular y en la computadora, con una licencia por
empresa que se paga en el sitio o en la app.

## Qué hay hoy

- **Backend** (`backend/`): NestJS + PostgreSQL con Drizzle.
  - Ingreso con celular y código por SMS; sesiones con token de acceso de
    15 minutos y renovación que rota (un token reutilizado cierra todo).
  - Empresas por RUC y régimen tributario. Personas por empresa con rol
    (dueño, contador, consulta) que entran por invitación a su celular.
  - **Operaciones fáciles**: venta, gasto, cobro y pago sin debe ni haber, con
    una explicación en palabras simples de lo que se registró.
  - **Resumen del mes**: plata en caja y bancos, por cobrar, por pagar, IGV,
    ventas, gastos y resultado.
  - Plan de cuentas PCGE, libro diario inmutable (se corrige con extornos),
    libro mayor, balance de comprobación y **cierre mensual**.
  - **Licencias**: 30 días gratis por empresa; luego plan Emprendedor o
    Negocio, por mes o por año, pagado con Yape o tarjeta (Culqi). Vencida, la
    empresa queda en solo lectura.
- **Sitio público** (lo sirve el backend): portada, `/precios`, `/descargas`,
  `/mi-plan` (ingresar y pagar desde el navegador), `/pagar/<orden>` y los
  borradores de `/terminos` y `/privacidad`.

## API

La API vive en `/api/v1`. Todas las rutas piden `Authorization: Bearer <token>`
salvo `/auth/*`, `/app/config` y las de la página de pago (`/payments/*`). Los montos van en céntimos (S/ 118,00 = `11800`) y las fechas como
`AAAA-MM-DD`. Los errores responden `{ code, message }`: `code` es estable y
`message` va en español.

| Método y ruta | Rol mínimo | Qué hace |
| --- | --- | --- |
| `POST /auth/code` · `/auth/verify` · `/auth/register` | — | Código por SMS, verificación y alta (`acceptTerms: true`) |
| `POST /auth/refresh` · `/auth/revoke` · `/auth/logout` | — | Renovar y cerrar sesión |
| `GET /me` | — | Tu cuenta |
| `POST /companies` · `GET /companies` · `GET /companies/:id` | — | Crear (quedas como dueño) y ver tus empresas |
| `GET /companies/:id/members` | consulta | Personas y roles |
| `PATCH` · `DELETE /companies/:id/members/:userId` | dueño (salir: cualquiera) | Cambiar rol o sacar |
| `POST` · `GET /companies/:id/invitations`, `DELETE …/:invitationId` | dueño | Invitar por celular, ver y revocar |
| `GET /invitations`, `POST /invitations/:id/accept` · `/decline` | — | Tus invitaciones |
| `GET` · `POST /companies/:id/accounts` | consulta · contador | Plan de cuentas y subcuentas |
| `POST /companies/:id/operations` | contador | Venta, gasto, cobro o pago: el asiento se arma solo |
| `GET /companies/:id/summary?period=AAAA-MM` | consulta | Resumen de finanzas del mes |
| `POST /companies/:id/journal` | contador | Registrar un asiento |
| `GET /companies/:id/journal?period=AAAA-MM&after=N` | consulta | Diario del mes, de a 100 |
| `GET /companies/:id/journal/:entryId` | consulta | Un asiento |
| `POST /companies/:id/journal/:entryId/reverse` | contador | Extornar |
| `GET /companies/:id/ledger/:code?from=&to=` | consulta | Libro mayor |
| `GET /companies/:id/trial-balance?from=&to=` | consulta | Balance de comprobación |
| `GET /companies/:id/periods`, `POST …/periods/close` · `/reopen` | consulta · contador · dueño | Cierre mensual (reabrir pide motivo) |
| `GET /companies/:id/billing` | consulta | Plan, días que quedan y pagos |
| `POST /companies/:id/billing/orders` | dueño | Orden de pago: devuelve `checkoutUrl` |
| `GET /app/config` | — | Planes, descargas y versión de los términos para las apps |

Con la licencia vencida, las rutas que registran responden 402 `license_expired`;
las de consulta siguen funcionando.

Sin `from`/`to`, los reportes van del 1 de enero hasta hoy (hora de Lima).

## Hoja de ruta

1. ~~Ingreso con celular y sesión; personas y permisos por empresa.~~
2. ~~API del libro diario y plan de cuentas; libro mayor y balance de comprobación.~~
3. ~~Cierre mensual, operaciones fáciles, resumen, licencias, cobro y sitio.~~
4. App Flutter para Android, iOS, Windows, macOS y Linux (un solo código), con
   los instaladores publicados en `/descargas`.
5. Avisos antes de que venza el plan; comprobante electrónico de cada pago de licencia.
6. Registro de ventas y de compras desde comprobantes; exportar a Excel y PDF.
7. Facturación electrónica (OSE/PSE) y libros electrónicos PLE.

## Desarrollo

```sh
docker compose -f infra/docker-compose.yml up -d
cd backend
cp .env.example .env
pnpm install
pnpm db:migrate
pnpm start:dev
```

Antes de subir: `pnpm format && pnpm lint && pnpm typecheck && pnpm test && pnpm test:e2e`.

Las convenciones están en [CLAUDE.md](CLAUDE.md).
