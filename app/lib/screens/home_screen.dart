import 'package:flutter/material.dart';

import '../api/api.dart';
import '../core/dates.dart';
import '../core/money.dart';
import '../session/session.dart';
import '../ui/andean.dart';
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
    this.showGreeting = true,
  });

  final SessionController session;
  final ValueNotifier<int> changes;
  final VoidCallback onOpenPlan;

  /// En la computadora el saludo va en el encabezado de la página.
  final bool showGreeting;

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
    final taxes = _taxes;
    final hasTrend = _trend.any((p) => p.sales > 0 || p.expenses > 0);

    final hero = _MoneyHero(
      summary: summary,
      greeting: widget.showGreeting ? widget.session.user?.firstName : null,
    );
    final record = <Widget>[
      if (canRecord) ...[
        const SectionTitle('¿Qué pasó hoy?'),
        _ActionGrid(onTap: _record),
      ] else if (!_company.role.canRecord)
        const Notice(
          text:
              'Tu rol en esta empresa es solo de consulta: puedes ver todo, '
              'pero no registrar.',
        ),
    ];
    final figures = <Widget>[
      SectionTitle('Tu negocio en ${monthName(summary.period)}'),
      _SummaryTiles(summary: summary),
      if (taxes != null) ...[
        const SizedBox(height: 12),
        _TaxesCard(taxes: taxes, onOpen: _openTaxes),
      ],
    ];
    final trend = <Widget>[
      if (hasTrend) ...[
        const SectionTitle('Tus últimos meses'),
        Card(
          child: Padding(
            padding: const EdgeInsets.fromLTRB(16, 20, 16, 16),
            child: TrendChart(points: _trend),
          ),
        ),
      ],
    ];

    return RefreshIndicator(
      onRefresh: _load,
      child: LayoutBuilder(
        builder: (context, constraints) {
          final twoColumns = constraints.maxWidth >= 900;
          final banner = [
            if (license != null) ...[
              _LicenseBanner(license: license, onOpenPlan: widget.onOpenPlan),
              const SizedBox(height: 16),
            ],
          ];
          final content = twoColumns
              ? [
                  ...banner,
                  Row(
                    crossAxisAlignment: CrossAxisAlignment.start,
                    children: [
                      Expanded(
                        flex: 6,
                        child: Column(
                          crossAxisAlignment: CrossAxisAlignment.stretch,
                          children: [hero, const SizedBox(height: 28), ...record],
                        ),
                      ),
                      const SizedBox(width: 24),
                      Expanded(
                        flex: 5,
                        child: Column(
                          crossAxisAlignment: CrossAxisAlignment.stretch,
                          children: figures,
                        ),
                      ),
                    ],
                  ),
                  if (hasTrend) const SizedBox(height: 28),
                  ...trend,
                ]
              : [
                  ...banner,
                  hero,
                  const SizedBox(height: 28),
                  ...record,
                  if (record.isNotEmpty) const SizedBox(height: 28),
                  ...figures,
                  if (hasTrend) const SizedBox(height: 28),
                  ...trend,
                ];
          return ListView(
            padding: EdgeInsets.fromLTRB(
              twoColumns ? 32 : 16,
              twoColumns ? 8 : 16,
              twoColumns ? 32 : 16,
              32,
            ),
            children: [
              ReadableWidth(
                maxWidth: 1040,
                child: Column(crossAxisAlignment: CrossAxisAlignment.stretch, children: content),
              ),
            ],
          );
        },
      ),
    );
  }
}

/// La plata disponible en grande, con caja, bancos y cómo va el mes.
class _MoneyHero extends StatelessWidget {
  const _MoneyHero({required this.summary, this.greeting});

  final Summary summary;
  final String? greeting;

  @override
  Widget build(BuildContext context) {
    final result = summary.result;
    const soft = TextStyle(color: Color(0xE6FFFFFF), fontSize: 16);
    return HeroPanel(
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          if (greeting != null) ...[
            Text('Hola, $greeting', style: ContabiliFonts.title(22, color: Colors.white)),
            const SizedBox(height: 10),
          ],
          const Text('Plata disponible', style: soft),
          const SizedBox(height: 2),
          FittedBox(
            fit: BoxFit.scaleDown,
            alignment: Alignment.centerLeft,
            child: Text(
              formatSoles(summary.money),
              style: ContabiliFonts.amount(44, color: Colors.white),
            ),
          ),
          const SizedBox(height: 12),
          Wrap(
            spacing: 8,
            runSpacing: 8,
            children: [
              _Pill(icon: Icons.payments_outlined, text: 'Caja ${formatSoles(summary.cash)}'),
              _Pill(
                icon: Icons.account_balance_outlined,
                text: 'Bancos ${formatSoles(summary.bank)}',
              ),
            ],
          ),
          const SizedBox(height: 18),
          Container(height: 1, color: const Color(0x33FFFFFF)),
          const SizedBox(height: 16),
          Row(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              Container(
                padding: const EdgeInsets.all(8),
                decoration: BoxDecoration(
                  color: const Color(0x26FFFFFF),
                  borderRadius: BorderRadius.circular(12),
                ),
                child: Icon(
                  result >= 0 ? Icons.trending_up_rounded : Icons.trending_down_rounded,
                  color: ContabiliColors.goldLight,
                ),
              ),
              const SizedBox(width: 12),
              Expanded(
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    Text(
                      result >= 0 ? 'Este mes vas ganando' : 'Este mes vas perdiendo',
                      style: soft,
                    ),
                    Text(
                      formatSoles(result.abs()),
                      style: ContabiliFonts.amount(
                        28,
                        color: result >= 0 ? ContabiliColors.goldLight : const Color(0xFFFFD3CC),
                      ),
                    ),
                    const SizedBox(height: 4),
                    Text(
                      'Vendiste ${formatSoles(summary.sales)} y gastaste '
                      '${formatSoles(summary.expenses)} (sin IGV).',
                      style: const TextStyle(color: Color(0xCCFFFFFF), fontSize: 14),
                    ),
                  ],
                ),
              ),
            ],
          ),
        ],
      ),
    );
  }
}

