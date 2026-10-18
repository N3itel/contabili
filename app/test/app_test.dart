import 'package:contabili/api/api.dart';
import 'package:contabili/api/fake_api.dart';
import 'package:contabili/api/session_store.dart';
import 'package:contabili/app.dart';
import 'package:contabili/core/dates.dart';
import 'package:contabili/core/operations.dart';
import 'package:contabili/session/session.dart';
import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';

const _companyId = '00000000-0000-4000-8000-000000000099';

Company _company({Role role = Role.owner, TaxRegime regime = TaxRegime.rmt}) => Company(
  id: _companyId,
  ruc: '20131312955',
  legalName: 'Bodega Doña Rosa EIRL',
  taxRegime: regime,
  role: role,
);

class _Harness {
  _Harness(this.api) : store = MemorySessionStore();

  final FakeContabiliApi api;
  final MemorySessionStore store;
  final List<Uri> opened = [];

  late final session = SessionController(
    api,
    store: store,
    webUrl: Uri.parse('https://contabili.pe'),
    openLink: (uri) async {
      opened.add(uri);
      return true;
    },
  );

  Future<void> pump(WidgetTester tester, {Size size = const Size(390, 844)}) async {
    tester.view.physicalSize = size;
    tester.view.devicePixelRatio = 1;
    addTearDown(tester.view.reset);
    await tester.pumpWidget(ContabiliApp(session: session));
    await tester.pumpAndSettle();
  }
}

Future<void> _tapText(WidgetTester tester, String text) async {
  await tester.ensureVisible(find.text(text).last);
  await tester.pumpAndSettle();
  await tester.tap(find.text(text).last);
  await tester.pumpAndSettle();
}

