import 'package:flutter/material.dart';

import '../api/api.dart';
import '../core/dates.dart';
import '../core/money.dart';
import '../session/session.dart';
import '../ui/theme.dart';
import '../ui/widgets.dart';

/// Registro de ventas y registro de compras del mes: los comprobantes que
/// diste y los que te dieron, con su base, IGV y total. Para el contador y
/// para SUNAT, también en Excel.
class RegistersScreen extends StatefulWidget {
  const RegistersScreen({super.key, required this.session, this.kind = RegisterKind.sales});

  final SessionController session;
  final RegisterKind kind;

  @override
  State<RegistersScreen> createState() => _RegistersScreenState();
}

class _RegistersScreenState extends State<RegistersScreen> {
  late String _period = limaDate(DateTime.now()).substring(0, 7);
  late RegisterKind _kind = widget.kind;
  Register? _register;
  Object? _error;
  String? _notice;

  Company get _company => widget.session.company!;
  String get _current => limaDate(DateTime.now()).substring(0, 7);

  @override
  void initState() {
    super.initState();
    _load();
  }

  Future<void> _load() async {
    setState(() {
      _register = null;
      _error = null;
    });
    try {
      final register = await widget.session.api.documentRegister(
        _company.id,
        _kind,
        period: _period,
      );
      if (mounted) setState(() => _register = register);
    } on ApiException catch (error) {
      if (mounted) setState(() => _error = error);
    }
  }

  void _shift(int months) {
    setState(() {
      _period = shiftPeriod(_period, months);
      _notice = null;
    });
    _load();
  }

  Future<void> _export(ExportFormat format) async {
    final (from, to) = periodBounds(_period);
    try {
      final link = await widget.session.api.exportLink(
        _company.id,
        kind: _kind.export,
        from: from,
        to: to,
        format: format,
      );
      final opened = await widget.session.openLink(link);
      setState(
        () => _notice = !opened
            ? 'No pudimos abrir el navegador. Inténtalo de nuevo.'
            : format == ExportFormat.pdf
            ? 'Abrimos el PDF en tu navegador: puedes guardarlo, imprimirlo o mandarlo.'
            : 'Abrimos la descarga en tu navegador. El archivo se abre con Excel.',
      );
    } on ApiException catch (error) {
      setState(() => _notice = error.message);
    }
  }

  @override
  Widget build(BuildContext context) {
    final register = _register;
    final sales = _kind == RegisterKind.sales;
    return Scaffold(
      appBar: AppBar(title: const Text('Registros de ventas y compras')),
      body: RefreshIndicator(
        onRefresh: _load,
        child: ListView(
          padding: const EdgeInsets.fromLTRB(16, 8, 16, 32),
          children: [
            ReadableWidth(
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.stretch,
                children: [
                  SegmentedButton<RegisterKind>(
                    showSelectedIcon: false,
                    segments: const [
                      ButtonSegment(value: RegisterKind.sales, label: Text('Ventas')),
                      ButtonSegment(value: RegisterKind.purchases, label: Text('Compras')),
                    ],
                    selected: {_kind},
                    onSelectionChanged: (s) {
                      setState(() {
                        _kind = s.first;
                        _notice = null;
                      });
                      _load();
                    },
                  ),
                  const SizedBox(height: 12),
                  Container(
                    padding: const EdgeInsets.all(4),
                    decoration: BoxDecoration(
                      color: Colors.white,
                      borderRadius: BorderRadius.circular(18),
                      border: Border.all(color: ContabiliColors.line),
                    ),
                    child: Row(
                      children: [
                        IconButton(
                          tooltip: 'Mes anterior',
                          onPressed: () => _shift(-1),
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
                          onPressed: _period.compareTo(_current) >= 0 ? null : () => _shift(1),
                          icon: const Icon(Icons.chevron_right),
                        ),
                      ],
                    ),
                  ),
                  const SizedBox(height: 12),
                  if (_notice != null) ...[Notice(text: _notice!), const SizedBox(height: 12)],
                  if (register == null)
                    LoadState(error: _error, onRetry: _load)
                  else ...[
                    _Totals(register: register, sales: sales),
                    const SizedBox(height: 16),
                    if (register.rows.isEmpty)
                      EmptyState(
                        title: sales
                            ? 'Este mes no hay comprobantes de venta'
                            : 'Este mes no hay comprobantes de compra',
                        message: sales
                            ? 'Al anotar una venta, elige la boleta o factura y escribe su serie y número.'
                            : 'Al anotar un gasto, elige la factura o boleta que te dieron y escribe su serie y número.',
                      )
                    else ...[
                      SectionTitle(
                        '${register.rows.length} ${register.rows.length == 1 ? 'comprobante' : 'comprobantes'}',
                      ),
                      Card(
                        child: Column(
                          children: [
                            for (final (i, row) in register.rows.indexed) ...[
                              if (i > 0) const Divider(indent: 76),
                              _RowTile(row: row),
                            ],
                          ],
                        ),
                      ),
                      const SizedBox(height: 16),
                      Row(
                        children: [
                          Expanded(
                            child: OutlinedButton.icon(
                              onPressed: () => _export(ExportFormat.csv),
                              icon: const Icon(Icons.table_chart_outlined),
                              label: const Text('Excel'),
                            ),
                          ),
                          const SizedBox(width: 10),
                          Expanded(
                            child: OutlinedButton.icon(
                              onPressed: () => _export(ExportFormat.pdf),
                              icon: const Icon(Icons.picture_as_pdf_outlined),
                              label: const Text('PDF'),
                            ),
                          ),
                        ],
                      ),
                    ],
                  ],
                ],
              ),
            ),
          ],
        ),
      ),
    );
  }
}

