import 'package:flutter/material.dart';

import '../api/api.dart';
import '../core/dates.dart';
import '../core/money.dart';
import '../core/operations.dart';
import '../session/session.dart';
import '../ui/theme.dart';
import '../ui/widgets.dart';
import 'operation_screen.dart';

/// Clientes y proveedores: quién te debe y a quién le debes.
class ContactsScreen extends StatefulWidget {
  const ContactsScreen({super.key, required this.session, required this.changes});

  final SessionController session;
  final ValueNotifier<int> changes;

  @override
  State<ContactsScreen> createState() => _ContactsScreenState();
}

class _ContactsScreenState extends State<ContactsScreen> {
  ContactKind _kind = ContactKind.customer;
  List<Contact>? _contacts;
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
      final list = await widget.session.api.contacts(_company.id);
      if (mounted) setState(() => _contacts = list);
    } on ApiException catch (error) {
      if (mounted) setState(() => _error = error);
    }
  }

  Future<void> _add() async {
    final created = await showDialog<Contact>(
      context: context,
      builder: (_) => NewContactDialog(session: widget.session, kind: _kind),
    );
    if (created != null) await _load();
  }

  @override
  Widget build(BuildContext context) {
    final all = _contacts;
    if (all == null) return LoadState(error: _error, onRetry: _load);
    final list = all.where((c) => c.kind == _kind).toList();
    final total = list.fold<int>(0, (sum, c) => sum + (c.balance > 0 ? c.balance : 0));
    final customers = _kind == ContactKind.customer;
    return RefreshIndicator(
      onRefresh: _load,
      child: ListView(
        padding: const EdgeInsets.fromLTRB(16, 12, 16, 24),
        children: [
          ReadableWidth(
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.stretch,
              children: [
                SegmentedButton<ContactKind>(
                  showSelectedIcon: false,
                  segments: const [
                    ButtonSegment(value: ContactKind.customer, label: Text('Clientes')),
                    ButtonSegment(value: ContactKind.supplier, label: Text('Proveedores')),
                  ],
                  selected: {_kind},
                  onSelectionChanged: (s) => setState(() => _kind = s.first),
                ),
                const SizedBox(height: 14),
                StatTile(
                  icon: customers ? Icons.call_received_rounded : Icons.call_made_rounded,
                  iconColor: customers ? ContabiliColors.green : ContabiliColors.red,
                  iconBackground: customers ? ContabiliColors.greenSoft : ContabiliColors.redSoft,
                  label: customers ? 'Te deben en total' : 'Debes en total',
                  amount: total,
                  color: customers ? ContabiliColors.green : ContabiliColors.red,
                  detail: customers
                      ? '${list.where((c) => c.balance > 0).length} de ${list.length} clientes tienen algo pendiente.'
                      : '${list.where((c) => c.balance > 0).length} de ${list.length} proveedores esperan un pago.',
                ),
                const SizedBox(height: 12),
                if (list.isEmpty)
                  EmptyState(
                    title: customers
                        ? 'Todavía no tienes clientes'
                        : 'Todavía no tienes proveedores',
                    message: customers
                        ? 'Agrégalos para saber quién te debe y cuánto.'
                        : 'Agrégalos para saber a quién le debes y cuánto.',
                  )
                else
                  Card(
                    child: Column(
                      children: [
                        for (final (i, c) in list.indexed) ...[
                          if (i > 0) const Divider(indent: 76),
                          ListTile(
                            contentPadding: const EdgeInsets.symmetric(horizontal: 16, vertical: 6),
                            leading: InitialsAvatar(name: c.name),
                            title: Text(
                              c.name,
                              style: const TextStyle(fontWeight: FontWeight.w600),
                            ),
                            subtitle: Text(c.ruc == null ? c.kind.label : 'RUC ${c.ruc}'),
                            trailing: Text(
                              formatSoles(c.balance),
                              style: ContabiliFonts.amount(
                                18,
                                color: c.balance > 0
                                    ? (customers ? ContabiliColors.green : ContabiliColors.red)
                                    : ContabiliColors.ink3,
                              ),
                            ),
                            onTap: () => Navigator.of(context).push(
                              MaterialPageRoute(
                                builder: (_) =>
                                    ContactDetailScreen(session: widget.session, contactId: c.id),
                              ),
                            ),
                          ),
                        ],
                      ],
                    ),
                  ),
                if (_company.role.canRecord) ...[
                  const SizedBox(height: 14),
                  OutlinedButton.icon(
                    onPressed: _add,
                    icon: const Icon(Icons.person_add_alt),
                    label: Text(customers ? 'Agregar cliente' : 'Agregar proveedor'),
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

/// Lo que pasó con un cliente o proveedor, con el saldo después de cada movimiento.
class ContactDetailScreen extends StatefulWidget {
  const ContactDetailScreen({super.key, required this.session, required this.contactId});

  final SessionController session;
  final String contactId;

  @override
  State<ContactDetailScreen> createState() => _ContactDetailScreenState();
}

class _ContactDetailScreenState extends State<ContactDetailScreen> {
  ContactDetail? _detail;
  Object? _error;

  @override
  void initState() {
    super.initState();
    _load();
  }

  Future<void> _load() async {
    try {
      final detail = await widget.session.api.contact(widget.session.company!.id, widget.contactId);
      if (mounted) setState(() => _detail = detail);
    } on ApiException catch (error) {
      if (mounted) setState(() => _error = error);
    }
  }

  @override
  Widget build(BuildContext context) {
    final detail = _detail;
    return Scaffold(
      appBar: AppBar(title: Text(detail?.contact.name ?? '')),
      body: detail == null
          ? LoadState(error: _error, onRetry: _load)
          : ListView(
              padding: const EdgeInsets.all(16),
              children: [
                ReadableWidth(
                  child: Column(
                    crossAxisAlignment: CrossAxisAlignment.stretch,
                    children: [
                      Card(
                        child: Padding(
                          padding: const EdgeInsets.all(18),
                          child: Row(
                            children: [
                              InitialsAvatar(name: detail.contact.name, size: 58),
                              const SizedBox(width: 16),
                              Expanded(
                                child: Column(
                                  crossAxisAlignment: CrossAxisAlignment.start,
                                  children: [
                                    Text(
                                      detail.contact.kind == ContactKind.customer
                                          ? 'Te debe'
                                          : 'Le debes',
                                      style: const TextStyle(color: ContabiliColors.ink2),
                                    ),
                                    Text(
                                      formatSoles(detail.contact.balance),
                                      style: ContabiliFonts.amount(32),
                                    ),
                                    Text(
                                      detail.contact.ruc == null
                                          ? detail.contact.kind.label
                                          : '${detail.contact.kind.label} · RUC ${detail.contact.ruc}',
                                      style: const TextStyle(color: ContabiliColors.ink2),
                                    ),
                                  ],
                                ),
                              ),
                            ],
                          ),
                        ),
                      ),
                      const SizedBox(height: 20),
                      const SectionTitle('Movimientos'),
                      if (detail.movements.isEmpty)
                        const Padding(
                          padding: EdgeInsets.all(24),
                          child: Text(
                            'Sin movimientos todavía.',
                            textAlign: TextAlign.center,
                            style: TextStyle(color: ContabiliColors.ink2),
                          ),
                        )
                      else
                        Card(
                          child: Column(
                            children: [
                              for (final (i, m) in detail.movements.reversed.indexed) ...[
                                if (i > 0) const Divider(),
                                ListTile(
                                  title: Text(m.description),
                                  subtitle: Text(
                                    '${formatDate(m.entryDate)} · queda ${formatSoles(m.balance)}',
                                  ),
                                  trailing: Text(
                                    '${m.amount > 0 ? '+' : ''}${formatSoles(m.amount)}',
                                    style: ContabiliFonts.amount(
                                      17,
                                      color: m.amount > 0
                                          ? ContabiliColors.ink
                                          : ContabiliColors.green,
                                    ),
                                  ),
                                ),
                              ],
                            ],
                          ),
                        ),
                    ],
                  ),
                ),
              ],
            ),
    );
  }
}
