import 'package:flutter/material.dart';

/// Colores de la marca, los mismos del sitio (`backend/src/web/brand.ts`).
abstract final class ContabiliColors {
  static const green = Color(0xFF1E8A5F);
  static const ink = Color(0xFF12261E);
  static const ink2 = Color(0xFF3D5249);
  static const mint = Color(0xFFE6F4EC);
  static const paper = Color(0xFFFBFAF6);
  static const line = Color(0x1F12261E);
  static const red = Color(0xFFB42318);
  static const redSoft = Color(0xFFFDECEA);
  static const amber = Color(0xFFB54708);
  static const amberSoft = Color(0xFFFEF4E6);
}

/// Letra grande, botones anchos y alto contraste: la app tiene que poder
/// usarla alguien sin experiencia, también en una computadora vieja.
ThemeData contabiliTheme() {
  final scheme = ColorScheme.fromSeed(
    seedColor: ContabiliColors.green,
    primary: ContabiliColors.green,
    surface: ContabiliColors.paper,
    onSurface: ContabiliColors.ink,
    error: ContabiliColors.red,
  );
  final base = ThemeData(colorScheme: scheme, useMaterial3: true);
  final text = base.textTheme.apply(
    bodyColor: ContabiliColors.ink,
    displayColor: ContabiliColors.ink,
  );
  return base.copyWith(
    scaffoldBackgroundColor: ContabiliColors.paper,
    textTheme: text.copyWith(
      headlineMedium: text.headlineMedium?.copyWith(fontWeight: FontWeight.w800),
      titleLarge: text.titleLarge?.copyWith(fontWeight: FontWeight.w700),
      bodyLarge: text.bodyLarge?.copyWith(fontSize: 17, height: 1.45),
      bodyMedium: text.bodyMedium?.copyWith(fontSize: 16, height: 1.45),
    ),
    appBarTheme: const AppBarTheme(
      backgroundColor: ContabiliColors.paper,
      foregroundColor: ContabiliColors.ink,
      elevation: 0,
      scrolledUnderElevation: 0.5,
      centerTitle: false,
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
        textStyle: const TextStyle(fontSize: 18, fontWeight: FontWeight.w700),
        shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(16)),
      ),
    ),
    outlinedButtonTheme: OutlinedButtonThemeData(
      style: OutlinedButton.styleFrom(
        minimumSize: const Size.fromHeight(56),
        foregroundColor: ContabiliColors.ink,
        side: const BorderSide(color: ContabiliColors.line),
        textStyle: const TextStyle(fontSize: 17, fontWeight: FontWeight.w600),
        shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(16)),
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
    ),
    // Opciones legibles: texto oscuro siempre; la elegida, con fondo verde claro y borde verde.
    chipTheme: base.chipTheme.copyWith(
      labelStyle: const TextStyle(
        fontSize: 16,
        fontWeight: FontWeight.w600,
        color: ContabiliColors.ink,
      ),
      secondaryLabelStyle: const TextStyle(
        fontSize: 16,
        fontWeight: FontWeight.w700,
        color: ContabiliColors.ink,
      ),
      backgroundColor: Colors.white,
      selectedColor: ContabiliColors.mint,
      iconTheme: const IconThemeData(color: ContabiliColors.green),
      side: WidgetStateBorderSide.resolveWith(
        (states) => BorderSide(
          color: states.contains(WidgetState.selected)
              ? ContabiliColors.green
              : ContabiliColors.line,
          width: states.contains(WidgetState.selected) ? 2 : 1,
        ),
      ),
      padding: const EdgeInsets.symmetric(horizontal: 10, vertical: 10),
      shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(14)),
    ),
  );
}
