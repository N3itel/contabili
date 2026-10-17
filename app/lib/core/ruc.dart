/// RUC de SUNAT: 11 dígitos, prefijo de tipo de contribuyente y dígito
/// verificador (módulo 11). Replica `backend/src/tax/ruc.ts`.
const _weights = [5, 4, 3, 2, 7, 6, 5, 4, 3, 2];
const _prefixes = {'10', '15', '16', '17', '20'};

int rucCheckDigit(String first10) {
  var sum = 0;
  for (var i = 0; i < 10; i++) {
    sum += _weights[i] * int.parse(first10[i]);
  }
  final r = 11 - (sum % 11);
  return r == 10 ? 0 : (r == 11 ? 1 : r);
}

bool isValidRuc(String ruc) {
  if (!RegExp(r'^\d{11}$').hasMatch(ruc)) return false;
  if (!_prefixes.contains(ruc.substring(0, 2))) return false;
  return rucCheckDigit(ruc.substring(0, 10)) == int.parse(ruc[10]);
}
