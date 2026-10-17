import 'dart:io';

import 'package:contabili/version.dart';
import 'package:flutter_test/flutter_test.dart';

void main() {
  test('la versión de la app coincide con pubspec.yaml', () {
    final pubspec = File('pubspec.yaml').readAsStringSync();
    final version = RegExp(r'^version: (\S+)\+(\d+)$', multiLine: true).firstMatch(pubspec)!;
    expect(version.group(1), appVersion);
    expect(int.parse(version.group(2)!), appBuild);
  });
}
