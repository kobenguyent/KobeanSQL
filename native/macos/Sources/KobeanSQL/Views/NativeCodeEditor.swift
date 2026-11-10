import AppKit
import SwiftUI

/// Native AppKit `NSTextView` SQL/Query editor with live syntax highlighting and `⌘↩` execution.
struct NativeCodeEditor: NSViewRepresentable {
    @Binding var text: String
    var onExecute: () -> Void

    func makeCoordinator() -> Coordinator {
        Coordinator(self)
    }

    func makeNSView(context: Context) -> NSScrollView {
        let scrollView = NSScrollView()
        scrollView.hasVerticalScroller = true
        scrollView.hasHorizontalScroller = true
        scrollView.autohidesScrollers = true
        scrollView.drawsBackground = false

        let textView = ShortcutTextView()
        textView.onCommandReturn = onExecute
        textView.delegate = context.coordinator
        textView.isRichText = false
        textView.isEditable = true
        textView.isSelectable = true
        textView.allowsUndo = true
        textView.usesFindBar = true
        textView.isAutomaticQuoteSubstitutionEnabled = false
        textView.isAutomaticDashSubstitutionEnabled = false
        textView.isAutomaticTextReplacementEnabled = false
        textView.isAutomaticSpellingCorrectionEnabled = false
        textView.font = NSFont.monospacedSystemFont(ofSize: 13, weight: .regular)
        textView.textColor = NSColor.labelColor
        textView.insertionPointColor = NSColor.controlAccentColor
        textView.drawsBackground = false
        textView.textContainerInset = NSSize(width: 12, height: 12)
        textView.isHorizontallyResizable = false
        textView.isVerticallyResizable = true
        textView.autoresizingMask = [.width]
        textView.textContainer?.widthTracksTextView = true
        textView.textContainer?.containerSize = NSSize(width: CGFloat.greatestFiniteMagnitude, height: CGFloat.greatestFiniteMagnitude)

        textView.string = text
        SQLSyntaxHighlighter.highlight(textStorage: textView.textStorage)

        scrollView.documentView = textView
        context.coordinator.textView = textView
        return scrollView
    }

    func updateNSView(_ scrollView: NSScrollView, context: Context) {
        context.coordinator.parent = self
        guard let textView = context.coordinator.textView else { return }
        textView.onCommandReturn = onExecute
        if textView.string != text {
            let selectedRanges = textView.selectedRanges
            context.coordinator.isProgrammaticChange = true
            textView.string = text
            SQLSyntaxHighlighter.highlight(textStorage: textView.textStorage)
            textView.selectedRanges = selectedRanges
            context.coordinator.isProgrammaticChange = false
        }
    }

    final class Coordinator: NSObject, NSTextViewDelegate {
        var parent: NativeCodeEditor
        weak var textView: ShortcutTextView?
        var isProgrammaticChange = false

        init(_ parent: NativeCodeEditor) {
            self.parent = parent
        }

        func textDidChange(_ notification: Notification) {
            guard !isProgrammaticChange, let tv = notification.object as? NSTextView else { return }
            parent.text = tv.string
            SQLSyntaxHighlighter.highlight(textStorage: tv.textStorage)
        }
    }
}

final class ShortcutTextView: NSTextView {
    var onCommandReturn: (() -> Void)?

    override func keyDown(with event: NSEvent) {
        let flags = event.modifierFlags.intersection(.deviceIndependentFlagsMask)
        // Cmd+Return or Cmd+Enter runs the query
        if flags.contains(.command) && (event.keyCode == 36 || event.keyCode == 76) {
            onCommandReturn?()
            return
        }
        super.keyDown(with: event)
    }
}

enum SQLSyntaxHighlighter {
    private static let keywordPattern = #"\b(SELECT|FROM|WHERE|JOIN|LEFT|RIGHT|INNER|OUTER|FULL|CROSS|ON|AS|AND|OR|NOT|IN|IS|NULL|LIKE|ILIKE|BETWEEN|EXISTS|GROUP|BY|ORDER|ASC|DESC|HAVING|LIMIT|OFFSET|TOP|FETCH|NEXT|ROWS|ONLY|UNION|ALL|DISTINCT|INSERT|INTO|VALUES|UPDATE|SET|DELETE|CREATE|ALTER|DROP|TRUNCATE|TABLE|VIEW|INDEX|DATABASE|SCHEMA|PRIMARY|KEY|FOREIGN|REFERENCES|DEFAULT|UNIQUE|CHECK|CONSTRAINT|CASE|WHEN|THEN|ELSE|END|CAST|COALESCE|COUNT|SUM|AVG|MIN|MAX|ROUND|WITH|RETURNING|EXPLAIN|ANALYZE|SHOW|DATABASES|TABLES|COLUMNS|PRAGMA|MATCH|RETURN|YIELD|CALL|UNWIND|DETACH|OPTIONAL|MERGE|GET|POST|PUT|SCAN|HGETALL|LRANGE|SMEMBERS|ZRANGE|INFO)\b"#
    private static let stringPattern = #"'(?:''|[^'])*'"#
    private static let numberPattern = #"\b\d+(?:\.\d+)?\b"#
    private static let commentPattern = #"(--[^\n]*|#[^\n]*|/\*[\s\S]*?\*/)"#

    private static let keywordRegex = try? NSRegularExpression(pattern: keywordPattern, options: [.caseInsensitive])
    private static let stringRegex = try? NSRegularExpression(pattern: stringPattern)
    private static let numberRegex = try? NSRegularExpression(pattern: numberPattern)
    private static let commentRegex = try? NSRegularExpression(pattern: commentPattern)

    static func highlight(textStorage: NSTextStorage?) {
        guard let storage = textStorage else { return }
        let fullString = storage.string as NSString
        let fullRange = NSRange(location: 0, length: fullString.length)
        guard fullRange.length > 0 else { return }

        let baseFont = NSFont.monospacedSystemFont(ofSize: 13, weight: .regular)
        let boldFont = NSFont.monospacedSystemFont(ofSize: 13, weight: .semibold)

        storage.beginEditing()
        storage.setAttributes([
            .font: baseFont,
            .foregroundColor: NSColor.labelColor
        ], range: fullRange)

        let accentColor = NSColor(red: 0.54, green: 0.54, blue: 0.96, alpha: 1.0)
        let numberColor = NSColor(red: 0.98, green: 0.65, blue: 0.25, alpha: 1.0)
        let stringColor = NSColor(red: 0.32, green: 0.84, blue: 0.55, alpha: 1.0)
        let commentColor = NSColor.secondaryLabelColor

        keywordRegex?.enumerateMatches(in: storage.string, range: fullRange) { match, _, _ in
            if let r = match?.range {
                storage.addAttributes([.foregroundColor: accentColor, .font: boldFont], range: r)
            }
        }
        numberRegex?.enumerateMatches(in: storage.string, range: fullRange) { match, _, _ in
            if let r = match?.range {
                storage.addAttribute(.foregroundColor, value: numberColor, range: r)
            }
        }
        stringRegex?.enumerateMatches(in: storage.string, range: fullRange) { match, _, _ in
            if let r = match?.range {
                storage.addAttributes([.foregroundColor: stringColor, .font: baseFont], range: r)
            }
        }
        commentRegex?.enumerateMatches(in: storage.string, range: fullRange) { match, _, _ in
            if let r = match?.range {
                storage.addAttributes([.foregroundColor: commentColor, .font: baseFont], range: r)
            }
        }
        storage.endEditing()
    }
}
