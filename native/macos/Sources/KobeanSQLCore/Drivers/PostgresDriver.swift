import Foundation
import Logging
import NIOCore
import NIOSSL
import PostgresNIO

/// PostgreSQL / CockroachDB over the Postgres wire protocol (PostgresNIO, pure Swift).
/// One connection per database (Postgres can't switch DB on a live session), capped at 5.
public actor PostgresDriver: DatabaseDriver {
    public let type: DatabaseType
    private var config: ConnectionConfig?
    private var connections: [String: PostgresConnection] = [:]
    private var connectionOrder: [String] = []
    private var nextID = 0
    private static let maxConnections = 5
    private let logger = Logger(label: "kobeansql.postgres")

    public init(type: DatabaseType = .postgres) { self.type = type }

    private var defaultDatabase: String {
        if let db = config?.database, !db.isEmpty { return db }
        return type == .cockroachdb ? "defaultdb" : "postgres"
    }

    public func connect(_ config: ConnectionConfig) async throws {
        self.config = try config.resolved()
        _ = try await connection(for: nil)
    }

    public func disconnect() async {
        for conn in connections.values { try? await conn.close() }
        connections.removeAll()
        connectionOrder.removeAll()
    }

    private func connection(for database: String?) async throws -> PostgresConnection {
        guard let config else { throw DatabaseError("Not connected") }
        let db = (database?.isEmpty == false ? database! : defaultDatabase)
        if let existing = connections[db], !existing.isClosed { return existing }

        let tls: PostgresConnection.Configuration.TLS
        if config.ssl == true {
            var tlsConfig = TLSConfiguration.makeClientConfiguration()
            // Mirrors `ssl: { rejectUnauthorized: false }` in the Electron adapter.
            tlsConfig.certificateVerification = .none
            tls = .require(try NIOSSLContext(configuration: tlsConfig))
        } else {
            tls = .disable
        }

        var pgConfig = PostgresConnection.Configuration(
            host: config.host?.isEmpty == false ? config.host! : "localhost",
            port: config.port ?? type.defaultPort ?? 5432,
            username: config.user?.isEmpty == false ? config.user! : type.defaultUser,
            password: config.password,
            database: db,
            tls: tls
        )
        pgConfig.options.connectTimeout = .seconds(Int64(QueryGuard.connectTimeout))
        if type == .cockroachdb { pgConfig.options.requireBackendKeyData = false }

        nextID += 1
        let conn = try await PostgresConnection.connect(configuration: pgConfig, id: nextID, logger: logger)
        connections[db] = conn
        connectionOrder.append(db)
        // Enforce the max-5 pool rule from GEMINI.md.
        while connectionOrder.count > Self.maxConnections {
            let evict = connectionOrder.removeFirst()
            if let old = connections.removeValue(forKey: evict) { try? await old.close() }
        }
        return conn
    }

    public func execute(_ query: String, database: String?) async throws -> QueryResult {
        let conn = try await connection(for: database)
        let start = Date()
        let result: PostgresQueryResult
        do {
            result = try await conn.query(query, []).get()
        } catch let error as PSQLError {
            throw DatabaseError(Self.describe(error))
        }

        let duration = Date().timeIntervalSince(start)
        guard let first = result.rows.first else {
            let affected = result.metadata.command == "SELECT" ? 0 : (result.metadata.rows ?? 0)
            return QueryResult(rowCount: affected, duration: duration)
        }

        let columns = first.map { ColumnDef(name: $0.columnName, type: $0.dataType.knownSQLName ?? "\($0.dataType.rawValue)") }
        var rows: [[CellValue]] = []
        rows.reserveCapacity(min(result.rows.count, QueryGuard.maxRows + 1))
        for row in result.rows.prefix(QueryGuard.maxRows + 1) {
            rows.append(row.map(Self.value))
        }
        return QueryResult(columns: columns, rows: rows, rowCount: result.rows.count, duration: duration)
    }

    static func describe(_ error: PSQLError) -> String {
        if let server = error.serverInfo {
            let message = server[.message] ?? "Server error"
            if let detail = server[.detail] { return "\(message)\n\(detail)" }
            return message
        }
        return String(reflecting: error.code)
    }

    static func value(_ cell: PostgresCell) -> CellValue {
        guard let bytes = cell.bytes else { return .null }
        if cell.format == .text { return .text(String(buffer: bytes)) }
        switch cell.dataType {
        case .bool:
            return (try? cell.decode(Bool.self)).map(CellValue.bool) ?? .null
        case .int2, .int4, .int8, .oid:
            return (try? cell.decode(Int64.self)).map(CellValue.integer) ?? .null
        case .float4, .float8:
            return (try? cell.decode(Double.self)).map(CellValue.double) ?? .null
        case .numeric:
            return (try? cell.decode(Decimal.self)).map { .text("\($0)") } ?? .null
        case .uuid:
            return (try? cell.decode(UUID.self)).map { .text($0.uuidString.lowercased()) } ?? .null
        case .text, .varchar, .bpchar, .name, .json:
            return .text(String(buffer: bytes))
        case .jsonb:
            var b = bytes
            b.moveReaderIndex(forwardBy: 1) // jsonb version byte
            return .text(String(buffer: b))
        case .timestamp, .timestamptz:
            return (try? cell.decode(Date.self)).map { .text(DateFormatting.timestamp.string(from: $0)) } ?? .null
        case .date:
            return (try? cell.decode(Date.self)).map { .text(DateFormatting.date.string(from: $0)) } ?? .null
        case .bytea:
            return .blob(bytes.readableBytes)
        default:
            let data = PostgresData(type: cell.dataType, formatCode: cell.format, value: bytes)
            return .text(data.description)
        }
    }

    public func databases() async throws -> [String] {
        let sql = type == .cockroachdb
            ? "SELECT database_name FROM [SHOW DATABASES] ORDER BY 1"
            : "SELECT datname FROM pg_database WHERE datistemplate = false ORDER BY datname"
        return try await execute(sql, database: nil).rows.map { $0[0].description }
    }

    public func tables(database: String?) async throws -> [TableInfo] {
        let sql = """
        SELECT table_schema, table_name, table_type FROM information_schema.tables
        WHERE table_schema NOT IN ('pg_catalog', 'information_schema', 'crdb_internal', 'pg_extension')
        ORDER BY table_schema, table_name
        """
        return try await execute(sql, database: database).rows.map {
            TableInfo(name: $0[1].description, kind: $0[2].description.contains("VIEW") ? .view : .table,
                      schema: $0[0].description)
        }
    }

    public func columns(table: TableInfo, database: String?) async throws -> [ColumnInfo] {
        let schema = SQLIdent.literal(table.schema ?? "public")
        let name = SQLIdent.literal(table.name)
        let sql = """
        SELECT c.column_name, c.data_type, c.is_nullable, c.column_default,
          EXISTS (
            SELECT 1 FROM information_schema.table_constraints tc
            JOIN information_schema.key_column_usage k
              ON tc.constraint_name = k.constraint_name AND tc.table_schema = k.table_schema
            WHERE tc.constraint_type = 'PRIMARY KEY' AND tc.table_schema = c.table_schema
              AND tc.table_name = c.table_name AND k.column_name = c.column_name
          ) AS is_pk
        FROM information_schema.columns c
        WHERE c.table_schema = \(schema) AND c.table_name = \(name)
        ORDER BY c.ordinal_position
        """
        return try await execute(sql, database: database).rows.map { r in
            ColumnInfo(name: r[0].description, type: r[1].description, nullable: r[2].description == "YES",
                       primaryKey: r[4] == .bool(true), defaultValue: r[3].isNull ? nil : r[3].description)
        }
    }

    public func serverVersion() async throws -> String {
        try await execute("SELECT version()", database: nil).rows.first?.first?.description ?? "unknown"
    }

    public func previewQuery(for table: TableInfo, database: String?, limit: Int) -> String {
        let qualified = [table.schema, table.name].compactMap { $0 }.map { SQLIdent.quote($0) }.joined(separator: ".")
        return "SELECT * FROM \(qualified) LIMIT \(limit);"
    }
}

enum DateFormatting {
    static let timestamp: ISO8601DateFormatter = {
        let f = ISO8601DateFormatter()
        f.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
        return f
    }()

    static let date: DateFormatter = {
        let f = DateFormatter()
        f.locale = Locale(identifier: "en_US_POSIX")
        f.timeZone = TimeZone(identifier: "UTC")
        f.dateFormat = "yyyy-MM-dd"
        return f
    }()
}
