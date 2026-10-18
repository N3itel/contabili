import 'package:flutter/material.dart';

import '../api/api.dart';
import '../core/money.dart';
import 'andean.dart';
import 'theme.dart';

/// Ancho cómodo para leer en una computadora: el contenido no se estira.
class ReadableWidth extends StatelessWidget {
  const ReadableWidth({super.key, required this.child, this.maxWidth = 760});

  final Widget child;
  final double maxWidth;

  @override
  Widget build(BuildContext context) => Align(
    alignment: Alignment.topCenter,
    child: ConstrainedBox(
      constraints: BoxConstraints(maxWidth: maxWidth),
      child: child,
    ),
  );
}

/// Mensaje destacado: informativo, de cuidado o de error.
enum NoticeTone { info, warning, error }

class Notice extends StatelessWidget {
  const Notice({super.key, required this.text, this.tone = NoticeTone.info, this.action});

  final String text;
  final NoticeTone tone;
  final Widget? action;

  @override
  Widget build(BuildContext context) {
    final (background, foreground, icon) = switch (tone) {
      NoticeTone.info => (ContabiliColors.mint, ContabiliColors.green, Icons.info_outline),
      NoticeTone.warning => (
        ContabiliColors.amberSoft,
        ContabiliColors.amber,
        Icons.schedule_outlined,
      ),
      NoticeTone.error => (ContabiliColors.redSoft, ContabiliColors.red, Icons.error_outline),
    };
    return Container(
      padding: const EdgeInsets.all(14),
      decoration: BoxDecoration(
        color: background,
        borderRadius: BorderRadius.circular(18),
        border: Border.all(color: foreground.withValues(alpha: 0.18)),
      ),
      child: Row(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Icon(icon, color: foreground),
          const SizedBox(width: 10),
          Expanded(
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Text(
                  text,
                  style: TextStyle(color: foreground, fontWeight: FontWeight.w600, fontSize: 16),
                ),
                ?action,
              ],
            ),
          ),
        ],
      ),
    );
  }
}

/// Error de la API para mostrar debajo de un formulario.
class ErrorText extends StatelessWidget {
  const ErrorText(this.message, {super.key});

  final String? message;

  @override
  Widget build(BuildContext context) {
    final text = message;
    if (text == null) return const SizedBox.shrink();
    return Padding(
      padding: const EdgeInsets.only(top: 12),
      child: Notice(text: text, tone: NoticeTone.error),
    );
  }
}

/// Pantalla de carga o de error con «Reintentar».
class LoadState extends StatelessWidget {
  const LoadState({super.key, this.error, this.onRetry});

  final Object? error;
  final VoidCallback? onRetry;

  @override
  Widget build(BuildContext context) {
    final error = this.error;
    if (error == null) return const Center(child: CircularProgressIndicator());
    return Center(
      child: Padding(
        padding: const EdgeInsets.all(24),
        child: Column(
          mainAxisSize: MainAxisSize.min,
          children: [
            Text(
              error is ApiException ? error.message : 'Algo salió mal. Intenta de nuevo.',
              textAlign: TextAlign.center,
              style: Theme.of(context).textTheme.bodyLarge,
            ),
            const SizedBox(height: 16),
            if (onRetry != null)
              OutlinedButton(onPressed: onRetry, child: const Text('Reintentar')),
          ],
        ),
      ),
    );
  }
}

/// Elegir una opción entre pocas, con botones grandes (más fácil que una lista).
class ChoiceRow<T> extends StatelessWidget {
  const ChoiceRow({
    super.key,
    required this.label,
    required this.options,
    required this.value,
    required this.onChanged,
  });

  final String label;
  final List<(T, String, IconData)> options;
  final T value;
  final ValueChanged<T> onChanged;

  @override
  Widget build(BuildContext context) {
    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        Text(label, style: Theme.of(context).textTheme.titleMedium),
        const SizedBox(height: 8),
        Wrap(
          spacing: 8,
          runSpacing: 8,
          children: [
            for (final (option, text, icon) in options)
              ChoiceChip(
                avatar: Icon(icon, size: 20),
                label: Text(text),
                selected: option == value,
                showCheckmark: false,
                onSelected: (_) => onChanged(option),
              ),
          ],
        ),
      ],
    );
  }
}

/// Título de sección con los peldaños de oro y, si hace falta, una acción.
class SectionTitle extends StatelessWidget {
  const SectionTitle(this.text, {super.key, this.action});

  final String text;
  final Widget? action;

  @override
  Widget build(BuildContext context) {
    return Padding(
      padding: const EdgeInsets.only(bottom: 12),
      child: Row(
        children: [
          const StepGlyph(),
          const SizedBox(width: 10),
          Expanded(
            child: Semantics(
              header: true,
              child: Text(text, style: Theme.of(context).textTheme.titleLarge),
            ),
          ),
          ?action,
        ],
      ),
    );
  }
}

