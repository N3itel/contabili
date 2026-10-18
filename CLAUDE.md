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
- RUC con `tax/ruc.ts` (dígito verificador módulo 11). El RUC no es único entre empresas (el dueño y su estudio contable pueden llevar cada uno la suya), pero una persona no tiene dos empresas con el mismo RUC (`ruc_already_yours`).
- Cierre mensual (`period-rules.ts`): `companies.closed_through` es la fecha hasta la que los libros están cerrados; cerrar un mes cierra lo anterior y solo se cierra un mes ya terminado. Reabrir es del dueño, con motivo, y queda en `period_closings`. La base rechaza asientos con fecha cerrada (trigger `journal_entries_open_period`).

## Facilidad de uso

- La meta: que un dueño sin experiencia lleve su contabilidad. Cada pantalla y cada mensaje se escriben para esa persona: sin «debe», «haber» ni códigos de cuenta salvo en las vistas del contador.
- Las operaciones fáciles (`accounting/operations.ts`) arman el asiento a partir de «vendí», «gasté», «cobré» o «pagué» y devuelven `explanation`, lo que se registró en palabras simples. El IGV va según el régimen: el Nuevo RUS no lo separa ni usa crédito fiscal; un gasto solo descuenta IGV con factura y si es de mercadería, servicios u otros.
- El resumen (`summary-rules.ts`) habla de plata, por cobrar, por pagar, IGV y resultado del mes; el resultado es aproximado (sin costo de ventas) y así se dice.
- Los mensajes de error dicen qué hacer, no solo qué falló («Usa una fecha posterior o pide al dueño que reabra el mes»).

## Clientes, impuestos y descargas

- Clientes y proveedores (`contacts`): el saldo de cada uno sale de las líneas de la 1212 (clientes) o la 4212 (proveedores) con su `contact_id` (clave foránea compuesta). Ventas y compras al crédito, cobros y pagos aceptan un contacto del tipo que corresponde (`operationContactKind`): `contact_not_needed`, `contact_wrong_kind`, `contact_not_found`. Un RUC no se repite por empresa y tipo (`contact_exists`).
- Cada asiento guarda de dónde salió (`journal_entries.source`: manual, sale, expense, collection, payment, tax_payment o reversal; check en la base).
- Comprobantes (`documents`, `accounting/document-rules.ts` y `app/lib/core/documents.dart` con los mismos casos): una venta o un gasto puede llevar el suyo (tabla 10 de SUNAT: 01 factura, 03 boleta, 02 recibo por honorarios —solo compras—, 12 ticket, 00 otro), con serie y número. Se guarda en la misma transacción que el asiento y, como él, no se edita ni se borra (trigger `documents_immutable`); si el asiento se extorna, figura como anulado y no suma. Factura y recibo llevan RUC (si no viene, el del cliente o proveedor elegido); en el Nuevo RUS no se emiten facturas; en un gasto, «tengo factura» (`withInvoice`) va solo con factura. Una serie y número propios no se repiten (`documents_sale_uq`) ni la misma factura de un proveedor (`documents_purchase_uq`): 409 `document_duplicate`.
- Registros de ventas y de compras (`registers.service.ts`, `GET /companies/:id/registers/sales|purchases?period=`), también para Excel. En la app, la serie y el número son opcionales: sin ellos se anota igual, pero no entra al registro.
- Impuestos del mes (`tax/monthly-taxes.ts`): IGV de ventas menos el de compras con factura, con el saldo a favor que pasa al mes siguiente; renta según el régimen (RMT 1 % hasta 300 UIT en el año y luego 1,5 %; RER y General 1,5 %; Nuevo RUS, cuota fija por categoría). Se redondea a soles enteros, como SUNAT. Es un estimado y la pantalla lo dice. Al empezar un año, agrega su UIT a `UIT_BY_YEAR`.
- Pagar impuestos es una operación más (`tax_payment`): baja el IGV por pagar (40111) o la renta (4017) contra caja o banco. La app la abre con el monto ya escrito desde «Ya pagué el IGV».
- Descargas para Excel (`exports`): la app pide un enlace firmado (JWT con audiencia `contabili-export`, 5 minutos) y lo abre en el navegador; al descargar se vuelve a revisar que la persona siga en la empresa. CSV en UTF-8 con BOM y comas (`accounting/csv.ts`), montos con punto decimal, y los textos que empiezan con `=`, `+`, `-` o `@` llevan `'` delante (inyección de fórmulas). Hasta un año por descarga (`range_too_large`). Cada descarga va en Excel (`csv`) o PDF (`pdf`); el reporte del mes (`monthly_report`: plata, resultado, impuestos y comprobantes) es solo PDF y de un mes.
- PDF (`src/pdf/`): `ReportPdf` dibuja la chakana, la franja tocapu, tablas que repiten el encabezado en cada página y el pie con la fecha y las páginas, con Saira y Lexend incrustadas (TTF fijos de `tools/letras.py` en `src/pdf/fonts/`). El diario en PDF va hasta 5000 líneas.

## Licencias y cobros

