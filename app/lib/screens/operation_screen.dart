import 'package:flutter/material.dart';
import 'package:flutter/services.dart';

import '../api/api.dart';
import '../core/dates.dart';
import '../core/money.dart';
import '../core/operations.dart';
import '../session/session.dart';
import '../ui/theme.dart';
import '../ui/widgets.dart';

/// Las cuatro cosas que pasan en un negocio, como las dice el dueño.
enum OperationType {
  sale(
    'Vendí',
    'Entró plata por una venta',
    'Anotar una venta',
    'Anotar otra venta',
    Icons.point_of_sale_outlined,
    ContabiliColors.green,
    ContabiliColors.mint,
  ),
  expense(
    'Gasté',
    'Compras, servicios, sueldos',
    'Anotar un gasto',
    'Anotar otro gasto',
    Icons.shopping_bag_outlined,
    ContabiliColors.red,
    ContabiliColors.redSoft,
  ),
  collection(
    'Cobré',
    'Un cliente me pagó lo que debía',
    'Anotar un cobro',
    'Anotar otro cobro',
    Icons.savings_outlined,
    ContabiliColors.green,
    Color(0xFFEFF6F1),
  ),
  payment(
    'Pagué',
    'Pagué lo que debía a un proveedor',
    'Anotar un pago',
    'Anotar otro pago',
    Icons.outbox_outlined,
    ContabiliColors.amber,
    ContabiliColors.amberSoft,
  );

  const OperationType(
    this.verb,
    this.hint,
    this.title,
    this.another,
    this.icon,
    this.foreground,
    this.background,
  );

  final String verb;
  final String hint;
  final String title;
  final String another;
  final IconData icon;
  final Color foreground;
  final Color background;
}

/// Anotar lo que pasó, sin debe ni haber: monto, cómo se pagó y listo. Muestra
/// antes de guardar cuánto es IGV y, al guardar, qué se registró en palabras simples.
class OperationScreen extends StatefulWidget {
  const OperationScreen({super.key, required this.session, required this.type});

  final SessionController session;
  final OperationType type;

  @override
  State<OperationScreen> createState() => _OperationScreenState();
}

class _OperationScreenState extends State<OperationScreen> {
  final _amount = TextEditingController();
  final _reference = TextEditingController();

  SaleKind _kind = SaleKind.goods;
  ExpenseCategory _category = ExpenseCategory.services;
  Settlement _settlement = Settlement.cash;
  Money _money = Money.cash;
  bool _withInvoice = true;
  late String _date = limaDate(DateTime.now());
  bool _busy = false;
  String? _error;

  Company get _company => widget.session.company!;
  TaxRegime get _regime => _company.taxRegime;

  Cents? get _total {
    final cents = parseSoles(_amount.text);
    return cents == null || cents <= 0 ? null : cents;
  }

  Operation? get _operation {
    final total = _total;
    if (total == null) return null;
    return switch (widget.type) {
      OperationType.sale => Sale(total, kind: _kind, paidWith: _settlement),
      OperationType.expense => Expense(
        total,
        category: _category,
        paidWith: _settlement,
        withInvoice: _withInvoice && _invoiceMatters,
      ),
      OperationType.collection => Collection(total, into: _money),
      OperationType.payment => Payment(total, from: _money),
    };
  }

  /// La factura solo cambia algo si la empresa cobra IGV y el gasto lo lleva.
  bool get _invoiceMatters => _regime.chargesIgv && _category.carriesIgv;

  @override
  void dispose() {
    _amount.dispose();
    _reference.dispose();
    super.dispose();
  }

  Future<void> _pickDate() async {
    final today = DateTime.parse(limaDate(DateTime.now()));
    final picked = await showDatePicker(
      context: context,
      initialDate: DateTime.parse(_date),
      firstDate: DateTime(today.year - 2),
      lastDate: today,
      helpText: '¿Cuándo pasó?',
    );
    if (picked != null) setState(() => _date = limaDate(picked.add(const Duration(hours: 12))));
  }

  Future<void> _save() async {
    final operation = _operation;
    if (operation == null) return;
    setState(() {
      _busy = true;
      _error = null;
    });
    try {
      final reference = _reference.text.trim();
      final result = await widget.session.api.recordOperation(
        _company.id,
        operation,
        date: _date,
        reference: reference.isEmpty ? null : reference,
      );
      if (!mounted) return;
      await _showDone(result.explanation);
    } on ApiException catch (error) {
      if (mounted) setState(() => _error = error.message);
    } finally {
      if (mounted) setState(() => _busy = false);
    }
  }

