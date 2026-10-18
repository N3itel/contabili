import 'package:flutter/material.dart';

import '../api/api.dart';
import '../core/dates.dart';
import '../core/money.dart';
import '../session/session.dart';
import '../ui/theme.dart';
import '../ui/trend_chart.dart';
import '../ui/widgets.dart';
import 'operation_screen.dart';
import 'taxes_screen.dart';

/// Inicio: cómo va el negocio en palabras simples, los cuatro botones para
/// anotar lo que pasó, los impuestos del mes y cómo vienen los últimos meses.
class HomeScreen extends StatefulWidget {
  const HomeScreen({
    super.key,
    required this.session,
    required this.changes,
    required this.onOpenPlan,
  });

  final SessionController session;
  final ValueNotifier<int> changes;
  final VoidCallback onOpenPlan;

  @override
  State<HomeScreen> createState() => _HomeScreenState();
}

class _HomeScreenState extends State<HomeScreen> {
  Summary? _summary;
  License? _license;
  MonthlyTaxes? _taxes;
  List<TrendPoint> _trend = const [];
  Object? _error;

  Company get _company => widget.session.company!;

  @override
  void initState() {
    super.initState();
    widget.changes.addListener(_load);
    _load();
  }

  @override
  void dispose() {
    widget.changes.removeListener(_load);
    super.dispose();
  }

  Future<void> _load() async {
    setState(() => _error = null);
    try {
      final api = widget.session.api;
      final results = await Future.wait([
        api.summary(_company.id),
        api.billing(_company.id),
        api.taxes(_company.id),
        api.trend(_company.id),
      ]);
      if (!mounted) return;
      setState(() {
        _summary = results[0] as Summary;
        _license = (results[1] as Billing).license;
        _taxes = results[2] as MonthlyTaxes;
        _trend = results[3] as List<TrendPoint>;
      });
    } on ApiException catch (error) {
      if (mounted) setState(() => _error = error);
    }
  }

  Future<void> _record(OperationType type) async {
    final saved = await Navigator.of(context).push<bool>(
      MaterialPageRoute(
        builder: (_) => OperationScreen(session: widget.session, type: type),
      ),
    );
    if (saved == true) widget.changes.value++;
  }

  Future<void> _openTaxes() => Navigator.of(context).push(
    MaterialPageRoute<void>(
      builder: (_) => TaxesScreen(session: widget.session, changes: widget.changes),
    ),
  );

  @override
  Widget build(BuildContext context) {
    final summary = _summary;
    if (summary == null) return LoadState(error: _error, onRetry: _load);
    final license = _license;
    final expired = license?.status == LicenseStatus.expired;
    final canRecord = _company.role.canRecord && !expired;
    return RefreshIndicator(
      onRefresh: _load,
      child: ListView(
        padding: const EdgeInsets.fromLTRB(16, 8, 16, 24),
        children: [
          ReadableWidth(
            maxWidth: 900,
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.stretch,
              children: [
                if (license != null) ...[
                  _LicenseBanner(license: license, onOpenPlan: widget.onOpenPlan),
                  const SizedBox(height: 12),
                ],
                if (canRecord) ...[
                  Text('¿Qué pasó hoy?', style: Theme.of(context).textTheme.titleLarge),
                  const SizedBox(height: 10),
                  _ActionGrid(onTap: _record),
                  const SizedBox(height: 24),
                ] else if (!_company.role.canRecord) ...[
                  const Notice(
                    text:
                        'Tu rol en esta empresa es solo de consulta: puedes ver todo, '
                        'pero no registrar.',
                  ),
                  const SizedBox(height: 16),
                ],
                Text(
                  'Tu negocio en ${monthName(summary.period)}',
                  style: Theme.of(context).textTheme.titleLarge,
                ),
                const SizedBox(height: 10),
                _SummaryCards(summary: summary),
                if (_taxes case final taxes?) ...[
                  const SizedBox(height: 14),
                  _TaxesCard(taxes: taxes, onOpen: _openTaxes),
                ],
                if (_trend.any((p) => p.sales > 0 || p.expenses > 0)) ...[
                  const SizedBox(height: 24),
                  Text('Tus últimos meses', style: Theme.of(context).textTheme.titleLarge),
                  const SizedBox(height: 10),
                  Card(
                    child: Padding(
                      padding: const EdgeInsets.fromLTRB(14, 18, 14, 14),
                      child: TrendChart(points: _trend),
                    ),
                  ),
                ],
              ],
            ),
          ),
        ],
      ),
    );
  }
}

