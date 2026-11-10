import Foundation

/// Port of the safety guards from `src/main/db/manager.ts` / GEMINI.md:
/// - auto-append `LIMIT 1000` to unbounded SELECTs
/// - cap result sets at 10,000 rows
/// - 30s query timeout, 15s connect timeout
public enum QueryGuard {
    public static let autoLimit = 1000
    public static let maxRows = 10_000
    public static let queryTimeout: TimeInterval = 30
    public static let connectTimeout: TimeInterval = 15

    /// Appends a row limit to unbounded SELECT/WITH statements (same rules as `applySafetyLimit`).
    public static func applySafetyLimit(_ sql: String, type: DatabaseType, limit: Int = autoLimit) -> String {
        guard type.usesSQLLimitGuard else { return sql }
        var trimmed = sql.trimmingCharacters(in: .whitespacesAndNewlines)
        while trimmed.hasSuffix(";") { trimmed.removeLast(); trimmed = trimmed.trimmingCharacters(in: .whitespacesAndNewlines) }

        guard matches(trimmed, #"^(SELECT|WITH)\s+"#) else { return sql }
        // Multiple statements: don't guess where to inject.
        guard !trimmed.contains(";") else { return sql }
        if matches(trimmed, #"\s+LIMIT\s+\d+"#) || matches(trimmed, #"\s+TOP\s+\d+"#) || matches(trimmed, #"\s+FETCH\s+NEXT\s+\d+"#) {
            return sql
        }

        switch type {
        case .mssql:
            if matches(trimmed, #"^SELECT\s+"#) && !matches(trimmed, #"^SELECT\s+TOP\s+"#) {
                return trimmed.replacingOccurrences(of: #"^SELECT\s+"#, with: "SELECT TOP \(limit) ",
                                                    options: [.regularExpression, .caseInsensitive])
            }
            return sql
        case .oracle:
            return "\(trimmed) FETCH NEXT \(limit) ROWS ONLY"
        default:
            return "\(trimmed) LIMIT \(limit)"
        }
    }

    /// Truncates a result to `maxRows`, attaching a notice.
    public static func capRows(_ result: QueryResult, max: Int = maxRows) -> QueryResult {
        guard result.rows.count > max else { return result }
        var copy = result
        copy.rows = Array(result.rows.prefix(max))
        let notice = "Result set limited to \(max) rows for safety."
        copy.notice = [result.notice, notice].compactMap { $0 }.joined(separator: " ")
        return copy
    }

    /// Runs `operation` with a deadline, throwing a friendly error when it's exceeded.
    public static func withTimeout<T: Sendable>(
        _ seconds: TimeInterval,
        message: String,
        _ operation: @escaping @Sendable () async throws -> T
    ) async throws -> T {
        try await withThrowingTaskGroup(of: T.self) { group in
            group.addTask { try await operation() }
            group.addTask {
                try await Task.sleep(nanoseconds: UInt64(seconds * 1_000_000_000))
                throw DatabaseError(message)
            }
            defer { group.cancelAll() }
            return try await group.next()!
        }
    }

    /// Returns true if the statement mutates data or schema (used to enforce Read-Only Safe Mode).
    public static func isWriteOrDDL(_ query: String, type: DatabaseType) -> Bool {
        let trimmed = stripLeadingComments(query)
        guard !trimmed.isEmpty else { return false }
        switch type {
        case .redis:
            return matches(trimmed, #"^(SET|HSET|HMSET|DEL|HDEL|LPUSH|RPUSH|LSET|LREM|SADD|SREM|ZADD|ZREM|FLUSHDB|FLUSHALL|EXPIRE|PERSIST|RENAME|INCR|DECR)\b"#)
        case .elasticsearch:
            return matches(trimmed, #"^(POST|PUT|DELETE)\s+"#) && !matches(trimmed, #"^POST\s+/[^\s]+/_search"#)
        case .neo4j:
            return matches(trimmed, #"\b(CREATE|MERGE|DELETE|DETACH|SET|REMOVE|DROP)\b"#)
        default:
            return matches(trimmed, #"^(INSERT|UPDATE|DELETE|DROP|TRUNCATE|ALTER|CREATE|REPLACE|GRANT|REVOKE|VACUUM|ATTACH|DETACH)\b"#)
        }
    }

    /// Detects high-risk destructive statements (`DROP`, `TRUNCATE`, or `DELETE`/`UPDATE` without `WHERE`).
    public static func detectDestructiveRisk(_ query: String, type: DatabaseType) -> String? {
        for stmt in StatementSplitter.split(query, type: type) {
            let cleaned = stripLeadingComments(stmt)
            if matches(cleaned, #"^DROP\s+(TABLE|VIEW|DATABASE|SCHEMA|INDEX)\b"#) {
                return "This query contains a DROP statement that will permanently destroy schema objects."
            }
            if matches(cleaned, #"^TRUNCATE\b"#) || matches(cleaned, #"^FLUSH(DB|ALL)\b"#) {
                return "This query will wipe all data in the target table or database."
            }
            if matches(cleaned, #"^DELETE\s+FROM\b"#) && !matches(cleaned, #"\bWHERE\b"#) {
                return "This DELETE statement has no WHERE clause and will delete every row in the table."
            }
            if matches(cleaned, #"^UPDATE\s+\S+"#) && matches(cleaned, #"\bSET\b"#) && !matches(cleaned, #"\bWHERE\b"#) {
                return "This UPDATE statement has no WHERE clause and will overwrite every row in the table."
            }
        }
        return nil
    }

    /// Scrubs inline credentials from queries or error strings before persisting to history logs.
    public static func redactSecrets(_ text: String) -> String {
        var out = text
        out = out.replacingOccurrences(
            of: #"([a-zA-Z0-9+.-]+://[^:\s/@]+:)([^@\s]+)(@)"#,
            with: "$1***$3",
            options: .regularExpression
        )
        out = out.replacingOccurrences(
            of: #"(?i)(IDENTIFIED\s+BY|PASSWORD\s*=?\s*)'[^']*'"#,
            with: "$1'***'",
            options: .regularExpression
        )
        return out
    }

    private static func stripLeadingComments(_ sql: String) -> String {
        var s = sql.trimmingCharacters(in: .whitespacesAndNewlines)
        while true {
            if s.hasPrefix("--") || s.hasPrefix("#") {
                if let nl = s.firstIndex(of: "\n") {
                    s = String(s[s.index(after: nl)...]).trimmingCharacters(in: .whitespacesAndNewlines)
                } else {
                    return ""
                }
            } else if s.hasPrefix("/*") {
                if let end = s.range(of: "*/") {
                    s = String(s[end.upperBound...]).trimmingCharacters(in: .whitespacesAndNewlines)
                } else {
                    return ""
                }
            } else {
                break
            }
        }
        return s
    }

    private static func matches(_ s: String, _ pattern: String) -> Bool {
        s.range(of: pattern, options: [.regularExpression, .caseInsensitive]) != nil
    }
}