void main() {
  testWidgets('cuenta nueva: código, nombre y términos, y crea su empresa', (tester) async {
    final h = _Harness(FakeContabiliApi());
    await h.pump(tester);

    expect(find.text('Tu contabilidad, tan fácil como anotar una venta'), findsOneWidget);
    await tester.enterText(find.byType(TextField), '987654321');
    await _tapText(tester, 'Enviarme el código');
    expect(find.text('Escribe el código'), findsOneWidget);

    // Al completar los 6 dígitos entra sola.
    await tester.enterText(find.byType(TextField), FakeContabiliApi.code);
    await tester.pumpAndSettle();
    expect(find.text('¿Cómo te llamas?'), findsOneWidget);
    await tester.enterText(find.byType(TextField), 'Rosa Quispe');
    await tester.pump();
    final create = find.widgetWithText(FilledButton, 'Crear mi cuenta');
    expect(tester.widget<FilledButton>(create).onPressed, isNull, reason: 'sin aceptar términos');
    await tester.tap(find.byType(Checkbox));
    await tester.pump();
    await _tapText(tester, 'Crear mi cuenta');

    expect(find.text('Hola, Rosa'), findsOneWidget);
    await _tapText(tester, 'Crear mi empresa');
    await tester.enterText(find.byType(TextField).first, '20131312954');
    await tester.pump();
    expect(find.text('Ese RUC no es válido. Revisa los 11 dígitos.'), findsOneWidget);
    await tester.enterText(find.byType(TextField).first, '20131312955');
    await tester.enterText(find.byType(TextField).at(1), 'Bodega Doña Rosa EIRL');
    await _tapText(tester, 'Régimen MYPE Tributario');
    await _tapText(tester, 'Crear mi empresa');

    expect(find.text('¿Qué pasó hoy?'), findsOneWidget);
    expect(find.text('Prueba gratis: te quedan 30 días para probar todo.'), findsOneWidget);
    expect(await h.store.lastCompanyId(), isNotNull);
  });

  testWidgets('anota una venta: ve el IGV antes y la explicación después', (tester) async {
    final h = _Harness(FakeContabiliApi(signedIn: true, companies: [_company()]));
    await h.pump(tester);

    // Con una sola empresa entra directo.
    expect(find.text('Plata disponible'), findsOneWidget);
    await _tapText(tester, 'Vendí');
    expect(find.text('Anotar una venta'), findsOneWidget);
    await tester.enterText(find.byType(TextField).first, '118');
    await tester.pump();
    expect(find.text('S/ 100.00 es tu venta y S/ 18.00 es IGV.'), findsOneWidget);
    await _tapText(tester, 'Banco o Yape');
    await _tapText(tester, 'Guardar');

    expect(find.text('¡Listo, quedó anotado!'), findsOneWidget);
    expect(find.text('Registraste S/ 118.00: S/ 18.00 es IGV.'), findsOneWidget);
    await _tapText(tester, 'Listo');

    // Inicio se actualiza: entró al banco y se ve en «Plata disponible».
    expect(find.text('S/ 118.00'), findsOneWidget);
    expect(find.text('Caja S/ 0.00'), findsOneWidget);
    expect(find.text('Bancos S/ 118.00'), findsOneWidget);
  });

  testWidgets('gasto sin factura y en el Nuevo RUS no separa IGV', (tester) async {
    final h = _Harness(
      FakeContabiliApi(signedIn: true, companies: [_company(regime: TaxRegime.nrus)]),
    );
    await h.pump(tester);
    await _tapText(tester, 'Gasté');
    await tester.enterText(find.byType(TextField).first, '59');
    await tester.pump();
    // En el Nuevo RUS ni siquiera se pregunta por la factura.
    expect(find.text('Tengo factura a nombre de mi empresa'), findsNothing);
    expect(find.text('En el Nuevo RUS no se separa el IGV.'), findsOneWidget);
  });

  testWidgets('un error del servidor se muestra tal cual, en español', (tester) async {
    final api = FakeContabiliApi(signedIn: true, companies: [_company()]);
    final h = _Harness(api);
    await h.pump(tester);
    await _tapText(tester, 'Cobré');
    await tester.enterText(find.byType(TextField).first, '50');
    await tester.pump();
    api.failNext = const ApiException(
      status: 409,
      code: 'period_closed',
      message: 'Los libros están cerrados hasta el 30/09/2026.',
    );
    await _tapText(tester, 'Guardar');
    expect(find.text('Los libros están cerrados hasta el 30/09/2026.'), findsOneWidget);
  });

  testWidgets('con el plan vencido, se ve todo pero no hay botones para anotar', (tester) async {
    final api = FakeContabiliApi(
      signedIn: true,
      companies: [_company()],
      license: License(
        status: LicenseStatus.expired,
        planName: 'Negocio',
        endsAt: DateTime.utc(2026, 10, 1),
        daysLeft: 0,
        members: 1,
        maxMembers: 6,
      ),
    );
    await _Harness(api).pump(tester);
    expect(find.textContaining('Tu plan venció'), findsOneWidget);
    expect(find.text('Vendí'), findsNothing);
    expect(find.text('Plata disponible'), findsOneWidget);
  });

  testWidgets('quien solo consulta ve el resumen sin botones', (tester) async {
    final api = FakeContabiliApi(signedIn: true, companies: [_company(role: Role.viewer)]);
    await _Harness(api).pump(tester);
    expect(find.textContaining('solo de consulta'), findsOneWidget);
    expect(find.text('Vendí'), findsNothing);
  });

  testWidgets('Mi plan: el dueño paga en el navegador', (tester) async {
    final api = FakeContabiliApi(signedIn: true, companies: [_company()]);
    final h = _Harness(api);
    await h.pump(tester);
    await _tapText(tester, 'Mi plan');
    expect(find.text('Prueba gratis del plan Negocio'), findsOneWidget);
    expect(find.text('Pagar S/ 490.00'), findsOneWidget);
    await _tapText(tester, 'Por mes');
    await _tapText(tester, 'Emprendedor');
    await _tapText(tester, 'Pagar S/ 25.00');
    expect(h.opened.single.toString(), contains('/pagar/'));
    expect(h.opened.single.fragment, 't=emprendedor-monthly');
    expect(find.text('Ya pagué'), findsOneWidget);
  });

  testWidgets('acepta una invitación y entra a esa empresa', (tester) async {
    final api = FakeContabiliApi(signedIn: true);
    api.invitations.add(
      const Invitation(
        id: '00000000-0000-4000-8000-000000000555',
        companyId: _companyId,
        legalName: 'Ferretería Sol SAC',
        role: Role.accountant,
        invitedBy: 'Jorge Ramos',
      ),
    );
    await _Harness(api).pump(tester);
    expect(find.text('Jorge Ramos te invitó a Ferretería Sol SAC'), findsOneWidget);
    await _tapText(tester, 'Aceptar');
    expect(find.text('Ferretería Sol SAC'), findsOneWidget);
    expect(find.text('RUC 20131312955 · Contador'), findsOneWidget);
  });

  testWidgets('anular un movimiento lo registra al revés', (tester) async {
    final api = FakeContabiliApi(signedIn: true, companies: [_company()]);
    await api.recordOperation(
      _companyId,
      const Sale(11800, kind: SaleKind.goods, paidWith: Settlement.cash),
    );
    final h = _Harness(api);
    await h.pump(tester);
    await _tapText(tester, 'Movimientos');
    await _tapText(tester, 'Venta');
    await _tapText(tester, 'Anular este movimiento');
    expect(find.text('¿Anular este movimiento?'), findsOneWidget);
    await _tapText(tester, 'Anular');
    expect(find.text('Listo: el movimiento quedó anulado.'), findsOneWidget);
    expect(find.textContaining('Anulado'), findsOneWidget);
    expect(find.text('Extorno del asiento 1-2026'), findsOneWidget);
  });

  testWidgets('con la letra al 150 % nada se desborda', (tester) async {
    _largeText(tester);
    final api = FakeContabiliApi(signedIn: true, companies: [_company()]);
    final h = _Harness(api);
    await h.pump(tester);
    expect(find.text('Plata disponible'), findsOneWidget);
    expect(tester.takeException(), isNull, reason: 'Inicio');
    for (final tab in ['Movimientos', 'Clientes', 'Mi plan', 'Más', 'Inicio']) {
      await _tapText(tester, tab);
      expect(tester.takeException(), isNull, reason: tab);
    }
    await _tapText(tester, 'Gasté');
    await tester.enterText(find.byType(TextField).first, '118');
    await tester.pumpAndSettle();
    expect(tester.takeException(), isNull);
    // La app está en español: el botón de volver dice «Atrás».
    await tester.tap(find.byTooltip('Atrás'));
    await tester.pumpAndSettle();
    await _tapText(tester, 'Impuestos de ${monthName(api.period)}');
    expect(find.text('Impuestos del mes'), findsOneWidget);
    expect(tester.takeException(), isNull, reason: 'Impuestos');
  });

  testWidgets('venta al crédito a un cliente nuevo: se ve cuánto debe', (tester) async {
    final api = FakeContabiliApi(signedIn: true, companies: [_company()]);
    final h = _Harness(api);
    await h.pump(tester);
    await _tapText(tester, 'Vendí');
    await tester.enterText(find.byType(TextField).first, '236');
    await _tapText(tester, 'Me lo deben');
    expect(find.text('¿Qué cliente? (opcional)'), findsOneWidget);
    await _tapText(tester, 'Nuevo cliente');
    final dialogFields = find.descendant(
      of: find.byType(AlertDialog),
      matching: find.byType(TextField),
    );
    await tester.enterText(dialogFields.first, 'Comercial Andina');
    await tester.pump();
    await tester.tap(find.widgetWithText(FilledButton, 'Guardar').last);
    await tester.pumpAndSettle();
    // Queda elegido en la venta.
    final chip = tester.widget<ChoiceChip>(find.widgetWithText(ChoiceChip, 'Comercial Andina'));
    expect(chip.selected, isTrue);
    await _tapText(tester, 'Guardar');
    await _tapText(tester, 'Listo');

    await _tapText(tester, 'Clientes');
    expect(find.text('Te deben en total'), findsOneWidget);
    expect(find.text('S/ 236.00'), findsNWidgets(2));
    await _tapText(tester, 'Comercial Andina');
    expect(find.text('Te debe'), findsOneWidget);
    expect(find.text('Venta de mercadería al crédito'), findsOneWidget);
  });

  testWidgets('impuestos del mes: desde Inicio y anota el pago del IGV', (tester) async {
    final api = FakeContabiliApi(signedIn: true, companies: [_company()]);
    await api.recordOperation(
      _companyId,
      const Sale(11800, kind: SaleKind.goods, paidWith: Settlement.cash),
    );
    final h = _Harness(api);
    await h.pump(tester);
    expect(find.text('Tus últimos meses'), findsOneWidget);
    await _tapText(tester, 'Impuestos de ${monthName(api.period)}');
    expect(find.text('Le tocaría pagar a SUNAT por ${monthName(api.period)}'), findsOneWidget);
    await _tapText(tester, 'Ya pagué el IGV');
    expect(find.text('Anotar un pago a SUNAT'), findsOneWidget);
    // El monto llega ya escrito.
    expect(find.widgetWithText(TextField, '18.00'), findsOneWidget);
    await _tapText(tester, 'Guardar');
    expect(find.text('¡Listo, quedó anotado!'), findsOneWidget);
  });

  testWidgets('descarga los movimientos del mes para Excel', (tester) async {
    final api = FakeContabiliApi(signedIn: true, companies: [_company()]);
    final h = _Harness(api);
    await h.pump(tester);
    await _tapText(tester, 'Movimientos');
    await _tapText(tester, 'Descargar para Excel');
    await _tapText(tester, 'Movimientos de ${periodLabel(api.period)}');
    final (from, to) = periodBounds(api.period);
    expect(api.exports.single, (ExportKind.journal, from, to));
    expect(h.opened.single.path, '/api/v1/exports/enlace-de-prueba');
    expect(find.textContaining('se abre con Excel'), findsOneWidget);

    await _tapText(tester, 'Descargar para Excel');
    await _tapText(
      tester,
      'Balance de ${api.period.substring(0, 4)} hasta ${monthName(api.period)}',
    );
    expect(api.exports.last, (ExportKind.trialBalance, '${api.period.substring(0, 4)}-01-01', to));
  });

  testWidgets('se ve que es beta', (tester) async {
    final api = FakeContabiliApi(signedIn: true, companies: [_company()]);
    await _Harness(api).pump(tester);
    expect(find.text('BETA'), findsOneWidget);
  });

  testWidgets('en la computadora, la navegación va al costado', (tester) async {
    final api = FakeContabiliApi(signedIn: true, companies: [_company()]);
    await _Harness(api).pump(tester, size: const Size(1280, 800));
    expect(find.byKey(const Key('sidebar')), findsOneWidget);
    expect(find.text('Hola, Rosa'), findsOneWidget);
    expect(find.byType(NavigationBar), findsNothing);
    expect(find.text('¿Qué pasó hoy?'), findsOneWidget);
  });
}

void _largeText(WidgetTester tester) {
  tester.platformDispatcher.textScaleFactorTestValue = 1.5;
  addTearDown(tester.platformDispatcher.clearTextScaleFactorTestValue);
}
