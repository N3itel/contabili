import 'package:flutter/material.dart';

import '../api/api.dart';
import '../core/dates.dart';
import '../core/money.dart';
import '../session/session.dart';
import '../ui/andean.dart';
import '../ui/theme.dart';
import '../ui/widgets.dart';

/// Mi plan: cuánto le queda, los planes y pagar con Yape o tarjeta en el
/// navegador (la tarjeta nunca pasa por la app).
class PlanScreen extends StatefulWidget {
  const PlanScreen({super.key, required this.session});

  final SessionController session;

  @override
  State<PlanScreen> createState() => _PlanScreenState();
}

class _PlanScreenState extends State<PlanScreen> {
  Billing? _billing;
  Object? _error;
  BillingCycle _cycle = BillingCycle.annual;
  String? _plan;
  bool _busy = false;
  String? _message;
  bool _waitingPayment = false;

  Company get _company => widget.session.company!;

  @override
  void initState() {
    super.initState();
    _load();
  }

  Future<void> _load() async {
    setState(() => _error = null);
    try {
      final billing = await widget.session.api.billing(_company.id);
      if (mounted) {
        setState(() {
          _billing = billing;
          _plan ??= billing.plans.last.code;
        });
      }
    } on ApiException catch (error) {
      if (mounted) setState(() => _error = error);
    }
  }

  Future<void> _pay() async {
    setState(() {
      _busy = true;
      _message = null;
    });
    try {
      final url = await widget.session.api.createOrder(_company.id, plan: _plan!, cycle: _cycle);
      final opened = await widget.session.openLink(url);
      setState(() {
        _waitingPayment = opened;
        _message = opened
            ? 'Abrimos la página de pago en tu navegador. Cuando termines, vuelve aquí.'
            : 'No pudimos abrir el navegador. Entra a ${widget.session.page('/mi-plan')} para pagar.';
      });
    } on ApiException catch (error) {
      setState(() => _message = error.message);
    } finally {
      if (mounted) setState(() => _busy = false);
    }
  }

  Future<void> _openReceipt(Receipt receipt) async {
    try {
      final link = await widget.session.api.receiptLink(_company.id, receipt.id);
      await widget.session.openLink(link);
    } on ApiException catch (error) {
      setState(() => _message = error.message);
    }
  }

  Future<void> _checkPayment() async {
    await _load();
    setState(() => _waitingPayment = false);
  }

