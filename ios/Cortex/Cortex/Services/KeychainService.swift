import Foundation
import Security

class KeychainService {
    static let shared = KeychainService()

    private init() {}

    // MARK: - Access Token
    func saveAccessToken(_ token: String) {
        save(key: Constants.Keychain.accessTokenKey, value: token)
    }

    func getAccessToken() -> String? {
        get(key: Constants.Keychain.accessTokenKey)
    }

    // MARK: - Refresh Token
    func saveRefreshToken(_ token: String) {
        save(key: Constants.Keychain.refreshTokenKey, value: token)
    }

    func getRefreshToken() -> String? {
        get(key: Constants.Keychain.refreshTokenKey)
    }

    // MARK: - Clear All
    func clearTokens() {
        delete(key: Constants.Keychain.accessTokenKey)
        delete(key: Constants.Keychain.refreshTokenKey)
    }

    // MARK: - Private Helpers
    private func save(key: String, value: String) {
        guard let data = value.data(using: .utf8) else { return }

        // Delete existing item first
        delete(key: key)

        let query: [String: Any] = [
            kSecClass as String: kSecClassGenericPassword,
            kSecAttrService as String: Constants.Keychain.serviceName,
            kSecAttrAccount as String: key,
            kSecValueData as String: data,
            kSecAttrAccessible as String: kSecAttrAccessibleWhenUnlockedThisDeviceOnly
        ]

        SecItemAdd(query as CFDictionary, nil)
    }

    private func get(key: String) -> String? {
        let query: [String: Any] = [
            kSecClass as String: kSecClassGenericPassword,
            kSecAttrService as String: Constants.Keychain.serviceName,
            kSecAttrAccount as String: key,
            kSecReturnData as String: true,
            kSecMatchLimit as String: kSecMatchLimitOne
        ]

        var result: AnyObject?
        let status = SecItemCopyMatching(query as CFDictionary, &result)

        guard status == errSecSuccess,
              let data = result as? Data,
              let string = String(data: data, encoding: .utf8) else {
            return nil
        }

        return string
    }

    private func delete(key: String) {
        let query: [String: Any] = [
            kSecClass as String: kSecClassGenericPassword,
            kSecAttrService as String: Constants.Keychain.serviceName,
            kSecAttrAccount as String: key
        ]

        SecItemDelete(query as CFDictionary)
    }
}
