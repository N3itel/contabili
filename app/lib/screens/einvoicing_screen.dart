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
  bool get _nrus => _company.taxRegime == TaxRegime.nrus;

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

  /// Anular con nota de crédito: elegir el motivo y confirmar (no se deshace).
  Future<void> _annul(Einvoice e) async {
    final reason = await showModalBottomSheet<CreditReason>(
      context: context,
      isScrollControlled: true,
      builder: (_) => _AnnulSheet(einvoice: e),
    );
    if (reason == null || !mounted) return;
    try {
      final result = await _api.creditNote(_company.id, e.id, reason);
      final note = result.einvoice;
      setState(
        () => _notice =
            result.recordError ??
            switch (note.status) {
              EinvoiceStatus.accepted || EinvoiceStatus.test =>
                'Listo: emitiste la nota de crédito ${note.label} y la venta se descontó de tus libros.',
              EinvoiceStatus.pending =>
                'La nota de crédito ${note.label} espera a SUNAT: consúltala en un momento.',
              EinvoiceStatus.rejected =>
                'SUNAT rechazó la nota de crédito ${note.label}: ${note.statusMessage ?? 'revisa los datos'}.',
            },
      );
      if (note.recorded) widget.changes?.value++;
      await _load();
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
                ? (result.einvoice.type == EinvoiceType.creditNote
                      ? 'Listo: la venta quedó descontada de tus libros.'
                      : 'Listo: la venta quedó anotada.')
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
                          nrus: _nrus,
                          onEdit: _owner ? () => setState(() => _editing = true) : null,
                        ),
                        const SizedBox(height: 16),
                        if (_company.role.canRecord)
                          FilledButton.icon(
                            onPressed: _emit,
                            icon: const Icon(Icons.receipt_long_outlined),
                            label: Text(_nrus ? 'Emitir boleta' : 'Emitir boleta o factura'),
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
                                    onRecord: e.canRecord && _company.role.canRecord
                                        ? () => _retry(e, record: true)
                                        : null,
                                    onAnnul: e.canAnnul && _company.role.canRecord
                                        ? () => _annul(e)
                                        : null,
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
  const _StatusCard({required this.settings, required this.nrus, this.onEdit});

  final EinvoiceSettings settings;
  final bool nrus;
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
          Text(switch ((settings.isTest, nrus)) {
            (true, true) =>
              'Lo que emitas aquí no se manda a SUNAT: sirve para ver cómo queda. En el Nuevo RUS, por ahora la facturación electrónica es solo de prueba.',
            (true, false) =>
              'Lo que emitas aquí no se manda a SUNAT: sirve para ver cómo queda. Cuando tengas tu cuenta en Nubefact, conéctala.',
            (false, _) =>
              'Tus boletas y facturas se mandan a SUNAT por tu cuenta de Nubefact (${settings.endpointHost}).',
          }, style: const TextStyle(color: Color(0xE6FFFFFF), fontSize: 16)),
          const SizedBox(height: 10),
          Text(
            nrus
                ? 'Series: ${settings.boletaSeries} para boletas · ${settings.boletaNoteSeries} para sus notas de crédito'
                : 'Series: ${settings.boletaSeries} para boletas · ${settings.facturaSeries} para facturas · '
                      '${settings.boletaNoteSeries} y ${settings.facturaNoteSeries} para sus notas de crédito',
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
  late final _facturaNote = TextEditingController(text: widget.current.facturaNoteSeries);
  late final _boletaNote = TextEditingController(text: widget.current.boletaNoteSeries);
  final _endpoint = TextEditingController();
  final _token = TextEditingController();
  bool _busy = false;
  String? _error;

  @override
  void dispose() {
    _factura.dispose();
    _boleta.dispose();
    _facturaNote.dispose();
    _boletaNote.dispose();
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
      final nrus = widget.session.company!.taxRegime == TaxRegime.nrus;
      final saved = await widget.session.api.saveEinvoiceSettings(
        widget.session.company!.id,
        provider: nrus ? 'test' : _provider,
        facturaSeries: _factura.text.trim().toUpperCase(),
        boletaSeries: _boleta.text.trim().toUpperCase(),
        facturaNoteSeries: _facturaNote.text.trim().toUpperCase(),
        boletaNoteSeries: _boletaNote.text.trim().toUpperCase(),
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
    Widget field(TextEditingController controller, String label, String hint) => TextField(
      controller: controller,
      textCapitalization: TextCapitalization.characters,
      inputFormatters: series,
      decoration: InputDecoration(labelText: label, hintText: hint),
    );
    // En el Nuevo RUS: solo boletas y solo de prueba (las series de facturas quedan como están).
    final nrus = widget.session.company!.taxRegime == TaxRegime.nrus;
    final fields = [
      field(_boleta, 'Serie de boletas', 'B001'),
      if (!nrus) field(_factura, 'Serie de facturas', 'F001'),
      field(_boletaNote, 'Notas de boletas', 'BC01'),
      if (!nrus) field(_facturaNote, 'Notas de facturas', 'FC01'),
    ];
    return Column(
      crossAxisAlignment: CrossAxisAlignment.stretch,
      children: [
        Notice(
          text: nrus
              ? 'Beta: prueba cómo quedan tus boletas electrónicas. En el Nuevo RUS, por ahora es solo de prueba: no se mandan a SUNAT. Emite las reales como siempre y anótalas en Contabili.'
              : 'Beta: emite boletas y facturas electrónicas desde Contabili. Empieza en modo de prueba; para mandarlas a SUNAT, conecta tu cuenta de Nubefact (un proveedor autorizado).',
        ),
        const SizedBox(height: 16),
        if (!nrus) ...[
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
        ],
        for (var i = 0; i < fields.length; i += 2) ...[
          if (i > 0) const SizedBox(height: 12),
          Row(
            children: [
              Expanded(child: fields[i]),
              const SizedBox(width: 10),
              Expanded(child: fields[i + 1]),
            ],
          ),
        ],
        const SizedBox(height: 6),
        Text(
          nrus
              ? 'Las notas de crédito anulan una boleta.'
              : 'Las notas de crédito anulan una boleta o factura. Si usas Nubefact, registra estas series también allá.',
          style: Theme.of(context).textTheme.bodySmall,
        ),
        if (_provider == 'nubefact' && !nrus) ...[
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
    this.onAnnul,
  });

  final Einvoice einvoice;
  final VoidCallback onOpen;
  final VoidCallback? onRefresh;
  final VoidCallback? onRecord;
  final VoidCallback? onAnnul;

  @override
  Widget build(BuildContext context) {
    final e = einvoice;
    final note = e.type == EinvoiceType.creditNote;
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
              IconBox(
                icon: note ? Icons.assignment_return_outlined : Icons.receipt_long_outlined,
                color: color,
                background: background,
              ),
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
              Text(
                formatSoles(note ? -e.total : e.total),
                style: ContabiliFonts.amount(
                  17,
                  color: note ? ContabiliColors.red : ContabiliColors.ink,
                ),
              ),
            ],
          ),
          if (e.modifies case final m?) ...[
            const SizedBox(height: 6),
            Text(
              'Anula la ${m.type.label.toLowerCase()} ${m.label}'
              '${e.creditReason == null ? '' : ' · ${e.creditReason!.label}'}',
              style: const TextStyle(fontSize: 14, color: ContabiliColors.ink2),
            ),
          ],
          if (e.creditNote case final n?) ...[
            const SizedBox(height: 6),
            Text(
              n.status == EinvoiceStatus.pending
                  ? 'Nota de crédito ${n.label} esperando a SUNAT'
                  : 'Anulada con la nota de crédito ${n.label}',
              style: const TextStyle(
                fontSize: 14,
                fontWeight: FontWeight.w600,
                color: ContabiliColors.red,
              ),
            ),
          ],
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
                  label: Text(note ? 'Descontar la venta' : 'Anotar la venta'),
                ),
              if (onAnnul != null)
                TextButton.icon(
                  onPressed: onAnnul,
                  style: TextButton.styleFrom(foregroundColor: ContabiliColors.red),
                  icon: const Icon(Icons.block, size: 20),
                  label: const Text('Anular'),
                ),
            ],
          ),
        ],
      ),
    );
  }
}

