import 'package:flutter/material.dart';

import '../api/api.dart';
import '../core/dates.dart';
import '../core/money.dart';
import '../session/session.dart';
import '../ui/theme.dart';
import '../ui/widgets.dart';
import 'registers_screen.dart';

/// Lo anotado en el mes, del más nuevo al más antiguo. Un error se corrige
/// anulándolo (se registra al revés, nunca se borra) y, quien registra, cierra el mes.
/// Desde aquí se descargan los libros para Excel (para el contador).
class MovementsScreen extends StatefulWidget {
  const MovementsScreen({super.key, required this.session, required this.changes});

  final SessionController session;
  final ValueNotifier<int> changes;

  @override
  State<MovementsScreen> createState() => _MovementsScreenState();
}

class _MovementsScreenState extends State<MovementsScreen> {
  late String _period = limaDate(DateTime.now()).substring(0, 7);
  final List<JournalEntry> _entries = [];
  int? _nextAfter;
  bool _loading = true;
  Object? _error;
  String? _notice;

  Company get _company => widget.session.company!;
  ContabiliApi get _api => widget.session.api;
  String get _currentPeriod => limaDate(DateTime.now()).substring(0, 7);

  @override
  void initState() {
    super.initState();
    widget.changes.addListener(_reload);
    _reload();
  }

  @override
  void dispose() {
    widget.changes.removeListener(_reload);
    super.dispose();
  }

  Future<void> _reload() async {
    setState(() {
      _loading = true;
      _error = null;
      _entries.clear();
      _nextAfter = null;
    });
    await _more();
  }

  Future<void> _more() async {
    try {
      final page = await _api.journal(_company.id, period: _period, after: _nextAfter ?? 0);
      if (!mounted) return;
      setState(() {
        _entries.addAll(page.entries);
        _nextAfter = page.nextAfter;
        _loading = false;
      });
    } on ApiException catch (error) {
      if (mounted) {
        setState(() {
          _error = error;
          _loading = false;
        });
      }
    }
  }

  void _shift(int months) {
    setState(() {
      _period = shiftPeriod(_period, months);
      _notice = null;
    });
    _reload();
  }

  /// Un mes se cierra cuando ya terminó y si todavía no estaba cerrado.
  bool get _canClose =>
      _company.role.canRecord && _period.compareTo(_currentPeriod) < 0 && !_isClosed;

  bool get _isClosed {
    final closed = _company.closedThrough;
    return closed != null && closed.substring(0, 7).compareTo(_period) >= 0;
  }

  Future<void> _close() async {
    final month = monthName(_period);
    final ok = await _confirm(
      title: '¿Cerrar $month?',
      body:
          'Ya no se podrá anotar nada con fecha de $month ni de antes. Si falta algo, '
          'el dueño puede reabrirlo diciendo por qué.',
      action: 'Cerrar $month',
    );
    if (!ok) return;
    try {
      await _api.closePeriod(_company.id, _period);
      await widget.session.refreshCompany();
      setState(() => _notice = 'Cerraste $month.');
    } on ApiException catch (error) {
      setState(() => _notice = error.message);
    }
  }