class _LicenseBanner extends StatelessWidget {
  const _LicenseBanner({required this.license, required this.onOpenPlan});

  final License license;
  final VoidCallback onOpenPlan;

  @override
  Widget build(BuildContext context) {
    final action = TextButton(onPressed: onOpenPlan, child: const Text('Ver Mi plan'));
    return switch (license.status) {
      LicenseStatus.expired => Notice(
        tone: NoticeTone.error,
        text:
            'Tu plan venció. Puedes ver todo lo que registraste, pero no anotar cosas '
            'nuevas hasta renovar.',
        action: action,
      ),
      LicenseStatus.trial when license.daysLeft <= 7 => Notice(
        tone: NoticeTone.warning,
        text: 'Te quedan ${license.daysLeft} días de prueba gratis.',
        action: action,
      ),
      LicenseStatus.trial => Notice(
        text: 'Prueba gratis: te quedan ${license.daysLeft} días para probar todo.',
      ),
      LicenseStatus.active when license.daysLeft <= 5 => Notice(
        tone: NoticeTone.warning,
        text: 'Tu plan vence el ${formatInstant(license.endsAt)}.',
        action: action,
      ),
      LicenseStatus.active => const SizedBox.shrink(),
    };
  }
}

class _ActionGrid extends StatelessWidget {
  const _ActionGrid({required this.onTap});

  final ValueChanged<OperationType> onTap;

  @override
  Widget build(BuildContext context) {
    // Filas que crecen con el texto (la letra puede estar agrandada): los
    // botones de una fila quedan del mismo alto.
    final columns = MediaQuery.sizeOf(context).width >= 700 ? 4 : 2;
    const types = OperationType.home;
    return Column(
      children: [
        for (var start = 0; start < types.length; start += columns) ...[
          if (start > 0) const SizedBox(height: 10),
          IntrinsicHeight(
            child: Row(
              crossAxisAlignment: CrossAxisAlignment.stretch,
              children: [
                for (final (i, type) in types.skip(start).take(columns).indexed) ...[
                  if (i > 0) const SizedBox(width: 10),
                  Expanded(
                    child: _ActionButton(type: type, onTap: () => onTap(type)),
                  ),
                ],
              ],
            ),
          ),
        ],
      ],
    );
  }
}

class _ActionButton extends StatelessWidget {
  const _ActionButton({required this.type, required this.onTap});

  final OperationType type;
  final VoidCallback onTap;

  @override
  Widget build(BuildContext context) {
    return Material(
      color: type.background,
      borderRadius: BorderRadius.circular(20),
      child: InkWell(
        borderRadius: BorderRadius.circular(20),
        onTap: onTap,
        child: Padding(
          padding: const EdgeInsets.all(16),
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              Icon(type.icon, size: 34, color: type.foreground),
              const SizedBox(height: 18),
              Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  Text(
                    type.verb,
                    style: TextStyle(
                      fontSize: 22,
                      fontWeight: FontWeight.w800,
                      color: type.foreground,
                    ),
                  ),
                  Text(
                    type.hint,
                    style: const TextStyle(color: ContabiliColors.ink2, fontSize: 14),
                  ),
                ],
              ),
            ],
          ),
        ),
      ),
    );
  }
}

class _SummaryCards extends StatelessWidget {
  const _SummaryCards({required this.summary});

  final Summary summary;

