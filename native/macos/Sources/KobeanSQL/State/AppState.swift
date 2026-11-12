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

enum UpdateDownloadState: Equatable {
    case idle
    case downloading(progress: Double)
    case ready(fileURL: URL)
    case failed(String)
}

struct CompletionSuggestion: Identifiable, Hashable {
    enum Kind: String {
        case database = "DB"
        case table = "TABLE"
        case view = "VIEW"
        case column = "COL"
        case keyword = "KW"
        case function = "FN"
    }

    var insertText: String
    var displayText: String
    var kind: Kind
    var detail: String
    var id: String { "\(kind.rawValue)::\(insertText)::\(detail)" }
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
    var foreignKeysByTableKey: [String: [ForeignKeyInfo]] = [:]

    var tabs: [QueryTab] = []
    var activeTabID: UUID = UUID()
    var runningTasks: [UUID: Task<Void, Never>] = [:]
    var pendingDestructiveWarning: String?

    var history: [HistoryEntry] = []
    var savedQueries: [SavedQuery] = []
    var settings: NativeAppSettings = NativeAppSettings()

    var statusMessage: String = "Ready"
    var statusLevel: StatusLevel = .info

    // Sheet & Update state
    var showingConnectionSheet = false
    var editingConnection: ConnectionConfig?
    var showingHistorySheet = false
    var showingSettingsSheet = false
    var showingUpdateSheet = false
    var isCheckingForUpdates = false
    var updateDownloadState: UpdateDownloadState = .idle
    var updateCheckError: String?
    private var updateSchedulerTask: Task<Void, Never>?

    var currentAppVersion: String {
        SemanticVersion.currentAppVersion()
    }

    var isUpdateAvailable: Bool {
        guard let latest = settings.updates.cachedLatestVersion else { return false }
        return SemanticVersion.isNewerVersion(latest, than: currentAppVersion)
    }

    var shouldShowUpdateBanner: Bool {
        guard isUpdateAvailable, let latest = settings.updates.cachedLatestVersion else { return false }
        if let ignored = settings.updates.ignoredVersion,
           SemanticVersion.normalize(ignored) == SemanticVersion.normalize(latest) {
            return false
        }
        if let dismissed = settings.updates.dismissedVersion,
           SemanticVersion.normalize(dismissed) == SemanticVersion.normalize(latest),
           let dismissedAt = settings.updates.dismissedAt,
           Date().timeIntervalSince(dismissedAt) < UpdateSettings.dismissTTL {
            return false
        }
        return true
    }

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
            scheduleAutomaticUpdateChecks()
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
        // Cancel any running queries on tabs belonging to this connection
        for tab in tabs where tab.connectionID == id {
            runningTasks[tab.id]?.cancel()
            runningTasks.removeValue(forKey: tab.id)
        }
        await manager.disconnect(id)
        connectedIDs.remove(id)
        serverVersions.removeValue(forKey: id)

        // Close all open query tabs belonging to the disconnected database
        let closedCount = tabs.filter { $0.connectionID == id }.count
        tabs.removeAll { $0.connectionID == id }

        if tabs.isEmpty {
            let fallbackConn = connections.first { connectedIDs.contains($0.id) }
            let fallbackDB = fallbackConn.flatMap { selectedDatabaseByConnection[$0.id] ?? $0.database }
            let placeholder = QueryTab(
                title: fallbackConn.map { "\($0.name)" } ?? "Query 1",
                connectionID: fallbackConn?.id,
                database: fallbackDB,
                activeTable: nil,
                sql: fallbackConn != nil
                    ? "-- Connected to \(fallbackConn!.name). Press ⌘↩ to run a query.\n"
                    : "-- Disconnected from database. Connect to a database in the sidebar to begin querying.\n"
            )
            tabs = [placeholder]
            activeTabID = placeholder.id
        } else if !tabs.contains(where: { $0.id == activeTabID }) {
            activeTabID = tabs[0].id
        }

        setStatus(closedCount > 0 ? "Disconnected and closed \(closedCount) open tab(s)" : "Disconnected", level: .info)
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
            // Preload column & foreign key metadata for the first 25 tables so autocomplete and FK navigation work immediately
            for table in list.prefix(25) where table.kind == .table {
                await loadColumns(for: table, connectionID: connectionID)
                await loadForeignKeys(for: table, connectionID: connectionID)
            }
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

    func loadForeignKeys(for table: TableInfo, connectionID: String) async {
        let db = selectedDatabaseByConnection[connectionID]
        let key = "\(connectionID)::\(db ?? "")::\(table.id)"
        if foreignKeysByTableKey[key] != nil { return }
        if let fks = try? await manager.foreignKeys(connectionID, table: table, database: db) {
            foreignKeysByTableKey[key] = fks
        }
    }

