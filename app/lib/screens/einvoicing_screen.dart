import 'package:flutter/material.dart';
import 'package:flutter/services.dart';

import '../api/api.dart';
import '../core/dates.dart';
import '../core/igv.dart';
import '../core/money.dart';
import '../core/operations.dart';
import '../core/ruc.dart';
import '../session/session.dart';
import '../ui/andean.dart';
import '../ui/brand.dart';
import '../ui/theme.dart';
import '../ui/widgets.dart';

/// Facturación electrónica (beta): configurar el proveedor y ver lo emitido.
class EinvoicingScreen extends StatefulWidget {
  const EinvoicingScreen({super.key, required this.session, this.changes});

  final SessionController session;
  final ValueNotifier<int>? changes;

  @override
  State<EinvoicingScreen> createState() => _EinvoicingScreenState();
}

class _EinvoicingScreenState extends State<EinvoicingScreen> {
  EinvoiceSettings? _settings;
  List<Einvoice> _issued = const [];
  Object? _error;
  bool _editing = false;
  String? _notice;

  Company get _company => widget.session.company!;
  ContabiliApi get _api => widget.session.api;
  bool get _owner => _company.role == Role.owner;

  @override
  void initState() {
    super.initState();
    _load();
  }

  Future<void> _load() async {
    setState(() => _error = null);
    try {
      final settings = await _api.einvoiceSettings(_company.id);
      final issued = settings.enabled
          ? await _api.einvoices(_company.id, period: limaDate(DateTime.now()).substring(0, 7))
          : const <Einvoice>[];
      if (mounted) {
        setState(() {
          _settings = settings;
          _issued = issued;
        });
      }
    } on ApiException catch (error) {
      if (mounted) setState(() => _error = error);
    }
  }

  Future<void> _emit() async {
    final emitted = await Navigator.of(
      context,
    ).push<bool>(MaterialPageRoute(builder: (_) => EmitScreen(session: widget.session)));
    if (emitted == true) {
      widget.changes?.value++;
      await _load();
    }
  }

  Future<void> _open(Einvoice e) async {
    try {
      final link = await _api.einvoiceLink(_company.id, e.id);
      await widget.session.openLink(link);
    } on ApiException catch (error) {
      setState(() => _notice = error.message);
    }
  }

  Future<void> _retry(Einvoice e, {required bool record}) async {
    try {
      final result = record
          ? await _api.recordEinvoice(_company.id, e.id)
          : await _api.refreshEinvoice(_company.id, e.id);
      setState(
        () => _notice =
            result.recordError ??
            (result.einvoice.recorded
                ? 'Listo: la venta quedó anotada.'
                : result.einvoice.statusMessage ?? result.einvoice.status.label),
      );
      if (result.einvoice.recorded) widget.changes?.value++;
      await _load();
    } on ApiException catch (error) {
      setState(() => _notice = error.message);
    }
  }

