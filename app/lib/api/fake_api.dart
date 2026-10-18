import '../core/money.dart';
import '../core/operations.dart';
import 'api.dart';

/// Servidor en memoria para las pruebas: mismas reglas de IGV y de permisos
/// que el backend, sin red. El código de ingreso siempre es 123456.
class FakeContabiliApi implements ContabiliApi {
  FakeContabiliApi({this.signedIn = false, List<Company>? companies, this.license})
    : _companies = [...?companies];

  static const code = '123456';

  bool signedIn;
  final List<Company> _companies;
  final List<Invitation> invitations = [];
  final Map<String, List<JournalEntry>> _entries = {};
  final Map<String, Summary> _summaries = {};
  final List<Uri> orders = [];
  final Map<String, List<Member>> _members = {};

  /// Estado de la licencia que devuelve `billing` (prueba por defecto).
  License? license;

  /// Si se fija, la próxima operación falla con este error.
  ApiException? failNext;

  /// Mes de las pruebas: el resumen y los movimientos son de este periodo.
  String period = '2026-10';

  var _registered = false;
  var _ids = 0;

  static const user = Me(
    id: '00000000-0000-4000-8000-000000000001',
    phone: '+51987654321',
    fullName: 'Rosa Quispe',
  );

  String _uuid() => '00000000-0000-4000-8000-${(++_ids + 100).toString().padLeft(12, '0')}';

  void _check() {
    final error = failNext;
    if (error != null) {
      failNext = null;
      throw error;
    }
  }

  @override
  Future<bool> hasSession() async => signedIn;

  @override
  Future<CodeSent> requestCode(String phone) async {
    _check();
    return const CodeSent(phone: '+51987654321', resendAfterSeconds: 60);
  }

  @override
  Future<VerifyResult> verifyCode(String phone, String code) async {
    if (code != FakeContabiliApi.code) {
      throw const ApiException(
        status: 400,
        code: 'otp_invalid',
        message: 'El código no es correcto. Te quedan 4 intentos.',
      );
    }
    if (!_registered) return const RegistrationRequired('registro-de-prueba');
    signedIn = true;
    return const SignedIn(user);
  }

  @override
  Future<SignedIn> register({
    required String registrationToken,
    required String fullName,
    required bool acceptTerms,
  }) async {
    if (!acceptTerms) {
      throw const ApiException(
        status: 400,
        code: 'invalid_request',
        message: 'Acepta los términos y la política de privacidad para crear tu cuenta.',
      );
    }
    _registered = true;
    signedIn = true;
    return SignedIn(Me(id: user.id, phone: user.phone, fullName: fullName));
  }

  /// Para las pruebas de ingreso: el número ya tiene cuenta.
  void registerExisting() => _registered = true;

  @override
  Future<Me> me() async {
    if (!signedIn) {
      throw const ApiException(status: 401, code: 'unauthorized', message: 'Inicia sesión.');
    }
    return user;
  }

  @override
  Future<void> logout() async => signedIn = false;

  @override
  Future<List<Company>> companies() async => [..._companies];

  @override
  Future<Company> createCompany({
    required String ruc,
    required String legalName,
    required TaxRegime taxRegime,
  }) async {
    _check();
    final company = Company(
      id: _uuid(),
      ruc: ruc,
      legalName: legalName,
      taxRegime: taxRegime,
      role: Role.owner,
    );
    _companies.add(company);
    return company;
  }

  @override
  Future<List<Invitation>> myInvitations() async => [...invitations];

  @override
  Future<void> respondInvitation(String invitationId, {required bool accept}) async {
    final invitation = invitations.firstWhere((i) => i.id == invitationId);
    invitations.remove(invitation);
    if (accept) {
      _companies.add(
        Company(
          id: invitation.companyId,
          ruc: '20131312955',
          legalName: invitation.legalName,
          taxRegime: TaxRegime.rmt,
          role: invitation.role,
        ),
      );
    }
  }

  Summary _summary(String companyId) =>
      _summaries[companyId] ??
      Summary(
        period: period,
        cash: 0,
        bank: 0,
        receivable: 0,
        payable: 0,
        igvMonth: 0,
        sales: 0,
        expenses: 0,
      );

  /// Fija el resumen de una empresa (para mostrar una pantalla con datos).
  void setSummary(String companyId, Summary summary) => _summaries[companyId] = summary;

  @override
  Future<Summary> summary(String companyId, {String? period}) async {
    _check();
    return _summary(companyId);
  }

