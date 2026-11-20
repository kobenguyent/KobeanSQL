import Foundation
import NIOCore
import NIOPosix

public struct EngineDetectionResult: Equatable, Sendable {
    public enum Confidence: String, Codable, Sendable {
        case high
        case medium
        case low
    }

    public enum Source: String, Codable, Sendable {
        case uriScheme
        case fileMagic
        case fileExtension
        case wireProtocol
        case httpProbe
        case serverVersion
        case hostnameHint
        case defaultPort
    }

    public var engine: DatabaseType
    public var confidence: Confidence
    public var source: Source
    public var detail: String
    public var suggestedPort: Int?
    public var suggestedSSL: Bool?
    public var parsedURI: ConnectionURI.Parsed?
    public var filePath: String?

    public init(
        engine: DatabaseType,
        confidence: Confidence,
        source: Source,
        detail: String,
        suggestedPort: Int? = nil,
        suggestedSSL: Bool? = nil,
        parsedURI: ConnectionURI.Parsed? = nil,
        filePath: String? = nil
    ) {
        self.engine = engine
        self.confidence = confidence
        self.source = source
        self.detail = detail
        self.suggestedPort = suggestedPort
        self.suggestedSSL = suggestedSSL
        self.parsedURI = parsedURI
        self.filePath = filePath
    }
}

/// Automatically recognizes the database engine from connection URIs, file paths/magic headers,
/// cloud hostnames, default ports, live TCP wire-protocol handshakes, HTTP endpoints, and server versions.
public enum DatabaseEngineDetector {
    private static let sqliteMagicHeader = Data("SQLite format 3\0".utf8)
    private static let sqliteExtensions: Set<String> = ["sqlite", "sqlite3", "db", "s3db", "sl3"]

    // MARK: - Static Detection (Zero Network I/O except optional local SQLite file header read)