  @override
  Widget build(BuildContext context) {
    final settings = _settings;
    return Scaffold(
      appBar: AppBar(
        title: const Row(
          children: [
            Flexible(child: Text('Facturación electrónica', overflow: TextOverflow.ellipsis)),
            SizedBox(width: 8),
            BetaBadge(),
          ],
        ),
      ),
      body: settings == null
          ? LoadState(error: _error, onRetry: _load)
          : ListView(
              padding: const EdgeInsets.fromLTRB(16, 8, 16, 32),
              children: [
                ReadableWidth(
                  child: Column(
                    crossAxisAlignment: CrossAxisAlignment.stretch,
                    children: [
                      if (_notice != null) ...[Notice(text: _notice!), const SizedBox(height: 12)],
                      if (!settings.enabled || _editing)
                        _owner
                            ? _SettingsForm(
                                session: widget.session,
                                current: settings,
                                onSaved: (saved) {
                                  setState(() {
                                    _settings = saved;
                                    _editing = false;
                                    _notice = saved.isTest
                                        ? 'Listo: ya puedes emitir en modo de prueba.'
                                        : 'Listo: tu cuenta de Nubefact quedó conectada.';
                                  });
                                  _load();
                                },
                              )
                            : const Notice(
                                text:
                                    'Pide al dueño de la empresa que configure la facturación electrónica.',
                              )
                      else ...[
                        _StatusCard(
                          settings: settings,
                          onEdit: _owner ? () => setState(() => _editing = true) : null,
                        ),
                        const SizedBox(height: 16),
                        if (_company.role.canRecord)
                          FilledButton.icon(
                            onPressed: _emit,
                            icon: const Icon(Icons.receipt_long_outlined),
                            label: const Text('Emitir boleta o factura'),
                          ),
                        const SizedBox(height: 24),
                        const SectionTitle('Emitidos este mes'),
                        if (_issued.isEmpty)
                          const EmptyState(
                            title: 'Todavía no emites comprobantes',
                            message:
                                'Cada boleta o factura que emitas queda anotada como venta y en tu registro de ventas.',
                          )
                        else
                          Card(
                            child: Column(
                              children: [
                                for (final (i, e) in _issued.indexed) ...[
                                  if (i > 0) const Divider(indent: 76),
                                  _EinvoiceTile(
                                    einvoice: e,
                                    onOpen: () => _open(e),
                                    onRefresh: e.status == EinvoiceStatus.pending
                                        ? () => _retry(e, record: false)
                                        : null,
                                    onRecord: e.canRecord ? () => _retry(e, record: true) : null,
                                  ),
                                ],
                              ],
                            ),
                          ),
                      ],
                    ],
                  ),
                ),
              ],
            ),
    );
  }
}

class _StatusCard extends StatelessWidget {
  const _StatusCard({required this.settings, this.onEdit});

  final EinvoiceSettings settings;
  final VoidCallback? onEdit;

  @override
  Widget build(BuildContext context) {
    return HeroPanel(
      colors: settings.isTest
          ? const [ContabiliColors.indigo, Color(0xFF243256)]
          : const [ContabiliColors.green, Color(0xFF1F5A3B)],
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Text(
            settings.isTest ? 'Modo de prueba' : 'Conectado a Nubefact',
            style: ContabiliFonts.title(24, color: Colors.white),
          ),
          const SizedBox(height: 6),
          Text(
            settings.isTest
                ? 'Lo que emitas aquí no se manda a SUNAT: sirve para ver cómo queda. Cuando tengas tu cuenta en Nubefact, conéctala.'
                : 'Tus boletas y facturas se mandan a SUNAT por tu cuenta de Nubefact (${settings.endpointHost}).',
            style: const TextStyle(color: Color(0xE6FFFFFF), fontSize: 16),
          ),
          const SizedBox(height: 10),
          Text(
            'Series: ${settings.boletaSeries} para boletas · ${settings.facturaSeries} para facturas',
            style: const TextStyle(color: ContabiliColors.goldLight, fontWeight: FontWeight.w600),
          ),
          if (onEdit != null) ...[
            const SizedBox(height: 10),
            TextButton(
              style: TextButton.styleFrom(foregroundColor: Colors.white, padding: EdgeInsets.zero),
              onPressed: onEdit,
              child: const Text('Cambiar la configuración'),
            ),
          ],
        ],
      ),
    );
  }
}

/// Configurar: modo de prueba o la cuenta de Nubefact, y las series.
class _SettingsForm extends StatefulWidget {
  const _SettingsForm({required this.session, required this.current, required this.onSaved});

  final SessionController session;
  final EinvoiceSettings current;
  final ValueChanged<EinvoiceSettings> onSaved;

  @override
  State<_SettingsForm> createState() => _SettingsFormState();
}

class _SettingsFormState extends State<_SettingsForm> {
  late String _provider = widget.current.enabled ? widget.current.provider : 'test';
  late final _factura = TextEditingController(text: widget.current.facturaSeries);
  late final _boleta = TextEditingController(text: widget.current.boletaSeries);
  final _endpoint = TextEditingController();
  final _token = TextEditingController();
  bool _busy = false;
  String? _error;

  @override
  void dispose() {
    _factura.dispose();
    _boleta.dispose();
    _endpoint.dispose();
    _token.dispose();
    super.dispose();
  }

