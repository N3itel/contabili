import '../core/money.dart';
import '../core/operations.dart';

typedef Json = Map<String, dynamic>;

/// Error de la API: `code` es estable; `message` va en español y se muestra tal cual.
class ApiException implements Exception {
  const ApiException({required this.status, required this.code, required this.message});

  const ApiException.network()
    : status = 0,
      code = 'network',
      message = 'No pudimos conectar. Revisa tu internet e intenta de nuevo.';

  factory ApiException.fromJson(int status, Json json) => ApiException(
    status: status,
    code: json['code'] as String? ?? 'error',
    message: json['message'] as String? ?? 'Algo salió mal. Intenta de nuevo.',
  );

  final int status;
  final String code;
  final String message;

  @override
  String toString() => 'ApiException($status, $code)';
}

class Me {
  const Me({required this.id, required this.phone, required this.fullName});

  factory Me.fromJson(Json json) => Me(
    id: json['id'] as String,
    phone: json['phone'] as String,
    fullName: json['fullName'] as String,
  );

  final String id;
  final String phone;
  final String fullName;

  String get firstName => fullName.trim().split(RegExp(r'\s+')).first;
}

class CodeSent {
  const CodeSent({required this.phone, required this.resendAfterSeconds});

  factory CodeSent.fromJson(Json json) => CodeSent(
    phone: json['phone'] as String,
    resendAfterSeconds: json['resendAfterSeconds'] as int? ?? 60,
  );

  final String phone;
  final int resendAfterSeconds;
}

sealed class VerifyResult {
  const VerifyResult();
}

class SignedIn extends VerifyResult {
  const SignedIn(this.user);
  final Me user;
}

class RegistrationRequired extends VerifyResult {
  const RegistrationRequired(this.registrationToken);
  final String registrationToken;
}

enum Role {
  owner('owner', 'Dueño', 'Puede todo, incluido quién entra y pagar el plan.'),
  accountant('accountant', 'Contador', 'Registra ventas, gastos y cierra el mes.'),
  viewer('viewer', 'Solo consulta', 'Ve el resumen y los movimientos.');

  const Role(this.wire, this.label, this.hint);
  final String wire;
  final String label;
  final String hint;

  bool get canRecord => this != viewer;

  static Role fromWire(String wire) => values.firstWhere((r) => r.wire == wire);
}

class Company {
  const Company({
    required this.id,
    required this.ruc,
    required this.legalName,
    required this.taxRegime,
    required this.role,
    this.closedThrough,
  });

  factory Company.fromJson(Json json) => Company(
    id: json['id'] as String,
    ruc: json['ruc'] as String,
    legalName: json['legalName'] as String,
    taxRegime: TaxRegime.fromWire(json['taxRegime'] as String),
    role: Role.fromWire(json['role'] as String),
    closedThrough: json['closedThrough'] as String?,
  );

  final String id;
  final String ruc;
  final String legalName;
  final TaxRegime taxRegime;
  final Role role;

  /// Libros cerrados hasta esta fecha (AAAA-MM-DD), si hay alguna.
  final String? closedThrough;
}

class Invitation {
  const Invitation({
    required this.id,
    required this.companyId,
    required this.legalName,
    required this.role,
    required this.invitedBy,
  });

  factory Invitation.fromJson(Json json) => Invitation(
    id: json['id'] as String,
    companyId: json['companyId'] as String,
    legalName: json['legalName'] as String,
    role: Role.fromWire(json['role'] as String),
    invitedBy: json['invitedBy'] as String? ?? '',
  );

  final String id;
  final String companyId;
  final String legalName;
  final Role role;
  final String invitedBy;
}

/// Cómo va el negocio, como lo devuelve `GET /companies/:id/summary`.
class Summary {
  const Summary({
    required this.period,
    required this.cash,
    required this.bank,
    required this.receivable,
    required this.payable,
    required this.igvMonth,
    required this.sales,
    required this.expenses,
  });

  factory Summary.fromJson(Json json) {
    final money = json['money'] as Json;
    final month = json['month'] as Json;
    return Summary(
      period: json['period'] as String,
      cash: money['cash'] as int,
      bank: money['bank'] as int,
      receivable: json['receivable'] as int,
      payable: json['payable'] as int,
      igvMonth: (json['igv'] as Json)['month'] as int,
      sales: month['sales'] as int,
      expenses: month['expenses'] as int,
    );
  }

  final String period;
  final Cents cash;
  final Cents bank;
  final Cents receivable;
  final Cents payable;

  /// IGV del mes: positivo, por pagar a SUNAT; negativo, a favor.
  final Cents igvMonth;
  final Cents sales;
  final Cents expenses;

