import 'dart:io';
import 'dart:math';
import 'dart:ui' as ui;

import 'package:contabili/api/http_api.dart';
import 'package:contabili/api/session_store.dart';
import 'package:contabili/app.dart';
import 'package:contabili/core/dates.dart';
import 'package:contabili/core/ruc.dart';
import 'package:contabili/session/session.dart';
import 'package:flutter/material.dart';
import 'package:flutter/rendering.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:integration_test/integration_test.dart';

/// La app real contra un backend real (SMS por consola). Uso:
/// flutter test integration_test -d linux \
///   --dart-define=CONTABILI_API=http://localhost:3100/api/v1 \
///   --dart-define=SMS_LOG=/ruta/al/log/del/backend \
///   --dart-define=SHOTS=/carpeta/para/capturas
const _api = String.fromEnvironment('CONTABILI_API');
const _smsLog = String.fromEnvironment('SMS_LOG');
const _shots = String.fromEnvironment('SHOTS');

final _boundary = GlobalKey();

Future<void> _shot(WidgetTester tester, String name) async {
  if (_shots.isEmpty) return;
  await tester.pumpAndSettle();
  final render = _boundary.currentContext!.findRenderObject()! as RenderRepaintBoundary;
  final image = await render.toImage(pixelRatio: 1);
  final png = await image.toByteData(format: ui.ImageByteFormat.png);
  File('$_shots/$name.png').writeAsBytesSync(png!.buffer.asUint8List());
}

/// El último código que el backend escribió en su log para ese celular.
Future<String> _codeFor(String phone) async {
  final tail = phone.substring(phone.length - 3);
  for (var i = 0; i < 50; i++) {
    final log = File(_smsLog).readAsStringSync();
    final matches = RegExp('••• $tail: Contabili: tu código es (\\d{6})').allMatches(log);
    if (matches.isNotEmpty) return matches.last.group(1)!;
    await Future<void>.delayed(const Duration(milliseconds: 100));
  }
  throw StateError('No llegó el código al log');
}

Future<void> _settle(WidgetTester tester, {int seconds = 10}) async {
  // Las llamadas HTTP son reales: se espera a que terminen.
  for (var i = 0; i < seconds * 10; i++) {
    await tester.pump(const Duration(milliseconds: 100));
    if (!tester.binding.hasScheduledFrame) break;
  }
  await tester.pumpAndSettle();
}

Future<void> _waitFor(WidgetTester tester, Finder finder) async {
  for (var i = 0; i < 100; i++) {
    await tester.pump(const Duration(milliseconds: 100));
    if (finder.evaluate().isNotEmpty) return;
  }
  expect(finder, findsWidgets);
}

Future<void> _tap(WidgetTester tester, String text) async {
  final finder = find.text(text).last;
  await tester.ensureVisible(finder);
  await tester.pumpAndSettle();
  await tester.tap(finder);
  await _settle(tester);
}

String _randomRuc() {
  final first10 = '20${Random().nextInt(90000000) + 10000000}';
  return '$first10${rucCheckDigit(first10)}';
}

