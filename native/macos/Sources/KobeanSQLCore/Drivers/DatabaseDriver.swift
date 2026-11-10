import Foundation

/// Native counterpart of `DatabaseAdapter` (`src/main/db/adapter.ts`).
/// Every driver is an actor so connection state is never touched concurrently.
public protocol DatabaseDriver: Actor {
    var type: DatabaseType { get }
    func connect(_ config: ConnectionConfig) async throws
    func disconnect() async
    /// Executes a single statement/command. Safety rewrites happen in `ConnectionManager`.
    func execute(_ query: String, database: String?) async throws -> QueryResult
    func databases() async throws -> [String]
    func tables(database: String?) async throws -> [TableInfo]
    func columns(table: TableInfo, database: String?) async throws -> [ColumnInfo]
    func foreignKeys(table: TableInfo, database: String?) async throws -> [ForeignKeyInfo]
    func serverVersion() async throws -> String
    /// Query used to preview a table/key/label when the user opens it from the sidebar.
    func previewQuery(for table: TableInfo, database: String?, limit: Int) -> String
}

public extension DatabaseDriver {
    func columns(table: TableInfo, database: String?) async throws -> [ColumnInfo] { [] }
    func foreignKeys(table: TableInfo, database: String?) async throws -> [ForeignKeyInfo] { [] }
}

public enum DriverFactory {
    public static func make(for config: ConnectionConfig) throws -> any DatabaseDriver {
        if DemoDatabaseCatalog.isDemo(config) {
            switch config.type {
            case .postgres, .cockroachdb, .mysql, .mariadb, .clickhouse:
                return DemoSQLDialectDriver(type: config.type)
            case .redis:
                return DemoRedisDriver()
            case .elasticsearch:
                return DemoElasticsearchDriver()
            case .neo4j:
                return DemoNeo4jDriver()
            case .influxdb:
                return DemoInfluxDBDriver()
            default:
                break
            }
        }
        return try make(for: config.type)
    }

    public static func make(for type: DatabaseType) throws -> any DatabaseDriver {
        switch type {
        case .sqlite: return SQLiteDriver()
        case .postgres, .cockroachdb: return PostgresDriver(type: type)
        case .mysql, .mariadb: return MySQLDriver(type: type)
        case .redis: return RedisDriver()
        case .clickhouse: return ClickHouseDriver()
        case .elasticsearch: return ElasticsearchDriver()
        case .neo4j: return Neo4jDriver()
        case .influxdb: return InfluxDBDriver()
        case .mssql, .oracle, .cassandra, .mongodb, .snowflake:
            throw DatabaseError("\(type.displayName) is not yet supported in the native macOS app. Use the Electron build for this engine.")
        }
    }
}

enum SQLIdent {
    /// Quotes an identifier with the given quote character, escaping embedded quotes.
    static func quote(_ name: String, with q: Character = "\"") -> String {
        let s = String(q)
        return s + name.replacingOccurrences(of: s, with: s + s) + s
    }

    static func literal(_ value: String) -> String {
        "'" + value.replacingOccurrences(of: "'", with: "''") + "'"
    }
}
