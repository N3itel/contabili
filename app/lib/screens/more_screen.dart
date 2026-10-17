import 'package:flutter/material.dart';

import '../session/session.dart';
import '../ui/theme.dart';
import '../ui/widgets.dart';
import 'team_screen.dart';

/// Más: equipo, cambiar de empresa, ayuda y cerrar sesión.
class MoreScreen extends StatelessWidget {
  const MoreScreen({super.key, required this.session});

  final SessionController session;

  @override
  Widget build(BuildContext context) {
    final user = session.user;
    final company = session.company!;
    return ListView(
      padding: const EdgeInsets.fromLTRB(16, 8, 16, 24),
      children: [
        ReadableWidth(
          maxWidth: 600,
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.stretch,
            children: [
              if (user != null)
                Padding(
                  padding: const EdgeInsets.symmetric(vertical: 8),
                  child: Text(
                    '${user.fullName}\n${company.role.label} en ${company.legalName}',
                    style: const TextStyle(fontSize: 16, color: ContabiliColors.ink2),
                  ),
                ),
              Card(
                child: Column(
                  children: [
                    ListTile(
                      leading: const Icon(Icons.group_outlined),
                      title: const Text('Tu equipo'),
                      subtitle: const Text('Invita a tu contador o a tu personal'),
                      trailing: const Icon(Icons.chevron_right),
                      onTap: () => Navigator.of(
                        context,
                      ).push(MaterialPageRoute(builder: (_) => TeamScreen(session: session))),
                    ),
                    const Divider(height: 1),
                    ListTile(
                      leading: const Icon(Icons.swap_horiz),
                      title: const Text('Cambiar de empresa'),
                      trailing: const Icon(Icons.chevron_right),
                      onTap: session.leaveCompany,
                    ),
                  ],
                ),
              ),
              const SizedBox(height: 14),
              Card(
                child: Column(
                  children: [
                    ListTile(
                      leading: const Icon(Icons.description_outlined),
                      title: const Text('Términos y condiciones'),
                      trailing: const Icon(Icons.open_in_new, size: 20),
                      onTap: () => session.openLink(session.page('/terminos')),
                    ),
                    const Divider(height: 1),
                    ListTile(
                      leading: const Icon(Icons.privacy_tip_outlined),
                      title: const Text('Privacidad'),
                      trailing: const Icon(Icons.open_in_new, size: 20),
                      onTap: () => session.openLink(session.page('/privacidad')),
                    ),
                  ],
                ),
              ),
              const SizedBox(height: 20),
              OutlinedButton.icon(
                onPressed: session.logout,
                icon: const Icon(Icons.logout),
                label: const Text('Cerrar sesión'),
              ),
            ],
          ),
        ),
      ],
    );
  }
}
