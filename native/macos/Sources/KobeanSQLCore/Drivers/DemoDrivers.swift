import Foundation
import SQLite3

/// Built-in zero-setup Demo Databases covering all 6 native database categories:
/// Relational SQL (SQLite, PostgreSQL, MySQL), Cloud Warehouse (ClickHouse),
/// Key-Value (Redis), Document NoSQL (Elasticsearch), Graph (Neo4j), and Time-Series (InfluxDB).
public struct DemoDatabasePreset: Identifiable, Sendable {
    public var type: DatabaseType
    public var name: String
    public var badgeColor: String
    public var defaultDatabase: String
    public var defaultTable: String
    public var sampleQuery: String
    public var id: String { "demo-\(type.rawValue)" }

    public var connectionConfig: ConnectionConfig {
        ConnectionConfig(
            id: id,
            name: name,
            type: type,
            host: DemoDatabaseCatalog.demoHost,
            port: type.defaultPort,
            user: type.defaultUser.isEmpty ? "demo" : type.defaultUser,
            database: defaultDatabase,
            color: badgeColor,
            category: "Demo"
        )
    }
}

public enum DemoDatabaseCatalog {
    public static let demoHost = "demo.kobeansql.local"

    public static func isDemo(_ config: ConnectionConfig) -> Bool {
        config.host == demoHost || (config.connectionUri?.hasPrefix("demo://") == true)
    }

    public static let presets: [DemoDatabasePreset] = [
        DemoDatabasePreset(
            type: .sqlite,
            name: "Demo — SQLite (E-Commerce)",
            badgeColor: "4ade80",
            defaultDatabase: "main",
            defaultTable: "customers",
            sampleQuery: """
            -- SQLite Demo: Select, Insert, Edit, Duplicate, or Delete rows below
            SELECT id, name, email, tier, created_at
            FROM customers
            ORDER BY id;
            """
        ),
        DemoDatabasePreset(
            type: .postgres,
            name: "Demo — PostgreSQL (SaaS MRR)",
            badgeColor: "60a5fa",
            defaultDatabase: "saas_analytics",
            defaultTable: "organizations",
            sampleQuery: """
            -- PostgreSQL Demo: Organizations (supports Insert / Edit / Duplicate / Delete)
            SELECT id, name, domain, region, created_at
            FROM organizations
            ORDER BY id;
            """
        ),
        DemoDatabasePreset(
            type: .mysql,
            name: "Demo — MySQL (Warehouse Inventory)",
            badgeColor: "f97316",
            defaultDatabase: "logistics",
            defaultTable: "inventory_items",
            sampleQuery: """
            -- MySQL Demo: Warehouse Inventory (supports Insert / Edit / Duplicate / Delete)
            SELECT id, warehouse_id, sku, product_name, stock_on_hand, reorder_point, unit_cost_usd
            FROM inventory_items
            ORDER BY id;
            """
        ),
        DemoDatabasePreset(
            type: .clickhouse,
            name: "Demo — ClickHouse (API Telemetry)",
            badgeColor: "fbbf24",
            defaultDatabase: "telemetry",
            defaultTable: "http_requests",
            sampleQuery: """
            -- ClickHouse Demo: HTTP Requests Telemetry
            SELECT id, ts, service, route, method, status_code, duration_ms, region
            FROM http_requests
            ORDER BY id;
            """
        ),
        DemoDatabasePreset(
            type: .redis,
            name: "Demo — Redis (Sessions & Cache)",
            badgeColor: "f87171",
            defaultDatabase: "db0",
            defaultTable: "session:user:1001",
            sampleQuery: """
            # Redis Demo: Run one or more Redis commands (one per line)
            HGETALL session:user:1001
            """
        ),
        DemoDatabasePreset(
            type: .elasticsearch,
            name: "Demo — Elasticsearch (App Logs)",
            badgeColor: "22d3ee",
            defaultDatabase: "indices",
            defaultTable: "app-logs-2026",
            sampleQuery: """
            GET /app-logs-2026/_search
            {
              "size": 25,
              "query": { "match_all": {} }
            }
            """
        ),
        DemoDatabasePreset(
            type: .neo4j,
            name: "Demo — Neo4j (Tech Knowledge Graph)",
            badgeColor: "38bdf8",
            defaultDatabase: "neo4j",
            defaultTable: "Service",
            sampleQuery: """
            MATCH (n:Service) RETURN n LIMIT 25
            """
        ),
        DemoDatabasePreset(
            type: .influxdb,
            name: "Demo — InfluxDB (MacBook & IoT Metrics)",
            badgeColor: "a855f7",
            defaultDatabase: "macbook-telemetry",
            defaultTable: "cpu_usage",
            sampleQuery: """
            from(bucket: "macbook-telemetry")
              |> range(start: -1h)
              |> filter(fn: (r) => r._measurement == "cpu_usage")
              |> limit(n: 50)
            """
        )
    ]

