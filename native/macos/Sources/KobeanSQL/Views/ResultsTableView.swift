import AppKit
import SwiftUI
import UniformTypeIdentifiers
import KobeanSQLCore

struct ResultsPaneView: View {
    @Bindable var state: AppState
    @State private var searchText: String = ""
    @State private var inspectedCell: String?
    @State private var selectedRowIndices: IndexSet = []
    @State private var sortColumnIndex: Int?
    @State private var sortAscending: Bool = true
    @State private var showingInsertSheet = false
    @State private var showingBulkInsertSheet = false
    @State private var showingBulkUpdateSheet = false
    @State private var showingBulkDeleteSheet = false
    @State private var editingRowIndex: Int?

    var body: some View {
        let tab = state.activeTab
        let targetTable = state.activeTargetTable

        VStack(spacing: 0) {
            // Responsive Results & CRUD Toolbar:
            // Uses single-row layout when all pills + CRUD controls fit horizontally without wrapping,
            // and automatically splits into a 2-row bar (Pills + Filter on row 1, CRUD actions on row 2)
            // when there are many active pills or the window is narrow.
            ViewThatFits(in: .horizontal) {
                HStack(spacing: 8) {
                    statusPillsRow(tab: tab, targetTable: targetTable)
                        .fixedSize(horizontal: true, vertical: false)
                    Spacer(minLength: 8)
                    if let result = tab?.activeResult, !result.columns.isEmpty {
                        if let table = targetTable, table.kind == .table {
                            crudActionRow(result: result, table: table)
                                .fixedSize(horizontal: true, vertical: false)
                            Divider()
                                .frame(height: 16)
                        }
                        filterAndExportRow(result: result, targetTable: targetTable)
                            .fixedSize(horizontal: true, vertical: false)
                    }
                }

                VStack(alignment: .leading, spacing: 6) {
                    HStack(spacing: 8) {
                        ScrollView(.horizontal, showsIndicators: false) {
                            statusPillsRow(tab: tab, targetTable: targetTable)
                                .fixedSize(horizontal: true, vertical: false)
                        }
                        Spacer(minLength: 6)
                        if let result = tab?.activeResult, !result.columns.isEmpty {
                            filterAndExportRow(result: result, targetTable: targetTable)
                                .fixedSize(horizontal: true, vertical: false)
                        }
                    }
                    if let result = tab?.activeResult, !result.columns.isEmpty, let table = targetTable, table.kind == .table {
                        ScrollView(.horizontal, showsIndicators: false) {
                            crudActionRow(result: result, table: table)
                                .fixedSize(horizontal: true, vertical: false)
                        }
                    }
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
                    let fkMap = foreignKeyMap(for: result, targetTable: targetTable)
                    VirtualizedTableGrid(
                        columns: result.columns,
                        rows: rows,
                        foreignKeysByColumn: fkMap,
                        selectedRowIndices: $selectedRowIndices,
                        sortColumnIndex: $sortColumnIndex,
                        sortAscending: $sortAscending,
                        onInspectCell: { value in inspectedCell = value },
                        onFollowForeignKey: { fk, cell in
                            Task { await state.followForeignKey(fk, value: cell) }
                        },
                        onEditRow: { rowIdx in
                            guard targetTable?.kind == .table else { return }
                            if selectedRowIndices.count > 1 {
                                showingBulkUpdateSheet = true
                            } else {
                                editingRowIndex = rowIdx
                            }
                        },
                        onBulkEditRows: {
                            guard targetTable?.kind == .table, !selectedRowIndices.isEmpty else { return }
                            showingBulkUpdateSheet = true
                        },
                        onDuplicateRows: { indices in
                            guard let table = targetTable, table.kind == .table else { return }
                            let toDup = indices.compactMap { $0 < rows.count ? rows[$0] : nil }
                            guard !toDup.isEmpty else { return }
                            Task { try? await state.duplicateRows(in: table, columns: result.columns, rows: toDup) }
                        },
                        onDeleteRows: { indices in
                            guard targetTable?.kind == .table else { return }
                            selectedRowIndices = indices
                            showingBulkDeleteSheet = true
                        },
                        onInsertRow: {
                            if targetTable?.kind == .table {
                                showingInsertSheet = true
                            }
                        },
                        onBulkInsertRows: {
                            if targetTable?.kind == .table {
                                showingBulkInsertSheet = true
                            }
                        },
                        onCopyBulkInsertSQL: { indices in
                            guard let table = targetTable else { return }
                            let target = indices.compactMap { $0 < rows.count ? rows[$0] : nil }
                            guard !target.isEmpty else { return }
                            let dialect = state.activeConnection?.type ?? .sqlite
                            let isDemo = state.activeConnection.map(DemoDatabaseCatalog.isDemo) ?? false
                            let sql = ResultExporter.sqlInserts(
                                table: table,
                                dialect: dialect,
                                isDemo: isDemo,
                                columns: result.columns,
                                rows: target
                            )
                            NSPasteboard.general.clearContents()
                            NSPasteboard.general.setString(sql, forType: .string)
                            state.setStatus("Copied bulk INSERT SQL (\(target.count) row(s))", level: .success)
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
        .onChange(of: tab?.activeResult?.columns) { _, _ in
            sortColumnIndex = nil
            selectedRowIndices.removeAll()
        }
        .sheet(isPresented: $showingInsertSheet) {
            if let table = targetTable, let cols = tab?.activeResult?.columns {
                RowEditorSheetView(state: state, table: table, columns: cols, originalRow: nil)
            }
        }
        .sheet(isPresented: $showingBulkInsertSheet) {
            if let table = targetTable, let cols = tab?.activeResult?.columns {
                BulkInsertSheetView(state: state, table: table, columns: cols)
            }
        }
        .sheet(isPresented: $showingBulkUpdateSheet) {
            if let table = targetTable, let result = tab?.activeResult {
                let rows = selectedRows(from: filteredRows(result))
                if !rows.isEmpty {
                    BulkUpdateSheetView(state: state, table: table, columns: result.columns, targetRows: rows)
                }
            }
        }
        .sheet(isPresented: $showingBulkDeleteSheet) {
            if let table = targetTable, let result = tab?.activeResult {
                let rows = selectedRows(from: filteredRows(result))
                if !rows.isEmpty {
                    BulkDeleteConfirmSheetView(
                        state: state,
                        table: table,
                        columns: result.columns,
                        targetRows: rows,
                        onDeleted: { selectedRowIndices.removeAll() }
                    )
                }
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

    @ViewBuilder
    private func statusPillsRow(tab: QueryTab?, targetTable: TableInfo?) -> some View {
        HStack(spacing: 6) {
            Label("Results", systemImage: "tablecells")
                .font(.system(size: 12, weight: .semibold))
                .foregroundStyle(.secondary)
                .lineLimit(1)
                .fixedSize(horizontal: true, vertical: false)

            if let targetTable {
                HStack(spacing: 4) {
                    Image(systemName: targetTable.kind == .view ? "eye" : "tablecells")
                        .font(.system(size: 10))
                    Text(targetTable.name)
                        .font(.system(size: 11, weight: .semibold, design: .monospaced))
                        .lineLimit(1)
                }
                .padding(.horizontal, 7)
                .padding(.vertical, 2)
                .background(GlassTheme.color(for: state.activeConnection?.type ?? .sqlite).opacity(0.18), in: Capsule())
                .fixedSize(horizontal: true, vertical: false)
                .help("Active target table: \(targetTable.name)")
            }

            if let tab, tab.results.count > 1 {
                Picker("Result Set", selection: Binding(
                    get: { tab.activeResultIndex },
                    set: { state.activeTab?.activeResultIndex = $0 }
                )) {
                    ForEach(Array(tab.results.enumerated()), id: \.offset) { idx, res in
                        Text("#\(idx + 1) (\(res.rowCount))").tag(idx)
                    }
                }
                .labelsHidden()
                .pickerStyle(.segmented)
                .controlSize(.small)
                .fixedSize(horizontal: true, vertical: false)
            }

            if let result = tab?.activeResult {
                Text("\(result.rows.count) rows • \(String(format: "%.1f ms", result.duration * 1000))")
                    .font(.system(size: 11, design: .monospaced))
                    .lineLimit(1)
                    .padding(.horizontal, 8)
                    .padding(.vertical, 3)
                    .background(GlassTheme.accent.opacity(0.16), in: Capsule())
                    .fixedSize(horizontal: true, vertical: false)

                if let sortIdx = sortColumnIndex, sortIdx < result.columns.count {
                    let colName = result.columns[sortIdx].name
                    Button {
                        sortColumnIndex = nil
                    } label: {
                        HStack(spacing: 4) {
                            Image(systemName: sortAscending ? "arrow.up" : "arrow.down")
                                .font(.system(size: 9, weight: .bold))
                            Text(colName.count > 22 ? String(colName.prefix(20)) + "…" : colName)
                                .font(.system(size: 11, weight: .semibold, design: .monospaced))
                                .lineLimit(1)
                            Image(systemName: "xmark.circle.fill")
                                .font(.system(size: 10))
                        }
                        .padding(.horizontal, 8)
                        .padding(.vertical, 3)
                        .background(GlassTheme.accent.opacity(0.20), in: Capsule())
                        .fixedSize(horizontal: true, vertical: false)
                    }
                    .buttonStyle(.plain)
                    .help("Sorted by \(colName) (\(sortAscending ? "ascending" : "descending")). Click to clear sort.")
                }

                if !selectedRowIndices.isEmpty {
                    HStack(spacing: 4) {
                        Text("\(selectedRowIndices.count) selected")
                            .font(.system(size: 11, weight: .semibold))
                            .lineLimit(1)
                        Button {
                            selectedRowIndices.removeAll()
                        } label: {
                            Image(systemName: "xmark.circle.fill")
                                .font(.system(size: 10))
                        }
                        .buttonStyle(.plain)
                        .help("Clear selection")
                    }
                    .padding(.horizontal, 8)
                    .padding(.vertical, 3)
                    .background(GlassTheme.success.opacity(0.18), in: Capsule())
                    .fixedSize(horizontal: true, vertical: false)
                }

                if let notice = result.notice, !notice.isEmpty {
                    let shortNotice = notice.count > 28 ? String(notice.prefix(26)) + "…" : notice
                    HStack(spacing: 4) {
                        Image(systemName: "shield.lefthalf.filled")
                            .font(.system(size: 10))
                        Text(shortNotice)
                            .font(.system(size: 11, weight: .medium))
                            .lineLimit(1)
                    }
                    .foregroundStyle(GlassTheme.warning)
                    .padding(.horizontal, 7)
                    .padding(.vertical, 2)
                    .background(GlassTheme.warning.opacity(0.14), in: Capsule())
                    .fixedSize(horizontal: true, vertical: false)
                    .help(notice)
                }
            }
        }
    }

    @ViewBuilder
    private func crudActionRow(result: QueryResult, table: TableInfo) -> some View {
        let rows = filteredRows(result)
        let selCount = selectedRowIndices.count

        HStack(spacing: 6) {
            Button {
                showingInsertSheet = true
            } label: {
                Label("Insert", systemImage: "plus")
            }
            .buttonStyle(.borderedProminent)
            .tint(GlassTheme.accent)
            .controlSize(.small)
            .fixedSize(horizontal: true, vertical: false)
            .help("Insert a single row into \(table.name)")

            Button {
                showingBulkInsertSheet = true
            } label: {
                Label("Bulk Insert…", systemImage: "square.stack.3d.up.badge.a.fill")
            }
            .controlSize(.small)
            .fixedSize(horizontal: true, vertical: false)
            .help("Bulk insert multiple rows (Grid, CSV/TSV, or JSON) into \(table.name)")

            Button {
                if selCount > 1 {
                    showingBulkUpdateSheet = true
                } else if let first = selectedRowIndices.first, first < rows.count {
                    editingRowIndex = first
                }
            } label: {
                Label(selCount > 1 ? "Bulk Edit (\(selCount))" : "Edit", systemImage: "pencil")
            }
            .controlSize(.small)
            .disabled(selectedRowIndices.isEmpty)
            .fixedSize(horizontal: true, vertical: false)
            .help(selCount > 1 ? "Batch edit \(selCount) selected rows" : "Edit selected row")

            Button {
                let toDup = selectedRows(from: rows)
                guard !toDup.isEmpty else { return }
                Task {
                    do {
                        try await state.duplicateRows(in: table, columns: result.columns, rows: toDup)
                    } catch {
                        state.setStatus("Duplicate failed: \(error.localizedDescription)", level: .error)
                    }
                }
            } label: {
                Label(selCount > 1 ? "Duplicate (\(selCount))" : "Duplicate", systemImage: "plus.square.on.square")
            }
            .controlSize(.small)
            .disabled(selectedRowIndices.isEmpty)
            .fixedSize(horizontal: true, vertical: false)
            .help(selCount > 1 ? "Bulk duplicate \(selCount) selected rows" : "Duplicate selected row")

            Button(role: .destructive) {
                showingBulkDeleteSheet = true
            } label: {
                Label(selCount > 1 ? "Delete (\(selCount))" : "Delete", systemImage: "trash")
            }
            .controlSize(.small)
            .disabled(selectedRowIndices.isEmpty)
            .fixedSize(horizontal: true, vertical: false)
            .help("Delete selected row(s) with SQL preview")
        }
    }

    @ViewBuilder
    private func filterAndExportRow(result: QueryResult, targetTable: TableInfo?) -> some View {
        let rows = filteredRows(result)

        HStack(spacing: 6) {
            TextField("Filter rows…", text: $searchText)
                .textFieldStyle(.roundedBorder)
                .controlSize(.small)
                .frame(width: 135)

            Menu {
                let targetRows = selectedRowIndices.isEmpty ? rows : selectedRows(from: rows)
                let scopeLabel = selectedRowIndices.isEmpty ? "All (\(rows.count))" : "Selected (\(targetRows.count))"

                Button("Copy \(scopeLabel) as TSV") {
                    let tsv = ResultExporter.tsv(columns: result.columns, rows: targetRows)
                    NSPasteboard.general.clearContents()
                    NSPasteboard.general.setString(tsv, forType: .string)
                    state.setStatus("Copied \(targetRows.count) row(s) (TSV) to clipboard", level: .success)
                }
                if let table = targetTable {
                    Button("Copy \(scopeLabel) as Bulk INSERT SQL") {
                        let dialect = state.activeConnection?.type ?? .sqlite
                        let isDemo = state.activeConnection.map(DemoDatabaseCatalog.isDemo) ?? false
                        let sql = ResultExporter.sqlInserts(
                            table: table,
                            dialect: dialect,
                            isDemo: isDemo,
                            columns: result.columns,
                            rows: targetRows
                        )
                        NSPasteboard.general.clearContents()
                        NSPasteboard.general.setString(sql, forType: .string)
                        state.setStatus("Copied bulk INSERT SQL (\(targetRows.count) row(s)) to clipboard", level: .success)
                    }
                }
                Divider()
                Button("Select All (\(rows.count) Rows)") {
                    selectedRowIndices = IndexSet(integersIn: 0..<rows.count)
                }
                if !selectedRowIndices.isEmpty {
                    Button("Clear Selection") {
                        selectedRowIndices.removeAll()
                    }
                }
                Divider()
                Button("Export \(scopeLabel) as CSV…") { exportResult(result, rows: targetRows, format: .csv) }
                Button("Export \(scopeLabel) as JSON…") { exportResult(result, rows: targetRows, format: .json) }
                if targetTable != nil {
                    Button("Export \(scopeLabel) as Bulk INSERT SQL…") { exportResult(result, rows: targetRows, format: .sql) }
                }
            } label: {
                Image(systemName: "square.and.arrow.up")
            }
            .controlSize(.small)
            .frame(width: 34)
            .help("Copy / Select / Export Rows (TSV, CSV, JSON, Bulk INSERT SQL)")
        }
    }

    private func selectedRows(from rows: [[CellValue]]) -> [[CellValue]] {
        selectedRowIndices.compactMap { $0 < rows.count ? rows[$0] : nil }
    }

    private func filteredRows(_ result: QueryResult) -> [[CellValue]] {
        let q = searchText.trimmingCharacters(in: .whitespacesAndNewlines).lowercased()
        var rows = result.rows
        if !q.isEmpty {
            rows = rows.filter { row in
                row.contains { !$0.isNull && $0.description.lowercased().contains(q) }
            }
        }
        if let sortIdx = sortColumnIndex, sortIdx >= 0, sortIdx < result.columns.count {
            let asc = sortAscending
            rows.sort { a, b in
                let lhs = sortIdx < a.count ? a[sortIdx] : .null
                let rhs = sortIdx < b.count ? b[sortIdx] : .null
                return CellValue.compare(lhs, rhs, ascending: asc)
            }
        }
        return rows
    }

    private func foreignKeyMap(for result: QueryResult, targetTable: TableInfo?) -> [String: ForeignKeyInfo] {
        guard let connID = state.activeTab?.connectionID ?? state.activeConnection?.id else { return [:] }
        var map: [String: ForeignKeyInfo] = [:]
        if let table = targetTable {
            for fk in state.foreignKeys(for: table, connectionID: connID) {
                map[fk.columnName.lowercased()] = fk
            }
        }
        let knownTables = state.tables(for: connID).filter { $0.kind == .table }
        for col in result.columns {
            let lower = col.name.lowercased()
            guard map[lower] == nil, lower.hasSuffix("_id"), lower.count > 3 else { continue }
            let stem = String(lower.dropLast(3))
            let candidates = [
                stem,
                stem + "s",
                stem + "es",
                stem.hasSuffix("y") ? String(stem.dropLast()) + "ies" : ""
            ]
            if let match = knownTables.first(where: { t in
                let tn = t.name.lowercased()
                return candidates.contains(tn) || (stem == "org" && tn == "organizations")
            }), match.name.lowercased() != targetTable?.name.lowercased() {
                map[lower] = ForeignKeyInfo(
                    columnName: col.name,
                    referencedTable: match.name,
                    referencedSchema: match.schema,
                    referencedColumn: "id"
                )
            }
        }
        return map
    }

    private enum ExportFormat { case csv, json, sql }

    private func exportResult(_ result: QueryResult, rows: [[CellValue]], format: ExportFormat) {
        let panel = NSSavePanel()
        panel.canCreateDirectories = true
        switch format {
        case .csv:
            panel.nameFieldStringValue = "query-results.csv"
            panel.allowedContentTypes = [.commaSeparatedText]
        case .json:
            panel.nameFieldStringValue = "query-results.json"
            panel.allowedContentTypes = [.json]
        case .sql:
            panel.nameFieldStringValue = "bulk-insert.sql"
            panel.allowedContentTypes = [.plainText]
        }
        guard panel.runModal() == .OK, let url = panel.url else { return }
        do {
            let subset = QueryResult(columns: result.columns, rows: rows, duration: result.duration)
            let content: String
            switch format {
            case .csv:
                content = ResultExporter.csv(subset)
            case .json:
                content = try ResultExporter.json(subset)
            case .sql:
                let table = state.activeTargetTable ?? TableInfo(name: "exported_rows")
                let dialect = state.activeConnection?.type ?? .sqlite
                let isDemo = state.activeConnection.map(DemoDatabaseCatalog.isDemo) ?? false
                content = ResultExporter.sqlInserts(
                    table: table,
                    dialect: dialect,
                    isDemo: isDemo,
                    columns: result.columns,
                    rows: rows
                )
            }
            try Data(content.utf8).write(to: url, options: .atomic)
            state.setStatus("Exported \(rows.count) row(s) to \(url.lastPathComponent)", level: .success)
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

/// AppKit `NSTableView` wrapper with column sorting, clickable Foreign Key links, multi-row selection, and Bulk CRUD context menu.
struct VirtualizedTableGrid: NSViewRepresentable {
    var columns: [ColumnDef]
    var rows: [[CellValue]]
    var foreignKeysByColumn: [String: ForeignKeyInfo]
    @Binding var selectedRowIndices: IndexSet
    @Binding var sortColumnIndex: Int?
    @Binding var sortAscending: Bool
    var onInspectCell: (String) -> Void
    var onFollowForeignKey: (ForeignKeyInfo, CellValue) -> Void
    var onEditRow: (Int) -> Void
    var onBulkEditRows: () -> Void
    var onDuplicateRows: (IndexSet) -> Void
    var onDeleteRows: (IndexSet) -> Void
    var onInsertRow: () -> Void
    var onBulkInsertRows: () -> Void
    var onCopyBulkInsertSQL: (IndexSet) -> Void

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
        table.action = #selector(Coordinator.handleSingleClick(_:))
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
        let prevFKs = context.coordinator.parent.foreignKeysByColumn
        context.coordinator.parent = self
        guard let table = context.coordinator.tableView else { return }
        if prevColumns != columns || prevFKs != foreignKeysByColumn {
            context.coordinator.rebuildColumns(on: table, columns: columns)
        }
        if sortColumnIndex == nil && !table.sortDescriptors.isEmpty {
            table.sortDescriptors = []
        }
        if prevColumns != columns || prevRows != rows || prevFKs != foreignKeysByColumn {
            table.reloadData()
        }
        if table.selectedRowIndexes != selectedRowIndices {
            table.selectRowIndexes(selectedRowIndices, byExtendingSelection: false)
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

            let followFKItem = NSMenuItem(title: "Follow Foreign Key ↗", action: #selector(contextFollowForeignKey), keyEquivalent: "")
            followFKItem.target = self
            menu.addItem(followFKItem)

            let inspectItem = NSMenuItem(title: "Inspect Cell Value…", action: #selector(contextInspectCell), keyEquivalent: "")
            inspectItem.target = self
            menu.addItem(inspectItem)

            menu.addItem(.separator())

            let editItem = NSMenuItem(title: "Edit Row…", action: #selector(contextEditRow), keyEquivalent: "")
            editItem.target = self
            menu.addItem(editItem)

            let bulkEditItem = NSMenuItem(title: "Bulk Edit Selected Rows…", action: #selector(contextBulkEditRows), keyEquivalent: "")
            bulkEditItem.target = self
            menu.addItem(bulkEditItem)

            let dupItem = NSMenuItem(title: "Duplicate Selected Row(s)", action: #selector(contextDuplicateRows), keyEquivalent: "")
            dupItem.target = self
            menu.addItem(dupItem)

            menu.addItem(.separator())

            let insertItem = NSMenuItem(title: "Insert Single Row…", action: #selector(contextInsertRow), keyEquivalent: "")
            insertItem.target = self
            menu.addItem(insertItem)

            let bulkInsertItem = NSMenuItem(title: "Bulk Insert Rows (Grid / CSV / JSON)…", action: #selector(contextBulkInsertRows), keyEquivalent: "")
            bulkInsertItem.target = self
            menu.addItem(bulkInsertItem)

            menu.addItem(.separator())

            let copyItem = NSMenuItem(title: "Copy Selected Row(s) (TSV)", action: #selector(contextCopyRows), keyEquivalent: "")
            copyItem.target = self
            menu.addItem(copyItem)

            let copySQLItem = NSMenuItem(title: "Copy Selected Row(s) as Bulk INSERT SQL", action: #selector(contextCopyBulkInsertSQL), keyEquivalent: "")
            copySQLItem.target = self
            menu.addItem(copySQLItem)

            let selectAllItem = NSMenuItem(title: "Select All Rows", action: #selector(contextSelectAllRows), keyEquivalent: "")
            selectAllItem.target = self
            menu.addItem(selectAllItem)

            menu.addItem(.separator())

            let deleteItem = NSMenuItem(title: "Delete Selected Row(s)…", action: #selector(contextDeleteRows), keyEquivalent: "")
            deleteItem.target = self
            menu.addItem(deleteItem)
            return menu
        }

        /// Resolves the active row indices for a context menu click, preserving multi-row selection when right-clicking a selected row.
        private var activeContextIndices: IndexSet {
            guard let table = tableView else { return [] }
            let selected = table.selectedRowIndexes
            let clicked = table.clickedRow
            if clicked >= 0 && clicked < parent.rows.count {
                if selected.contains(clicked) {
                    return selected
                }
                let single = IndexSet(integer: clicked)
                table.selectRowIndexes(single, byExtendingSelection: false)
                parent.selectedRowIndices = single
                return single
            }
            return selected
        }

        private func columnIndex(forTableColumn tableColIdx: Int) -> Int? {
            guard let table = tableView,
                  tableColIdx >= 0,
                  tableColIdx < table.tableColumns.count else { return nil }
            let id = table.tableColumns[tableColIdx].identifier.rawValue
            guard id.hasPrefix("col_"),
                  let idxStr = id.split(separator: "_").last,
                  let colIdx = Int(idxStr) else { return nil }
            return colIdx
        }

        @objc func contextFollowForeignKey() {
            guard let table = tableView else { return }
            let row = table.clickedRow >= 0 ? table.clickedRow : (table.selectedRowIndexes.first ?? -1)
            guard row >= 0, row < parent.rows.count else { return }
            if let colIdx = columnIndex(forTableColumn: table.clickedColumn),
               colIdx < parent.columns.count,
               colIdx < parent.rows[row].count {
                let colName = parent.columns[colIdx].name.lowercased()
                if let fk = parent.foreignKeysByColumn[colName], !parent.rows[row][colIdx].isNull {
                    parent.onFollowForeignKey(fk, parent.rows[row][colIdx])
                    return
                }
            }
            // Fallback: follow the first non-null foreign key column in the clicked row
            for (idx, col) in parent.columns.enumerated() where idx < parent.rows[row].count {
                if let fk = parent.foreignKeysByColumn[col.name.lowercased()], !parent.rows[row][idx].isNull {
                    parent.onFollowForeignKey(fk, parent.rows[row][idx])
                    return
                }
            }
        }

        @objc func contextInspectCell() {
            guard let table = tableView else { return }
            let row = table.clickedRow >= 0 ? table.clickedRow : (table.selectedRowIndexes.first ?? -1)
            guard row >= 0, row < parent.rows.count else { return }
            if let colIdx = columnIndex(forTableColumn: table.clickedColumn),
               colIdx < parent.rows[row].count {
                parent.onInspectCell(parent.rows[row][colIdx].description)
            } else if let firstCell = parent.rows[row].first {
                parent.onInspectCell(firstCell.description)
            }
        }

        @objc func contextEditRow() {
            let indices = activeContextIndices
            if indices.count > 1 {
                parent.onBulkEditRows()
            } else if let r = indices.first {
                parent.onEditRow(r)
            }
        }

        @objc func contextBulkEditRows() {
            let indices = activeContextIndices
            guard !indices.isEmpty else { return }
            parent.selectedRowIndices = indices
            parent.onBulkEditRows()
        }

        @objc func contextDuplicateRows() {
            let indices = activeContextIndices
            guard !indices.isEmpty else { return }
            parent.onDuplicateRows(indices)
        }

        @objc func contextInsertRow() {
            parent.onInsertRow()
        }

        @objc func contextBulkInsertRows() {
            parent.onBulkInsertRows()
        }

        @objc func contextCopyRows() {
            let indices = activeContextIndices
            let target = indices.compactMap { $0 < parent.rows.count ? parent.rows[$0] : nil }
            guard !target.isEmpty else { return }
            let tsv = ResultExporter.tsv(columns: parent.columns, rows: target, includeHeader: target.count > 1)
            NSPasteboard.general.clearContents()
            NSPasteboard.general.setString(tsv, forType: .string)
        }

        @objc func contextCopyBulkInsertSQL() {
            let indices = activeContextIndices
            guard !indices.isEmpty else { return }
            parent.onCopyBulkInsertSQL(indices)
        }

        @objc func contextSelectAllRows() {
            guard let table = tableView, !parent.rows.isEmpty else { return }
            let all = IndexSet(integersIn: 0..<parent.rows.count)
            table.selectRowIndexes(all, byExtendingSelection: false)
            parent.selectedRowIndices = all
        }

        @objc func contextDeleteRows() {
            let indices = activeContextIndices
            guard !indices.isEmpty else { return }
            parent.onDeleteRows(indices)
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
                let fk = parent.foreignKeysByColumn[col.name.lowercased()]
                let fkBadge = fk != nil ? " 🔗" : ""
                tc.title = col.type.isEmpty ? "\(col.name)\(fkBadge)" : "\(col.name)\(fkBadge) (\(col.type))"
                if let fk {
                    tc.headerToolTip = "Foreign Key → \(fk.referencedTable).\(fk.referencedColumn) (Click cell to open referenced row, click header to sort)"
                } else {
                    tc.headerToolTip = "Click header to sort by \(col.name)"
                }
                tc.sortDescriptorPrototype = NSSortDescriptor(key: "col_\(idx)", ascending: true)
                tc.width = max(120, min(320, CGFloat(col.name.count * 10 + 56)))
                tc.minWidth = 70
                table.addTableColumn(tc)
            }
        }

        func numberOfRows(in tableView: NSTableView) -> Int {
            parent.rows.count
        }

        func tableView(_ tableView: NSTableView, sortDescriptorsDidChange oldDescriptors: [NSSortDescriptor]) {
            if let first = tableView.sortDescriptors.first,
               let key = first.key,
               key.hasPrefix("col_"),
               let idxStr = key.split(separator: "_").last,
               let colIdx = Int(idxStr) {
                parent.sortColumnIndex = colIdx
                parent.sortAscending = first.ascending
            } else {
                parent.sortColumnIndex = nil
            }
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
                tf.attributedStringValue = NSAttributedString(string: "")
                tf.stringValue = "\(row + 1)"
                tf.textColor = .tertiaryLabelColor
                tf.toolTip = nil
                return tf
            }

            guard let idxStr = id.rawValue.split(separator: "_").last,
                  let colIdx = Int(idxStr),
                  row < parent.rows.count,
                  colIdx < parent.rows[row].count else {
                tf.attributedStringValue = NSAttributedString(string: "")
                tf.stringValue = ""
                tf.toolTip = nil
                return tf
            }

            let cell = parent.rows[row][colIdx]
            let preview = cell.displayPreview(maxLength: 240)
            let colName = colIdx < parent.columns.count ? parent.columns[colIdx].name.lowercased() : ""

            if let fk = parent.foreignKeysByColumn[colName], !cell.isNull {
                let linkText = "\(preview) ↗"
                let attr = NSMutableAttributedString(
                    string: linkText,
                    attributes: [
                        .font: NSFont.monospacedSystemFont(ofSize: 12, weight: .medium),
                        .foregroundColor: NSColor.controlAccentColor,
                        .underlineStyle: NSUnderlineStyle.single.rawValue
                    ]
                )
                tf.attributedStringValue = attr
                tf.toolTip = "Click to open \(fk.referencedTable) where \(fk.referencedColumn) = \(preview)"
            } else {
                tf.attributedStringValue = NSAttributedString(string: "")
                tf.stringValue = preview
                tf.textColor = cell.isNull ? .tertiaryLabelColor : .labelColor
                tf.toolTip = preview.hasSuffix("…") ? "Right-click → Inspect Cell Value to view full text" : nil
            }
            return tf
        }

        @objc func handleSingleClick(_ sender: NSTableView) {
            let row = sender.clickedRow
            let tableCol = sender.clickedColumn
            guard row >= 0, row < parent.rows.count, tableCol >= 0 else { return }
            let flags = NSApp.currentEvent?.modifierFlags ?? []
            // Do not hijack Shift/Cmd multi-row selection clicks
            guard !flags.contains(.shift), !flags.contains(.command) else { return }
            guard let colIdx = columnIndex(forTableColumn: tableCol),
                  colIdx < parent.columns.count,
                  colIdx < parent.rows[row].count else { return }
            let colName = parent.columns[colIdx].name.lowercased()
            let cell = parent.rows[row][colIdx]
            guard let fk = parent.foreignKeysByColumn[colName], !cell.isNull else { return }
            parent.onFollowForeignKey(fk, cell)
        }

        @objc func handleDoubleClick(_ sender: NSTableView) {
            let row = sender.clickedRow
            guard row >= 0, row < parent.rows.count else { return }
            parent.onEditRow(row)
        }
    }
}