    public static func detect(fromURI rawURI: String?) -> EngineDetectionResult? {
        guard let raw = rawURI?.trimmingCharacters(in: .whitespacesAndNewlines), !raw.isEmpty else {
            return nil
        }

        // Plain file path pasted into URI field
        if !raw.contains("://") {
            return detect(fromFilePath: raw)
        }

        guard let any = ConnectionURI.parseAny(raw) else { return nil }
        let scheme = any.scheme
        let parsed = any.parsed
        let hostLower = parsed.host?.lowercased() ?? ""

        switch scheme {
        case "postgres", "postgresql", "pg":
            if parsed.port == 26257 || hostLower.contains("cockroach") {
                return EngineDetectionResult(
                    engine: .cockroachdb,
                    confidence: .high,
                    source: .uriScheme,
                    detail: "Recognized CockroachDB from URI (\(scheme):// on Cockroach endpoint)",
                    suggestedPort: parsed.port ?? 26257,
                    suggestedSSL: parsed.ssl ?? (hostLower.contains("cockroachlabs.cloud") ? true : nil),
                    parsedURI: parsed
                )
            }
            let cloudSSL = (hostLower.hasSuffix(".neon.tech") || hostLower.hasSuffix(".supabase.co") || hostLower.hasSuffix(".supabase.com")) ? true : nil
            return EngineDetectionResult(
                engine: .postgres,
                confidence: .high,
                source: .uriScheme,
                detail: "Recognized PostgreSQL from URI scheme \(scheme)://",
                suggestedPort: parsed.port ?? 5432,
                suggestedSSL: parsed.ssl ?? cloudSSL,
                parsedURI: parsed
            )

        case "cockroachdb", "cockroach":
            return EngineDetectionResult(
                engine: .cockroachdb,
                confidence: .high,
                source: .uriScheme,
                detail: "Recognized CockroachDB from URI scheme \(scheme)://",
                suggestedPort: parsed.port ?? 26257,
                suggestedSSL: parsed.ssl,
                parsedURI: parsed
            )

        case "mariadb":
            return EngineDetectionResult(
                engine: .mariadb,
                confidence: .high,
                source: .uriScheme,
                detail: "Recognized MariaDB from URI scheme mariadb://",
                suggestedPort: parsed.port ?? 3306,
                suggestedSSL: parsed.ssl,
                parsedURI: parsed
            )

        case "mysql", "mysql2":
            return EngineDetectionResult(
                engine: .mysql,
                confidence: .high,
                source: .uriScheme,
                detail: "Recognized MySQL from URI scheme \(scheme)://",
                suggestedPort: parsed.port ?? 3306,
                suggestedSSL: parsed.ssl,
                parsedURI: parsed
            )

        case "mssql", "sqlserver", "tds":
            return EngineDetectionResult(
                engine: .mssql,
                confidence: .high,
                source: .uriScheme,
                detail: "Recognized SQL Server from URI scheme \(scheme)://",
                suggestedPort: parsed.port ?? 1433,
                suggestedSSL: parsed.ssl,
                parsedURI: parsed
            )

        case "sqlite", "sqlite3":
            return EngineDetectionResult(
                engine: .sqlite,
                confidence: .high,
                source: .uriScheme,
                detail: "Recognized SQLite from URI scheme \(scheme)://",
                parsedURI: parsed,
                filePath: any.filePath
            )

        case "file":
            if let fp = any.filePath, let fileMatch = detect(fromFilePath: fp) {
                return fileMatch
            }
            return nil

        case "mongodb", "mongodb+srv":
            return EngineDetectionResult(
                engine: .mongodb,
                confidence: .high,
                source: .uriScheme,
                detail: "Recognized MongoDB from URI scheme \(scheme)://",
                suggestedPort: parsed.port ?? (scheme == "mongodb+srv" ? nil : 27017),
                suggestedSSL: parsed.ssl ?? (scheme == "mongodb+srv" ? true : nil),
                parsedURI: parsed
            )

        case "redis", "rediss":
            return EngineDetectionResult(
                engine: .redis,
                confidence: .high,
                source: .uriScheme,
                detail: "Recognized Redis from URI scheme \(scheme)://",
                suggestedPort: parsed.port ?? 6379,
                suggestedSSL: parsed.ssl ?? (scheme == "rediss" ? true : nil),
                parsedURI: parsed
            )

        case "clickhouse", "clickhouses":
            return EngineDetectionResult(
                engine: .clickhouse,
                confidence: .high,
                source: .uriScheme,
                detail: "Recognized ClickHouse from URI scheme \(scheme)://",
                suggestedPort: parsed.port ?? (scheme == "clickhouses" ? 8443 : 8123),
                suggestedSSL: parsed.ssl ?? (scheme == "clickhouses" ? true : nil),
                parsedURI: parsed
            )

        case "cassandra":
            return EngineDetectionResult(
                engine: .cassandra,
                confidence: .high,
                source: .uriScheme,
                detail: "Recognized Cassandra from URI scheme cassandra://",
                suggestedPort: parsed.port ?? 9042,
                suggestedSSL: parsed.ssl,
                parsedURI: parsed
            )

        case "elasticsearch", "es", "opensearch":
            return EngineDetectionResult(
                engine: .elasticsearch,
                confidence: .high,
                source: .uriScheme,
                detail: "Recognized Elasticsearch from URI scheme \(scheme)://",
                suggestedPort: parsed.port ?? 9200,
                suggestedSSL: parsed.ssl,
                parsedURI: parsed
            )

        case "oracle", "oracle+thin":
            return EngineDetectionResult(
                engine: .oracle,
                confidence: .high,
                source: .uriScheme,
                detail: "Recognized Oracle from URI scheme \(scheme)://",
                suggestedPort: parsed.port ?? 1521,
                suggestedSSL: parsed.ssl,
                parsedURI: parsed
            )

        case "influxdb", "influx":
            return EngineDetectionResult(
                engine: .influxdb,
                confidence: .high,
                source: .uriScheme,
                detail: "Recognized InfluxDB from URI scheme \(scheme)://",
                suggestedPort: parsed.port ?? 8086,
                suggestedSSL: parsed.ssl,
                parsedURI: parsed
            )

        case "neo4j", "neo4j+s", "neo4j+ssc", "bolt", "bolt+s", "bolt+ssc":
            let isSecure = scheme.contains("+s")
            return EngineDetectionResult(
                engine: .neo4j,
                confidence: .high,
                source: .uriScheme,
                detail: "Recognized Neo4j from URI scheme \(scheme)://",
                suggestedPort: parsed.port ?? 7474,
                suggestedSSL: parsed.ssl ?? (isSecure ? true : nil),
                parsedURI: parsed
            )

        case "snowflake":
            return EngineDetectionResult(
                engine: .snowflake,
                confidence: .high,
                source: .uriScheme,
                detail: "Recognized Snowflake from URI scheme snowflake://",
                suggestedSSL: true,
                parsedURI: parsed
            )

        case "http", "https":
            let ssl = scheme == "https"
            if let hostMatch = detect(fromHostname: hostLower) {
                return EngineDetectionResult(
                    engine: hostMatch.engine,
                    confidence: .high,
                    source: .hostnameHint,
                    detail: "Recognized \(hostMatch.engine.displayName) from \(scheme):// hostname",
                    suggestedPort: parsed.port ?? hostMatch.engine.defaultPort,
                    suggestedSSL: ssl,
                    parsedURI: parsed
                )
            }
            if let port = parsed.port {
                switch port {
                case 8123, 8443:
                    return EngineDetectionResult(
                        engine: .clickhouse,
                        confidence: .medium,
                        source: .defaultPort,
                        detail: "Recognized ClickHouse from \(scheme):// port \(port)",
                        suggestedPort: port,
                        suggestedSSL: ssl,
                        parsedURI: parsed
                    )
                case 9200, 9243:
                    return EngineDetectionResult(
                        engine: .elasticsearch,
                        confidence: .medium,
                        source: .defaultPort,
                        detail: "Recognized Elasticsearch from \(scheme):// port \(port)",
                        suggestedPort: port,
                        suggestedSSL: ssl,
                        parsedURI: parsed
                    )
                case 8086:
                    return EngineDetectionResult(
                        engine: .influxdb,
                        confidence: .medium,
                        source: .defaultPort,
                        detail: "Recognized InfluxDB from \(scheme):// port 8086",
                        suggestedPort: port,
                        suggestedSSL: ssl,
                        parsedURI: parsed
                    )
                case 7474, 7473:
                    return EngineDetectionResult(
                        engine: .neo4j,
                        confidence: .medium,
                        source: .defaultPort,
                        detail: "Recognized Neo4j from \(scheme):// port \(port)",
                        suggestedPort: port,
                        suggestedSSL: ssl,
                        parsedURI: parsed
                    )
                default:
                    break
                }
            }
            return nil

        default:
            return nil
        }
    }

