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
- Un asiento registrado no se edita ni se borra (trigger `journal_immutable`): se corrige con un extorno, una sola vez por asiento (índice único) y nunca de otro extorno.
- Fechas de asiento desde el año 2000 hasta hoy en Lima. Cada asiento guarda quién lo registró (`created_by`).
- Abrir una subcuenta convierte a su madre en cuenta que agrupa; por eso no se divide una cuenta que ya tiene asientos (`parent_has_entries`). Asentar toma un bloqueo compartido de las cuentas y abrir una subcuenta bloquea la madre.
- El mayor de una cuenta madre suma sus subcuentas. Los saldos van del lado normal de la cuenta (`natureBalance`); el balance de comprobación, en columnas deudor/acreedor (`balanceSides`).
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

## Autenticación y permisos

- Toda ruta pide sesión por defecto (guard global). Las públicas llevan `@Public()`.
- Ingreso con celular peruano y código por SMS (`auth/otp.ts`): 6 dígitos, 5 min, 5 intentos, 60 s entre envíos, 5 por hora y 10 por día, y 10 pedidos por IP por hora. Solo se guarda el HMAC del código.
- Token de acceso de 15 min; refresh token opaco de 60 días que rota en cada uso. Uno ya rotado (pasados 30 s) cierra todas las sesiones de la persona.
- El guard lee de la base si la sesión sigue abierta y si la cuenta está bloqueada. No confíes en datos del token para permisos.
- Dentro de una empresa, cada servicio llama a `CompanyAccess.require(companyId, userId, rol)` (`viewer` < `accountant` < `owner`). Quien no es parte recibe 404 (`company_not_found`), igual que si no existiera.
- Se entra a una empresa solo aceptando una invitación al propio celular (vence a los 7 días, hasta 20 pendientes por empresa). La respuesta al invitar no dice si el número ya tiene cuenta.
- Siempre queda al menos un dueño (`memberChangeProblem` y trigger diferido `company_members_has_owner`). Los cambios de miembros bloquean la fila de la empresa.
- Entrar, salir, cambios de rol, invitaciones, cuentas nuevas y extornos dejan registro con `audit()`.
- El alta exige `acceptTerms: true` y guarda la versión en `user_consents` (`TERMS_VERSION`).

## Backend

- En los servicios, inyecta todo con `@Inject(...)` explícito: las pruebas corren sin metadatos de decoradores.
- Valida los cuerpos y las consultas con zod (`new ZodPipe(schema)`), los ids de la ruta con `uuidParam()`, y responde errores con `apiError(status, código, mensaje)`: el código es estable para las apps y el mensaje va en español.

## Datos sensibles

- No registres en logs montos de clientes, DNI, teléfonos ni documentos. Usa `maskPhone()` si hace falta mostrar un número (las listas de miembros e invitaciones lo enmascaran). El filtro global de errores ya oculta los parámetros de las consultas.
