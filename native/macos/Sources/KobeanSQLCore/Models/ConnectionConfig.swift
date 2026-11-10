import Foundation

/// Saved connection definition. Field names match `ConnectionConfig` in `src/main/db/types.ts`.
/// The password is never persisted in this struct's JSON — it lives in the Keychain.
public struct ConnectionConfig: Codable, Identifiable, Hashable, Sendable {
    public var id: String
    public var name: String
    public var type: DatabaseType
    public var connectionUri: String?
    public var host: String?
    public var port: Int?
    public var user: String?
    public var password: String?
    public var database: String?
    public var filename: String?
    public var ssl: Bool?
    public var color: String?
    public var category: String?

    public init(
        id: String = UUID().uuidString,
        name: String = "",
        type: DatabaseType = .postgres,
        connectionUri: String? = nil,
        host: String? = "localhost",
        port: Int? = nil,
        user: String? = nil,
        password: String? = nil,
        database: String? = nil,
        filename: String? = nil,
        ssl: Bool? = false,
        color: String? = nil,
        category: String? = nil
    ) {
        self.id = id
        self.name = name
        self.type = type
        self.connectionUri = connectionUri
        self.host = host
        self.port = port ?? type.defaultPort
        self.user = user
        self.password = password
        self.database = database
        self.filename = filename
        self.ssl = ssl
        self.color = color
        self.category = category
    }

    /// Short "user@host:port/db" description for the sidebar.
    public var subtitle: String {
        if type == .sqlite { return filename.map { ($0 as NSString).lastPathComponent } ?? "No file" }
        if let uri = connectionUri, !uri.isEmpty, let resolved = try? resolved() {
            return resolved.endpointDescription
        }
        return endpointDescription
    }

    private var endpointDescription: String {
        var s = host ?? "localhost"
        if let port { s += ":\(port)" }
        if let database, !database.isEmpty { s += "/\(database)" }
        return s
    }

    /// Returns a copy with fields from `connectionUri` applied (mirrors `resolveConnectionConfig`).
    public func resolved() throws -> ConnectionConfig {
        guard let parsed = try ConnectionURI.parse(type: type, uri: connectionUri) else { return self }
        var copy = self
        copy.host = parsed.host ?? host
        copy.port = parsed.port ?? port
        copy.user = parsed.user ?? user
        copy.password = parsed.password ?? password
        copy.database = parsed.database ?? database
        copy.ssl = parsed.ssl ?? ssl
        return copy
    }

    /// Copy without secrets, safe to write to disk.
    public var withoutSecrets: ConnectionConfig {
        var copy = self
        copy.password = nil
        return copy
    }
}
