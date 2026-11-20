import Foundation

public struct ConnectOutcome: Equatable, Sendable {
    public var serverVersion: String
    public var detectedType: DatabaseType
    public var resolvedConfig: ConnectionConfig
    public var detectionDetail: String?

    public init(
        serverVersion: String,
        detectedType: DatabaseType,
        resolvedConfig: ConnectionConfig,
        detectionDetail: String? = nil
    ) {
        self.serverVersion = serverVersion
        self.detectedType = detectedType
        self.resolvedConfig = resolvedConfig
        self.detectionDetail = detectionDetail
    }
}

public struct AutoDisconnectPolicy: Equatable, Sendable {
    public var enabled: Bool
    public var idleTimeoutSeconds: TimeInterval
    public var sweepIntervalSeconds: TimeInterval

    public init(
        enabled: Bool = true,
        idleTimeoutSeconds: TimeInterval = 15 * 60,
        sweepIntervalSeconds: TimeInterval = 15
    ) {
        self.enabled = enabled
        self.idleTimeoutSeconds = max(1, idleTimeoutSeconds)
        self.sweepIntervalSeconds = max(0.05, sweepIntervalSeconds)
    }
}

public struct AutoDisconnectEvent: Equatable, Sendable {
    public var connectionID: String
    public var idleSeconds: TimeInterval
    public var reason: String

    public init(connectionID: String, idleSeconds: TimeInterval, reason: String) {
        self.connectionID = connectionID
        self.idleSeconds = idleSeconds
        self.reason = reason
    }
}

