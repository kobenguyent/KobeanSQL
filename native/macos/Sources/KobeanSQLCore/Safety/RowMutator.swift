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

    // MARK: - Bulk CRUD Builders

    /// Builds a multi-row `INSERT INTO table (c1, c2) VALUES (r1c1, r1c2), (r2c1, r2c2);`.
    public static func buildBulkInsertSQL(
        table: TableInfo,
        dialect: DatabaseType,
        isDemo: Bool = false,
        columns: [String],
        rows: [[CellValue]]
    ) throws -> String {
        let validCols = columns.map { $0.trimmingCharacters(in: .whitespacesAndNewlines) }.filter { !$0.isEmpty }
        guard !validCols.isEmpty else {
            throw DatabaseError("Bulk insert requires at least one column.")
        }
        guard !rows.isEmpty else {
            throw DatabaseError("Bulk insert requires at least one row.")
        }
        let colList = validCols.map { quoteIdentifier($0, dialect: dialect) }.joined(separator: ", ")
        let tupleList = rows.map { row -> String in
            let cells = (0..<validCols.count).map { idx -> String in
                let val = idx < row.count ? row[idx] : .null
                return quoteLiteral(val, dialect: dialect)
            }.joined(separator: ", ")
            return "(\(cells))"
        }.joined(separator: ",\n  ")
        return "INSERT INTO \(qualifyTable(table, dialect: dialect, isDemo: isDemo)) (\(colList)) VALUES\n  \(tupleList);"
    }

    /// Builds a bulk `UPDATE table SET c1 = v1, c2 = v2 WHERE ...;` across multiple rows.
    public static func buildBulkUpdateSQL(
        table: TableInfo,
        dialect: DatabaseType,
        isDemo: Bool = false,
        columns: [ColumnDef],
        pkColumnNames: Set<String>,
        targetRows: [[CellValue]],
        updatedValues: [(column: String, value: CellValue)]
    ) throws -> String {
        guard !targetRows.isEmpty else {
            throw DatabaseError("Bulk update requires at least one selected row.")
        }
        guard !updatedValues.isEmpty else {
            throw DatabaseError("Bulk update requires at least one modified column.")
        }
        let setClause = updatedValues
            .map { "\(quoteIdentifier($0.column, dialect: dialect)) = \(quoteLiteral($0.value, dialect: dialect))" }
            .joined(separator: ", ")
        let whereClause = try buildBulkWhereClause(
            columns: columns,
            pkColumnNames: pkColumnNames,
            rows: targetRows,
            dialect: dialect
        )
        return "UPDATE \(qualifyTable(table, dialect: dialect, isDemo: isDemo)) SET \(setClause) WHERE \(whereClause);"
    }

    /// Builds a bulk `DELETE FROM table WHERE ...;` across multiple rows.
    public static func buildBulkDeleteSQL(
        table: TableInfo,
        dialect: DatabaseType,
        isDemo: Bool = false,
        columns: [ColumnDef],
        pkColumnNames: Set<String>,
        rows: [[CellValue]]
    ) throws -> String {
        guard !rows.isEmpty else {
            throw DatabaseError("Bulk delete requires at least one row.")
        }
        let whereClause = try buildBulkWhereClause(
            columns: columns,
            pkColumnNames: pkColumnNames,
            rows: rows,
            dialect: dialect
        )
        return "DELETE FROM \(qualifyTable(table, dialect: dialect, isDemo: isDemo)) WHERE \(whereClause);"
    }

    /// Builds a multi-row `INSERT INTO table (non_pk_cols...) VALUES (...), (...);` for duplicating multiple rows.
    public static func buildBulkDuplicateSQL(
        table: TableInfo,
        dialect: DatabaseType,
        isDemo: Bool = false,
        columns: [ColumnDef],
        pkColumnNames: Set<String>,
        rows: [[CellValue]]
    ) throws -> String {
        guard !rows.isEmpty else {
            throw DatabaseError("Bulk duplicate requires at least one row.")
        }
        var duplicateColIndices: [Int] = []
        var duplicateColNames: [String] = []
        for (idx, col) in columns.enumerated() {
            if pkColumnNames.contains(col.name) { continue }
            if pkColumnNames.isEmpty && col.name.lowercased() == "id" && columns.count > 1 { continue }
            duplicateColIndices.append(idx)
            duplicateColNames.append(col.name)
        }
        guard !duplicateColNames.isEmpty else {
            throw DatabaseError("Duplicate row mutation requires at least one non-primary-key column.")
        }
        let projectedRows: [[CellValue]] = rows.map { row in
            duplicateColIndices.map { idx in idx < row.count ? row[idx] : .null }
        }
        return try buildBulkInsertSQL(
            table: table,
            dialect: dialect,
            isDemo: isDemo,
            columns: duplicateColNames,
            rows: projectedRows
        )
    }

    /// Parses CSV or TSV text into column names and typed `CellValue` rows for bulk insert.
    public static func parseBulkDelimited(
        _ rawText: String,
        tableColumns: [ColumnDef],
        schemaColumns: [String: ColumnInfo] = [:]
    ) throws -> (columns: [String], rows: [[CellValue]]) {
        let lines = rawText
            .components(separatedBy: .newlines)
            .map { $0.trimmingCharacters(in: .whitespacesAndNewlines) }
            .filter { !$0.isEmpty }
        guard !lines.isEmpty else {
            throw DatabaseError("Paste or load at least one non-empty CSV/TSV line.")
        }

        let delimiter: Character = lines[0].contains("\t") ? "\t" : ","
        let parsedRecords = lines.map { splitDelimitedLine($0, delimiter: delimiter) }

        let knownColMap = Dictionary(uniqueKeysWithValues: tableColumns.map { ($0.name.lowercased(), $0.name) })
        let firstRow = parsedRecords[0]
        let isHeader = !firstRow.isEmpty && firstRow.allSatisfy { knownColMap[$0.lowercased()] != nil }

        let targetColNames: [String]
        let dataRecords: [[String]]

        if isHeader {
            targetColNames = firstRow.compactMap { knownColMap[$0.lowercased()] }
            dataRecords = Array(parsedRecords.dropFirst())
        } else {
            // Default to non-auto-PK columns if column count matches, otherwise prefix of tableColumns
            let nonPKCols = tableColumns.filter { col in
                let isPK = schemaColumns[col.name]?.primaryKey ?? (col.name.lowercased() == "id")
                return !isPK
            }
            if firstRow.count == nonPKCols.count && !nonPKCols.isEmpty {
                targetColNames = nonPKCols.map(\.name)
            } else {
                targetColNames = Array(tableColumns.prefix(firstRow.count).map(\.name))
            }
            dataRecords = parsedRecords
        }

        guard !targetColNames.isEmpty else {
            throw DatabaseError("Could not match columns for bulk import.")
        }
        guard !dataRecords.isEmpty else {
            throw DatabaseError("No data rows found after header row.")
        }

        let typeLookup = Dictionary(uniqueKeysWithValues: tableColumns.map { ($0.name, schemaColumns[$0.name]?.type ?? $0.type) })
        let typedRows: [[CellValue]] = dataRecords.map { rec in
            targetColNames.enumerated().map { idx, colName in
                guard idx < rec.count else { return .null }
                let rawVal = rec[idx]
                if rawVal.isEmpty { return .null }
                return parseInput(rawVal, columnType: typeLookup[colName] ?? "")
            }
        }
        return (targetColNames, typedRows)
    }

    /// Parses a JSON array of objects (`[{"col": "val"}, ...]`) into columns and typed `CellValue` rows.
    public static func parseBulkJSON(
        _ rawJSON: String,
        tableColumns: [ColumnDef],
        schemaColumns: [String: ColumnInfo] = [:]
    ) throws -> (columns: [String], rows: [[CellValue]]) {
        guard let data = rawJSON.data(using: .utf8),
              let array = try? JSONSerialization.jsonObject(with: data) as? [[String: Any]],
              !array.isEmpty else {
            throw DatabaseError("Expected a non-empty JSON array of objects, e.g. [{\"name\": \"Ada\"}].")
        }

        var presentKeys = Set<String>()
        for obj in array {
            for k in obj.keys { presentKeys.insert(k) }
        }

        let orderedTableCols = tableColumns.map(\.name).filter { presentKeys.contains($0) }
        let extraCols = presentKeys.subtracting(orderedTableCols).sorted()
        let finalCols = orderedTableCols + extraCols
        guard !finalCols.isEmpty else {
            throw DatabaseError("JSON objects must contain at least one property.")
        }

        let typeLookup = Dictionary(uniqueKeysWithValues: tableColumns.map { ($0.name, schemaColumns[$0.name]?.type ?? $0.type) })
        let typedRows: [[CellValue]] = array.map { obj in
            finalCols.map { col in
                guard let val = obj[col], !(val is NSNull) else { return .null }
                if let b = val as? Bool { return .bool(b) }
                if let i = val as? Int64 { return .integer(i) }
                if let i = val as? Int { return .integer(Int64(i)) }
                if let d = val as? Double { return .double(d) }
                if let s = val as? String { return parseInput(s, columnType: typeLookup[col] ?? "") }
                if let nested = try? JSONSerialization.data(withJSONObject: val),
                   let str = String(data: nested, encoding: .utf8) {
                    return .text(str)
                }
                return .text(String(describing: val))
            }
        }
        return (finalCols, typedRows)
    }

    private static func splitDelimitedLine(_ line: String, delimiter: Character) -> [String] {
        var result: [String] = []
        var current = ""
        var inQuotes = false
        let chars = Array(line)
        var i = 0
        while i < chars.count {
            let ch = chars[i]
            if ch == "\"" {
                if inQuotes && i + 1 < chars.count && chars[i + 1] == "\"" {
                    current.append("\"")
                    i += 2
                    continue
                }
                inQuotes.toggle()
            } else if ch == delimiter && !inQuotes {
                result.append(current.trimmingCharacters(in: .whitespaces))
                current = ""
            } else {
                current.append(ch)
            }
            i += 1
        }
        result.append(current.trimmingCharacters(in: .whitespaces))
        return result
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

    private static func buildBulkWhereClause(
        columns: [ColumnDef],
        pkColumnNames: Set<String>,
        rows: [[CellValue]],
        dialect: DatabaseType
    ) throws -> String {
        guard !rows.isEmpty else {
            throw DatabaseError("Row mutation requires at least one row.")
        }
        // Check if we have a single identifying column with all non-null values for a clean `IN (...)` clause
        let keyIndices: [Int]
        if !pkColumnNames.isEmpty {
            keyIndices = columns.enumerated().compactMap { pkColumnNames.contains($0.element.name) ? $0.offset : nil }
        } else if let idIdx = columns.firstIndex(where: { $0.name.lowercased() == "id" || $0.name == "_id" }) {
            keyIndices = [idIdx]
        } else {
            keyIndices = Array(columns.indices)
        }

        if keyIndices.count == 1,
           let pkIdx = keyIndices.first,
           pkIdx < columns.count,
           rows.allSatisfy({ pkIdx < $0.count && !$0[pkIdx].isNull }) {
            let ident = quoteIdentifier(columns[pkIdx].name, dialect: dialect)
            if rows.count == 1 {
                return "\(ident) = \(quoteLiteral(rows[0][pkIdx], dialect: dialect))"
            }
            let inList = rows.map { quoteLiteral($0[pkIdx], dialect: dialect) }.joined(separator: ", ")
            return "\(ident) IN (\(inList))"
        }

        let clauses = try rows.map { row -> String in
            let c = try buildWhereClause(columns: columns, pkColumnNames: pkColumnNames, row: row, dialect: dialect)
            return rows.count > 1 && c.contains(" AND ") ? "(\(c))" : c
        }
        return clauses.joined(separator: " OR ")
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