  Future<void> _export() async {
    final choice = await showModalBottomSheet<(ExportKind, ExportFormat)>(
      context: context,
      isScrollControlled: true,
      builder: (context) => _ExportSheet(period: _period),
    );
    if (choice == null || !mounted) return;
    final (kind, format) = choice;
    final (monthStart, monthEnd) = periodBounds(_period);
    final from = kind == ExportKind.trialBalance ? '${_period.substring(0, 4)}-01-01' : monthStart;
    try {
      final link = await _api.exportLink(
        _company.id,
        kind: kind,
        from: from,
        to: monthEnd,
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

  Future<bool> _confirm({
    required String title,
    required String body,
    required String action,
  }) async =>
      await showDialog<bool>(
        context: context,
        builder: (context) => AlertDialog(
          title: Text(title),
          content: Text(body),
          actions: [
            TextButton(
              onPressed: () => Navigator.of(context).pop(false),
              child: const Text('Cancelar'),
            ),
            FilledButton(
              style: FilledButton.styleFrom(minimumSize: const Size(0, 48)),
              onPressed: () => Navigator.of(context).pop(true),
              child: Text(action),
            ),
          ],
        ),
      ) ??
      false;

  Future<void> _open(JournalEntry entry) async {
    final reverse = await showModalBottomSheet<bool>(
      context: context,
      isScrollControlled: true,
      builder: (context) => _EntryDetail(
        entry: entry,
        canReverse: _company.role.canRecord && !entry.isReversal && !entry.isReversed,
      ),
    );
    if (reverse != true || !mounted) return;
    final ok = await _confirm(
      title: '¿Anular este movimiento?',
      body:
          'Se anotará el mismo monto al revés, con fecha de hoy. No se borra nada: '
          'los dos quedan en tus libros.',
      action: 'Anular',
    );
    if (!ok) return;
    try {
      await _api.reverseEntry(_company.id, entry.id);
      widget.changes.value++;
      setState(() => _notice = 'Listo: el movimiento quedó anulado.');
    } on ApiException catch (error) {
      setState(() => _notice = error.message);
    }
  }

  /// Agrupa por fecha, en el orden en que vienen (del más nuevo al más antiguo).
  static List<(String, List<JournalEntry>)> _byDate(List<JournalEntry> entries) {
    final groups = <(String, List<JournalEntry>)>[];
    for (final entry in entries) {
      if (groups.isNotEmpty && groups.last.$1 == entry.entryDate) {
        groups.last.$2.add(entry);
      } else {
        groups.add((entry.entryDate, [entry]));
      }
    }
    return groups;
  }

  static String _dayLabel(String date) {
    final today = limaDate(DateTime.now());
    final yesterday = limaDate(DateTime.now().subtract(const Duration(days: 1)));
    if (date == today) return 'Hoy';
    if (date == yesterday) return 'Ayer';
    return '${int.parse(date.substring(8, 10))} de ${monthName(date.substring(0, 7))}';
  }

  @override
  Widget build(BuildContext context) {
    final entries = _entries.reversed.toList();
    return RefreshIndicator(
      onRefresh: _reload,
      child: ListView(
        padding: const EdgeInsets.fromLTRB(16, 8, 16, 24),
        children: [
          ReadableWidth(
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.stretch,
              children: [
                Container(
                  decoration: BoxDecoration(
                    color: Colors.white,
                    borderRadius: BorderRadius.circular(18),
                    border: Border.all(color: ContabiliColors.line),
                  ),
                  padding: const EdgeInsets.symmetric(horizontal: 4, vertical: 4),
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
                        onPressed: _period.compareTo(_currentPeriod) >= 0 ? null : () => _shift(1),
                        icon: const Icon(Icons.chevron_right),
                      ),
                    ],
                  ),
                ),
                const SizedBox(height: 8),
                if (_isClosed) ...[
                  const SizedBox(height: 4),
                  const Notice(text: 'Este mes está cerrado: ya no se le pueden anotar cosas.'),
                  const SizedBox(height: 10),
                ],
                if (_notice != null) ...[Notice(text: _notice!), const SizedBox(height: 10)],
                if (_loading)
                  const Padding(
                    padding: EdgeInsets.all(32),
                    child: Center(child: CircularProgressIndicator()),
                  )
                else if (_error != null)
                  LoadState(error: _error, onRetry: _reload)
                else if (entries.isEmpty)
                  const EmptyState(
                    title: 'Todavía no hay nada anotado este mes',
                    message:
                        'Lo que anotes en Inicio (ventas, gastos, cobros y pagos) aparece aquí.',
                  )
                else
                  for (final (date, group) in _byDate(entries)) ...[
                    Padding(
                      padding: const EdgeInsets.fromLTRB(4, 12, 4, 8),
                      child: Text(
                        _dayLabel(date),
                        style: const TextStyle(
                          fontSize: 15,
                          fontWeight: FontWeight.w600,
                          color: ContabiliColors.ink2,
                        ),
                      ),
                    ),
                    Card(
                      child: Column(
                        children: [
                          for (final (i, entry) in group.indexed) ...[
                            if (i > 0) const Divider(indent: 76),
                            _EntryTile(entry: entry, onTap: () => _open(entry)),
                          ],
                        ],
                      ),
                    ),
                  ],
                if (_nextAfter != null) ...[
                  const SizedBox(height: 10),
                  OutlinedButton(onPressed: _more, child: const Text('Ver más')),
                ],
                const SizedBox(height: 20),
                OutlinedButton.icon(
                  onPressed: () => Navigator.of(context).push(
                    MaterialPageRoute<void>(
                      builder: (_) => RegistersScreen(session: widget.session),
                    ),
                  ),
                  icon: const Icon(Icons.fact_check_outlined),
                  label: const Text('Registros de ventas y compras'),
                ),
                const SizedBox(height: 10),
                OutlinedButton.icon(
                  onPressed: _export,
                  icon: const Icon(Icons.download_outlined),
                  label: const Text('Descargar reportes'),
                ),
                if (_canClose) ...[
                  const SizedBox(height: 10),
                  OutlinedButton.icon(
                    onPressed: _close,
                    icon: const Icon(Icons.lock_outline),
                    label: Text('Cerrar ${monthName(_period)}'),
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

/// Qué descargar: lo del mes o el balance del año hasta ese mes.
/// Qué descargar: el reporte del mes (PDF), lo del mes o el balance del año,
/// en Excel o en PDF.
class _ExportSheet extends StatelessWidget {
  const _ExportSheet({required this.period});

  final String period;

  @override
  Widget build(BuildContext context) {
    final year = period.substring(0, 4);
    Widget formats(ExportKind kind) => Padding(
      padding: const EdgeInsets.fromLTRB(16, 0, 16, 8),
      child: Row(
        children: [
          for (final (i, format) in ExportFormat.values.indexed) ...[
            if (i > 0) const SizedBox(width: 10),
            Expanded(
              child: OutlinedButton.icon(
                style: OutlinedButton.styleFrom(minimumSize: const Size(0, 48)),
                onPressed: () => Navigator.of(context).pop((kind, format)),
                icon: Icon(
                  format == ExportFormat.pdf
                      ? Icons.picture_as_pdf_outlined
                      : Icons.table_chart_outlined,
                  size: 20,
                ),
                label: Text(format.label),
              ),
            ),
          ],
        ],
      ),
    );
    return SafeArea(
      child: SingleChildScrollView(
        padding: const EdgeInsets.fromLTRB(8, 0, 8, 8),
        child: Column(
          mainAxisSize: MainAxisSize.min,
          crossAxisAlignment: CrossAxisAlignment.stretch,
          children: [
            Padding(
              padding: const EdgeInsets.symmetric(horizontal: 16),
              child: Text('Descargar reportes', style: Theme.of(context).textTheme.titleLarge),
            ),
            const SizedBox(height: 8),
            ListTile(
              leading: const IconBox(
                icon: Icons.picture_as_pdf_outlined,
                color: ContabiliColors.terracotta,
                background: ContabiliColors.terracottaSoft,
                size: 42,
              ),
              title: Text('Reporte de ${periodLabel(period)}'),
              subtitle: const Text('Cómo te fue, tu plata e impuestos, en PDF.'),
              onTap: () => Navigator.of(context).pop((ExportKind.monthlyReport, ExportFormat.pdf)),
            ),
            const Divider(),
            ListTile(
              leading: const Icon(Icons.receipt_long_outlined),
              title: Text('Movimientos de ${periodLabel(period)}'),
              subtitle: const Text('El libro diario: cada movimiento con su asiento.'),
            ),
            formats(ExportKind.journal),
            ListTile(
              leading: const Icon(Icons.balance_outlined),
              title: Text('Balance de $year hasta ${monthName(period)}'),
              subtitle: const Text('El balance de comprobación, para tu contador.'),
            ),
            formats(ExportKind.trialBalance),
          ],
        ),
      ),
    );
  }
}

/// Ícono y colores de cada tipo de movimiento.
(IconData, Color, Color) entryStyle(EntrySource source) => switch (source) {
  EntrySource.sale => (
    Icons.point_of_sale_outlined,
    ContabiliColors.green,
    ContabiliColors.greenSoft,
  ),
  EntrySource.collection => (
    Icons.savings_outlined,
    ContabiliColors.amber,
    ContabiliColors.goldSoft,
  ),
  EntrySource.expense => (
    Icons.shopping_bag_outlined,
    ContabiliColors.red,
    ContabiliColors.redSoft,
  ),
  EntrySource.payment => (
    Icons.outbox_outlined,
    ContabiliColors.indigo,
    ContabiliColors.indigoSoft,
  ),
  EntrySource.taxPayment => (
    Icons.account_balance_outlined,
    ContabiliColors.terracotta,
    ContabiliColors.terracottaSoft,
  ),
  EntrySource.reversal => (Icons.undo_rounded, ContabiliColors.ink2, ContabiliColors.sand),
  EntrySource.manual => (Icons.edit_note_rounded, ContabiliColors.ink2, ContabiliColors.sand),
};

class _EntryTile extends StatelessWidget {
  const _EntryTile({required this.entry, required this.onTap});

  final JournalEntry entry;
  final VoidCallback onTap;

  @override
  Widget build(BuildContext context) {
    final badge = entry.isReversed
        ? 'Anulado'
        : entry.isReversal
        ? 'Anulación'
        : null;
    final (icon, color, background) = entryStyle(entry.source);
    return InkWell(
      onTap: onTap,
      child: Padding(
        padding: const EdgeInsets.symmetric(horizontal: 16, vertical: 12),
        child: Row(
          children: [
            IconBox(icon: icon, color: color, background: background),
            const SizedBox(width: 14),
            Expanded(
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  Text(
                    entry.description,
                    style: TextStyle(
                      fontWeight: FontWeight.w500,
                      fontSize: 16,
                      decoration: entry.isReversed ? TextDecoration.lineThrough : null,
                    ),
                  ),
                  const SizedBox(height: 2),
                  Text(
                    // El comprobante ya va en la glosa («… · Boleta B001-45»).
                    [formatDate(entry.entryDate), ?badge].join(' · '),
                    style: const TextStyle(fontSize: 14, color: ContabiliColors.ink2),
                  ),
                ],
              ),
            ),
            const SizedBox(width: 10),
            Text(
              formatSoles(entry.total),
              style: ContabiliFonts.amount(
                18,
                color: entry.isReversed ? ContabiliColors.ink3 : color,
              ).copyWith(fontWeight: FontWeight.w700),
            ),
          ],
        ),
      ),
    );
  }
}

/// Detalle de un movimiento, con el asiento para quien quiera verlo.
class _EntryDetail extends StatelessWidget {
  const _EntryDetail({required this.entry, required this.canReverse});

  final JournalEntry entry;
  final bool canReverse;

  @override
  Widget build(BuildContext context) {
    return SafeArea(
      child: Padding(
        padding: const EdgeInsets.fromLTRB(20, 20, 20, 16),
        child: Column(
          mainAxisSize: MainAxisSize.min,
          crossAxisAlignment: CrossAxisAlignment.stretch,
          children: [
            Text(entry.description, style: Theme.of(context).textTheme.titleLarge),
            const SizedBox(height: 4),
            Text(
              '${formatDate(entry.entryDate)} · ${formatSoles(entry.total)} · '
              'anotado por ${entry.createdBy}',
              style: const TextStyle(color: ContabiliColors.ink2),
            ),
            if (entry.lines.isNotEmpty) ...[
              const SizedBox(height: 12),
              ExpansionTile(
                tilePadding: EdgeInsets.zero,
                title: Text('Ver el asiento contable (N.º ${entry.number}-${entry.fiscalYear})'),
                children: [
                  Table(
                    columnWidths: const {
                      0: FlexColumnWidth(3),
                      1: FlexColumnWidth(1.4),
                      2: FlexColumnWidth(1.4),
                    },
                    children: [
                      const TableRow(
                        children: [
                          Text('Cuenta', style: TextStyle(fontWeight: FontWeight.w700)),
                          Text(
                            'Debe',
                            textAlign: TextAlign.end,
                            style: TextStyle(fontWeight: FontWeight.w700),
                          ),
                          Text(
                            'Haber',
                            textAlign: TextAlign.end,
                            style: TextStyle(fontWeight: FontWeight.w700),
                          ),
                        ],
                      ),
                      for (final line in entry.lines)
                        TableRow(
                          children: [
                            Padding(
                              padding: const EdgeInsets.symmetric(vertical: 4),
                              child: Text('${line.accountCode} ${line.accountName}'),
                            ),
                            Text(
                              line.debit > 0 ? formatSoles(line.debit) : '',
                              textAlign: TextAlign.end,
                            ),
                            Text(
                              line.credit > 0 ? formatSoles(line.credit) : '',
                              textAlign: TextAlign.end,
                            ),
                          ],
                        ),
                    ],
                  ),
                ],
              ),
            ],
            const SizedBox(height: 16),
            if (canReverse)
              OutlinedButton.icon(
                onPressed: () => Navigator.of(context).pop(true),
                icon: const Icon(Icons.undo),
                label: const Text('Anular este movimiento'),
              ),
            TextButton(
              onPressed: () => Navigator.of(context).pop(false),
              child: const Text('Cerrar'),
            ),
          ],
        ),
      ),
    );
  }
}
