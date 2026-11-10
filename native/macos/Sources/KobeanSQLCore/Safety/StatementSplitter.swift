import Foundation

/// Splits editor text into individual statements so engines that only accept one statement
/// per round-trip (Postgres extended protocol, MySQL COM_QUERY, HTTP APIs) can run scripts.
public enum StatementSplitter {
    public static func split(_ text: String, type: DatabaseType) -> [String] {
        switch type {
        case .redis:
            return text.components(separatedBy: .newlines)
                .map { $0.trimmingCharacters(in: .whitespaces) }
                .filter { !$0.isEmpty && !$0.hasPrefix("#") && !$0.hasPrefix("//") }
        case .elasticsearch, .influxdb:
            // Request bodies / Flux pipelines span lines and contain no statement separator.
            let t = text.trimmingCharacters(in: .whitespacesAndNewlines)
            return t.isEmpty ? [] : [t]
        default:
            return splitSQL(text)
        }
    }

    /// Splits on `;` outside of quotes, comments, and Postgres dollar-quoted bodies.
    public static func splitSQL(_ text: String) -> [String] {
        var statements: [String] = []
        var current = ""
        let chars = Array(text)
        var i = 0
        var quote: Character?
        var dollarTag: String?
        var lineComment = false
        var blockComment = false

        func flush() {
            let s = current.trimmingCharacters(in: .whitespacesAndNewlines)
            if !s.isEmpty && !isOnlyComments(s) { statements.append(s) }
            current = ""
        }

        while i < chars.count {
            let c = chars[i]
            let next: Character? = i + 1 < chars.count ? chars[i + 1] : nil

            if lineComment {
                current.append(c)
                if c == "\n" { lineComment = false }
            } else if blockComment {
                current.append(c)
                if c == "*" && next == "/" { current.append("/"); i += 1; blockComment = false }
            } else if let tag = dollarTag {
                if c == "$" && String(chars[i..<min(chars.count, i + tag.count)]) == tag {
                    current += tag
                    i += tag.count - 1
                    dollarTag = nil
                } else { current.append(c) }
            } else if let q = quote {
                current.append(c)
                if c == q {
                    if next == q { current.append(q); i += 1 } else { quote = nil }
                } else if c == "\\" && q != "`", let n = next {
                    current.append(n); i += 1
                }
            } else if c == "-" && next == "-" {
                lineComment = true; current.append(c)
            } else if c == "#" && (i == 0 || chars[i - 1].isNewline) {
                lineComment = true; current.append(c)
            } else if c == "/" && next == "*" {
                blockComment = true; current += "/*"; i += 1
            } else if c == "'" || c == "\"" || c == "`" {
                quote = c; current.append(c)
            } else if c == "$", let tag = dollarQuoteTag(chars, at: i) {
                dollarTag = tag; current += tag; i += tag.count - 1
            } else if c == ";" {
                flush()
            } else {
                current.append(c)
            }
            i += 1
        }
        flush()
        return statements
    }

    private static func dollarQuoteTag(_ chars: [Character], at start: Int) -> String? {
        var j = start + 1
        while j < chars.count, chars[j].isLetter || chars[j].isNumber || chars[j] == "_" { j += 1 }
        guard j < chars.count, chars[j] == "$" else { return nil }
        if j > start + 1, chars[start + 1].isNumber { return nil } // $1 positional parameter
        return String(chars[start...j])
    }

    private static func isOnlyComments(_ s: String) -> Bool {
        let withoutBlocks = s.replacingOccurrences(of: #"/\*[\s\S]*?\*/"#, with: "", options: .regularExpression)
        return withoutBlocks.components(separatedBy: .newlines).allSatisfy {
            let t = $0.trimmingCharacters(in: .whitespaces)
            return t.isEmpty || t.hasPrefix("--") || t.hasPrefix("#")
        }
    }
}
