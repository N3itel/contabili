/// La fecha de negocio es la de Lima: UTC−5 siempre (el Perú no tiene horario
/// de verano). Replica `limaDate()` de `backend/src/accounting/lima.ts`.
String limaDate(DateTime at) {
  final lima = at.toUtc().subtract(const Duration(hours: 5));
  return '${lima.year.toString().padLeft(4, '0')}-${_two(lima.month)}-${_two(lima.day)}';
}

String _two(int n) => n.toString().padLeft(2, '0');

const _months = [
  'enero',
  'febrero',
  'marzo',
  'abril',
  'mayo',
  'junio',
  'julio',
  'agosto',
  'septiembre',
  'octubre',
  'noviembre',
  'diciembre',
];

/// '2026-10' → 'octubre de 2026'.
String periodLabel(String period) {
  final year = period.substring(0, 4);
  final month = int.parse(period.substring(5, 7));
  return '${_months[month - 1]} de $year';
}

/// Solo el mes: '2026-10' → 'octubre'.
String monthName(String period) => _months[int.parse(period.substring(5, 7)) - 1];

/// Mes siguiente o anterior: shiftPeriod('2026-01', -1) → '2025-12'.
String shiftPeriod(String period, int months) {
  final year = int.parse(period.substring(0, 4));
  final month = int.parse(period.substring(5, 7)) - 1 + months;
  final y = year + (month / 12).floor();
  final m = month % 12 + 1;
  return '$y-${_two(m)}';
}

/// Para mostrar: '2026-10-17' → '17/10/2026'.
String formatDate(String date) =>
    '${date.substring(8, 10)}/${date.substring(5, 7)}/${date.substring(0, 4)}';

/// Para mostrar una fecha con hora del servidor, en Lima: '16/11/2026'.
String formatInstant(DateTime at) => formatDate(limaDate(at));
