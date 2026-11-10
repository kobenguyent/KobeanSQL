import AppKit
import Foundation
import Observation
import SQLite3
import SwiftUI
import KobeanSQLCore

struct QueryTab: Identifiable, Hashable {
    var id: UUID = UUID()
    var title: String
    var connectionID: String?
    var database: String?
    var activeTable: TableInfo?
    var sql: String
    var isRunning: Bool = false
    var results: [QueryResult] = []
    var activeResultIndex: Int = 0
    var errorMessage: String?

    var activeResult: QueryResult? {
        guard results.indices.contains(activeResultIndex) else { return results.first }
        return results[activeResultIndex]
    }
}

enum StatusLevel {
    case info, success, warning, error
}

@Observable
@MainActor
final class AppState {
    let storage = AppStorage()
    let manager = ConnectionManager()

    var connections: [ConnectionConfig] = []
    var connectedIDs: Set<String> = []
    var connectingIDs: Set<String> = []
    var serverVersions: [String: String] = [:]

    /// Cached schema metadata keyed by connectionID and `"connID::database"`.
    /// Per GEMINI.md CPU/Polling Guard: cached on first load, never re-polled on tab switch.
    var databasesByConnection: [String: [String]] = [:]
    var selectedDatabaseByConnection: [String: String] = [:]
    var tablesByScope: [String: [TableInfo]] = [:]
    var columnsByTableKey: [String: [ColumnInfo]] = [:]

    var tabs: [QueryTab] = []
    var activeTabID: UUID = UUID()

    var history: [HistoryEntry] = []
    var savedQueries: [SavedQuery] = []
    var settings: NativeAppSettings = NativeAppSettings()

    var statusMessage: String = "Ready"
    var statusLevel: StatusLevel = .info

    // Sheet state
    var showingConnectionSheet = false
    var editingConnection: ConnectionConfig?
    var showingHistorySheet = false
    var showingSettingsSheet = false

    init() {
        reloadFromDisk()
        if tabs.isEmpty {
            let firstConn = connections.first
            let preset = firstConn.map { DemoDatabaseCatalog.preset(for: $0.type) }
            let initial = QueryTab(
                title: firstConn.map { "\($0.type.displayName) Demo" } ?? "Query 1",
                connectionID: firstConn?.id,
                database: firstConn?.database ?? preset?.defaultDatabase,
                activeTable: preset.map { TableInfo(name: $0.defaultTable, kind: .table, schema: $0.defaultDatabase) },
                sql: preset?.sampleQuery ?? "-- Welcome to KobeanSQL Native for macOS\n-- Press ⌘↩ to run queries, or click a table in the sidebar.\nSELECT 1 AS kobeansql_ready;\n"
            )
            tabs = [initial]
            activeTabID = initial.id
        }
        if CommandLine.arguments.contains("--verify-demo") {
            Task { @MainActor in
                await self.loadAllDemoDatabases()
                let rows = self.activeTab?.activeResult?.rows.count ?? 0
                print("VERIFY_DEMO_OK connections=\(self.connections.count) rows=\(rows)")
                Foundation.exit(self.connections.count >= 8 && rows >= 5 ? 0 : 1)
            }
        } else {
            let autoConnect = connections.filter { $0.type == .sqlite || DemoDatabaseCatalog.isDemo($0) }
            if !autoConnect.isEmpty {
                Task { @MainActor in
                    for c in autoConnect {
                        await self.connect(c)
                    }
                    await self.runActiveQuery()
                }
            }
        }
    }

    private func requiresKeychain(_ config: ConnectionConfig) -> Bool {
        config.type != .sqlite && !DemoDatabaseCatalog.isDemo(config)
    }

    var activeTabIndex: Int? {
        tabs.firstIndex { $0.id == activeTabID }
    }

    var activeTab: QueryTab? {
        get { activeTabIndex.map { tabs[$0] } }
        set {
            if let idx = activeTabIndex, let newValue {
                tabs[idx] = newValue
            }
        }
    }

    var activeConnection: ConnectionConfig? {
        guard let connID = activeTab?.connectionID else { return connections.first }
        return connections.first { $0.id == connID }
    }