- La licencia es por empresa (`company_licenses`): nace con 30 días de prueba del plan Negocio. Planes y precios en `billing/plans.ts` (con IGV); el análisis está en `docs/precios.md` y `unit-economics.spec.ts` exige al menos 40 % de margen con el plan lleno. Al cambiar un precio o un proveedor, actualiza los supuestos de `COSTS`.
- Vencida, la empresa queda en solo lectura: las escrituras usan `CompanyAccess.requireWritable()` y responden 402 `license_expired`; leer y pagar siempre se puede. Nunca se borran datos por falta de pago.
- Personas por plan: invitar y aceptar respetan `maxMembers` (las invitaciones pendientes también cuentan). Bajar a un plan donde no entra el equipo no se puede (`plan_too_small`), ni cambiar de plan con un periodo pagado corriendo (`plan_change_while_paid`).
- Cobro como en Taxinka: el monto lo fija el servidor; la página `/pagar/<orden>#t=<código>` lleva el código en el fragmento; la tarjeta o Yape van al checkout de Culqi. La licencia se extiende solo cuando Culqi confirma el cargo (respuesta del cobro o webhook que consulta el cargo, nunca cree el cuerpo), una vez por orden (escritura condicional e índice único por cargo). Un pago empieza cuando termina lo que ya había (prueba o periodo pagado).
- Una orden nueva reemplaza a las pendientes; con un cobro en curso no se crea otra. 4 intentos por orden (3DS no gasta), 10 órdenes por empresa al día, vencen a los 30 min.
- Nunca registres el cuerpo de las respuestas de Culqi. Sin llaves se usa el proveedor de prueba; en producción, llaves `live`.

## Sitio público

- Lo sirve el backend fuera de `/api/v1` (`web/`, lista en `main-prefix.ts`): páginas fijas con CSP por hash, sin cookies ni recursos externos (salvo Culqi en `/pagar`). Nada de atributos `style=""`: la CSP los bloquea; usa clases (una prueba lo revisa).
- Los precios del sitio salen de `PLANS`; las descargas, de las variables `DOWNLOAD_*` y `APP_*`: solo se muestran las publicadas, nunca botones vacíos.
- `/mi-plan` ingresa con SMS y guarda la sesión solo en memoria; al ir a pagar la cierra.
- `/terminos` y `/privacidad` son borradores para revisión legal: al cambiarlos, sube `TERMS_VERSION`.

## Diseño incaico moderno

- La marca es una chakana de terracota con el Inti (círculo de oro) y un visto bueno de tinta: «todo cuadra». El contorno y los colores viven en `backend/src/web/brand.ts` (`BRAND`, `CHAKANA_POINTS`); la app los replica en `app/lib/ui/theme.dart` (`ContabiliColors`) y `app/lib/ui/brand.dart` (`ContabiliMark`). Si cambia uno, cambia el otro.
- Paleta: terracota (acción principal), oro (realces y avisos), añil, verde (ingresos y «vas ganando»), rojo (errores y «vas perdiendo») y tinta sobre papel. Los textos sobre color usan la versión oscura y los fondos la suave: el contraste siempre AA.
- La franja tocapu (`TocapuBand` en la app, `TOCAPU_BAND` en el sitio) va bajo la barra superior y al pie, nunca detrás de texto.
- Letras (OFL): **Saira** para títulos, montos y la marca (formas cuadradas y redondeadas, como piedra labrada) y **Lexend** para el texto (hecha para leer con menos esfuerzo). Las genera `python3 tools/letras.py`: archivos fijos por peso en `app/assets/fonts/` y WOFF2 en `backend/src/web/assets/` (el sitio las sirve en `/fonts/`). Los montos usan cifras de ancho fijo (`ContabiliFonts.amount`).
- Componentes de la app en `app/lib/ui/`: `HeroPanel` (la cifra principal sobre terracota con trama de chakanas), `SectionTitle` (peldaños de oro), `StatTile`, `IconBox`, `InitialsAvatar`, `EmptyState` con la ilustración de andenes (`AndesIllustration`). En la computadora, barra lateral con la empresa y la persona; en el celular, barra de abajo.
- Los íconos de la app salen de `python3 tools/iconos.py`, que lee la chakana de `brand.ts`: no los edites a mano.

## Beta

- Contabili está en beta: el sello «BETA» se ve en la barra de la app y en el sitio. No se publica en Play ni en App Store hasta decidirlo; las versiones de prueba se compilan con Actions → App → Run workflow.

## App

- Un solo código Flutter (`app/`) para Android, iPhone, Windows, Mac y Linux: en el celular, navegación abajo; desde 840 px, al costado.
- Las reglas que la app muestra antes de enviar (IGV, RUC, fecha de Lima, dinero) viven en `app/lib/core/` y replican las del backend con los mismos casos de prueba. Un cambio de regla se hace en los dos lados.
- La app nunca arma asientos: manda la operación y muestra la `explanation` del servidor. Los errores se muestran con el `message` del servidor.
- Montos en céntimos (`Cents`); para escribir, `parseSoles()` acepta «118», «118,50» o «1,200.00».
- Accesible para quien tenga poca experiencia o vista cansada: botones de 56 px o más, textos cortos sin jerga y nada que se desborde con la letra al 150 % (hay una prueba). Los botones de solo ícono llevan `tooltip`.
- Pruebas de pantallas en tamaño de teléfono (390 × 844) con `FakeContabiliApi`; la prueba de punta a punta (`integration_test/`) usa el backend real y deja capturas.
- La tarjeta nunca pasa por la app: Mi plan crea la orden y abre `/pagar` en el navegador.
- Formato: `dart format .` con ancho 100. Análisis sin avisos: `flutter analyze --fatal-infos`.

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
