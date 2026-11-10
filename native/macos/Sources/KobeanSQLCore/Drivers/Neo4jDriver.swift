import Foundation

/// Neo4j via the HTTP transactional Cypher endpoint (`/db/{name}/tx/commit`, port 7474).
public actor Neo4jDriver: DatabaseDriver {
    public let type: DatabaseType = .neo4j
    private var http: HTTPClient?
    private var defaultDatabase = "neo4j"

    public init() {}

    public func connect(_ config: ConnectionConfig) async throws {
        let config = try config.resolved()
        http = try HTTPClient.make(config: config, defaultPort: 7474,
                                   headers: HTTPClient.basicAuth(user: config.user, password: config.password))
        if let db = config.database, !db.isEmpty { defaultDatabase = db }
        _ = try await execute("RETURN 1 AS ok", database: nil)
    }

    public func disconnect() async {
        http?.invalidate()
        http = nil
    }

    public func execute(_ query: String, database: String?) async throws -> QueryResult {
        guard let http else { throw DatabaseError("Not connected") }
        let db = database?.isEmpty == false ? database! : defaultDatabase
        let start = Date()
        let payload: [String: Any] = ["statements": [["statement": query, "includeStats": true]]]
        let response = try await http.request(
            "POST", "/db/\(db.addingPercentEncoding(withAllowedCharacters: .urlPathAllowed) ?? db)/tx/commit",
            body: try JSONSerialization.data(withJSONObject: payload),
            contentType: "application/json", accept: "application/json")
        if response.status == 401 { throw DatabaseError("Authentication failed (401)") }
        guard let json = try? response.json() as? [String: Any] else {
            throw DatabaseError("HTTP \(response.status): \(response.text)")
        }
        if let errors = json["errors"] as? [[String: Any]], let first = errors.first {
            throw DatabaseError("\(first["code"] as? String ?? "Error"): \(first["message"] as? String ?? "")")
        }
        let duration = Date().timeIntervalSince(start)
        guard let result = (json["results"] as? [[String: Any]])?.first else {
            return QueryResult(rowCount: 0, duration: duration)
        }
        let columns = (result["columns"] as? [String] ?? []).map { ColumnDef(name: $0) }
        let data = result["data"] as? [[String: Any]] ?? []
        let rows: [[CellValue]] = data.map { item in
            let rawRow = item["row"] as? [Any] ?? []
            return rawRow.map { JSONCells.cell($0) }
        }
        if columns.isEmpty, let stats = result["stats"] as? [String: Any] {
            let changed = stats.compactMap { ($0.value as? Int).flatMap { $0 > 0 ? $0 : nil } }.reduce(0, +)
            return QueryResult(rowCount: changed, duration: duration)
        }
        return QueryResult(columns: columns, rows: rows, duration: duration)
    }

    public func databases() async throws -> [String] {
        let result = try? await execute("SHOW DATABASES YIELD name RETURN name", database: "system")
        return result?.rows.map { $0[0].description }.filter { $0 != "system" } ?? [defaultDatabase]
    }

    /// Node labels act as "tables".
    public func tables(database: String?) async throws -> [TableInfo] {
        try await execute("CALL db.labels() YIELD label RETURN label ORDER BY label", database: database)
            .rows.map { TableInfo(name: $0[0].description) }
    }

    public func columns(table: TableInfo, database: String?) async throws -> [ColumnInfo] {
        let cypher = "MATCH (n:\(SQLIdent.quote(table.name, with: "`"))) WITH n LIMIT 100 UNWIND keys(n) AS k RETURN DISTINCT k ORDER BY k"
        return try await execute(cypher, database: database).rows.map { ColumnInfo(name: $0[0].description, type: "property") }
    }

    public func serverVersion() async throws -> String {
        let r = try await execute("CALL dbms.components() YIELD name, versions RETURN name, versions[0]", database: nil)
        guard let row = r.rows.first else { return "Neo4j" }
        return "\(row[0]) \(row[1])"
    }

    public func previewQuery(for table: TableInfo, database: String?, limit: Int) -> String {
        "MATCH (n:\(SQLIdent.quote(table.name, with: "`"))) RETURN n LIMIT \(limit)"
    }
}
