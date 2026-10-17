import 'igv.dart';
import 'money.dart';

/// Operaciones del día a día, como en `backend/src/accounting/operations.ts`.
/// La app solo arma lo que la persona eligió y muestra una vista previa del
/// IGV; el asiento lo arma el servidor.
enum Money {
  cash('cash', 'Efectivo'),
  bank('bank', 'Banco o Yape');

  const Money(this.wire, this.label);
  final String wire;
  final String label;
}

/// Al contado (caja o banco) o al crédito (queda por cobrar o por pagar).
enum Settlement {
  cash('cash'),
  bank('bank'),
  credit('credit');

  const Settlement(this.wire);
  final String wire;
}

enum SaleKind {
  goods('goods', 'Productos'),
  services('services', 'Servicios');

  const SaleKind(this.wire, this.label);
  final String wire;
  final String label;
}

enum ExpenseCategory {
  goods('goods', 'Mercadería', 'Lo que compras para vender'),
  services('services', 'Servicios', 'Luz, agua, internet, alquiler, transporte'),
  payroll('payroll', 'Sueldos', 'Lo que pagas a tu equipo'),
  taxes('taxes', 'Impuestos', 'Tributos y arbitrios'),
  financial('financial', 'Banco o intereses', 'Comisiones del banco, intereses'),
  other('other', 'Otro gasto', 'Útiles, limpieza, mantenimiento');

  const ExpenseCategory(this.wire, this.label, this.hint);
  final String wire;
  final String label;
  final String hint;

  /// Los sueldos, tributos e intereses no llevan IGV en la factura.
  bool get carriesIgv => this == goods || this == services || this == other;
}

enum TaxRegime {
  nrus('nrus', 'Nuevo RUS', 'Pagas una cuota fija al mes y emites boletas.'),
  rer('rer', 'Régimen Especial (RER)', 'Pagas 1,5 % de tus ingresos y el IGV.'),
  rmt('rmt', 'Régimen MYPE Tributario', 'El más común en pequeñas empresas.'),
  general('general', 'Régimen General', 'Para empresas medianas y grandes.');

  const TaxRegime(this.wire, this.label, this.hint);
  final String wire;
  final String label;
  final String hint;

  /// El Nuevo RUS no cobra IGV aparte ni usa crédito fiscal.
  bool get chargesIgv => this != nrus;

  static TaxRegime fromWire(String wire) =>
      values.firstWhere((r) => r.wire == wire, orElse: () => general);
}

sealed class Operation {
  const Operation(this.total);
  final Cents total;

  Map<String, Object> toJson();
}

class Sale extends Operation {
  const Sale(super.total, {required this.kind, required this.paidWith});
  final SaleKind kind;
  final Settlement paidWith;

  @override
  Map<String, Object> toJson() => {
    'type': 'sale',
    'total': total,
    'kind': kind.wire,
    'paidWith': paidWith.wire,
  };
}

class Expense extends Operation {
  const Expense(
    super.total, {
    required this.category,
    required this.paidWith,
    required this.withInvoice,
  });
  final ExpenseCategory category;
  final Settlement paidWith;
  final bool withInvoice;

  @override
  Map<String, Object> toJson() => {
    'type': 'expense',
    'total': total,
    'category': category.wire,
    'paidWith': paidWith.wire,
    'withInvoice': withInvoice,
  };
}

class Collection extends Operation {
  const Collection(super.total, {required this.into});
  final Money into;

  @override
  Map<String, Object> toJson() => {'type': 'collection', 'total': total, 'into': into.wire};
}

class Payment extends Operation {
  const Payment(super.total, {required this.from});
  final Money from;

  @override
  Map<String, Object> toJson() => {'type': 'payment', 'total': total, 'from': from.wire};
}

/// Cuánto de la operación es IGV, con las mismas reglas del servidor.
IgvBreakdown operationIgv(Operation op, TaxRegime regime) {
  final noIgv = IgvBreakdown(base: op.total, igv: 0, total: op.total);
  return switch (op) {
    Sale() => regime.chargesIgv ? igvFromTotal(op.total) : noIgv,
    Expense(:final withInvoice, :final category) =>
      withInvoice && regime.chargesIgv && category.carriesIgv ? igvFromTotal(op.total) : noIgv,
    Collection() || Payment() => noIgv,
  };
}
