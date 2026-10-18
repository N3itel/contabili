import 'package:flutter/material.dart';

import '../api/api.dart';
import '../core/dates.dart';
import '../core/money.dart';
import '../core/operations.dart';
import '../session/session.dart';
import '../ui/andean.dart';
import '../ui/theme.dart';
import '../ui/widgets.dart';
import 'operation_screen.dart';

/// Cuánto le tocaría pagar a SUNAT este mes, explicado sin jerga, con un
/// atajo para anotar el pago.
class TaxesScreen extends StatefulWidget {
  const TaxesScreen({super.key, required this.session, this.changes});

  final SessionController session;
  final ValueNotifier<int>? changes;

  @override
  State<TaxesScreen> createState() => _TaxesScreenState();
}

class _TaxesScreenState extends State<TaxesScreen> {
  late String _period = limaDate(DateTime.now()).substring(0, 7);
  MonthlyTaxes? _taxes;
  Object? _error;

  Company get _company => widget.session.company!;
  String get _current => limaDate(DateTime.now()).substring(0, 7);

  @override
  void initState() {
    super.initState();
    _load();
  }

  Future<void> _load() async {
    setState(() {
      _error = null;
      _taxes = null;
    });
    try {
      final taxes = await widget.session.api.taxes(_company.id, period: _period);
      if (mounted) setState(() => _taxes = taxes);
    } on ApiException catch (error) {
      if (mounted) setState(() => _error = error);
    }
  }

  Future<void> _recordPayment(TaxKind tax, Cents amount) async {
    final saved = await Navigator.of(context).push<bool>(
      MaterialPageRoute(
        builder: (_) => OperationScreen(
          session: widget.session,
          type: OperationType.taxPayment,
          initialTotal: amount,
          initialTax: tax,
        ),
      ),
    );
    if (saved == true) {
      widget.changes?.value++;
      await _load();
    }
  }

  @override
  Widget build(BuildContext context) {
    final taxes = _taxes;
    return Scaffold(
      appBar: AppBar(title: const Text('Impuestos del mes')),
      body: ListView(
        padding: const EdgeInsets.all(16),
        children: [
          ReadableWidth(
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.stretch,
              children: [
                Row(
                  children: [
                    IconButton(
                      tooltip: 'Mes anterior',
                      onPressed: () {
                        setState(() => _period = shiftPeriod(_period, -1));
                        _load();
                      },
                      icon: const Icon(Icons.chevron_left),
                    ),
                    Expanded(
                      child: Text(
                        periodLabel(_period),
                        textAlign: TextAlign.center,
                        style: Theme.of(context).textTheme.titleLarge,
                      ),
                    ),
                    IconButton(
                      tooltip: 'Mes siguiente',
                      onPressed: _period.compareTo(_current) >= 0
                          ? null
                          : () {
                              setState(() => _period = shiftPeriod(_period, 1));
                              _load();
                            },
                      icon: const Icon(Icons.chevron_right),
                    ),
                  ],
                ),
                const SizedBox(height: 8),
                if (taxes == null) LoadState(error: _error, onRetry: _load) else ..._content(taxes),
              ],
            ),
          ),
        ],
      ),
    );
  }

  List<Widget> _content(MonthlyTaxes taxes) {
    final igv = taxes.igv;
    final canRecord = _company.role.canRecord;
    return [
      HeroPanel(
        colors: const [ContabiliColors.goldLight, ContabiliColors.gold],
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Text(
              'Le tocaría pagar a SUNAT por ${monthName(taxes.period)}',
              style: const TextStyle(fontSize: 16, color: ContabiliColors.ink),
            ),
            Text(formatSoles(taxes.total), style: ContabiliFonts.amount(44)),
            const SizedBox(height: 6),
            Container(
              padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 6),
              decoration: BoxDecoration(
                color: const Color(0x66FFFFFF),
                borderRadius: BorderRadius.circular(999),
              ),
              child: Text(
                taxes.regime.label,
                style: const TextStyle(fontWeight: FontWeight.w600, color: ContabiliColors.ink),
              ),
            ),
          ],
        ),
      ),
      const SizedBox(height: 12),
      if (igv != null)
        _TaxCard(
          title: 'IGV',
          amount: igv.toPay,
          rows: [
            ('IGV de tus ventas', igv.sales),
            ('IGV de tus compras con factura', -igv.purchases),
            if (igv.previousCredit > 0) ('Saldo a favor del mes anterior', -igv.previousCredit),
          ],
          footer: igv.nextCredit > 0
              ? 'Te queda ${formatSoles(igv.nextCredit)} a favor para el próximo mes.'
              : null,
          action: canRecord && igv.toPay > 0
              ? OutlinedButton(
                  onPressed: () => _recordPayment(TaxKind.igv, igv.toPay),
                  child: const Text('Ya pagué el IGV'),
                )
              : null,
        )
      else
        const Notice(text: 'En el Nuevo RUS no pagas IGV aparte: va dentro de tu cuota.'),
      const SizedBox(height: 12),
      _TaxCard(
        title: taxes.nrusCategory != null ? 'Cuota del Nuevo RUS' : 'Renta (pago a cuenta)',
        amount: taxes.incomeAmount,
        rows: [('Tus ventas del mes (sin IGV)', taxes.incomeBase)],
        footer: taxes.nrusCategory != null
            ? 'Categoría ${taxes.nrusCategory}: cuota fija de ${formatSoles(taxes.incomeAmount)}.'
            : '${_rate(taxes.incomeRatePercent!)} % de tus ventas del mes.',
        action: canRecord && taxes.incomeAmount > 0
            ? OutlinedButton(
                onPressed: () => _recordPayment(TaxKind.income, taxes.incomeAmount),
                child: Text(taxes.nrusCategory != null ? 'Ya pagué la cuota' : 'Ya pagué la renta'),
              )
            : null,
      ),
      const SizedBox(height: 12),
      for (final note in taxes.notes) ...[
        Notice(text: note, tone: NoticeTone.warning),
        const SizedBox(height: 8),
      ],
    ];
  }

  String _rate(double rate) =>
      rate == rate.roundToDouble() ? rate.toStringAsFixed(0) : rate.toStringAsFixed(1);
}

class _TaxCard extends StatelessWidget {
  const _TaxCard({
    required this.title,
    required this.amount,
    required this.rows,
    this.footer,
    this.action,
  });

  final String title;
  final Cents amount;
  final List<(String, Cents)> rows;
  final String? footer;
  final Widget? action;

  @override
  Widget build(BuildContext context) {
    return Card(
      child: Padding(
        padding: const EdgeInsets.all(18),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.stretch,
          children: [
            Row(
              children: [
                Expanded(child: Text(title, style: Theme.of(context).textTheme.titleLarge)),
                Text(formatSoles(amount), style: ContabiliFonts.amount(24)),
              ],
            ),
            const SizedBox(height: 8),
            const Divider(),
            const SizedBox(height: 6),
            for (final (label, value) in rows)
              Padding(
                padding: const EdgeInsets.symmetric(vertical: 3),
                child: Row(
                  children: [
                    Expanded(
                      child: Text(label, style: const TextStyle(color: ContabiliColors.ink2)),
                    ),
                    Text(
                      formatSoles(value),
                      style: const TextStyle(fontFeatures: [FontFeature.tabularFigures()]),
                    ),
                  ],
                ),
              ),
            if (footer != null) ...[
              const SizedBox(height: 6),
              Text(footer!, style: const TextStyle(fontWeight: FontWeight.w600)),
            ],
            if (action != null) ...[const SizedBox(height: 10), action!],
          ],
        ),
      ),
    );
  }
}