  @override
  Future<OperationResult> recordOperation(
    String companyId,
    Operation operation, {
    String? date,
    String? reference,
    String? contactId,
  }) async {
    _check();
    if (contactId != null) {
      final contact = _contacts.firstWhere((c) => c.id == contactId);
      if (contact.kind != operationContactKind(operation)) {
        throw const ApiException(
          status: 400,
          code: 'contact_wrong_kind',
          message: 'Ese contacto no corresponde a esta operación.',
        );
      }
      final change = switch (operation) {
        Collection() || Payment() => -operation.total,
        _ => operation.total,
      };
      _contacts[_contacts.indexOf(contact)] = Contact(
        id: contact.id,
        kind: contact.kind,
        name: contact.name,
        ruc: contact.ruc,
        balance: contact.balance + change,
      );
    }
    final company = _companies.firstWhere((c) => c.id == companyId);
    final split = operationIgv(operation, company.taxRegime);
    final s = _summary(companyId);
    var cash = s.cash, bank = s.bank, receivable = s.receivable, payable = s.payable;
    var igv = s.igvMonth, sales = s.sales, expenses = s.expenses;
    void money(Settlement to, Cents amount, {required bool incoming}) {
      final sign = incoming ? 1 : -1;
      switch (to) {
        case Settlement.cash:
          cash += sign * amount;
        case Settlement.bank:
          bank += sign * amount;
        case Settlement.credit:
          if (incoming) {
            receivable += amount;
          } else {
            payable += amount;
          }
      }
    }

    final String description;
    switch (operation) {
      case Sale(:final paidWith):
        money(paidWith, operation.total, incoming: true);
        sales += split.base;
        igv += split.igv;
        description = 'Venta';
      case Expense(:final paidWith):
        money(paidWith, operation.total, incoming: false);
        expenses += split.base;
        igv -= split.igv;
        description = 'Gasto';
      case Collection(:final into):
        receivable -= operation.total;
        money(
          into == Money.cash ? Settlement.cash : Settlement.bank,
          operation.total,
          incoming: true,
        );
        description = 'Cobro a cliente';
      case Payment(:final from):
        payable -= operation.total;
        money(
          from == Money.cash ? Settlement.cash : Settlement.bank,
          operation.total,
          incoming: false,
        );
        description = 'Pago a proveedor';
      case TaxPayment(:final from, :final tax):
        money(
          from == Money.cash ? Settlement.cash : Settlement.bank,
          operation.total,
          incoming: false,
        );
        description = tax == TaxKind.igv ? 'Pago de IGV a SUNAT' : 'Pago a cuenta de renta a SUNAT';
    }
    _summaries[companyId] = Summary(
      period: s.period,
      cash: cash,
      bank: bank,
      receivable: receivable,
      payable: payable,
      igvMonth: igv,
      sales: sales,
      expenses: expenses,
    );
    final list = _entries.putIfAbsent(companyId, () => []);
    final entry = JournalEntry(
      id: _uuid(),
      number: list.length + 1,
      fiscalYear: 2026,
      entryDate: date ?? '$period-17',
      description: reference == null ? description : '$description · $reference',
      createdBy: user.fullName,
      lines: const [],
      total: operation.total,
      source: switch (operation) {
        Sale() => EntrySource.sale,
        Expense() => EntrySource.expense,
        Collection() => EntrySource.collection,
        Payment() => EntrySource.payment,
        TaxPayment() => EntrySource.taxPayment,
      },
    );
    list.add(entry);
    return OperationResult(
      entry: entry,
      explanation: split.igv > 0
          ? 'Registraste ${formatSoles(operation.total)}: ${formatSoles(split.igv)} es IGV.'
          : 'Registraste ${formatSoles(operation.total)}.',
    );
  }

  @override
  Future<JournalPage> journal(String companyId, {required String period, int after = 0}) async {
    _check();
    return JournalPage([...?_entries[companyId]], null);
  }

  @override
  Future<JournalEntry> reverseEntry(String companyId, String entryId) async {
    _check();
    final list = _entries[companyId]!;
    final index = list.indexWhere((e) => e.id == entryId);
    final original = list[index];
    final reversal = JournalEntry(
      id: _uuid(),
      number: list.length + 1,
      fiscalYear: 2026,
      entryDate: '$period-17',
      description: 'Extorno del asiento ${original.number}-2026',
      createdBy: user.fullName,
      lines: const [],
      total: original.total,
      reversesEntryId: original.id,
      source: EntrySource.reversal,
    );
    list[index] = JournalEntry(
      id: original.id,
      number: original.number,
      fiscalYear: original.fiscalYear,
      entryDate: original.entryDate,
      description: original.description,
      createdBy: original.createdBy,
      lines: original.lines,
      total: original.total,
      reversedByEntryId: reversal.id,
      source: original.source,
    );
    list.add(reversal);
    return reversal;
  }

  final List<String> closedPeriods = [];

  @override
  Future<void> closePeriod(String companyId, String period) async {
    _check();
    closedPeriods.add(period);
  }