class _Totals extends StatelessWidget {
  const _Totals({required this.register, required this.sales});

  final Register register;
  final bool sales;

  @override
  Widget build(BuildContext context) {
    Widget figure(String label, Cents amount, {bool big = false}) => Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        Text(label, style: const TextStyle(fontSize: 14, color: ContabiliColors.ink2)),
        FittedBox(
          fit: BoxFit.scaleDown,
          alignment: Alignment.centerLeft,
          child: Text(
            formatSoles(amount),
            style: ContabiliFonts.amount(
              big ? 28 : 20,
              color: big ? ContabiliColors.terracottaDark : ContabiliColors.ink,
            ),
          ),
        ),
      ],
    );
    return Card(
      child: Padding(
        padding: const EdgeInsets.all(18),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.stretch,
          children: [
            figure(
              sales ? 'Total vendido con comprobante' : 'Total comprado con comprobante',
              register.total,
              big: true,
            ),
            const SizedBox(height: 12),
            const Divider(),
            const SizedBox(height: 12),
            Row(
              children: [
                Expanded(child: figure('Base imponible', register.base)),
                const SizedBox(width: 12),
                Expanded(child: figure('IGV', register.igv)),
              ],
            ),
          ],
        ),
      ),
    );
  }
}

class _RowTile extends StatelessWidget {
  const _RowTile({required this.row});

  final RegisterRow row;

  @override
  Widget build(BuildContext context) {
    final who = [
      if (row.counterpartyName != null) row.counterpartyName!,
      if (row.counterpartyRuc != null) 'RUC ${row.counterpartyRuc}',
    ].join(' · ');
    return Padding(
      padding: const EdgeInsets.symmetric(horizontal: 16, vertical: 12),
      child: Row(
        children: [
          IconBox(
            icon: switch (row.type) {
              DocType.factura => Icons.receipt_long_outlined,
              DocType.boleta => Icons.receipt_outlined,
              DocType.recibo => Icons.badge_outlined,
              DocType.ticket => Icons.confirmation_number_outlined,
              DocType.other => Icons.description_outlined,
              DocType.creditNote => Icons.assignment_return_outlined,
            },
            color: row.annulled
                ? ContabiliColors.ink3
                : (row.total < 0 ? ContabiliColors.red : ContabiliColors.indigo),
            background: row.annulled
                ? ContabiliColors.sand
                : (row.total < 0 ? ContabiliColors.redSoft : ContabiliColors.indigoSoft),
          ),
          const SizedBox(width: 14),
          Expanded(
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Text(
                  '${row.type.label} ${row.label}',
                  style: TextStyle(
                    fontWeight: FontWeight.w600,
                    fontSize: 16,
                    decoration: row.annulled ? TextDecoration.lineThrough : null,
                  ),
                ),
                Text(
                  [
                    formatDate(row.issueDate),
                    if (row.modifies != null) 'anula ${row.modifies}',
                    if (who.isNotEmpty) who,
                    if (row.annulled) 'Anulado',
                  ].join(' · '),
                  style: const TextStyle(fontSize: 14, color: ContabiliColors.ink2),
                ),
              ],
            ),
          ),
          const SizedBox(width: 10),
          Column(
            crossAxisAlignment: CrossAxisAlignment.end,
            children: [
              Text(
                formatSoles(row.total),
                style: ContabiliFonts.amount(
                  17,
                  color: row.annulled
                      ? ContabiliColors.ink3
                      : (row.total < 0 ? ContabiliColors.red : ContabiliColors.ink),
                ),
              ),
              if (row.igv != 0)
                Text(
                  'IGV ${formatSoles(row.igv)}',
                  style: const TextStyle(fontSize: 13, color: ContabiliColors.ink2),
                ),
            ],
          ),
        ],
      ),
    );
  }
}
