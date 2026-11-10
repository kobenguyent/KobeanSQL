import AppKit
import SwiftUI
import UniformTypeIdentifiers
import KobeanSQLCore

struct ResultsPaneView: View {
    @Bindable var state: AppState
    @State private var searchText: String = ""
    @State private var inspectedCell: String?
    @State private var selectedRowIndices: IndexSet = []
    @State private var showingInsertSheet = false
    @State private var editingRowIndex: Int?

    var body: some View {
        let tab = state.activeTab
        let targetTable = state.activeTargetTable

        VStack(spacing: 0) {
            // Results & CRUD Toolbar
            HStack(spacing: 8) {
                Label("Results", systemImage: "tablecells")
                    .font(.system(size: 12, weight: .semibold))
                    .foregroundStyle(.secondary)

                if let targetTable {
                    Text(targetTable.name)
                        .font(.system(size: 11, weight: .semibold, design: .monospaced))
                        .padding(.horizontal, 7)
                        .padding(.vertical, 2)
                        .background(GlassTheme.color(for: state.activeConnection?.type ?? .sqlite).opacity(0.18), in: Capsule())
                }

                if let tab, tab.results.count > 1 {
                    Picker("Result Set", selection: Binding(
                        get: { tab.activeResultIndex },
                        set: { state.activeTab?.activeResultIndex = $0 }
                    )) {
                        ForEach(Array(tab.results.enumerated()), id: \.offset) { idx, res in
                            Text("Result #\(idx + 1) (\(res.rowCount))").tag(idx)
                        }
                    }
                    .pickerStyle(.segmented)
                    .frame(maxWidth: 260)
                }

                if let result = tab?.activeResult {
                    Text("\(result.rows.count) rows • \(String(format: "%.1f ms", result.duration * 1000))")
                        .font(.system(size: 11, design: .monospaced))
                        .padding(.horizontal, 8)
                        .padding(.vertical, 3)
                        .background(GlassTheme.accent.opacity(0.16), in: Capsule())

                    if let notice = result.notice, !notice.isEmpty {
                        Label(notice, systemImage: "shield.lefthalf.filled")
                            .font(.system(size: 11))
                            .foregroundStyle(GlassTheme.warning)
                            .lineLimit(1)
                    }
                }

                Spacer()

                // CRUD Action Buttons when a table result is active
                if let result = tab?.activeResult, !result.columns.isEmpty, let table = targetTable, table.kind == .table {
                    let rows = filteredRows(result)

                    Button {
                        showingInsertSheet = true
                    } label: {
                        Label("Insert Row", systemImage: "plus")
                    }
                    .buttonStyle(.borderedProminent)
                    .tint(GlassTheme.accent)
                    .controlSize(.small)
                    .help("Insert a new row into \(table.name)")

                    Button {
                        if let first = selectedRowIndices.first, first < rows.count {
                            editingRowIndex = first
                        }
                    } label: {
                        Label("Edit", systemImage: "pencil")
                    }
                    .controlSize(.small)
                    .disabled(selectedRowIndices.isEmpty)
                    .help("Edit selected row")

                    Button {
                        if let first = selectedRowIndices.first, first < rows.count {
                            let row = rows[first]
                            Task {
                                do {
                                    try await state.duplicateRow(in: table, columns: result.columns, row: row)
                                } catch {
                                    state.setStatus("Duplicate failed: \(error.localizedDescription)", level: .error)
                                }
                            }
                        }
                    } label: {
                        Label("Duplicate", systemImage: "plus.square.on.square")
                    }
                    .controlSize(.small)
                    .disabled(selectedRowIndices.isEmpty)
                    .help("Duplicate selected row")

                    Button(role: .destructive) {
                        let toDelete = selectedRowIndices.compactMap { $0 < rows.count ? rows[$0] : nil }
                        guard !toDelete.isEmpty else { return }
                        Task {
                            do {
                                try await state.deleteRows(from: table, columns: result.columns, rows: toDelete)
                                selectedRowIndices.removeAll()
                            } catch {
                                state.setStatus("Delete failed: \(error.localizedDescription)", level: .error)
                            }
                        }
                    } label: {
                        Label(selectedRowIndices.count > 1 ? "Delete (\(selectedRowIndices.count))" : "Delete", systemImage: "trash")
                    }
                    .controlSize(.small)
                    .disabled(selectedRowIndices.isEmpty)
                    .help("Delete selected row(s)")

                    Divider()
                        .frame(height: 16)
                }

                if let result = tab?.activeResult, !result.columns.isEmpty {
                    TextField("Filter rows…", text: $searchText)
                        .textFieldStyle(.roundedBorder)
                        .controlSize(.small)
                        .frame(width: 150)

                    Button {
                        let tsv = ResultExporter.tsv(columns: result.columns, rows: filteredRows(result))
                        NSPasteboard.general.clearContents()
                        NSPasteboard.general.setString(tsv, forType: .string)
                        state.setStatus("Copied \(filteredRows(result).count) rows (TSV) to clipboard", level: .success)
                    } label: {
                        Image(systemName: "doc.on.doc")
                    }
                    .controlSize(.small)
                    .help("Copy TSV to Clipboard")

                    Menu {
                        Button("Export CSV…") { exportResult(result, format: .csv) }
                        Button("Export JSON…") { exportResult(result, format: .json) }
                    } label: {
                        Image(systemName: "square.and.arrow.up")
                    }
                    .controlSize(.small)
                    .frame(width: 34)
                    .help("Export CSV / JSON")
                }
            }
            .padding(.horizontal, 12)
            .padding(.vertical, 7)
            .background(.ultraThinMaterial)

            Divider()

            // Body
            if let errorMessage = tab?.errorMessage {
                VStack(alignment: .leading, spacing: 8) {
                    Label("Query Error", systemImage: "exclamationmark.triangle.fill")
                        .font(.headline)
                        .foregroundStyle(GlassTheme.danger)
                    ScrollView {
                        Text(errorMessage)
                            .font(.system(size: 12, design: .monospaced))
                            .textSelection(.enabled)
                            .frame(maxWidth: .infinity, alignment: .leading)
                    }
                }
                .padding(16)
                .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .topLeading)
            } else if let result = tab?.activeResult {
                if result.columns.isEmpty {
                    VStack(spacing: 8) {
                        Image(systemName: "checkmark.circle.fill")
                            .font(.system(size: 28))
                            .foregroundStyle(GlassTheme.success)
                        Text("Statement executed successfully")
                            .font(.headline)
                        Text("Rows affected: \(result.rowCount) • Duration: \(String(format: "%.1f ms", result.duration * 1000))")
                            .font(.subheadline)
                            .foregroundStyle(.secondary)
                    }
                    .frame(maxWidth: .infinity, maxHeight: .infinity)
                } else {
                    let rows = filteredRows(result)
                    VirtualizedTableGrid(
                        columns: result.columns,
                        rows: rows,
                        selectedRowIndices: $selectedRowIndices,
                        onInspectCell: { value in inspectedCell = value },
                        onEditRow: { rowIdx in
                            if targetTable?.kind == .table {
                                editingRowIndex = rowIdx
                            }
                        },
                        onDuplicateRow: { rowIdx in
                            guard let table = targetTable, table.kind == .table, rowIdx < rows.count else { return }
                            Task { try? await state.duplicateRow(in: table, columns: result.columns, row: rows[rowIdx]) }
                        },
                        onDeleteRow: { rowIdx in
                            guard let table = targetTable, table.kind == .table, rowIdx < rows.count else { return }
                            Task { try? await state.deleteRows(from: table, columns: result.columns, rows: [rows[rowIdx]]) }
                        },
                        onInsertRow: {
                            if targetTable?.kind == .table {
                                showingInsertSheet = true
                            }
                        }
                    )
                }
            } else {
                VStack(spacing: 10) {
                    Image(systemName: "play.rectangle.on.rectangle")
                        .font(.system(size: 28))
                        .foregroundStyle(.tertiary)
                    Text("Run a query (⌘↩) or select a table from the sidebar")
                        .font(.subheadline)
                        .foregroundStyle(.secondary)
                    Menu {
                        Button("Load All 8 Demo DB Types (SQL, Redis, ES, Neo4j, InfluxDB, ClickHouse)") {
                            Task { await state.loadAllDemoDatabases() }
                        }
                        Divider()
                        ForEach(DemoDatabaseCatalog.presets) { preset in
                            Button(preset.name) {
                                Task { await state.openOrCreateDemoDatabase(type: preset.type) }
                            }
                        }
                    } label: {
                        Label("Try Built-in Demo Databases (8 Types)", systemImage: "sparkles")
                    }
                    .buttonStyle(.borderedProminent)
                    .tint(GlassTheme.accent)
                    .controlSize(.small)
                }
                .frame(maxWidth: .infinity, maxHeight: .infinity)
            }
        }
        .sheet(isPresented: $showingInsertSheet) {
            if let table = targetTable, let cols = tab?.activeResult?.columns {
                RowEditorSheetView(state: state, table: table, columns: cols, originalRow: nil)
            }
        }
        .sheet(isPresented: Binding(
            get: { editingRowIndex != nil },
            set: { if !$0 { editingRowIndex = nil } }
        )) {
            if let table = targetTable,
               let result = tab?.activeResult,
               let idx = editingRowIndex {
                let rows = filteredRows(result)
                if idx < rows.count {
                    RowEditorSheetView(state: state, table: table, columns: result.columns, originalRow: rows[idx])
                }
            }
        }
        .sheet(isPresented: Binding(
            get: { inspectedCell != nil },
            set: { if !$0 { inspectedCell = nil } }
        )) {
            CellInspectorSheet(value: inspectedCell ?? "") {
                inspectedCell = nil
            }
        }
    }

    private func filteredRows(_ result: QueryResult) -> [[CellValue]] {
        let q = searchText.trimmingCharacters(in: .whitespacesAndNewlines).lowercased()
        guard !q.isEmpty else { return result.rows }
        return result.rows.filter { row in
            row.contains { !$0.isNull && $0.description.lowercased().contains(q) }
        }
    }

    private enum ExportFormat { case csv, json }

    private func exportResult(_ result: QueryResult, format: ExportFormat) {
        let panel = NSSavePanel()
        panel.canCreateDirectories = true
        panel.nameFieldStringValue = format == .csv ? "query-results.csv" : "query-results.json"
        panel.allowedContentTypes = [format == .csv ? .commaSeparatedText : .json]
        guard panel.runModal() == .OK, let url = panel.url else { return }
        do {
            let filtered = QueryResult(columns: result.columns, rows: filteredRows(result), duration: result.duration)
            let content = format == .csv ? ResultExporter.csv(filtered) : try ResultExporter.json(filtered)
            try Data(content.utf8).write(to: url, options: .atomic)
            state.setStatus("Exported \(filtered.rows.count) rows to \(url.lastPathComponent)", level: .success)
        } catch {
            state.setStatus("Export failed: \(error.localizedDescription)", level: .error)
        }
    }
}

