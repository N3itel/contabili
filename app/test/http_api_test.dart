import 'dart:convert';

import 'package:contabili/api/http_api.dart';
import 'package:contabili/api/session_store.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:http/http.dart' as http;
import 'package:http/testing.dart';

void main() {
  const company = '00000000-0000-4000-8000-000000000123';

  test('renueva la sesión cuando el token vence y reintenta', () async {
    final store = MemorySessionStore(const Tokens(accessToken: 'viejo', refreshToken: 'r1'));
    final seen = <String>[];
    final client = MockClient((request) async {
      seen.add('${request.method} ${request.url.path} ${request.headers['Authorization']}');
      if (request.url.path.endsWith('/auth/refresh')) {
        expect(jsonDecode(request.body), {'refreshToken': 'r1'});
        return http.Response(jsonEncode({'accessToken': 'nuevo', 'refreshToken': 'r2'}), 200);
      }
      if (request.headers['Authorization'] == 'Bearer viejo') {
        return http.Response(jsonEncode({'code': 'unauthorized', 'message': 'x'}), 401);
      }
      return http.Response(
        jsonEncode({
          'period': '2026-10',
          'asOf': '2026-10-17',
          'money': {'cash': 100, 'bank': 200, 'total': 300},
          'receivable': 0,
          'payable': 0,
          'igv': {'month': 18, 'balance': 18},
          'month': {'sales': 100, 'expenses': 0, 'result': 100},
        }),
        200,
        headers: {'content-type': 'application/json; charset=utf-8'},
      );
    });
    final api = HttpContabiliApi(
      baseUrl: Uri.parse('https://contabili.test/api/v1/'),
      store: store,
      client: client,
    );
    final summary = await api.summary(company);
    expect(summary.money, 300);
    expect((await store.read())!.accessToken, 'nuevo');
    expect(seen, [
      'GET /api/v1/companies/$company/summary Bearer viejo',
      'POST /api/v1/auth/refresh null',
      'GET /api/v1/companies/$company/summary Bearer nuevo',
    ]);
  });

  test('si la renovación falla, borra la sesión y avisa', () async {
    final store = MemorySessionStore(const Tokens(accessToken: 'a', refreshToken: 'r'));
    var expired = false;
    final api = HttpContabiliApi(
      baseUrl: Uri.parse('https://contabili.test/api/v1'),
      store: store,
      client: MockClient(
        (_) async => http.Response(jsonEncode({'code': 'unauthorized', 'message': 'x'}), 401),
      ),
      onSessionExpired: () => expired = true,
    );
    await expectLater(api.companies(), throwsA(isA<Object>()));
    expect(expired, isTrue);
    expect(await store.read(), isNull);
  });

  test('los errores traen el mensaje en español del servidor', () async {
    final api = HttpContabiliApi(
      baseUrl: Uri.parse('https://contabili.test/api/v1'),
      store: MemorySessionStore(const Tokens(accessToken: 'a', refreshToken: 'r')),
      client: MockClient(
        (_) async => http.Response(
          jsonEncode({'code': 'license_expired', 'message': 'El plan de esta empresa venció.'}),
          402,
          headers: {'content-type': 'application/json; charset=utf-8'},
        ),
      ),
    );
    try {
      await api.billing(company);
      fail('debía fallar');
    } on Exception catch (error) {
      expect(error.toString(), contains('license_expired'));
    }
  });

  test('no arma rutas con ids que no son UUID', () {
    final api = HttpContabiliApi(
      baseUrl: Uri.parse('https://contabili.test/api/v1'),
      store: MemorySessionStore(),
      client: MockClient((_) async => http.Response('{}', 200)),
    );
    expect(() => api.summary('../admin'), throwsArgumentError);
  });
}
