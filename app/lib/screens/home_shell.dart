import 'package:flutter/material.dart';

import '../core/dates.dart';
import '../session/session.dart';
import '../ui/andean.dart';
import '../ui/brand.dart';
import '../ui/theme.dart';
import '../ui/widgets.dart';
import 'contacts_screen.dart';
import 'home_screen.dart';
import 'more_screen.dart';
import 'movements_screen.dart';
import 'plan_screen.dart';

/// Navegación de la empresa abierta: abajo en el celular; en la computadora,
/// una barra lateral con la marca, la empresa y quién está usando la app.
class HomeShell extends StatefulWidget {
  const HomeShell({super.key, required this.session});

  final SessionController session;

  @override
  State<HomeShell> createState() => _HomeShellState();
}

class _HomeShellState extends State<HomeShell> {
  int _tab = 0;

  /// Cambia cuando se registra algo, para que las pestañas se actualicen.
  final ValueNotifier<int> _changes = ValueNotifier(0);

  static const _destinations = [
    (Icons.home_outlined, Icons.home_rounded, 'Inicio'),
    (Icons.receipt_long_outlined, Icons.receipt_long_rounded, 'Movimientos'),
    (Icons.people_alt_outlined, Icons.people_alt_rounded, 'Clientes'),
    (Icons.workspace_premium_outlined, Icons.workspace_premium_rounded, 'Mi plan'),
    (Icons.grid_view_outlined, Icons.grid_view_rounded, 'Más'),
  ];

  @override
  void dispose() {
    _changes.dispose();
    super.dispose();
  }

  void _goTo(int tab) => setState(() => _tab = tab);

  @override
  Widget build(BuildContext context) {
    final session = widget.session;
    final company = session.company!;
    final wide = MediaQuery.sizeOf(context).width >= 840;
    final pages = [
      HomeScreen(
        session: session,
        changes: _changes,
        onOpenPlan: () => _goTo(3),
        showGreeting: !wide,
      ),
      MovementsScreen(session: session, changes: _changes),
      ContactsScreen(session: session, changes: _changes),
      PlanScreen(session: session),
      MoreScreen(session: session, changes: _changes),
    ];
    final body = IndexedStack(index: _tab, children: pages);
    if (wide) {
      final firstName = session.user?.firstName;
      final month = periodLabel(limaDate(DateTime.now()).substring(0, 7));
      final (title, subtitle) = _tab == 0
          ? (firstName == null ? 'Inicio' : 'Hola, $firstName', 'Así va tu negocio en $month')
          : (_destinations[_tab].$3, company.legalName);
      return Scaffold(
        body: Row(
          children: [
            _Sidebar(session: session, selected: _tab, onSelect: _goTo),
            Expanded(
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.stretch,
                children: [
                  _PageHeader(title: title, subtitle: subtitle),
                  Expanded(child: body),
                ],
              ),
            ),
          ],
        ),
      );
    }
    return Scaffold(
      appBar: AppBar(
        title: BrandTitle(text: company.legalName),
        bottom: const PreferredSize(
          preferredSize: Size.fromHeight(8),
          child: TocapuBand(height: 8),
        ),
      ),
      body: body,
      bottomNavigationBar: NavigationBar(
        selectedIndex: _tab,
        onDestinationSelected: _goTo,
        destinations: [
          for (final (icon, selected, label) in _destinations)
            NavigationDestination(icon: Icon(icon), selectedIcon: Icon(selected), label: label),
        ],
      ),
    );
  }
}

class _PageHeader extends StatelessWidget {
  const _PageHeader({required this.title, required this.subtitle});

  final String title;
  final String subtitle;

  @override
  Widget build(BuildContext context) {
    return Padding(
      padding: const EdgeInsets.fromLTRB(32, 28, 32, 12),
      child: Align(
        alignment: Alignment.topCenter,
        child: ConstrainedBox(
          constraints: const BoxConstraints(maxWidth: 1040),
          child: SizedBox(
            width: double.infinity,
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Semantics(header: true, child: Text(title, style: ContabiliFonts.title(32))),
                const SizedBox(height: 4),
                Text(subtitle, style: const TextStyle(fontSize: 16, color: ContabiliColors.ink2)),
              ],
            ),
          ),
        ),
      ),
    );
  }
}

/// Barra lateral de la computadora.
class _Sidebar extends StatelessWidget {
  const _Sidebar({required this.session, required this.selected, required this.onSelect});

  final SessionController session;
  final int selected;
  final ValueChanged<int> onSelect;