    public static func detect(fromFilePath rawPath: String?) -> EngineDetectionResult? {
        guard let trimmed = rawPath?.trimmingCharacters(in: .whitespacesAndNewlines), !trimmed.isEmpty else {
            return nil
        }
        if trimmed == ":memory:" {
            return EngineDetectionResult(
                engine: .sqlite,
                confidence: .high,
                source: .fileExtension,
                detail: "Recognized in-memory SQLite database",
                filePath: trimmed
            )
        }

        let expanded = (trimmed as NSString).expandingTildeInPath
        if FileManager.default.fileExists(atPath: expanded),
           let handle = FileHandle(forReadingAtPath: expanded) {
            defer { try? handle.close() }
            if let header = try? handle.read(upToCount: sqliteMagicHeader.count),
               header == sqliteMagicHeader {
                return EngineDetectionResult(
                    engine: .sqlite,
                    confidence: .high,
                    source: .fileMagic,
                    detail: "Verified SQLite 3 database file header",
                    filePath: expanded
                )
            }
        }

        let ext = URL(fileURLWithPath: expanded).pathExtension.lowercased()
        if sqliteExtensions.contains(ext) {
            return EngineDetectionResult(
                engine: .sqlite,
                confidence: .high,
                source: .fileExtension,
                detail: "Recognized SQLite from .\(ext) file path",
                filePath: expanded
            )
        }
        return nil
    }

    public static func detect(fromHostname rawHost: String?) -> EngineDetectionResult? {
        guard let host = rawHost?.trimmingCharacters(in: .whitespacesAndNewlines).lowercased(), !host.isEmpty else {
            return nil
        }

        if host.contains("snowflakecomputing.com") {
            return EngineDetectionResult(engine: .snowflake, confidence: .high, source: .hostnameHint, detail: "Recognized Snowflake cloud hostname", suggestedSSL: true)
        }
        if host.contains("cockroachlabs.cloud") || host.contains("cockroach") {
            return EngineDetectionResult(engine: .cockroachdb, confidence: .high, source: .hostnameHint, detail: "Recognized CockroachDB hostname", suggestedPort: 26257, suggestedSSL: host.contains("cockroachlabs.cloud") ? true : nil)
        }
        if host.contains("mongodb.net") || host.contains("mongodb.com") {
            return EngineDetectionResult(engine: .mongodb, confidence: .high, source: .hostnameHint, detail: "Recognized MongoDB Atlas hostname", suggestedPort: 27017, suggestedSSL: true)
        }
        if host.contains("clickhouse.cloud") || host.contains("clickhouse") {
            return EngineDetectionResult(engine: .clickhouse, confidence: .high, source: .hostnameHint, detail: "Recognized ClickHouse hostname", suggestedPort: host.contains("clickhouse.cloud") ? 8443 : 8123, suggestedSSL: host.contains("clickhouse.cloud") ? true : nil)
        }
        if host.contains("influxdata.com") || host.contains("influxdb") {
            return EngineDetectionResult(engine: .influxdb, confidence: .high, source: .hostnameHint, detail: "Recognized InfluxDB hostname", suggestedPort: 8086, suggestedSSL: host.contains("influxdata.com") ? true : nil)
        }
        if host.contains("databases.neo4j.io") || host.contains("neo4j") {
            return EngineDetectionResult(engine: .neo4j, confidence: .high, source: .hostnameHint, detail: "Recognized Neo4j hostname", suggestedPort: 7474, suggestedSSL: host.contains("neo4j.io") ? true : nil)
        }
        if host.contains("elastic-cloud.com") || host.contains("es.amazonaws.com") || host.contains("elasticsearch") {
            return EngineDetectionResult(engine: .elasticsearch, confidence: .high, source: .hostnameHint, detail: "Recognized Elasticsearch hostname", suggestedPort: 9200, suggestedSSL: host.contains("elastic-cloud.com") ? true : nil)
        }
        if host.contains("upstash.io") || host.contains("redislabs.com") || host.contains("redis.cache.windows.net") || host.contains("cache.amazonaws.com") {
            return EngineDetectionResult(engine: .redis, confidence: .high, source: .hostnameHint, detail: "Recognized Redis cloud hostname", suggestedPort: 6379, suggestedSSL: true)
        }
        if host.contains("database.windows.net") {
            return EngineDetectionResult(engine: .mssql, confidence: .high, source: .hostnameHint, detail: "Recognized Azure SQL Server hostname", suggestedPort: 1433, suggestedSSL: true)
        }
        if host.contains("neon.tech") || host.contains("supabase.co") || host.contains("supabase.com") {
            return EngineDetectionResult(engine: .postgres, confidence: .high, source: .hostnameHint, detail: "Recognized managed PostgreSQL hostname", suggestedPort: 5432, suggestedSSL: true)
        }
        return nil
    }

