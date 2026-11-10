import Foundation

/// Result export helpers (CSV / JSON / Markdown).
public enum ResultExporter {
    public static func csv(_ result: QueryResult) -> String {
        func esc(_ s: String) -> String {
            s.contains(where: { $0 == "," || $0 == "\"" || $0.isNewline }) ? "\"" + s.replacingOccurrences(of: "\"", with: "\"\"") + "\"" : s
        }
        var lines = [result.columns.map { esc($0.name) }.joined(separator: ",")]
        for row in result.rows {
            lines.append(row.map { $0.isNull ? "" : esc($0.description) }.joined(separator: ","))
        }
        return lines.joined(separator: "\n") + "\n"
    }

    public static func json(_ result: QueryResult) throws -> String {
        let objects: [[String: Any]] = result.rows.map { row in
            Dictionary(zip(result.columns.map(\.name), row.map(\.jsonValue)), uniquingKeysWith: { a, _ in a })
        }
        let data = try JSONSerialization.data(withJSONObject: objects, options: [.prettyPrinted, .sortedKeys, .withoutEscapingSlashes])
        return String(decoding: data, as: UTF8.self)
    }

    /// Tab-separated rows for pasting into spreadsheets.
    public static func tsv(columns: [ColumnDef], rows: [[CellValue]], includeHeader: Bool = true) -> String {
        var lines: [String] = []
        if includeHeader { lines.append(columns.map(\.name).joined(separator: "\t")) }
        lines += rows.map { $0.map { $0.isNull ? "" : $0.description.replacingOccurrences(of: "\t", with: " ") }.joined(separator: "\t") }
        return lines.joined(separator: "\n")
    }
}