/// Elegir por qué se anula. Devuelve el motivo solo si se confirma.
class _AnnulSheet extends StatefulWidget {
  const _AnnulSheet({required this.einvoice});

  final Einvoice einvoice;

  @override
  State<_AnnulSheet> createState() => _AnnulSheetState();
}

class _AnnulSheetState extends State<_AnnulSheet> {
  CreditReason _reason = CreditReason.operation;

  @override
  Widget build(BuildContext context) {
    final e = widget.einvoice;
    return SafeArea(
      child: SingleChildScrollView(
        padding: const EdgeInsets.fromLTRB(20, 4, 20, 20),
        child: Column(
          mainAxisSize: MainAxisSize.min,
          crossAxisAlignment: CrossAxisAlignment.stretch,
          children: [
            Text(
              'Anular ${e.type.label.toLowerCase()} ${e.label}',
              style: ContabiliFonts.title(24),
            ),
            const SizedBox(height: 6),
            Text(
              'Se emite una nota de crédito por ${formatSoles(e.total)} y la venta se descuenta de tus libros. No se puede deshacer.',
              style: Theme.of(context).textTheme.bodyMedium,
            ),
            const SizedBox(height: 16),
            Text('¿Por qué la anulas?', style: Theme.of(context).textTheme.titleMedium),
            const SizedBox(height: 8),
            for (final reason in CreditReason.values)
              if (reason != CreditReason.wrongRuc || e.type == EinvoiceType.factura)
                _ReasonOption(
                  reason: reason,
                  selected: reason == _reason,
                  onTap: () => setState(() => _reason = reason),
                ),
            const SizedBox(height: 16),
            FilledButton(
              style: FilledButton.styleFrom(backgroundColor: ContabiliColors.red),
              onPressed: () => Navigator.of(context).pop(_reason),
              child: const Text('Anular con nota de crédito'),
            ),
            const SizedBox(height: 8),
            OutlinedButton(
              onPressed: () => Navigator.of(context).pop(),
              child: const Text('Volver sin anular'),
            ),
          ],
        ),
      ),
    );
  }
}