    public static func detect(fromPort port: Int?) -> EngineDetectionResult? {
        guard let port else { return nil }
        switch port {
        case 5432:
            return EngineDetectionResult(engine: .postgres, confidence: .medium, source: .defaultPort, detail: "Recognized PostgreSQL default port 5432", suggestedPort: 5432)
        case 26257:
            return EngineDetectionResult(engine: .cockroachdb, confidence: .medium, source: .defaultPort, detail: "Recognized CockroachDB default port 26257", suggestedPort: 26257)
        case 3306:
            return EngineDetectionResult(engine: .mysql, confidence: .medium, source: .defaultPort, detail: "Recognized MySQL/MariaDB default port 3306", suggestedPort: 3306)
        case 6379, 6380:
            return EngineDetectionResult(engine: .redis, confidence: .medium, source: .defaultPort, detail: "Recognized Redis port \(port)", suggestedPort: port, suggestedSSL: port == 6380 ? true : nil)
        case 8123, 8443:
            return EngineDetectionResult(engine: .clickhouse, confidence: .medium, source: .defaultPort, detail: "Recognized ClickHouse HTTP port \(port)", suggestedPort: port, suggestedSSL: port == 8443 ? true : nil)
        case 9200, 9243:
            return EngineDetectionResult(engine: .elasticsearch, confidence: .medium, source: .defaultPort, detail: "Recognized Elasticsearch port \(port)", suggestedPort: port, suggestedSSL: port == 9243 ? true : nil)
        case 8086:
            return EngineDetectionResult(engine: .influxdb, confidence: .medium, source: .defaultPort, detail: "Recognized InfluxDB port 8086", suggestedPort: 8086)
        case 7474, 7473, 7687:
            return EngineDetectionResult(engine: .neo4j, confidence: .medium, source: .defaultPort, detail: "Recognized Neo4j port \(port)", suggestedPort: port, suggestedSSL: port == 7473 ? true : nil)
        case 1433:
            return EngineDetectionResult(engine: .mssql, confidence: .medium, source: .defaultPort, detail: "Recognized SQL Server default port 1433", suggestedPort: 1433)
        case 27017:
            return EngineDetectionResult(engine: .mongodb, confidence: .medium, source: .defaultPort, detail: "Recognized MongoDB default port 27017", suggestedPort: 27017)
        case 9042:
            return EngineDetectionResult(engine: .cassandra, confidence: .medium, source: .defaultPort, detail: "Recognized Cassandra CQL port 9042", suggestedPort: 9042)
        case 1521:
            return EngineDetectionResult(engine: .oracle, confidence: .medium, source: .defaultPort, detail: "Recognized Oracle default port 1521", suggestedPort: 1521)
        default:
            return nil
        }
    }

    /// Best-effort static detection combining URI, file path, cloud hostname, and default port.
    public static func detectStatic(for config: ConnectionConfig) -> EngineDetectionResult? {
        if let uri = config.connectionUri?.trimmingCharacters(in: .whitespacesAndNewlines), !uri.isEmpty,
           let uriResult = detect(fromURI: uri) {
            return uriResult
        }
        if let file = config.filename?.trimmingCharacters(in: .whitespacesAndNewlines), !file.isEmpty,
           let fileResult = detect(fromFilePath: file) {
            return fileResult
        }
        if let hostResult = detect(fromHostname: config.host) {
            return hostResult
        }
        if let portResult = detect(fromPort: config.port) {
            return portResult
        }
        return nil
    }

