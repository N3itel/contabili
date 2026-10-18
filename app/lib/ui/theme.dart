import 'package:flutter/cupertino.dart' show CupertinoPageTransitionsBuilder;
import 'package:flutter/material.dart';

/// Paleta andina, la misma del sitio (`backend/src/web/brand.ts`): terracota
/// de adobe, oro del Inti, añil de los tejidos, crema de alpaca y verde de
/// los andenes.
abstract final class ContabiliColors {
  static const terracotta = Color(0xFFB4442C);
  static const terracottaDark = Color(0xFF8E3220);
  static const terracottaDeep = Color(0xFF5E2116);
  static const terracottaSoft = Color(0xFFF6E3DA);
  static const gold = Color(0xFFD99A1E);
  static const goldLight = Color(0xFFF2C46B);
  static const goldSoft = Color(0xFFFBEFD3);
  static const ink = Color(0xFF1E2235);
  static const ink2 = Color(0xFF4A4E63);
  static const ink3 = Color(0xFF6E7285);
  static const indigo = Color(0xFF34477A);
  static const indigoSoft = Color(0xFFE5E9F4);
  static const green = Color(0xFF2F7A52);
  static const greenSoft = Color(0xFFE3F1E8);
  static const paper = Color(0xFFFAF6EE);
  static const sand = Color(0xFFF1E8D8);
  static const line = Color(0x1F1E2235);
  static const red = Color(0xFFA3201D);
  static const redSoft = Color(0xFFFBE5E3);
  // Los avisos de cuidado usan el oro, más oscuro para que se lea.
  static const amber = Color(0xFF8A5A00);
  static const amberSoft = goldSoft;
  static const mint = greenSoft;
}

/// Letras: Saira (títulos y montos, firme como piedra labrada) y Lexend
/// (texto, hecha para leer con poco esfuerzo). Las genera `tools/letras.py`.
abstract final class ContabiliFonts {
  static const display = 'Saira';
  static const text = 'Lexend';

  /// Montos grandes: Saira con cifras del mismo ancho, para que no bailen.
  static TextStyle amount(double size, {Color color = ContabiliColors.ink}) => TextStyle(
    fontFamily: display,
    fontSize: size,
    fontWeight: FontWeight.w800,
    color: color,
    height: 1.1,
    fontFeatures: const [FontFeature.tabularFigures()],
  );

  static TextStyle title(double size, {Color color = ContabiliColors.ink}) => TextStyle(
    fontFamily: display,
    fontSize: size,
    fontWeight: FontWeight.w700,
    color: color,
    height: 1.15,
  );
}