/// Owns live driver instances, applies shared safety guards (auto LIMIT, row cap, timeouts),
/// auto-recognizes the database engine on connect/test, and automatically disconnects idle
/// connections so sessions never linger indefinitely.
public actor ConnectionManager {
    private var drivers: [String: any DatabaseDriver] = [:]
    private var lastActivityAt: [String: Date] = [:]
    private var inFlightOperations: [String: Int] = [:]
    private var autoDisconnectPolicy: AutoDisconnectPolicy
    private var autoDisconnectHandler: (@Sendable (AutoDisconnectEvent) -> Void)?
    private var idleSweeperTask: Task<Void, Never>?

    public init(autoDisconnectPolicy: AutoDisconnectPolicy = AutoDisconnectPolicy()) {
        self.autoDisconnectPolicy = autoDisconnectPolicy
    }

    deinit {
        idleSweeperTask?.cancel()
    }

    public func isConnected(_ id: String) -> Bool { drivers[id] != nil }

    public func connectedIDs() -> [String] { Array(drivers.keys) }

    public func currentAutoDisconnectPolicy() -> AutoDisconnectPolicy { autoDisconnectPolicy }

    /// Configures idle auto-disconnection and starts/restarts the background sweeper.
    public func configureAutoDisconnect(
        enabled: Bool,
        timeoutSeconds: TimeInterval,
        sweepIntervalSeconds: TimeInterval = 15
    ) {
        autoDisconnectPolicy = AutoDisconnectPolicy(
            enabled: enabled,
            idleTimeoutSeconds: timeoutSeconds,
            sweepIntervalSeconds: sweepIntervalSeconds
        )
        restartIdleSweeper()
    }

    /// Registers a callback invoked whenever an idle connection is automatically disconnected.
    public func setAutoDisconnectHandler(_ handler: (@Sendable (AutoDisconnectEvent) -> Void)?) {
        autoDisconnectHandler = handler
        restartIdleSweeper()
    }

    /// Refreshes the last-activity timestamp for an active connection.
    public func touch(_ id: String, at now: Date = Date()) {
        guard drivers[id] != nil else { return }
        lastActivityAt[id] = now
    }

    /// Returns how long (in seconds) a connected session has been idle.
    public func idleSeconds(for id: String, now: Date = Date()) -> TimeInterval? {
        guard drivers[id] != nil, let last = lastActivityAt[id] else { return nil }
        return max(0, now.timeIntervalSince(last))
    }

    private func beginOperation(_ id: String) {
        lastActivityAt[id] = Date()
        inFlightOperations[id, default: 0] += 1
    }

    private func endOperation(_ id: String) {
        if let count = inFlightOperations[id] {
            if count <= 1 {
                inFlightOperations.removeValue(forKey: id)
            } else {
                inFlightOperations[id] = count - 1
            }
        }
        if drivers[id] != nil {
            lastActivityAt[id] = Date()
        }
    }

    private func restartIdleSweeper() {
        idleSweeperTask?.cancel()
        idleSweeperTask = nil
        guard autoDisconnectPolicy.enabled else { return }
        let intervalNs = UInt64(max(0.05, autoDisconnectPolicy.sweepIntervalSeconds) * 1_000_000_000)
        idleSweeperTask = Task { [weak self] in
            while !Task.isCancelled {
                try? await Task.sleep(nanoseconds: intervalNs)
                guard !Task.isCancelled, let self else { break }
                _ = await self.sweepIdleConnections()
            }
        }
    }

    /// Disconnects any active connection that has exceeded the configured idle timeout
    /// and has no in-flight queries or metadata operations.
    @discardableResult
    public func sweepIdleConnections(now: Date = Date()) async -> [AutoDisconnectEvent] {
        guard autoDisconnectPolicy.enabled else { return [] }
        let threshold = autoDisconnectPolicy.idleTimeoutSeconds
        var expired: [(id: String, idle: TimeInterval)] = []

        for (id, lastUsed) in lastActivityAt where drivers[id] != nil {
            if (inFlightOperations[id] ?? 0) > 0 { continue }
            let idle = now.timeIntervalSince(lastUsed)
            if idle >= threshold {
                expired.append((id, idle))
            }
        }

        var events: [AutoDisconnectEvent] = []
        for item in expired {
            await disconnect(item.id)
            let mins = max(1, Int(round(threshold / 60.0)))
            let reason = threshold >= 60
                ? "Auto-disconnected after \(mins)m of inactivity"
                : "Auto-disconnected after \(Int(round(threshold)))s of inactivity"
            let event = AutoDisconnectEvent(connectionID: item.id, idleSeconds: item.idle, reason: reason)
            events.append(event)
            autoDisconnectHandler?(event)
        }
        return events
    }

    // MARK: - Connect & Auto Engine Recognition

    /// Opens a connection (replacing any existing one for the same id).
    public func connect(_ config: ConnectionConfig) async throws -> String {
        let outcome = try await connectWithDetection(config)
        return outcome.serverVersion
    }

    /// Opens a connection while automatically recognizing the database engine from URI schemes,
    /// SQLite files, wire-protocol probes, and server version banners so the proper driver and
    /// configuration are always used.
    public func connectWithDetection(_ config: ConnectionConfig) async throws -> ConnectOutcome {
        await disconnect(config.id)
        let (driver, outcome) = try await Self.openAndDetect(config)
        drivers[config.id] = driver
        lastActivityAt[config.id] = Date()
        restartIdleSweeper()
        return outcome
    }

    /// Connects, reads the server version, and disconnects — used by "Test Connection".
    public static func test(_ config: ConnectionConfig) async throws -> String {
        let outcome = try await testWithDetection(config)
        return outcome.serverVersion
    }

    /// Tests a connection and returns both server version and any auto-recognized engine configuration.
    public static func testWithDetection(_ config: ConnectionConfig) async throws -> ConnectOutcome {
        let (driver, outcome) = try await openAndDetect(config)
        await driver.disconnect()
        return outcome
    }

    private static func openAndDetect(_ rawConfig: ConnectionConfig) async throws -> (any DatabaseDriver, ConnectOutcome) {
        var effectiveConfig = rawConfig
        var detectionDetail: String?

        // 1. Pre-connect static recognition for explicit URI schemes or SQLite file paths
        if !DemoDatabaseCatalog.isDemo(rawConfig) {
            if let uri = rawConfig.connectionUri?.trimmingCharacters(in: .whitespacesAndNewlines),
               !uri.isEmpty,
               let detected = DatabaseEngineDetector.detect(fromURI: uri),
               detected.confidence == .high,
               detected.engine != rawConfig.type,
               detected.engine.isSupportedNatively {
                effectiveConfig = rawConfig.applyingDetection(detected)
                detectionDetail = detected.detail
            } else if rawConfig.type != .sqlite,
                      let file = rawConfig.filename?.trimmingCharacters(in: .whitespacesAndNewlines),
                      !file.isEmpty,
                      let detected = DatabaseEngineDetector.detect(fromFilePath: file) {
                effectiveConfig = rawConfig.applyingDetection(detected)
                detectionDetail = detected.detail
            }
        }

        do {
            return try await connectAndRefine(effectiveConfig, priorDetail: detectionDetail)
        } catch let initialError {
            // 2. On connection/protocol failure for real TCP endpoints, probe the endpoint live
            // to check whether another natively supported DB engine is listening there.
            guard !DemoDatabaseCatalog.isDemo(effectiveConfig),
                  let probed = await DatabaseEngineDetector.probe(config: effectiveConfig, timeout: 2.0),
                  probed.engine != effectiveConfig.type,
                  probed.engine.isSupportedNatively else {
                throw initialError
            }

            let switchedConfig = effectiveConfig.applyingDetection(probed)
            return try await connectAndRefine(switchedConfig, priorDetail: probed.detail)
        }
    }

    private static func connectAndRefine(
        _ config: ConnectionConfig,
        priorDetail: String?
    ) async throws -> (any DatabaseDriver, ConnectOutcome) {
        let initialConfig = config
        let initialDriver = try DriverFactory.make(for: initialConfig)
        try await QueryGuard.withTimeout(
            QueryGuard.connectTimeout + 1,
            message: "Connection timed out after \(Int(QueryGuard.connectTimeout))s"
        ) {
            try await initialDriver.connect(initialConfig)
        }

        let version = (try? await initialDriver.serverVersion()) ?? initialConfig.type.displayName
        var activeConfig = initialConfig
        var activeDriver: any DatabaseDriver = initialDriver
        var detail = priorDetail

        // 3. Post-connect server version refinement (MySQL <-> MariaDB, PostgreSQL -> CockroachDB)
        if !DemoDatabaseCatalog.isDemo(initialConfig),
           let refined = DatabaseEngineDetector.refineFromServerVersion(version, currentType: initialConfig.type),
           refined.engine != initialConfig.type,
           refined.engine.isSupportedNatively {
            await initialDriver.disconnect()
            let nextConfig = initialConfig.applyingDetection(refined)
            let refinedDriver = try DriverFactory.make(for: nextConfig)
            try await QueryGuard.withTimeout(
                QueryGuard.connectTimeout + 1,
                message: "Connection timed out after \(Int(QueryGuard.connectTimeout))s"
            ) {
                try await refinedDriver.connect(nextConfig)
            }
            activeConfig = nextConfig
            activeDriver = refinedDriver
            detail = refined.detail
        }

        let outcome = ConnectOutcome(
            serverVersion: version,
            detectedType: activeConfig.type,
            resolvedConfig: activeConfig,
            detectionDetail: detail
        )
        return (activeDriver, outcome)
    }

    // MARK: - Disconnect & Query Execution

    public func disconnect(_ id: String) async {
        lastActivityAt.removeValue(forKey: id)
        inFlightOperations.removeValue(forKey: id)
        if let driver = drivers.removeValue(forKey: id) {
            await driver.disconnect()
        }
        if drivers.isEmpty {
            idleSweeperTask?.cancel()
            idleSweeperTask = nil
        }
    }

    public func disconnectAll() async {
        let ids = Array(drivers.keys)
        for id in ids {
            await disconnect(id)
        }
    }

    private func driver(_ id: String) throws -> any DatabaseDriver {
        guard let d = drivers[id] else { throw DatabaseError("Not connected") }
        return d
    }

    /// Runs every statement in `text` sequentially and returns one result per statement.
    /// Stops at the first failure (earlier results are kept on the returned error).
    public func run(_ text: String, connectionID id: String, type: DatabaseType, database: String?,
                    autoLimit: Bool = true, timeout: TimeInterval = QueryGuard.queryTimeout) async throws -> [QueryResult] {
        let driver = try driver(id)
        let statements = StatementSplitter.split(text, type: type)
        guard !statements.isEmpty else { throw DatabaseError("Nothing to run") }
        let effectiveTimeout = max(5, min(timeout, 300))

        beginOperation(id)
        defer { endOperation(id) }

        var results: [QueryResult] = []
        for statement in statements {
            try Task.checkCancellation()
            let sql = autoLimit ? QueryGuard.applySafetyLimit(statement, type: type) : statement
            do {
                var result = try await QueryGuard.withTimeout(
                    effectiveTimeout,
                    message: "Query timed out after \(Int(effectiveTimeout))s (aborted to prevent DB/UI hang)"
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
        let d = try driver(id)
        beginOperation(id)
        defer { endOperation(id) }
        return try await d.databases()
    }

    public func tables(_ id: String, database: String?) async throws -> [TableInfo] {
        let d = try driver(id)
        beginOperation(id)
        defer { endOperation(id) }
        return try await d.tables(database: database)
    }

    public func columns(_ id: String, table: TableInfo, database: String?) async throws -> [ColumnInfo] {
        let d = try driver(id)
        beginOperation(id)
        defer { endOperation(id) }
        return try await d.columns(table: table, database: database)
    }

    public func foreignKeys(_ id: String, table: TableInfo, database: String?) async throws -> [ForeignKeyInfo] {
        let d = try driver(id)
        beginOperation(id)
        defer { endOperation(id) }
        return try await d.foreignKeys(table: table, database: database)
    }

    public func previewQuery(_ id: String, table: TableInfo, database: String?, limit: Int) async throws -> String {
        let d = try driver(id)
        beginOperation(id)
        defer { endOperation(id) }
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