    // MARK: - Server Version Refinement

    /// Refines wire-compatible engines after reading the actual server version banner.
    public static func refineFromServerVersion(_ version: String, currentType: DatabaseType) -> EngineDetectionResult? {
        let lower = version.lowercased()
        switch currentType {
        case .mysql:
            if lower.contains("mariadb") {
                return EngineDetectionResult(
                    engine: .mariadb,
                    confidence: .high,
                    source: .serverVersion,
                    detail: "Auto-recognized MariaDB from server version (\(version))"
                )
            }
        case .mariadb:
            if !lower.isEmpty && !lower.contains("mariadb") && lower.first?.isNumber == true {
                return EngineDetectionResult(
                    engine: .mysql,
                    confidence: .high,
                    source: .serverVersion,
                    detail: "Auto-recognized MySQL from server version (\(version))"
                )
            }
        case .postgres:
            if lower.contains("cockroachdb") {
                return EngineDetectionResult(
                    engine: .cockroachdb,
                    confidence: .high,
                    source: .serverVersion,
                    detail: "Auto-recognized CockroachDB from server version (\(version))"
                )
            }
        default:
            break
        }
        return nil
    }

    // MARK: - Live Wire-Protocol & HTTP Probing

    /// Probes a live database endpoint (file header, TCP wire-protocol handshake, or HTTP banner)
    /// to identify the actual running engine, falling back to static heuristics.
    public static func probe(config: ConnectionConfig, timeout: TimeInterval = 2.5) async -> EngineDetectionResult? {
        // 1. Check SQLite file path / magic header first
        if let file = config.filename?.trimmingCharacters(in: .whitespacesAndNewlines), !file.isEmpty,
           let fileResult = detect(fromFilePath: file) {
            return fileResult
        }

        // 2. Parse URI if provided to get concrete host/port/ssl
        var host = config.host?.trimmingCharacters(in: .whitespacesAndNewlines) ?? ""
        var port = config.port
        var ssl = config.ssl ?? false
        var staticURIDetection: EngineDetectionResult?

        if let rawURI = config.connectionUri?.trimmingCharacters(in: .whitespacesAndNewlines), !rawURI.isEmpty {
            staticURIDetection = detect(fromURI: rawURI)
            if let fp = staticURIDetection?.filePath {
                return detect(fromFilePath: fp) ?? staticURIDetection
            }
            if let any = ConnectionURI.parseAny(rawURI) {
                if let h = any.parsed.host, !h.isEmpty { host = h }
                if let p = any.parsed.port { port = p }
                if let s = any.parsed.ssl { ssl = s }
            }
        }

        let effectiveHost = host.isEmpty ? "127.0.0.1" : host
        let effectivePort = port ?? staticURIDetection?.suggestedPort ?? config.type.defaultPort

        // 3. Live network wire-protocol / HTTP probe if we have a port
        if let effectivePort, effectivePort > 0 {
            if let liveResult = await probeEndpoint(host: effectiveHost, port: effectivePort, ssl: ssl, timeout: timeout) {
                var enriched = liveResult
                if let parsed = staticURIDetection?.parsedURI {
                    enriched.parsedURI = parsed
                }
                return enriched
            }
        }

        // 4. Fallback to static recognition
        return staticURIDetection ?? detectStatic(for: config)
    }

    public static func probeEndpoint(
        host: String,
        port: Int,
        ssl: Bool = false,
        timeout: TimeInterval = 2.5
    ) async -> EngineDetectionResult? {
        // Step A: TCP wire-protocol sniff (MySQL/MariaDB server-first greeting, Postgres/Cockroach SSLRequest, Redis PING)
        if let tcpResult = await probeTCPWireProtocol(host: host, port: port, timeout: min(timeout, 2.0)) {
            return tcpResult
        }

        // Step B: HTTP-based database engines (Elasticsearch, ClickHouse, InfluxDB, Neo4j)
        if let httpResult = await probeHTTPDatabase(host: host, port: port, ssl: ssl, timeout: min(timeout, 2.0)) {
            return httpResult
        }

        return nil
    }

    private static func probeTCPWireProtocol(host: String, port: Int, timeout: TimeInterval) async -> EngineDetectionResult? {
        let group = MultiThreadedEventLoopGroup(numberOfThreads: 1)
        let result = await runTCPWireProbes(group: group, host: host, port: port, timeout: timeout)
        try? await group.shutdownGracefully()
        return result
    }