    /// Returns introspected foreign keys plus schema-aware `<table_prefix>_id` foreign keys.
    func foreignKeys(for table: TableInfo, connectionID: String) -> [ForeignKeyInfo] {
        let db = selectedDatabaseByConnection[connectionID] ?? ""
        let explicit = foreignKeysByTableKey["\(connectionID)::\(db)::\(table.id)"] ?? []
        var byColumn = Dictionary(uniqueKeysWithValues: explicit.map { ($0.columnName.lowercased(), $0) })

        let knownTables = tables(for: connectionID).filter { $0.kind == .table }
        let tableCols = columns(for: table, connectionID: connectionID).map(\.name)
        let activeResultCols = activeTab?.activeResult?.columns.map(\.name) ?? []
        let allColNames = Array(Set(tableCols + activeResultCols))

        for colName in allColNames {
            let lower = colName.lowercased()
            guard byColumn[lower] == nil, lower.hasSuffix("_id"), lower.count > 3 else { continue }
            let stem = String(lower.dropLast(3)) // e.g. "customer", "org", "warehouse"
            if let matched = knownTables.first(where: { t in
                let tn = t.name.lowercased()
                return tn == stem || tn == stem + "s" || tn == stem + "es" || (stem == "org" && tn.hasPrefix("organization"))
            }), matched.name.caseInsensitiveCompare(table.name) != .orderedSame {
                let fk = ForeignKeyInfo(
                    columnName: colName,
                    referencedTable: matched.name,
                    referencedSchema: matched.schema,
                    referencedColumn: "id"
                )
                byColumn[lower] = fk
            }
        }
        return Array(byColumn.values)
    }

    /// Navigates to the parent table and filters by the clicked foreign key's primary key value.
    func followForeignKey(_ fk: ForeignKeyInfo, value: CellValue) async {
        guard !value.isNull, let conn = activeConnection else { return }
        let db = activeTab?.database ?? selectedDatabaseByConnection[conn.id]
        let isDemo = DemoDatabaseCatalog.isDemo(conn)
        let knownTables = tables(for: conn.id)
        let targetTable = knownTables.first { $0.name.caseInsensitiveCompare(fk.referencedTable) == .orderedSame }
            ?? TableInfo(name: fk.referencedTable, kind: .table, schema: fk.referencedSchema ?? db)

        await loadColumns(for: targetTable, connectionID: conn.id)
        await loadForeignKeys(for: targetTable, connectionID: conn.id)

        let qualifiedTable = RowMutator.qualifyTable(targetTable, dialect: conn.type, isDemo: isDemo)
        let quotedPK = RowMutator.quoteIdentifier(fk.referencedColumn, dialect: conn.type)
        let quotedVal = RowMutator.quoteLiteral(value, dialect: conn.type)
        let sql = "SELECT * FROM \(qualifiedTable) WHERE \(quotedPK) = \(quotedVal) LIMIT \(settings.queryLimit);"

        if let idx = activeTabIndex {
            tabs[idx].activeTable = targetTable
            tabs[idx].title = targetTable.name
            tabs[idx].sql = sql
        } else {
            newTab(title: targetTable.name, connectionID: conn.id, database: db, sql: sql)
            activeTab?.activeTable = targetTable
        }
        await runActiveQuery()
        setStatus("Followed foreign key \(fk.columnName) → \(targetTable.name).\(fk.referencedColumn) = \(value.description)", level: .info)
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
        runningTasks[id]?.cancel()
        runningTasks.removeValue(forKey: id)
        guard tabs.count > 1, let idx = tabs.firstIndex(where: { $0.id == id }) else { return }
        tabs.remove(at: idx)
        if activeTabID == id {
            activeTabID = tabs[max(0, idx - 1)].id
        }
    }

