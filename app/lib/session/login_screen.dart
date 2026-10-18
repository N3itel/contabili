import 'dart:async';

import 'package:flutter/gestures.dart';
import 'package:flutter/material.dart';
import 'package:flutter/services.dart';

import '../api/api.dart';
import '../ui/andean.dart';
import '../ui/brand.dart';
import '../ui/theme.dart';
import '../ui/widgets.dart';
import 'session.dart';

enum _Step { phone, code, name }

/// Ingreso por SMS: celular → código de 6 dígitos → nombre (solo cuentas nuevas).
class LoginScreen extends StatefulWidget {
  const LoginScreen({super.key, required this.session});

  final SessionController session;

  @override
  State<LoginScreen> createState() => _LoginScreenState();
}

class _LoginScreenState extends State<LoginScreen> {
  final _phone = TextEditingController();
  final _code = TextEditingController();
  final _name = TextEditingController();
  final _codeFocus = FocusNode();

  _Step _step = _Step.phone;
  bool _busy = false;
  String? _error;
  String _normalizedPhone = '';
  String? _registrationToken;
  bool _acceptedTerms = false;
  int _resendIn = 0;
  Timer? _timer;

  ContabiliApi get _api => widget.session.api;

  @override
  void initState() {
    super.initState();
    _code.addListener(() {
      if (_code.text.length == 6 && !_busy) _verify();
    });
  }

  @override
  void dispose() {
    _timer?.cancel();
    _phone.dispose();
    _code.dispose();
    _name.dispose();
    _codeFocus.dispose();
    super.dispose();
  }

  Future<void> _run(Future<void> Function() action) async {
    setState(() {
      _busy = true;
      _error = null;
    });
    try {
      await action();
    } on ApiException catch (error) {
      if (mounted) setState(() => _error = error.message);
    } finally {
      if (mounted) setState(() => _busy = false);
    }
  }

  Future<void> _sendCode() => _run(() async {
    final sent = await _api.requestCode(_phone.text);
    _normalizedPhone = sent.phone;
    _code.clear();
    _startResendTimer(sent.resendAfterSeconds);
    setState(() => _step = _Step.code);
    _codeFocus.requestFocus();
  });

  Future<void> _verify() => _run(() async {
    try {
      final result = await _api.verifyCode(_normalizedPhone, _code.text);
      switch (result) {
        case SignedIn(:final user):
          widget.session.signedIn(user);
        case RegistrationRequired(:final registrationToken):
          _registrationToken = registrationToken;
          setState(() => _step = _Step.name);
      }
    } on ApiException {
      _code.clear();
      rethrow;
    }
  });

  Future<void> _register() => _run(() async {
    final result = await _api.register(
      registrationToken: _registrationToken!,
      fullName: _name.text.trim(),
      acceptTerms: _acceptedTerms,
    );
    widget.session.signedIn(result.user);
  });

