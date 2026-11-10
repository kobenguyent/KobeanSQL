import Foundation

/// Minimal async HTTP client shared by the HTTP-based drivers.
final class HTTPClient: NSObject, URLSessionDelegate, @unchecked Sendable {
    struct Response {
        var status: Int
        var data: Data
        var text: String { String(decoding: data, as: UTF8.self) }
        func json() throws -> Any { try JSONSerialization.jsonObject(with: data, options: [.fragmentsAllowed]) }
    }

    let baseURL: URL
    private var headers: [String: String]
    private let allowSelfSigned: Bool
    private lazy var session: URLSession = {
        let cfg = URLSessionConfiguration.ephemeral
        cfg.timeoutIntervalForRequest = QueryGuard.connectTimeout
        cfg.timeoutIntervalForResource = QueryGuard.queryTimeout
        cfg.waitsForConnectivity = false
        cfg.httpMaximumConnectionsPerHost = 5
        return URLSession(configuration: cfg, delegate: self, delegateQueue: nil)
    }()

    init(baseURL: URL, headers: [String: String] = [:], allowSelfSigned: Bool) {
        self.baseURL = baseURL
        self.headers = headers
        self.allowSelfSigned = allowSelfSigned
    }

    static func make(config: ConnectionConfig, defaultPort: Int, headers: [String: String] = [:]) throws -> HTTPClient {
        let scheme = config.ssl == true ? "https" : "http"
        let host = config.host?.isEmpty == false ? config.host! : "localhost"
        guard let url = URL(string: "\(scheme)://\(host):\(config.port ?? defaultPort)") else {
            throw DatabaseError("Invalid host \(host)")
        }
        return HTTPClient(baseURL: url, headers: headers, allowSelfSigned: config.ssl == true)
    }

    static func basicAuth(user: String?, password: String?) -> [String: String] {
        guard let user, !user.isEmpty else { return [:] }
        let token = Data("\(user):\(password ?? "")".utf8).base64EncodedString()
        return ["Authorization": "Basic \(token)"]
    }

    func request(_ method: String, _ path: String, query: [String: String] = [:], body: Data? = nil,
                 contentType: String? = nil, accept: String? = nil) async throws -> Response {
        var comps = URLComponents(url: baseURL, resolvingAgainstBaseURL: false)!
        let (rawPath, rawQuery) = Self.splitPath(path)
        comps.percentEncodedPath = rawPath.hasPrefix("/") ? rawPath : "/" + rawPath
        var items = rawQuery.map { URLComponents(string: "?" + $0)?.queryItems ?? [] } ?? []
        items += query.sorted { $0.key < $1.key }.map { URLQueryItem(name: $0.key, value: $0.value) }
        comps.queryItems = items.isEmpty ? nil : items
        guard let url = comps.url else { throw DatabaseError("Invalid request path \(path)") }

        var req = URLRequest(url: url)
        req.httpMethod = method
        req.httpBody = body
        headers.forEach { req.setValue($0.value, forHTTPHeaderField: $0.key) }
        if let contentType { req.setValue(contentType, forHTTPHeaderField: "Content-Type") }
        if let accept { req.setValue(accept, forHTTPHeaderField: "Accept") }

        let (data, response) = try await session.data(for: req)
        return Response(status: (response as? HTTPURLResponse)?.statusCode ?? 0, data: data)
    }

    private static func splitPath(_ path: String) -> (String, String?) {
        guard let q = path.firstIndex(of: "?") else { return (path, nil) }
        return (String(path[..<q]), String(path[path.index(after: q)...]))
    }

    func invalidate() { session.invalidateAndCancel() }

    // Self-signed certificates are common for local Elasticsearch/ClickHouse installs; the Electron
    // adapters use `rejectUnauthorized: false`, so we match that only when SSL is enabled.
    func urlSession(_ session: URLSession, didReceive challenge: URLAuthenticationChallenge,
                    completionHandler: @escaping (URLSession.AuthChallengeDisposition, URLCredential?) -> Void) {
        if allowSelfSigned,
           challenge.protectionSpace.authenticationMethod == NSURLAuthenticationMethodServerTrust,
           let trust = challenge.protectionSpace.serverTrust {
            completionHandler(.useCredential, URLCredential(trust: trust))
        } else {
            completionHandler(.performDefaultHandling, nil)
        }
    }
}

enum JSONCells {
    static func cell(_ value: Any?) -> CellValue {
        switch value {
        case nil, is NSNull: return .null
        case let n as NSNumber:
            if CFGetTypeID(n) == CFBooleanGetTypeID() { return .bool(n.boolValue) }
            if CFNumberIsFloatType(n) { return .double(n.doubleValue) }
            return .integer(n.int64Value)
        case let s as String: return .text(s)
        case let v?:
            if JSONSerialization.isValidJSONObject(v),
               let data = try? JSONSerialization.data(withJSONObject: v, options: [.sortedKeys, .withoutEscapingSlashes]) {
                return .text(String(decoding: data, as: UTF8.self))
            }
            return .text(String(describing: v))
        }
    }

    static func pretty(_ data: Data) -> String {
        guard let obj = try? JSONSerialization.jsonObject(with: data, options: [.fragmentsAllowed]),
              let out = try? JSONSerialization.data(withJSONObject: obj, options: [.prettyPrinted, .sortedKeys, .fragmentsAllowed])
        else { return String(decoding: data, as: UTF8.self) }
        return String(decoding: out, as: UTF8.self)
    }

    /// Builds a grid from an array of JSON objects, preserving first-seen key order.
    static func grid(from objects: [[String: Any]], leading: [String] = []) -> QueryResult {
        var order = leading
        var seen = Set(leading)
        for obj in objects {
            for key in obj.keys.sorted() where !seen.contains(key) {
                seen.insert(key)
                order.append(key)
            }
        }
        let rows = objects.map { obj in order.map { cell(obj[$0]) } }
        return QueryResult(columns: order.map { ColumnDef(name: $0) }, rows: rows)
    }
}
