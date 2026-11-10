import Foundation
import Logging
import NIOCore
import NIOPosix
import NIOSSL
@preconcurrency import MySQLNIO

/// MySQL / MariaDB via MySQLNIO (pure Swift). Uses the text protocol (COM_QUERY) so every
/// statement type works and values arrive as display-ready strings.
public actor MySQLDriver: DatabaseDriver {
    public let type: DatabaseType
    private var config: ConnectionConfig?
    private var conn: MySQLConnection?
    private var currentDatabase: String?
    private let logger = Logger(label: "kobeansql.mysql")

    public init(type: DatabaseType = .mysql) { self.type = type }

    public func connect(_ config: ConnectionConfig) async throws {
        let config = try config.resolved()
        self.config = config
        let host = config.host?.isEmpty == false ? config.host! : "localhost"
        let port = config.port ?? 3306
        let eventLoop = MultiThreadedEventLoopGroup.singleton.any()

        // Opportunistic TLS ("PREFERRED"): only negotiated when the server supports it.
        // Needed for caching_sha2_password (MySQL 8 default). Verification is skipped
        // unless the user asked for SSL, mirroring the Electron adapter.
        var tls = TLSConfiguration.makeClientConfiguration()
        if config.ssl != true { tls.certificateVerification = .none }

        let address = try await eventLoop.submit { try SocketAddress.makeAddressResolvingHost(host, port: port) }.get()
        let future = MySQLConnection.connect(
            to: address,
            username: config.user?.isEmpty == false ? config.user! : "root",
            database: config.database ?? "",
            password: config.password,
            tlsConfiguration: tls,
            serverHostname: host,
            logger: logger,
            on: eventLoop
        )
        conn = try await QueryGuard.withTimeout(QueryGuard.connectTimeout, message: "Connection timed out after \(Int(QueryGuard.connectTimeout))s") {
            try await future.get()
        }
        currentDatabase = config.database
    }

    public func disconnect() async {
        try? await conn?.close().get()
        conn = nil
    }

    private func useDatabase(_ database: String?) async throws {
        guard let conn, let database, !database.isEmpty, database != currentDatabase else { return }
        _ = try await conn.simpleQuery("USE \(SQLIdent.quote(database, with: "`"))").get()
        currentDatabase = database
    }

    public func execute(_ query: String, database: String?) async throws -> QueryResult {
        guard let conn, !conn.isClosed else { throw DatabaseError("Not connected") }
        try await useDatabase(database)
        let start = Date()
        let rows: [MySQLRow]
        do {
            rows = try await conn.simpleQuery(query).get()
        } catch let error as MySQLError {
            throw DatabaseError(error.message)
        }
        let duration = Date().timeIntervalSince(start)

        guard let first = rows.first else {
            // Distinguish "empty result set" from DML: ROW_COUNT() is -1 after a SELECT.
            let countBuf = try? await conn.simpleQuery("SELECT ROW_COUNT()").get().first?.values.first ?? nil
            let count = countBuf.flatMap { $0.getString(at: 0, length: $0.readableBytes) }
            let affected = Int(count ?? "") ?? 0
            return QueryResult(rowCount: max(affected, 0), duration: duration)
        }

        let defs = first.columnDefinitions
        let columns = defs.map { ColumnDef(name: $0.name, type: $0.columnType.name) }
        let decoded: [[CellValue]] = rows.prefix(QueryGuard.maxRows + 1).map { row in
            zip(defs, row.values).map { def, buffer in
                guard let buffer else { return .null }
                if def.characterSet == .binary && Self.isBinaryType(def.columnType) {
                    return .blob(buffer.readableBytes)
                }
                return .text(String(buffer: buffer))
            }
        }
        return QueryResult(columns: columns, rows: decoded, rowCount: rows.count, duration: duration)
    }

    private static func isBinaryType(_ t: MySQLProtocol.DataType) -> Bool {
        switch t {
        case .blob, .tinyBlob, .mediumBlob, .longBlob, .varString, .string, .geometry: true
        default: false
        }
    }

    public func databases() async throws -> [String] {
        try await execute("SHOW DATABASES", database: nil).rows.map { $0[0].description }
    }

    public func tables(database: String?) async throws -> [TableInfo] {
        let db = database ?? currentDatabase
        guard let db, !db.isEmpty else { return [] }
        let sql = """
        SELECT TABLE_NAME, TABLE_TYPE FROM information_schema.TABLES
        WHERE TABLE_SCHEMA = \(SQLIdent.literal(db)) ORDER BY TABLE_NAME
        """
        return try await execute(sql, database: nil).rows.map {
            TableInfo(name: $0[0].description, kind: $0[1].description.contains("VIEW") ? .view : .table, schema: db)
        }
    }

    public func columns(table: TableInfo, database: String?) async throws -> [ColumnInfo] {
        let db = table.schema ?? database ?? currentDatabase ?? ""
        let sql = """
        SELECT COLUMN_NAME, COLUMN_TYPE, IS_NULLABLE, COLUMN_KEY, COLUMN_DEFAULT
        FROM information_schema.COLUMNS
        WHERE TABLE_SCHEMA = \(SQLIdent.literal(db)) AND TABLE_NAME = \(SQLIdent.literal(table.name))
        ORDER BY ORDINAL_POSITION
        """
        return try await execute(sql, database: nil).rows.map { r in
            ColumnInfo(name: r[0].description, type: r[1].description, nullable: r[2].description == "YES",
                       primaryKey: r[3].description == "PRI", defaultValue: r[4].isNull ? nil : r[4].description)
        }
    }

    public func foreignKeys(table: TableInfo, database: String?) async throws -> [ForeignKeyInfo] {
        let db = table.schema ?? database ?? currentDatabase ?? ""
        let sql = """
        SELECT COLUMN_NAME, REFERENCED_TABLE_SCHEMA, REFERENCED_TABLE_NAME, REFERENCED_COLUMN_NAME
        FROM information_schema.KEY_COLUMN_USAGE
        WHERE TABLE_SCHEMA = \(SQLIdent.literal(db))
          AND TABLE_NAME = \(SQLIdent.literal(table.name))
          AND REFERENCED_TABLE_NAME IS NOT NULL
        """
        return try await execute(sql, database: nil).rows.compactMap { r in
            guard r.count >= 4 else { return nil }
            return ForeignKeyInfo(
                columnName: r[0].description,
                referencedTable: r[2].description,
                referencedSchema: r[1].description,
                referencedColumn: r[3].description
            )
        }
    }

    public func serverVersion() async throws -> String {
        try await execute("SELECT VERSION()", database: nil).rows.first?.first?.description ?? "unknown"
    }

    public func previewQuery(for table: TableInfo, database: String?, limit: Int) -> String {
        let qualified = [table.schema, table.name].compactMap { $0 }.map { SQLIdent.quote($0, with: "`") }.joined(separator: ".")
        return "SELECT * FROM \(qualified) LIMIT \(limit);"
    }
}
