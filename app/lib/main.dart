import 'package:flutter/material.dart';

import 'api/http_api.dart';
import 'api/session_store.dart';
import 'app.dart';
import 'session/session.dart';

/// Dirección de la API y del sitio. En desarrollo:
/// `flutter run --dart-define=CONTABILI_API=http://localhost:3000/api/v1
///  --dart-define=CONTABILI_WEB=http://localhost:3000`.
const _apiUrl = String.fromEnvironment(
  'CONTABILI_API',
  defaultValue: 'https://contabili.pe/api/v1',
);
const _webUrl = String.fromEnvironment('CONTABILI_WEB', defaultValue: 'https://contabili.pe');

void main() {
  WidgetsFlutterBinding.ensureInitialized();
  final store = SecureSessionStore();
  final api = HttpContabiliApi(baseUrl: Uri.parse(_apiUrl), store: store);
  final session = SessionController(api, store: store, webUrl: Uri.parse(_webUrl));
  api.onSessionExpired = session.expired;
  runApp(ContabiliApp(session: session));
}
