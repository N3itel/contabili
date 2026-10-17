# Convenciones de Contabili

Guía para quien programe en este repositorio (personas o Claude).

## Idioma

- Textos para usuarios, comentarios y documentación: **español**.
- Identificadores de código, nombres de tablas y columnas: **inglés**.
- Mensajes de commit: español, en imperativo («Agrega el libro mayor»).

## Dinero

- Todos los montos son **enteros en céntimos de sol** (`Cents`). S/ 15,50 = `1550`.
- Nunca uses decimales para dinero. Usa los helpers de `backend/src/accounting/money.ts`.
- En la base, `bigint` (modo `number`): un libro puede sumar más de lo que cabe en `integer`.
- IGV con `tax/igv.ts`: desde el total, la base se redondea y el IGV es la diferencia.

## Tiempo

- La fecha de negocio (fecha del asiento, periodo) es la de **Lima** (`America/Lima`, UTC−5, sin horario de verano). Usa `limaDate()`.
- En base de datos, `timestamp with time zone`; las fechas contables, `date`.

## Contabilidad

- Partida doble: cada línea va al debe o al haber, nunca a los dos, y el asiento cuadra (`accounting/journal-rules.ts`). La base lo vuelve a exigir con un trigger diferido (`journal_entries_balanced`).
- Plan de cuentas PCGE (`accounting/pcge.ts`): cada empresa nace con el suyo. Solo se asienta en cuentas de detalle (`allows_posting`); las madres agrupan.
- Los asientos se numeran por empresa y ejercicio (índice único), bloqueando la fila de la empresa.
- Un asiento registrado no se edita: se corrige con otro (extorno). Las líneas no cambian de asiento.
- Todo lo de una empresa (cuentas, asientos, líneas) lleva `company_id` con claves foráneas compuestas: nada cruza de empresa.
- RUC con `tax/ruc.ts` (dígito verificador módulo 11).

## Base de datos

- El esquema vive en `backend/src/db/schema/`. Para cambiarlo:
  1. Edita el esquema.
  2. `pnpm db:generate --name=descripcion_corta`
  3. Revisa el SQL generado en `backend/drizzle/`.
- Triggers y funciones van en migraciones a mano: `pnpm exec drizzle-kit generate --custom --name=...`.
- Nunca edites una migración ya aplicada; crea una nueva.
- Las reglas que protegen dinero van también como restricciones en la base (checks, índices únicos y triggers), no solo en código.

## Pruebas

- Cada regla de negocio lleva prueba unitaria (`*.spec.ts` junto al archivo).
- Las restricciones de base de datos se prueban en `backend/test/*.e2e-spec.ts` contra PostgreSQL real.
- Antes de subir: `pnpm format && pnpm lint && pnpm typecheck && pnpm test && pnpm test:e2e`.

## Backend

- En los servicios, inyecta todo con `@Inject(...)` explícito: las pruebas corren sin metadatos de decoradores.
- Valida los cuerpos con zod (`new ZodPipe(schema)`) y responde errores con `apiError(status, código, mensaje)`: el código es estable para las apps y el mensaje va en español.
- Ninguna ruta de negocio se publica sin sesión: primero llega la autenticación.

## Datos sensibles

- No registres en logs montos de clientes, DNI, teléfonos ni documentos. El filtro global de errores ya oculta los parámetros de las consultas.
