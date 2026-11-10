import Foundation
import Logging
import NIOCore
import NIOPosix
import NIOSSL
@preconcurrency import RediStack

/// Redis via RediStack (pure Swift RESP client).
/// "Tables" are keys (first 500 from SCAN); each line in the editor is one command.
public actor RedisDriver: DatabaseDriver {
    public let type: DatabaseType = .redis
    private var conn: RedisConnection?
    private var currentDB = 0
    private static let keyScanLimit = 500

    public init() {}

    public func connect(_ config: ConnectionConfig) async throws {
        let config = try config.resolved()
        let host = config.host?.isEmpty == false ? config.host! : "localhost"
        let port = config.port ?? 6379
        let db = Int(config.database ?? "") ?? 0
        let eventLoop = MultiThreadedEventLoopGroup.singleton.any()

        let redisConfig = try RedisConnection.Configuration(
            address: try SocketAddress.makeAddressResolvingHost(host, port: port),
            username: config.user?.isEmpty == false ? config.user : nil,
            password: config.password?.isEmpty == false ? config.password : nil,
            initialDatabase: db
        )

        var client: ClientBootstrap?
        if config.ssl == true {
            var tls = TLSConfiguration.makeClientConfiguration()
            tls.certificateVerification = .none
            let context = try NIOSSLContext(configuration: tls)
            client = ClientBootstrap(group: eventLoop)
                .channelOption(ChannelOptions.socketOption(.so_reuseaddr), value: 1)
                .channelInitializer { channel in
                    do {
                        let handler = try NIOSSLClientHandler(context: context, serverHostname: host)
                        return channel.pipeline.addHandler(handler).flatMap { channel.pipeline.addBaseRedisHandlers() }
                    } catch {
                        return channel.eventLoop.makeFailedFuture(error)
                    }
                }
        }

        let future = RedisConnection.make(configuration: redisConfig, boundEventLoop: eventLoop, configuredTCPClient: client)
        conn = try await QueryGuard.withTimeout(QueryGuard.connectTimeout, message: "Connection timed out after \(Int(QueryGuard.connectTimeout))s") {
            try await future.get()
        }
        currentDB = db
    }

    public func disconnect() async {
        try? await conn?.close().get()
        conn = nil
    }

    private func send(_ command: String, _ args: [String]) async throws -> RESPValue {
        guard let conn else { throw DatabaseError("Not connected") }
        let value = try await conn.send(command: command, with: args.map { RESPValue(from: $0) }).get()
        if case .error(let e) = value { throw DatabaseError(e.message) }
        return value
    }

    private func select(_ database: String?) async throws {
        guard let database, let index = Int(database.replacingOccurrences(of: "db", with: "")), index != currentDB else { return }
        _ = try await send("SELECT", [String(index)])
        currentDB = index
    }

    public func execute(_ query: String, database: String?) async throws -> QueryResult {
        try await select(database)
        let parts = RedisCommandParser.tokenize(query)
        guard let command = parts.first else { throw DatabaseError("Empty command") }
        let start = Date()
        let value: RESPValue
        do {
            value = try await send(command.uppercased(), Array(parts.dropFirst()))
        } catch let error as RedisClientError {
            throw DatabaseError(error.localizedDescription)
        }
        var result = Self.table(from: value, command: command.uppercased())
        result.duration = Date().timeIntervalSince(start)
        return result
    }

    /// Converts a RESP reply into a grid. Hash-style replies (HGETALL, CONFIG GET) become field/value rows.
    static func table(from value: RESPValue, command: String) -> QueryResult {
        switch value {
        case .array(let items):
            let pairCommands: Set = ["HGETALL", "CONFIG", "XINFO"]
            if pairCommands.contains(command) && items.count % 2 == 0 {
                let rows = stride(from: 0, to: items.count, by: 2).map { [cell(items[$0]), cell(items[$0 + 1])] }
                return QueryResult(columns: [ColumnDef(name: "field"), ColumnDef(name: "value")], rows: rows)
            }
            if command == "ZRANGE" || command == "ZREVRANGE", items.count % 2 == 0, items.count > 0 {
                // WITHSCORES output is alternating member/score
                let rows = stride(from: 0, to: items.count, by: 2).map { [cell(items[$0]), cell(items[$0 + 1])] }
                return QueryResult(columns: [ColumnDef(name: "member"), ColumnDef(name: "score")], rows: rows)
            }
            let rows = items.enumerated().map { [CellValue.integer(Int64($0.offset)), cell($0.element)] }
            return QueryResult(columns: [ColumnDef(name: "#"), ColumnDef(name: "value")], rows: rows)
        default:
            return QueryResult(columns: [ColumnDef(name: "result")], rows: [[cell(value)]])
        }
    }

    private static func cell(_ value: RESPValue) -> CellValue {
        switch value {
        case .null, .bulkString(nil): .null
        case .integer(let i): .integer(Int64(i))
        case .array(let items): .text("[" + items.map { cell($0).description }.joined(separator: ", ") + "]")
        case .error(let e): .text("ERR " + e.message)
        default: .text(value.string ?? value.description)
        }
    }

    public func databases() async throws -> [String] {
        let reply = try? await send("CONFIG", ["GET", "databases"])
        let count = reply?.array?.last.flatMap { Int($0.string ?? "") } ?? 16
        return (0..<count).map { "db\($0)" }
    }

    public func tables(database: String?) async throws -> [TableInfo] {
        try await select(database)
        var keys: [String] = []
        var cursor = "0"
        repeat {
            let reply = try await send("SCAN", [cursor, "COUNT", "200"])
            guard let parts = reply.array, parts.count == 2 else { break }
            cursor = parts[0].string ?? "0"
            keys += (parts[1].array ?? []).compactMap { $0.string }
        } while cursor != "0" && keys.count < Self.keyScanLimit
        return keys.prefix(Self.keyScanLimit).sorted().map { TableInfo(name: $0) }
    }

    public func serverVersion() async throws -> String {
        let info = try await send("INFO", ["server"]).string ?? ""
        let line = info.split(whereSeparator: \.isNewline).first { $0.hasPrefix("redis_version:") }
        return line.map { "Redis " + $0.dropFirst("redis_version:".count) } ?? "Redis"
    }

    /// The preview command depends on the key type, so it's resolved lazily.
    public func previewQuery(for table: TableInfo, database: String?, limit: Int) -> String {
        "TYPE \(RedisCommandParser.quote(table.name))"
    }

    /// Returns a type-appropriate read command for a key (GET / HGETALL / LRANGE ...).
    public func readCommand(forKey key: String, database: String?, limit: Int) async throws -> String {
        try await select(database)
        let type = try await send("TYPE", [key]).string ?? "string"
        let k = RedisCommandParser.quote(key)
        switch type {
        case "hash": return "HGETALL \(k)"
        case "list": return "LRANGE \(k) 0 \(limit - 1)"
        case "set": return "SMEMBERS \(k)"
        case "zset": return "ZRANGE \(k) 0 \(limit - 1) WITHSCORES"
        case "stream": return "XRANGE \(k) - + COUNT \(limit)"
        default: return "GET \(k)"
        }
    }
}

public enum RedisCommandParser {
    /// Splits a command line into arguments, honouring single/double quotes and backslash escapes.
    public static func tokenize(_ line: String) -> [String] {
        var tokens: [String] = []
        var current = ""
        var quote: Character?
        var inToken = false
        var escape = false
        for ch in line {
            if escape { current.append(ch); escape = false; continue }
            if ch == "\\" && quote == "\"" { escape = true; continue }
            if let q = quote {
                if ch == q { quote = nil } else { current.append(ch) }
                continue
            }
            if ch == "\"" || ch == "'" { quote = ch; inToken = true; continue }
            if ch.isWhitespace {
                if inToken { tokens.append(current); current = ""; inToken = false }
                continue
            }
            current.append(ch)
            inToken = true
        }
        if inToken { tokens.append(current) }
        return tokens
    }

    public static func quote(_ s: String) -> String {
        if !s.isEmpty && !s.contains(where: { $0.isWhitespace || $0 == "\"" || $0 == "'" }) { return s }
        return "\"" + s.replacingOccurrences(of: "\\", with: "\\\\").replacingOccurrences(of: "\"", with: "\\\"") + "\""
    }
}