  Future<void> _save() async {
    setState(() {
      _busy = true;
      _error = null;
    });
    try {
      final saved = await widget.session.api.saveEinvoiceSettings(
        widget.session.company!.id,
        provider: _provider,
        facturaSeries: _factura.text.trim().toUpperCase(),
        boletaSeries: _boleta.text.trim().toUpperCase(),
        endpoint: _provider == 'nubefact' && _endpoint.text.trim().isNotEmpty
            ? _endpoint.text.trim()
            : null,
        token: _provider == 'nubefact' && _token.text.trim().isNotEmpty ? _token.text.trim() : null,
      );
      widget.onSaved(saved);
    } on ApiException catch (error) {
      setState(() => _error = error.message);
    } finally {
      if (mounted) setState(() => _busy = false);
    }
  }

  @override
  Widget build(BuildContext context) {
    final series = [
      FilteringTextInputFormatter.allow(RegExp(r'[A-Za-z0-9]')),
      LengthLimitingTextInputFormatter(4),
    ];
    return Column(
      crossAxisAlignment: CrossAxisAlignment.stretch,
      children: [
        const Notice(
          text:
              'Beta: emite boletas y facturas electrónicas desde Contabili. Empieza en modo de prueba; para mandarlas a SUNAT, conecta tu cuenta de Nubefact (un proveedor autorizado).',
        ),
        const SizedBox(height: 16),
        ChoiceRow<String>(
          label: '¿Cómo quieres emitir?',
          value: _provider,
          onChanged: (v) => setState(() => _provider = v),
          options: const [
            ('test', 'Modo de prueba', Icons.science_outlined),
            ('nubefact', 'Mi cuenta de Nubefact', Icons.cloud_done_outlined),
          ],
        ),
        const SizedBox(height: 16),
        Row(
          children: [
            Expanded(
              child: TextField(
                controller: _boleta,
                textCapitalization: TextCapitalization.characters,
                inputFormatters: series,
                decoration: const InputDecoration(labelText: 'Serie de boletas', hintText: 'B001'),
              ),
            ),
            const SizedBox(width: 10),
            Expanded(
              child: TextField(
                controller: _factura,
                textCapitalization: TextCapitalization.characters,
                inputFormatters: series,
                decoration: const InputDecoration(labelText: 'Serie de facturas', hintText: 'F001'),
              ),
            ),
          ],
        ),
        if (_provider == 'nubefact') ...[
          const SizedBox(height: 12),
          TextField(
            controller: _endpoint,
            keyboardType: TextInputType.url,
            decoration: InputDecoration(
              labelText: 'RUTA de Nubefact',
              hintText: 'https://api.nubefact.com/api/v1/…',
              helperText: widget.current.endpointHost == null
                  ? null
                  : 'Déjala en blanco para seguir usando la de ${widget.current.endpointHost}.',
            ),
          ),
          const SizedBox(height: 12),
          TextField(
            controller: _token,
            obscureText: true,
            decoration: InputDecoration(
              labelText: 'TOKEN de Nubefact',
              helperText: widget.current.hasToken
                  ? 'Ya hay un token guardado; escribe otro solo si cambió.'
                  : 'Se guarda cifrado y nadie lo puede volver a ver.',
            ),
          ),
        ],
        ErrorText(_error),
        const SizedBox(height: 16),
        FilledButton(
          onPressed: _busy ? null : _save,
          child: Text(_busy ? 'Guardando…' : 'Guardar'),
        ),
      ],
    );
  }
}

class _EinvoiceTile extends StatelessWidget {
  const _EinvoiceTile({
    required this.einvoice,
    required this.onOpen,
    this.onRefresh,
    this.onRecord,
  });

  final Einvoice einvoice;
  final VoidCallback onOpen;
  final VoidCallback? onRefresh;
  final VoidCallback? onRecord;

