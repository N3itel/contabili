import 'package:flutter/material.dart';
import 'package:flutter_localizations/flutter_localizations.dart';

import 'screens/companies_screen.dart';
import 'screens/home_shell.dart';
import 'session/login_screen.dart';
import 'session/session.dart';
import 'ui/brand.dart';
import 'ui/theme.dart';
import 'ui/widgets.dart';

class ContabiliApp extends StatelessWidget {
  const ContabiliApp({super.key, required this.session});

  final SessionController session;

  @override
  Widget build(BuildContext context) {
    return MaterialApp(
      title: 'Contabili',
      debugShowCheckedModeBanner: false,
      theme: contabiliTheme(),
      locale: const Locale('es', 'PE'),
      supportedLocales: const [Locale('es', 'PE'), Locale('es')],
      localizationsDelegates: GlobalMaterialLocalizations.delegates,
      home: SessionGate(session: session),
    );
  }
}

/// Decide qué mostrar: carga, sin conexión, ingreso, elegir empresa o la empresa.
class SessionGate extends StatefulWidget {
  const SessionGate({super.key, required this.session});

  final SessionController session;

  @override
  State<SessionGate> createState() => _SessionGateState();
}

class _SessionGateState extends State<SessionGate> {
  @override
  void initState() {
    super.initState();
    if (widget.session.phase == SessionPhase.loading) widget.session.restore();
  }

  @override
  Widget build(BuildContext context) {
    final session = widget.session;
    return ListenableBuilder(
      listenable: session,
      builder: (context, _) => switch (session.phase) {
        SessionPhase.loading => const Scaffold(body: Center(child: ContabiliMark(size: 72))),
        SessionPhase.offline => Scaffold(
          body: SafeArea(
            child: Center(
              child: Padding(
                padding: const EdgeInsets.all(24),
                child: Column(
                  mainAxisSize: MainAxisSize.min,
                  children: [
                    const ContabiliMark(size: 56),
                    const SizedBox(height: 16),
                    const Text(
                      'No pudimos conectar. Revisa tu internet e intenta de nuevo.',
                      textAlign: TextAlign.center,
                      style: TextStyle(fontSize: 18),
                    ),
                    const SizedBox(height: 16),
                    OutlinedButton(onPressed: session.restore, child: const Text('Reintentar')),
                  ],
                ),
              ),
            ),
          ),
        ),
        SessionPhase.signedOut => LoginScreen(session: session),
        SessionPhase.signedIn when session.company == null => CompaniesScreen(
          key: ValueKey(session.user?.id),
          session: session,
        ),
        SessionPhase.signedIn => HomeShell(key: ValueKey(session.company!.id), session: session),
      },
    );
  }
}

/// Para las pruebas: envuelve una pantalla suelta con el tema de la app.
Widget themed(Widget child) => MaterialApp(
  theme: contabiliTheme(),
  locale: const Locale('es', 'PE'),
  supportedLocales: const [Locale('es', 'PE')],
  localizationsDelegates: GlobalMaterialLocalizations.delegates,
  home: ReadableWidth(child: child),
);