  Future<void> _showDone(String explanation) async {
    final again = await showModalBottomSheet<bool>(
      context: context,
      isDismissible: false,
      builder: (context) => SafeArea(
        child: Padding(
          padding: const EdgeInsets.fromLTRB(20, 24, 20, 20),
          child: Column(
            mainAxisSize: MainAxisSize.min,
            crossAxisAlignment: CrossAxisAlignment.stretch,
            children: [
              const Icon(Icons.check_circle, color: ContabiliColors.green, size: 56),
              const SizedBox(height: 12),
              Text(
                '¡Listo, quedó anotado!',
                textAlign: TextAlign.center,
                style: Theme.of(
                  context,
                ).textTheme.headlineSmall?.copyWith(fontWeight: FontWeight.w800),
              ),
              const SizedBox(height: 8),
              Text(
                explanation,
                textAlign: TextAlign.center,
                style: Theme.of(context).textTheme.bodyLarge,
              ),
              const SizedBox(height: 20),
              FilledButton(
                onPressed: () => Navigator.of(context).pop(false),
                child: const Text('Listo'),
              ),
              const SizedBox(height: 8),
              OutlinedButton(
                onPressed: () => Navigator.of(context).pop(true),
                child: Text(widget.type.another),
              ),
            ],
          ),
        ),
      ),
    );
    if (!mounted) return;
    if (again == true) {
      setState(() {
        _amount.clear();
        _reference.clear();
      });
      // Avisa a Inicio que hubo cambios, aunque sigamos en esta pantalla.
      _savedSomething = true;
    } else {
      Navigator.of(context).pop(true);
    }
  }

  bool _savedSomething = false;

