import Foundation

public struct ColumnDef: Hashable, Sendable {
    public var name: String
    public var type: String
    public init(name: String, type: String = "") {
        self.name = name
        self.type = type
    }
}

/// A single cell value. Drivers convert everything to display-ready values so the
/// UI never needs driver-specific knowledge.
public enum CellValue: Hashable, Sendable, CustomStringConvertible {
    case null
    case text(String)
    case integer(Int64)
    case double(Double)
    case bool(Bool)
    case blob(Int) // byte count

    public var description: String {
        switch self {
        case .null: "NULL"
        case .text(let s): s
        case .integer(let i): String(i)
        case .double(let d): String(d)
        case .bool(let b): b ? "true" : "false"
        case .blob(let n): "<BLOB \(n) bytes>"
        }
    }

    public var isNull: Bool { if case .null = self { true } else { false } }

    /// JSON-compatible representation for exports.
    public var jsonValue: Any {
        switch self {
        case .null: NSNull()
        case .text(let s): s
        case .integer(let i): i
        case .double(let d): d
        case .bool(let b): b
        case .blob: description
        }
    }
}

public struct QueryResult: Hashable, Sendable {
    public var columns: [ColumnDef]
    public var rows: [[CellValue]]
    /// Rows returned, or rows affected for DML statements.
    public var rowCount: Int
    public var duration: TimeInterval
    /// Non-fatal notice (e.g. "Result set limited to 10000 rows for safety.").
    public var notice: String?
    /// The statement actually sent to the server (after safety rewrites).
    public var executedQuery: String = ""

    public init(columns: [ColumnDef] = [], rows: [[CellValue]] = [], rowCount: Int? = nil,
                duration: TimeInterval = 0, notice: String? = nil) {
        self.columns = columns
        self.rows = rows
        self.rowCount = rowCount ?? rows.count
        self.duration = duration
        self.notice = notice
    }

    public static func affected(_ count: Int) -> QueryResult {
        QueryResult(columns: [], rows: [], rowCount: count)
    }
}

public struct TableInfo: Hashable, Sendable, Identifiable {
    public enum Kind: String, Sendable { case table, view }
    public var name: String
    public var kind: Kind
    public var schema: String?
    public var id: String { [schema, name].compactMap { $0 }.joined(separator: ".") }

    public init(name: String, kind: Kind = .table, schema: String? = nil) {
        self.name = name
        self.kind = kind
        self.schema = schema
    }
}

public struct ColumnInfo: Hashable, Sendable, Identifiable {
    public var name: String
    public var type: String
    public var nullable: Bool
    public var primaryKey: Bool
    public var defaultValue: String?
    public var id: String { name }

    public init(name: String, type: String, nullable: Bool = true, primaryKey: Bool = false, defaultValue: String? = nil) {
        self.name = name
        self.type = type
        self.nullable = nullable
        self.primaryKey = primaryKey
        self.defaultValue = defaultValue
    }
}

public struct DatabaseError: LocalizedError, Sendable {
    public var message: String
    public init(_ message: String) { self.message = message }
    public var errorDescription: String? { message }
}
