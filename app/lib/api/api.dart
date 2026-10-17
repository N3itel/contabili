import '../core/operations.dart';
import 'models.dart';

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
  });
  Future<JournalPage> journal(String companyId, {required String period, int after = 0});
  Future<JournalEntry> reverseEntry(String companyId, String entryId);
  Future<void> closePeriod(String companyId, String period);

  Future<Billing> billing(String companyId);

  /// Crea la orden de pago y devuelve la dirección de la página de pago.
  Future<Uri> createOrder(String companyId, {required String plan, required BillingCycle cycle});

  Future<List<Member>> members(String companyId);
  Future<void> invite(String companyId, {required String phone, required Role role});
  Future<void> removeMember(String companyId, String userId);
}