  @override
  Widget build(BuildContext context) {
    final type = widget.type;
    final today = limaDate(DateTime.now());
    return PopScope(
      canPop: false,
      onPopInvokedWithResult: (didPop, _) {
        if (!didPop) Navigator.of(context).pop(_savedSomething);
      },
      child: Scaffold(
        appBar: AppBar(title: Text(type.title)),
        body: ListView(
          padding: const EdgeInsets.all(20),
          children: [
            ReadableWidth(
              maxWidth: 560,
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.stretch,
                children: [
                  TextField(
                    controller: _amount,
                    autofocus: true,
                    keyboardType: const TextInputType.numberWithOptions(decimal: true),
                    inputFormatters: [FilteringTextInputFormatter.allow(RegExp(r'[\d.,]'))],
                    style: const TextStyle(fontSize: 34, fontWeight: FontWeight.w800),
                    decoration: InputDecoration(
                      prefixText: 'S/ ',
                      prefixStyle: const TextStyle(
                        fontSize: 34,
                        fontWeight: FontWeight.w800,
                        color: ContabiliColors.ink,
                      ),
                      hintText: '0.00',
                      labelText: switch (type) {
                        OperationType.sale => '¿Cuánto vendiste?',
                        OperationType.expense => '¿Cuánto gastaste?',
                        OperationType.collection => '¿Cuánto te pagaron?',
                        OperationType.payment => '¿Cuánto pagaste?',
                      },
                      helperText: switch (type) {
                        OperationType.sale ||
                        OperationType.expense => 'El total, con IGV incluido si lo hubo.',
                        _ => null,
                      },
                    ),
                    onChanged: (_) => setState(() {}),
                  ),
                  const SizedBox(height: 22),
                  ..._details(),
                  const SizedBox(height: 18),
                  ListTile(
                    contentPadding: EdgeInsets.zero,
                    leading: const Icon(Icons.event_outlined),
                    title: Text(_date == today ? 'Hoy' : formatDate(_date)),
                    subtitle: const Text('Fecha'),
                    trailing: TextButton(onPressed: _pickDate, child: const Text('Cambiar')),
                  ),
                  TextField(
                    controller: _reference,
                    maxLength: 40,
                    decoration: const InputDecoration(
                      labelText: 'N.º de boleta o factura (si tienes)',
                      hintText: 'B001-123',
                    ),
                  ),
                  const SizedBox(height: 8),
                  _Preview(operation: _operation, regime: _regime),
                  ErrorText(_error),
                  const SizedBox(height: 16),
                  FilledButton(
                    onPressed: _operation == null || _busy ? null : _save,
                    child: Text(_busy ? 'Guardando…' : 'Guardar'),
                  ),
                ],
              ),
            ),
          ],
        ),
      ),
    );
  }

  List<Widget> _details() {
    const cash = (Settlement.cash, 'Efectivo', Icons.payments_outlined);
    const bank = (Settlement.bank, 'Banco o Yape', Icons.account_balance_outlined);
    switch (widget.type) {
      case OperationType.sale:
        return [
          ChoiceRow<SaleKind>(
            label: '¿Qué vendiste?',
            value: _kind,
            onChanged: (v) => setState(() => _kind = v),
            options: const [
              (SaleKind.goods, 'Productos', Icons.inventory_2_outlined),
              (SaleKind.services, 'Servicios', Icons.handyman_outlined),
            ],
          ),
          const SizedBox(height: 18),
          ChoiceRow<Settlement>(
            label: '¿Cómo te pagaron?',
            value: _settlement,
            onChanged: (v) => setState(() => _settlement = v),
            options: const [
              cash,
              bank,
              (Settlement.credit, 'Me lo deben', Icons.schedule_outlined),
            ],
          ),
        ];
      case OperationType.expense:
        return [
          Text('¿En qué gastaste?', style: Theme.of(context).textTheme.titleMedium),
          const SizedBox(height: 8),
          RadioGroup<ExpenseCategory>(
            groupValue: _category,
            onChanged: (v) => setState(() => _category = v ?? _category),
            child: Column(
              children: [
                for (final category in ExpenseCategory.values)
                  RadioListTile<ExpenseCategory>(
                    value: category,
                    dense: true,
                    contentPadding: EdgeInsets.zero,
                    title: Text(
                      category.label,
                      style: const TextStyle(fontSize: 17, fontWeight: FontWeight.w600),
                    ),
                    subtitle: Text(category.hint),
                  ),
              ],
            ),
          ),
          const SizedBox(height: 12),
          ChoiceRow<Settlement>(
            label: '¿Cómo pagaste?',
            value: _settlement,
            onChanged: (v) => setState(() => _settlement = v),
            options: const [cash, bank, (Settlement.credit, 'Lo debo', Icons.schedule_outlined)],
          ),
          if (_invoiceMatters) ...[
            const SizedBox(height: 8),
            SwitchListTile(
              contentPadding: EdgeInsets.zero,
              value: _withInvoice,
              onChanged: (v) => setState(() => _withInvoice = v),
              title: const Text(
                'Tengo factura a nombre de mi empresa',
                style: TextStyle(fontWeight: FontWeight.w600),
              ),
              subtitle: const Text('Con factura, el IGV te ayuda a pagar menos a SUNAT.'),
            ),
          ],
        ];
      case OperationType.collection:
      case OperationType.payment:
        return [
          ChoiceRow<Money>(
            label: widget.type == OperationType.collection
                ? '¿Dónde entró la plata?'
                : '¿De dónde salió la plata?',
            value: _money,
            onChanged: (v) => setState(() => _money = v),
            options: const [
              (Money.cash, 'Efectivo', Icons.payments_outlined),
              (Money.bank, 'Banco o Yape', Icons.account_balance_outlined),
            ],
          ),
        ];
    }
  }
}

/// Antes de guardar: cuánto es IGV, con las mismas reglas del servidor.
class _Preview extends StatelessWidget {
  const _Preview({required this.operation, required this.regime});

  final Operation? operation;
  final TaxRegime regime;

  @override
  Widget build(BuildContext context) {
    final op = operation;
    if (op == null || op is Collection || op is Payment) return const SizedBox.shrink();
    final split = operationIgv(op, regime);
    final text = split.igv > 0
        ? '${formatSoles(split.base)} ${op is Sale ? 'es tu venta' : 'es tu gasto'} y '
              '${formatSoles(split.igv)} es IGV.'
        : regime.chargesIgv
        ? 'No lleva IGV que descontar.'
        : 'En el Nuevo RUS no se separa el IGV.';
    return Notice(text: text);
  }
}
