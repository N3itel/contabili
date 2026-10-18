import 'package:flutter/material.dart';

import '../session/session.dart';
import '../ui/theme.dart';
import '../ui/widgets.dart';
import 'einvoicing_screen.dart';
import 'registers_screen.dart';
import 'taxes_screen.dart';
import 'team_screen.dart';

/// Más: impuestos, equipo, cambiar de empresa, ayuda y cerrar sesión.
class MoreScreen extends StatelessWidget {
  const MoreScreen({super.key, required this.session, this.changes});

  final SessionController session;
  final ValueNotifier<int>? changes;

  @override
  Widget build(BuildContext context) {
    final user = session.user;
    final company = session.company!;
    return ListView(
      padding: const EdgeInsets.fromLTRB(16, 16, 16, 32),
      children: [
        ReadableWidth(
          maxWidth: 640,
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.stretch,
            children: [
              if (user != null) ...[
                Card(
                  child: Padding(
                    padding: const EdgeInsets.all(16),
                    child: Row(
                      children: [
                        InitialsAvatar(name: user.fullName, size: 54),
                        const SizedBox(width: 14),
                        Expanded(
                          child: Column(
                            crossAxisAlignment: CrossAxisAlignment.start,
                            children: [
                              Text(user.fullName, style: ContabiliFonts.title(21)),
                              Text(
                                '${company.role.label} en ${company.legalName}',
                                style: const TextStyle(fontSize: 15, color: ContabiliColors.ink2),
                              ),
                            ],
                          ),
                        ),
                      ],
                    ),
                  ),
                ),
                const SizedBox(height: 20),
              ],
              const SectionTitle('Tu empresa'),
              Card(
                child: Column(
                  children: [
                    _MoreTile(
                      icon: Icons.account_balance_outlined,
                      color: ContabiliColors.amber,
                      background: ContabiliColors.goldSoft,
                      title: 'Impuestos del mes',
                      subtitle: 'Cuánto te toca pagar a SUNAT',
                      onTap: () => Navigator.of(context).push(
                        MaterialPageRoute<void>(
                          builder: (_) => TaxesScreen(session: session, changes: changes),
                        ),
                      ),
                    ),
                    const Divider(indent: 76),
                    _MoreTile(
                      icon: Icons.receipt_long_outlined,
                      color: ContabiliColors.green,
                      background: ContabiliColors.greenSoft,
                      title: 'Facturación electrónica (beta)',
                      subtitle: 'Emite boletas y facturas',
                      onTap: () => Navigator.of(context).push(
                        MaterialPageRoute<void>(
                          builder: (_) => EinvoicingScreen(session: session, changes: changes),
                        ),
                      ),
                    ),
                    const Divider(indent: 76),
                    _MoreTile(
                      icon: Icons.fact_check_outlined,
                      color: ContabiliColors.terracotta,
                      background: ContabiliColors.terracottaSoft,
                      title: 'Registros de ventas y compras',
                      subtitle: 'Tus boletas y facturas del mes',
                      onTap: () => Navigator.of(context).push(
                        MaterialPageRoute<void>(builder: (_) => RegistersScreen(session: session)),
                      ),
                    ),
                    const Divider(indent: 76),
                    _MoreTile(
                      icon: Icons.group_outlined,
                      color: ContabiliColors.indigo,
                      background: ContabiliColors.indigoSoft,
                      title: 'Tu equipo',
                      subtitle: 'Invita a tu contador o a tu personal',
                      onTap: () => Navigator.of(
                        context,
                      ).push(MaterialPageRoute(builder: (_) => TeamScreen(session: session))),
                    ),
                    const Divider(indent: 76),
                    _MoreTile(
                      icon: Icons.swap_horiz,
                      color: ContabiliColors.green,
                      background: ContabiliColors.greenSoft,
                      title: 'Cambiar de empresa',
                      onTap: session.leaveCompany,
                    ),
                  ],
                ),
              ),
              const SizedBox(height: 24),
              const SectionTitle('Ayuda y legal'),
              Card(
                child: Column(
                  children: [
                    _MoreTile(
                      icon: Icons.description_outlined,
                      title: 'Términos y condiciones',
                      external: true,
                      onTap: () => session.openLink(session.page('/terminos')),
                    ),
                    const Divider(indent: 76),
                    _MoreTile(
                      icon: Icons.privacy_tip_outlined,
                      title: 'Privacidad',
                      external: true,
                      onTap: () => session.openLink(session.page('/privacidad')),
                    ),
                  ],
                ),
              ),
              const SizedBox(height: 24),
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

class _MoreTile extends StatelessWidget {
  const _MoreTile({
    required this.icon,
    required this.title,
    required this.onTap,
    this.subtitle,
    this.color = ContabiliColors.terracotta,
    this.background = ContabiliColors.terracottaSoft,
    this.external = false,
  });

  final IconData icon;
  final String title;
  final String? subtitle;
  final Color color;
  final Color background;
  final bool external;
  final VoidCallback onTap;

  @override
  Widget build(BuildContext context) {
    return ListTile(
      contentPadding: const EdgeInsets.symmetric(horizontal: 16, vertical: 6),
      leading: IconBox(icon: icon, color: color, background: background, size: 44),
      title: Text(title),
      subtitle: subtitle == null ? null : Text(subtitle!),
      trailing: Icon(
        external ? Icons.open_in_new : Icons.chevron_right,
        size: external ? 20 : 24,
        color: ContabiliColors.ink3,
      ),
      onTap: onTap,
    );
  }
}