    public static func preset(for type: DatabaseType) -> DemoDatabasePreset {
        presets.first { $0.type == type } ?? presets[0]
    }
}

// MARK: - 1. Embedded SQL Dialect Demo Driver (Postgres / MySQL / ClickHouse)

public actor DemoSQLDialectDriver: DatabaseDriver {
    public let type: DatabaseType
    private let backing = SQLiteDriver()
    private var defaultDB: String = "main"

    public init(type: DatabaseType) {
        self.type = type
    }

    public func connect(_ config: ConnectionConfig) async throws {
        defaultDB = config.database ?? DemoDatabaseCatalog.preset(for: type).defaultDatabase
        let baseDir = FileManager.default.urls(for: .applicationSupportDirectory, in: .userDomainMask)[0]
            .appendingPathComponent("KobeanSQL Native/demos", isDirectory: true)
        try FileManager.default.createDirectory(at: baseDir, withIntermediateDirectories: true)
        let dbURL = baseDir.appendingPathComponent("demo-\(type.rawValue).sqlite")
        let needsSeed = !FileManager.default.fileExists(atPath: dbURL.path)

        var sqliteConfig = config
        sqliteConfig.filename = dbURL.path
        try await backing.connect(sqliteConfig)

        if needsSeed {
            for stmt in StatementSplitter.splitSQL(Self.seedSQL(for: type)) {
                _ = try? await backing.execute(stmt, database: nil)
            }
        }
    }

    public func disconnect() async {
        await backing.disconnect()
    }

    public func execute(_ query: String, database: String?) async throws -> QueryResult {
        let trimmed = query.trimmingCharacters(in: .whitespacesAndNewlines)
        if trimmed.range(of: #"^SELECT\s+version\(\)"#, options: [.regularExpression, .caseInsensitive]) != nil {
            return QueryResult(columns: [ColumnDef(name: "version", type: "text")],
                               rows: [[.text(try await serverVersion())]], duration: 0.001)
        }
        if trimmed.range(of: #"^SHOW\s+DATABASES"#, options: [.regularExpression, .caseInsensitive]) != nil {
            let dbs = try await databases()
            return QueryResult(columns: [ColumnDef(name: "Database", type: "varchar")],
                               rows: dbs.map { [.text($0)] }, duration: 0.001)
        }
        return try await backing.execute(query, database: nil)
    }

    public func databases() async throws -> [String] {
        [defaultDB]
    }

    public func tables(database: String?) async throws -> [TableInfo] {
        let schema: String? = (type == .postgres || type == .cockroachdb) ? "public" : defaultDB
        return try await backing.tables(database: nil).map {
            TableInfo(name: $0.name, kind: $0.kind, schema: schema)
        }
    }

    public func columns(table: TableInfo, database: String?) async throws -> [ColumnInfo] {
        try await backing.columns(table: table, database: nil)
    }

    public func foreignKeys(table: TableInfo, database: String?) async throws -> [ForeignKeyInfo] {
        try await backing.foreignKeys(table: table, database: nil)
    }

    public func serverVersion() async throws -> String {
        switch type {
        case .postgres: "PostgreSQL 16.4 (KobeanSQL Embedded Demo)"
        case .cockroachdb: "CockroachDB v24.1 (KobeanSQL Embedded Demo)"
        case .mysql: "MySQL 8.4.2 (KobeanSQL Embedded Demo)"
        case .mariadb: "MariaDB 11.4 (KobeanSQL Embedded Demo)"
        case .clickhouse: "ClickHouse 24.8 (KobeanSQL Embedded Demo)"
        default: "\(type.displayName) (Embedded Demo)"
        }
    }

    public func previewQuery(for table: TableInfo, database: String?, limit: Int) -> String {
        let q: Character = (type == .mysql || type == .mariadb || type == .clickhouse) ? "`" : "\""
        return "SELECT * FROM \(SQLIdent.quote(table.name, with: q)) LIMIT \(limit);"
    }

    private static func seedSQL(for type: DatabaseType) -> String {
        switch type {
        case .postgres, .cockroachdb:
            return """
            CREATE TABLE organizations (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                name TEXT NOT NULL,
                domain TEXT NOT NULL,
                region TEXT NOT NULL,
                created_at TEXT DEFAULT CURRENT_TIMESTAMP
            );
            CREATE TABLE subscriptions (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                org_id INTEGER NOT NULL REFERENCES organizations(id),
                plan_tier TEXT NOT NULL,
                seats INTEGER NOT NULL,
                mrr_usd REAL NOT NULL,
                status TEXT NOT NULL
            );
            CREATE TABLE audit_events (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                org_id INTEGER NOT NULL REFERENCES organizations(id),
                actor TEXT NOT NULL,
                action TEXT NOT NULL,
                created_at TEXT DEFAULT CURRENT_TIMESTAMP
            );
            CREATE VIEW mrr_by_region AS
            SELECT o.region, COUNT(s.id) AS active_subscriptions, ROUND(SUM(s.mrr_usd), 2) AS total_mrr_usd
            FROM organizations o JOIN subscriptions s ON s.org_id = o.id
            WHERE s.status = 'active'
            GROUP BY o.region;
            INSERT INTO organizations (name, domain, region) VALUES
                ('Linear Orbit Labs', 'orbit.dev', 'us-west'),
                ('Nordic Cloud AB', 'nordiccloud.se', 'eu-north'),
                ('Tokyo Quantum KK', 'quantum.jp', 'ap-northeast'),
                ('Alpine FinTech AG', 'alpinefin.ch', 'eu-central'),
                ('Pacific AI Studio', 'pacific.ai', 'us-east');
            INSERT INTO subscriptions (org_id, plan_tier, seats, mrr_usd, status) VALUES
                (1, 'enterprise', 85, 4250.00, 'active'),
                (2, 'enterprise', 120, 6000.00, 'active'),
                (3, 'team', 32, 960.00, 'active'),
                (4, 'enterprise', 64, 3200.00, 'active'),
                (5, 'pro', 14, 420.00, 'trialing');
            INSERT INTO audit_events (org_id, actor, action) VALUES
                (1, 'ada@orbit.dev', 'sso.saml.enabled'),
                (2, 'erik@nordiccloud.se', 'apikey.rotated'),
                (4, 'claire@alpinefin.ch', 'role.granted.dba');
            """
        case .mysql, .mariadb:
            return """
            CREATE TABLE warehouses (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                code TEXT NOT NULL,
                city TEXT NOT NULL,
                capacity_pallets INTEGER NOT NULL
            );
            CREATE TABLE inventory_items (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                warehouse_id INTEGER NOT NULL REFERENCES warehouses(id),
                sku TEXT NOT NULL,
                product_name TEXT NOT NULL,
                stock_on_hand INTEGER NOT NULL,
                reorder_point INTEGER NOT NULL,
                unit_cost_usd REAL NOT NULL
            );
            CREATE TABLE shipments (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                warehouse_id INTEGER NOT NULL REFERENCES warehouses(id),
                carrier TEXT NOT NULL,
                tracking_code TEXT NOT NULL,
                status TEXT NOT NULL
            );
            CREATE VIEW low_stock_alerts AS
            SELECT w.code AS warehouse, i.sku, i.product_name, i.stock_on_hand, i.reorder_point
            FROM inventory_items i JOIN warehouses w ON w.id = i.warehouse_id
            WHERE i.stock_on_hand <= i.reorder_point;
            INSERT INTO warehouses (code, city, capacity_pallets) VALUES
                ('FRA-01', 'Frankfurt', 12000),
                ('SJC-02', 'San Jose', 18500),
                ('SIN-01', 'Singapore', 9500);
            INSERT INTO inventory_items (warehouse_id, sku, product_name, stock_on_hand, reorder_point, unit_cost_usd) VALUES
                (1, 'MBP-M4-16', 'MacBook Pro 16-inch M4 Max', 48, 25, 2899.00),
                (1, 'DISP-XDR-32', 'Pro Display XDR 32-inch', 12, 15, 4299.00),
                (2, 'SRV-ARM-64', 'Rack Blade ARM64 128-Core', 19, 10, 6400.00),
                (2, 'NVME-8TB-E3', 'Enterprise NVMe U.3 8TB', 310, 100, 620.00),
                (3, 'SW-100G-TOR', '100GbE Top-of-Rack Switch', 8, 10, 3850.00);
            INSERT INTO shipments (warehouse_id, carrier, tracking_code, status) VALUES
                (1, 'DHL Express', 'DHL-9928172', 'in_transit'),
                (2, 'FedEx Priority', 'FDX-4410928', 'delivered'),
                (3, 'Maersk Air', 'MSK-7712004', 'customs_cleared');
            """
        default: // ClickHouse
            return """
            CREATE TABLE http_requests (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                ts TEXT NOT NULL,
                service TEXT NOT NULL,
                route TEXT NOT NULL,
                method TEXT NOT NULL,
                status_code INTEGER NOT NULL,
                duration_ms REAL NOT NULL,
                region TEXT NOT NULL
            );
            CREATE TABLE error_traces (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                ts TEXT NOT NULL,
                service TEXT NOT NULL,
                exception_type TEXT NOT NULL,
                message TEXT NOT NULL
            );
            INSERT INTO http_requests (ts, service, route, method, status_code, duration_ms, region) VALUES
                ('2026-11-10T10:00:01Z', 'query-gateway', '/v1/sql/execute', 'POST', 200, 14.2, 'eu-central'),
                ('2026-11-10T10:00:02Z', 'query-gateway', '/v1/sql/execute', 'POST', 200, 28.7, 'us-west'),
                ('2026-11-10T10:00:04Z', 'schema-indexer', '/v1/schema/introspect', 'GET', 200, 6.4, 'eu-central'),
                ('2026-11-10T10:00:05Z', 'auth-edge', '/v1/token/verify', 'POST', 200, 2.1, 'ap-northeast'),
                ('2026-11-10T10:00:07Z', 'query-gateway', '/v1/sql/export', 'POST', 504, 30000.0, 'us-east'),
                ('2026-11-10T10:00:09Z', 'ai-copilot', '/v1/ollama/generate', 'POST', 200, 412.5, 'local');
            INSERT INTO error_traces (ts, service, exception_type, message) VALUES
                ('2026-11-10T10:00:07Z', 'query-gateway', 'QueryTimeoutError', 'Statement exceeded 30000ms safety guard');
            """
        }
    }
}

