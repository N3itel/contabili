/// Todos los montos son enteros en céntimos de sol, igual que en el backend:
/// S/ 15,50 = 1550. Nunca se usan decimales para dinero.
typedef Cents = int;

/// Para mostrar: 123450 → «S/ 1,234.50» (formato peruano).
String formatSoles(Cents cents) {
  final negative = cents < 0;
  final abs = cents.abs();
  final soles = (abs ~/ 100).toString();
  final buffer = StringBuffer();
  for (var i = 0; i < soles.length; i++) {
    if (i > 0 && (soles.length - i) % 3 == 0) buffer.write(',');
    buffer.write(soles[i]);
  }
  final decimals = (abs % 100).toString().padLeft(2, '0');
  return '${negative ? '-' : ''}S/ $buffer.$decimals';
}

/// Lo que la persona escribe («118», «118.5», «118,50», «1,200.00», «S/ 20»)
/// pasado a céntimos; null si no es un monto válido.
Cents? parseSoles(String input) {
  var text = input.replaceAll(RegExp(r'[\sS/]'), '');
  if (text.isEmpty) return null;
  final lastDot = text.lastIndexOf('.');
  final lastComma = text.lastIndexOf(',');
  if (lastDot >= 0 && lastComma >= 0) {
    // Con los dos, el último es el decimal y el otro separa miles.
    final decimal = lastDot > lastComma ? '.' : ',';
    final thousands = decimal == '.' ? ',' : '.';
    text = text.replaceAll(thousands, '').replaceAll(decimal, '.');
  } else if (lastComma >= 0) {
    // Solo comas: decimal si lleva 1 o 2 cifras después («18,50»); si no, miles.
    final after = text.length - lastComma - 1;
    text = after <= 2 && ','.allMatches(text).length == 1
        ? text.replaceAll(',', '.')
        : text.replaceAll(',', '');
  }
  final match = RegExp(r'^(\d{1,11})(?:\.(\d{1,2}))?$').firstMatch(text);
  if (match == null) return null;
  final soles = int.parse(match.group(1)!);
  final decimals = (match.group(2) ?? '').padRight(2, '0');
  return soles * 100 + int.parse(decimals);
}
