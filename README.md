# Contabili

Contabilidad y finanzas para pymes peruanas, tan fácil que la pueda llevar un
dueño sin experiencia: anota «vendí», «gasté», «cobré» o «pagué» y Contabili
arma los asientos del PCGE, separa el IGV según su régimen, le dice cuánto le
toca pagar a SUNAT y cómo va su negocio. Se usa en el celular y en la
computadora, con una licencia por empresa que se paga en el sitio o en la app.

**Está en beta**: todavía no se publica en Play ni en App Store; las versiones
de prueba se compilan desde GitHub Actions.

## Qué hay hoy

- **Backend** (`backend/`): NestJS + PostgreSQL con Drizzle.
  - Ingreso con celular y código por SMS; sesiones con token de acceso de
    15 minutos y renovación que rota (un token reutilizado cierra todo).
  - Empresas por RUC y régimen tributario. Personas por empresa con rol
    (dueño, contador, consulta) que entran por invitación a su celular.
  - **Operaciones fáciles**: venta, gasto, cobro, pago y pago de impuestos sin
    debe ni haber, con una explicación en palabras simples de lo que se registró.
  - **Clientes y proveedores**: cuánto debe cada cliente y cuánto se le debe a
    cada proveedor, con sus movimientos.
  - **Resumen del mes**: plata en caja y bancos, por cobrar, por pagar, IGV,
    ventas, gastos y resultado; y la tendencia de los últimos meses.
  - **Impuestos del mes**: IGV (con el saldo a favor que pasa de mes a mes) y
    renta o cuota del Nuevo RUS según el régimen, como estimado.
  - **Comprobantes y registros**: cada venta o gasto puede llevar su boleta,
    factura, recibo por honorarios o ticket; con ellos salen el registro de
    ventas y el de compras del mes, sin duplicados.
  - **Facturación electrónica (beta)**: boletas y facturas en modo de prueba o
    con la cuenta de Nubefact de cada empresa; la venta se anota sola, y se
    anulan con nota de crédito, que la descuenta.
  - **Avisos por SMS** a los dueños antes de que venza la prueba o el plan.
  - **Descargas en Excel y PDF**: libro diario, balance de comprobación y
    registros de ventas y compras, y el **reporte del mes** en PDF con la marca,
    con enlaces firmados que vencen en 5 minutos.
  - Plan de cuentas PCGE, libro diario inmutable (se corrige con extornos),
    libro mayor, balance de comprobación y **cierre mensual**.
  - **Licencias**: 30 días gratis por empresa; luego plan Emprendedor o
    Negocio, por mes o por año, pagado con Yape o tarjeta (Culqi). Vencida, la
    empresa queda en solo lectura.
- **App** (`app/`): Flutter, un solo código para Android, iPhone, Windows, Mac
  y Linux. Inicio con el resumen, cuatro botones grandes (Vendí, Gasté, Cobré,
  Pagué), los impuestos del mes y el gráfico de los últimos meses; movimientos
  con anular, cierre de mes y descarga para Excel; clientes y proveedores; Mi
  plan (paga en el navegador) y equipo. Probada con letra al 150 % y de punta a
  punta contra el backend.
- **Diseño incaico moderno**: la marca es una chakana de terracota con el Inti
  y un visto bueno («todo cuadra»); franjas tocapu, paleta andina (terracota,
  oro, añil, verde y papel) y las letras Saira (títulos y montos) y Lexend (texto),
  iguales en el sitio y la app. En la computadora, barra lateral como un programa de escritorio.
- **Sitio público** (lo sirve el backend): portada, `/precios`, `/descargas`,
  `/mi-plan` (ingresar y pagar desde el navegador), `/pagar/<orden>` y los
  borradores de `/terminos` y `/privacidad`.

## API