// MARK: - 2. Embedded Redis Demo Driver

public actor DemoRedisDriver: DatabaseDriver {
    public let type: DatabaseType = .redis
    private var strings: [String: String] = [
        "metrics:queries_today": "18492",
        "cache:pricing:pro_usd": "29.00",
        "system:maintenance_mode": "false"
    ]
    private var hashes: [String: [(String, String)]] = [
        "session:user:1001": [
            ("user_id", "1001"),
            ("name", "Ada Lovelace"),
            ("role", "principal_engineer"),
            ("plan", "enterprise"),
            ("region", "eu-west-1"),
            ("last_active", "2026-11-10T11:40:00Z")
        ],
        "session:user:1002": [
            ("user_id", "1002"),
            ("name", "Grace Hopper"),
            ("role", "staff_dba"),
            ("plan", "enterprise"),
            ("region", "us-east-1"),
            ("last_active", "2026-11-10T11:42:00Z")
        ]
    ]
    private var lists: [String: [String]] = [
        "queue:background_jobs": [
            "refresh_materialized_views",
            "export_audit_archive_s3",
            "vacuum_sqlite_wal",
            "notify_slack_digest"
        ]
    ]
    private var sets: [String: [String]] = [
        "feature_flags:enabled": [
            "native_macos_swiftui",
            "auto_limit_1000",
            "local_ai_ollama",
            "keychain_credentials"
        ]
    ]
    private var zsets: [String: [(String, Double)]] = [
        "leaderboard:top_queries": [
            ("SELECT_orders_summary", 9840),
            ("MATCH_service_graph", 7420),
            ("FLUX_cpu_telemetry", 6310),
            ("ES_error_logs_search", 5190)
        ]
    ]

    public init() {}

    public func connect(_ config: ConnectionConfig) async throws {}
    public func disconnect() async {}

    private var allKeys: [String] {
        (Array(strings.keys) + Array(hashes.keys) + Array(lists.keys) + Array(sets.keys) + Array(zsets.keys)).sorted()
    }

    private func keyType(_ k: String) -> String {
        if strings[k] != nil { return "string" }
        if hashes[k] != nil { return "hash" }
        if lists[k] != nil { return "list" }
        if sets[k] != nil { return "set" }
        if zsets[k] != nil { return "zset" }
        return "none"
    }

    public func execute(_ query: String, database: String?) async throws -> QueryResult {
        let parts = RedisCommandParser.tokenize(query)
        guard let cmd = parts.first?.uppercased() else { throw DatabaseError("Empty Redis command") }
        let args = Array(parts.dropFirst())

        switch cmd {
        case "PING":
            return QueryResult(columns: [ColumnDef(name: "result")], rows: [[.text(args.first ?? "PONG")]], duration: 0.001)
        case "INFO":
            let info = "redis_version:7.4.1-kobeansql-demo\nconnected_clients:1\nused_memory_human:1.42M\ndb0:keys=\(allKeys.count),expires=0"
            return QueryResult(columns: [ColumnDef(name: "info")], rows: [[.text(info)]], duration: 0.001)
        case "DBSIZE":
            return QueryResult(columns: [ColumnDef(name: "keys")], rows: [[.integer(Int64(allKeys.count))]], duration: 0.001)
        case "KEYS", "SCAN":
            let rows = allKeys.enumerated().map { [CellValue.integer(Int64($0.offset + 1)), .text($0.element), .text(keyType($0.element))] }
            return QueryResult(columns: [ColumnDef(name: "#"), ColumnDef(name: "key"), ColumnDef(name: "type")], rows: rows, duration: 0.001)
        case "TYPE":
            guard let k = args.first else { throw DatabaseError("TYPE requires a key") }
            return QueryResult(columns: [ColumnDef(name: "key"), ColumnDef(name: "type")], rows: [[.text(k), .text(keyType(k))]], duration: 0.001)
        case "GET":
            guard let k = args.first else { throw DatabaseError("GET requires a key") }
            return QueryResult(columns: [ColumnDef(name: "key"), ColumnDef(name: "value")],
                               rows: [[.text(k), strings[k].map(CellValue.text) ?? .null]], duration: 0.001)
        case "SET":
            guard args.count >= 2 else { throw DatabaseError("SET requires key and value") }
            strings[args[0]] = args[1]
            return QueryResult(columns: [ColumnDef(name: "result")], rows: [[.text("OK")]], duration: 0.001)
        case "HGETALL":
            guard let k = args.first else { throw DatabaseError("HGETALL requires a key") }
            let pairs = hashes[k] ?? []
            return QueryResult(columns: [ColumnDef(name: "field"), ColumnDef(name: "value")],
                               rows: pairs.map { [.text($0.0), .text($0.1)] }, duration: 0.001)
        case "HSET":
            guard args.count >= 3 else { throw DatabaseError("HSET requires key field value") }
            var pairs = hashes[args[0]] ?? []
            if let idx = pairs.firstIndex(where: { $0.0 == args[1] }) {
                pairs[idx] = (args[1], args[2])
            } else {
                pairs.append((args[1], args[2]))
            }
            hashes[args[0]] = pairs
            return QueryResult(columns: [ColumnDef(name: "updated")], rows: [[.integer(1)]], duration: 0.001)
        case "HDEL":
            guard args.count >= 2 else { throw DatabaseError("HDEL requires key field") }
            hashes[args[0]]?.removeAll { $0.0 == args[1] }
            return QueryResult(columns: [ColumnDef(name: "deleted")], rows: [[.integer(1)]], duration: 0.001)
        case "DEL":
            guard let k = args.first else { throw DatabaseError("DEL requires a key") }
            strings.removeValue(forKey: k)
            hashes.removeValue(forKey: k)
            lists.removeValue(forKey: k)
            sets.removeValue(forKey: k)
            zsets.removeValue(forKey: k)
            return QueryResult(columns: [ColumnDef(name: "deleted")], rows: [[.integer(1)]], duration: 0.001)
        case "RPUSH", "LPUSH":
            guard args.count >= 2 else { throw DatabaseError("\(cmd) requires key value") }
            var items = lists[args[0]] ?? []
            if cmd == "LPUSH" { items.insert(args[1], at: 0) } else { items.append(args[1]) }
            lists[args[0]] = items
            return QueryResult(columns: [ColumnDef(name: "length")], rows: [[.integer(Int64(items.count))]], duration: 0.001)
        case "LREM":
            guard args.count >= 3 else { throw DatabaseError("LREM requires key count value") }
            lists[args[0]]?.removeAll { $0 == args[2] }
            return QueryResult(columns: [ColumnDef(name: "removed")], rows: [[.integer(1)]], duration: 0.001)
        case "SADD":
            guard args.count >= 2 else { throw DatabaseError("SADD requires key member") }
            var items = sets[args[0]] ?? []
            if !items.contains(args[1]) { items.append(args[1]) }
            sets[args[0]] = items
            return QueryResult(columns: [ColumnDef(name: "added")], rows: [[.integer(1)]], duration: 0.001)
        case "SREM":
            guard args.count >= 2 else { throw DatabaseError("SREM requires key member") }
            sets[args[0]]?.removeAll { $0 == args[1] }
            return QueryResult(columns: [ColumnDef(name: "removed")], rows: [[.integer(1)]], duration: 0.001)
        case "ZADD":
            guard args.count >= 3, let score = Double(args[1]) else { throw DatabaseError("ZADD requires key score member") }
            var items = zsets[args[0]] ?? []
            if let idx = items.firstIndex(where: { $0.0 == args[2] }) {
                items[idx] = (args[2], score)
            } else {
                items.append((args[2], score))
            }
            zsets[args[0]] = items.sorted { $0.1 > $1.1 }
            return QueryResult(columns: [ColumnDef(name: "added")], rows: [[.integer(1)]], duration: 0.001)
        case "ZREM":
            guard args.count >= 2 else { throw DatabaseError("ZREM requires key member") }
            zsets[args[0]]?.removeAll { $0.0 == args[1] }
            return QueryResult(columns: [ColumnDef(name: "removed")], rows: [[.integer(1)]], duration: 0.001)
        case "LRANGE":
            guard let k = args.first else { throw DatabaseError("LRANGE requires a key") }
            let items = lists[k] ?? []
            return QueryResult(columns: [ColumnDef(name: "index"), ColumnDef(name: "element")],
                               rows: items.enumerated().map { [.integer(Int64($0.offset)), .text($0.element)] }, duration: 0.001)
        case "SMEMBERS":
            guard let k = args.first else { throw DatabaseError("SMEMBERS requires a key") }
            let items = sets[k] ?? []
            return QueryResult(columns: [ColumnDef(name: "member")],
                               rows: items.map { [.text($0)] }, duration: 0.001)
        case "ZRANGE", "ZREVRANGE":
            guard let k = args.first else { throw DatabaseError("ZRANGE requires a key") }
            let items = zsets[k] ?? []
            return QueryResult(columns: [ColumnDef(name: "member"), ColumnDef(name: "score")],
                               rows: items.map { [.text($0.0), .double($0.1)] }, duration: 0.001)
        default:
            throw DatabaseError("Supported demo Redis commands: PING, INFO, KEYS, TYPE, GET, SET, HGETALL, HSET, LRANGE, SMEMBERS, ZRANGE, DBSIZE")
        }
    }

    public func databases() async throws -> [String] { ["db0", "db1"] }

    public func tables(database: String?) async throws -> [TableInfo] {
        allKeys.map { TableInfo(name: $0) }
    }

    public func columns(table: TableInfo, database: String?) async throws -> [ColumnInfo] {
        [ColumnInfo(name: "type", type: keyType(table.name), nullable: false, primaryKey: true)]
    }

    public func serverVersion() async throws -> String {
        "Redis 7.4.1 (KobeanSQL Embedded Demo)"
    }

    public func previewQuery(for table: TableInfo, database: String?, limit: Int) -> String {
        let k = RedisCommandParser.quote(table.name)
        switch keyType(table.name) {
        case "hash": return "HGETALL \(k)"
        case "list": return "LRANGE \(k) 0 \(limit - 1)"
        case "set": return "SMEMBERS \(k)"
        case "zset": return "ZRANGE \(k) 0 \(limit - 1) WITHSCORES"
        default: return "GET \(k)"
        }
    }
}