    private static func runTCPWireProbes(group: EventLoopGroup, host: String, port: Int, timeout: TimeInterval) async -> EngineDetectionResult? {

        // 1. Connect and wait briefly for server-first banner (MySQL / MariaDB)
        if let banner = await tcpExchange(group: group, host: host, port: port, payload: nil, connectTimeout: timeout, readTimeout: 0.35),
           let mysqlResult = parseMySQLGreeting(banner, port: port) {
            return mysqlResult
        }

        // 2. PostgreSQL / CockroachDB SSLRequest packet: [0,0,0,8, 4,210,22,47] -> 1-byte 'S' or 'N'
        let pgSSLRequest: [UInt8] = [0x00, 0x00, 0x00, 0x08, 0x04, 0xd2, 0x16, 0x2f]
        if let pgReply = await tcpExchange(group: group, host: host, port: port, payload: pgSSLRequest, connectTimeout: timeout, readTimeout: 0.5),
           pgReply.count == 1,
           (pgReply[0] == UInt8(ascii: "S") || pgReply[0] == UInt8(ascii: "N")) {
            let isCockroach = (port == 26257)
            return EngineDetectionResult(
                engine: isCockroach ? .cockroachdb : .postgres,
                confidence: .high,
                source: .wireProtocol,
                detail: isCockroach
                    ? "Detected CockroachDB (PostgreSQL wire protocol on port \(port))"
                    : "Detected PostgreSQL wire protocol on \(host):\(port)",
                suggestedPort: port,
                suggestedSSL: pgReply[0] == UInt8(ascii: "S") ? nil : false
            )
        }

        // 3. Redis RESP PING\r\n -> +PONG / -NOAUTH / -ERR
        let redisPing = Array("PING\r\n".utf8)
        if let redisReply = await tcpExchange(group: group, host: host, port: port, payload: redisPing, connectTimeout: timeout, readTimeout: 0.5),
           let text = String(data: Data(redisReply), encoding: .utf8) {
            if text.hasPrefix("+PONG") || text.hasPrefix("-NOAUTH") || text.hasPrefix("-WRONGPASS") || text.hasPrefix("-ERR") {
                return EngineDetectionResult(
                    engine: .redis,
                    confidence: .high,
                    source: .wireProtocol,
                    detail: "Detected Redis RESP protocol on \(host):\(port)",
                    suggestedPort: port
                )
            }
        }

        // 4. Cassandra native protocol v4 OPTIONS frame -> 0x84 ... SUPPORTED (opcode 0x06)
        let cassandraOptions: [UInt8] = [0x04, 0x00, 0x00, 0x00, 0x05, 0x00, 0x00, 0x00, 0x00]
        if let casReply = await tcpExchange(group: group, host: host, port: port, payload: cassandraOptions, connectTimeout: timeout, readTimeout: 0.5),
           casReply.count >= 5,
           (casReply[0] & 0x80) != 0,
           casReply[4] == 0x06 {
            return EngineDetectionResult(
                engine: .cassandra,
                confidence: .high,
                source: .wireProtocol,
                detail: "Detected Apache Cassandra native CQL protocol on \(host):\(port)",
                suggestedPort: port
            )
        }

        return nil
    }

    /// Parses a MySQL/MariaDB initial handshake packet (protocol v10 = 0x0a).
    public static func parseMySQLGreeting(_ bytes: [UInt8], port: Int) -> EngineDetectionResult? {
        // MySQL packet header: 3-byte payload length + 1-byte seq (0x00) + protocol version (0x0a) + null-terminated version string
        guard bytes.count >= 10, bytes[3] == 0x00, bytes[4] == 0x0a else {
            return nil
        }
        guard let nulIndex = bytes[5...].firstIndex(of: 0x00) else { return nil }
        let versionBytes = bytes[5..<nulIndex]
        guard let versionStr = String(bytes: versionBytes, encoding: .utf8), !versionStr.isEmpty else {
            return nil
        }
        let isMaria = versionStr.lowercased().contains("mariadb")
        return EngineDetectionResult(
            engine: isMaria ? .mariadb : .mysql,
            confidence: .high,
            source: .wireProtocol,
            detail: "Detected \(isMaria ? "MariaDB" : "MySQL") (\(versionStr)) via wire handshake",
            suggestedPort: port
        )
    }

