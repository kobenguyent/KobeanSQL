import AppKit
import SwiftUI

/// Native AppKit `NSTextView` SQL/Query editor with live syntax highlighting,
/// schema-aware auto-completion (databases, tables, views, columns, keywords), and `⌘↩` execution.
struct NativeCodeEditor: NSViewRepresentable {
    @Binding var text: String
    var onExecute: () -> Void
    var suggestionsProvider: ((String, String) -> [CompletionSuggestion])? = nil

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
        textView.coordinator = context.coordinator
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
            context.coordinator.dismissCompletions()
        }
    }

    @MainActor
    final class Coordinator: NSObject, NSTextViewDelegate {
        var parent: NativeCodeEditor
        weak var textView: ShortcutTextView?
        var isProgrammaticChange = false

        private let popover = NSPopover()
        private var suggestions: [CompletionSuggestion] = []
        private var selectedIndex: Int = 0
        private var activeTokenRange: NSRange = NSRange(location: 0, length: 0)

        init(_ parent: NativeCodeEditor) {
            self.parent = parent
            super.init()
            popover.behavior = .semitransient
            popover.animates = false
        }

        var isCompletionVisible: Bool {
            popover.isShown && !suggestions.isEmpty
        }

        func textDidChange(_ notification: Notification) {
            guard !isProgrammaticChange, let tv = notification.object as? NSTextView else { return }
            parent.text = tv.string
            SQLSyntaxHighlighter.highlight(textStorage: tv.textStorage)
            updateCompletions(in: tv, force: false)
        }

        func triggerManualCompletions() {
            guard let tv = textView else { return }
            updateCompletions(in: tv, force: true)
        }

        func moveSelection(delta: Int) {
            guard !suggestions.isEmpty else { return }
            selectedIndex = (selectedIndex + delta + suggestions.count) % suggestions.count
            refreshPopoverContent()
        }

        func acceptSelectedCompletion() -> Bool {
            guard isCompletionVisible, selectedIndex < suggestions.count else { return false }
            applyCompletion(suggestions[selectedIndex])
            return true
        }

        func dismissCompletions() {
            if popover.isShown {
                popover.performClose(nil)
            }
            suggestions = []
        }

        func applyCompletion(_ item: CompletionSuggestion) {
            guard let tv = textView else { return }
            let nsString = tv.string as NSString
            guard activeTokenRange.location + activeTokenRange.length <= nsString.length else {
                dismissCompletions()
                return
            }
            isProgrammaticChange = true
            tv.replaceCharacters(in: activeTokenRange, with: item.insertText)
            let newCursor = activeTokenRange.location + (item.insertText as NSString).length
            tv.setSelectedRange(NSRange(location: newCursor, length: 0))
            parent.text = tv.string
            SQLSyntaxHighlighter.highlight(textStorage: tv.textStorage)
            isProgrammaticChange = false
            dismissCompletions()
        }

        private func updateCompletions(in tv: NSTextView, force: Bool) {
            guard let provider = parent.suggestionsProvider else {
                dismissCompletions()
                return
            }
            let cursor = tv.selectedRange().location
            let ns = tv.string as NSString
            guard cursor <= ns.length else {
                dismissCompletions()
                return
            }

            // Scan backward for `[A-Za-z0-9_.]`
            var start = cursor
            while start > 0 {
                let ch = ns.character(at: start - 1)
                guard let scalar = UnicodeScalar(ch) else { break }
                if CharacterSet.alphanumerics.contains(scalar) || scalar == "_" || scalar == "." {
                    start -= 1
                } else {
                    break
                }
            }

            let tokenRange = NSRange(location: start, length: cursor - start)
            let token = ns.substring(with: tokenRange)
            if !force && token.isEmpty {
                dismissCompletions()
                return
            }

            let items = provider(token, tv.string)
            // Don't show popup if the only match is already identically typed
            if items.isEmpty || (items.count == 1 && items[0].insertText.caseInsensitiveCompare(token) == .orderedSame) {
                dismissCompletions()
                return
            }

            activeTokenRange = tokenRange
            suggestions = items
            selectedIndex = 0
            refreshPopoverContent()

            guard let layoutManager = tv.layoutManager, let textContainer = tv.textContainer else { return }
            let glyphRange = layoutManager.glyphRange(forCharacterRange: NSRange(location: max(0, cursor - 1), length: min(1, ns.length)), actualCharacterRange: nil)
            var rect = layoutManager.boundingRect(forGlyphRange: glyphRange, in: textContainer)
            rect.origin.x += tv.textContainerInset.width
            rect.origin.y += tv.textContainerInset.height
            rect.size.width = max(rect.size.width, 4)
            rect.size.height = max(rect.size.height, 16)

            if !popover.isShown {
                popover.show(relativeTo: rect, of: tv, preferredEdge: .maxY)
                tv.window?.makeFirstResponder(tv)
            }
        }

        private func refreshPopoverContent() {
            let currentItems = suggestions
            let currentIdx = selectedIndex
            let host = NSHostingController(
                rootView: AutocompletePopupListView(
                    suggestions: currentItems,
                    selectedIndex: currentIdx,
                    onSelect: { [weak self] item in
                        self?.applyCompletion(item)
                    }
                )
            )
            popover.contentViewController = host
            popover.contentSize = NSSize(width: 340, height: min(CGFloat(currentItems.count) * 26 + 12, 240))
        }
    }
}