  @override
  Widget build(BuildContext context) {
    final billing = _billing;
    if (billing == null) return LoadState(error: _error, onRetry: _load);
    final license = billing.license;
    final owner = _company.role == Role.owner;
    final selected = billing.plans.firstWhere((p) => p.code == _plan);
    return RefreshIndicator(
      onRefresh: _load,
      child: ListView(
        padding: const EdgeInsets.fromLTRB(16, 8, 16, 24),
        children: [
          ReadableWidth(
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.stretch,
              children: [
                HeroPanel(
                  colors: license.status == LicenseStatus.expired
                      ? const [ContabiliColors.ink2, ContabiliColors.ink]
                      : const [ContabiliColors.indigo, Color(0xFF243256)],
                  child: Column(
                    crossAxisAlignment: CrossAxisAlignment.start,
                    children: [
                      Text(switch (license.status) {
                        LicenseStatus.trial => 'Prueba gratis del plan ${license.planName}',
                        LicenseStatus.active => 'Plan ${license.planName}',
                        LicenseStatus.expired => 'Tu plan venció',
                      }, style: ContabiliFonts.title(24, color: Colors.white)),
                      const SizedBox(height: 6),
                      Text(switch (license.status) {
                        LicenseStatus.trial =>
                          'Te quedan ${license.daysLeft} días (hasta el ${formatInstant(license.endsAt)}).',
                        LicenseStatus.active => 'Pagado hasta el ${formatInstant(license.endsAt)}.',
                        LicenseStatus.expired =>
                          'Venció el ${formatInstant(license.endsAt)}. Tu empresa está en solo '
                              'lectura: renueva para seguir anotando.',
                      }, style: const TextStyle(fontSize: 17, color: Colors.white)),
                      const SizedBox(height: 10),
                      Row(
                        children: [
                          const Icon(Icons.group_outlined, color: ContabiliColors.goldLight),
                          const SizedBox(width: 8),
                          Expanded(
                            child: Text(
                              '${license.members} de ${license.maxMembers} personas en tu equipo.',
                              style: const TextStyle(color: Color(0xDDFFFFFF)),
                            ),
                          ),
                        ],
                      ),
                    ],
                  ),
                ),
                const SizedBox(height: 12),
                if (owner && license.status != LicenseStatus.expired)
                  const Padding(
                    padding: EdgeInsets.only(bottom: 8),
                    child: Row(
                      children: [
                        Icon(Icons.sms_outlined, color: ContabiliColors.ink2, size: 20),
                        SizedBox(width: 8),
                        Expanded(
                          child: Text(
                            'Te avisamos por SMS 3 días antes de que venza.',
                            style: TextStyle(color: ContabiliColors.ink2),
                          ),
                        ),
                      ],
                    ),
                  ),
                const SizedBox(height: 12),
                const SectionTitle('Elige tu plan'),
                SegmentedButton<BillingCycle>(
                  showSelectedIcon: false,
                  segments: const [
                    ButtonSegment(value: BillingCycle.monthly, label: Text('Por mes')),
                    ButtonSegment(
                      value: BillingCycle.annual,
                      label: Text('Por año (2 meses gratis)', textAlign: TextAlign.center),
                    ),
                  ],
                  selected: {_cycle},
                  onSelectionChanged: (s) => setState(() => _cycle = s.first),
                ),
                const SizedBox(height: 12),
                RadioGroup<String>(
                  groupValue: _plan,
                  onChanged: (v) => setState(() => _plan = v),
                  child: Column(
                    children: [
                      for (final plan in billing.plans) ...[
                        Card(
                          shape: RoundedRectangleBorder(
                            borderRadius: BorderRadius.circular(22),
                            side: BorderSide(
                              color: plan.code == _plan
                                  ? ContabiliColors.terracotta
                                  : ContabiliColors.line,
                              width: plan.code == _plan ? 2 : 1,
                            ),
                          ),
                          child: RadioListTile<String>(
                            value: plan.code,
                            contentPadding: const EdgeInsets.symmetric(horizontal: 12, vertical: 8),
                            // En dos líneas: con letra grande, nombre y precio no entran lado a lado.
                            title: Text(plan.name, style: ContabiliFonts.title(22)),
                            subtitle: Column(
                              crossAxisAlignment: CrossAxisAlignment.start,
                              children: [
                                Text(
                                  '${formatSoles(plan.price(_cycle))} '
                                  '${_cycle == BillingCycle.monthly ? 'al mes' : 'al año'}',
                                  style: ContabiliFonts.amount(
                                    20,
                                    color: ContabiliColors.terracottaDark,
                                  ),
                                ),
                                Text('${plan.tagline} Hasta ${plan.maxMembers} personas.'),
                              ],
                            ),
                          ),
                        ),
                        const SizedBox(height: 8),
                      ],
                    ],
                  ),
                ),
                const Text(
                  'Precios con IGV. No es una suscripción: pagas una vez con Yape o tarjeta y '
                  'no guardamos tu tarjeta.',
                  style: TextStyle(color: ContabiliColors.ink2),
                ),
                const SizedBox(height: 14),
                if (owner)
                  FilledButton(
                    onPressed: _busy ? null : _pay,
                    child: Text(
                      _busy
                          ? 'Preparando el pago…'
                          : 'Pagar ${formatSoles(selected.price(_cycle))}',
                    ),
                  )
                else
                  const Notice(text: 'Solo quien es dueño de la empresa puede pagar el plan.'),
                if (_message != null) ...[const SizedBox(height: 12), Notice(text: _message!)],
                if (_waitingPayment) ...[
                  const SizedBox(height: 8),
                  OutlinedButton(onPressed: _checkPayment, child: const Text('Ya pagué')),
                ],
                if (billing.payments.isNotEmpty) ...[
                  const SizedBox(height: 24),
                  const SectionTitle('Tus pagos'),
                  Card(
                    child: Column(
                      children: [
                        for (final (i, payment) in billing.payments.indexed) ...[
                          if (i > 0) const Divider(indent: 76),
                          _PaymentTile(payment: payment, onReceipt: _openReceipt),
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

class _PaymentTile extends StatelessWidget {
  const _PaymentTile({required this.payment, required this.onReceipt});

  final LicensePayment payment;
  final ValueChanged<Receipt> onReceipt;

  @override
  Widget build(BuildContext context) {
    final receipt = payment.receipt;
    return Padding(
      padding: const EdgeInsets.symmetric(horizontal: 16, vertical: 12),
      child: Row(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          const IconBox(
            icon: Icons.verified_outlined,
            color: ContabiliColors.green,
            background: ContabiliColors.greenSoft,
          ),
          const SizedBox(width: 14),
          Expanded(
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Text(
                  'Plan ${payment.planName} · ${payment.cycle == BillingCycle.monthly ? '1 mes' : '1 año'}',
                  style: const TextStyle(fontWeight: FontWeight.w600, fontSize: 16),
                ),
                Text(
                  'Pagado el ${formatInstant(payment.paidAt)} · ${formatSoles(payment.amountCents)}',
                  style: const TextStyle(fontSize: 14, color: ContabiliColors.ink2),
                ),
                if (receipt == null)
                  const SizedBox.shrink()
                else if (receipt.status.ready)
                  TextButton.icon(
                    style: TextButton.styleFrom(padding: EdgeInsets.zero),
                    onPressed: () => onReceipt(receipt),
                    icon: const Icon(Icons.picture_as_pdf_outlined, size: 20),
                    label: Text(
                      receipt.status == ReceiptStatus.test
                          ? 'Factura ${receipt.label} (de prueba)'
                          : 'Factura ${receipt.label}',
                    ),
                  )
                else
                  Text(
                    receipt.status == ReceiptStatus.rejected
                        ? 'Estamos revisando tu factura; te avisaremos cuando esté lista.'
                        : 'Tu factura está en camino: aparecerá aquí en unos minutos.',
                    style: const TextStyle(fontSize: 14, color: ContabiliColors.amber),
                  ),
              ],
            ),
          ),
        ],
      ),
    );
  }
}
