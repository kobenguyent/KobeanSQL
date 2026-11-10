import Foundation
import SQLite3

private let SQLITE_TRANSIENT = unsafeBitCast(-1, to: sqlite3_destructor_type.self)

/// SQLite via the system `libsqlite3` — zero third-party code.
public actor SQLiteDriver: DatabaseDriver {
    public let type: DatabaseType = .sqlite
    private var db: OpaquePointer?

    public init() {}

    public func connect(_ config: ConnectionConfig) async throws {
        let path = (config.filename ?? "").trimmingCharacters(in: .whitespaces)
        guard !path.isEmpty else { throw DatabaseError("Choose a SQLite database file.") }
        let expanded = (path as NSString).expandingTildeInPath
        var handle: OpaquePointer?
        let flags = SQLITE_OPEN_READWRITE | SQLITE_OPEN_CREATE | SQLITE_OPEN_FULLMUTEX
        guard sqlite3_open_v2(expanded, &handle, flags, nil) == SQLITE_OK else {
            let msg = handle.map { String(cString: sqlite3_errmsg($0)) } ?? "unknown error"
            sqlite3_close(handle)
            throw DatabaseError("Unable to open \(expanded): \(msg)")
        }
        sqlite3_busy_timeout(handle, Int32(QueryGuard.queryTimeout * 1000))
        db = handle
    }

    public func disconnect() async {
        if let db { sqlite3_close_v2(db) }
        db = nil
    }

    public func execute(_ query: String, database: String?) async throws -> QueryResult {
        guard let db else { throw DatabaseError("Not connected") }
        let start = Date()
        var stmt: OpaquePointer?
        guard sqlite3_prepare_v2(db, query, -1, &stmt, nil) == SQLITE_OK else {
            throw DatabaseError(String(cString: sqlite3_errmsg(db)))
        }
        defer { sqlite3_finalize(stmt) }

        let columnCount = Int(sqlite3_column_count(stmt))
        let columns = (0..<columnCount).map { i in
            ColumnDef(name: String(cString: sqlite3_column_name(stmt, Int32(i))),
                      type: sqlite3_column_decltype(stmt, Int32(i)).map { String(cString: $0) } ?? "")
        }

        var rows: [[CellValue]] = []
        while true {
            let rc = sqlite3_step(stmt)
            if rc == SQLITE_DONE { break }
            guard rc == SQLITE_ROW else { throw DatabaseError(String(cString: sqlite3_errmsg(db))) }
            // Stop reading early instead of materialising huge result sets.
            if rows.count > QueryGuard.maxRows { break }
            rows.append((0..<columnCount).map { cell(stmt, Int32($0)) })
        }

        let duration = Date().timeIntervalSince(start)
        if columnCount == 0 {
            return QueryResult(rowCount: Int(sqlite3_changes(db)), duration: duration)
        }
        return QueryResult(columns: columns, rows: rows, duration: duration)
    }

    private func cell(_ stmt: OpaquePointer?, _ i: Int32) -> CellValue {
        switch sqlite3_column_type(stmt, i) {
        case SQLITE_NULL: return .null
        case SQLITE_INTEGER: return .integer(sqlite3_column_int64(stmt, i))
        case SQLITE_FLOAT: return .double(sqlite3_column_double(stmt, i))
        case SQLITE_BLOB: return .blob(Int(sqlite3_column_bytes(stmt, i)))
        default:
            guard let text = sqlite3_column_text(stmt, i) else { return .null }
            return .text(String(cString: text))
        }
    }

    public func databases() async throws -> [String] { ["main"] }

    public func tables(database: String?) async throws -> [TableInfo] {
        let result = try await execute(
            "SELECT name, type FROM sqlite_master WHERE type IN ('table','view') AND name NOT LIKE 'sqlite_%' ORDER BY name",
            database: nil)
        return result.rows.map { TableInfo(name: $0[0].description, kind: $0[1].description == "view" ? .view : .table) }
    }

    public func columns(table: TableInfo, database: String?) async throws -> [ColumnInfo] {
        let result = try await execute("PRAGMA table_info(\(SQLIdent.quote(table.name)))", database: nil)
        // cid, name, type, notnull, dflt_value, pk
        return result.rows.map { r in
            ColumnInfo(name: r[1].description, type: r[2].description,
                       nullable: r[3].description == "0", primaryKey: r[5].description != "0",
                       defaultValue: r[4].isNull ? nil : r[4].description)
        }
    }

    public func serverVersion() async throws -> String { "SQLite " + String(cString: sqlite3_libversion()) }

    public func previewQuery(for table: TableInfo, database: String?, limit: Int) -> String {
        "SELECT * FROM \(SQLIdent.quote(table.name)) LIMIT \(limit);"
    }
}
