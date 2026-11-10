import Foundation

/// Native Swift port of `src/main/db/mutations/sql-row-mutations.ts` and `src/main/db/mutations/copy-table.ts`.
/// Builds dialect-aware `INSERT`, `UPDATE`, `DELETE`, `DUPLICATE`, and `COPY TABLE` statements.
public enum CopyTableMode: String, CaseIterable, Identifiable, Sendable {
    case schemaAndData = "schema-and-data"
    case schemaOnly = "schema-only"
    case dataOnly = "data-only"

    public var id: String { rawValue }
    public var label: String {
        switch self {
        case .schemaAndData: "Schema & Data"
        case .schemaOnly: "Schema Only"
        case .dataOnly: "Data Only (into existing table)"
        }
    }
}

public enum RowMutator {
    public static func quoteIdentifier(_ name: String, dialect: DatabaseType) -> String {
        switch dialect {
        case .mssql:
            return "[" + name.replacingOccurrences(of: "]", with: "]]") + "]"
        case .mysql, .mariadb, .clickhouse:
            return SQLIdent.quote(name, with: "`")
        default:
            return SQLIdent.quote(name, with: "\"")
        }
    }

    public static func qualifyTable(_ table: TableInfo, dialect: DatabaseType, isDemo: Bool = false) -> String {
        let quotedTable = quoteIdentifier(table.name, dialect: dialect)
        if isDemo || dialect == .sqlite {
            return quotedTable
        }
        if let schema = table.schema, !schema.isEmpty, schema != "main" {
            return "\(quoteIdentifier(schema, dialect: dialect)).\(quotedTable)"
        }
        return quotedTable
    }

    public static func quoteLiteral(_ value: CellValue, dialect: DatabaseType) -> String {
        switch value {
        case .null:
            return "NULL"
        case .integer(let i):
            return String(i)
        case .double(let d):
            return String(d)
        case .bool(let b):
            if dialect == .mssql || dialect == .sqlite { return b ? "1" : "0" }
            return b ? "TRUE" : "FALSE"
        case .blob:
            return "NULL"
        case .text(let s):
            if s.uppercased() == "NULL" { return "NULL" }
            var escaped = s.replacingOccurrences(of: "'", with: "''")
            if dialect == .mysql || dialect == .mariadb {
                escaped = escaped.replacingOccurrences(of: "\\", with: "\\\\")
            }
            return "'\(escaped)'"
        }
    }

    /// Parses user input string from an insert/edit form into an appropriate `CellValue`.
    public static func parseInput(_ raw: String, columnType: String = "") -> CellValue {
        let trimmed = raw.trimmingCharacters(in: .whitespacesAndNewlines)
        if trimmed.uppercased() == "NULL" { return .null }
        let lowerType = columnType.lowercased()
        if lowerType.contains("int") || lowerType.contains("serial"), let i = Int64(trimmed) {
            return .integer(i)
        }
        if (lowerType.contains("real") || lowerType.contains("floa") || lowerType.contains("doub") || lowerType.contains("num") || lowerType.contains("dec")),
           let d = Double(trimmed) {
            return .double(d)
        }
        if lowerType.contains("bool") {
            if ["true", "1", "yes"].contains(trimmed.lowercased()) { return .bool(true) }
            if ["false", "0", "no"].contains(trimmed.lowercased()) { return .bool(false) }
        }
        return .text(raw)
    }

    /// Builds `INSERT INTO table (col1, col2) VALUES (val1, val2);`.
    public static func buildInsertSQL(
        table: TableInfo,
        dialect: DatabaseType,
        isDemo: Bool = false,
        values: [(column: String, value: CellValue)]
    ) throws -> String {
        let nonEmpty = values.filter { !$0.column.isEmpty }
        guard !nonEmpty.isEmpty else {
            throw DatabaseError("Insert row mutation requires at least one column value.")
        }
        let cols = nonEmpty.map { quoteIdentifier($0.column, dialect: dialect) }.joined(separator: ", ")
        let vals = nonEmpty.map { quoteLiteral($0.value, dialect: dialect) }.joined(separator: ", ")
        return "INSERT INTO \(qualifyTable(table, dialect: dialect, isDemo: isDemo)) (\(cols)) VALUES (\(vals));"
    }

    /// Builds `UPDATE table SET col = newVal WHERE pk1 = val1 ...;`.
    public static func buildUpdateSQL(
        table: TableInfo,
        dialect: DatabaseType,
        isDemo: Bool = false,
        columns: [ColumnDef],
        pkColumnNames: Set<String>,
        originalRow: [CellValue],
        updatedValues: [(column: String, value: CellValue)]
    ) throws -> String {
        guard !updatedValues.isEmpty else {
            throw DatabaseError("No modified columns to update.")
        }
        let setClause = updatedValues
            .map { "\(quoteIdentifier($0.column, dialect: dialect)) = \(quoteLiteral($0.value, dialect: dialect))" }
            .joined(separator: ", ")
        let whereClause = try buildWhereClause(columns: columns, pkColumnNames: pkColumnNames, row: originalRow, dialect: dialect)
        return "UPDATE \(qualifyTable(table, dialect: dialect, isDemo: isDemo)) SET \(setClause) WHERE \(whereClause);"
    }