class _Pill extends StatelessWidget {
  const _Pill({required this.icon, required this.text});

  final IconData icon;
  final String text;

  @override
  Widget build(BuildContext context) => Container(
    padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 7),
    decoration: BoxDecoration(
      color: const Color(0x26FFFFFF),
      borderRadius: BorderRadius.circular(999),
      border: Border.all(color: const Color(0x33FFFFFF)),
    ),
    child: Row(
      mainAxisSize: MainAxisSize.min,
      children: [
        Icon(icon, size: 18, color: Colors.white),
        const SizedBox(width: 6),
        Flexible(
          child: Text(
            text,
            style: const TextStyle(
              color: Colors.white,
              fontWeight: FontWeight.w500,
              fontFeatures: [FontFeature.tabularFigures()],
            ),
          ),
        ),
      ],
    ),
  );
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
      borderRadius: BorderRadius.circular(22),
      child: InkWell(
        borderRadius: BorderRadius.circular(22),
        onTap: onTap,
        child: Ink(
          decoration: BoxDecoration(
            borderRadius: BorderRadius.circular(22),
            border: Border.all(color: type.foreground.withValues(alpha: 0.16)),
          ),
          child: Padding(
            padding: const EdgeInsets.all(16),
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Container(
                  width: 52,
                  height: 52,
                  decoration: BoxDecoration(
                    color: Colors.white,
                    borderRadius: BorderRadius.circular(16),
                    boxShadow: const [
                      BoxShadow(color: Color(0x141E2235), blurRadius: 8, offset: Offset(0, 3)),
                    ],
                  ),
                  child: Icon(type.icon, size: 28, color: type.foreground),
                ),
                const SizedBox(height: 16),
                Text(type.verb, style: ContabiliFonts.title(25, color: type.foreground)),
                const SizedBox(height: 2),
                Text(
                  type.hint,
                  style: const TextStyle(color: ContabiliColors.ink2, fontSize: 14, height: 1.35),
                ),
              ],
            ),
          ),
        ),
      ),
    );
  }
}

/// Te deben, debes e IGV del mes.
class _SummaryTiles extends StatelessWidget {
  const _SummaryTiles({required this.summary});

  final Summary summary;

  @override
  Widget build(BuildContext context) {
    final igv = summary.igvMonth;
    return Column(
      crossAxisAlignment: CrossAxisAlignment.stretch,
      children: [
        StatTile(
          icon: Icons.call_received_rounded,
          iconColor: ContabiliColors.green,
          iconBackground: ContabiliColors.greenSoft,
          label: 'Te deben',
          amount: summary.receivable,
          detail: 'Ventas al crédito que falta cobrar.',
        ),
        const SizedBox(height: 10),
        StatTile(
          icon: Icons.call_made_rounded,
          iconColor: ContabiliColors.red,
          iconBackground: ContabiliColors.redSoft,
          label: 'Debes',
          amount: summary.payable,
          detail: 'Compras al crédito que falta pagar.',
        ),
        const SizedBox(height: 10),
        StatTile(
          icon: Icons.percent_rounded,
          iconColor: ContabiliColors.indigo,
          iconBackground: ContabiliColors.indigoSoft,
          label: igv >= 0 ? 'IGV de este mes' : 'IGV a tu favor',
          amount: igv.abs(),
          detail: igv >= 0
              ? 'Lo de tus ventas, menos lo de tus facturas de compra.'
              : 'Pagaste más IGV en tus compras del que cobraste: queda para el próximo mes.',
        ),
      ],
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
    return DecoratedBox(
      decoration: BoxDecoration(
        borderRadius: BorderRadius.circular(22),
        gradient: const LinearGradient(
          begin: Alignment.topLeft,
          end: Alignment.bottomRight,
          colors: [ContabiliColors.goldSoft, Color(0xFFF7E2B2)],
        ),
        border: Border.all(color: ContabiliColors.gold.withValues(alpha: 0.35)),
      ),
      child: Material(
        color: Colors.transparent,
        child: InkWell(
          borderRadius: BorderRadius.circular(22),
          onTap: onOpen,
          child: Padding(
            padding: const EdgeInsets.all(18),
            child: Row(
              children: [
                const IconBox(
                  icon: Icons.account_balance_rounded,
                  color: ContabiliColors.amber,
                  background: Colors.white,
                ),
                const SizedBox(width: 14),
                Expanded(
                  child: Column(
                    crossAxisAlignment: CrossAxisAlignment.start,
                    children: [
                      Text(
                        'Impuestos de ${monthName(taxes.period)}',
                        style: const TextStyle(fontSize: 15, color: ContabiliColors.ink2),
                      ),
                      Text(formatSoles(taxes.total), style: ContabiliFonts.amount(28)),
                      const SizedBox(height: 2),
                      const Text(
                        'Lo que va del mes para SUNAT. Toca para ver el detalle.',
                        style: TextStyle(fontSize: 14, color: ContabiliColors.ink2),
                      ),
                    ],
                  ),
                ),
                const Icon(Icons.chevron_right, color: ContabiliColors.amber),
              ],
            ),
          ),
        ),
      ),
    );
  }
}