struct CellInspectorSheet: View {
    let value: String
    let onClose: () -> Void

    var body: some View {
        VStack(alignment: .leading, spacing: 12) {
            HStack {
                Label("Cell Value Inspector", systemImage: "magnifyingglass")
                    .font(.headline)
                Spacer()
                Button("Copy") {
                    NSPasteboard.general.clearContents()
                    NSPasteboard.general.setString(value, forType: .string)
                }
                Button("Done", action: onClose)
                    .keyboardShortcut(.defaultAction)
            }
            Divider()
            ScrollView {
                Text(value)
                    .font(.system(size: 12, design: .monospaced))
                    .textSelection(.enabled)
                    .frame(maxWidth: .infinity, alignment: .leading)
            }
        }
        .padding(16)
        .frame(minWidth: 520, minHeight: 340)
    }
}

/// AppKit `NSTableView` wrapper with row selection and native right-click CRUD context menu.
struct VirtualizedTableGrid: NSViewRepresentable {
    var columns: [ColumnDef]
    var rows: [[CellValue]]
    @Binding var selectedRowIndices: IndexSet
    var onInspectCell: (String) -> Void
    var onEditRow: (Int) -> Void
    var onDuplicateRow: (Int) -> Void
    var onDeleteRow: (Int) -> Void
    var onInsertRow: () -> Void

