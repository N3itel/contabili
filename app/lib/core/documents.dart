import 'operations.dart';
import 'ruc.dart';

/// Comprobantes de pago: replica `backend/src/accounting/document-rules.ts`
/// (códigos de la tabla 10 de SUNAT) con los mismos casos de prueba.
enum DocType {
  factura('01', 'Factura', sale: true, purchase: true),
  boleta('03', 'Boleta', sale: true, purchase: true),
  recibo('02', 'Recibo por honorarios', sale: false, purchase: true),
  ticket('12', 'Ticket', sale: true, purchase: true),
  other('00', 'Otro comprobante', sale: true, purchase: true);

  const DocType(this.wire, this.label, {required this.sale, required this.purchase});

  final String wire;
  final String label;
  final bool sale;
  final bool purchase;

  /// Factura y recibo por honorarios llevan el RUC de la otra parte.
  bool get needsRuc => this == factura || this == recibo;

  static DocType fromWire(String wire) =>
      values.firstWhere((t) => t.wire == wire, orElse: () => other);
}

/// Número correlativo: hasta 8 dígitos.
const maxDocumentNumber = 99999999;

/// «f 001» → «F001».
String normalizeSeries(String series) => series.replaceAll(RegExp(r'\s+'), '').toUpperCase();

bool isValidSeries(DocType type, String series) => type == DocType.ticket || type == DocType.other
    ? RegExp(r'^[A-Z0-9-]{1,20}$').hasMatch(series)
    : RegExp(r'^[A-Z0-9]{1,4}$').hasMatch(series);

/// Comprobante que acompaña a una venta o a un gasto.
class OperationDocument {
  const OperationDocument({
    required this.type,
    required this.series,
    required this.number,
    this.counterpartyRuc,
    this.counterpartyName,
  });

  final DocType type;
  final String series;
  final int number;
  final String? counterpartyRuc;
  final String? counterpartyName;

  String get label => '$series-$number';

  Map<String, Object> toJson() => {
    'type': type.wire,
    'series': normalizeSeries(series),
    'number': number,
    'counterpartyRuc': ?counterpartyRuc,
    'counterpartyName': ?counterpartyName,
  };
}

/// Qué falta o está mal en el comprobante, en palabras simples; null si está bien.
String? documentProblem(Operation operation, OperationDocument doc, TaxRegime regime) {
  final isSale = operation is Sale;
  if (!isSale && operation is! Expense) return 'Solo las ventas y los gastos llevan comprobante.';
  if (isSale && !doc.type.sale) {
    return 'Ese comprobante no corresponde: un recibo por honorarios es de compra.';
  }
  if (!isValidSeries(doc.type, normalizeSeries(doc.series))) {
    return 'Revisa la serie: son hasta 4 letras o números (F001, B001, E001 o 0001).';
  }
  if (doc.number < 1 || doc.number > maxDocumentNumber) {
    return 'Revisa el número del comprobante.';
  }
  if (isSale && doc.type == DocType.factura && regime == TaxRegime.nrus) {
    return 'En el Nuevo RUS solo emites boletas o tickets, no facturas.';
  }
  final ruc = doc.counterpartyRuc;
  if (doc.type.needsRuc && (ruc == null || ruc.isEmpty)) {
    return 'Escribe el RUC: una factura o un recibo por honorarios siempre lo lleva.';
  }
  if (ruc != null && ruc.isNotEmpty && !isValidRuc(ruc)) {
    return 'El RUC no es válido. Revisa los 11 dígitos.';
  }
  if (operation is Expense &&
      regime != TaxRegime.nrus &&
      operation.withInvoice != (doc.type == DocType.factura)) {
    return 'Con factura, el IGV se descuenta; con otro comprobante, no.';
  }
  return null;
}