  @override
  Future<Billing> billing(String companyId) async {
    _check();
    return Billing(
      license:
          license ??
          License(
            status: LicenseStatus.trial,
            planName: 'Negocio',
            endsAt: DateTime.utc(2026, 11, 16, 17),
            daysLeft: 30,
            members: 1,
            maxMembers: 6,
          ),
      plans: const [
        Plan(
          code: 'emprendedor',
          name: 'Emprendedor',
          tagline: 'Para quien lleva su negocio solo o con una persona más.',
          maxMembers: 2,
          monthlyCents: 2500,
          annualCents: 25000,
          features: ['Hasta 2 personas'],
        ),
        Plan(
          code: 'negocio',
          name: 'Negocio',
          tagline: 'Para negocios con equipo o con contador externo.',
          maxMembers: 6,
          monthlyCents: 4900,
          annualCents: 49000,
          features: ['Hasta 6 personas'],
        ),
      ],
    );
  }

  @override
  Future<Uri> createOrder(
    String companyId, {
    required String plan,
    required BillingCycle cycle,
  }) async {
    _check();
    final uri = Uri.parse('https://contabili.pe/pagar/${_uuid()}#t=$plan-${cycle.wire}');
    orders.add(uri);
    return uri;
  }

  @override
  Future<List<Member>> members(String companyId) async => [
    ...(_members[companyId] ??
        [
          Member(
            userId: user.id,
            fullName: user.fullName,
            phone: '+51 9•• ••• 321',
            role: Role.owner,
          ),
        ]),
  ];

  final List<(String, Role)> invited = [];
  final List<Contact> _contacts = [];
  final List<(ExportKind, String, String)> exports = [];

  @override
  Future<List<Contact>> contacts(String companyId, {ContactKind? kind}) async => [
    for (final c in _contacts)
      if (kind == null || c.kind == kind) c,
  ];

  @override
  Future<Contact> createContact(
    String companyId, {
    required ContactKind kind,
    required String name,
    String? ruc,
  }) async {
    _check();
    final contact = Contact(id: _uuid(), kind: kind, name: name, ruc: ruc, balance: 0);
    _contacts.add(contact);
    return contact;
  }

  @override
  Future<ContactDetail> contact(String companyId, String contactId) async {
    final contact = _contacts.firstWhere((c) => c.id == contactId);
    return ContactDetail(contact, [
      if (contact.balance != 0)
        ContactMovement(
          entryDate: '$period-17',
          description: 'Venta de mercadería al crédito',
          amount: contact.balance,
          balance: contact.balance,
        ),
    ]);
  }

  @override
  Future<MonthlyTaxes> taxes(String companyId, {String? period}) async {
    _check();
    final company = _companies.firstWhere((c) => c.id == companyId);
    final s = _summary(companyId);
    final nrus = company.taxRegime == TaxRegime.nrus;
    final igvToPay = s.igvMonth > 0 ? (s.igvMonth / 100).round() * 100 : 0;
    final income = nrus ? 2000 : (s.sales / 100 / 100).round() * 100;
    return MonthlyTaxes(
      period: period ?? this.period,
      regime: company.taxRegime,
      igv: nrus
          ? null
          : IgvMonth(
              sales: s.igvMonth > 0 ? s.igvMonth : 0,
              purchases: s.igvMonth < 0 ? -s.igvMonth : 0,
              previousCredit: 0,
              toPay: igvToPay,
              nextCredit: s.igvMonth < 0 ? -s.igvMonth : 0,
            ),
      incomeBase: s.sales,
      incomeRatePercent: nrus ? null : 1,
      nrusCategory: nrus ? 1 : null,
      incomeAmount: income,
      total: igvToPay + income,
      notes: const ['Es un estimado con lo que registraste en Contabili.'],
    );
  }

  @override
  Future<List<TrendPoint>> trend(String companyId, {int months = 6}) async {
    final s = _summary(companyId);
    return [
      for (var i = months - 1; i >= 0; i--)
        TrendPoint(
          period: _shift(period, -i),
          sales: i == 0 ? s.sales : 0,
          expenses: i == 0 ? s.expenses : 0,
        ),
    ];
  }

  static String _shift(String period, int months) {
    final index =
        int.parse(period.substring(0, 4)) * 12 + int.parse(period.substring(5)) - 1 + months;
    return '${index ~/ 12}-${(index % 12 + 1).toString().padLeft(2, '0')}';
  }

  @override
  Future<Uri> exportLink(
    String companyId, {
    required ExportKind kind,
    required String from,
    required String to,
  }) async {
    _check();
    exports.add((kind, from, to));
    return Uri.parse('https://contabili.pe/api/v1/exports/enlace-de-prueba');
  }

  @override
  Future<void> invite(String companyId, {required String phone, required Role role}) async {
    _check();
    invited.add((phone, role));
  }

  @override
  Future<void> removeMember(String companyId, String userId) async {
    _members[companyId]?.removeWhere((m) => m.userId == userId);
  }
}