    func makeCoordinator() -> Coordinator {
        Coordinator(self)
    }

    func makeNSView(context: Context) -> NSScrollView {
        let scroll = NSScrollView()
        scroll.hasVerticalScroller = true
        scroll.hasHorizontalScroller = true
        scroll.autohidesScrollers = true
        scroll.drawsBackground = false

        let table = NSTableView()
        table.style = .plain
        table.usesAlternatingRowBackgroundColors = true
        table.rowHeight = 24
        table.intercellSpacing = NSSize(width: 10, height: 2)
        table.columnAutoresizingStyle = .noColumnAutoresizing
        table.allowsColumnReordering = true
        table.allowsColumnResizing = true
        table.allowsMultipleSelection = true
        table.delegate = context.coordinator
        table.dataSource = context.coordinator
        table.target = context.coordinator
        table.doubleAction = #selector(Coordinator.handleDoubleClick(_:))
        table.menu = context.coordinator.buildContextMenu()

        scroll.documentView = table
        context.coordinator.tableView = table
        context.coordinator.rebuildColumns(on: table, columns: columns)
        return scroll
    }

    func updateNSView(_ scrollView: NSScrollView, context: Context) {
        let prevColumns = context.coordinator.parent.columns
        let prevRows = context.coordinator.parent.rows
        context.coordinator.parent = self
        guard let table = context.coordinator.tableView else { return }
        if prevColumns != columns {
            context.coordinator.rebuildColumns(on: table, columns: columns)
        }
        if prevColumns != columns || prevRows != rows {
            table.reloadData()
        }
    }

    final class Coordinator: NSObject, NSTableViewDataSource, NSTableViewDelegate {
        var parent: VirtualizedTableGrid
        weak var tableView: NSTableView?

