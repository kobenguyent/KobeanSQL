import Foundation

/// Port of `src/main/db/connection-uri.ts`.
public enum ConnectionURI {
    public struct Parsed: Equatable, Sendable {
        public var host: String?
        public var port: Int?
        public var user: String?
        public var password: String?
        public var database: String?
        public var ssl: Bool?
    }

    static let allowedSchemes: [DatabaseType: [String]] = [
        .postgres: ["postgres", "postgresql"],
        .mysql: ["mysql"],
        .mariadb: ["mariadb", "mysql"],
        .mssql: ["mssql", "sqlserver"],
        .sqlite: ["sqlite"],
        .mongodb: ["mongodb", "mongodb+srv"],
        .cockroachdb: ["cockroachdb", "postgres", "postgresql"],
        .clickhouse: ["clickhouse", "http", "https"],
        .cassandra: ["cassandra"],
        .redis: ["redis", "rediss"],
        .elasticsearch: ["http", "https", "elasticsearch"],
        .oracle: ["oracle", "oracle+thin"],
        .influxdb: ["http", "https", "influxdb"],
        .neo4j: ["http", "https", "neo4j", "bolt"]
    ]

    public static func parse(type: DatabaseType, uri: String?) throws -> Parsed? {
        guard let raw = uri?.trimmingCharacters(in: .whitespacesAndNewlines), !raw.isEmpty else { return nil }
        guard let comps = URLComponents(string: raw), let scheme = comps.scheme?.lowercased() else {
            throw DatabaseError("Invalid connection URI format")
        }
        let allowed = allowedSchemes[type] ?? []
        guard allowed.contains(scheme) else {
            throw DatabaseError("Invalid URI scheme for \(type.rawValue). Allowed: \(allowed.joined(separator: ", "))")
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
        func value(_ name: String) -> String? { query.first { $0.name == name }?.value }
        if let ssl = value("ssl") ?? value("sslmode") {
            parsed.ssl = !["disable", "false", "0"].contains(ssl.lowercased())
        } else if let encrypt = value("encrypt") {
            parsed.ssl = ["true", "1", "yes"].contains(encrypt.lowercased())
        } else if scheme == "https" || scheme == "rediss" {
            parsed.ssl = true
        }
        return parsed
    }
}