// MARK: - 3. Embedded Elasticsearch Demo Driver

public actor DemoElasticsearchDriver: DatabaseDriver {
    public let type: DatabaseType = .elasticsearch
    private var indices: [String: [[String: Any]]] = [
        "app-logs-2026": [
            ["_id": "log-101", "@timestamp": "2026-11-10T11:30:02Z", "level": "INFO", "service": "api-gateway", "message": "TLS handshake completed", "latency_ms": 4],
            ["_id": "log-102", "@timestamp": "2026-11-10T11:31:15Z", "level": "WARN", "service": "postgres-pool", "message": "Connection pool reached 80% capacity (4/5)", "latency_ms": 19],
            ["_id": "log-103", "@timestamp": "2026-11-10T11:32:44Z", "level": "ERROR", "service": "checkout-worker", "message": "Stripe webhook signature mismatch", "latency_ms": 112],
            ["_id": "log-104", "@timestamp": "2026-11-10T11:35:10Z", "level": "INFO", "service": "ai-assistant", "message": "Ollama llama3.1 generated SQL in 380ms", "latency_ms": 380]
        ],
        "product-catalog": [
            ["_id": "sku-1", "title": "MacBook Pro 16 M4 Max", "category": "Hardware", "price_usd": 3499, "in_stock": true],
            ["_id": "sku-2", "title": "Studio Display 27 5K", "category": "Displays", "price_usd": 1599, "in_stock": true],
            ["_id": "sku-3", "title": "KobeanSQL Team License", "category": "Software", "price_usd": 199, "in_stock": true]
        ],
        "security-audit": [
            ["_id": "aud-1", "@timestamp": "2026-11-10T09:12:00Z", "actor": "kobet@macbook-pro", "event": "keychain.unlock", "outcome": "success"],
            ["_id": "aud-2", "@timestamp": "2026-11-10T10:05:19Z", "actor": "ci-bot@github", "event": "codesign.adhoc.verify", "outcome": "success"]
        ]
    ]

    public init() {}

    public func connect(_ config: ConnectionConfig) async throws {}
    public func disconnect() async {}

    public func execute(_ query: String, database: String?) async throws -> QueryResult {
        let trimmed = query.trimmingCharacters(in: .whitespacesAndNewlines)
        if let req = ConsoleRequest.parse(trimmed) {
            let parts = req.path.split(separator: "/").map(String.init)
            if req.method == "DELETE", parts.count >= 3, parts[1] == "_doc" {
                let index = parts[0]
                let docID = parts[2]
                indices[index]?.removeAll { "\($0["_id"] ?? "")" == docID }
                return QueryResult(rowCount: 1, duration: 0.001)
            }
            if req.method == "DELETE", parts.count == 1 {
                indices.removeValue(forKey: parts[0])
                return QueryResult(rowCount: 1, duration: 0.001)
            }
            if (req.method == "POST" || req.method == "PUT"), parts.count >= 2, parts[1] == "_doc",
               let body = req.body,
               var obj = (try? JSONSerialization.jsonObject(with: body)) as? [String: Any] {
                let index = parts[0]
                let docID = parts.count >= 3 ? parts[2] : ((obj["_id"] as? String) ?? "doc-\(Int.random(in: 1000...9999))")
                obj["_id"] = docID
                var list = indices[index] ?? []
                if let idx = list.firstIndex(where: { "\($0["_id"] ?? "")" == docID }) {
                    list[idx] = obj
                } else {
                    list.append(obj)
                }
                indices[index] = list
                return QueryResult(rowCount: 1, duration: 0.001)
            }
        }
        if trimmed.contains("_cat/indices") {
            let rows: [[CellValue]] = indices.keys.sorted().map { name in
                [.text("green"), .text("open"), .text(name), .integer(Int64(indices[name]?.count ?? 0))]
            }
            return QueryResult(columns: [ColumnDef(name: "health"), ColumnDef(name: "status"), ColumnDef(name: "index"), ColumnDef(name: "docs.count")], rows: rows, duration: 0.002)
        }

        let targetIndex = indices.keys.first { trimmed.contains($0) } ?? "app-logs-2026"
        var docs = indices[targetIndex] ?? []

        // Simple term/match filter if body contains a query string
        if let range = trimmed.range(of: #""(INFO|WARN|ERROR|Hardware|Software|Displays)""#, options: .regularExpression) {
            let term = String(trimmed[range]).replacingOccurrences(of: "\"", with: "")
            docs = docs.filter { doc in doc.values.contains { "\($0)" == term } }
        }

        let enriched: [[String: Any]] = docs.map { d in
            var copy = d
            copy["_index"] = targetIndex
            return copy
        }
        var grid = JSONCells.grid(from: enriched, leading: ["_index", "_id"])
        grid.duration = 0.003
        return grid
    }

    public func databases() async throws -> [String] { ["indices"] }

    public func tables(database: String?) async throws -> [TableInfo] {
        indices.keys.sorted().map { TableInfo(name: $0) }
    }

    public func columns(table: TableInfo, database: String?) async throws -> [ColumnInfo] {
        guard let sample = indices[table.name]?.first else { return [] }
        return sample.keys.sorted().map { ColumnInfo(name: $0, type: $0.hasPrefix("_") ? "keyword" : "field", primaryKey: $0 == "_id") }
    }

    public func serverVersion() async throws -> String {
        "Elasticsearch 8.15.0 (KobeanSQL Embedded Demo)"
    }

    public func previewQuery(for table: TableInfo, database: String?, limit: Int) -> String {
        """
        GET /\(table.name)/_search
        {
          "size": \(limit),
          "query": { "match_all": {} }
        }
        """
    }
}

