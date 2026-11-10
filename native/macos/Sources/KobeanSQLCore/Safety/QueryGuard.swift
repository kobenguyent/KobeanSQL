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

    private static func matches(_ s: String, _ pattern: String) -> Bool {
        s.range(of: pattern, options: [.regularExpression, .caseInsensitive]) != nil
    }
}
