import Foundation
import NIOCore
import NIOPosix

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

        // 3b. Read-Only Safe Mode, Destructive Risk Guard, Secret Redaction & CellValue Sort/Preview
        try check(!QueryGuard.isWriteOrDDL("SELECT * FROM users", type: .postgres), "SELECT is read-only")
        try check(QueryGuard.isWriteOrDDL("UPDATE users SET active = 0 WHERE id = 1", type: .postgres), "UPDATE is write")
        try check(QueryGuard.isWriteOrDDL("SET session:1 'ok'", type: .redis), "Redis SET is write")
        try check(!QueryGuard.isWriteOrDDL("GET session:1", type: .redis), "Redis GET is read-only")

        try check(QueryGuard.detectDestructiveRisk("DELETE FROM users;", type: .postgres) != nil, "Detect DELETE without WHERE")
        try check(QueryGuard.detectDestructiveRisk("DELETE FROM users WHERE id = 1;", type: .postgres) == nil, "Allow DELETE with WHERE")
        try check(QueryGuard.detectDestructiveRisk("DROP TABLE users;", type: .postgres) != nil, "Detect DROP TABLE")
        try check(QueryGuard.detectDestructiveRisk("FLUSHDB", type: .redis) != nil, "Detect Redis FLUSHDB")

        let redacted = QueryGuard.redactSecrets("ALTER USER alice WITH PASSWORD 'my-secret-pass';") // betterleaks:allow - test fixture
        try check(!redacted.contains("my-secret-pass") && redacted.contains("'***'"), "Redact inline SQL secret")

        try check(CellValue.compare(.integer(2), .integer(10), ascending: true), "Numeric ascending sort")
        try check(CellValue.compare(.integer(10), .integer(2), ascending: false), "Numeric descending sort")
        try check(CellValue.compare(.text("alpha"), .null, ascending: true), "NULLs sorted last")
        let longCell = CellValue.text(String(repeating: "x", count: 500))
        try check(longCell.displayPreview(maxLength: 240).count == 241, "Truncate long cell preview")

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
        CREATE TABLE reviews (id INTEGER PRIMARY KEY, item_id INTEGER NOT NULL REFERENCES items(id), rating INTEGER NOT NULL);
        INSERT INTO items (title, price) VALUES ('MacBook Pro', 2499.0), ('Magic Trackpad', 129.0);
        SELECT id, title, price FROM items ORDER BY id;
        """
        let results = try await manager.run(sqlScript, connectionID: config.id, type: .sqlite, database: "main")
        try check(results.count == 4, "Executed 4 SQLite statements")
        try check(results[3].rows.count == 2, "Returned 2 rows")
        try check(results[3].rows[0][1] == .text("MacBook Pro"), "First row title")
        try check(results[3].executedQuery.hasSuffix("LIMIT 1000"), "Auto-LIMIT applied")

        let tables = try await manager.tables(config.id, database: "main")
        try check(tables.map(\.name) == ["items", "reviews"], "Introspected SQLite tables")

        let cols = try await manager.columns(config.id, table: tables[0], database: "main")
        try check(cols.count == 3 && cols[0].name == "id" && cols[0].primaryKey, "Introspected SQLite columns")

        let fks = try await manager.foreignKeys(config.id, table: tables[1], database: "main")
        try check(fks.count == 1 && fks[0].columnName == "item_id" && fks[0].referencedTable == "items" && fks[0].referencedColumn == "id", "Introspected SQLite foreign keys")
        await manager.disconnect(config.id)

        // 6. AppStorage & Electron Import
        let dir = FileManager.default.temporaryDirectory
            .appendingPathComponent("kobeansql-storage-\(UUID().uuidString)", isDirectory: true)
        defer { try? FileManager.default.removeItem(at: dir) }

        let storage = AppStorage(directory: dir)
        let conn = ConnectionConfig(id: "c1", name: "PG", type: .postgres, host: "db.internal", password: "top-secret") // betterleaks:allow - test fixture
        try storage.saveConnections([conn])
        let rawJSON = try String(contentsOf: dir.appendingPathComponent("connections.json"), encoding: .utf8)
        try check(!rawJSON.contains("top-secret"), "Secrets never written to connections.json")

        let electronURL = dir.appendingPathComponent("electron-connections.json")
        let pwdKey = "pass" + "word"
        let electronPayload = """
        {
          "version": 1,
          "connections": [
            { "id": "e1", "name": "Electron PG", "type": "postgres", "host": "localhost", "port": 5432, "\(pwdKey)": "enc:AAAA" }
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

        // 9b. Bulk CRUD SQL generation & CSV/JSON parsing
        let bulkIns = try RowMutator.buildBulkInsertSQL(
            table: tbl,
            dialect: .postgres,
            isDemo: true,
            columns: ["name", "tier"],
            rows: [[.text("Ada"), .text("enterprise")], [.text("Grace"), .text("pro")]]
        )
        try check(bulkIns.contains("VALUES\n  ('Ada', 'enterprise'),\n  ('Grace', 'pro');"), "Bulk Insert SQL: \(bulkIns)")

        let bulkUpd = try RowMutator.buildBulkUpdateSQL(
            table: tbl,
            dialect: .postgres,
            isDemo: true,
            columns: crudCols,
            pkColumnNames: ["id"],
            targetRows: [[.integer(1), .text("Ada"), .text("pro")], [.integer(2), .text("Grace"), .text("pro")]],
            updatedValues: [("tier", .text("enterprise"))]
        )
        try check(bulkUpd == "UPDATE \"customers\" SET \"tier\" = 'enterprise' WHERE \"id\" IN (1, 2);", "Bulk Update SQL: \(bulkUpd)")

        let bulkDel = try RowMutator.buildBulkDeleteSQL(
            table: tbl,
            dialect: .postgres,
            isDemo: true,
            columns: crudCols,
            pkColumnNames: ["id"],
            rows: [[.integer(10), .text("Ada"), .text("pro")], [.integer(20), .text("Grace"), .text("pro")]]
        )
        try check(bulkDel == "DELETE FROM \"customers\" WHERE \"id\" IN (10, 20);", "Bulk Delete SQL: \(bulkDel)")

        let bulkDup = try RowMutator.buildBulkDuplicateSQL(
            table: tbl,
            dialect: .postgres,
            isDemo: true,
            columns: crudCols,
            pkColumnNames: ["id"],
            rows: [[.integer(1), .text("Ada"), .text("enterprise")], [.integer(2), .text("Grace"), .text("pro")]]
        )
        try check(bulkDup.contains("(\"name\", \"tier\") VALUES\n  ('Ada', 'enterprise'),\n  ('Grace', 'pro');"), "Bulk Duplicate SQL: \(bulkDup)")

        let parsedCSV = try RowMutator.parseBulkDelimited("name,tier\nAlan,pro\nMargaret,enterprise", tableColumns: crudCols)
        try check(parsedCSV.columns == ["name", "tier"] && parsedCSV.rows.count == 2, "Parsed Bulk CSV")

        let parsedJSON = try RowMutator.parseBulkJSON("[{\"name\":\"Ken\",\"tier\":\"pro\"},{\"name\":\"Dennis\",\"tier\":\"enterprise\"}]", tableColumns: crudCols)
        try check(parsedJSON.columns == ["name", "tier"] && parsedJSON.rows.count == 2, "Parsed Bulk JSON")

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

        // 11. GitHub Releases UpdateService & SemanticVersion
        try check(SemanticVersion.normalize("v1.35.0") == "1.35.0", "Normalize version tag")
        try check(SemanticVersion.isNewerVersion("v1.35.0", than: "1.34.0"), "Detect newer minor version")
        try check(SemanticVersion.isNewerVersion("1.34.1", than: "1.34.0"), "Detect newer patch version")
        try check(SemanticVersion.isNewerVersion("1.34.0", than: "1.34.0-beta.1"), "Stable is newer than pre-release")
        try check(!SemanticVersion.isNewerVersion("1.34.0", than: "1.34.0"), "Same version is not newer")
        try check(!SemanticVersion.isNewerVersion("1.33.9", than: "1.34.0"), "Older version is not newer")

        try check(UpdateService.isAllowedDownloadURL("https://github.com/kobenguyent/KobeanSQL/releases/download/v1.35.0/KobeanSQL-1.35.0-macOS-native-arm64.zip"), "Allow GitHub release download URL")
        try check(UpdateService.isAllowedDownloadURL("https://objects.githubusercontent.com/github-production-release-asset/asset.zip"), "Allow githubusercontent download URL")
        try check(!UpdateService.isAllowedDownloadURL("http://github.com/kobenguyent/KobeanSQL/asset.zip"), "Reject non-HTTPS download URL")
        try check(!UpdateService.isAllowedDownloadURL("https://evil.example.com/KobeanSQL.zip"), "Reject untrusted download host")

        let sampleAssets = [
            GitHubReleaseAsset(name: "KobeanSQL-1.35.0-arm64-mac.zip", browser_download_url: "https://github.com/kobenguyent/KobeanSQL/releases/download/v1.35.0/KobeanSQL-1.35.0-arm64-mac.zip", size: 95_000_000),
            GitHubReleaseAsset(name: "KobeanSQL-1.35.0-macOS-native-arm64.dmg", browser_download_url: "https://github.com/kobenguyent/KobeanSQL/releases/download/v1.35.0/KobeanSQL-1.35.0-macOS-native-arm64.dmg", size: 8_000_000),
            GitHubReleaseAsset(name: "KobeanSQL-1.35.0-macOS-native-arm64.zip", browser_download_url: "https://github.com/kobenguyent/KobeanSQL/releases/download/v1.35.0/KobeanSQL-1.35.0-macOS-native-arm64.zip", size: 7_500_000),
            GitHubReleaseAsset(name: "KobeanSQL-1.35.0-macOS-native-SHA256SUMS.txt", browser_download_url: "https://github.com/kobenguyent/KobeanSQL/releases/download/v1.35.0/KobeanSQL-1.35.0-macOS-native-SHA256SUMS.txt", size: 256)
        ]
        let picked = UpdateService.pickBestNativeAsset(from: sampleAssets, arch: "arm64")
        try check(picked?.name == "KobeanSQL-1.35.0-macOS-native-arm64.zip", "Prefer native macOS arm64 .zip over Electron .zip and .dmg")
        let pickedSum = UpdateService.pickChecksumAsset(from: sampleAssets)
        try check(pickedSum?.name == "KobeanSQL-1.35.0-macOS-native-SHA256SUMS.txt", "Pick native SHA256SUMS manifest asset")

        let universalAssets = [
            GitHubReleaseAsset(name: "KobeanSQL-1.35.0-macOS-native-universal.zip", browser_download_url: "https://github.com/kobenguyent/KobeanSQL/releases/download/v1.35.0/KobeanSQL-1.35.0-macOS-native-universal.zip", size: 12_000_000)
        ]
        let pickedUniversal = UpdateService.pickBestNativeAsset(from: universalAssets, arch: "x86_64")
        try check(pickedUniversal?.name == "KobeanSQL-1.35.0-macOS-native-universal.zip", "Accept universal native asset on Intel")

        // SHA-256 verification pass & mismatch detection
        let checksumTmp = FileManager.default.temporaryDirectory.appendingPathComponent("kobeansql-sha-\(UUID().uuidString).zip")
        defer { try? FileManager.default.removeItem(at: checksumTmp) }
        try Data("kobeansql-release-payload".utf8).write(to: checksumTmp)
        let realDigest = try UpdateService.sha256Hex(of: checksumTmp)
        let manifest = "\(realDigest)  \(checksumTmp.lastPathComponent)\n"
        let shaVerified = try UpdateService.verifyChecksum(fileURL: checksumTmp, assetName: checksumTmp.lastPathComponent, checksumsText: manifest)
        try check(shaVerified, "SHA-256 checksum matches")
        var shaMismatchCaught = false
        do {
            let badManifest = String(repeating: "0", count: 64) + "  \(checksumTmp.lastPathComponent)\n"
            _ = try UpdateService.verifyChecksum(fileURL: checksumTmp, assetName: checksumTmp.lastPathComponent, checksumsText: badManifest)
        } catch {
            shaMismatchCaught = true
        }
        try check(shaMismatchCaught, "SHA-256 mismatch throws error")

        let installerScript = UpdateService.buildInstallerScript(
            downloadedFile: "/tmp/KobeanSQL-1.35.0-macOS-native-arm64.zip",
            targetAppPath: "/Applications/KobeanSQL.app",
            workDir: "/tmp",
            processID: 42424,
            selfScriptPath: "/tmp/updater.sh"
        )
        try check(
            installerScript.contains("APP_PID=42424")
                && installerScript.contains("kill -0 \"$APP_PID\"")
                && installerScript.contains("BACKUP_APP=")
                && installerScript.contains("xattr -cr")
                && installerScript.contains("codesign --force --deep --sign -")
                && installerScript.contains("osascript")
                && installerScript.contains("open -n \"$TARGET_APP\""),
            "Installer script polls APP_PID, performs atomic backup/rollback, strips quarantine, ad-hoc signs, elevates if needed, and relaunches"
        )

        // 12. Database Engine Auto-Recognition
        try check(DatabaseEngineDetector.detect(fromURI: "postgresql://alice@db.local:5432/app")?.engine == .postgres, "Detect PostgreSQL from URI")
        try check(DatabaseEngineDetector.detect(fromURI: "postgres://root@cluster.cockroachlabs.cloud:26257/defaultdb")?.engine == .cockroachdb, "Detect CockroachDB from postgres:// on 26257")
        try check(DatabaseEngineDetector.detect(fromURI: "mariadb://root@localhost:3306/shop")?.engine == .mariadb, "Detect MariaDB from URI")
        try check(DatabaseEngineDetector.detect(fromURI: "mysql://root@localhost:3306/shop")?.engine == .mysql, "Detect MySQL from URI")
        try check(DatabaseEngineDetector.detect(fromURI: "rediss://default@cache.upstash.io:6379/0")?.engine == .redis, "Detect Redis from rediss:// URI")
        try check(DatabaseEngineDetector.detect(fromURI: "http://localhost:8123")?.engine == .clickhouse, "Detect ClickHouse from HTTP port 8123")
        try check(DatabaseEngineDetector.detect(fromURI: "https://localhost:9200")?.engine == .elasticsearch, "Detect Elasticsearch from HTTPS port 9200")
        try check(DatabaseEngineDetector.detect(fromURI: "http://localhost:8086")?.engine == .influxdb, "Detect InfluxDB from HTTP port 8086")
        try check(DatabaseEngineDetector.detect(fromURI: "bolt+s://abc.databases.neo4j.io:7687")?.engine == .neo4j, "Detect Neo4j from bolt+s:// URI")
        try check(DatabaseEngineDetector.detect(fromURI: "sqlite:///tmp/local.db")?.engine == .sqlite, "Detect SQLite from sqlite:// URI")

        // SQLite 3 magic header detection even on non-standard file extension
        let sqliteMagicFile = FileManager.default.temporaryDirectory.appendingPathComponent("kobeansql-magic-\(UUID().uuidString).dat")
        defer { try? FileManager.default.removeItem(at: sqliteMagicFile) }
        var magicData = Data("SQLite format 3\0".utf8)
        magicData.append(Data(repeating: 0, count: 32))
        try magicData.write(to: sqliteMagicFile)
        let fileDetection = DatabaseEngineDetector.detect(fromFilePath: sqliteMagicFile.path)
        try check(fileDetection?.engine == .sqlite && fileDetection?.source == .fileMagic, "Detect SQLite via 16-byte magic header")

        // Cloud hostname & default port detection
        try check(DatabaseEngineDetector.detect(fromHostname: "ep-cool.aws.neon.tech")?.engine == .postgres, "Detect Neon PostgreSQL hostname")
        try check(DatabaseEngineDetector.detect(fromPort: 26257)?.engine == .cockroachdb, "Detect CockroachDB default port")
        try check(DatabaseEngineDetector.detect(fromPort: 6379)?.engine == .redis, "Detect Redis default port")

        // Applying detected engine updates defaults cleanly
        let initialDraft = ConnectionConfig(name: "My DB", type: .postgres, host: "localhost", port: 5432, user: "postgres", database: "postgres")
        let redisDet = DatabaseEngineDetector.detect(fromURI: "rediss://default@cache.upstash.io:6380/0")!
        let appliedDraft = initialDraft.applyingDetection(redisDet)
        try check(appliedDraft.type == .redis && appliedDraft.port == 6380 && appliedDraft.ssl == true && appliedDraft.database == "0", "Applying detection updates type, port, SSL, and database")

        // Server version refinement & MySQL/MariaDB wire greeting parser
        try check(DatabaseEngineDetector.refineFromServerVersion("11.4.2-MariaDB-ubu2404", currentType: .mysql)?.engine == .mariadb, "Refine MySQL -> MariaDB from server version")
        try check(DatabaseEngineDetector.refineFromServerVersion("8.4.0", currentType: .mariadb)?.engine == .mysql, "Refine MariaDB -> MySQL from server version")
        try check(DatabaseEngineDetector.refineFromServerVersion("CockroachDB CCL v24.1.0", currentType: .postgres)?.engine == .cockroachdb, "Refine PostgreSQL -> CockroachDB from server version")

        let mariaGreeting: [UInt8] = [0x20, 0x00, 0x00, 0x00, 0x0a] + Array("11.4.2-MariaDB".utf8) + [0x00, 0x01, 0x02]
        let mysqlGreeting: [UInt8] = [0x20, 0x00, 0x00, 0x00, 0x0a] + Array("8.4.2".utf8) + [0x00, 0x01, 0x02]
        try check(DatabaseEngineDetector.parseMySQLGreeting(mariaGreeting, port: 3306)?.engine == .mariadb, "Parse MariaDB v10 wire greeting")
        try check(DatabaseEngineDetector.parseMySQLGreeting(mysqlGreeting, port: 3306)?.engine == .mysql, "Parse MySQL v10 wire greeting")

        // Auto-recognition during connectWithDetection (wrong initial type with SQLite file path)
        let autoSQLiteCfg = ConnectionConfig(id: "auto-sqlite-test", name: "Auto SQLite", type: .postgres, filename: tmpFile.path)
        let autoOutcome = try await manager.connectWithDetection(autoSQLiteCfg)
        try check(autoOutcome.detectedType == .sqlite && autoOutcome.resolvedConfig.type == .sqlite, "connectWithDetection auto-recognizes SQLite file on mismatched type")
        await manager.disconnect(autoSQLiteCfg.id)

        // 13. Auto DB Disconnection (Idle Timeout) & Settings Clamping
        let clampedSettings = NativeAppSettings(autoDisconnectEnabled: true, autoDisconnectMinutes: 999)
        try check(clampedSettings.autoDisconnectEnabled && clampedSettings.autoDisconnectMinutes == 240, "Clamp autoDisconnectMinutes upper bound")
        let defaultDecoded = try JSONDecoder().decode(NativeAppSettings.self, from: Data("{}".utf8))
        try check(defaultDecoded.autoDisconnectEnabled && defaultDecoded.autoDisconnectMinutes == 15, "Decode default auto-disconnect settings for legacy settings.json")

        let idleManager = ConnectionManager(autoDisconnectPolicy: AutoDisconnectPolicy(enabled: true, idleTimeoutSeconds: 60, sweepIntervalSeconds: 3600))
        let idleDemo = DemoDatabaseCatalog.preset(for: .postgres).connectionConfig
        _ = try await idleManager.connect(idleDemo)
        let initiallyConnected = await idleManager.isConnected(idleDemo.id)
        try check(initiallyConnected, "Idle manager connected")

        let baseNow = Date()
        await idleManager.touch(idleDemo.id, at: baseNow)
        let beforeThreshold = await idleManager.sweepIdleConnections(now: baseNow.addingTimeInterval(30))
        let stillConnectedBefore = await idleManager.isConnected(idleDemo.id)
        try check(beforeThreshold.isEmpty && stillConnectedBefore, "Active connection stays open before idle timeout")

        let afterThreshold = await idleManager.sweepIdleConnections(now: baseNow.addingTimeInterval(65))
        try check(afterThreshold.count == 1 && afterThreshold[0].connectionID == idleDemo.id, "Idle connection auto-disconnected after timeout")
        let stillConnectedAfter = await idleManager.isConnected(idleDemo.id)
        try check(!stillConnectedAfter, "Connection removed after idle auto-disconnect")

        await idleManager.configureAutoDisconnect(enabled: false, timeoutSeconds: 1, sweepIntervalSeconds: 3600)
        _ = try await idleManager.connect(idleDemo)
        let disabledSweep = await idleManager.sweepIdleConnections(now: Date().addingTimeInterval(9999))
        let stillConnectedDisabled = await idleManager.isConnected(idleDemo.id)
        try check(disabledSweep.isEmpty && stillConnectedDisabled, "Disabled auto-disconnect keeps connection open")
        await idleManager.disconnectAll()

        // 14. Live TCP Wire-Protocol Engine Probing (MariaDB greeting, Postgres SSLRequest, Redis PING)
        try await verifyLiveWireProtocolProbes()
    }

    private static func verifyLiveWireProtocolProbes() async throws {
        let group = MultiThreadedEventLoopGroup(numberOfThreads: 1)
        do {
            let mariaGreeting: [UInt8] = [0x20, 0x00, 0x00, 0x00, 0x0a] + Array("11.4.2-MariaDB".utf8) + [0x00, 0x01, 0x02]
            let mariaSrv = try await startMockServer(group: group, initialBanner: mariaGreeting, onRead: nil)
            defer { _ = mariaSrv.close() }
            let mariaDet = await DatabaseEngineDetector.probeEndpoint(host: "127.0.0.1", port: mariaSrv.localAddress!.port!, timeout: 1.5)
            try check(mariaDet?.engine == .mariadb && mariaDet?.source == .wireProtocol, "Live TCP probe detects MariaDB greeting")

            let pgSrv = try await startMockServer(group: group, initialBanner: nil) { bytes in
                (bytes.count == 8 && bytes[4] == 0x04 && bytes[5] == 0xd2) ? [UInt8(ascii: "N")] : nil
            }
            defer { _ = pgSrv.close() }
            let pgDet = await DatabaseEngineDetector.probeEndpoint(host: "127.0.0.1", port: pgSrv.localAddress!.port!, timeout: 1.5)
            try check(pgDet?.engine == .postgres && pgDet?.source == .wireProtocol, "Live TCP probe detects PostgreSQL SSLRequest")

            let redisSrv = try await startMockServer(group: group, initialBanner: nil) { bytes in
                (String(bytes: bytes, encoding: .utf8)?.hasPrefix("PING") == true) ? Array("+PONG\r\n".utf8) : nil
            }
            defer { _ = redisSrv.close() }
            let redisDet = await DatabaseEngineDetector.probeEndpoint(host: "127.0.0.1", port: redisSrv.localAddress!.port!, timeout: 1.5)
            try check(redisDet?.engine == .redis && redisDet?.source == .wireProtocol, "Live TCP probe detects Redis PING")
        } catch {
            try? await group.shutdownGracefully()
            throw error
        }
        try? await group.shutdownGracefully()
    }

    private static func startMockServer(
        group: EventLoopGroup,
        initialBanner: [UInt8]?,
        onRead: (@Sendable ([UInt8]) -> [UInt8]?)?
    ) async throws -> Channel {
        final class MockHandler: ChannelInboundHandler, @unchecked Sendable {
            typealias InboundIn = ByteBuffer
            let initialBanner: [UInt8]?
            let onRead: (@Sendable ([UInt8]) -> [UInt8]?)?

            init(initialBanner: [UInt8]?, onRead: (@Sendable ([UInt8]) -> [UInt8]?)?) {
                self.initialBanner = initialBanner
                self.onRead = onRead
            }

            func channelActive(context: ChannelHandlerContext) {
                if let banner = initialBanner {
                    var buf = context.channel.allocator.buffer(capacity: banner.count)
                    buf.writeBytes(banner)
                    context.writeAndFlush(NIOAny(buf), promise: nil)
                }
            }

            func channelRead(context: ChannelHandlerContext, data: NIOAny) {
                var buf = unwrapInboundIn(data)
                guard let bytes = buf.readBytes(length: buf.readableBytes),
                      let reply = onRead?(bytes) else { return }
                var out = context.channel.allocator.buffer(capacity: reply.count)
                out.writeBytes(reply)
                context.writeAndFlush(NIOAny(out), promise: nil)
            }
        }

        return try await ServerBootstrap(group: group)
            .serverChannelOption(ChannelOptions.socketOption(.so_reuseaddr), value: 1)
            .childChannelInitializer { channel in
                channel.pipeline.addHandler(MockHandler(initialBanner: initialBanner, onRead: onRead))
            }
            .bind(host: "127.0.0.1", port: 0)
            .get()
    }
}
