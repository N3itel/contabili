# Contabili

Contabilidad simple para pymes peruanas: libro diario en partida doble con el
PCGE, IGV y, más adelante, comprobantes electrónicos, libros electrónicos
(PLE) y declaraciones para SUNAT.

## Qué hay hoy

- **Backend** (`backend/`): NestJS + PostgreSQL con Drizzle.
  - Empresas identificadas por RUC (con dígito verificador) y régimen
    tributario (Nuevo RUS, RER, RMT o General).
  - Plan de cuentas por empresa, sembrado con el PCGE base. Las cuentas con
    subcuentas solo agrupan.
  - Libro diario: asientos numerados por empresa y ejercicio. La partida doble
    se exige en código y en la base (trigger diferido al confirmar).
  - Cálculo de IGV (18 %) sin perder céntimos.

## Hoja de ruta

1. Ingreso con celular y sesión; personas y permisos por empresa.
2. API del libro diario y plan de cuentas; libro mayor y balance de comprobación.
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