  @override
  Widget build(BuildContext context) {
    final e = einvoice;
    final (color, background) = switch (e.status) {
      EinvoiceStatus.accepted => (ContabiliColors.green, ContabiliColors.greenSoft),
      EinvoiceStatus.test => (ContabiliColors.indigo, ContabiliColors.indigoSoft),
      EinvoiceStatus.pending => (ContabiliColors.amber, ContabiliColors.goldSoft),
      EinvoiceStatus.rejected => (ContabiliColors.red, ContabiliColors.redSoft),
    };
    return Padding(
      padding: const EdgeInsets.symmetric(horizontal: 16, vertical: 12),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.stretch,
        children: [
          Row(
            children: [
              IconBox(icon: Icons.receipt_long_outlined, color: color, background: background),
              const SizedBox(width: 14),
              Expanded(
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    Text(
                      '${e.type.label} ${e.label}',
                      style: const TextStyle(fontWeight: FontWeight.w600, fontSize: 16),
                    ),
                    Text(
                      [
                        e.customerDoc == CustomerDoc.none
                            ? 'Clientes varios'
                            : (e.customerName ?? ''),
                        e.status.label,
                      ].join(' · '),
                      style: TextStyle(fontSize: 14, color: color),
                    ),
                  ],
                ),
              ),
              Text(formatSoles(e.total), style: ContabiliFonts.amount(17)),
            ],
          ),
          if (e.status == EinvoiceStatus.rejected && e.statusMessage != null) ...[
            const SizedBox(height: 6),
            Text(e.statusMessage!, style: const TextStyle(color: ContabiliColors.red)),
          ],
          const SizedBox(height: 8),
          Wrap(
            spacing: 8,
            children: [
              TextButton.icon(
                onPressed: onOpen,
                icon: const Icon(Icons.picture_as_pdf_outlined, size: 20),
                label: const Text('Ver PDF'),
              ),
              if (onRefresh != null)
                TextButton.icon(
                  onPressed: onRefresh,
                  icon: const Icon(Icons.refresh, size: 20),
                  label: const Text('Consultar a SUNAT'),
                ),
              if (onRecord != null)
                TextButton.icon(
                  onPressed: onRecord,
                  icon: const Icon(Icons.edit_note, size: 20),
                  label: const Text('Anotar la venta'),
                ),
            ],
          ),
        ],
      ),
    );
  }
}

/// Emitir una boleta o factura: lo que se vendió, a quién y cómo pagó. La
/// venta se anota sola con su comprobante.
class EmitScreen extends StatefulWidget {
  const EmitScreen({super.key, required this.session});

  final SessionController session;

  @override
  State<EmitScreen> createState() => _EmitScreenState();
}

class _EmitScreenState extends State<EmitScreen> {
  EinvoiceType _type = EinvoiceType.boleta;
  CustomerDoc _doc = CustomerDoc.none;
  SaleKind _kind = SaleKind.goods;
  Settlement _paid = Settlement.cash;
  final _number = TextEditingController();
  final _name = TextEditingController();
  final _description = TextEditingController();
  final _amount = TextEditingController();
  bool _busy = false;
  String? _error;

  Company get _company => widget.session.company!;

  @override
  void dispose() {
    _number.dispose();
    _name.dispose();
    _description.dispose();
    _amount.dispose();
    super.dispose();
  }

  Cents? get _total {
    final cents = parseSoles(_amount.text);
    return cents == null || cents <= 0 ? null : cents;
  }

  /// Lo mismo que revisa el servidor, dicho antes de emitir.
  String? get _problem {
    final total = _total;
    if (total == null) return null;
    if (_type == EinvoiceType.factura && _doc != CustomerDoc.ruc) {
      return 'Una factura va con el RUC de tu cliente. Si no tiene RUC, emite una boleta.';
    }
    if (_type == EinvoiceType.boleta && _doc == CustomerDoc.none && total > 70000) {
      return 'Una boleta de más de S/ 700 lleva el nombre y el DNI (o RUC) de quien compra.';
    }
    if (_doc == CustomerDoc.ruc && !isValidRuc(_number.text)) return 'El RUC no es válido.';
    if (_doc == CustomerDoc.dni && !RegExp(r'^\d{8}$').hasMatch(_number.text)) {
      return 'El DNI tiene 8 dígitos.';
    }
    if (_doc != CustomerDoc.none && _name.text.trim().length < 2) {
      return 'Escribe el nombre de tu cliente.';
    }
    if (_description.text.trim().length < 3) return 'Escribe qué vendiste.';
    return null;
  }

