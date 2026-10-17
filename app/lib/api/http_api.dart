import 'dart:async';
import 'dart:convert';

import 'package:http/http.dart' as http;

import '../core/operations.dart';
import 'api.dart';
import 'session_store.dart';

/// Cliente del backend real. Renueva la sesión sola cuando el token de acceso
/// vence; si la renovación falla, borra los tokens y avisa con [onSessionExpired].
class HttpContabiliApi implements ContabiliApi {
  HttpContabiliApi({
    required Uri baseUrl,
    required this.store,
    http.Client? client,
    this.onSessionExpired,
    this.timeout = const Duration(seconds: 20),
  }) : _base = baseUrl.toString().replaceAll(RegExp(r'/+$'), ''),
       _client = client ?? http.Client();

  final String _base;
  final http.Client _client;
  final SessionStore store;
  void Function()? onSessionExpired;
  final Duration timeout;

  Future<bool>? _refreshing;

  @override
  Future<bool> hasSession() async => await store.read() != null;

  @override
  Future<CodeSent> requestCode(String phone) async =>
      CodeSent.fromJson(await _json('POST', '/auth/code', body: {'phone': phone}, auth: false));

  @override
  Future<VerifyResult> verifyCode(String phone, String code) async {
    final json = await _json(
      'POST',
      '/auth/verify',
      body: {'phone': phone, 'code': code, 'deviceName': 'App Contabili'},
      auth: false,
    );
    if (json['status'] == 'registration_required') {
      return RegistrationRequired(json['registrationToken'] as String);
    }
    return _signedIn(json);
  }

  @override
  Future<SignedIn> register({
    required String registrationToken,
    required String fullName,
    required bool acceptTerms,
  }) async => _signedIn(
    await _json(
      'POST',
      '/auth/register',
      body: {
        'registrationToken': registrationToken,
        'fullName': fullName,
        'acceptTerms': acceptTerms,
        'deviceName': 'App Contabili',
      },
      auth: false,
    ),
  );

  @override
  Future<Me> me() async => Me.fromJson(await _json('GET', '/me'));

  @override
  Future<void> logout() async {
    try {
      await _request('POST', '/auth/logout');
    } on ApiException {
      // Aunque el servidor no responda, en el dispositivo la sesión se cierra.
    }
    await store.clear();
  }

  @override
  Future<List<Company>> companies() async => [
    for (final c in await _list('GET', '/companies')) Company.fromJson(c as Json),
  ];

  @override
  Future<Company> createCompany({
    required String ruc,
    required String legalName,
    required TaxRegime taxRegime,
  }) async => Company.fromJson(
    await _json(
      'POST',
      '/companies',
      body: {'ruc': ruc, 'legalName': legalName, 'taxRegime': taxRegime.wire},
    ),
  );

  @override
  Future<List<Invitation>> myInvitations() async => [
    for (final i in await _list('GET', '/invitations')) Invitation.fromJson(i as Json),
  ];

  @override
  Future<void> respondInvitation(String invitationId, {required bool accept}) async {
    await _json('POST', '/invitations/${_id(invitationId)}/${accept ? 'accept' : 'decline'}');
  }

  @override
  Future<Summary> summary(String companyId, {String? period}) async => Summary.fromJson(
    await _json('GET', '${_company(companyId)}/summary${period == null ? '' : '?period=$period'}'),
  );

  @override
  Future<OperationResult> recordOperation(
    String companyId,
    Operation operation, {
    String? date,
    String? reference,
  }) async {
    final json = await _json(
      'POST',
      '${_company(companyId)}/operations',
      body: {'operation': operation.toJson(), 'date': ?date, 'reference': ?reference},
    );
    return OperationResult(
      entry: JournalEntry.fromJson(json['entry'] as Json),
      explanation: json['explanation'] as String,
    );
  }

  @override
  Future<JournalPage> journal(String companyId, {required String period, int after = 0}) async {
    final json = await _json('GET', '${_company(companyId)}/journal?period=$period&after=$after');
    return JournalPage([
      for (final e in json['entries'] as List) JournalEntry.fromJson(e as Json),
    ], json['nextAfter'] as int?);
  }

  @override
  Future<JournalEntry> reverseEntry(String companyId, String entryId) async =>
      JournalEntry.fromJson(
        await _json('POST', '${_company(companyId)}/journal/${_id(entryId)}/reverse', body: {}),
      );

  @override
  Future<void> closePeriod(String companyId, String period) async {
    await _json('POST', '${_company(companyId)}/periods/close', body: {'period': period});
  }

