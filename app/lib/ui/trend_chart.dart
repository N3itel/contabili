import 'package:flutter/material.dart';

import '../api/api.dart';
import '../core/dates.dart';
import '../core/money.dart';
import 'theme.dart';

/// Barras de ventas (verde) y gastos (terracota) de los últimos meses. Hechas
/// con cajas, así crecen con la letra y se leen con el lector de pantalla.
class TrendChart extends StatelessWidget {
  const TrendChart({super.key, required this.points, this.height = 140});

  final List<TrendPoint> points;
  final double height;

  @override
  Widget build(BuildContext context) {
    final max = points.fold<int>(
      1,
      (m, p) => [m, p.sales, p.expenses].reduce((a, b) => a > b ? a : b),
    );
    final description = [
      for (final p in points)
        '${monthName(p.period)}: vendiste ${formatSoles(p.sales)} y gastaste ${formatSoles(p.expenses)}',
    ].join('. ');
    return Semantics(
      label: 'Ventas y gastos de los últimos meses. $description',
      child: ExcludeSemantics(
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.stretch,
          children: [
            SizedBox(
              height: height,
              child: Row(
                crossAxisAlignment: CrossAxisAlignment.end,
                children: [
                  for (final p in points)
                    Expanded(
                      child: Padding(
                        padding: const EdgeInsets.symmetric(horizontal: 4),
                        child: Row(
                          crossAxisAlignment: CrossAxisAlignment.end,
                          children: [
                            _Bar(
                              value: p.sales,
                              max: max,
                              color: ContabiliColors.green,
                              height: height,
                            ),
                            const SizedBox(width: 3),
                            _Bar(
                              value: p.expenses,
                              max: max,
                              color: ContabiliColors.terracotta,
                              height: height,
                            ),
                          ],
                        ),
                      ),
                    ),
                ],
              ),
            ),
            const SizedBox(height: 6),
            Row(
              children: [
                for (final p in points)
                  Expanded(
                    child: Text(
                      monthName(p.period).substring(0, 3),
                      textAlign: TextAlign.center,
                      style: const TextStyle(fontSize: 13, color: ContabiliColors.ink2),
                    ),
                  ),
              ],
            ),
            const SizedBox(height: 8),
            const Row(
              children: [
                _Legend(color: ContabiliColors.green, label: 'Ventas'),
                SizedBox(width: 16),
                _Legend(color: ContabiliColors.terracotta, label: 'Gastos'),
              ],
            ),
          ],
        ),
      ),
    );
  }
}

class _Bar extends StatelessWidget {
  const _Bar({required this.value, required this.max, required this.color, required this.height});

  final int value;
  final int max;
  final Color color;
  final double height;

  @override
  Widget build(BuildContext context) => Expanded(
    child: Container(
      height: value <= 0 ? 2 : (value / max * height).clamp(4, height),
      decoration: BoxDecoration(
        color: value <= 0 ? ContabiliColors.line : color,
        borderRadius: const BorderRadius.vertical(top: Radius.circular(4)),
      ),
    ),
  );
}

class _Legend extends StatelessWidget {
  const _Legend({required this.color, required this.label});

  final Color color;
  final String label;

  @override
  Widget build(BuildContext context) => Row(
    children: [
      Container(width: 12, height: 12, color: color),
      const SizedBox(width: 6),
      Text(label, style: const TextStyle(fontSize: 14)),
    ],
  );
}
