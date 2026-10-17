import 'package:flutter_secure_storage/flutter_secure_storage.dart';

/// Tokens de la sesión. El de acceso dura 15 minutos; el de renovación, 60 días.
class Tokens {
  const Tokens({required this.accessToken, required this.refreshToken});

  final String accessToken;
  final String refreshToken;
}

/// Dónde se guardan los tokens y la última empresa abierta.
abstract interface class SessionStore {
  Future<Tokens?> read();
  Future<void> write(Tokens tokens);
  Future<void> clear();
  Future<String?> lastCompanyId();
  Future<void> setLastCompanyId(String? companyId);
}

/// Almacén seguro de cada sistema: Keychain (iPhone y Mac), Keystore
/// (Android), Credential Manager (Windows) y libsecret (Linux).
class SecureSessionStore implements SessionStore {
  SecureSessionStore([FlutterSecureStorage? storage])
    : _storage = storage ?? const FlutterSecureStorage();

  final FlutterSecureStorage _storage;
  static const _access = 'contabili.accessToken';
  static const _refresh = 'contabili.refreshToken';
  static const _company = 'contabili.companyId';

  @override
  Future<Tokens?> read() async {
    final access = await _storage.read(key: _access);
    final refresh = await _storage.read(key: _refresh);
    if (access == null || refresh == null) return null;
    return Tokens(accessToken: access, refreshToken: refresh);
  }

  @override
  Future<void> write(Tokens tokens) async {
    await _storage.write(key: _access, value: tokens.accessToken);
    await _storage.write(key: _refresh, value: tokens.refreshToken);
  }

  @override
  Future<void> clear() async {
    await _storage.delete(key: _access);
    await _storage.delete(key: _refresh);
    await _storage.delete(key: _company);
  }

  @override
  Future<String?> lastCompanyId() => _storage.read(key: _company);

  @override
  Future<void> setLastCompanyId(String? companyId) => companyId == null
      ? _storage.delete(key: _company)
      : _storage.write(key: _company, value: companyId);
}

class MemorySessionStore implements SessionStore {
  MemorySessionStore([this._tokens]);

  Tokens? _tokens;
  String? _companyId;

  @override
  Future<Tokens?> read() async => _tokens;

  @override
  Future<void> write(Tokens tokens) async => _tokens = tokens;

  @override
  Future<void> clear() async {
    _tokens = null;
    _companyId = null;
  }

  @override
  Future<String?> lastCompanyId() async => _companyId;

  @override
  Future<void> setLastCompanyId(String? companyId) async => _companyId = companyId;
}