    private static func tcpExchange(
        group: EventLoopGroup,
        host: String,
        port: Int,
        payload: [UInt8]?,
        connectTimeout: TimeInterval,
        readTimeout: TimeInterval
    ) async -> [UInt8]? {
        final class SniffHandler: ChannelInboundHandler, @unchecked Sendable {
            typealias InboundIn = ByteBuffer
            private let onData: ([UInt8]) -> Void
            private var fired = false

            init(onData: @escaping ([UInt8]) -> Void) {
                self.onData = onData
            }

            func channelRead(context: ChannelHandlerContext, data: NIOAny) {
                guard !fired else { return }
                var buf = unwrapInboundIn(data)
                if let bytes = buf.readBytes(length: buf.readableBytes), !bytes.isEmpty {
                    fired = true
                    onData(bytes)
                }
            }
        }

        final class OnceBox: @unchecked Sendable {
            private let lock = NSLock()
            private var resumed = false
            private var continuation: CheckedContinuation<[UInt8]?, Never>?

            func setContinuation(_ c: CheckedContinuation<[UInt8]?, Never>) {
                lock.lock()
                continuation = c
                lock.unlock()
            }

            func resolve(_ value: [UInt8]?) {
                lock.lock()
                guard !resumed else {
                    lock.unlock()
                    return
                }
                resumed = true
                let cont = continuation
                continuation = nil
                lock.unlock()
                cont?.resume(returning: value)
            }
        }

        let box = OnceBox()
        var channelRef: Channel?

        let result: [UInt8]? = await withCheckedContinuation { continuation in
            box.setContinuation(continuation)
            let bootstrap = ClientBootstrap(group: group)
                .connectTimeout(.milliseconds(Int64(max(200, connectTimeout * 1000))))
                .channelInitializer { channel in
                    channel.pipeline.addHandler(SniffHandler { bytes in
                        box.resolve(bytes)
                    })
                }

            bootstrap.connect(host: host, port: port).whenComplete { connectResult in
                switch connectResult {
                case .failure:
                    box.resolve(nil)
                case .success(let channel):
                    channelRef = channel
                    if let payload, !payload.isEmpty {
                        var buffer = channel.allocator.buffer(capacity: payload.count)
                        buffer.writeBytes(payload)
                        channel.writeAndFlush(buffer, promise: nil)
                    }
                    channel.eventLoop.scheduleTask(in: .milliseconds(Int64(max(100, readTimeout * 1000)))) {
                        box.resolve(nil)
                    }
                }
            }
        }

        if let ch = channelRef {
            try? await ch.close()
        }
        return result
    }

    private static func probeHTTPDatabase(
        host: String,
        port: Int,
        ssl: Bool,
        timeout: TimeInterval
    ) async -> EngineDetectionResult? {
        let useHTTPS = ssl || port == 443 || port == 8443 || port == 9243 || port == 7473
        let scheme = useHTTPS ? "https" : "http"
        let base = "\(scheme)://\(host):\(port)"

        let config = URLSessionConfiguration.ephemeral
        config.timeoutIntervalForRequest = timeout
        config.timeoutIntervalForResource = timeout
        let session = URLSession(configuration: config)
        defer { session.invalidateAndCancel() }

        func fetch(_ path: String) async -> (HTTPURLResponse, Data)? {
            guard let url = URL(string: base + path) else { return nil }
            var req = URLRequest(url: url)
            req.httpMethod = "GET"
            req.timeoutInterval = timeout
            guard let (data, resp) = try? await session.data(for: req),
                  let http = resp as? HTTPURLResponse else {
                return nil
            }
            return (http, data)
        }

        // 1. Probe root "/" (Elasticsearch, Neo4j, ClickHouse headers)
        if let (http, data) = await fetch("/") {
            let headers = Dictionary(uniqueKeysWithValues: http.allHeaderFields.map {
                (String(describing: $0.key).lowercased(), String(describing: $0.value))
            })
            if headers["x-elastic-product"] != nil {
                return EngineDetectionResult(
                    engine: .elasticsearch,
                    confidence: .high,
                    source: .httpProbe,
                    detail: "Detected Elasticsearch via X-Elastic-Product header on \(host):\(port)",
                    suggestedPort: port,
                    suggestedSSL: useHTTPS
                )
            }
            if headers["x-clickhouse-summary"] != nil || headers["x-clickhouse-server-display-name"] != nil {
                return EngineDetectionResult(
                    engine: .clickhouse,
                    confidence: .high,
                    source: .httpProbe,
                    detail: "Detected ClickHouse HTTP interface on \(host):\(port)",
                    suggestedPort: port,
                    suggestedSSL: useHTTPS
                )
            }
            if headers["x-influxdb-version"] != nil || headers["x-influxdb-build"] != nil {
                return EngineDetectionResult(
                    engine: .influxdb,
                    confidence: .high,
                    source: .httpProbe,
                    detail: "Detected InfluxDB via HTTP header on \(host):\(port)",
                    suggestedPort: port,
                    suggestedSSL: useHTTPS
                )
            }

            if let json = try? JSONSerialization.jsonObject(with: data) as? [String: Any] {
                if json["cluster_name"] != nil && json["version"] != nil {
                    return EngineDetectionResult(
                        engine: .elasticsearch,
                        confidence: .high,
                        source: .httpProbe,
                        detail: "Detected Elasticsearch cluster on \(host):\(port)",
                        suggestedPort: port,
                        suggestedSSL: useHTTPS
                    )
                }
                if json["neo4j_version"] != nil || json["bolt_direct"] != nil || json["transaction"] != nil {
                    return EngineDetectionResult(
                        engine: .neo4j,
                        confidence: .high,
                        source: .httpProbe,
                        detail: "Detected Neo4j HTTP endpoint on \(host):\(port)",
                        suggestedPort: port,
                        suggestedSSL: useHTTPS
                    )
                }
            }
        }

        // 2. Probe "/ping" (ClickHouse returns "Ok.\n", InfluxDB returns X-Influxdb-Version)
        if let (http, data) = await fetch("/ping") {
            let headers = Dictionary(uniqueKeysWithValues: http.allHeaderFields.map {
                (String(describing: $0.key).lowercased(), String(describing: $0.value))
            })
            if headers["x-influxdb-version"] != nil || headers["x-influxdb-build"] != nil {
                return EngineDetectionResult(
                    engine: .influxdb,
                    confidence: .high,
                    source: .httpProbe,
                    detail: "Detected InfluxDB via /ping header on \(host):\(port)",
                    suggestedPort: port,
                    suggestedSSL: useHTTPS
                )
            }
            if let text = String(data: data, encoding: .utf8)?.trimmingCharacters(in: .whitespacesAndNewlines),
               text == "Ok." {
                return EngineDetectionResult(
                    engine: .clickhouse,
                    confidence: .high,
                    source: .httpProbe,
                    detail: "Detected ClickHouse via /ping response on \(host):\(port)",
                    suggestedPort: port,
                    suggestedSSL: useHTTPS
                )
            }
        }

        // 3. Probe "/health" (InfluxDB 2.x returns {"name":"influxdb", ...})
        if let (_, data) = await fetch("/health"),
           let json = try? JSONSerialization.jsonObject(with: data) as? [String: Any],
           let name = json["name"] as? String,
           name.lowercased().contains("influx") {
            return EngineDetectionResult(
                engine: .influxdb,
                confidence: .high,
                source: .httpProbe,
                detail: "Detected InfluxDB via /health endpoint on \(host):\(port)",
                suggestedPort: port,
                suggestedSSL: useHTTPS
            )
        }

        return nil
    }
}