/// Ícono dentro de un cuadro redondeado de color suave.
class IconBox extends StatelessWidget {
  const IconBox({
    super.key,
    required this.icon,
    required this.color,
    required this.background,
    this.size = 46,
  });

  final IconData icon;
  final Color color;
  final Color background;
  final double size;

  @override
  Widget build(BuildContext context) => Container(
    width: size,
    height: size,
    decoration: BoxDecoration(color: background, borderRadius: BorderRadius.circular(size * 0.32)),
    child: Icon(icon, color: color, size: size * 0.52),
  );
}

/// Una cifra con su ícono, nombre y explicación corta.
class StatTile extends StatelessWidget {
  const StatTile({
    super.key,
    required this.icon,
    required this.label,
    required this.amount,
    required this.detail,
    this.color = ContabiliColors.ink,
    this.iconColor = ContabiliColors.terracotta,
    this.iconBackground = ContabiliColors.terracottaSoft,
    this.onTap,
  });

  final IconData icon;
  final String label;
  final Cents amount;
  final String detail;
  final Color color;
  final Color iconColor;
  final Color iconBackground;
  final VoidCallback? onTap;

  @override
  Widget build(BuildContext context) {
    return Card(
      child: InkWell(
        onTap: onTap,
        child: Padding(
          padding: const EdgeInsets.all(16),
          child: Row(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              IconBox(icon: icon, color: iconColor, background: iconBackground),
              const SizedBox(width: 14),
              Expanded(
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    Text(label, style: const TextStyle(fontSize: 15, color: ContabiliColors.ink2)),
                    const SizedBox(height: 2),
                    Text(formatSoles(amount), style: ContabiliFonts.amount(26, color: color)),
                    const SizedBox(height: 4),
                    Text(detail, style: Theme.of(context).textTheme.bodySmall),
                  ],
                ),
              ),
              if (onTap != null) const Icon(Icons.chevron_right, color: ContabiliColors.ink3),
            ],
          ),
        ),
      ),
    );
  }
}

/// Iniciales en un cuadro de color, como un tocapu: distingue a cada cliente,
/// empresa o persona de un vistazo.
class InitialsAvatar extends StatelessWidget {
  const InitialsAvatar({super.key, required this.name, this.size = 44});

  final String name;
  final double size;

  static const _tones = [
    (ContabiliColors.terracottaSoft, ContabiliColors.terracottaDark),
    (ContabiliColors.goldSoft, ContabiliColors.amber),
    (ContabiliColors.indigoSoft, ContabiliColors.indigo),
    (ContabiliColors.greenSoft, ContabiliColors.green),
  ];

  String get _initials {
    final words = name
        .split(RegExp(r'\s+'))
        .where((w) => w.isNotEmpty && w.toUpperCase() != w.toLowerCase())
        .toList();
    if (words.isEmpty) return '?';
    final first = words.first.characters.first;
    final second = words.length > 1 ? words[1].characters.first : '';
    return (first + second).toUpperCase();
  }

  @override
  Widget build(BuildContext context) {
    final (background, foreground) =
        _tones[name.codeUnits.fold(0, (a, b) => a + b) % _tones.length];
    return ExcludeSemantics(
      child: Container(
        width: size,
        height: size,
        alignment: Alignment.center,
        decoration: BoxDecoration(
          color: background,
          borderRadius: BorderRadius.circular(size * 0.3),
        ),
        child: Text(
          _initials,
          style: TextStyle(
            fontFamily: ContabiliFonts.display,
            fontWeight: FontWeight.w800,
            fontSize: size * 0.4,
            color: foreground,
          ),
        ),
      ),
    );
  }
}

/// Pantalla vacía con los andenes: qué falta y qué hacer.
class EmptyState extends StatelessWidget {
  const EmptyState({super.key, required this.title, required this.message, this.action});

  final String title;
  final String message;
  final Widget? action;

  @override
  Widget build(BuildContext context) {
    return Card(
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.stretch,
        children: [
          const AndesIllustration(height: 120),
          Padding(
            padding: const EdgeInsets.fromLTRB(20, 16, 20, 20),
            child: Column(
              children: [
                Text(title, textAlign: TextAlign.center, style: ContabiliFonts.title(21)),
                const SizedBox(height: 6),
                Text(
                  message,
                  textAlign: TextAlign.center,
                  style: const TextStyle(fontSize: 16, color: ContabiliColors.ink2, height: 1.45),
                ),
                if (action != null) ...[const SizedBox(height: 16), action!],
              ],
            ),
          ),
        ],
      ),
    );
  }
}