    func reloadFromDisk() {
        connections = storage.loadConnections().map { conn in
            var c = conn
            if requiresKeychain(conn) {
                c.password = KeychainStore.password(for: conn.id)
            }
            return c
        }
        history = storage.loadHistory()
        savedQueries = storage.loadSavedQueries()
        settings = storage.loadSettings()
    }

    func setStatus(_ message: String, level: StatusLevel = .info) {
        statusMessage = message
        statusLevel = level
    }

    // MARK: - Connections

    func saveConnection(_ config: ConnectionConfig) {
        if requiresKeychain(config) {
            KeychainStore.setPassword(config.password, for: config.id)
        }
        if let idx = connections.firstIndex(where: { $0.id == config.id }) {
            connections[idx] = config
        } else {
            connections.append(config)
        }
        try? storage.saveConnections(connections)
        if activeTab?.connectionID == nil {
            activeTab?.connectionID = config.id
            activeTab?.database = config.database
        }
        setStatus("Saved connection \"\(config.name)\"", level: .success)
    }

    func deleteConnection(_ id: String) {
        Task {
            await disconnect(id)
            connections.removeAll { $0.id == id }
            KeychainStore.setPassword(nil, for: id)
            try? storage.saveConnections(connections)
            setStatus("Deleted connection", level: .info)
        }
    }

    func connect(_ config: ConnectionConfig) async {
        guard !connectingIDs.contains(config.id) else { return }
        connectingIDs.insert(config.id)
        setStatus("Connecting to \(config.name)…", level: .info)
        defer { connectingIDs.remove(config.id) }

        var hydrated = config
        if requiresKeychain(hydrated) && (hydrated.password == nil || hydrated.password?.isEmpty == true) {
            hydrated.password = KeychainStore.password(for: config.id)
        }

        do {
            let version = try await manager.connect(hydrated)
            connectedIDs.insert(config.id)
            serverVersions[config.id] = version
            let dbs = (try? await manager.databases(config.id)) ?? []
            databasesByConnection[config.id] = dbs
            let defaultDB = hydrated.database?.isEmpty == false ? hydrated.database : dbs.first
            if let defaultDB {
                selectedDatabaseByConnection[config.id] = defaultDB
            }
            await loadTables(connectionID: config.id, database: selectedDatabaseByConnection[config.id], force: true)
            if activeTab?.connectionID == nil || activeTab?.connectionID == config.id {
                activeTab?.connectionID = config.id
                activeTab?.database = selectedDatabaseByConnection[config.id]
            }
            setStatus("Connected to \(config.name) (\(version))", level: .success)
        } catch {
            connectedIDs.remove(config.id)
            setStatus("Connection failed: \(error.localizedDescription)", level: .error)
        }
    }

    func disconnect(_ id: String) async {
        await manager.disconnect(id)
        connectedIDs.remove(id)
        serverVersions.removeValue(forKey: id)
        setStatus("Disconnected", level: .info)
    }

    func selectDatabase(_ db: String, for connectionID: String) async {
        selectedDatabaseByConnection[connectionID] = db
        if activeTab?.connectionID == connectionID {
            activeTab?.database = db
        }
        await loadTables(connectionID: connectionID, database: db, force: false)
    }

    func scopeKey(connectionID: String, database: String?) -> String {
        "\(connectionID)::\(database ?? "")"
    }

    func tables(for connectionID: String) -> [TableInfo] {
        let db = selectedDatabaseByConnection[connectionID]
        return tablesByScope[scopeKey(connectionID: connectionID, database: db)] ?? []
    }

    func loadTables(connectionID: String, database: String?, force: Bool) async {
        let key = scopeKey(connectionID: connectionID, database: database)
        if !force, tablesByScope[key] != nil { return }
        do {
            let list = try await manager.tables(connectionID, database: database)
            tablesByScope[key] = list
        } catch {
            setStatus("Failed to load schema: \(error.localizedDescription)", level: .warning)
        }
    }

    func columns(for table: TableInfo, connectionID: String) -> [ColumnInfo] {
        let db = selectedDatabaseByConnection[connectionID] ?? ""
        return columnsByTableKey["\(connectionID)::\(db)::\(table.id)"] ?? []
    }