  Future<void> _emit() async {
    final total = _total;
    if (total == null) return;
    final problem = _problem;
    if (problem != null) {
      setState(() => _error = problem);
      return;
    }
    setState(() {
      _busy = true;
      _error = null;
    });
    try {
      final result = await widget.session.api.emitEinvoice(
        _company.id,
        EmitRequest(
          type: _type,
          saleKind: _kind,
          paidWith: _paid,
          customerDoc: _doc,
          customerNumber: _doc == CustomerDoc.none ? null : _number.text,
          customerName: _doc == CustomerDoc.none ? null : _name.text.trim(),
          description: _description.text.trim(),
          total: total,
        ),
      );
      if (!mounted) return;
      await _showDone(result);
    } on ApiException catch (error) {
      if (mounted) setState(() => _error = error.message);
    } finally {
      if (mounted) setState(() => _busy = false);
    }
  }

  Future<void> _showDone(EinvoiceResult result) async {
    final e = result.einvoice;
    final ok = e.status == EinvoiceStatus.accepted || e.status == EinvoiceStatus.test;
    await showModalBottomSheet<void>(
      context: context,
      isDismissible: false,
      isScrollControlled: true,
      builder: (context) => SafeArea(
        child: SingleChildScrollView(
          padding: const EdgeInsets.fromLTRB(20, 4, 20, 20),
          child: Column(
            mainAxisSize: MainAxisSize.min,
            crossAxisAlignment: CrossAxisAlignment.stretch,
            children: [
              Center(
                child: Container(
                  padding: const EdgeInsets.all(18),
                  decoration: BoxDecoration(
                    color: ok ? ContabiliColors.goldSoft : ContabiliColors.redSoft,
                    shape: BoxShape.circle,
                  ),
                  child: ok
                      ? const ContabiliMark(size: 64)
                      : const Icon(Icons.error_outline, size: 64, color: ContabiliColors.red),
                ),
              ),
              const SizedBox(height: 14),
              Text(
                switch (e.status) {
                  EinvoiceStatus.accepted => '¡Listo, SUNAT la aceptó!',
                  EinvoiceStatus.test => '¡Listo! (de prueba)',
                  EinvoiceStatus.pending => 'Esperando a SUNAT',
                  EinvoiceStatus.rejected => 'SUNAT la rechazó',
                },
                textAlign: TextAlign.center,
                style: ContabiliFonts.title(26),
              ),
              const SizedBox(height: 6),
              Text(
                '${e.type.label} ${e.label} por ${formatSoles(e.total)}',
                textAlign: TextAlign.center,
                style: Theme.of(context).textTheme.titleMedium,
              ),
              if (e.statusMessage != null) ...[
                const SizedBox(height: 8),
                Text(
                  e.statusMessage!,
                  textAlign: TextAlign.center,
                  style: Theme.of(context).textTheme.bodyMedium,
                ),
              ],
              if (result.recordError != null) ...[
                const SizedBox(height: 12),
                Notice(text: result.recordError!, tone: NoticeTone.warning),
              ] else if (e.recorded) ...[
                const SizedBox(height: 12),
                const Notice(text: 'La venta quedó anotada y en tu registro de ventas.'),
              ],
              const SizedBox(height: 20),
              OutlinedButton.icon(
                onPressed: () async {
                  final link = await widget.session.api.einvoiceLink(_company.id, e.id);
                  await widget.session.openLink(link);
                },
                icon: const Icon(Icons.picture_as_pdf_outlined),
                label: const Text('Ver PDF'),
              ),
              const SizedBox(height: 8),
              FilledButton(
                onPressed: () => Navigator.of(context).pop(),
                child: const Text('Listo'),
              ),
            ],
          ),
        ),
      ),
    );
    if (mounted) Navigator.of(context).pop(true);
  }

