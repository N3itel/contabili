import 'package:flutter/material.dart';

import '../api/api.dart';
import '../core/dates.dart';
import '../core/money.dart';
import '../session/session.dart';
import '../ui/theme.dart';
import '../ui/widgets.dart';

/// Lo anotado en el mes, del más nuevo al más antiguo. Un error se corrige
/// anulándolo (se registra al revés, nunca se borra) y, quien registra, cierra el mes.
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
                Row(
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
                if (_isClosed) ...[
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
                  const Padding(
                    padding: EdgeInsets.symmetric(vertical: 32),
                    child: Text(
                      'Todavía no hay nada anotado este mes.',
                      textAlign: TextAlign.center,
                      style: TextStyle(fontSize: 17, color: ContabiliColors.ink2),
                    ),
                  )
                else
                  Card(
                    child: Column(
                      children: [
                        for (final (i, entry) in entries.indexed) ...[
                          if (i > 0) const Divider(height: 1),
                          _EntryTile(entry: entry, onTap: () => _open(entry)),
                        ],
                      ],
                    ),
                  ),
                if (_nextAfter != null) ...[
                  const SizedBox(height: 10),
                  OutlinedButton(onPressed: _more, child: const Text('Ver más')),
                ],
                if (_canClose) ...[
                  const SizedBox(height: 20),
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
    return ListTile(
      onTap: onTap,
      contentPadding: const EdgeInsets.symmetric(horizontal: 16, vertical: 6),
      title: Text(
        entry.description,
        style: TextStyle(
          fontWeight: FontWeight.w600,
          decoration: entry.isReversed ? TextDecoration.lineThrough : null,
        ),
      ),
      subtitle: Text('${formatDate(entry.entryDate)}${badge == null ? '' : ' · $badge'}'),
      trailing: Text(
        formatSoles(entry.total),
        style: const TextStyle(fontWeight: FontWeight.w700, fontSize: 16),
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