  void _startResendTimer(int seconds) {
    _timer?.cancel();
    setState(() => _resendIn = seconds);
    _timer = Timer.periodic(const Duration(seconds: 1), (timer) {
      if (!mounted) return timer.cancel();
      setState(() => _resendIn = _resendIn > 0 ? _resendIn - 1 : 0);
      if (_resendIn == 0) timer.cancel();
    });
  }

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);
    final form = Column(
      crossAxisAlignment: CrossAxisAlignment.stretch,
      children: [
        Text(switch (_step) {
          _Step.phone => 'Tu contabilidad, tan fácil como anotar una venta',
          _Step.code => 'Escribe el código',
          _Step.name => '¿Cómo te llamas?',
        }, style: theme.textTheme.headlineMedium),
        const SizedBox(height: 8),
        Text(switch (_step) {
          _Step.phone =>
            'Entra con tu celular. Te enviamos un código por SMS; '
                'no hay contraseñas que recordar.',
          _Step.code => 'Te lo enviamos por SMS al $_normalizedPhone.',
          _Step.name => 'Es la primera vez que entras con este número.',
        }, style: theme.textTheme.bodyLarge?.copyWith(color: ContabiliColors.ink2)),
        const SizedBox(height: 24),
        ...switch (_step) {
          _Step.phone => _phoneStep(),
          _Step.code => _codeStep(),
          _Step.name => _nameStep(),
        },
        ErrorText(_error),
      ],
    );
    if (MediaQuery.sizeOf(context).width >= 900) {
      return Scaffold(
        body: Row(
          children: [
            const Expanded(flex: 5, child: _BrandPanel()),
            Expanded(
              flex: 4,
              child: SafeArea(
                child: Center(
                  child: SingleChildScrollView(
                    padding: const EdgeInsets.all(40),
                    child: ReadableWidth(maxWidth: 440, child: form),
                  ),
                ),
              ),
            ),
          ],
        ),
      );
    }
    return Scaffold(
      bottomNavigationBar: const SafeArea(top: false, child: TocapuBand(height: 14)),
      body: SingleChildScrollView(
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.stretch,
          children: [
            const _PhoneHeader(),
            Padding(
              padding: const EdgeInsets.fromLTRB(20, 24, 20, 24),
              child: ReadableWidth(maxWidth: 480, child: form),
            ),
          ],
        ),
      ),
    );
  }

  List<Widget> _phoneStep() => [
    TextField(
      controller: _phone,
      autofocus: true,
      keyboardType: TextInputType.phone,
      autofillHints: const [AutofillHints.telephoneNumber],
      inputFormatters: [FilteringTextInputFormatter.allow(RegExp(r'[\d +]'))],
      style: const TextStyle(fontSize: 22),
      decoration: const InputDecoration(labelText: 'Tu celular', hintText: '987 654 321'),
      onSubmitted: (_) => _sendCode(),
    ),
    const SizedBox(height: 16),
    FilledButton(
      onPressed: _busy ? null : _sendCode,
      child: Text(_busy ? 'Enviando…' : 'Enviarme el código'),
    ),
  ];

  List<Widget> _codeStep() => [
    TextField(
      controller: _code,
      focusNode: _codeFocus,
      keyboardType: TextInputType.number,
      autofillHints: const [AutofillHints.oneTimeCode],
      inputFormatters: [
        FilteringTextInputFormatter.digitsOnly,
        LengthLimitingTextInputFormatter(6),
      ],
      textAlign: TextAlign.center,
      style: const TextStyle(fontSize: 30, letterSpacing: 10, fontWeight: FontWeight.w700),
      decoration: const InputDecoration(labelText: 'Código de 6 dígitos'),
    ),
    const SizedBox(height: 16),
    FilledButton(
      onPressed: _busy || _code.text.length != 6 ? null : _verify,
      child: Text(_busy ? 'Revisando…' : 'Entrar'),
    ),
    const SizedBox(height: 8),
    OutlinedButton(
      onPressed: _busy || _resendIn > 0 ? null : _sendCode,
      child: Text(_resendIn > 0 ? 'Pedir otro código en $_resendIn s' : 'Pedir otro código'),
    ),
    TextButton(
      onPressed: () => setState(() {
        _step = _Step.phone;
        _error = null;
      }),
      child: const Text('Usar otro número'),
    ),
  ];

  List<Widget> _nameStep() {
    final linkStyle = const TextStyle(
      color: ContabiliColors.green,
      decoration: TextDecoration.underline,
      fontWeight: FontWeight.w600,
    );
    return [
      TextField(
        controller: _name,
        autofocus: true,
        textCapitalization: TextCapitalization.words,
        autofillHints: const [AutofillHints.name],
        style: const TextStyle(fontSize: 20),
        decoration: const InputDecoration(labelText: 'Nombre y apellido'),
        onChanged: (_) => setState(() {}),
      ),
      const SizedBox(height: 12),
      CheckboxListTile(
        value: _acceptedTerms,
        contentPadding: EdgeInsets.zero,
        controlAffinity: ListTileControlAffinity.leading,
        onChanged: (value) => setState(() => _acceptedTerms = value ?? false),
        title: Text.rich(
          TextSpan(
            text: 'Acepto los ',
            children: [
              TextSpan(
                text: 'términos y condiciones',
                style: linkStyle,
                recognizer: TapGestureRecognizer()
                  ..onTap = () => widget.session.openLink(widget.session.page('/terminos')),
              ),
              const TextSpan(text: ' y la '),
              TextSpan(
                text: 'política de privacidad',
                style: linkStyle,
                recognizer: TapGestureRecognizer()
                  ..onTap = () => widget.session.openLink(widget.session.page('/privacidad')),
              ),
              const TextSpan(text: '.'),
            ],
          ),
        ),
      ),
      const SizedBox(height: 12),
      FilledButton(
        onPressed: _busy || !_acceptedTerms || _name.text.trim().length < 3 ? null : _register,
        child: Text(_busy ? 'Creando tu cuenta…' : 'Crear mi cuenta'),
      ),
    ];
  }
}