  Cents get money => cash + bank;
  Cents get result => sales - expenses;
}

class EntryLine {
  const EntryLine({
    required this.accountCode,
    required this.accountName,
    required this.debit,
    required this.credit,
  });

  factory EntryLine.fromJson(Json json) => EntryLine(
    accountCode: json['accountCode'] as String,
    accountName: json['accountName'] as String,
    debit: json['debit'] as int,
    credit: json['credit'] as int,
  );

  final String accountCode;
  final String accountName;
  final Cents debit;
  final Cents credit;
}

/// De dónde salió un asiento: decide su ícono y si la plata entra o sale.
enum EntrySource {
  manual('manual'),
  sale('sale'),
  expense('expense'),
  collection('collection'),
  payment('payment'),
  taxPayment('tax_payment'),
  reversal('reversal');

  const EntrySource(this.wire);
  final String wire;

  static EntrySource fromWire(String? wire) =>
      values.firstWhere((s) => s.wire == wire, orElse: () => manual);
}

class JournalEntry {
  const JournalEntry({
    required this.id,
    required this.number,
    required this.fiscalYear,
    required this.entryDate,
    required this.description,
    required this.createdBy,
    required this.lines,
    required this.total,
    this.reversesEntryId,
    this.reversedByEntryId,
    this.source = EntrySource.manual,
  });

  factory JournalEntry.fromJson(Json json) => JournalEntry(
    id: json['id'] as String,
    number: json['number'] as int,
    fiscalYear: json['fiscalYear'] as int,
    entryDate: json['entryDate'] as String,
    description: json['description'] as String,
    createdBy: (json['createdBy'] as Json)['fullName'] as String,
    lines: [for (final l in json['lines'] as List) EntryLine.fromJson(l as Json)],
    total: (json['totals'] as Json)['debit'] as int,
    reversesEntryId: json['reversesEntryId'] as String?,
    reversedByEntryId: json['reversedByEntryId'] as String?,
    source: EntrySource.fromWire(json['source'] as String?),
  );

  final String id;
  final int number;
  final int fiscalYear;
  final String entryDate;
  final String description;
  final String createdBy;
  final List<EntryLine> lines;
  final Cents total;
  final String? reversesEntryId;
  final String? reversedByEntryId;
  final EntrySource source;

  bool get isReversal => reversesEntryId != null;
  bool get isReversed => reversedByEntryId != null;
}

class JournalPage {
  const JournalPage(this.entries, this.nextAfter);
  final List<JournalEntry> entries;
  final int? nextAfter;
}

class OperationResult {
  const OperationResult({required this.entry, required this.explanation});
  final JournalEntry entry;

  /// Lo que se registró, en palabras simples.
  final String explanation;
}

enum BillingCycle {
  monthly('monthly', 'Mensual'),
  annual('annual', 'Anual');

  const BillingCycle(this.wire, this.label);
  final String wire;
  final String label;
}

class Plan {
  const Plan({
    required this.code,
    required this.name,
    required this.tagline,
    required this.maxMembers,
    required this.monthlyCents,
    required this.annualCents,
    required this.features,
  });

  factory Plan.fromJson(Json json) => Plan(
    code: json['code'] as String,
    name: json['name'] as String,
    tagline: json['tagline'] as String,
    maxMembers: json['maxMembers'] as int,
    monthlyCents: json['monthlyCents'] as int,
    annualCents: json['annualCents'] as int,
    features: [for (final f in json['features'] as List) f as String],
  );

  final String code;
  final String name;
  final String tagline;
  final int maxMembers;
  final Cents monthlyCents;
  final Cents annualCents;
  final List<String> features;

  Cents price(BillingCycle cycle) => cycle == BillingCycle.monthly ? monthlyCents : annualCents;
}

enum LicenseStatus { trial, active, expired }

class License {
  const License({
    required this.status,
    required this.planName,
    required this.endsAt,
    required this.daysLeft,
    required this.members,
    required this.maxMembers,
  });

  factory License.fromJson(Json json) => License(
    status: LicenseStatus.values.byName(json['status'] as String),
    planName: json['planName'] as String,
    endsAt: DateTime.parse(json['endsAt'] as String),
    daysLeft: json['daysLeft'] as int,
    members: json['members'] as int,
    maxMembers: json['maxMembers'] as int,
  );

  final LicenseStatus status;
  final String planName;
  final DateTime endsAt;
  final int daysLeft;
  final int members;
  final int maxMembers;
}

class Billing {
  const Billing({required this.license, required this.plans});

  factory Billing.fromJson(Json json) => Billing(
    license: License.fromJson(json['license'] as Json),
    plans: [for (final p in json['plans'] as List) Plan.fromJson(p as Json)],
  );