        init(_ parent: VirtualizedTableGrid) {
            self.parent = parent
        }

        func buildContextMenu() -> NSMenu {
            let menu = NSMenu()
            let editItem = NSMenuItem(title: "Edit Row…", action: #selector(contextEditRow), keyEquivalent: "")
            editItem.target = self
            menu.addItem(editItem)

            let dupItem = NSMenuItem(title: "Duplicate Row", action: #selector(contextDuplicateRow), keyEquivalent: "")
            dupItem.target = self
            menu.addItem(dupItem)

            let insertItem = NSMenuItem(title: "Insert New Row…", action: #selector(contextInsertRow), keyEquivalent: "")
            insertItem.target = self
            menu.addItem(insertItem)

            menu.addItem(.separator())

            let copyItem = NSMenuItem(title: "Copy Row (TSV)", action: #selector(contextCopyRow), keyEquivalent: "")
            copyItem.target = self
            menu.addItem(copyItem)

            menu.addItem(.separator())

            let deleteItem = NSMenuItem(title: "Delete Row", action: #selector(contextDeleteRow), keyEquivalent: "")
            deleteItem.target = self
            menu.addItem(deleteItem)
            return menu
        }

        private var activeContextRow: Int? {
            guard let table = tableView else { return nil }
            let clicked = table.clickedRow
            if clicked >= 0 && clicked < parent.rows.count { return clicked }
            let selected = table.selectedRow
            if selected >= 0 && selected < parent.rows.count { return selected }
            return nil
        }

        @objc func contextEditRow() {
            if let r = activeContextRow { parent.onEditRow(r) }
        }

        @objc func contextDuplicateRow() {
            if let r = activeContextRow { parent.onDuplicateRow(r) }
        }

        @objc func contextInsertRow() {
            parent.onInsertRow()
        }

        @objc func contextCopyRow() {
            guard let r = activeContextRow else { return }
            let line = parent.rows[r].map { $0.isNull ? "" : $0.description }.joined(separator: "\t")
            NSPasteboard.general.clearContents()
            NSPasteboard.general.setString(line, forType: .string)
        }

        @objc func contextDeleteRow() {
            if let r = activeContextRow { parent.onDeleteRow(r) }
        }

        func rebuildColumns(on table: NSTableView, columns: [ColumnDef]) {
            for col in table.tableColumns {
                table.removeTableColumn(col)
            }
            let numCol = NSTableColumn(identifier: NSUserInterfaceItemIdentifier("__row_num__"))
            numCol.title = "#"
            numCol.width = 48
            numCol.minWidth = 36
            table.addTableColumn(numCol)

            for (idx, col) in columns.enumerated() {
                let tc = NSTableColumn(identifier: NSUserInterfaceItemIdentifier("col_\(idx)"))
                tc.title = col.type.isEmpty ? col.name : "\(col.name) (\(col.type))"
                tc.width = max(120, min(320, CGFloat(col.name.count * 10 + 48)))
                tc.minWidth = 70
                table.addTableColumn(tc)
            }
        }

        func numberOfRows(in tableView: NSTableView) -> Int {
            parent.rows.count
        }

        func tableViewSelectionDidChange(_ notification: Notification) {
            guard let table = tableView else { return }
            parent.selectedRowIndices = table.selectedRowIndexes
        }

        func tableView(_ tableView: NSTableView, viewFor tableColumn: NSTableColumn?, row: Int) -> NSView? {
            guard let id = tableColumn?.identifier else { return nil }
            let tf: NSTextField
            if let reused = tableView.makeView(withIdentifier: id, owner: nil) as? NSTextField {
                tf = reused
            } else {
                tf = NSTextField(labelWithString: "")
                tf.identifier = id
                tf.lineBreakMode = .byTruncatingTail
                tf.font = NSFont.monospacedSystemFont(ofSize: 12, weight: .regular)
            }

            if id.rawValue == "__row_num__" {
                tf.stringValue = "\(row + 1)"
                tf.textColor = .tertiaryLabelColor
                return tf
            }

            guard let idxStr = id.rawValue.split(separator: "_").last,
                  let colIdx = Int(idxStr),
                  row < parent.rows.count,
                  colIdx < parent.rows[row].count else {
                tf.stringValue = ""
                return tf
            }

            let cell = parent.rows[row][colIdx]
            tf.stringValue = cell.description
            tf.textColor = cell.isNull ? .tertiaryLabelColor : .labelColor
            return tf
        }

        @objc func handleDoubleClick(_ sender: NSTableView) {
            let row = sender.clickedRow
            guard row >= 0, row < parent.rows.count else { return }
            parent.onEditRow(row)
        }
    }
}