/// La marca sobre terracota, para el ingreso.
class _MarkOnColor extends StatelessWidget {
  const _MarkOnColor({this.size = 44});

  final double size;

  @override
  Widget build(BuildContext context) => Container(
    padding: EdgeInsets.all(size * 0.16),
    decoration: BoxDecoration(
      color: ContabiliColors.paper,
      borderRadius: BorderRadius.circular(size * 0.36),
      boxShadow: const [BoxShadow(color: Color(0x335E2116), blurRadius: 12, offset: Offset(0, 4))],
    ),
    child: ContabiliMark(size: size),
  );
}

class _Wordmark extends StatelessWidget {
  const _Wordmark({this.size = 28});

  final double size;

  @override
  Widget build(BuildContext context) => Row(
    children: [
      _MarkOnColor(size: size * 1.4),
      const SizedBox(width: 14),
      Flexible(
        child: Text(
          'Contabili',
          style: ContabiliFonts.title(
            size,
            color: Colors.white,
          ).copyWith(fontWeight: FontWeight.w800),
        ),
      ),
      const SizedBox(width: 10),
      const BetaBadge(),
    ],
  );
}

/// Encabezado del ingreso en el celular: terracota, chakanas y andenes.
class _PhoneHeader extends StatelessWidget {
  const _PhoneHeader();

  @override
  Widget build(BuildContext context) {
    return DecoratedBox(
      decoration: const BoxDecoration(
        gradient: LinearGradient(
          begin: Alignment.topLeft,
          end: Alignment.bottomRight,
          colors: [ContabiliColors.terracotta, ContabiliColors.terracottaDark],
        ),
      ),
      child: CustomPaint(
        painter: ChakanaPattern(color: Colors.white.withValues(alpha: 0.07)),
        child: const SafeArea(
          bottom: false,
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.stretch,
            children: [
              Padding(padding: EdgeInsets.fromLTRB(20, 20, 20, 8), child: _Wordmark()),
              AndesIllustration(height: 110, night: true),
            ],
          ),
        ),
      ),
    );
  }
}

/// Panel de la marca en la computadora: qué es Contabili, en tres frases.
class _BrandPanel extends StatelessWidget {
  const _BrandPanel();

  static const _benefits = [
    'Anota ventas y gastos con un toque: el asiento contable se arma solo.',
    'Sabe cuánto te toca pagar a SUNAT cada mes, sin sorpresas.',
    'En el celular y en la computadora, con tu equipo y tu contador.',
  ];

  @override
  Widget build(BuildContext context) {
    return DecoratedBox(
      decoration: const BoxDecoration(
        gradient: LinearGradient(
          begin: Alignment.topLeft,
          end: Alignment.bottomRight,
          colors: [
            ContabiliColors.terracotta,
            ContabiliColors.terracottaDark,
            ContabiliColors.terracottaDeep,
          ],
        ),
      ),
      child: CustomPaint(
        painter: ChakanaPattern(color: Colors.white.withValues(alpha: 0.06), cell: 60, mark: 20),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.stretch,
          children: [
            Expanded(
              child: SingleChildScrollView(
                padding: const EdgeInsets.fromLTRB(48, 48, 48, 24),
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    const _Wordmark(size: 32),
                    const SizedBox(height: 56),
                    Text(
                      'Lleva las cuentas de tu negocio sin ser contador',
                      style: ContabiliFonts.title(42, color: Colors.white),
                    ),
                    const SizedBox(height: 28),
                    for (final benefit in _benefits) ...[
                      Row(
                        crossAxisAlignment: CrossAxisAlignment.start,
                        children: [
                          Container(
                            padding: const EdgeInsets.all(4),
                            decoration: const BoxDecoration(
                              color: ContabiliColors.gold,
                              shape: BoxShape.circle,
                            ),
                            child: const Icon(
                              Icons.check_rounded,
                              size: 18,
                              color: ContabiliColors.ink,
                            ),
                          ),
                          const SizedBox(width: 14),
                          Expanded(
                            child: Text(
                              benefit,
                              style: const TextStyle(
                                color: Color(0xF2FFFFFF),
                                fontSize: 18,
                                height: 1.45,
                              ),
                            ),
                          ),
                        ],
                      ),
                      const SizedBox(height: 16),
                    ],
                  ],
                ),
              ),
            ),
            const AndesIllustration(height: 170, night: true),
            const TocapuBand(height: 12),
          ],
        ),
      ),
    );
  }
}
