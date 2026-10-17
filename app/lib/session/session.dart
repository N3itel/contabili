import 'package:flutter/foundation.dart';
import 'package:url_launcher/url_launcher.dart';

import '../api/api.dart';
import '../api/session_store.dart';

enum SessionPhase { loading, signedOut, signedIn, offline }

/// Abre un enlace fuera de la app (el navegador). Devuelve si pudo.
typedef LinkOpener = Future<bool> Function(Uri uri);

Future<bool> _launchExternal(Uri uri) => launchUrl(uri, mode: LaunchMode.externalApplication);

/// Sesión y empresa abierta, para toda la app.
class SessionController extends ChangeNotifier {
  SessionController(this.api, {required this.store, required this.webUrl, LinkOpener? openLink})
    : openLink = openLink ?? _launchExternal;

  final ContabiliApi api;
  final SessionStore store;

  /// Dirección del sitio: términos, privacidad y descargas.
  final Uri webUrl;
  final LinkOpener openLink;

  SessionPhase _phase = SessionPhase.loading;
  Me? _user;
  Company? _company;

  SessionPhase get phase => _phase;
  Me? get user => _user;

  /// La empresa con la que se está trabajando.
  Company? get company => _company;

  Uri page(String path) => webUrl.resolve(path);

  /// Al abrir la app: si hay tokens guardados, confirma quién es.
  Future<void> restore() async {
    _set(SessionPhase.loading);
    if (!await api.hasSession()) return _set(SessionPhase.signedOut);
    try {
      _user = await api.me();
      _set(SessionPhase.signedIn);
    } on ApiException catch (error) {
      _set(error.code == 'network' ? SessionPhase.offline : SessionPhase.signedOut);
    }
  }

  void signedIn(Me user) {
    _user = user;
    _set(SessionPhase.signedIn);
  }

  /// La API borró los tokens (la renovación falló): vuelve al ingreso.
  void expired() {
    _user = null;
    _company = null;
    _set(SessionPhase.signedOut);
  }

  Future<void> openCompany(Company company) async {
    _company = company;
    await store.setLastCompanyId(company.id);
    notifyListeners();
  }

  /// Vuelve a la lista de empresas.
  Future<void> leaveCompany() async {
    _company = null;
    await store.setLastCompanyId(null);
    notifyListeners();
  }

  /// Actualiza los datos de la empresa abierta (por ejemplo, tras cerrar un mes).
  Future<void> refreshCompany() async {
    final current = _company;
    if (current == null) return;
    final list = await api.companies();
    for (final c in list) {
      if (c.id == current.id) {
        _company = c;
        notifyListeners();
      }
    }
  }

  Future<void> logout() async {
    await api.logout();
    _user = null;
    _company = null;
    _set(SessionPhase.signedOut);
  }

  void _set(SessionPhase phase) {
    _phase = phase;
    notifyListeners();
  }
}
