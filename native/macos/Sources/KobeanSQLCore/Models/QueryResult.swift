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

    /// Fast truncated single-line preview for `NSTableView` cells so huge TEXT/JSON payloads never stall CoreText layout.
    public func displayPreview(maxLength: Int = 240) -> String {
        switch self {
        case .null:
            return "NULL"
        case .text(let s):
            let singleLine = s.replacingOccurrences(of: "\r\n", with: "↵").replacingOccurrences(of: "\n", with: "↵")
            if singleLine.count <= maxLength { return singleLine }
            return String(singleLine.prefix(maxLength)) + "…"
        default:
            return description
        }
    }

    /// Type-aware ordering for sorting result columns (`NULL` values sort last).
    public static func compare(_ lhs: CellValue, _ rhs: CellValue, ascending: Bool = true) -> Bool {
        if lhs.isNull && rhs.isNull { return false }
        if lhs.isNull { return false } // NULL always last
        if rhs.isNull { return true }

        let ordered: ComparisonResult
        switch (lhs, rhs) {
        case (.integer(let a), .integer(let b)):
            ordered = a < b ? .orderedAscending : (a > b ? .orderedDescending : .orderedSame)
        case (.double(let a), .double(let b)):
            ordered = a < b ? .orderedAscending : (a > b ? .orderedDescending : .orderedSame)
        case (.integer(let a), .double(let b)):
            let da = Double(a)
            ordered = da < b ? .orderedAscending : (da > b ? .orderedDescending : .orderedSame)
        case (.double(let a), .integer(let b)):
            let db = Double(b)
            ordered = a < db ? .orderedAscending : (a > db ? .orderedDescending : .orderedSame)
        case (.bool(let a), .bool(let b)):
            ordered = (a == b) ? .orderedSame : (!a && b ? .orderedAscending : .orderedDescending)
        case (.blob(let a), .blob(let b)):
            ordered = a < b ? .orderedAscending : (a > b ? .orderedDescending : .orderedSame)
        default:
            let sa = lhs.description
            let sb = rhs.description
            if let na = Double(sa), let nb = Double(sb) {
                ordered = na < nb ? .orderedAscending : (na > nb ? .orderedDescending : .orderedSame)
            } else {
                ordered = sa.localizedStandardCompare(sb)
            }
        }
        if ordered == .orderedSame { return false }
        return ascending ? (ordered == .orderedAscending) : (ordered == .orderedDescending)
    }

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

public struct ForeignKeyInfo: Hashable, Sendable, Identifiable {
    public var columnName: String
    public var referencedTable: String
    public var referencedSchema: String?
    public var referencedColumn: String
    public var id: String { "\(columnName)->\(referencedSchema ?? "").\(referencedTable).\(referencedColumn)" }

    public init(columnName: String, referencedTable: String, referencedSchema: String? = nil, referencedColumn: String = "id") {
        self.columnName = columnName
        self.referencedTable = referencedTable
        self.referencedSchema = referencedSchema
        self.referencedColumn = referencedColumn
    }
}

public struct DatabaseError: LocalizedError, Sendable {
    public var message: String
    public init(_ message: String) { self.message = message }
    public var errorDescription: String? { message }
}