// MARK: - 4. Embedded Neo4j Graph Demo Driver

public actor DemoNeo4jDriver: DatabaseDriver {
    public let type: DatabaseType = .neo4j
    private var nodesByLabel: [String: [[String: Any]]] = [
        "Service": [
            ["id": "svc-1", "name": "kobeansql-native", "language": "Swift 6", "framework": "SwiftUI + AppKit", "tier": "client"],
            ["id": "svc-2", "name": "postgres-primary", "language": "C", "framework": "PostgreSQL 16", "tier": "storage"],
            ["id": "svc-3", "name": "redis-session-cache", "language": "C", "framework": "Redis 7.4", "tier": "cache"],
            ["id": "svc-4", "name": "ollama-local-ai", "language": "Go/C++", "framework": "Llama 3.1", "tier": "ai"]
        ],
        "Person": [
            ["id": "p-1", "name": "Ada Lovelace", "role": "Staff iOS/macOS Engineer", "team": "Native Platform"],
            ["id": "p-2", "name": "Grace Hopper", "role": "Principal Compiler Architect", "team": "Query Engine"],
            ["id": "p-3", "name": "Alan Turing", "role": "Security & Cryptography Lead", "team": "Local AI"]
        ],
        "Technology": [
            ["id": "t-1", "name": "SwiftNIO", "category": "Networking", "license": "Apache-2.0"],
            ["id": "t-2", "name": "SQLite3", "category": "Embedded SQL", "license": "Public Domain"],
            ["id": "t-3", "name": "AppKit NSTableView", "category": "Native UI", "license": "Apple SDK"]
        ]
    ]

    public init() {}

    public func connect(_ config: ConnectionConfig) async throws {}
    public func disconnect() async {}

    public func execute(_ query: String, database: String?) async throws -> QueryResult {
        let trimmed = query.trimmingCharacters(in: .whitespacesAndNewlines)
        if trimmed.localizedCaseInsensitiveContains("db.labels") {
            let rows = nodesByLabel.keys.sorted().map { [CellValue.text($0)] }
            return QueryResult(columns: [ColumnDef(name: "label")], rows: rows, duration: 0.001)
        }
        let matchedLabel = nodesByLabel.keys.first { trimmed.localizedCaseInsensitiveContains(":\($0)") || trimmed.localizedCaseInsensitiveContains("`\($0)`") }
        let objects: [[String: Any]]
        if let label = matchedLabel, let list = nodesByLabel[label] {
            objects = list.map { var c = $0; c[":label"] = label; return c }
        } else {
            objects = nodesByLabel.flatMap { label, list in
                list.map { var c = $0; c[":label"] = label; return c }
            }
        }
        var grid = JSONCells.grid(from: objects, leading: [":label", "id", "name"])
        grid.duration = 0.002
        return grid
    }

    public func databases() async throws -> [String] { ["neo4j"] }

    public func tables(database: String?) async throws -> [TableInfo] {
        nodesByLabel.keys.sorted().map { TableInfo(name: $0) }
    }

    public func columns(table: TableInfo, database: String?) async throws -> [ColumnInfo] {
        guard let first = nodesByLabel[table.name]?.first else { return [] }
        return first.keys.sorted().map { ColumnInfo(name: $0, type: "property", primaryKey: $0 == "id") }
    }

    public func serverVersion() async throws -> String {
        "Neo4j 5.23 (KobeanSQL Embedded Demo)"
    }

    public func previewQuery(for table: TableInfo, database: String?, limit: Int) -> String {
        "MATCH (n:\(SQLIdent.quote(table.name, with: "`"))) RETURN n LIMIT \(limit)"
    }
}

// MARK: - 5. Embedded InfluxDB Time-Series Demo Driver

public actor DemoInfluxDBDriver: DatabaseDriver {
    public let type: DatabaseType = .influxdb
    private var measurements: [String: [[String: Any]]] = [
        "cpu_usage": [
            ["_time": "2026-11-10T11:40:00Z", "_measurement": "cpu_usage", "host": "macbook-pro-m4", "core": "p-core-0", "_field": "usage_pct", "_value": 18.4],
            ["_time": "2026-11-10T11:41:00Z", "_measurement": "cpu_usage", "host": "macbook-pro-m4", "core": "p-core-1", "_field": "usage_pct", "_value": 24.1],
            ["_time": "2026-11-10T11:42:00Z", "_measurement": "cpu_usage", "host": "macbook-pro-m4", "core": "e-core-0", "_field": "usage_pct", "_value": 6.8],
            ["_time": "2026-11-10T11:43:00Z", "_measurement": "cpu_usage", "host": "macbook-pro-m4", "core": "p-core-0", "_field": "usage_pct", "_value": 15.2]
        ],
        "memory_pressure": [
            ["_time": "2026-11-10T11:40:00Z", "_measurement": "memory_pressure", "host": "macbook-pro-m4", "_field": "used_gb", "_value": 19.6],
            ["_time": "2026-11-10T11:41:00Z", "_measurement": "memory_pressure", "host": "macbook-pro-m4", "_field": "used_gb", "_value": 20.1],
            ["_time": "2026-11-10T11:42:00Z", "_measurement": "memory_pressure", "host": "macbook-pro-m4", "_field": "swap_mb", "_value": 0.0]
        ],
        "thermal_sensors": [
            ["_time": "2026-11-10T11:40:00Z", "_measurement": "thermal_sensors", "sensor": "soc_die", "_field": "temp_c", "_value": 44.5],
            ["_time": "2026-11-10T11:41:00Z", "_measurement": "thermal_sensors", "sensor": "battery", "_field": "temp_c", "_value": 31.2],
            ["_time": "2026-11-10T11:42:00Z", "_measurement": "thermal_sensors", "sensor": "nvme_ssd", "_field": "temp_c", "_value": 38.0]
        ]
    ]

    public init() {}

    public func connect(_ config: ConnectionConfig) async throws {}
    public func disconnect() async {}

    public func execute(_ query: String, database: String?) async throws -> QueryResult {
        let matched = measurements.keys.first { query.contains($0) }
        let points: [[String: Any]]
        if let m = matched, let list = measurements[m] {
            points = list
        } else {
            points = measurements.values.flatMap { $0 }
        }
        var grid = JSONCells.grid(from: points, leading: ["_time", "_measurement", "_field", "_value"])
        grid.duration = 0.002
        return grid
    }

    public func databases() async throws -> [String] {
        ["macbook-telemetry", "iot-sensors"]
    }

    public func tables(database: String?) async throws -> [TableInfo] {
        let b = database ?? "macbook-telemetry"
        return measurements.keys.sorted().map { TableInfo(name: $0, schema: b) }
    }

    public func columns(table: TableInfo, database: String?) async throws -> [ColumnInfo] {
        guard let sample = measurements[table.name]?.first else { return [] }
        return sample.keys.sorted().map { ColumnInfo(name: $0, type: $0 == "_value" ? "float" : "tag") }
    }

    public func serverVersion() async throws -> String {
        "InfluxDB 2.7 (KobeanSQL Embedded Demo)"
    }

    public func previewQuery(for table: TableInfo, database: String?, limit: Int) -> String {
        let b = table.schema ?? database ?? "macbook-telemetry"
        return """
        from(bucket: "\(b)")
          |> range(start: -1h)
          |> filter(fn: (r) => r._measurement == "\(table.name)")
          |> limit(n: \(limit))
        """
    }
}
