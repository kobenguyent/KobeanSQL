import Foundation

/// Elasticsearch over REST. The editor accepts either:
///  - Kibana-console style requests:   `GET /my-index/_search` + optional JSON body on following lines
///  - plain Elasticsearch SQL:          `SELECT * FROM "my-index" LIMIT 10`
public actor ElasticsearchDriver: DatabaseDriver {
    public let type: DatabaseType = .elasticsearch
    private var http: HTTPClient?

    public init() {}

    public func connect(_ config: ConnectionConfig) async throws {
        let config = try config.resolved()
        http = try HTTPClient.make(config: config, defaultPort: 9200,
                                   headers: HTTPClient.basicAuth(user: config.user, password: config.password))
        _ = try await serverVersion()
    }

    public func disconnect() async {
        http?.invalidate()
        http = nil
    }

    private func call(_ method: String, _ path: String, body: Data?) async throws -> HTTPClient.Response {
        guard let http else { throw DatabaseError("Not connected") }
        let response = try await http.request(method, path, body: body, contentType: body == nil ? nil : "application/json")
        guard (200..<300).contains(response.status) else {
            if let json = try? response.json() as? [String: Any],
               let error = json["error"] as? [String: Any], let reason = error["reason"] as? String {
                throw DatabaseError("\(response.status): \(reason)")
            }
            throw DatabaseError("HTTP \(response.status): \(response.text)")
        }
        return response
    }

    public func execute(_ query: String, database: String?) async throws -> QueryResult {
        let start = Date()
        var result: QueryResult
        if let request = ConsoleRequest.parse(query) {
            let response = try await call(request.method, request.path, body: request.body)
            result = Self.grid(from: response)
        } else {
            let body = try JSONSerialization.data(withJSONObject: ["query": query, "fetch_size": QueryGuard.autoLimit])
            let response = try await call("POST", "/_sql?format=json", body: body)
            let json = try response.json() as? [String: Any] ?? [:]
            let cols = (json["columns"] as? [[String: Any]] ?? []).map {
                ColumnDef(name: $0["name"] as? String ?? "", type: $0["type"] as? String ?? "")
            }
            let rows = (json["rows"] as? [[Any]] ?? []).map { $0.map(JSONCells.cell) }
            result = QueryResult(columns: cols, rows: rows)
        }
        result.duration = Date().timeIntervalSince(start)
        return result
    }

    /// Search responses become a hit grid; anything else is shown as pretty JSON.
    static func grid(from response: HTTPClient.Response) -> QueryResult {
        if let json = try? response.json() as? [String: Any],
           let hits = (json["hits"] as? [String: Any])?["hits"] as? [[String: Any]] {
            let objects: [[String: Any]] = hits.map { hit in
                var row = hit["_source"] as? [String: Any] ?? [:]
                row["_id"] = hit["_id"]
                row["_index"] = hit["_index"]
                row["_score"] = hit["_score"]
                return row
            }
            var grid = JSONCells.grid(from: objects, leading: ["_index", "_id", "_score"])
            if let aggs = json["aggregations"] {
                grid.notice = "Aggregations: " + JSONCells.cell(aggs).description
            }
            return grid
        }
        if let array = try? response.json() as? [[String: Any]] {
            return JSONCells.grid(from: array) // e.g. _cat APIs with ?format=json
        }
        return QueryResult(columns: [ColumnDef(name: "response")], rows: [[.text(JSONCells.pretty(response.data))]])
    }

    public func databases() async throws -> [String] { ["indices"] }

    public func tables(database: String?) async throws -> [TableInfo] {
        let response = try await call("GET", "/_cat/indices?format=json&h=index,status&s=index", body: nil)
        let items = try response.json() as? [[String: Any]] ?? []
        return items.compactMap { $0["index"] as? String }
            .filter { !$0.hasPrefix(".") }
            .map { TableInfo(name: $0) }
    }

    public func columns(table: TableInfo, database: String?) async throws -> [ColumnInfo] {
        let path = "/\(table.name.addingPercentEncoding(withAllowedCharacters: .urlPathAllowed) ?? table.name)/_mapping"
        let json = try await call("GET", path, body: nil).json() as? [String: Any] ?? [:]
        guard let index = json.values.first as? [String: Any],
              let props = (index["mappings"] as? [String: Any])?["properties"] as? [String: Any] else { return [] }
        return props.keys.sorted().map { key in
            let type = (props[key] as? [String: Any])?["type"] as? String ?? "object"
            return ColumnInfo(name: key, type: type)
        }
    }

    public func serverVersion() async throws -> String {
        let json = try await call("GET", "/", body: nil).json() as? [String: Any] ?? [:]
        let version = (json["version"] as? [String: Any])?["number"] as? String ?? "?"
        return "Elasticsearch \(version)"
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

/// Parses `METHOD /path` + optional JSON body (Kibana Dev Tools syntax).
struct ConsoleRequest: Equatable {
    var method: String
    var path: String
    var body: Data?

    static let methods: Set = ["GET", "POST", "PUT", "DELETE", "HEAD", "PATCH"]

    static func parse(_ text: String) -> ConsoleRequest? {
        let trimmed = text.trimmingCharacters(in: .whitespacesAndNewlines)
        let firstLine = trimmed.prefix { $0 != "\n" }
        let parts = firstLine.split(separator: " ", maxSplits: 1).map(String.init)
        guard parts.count == 2, methods.contains(parts[0].uppercased()) else { return nil }
        let rest = trimmed.dropFirst(firstLine.count).trimmingCharacters(in: .whitespacesAndNewlines)
        let path = parts[1].trimmingCharacters(in: .whitespaces)
        return ConsoleRequest(method: parts[0].uppercased(), path: path.hasPrefix("/") ? path : "/" + path,
                              body: rest.isEmpty ? nil : Data(rest.utf8))
    }
}
