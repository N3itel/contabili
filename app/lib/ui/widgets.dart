import 'package:flutter/material.dart';

import '../api/api.dart';
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
      decoration: BoxDecoration(color: background, borderRadius: BorderRadius.circular(16)),
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