class _ReasonOption extends StatelessWidget {
  const _ReasonOption({required this.reason, required this.selected, required this.onTap});

  final CreditReason reason;
  final bool selected;
  final VoidCallback onTap;

  @override
  Widget build(BuildContext context) {
    return Padding(
      padding: const EdgeInsets.only(bottom: 8),
      child: Semantics(
        selected: selected,
        button: true,
        child: InkWell(
          onTap: onTap,
          borderRadius: BorderRadius.circular(14),
          child: Container(
            constraints: const BoxConstraints(minHeight: 56),
            padding: const EdgeInsets.symmetric(horizontal: 14, vertical: 10),
            decoration: BoxDecoration(
              color: selected ? ContabiliColors.terracottaSoft : null,
              border: Border.all(
                color: selected ? ContabiliColors.terracotta : ContabiliColors.line,
                width: selected ? 2 : 1,
              ),
              borderRadius: BorderRadius.circular(14),
            ),
            child: Row(
              children: [
                Icon(
                  selected ? Icons.radio_button_checked : Icons.radio_button_off,
                  color: selected ? ContabiliColors.terracotta : ContabiliColors.ink3,
                ),
                const SizedBox(width: 12),
                Expanded(
                  child: Column(
                    crossAxisAlignment: CrossAxisAlignment.start,
                    children: [
                      Text(reason.label, style: const TextStyle(fontWeight: FontWeight.w600)),
                      Text(
                        reason.hint,
                        style: const TextStyle(fontSize: 14, color: ContabiliColors.ink2),
                      ),
                    ],
                  ),
                ),
              ],
            ),
          ),
        ),
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
  bool get _nrus => _company.taxRegime == TaxRegime.nrus;

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
    final split = total == null || _nrus ? null : igvFromTotal(total);
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
                // En el Nuevo RUS solo hay boletas.
                if (!_nrus) ...[
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
                ],
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
                ] else if (_nrus) ...[
                  const SizedBox(height: 8),
                  Text(
                    'En el Nuevo RUS el precio no separa el IGV: la boleta va por el total.',
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