  final License license;
  final List<Plan> plans;
}

class Member {
  const Member({
    required this.userId,
    required this.fullName,
    required this.phone,
    required this.role,
  });

  factory Member.fromJson(Json json) => Member(
    userId: json['userId'] as String,
    fullName: json['fullName'] as String,
    phone: json['phone'] as String,
    role: Role.fromWire(json['role'] as String),
  );

  final String userId;
  final String fullName;

  /// Enmascarado por el servidor.
  final String phone;
  final Role role;
}

class Contact {
  const Contact({
    required this.id,
    required this.kind,
    required this.name,
    required this.balance,
    this.ruc,
  });

  factory Contact.fromJson(Json json) => Contact(
    id: json['id'] as String,
    kind: ContactKind.fromWire(json['kind'] as String),
    name: json['name'] as String,
    ruc: json['ruc'] as String?,
    balance: json['balance'] as int,
  );

  final String id;
  final ContactKind kind;
  final String name;
  final String? ruc;

  /// Cliente: lo que te debe. Proveedor: lo que le debes.
  final Cents balance;
}

class ContactMovement {
  const ContactMovement({
    required this.entryDate,
    required this.description,
    required this.amount,
    required this.balance,
  });

  factory ContactMovement.fromJson(Json json) => ContactMovement(
    entryDate: json['entryDate'] as String,
    description: json['description'] as String,
    amount: json['amount'] as int,
    balance: json['balance'] as int,
  );

  final String entryDate;
  final String description;

  /// Positivo: sube lo que se debe (venta o compra al crédito). Negativo: baja.
  final Cents amount;
  final Cents balance;
}

class ContactDetail {
  const ContactDetail(this.contact, this.movements);

  factory ContactDetail.fromJson(Json json) => ContactDetail(
    Contact.fromJson(json['contact'] as Json),
    [for (final m in json['movements'] as List) ContactMovement.fromJson(m as Json)],
  );

  final Contact contact;
  final List<ContactMovement> movements;
}

/// Lo que toca pagar a SUNAT en el mes, como lo devuelve `GET /taxes`.
class MonthlyTaxes {
  const MonthlyTaxes({
    required this.period,
    required this.regime,
    required this.igv,
    required this.incomeBase,
    required this.incomeRatePercent,
    required this.nrusCategory,
    required this.incomeAmount,
    required this.total,
    required this.notes,
  });

  factory MonthlyTaxes.fromJson(Json json) {
    final income = json['income'] as Json;
    final igv = json['igv'] as Json?;
    return MonthlyTaxes(
      period: json['period'] as String,
      regime: TaxRegime.fromWire(json['regime'] as String),
      igv: igv == null
          ? null
          : IgvMonth(
              sales: igv['sales'] as int,
              purchases: igv['purchases'] as int,
              previousCredit: igv['previousCredit'] as int,
              toPay: igv['toPay'] as int,
              nextCredit: igv['nextCredit'] as int,
            ),
      incomeBase: income['base'] as int,
      incomeRatePercent: (income['ratePercent'] as num?)?.toDouble(),
      nrusCategory: income['nrusCategory'] as int?,
      incomeAmount: income['amount'] as int,
      total: json['total'] as int,
      notes: [for (final n in json['notes'] as List) n as String],
    );
  }

  final String period;
  final TaxRegime regime;

  /// Null en el Nuevo RUS (no separa IGV).
  final IgvMonth? igv;
  final Cents incomeBase;

  /// Tasa del pago a cuenta en %; null en el Nuevo RUS (cuota fija).
  final double? incomeRatePercent;
  final int? nrusCategory;
  final Cents incomeAmount;
  final Cents total;
  final List<String> notes;
}

class IgvMonth {
  const IgvMonth({
    required this.sales,
    required this.purchases,
    required this.previousCredit,
    required this.toPay,
    required this.nextCredit,
  });

  final Cents sales;
  final Cents purchases;
  final Cents previousCredit;
  final Cents toPay;
  final Cents nextCredit;
}

class TrendPoint {
  const TrendPoint({required this.period, required this.sales, required this.expenses});

  factory TrendPoint.fromJson(Json json) => TrendPoint(
    period: json['period'] as String,
    sales: json['sales'] as int,
    expenses: json['expenses'] as int,
  );

  final String period;
  final Cents sales;
  final Cents expenses;
}

enum ExportKind {
  journal('journal', 'Libro diario'),
  trialBalance('trial_balance', 'Balance de comprobación');

  const ExportKind(this.wire, this.label);
  final String wire;
  final String label;
}