    func previewTable(_ table: TableInfo, connectionID: String, inNewTab: Bool = false) async {
        let db = selectedDatabaseByConnection[connectionID]
        await loadColumns(for: table, connectionID: connectionID)
        await loadForeignKeys(for: table, connectionID: connectionID)
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

    /// Infers the target table from a SQL / Redis / Elasticsearch / Neo4j / Flux query string.
    func inferTargetTable(from rawSQL: String, connectionID: String) -> TableInfo? {
        let connType = connections.first { $0.id == connectionID }?.type ?? .sqlite
        let statements = StatementSplitter.split(rawSQL, type: connType)
        let sql = (statements.last ?? rawSQL).trimmingCharacters(in: .whitespacesAndNewlines)
        guard !sql.isEmpty else { return nil }
        let knownTables = tables(for: connectionID)

        // Joined, unioned, or grouped queries do not map to a single mutable table pill
        if sql.range(of: #"\b(JOIN|GROUP\s+BY|UNION)\b"#, options: [.regularExpression, .caseInsensitive]) != nil {
            return nil
        }

        var candidateName: String?

        switch connType {
        case .redis:
            let tokens = RedisCommandParser.tokenize(sql)
            if tokens.count >= 2 {
                candidateName = tokens[1]
            }
        case .elasticsearch:
            if let r = sql.range(of: #"^(?:GET|POST|PUT|DELETE)\s+/([A-Za-z0-9_.\-]+)"#, options: [.regularExpression, .caseInsensitive]) {
                candidateName = String(sql[r]).replacingOccurrences(of: #"^(?:GET|POST|PUT|DELETE)\s+/"#, with: "", options: [.regularExpression, .caseInsensitive])
            }
        case .neo4j:
            if let r = sql.range(of: #"\([A-Za-z0-9_]*:([A-Za-z0-9_]+)"#, options: .regularExpression) {
                candidateName = String(sql[r]).components(separatedBy: ":").last
            }
        case .influxdb:
            if let r = sql.range(of: #"_measurement\s*==\s*"([^"]+)""#, options: .regularExpression) {
                candidateName = String(sql[r])
                    .replacingOccurrences(of: #"^_measurement\s*==\s*""#, with: "", options: .regularExpression)
                    .replacingOccurrences(of: "\"", with: "")
            }
        default:
            let patterns = [
                #"\bFROM\s+([`"'\[\]A-Za-z0-9_.]+)"#,
                #"\bINTO\s+([`"'\[\]A-Za-z0-9_.]+)"#,
                #"^\s*UPDATE\s+([`"'\[\]A-Za-z0-9_.]+)"#,
                #"\bTABLE\s+([`"'\[\]A-Za-z0-9_.]+)"#
            ]
            for pat in patterns {
                if let r = sql.range(of: pat, options: [.regularExpression, .caseInsensitive]) {
                    let frag = String(sql[r])
                    let stripped = frag.replacingOccurrences(
                        of: #"^\s*(?:FROM|INTO|UPDATE|TABLE)\s+"#,
                        with: "",
                        options: [.regularExpression, .caseInsensitive]
                    )
                    let cleaned = stripped.trimmingCharacters(in: CharacterSet(charactersIn: "`\"'[] \t\n;"))
                    candidateName = cleaned.split(separator: ".").last.map(String.init) ?? cleaned
                    break
                }
            }
        }

        guard let name = candidateName, !name.isEmpty else { return nil }
        if let matched = knownTables.first(where: { $0.name.caseInsensitiveCompare(name) == .orderedSame }) {
            return matched
        }
        return TableInfo(name: name, kind: .table, schema: selectedDatabaseByConnection[connectionID])
    }

    /// Resolves the target table for the active tab, always reflecting the latest query.
    var activeTargetTable: TableInfo? {
        guard let tab = activeTab, let connID = tab.connectionID ?? connections.first?.id else { return nil }
        if let active = tab.activeTable {
            return active
        }
        return inferTargetTable(from: tab.sql, connectionID: connID)
    }

    // MARK: - Query Editor Auto-Completion

    private static let sqlKeywords: [String] = [
        "SELECT", "FROM", "WHERE", "ORDER BY", "GROUP BY", "HAVING", "LIMIT", "OFFSET",
        "JOIN", "LEFT JOIN", "INNER JOIN", "RIGHT JOIN", "ON", "AS", "DISTINCT",
        "INSERT INTO", "VALUES", "UPDATE", "SET", "DELETE FROM", "CREATE TABLE",
        "ALTER TABLE", "DROP TABLE", "TRUNCATE TABLE", "PRIMARY KEY", "FOREIGN KEY",
        "REFERENCES", "NOT NULL", "DEFAULT", "UNIQUE", "INDEX", "VIEW", "WITH",
        "UNION ALL", "CASE", "WHEN", "THEN", "ELSE", "END", "AND", "OR", "IN",
        "IS NULL", "IS NOT NULL", "LIKE", "ILIKE", "BETWEEN", "EXISTS", "RETURNING",
        "EXPLAIN", "PRAGMA", "HGETALL", "HSET", "LRANGE", "SMEMBERS", "ZRANGE",
        "MATCH", "RETURN", "OPTIONAL MATCH"
    ]

    private static let sqlFunctions: [String] = [
        "COUNT()", "SUM()", "AVG()", "MIN()", "MAX()", "ROUND()", "COALESCE()",
        "LOWER()", "UPPER()", "LENGTH()", "SUBSTR()", "NOW()", "CURRENT_TIMESTAMP",
        "DATE()", "DATETIME()", "CAST()", "JSON_EXTRACT()"
    ]

    /// Computes ranked auto-completion suggestions (Databases, Tables, Views, Columns, Keywords, Functions)
    /// for the current cursor token in `NativeCodeEditor`.
    func autocompleteSuggestions(prefix: String, fullSQL: String) -> [CompletionSuggestion] {
        guard let connID = activeTab?.connectionID ?? connections.first?.id else { return [] }
        let trimmedPrefix = prefix.trimmingCharacters(in: .whitespacesAndNewlines)

        // Check for `tableOrAlias.columnPrefix` dot completion
        if trimmedPrefix.contains(".") {
            let parts = trimmedPrefix.split(separator: ".", omittingEmptySubsequences: false)
            guard parts.count == 2 else { return [] }
            let qualifier = String(parts[0]).trimmingCharacters(in: CharacterSet(charactersIn: "\"`[]"))
            let colPrefix = String(parts[1]).lowercased()

            let knownTables = tables(for: connID)
            // Resolve qualifier as either a table name, database/schema name, or SQL alias (`FROM orders o`)
            var matchedTable = knownTables.first { $0.name.caseInsensitiveCompare(qualifier) == .orderedSame }
            if matchedTable == nil {
                // Check alias pattern `FROM <table> [AS] <qualifier>` or `JOIN <table> [AS] <qualifier>`
                let aliasPattern = "(?:FROM|JOIN)\\s+[`\"']?([A-Za-z0-9_]+)[`\"']?\\s+(?:AS\\s+)?\(NSRegularExpression.escapedPattern(for: qualifier))\\b"
                if let r = fullSQL.range(of: aliasPattern, options: [.regularExpression, .caseInsensitive]) {
                    let frag = String(fullSQL[r])
                    let tokens = frag.components(separatedBy: .whitespaces).filter { !$0.isEmpty }
                    if tokens.count >= 2 {
                        let tName = tokens[1].trimmingCharacters(in: CharacterSet(charactersIn: "`\"'"))
                        matchedTable = knownTables.first { $0.name.caseInsensitiveCompare(tName) == .orderedSame }
                    }
                }
            }

            if let table = matchedTable {
                let cols = columns(for: table, connectionID: connID)
                return cols
                    .filter { colPrefix.isEmpty || $0.name.lowercased().hasPrefix(colPrefix) || $0.name.lowercased().contains(colPrefix) }
                    .map { col in
                        CompletionSuggestion(
                            insertText: "\(qualifier).\(col.name)",
                            displayText: "\(qualifier).\(col.name)",
                            kind: .column,
                            detail: "\(table.name) • \(col.type.isEmpty ? "column" : col.type)"
                        )
                    }
            }

            // Or `database.table` completion
            let dbs = databasesByConnection[connID] ?? []
            if dbs.contains(where: { $0.caseInsensitiveCompare(qualifier) == .orderedSame }) {
                return knownTables
                    .filter { colPrefix.isEmpty || $0.name.lowercased().hasPrefix(colPrefix) }
                    .map { t in
                        CompletionSuggestion(
                            insertText: "\(qualifier).\(t.name)",
                            displayText: "\(qualifier).\(t.name)",
                            kind: t.kind == .view ? .view : .table,
                            detail: qualifier
                        )
                    }
            }
            return []
        }

        let q = trimmedPrefix.lowercased()
        guard !q.isEmpty else { return [] }

        var results: [CompletionSuggestion] = []
        var seen = Set<String>()

        // 1. Tables & Views
        let knownTables = tables(for: connID)
        for t in knownTables where t.name.lowercased().hasPrefix(q) || t.name.lowercased().contains(q) {
            let s = CompletionSuggestion(
                insertText: t.name,
                displayText: t.name,
                kind: t.kind == .view ? .view : .table,
                detail: t.schema ?? "schema"
            )
            if seen.insert(s.id).inserted { results.append(s) }
        }

        // 2. Columns across known tables & active result set
        for t in knownTables {
            for col in columns(for: t, connectionID: connID)
            where col.name.lowercased().hasPrefix(q) || col.name.lowercased().contains(q) {
                let s = CompletionSuggestion(
                    insertText: col.name,
                    displayText: col.name,
                    kind: .column,
                    detail: "\(t.name)\(col.type.isEmpty ? "" : " (\(col.type))")"
                )
                if seen.insert("COL::\(col.name)::\(t.name)").inserted { results.append(s) }
            }
        }
        if let activeCols = activeTab?.activeResult?.columns {
            for col in activeCols where col.name.lowercased().hasPrefix(q) {
                let s = CompletionSuggestion(
                    insertText: col.name,
                    displayText: col.name,
                    kind: .column,
                    detail: col.type.isEmpty ? "result column" : col.type
                )
                if seen.insert("COL::\(col.name)::result").inserted { results.append(s) }
            }
        }

        // 3. Databases
        for db in (databasesByConnection[connID] ?? []) where db.lowercased().hasPrefix(q) || db.lowercased().contains(q) {
            let s = CompletionSuggestion(insertText: db, displayText: db, kind: .database, detail: "database")
            if seen.insert(s.id).inserted { results.append(s) }
        }

        // 4. SQL / NoSQL Keywords & Functions
        for kw in Self.sqlKeywords where kw.lowercased().hasPrefix(q) {
            let s = CompletionSuggestion(insertText: kw, displayText: kw, kind: .keyword, detail: "keyword")
            if seen.insert(s.id).inserted { results.append(s) }
        }
        for fn in Self.sqlFunctions where fn.lowercased().hasPrefix(q) {
            let clean = fn.replacingOccurrences(of: "()", with: "")
            let s = CompletionSuggestion(insertText: clean, displayText: fn, kind: .function, detail: "function")
            if seen.insert(s.id).inserted { results.append(s) }
        }

        // Sort prefix matches before substring matches
        results.sort { a, b in
            let aPre = a.displayText.lowercased().hasPrefix(q)
            let bPre = b.displayText.lowercased().hasPrefix(q)
            if aPre != bPre { return aPre }
            return a.displayText.count < b.displayText.count
        }
        return Array(results.prefix(12))
    }

    // MARK: - Row & Table CRUD Operations

    func primaryKeyNamesSync(for table: TableInfo, connectionID: String) -> Set<String> {
        let cols = columns(for: table, connectionID: connectionID)
        return Set(cols.filter(\.primaryKey).map(\.name))
    }

    private func primaryKeyNames(for table: TableInfo, connectionID: String) async -> Set<String> {
        await loadColumns(for: table, connectionID: connectionID)
        return primaryKeyNamesSync(for: table, connectionID: connectionID)
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

    func bulkInsertRows(into table: TableInfo, columns: [String], rows: [[CellValue]]) async throws {
        guard let conn = activeConnection else { throw DatabaseError("No active connection") }
        guard !rows.isEmpty else { throw DatabaseError("Bulk insert requires at least one row") }
        let db = activeTab?.database ?? selectedDatabaseByConnection[conn.id]
        let isDemo = DemoDatabaseCatalog.isDemo(conn)

        switch conn.type {
        case .redis:
            var pairs: [String] = []
            for row in rows {
                let dict = Dictionary(uniqueKeysWithValues: zip(columns, row.map(\.description)))
                let field = dict["field"] ?? dict["member"] ?? dict["element"] ?? row.first?.description ?? "key"
                let val = dict["value"] ?? dict["score"] ?? (row.count > 1 ? row[1].description : "")
                pairs.append("\(RedisCommandParser.quote(field)) \(RedisCommandParser.quote(val))")
            }
            let statement = "HSET \(RedisCommandParser.quote(table.name)) \(pairs.joined(separator: " "))"
            _ = try await manager.run(statement, connectionID: conn.id, type: conn.type, database: db, autoLimit: false)
        case .elasticsearch:
            for (idx, row) in rows.enumerated() {
                var obj: [String: Any] = [:]
                for (col, val) in zip(columns, row) where col != "_index" {
                    obj[col] = val.jsonValue
                }
                let docID = (obj["_id"] as? String) ?? "doc-\(Int.random(in: 1000...9999))-\(idx)"
                let data = try JSONSerialization.data(withJSONObject: obj, options: [.sortedKeys])
                let statement = "POST /\(table.name)/_doc/\(docID)\n\(String(decoding: data, as: UTF8.self))"
                _ = try await manager.run(statement, connectionID: conn.id, type: conn.type, database: db, autoLimit: false)
            }
        default:
            let statement = try RowMutator.buildBulkInsertSQL(
                table: table,
                dialect: conn.type,
                isDemo: isDemo,
                columns: columns,
                rows: rows
            )
            _ = try await manager.run(statement, connectionID: conn.id, type: conn.type, database: db, autoLimit: false)
        }

        setStatus("Bulk inserted \(rows.count) row(s) into \(table.name)", level: .success)
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

    func bulkUpdateRows(
        in table: TableInfo,
        columns: [ColumnDef],
        targetRows: [[CellValue]],
        updatedValues: [(column: String, value: CellValue)]
    ) async throws {
        guard let conn = activeConnection else { throw DatabaseError("No active connection") }
        guard !targetRows.isEmpty else { throw DatabaseError("Select at least one row to bulk update") }
        guard !updatedValues.isEmpty else { throw DatabaseError("Select at least one column to update") }
        let db = activeTab?.database ?? selectedDatabaseByConnection[conn.id]
        let isDemo = DemoDatabaseCatalog.isDemo(conn)
        let pks = await primaryKeyNames(for: table, connectionID: conn.id)

        switch conn.type {
        case .redis:
            let newVal = updatedValues.first?.value.description ?? ""
            var pairs: [String] = []
            for row in targetRows {
                let field = row.first?.description ?? "field"
                pairs.append("\(RedisCommandParser.quote(field)) \(RedisCommandParser.quote(newVal))")
            }
            let statement = "HSET \(RedisCommandParser.quote(table.name)) \(pairs.joined(separator: " "))"
            _ = try await manager.run(statement, connectionID: conn.id, type: conn.type, database: db, autoLimit: false)
        case .elasticsearch:
            for row in targetRows {
                var obj: [String: Any] = [:]
                for (i, col) in columns.enumerated() where i < row.count && col.name != "_index" {
                    obj[col.name] = row[i].jsonValue
                }
                for (col, val) in updatedValues { obj[col] = val.jsonValue }
                let docID = "\(obj["_id"] ?? "doc-1")"
                let data = try JSONSerialization.data(withJSONObject: obj, options: [.sortedKeys])
                let statement = "PUT /\(table.name)/_doc/\(docID)\n\(String(decoding: data, as: UTF8.self))"
                _ = try await manager.run(statement, connectionID: conn.id, type: conn.type, database: db, autoLimit: false)
            }
        default:
            let statement = try RowMutator.buildBulkUpdateSQL(
                table: table,
                dialect: conn.type,
                isDemo: isDemo,
                columns: columns,
                pkColumnNames: pks,
                targetRows: targetRows,
                updatedValues: updatedValues
            )
            _ = try await manager.run(statement, connectionID: conn.id, type: conn.type, database: db, autoLimit: false)
        }

        setStatus("Bulk updated \(targetRows.count) row(s) in \(table.name)", level: .success)
        await runActiveQuery()
    }

    func duplicateRow(in table: TableInfo, columns: [ColumnDef], row: [CellValue]) async throws {
        try await duplicateRows(in: table, columns: columns, rows: [row])
    }

    func duplicateRows(in table: TableInfo, columns: [ColumnDef], rows: [[CellValue]]) async throws {
        guard let conn = activeConnection else { throw DatabaseError("No active connection") }
        guard !rows.isEmpty else { return }
        let db = activeTab?.database ?? selectedDatabaseByConnection[conn.id]
        let isDemo = DemoDatabaseCatalog.isDemo(conn)
        let pks = await primaryKeyNames(for: table, connectionID: conn.id)

        switch conn.type {
        case .redis:
            var pairs: [String] = []
            for (idx, row) in rows.enumerated() {
                let field = "\(row.first?.description ?? "key")_copy\(rows.count > 1 ? "_\(idx + 1)" : "")"
                let val = row.count > 1 ? row[1].description : ""
                pairs.append("\(RedisCommandParser.quote(field)) \(RedisCommandParser.quote(val))")
            }
            let statement = "HSET \(RedisCommandParser.quote(table.name)) \(pairs.joined(separator: " "))"
            _ = try await manager.run(statement, connectionID: conn.id, type: conn.type, database: db, autoLimit: false)
        case .elasticsearch:
            for (idx, row) in rows.enumerated() {
                var obj: [String: Any] = [:]
                for (i, col) in columns.enumerated() where i < row.count && col.name != "_index" && col.name != "_id" {
                    obj[col.name] = row[i].jsonValue
                }
                let newID = "doc-\(Int.random(in: 1000...9999))-\(idx)"
                obj["_id"] = newID
                let data = try JSONSerialization.data(withJSONObject: obj, options: [.sortedKeys])
                let statement = "POST /\(table.name)/_doc/\(newID)\n\(String(decoding: data, as: UTF8.self))"
                _ = try await manager.run(statement, connectionID: conn.id, type: conn.type, database: db, autoLimit: false)
            }
        default:
            let statement = try RowMutator.buildBulkDuplicateSQL(
                table: table,
                dialect: conn.type,
                isDemo: isDemo,
                columns: columns,
                pkColumnNames: pks,
                rows: rows
            )
            _ = try await manager.run(statement, connectionID: conn.id, type: conn.type, database: db, autoLimit: false)
        }

        setStatus("Duplicated \(rows.count) row(s) in \(table.name)", level: .success)
        await runActiveQuery()
    }

    func deleteRows(from table: TableInfo, columns: [ColumnDef], rows: [[CellValue]]) async throws {
        guard let conn = activeConnection else { throw DatabaseError("No active connection") }
        guard !rows.isEmpty else { return }
        let db = activeTab?.database ?? selectedDatabaseByConnection[conn.id]
        let isDemo = DemoDatabaseCatalog.isDemo(conn)
        let pks = await primaryKeyNames(for: table, connectionID: conn.id)

        switch conn.type {
        case .redis:
            let fields = rows.compactMap { $0.first?.description }.filter { !$0.isEmpty }.map(RedisCommandParser.quote)
            if !fields.isEmpty {
                let statement = "HDEL \(RedisCommandParser.quote(table.name)) \(fields.joined(separator: " "))"
                _ = try await manager.run(statement, connectionID: conn.id, type: conn.type, database: db, autoLimit: false)
            }
        case .elasticsearch:
            let idIdx = columns.firstIndex { $0.name == "_id" } ?? 0
            for row in rows {
                let docID = idIdx < row.count ? row[idIdx].description : ""
                let statement = "DELETE /\(table.name)/_doc/\(docID)"
                _ = try await manager.run(statement, connectionID: conn.id, type: conn.type, database: db, autoLimit: false)
            }
        default:
            let statement = try RowMutator.buildBulkDeleteSQL(
                table: table,
                dialect: conn.type,
                isDemo: isDemo,
                columns: columns,
                pkColumnNames: pks,
                rows: rows
            )
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

    func startActiveQuery(confirmedDestructive: Bool = false) {
        guard let tabID = activeTab?.id else { return }
        runningTasks[tabID]?.cancel()
        let task = Task { @MainActor in
            await self.runActiveQuery(confirmedDestructive: confirmedDestructive)
            self.runningTasks.removeValue(forKey: tabID)
        }
        runningTasks[tabID] = task
    }

    func cancelActiveQuery() {
        guard let idx = activeTabIndex else { return }
        let tabID = tabs[idx].id
        runningTasks[tabID]?.cancel()
        runningTasks.removeValue(forKey: tabID)
        tabs[idx].isRunning = false
        setStatus("Query cancelled by user", level: .warning)
    }

    func runActiveQuery(confirmedDestructive: Bool = false) async {
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

        // Security Guard 1: Enforce Read-Only Safe Mode
        if settings.readOnlyMode && QueryGuard.isWriteOrDDL(sql, type: conn.type) {
            let msg = "Blocked by Read-Only Safe Mode: disable Read-Only in the toolbar or settings to execute write/DDL statements."
            tabs[idx].errorMessage = msg
            setStatus(msg, level: .warning)
            return
        }

        // Security Guard 2: Confirm destructive statements (DROP, TRUNCATE, DELETE/UPDATE without WHERE)
        if settings.confirmDestructiveQueries && !confirmedDestructive,
           let warning = QueryGuard.detectDestructiveRisk(sql, type: conn.type) {
            pendingDestructiveWarning = warning
            return
        }

        if !connectedIDs.contains(connID) {
            await connect(conn)
            guard connectedIDs.contains(connID) else { return }
        }

        guard let runIdx = tabs.firstIndex(where: { $0.id == tab.id }) else { return }
        tabs[runIdx].isRunning = true
        tabs[runIdx].errorMessage = nil

        // Always update the target table pill to match the newly executed query
        let inferredTable = inferTargetTable(from: sql, connectionID: connID)
        tabs[runIdx].activeTable = inferredTable
        if let inferredTable {
            await loadColumns(for: inferredTable, connectionID: connID)
            await loadForeignKeys(for: inferredTable, connectionID: connID)
        }

        let db = tab.database ?? selectedDatabaseByConnection[connID]
        let start = Date()
        setStatus("Running query on \(conn.name)…", level: .info)

        do {
            let results = try await manager.run(
                sql,
                connectionID: connID,
                type: conn.type,
                database: db,
                autoLimit: settings.autoLimitEnabled,
                timeout: TimeInterval(settings.queryTimeoutSeconds)
            )
            let duration = Date().timeIntervalSince(start)
            if let currentIdx = tabs.firstIndex(where: { $0.id == tab.id }) {
                tabs[currentIdx].isRunning = false
                tabs[currentIdx].results = results
                tabs[currentIdx].activeResultIndex = max(0, results.count - 1)
                tabs[currentIdx].errorMessage = nil
                tabs[currentIdx].activeTable = inferredTable
            }
            let totalRows = results.reduce(0) { $0 + $1.rowCount }
            recordHistory(conn: conn, database: db, sql: sql, duration: duration, rows: totalRows, error: nil)
            setStatus(String(format: "Returned %d rows in %.0f ms", totalRows, duration * 1000), level: .success)
        } catch is CancellationError {
            if let currentIdx = tabs.firstIndex(where: { $0.id == tab.id }) {
                tabs[currentIdx].isRunning = false
            }
            setStatus("Query cancelled", level: .warning)
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
            query: QueryGuard.redactSecrets(sql),
            duration: duration,
            rowCount: rows,
            error: error.map(QueryGuard.redactSecrets)
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
        let intervalChanged = settings.updates.autoCheckEnabled != newSettings.updates.autoCheckEnabled
            || settings.updates.checkIntervalHours != newSettings.updates.checkIntervalHours
        settings = newSettings
        try? storage.saveSettings(newSettings)
        if intervalChanged {
            scheduleAutomaticUpdateChecks()
        }
        setStatus("Settings saved", level: .success)
    }

    // MARK: - Software Updates (GitHub Releases)

    func scheduleAutomaticUpdateChecks() {
        updateSchedulerTask?.cancel()
        guard settings.updates.autoCheckEnabled else { return }
        let intervalSecs = TimeInterval(max(1, settings.updates.checkIntervalHours) * 3600)

        updateSchedulerTask = Task { @MainActor in
            var initialDelay: TimeInterval = 15
            if let last = self.settings.updates.lastCheckedAt {
                let elapsed = Date().timeIntervalSince(last)
                if elapsed < intervalSecs {
                    initialDelay = max(15, intervalSecs - elapsed)
                }
            }
            try? await Task.sleep(nanoseconds: UInt64(initialDelay * 1_000_000_000))
            while !Task.isCancelled && self.settings.updates.autoCheckEnabled {
                await self.checkForUpdates(manual: false)
                try? await Task.sleep(nanoseconds: UInt64(intervalSecs * 1_000_000_000))
            }
        }
    }

    func checkForUpdates(manual: Bool = false) async {
        guard !isCheckingForUpdates else { return }
        isCheckingForUpdates = true
        updateCheckError = nil
        if manual {
            setStatus("Checking GitHub Releases for updates…", level: .info)
        }

        do {
            let outcome = try await UpdateService.fetchLatestRelease(
                etag: settings.updates.cachedETag,
                force: manual || settings.updates.cachedDownloadURL == nil
            )
            var updated = settings
            updated.updates.lastCheckedAt = Date()

            switch outcome {
            case .notModified(let etag):
                if let etag { updated.updates.cachedETag = etag }
            case .release(let version, let name, let notes, let releaseURL, let asset, let etag):
                updated.updates.cachedLatestVersion = version
                updated.updates.cachedReleaseName = name
                updated.updates.cachedReleaseNotes = notes
                updated.updates.cachedReleaseURL = releaseURL
                updated.updates.cachedDownloadURL = asset?.browser_download_url
                updated.updates.cachedAssetName = asset?.name
                updated.updates.cachedAssetSize = asset?.size
                updated.updates.cachedETag = etag
            }

            settings = updated
            try? storage.saveSettings(updated)
            isCheckingForUpdates = false

            if isUpdateAvailable, let latest = settings.updates.cachedLatestVersion {
                if manual {
                    showingUpdateSheet = true
                    setStatus("Update available: KobeanSQL v\(latest)", level: .success)
                } else if shouldShowUpdateBanner {
                    setStatus("New version available: KobeanSQL v\(latest)", level: .info)
                }
            } else if manual {
                showingUpdateSheet = true
                setStatus("You're up to date! (KobeanSQL v\(currentAppVersion))", level: .success)
            }
        } catch {
            isCheckingForUpdates = false
            updateCheckError = error.localizedDescription
            if manual {
                showingUpdateSheet = true
                setStatus("Update check failed: \(error.localizedDescription)", level: .error)
            }
        }
    }

    func downloadUpdate() async {
        if case .downloading = updateDownloadState { return }
        updateDownloadState = .downloading(progress: 0)

        if settings.updates.cachedDownloadURL == nil {
            await checkForUpdates(manual: false)
        }

        guard let dlURL = settings.updates.cachedDownloadURL else {
            let msg = "No native macOS download asset found on the latest release. Opening GitHub Releases page."
            updateDownloadState = .failed(msg)
            setStatus(msg, level: .warning)
            return
        }

        do {
            let fileURL = try await UpdateService.downloadAsset(
                from: dlURL,
                assetName: settings.updates.cachedAssetName
            ) { [weak self] pct in
                Task { @MainActor in
                    guard let self else { return }
                    if case .downloading = self.updateDownloadState {
                        self.updateDownloadState = .downloading(progress: pct)
                    }
                }
            }
            updateDownloadState = .ready(fileURL: fileURL)
            setStatus("Update downloaded and ready to install.", level: .success)
        } catch {
            updateDownloadState = .failed(error.localizedDescription)
            setStatus("Update download failed: \(error.localizedDescription)", level: .error)
        }
    }

    func installReadyUpdate() {
        guard case .ready(let fileURL) = updateDownloadState else { return }
        do {
            try UpdateService.installAndRelaunch(downloadedFile: fileURL)
            setStatus("Installing update and relaunching KobeanSQL…", level: .success)
            DispatchQueue.main.asyncAfter(deadline: .now() + 0.35) {
                NSApplication.shared.terminate(nil)
            }
        } catch {
            updateDownloadState = .failed(error.localizedDescription)
            setStatus("Install failed: \(error.localizedDescription)", level: .error)
        }
    }

    func downloadAndInstallUpdate() async {
        await downloadUpdate()
        if case .ready = updateDownloadState {
            installReadyUpdate()
        }
    }

    func dismissUpdateReminder() {
        guard let latest = settings.updates.cachedLatestVersion else { return }
        var updated = settings
        updated.updates.dismissedVersion = SemanticVersion.normalize(latest)
        updated.updates.dismissedAt = Date()
        settings = updated
        try? storage.saveSettings(updated)
    }

    func ignoreCurrentUpdate() {
        guard let latest = settings.updates.cachedLatestVersion else { return }
        var updated = settings
        updated.updates.ignoredVersion = SemanticVersion.normalize(latest)
        settings = updated
        try? storage.saveSettings(updated)
        showingUpdateSheet = false
        setStatus("Skipped update v\(latest)", level: .info)
    }

    func openReleasePage() {
        let urlStr = settings.updates.cachedReleaseURL
        let target: URL
        if UpdateService.isAllowedReleasePageURL(urlStr), let u = urlStr.flatMap(URL.init(string:)) {
            target = u
        } else {
            target = UpdateService.releasesPageURL
        }
        NSWorkspace.shared.open(target)
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