  @override
  Widget build(BuildContext context) {
    final total = _total;
    final split = total == null ? null : igvFromTotal(total);
    return Scaffold(
      appBar: AppBar(title: Text('Emitir ${_type.label.toLowerCase()}')),
      body: ListView(
        padding: const EdgeInsets.all(20),
        children: [
          ReadableWidth(
            maxWidth: 560,
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.stretch,
              children: [
                SegmentedButton<EinvoiceType>(
                  showSelectedIcon: false,
                  segments: const [
                    ButtonSegment(value: EinvoiceType.boleta, label: Text('Boleta')),
                    ButtonSegment(value: EinvoiceType.factura, label: Text('Factura')),
                  ],
                  selected: {_type},
                  onSelectionChanged: (s) => setState(() {
                    _type = s.first;
                    if (_type == EinvoiceType.factura) _doc = CustomerDoc.ruc;
                  }),
                ),
                const SizedBox(height: 18),
                TextField(
                  controller: _amount,
                  keyboardType: const TextInputType.numberWithOptions(decimal: true),
                  inputFormatters: [FilteringTextInputFormatter.allow(RegExp(r'[\d.,]'))],
                  style: ContabiliFonts.amount(34),
                  decoration: InputDecoration(
                    prefixText: 'S/ ',
                    prefixStyle: ContabiliFonts.amount(34, color: ContabiliColors.ink2),
                    labelText: 'Total, con IGV',
                    hintText: '0.00',
                  ),
                  onChanged: (_) => setState(() {}),
                ),
                if (split != null) ...[
                  const SizedBox(height: 8),
                  Text(
                    '${formatSoles(split.base)} es tu venta y ${formatSoles(split.igv)} es IGV.',
                    style: Theme.of(context).textTheme.bodySmall,
                  ),
                ],
                const SizedBox(height: 16),
                TextField(
                  controller: _description,
                  maxLength: 250,
                  textCapitalization: TextCapitalization.sentences,
                  decoration: const InputDecoration(
                    labelText: '¿Qué vendiste?',
                    hintText: 'Por ejemplo: 2 sacos de arroz de 50 kg',
                  ),
                  onChanged: (_) => setState(() {}),
                ),
                const SizedBox(height: 8),
                ChoiceRow<SaleKind>(
                  label: '¿Productos o servicios?',
                  value: _kind,
                  onChanged: (v) => setState(() => _kind = v),
                  options: const [
                    (SaleKind.goods, 'Productos', Icons.inventory_2_outlined),
                    (SaleKind.services, 'Servicios', Icons.handyman_outlined),
                  ],
                ),
                const SizedBox(height: 18),
                ChoiceRow<CustomerDoc>(
                  label: '¿A quién le vendiste?',
                  value: _doc,
                  onChanged: (v) => setState(() => _doc = v),
                  options: [
                    if (_type == EinvoiceType.boleta)
                      (CustomerDoc.none, 'Sin documento', Icons.person_outline),
                    if (_type == EinvoiceType.boleta)
                      (CustomerDoc.dni, 'DNI', Icons.badge_outlined),
                    (CustomerDoc.ruc, 'RUC', Icons.business_outlined),
                  ],
                ),
                if (_doc != CustomerDoc.none) ...[
                  const SizedBox(height: 12),
                  TextField(
                    controller: _number,
                    keyboardType: TextInputType.number,
                    inputFormatters: [
                      FilteringTextInputFormatter.digitsOnly,
                      LengthLimitingTextInputFormatter(_doc == CustomerDoc.ruc ? 11 : 8),
                    ],
                    decoration: InputDecoration(labelText: _doc.label),
                    onChanged: (_) => setState(() {}),
                  ),
                  const SizedBox(height: 12),
                  TextField(
                    controller: _name,
                    textCapitalization: TextCapitalization.words,
                    decoration: InputDecoration(
                      labelText: _doc == CustomerDoc.ruc ? 'Razón social' : 'Nombre y apellido',
                    ),
                    onChanged: (_) => setState(() {}),
                  ),
                ],
                const SizedBox(height: 18),
                ChoiceRow<Settlement>(
                  label: '¿Cómo te pagaron?',
                  value: _paid,
                  onChanged: (v) => setState(() => _paid = v),
                  options: const [
                    (Settlement.cash, 'Efectivo', Icons.payments_outlined),
                    (Settlement.bank, 'Banco o Yape', Icons.account_balance_outlined),
                    (Settlement.credit, 'Me lo deben', Icons.schedule_outlined),
                  ],
                ),
                ErrorText(_error),
                const SizedBox(height: 20),
                FilledButton(
                  onPressed: total == null || _busy ? null : _emit,
                  child: Text(_busy ? 'Emitiendo…' : 'Emitir ${_type.label.toLowerCase()}'),
                ),
              ],
            ),
          ),
        ],
      ),
    );
  }
}
