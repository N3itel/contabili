import 'package:flutter/material.dart';

import '../session/session.dart';
import '../ui/brand.dart';
import 'contacts_screen.dart';
import 'home_screen.dart';
import 'more_screen.dart';
import 'movements_screen.dart';
import 'plan_screen.dart';

/// Navegación de la empresa abierta: abajo en el celular, al costado en la
/// computadora.
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
    (Icons.home_outlined, Icons.home, 'Inicio'),
    (Icons.receipt_long_outlined, Icons.receipt_long, 'Movimientos'),
    (Icons.people_alt_outlined, Icons.people_alt, 'Clientes'),
    (Icons.workspace_premium_outlined, Icons.workspace_premium, 'Mi plan'),
    (Icons.menu, Icons.menu, 'Más'),
  ];

  @override
  void dispose() {
    _changes.dispose();
    super.dispose();
  }

  void _goTo(int tab) => setState(() => _tab = tab);

  @override
  Widget build(BuildContext context) {
    final company = widget.session.company!;
    final pages = [
      HomeScreen(session: widget.session, changes: _changes, onOpenPlan: () => _goTo(3)),
      MovementsScreen(session: widget.session, changes: _changes),
      ContactsScreen(session: widget.session, changes: _changes),
      PlanScreen(session: widget.session),
      MoreScreen(session: widget.session, changes: _changes),
    ];
    final wide = MediaQuery.sizeOf(context).width >= 840;
    final body = IndexedStack(index: _tab, children: pages);
    final appBar = AppBar(
      title: BrandTitle(text: company.legalName),
      bottom: const PreferredSize(preferredSize: Size.fromHeight(8), child: TocapuBand(height: 8)),
    );
    if (wide) {
      return Scaffold(
        appBar: appBar,
        body: Row(
          children: [
            NavigationRail(
              selectedIndex: _tab,
              onDestinationSelected: _goTo,
              labelType: NavigationRailLabelType.all,
              destinations: [
                for (final (icon, selected, label) in _destinations)
                  NavigationRailDestination(
                    icon: Icon(icon),
                    selectedIcon: Icon(selected),
                    label: Text(label),
                  ),
              ],
            ),
            const VerticalDivider(width: 1),
            Expanded(child: body),
          ],
        ),
      );
    }
    return Scaffold(
      appBar: appBar,
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