    /// Builds `DELETE FROM table WHERE pk1 = val1 ...;`.
    public static func buildDeleteSQL(
        table: TableInfo,
        dialect: DatabaseType,
        isDemo: Bool = false,
        columns: [ColumnDef],
        pkColumnNames: Set<String>,
        row: [CellValue]
    ) throws -> String {
        let whereClause = try buildWhereClause(columns: columns, pkColumnNames: pkColumnNames, row: row, dialect: dialect)
        return "DELETE FROM \(qualifyTable(table, dialect: dialect, isDemo: isDemo)) WHERE \(whereClause);"
    }

    /// Builds `INSERT INTO table (non_pk_cols...) VALUES (...);` (mirrors `buildDuplicateSql`).
    public static func buildDuplicateSQL(
        table: TableInfo,
        dialect: DatabaseType,
        isDemo: Bool = false,
        columns: [ColumnDef],
        pkColumnNames: Set<String>,
        row: [CellValue]
    ) throws -> String {
        var pairs: [(String, CellValue)] = []
        for (idx, col) in columns.enumerated() where idx < row.count {
            if pkColumnNames.contains(col.name) { continue }
            // Also skip common auto-increment `id` column if no PK metadata was loaded
            if pkColumnNames.isEmpty && col.name.lowercased() == "id" && columns.count > 1 { continue }
            pairs.append((col.name, row[idx]))
        }
        guard !pairs.isEmpty else {
            throw DatabaseError("Duplicate row mutation requires at least one non-primary-key column.")
        }
        return try buildInsertSQL(table: table, dialect: dialect, isDemo: isDemo, values: pairs)
    }

    /// Builds statements to copy a table (Schema & Data, Schema Only, or Data Only).
    public static func buildCopyTableSQL(
        source: TableInfo,
        targetName: String,
        mode: CopyTableMode,
        dialect: DatabaseType,
        isDemo: Bool = false
    ) throws -> [String] {
        let trimmedTarget = targetName.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !trimmedTarget.isEmpty else {
            throw DatabaseError("Target table name is required.")
        }
        guard trimmedTarget.lowercased() != source.name.lowercased() else {
            throw DatabaseError("Target table name must be different from source table.")
        }
        let targetTable = TableInfo(name: trimmedTarget, kind: .table, schema: source.schema)
        let srcSQL = qualifyTable(source, dialect: dialect, isDemo: isDemo)
        let dstSQL = qualifyTable(targetTable, dialect: dialect, isDemo: isDemo)

        switch mode {
        case .schemaOnly:
            if dialect == .postgres && !isDemo {
                return ["CREATE TABLE \(dstSQL) (LIKE \(srcSQL) INCLUDING ALL);"]
            }
            return ["CREATE TABLE \(dstSQL) AS SELECT * FROM \(srcSQL) WHERE 1 = 0;"]
        case .dataOnly:
            return ["INSERT INTO \(dstSQL) SELECT * FROM \(srcSQL);"]
        case .schemaAndData:
            if dialect == .postgres && !isDemo {
                return [
                    "CREATE TABLE \(dstSQL) (LIKE \(srcSQL) INCLUDING ALL);",
                    "INSERT INTO \(dstSQL) SELECT * FROM \(srcSQL);"
                ]
            }
            return ["CREATE TABLE \(dstSQL) AS SELECT * FROM \(srcSQL);"]
        }
    }

    private static func buildWhereClause(
        columns: [ColumnDef],
        pkColumnNames: Set<String>,
        row: [CellValue],
        dialect: DatabaseType
    ) throws -> String {
        var predicates: [String] = []
        for (idx, col) in columns.enumerated() where idx < row.count {
            if !pkColumnNames.isEmpty {
                if !pkColumnNames.contains(col.name) { continue }
            } else if let idIdx = columns.firstIndex(where: { $0.name.lowercased() == "id" || $0.name == "_id" }) {
                if idx != idIdx { continue }
            }
            let ident = quoteIdentifier(col.name, dialect: dialect)
            let val = row[idx]
            if val.isNull {
                predicates.append("\(ident) IS NULL")
            } else {
                predicates.append("\(ident) = \(quoteLiteral(val, dialect: dialect))")
            }
        }
        guard !predicates.isEmpty else {
            throw DatabaseError("Row mutation requires at least one identifying column.")
        }
        return predicates.joined(separator: " AND ")
    }
}
