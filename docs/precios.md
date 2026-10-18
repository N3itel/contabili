# Precios de Contabili

Decisión del 17/10/2026: precios competitivos para micro y pequeñas empresas,
sin perder plata en ningún plan. Los montos viven en
`backend/src/billing/plans.ts` y `backend/src/billing/unit-economics.spec.ts`
falla si alguno deja menos de 40 % de margen.

| Plan | Al mes | Al año (2 meses gratis) | Personas |
| --- | --- | --- | --- |
| Emprendedor | S/ 25 | S/ 250 | 2 |
| Negocio | S/ 49 | S/ 490 | 6 |

Con IGV incluido. Cada empresa empieza con 30 días gratis del plan Negocio.

## Frente a la competencia

| Opción | Precio al mes | Qué incluye |
| --- | --- | --- |
| Alegra Contabilidad | S/ 105 a S/ 353 (con IGV) | Contabilidad y facturación electrónica (150 a 1 500 comprobantes) |
| Dora | S/ 169 + IGV | Contabilidad web |
| Defontana | desde US$ 40 + IGV, contrato anual | ERP contable |
| Estudio contable externo | desde S/ 50 | Persona que lleva los libros |
| Facturadores (Nubefact, Facturalo) | S/ 25 a S/ 29 | Solo facturación electrónica |

Contabili todavía no emite comprobantes electrónicos, así que se ubica por debajo
de la contabilidad con facturación (Alegra) y a la altura de un facturador simple.
Emprendedor cuesta la mitad del estudio contable más barato y la cuarta parte de
Alegra. Cuando llegue la facturación electrónica, conviene revisar los precios.

## Lo que cuesta atender una empresa (por mes)

| Concepto | Supuesto |
| --- | --- |
| IGV | 18 % del precio (se queda SUNAT) |
| Culqi | 3,44 % + US$ 0,20 por cargo; mínimo S/ 3,50 si el cargo es menor a S/ 87,72 |
| SMS (Twilio) | US$ 0,25 por mensaje ≈ S/ 0,95; 1 código por persona al mes, con el plan lleno |
| Avisos de vencimiento | 2 SMS por ciclo (3 días antes y al vencer) |
| Servidores | S/ 2 por empresa |
| Comprobante del pago | S/ 0,60 por cargo |

| Plan y ciclo | Ingreso sin IGV | Costo | Margen |
| --- | --- | --- | --- |
| Emprendedor mensual | S/ 21,19 | S/ 9,90 | 53 % |
| Emprendedor anual | S/ 17,66 | S/ 4,89 | 72 % |
| Negocio mensual | S/ 41,53 | S/ 13,70 | 67 % |
| Negocio anual | S/ 34,60 | S/ 9,38 | 73 % |

El mínimo de Culqi (S/ 3,50) se come el 14 % de un pago mensual de Emprendedor;
por eso el año trae 2 meses gratis: a la empresa le conviene y a nosotros también.

Los costos fijos (servidores base, cuentas de desarrollador de las tiendas,
dominio, plan del proveedor de comprobantes; unos S/ 600 al mes al empezar) se
cubren con unas 40 empresas pagando Emprendedor.

## Para revisar

- Confirmar con Culqi la tarifa y el mínimo (dicen que varían por volumen y se negocian).
- El SMS es el costo variable más alto: si crece, considerar el código por WhatsApp. Cada SMS va en una sola parte: el código cabe en 70 caracteres (lleva tilde) y los avisos van sin tildes en 160.
- Las fuentes de la competencia son de octubre de 2026; verificarlas antes de cada revisión.

Fuentes: [Alegra Perú](https://www.alegra.com/peru/contabilidad/precios/),
[CulqiOnline](https://culqi.com/productos/online-pasarela-de-pagos/),
[Twilio SMS Perú](https://www.twilio.com/sms/pricing/pe),
[Dora](https://dora.pe/precios.php),
[Defontana](https://www.defontana.com/pe/software-contable),
[estudio contable](https://www.tuestudiocontable.com/),
[facturadores](https://kom.pe/factura-boleta-electronica-tienda-online-peru/).
