import 'package:flutter/material.dart';
import 'package:flutter/services.dart';

import '../api/api.dart';
import '../core/operations.dart';
import '../core/ruc.dart';
import '../ui/theme.dart';
import '../ui/widgets.dart';

/// Crear la empresa: RUC, razón social y régimen, con ayuda para elegirlo.
class CreateCompanyScreen extends StatefulWidget {
  const CreateCompanyScreen({super.key, required this.api});

  final ContabiliApi api;

  @override
  State<CreateCompanyScreen> createState() => _CreateCompanyScreenState();
}

class _CreateCompanyScreenState extends State<CreateCompanyScreen> {
  final _ruc = TextEditingController();
  final _name = TextEditingController();
  TaxRegime? _regime;
  bool _busy = false;
  String? _error;

  String? get _rucProblem {
    final ruc = _ruc.text;
    if (ruc.length < 11) return null;
    return isValidRuc(ruc) ? null : 'Ese RUC no es válido. Revisa los 11 dígitos.';
  }

  bool get _ready =>
      isValidRuc(_ruc.text) && _name.text.trim().length >= 3 && _regime != null && !_busy;

  Future<void> _save() async {
    setState(() {
      _busy = true;
      _error = null;
    });
    try {
      final company = await widget.api.createCompany(
        ruc: _ruc.text,
        legalName: _name.text.trim(),
        taxRegime: _regime!,
      );
      if (mounted) Navigator.of(context).pop(company);
    } on ApiException catch (error) {
      setState(() => _error = error.message);
    } finally {
      if (mounted) setState(() => _busy = false);
    }
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      appBar: AppBar(title: const Text('Tu empresa')),
      body: ListView(
        padding: const EdgeInsets.all(20),
        children: [
          ReadableWidth(
            maxWidth: 560,
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.stretch,
              children: [
                TextField(
                  controller: _ruc,
                  autofocus: true,
                  keyboardType: TextInputType.number,
                  inputFormatters: [
                    FilteringTextInputFormatter.digitsOnly,
                    LengthLimitingTextInputFormatter(11),
                  ],
                  style: const TextStyle(fontSize: 20, letterSpacing: 1),
                  decoration: InputDecoration(
                    labelText: 'RUC',
                    helperText: 'Los 11 dígitos de tu ficha RUC.',
                    errorText: _rucProblem,
                  ),
                  onChanged: (_) => setState(() {}),
                ),
                const SizedBox(height: 16),
                TextField(
                  controller: _name,
                  textCapitalization: TextCapitalization.characters,
                  style: const TextStyle(fontSize: 18),
                  decoration: const InputDecoration(
                    labelText: 'Razón social o nombre',
                    helperText: 'Como figura en SUNAT.',
                  ),
                  onChanged: (_) => setState(() {}),
                ),
                const SizedBox(height: 24),
                Text('¿En qué régimen estás?', style: Theme.of(context).textTheme.titleMedium),
                const SizedBox(height: 4),
                const Text(
                  'Lo dice tu ficha RUC en SUNAT. Si no sabes, pregúntale a tu contador; '
                  'casi todas las pequeñas empresas están en el MYPE Tributario.',
                  style: TextStyle(color: ContabiliColors.ink2),
                ),
                const SizedBox(height: 8),
                RadioGroup<TaxRegime>(
                  groupValue: _regime,
                  onChanged: (value) => setState(() => _regime = value),
                  child: Column(
                    children: [
                      for (final regime in TaxRegime.values)
                        RadioListTile<TaxRegime>(
                          value: regime,
                          contentPadding: EdgeInsets.zero,
                          title: Text(
                            regime.label,
                            style: const TextStyle(fontWeight: FontWeight.w600),
                          ),
                          subtitle: Text(regime.hint),
                        ),
                    ],
                  ),
                ),
                const SizedBox(height: 16),
                FilledButton(
                  onPressed: _ready ? _save : null,
                  child: Text(_busy ? 'Creando…' : 'Crear mi empresa'),
                ),
                ErrorText(_error),
              ],
            ),
          ),
        ],
      ),
    );
  }
}