/// Sombras suaves y cálidas, como luz de tarde sobre adobe.
abstract final class ContabiliShadows {
  static const card = [
    BoxShadow(color: Color(0x141E2235), blurRadius: 18, offset: Offset(0, 6)),
    BoxShadow(color: Color(0x0A1E2235), blurRadius: 3, offset: Offset(0, 1)),
  ];
  static const raised = [
    BoxShadow(color: Color(0x335E2116), blurRadius: 28, offset: Offset(0, 12)),
  ];
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
  final base = ThemeData(colorScheme: scheme, useMaterial3: true, fontFamily: ContabiliFonts.text);
  final text = base.textTheme.apply(
    bodyColor: ContabiliColors.ink,
    displayColor: ContabiliColors.ink,
  );
  TextStyle? display(TextStyle? style, FontWeight weight) =>
      style?.copyWith(fontFamily: ContabiliFonts.display, fontWeight: weight);
  const buttonText = TextStyle(
    fontFamily: ContabiliFonts.text,
    fontSize: 17,
    fontWeight: FontWeight.w600,
  );
  return base.copyWith(
    scaffoldBackgroundColor: ContabiliColors.paper,
    textTheme: text.copyWith(
      displaySmall: display(text.displaySmall, FontWeight.w800),
      headlineLarge: display(text.headlineLarge, FontWeight.w800),
      headlineMedium: display(text.headlineMedium, FontWeight.w800)?.copyWith(height: 1.15),
      headlineSmall: display(text.headlineSmall, FontWeight.w700),
      titleLarge: display(text.titleLarge, FontWeight.w700)?.copyWith(fontSize: 23),
      titleMedium: text.titleMedium?.copyWith(fontWeight: FontWeight.w600, fontSize: 17),
      titleSmall: text.titleSmall?.copyWith(fontWeight: FontWeight.w600),
      bodyLarge: text.bodyLarge?.copyWith(fontSize: 17, height: 1.5),
      bodyMedium: text.bodyMedium?.copyWith(fontSize: 16, height: 1.5),
      bodySmall: text.bodySmall?.copyWith(fontSize: 14, height: 1.45, color: ContabiliColors.ink2),
      labelLarge: text.labelLarge?.copyWith(fontWeight: FontWeight.w600),
    ),
    pageTransitionsTheme: const PageTransitionsTheme(
      builders: {
        TargetPlatform.android: FadeForwardsPageTransitionsBuilder(),
        TargetPlatform.linux: FadeForwardsPageTransitionsBuilder(),
        TargetPlatform.windows: FadeForwardsPageTransitionsBuilder(),
        TargetPlatform.iOS: CupertinoPageTransitionsBuilder(),
        TargetPlatform.macOS: CupertinoPageTransitionsBuilder(),
      },
    ),
    appBarTheme: const AppBarTheme(
      backgroundColor: ContabiliColors.paper,
      foregroundColor: ContabiliColors.ink,
      elevation: 0,
      scrolledUnderElevation: 0,
      centerTitle: false,
      titleTextStyle: TextStyle(
        fontFamily: ContabiliFonts.display,
        fontSize: 22,
        fontWeight: FontWeight.w700,
        color: ContabiliColors.ink,
      ),
    ),
    cardTheme: CardThemeData(
      color: Colors.white,
      elevation: 0,
      margin: EdgeInsets.zero,
      clipBehavior: Clip.antiAlias,
      shape: RoundedRectangleBorder(
        borderRadius: BorderRadius.circular(22),
        side: const BorderSide(color: ContabiliColors.line),
      ),
    ),
    dividerTheme: const DividerThemeData(color: ContabiliColors.line, space: 1),
    listTileTheme: const ListTileThemeData(
      titleTextStyle: TextStyle(
        fontFamily: ContabiliFonts.text,
        fontSize: 17,
        fontWeight: FontWeight.w500,
        color: ContabiliColors.ink,
      ),
      subtitleTextStyle: TextStyle(
        fontFamily: ContabiliFonts.text,
        fontSize: 14,
        color: ContabiliColors.ink2,
      ),
      iconColor: ContabiliColors.terracotta,
    ),
    filledButtonTheme: FilledButtonThemeData(
      style: FilledButton.styleFrom(
        minimumSize: const Size.fromHeight(58),
        backgroundColor: ContabiliColors.terracotta,
        foregroundColor: Colors.white,
        disabledBackgroundColor: ContabiliColors.sand,
        textStyle: buttonText.copyWith(fontSize: 18),
        shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(16)),
      ),
    ),
    outlinedButtonTheme: OutlinedButtonThemeData(
      style: OutlinedButton.styleFrom(
        minimumSize: const Size.fromHeight(56),
        foregroundColor: ContabiliColors.ink,
        backgroundColor: Colors.white,
        side: const BorderSide(color: ContabiliColors.line),
        textStyle: buttonText,
        shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(16)),
      ),
    ),
    textButtonTheme: TextButtonThemeData(
      style: TextButton.styleFrom(
        foregroundColor: ContabiliColors.terracotta,
        textStyle: buttonText.copyWith(fontSize: 16),
      ),
    ),
    inputDecorationTheme: InputDecorationTheme(
      filled: true,
      fillColor: Colors.white,
      contentPadding: const EdgeInsets.symmetric(horizontal: 18, vertical: 18),
      border: OutlineInputBorder(
        borderRadius: BorderRadius.circular(16),
        borderSide: const BorderSide(color: ContabiliColors.line),
      ),
      enabledBorder: OutlineInputBorder(
        borderRadius: BorderRadius.circular(16),
        borderSide: const BorderSide(color: ContabiliColors.line),
      ),
      focusedBorder: OutlineInputBorder(
        borderRadius: BorderRadius.circular(16),
        borderSide: const BorderSide(color: ContabiliColors.gold, width: 2),
      ),
      floatingLabelStyle: const TextStyle(color: ContabiliColors.terracottaDark),
    ),
    navigationBarTheme: NavigationBarThemeData(
      backgroundColor: Colors.white,
      surfaceTintColor: Colors.transparent,
      shadowColor: const Color(0x331E2235),
      elevation: 8,
      height: 72,
      indicatorColor: ContabiliColors.goldSoft,
      indicatorShape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(14)),
      labelTextStyle: WidgetStateProperty.resolveWith(
        // En Saira 12, «Movimientos» entra en una línea desde 375 px de ancho.
        (states) => TextStyle(
          fontFamily: ContabiliFonts.display,
          fontSize: 12,
          letterSpacing: -0.1,
          fontWeight: FontWeight.w600,
          color: states.contains(WidgetState.selected)
              ? ContabiliColors.terracottaDark
              : ContabiliColors.ink2,
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
    // Opciones legibles: texto oscuro siempre; la elegida, con fondo oro claro y borde terracota.
    chipTheme: base.chipTheme.copyWith(
      labelStyle: const TextStyle(
        fontFamily: ContabiliFonts.text,
        fontSize: 16,
        fontWeight: FontWeight.w500,
        color: ContabiliColors.ink,
      ),
      secondaryLabelStyle: const TextStyle(
        fontFamily: ContabiliFonts.text,
        fontSize: 16,
        fontWeight: FontWeight.w700,
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
      padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 12),
      shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(14)),
    ),
    segmentedButtonTheme: SegmentedButtonThemeData(
      style: ButtonStyle(
        minimumSize: const WidgetStatePropertyAll(Size(0, 52)),
        textStyle: const WidgetStatePropertyAll(
          TextStyle(fontFamily: ContabiliFonts.text, fontSize: 16, fontWeight: FontWeight.w600),
        ),
        backgroundColor: WidgetStateProperty.resolveWith(
          (states) =>
              states.contains(WidgetState.selected) ? ContabiliColors.terracotta : Colors.white,
        ),
        foregroundColor: WidgetStateProperty.resolveWith(
          (states) => states.contains(WidgetState.selected) ? Colors.white : ContabiliColors.ink,
        ),
        side: const WidgetStatePropertyAll(BorderSide(color: ContabiliColors.line)),
        shape: WidgetStatePropertyAll(
          RoundedRectangleBorder(borderRadius: BorderRadius.circular(14)),
        ),
      ),
    ),
    bottomSheetTheme: const BottomSheetThemeData(
      backgroundColor: ContabiliColors.paper,
      surfaceTintColor: Colors.transparent,
      showDragHandle: true,
      shape: RoundedRectangleBorder(borderRadius: BorderRadius.vertical(top: Radius.circular(28))),
    ),
    dialogTheme: DialogThemeData(
      backgroundColor: ContabiliColors.paper,
      surfaceTintColor: Colors.transparent,
      shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(26)),
      titleTextStyle: const TextStyle(
        fontFamily: ContabiliFonts.display,
        fontSize: 23,
        fontWeight: FontWeight.w700,
        color: ContabiliColors.ink,
      ),
    ),
    snackBarTheme: const SnackBarThemeData(
      behavior: SnackBarBehavior.floating,
      backgroundColor: ContabiliColors.ink,
      contentTextStyle: TextStyle(fontFamily: ContabiliFonts.text, fontSize: 16),
    ),
    progressIndicatorTheme: const ProgressIndicatorThemeData(color: ContabiliColors.terracotta),
  );
}
