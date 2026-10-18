import 'package:flutter/material.dart';

import 'brand.dart';
import 'theme.dart';

/// Trama de chakanas pequeñas, en filas alternadas como un tejido. Va de
/// fondo en los paneles de color, siempre muy tenue.
class ChakanaPattern extends CustomPainter {
  const ChakanaPattern({required this.color, this.cell = 46, this.mark = 16});

  final Color color;
  final double cell;
  final double mark;

  @override
  void paint(Canvas canvas, Size size) {
    final paint = Paint()
      ..color = color
      ..style = PaintingStyle.stroke
      ..strokeWidth = 1.4;
    final k = mark / 100;
    var row = 0;
    for (var y = -cell / 2; y < size.height + cell; y += cell * 0.8, row++) {
      final shift = row.isOdd ? cell / 2 : 0.0;
      for (var x = -cell + shift; x < size.width + cell; x += cell) {
        final path = Path()
          ..addPolygon([for (final p in chakanaPoints) Offset(x + p.dx * k, y + p.dy * k)], true);
        canvas.drawPath(path, paint);
      }
    }
  }

  @override
  bool shouldRepaint(covariant ChakanaPattern old) =>
      old.color != color || old.cell != cell || old.mark != mark;
}

/// Andenes al pie de los cerros, con el Inti: la ilustración de la casa.
/// Va en el ingreso y en las pantallas vacías.
class AndesIllustration extends StatelessWidget {
  const AndesIllustration({super.key, this.height = 140, this.night = false});

  final double height;

  /// Sobre fondo terracota (ingreso): colores más cálidos y sin cielo.
  final bool night;

  @override
  Widget build(BuildContext context) => ExcludeSemantics(
    child: SizedBox(
      height: height,
      width: double.infinity,
      child: CustomPaint(painter: _AndesPainter(night: night)),
    ),
  );
}

class _AndesPainter extends CustomPainter {
  const _AndesPainter({required this.night});

  final bool night;

  @override
  void paint(Canvas canvas, Size size) {
    final w = size.width, h = size.height;
    if (!night) {
      canvas.drawRect(
        Offset.zero & size,
        Paint()
          ..shader = const LinearGradient(
            begin: Alignment.topCenter,
            end: Alignment.bottomCenter,
            colors: [ContabiliColors.goldSoft, ContabiliColors.paper],
          ).createShader(Offset.zero & size),
      );
    }
    // El Inti, con rayos escalonados.
    final sun = Offset(w * 0.74, h * 0.34);
    final r = h * 0.17;
    final rays = Paint()..color = ContabiliColors.gold.withValues(alpha: night ? 0.55 : 0.35);
    for (var i = 0; i < 8; i++) {
      canvas.save();
      canvas.translate(sun.dx, sun.dy);
      canvas.rotate(i * 3.14159 / 4);
      canvas.drawRect(Rect.fromLTWH(-r * 0.12, -r * 1.75, r * 0.24, r * 0.45), rays);
      canvas.restore();
    }
    canvas.drawCircle(
      sun,
      r,
      Paint()..color = night ? ContabiliColors.goldLight : ContabiliColors.gold,
    );

    // Cerros escalonados, como andenes vistos de lejos.
    Path steps(double base, double peakX, double peakY, int up, int down) {
      final path = Path()
        ..moveTo(0, h)
        ..lineTo(0, base);
      var x = 0.0, y = base;
      for (var i = 0; i < up; i++) {
        y -= (base - peakY) / up;
        path.lineTo(x, y);
        x += peakX / up;
        path.lineTo(x, y);
      }
      for (var i = 0; i < down; i++) {
        x += (w - peakX) / down;
        path.lineTo(x, y);
        y += (base - peakY) / down;
        path.lineTo(x, y);
      }
      return path
        ..lineTo(w, h)
        ..close();
    }

    canvas.drawPath(
      steps(h * 0.8, w * 0.3, h * 0.2, 4, 6),
      Paint()..color = night ? ContabiliColors.terracottaDeep : ContabiliColors.indigo,
    );
    canvas.drawPath(
      steps(h * 0.92, w * 0.62, h * 0.42, 4, 3),
      Paint()..color = night ? const Color(0xFF7A2A1B) : const Color(0xFF4F6297),
    );

    // Andenes: franjas curvas en verdes.
    const greens = [Color(0xFF2F7A52), Color(0xFF3E8D61), Color(0xFF55A174), Color(0xFF74B88E)];
    final band = h * 0.085;
    for (var i = 0; i < greens.length; i++) {
      final top = h * 0.66 + i * band;
      final path = Path()
        ..moveTo(0, top + band * 0.6)
        ..quadraticBezierTo(w * 0.5, top - band * 0.9, w, top + band * 0.6)
        ..lineTo(w, h)
        ..lineTo(0, h)
        ..close();
      canvas.drawPath(path, Paint()..color = greens[greens.length - 1 - i]);
    }
  }

  @override
  bool shouldRepaint(covariant _AndesPainter old) => old.night != night;
}

/// Panel principal de color terracota con la trama de chakanas: la cifra
/// más importante de la pantalla va aquí.
class HeroPanel extends StatelessWidget {
  const HeroPanel({
    super.key,
    required this.child,
    this.colors = const [ContabiliColors.terracotta, ContabiliColors.terracottaDark],
    this.padding = const EdgeInsets.fromLTRB(22, 22, 22, 0),
    this.band = true,
  });

  final Widget child;
  final List<Color> colors;
  final EdgeInsets padding;

  /// Franja tocapu al pie del panel.
  final bool band;

  @override
  Widget build(BuildContext context) {
    return DecoratedBox(
      decoration: BoxDecoration(
        borderRadius: BorderRadius.circular(28),
        boxShadow: ContabiliShadows.raised,
      ),
      child: ClipRRect(
        borderRadius: BorderRadius.circular(28),
        child: DecoratedBox(
          decoration: BoxDecoration(
            gradient: LinearGradient(
              begin: Alignment.topLeft,
              end: Alignment.bottomRight,
              colors: colors,
            ),
          ),
          child: CustomPaint(
            painter: ChakanaPattern(color: Colors.white.withValues(alpha: 0.07)),
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.stretch,
              children: [
                Padding(
                  padding: padding.copyWith(bottom: padding.bottom + 20),
                  child: child,
                ),
                if (band) const TocapuBand(height: 10),
              ],
            ),
          ),
        ),
      ),
    );
  }
}

/// Peldaños de oro: el adorno de los títulos de sección.
class StepGlyph extends StatelessWidget {
  const StepGlyph({super.key, this.size = 18, this.color = ContabiliColors.gold});

  final double size;
  final Color color;

  @override
  Widget build(BuildContext context) => ExcludeSemantics(
    child: SizedBox.square(
      dimension: size,
      child: CustomPaint(painter: _StepPainter(color)),
    ),
  );
}

class _StepPainter extends CustomPainter {
  const _StepPainter(this.color);

  final Color color;

  @override
  void paint(Canvas canvas, Size size) {
    final u = size.width / 3;
    final paint = Paint()..color = color;
    canvas
      ..drawRect(Rect.fromLTWH(0, 2 * u, 3 * u, u), paint)
      ..drawRect(Rect.fromLTWH(u, u, 2 * u, u), paint)
      ..drawRect(Rect.fromLTWH(2 * u, 0, u, u), paint);
  }

  @override
  bool shouldRepaint(covariant _StepPainter old) => old.color != color;
}