final class ShortcutTextView: NSTextView {
    var onCommandReturn: (() -> Void)?
    weak var coordinator: NativeCodeEditor.Coordinator?

    override func keyDown(with event: NSEvent) {
        let flags = event.modifierFlags.intersection(.deviceIndependentFlagsMask)
        // Cmd+Return or Cmd+Enter runs the query
        if flags.contains(.command) && (event.keyCode == 36 || event.keyCode == 76) {
            coordinator?.dismissCompletions()
            onCommandReturn?()
            return
        }
        // Ctrl+Space triggers manual completions
        if flags.contains(.control) && event.keyCode == 49 {
            coordinator?.triggerManualCompletions()
            return
        }
        if let coordinator, coordinator.isCompletionVisible {
            switch event.keyCode {
            case 125: // Down arrow
                coordinator.moveSelection(delta: 1)
                return
            case 126: // Up arrow
                coordinator.moveSelection(delta: -1)
                return
            case 48, 36, 76: // Tab, Return, Enter
                if coordinator.acceptSelectedCompletion() {
                    return
                }
            case 53: // Escape
                coordinator.dismissCompletions()
                return
            default:
                break
            }
        }
        super.keyDown(with: event)
    }
}

private struct AutocompletePopupListView: View {
    let suggestions: [CompletionSuggestion]
    let selectedIndex: Int
    var onSelect: (CompletionSuggestion) -> Void

    private func badgeColor(for kind: CompletionSuggestion.Kind) -> Color {
        switch kind {
        case .database: .purple
        case .table: GlassTheme.success
        case .view: .cyan
        case .column: .orange
        case .keyword: GlassTheme.accentBright
        case .function: .pink
        }
    }

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 2) {
                ForEach(Array(suggestions.enumerated()), id: \.element.id) { idx, item in
                    let isSelected = idx == selectedIndex
                    HStack(spacing: 8) {
                        Text(item.kind.rawValue)
                            .font(.system(size: 9, weight: .bold, design: .monospaced))
                            .foregroundStyle(badgeColor(for: item.kind))
                            .frame(width: 38, alignment: .center)
                            .padding(.vertical, 2)
                            .background(badgeColor(for: item.kind).opacity(0.16), in: RoundedRectangle(cornerRadius: 4))

                        Text(item.displayText)
                            .font(.system(size: 12, weight: isSelected ? .semibold : .regular, design: .monospaced))
                            .lineLimit(1)

                        Spacer()

                        Text(item.detail)
                            .font(.system(size: 10, design: .monospaced))
                            .foregroundStyle(.secondary)
                            .lineLimit(1)
                    }
                    .padding(.horizontal, 8)
                    .padding(.vertical, 4)
                    .background(
                        RoundedRectangle(cornerRadius: 5)
                            .fill(isSelected ? GlassTheme.accent.opacity(0.28) : Color.clear)
                    )
                    .contentShape(Rectangle())
                    .onTapGesture {
                        onSelect(item)
                    }
                }
            }
            .padding(6)
        }
        .frame(width: 340, height: min(CGFloat(suggestions.count) * 26 + 12, 240))
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
