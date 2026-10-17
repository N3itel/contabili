import 'package:flutter/material.dart';
import 'package:flutter/services.dart';

import '../api/api.dart';
import '../session/session.dart';
import '../ui/theme.dart';
import '../ui/widgets.dart';

/// Quién trabaja en la empresa. El dueño invita por celular: la persona ve la
/// invitación al entrar a Contabili con ese número.
class TeamScreen extends StatefulWidget {
  const TeamScreen({super.key, required this.session});

  final SessionController session;

  @override
  State<TeamScreen> createState() => _TeamScreenState();
}

class _TeamScreenState extends State<TeamScreen> {
  List<Member>? _members;
  Object? _error;
  final _phone = TextEditingController();
  Role _role = Role.accountant;
  bool _busy = false;
  String? _message;
  bool _messageIsError = false;

  Company get _company => widget.session.company!;
  bool get _owner => _company.role == Role.owner;

  @override
  void initState() {
    super.initState();
    _load();
  }

  @override
  void dispose() {
    _phone.dispose();
    super.dispose();
  }

  Future<void> _load() async {
    try {
      final members = await widget.session.api.members(_company.id);
      if (mounted) setState(() => _members = members);
    } on ApiException catch (error) {
      if (mounted) setState(() => _error = error);
    }
  }

  Future<void> _invite() async {
    setState(() {
      _busy = true;
      _message = null;
    });
    try {
      await widget.session.api.invite(_company.id, phone: _phone.text, role: _role);
      setState(() {
        _message =
            'Listo. Cuando esa persona entre a Contabili con su celular, verá tu invitación.';
        _messageIsError = false;
        _phone.clear();
      });
    } on ApiException catch (error) {
      setState(() {
        _message = error.message;
        _messageIsError = true;
      });
    } finally {
      if (mounted) setState(() => _busy = false);
    }
  }

  Future<void> _remove(Member member) async {
    final ok = await showDialog<bool>(
      context: context,
      builder: (context) => AlertDialog(
        title: Text('¿Sacar a ${member.fullName}?'),
        content: const Text('Ya no podrá ver ni anotar nada en esta empresa.'),
        actions: [
          TextButton(
            onPressed: () => Navigator.of(context).pop(false),
            child: const Text('Cancelar'),
          ),
          FilledButton(
            style: FilledButton.styleFrom(minimumSize: const Size(0, 48)),
            onPressed: () => Navigator.of(context).pop(true),
            child: const Text('Sacar'),
          ),
        ],
      ),
    );
    if (ok != true) return;
    try {
      await widget.session.api.removeMember(_company.id, member.userId);
      await _load();
    } on ApiException catch (error) {
      setState(() {
        _message = error.message;
        _messageIsError = true;
      });
    }
  }

  @override
  Widget build(BuildContext context) {
    final members = _members;
    final me = widget.session.user?.id;
    return Scaffold(
      appBar: AppBar(title: const Text('Tu equipo')),
      body: members == null
          ? LoadState(error: _error, onRetry: _load)
          : ListView(
              padding: const EdgeInsets.all(16),
              children: [
                ReadableWidth(
                  maxWidth: 600,
                  child: Column(
                    crossAxisAlignment: CrossAxisAlignment.stretch,
                    children: [
                      Card(
                        child: Column(
                          children: [
                            for (final (i, member) in members.indexed) ...[
                              if (i > 0) const Divider(height: 1),
                              ListTile(
                                title: Text(
                                  member.userId == me ? '${member.fullName} (tú)' : member.fullName,
                                  style: const TextStyle(fontWeight: FontWeight.w600),
                                ),
                                subtitle: Text('${member.role.label} · ${member.phone}'),
                                trailing: _owner && member.userId != me
                                    ? IconButton(
                                        tooltip: 'Sacar de la empresa',
                                        onPressed: () => _remove(member),
                                        icon: const Icon(Icons.person_remove_outlined),
                                      )
                                    : null,
                              ),
                            ],
                          ],
                        ),
                      ),
                      if (_owner) ...[
                        const SizedBox(height: 24),
                        Text('Invitar a alguien', style: Theme.of(context).textTheme.titleLarge),
                        const SizedBox(height: 4),
                        const Text(
                          'Por ejemplo, a tu contador o a quien te ayuda con las ventas.',
                          style: TextStyle(color: ContabiliColors.ink2),
                        ),
                        const SizedBox(height: 12),
                        TextField(
                          controller: _phone,
                          keyboardType: TextInputType.phone,
                          inputFormatters: [FilteringTextInputFormatter.allow(RegExp(r'[\d +]'))],
                          decoration: const InputDecoration(labelText: 'Su celular'),
                          onChanged: (_) => setState(() {}),
                        ),
                        const SizedBox(height: 8),
                        RadioGroup<Role>(
                          groupValue: _role,
                          onChanged: (v) => setState(() => _role = v ?? _role),
                          child: Column(
                            children: [
                              for (final role in Role.values)
                                RadioListTile<Role>(
                                  value: role,
                                  contentPadding: EdgeInsets.zero,
                                  title: Text(
                                    role.label,
                                    style: const TextStyle(fontWeight: FontWeight.w600),
                                  ),
                                  subtitle: Text(role.hint),
                                ),
                            ],
                          ),
                        ),
                        const SizedBox(height: 8),
                        FilledButton(
                          onPressed: _busy || _phone.text.trim().length < 9 ? null : _invite,
                          child: Text(_busy ? 'Invitando…' : 'Invitar'),
                        ),
                      ],
                      if (_message != null) ...[
                        const SizedBox(height: 12),
                        Notice(
                          text: _message!,
                          tone: _messageIsError ? NoticeTone.error : NoticeTone.info,
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
