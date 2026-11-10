import Foundation

/// Mirrors `DatabaseType` in `src/main/db/types.ts` so connection definitions stay compatible
/// with the Electron app (and can be imported from its `connections.json`).
public enum DatabaseType: String, Codable, CaseIterable, Identifiable, Sendable {
    case mysql, mariadb, postgres, sqlite, mssql, mongodb, cockroachdb, clickhouse
    case cassandra, redis, elasticsearch, oracle, influxdb, neo4j, snowflake

    public var id: String { rawValue }

    public var displayName: String {
        switch self {
        case .mysql: "MySQL"
        case .mariadb: "MariaDB"
        case .postgres: "PostgreSQL"
        case .sqlite: "SQLite"
        case .mssql: "SQL Server"
        case .mongodb: "MongoDB"
        case .cockroachdb: "CockroachDB"
        case .clickhouse: "ClickHouse"
        case .cassandra: "Cassandra"
        case .redis: "Redis"
        case .elasticsearch: "Elasticsearch"
        case .oracle: "Oracle"
        case .influxdb: "InfluxDB"
        case .neo4j: "Neo4j"
        case .snowflake: "Snowflake"
        }
    }

    public var category: DatabaseCategory {
        switch self {
        case .mysql, .mariadb, .postgres, .sqlite, .mssql, .cockroachdb, .oracle: .relational
        case .mongodb, .elasticsearch: .document
        case .redis: .keyValue
        case .cassandra: .wideColumn
        case .influxdb: .timeSeries
        case .neo4j: .graph
        case .clickhouse, .snowflake: .cloudWarehouse
        }
    }

    /// Whether the native app ships a driver for this engine.
    /// Engines without a pure-Swift wire-protocol client are kept visible but disabled.
    public var isSupportedNatively: Bool {
        switch self {
        case .mysql, .mariadb, .postgres, .cockroachdb, .sqlite, .redis,
             .clickhouse, .elasticsearch, .neo4j, .influxdb: true
        case .mssql, .oracle, .cassandra, .mongodb, .snowflake: false
        }
    }

    public var defaultPort: Int? {
        switch self {
        case .mysql, .mariadb: 3306
        case .postgres: 5432
        case .cockroachdb: 26257
        case .mssql: 1433
        case .mongodb: 27017
        case .clickhouse: 8123
        case .cassandra: 9042
        case .redis: 6379
        case .elasticsearch: 9200
        case .oracle: 1521
        case .influxdb: 8086
        case .neo4j: 7474
        case .sqlite, .snowflake: nil
        }
    }

    public var defaultUser: String {
        switch self {
        case .postgres: "postgres"
        case .cockroachdb: "root"
        case .mysql, .mariadb: "root"
        case .clickhouse: "default"
        case .neo4j: "neo4j"
        case .elasticsearch: "elastic"
        default: ""
        }
    }

    /// Query language label shown in the editor.
    public var languageName: String {
        switch self {
        case .redis: "Redis command"
        case .elasticsearch: "Query DSL"
        case .neo4j: "Cypher"
        case .influxdb: "Flux"
        case .mongodb: "MQL"
        default: "SQL"
        }
    }

    /// Engines where the SQL `LIMIT` safety guard applies (same list as `applySafetyLimit`).
    public var usesSQLLimitGuard: Bool {
        switch self {
        case .mysql, .mariadb, .postgres, .mssql, .sqlite, .cockroachdb, .clickhouse,
             .oracle, .cassandra, .snowflake: true
        default: false
        }
    }

    /// SF Symbol used in the sidebar.
    public var symbolName: String {
        switch category {
        case .relational: "cylinder.split.1x2"
        case .document: "doc.text"
        case .keyValue: "key"
        case .wideColumn: "tablecells"
        case .timeSeries: "chart.xyaxis.line"
        case .graph: "point.3.connected.trianglepath.dotted"
        case .cloudWarehouse: "cloud"
        }
    }
}

public enum DatabaseCategory: String, CaseIterable, Sendable {
    case relational, document, keyValue, wideColumn, timeSeries, graph, cloudWarehouse

    public var label: String {
        switch self {
        case .relational: "Relational SQL"
        case .document: "Document NoSQL"
        case .keyValue: "Key-Value"
        case .wideColumn: "Wide-Column"
        case .timeSeries: "Time-Series"
        case .graph: "Graph"
        case .cloudWarehouse: "Cloud Data Warehouse"
        }
    }

    public var types: [DatabaseType] { DatabaseType.allCases.filter { $0.category == self } }
}
