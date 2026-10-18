import 'package:flutter/material.dart';

import '../api/api.dart';
import '../session/session.dart';
import '../ui/brand.dart';
import '../ui/theme.dart';
import '../ui/widgets.dart';
import 'create_company_screen.dart';

/// Elegir con qué empresa trabajar, aceptar invitaciones o crear la primera.
/// Si había una empresa abierta la última vez, entra directo.
class CompaniesScreen extends StatefulWidget {
  const CompaniesScreen({super.key, required this.session, this.autoOpen = true});

  final SessionController session;
  final bool autoOpen;

  @override
  State<CompaniesScreen> createState() => _CompaniesScreenState();
}

class _CompaniesScreenState extends State<CompaniesScreen> {
  List<Company>? _companies;
  List<Invitation> _invitations = const [];
  Object? _error;
  String? _actionError;

  ContabiliApi get _api => widget.session.api;

  @override
  void initState() {
    super.initState();
    _load(autoOpen: widget.autoOpen);
  }

  Future<void> _load({bool autoOpen = false}) async {
    setState(() => _error = null);
    try {
      final results = await Future.wait([_api.companies(), _api.myInvitations()]);
      final companies = results[0] as List<Company>;
      final invitations = results[1] as List<Invitation>;
      if (autoOpen) {
        final last = await widget.session.store.lastCompanyId();
        final match = companies.where((c) => c.id == last).firstOrNull;
        final only = companies.length == 1 && invitations.isEmpty ? companies.first : null;
        if (match ?? only case final company?) {
          await widget.session.openCompany(company);
          return;
        }
      }
      if (mounted) {
        setState(() {
          _companies = companies;
          _invitations = invitations;
        });
      }
    } on ApiException catch (error) {
      if (mounted) setState(() => _error = error);
    }
  }

  Future<void> _respond(Invitation invitation, bool accept) async {
    setState(() => _actionError = null);
    try {
      await _api.respondInvitation(invitation.id, accept: accept);
      await _load();
    } on ApiException catch (error) {
      setState(() => _actionError = error.message);
    }
  }

  Future<void> _create() async {
    final company = await Navigator.of(
      context,
    ).push<Company>(MaterialPageRoute(builder: (_) => CreateCompanyScreen(api: _api)));
    if (company != null) await widget.session.openCompany(company);
  }

  @override
  Widget build(BuildContext context) {
    final companies = _companies;
    final user = widget.session.user;
    return Scaffold(
      appBar: AppBar(
        title: const BrandTitle(markSize: 32),
        bottom: const PreferredSize(
          preferredSize: Size.fromHeight(8),
          child: TocapuBand(height: 8),
        ),
        actions: [TextButton(onPressed: widget.session.logout, child: const Text('Salir'))],
      ),
      body: companies == null
          ? LoadState(error: _error, onRetry: _load)
          : RefreshIndicator(
              onRefresh: _load,
              child: ListView(
                padding: const EdgeInsets.all(20),
                children: [
                  ReadableWidth(
                    child: Column(
                      crossAxisAlignment: CrossAxisAlignment.stretch,
                      children: [
                        Text(
                          user == null ? 'Tus empresas' : 'Hola, ${user.firstName}',
                          style: Theme.of(context).textTheme.headlineMedium,
                        ),
                        const SizedBox(height: 6),
                        Text(
                          companies.isEmpty
                              ? 'Crea tu empresa para empezar. Tienes 30 días gratis para probar todo.'
                              : '¿Con qué empresa vas a trabajar?',
                          style: Theme.of(
                            context,
                          ).textTheme.bodyLarge?.copyWith(color: ContabiliColors.ink2),
                        ),
                        const SizedBox(height: 20),
                        for (final invitation in _invitations) ...[
                          _InvitationCard(
                            invitation: invitation,
                            onAccept: () => _respond(invitation, true),
                            onDecline: () => _respond(invitation, false),
                          ),
                          const SizedBox(height: 12),
                        ],
                        ErrorText(_actionError),
                        for (final company in companies) ...[
                          Card(
                            child: ListTile(
                              contentPadding: const EdgeInsets.symmetric(
                                horizontal: 18,
                                vertical: 8,
                              ),
                              title: Text(
                                company.legalName,
                                style: const TextStyle(fontWeight: FontWeight.w700, fontSize: 18),
                              ),
                              subtitle: Text('RUC ${company.ruc} · ${company.role.label}'),
                              trailing: const Icon(Icons.chevron_right),
                              onTap: () => widget.session.openCompany(company),
                            ),
                          ),
                          const SizedBox(height: 10),
                        ],
                        const SizedBox(height: 8),
                        companies.isEmpty
                            ? FilledButton.icon(
                                onPressed: _create,
                                icon: const Icon(Icons.add_business_outlined),
                                label: const Text('Crear mi empresa'),
                              )
                            : OutlinedButton.icon(
                                onPressed: _create,
                                icon: const Icon(Icons.add_business_outlined),
                                label: const Text('Agregar otra empresa'),
                              ),
                      ],
                    ),
                  ),
                ],
              ),
            ),
    );
  }
}

class _InvitationCard extends StatelessWidget {
  const _InvitationCard({
    required this.invitation,
    required this.onAccept,
    required this.onDecline,
  });

  final Invitation invitation;
  final VoidCallback onAccept;
  final VoidCallback onDecline;

  @override
  Widget build(BuildContext context) {
    return Card(
      color: ContabiliColors.mint,
      child: Padding(
        padding: const EdgeInsets.all(18),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.stretch,
          children: [
            Text(
              '${invitation.invitedBy} te invitó a ${invitation.legalName}',
              style: const TextStyle(fontWeight: FontWeight.w700, fontSize: 18),
            ),
            const SizedBox(height: 4),
            Text('Como ${invitation.role.label.toLowerCase()}: ${invitation.role.hint}'),
            const SizedBox(height: 12),
            Row(
              children: [
                Expanded(
                  child: OutlinedButton(onPressed: onDecline, child: const Text('No, gracias')),
                ),
                const SizedBox(width: 10),
                Expanded(
                  child: FilledButton(onPressed: onAccept, child: const Text('Aceptar')),
                ),
              ],
            ),
          ],
        ),
      ),
    );
  }
}
