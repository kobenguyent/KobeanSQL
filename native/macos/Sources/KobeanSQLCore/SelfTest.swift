import Foundation

/// Built-in verification suite that runs both from `swift test` (via XCTest) and via
/// `KobeanSQL --self-test` on machines that only have Command Line Tools installed.
public enum SelfTestSuite {
    private static func check(_ condition: @autoclosure () -> Bool, _ message: String, file: String = #fileID, line: Int = #line) throws {
        if !condition() {
            throw DatabaseError("Self-test assertion failed (\(file):\(line)): \(message)")
        }
    }

    public static func runAll() async throws {
        // 1. DatabaseType metadata
        try check(DatabaseType.allCases.count == 15, "Expected 15 database engines")
        try check(DatabaseType.postgres.category == .relational, "Postgres category")
        try check(DatabaseType.redis.category == .keyValue, "Redis category")
        try check(DatabaseType.neo4j.category == .graph, "Neo4j category")
        try check(DatabaseType.influxdb.category == .timeSeries, "InfluxDB category")
        try check(DatabaseType.clickhouse.category == .cloudWarehouse, "ClickHouse category")

        // 2. ConnectionURI parser
        let pg = try ConnectionURI.parse(type: .postgres, uri: "postgresql://alice:s3cret@db.example.com:5433/analytics?sslmode=require")
        try check(pg?.host == "db.example.com", "URI host")
        try check(pg?.port == 5433, "URI port")
        try check(pg?.user == "alice", "URI user")
        try check(pg?.password == "s3cret", "URI password")
        try check(pg?.database == "analytics", "URI database")
        try check(pg?.ssl == true, "URI ssl")

        var rejectedBadScheme = false
        do {
            _ = try ConnectionURI.parse(type: .postgres, uri: "mysql://localhost:3306/test")
        } catch {
            rejectedBadScheme = true
        }
        try check(rejectedBadScheme, "Should reject mismatched URI scheme")

        // 3. QueryGuard safety limits
        try check(QueryGuard.applySafetyLimit("SELECT * FROM users", type: .postgres) == "SELECT * FROM users LIMIT 1000", "Auto LIMIT postgres")
        try check(QueryGuard.applySafetyLimit("SELECT * FROM users;", type: .mysql) == "SELECT * FROM users LIMIT 1000", "Auto LIMIT mysql with semicolon")
        try check(QueryGuard.applySafetyLimit("SELECT * FROM users LIMIT 10", type: .postgres) == "SELECT * FROM users LIMIT 10", "Preserve existing LIMIT")
        try check(QueryGuard.applySafetyLimit("UPDATE users SET active = 1", type: .postgres) == "UPDATE users SET active = 1", "Skip DML")
        try check(QueryGuard.applySafetyLimit("GET mykey", type: .redis) == "GET mykey", "Skip Redis")

        let bigRows = Array(repeating: [CellValue.integer(1)], count: 10_005)
        let capped = QueryGuard.capRows(QueryResult(columns: [ColumnDef(name: "id")], rows: bigRows))
        try check(capped.rows.count == 10_000, "Cap rows at 10,000")
        try check(capped.notice?.contains("10000") == true, "Attach truncation notice")

        // 4. StatementSplitter
        let script = """
        -- header comment
        INSERT INTO logs(msg) VALUES ('hello; world');
        CREATE FUNCTION f() RETURNS void AS $$
        BEGIN
            PERFORM 1;
        END;
        $$ LANGUAGE plpgsql;
        SELECT 42;
        """
        let parts = StatementSplitter.split(script, type: .postgres)
        try check(parts.count == 3, "Split 3 statements (got \(parts.count))")
        try check(parts[0].contains("'hello; world'"), "Preserve semicolon inside string")
        try check(parts[1].contains("PERFORM 1;"), "Preserve semicolon inside dollar-quoted body")
        try check(parts[2] == "SELECT 42", "Final statement")

        // 5. SQLiteDriver + ConnectionManager end-to-end
        let tmpFile = FileManager.default.temporaryDirectory
            .appendingPathComponent("kobeansql-test-\(UUID().uuidString).sqlite")
        defer { try? FileManager.default.removeItem(at: tmpFile) }

        let config = ConnectionConfig(name: "Test SQLite", type: .sqlite, filename: tmpFile.path)
        let manager = ConnectionManager()
        let version = try await manager.connect(config)
        try check(version.contains("SQLite"), "SQLite version string")

        let sqlScript = """
        CREATE TABLE items (id INTEGER PRIMARY KEY, title TEXT NOT NULL, price REAL DEFAULT 9.99);
        INSERT INTO items (title, price) VALUES ('MacBook Pro', 2499.0), ('Magic Trackpad', 129.0);
        SELECT id, title, price FROM items ORDER BY id;
        """
        let results = try await manager.run(sqlScript, connectionID: config.id, type: .sqlite, database: "main")
        try check(results.count == 3, "Executed 3 SQLite statements")
        try check(results[2].rows.count == 2, "Returned 2 rows")
        try check(results[2].rows[0][1] == .text("MacBook Pro"), "First row title")
        try check(results[2].executedQuery.hasSuffix("LIMIT 1000"), "Auto-LIMIT applied")

        let tables = try await manager.tables(config.id, database: "main")
        try check(tables.map(\.name) == ["items"], "Introspected SQLite tables")

        let cols = try await manager.columns(config.id, table: tables[0], database: "main")
        try check(cols.count == 3 && cols[0].name == "id" && cols[0].primaryKey, "Introspected SQLite columns")
        await manager.disconnect(config.id)

        // 6. AppStorage & Electron Import
        let dir = FileManager.default.temporaryDirectory
            .appendingPathComponent("kobeansql-storage-\(UUID().uuidString)", isDirectory: true)
        defer { try? FileManager.default.removeItem(at: dir) }

        let storage = AppStorage(directory: dir)
        let conn = ConnectionConfig(id: "c1", name: "PG", type: .postgres, host: "db.internal", password: "top-secret")
        try storage.saveConnections([conn])
        let rawJSON = try String(contentsOf: dir.appendingPathComponent("connections.json"), encoding: .utf8)
        try check(!rawJSON.contains("top-secret"), "Secrets never written to connections.json")

        let electronURL = dir.appendingPathComponent("electron-connections.json")
        let electronPayload = """
        {
          "version": 1,
          "connections": [
            { "id": "e1", "name": "Electron PG", "type": "postgres", "host": "localhost", "port": 5432, "password": "enc:AAAA" }
          ]
        }
        """
        try Data(electronPayload.utf8).write(to: electronURL)
        let imported = try AppStorage.importElectronConnections(from: electronURL)
        try check(imported.count == 1 && imported[0].name == "Electron PG" && imported[0].password == nil, "Imported Electron connections")

        // 7. Local AI loopback guard
        try check(AIService.validateLocalURL("http://127.0.0.1:11434") == nil, "Allow 127.0.0.1")
        try check(AIService.validateLocalURL("http://localhost:1234/v1") == nil, "Allow localhost")
        try check(AIService.validateLocalURL("https://api.openai.com/v1") != nil, "Reject remote AI host")

        // 8. ResultExporter
        let sampleResult = QueryResult(
            columns: [ColumnDef(name: "name"), ColumnDef(name: "score")],
            rows: [[.text("Ada, Countess"), .integer(100)], [.null, .integer(42)]]
        )
        let csv = ResultExporter.csv(sampleResult)
        try check(csv.contains("\"Ada, Countess\",100"), "CSV escaping")
        let json = try ResultExporter.json(sampleResult)
        try check(json.contains("\"score\" : 100"), "JSON export")

        // 9. RowMutator CRUD & Copy Table SQL generation
        let tbl = TableInfo(name: "customers", kind: .table, schema: "public")
        let crudCols = [ColumnDef(name: "id", type: "INTEGER"), ColumnDef(name: "name", type: "TEXT"), ColumnDef(name: "tier", type: "TEXT")]
        let insSQL = try RowMutator.buildInsertSQL(table: tbl, dialect: .postgres, isDemo: true, values: [("name", .text("Linus")), ("tier", .text("pro"))])
        try check(insSQL == "INSERT INTO \"customers\" (\"name\", \"tier\") VALUES ('Linus', 'pro');", "Insert SQL: \(insSQL)")

        let updSQL = try RowMutator.buildUpdateSQL(table: tbl, dialect: .postgres, isDemo: true, columns: crudCols, pkColumnNames: ["id"], originalRow: [.integer(1), .text("Ada"), .text("pro")], updatedValues: [("tier", .text("enterprise"))])
        try check(updSQL == "UPDATE \"customers\" SET \"tier\" = 'enterprise' WHERE \"id\" = 1;", "Update SQL: \(updSQL)")

        let dupSQL = try RowMutator.buildDuplicateSQL(table: tbl, dialect: .postgres, isDemo: true, columns: crudCols, pkColumnNames: ["id"], row: [.integer(1), .text("Ada"), .text("enterprise")])
        try check(dupSQL == "INSERT INTO \"customers\" (\"name\", \"tier\") VALUES ('Ada', 'enterprise');", "Duplicate SQL: \(dupSQL)")

        let delSQL = try RowMutator.buildDeleteSQL(table: tbl, dialect: .postgres, isDemo: true, columns: crudCols, pkColumnNames: ["id"], row: [.integer(1), .text("Ada"), .text("enterprise")])
        try check(delSQL == "DELETE FROM \"customers\" WHERE \"id\" = 1;", "Delete SQL: \(delSQL)")

        let copySQL = try RowMutator.buildCopyTableSQL(source: tbl, targetName: "customers_backup", mode: .schemaAndData, dialect: .sqlite, isDemo: true)
        try check(copySQL == ["CREATE TABLE \"customers_backup\" AS SELECT * FROM \"customers\";"], "Copy Table SQL: \(copySQL)")

        // 10. All Built-in Multi-Engine Demo Drivers (Postgres, MySQL, ClickHouse, Redis, Elasticsearch, Neo4j, InfluxDB)
        for preset in DemoDatabaseCatalog.presets where preset.type != .sqlite {
            let cfg = preset.connectionConfig
            let ver = try await manager.connect(cfg)
            try check(!ver.isEmpty, "Demo \(preset.type.rawValue) version")
            let tables = try await manager.tables(cfg.id, database: preset.defaultDatabase)
            try check(!tables.isEmpty, "Demo \(preset.type.rawValue) tables")
            let res = try await manager.run(preset.sampleQuery, connectionID: cfg.id, type: preset.type, database: preset.defaultDatabase)
            try check(!res.isEmpty && !res[0].rows.isEmpty, "Demo \(preset.type.rawValue) sample query rows")
            await manager.disconnect(cfg.id)
        }
    }
}