  @override
  Widget build(BuildContext context) {
    final user = session.user;
    return Container(
      key: const Key('sidebar'),
      width: 280,
      decoration: const BoxDecoration(
        color: Colors.white,
        border: Border(right: BorderSide(color: ContabiliColors.line)),
      ),
      child: Column(
        children: [
          Expanded(
            child: LayoutBuilder(
              builder: (context, constraints) => SingleChildScrollView(
                child: ConstrainedBox(
                  constraints: BoxConstraints(minHeight: constraints.maxHeight),
                  child: IntrinsicHeight(
                    child: Padding(
                      padding: const EdgeInsets.fromLTRB(18, 24, 18, 16),
                      child: Column(
                        crossAxisAlignment: CrossAxisAlignment.stretch,
                        children: [
                          Row(
                            children: [
                              const ContabiliMark(size: 40),
                              const SizedBox(width: 10),
                              Flexible(
                                child: Text(
                                  'Contabili',
                                  overflow: TextOverflow.ellipsis,
                                  style: ContabiliFonts.title(
                                    26,
                                  ).copyWith(fontWeight: FontWeight.w800),
                                ),
                              ),
                              const SizedBox(width: 8),
                              const BetaBadge(),
                            ],
                          ),
                          const SizedBox(height: 22),
                          _CompanyCard(session: session),
                          const SizedBox(height: 18),
                          for (final (i, (icon, filled, label))
                              in _HomeShellState._destinations.indexed) ...[
                            _NavItem(
                              icon: i == selected ? filled : icon,
                              label: label,
                              selected: i == selected,
                              onTap: () => onSelect(i),
                            ),
                            const SizedBox(height: 4),
                          ],
                          const Spacer(),
                          const SizedBox(height: 16),
                          if (user != null)
                            Row(
                              children: [
                                InitialsAvatar(name: user.fullName, size: 38),
                                const SizedBox(width: 10),
                                Expanded(
                                  child: Text(
                                    user.fullName,
                                    overflow: TextOverflow.ellipsis,
                                    style: const TextStyle(fontWeight: FontWeight.w500),
                                  ),
                                ),
                              ],
                            ),
                          const SizedBox(height: 8),
                          TextButton.icon(
                            style: TextButton.styleFrom(
                              alignment: Alignment.centerLeft,
                              minimumSize: const Size.fromHeight(48),
                            ),
                            onPressed: session.leaveCompany,
                            icon: const Icon(Icons.swap_horiz),
                            label: const Text('Cambiar de empresa'),
                          ),
                        ],
                      ),
                    ),
                  ),
                ),
              ),
            ),
          ),
          const TocapuBand(height: 10),
        ],
      ),
    );
  }
}

class _CompanyCard extends StatelessWidget {
  const _CompanyCard({required this.session});

  final SessionController session;

  @override
  Widget build(BuildContext context) {
    final company = session.company!;
    return Container(
      padding: const EdgeInsets.all(12),
      decoration: BoxDecoration(
        color: ContabiliColors.paper,
        borderRadius: BorderRadius.circular(18),
        border: Border.all(color: ContabiliColors.line),
      ),
      child: Row(
        children: [
          InitialsAvatar(name: company.legalName, size: 42),
          const SizedBox(width: 12),
          Expanded(
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Text(
                  company.legalName,
                  maxLines: 2,
                  overflow: TextOverflow.ellipsis,
                  style: const TextStyle(fontWeight: FontWeight.w600, fontSize: 15),
                ),
                Text(
                  '${company.role.label} · RUC ${company.ruc}',
                  style: const TextStyle(fontSize: 13, color: ContabiliColors.ink2),
                ),
              ],
            ),
          ),
        ],
      ),
    );
  }
}

class _NavItem extends StatelessWidget {
  const _NavItem({
    required this.icon,
    required this.label,
    required this.selected,
    required this.onTap,
  });

  final IconData icon;
  final String label;
  final bool selected;
  final VoidCallback onTap;

  @override
  Widget build(BuildContext context) {
    return Semantics(
      selected: selected,
      button: true,
      child: Material(
        color: selected ? ContabiliColors.goldSoft : Colors.transparent,
        borderRadius: BorderRadius.circular(14),
        child: InkWell(
          borderRadius: BorderRadius.circular(14),
          onTap: onTap,
          child: Padding(
            padding: const EdgeInsets.symmetric(horizontal: 14, vertical: 14),
            child: Row(
              children: [
                Icon(icon, color: selected ? ContabiliColors.terracotta : ContabiliColors.ink2),
                const SizedBox(width: 14),
                Expanded(
                  child: Text(
                    label,
                    style: TextStyle(
                      fontSize: 16,
                      fontWeight: selected ? FontWeight.w700 : FontWeight.w500,
                      color: selected ? ContabiliColors.terracottaDark : ContabiliColors.ink,
                    ),
                  ),
                ),
                if (selected) const StepGlyph(size: 14),
              ],
            ),
          ),
        ),
      ),
    );
  }
}
