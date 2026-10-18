import 'package:flutter/material.dart';

import 'theme.dart';

/// Contorno de la chakana en un cuadro de 100 × 100, igual que en el sitio.
const chakanaPoints = [
  Offset(35, 5), Offset(65, 5), Offset(65, 20), Offset(80, 20), Offset(80, 35), //
  Offset(95, 35), Offset(95, 65), Offset(80, 65), Offset(80, 80), Offset(65, 80),
  Offset(65, 95), Offset(35, 95), Offset(35, 80), Offset(20, 80), Offset(20, 65),
  Offset(5, 65), Offset(5, 35), Offset(20, 35), Offset(20, 20), Offset(35, 20),
];

/// La marca: chakana de terracota con el Inti al centro y un visto bueno
/// («todo cuadra»). Incaico y moderno, como el sitio.
class ContabiliMark extends StatelessWidget {
  const ContabiliMark({super.key, this.size = 40});

  final double size;

  @override
  Widget build(BuildContext context) {
    return Semantics(
      label: 'Contabili',
      child: SizedBox(
        width: size,
        height: size,
        child: CustomPaint(painter: _MarkPainter()),
      ),
    );
  }
}

class _MarkPainter extends CustomPainter {
  @override
  void paint(Canvas canvas, Size size) {
    final s = size.width / 100;
    final chakana = Path()..addPolygon([for (final p in chakanaPoints) p * s], true);
    canvas.drawPath(chakana, Paint()..color = ContabiliColors.terracotta);
    canvas.drawCircle(Offset(50 * s, 50 * s), 16 * s, Paint()..color = ContabiliColors.gold);
    final check = Path()
      ..moveTo(42.5 * s, 50.5 * s)
      ..lineTo(48 * s, 56 * s)
      ..lineTo(58 * s, 45 * s);
    canvas.drawPath(
      check,
      Paint()
        ..color = ContabiliColors.ink
        ..style = PaintingStyle.stroke
        ..strokeWidth = 4.5 * s
        ..strokeCap = StrokeCap.round
        ..strokeJoin = StrokeJoin.round,
    );
  }

  @override
  bool shouldRepaint(covariant CustomPainter oldDelegate) => false;
}

/// Franja tocapu: pirámides escalonadas de oro sobre terracota, con un punto
/// añil, como en los tejidos y los andenes. Es la misma del sitio.
class TocapuBand extends StatelessWidget {
  const TocapuBand({super.key, this.height = 12});

  final double height;

  @override
  Widget build(BuildContext context) => ExcludeSemantics(
    child: SizedBox(
      height: height,
      width: double.infinity,
      child: CustomPaint(painter: _TocapuPainter()),
    ),
  );
}

class _TocapuPainter extends CustomPainter {
  @override
  void paint(Canvas canvas, Size size) {
    // Unidad de 32 × 12, escalada al alto pedido.
    final k = size.height / 12;
    // Sin recorte, la última unidad se dibujaría fuera de la franja.
    canvas.clipRect(Offset.zero & size);
    canvas.drawRect(Offset.zero & size, Paint()..color = ContabiliColors.terracotta);
    final gold = Paint()..color = ContabiliColors.gold;
    final ink = Paint()..color = ContabiliColors.ink.withValues(alpha: 0.9);
    for (var x = 0.0; x < size.width; x += 32 * k) {
      Offset p(double dx, double dy) => Offset(x + dx * k, dy * k);
      canvas.drawPath(
        Path()..addPolygon([
          p(2, 12), p(2, 9), p(5, 9), p(5, 6), p(8, 6), p(8, 3), p(12, 3), p(12, 6), //
          p(15, 6), p(15, 9), p(18, 9), p(18, 12),
        ], true),
        gold,
      );
      canvas.drawRect(Rect.fromLTWH(x + 9 * k, 7 * k, 2 * k, 2 * k), ink);
      canvas.drawPath(
        Path()..addPolygon([
          p(18, 0), p(18, 3), p(21, 3), p(21, 6), p(24, 6), p(24, 9), p(28, 9), p(28, 6), //
          p(31, 6), p(31, 3), p(32, 3), p(32, 0),
        ], true),
        ink,
      );
    }
  }

  @override
  bool shouldRepaint(covariant CustomPainter oldDelegate) => false;
}

/// Sello de beta, junto a la marca.
class BetaBadge extends StatelessWidget {
  const BetaBadge({super.key});

  @override
  Widget build(BuildContext context) => Container(
    padding: const EdgeInsets.symmetric(horizontal: 7, vertical: 2),
    decoration: BoxDecoration(color: ContabiliColors.gold, borderRadius: BorderRadius.circular(6)),
    child: const Text(
      'BETA',
      style: TextStyle(
        fontSize: 11,
        fontWeight: FontWeight.w900,
        letterSpacing: 0.6,
        color: ContabiliColors.ink,
      ),
    ),
  );
}

/// Marca + nombre + sello beta, para las barras superiores.
class BrandTitle extends StatelessWidget {
  const BrandTitle({super.key, this.text = 'Contabili', this.markSize = 30});

  final String text;
  final double markSize;

  @override
  Widget build(BuildContext context) => Row(
    children: [
      ContabiliMark(size: markSize),
      const SizedBox(width: 10),
      Flexible(child: Text(text, overflow: TextOverflow.ellipsis)),
      const SizedBox(width: 8),
      const BetaBadge(),
    ],
  );
}