  @override
  Future<Billing> billing(String companyId) async =>
      Billing.fromJson(await _json('GET', '${_company(companyId)}/billing'));

  @override
  Future<Uri> createOrder(
    String companyId, {
    required String plan,
    required BillingCycle cycle,
  }) async {
    final json = await _json(
      'POST',
      '${_company(companyId)}/billing/orders',
      body: {'plan': plan, 'cycle': cycle.wire},
    );
    return Uri.parse(json['checkoutUrl'] as String);
  }

  @override
  Future<List<Member>> members(String companyId) async => [
    for (final m in await _list('GET', '${_company(companyId)}/members'))
      Member.fromJson(m as Json),
  ];

  @override
  Future<void> invite(String companyId, {required String phone, required Role role}) async {
    await _json(
      'POST',
      '${_company(companyId)}/invitations',
      body: {'phone': phone, 'role': role.wire},
    );
  }

  @override
  Future<void> removeMember(String companyId, String userId) async {
    await _request('DELETE', '${_company(companyId)}/members/${_id(userId)}');
  }

  // ─── Interno ─────────────────────────────────────────────────────────────

  Future<SignedIn> _signedIn(Json json) async {
    await store.write(
      Tokens(
        accessToken: json['accessToken'] as String,
        refreshToken: json['refreshToken'] as String,
      ),
    );
    return SignedIn(Me.fromJson(json['user'] as Json));
  }

  /// Los ids van en la ruta: solo se aceptan UUID, así nada cambia la dirección.
  String _id(String id) {
    if (!RegExp(r'^[0-9a-fA-F-]{36}$').hasMatch(id)) throw ArgumentError.value(id, 'id');
    return id;
  }

  String _company(String companyId) => '/companies/${_id(companyId)}';

  Future<Json> _json(String method, String path, {Json? body, bool auth = true}) async =>
      (await _request(method, path, body: body, auth: auth)) as Json? ?? const {};

  Future<List<Object?>> _list(String method, String path) async =>
      (await _request(method, path)) as List<Object?>;

  Future<Object?> _request(String method, String path, {Json? body, bool auth = true}) async {
    final usedToken = auth ? (await store.read())?.accessToken : null;
    var response = await _send(method, path, body, auth);
    if (auth && response.statusCode == 401) {
      // Si otra petición ya renovó la sesión, basta con reintentar.
      final current = (await store.read())?.accessToken;
      final renewed = current != null && current != usedToken;
      // Sin conexión, _refresh lanza el error de red y la sesión se conserva.
      if (renewed || await _refresh()) {
        response = await _send(method, path, body, auth);
      }
      if (response.statusCode == 401) {
        await store.clear();
        onSessionExpired?.call();
      }
    }
    return _decode(response);
  }

  Future<http.Response> _send(String method, String path, Json? body, bool auth) async {
    final headers = {'Accept': 'application/json'};
    if (body != null) headers['Content-Type'] = 'application/json';
    if (auth) {
      final tokens = await store.read();
      if (tokens != null) headers['Authorization'] = 'Bearer ${tokens.accessToken}';
    }
    final request = http.Request(method, Uri.parse('$_base$path'))..headers.addAll(headers);
    if (body != null) request.body = jsonEncode(body);
    try {
      return await http.Response.fromStream(await _client.send(request).timeout(timeout));
    } on Object {
      throw const ApiException.network();
    }
  }

  Object? _decode(http.Response response) {
    final text = utf8.decode(response.bodyBytes);
    Object? json;
    if (text.isNotEmpty) {
      try {
        json = jsonDecode(text);
      } on FormatException {
        json = null;
      }
    }
    if (response.statusCode >= 200 && response.statusCode < 300) return json;
    if (json is Json) throw ApiException.fromJson(response.statusCode, json);
    throw ApiException(
      status: response.statusCode,
      code: 'error',
      message: 'Algo salió mal de nuestro lado. Intenta de nuevo en un momento.',
    );
  }

  Future<bool> _refresh() => _refreshing ??= _doRefresh().whenComplete(() => _refreshing = null);

  Future<bool> _doRefresh() async {
    final tokens = await store.read();
    if (tokens == null) return false;
    final response = await _send('POST', '/auth/refresh', {
      'refreshToken': tokens.refreshToken,
    }, false);
    if (response.statusCode != 200) return false;
    final json = jsonDecode(utf8.decode(response.bodyBytes)) as Json;
    await store.write(
      Tokens(
        accessToken: json['accessToken'] as String,
        refreshToken: json['refreshToken'] as String,
      ),
    );
    return true;
  }
}
