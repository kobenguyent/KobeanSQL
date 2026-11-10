import Foundation

/// Owns live driver instances and applies the shared safety guards
/// (auto LIMIT, row cap, timeouts) — the native twin of `ConnectionManager` in `src/main/db/manager.ts`.
public actor ConnectionManager {
    private var drivers: [String: any DatabaseDriver] = [:]

    public init() {}

    public func isConnected(_ id: String) -> Bool { drivers[id] != nil }

    /// Opens a connection (replacing any existing one for the same id).
    public func connect(_ config: ConnectionConfig) async throws -> String {
        await disconnect(config.id)
        let driver = try DriverFactory.make(for: config)
        try await QueryGuard.withTimeout(QueryGuard.connectTimeout + 1,
                                         message: "Connection timed out after \(Int(QueryGuard.connectTimeout))s") {
            try await driver.connect(config)
        }
        drivers[config.id] = driver
        return (try? await driver.serverVersion()) ?? config.type.displayName
    }

    /// Connects, reads the server version, and disconnects — used by "Test Connection".
    public static func test(_ config: ConnectionConfig) async throws -> String {
        let driver = try DriverFactory.make(for: config)
        try await QueryGuard.withTimeout(QueryGuard.connectTimeout + 1, message: "Connection timed out") {
            try await driver.connect(config)
        }
        let version = (try? await driver.serverVersion()) ?? "OK"
        await driver.disconnect()
        return version
    }

    public func disconnect(_ id: String) async {
        if let driver = drivers.removeValue(forKey: id) { await driver.disconnect() }
    }

    public func disconnectAll() async {
        for id in drivers.keys { await disconnect(id) }
    }

    private func driver(_ id: String) throws -> any DatabaseDriver {
        guard let d = drivers[id] else { throw DatabaseError("Not connected") }
        return d
    }

    /// Runs every statement in `text` sequentially and returns one result per statement.
    /// Stops at the first failure (earlier results are kept on the returned error).
    public func run(_ text: String, connectionID id: String, type: DatabaseType, database: String?,
                    autoLimit: Bool = true) async throws -> [QueryResult] {
        let driver = try driver(id)
        let statements = StatementSplitter.split(text, type: type)
        guard !statements.isEmpty else { throw DatabaseError("Nothing to run") }
        var results: [QueryResult] = []
        for statement in statements {
            let sql = autoLimit ? QueryGuard.applySafetyLimit(statement, type: type) : statement
            do {
                var result = try await QueryGuard.withTimeout(
                    QueryGuard.queryTimeout,
                    message: "Query timed out after \(Int(QueryGuard.queryTimeout))s"
                ) { try await driver.execute(sql, database: database) }
                result.executedQuery = sql
                if sql != statement {
                    result.notice = [result.notice, "LIMIT \(QueryGuard.autoLimit) added automatically."]
                        .compactMap { $0 }.joined(separator: " ")
                }
                results.append(QueryGuard.capRows(result))
            } catch {
                throw StatementFailure(statement: statement, index: results.count, underlying: error, previous: results)
            }
        }
        return results
    }

    public func databases(_ id: String) async throws -> [String] {
        try await driver(id).databases()
    }

    public func tables(_ id: String, database: String?) async throws -> [TableInfo] {
        try await driver(id).tables(database: database)
    }

    public func columns(_ id: String, table: TableInfo, database: String?) async throws -> [ColumnInfo] {
        try await driver(id).columns(table: table, database: database)
    }

    public func previewQuery(_ id: String, table: TableInfo, database: String?, limit: Int) async throws -> String {
        let d = try driver(id)
        if let redis = d as? RedisDriver {
            return try await redis.readCommand(forKey: table.name, database: database, limit: limit)
        }
        return await d.previewQuery(for: table, database: database, limit: limit)
    }
}

public struct StatementFailure: LocalizedError, Sendable {
    public var statement: String
    public var index: Int
    public var message: String
    public var previous: [QueryResult]

    init(statement: String, index: Int, underlying: Error, previous: [QueryResult]) {
        self.statement = statement
        self.index = index
        self.message = (underlying as? LocalizedError)?.errorDescription ?? String(describing: underlying)
        self.previous = previous
    }

    public var errorDescription: String? {
        index == 0 ? message : "Statement \(index + 1) failed: \(message)"
    }
}