void main() {
  IntegrationTestWidgetsFlutterBinding.ensureInitialized();

  testWidgets('de punta a punta: ingreso, empresa, ventas, clientes e impuestos', (tester) async {
    expect(_api, isNotEmpty, reason: 'Falta --dart-define=CONTABILI_API');
    final store = MemorySessionStore();
    final api = HttpContabiliApi(baseUrl: Uri.parse(_api), store: store);
    final session = SessionController(
      api,
      store: store,
      webUrl: Uri.parse('http://localhost'),
      openLink: (_) async => true,
    );
    api.onSessionExpired = session.expired;
    await tester.pumpWidget(
      RepaintBoundary(
        key: _boundary,
        child: ContabiliApp(session: session),
      ),
    );
    await _settle(tester);

    final phone = '9${Random().nextInt(90000000) + 10000000}';
    await _shot(tester, '1-ingreso');
    await tester.enterText(find.byType(TextField), phone);
    await _tap(tester, 'Enviarme el código');
    await _waitFor(tester, find.text('Escribe el código'));
    await tester.enterText(find.byType(TextField), await _codeFor(phone));
    await _waitFor(tester, find.text('¿Cómo te llamas?'));
    await tester.enterText(find.byType(TextField), 'Rosa Quispe');
    await tester.tap(find.byType(Checkbox));
    await tester.pump();
    await _tap(tester, 'Crear mi cuenta');
    await _waitFor(tester, find.text('Hola, Rosa'));

    await _tap(tester, 'Crear mi empresa');
    await tester.enterText(find.byType(TextField).first, _randomRuc());
    await tester.enterText(find.byType(TextField).at(1), 'BODEGA DOÑA ROSA EIRL');
    await _tap(tester, 'Régimen MYPE Tributario');
    await _shot(tester, '2-empresa');
    await _tap(tester, 'Crear mi empresa');
    await _waitFor(tester, find.text('¿Qué pasó hoy?'));
    await _shot(tester, '3-inicio-vacio');

    await _tap(tester, 'Vendí');
    await tester.enterText(find.byType(TextField).first, '118');
    await tester.pump();
    expect(find.text('S/ 100.00 es tu venta y S/ 18.00 es IGV.'), findsOneWidget);
    await _shot(tester, '4-venta');
    await _tap(tester, 'Guardar');
    await _waitFor(tester, find.text('¡Listo, quedó anotado!'));
    // La explicación es la del servidor (separa «S/» del monto con un espacio duro).
    expect(find.textContaining('es IGV que le toca a SUNAT'), findsOneWidget);
    await _shot(tester, '5-listo');
    await _tap(tester, 'Listo');

    await _tap(tester, 'Gasté');
    await tester.enterText(find.byType(TextField).first, '59');
    await _tap(tester, 'Banco o Yape');
    await _tap(tester, 'Guardar');
    await _waitFor(tester, find.text('¡Listo, quedó anotado!'));
    await _tap(tester, 'Listo');

    // El resumen viene del backend: 118 en caja, -59 en el banco, IGV 18 - 9 = 9.
    await _waitFor(tester, find.text('S/ 59.00'));
    expect(find.text('Caja S/ 118.00'), findsOneWidget);
    expect(find.text('Bancos -S/ 59.00'), findsOneWidget);
    expect(find.text('S/ 9.00'), findsOneWidget);
    await _shot(tester, '6-inicio');

    await _tap(tester, 'Movimientos');
    await _waitFor(tester, find.text('Venta de mercadería al contado'));
    expect(find.text('Gasto: servicios'), findsOneWidget);
    await _shot(tester, '7-movimientos');

    // Un cliente nuevo y una venta al crédito a su nombre.
    await _tap(tester, 'Clientes');
    await _waitFor(tester, find.text('Agregar cliente'));
    await _tap(tester, 'Agregar cliente');
    await tester.enterText(
      find.descendant(of: find.byType(AlertDialog), matching: find.byType(TextField)).first,
      'Comercial Andina',
    );
    await tester.pump();
    await tester.tap(find.widgetWithText(FilledButton, 'Guardar'));
    await _settle(tester);
    await _waitFor(tester, find.text('Comercial Andina'));

    await _tap(tester, 'Inicio');
    await _tap(tester, 'Vendí');
    await tester.enterText(find.byType(TextField).first, '236');
    await _tap(tester, 'Me lo deben');
    await _waitFor(tester, find.widgetWithText(ChoiceChip, 'Comercial Andina'));
    await _tap(tester, 'Comercial Andina');
    await _tap(tester, 'Boleta');
    await tester.enterText(find.widgetWithText(TextField, 'Serie'), 'b001');
    await tester.enterText(find.widgetWithText(TextField, 'Número'), '1');
    await tester.pump();
    await _tap(tester, 'Guardar');
    await _waitFor(tester, find.text('¡Listo, quedó anotado!'));
    await _tap(tester, 'Listo');
    await _waitFor(tester, find.text('Tus últimos meses'));
    await _shot(tester, '8-inicio-grafico');

    // La boleta quedó en el registro de ventas del servidor, con la serie en mayúsculas.
    await _tap(tester, 'Movimientos');
    await _tap(tester, 'Registros de ventas y compras');
    await _waitFor(tester, find.text('Boleta B001-1'));
    expect(find.textContaining('Comercial Andina'), findsOneWidget);
    expect(find.text('IGV S/ 36.00'), findsOneWidget);
    await _shot(tester, '9a-registro-de-ventas');
    await tester.tap(find.byTooltip('Atrás'));
    await _settle(tester);

    await _tap(tester, 'Clientes');
    await _waitFor(tester, find.text('S/ 236.00'));
    expect(find.text('Te deben en total'), findsOneWidget);
    await _shot(tester, '9-clientes');

    // Impuestos del servidor: IGV 18 + 36 de ventas menos 9 de la factura = 45.
    final month = monthName(limaDate(DateTime.now()).substring(0, 7));
    await _tap(tester, 'Inicio');
    await _tap(tester, 'Impuestos de $month');
    await _waitFor(tester, find.text('Le tocaría pagar a SUNAT por $month'));
    expect(find.text('S/ 45.00'), findsOneWidget);
    await _shot(tester, '10-impuestos');
    await tester.tap(find.byTooltip('Atrás'));
    await _settle(tester);

    // Facturación electrónica en modo de prueba, con otra serie (B001-1 ya se anotó a mano).
    await _tap(tester, 'Más');
    await _tap(tester, 'Facturación electrónica (beta)');
    await _waitFor(tester, find.text('¿Cómo quieres emitir?'));
    await tester.enterText(find.widgetWithText(TextField, 'Serie de boletas'), 'B002');
    await _tap(tester, 'Guardar');
    await _waitFor(tester, find.text('Modo de prueba'));
    await _tap(tester, 'Emitir boleta o factura');
    await tester.enterText(find.widgetWithText(TextField, 'Total, con IGV'), '59');
    await tester.enterText(find.widgetWithText(TextField, '¿Qué vendiste?'), 'Abarrotes varios');
    await tester.pump();
    await _shot(tester, '10a-emitir');
    final emit = find.widgetWithText(FilledButton, 'Emitir boleta');
    await tester.ensureVisible(emit);
    await tester.tap(emit);
    await _waitFor(tester, find.text('¡Listo! (de prueba)'));
    expect(find.text('Boleta B002-00000001 por S/ 59.00'), findsOneWidget);
    expect(find.text('La venta quedó anotada y en tu registro de ventas.'), findsOneWidget);
    await _shot(tester, '10b-emitida');
    await _tap(tester, 'Listo');
    await _waitFor(tester, find.text('Boleta B002-00000001'));
    await _shot(tester, '10c-facturacion');
    await tester.tap(find.byTooltip('Atrás'));
    await _settle(tester);

    await _tap(tester, 'Mi plan');
    await _waitFor(tester, find.text('Prueba gratis del plan Negocio'));
    expect(find.text('Pagar S/ 490.00'), findsOneWidget);
    await _shot(tester, '11-mi-plan');
  });
}