La API vive en `/api/v1`. Todas las rutas piden `Authorization: Bearer <token>`
salvo `/auth/*`, `/app/config`, las de la página de pago (`/payments/*`) y las
descargas con enlace firmado (`/exports/:token`). Los montos van en céntimos (S/ 118,00 = `11800`) y las fechas como
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
| `GET /companies/:id/taxes?period=AAAA-MM` | consulta | Impuestos del mes (estimado) |
| `GET /companies/:id/trend?months=N` | consulta | Ventas y gastos de los últimos meses |
| `GET /companies/:id/registers/sales` · `/purchases?period=AAAA-MM` | consulta | Registro de ventas o de compras con sus comprobantes |
| `GET` · `POST /companies/:id/contacts`, `GET` · `PATCH …/:contactId` | consulta · contador | Clientes y proveedores, con lo que deben |
| `POST /companies/:id/exports` | consulta | Enlace de descarga (5 min): diario, balance, registros o reporte del mes, en `csv` o `pdf` |
| `POST /companies/:id/journal` | contador | Registrar un asiento |
| `GET /companies/:id/journal?period=AAAA-MM&after=N` | consulta | Diario del mes, de a 100 |
| `GET /companies/:id/journal/:entryId` | consulta | Un asiento |
| `POST /companies/:id/journal/:entryId/reverse` | contador | Extornar |
| `GET /companies/:id/ledger/:code?from=&to=` | consulta | Libro mayor |
| `GET /companies/:id/trial-balance?from=&to=` | consulta | Balance de comprobación |
| `GET /companies/:id/periods`, `POST …/periods/close` · `/reopen` | consulta · contador · dueño | Cierre mensual (reabrir pide motivo) |
| `GET /companies/:id/billing` | consulta | Plan, días que quedan y pagos |
| `POST /companies/:id/billing/orders` | dueño | Orden de pago: devuelve `checkoutUrl` |
| `GET` · `PUT /companies/:id/einvoicing` | consulta · dueño | Facturación electrónica: modo de prueba o Nubefact y series |
| `GET` · `POST /companies/:id/einvoices` | consulta · contador | Comprobantes emitidos y emitir una boleta o factura |
| `POST /companies/:id/einvoices/:id/refresh` · `/record` · `/link` | contador · contador · consulta | Consultar a SUNAT, anotar la venta y ver el PDF |
| `POST /companies/:id/einvoices/:id/credit-note` | contador | Anular con nota de crédito (motivo 01, 02 o 06) |
| `GET /app/config` | — | Planes, descargas y versión de los términos para las apps |
| `GET /exports/:token` | — (enlace firmado) | La descarga en sí |

Con la licencia vencida, las rutas que registran responden 402 `license_expired`;
las de consulta siguen funcionando.

Sin `from`/`to`, los reportes van del 1 de enero hasta hoy (hora de Lima).

## Hoja de ruta

1. ~~Ingreso con celular y sesión; personas y permisos por empresa.~~
2. ~~API del libro diario y plan de cuentas; libro mayor y balance de comprobación.~~
3. ~~Cierre mensual, operaciones fáciles, resumen, licencias, cobro y sitio.~~
4. ~~App Flutter para Android, iOS, Windows, macOS y Linux.~~ Falta: instaladores
   firmados (MSIX, DMG notarizado, .deb, Play y App Store) y publicarlos en `/descargas`.
5. ~~Avisos antes de que venza el plan.~~ Comprobante electrónico de cada pago de licencia.
6. ~~Registro de ventas y de compras desde comprobantes; exportar a PDF.~~
7. ~~Facturación electrónica (beta, con Nubefact) y notas de crédito.~~ Nuevo RUS y libros electrónicos PLE.

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

La app (con el backend corriendo en el puerto 3000):

```sh
cd app
flutter run --dart-define=CONTABILI_API=http://localhost:3000/api/v1 \
  --dart-define=CONTABILI_WEB=http://localhost:3000
```

Antes de subir: `dart format . && flutter analyze --fatal-infos && flutter test`. Los
íconos salen de `python3 tools/iconos.py` (lee la chakana de `backend/src/web/brand.ts`). La
prueba de punta a punta (`integration_test/`) corre en el CI contra el backend real;
las versiones para descargar se compilan desde Actions → App → Run workflow.

Las convenciones están en [CLAUDE.md](CLAUDE.md).
