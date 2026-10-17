import 'package:flutter/material.dart';

import 'theme.dart';

/// La marca: una C que abraza un visto bueno («todo cuadra»), blanca sobre
/// verde. Dibujada con los mismos trazos que el sitio.
class ContabiliMark extends StatelessWidget {
  const ContabiliMark({super.key, this.size = 40});

  final double size;

  @override
  Widget build(BuildContext context) {
    return Semantics(
      label: 'Contabili',
      child: Container(
        width: size,
        height: size,
        decoration: BoxDecoration(
          color: ContabiliColors.green,
          borderRadius: BorderRadius.circular(size * 0.22),
        ),
        child: CustomPaint(painter: _MarkPainter()),
      ),
    );
  }
}

class _MarkPainter extends CustomPainter {
  @override
  void paint(Canvas canvas, Size size) {
    final s = size.width / 100;
    final paint = Paint()
      ..color = Colors.white
      ..style = PaintingStyle.stroke
      ..strokeCap = StrokeCap.round
      ..strokeJoin = StrokeJoin.round;
    // Igual que el SVG: arco de (68,31) a (68,69), radio 26, por la izquierda.
    final arc = Path()
      ..moveTo(68 * s, 31 * s)
      ..arcToPoint(
        Offset(68 * s, 69 * s),
        radius: Radius.circular(26 * s),
        largeArc: true,
        clockwise: false,
      );
    canvas.drawPath(arc, paint..strokeWidth = 11 * s);
    final check = Path()
      ..moveTo(41 * s, 50 * s)
      ..lineTo(49.5 * s, 58.5 * s)
      ..lineTo(64 * s, 43 * s);
    canvas.drawPath(check, paint..strokeWidth = 9 * s);
  }

  @override
  bool shouldRepaint(covariant CustomPainter oldDelegate) => false;
}
