import 'package:flutter/material.dart';

/// Paleta andina, la misma del sitio (`backend/src/web/brand.ts`): terracota
/// de adobe, oro del Inti, añil de los tejidos, crema de alpaca y verde de
/// los andenes.
abstract final class ContabiliColors {
  static const terracotta = Color(0xFFB4442C);
  static const terracottaDark = Color(0xFF8E3220);
  static const terracottaSoft = Color(0xFFF6E3DA);
  static const gold = Color(0xFFD99A1E);
  static const goldSoft = Color(0xFFFBEFD3);
  static const ink = Color(0xFF1E2235);
  static const ink2 = Color(0xFF4A4E63);
  static const indigo = Color(0xFF34477A);
  static const indigoSoft = Color(0xFFE5E9F4);
  static const green = Color(0xFF2F7A52);
  static const greenSoft = Color(0xFFE3F1E8);
  static const paper = Color(0xFFFAF6EE);
  static const line = Color(0x1F1E2235);
  static const red = Color(0xFFA3201D);
  static const redSoft = Color(0xFFFBE5E3);
  // Los avisos de cuidado usan el oro, más oscuro para que se lea.
  static const amber = Color(0xFF8A5A00);
  static const amberSoft = goldSoft;
  static const mint = greenSoft;
}

/// Letra grande, botones anchos y alto contraste: la app tiene que poder
/// usarla alguien sin experiencia, también en una computadora vieja.
ThemeData contabiliTheme() {
  final scheme = ColorScheme.fromSeed(
    seedColor: ContabiliColors.terracotta,
    primary: ContabiliColors.terracotta,
    onPrimary: Colors.white,
    secondary: ContabiliColors.gold,
    surface: ContabiliColors.paper,
    onSurface: ContabiliColors.ink,
    error: ContabiliColors.red,
  );
  final base = ThemeData(colorScheme: scheme, useMaterial3: true, fontFamily: 'Figtree');
  final text = base.textTheme.apply(
    bodyColor: ContabiliColors.ink,
    displayColor: ContabiliColors.ink,
  );
  return base.copyWith(
    scaffoldBackgroundColor: ContabiliColors.paper,
    textTheme: text.copyWith(
      headlineMedium: text.headlineMedium?.copyWith(
        fontWeight: FontWeight.w800,
        letterSpacing: -0.5,
      ),
      headlineSmall: text.headlineSmall?.copyWith(fontWeight: FontWeight.w800),
      titleLarge: text.titleLarge?.copyWith(fontWeight: FontWeight.w800, letterSpacing: -0.2),
      titleMedium: text.titleMedium?.copyWith(fontWeight: FontWeight.w700),
      bodyLarge: text.bodyLarge?.copyWith(fontSize: 17, height: 1.45),
      bodyMedium: text.bodyMedium?.copyWith(fontSize: 16, height: 1.45),
    ),
    appBarTheme: const AppBarTheme(
      backgroundColor: ContabiliColors.paper,
      foregroundColor: ContabiliColors.ink,
      elevation: 0,
      scrolledUnderElevation: 0.5,
      centerTitle: false,
      titleTextStyle: TextStyle(
        fontFamily: 'Figtree',
        fontSize: 20,
        fontWeight: FontWeight.w800,
        color: ContabiliColors.ink,
      ),
    ),
    cardTheme: CardThemeData(
      color: Colors.white,
      elevation: 0,
      margin: EdgeInsets.zero,
      shape: RoundedRectangleBorder(
        borderRadius: BorderRadius.circular(20),
        side: const BorderSide(color: ContabiliColors.line),
      ),
    ),
    filledButtonTheme: FilledButtonThemeData(
      style: FilledButton.styleFrom(
        minimumSize: const Size.fromHeight(56),
        backgroundColor: ContabiliColors.terracotta,
        foregroundColor: Colors.white,
        textStyle: const TextStyle(
          fontFamily: 'Figtree',
          fontSize: 18,
          fontWeight: FontWeight.w800,
        ),
        shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(14)),
      ),
    ),
    outlinedButtonTheme: OutlinedButtonThemeData(
      style: OutlinedButton.styleFrom(
        minimumSize: const Size.fromHeight(56),
        foregroundColor: ContabiliColors.ink,
        side: const BorderSide(color: ContabiliColors.line),
        textStyle: const TextStyle(
          fontFamily: 'Figtree',
          fontSize: 17,
          fontWeight: FontWeight.w700,
        ),
        shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(14)),
      ),
    ),
    textButtonTheme: TextButtonThemeData(
      style: TextButton.styleFrom(
        foregroundColor: ContabiliColors.terracotta,
        textStyle: const TextStyle(fontFamily: 'Figtree', fontWeight: FontWeight.w700),
      ),
    ),
    inputDecorationTheme: InputDecorationTheme(
      filled: true,
      fillColor: Colors.white,
      contentPadding: const EdgeInsets.symmetric(horizontal: 16, vertical: 16),
      border: OutlineInputBorder(
        borderRadius: BorderRadius.circular(14),
        borderSide: const BorderSide(color: ContabiliColors.line),
      ),
      enabledBorder: OutlineInputBorder(
        borderRadius: BorderRadius.circular(14),
        borderSide: const BorderSide(color: ContabiliColors.line),
      ),
      focusedBorder: OutlineInputBorder(
        borderRadius: BorderRadius.circular(14),
        borderSide: const BorderSide(color: ContabiliColors.gold, width: 2),
      ),
    ),
    navigationBarTheme: NavigationBarThemeData(
      backgroundColor: Colors.white,
      indicatorColor: ContabiliColors.goldSoft,
      labelTextStyle: WidgetStateProperty.resolveWith(
        (states) => TextStyle(
          fontFamily: 'Figtree',
          fontSize: 12,
          fontWeight: states.contains(WidgetState.selected) ? FontWeight.w800 : FontWeight.w600,
          color: ContabiliColors.ink,
        ),
      ),
      iconTheme: WidgetStateProperty.resolveWith(
        (states) => IconThemeData(
          color: states.contains(WidgetState.selected)
              ? ContabiliColors.terracotta
              : ContabiliColors.ink2,
        ),
      ),
    ),
    navigationRailTheme: const NavigationRailThemeData(
      backgroundColor: Colors.white,
      indicatorColor: ContabiliColors.goldSoft,
      selectedIconTheme: IconThemeData(color: ContabiliColors.terracotta),
      selectedLabelTextStyle: TextStyle(
        fontFamily: 'Figtree',
        fontWeight: FontWeight.w800,
        color: ContabiliColors.ink,
      ),
    ),
    // Opciones legibles: texto oscuro siempre; la elegida, con fondo oro claro y borde terracota.
    chipTheme: base.chipTheme.copyWith(
      labelStyle: const TextStyle(
        fontFamily: 'Figtree',
        fontSize: 16,
        fontWeight: FontWeight.w700,
        color: ContabiliColors.ink,
      ),
      secondaryLabelStyle: const TextStyle(
        fontFamily: 'Figtree',
        fontSize: 16,
        fontWeight: FontWeight.w800,
        color: ContabiliColors.ink,
      ),
      backgroundColor: Colors.white,
      selectedColor: ContabiliColors.goldSoft,
      iconTheme: const IconThemeData(color: ContabiliColors.terracotta),
      side: WidgetStateBorderSide.resolveWith(
        (states) => BorderSide(
          color: states.contains(WidgetState.selected)
              ? ContabiliColors.terracotta
              : ContabiliColors.line,
          width: states.contains(WidgetState.selected) ? 2 : 1,
        ),
      ),
      padding: const EdgeInsets.symmetric(horizontal: 10, vertical: 10),
      shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(14)),
    ),
    segmentedButtonTheme: SegmentedButtonThemeData(
      style: ButtonStyle(
        backgroundColor: WidgetStateProperty.resolveWith(
          (states) =>
              states.contains(WidgetState.selected) ? ContabiliColors.goldSoft : Colors.white,
        ),
        foregroundColor: const WidgetStatePropertyAll(ContabiliColors.ink),
      ),
    ),
  );
}
