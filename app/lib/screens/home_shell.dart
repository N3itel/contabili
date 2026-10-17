import 'package:flutter/material.dart';

import '../session/session.dart';
import '../ui/brand.dart';
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

  /// Cambia cuando se registra algo, para que Inicio y Movimientos se actualicen.
  final ValueNotifier<int> _changes = ValueNotifier(0);

  static const _destinations = [
    (Icons.home_outlined, Icons.home, 'Inicio'),
    (Icons.receipt_long_outlined, Icons.receipt_long, 'Movimientos'),
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
      HomeScreen(session: widget.session, changes: _changes, onOpenPlan: () => _goTo(2)),
      MovementsScreen(session: widget.session, changes: _changes),
      PlanScreen(session: widget.session),
      MoreScreen(session: widget.session),
    ];
    final wide = MediaQuery.sizeOf(context).width >= 840;
    final body = IndexedStack(index: _tab, children: pages);
    final title = Row(
      children: [
        const ContabiliMark(size: 30),
        const SizedBox(width: 10),
        Flexible(child: Text(company.legalName, overflow: TextOverflow.ellipsis)),
      ],
    );
    if (wide) {
      return Scaffold(
        appBar: AppBar(title: title),
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
      appBar: AppBar(title: title),
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
