import Foundation

/// ClickHouse over its HTTP interface (port 8123).
public actor ClickHouseDriver: DatabaseDriver {
    public let type: DatabaseType = .clickhouse
    private var http: HTTPClient?
    private var defaultDatabase = "default"

    public init() {}

    public func connect(_ config: ConnectionConfig) async throws {
        let config = try config.resolved()
        var headers = ["X-ClickHouse-User": config.user?.isEmpty == false ? config.user! : "default"]
        if let pw = config.password, !pw.isEmpty { headers["X-ClickHouse-Key"] = pw }
        http = try HTTPClient.make(config: config, defaultPort: 8123, headers: headers)
        if let db = config.database, !db.isEmpty { defaultDatabase = db }
        _ = try await execute("SELECT 1", database: nil)
    }

    public func disconnect() async {
        http?.invalidate()
        http = nil
    }

    public func execute(_ query: String, database: String?) async throws -> QueryResult {
        guard let http else { throw DatabaseError("Not connected") }
        let start = Date()
        let response = try await http.request(
            "POST", "/",
            query: [
                "database": database?.isEmpty == false ? database! : defaultDatabase,
                "default_format": "JSON",
                "max_execution_time": String(Int(QueryGuard.queryTimeout)),
                "max_result_rows": String(QueryGuard.maxRows + 1),
                "result_overflow_mode": "break"
            ],
            body: Data(query.utf8), contentType: "text/plain; charset=utf-8")
        guard response.status == 200 else {
            throw DatabaseError(response.text.trimmingCharacters(in: .whitespacesAndNewlines))
        }
        let duration = Date().timeIntervalSince(start)
        guard !response.data.isEmpty,
              let json = try? response.json() as? [String: Any],
              let meta = json["meta"] as? [[String: Any]] else {
            return QueryResult(rowCount: 0, duration: duration)
        }
        let columns = meta.map { ColumnDef(name: $0["name"] as? String ?? "", type: $0["type"] as? String ?? "") }
        let data = json["data"] as? [[String: Any]] ?? []
        let rows = data.map { row in columns.map { JSONCells.cell(row[$0.name]) } }
        return QueryResult(columns: columns, rows: rows, duration: duration)
    }

    public func databases() async throws -> [String] {
        try await execute("SHOW DATABASES", database: nil).rows.map { $0[0].description }
    }

    public func tables(database: String?) async throws -> [TableInfo] {
        let db = database ?? defaultDatabase
        let sql = "SELECT name, engine FROM system.tables WHERE database = \(SQLIdent.literal(db)) ORDER BY name"
        return try await execute(sql, database: nil).rows.map {
            TableInfo(name: $0[0].description, kind: $0[1].description.contains("View") ? .view : .table, schema: db)
        }
    }

    public func columns(table: TableInfo, database: String?) async throws -> [ColumnInfo] {
        let db = table.schema ?? database ?? defaultDatabase
        let sql = """
        SELECT name, type, is_in_primary_key, default_expression FROM system.columns
        WHERE database = \(SQLIdent.literal(db)) AND table = \(SQLIdent.literal(table.name)) ORDER BY position
        """
        return try await execute(sql, database: nil).rows.map { r in
            let type = r[1].description
            return ColumnInfo(name: r[0].description, type: type, nullable: type.hasPrefix("Nullable"),
                              primaryKey: r[2].description == "1", defaultValue: r[3].description.isEmpty ? nil : r[3].description)
        }
    }

    public func serverVersion() async throws -> String {
        "ClickHouse " + (try await execute("SELECT version()", database: nil).rows.first?.first?.description ?? "")
    }

    public func previewQuery(for table: TableInfo, database: String?, limit: Int) -> String {
        let qualified = [table.schema, table.name].compactMap { $0 }.map { SQLIdent.quote($0, with: "`") }.joined(separator: ".")
        return "SELECT * FROM \(qualified) LIMIT \(limit)"
    }
}