    func loadColumns(for table: TableInfo, connectionID: String) async {
        let db = selectedDatabaseByConnection[connectionID]
        let key = "\(connectionID)::\(db ?? "")::\(table.id)"
        if columnsByTableKey[key] != nil { return }
        if let cols = try? await manager.columns(connectionID, table: table, database: db) {
            columnsByTableKey[key] = cols
        }
    }

    // MARK: - Tabs & Query Execution

    func newTab(title: String? = nil, connectionID: String? = nil, database: String? = nil, sql: String = "") {
        let connID = connectionID ?? activeTab?.connectionID ?? connections.first?.id
        let db = database ?? (connID.flatMap { selectedDatabaseByConnection[$0] }) ?? activeTab?.database
        let tab = QueryTab(
            title: title ?? "Query \(tabs.count + 1)",
            connectionID: connID,
            database: db,
            sql: sql
        )
        tabs.append(tab)
        activeTabID = tab.id
    }

    func closeTab(_ id: UUID) {
        guard tabs.count > 1, let idx = tabs.firstIndex(where: { $0.id == id }) else { return }
        tabs.remove(at: idx)
        if activeTabID == id {
            activeTabID = tabs[max(0, idx - 1)].id
        }
    }

    func previewTable(_ table: TableInfo, connectionID: String, inNewTab: Bool = false) async {
        let db = selectedDatabaseByConnection[connectionID]
        await loadColumns(for: table, connectionID: connectionID)
        let sql = (try? await manager.previewQuery(connectionID, table: table, database: db, limit: settings.queryLimit))
            ?? "SELECT * FROM \"\(table.name)\" LIMIT \(settings.queryLimit);"
        if inNewTab || activeTab == nil {
            newTab(title: table.name, connectionID: connectionID, database: db, sql: sql)
            activeTab?.activeTable = table
        } else {
            activeTab?.connectionID = connectionID
            activeTab?.database = db
            activeTab?.activeTable = table
            activeTab?.title = table.name
            activeTab?.sql = sql
        }
        await runActiveQuery()
    }

