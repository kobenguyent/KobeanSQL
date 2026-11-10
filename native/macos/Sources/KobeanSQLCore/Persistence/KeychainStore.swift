import Foundation
import Security

/// Stores connection passwords in the login Keychain (never in the JSON file).
/// Works with ad-hoc signed builds; macOS may ask once to allow access after an app update
/// because the ad-hoc signature changes on every build.
public enum KeychainStore {
    static let service = "com.kobenguyent.kobeansql.native"

    public static func password(for id: String) -> String? {
        let query: [String: Any] = [
            kSecClass as String: kSecClassGenericPassword,
            kSecAttrService as String: service,
            kSecAttrAccount as String: id,
            kSecReturnData as String: true,
            kSecMatchLimit as String: kSecMatchLimitOne
        ]
        var item: CFTypeRef?
        guard SecItemCopyMatching(query as CFDictionary, &item) == errSecSuccess, let data = item as? Data else { return nil }
        return String(data: data, encoding: .utf8)
    }

    public static func setPassword(_ password: String?, for id: String) {
        let base: [String: Any] = [
            kSecClass as String: kSecClassGenericPassword,
            kSecAttrService as String: service,
            kSecAttrAccount as String: id
        ]
        SecItemDelete(base as CFDictionary)
        guard let password, !password.isEmpty else { return }
        var add = base
        add[kSecValueData as String] = Data(password.utf8)
        add[kSecAttrAccessible as String] = kSecAttrAccessibleAfterFirstUnlock
        add[kSecAttrLabel as String] = "KobeanSQL connection"
        SecItemAdd(add as CFDictionary, nil)
    }
}
