import Foundation

/// Port of `src/main/db/connection-uri.ts` with engine-agnostic parsing support.
public enum ConnectionURI {
    public struct Parsed: Equatable, Sendable {
        public var host: String?
        public var port: Int?
        public var user: String?
        public var password: String?
        public var database: String?
        public var ssl: Bool?

        public init(
            host: String? = nil,
            port: Int? = nil,
            user: String? = nil,
            password: String? = nil,
            database: String? = nil,
            ssl: Bool? = nil
        ) {
            self.host = host
            self.port = port
            self.user = user
            self.password = password
            self.database = database
            self.ssl = ssl
        }
    }

    public struct AnyParsed: Equatable, Sendable {
        public var scheme: String
        public var parsed: Parsed
        public var filePath: String?
    }

    static let allowedSchemes: [DatabaseType: [String]] = [
        .postgres: ["postgres", "postgresql", "pg"],
        .mysql: ["mysql", "mysql2"],
        .mariadb: ["mariadb", "mysql", "mysql2"],
        .mssql: ["mssql", "sqlserver", "tds"],
        .sqlite: ["sqlite", "sqlite3", "file"],
        .mongodb: ["mongodb", "mongodb+srv"],
        .cockroachdb: ["cockroachdb", "cockroach", "postgres", "postgresql"],
        .clickhouse: ["clickhouse", "clickhouses", "http", "https"],
        .cassandra: ["cassandra"],
        .redis: ["redis", "rediss"],
        .elasticsearch: ["http", "https", "elasticsearch", "es", "opensearch"],
        .oracle: ["oracle", "oracle+thin"],
        .influxdb: ["http", "https", "influxdb", "influx"],
        .neo4j: ["http", "https", "neo4j", "neo4j+s", "neo4j+ssc", "bolt", "bolt+s", "bolt+ssc"],
        .snowflake: ["snowflake", "https"]
    ]

    /// Parses any valid connection URI without requiring the caller to know the database engine in advance.
    public static func parseAny(_ uri: String?) -> AnyParsed? {
        guard let raw = uri?.trimmingCharacters(in: .whitespacesAndNewlines), !raw.isEmpty else { return nil }
        guard let comps = URLComponents(string: raw), let scheme = comps.scheme?.lowercased(), !scheme.isEmpty else {
            return nil
        }

        // Handle sqlite:///path/to/file.db or file:///path/to/file.sqlite
        var filePath: String?
        if scheme == "sqlite" || scheme == "sqlite3" || scheme == "file" {
            let hostPart = comps.host ?? ""
            let rawPath = comps.path
            let combined = hostPart.isEmpty ? rawPath : "/\(hostPart)\(rawPath)"
            if !combined.isEmpty {
                filePath = combined
            }
        }

        let path = comps.percentEncodedPath.drop(while: { $0 == "/" })
        var parsed = Parsed(
            host: comps.host.flatMap { $0.isEmpty ? nil : $0 },
            port: comps.port,
            user: comps.user.flatMap { $0.isEmpty ? nil : $0 },
            password: comps.password.flatMap { $0.isEmpty ? nil : $0 },
            database: path.isEmpty ? nil : (String(path).removingPercentEncoding ?? String(path))
        )

        let query = comps.queryItems ?? []
        func value(_ name: String) -> String? { query.first { $0.name.lowercased() == name }?.value }
        if let ssl = value("ssl") ?? value("sslmode") {
            parsed.ssl = !["disable", "false", "0"].contains(ssl.lowercased())
        } else if let encrypt = value("encrypt") {
            parsed.ssl = ["true", "1", "yes"].contains(encrypt.lowercased())
        } else if ["https", "rediss", "clickhouses", "neo4j+s", "neo4j+ssc", "bolt+s", "bolt+ssc", "mongodb+srv"].contains(scheme) {
            parsed.ssl = true
        }
        return AnyParsed(scheme: scheme, parsed: parsed, filePath: filePath)
    }

    public static func parse(type: DatabaseType, uri: String?) throws -> Parsed? {
        guard let raw = uri?.trimmingCharacters(in: .whitespacesAndNewlines), !raw.isEmpty else { return nil }
        guard let any = parseAny(raw) else {
            throw DatabaseError("Invalid connection URI format")
        }
        let allowed = allowedSchemes[type] ?? []
        guard allowed.contains(any.scheme) else {
            throw DatabaseError("Invalid URI scheme for \(type.rawValue). Allowed: \(allowed.joined(separator: ", "))")
        }
        return any.parsed
    }
}