    /// Resolves the target table for CRUD operations on the active tab.
    var activeTargetTable: TableInfo? {
        guard let tab = activeTab, let connID = tab.connectionID ?? connections.first?.id else { return nil }
        let knownTables = tables(for: connID)
        if let explicit = tab.activeTable {
            return explicit
        }
        // Infer from simple SELECT ... FROM <table> queries without JOIN/GROUP BY
        let sql = tab.sql
        if sql.range(of: #"\b(JOIN|GROUP\s+BY|UNION)\b"#, options: [.regularExpression, .caseInsensitive]) == nil,
           let matchRange = sql.range(of: #"(?:FROM|GET\s+/)\s*[`"']?([A-Za-z0-9_.\-:]+)[`"']?"#, options: [.regularExpression, .caseInsensitive]) {
            let fragment = String(sql[matchRange])
            let cleaned = fragment
                .replacingOccurrences(of: #"^(FROM|GET\s+/)\s*"#, with: "", options: [.regularExpression, .caseInsensitive])
                .replacingOccurrences(of: #"/.*$"#, with: "", options: .regularExpression)
                .trimmingCharacters(in: CharacterSet(charactersIn: "`\"' \t\n;"))
            let tableName = cleaned.split(separator: ".").last.map(String.init) ?? cleaned
            if let found = knownTables.first(where: { $0.name.caseInsensitiveCompare(tableName) == .orderedSame }) {
                return found
            }
            if !tableName.isEmpty {
                return TableInfo(name: tableName)
            }
        }
        return knownTables.first
    }

    // MARK: - Row & Table CRUD Operations

    private func primaryKeyNames(for table: TableInfo, connectionID: String) async -> Set<String> {
        await loadColumns(for: table, connectionID: connectionID)
        let cols = columns(for: table, connectionID: connectionID)
        return Set(cols.filter(\.primaryKey).map(\.name))
    }

    func insertRow(into table: TableInfo, values: [(column: String, value: CellValue)]) async throws {
        guard let conn = activeConnection else { throw DatabaseError("No active connection") }
        let db = activeTab?.database ?? selectedDatabaseByConnection[conn.id]
        let isDemo = DemoDatabaseCatalog.isDemo(conn)

        let statement: String
        switch conn.type {
        case .redis:
            let dict = Dictionary(uniqueKeysWithValues: values.map { ($0.column, $0.value.description) })
            let field = dict["field"] ?? dict["member"] ?? dict["element"] ?? "key"
            let val = dict["value"] ?? dict["score"] ?? dict["element"] ?? ""
            statement = "HSET \(RedisCommandParser.quote(table.name)) \(RedisCommandParser.quote(field)) \(RedisCommandParser.quote(val))"
        case .elasticsearch:
            var obj: [String: Any] = [:]
            for (k, v) in values where k != "_index" { obj[k] = v.jsonValue }
            let docID = (obj["_id"] as? String) ?? "doc-\(Int.random(in: 1000...9999))"
            let data = try JSONSerialization.data(withJSONObject: obj, options: [.sortedKeys])
            statement = "POST /\(table.name)/_doc/\(docID)\n\(String(decoding: data, as: UTF8.self))"
        default:
            statement = try RowMutator.buildInsertSQL(table: table, dialect: conn.type, isDemo: isDemo, values: values)
        }

        _ = try await manager.run(statement, connectionID: conn.id, type: conn.type, database: db, autoLimit: false)
        setStatus("Inserted row into \(table.name)", level: .success)
        await runActiveQuery()
    }

    func updateRow(in table: TableInfo, columns: [ColumnDef], originalRow: [CellValue], updatedValues: [(column: String, value: CellValue)]) async throws {
        guard let conn = activeConnection else { throw DatabaseError("No active connection") }
        let db = activeTab?.database ?? selectedDatabaseByConnection[conn.id]
        let isDemo = DemoDatabaseCatalog.isDemo(conn)
        let pks = await primaryKeyNames(for: table, connectionID: conn.id)

        let statement: String
        switch conn.type {
        case .redis:
            let field = originalRow.first?.description ?? "field"
            let newVal = updatedValues.first?.value.description ?? ""
            statement = "HSET \(RedisCommandParser.quote(table.name)) \(RedisCommandParser.quote(field)) \(RedisCommandParser.quote(newVal))"
        case .elasticsearch:
            var obj: [String: Any] = [:]
            for (i, col) in columns.enumerated() where i < originalRow.count && col.name != "_index" {
                obj[col.name] = originalRow[i].jsonValue
            }
            for (col, val) in updatedValues { obj[col] = val.jsonValue }
            let docID = "\(obj["_id"] ?? "doc-1")"
            let data = try JSONSerialization.data(withJSONObject: obj, options: [.sortedKeys])
            statement = "PUT /\(table.name)/_doc/\(docID)\n\(String(decoding: data, as: UTF8.self))"
        default:
            statement = try RowMutator.buildUpdateSQL(
                table: table,
                dialect: conn.type,
                isDemo: isDemo,
                columns: columns,
                pkColumnNames: pks,
                originalRow: originalRow,
                updatedValues: updatedValues
            )
        }

        _ = try await manager.run(statement, connectionID: conn.id, type: conn.type, database: db, autoLimit: false)
        setStatus("Updated row in \(table.name)", level: .success)
        await runActiveQuery()
    }

    func duplicateRow(in table: TableInfo, columns: [ColumnDef], row: [CellValue]) async throws {
        guard let conn = activeConnection else { throw DatabaseError("No active connection") }
        let db = activeTab?.database ?? selectedDatabaseByConnection[conn.id]
        let isDemo = DemoDatabaseCatalog.isDemo(conn)
        let pks = await primaryKeyNames(for: table, connectionID: conn.id)

        let statement: String
        switch conn.type {
        case .elasticsearch:
            var obj: [String: Any] = [:]
            for (i, col) in columns.enumerated() where i < row.count && col.name != "_index" && col.name != "_id" {
                obj[col.name] = row[i].jsonValue
            }
            let newID = "doc-\(Int.random(in: 1000...9999))"
            obj["_id"] = newID
            let data = try JSONSerialization.data(withJSONObject: obj, options: [.sortedKeys])
            statement = "POST /\(table.name)/_doc/\(newID)\n\(String(decoding: data, as: UTF8.self))"
        default:
            statement = try RowMutator.buildDuplicateSQL(
                table: table,
                dialect: conn.type,
                isDemo: isDemo,
                columns: columns,
                pkColumnNames: pks,
                row: row
            )
        }

        _ = try await manager.run(statement, connectionID: conn.id, type: conn.type, database: db, autoLimit: false)
        setStatus("Duplicated row in \(table.name)", level: .success)
        await runActiveQuery()
    }

    func deleteRows(from table: TableInfo, columns: [ColumnDef], rows: [[CellValue]]) async throws {
        guard let conn = activeConnection else { throw DatabaseError("No active connection") }
        let db = activeTab?.database ?? selectedDatabaseByConnection[conn.id]
        let isDemo = DemoDatabaseCatalog.isDemo(conn)
        let pks = await primaryKeyNames(for: table, connectionID: conn.id)

        for row in rows {
            let statement: String
            switch conn.type {
            case .redis:
                let field = row.first?.description ?? ""
                statement = "HDEL \(RedisCommandParser.quote(table.name)) \(RedisCommandParser.quote(field))"
            case .elasticsearch:
                let idIdx = columns.firstIndex { $0.name == "_id" } ?? 0
                let docID = idIdx < row.count ? row[idIdx].description : ""
                statement = "DELETE /\(table.name)/_doc/\(docID)"
            default:
                statement = try RowMutator.buildDeleteSQL(
                    table: table,
                    dialect: conn.type,
                    isDemo: isDemo,
                    columns: columns,
                    pkColumnNames: pks,
                    row: row
                )
            }
            _ = try await manager.run(statement, connectionID: conn.id, type: conn.type, database: db, autoLimit: false)
        }

        setStatus("Deleted \(rows.count) row(s) from \(table.name)", level: .success)
        await runActiveQuery()
    }

    func createTable(name: String, columnSpecs: [(name: String, type: String, primaryKey: Bool, notNull: Bool, defaultValue: String)]) async throws {
        guard let conn = activeConnection else { throw DatabaseError("No active connection") }
        let trimmedName = name.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !trimmedName.isEmpty else { throw DatabaseError("Table name is required") }
        let validCols = columnSpecs.filter { !$0.name.trimmingCharacters(in: .whitespaces).isEmpty }
        guard !validCols.isEmpty else { throw DatabaseError("At least one column is required") }

        let colDefs = validCols.map { spec -> String in
            var parts = [
                RowMutator.quoteIdentifier(spec.name.trimmingCharacters(in: .whitespaces), dialect: conn.type),
                spec.type.isEmpty ? "TEXT" : spec.type
            ]
            if spec.primaryKey { parts.append("PRIMARY KEY") }
            if spec.notNull && !spec.primaryKey { parts.append("NOT NULL") }
            let def = spec.defaultValue.trimmingCharacters(in: .whitespaces)
            if !def.isEmpty { parts.append("DEFAULT \(def)") }
            return parts.joined(separator: " ")
        }.joined(separator: ",\n    ")

        let tableIdent = RowMutator.quoteIdentifier(trimmedName, dialect: conn.type)
        let ddl = "CREATE TABLE \(tableIdent) (\n    \(colDefs)\n);"
        let db = activeTab?.database ?? selectedDatabaseByConnection[conn.id]
        _ = try await manager.run(ddl, connectionID: conn.id, type: conn.type, database: db, autoLimit: false)
        await loadTables(connectionID: conn.id, database: db, force: true)
        let newTable = TableInfo(name: trimmedName, kind: .table, schema: db)
        await previewTable(newTable, connectionID: conn.id, inNewTab: false)
        setStatus("Created table \"\(trimmedName)\"", level: .success)
    }

    func copyTable(source: TableInfo, targetName: String, mode: CopyTableMode) async throws {
        guard let conn = activeConnection else { throw DatabaseError("No active connection") }
        let isDemo = DemoDatabaseCatalog.isDemo(conn)
        let statements = try RowMutator.buildCopyTableSQL(
            source: source,
            targetName: targetName,
            mode: mode,
            dialect: conn.type,
            isDemo: isDemo
        )
        let db = activeTab?.database ?? selectedDatabaseByConnection[conn.id]
        for stmt in statements {
            _ = try await manager.run(stmt, connectionID: conn.id, type: conn.type, database: db, autoLimit: false)
        }
        await loadTables(connectionID: conn.id, database: db, force: true)
        setStatus("Copied table \"\(source.name)\" to \"\(targetName)\"", level: .success)
    }

    func truncateTable(_ table: TableInfo, connectionID: String) async {
        guard let conn = connections.first(where: { $0.id == connectionID }) else { return }
        let db = selectedDatabaseByConnection[connectionID]
        let isDemo = DemoDatabaseCatalog.isDemo(conn)
        let qualified = RowMutator.qualifyTable(table, dialect: conn.type, isDemo: isDemo)
        let sql = (conn.type == .sqlite || isDemo) ? "DELETE FROM \(qualified);" : "TRUNCATE TABLE \(qualified);"
        do {
            _ = try await manager.run(sql, connectionID: connectionID, type: conn.type, database: db, autoLimit: false)
            setStatus("Truncated \(table.name)", level: .success)
            if activeTargetTable?.name == table.name {
                await runActiveQuery()
            }
        } catch {
            setStatus("Truncate failed: \(error.localizedDescription)", level: .error)
        }
    }

    func dropTable(_ table: TableInfo, connectionID: String) async {
        guard let conn = connections.first(where: { $0.id == connectionID }) else { return }
        let db = selectedDatabaseByConnection[connectionID]
        let isDemo = DemoDatabaseCatalog.isDemo(conn)
        let qualified = RowMutator.qualifyTable(table, dialect: conn.type, isDemo: isDemo)
        let kindKeyword = table.kind == .view ? "VIEW" : "TABLE"
        let sql: String
        switch conn.type {
        case .redis:
            sql = "DEL \(RedisCommandParser.quote(table.name))"
        case .elasticsearch:
            sql = "DELETE /\(table.name)"
        default:
            sql = "DROP \(kindKeyword) \(qualified);"
        }
        do {
            _ = try await manager.run(sql, connectionID: connectionID, type: conn.type, database: db, autoLimit: false)
            await loadTables(connectionID: connectionID, database: db, force: true)
            setStatus("Dropped \(kindKeyword.lowercased()) \"\(table.name)\"", level: .success)
        } catch {
            setStatus("Drop failed: \(error.localizedDescription)", level: .error)
        }
    }

    func runActiveQuery() async {
        guard let idx = activeTabIndex else { return }
        let tab = tabs[idx]
        let sql = tab.sql.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !sql.isEmpty else {
            setStatus("Enter a query to run", level: .warning)
            return
        }
        guard let connID = tab.connectionID ?? connections.first?.id,
              let conn = connections.first(where: { $0.id == connID }) else {
            setStatus("Select or create a database connection first", level: .warning)
            return
        }

        if !connectedIDs.contains(connID) {
            await connect(conn)
            guard connectedIDs.contains(connID) else { return }
        }

        tabs[idx].isRunning = true
        tabs[idx].errorMessage = nil
        let db = tab.database ?? selectedDatabaseByConnection[connID]
        let start = Date()
        setStatus("Running query on \(conn.name)…", level: .info)

        do {
            let results = try await manager.run(
                sql,
                connectionID: connID,
                type: conn.type,
                database: db,
                autoLimit: settings.autoLimitEnabled
            )
            let duration = Date().timeIntervalSince(start)
            if let currentIdx = tabs.firstIndex(where: { $0.id == tab.id }) {
                tabs[currentIdx].isRunning = false
                tabs[currentIdx].results = results
                tabs[currentIdx].activeResultIndex = max(0, results.count - 1)
                tabs[currentIdx].errorMessage = nil
            }
            let totalRows = results.reduce(0) { $0 + $1.rowCount }
            recordHistory(conn: conn, database: db, sql: sql, duration: duration, rows: totalRows, error: nil)
            setStatus(String(format: "Returned %d rows in %.0f ms", totalRows, duration * 1000), level: .success)
        } catch let failure as StatementFailure {
            let duration = Date().timeIntervalSince(start)
            if let currentIdx = tabs.firstIndex(where: { $0.id == tab.id }) {
                tabs[currentIdx].isRunning = false
                tabs[currentIdx].results = failure.previous
                tabs[currentIdx].errorMessage = failure.errorDescription
            }
            recordHistory(conn: conn, database: db, sql: sql, duration: duration, rows: 0, error: failure.errorDescription)
            setStatus(failure.errorDescription ?? "Query failed", level: .error)
        } catch {
            let duration = Date().timeIntervalSince(start)
            if let currentIdx = tabs.firstIndex(where: { $0.id == tab.id }) {
                tabs[currentIdx].isRunning = false
                tabs[currentIdx].errorMessage = error.localizedDescription
            }
            recordHistory(conn: conn, database: db, sql: sql, duration: duration, rows: 0, error: error.localizedDescription)
            setStatus(error.localizedDescription, level: .error)
        }
    }

    private func recordHistory(conn: ConnectionConfig, database: String?, sql: String, duration: TimeInterval, rows: Int, error: String?) {
        let entry = HistoryEntry(
            connectionID: conn.id,
            connectionName: conn.name,
            database: database,
            query: sql,
            duration: duration,
            rowCount: rows,
            error: error
        )
        history.insert(entry, at: 0)
        if history.count > HistoryEntry.maxEntries {
            history = Array(history.prefix(HistoryEntry.maxEntries))
        }
        try? storage.saveHistory(history)
    }

    func clearHistory() {
        history.removeAll()
        try? storage.saveHistory([])
        setStatus("Cleared query history", level: .info)
    }

    // MARK: - Saved Queries

    func saveQuery(name: String, sql: String, category: String? = nil) {
        let trimmed = name.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !trimmed.isEmpty else { return }
        savedQueries.insert(SavedQuery(name: trimmed, sql: sql, category: category), at: 0)
        try? storage.saveSavedQueries(savedQueries)
        setStatus("Saved query \"\(trimmed)\"", level: .success)
    }

    func deleteSavedQuery(_ id: String) {
        savedQueries.removeAll { $0.id == id }
        try? storage.saveSavedQueries(savedQueries)
    }

    func updateSettings(_ newSettings: NativeAppSettings) {
        settings = newSettings
        try? storage.saveSettings(newSettings)
        setStatus("Settings saved", level: .success)
    }

    // MARK: - Local AI Schema Context

    func currentSchemaContext() -> String {
        guard let connID = activeTab?.connectionID else { return "" }
        let tableList = tables(for: connID)
        return tableList.prefix(30).map { t in
            let cols = columns(for: t, connectionID: connID).map { "\($0.name) \($0.type)" }.joined(separator: ", ")
            return cols.isEmpty ? t.name : "\(t.name)(\(cols))"
        }.joined(separator: "\n")
    }

    // MARK: - Import & Demo Database

    func importElectronConnections() {
        do {
            let imported = try AppStorage.importElectronConnections()
            guard !imported.isEmpty else {
                setStatus("No saved connections found in the Electron app.", level: .warning)
                return
            }
            var added = 0
            for item in imported where !connections.contains(where: { $0.id == item.id }) {
                connections.append(item)
                added += 1
            }
            try? storage.saveConnections(connections)
            setStatus("Imported \(added) connection(s) from Electron KobeanSQL", level: .success)
        } catch {
            setStatus("Could not import Electron connections: \(error.localizedDescription)", level: .warning)
        }
    }

    /// Creates and connects to a ready-to-query sample database for the chosen engine
    /// (or all 8 demo engines across Relational, Key-Value, Document, Graph, Time-Series, and Warehouse).
    func openOrCreateDemoDatabase(type: DatabaseType = .sqlite) async {
        if type == .sqlite {
            await openOrCreateSQLiteDemo()
            return
        }
        let preset = DemoDatabaseCatalog.preset(for: type)
        let config = preset.connectionConfig
        saveConnection(config)
        await connect(config)

        let table = TableInfo(name: preset.defaultTable, kind: .table, schema: preset.defaultDatabase)
        await loadColumns(for: table, connectionID: config.id)

        if let idx = activeTabIndex {
            tabs[idx].connectionID = config.id
            tabs[idx].database = preset.defaultDatabase
            tabs[idx].activeTable = table
            tabs[idx].title = preset.type.displayName + " Demo"
            tabs[idx].sql = preset.sampleQuery
        } else {
            newTab(title: preset.type.displayName + " Demo", connectionID: config.id, database: preset.defaultDatabase, sql: preset.sampleQuery)
            activeTab?.activeTable = table
        }
        await runActiveQuery()
    }

    func loadAllDemoDatabases() async {
        await openOrCreateSQLiteDemo()
        for preset in DemoDatabaseCatalog.presets where preset.type != .sqlite {
            let config = preset.connectionConfig
            saveConnection(config)
            await connect(config)
        }
        setStatus("Loaded all \(DemoDatabaseCatalog.presets.count) built-in demo databases!", level: .success)
    }

    private func openOrCreateSQLiteDemo() async {
        let dir = storage.directory
        try? FileManager.default.createDirectory(at: dir, withIntermediateDirectories: true)
        let dbURL = dir.appendingPathComponent("kobeansql-demo.sqlite")
        let isNew = !FileManager.default.fileExists(atPath: dbURL.path)

        var handle: OpaquePointer?
        if sqlite3_open(dbURL.path, &handle) == SQLITE_OK, let handle {
            if isNew {
                let seedSQL = """
                CREATE TABLE customers (
                    id INTEGER PRIMARY KEY AUTOINCREMENT,
                    name TEXT NOT NULL,
                    email TEXT UNIQUE NOT NULL,
                    tier TEXT DEFAULT 'pro',
                    created_at TEXT DEFAULT CURRENT_TIMESTAMP
                );
                CREATE TABLE orders (
                    id INTEGER PRIMARY KEY AUTOINCREMENT,
                    customer_id INTEGER NOT NULL REFERENCES customers(id),
                    product TEXT NOT NULL,
                    amount_usd REAL NOT NULL,
                    status TEXT NOT NULL,
                    ordered_at TEXT DEFAULT CURRENT_TIMESTAMP
                );
                CREATE VIEW customer_spend_summary AS
                SELECT c.id, c.name, c.tier, COUNT(o.id) AS order_count, ROUND(COALESCE(SUM(o.amount_usd), 0), 2) AS total_usd
                FROM customers c LEFT JOIN orders o ON o.customer_id = c.id
                GROUP BY c.id, c.name, c.tier;
                INSERT INTO customers (name, email, tier) VALUES
                    ('Ada Lovelace', 'ada@analytical.engine', 'enterprise'),
                    ('Grace Hopper', 'grace@compiler.navy', 'enterprise'),
                    ('Alan Turing', 'alan@bletchley.uk', 'pro'),
                    ('Margaret Hamilton', 'margaret@apollo.nasa', 'enterprise'),
                    ('Ken Thompson', 'ken@bell-labs.org', 'pro');
                INSERT INTO orders (customer_id, product, amount_usd, status) VALUES
                    (1, 'KobeanSQL Native Enterprise', 299.00, 'paid'),
                    (1, 'Vector Analytics Add-on', 149.50, 'paid'),
                    (2, 'KobeanSQL Pro License', 99.00, 'paid'),
                    (3, 'Cloud Warehouse Connector', 199.00, 'pending'),
                    (4, 'Mission Control Cluster Pack', 499.00, 'paid'),
                    (5, 'UNIX Socket Debugger', 79.00, 'paid');
                """
                sqlite3_exec(handle, seedSQL, nil, nil, nil)
            }
            sqlite3_close(handle)
        }

        let preset = DemoDatabaseCatalog.preset(for: .sqlite)
        let demoConfig: ConnectionConfig
        if let existing = connections.first(where: { $0.filename == dbURL.path || $0.id == preset.id }) {
            var updated = existing
            updated.filename = dbURL.path
            saveConnection(updated)
            demoConfig = updated
        } else {
            let c = ConnectionConfig(
                id: preset.id,
                name: preset.name,
                type: .sqlite,
                filename: dbURL.path,
                color: preset.badgeColor,
                category: "Demo"
            )
            saveConnection(c)
            demoConfig = c
        }

        await connect(demoConfig)
        let defaultTable = TableInfo(name: preset.defaultTable, kind: .table, schema: "main")
        await loadColumns(for: defaultTable, connectionID: demoConfig.id)
        if let idx = activeTabIndex {
            tabs[idx].connectionID = demoConfig.id
            tabs[idx].database = "main"
            tabs[idx].activeTable = defaultTable
            tabs[idx].title = "SQLite Demo"
            tabs[idx].sql = preset.sampleQuery
        }
        await runActiveQuery()
    }
}