  @override
  Widget build(BuildContext context) {
    final result = summary.result;
    final igv = summary.igvMonth;
    final wide = MediaQuery.sizeOf(context).width >= 700;
    final cards = [
      _Figure(
        label: 'Plata disponible',
        amount: summary.money,
        detail: 'Caja ${formatSoles(summary.cash)} · Bancos ${formatSoles(summary.bank)}',
        big: true,
      ),
      _Figure(
        label: result >= 0 ? 'Este mes vas ganando' : 'Este mes vas perdiendo',
        amount: result.abs(),
        color: result >= 0 ? ContabiliColors.green : ContabiliColors.red,
        detail:
            'Vendiste ${formatSoles(summary.sales)} y gastaste ${formatSoles(summary.expenses)} '
            '(sin IGV).',
        big: true,
      ),
      _Figure(
        label: 'Te deben',
        amount: summary.receivable,
        detail: 'Ventas al crédito que falta cobrar.',
      ),
      _Figure(
        label: 'Debes',
        amount: summary.payable,
        detail: 'Compras al crédito que falta pagar.',
      ),
      _Figure(
        label: igv >= 0 ? 'IGV de este mes' : 'IGV a tu favor',
        amount: igv.abs(),
        detail: igv >= 0
            ? 'Lo que te toca pagar a SUNAT por tus ventas, menos lo de tus facturas.'
            : 'Pagaste más IGV en tus compras del que cobraste: queda para el próximo mes.',
      ),
    ];
    if (!wide) {
      return Column(
        crossAxisAlignment: CrossAxisAlignment.stretch,
        children: [
          for (final card in cards) ...[card, const SizedBox(height: 10)],
        ],
      );
    }
    // En pantallas anchas: plata y resultado arriba (dos columnas), el resto en tres.
    return LayoutBuilder(
      builder: (context, constraints) {
        final half = (constraints.maxWidth - 10) / 2;
        final third = (constraints.maxWidth - 20) / 3;
        return Wrap(
          spacing: 10,
          runSpacing: 10,
          children: [
            for (final (i, card) in cards.indexed)
              SizedBox(width: i < 2 ? half : third, child: card),
          ],
        );
      },
    );
  }
}

class _Figure extends StatelessWidget {
  const _Figure({
    required this.label,
    required this.amount,
    required this.detail,
    this.color = ContabiliColors.ink,
    this.big = false,
  });

  final String label;
  final Cents amount;
  final String detail;
  final Color color;
  final bool big;

  @override
  Widget build(BuildContext context) {
    return Card(
      child: Padding(
        padding: const EdgeInsets.all(18),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Text(label, style: const TextStyle(fontSize: 16, color: ContabiliColors.ink2)),
            const SizedBox(height: 4),
            Text(
              formatSoles(amount),
              style: TextStyle(
                fontSize: big ? 34 : 26,
                fontWeight: FontWeight.w800,
                color: color,
                letterSpacing: -0.5,
              ),
            ),
            const SizedBox(height: 4),
            Text(detail, style: const TextStyle(fontSize: 14, color: ContabiliColors.ink2)),
          ],
        ),
      ),
    );
  }
}

/// Cuánto toca pagar a SUNAT este mes; lleva al detalle.
class _TaxesCard extends StatelessWidget {
  const _TaxesCard({required this.taxes, required this.onOpen});

  final MonthlyTaxes taxes;
  final VoidCallback onOpen;

  @override
  Widget build(BuildContext context) {
    return Card(
      color: ContabiliColors.goldSoft,
      child: InkWell(
        borderRadius: BorderRadius.circular(20),
        onTap: onOpen,
        child: Padding(
          padding: const EdgeInsets.all(18),
          child: Row(
            children: [
              const Icon(Icons.account_balance_outlined, size: 34, color: ContabiliColors.amber),
              const SizedBox(width: 14),
              Expanded(
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    Text(
                      'Impuestos de ${monthName(taxes.period)}',
                      style: const TextStyle(fontSize: 16, color: ContabiliColors.ink2),
                    ),
                    Text(
                      formatSoles(taxes.total),
                      style: const TextStyle(
                        fontSize: 26,
                        fontWeight: FontWeight.w800,
                        letterSpacing: -0.5,
                      ),
                    ),
                    const Text(
                      'Lo que va del mes para SUNAT. Toca para ver el detalle.',
                      style: TextStyle(fontSize: 14, color: ContabiliColors.ink2),
                    ),
                  ],
                ),
              ),
              const Icon(Icons.chevron_right),
            ],
          ),
        ),
      ),
    );
  }
}
