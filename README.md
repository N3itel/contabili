# Contabili

Contabilidad simple para pymes peruanas: libro diario en partida doble con el
PCGE, IGV y, más adelante, comprobantes electrónicos, libros electrónicos
(PLE) y declaraciones para SUNAT.

## Qué hay hoy

- **Backend** (`backend/`): NestJS + PostgreSQL con Drizzle.
  - Ingreso con celular y código por SMS; sesiones con token de acceso de
    15 minutos y renovación que rota (un token reutilizado cierra todo).
  - Empresas identificadas por RUC (con dígito verificador) y régimen
    tributario (Nuevo RUS, RER, RMT o General).
  - Personas por empresa con rol: dueño, contador o solo consulta. Se entra
    por invitación al celular, que la persona acepta. Siempre queda un dueño.
  - Plan de cuentas por empresa, sembrado con el PCGE base; subcuentas propias.
  - Libro diario: asientos numerados por empresa y ejercicio, partida doble
    exigida en código y en la base, sin edición ni borrado: se extornan.
  - Libro mayor por cuenta (con sus subcuentas) y balance de comprobación.
  - Cálculo de IGV (18 %) sin perder céntimos.

## API

Todas las rutas piden `Authorization: Bearer <token>` salvo `/health` y
`/auth/*`. Los montos van en céntimos (S/ 118,00 = `11800`) y las fechas como
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
| `POST /companies/:id/journal` | contador | Registrar un asiento |
| `GET /companies/:id/journal?period=AAAA-MM&after=N` | consulta | Diario del mes, de a 100 |
| `GET /companies/:id/journal/:entryId` | consulta | Un asiento |
| `POST /companies/:id/journal/:entryId/reverse` | contador | Extornar |
| `GET /companies/:id/ledger/:code?from=&to=` | consulta | Libro mayor |
| `GET /companies/:id/trial-balance?from=&to=` | consulta | Balance de comprobación |

Sin `from`/`to`, los reportes van del 1 de enero hasta hoy (hora de Lima).

## Hoja de ruta

1. ~~Ingreso con celular y sesión; personas y permisos por empresa.~~
2. ~~API del libro diario y plan de cuentas; libro mayor y balance de comprobación.~~
3. Periodos mensuales con cierre (un periodo cerrado no recibe asientos).
4. Registro de ventas y de compras desde comprobantes (factura, boleta, notas).
5. Facturación electrónica (OSE/PSE) y libros electrónicos PLE.
6. Panel web y app Flutter.

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
