import Foundation

/// InfluxDB 2.x via the HTTP API. Matches the Electron adapter's field mapping:
/// `user` = organisation, `password` = API token, `database` = default bucket.
/// Queries starting with SELECT/SHOW use InfluxQL (v1 compat API), everything else is Flux.
public actor InfluxDBDriver: DatabaseDriver {
    public let type: DatabaseType = .influxdb
    private var http: HTTPClient?
    private var org = "default"
    private var bucket: String?

    public init() {}

    public func connect(_ config: ConnectionConfig) async throws {
        let config = try config.resolved()
        var headers: [String: String] = [:]
        if let token = config.password, !token.isEmpty { headers["Authorization"] = "Token \(token)" }
        http = try HTTPClient.make(config: config, defaultPort: 8086, headers: headers)
        if let user = config.user, !user.isEmpty { org = user }
        bucket = config.database?.isEmpty == false ? config.database : nil
        let health = try await http!.request("GET", "/health")
        guard health.status == 200 else { throw DatabaseError("InfluxDB health check failed (HTTP \(health.status))") }
    }

    public func disconnect() async {
        http?.invalidate()
        http = nil
    }

    public func execute(_ query: String, database: String?) async throws -> QueryResult {
        guard let http else { throw DatabaseError("Not connected") }
        let start = Date()
        let trimmed = query.trimmingCharacters(in: .whitespacesAndNewlines)
        var result: QueryResult
        if trimmed.range(of: #"^(SELECT|SHOW)\s"#, options: [.regularExpression, .caseInsensitive]) != nil {
            result = try await influxQL(trimmed, db: database ?? bucket, http: http)
        } else {
            let response = try await http.request("POST", "/api/v2/query", query: ["org": org], body: Data(trimmed.utf8),
                                                  contentType: "application/vnd.flux", accept: "application/csv")
            guard response.status == 200 else { throw DatabaseError(Self.errorMessage(response)) }
            result = AnnotatedCSV.parse(response.text)
        }
        result.duration = Date().timeIntervalSince(start)
        return result
    }

    private func influxQL(_ q: String, db: String?, http: HTTPClient) async throws -> QueryResult {
        var params = ["q": q]
        if let db { params["db"] = db }
        let response = try await http.request("GET", "/query", query: params)
        guard response.status == 200 else { throw DatabaseError(Self.errorMessage(response)) }
        let json = try response.json() as? [String: Any] ?? [:]
        let first = (json["results"] as? [[String: Any]])?.first ?? [:]
        if let error = first["error"] as? String { throw DatabaseError(error) }
        guard let series = (first["series"] as? [[String: Any]])?.first else { return QueryResult() }
        let columns = (series["columns"] as? [String] ?? []).map { ColumnDef(name: $0) }
        let rows = (series["values"] as? [[Any]] ?? []).map { $0.map(JSONCells.cell) }
        return QueryResult(columns: columns, rows: rows)
    }

    private static func errorMessage(_ r: HTTPClient.Response) -> String {
        if let json = try? r.json() as? [String: Any], let msg = json["message"] as? String { return msg }
        return "HTTP \(r.status): \(r.text)"
    }

    public func databases() async throws -> [String] {
        let r = try await execute("buckets() |> keep(columns: [\"name\"])", database: nil)
        let idx = r.columns.firstIndex { $0.name == "name" } ?? 0
        return r.rows.map { $0[idx].description }.filter { !$0.hasPrefix("_") }
    }

    /// Measurements act as "tables".
    public func tables(database: String?) async throws -> [TableInfo] {
        guard let b = database ?? bucket else { return [] }
        let flux = "import \"influxdata/influxdb/schema\"\nschema.measurements(bucket: \(Self.fluxString(b)))"
        let r = try await execute(flux, database: nil)
        let idx = r.columns.firstIndex { $0.name == "_value" } ?? 0
        return r.rows.map { TableInfo(name: $0[idx].description, schema: b) }
    }

    public func serverVersion() async throws -> String {
        guard let http else { return "InfluxDB" }
        let json = try await http.request("GET", "/health").json() as? [String: Any]
        return "InfluxDB " + (json?["version"] as? String ?? "")
    }

    public func previewQuery(for table: TableInfo, database: String?, limit: Int) -> String {
        let b = table.schema ?? database ?? bucket ?? "my-bucket"
        return """
        from(bucket: \(Self.fluxString(b)))
          |> range(start: -1h)
          |> filter(fn: (r) => r._measurement == \(Self.fluxString(table.name)))
          |> limit(n: \(limit))
        """
    }

    static func fluxString(_ s: String) -> String {
        "\"" + s.replacingOccurrences(of: "\\", with: "\\\\").replacingOccurrences(of: "\"", with: "\\\"") + "\""
    }
}

/// Parser for InfluxDB annotated CSV (multiple tables separated by blank lines).
enum AnnotatedCSV {
    static func parse(_ text: String) -> QueryResult {
        var columns: [String] = []
        var objects: [[String: Any]] = []
        var header: [String]?
        for rawLine in text.components(separatedBy: .newlines) {
            let line = rawLine.trimmingCharacters(in: CharacterSet(charactersIn: "\r"))
            if line.isEmpty { header = nil; continue }
            if line.hasPrefix("#") { continue }
            let fields = splitCSV(line)
            guard let h = header else {
                header = fields
                for name in fields where !name.isEmpty && name != "result" && name != "table" && !columns.contains(name) {
                    columns.append(name)
                }
                continue
            }
            var obj: [String: Any] = [:]
            for (i, name) in h.enumerated() where i < fields.count && !name.isEmpty { obj[name] = fields[i] }
            objects.append(obj)
        }
        let rows = objects.map { o in columns.map { JSONCells.cell(o[$0]) } }
        return QueryResult(columns: columns.map { ColumnDef(name: $0) }, rows: rows)
    }

    static func splitCSV(_ line: String) -> [String] {
        var out: [String] = []
        var cur = ""
        var quoted = false
        var chars = Array(line)
        var i = 0
        while i < chars.count {
            let c = chars[i]
            if quoted {
                if c == "\"" {
                    if i + 1 < chars.count && chars[i + 1] == "\"" { cur.append("\""); i += 1 } else { quoted = false }
                } else { cur.append(c) }
            } else if c == "\"" { quoted = true }
            else if c == "," { out.append(cur); cur = "" }
            else { cur.append(c) }
            i += 1
        }
        out.append(cur)
        chars.removeAll()
        return out
    }
}
