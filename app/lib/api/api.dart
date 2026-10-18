import '../core/documents.dart';
import '../core/operations.dart';
import 'models.dart';

export '../core/documents.dart' show DocType, OperationDocument;
export 'models.dart';

/// Lo que la app le pide al backend. `HttpContabiliApi` habla con el servidor
/// real; `FakeContabiliApi` sirve para las pruebas.
abstract interface class ContabiliApi {
  Future<bool> hasSession();
  Future<CodeSent> requestCode(String phone);
  Future<VerifyResult> verifyCode(String phone, String code);
  Future<SignedIn> register({
    required String registrationToken,
    required String fullName,
    required bool acceptTerms,
  });
  Future<Me> me();
  Future<void> logout();

  Future<List<Company>> companies();
  Future<Company> createCompany({
    required String ruc,
    required String legalName,
    required TaxRegime taxRegime,
  });
  Future<List<Invitation>> myInvitations();
  Future<void> respondInvitation(String invitationId, {required bool accept});

  Future<Summary> summary(String companyId, {String? period});
  Future<OperationResult> recordOperation(
    String companyId,
    Operation operation, {
    String? date,
    String? reference,
    String? contactId,
    OperationDocument? document,
  });
  Future<JournalPage> journal(String companyId, {required String period, int after = 0});
  Future<JournalEntry> reverseEntry(String companyId, String entryId);
  Future<void> closePeriod(String companyId, String period);

  Future<Billing> billing(String companyId);

  Future<List<Contact>> contacts(String companyId, {ContactKind? kind});
  Future<Contact> createContact(
    String companyId, {
    required ContactKind kind,
    required String name,
    String? ruc,
  });
  Future<ContactDetail> contact(String companyId, String contactId);

  Future<MonthlyTaxes> taxes(String companyId, {String? period});
  Future<Register> documentRegister(String companyId, RegisterKind kind, {required String period});
  Future<List<TrendPoint>> trend(String companyId, {int months = 6});

  /// Enlace de descarga para Excel (vence en 5 minutos); se abre en el navegador.
  Future<Uri> exportLink(
    String companyId, {
    required ExportKind kind,
    required String from,
    required String to,
    ExportFormat format = ExportFormat.csv,
  });

  // Facturación electrónica (beta).
  Future<EinvoiceSettings> einvoiceSettings(String companyId);
  Future<EinvoiceSettings> saveEinvoiceSettings(
    String companyId, {
    required String provider,
    required String facturaSeries,
    required String boletaSeries,
    String? facturaNoteSeries,
    String? boletaNoteSeries,
    String? endpoint,
    String? token,
  });
  Future<List<Einvoice>> einvoices(String companyId, {required String period});
  Future<EinvoiceResult> emitEinvoice(String companyId, EmitRequest request);
  Future<EinvoiceResult> refreshEinvoice(String companyId, String einvoiceId);
  Future<EinvoiceResult> recordEinvoice(String companyId, String einvoiceId);

  /// Anula la boleta o factura con una nota de crédito por el total.
  Future<EinvoiceResult> creditNote(String companyId, String einvoiceId, CreditReason reason);

  /// Dónde ver el PDF del comprobante.
  Future<Uri> einvoiceLink(String companyId, String einvoiceId);

  /// Crea la orden de pago y devuelve la dirección de la página de pago.
  Future<Uri> createOrder(String companyId, {required String plan, required BillingCycle cycle});

  /// Dónde ver el comprobante de un pago de la licencia.
  Future<Uri> receiptLink(String companyId, String receiptId);

  Future<List<Member>> members(String companyId);
  Future<void> invite(String companyId, {required String phone, required Role role});
  Future<void> removeMember(String companyId, String userId);
}