public extension ConnectionConfig {
    /// Returns a copy of this connection updated with the proper engine configuration
    /// for a recognized `EngineDetectionResult` (type, port, default user, SSL, SQLite path).
    func applyingDetection(_ detection: EngineDetectionResult) -> ConnectionConfig {
        let previousType = self.type
        var copy = self
        copy.type = detection.engine

        if let parsed = detection.parsedURI {
            if let h = parsed.host, !h.isEmpty { copy.host = h }
            if let p = parsed.port { copy.port = p }
            if let u = parsed.user, !u.isEmpty { copy.user = u }
            if let pw = parsed.password, !pw.isEmpty { copy.password = pw }
            if let db = parsed.database, !db.isEmpty { copy.database = db }
            if let s = parsed.ssl { copy.ssl = s }
        }

        if detection.engine == .sqlite {
            if let fp = detection.filePath, !fp.isEmpty {
                copy.filename = fp
            }
            copy.port = nil
            copy.ssl = false
        } else {
            // Update port if unset or still holding the previous engine's default port
            if let suggested = detection.suggestedPort {
                if copy.port == nil || copy.port == previousType.defaultPort {
                    copy.port = suggested
                }
            } else if copy.port == nil || copy.port == previousType.defaultPort {
                copy.port = detection.engine.defaultPort
            }

            // Update username if empty or still equal to the previous engine's default user
            let trimmedUser = copy.user?.trimmingCharacters(in: .whitespacesAndNewlines) ?? ""
            if trimmedUser.isEmpty || trimmedUser == previousType.defaultUser {
                let newDefaultUser = detection.engine.defaultUser
                copy.user = newDefaultUser.isEmpty ? nil : newDefaultUser
            }

            // Update default database placeholder when switching away from Postgres/Redis defaults
            let trimmedDB = copy.database?.trimmingCharacters(in: .whitespacesAndNewlines) ?? ""
            if previousType == .postgres && trimmedDB == "postgres" && detection.engine != .postgres {
                copy.database = detection.engine == .redis ? "0" : nil
            } else if detection.engine == .redis && trimmedDB.isEmpty {
                copy.database = "0"
            } else if detection.engine == .postgres && trimmedDB.isEmpty {
                copy.database = "postgres"
            }

            if let ssl = detection.suggestedSSL {
                copy.ssl = ssl
            }
        }

        return copy
    }
}
