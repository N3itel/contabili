import 'money.dart';

/// Tasa general: 16 % de IGV más 2 % de Impuesto de Promoción Municipal.
/// Replica `backend/src/tax/igv.ts`: un cambio de regla va en los dos lados.
const igvRatePercent = 18;

class IgvBreakdown {
  const IgvBreakdown({required this.base, required this.igv, required this.total});

  /// Valor de venta (base imponible).
  final Cents base;
  final Cents igv;

  /// Precio de venta: base + IGV.
  final Cents total;

  @override
  bool operator ==(Object other) =>
      other is IgvBreakdown && other.base == base && other.igv == igv && other.total == total;

  @override
  int get hashCode => Object.hash(base, igv, total);

  @override
  String toString() => 'IgvBreakdown(base: $base, igv: $igv, total: $total)';
}

/// Desde el precio con IGV incluido: la base se redondea y el IGV es la
/// diferencia, así base + IGV siempre da el total exacto.
IgvBreakdown igvFromTotal(Cents total, [int rate = igvRatePercent]) {
  final base = (total * 100 / (100 + rate)).round();
  return IgvBreakdown(base: base, igv: total - base, total: total);
}
