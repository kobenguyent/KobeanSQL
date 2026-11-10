import AppKit
import SwiftUI
import UniformTypeIdentifiers
import KobeanSQLCore

/// Native sheet for Inserting a new row or Editing an existing row in the active table.
struct RowEditorSheetView: View {
    @Bindable var state: AppState
    let table: TableInfo
    let columns: [ColumnDef]
    let originalRow: [CellValue]?
    @Environment(\.dismiss) private var dismiss

    @State private var fieldTexts: [String: String] = [:]
    @State private var nullFlags: [String: Bool] = [:]
    @State private var errorMessage: String?
    @State private var isSubmitting = false

    init(state: AppState, table: TableInfo, columns: [ColumnDef], originalRow: [CellValue]? = nil) {
        self.state = state
        self.table = table
        self.columns = columns
        self.originalRow = originalRow

        var initialTexts: [String: String] = [:]
        var initialNulls: [String: Bool] = [:]
        for (idx, col) in columns.enumerated() {
            if let row = originalRow, idx < row.count {
                let cell = row[idx]
                initialNulls[col.name] = cell.isNull
                initialTexts[col.name] = cell.isNull ? "" : cell.description
            } else {
                initialNulls[col.name] = false
                initialTexts[col.name] = ""
            }
        }
        _fieldTexts = State(initialValue: initialTexts)
        _nullFlags = State(initialValue: initialNulls)
    }

    private var isEditMode: Bool { originalRow != nil }

    private var schemaColumns: [String: ColumnInfo] {
        guard let connID = state.activeConnection?.id else { return [:] }
        let list = state.columns(for: table, connectionID: connID)
        return Dictionary(uniqueKeysWithValues: list.map { ($0.name, $0) })
    }

    var body: some View {
        VStack(alignment: .leading, spacing: 14) {
            HStack {
                Label(isEditMode ? "Edit Row in \"\(table.name)\"" : "Insert Row into \"\(table.name)\"",
                      systemImage: isEditMode ? "pencil.line" : "plus.rectangle.on.rectangle")
                    .font(.title3.weight(.semibold))
                Spacer()
                Text(state.activeConnection?.type.displayName ?? "SQL")
                    .font(.caption.weight(.semibold))
                    .padding(.horizontal, 8)
                    .padding(.vertical, 3)
                    .background(GlassTheme.accent.opacity(0.18), in: Capsule())
            }

            Divider()

            ScrollView {
                VStack(alignment: .leading, spacing: 10) {
                    ForEach(columns, id: \.name) { col in
                        let meta = schemaColumns[col.name]
                        let isPK = meta?.primaryKey ?? (col.name.lowercased() == "id" || col.name == "_id")
                        let typeLabel = !(meta?.type ?? "").isEmpty ? meta!.type : col.type

                        HStack(spacing: 10) {
                            HStack(spacing: 4) {
                                if isPK {
                                    Image(systemName: "key.fill")
                                        .font(.system(size: 10))
                                        .foregroundStyle(GlassTheme.warning)
                                }
                                Text(col.name)
                                    .font(.system(size: 12, weight: .semibold, design: .monospaced))
                                if !typeLabel.isEmpty {
                                    Text(typeLabel)
                                        .font(.system(size: 10, design: .monospaced))
                                        .foregroundStyle(.secondary)
                                }
                            }
                            .frame(width: 170, alignment: .leading)

                            TextField(
                                isPK && !isEditMode ? "(auto / optional)" : (meta?.defaultValue ?? "value"),
                                text: Binding(
                                    get: { fieldTexts[col.name] ?? "" },
                                    set: {
                                        fieldTexts[col.name] = $0
                                        if !$0.isEmpty { nullFlags[col.name] = false }
                                    }
                                )
                            )
                            .textFieldStyle(.roundedBorder)
                            .font(.system(size: 12, design: .monospaced))
                            .disabled(nullFlags[col.name] == true)

                            Toggle("NULL", isOn: Binding(
                                get: { nullFlags[col.name] ?? false },
                                set: { nullFlags[col.name] = $0 }
                            ))
                            .toggleStyle(.checkbox)
                            .font(.caption)
                        }
                    }
                }
                .padding(.vertical, 4)
            }

            if let errorMessage {
                Label(errorMessage, systemImage: "exclamationmark.triangle.fill")
                    .font(.caption)
                    .foregroundStyle(GlassTheme.danger)
            }

            Divider()

            HStack {
                Button("Cancel") { dismiss() }
                    .keyboardShortcut(.cancelAction)
                Spacer()
                Button(isEditMode ? "Save Changes" : "Insert Row") {
                    submit()
                }
                .buttonStyle(.borderedProminent)
                .tint(GlassTheme.accent)
                .disabled(isSubmitting)
                .keyboardShortcut(.defaultAction)
            }
        }
        .padding(18)
        .frame(width: 560, height: 440)
    }

    private func submit() {
        isSubmitting = true
        errorMessage = nil
        let metaMap = schemaColumns

        Task {
            do {
                if let originalRow {
                    var updates: [(String, CellValue)] = []
                    for (idx, col) in columns.enumerated() where idx < originalRow.count {
                        let newVal: CellValue
                        if nullFlags[col.name] == true {
                            newVal = .null
                        } else {
                            let text = fieldTexts[col.name] ?? ""
                            newVal = RowMutator.parseInput(text, columnType: metaMap[col.name]?.type ?? col.type)
                        }
                        if newVal != originalRow[idx] {
                            updates.append((col.name, newVal))
                        }
                    }
                    try await state.updateRow(in: table, columns: columns, originalRow: originalRow, updatedValues: updates)
                } else {
                    var pairs: [(String, CellValue)] = []
                    for col in columns {
                        if nullFlags[col.name] == true {
                            pairs.append((col.name, .null))
                        } else {
                            let raw = fieldTexts[col.name] ?? ""
                            let isPK = metaMap[col.name]?.primaryKey ?? (col.name.lowercased() == "id")
                            if raw.isEmpty && isPK { continue }
                            if raw.isEmpty && metaMap[col.name]?.defaultValue != nil { continue }
                            if !raw.isEmpty {
                                pairs.append((col.name, RowMutator.parseInput(raw, columnType: metaMap[col.name]?.type ?? col.type)))
                            }
                        }
                    }
                    try await state.insertRow(into: table, values: pairs)
                }
                dismiss()
            } catch {
                errorMessage = error.localizedDescription
            }
            isSubmitting = false
        }
    }
}

/// Native sheet for creating a new SQL table visually.
struct CreateTableSheetView: View {
    @Bindable var state: AppState
    @Environment(\.dismiss) private var dismiss

    struct ColumnDraft: Identifiable {
        var id = UUID()
        var name: String
        var type: String
        var primaryKey: Bool
        var notNull: Bool
        var defaultValue: String
    }

    @State private var tableName: String = "new_table"
    @State private var columns: [ColumnDraft] = [
        ColumnDraft(name: "id", type: "INTEGER", primaryKey: true, notNull: true, defaultValue: ""),
        ColumnDraft(name: "name", type: "TEXT", primaryKey: false, notNull: true, defaultValue: ""),
        ColumnDraft(name: "created_at", type: "TEXT", primaryKey: false, notNull: false, defaultValue: "CURRENT_TIMESTAMP")
    ]
    @State private var errorMessage: String?

    private let commonTypes = ["INTEGER", "TEXT", "REAL", "NUMERIC", "BOOLEAN", "TIMESTAMP", "JSON", "BLOB"]

    var body: some View {
        VStack(alignment: .leading, spacing: 12) {
            HStack {
                Label("Create New Table", systemImage: "tablecells.badge.ellipsis")
                    .font(.title3.weight(.semibold))
                Spacer()
                Button {
                    columns.append(ColumnDraft(name: "col_\(columns.count + 1)", type: "TEXT", primaryKey: false, notNull: false, defaultValue: ""))
                } label: {
                    Label("Add Column", systemImage: "plus")
                }
                .controlSize(.small)
            }

            HStack {
                Text("Table Name:")
                    .font(.caption.weight(.semibold))
                TextField("new_table", text: $tableName)
                    .textFieldStyle(.roundedBorder)
            }

            Divider()

            ScrollView {
                VStack(spacing: 8) {
                    ForEach($columns) { $col in
                        HStack(spacing: 8) {
                            TextField("column_name", text: $col.name)
                                .textFieldStyle(.roundedBorder)
                                .font(.system(size: 12, design: .monospaced))

                            Picker("Type", selection: $col.type) {
                                ForEach(commonTypes, id: \.self) { t in
                                    Text(t).tag(t)
                                }
                            }
                            .labelsHidden()
                            .frame(width: 125)

                            Toggle("PK", isOn: $col.primaryKey)
                                .toggleStyle(.checkbox)
                                .font(.caption)

                            Toggle("NOT NULL", isOn: $col.notNull)
                                .toggleStyle(.checkbox)
                                .font(.caption)

                            TextField("Default", text: $col.defaultValue)
                                .textFieldStyle(.roundedBorder)
                                .font(.system(size: 11, design: .monospaced))
                                .frame(width: 120)

                            if columns.count > 1 {
                                Button(role: .destructive) {
                                    columns.removeAll { $0.id == col.id }
                                } label: {
                                    Image(systemName: "trash")
                                }
                                .buttonStyle(.plain)
                            }
                        }
                    }
                }
            }

            if let errorMessage {
                Text(errorMessage)
                    .font(.caption)
                    .foregroundStyle(GlassTheme.danger)
            }

            Divider()

            HStack {
                Button("Cancel") { dismiss() }
                    .keyboardShortcut(.cancelAction)
                Spacer()
                Button("Create Table") {
                    Task {
                        do {
                            let specs = columns.map { ($0.name, $0.type, $0.primaryKey, $0.notNull, $0.defaultValue) }
                            try await state.createTable(name: tableName, columnSpecs: specs)
                            dismiss()
                        } catch {
                            errorMessage = error.localizedDescription
                        }
                    }
                }
                .buttonStyle(.borderedProminent)
                .tint(GlassTheme.accent)
                .keyboardShortcut(.defaultAction)
            }
        }
        .padding(18)
        .frame(width: 640, height: 420)
    }
}

/// Native sheet for Copying a Table (Schema & Data, Schema Only, or Data Only).
struct CopyTableSheetView: View {
    @Bindable var state: AppState
    let sourceTable: TableInfo
    @Environment(\.dismiss) private var dismiss

    @State private var targetName: String
    @State private var mode: CopyTableMode = .schemaAndData
    @State private var errorMessage: String?

    init(state: AppState, sourceTable: TableInfo) {
        self.state = state
        self.sourceTable = sourceTable
        _targetName = State(initialValue: "\(sourceTable.name)_copy")
    }

    private var previewSQL: String {
        let dialect = state.activeConnection?.type ?? .sqlite
        let isDemo = state.activeConnection.map(DemoDatabaseCatalog.isDemo) ?? false
        let stmts = (try? RowMutator.buildCopyTableSQL(source: sourceTable, targetName: targetName, mode: mode, dialect: dialect, isDemo: isDemo)) ?? []
        return stmts.joined(separator: "\n")
    }

    var body: some View {
        VStack(alignment: .leading, spacing: 14) {
            Label("Copy Table \"\(sourceTable.name)\"", systemImage: "doc.on.doc.fill")
                .font(.title3.weight(.semibold))

            Divider()

            VStack(alignment: .leading, spacing: 6) {
                Text("Target Table Name")
                    .font(.caption.weight(.semibold))
                TextField("\(sourceTable.name)_copy", text: $targetName)
                    .textFieldStyle(.roundedBorder)
                    .font(.system(size: 12, design: .monospaced))
            }

            VStack(alignment: .leading, spacing: 6) {
                Text("Copy Mode")
                    .font(.caption.weight(.semibold))
                Picker("Mode", selection: $mode) {
                    ForEach(CopyTableMode.allCases) { m in
                        Text(m.label).tag(m)
                    }
                }
                .pickerStyle(.radioGroup)
                .labelsHidden()
            }

            VStack(alignment: .leading, spacing: 4) {
                Text("SQL Preview")
                    .font(.caption.weight(.semibold))
                    .foregroundStyle(.secondary)
                Text(previewSQL)
                    .font(.system(size: 11, design: .monospaced))
                    .padding(8)
                    .frame(maxWidth: .infinity, alignment: .leading)
                    .background(Color.secondary.opacity(0.08), in: RoundedRectangle(cornerRadius: 6))
            }

            if let errorMessage {
                Text(errorMessage)
                    .font(.caption)
                    .foregroundStyle(GlassTheme.danger)
            }

            Spacer()

            Divider()

            HStack {
                Button("Cancel") { dismiss() }
                    .keyboardShortcut(.cancelAction)
                Spacer()
                Button("Copy Table") {
                    Task {
                        do {
                            try await state.copyTable(source: sourceTable, targetName: targetName, mode: mode)
                            dismiss()
                        } catch {
                            errorMessage = error.localizedDescription
                        }
                    }
                }
                .buttonStyle(.borderedProminent)
                .tint(GlassTheme.accent)
                .keyboardShortcut(.defaultAction)
            }
        }
        .padding(18)
        .frame(width: 500, height: 360)
    }
}

// MARK: - Bulk CRUD Sheets

enum BulkInsertInputMode: String, CaseIterable, Identifiable {
    case grid = "Multi-Row Grid"
    case csv = "CSV / TSV Paste & File"
    case json = "JSON Array"

    var id: String { rawValue }
}

/// Native sheet for Bulk Inserting multiple rows via an interactive grid, CSV/TSV, or JSON array.
struct BulkInsertSheetView: View {
    @Bindable var state: AppState
    let table: TableInfo
    let columns: [ColumnDef]
    @Environment(\.dismiss) private var dismiss

    struct DraftRow: Identifiable {
        var id = UUID()
        var values: [String: String]
    }

    @State private var mode: BulkInsertInputMode = .grid
    @State private var draftRows: [DraftRow] = []
    @State private var csvText: String = ""
    @State private var jsonText: String = ""
    @State private var errorMessage: String?
    @State private var isSubmitting = false

    init(state: AppState, table: TableInfo, columns: [ColumnDef]) {
        self.state = state
        self.table = table
        self.columns = columns

        let editable = Self.defaultEditableColumns(columns: columns, state: state, table: table)
        let emptyDict = Dictionary(uniqueKeysWithValues: editable.map { ($0.name, "") })
        _draftRows = State(initialValue: [
            DraftRow(values: emptyDict),
            DraftRow(values: emptyDict),
            DraftRow(values: emptyDict)
        ])

        let header = editable.map(\.name).joined(separator: ",")
        let sample1 = editable.map { "val1_\($0.name)" }.joined(separator: ",")
        let sample2 = editable.map { "val2_\($0.name)" }.joined(separator: ",")
        _csvText = State(initialValue: "\(header)\n\(sample1)\n\(sample2)")

        let jsonFields = editable.map { "\"\($0.name)\": \"sample\"" }.joined(separator: ", ")
        _jsonText = State(initialValue: "[\n  { \(jsonFields) },\n  { \(jsonFields) }\n]")
    }

    private static func defaultEditableColumns(columns: [ColumnDef], state: AppState, table: TableInfo) -> [ColumnDef] {
        let connID = state.activeConnection?.id ?? ""
        let meta = Dictionary(uniqueKeysWithValues: state.columns(for: table, connectionID: connID).map { ($0.name, $0) })
        let nonAutoPK = columns.filter { col in
            let isPK = meta[col.name]?.primaryKey ?? (col.name.lowercased() == "id")
            return !(isPK && columns.count > 1)
        }
        return nonAutoPK.isEmpty ? columns : nonAutoPK
    }

    private var schemaColumns: [String: ColumnInfo] {
        guard let connID = state.activeConnection?.id else { return [:] }
        return Dictionary(uniqueKeysWithValues: state.columns(for: table, connectionID: connID).map { ($0.name, $0) })
    }

    private var editableColumns: [ColumnDef] {
        Self.defaultEditableColumns(columns: columns, state: state, table: table)
    }

    private func resolveBulkPayload() throws -> (columns: [String], rows: [[CellValue]]) {
        let meta = schemaColumns
        switch mode {
        case .grid:
            let cols = editableColumns
            let nonEmptyRows = draftRows.filter { row in
                cols.contains { !(row.values[$0.name]?.trimmingCharacters(in: .whitespaces).isEmpty ?? true) }
            }
            guard !nonEmptyRows.isEmpty else {
                throw DatabaseError("Fill in at least one row in the grid.")
            }
            let typedRows: [[CellValue]] = nonEmptyRows.map { row in
                cols.map { col in
                    let raw = row.values[col.name] ?? ""
                    if raw.trimmingCharacters(in: .whitespaces).isEmpty {
                        return .null
                    }
                    return RowMutator.parseInput(raw, columnType: meta[col.name]?.type ?? col.type)
                }
            }
            return (cols.map(\.name), typedRows)
        case .csv:
            return try RowMutator.parseBulkDelimited(csvText, tableColumns: columns, schemaColumns: meta)
        case .json:
            return try RowMutator.parseBulkJSON(jsonText, tableColumns: columns, schemaColumns: meta)
        }
    }

    private var sqlPreview: String {
        let dialect = state.activeConnection?.type ?? .sqlite
        let isDemo = state.activeConnection.map(DemoDatabaseCatalog.isDemo) ?? false
        do {
            let payload = try resolveBulkPayload()
            return try RowMutator.buildBulkInsertSQL(
                table: table,
                dialect: dialect,
                isDemo: isDemo,
                columns: payload.columns,
                rows: payload.rows
            )
        } catch {
            return "-- \(error.localizedDescription)"
        }
    }

    var body: some View {
        VStack(alignment: .leading, spacing: 12) {
            HStack {
                Label("Bulk Insert into \"\(table.name)\"", systemImage: "square.stack.3d.up.badge.a.fill")
                    .font(.title3.weight(.semibold))
                Spacer()
                Picker("Mode", selection: $mode) {
                    ForEach(BulkInsertInputMode.allCases) { m in
                        Text(m.rawValue).tag(m)
                    }
                }
                .pickerStyle(.segmented)
                .frame(width: 340)
            }

            Divider()

            Group {
                switch mode {
                case .grid:
                    gridEditorView
                case .csv:
                    delimitedEditorView
                case .json:
                    jsonEditorView
                }
            }
            .frame(maxHeight: .infinity)

            VStack(alignment: .leading, spacing: 4) {
                Text("Live Bulk SQL Preview")
                    .font(.caption.weight(.semibold))
                    .foregroundStyle(.secondary)
                ScrollView {
                    Text(sqlPreview)
                        .font(.system(size: 11, design: .monospaced))
                        .textSelection(.enabled)
                        .frame(maxWidth: .infinity, alignment: .leading)
                }
                .padding(8)
                .frame(height: 85)
                .background(Color.secondary.opacity(0.08), in: RoundedRectangle(cornerRadius: 6))
            }

            if let errorMessage {
                Label(errorMessage, systemImage: "exclamationmark.triangle.fill")
                    .font(.caption)
                    .foregroundStyle(GlassTheme.danger)
            }

            Divider()

            HStack {
                Button("Cancel") { dismiss() }
                    .keyboardShortcut(.cancelAction)
                Spacer()
                Button("Execute Bulk Insert") {
                    submit()
                }
                .buttonStyle(.borderedProminent)
                .tint(GlassTheme.accent)
                .disabled(isSubmitting)
                .keyboardShortcut(.defaultAction)
            }
        }
        .padding(18)
        .frame(width: 720, height: 540)
    }

    private var gridEditorView: some View {
        let cols = editableColumns
        return VStack(alignment: .leading, spacing: 8) {
            HStack {
                Text("Enter multiple rows below (empty cells become NULL):")
                    .font(.caption)
                    .foregroundStyle(.secondary)
                Spacer()
                Button {
                    let emptyDict = Dictionary(uniqueKeysWithValues: cols.map { ($0.name, "") })
                    draftRows.append(DraftRow(values: emptyDict))
                } label: {
                    Label("Add Row", systemImage: "plus")
                }
                .controlSize(.small)

                Button {
                    let emptyDict = Dictionary(uniqueKeysWithValues: cols.map { ($0.name, "") })
                    for _ in 0..<5 { draftRows.append(DraftRow(values: emptyDict)) }
                } label: {
                    Label("+5 Rows", systemImage: "plus.rectangle.on.rectangle")
                }
                .controlSize(.small)
            }

            ScrollView([.horizontal, .vertical]) {
                VStack(alignment: .leading, spacing: 6) {
                    HStack(spacing: 8) {
                        Text("#")
                            .font(.system(size: 11, weight: .bold, design: .monospaced))
                            .frame(width: 28, alignment: .leading)
                        ForEach(cols, id: \.name) { col in
                            Text(col.name)
                                .font(.system(size: 11, weight: .semibold, design: .monospaced))
                                .frame(width: 140, alignment: .leading)
                        }
                        Spacer()
                    }
                    .padding(.bottom, 2)

                    ForEach(Array(draftRows.enumerated()), id: \.element.id) { idx, row in
                        HStack(spacing: 8) {
                            Text("\(idx + 1)")
                                .font(.system(size: 11, design: .monospaced))
                                .foregroundStyle(.secondary)
                                .frame(width: 28, alignment: .leading)

                            ForEach(cols, id: \.name) { col in
                                TextField("NULL", text: Binding(
                                    get: { draftRows[idx].values[col.name] ?? "" },
                                    set: { draftRows[idx].values[col.name] = $0 }
                                ))
                                .textFieldStyle(.roundedBorder)
                                .font(.system(size: 11, design: .monospaced))
                                .frame(width: 140)
                            }

                            Button {
                                draftRows.append(DraftRow(values: row.values))
                            } label: {
                                Image(systemName: "plus.square.on.square")
                            }
                            .buttonStyle(.plain)
                            .help("Duplicate this draft row")

                            if draftRows.count > 1 {
                                Button(role: .destructive) {
                                    draftRows.removeAll { $0.id == row.id }
                                } label: {
                                    Image(systemName: "trash")
                                }
                                .buttonStyle(.plain)
                                .help("Remove draft row")
                            }
                        }
                    }
                }
                .padding(4)
            }
        }
    }

    private var delimitedEditorView: some View {
        VStack(alignment: .leading, spacing: 8) {
            HStack {
                Text("Paste CSV or TSV rows (with or without column header row):")
                    .font(.caption)
                    .foregroundStyle(.secondary)
                Spacer()
                Button("Paste Clipboard") {
                    if let str = NSPasteboard.general.string(forType: .string), !str.isEmpty {
                        csvText = str
                    }
                }
                .controlSize(.small)

                Button("Load CSV/TSV File…") {
                    loadFile(allowedTypes: [.commaSeparatedText, .tabSeparatedText, .plainText]) { content in
                        csvText = content
                    }
                }
                .controlSize(.small)
            }

            TextEditor(text: $csvText)
                .font(.system(size: 12, design: .monospaced))
                .padding(4)
                .background(Color.secondary.opacity(0.06), in: RoundedRectangle(cornerRadius: 6))
        }
    }

    private var jsonEditorView: some View {
        VStack(alignment: .leading, spacing: 8) {
            HStack {
                Text("Paste a JSON array of row objects:")
                    .font(.caption)
                    .foregroundStyle(.secondary)
                Spacer()
                Button("Paste Clipboard") {
                    if let str = NSPasteboard.general.string(forType: .string), !str.isEmpty {
                        jsonText = str
                    }
                }
                .controlSize(.small)

                Button("Load JSON File…") {
                    loadFile(allowedTypes: [.json, .plainText]) { content in
                        jsonText = content
                    }
                }
                .controlSize(.small)
            }

            TextEditor(text: $jsonText)
                .font(.system(size: 12, design: .monospaced))
                .padding(4)
                .background(Color.secondary.opacity(0.06), in: RoundedRectangle(cornerRadius: 6))
        }
    }

    private func loadFile(allowedTypes: [UTType], onLoaded: (String) -> Void) {
        let panel = NSOpenPanel()
        panel.canChooseFiles = true
        panel.canChooseDirectories = false
        panel.allowsMultipleSelection = false
        panel.allowedContentTypes = allowedTypes
        if panel.runModal() == .OK, let url = panel.url,
           let content = try? String(contentsOf: url, encoding: .utf8) {
            onLoaded(content)
        }
    }

    private func submit() {
        isSubmitting = true
        errorMessage = nil
        Task {
            do {
                let payload = try resolveBulkPayload()
                try await state.bulkInsertRows(into: table, columns: payload.columns, rows: payload.rows)
                dismiss()
            } catch {
                errorMessage = error.localizedDescription
            }
            isSubmitting = false
        }
    }
}

/// Native sheet for Batch / Bulk Editing multiple selected rows at once.
struct BulkUpdateSheetView: View {
    @Bindable var state: AppState
    let table: TableInfo
    let columns: [ColumnDef]
    let targetRows: [[CellValue]]
    @Environment(\.dismiss) private var dismiss

    @State private var enabledColumns: [String: Bool] = [:]
    @State private var fieldTexts: [String: String] = [:]
    @State private var nullFlags: [String: Bool] = [:]
    @State private var errorMessage: String?
    @State private var isSubmitting = false

    private var schemaColumns: [String: ColumnInfo] {
        guard let connID = state.activeConnection?.id else { return [:] }
        return Dictionary(uniqueKeysWithValues: state.columns(for: table, connectionID: connID).map { ($0.name, $0) })
    }

    private var pkNames: Set<String> {
        guard let connID = state.activeConnection?.id else { return [] }
        return state.primaryKeyNamesSync(for: table, connectionID: connID)
    }

    private var updatedValues: [(column: String, value: CellValue)] {
        let meta = schemaColumns
        var list: [(String, CellValue)] = []
        for col in columns where enabledColumns[col.name] == true {
            if nullFlags[col.name] == true {
                list.append((col.name, .null))
            } else {
                let raw = fieldTexts[col.name] ?? ""
                list.append((col.name, RowMutator.parseInput(raw, columnType: meta[col.name]?.type ?? col.type)))
            }
        }
        return list
    }

    private var sqlPreview: String {
        let dialect = state.activeConnection?.type ?? .sqlite
        let isDemo = state.activeConnection.map(DemoDatabaseCatalog.isDemo) ?? false
        let updates = updatedValues
        guard !updates.isEmpty else {
            return "-- Check one or more columns above to preview the bulk UPDATE statement"
        }
        return (try? RowMutator.buildBulkUpdateSQL(
            table: table,
            dialect: dialect,
            isDemo: isDemo,
            columns: columns,
            pkColumnNames: pkNames,
            targetRows: targetRows,
            updatedValues: updates
        )) ?? "-- Unable to build bulk UPDATE statement"
    }

    var body: some View {
        VStack(alignment: .leading, spacing: 14) {
            HStack {
                Label("Bulk Edit \(targetRows.count) Row(s) in \"\(table.name)\"", systemImage: "pencil.and.list.clipboard")
                    .font(.title3.weight(.semibold))
                Spacer()
                Text("\(targetRows.count) selected")
                    .font(.caption.weight(.semibold))
                    .padding(.horizontal, 8)
                    .padding(.vertical, 3)
                    .background(GlassTheme.accent.opacity(0.18), in: Capsule())
            }

            Text("Select the columns you want to update across all \(targetRows.count) selected rows:")
                .font(.caption)
                .foregroundStyle(.secondary)

            Divider()

            ScrollView {
                VStack(alignment: .leading, spacing: 10) {
                    ForEach(columns, id: \.name) { col in
                        let meta = schemaColumns[col.name]
                        let isPK = meta?.primaryKey ?? (col.name.lowercased() == "id" || col.name == "_id")
                        let isChecked = enabledColumns[col.name] ?? false

                        HStack(spacing: 10) {
                            Toggle(isOn: Binding(
                                get: { enabledColumns[col.name] ?? false },
                                set: { enabledColumns[col.name] = $0 }
                            )) {
                                HStack(spacing: 4) {
                                    if isPK {
                                        Image(systemName: "key.fill")
                                            .font(.system(size: 10))
                                            .foregroundStyle(GlassTheme.warning)
                                    }
                                    Text(col.name)
                                        .font(.system(size: 12, weight: .semibold, design: .monospaced))
                                }
                            }
                            .toggleStyle(.checkbox)
                            .frame(width: 180, alignment: .leading)

                            TextField("New value for all \(targetRows.count) rows", text: Binding(
                                get: { fieldTexts[col.name] ?? "" },
                                set: {
                                    fieldTexts[col.name] = $0
                                    enabledColumns[col.name] = true
                                    if !$0.isEmpty { nullFlags[col.name] = false }
                                }
                            ))
                            .textFieldStyle(.roundedBorder)
                            .font(.system(size: 12, design: .monospaced))
                            .disabled(nullFlags[col.name] == true)

                            Toggle("NULL", isOn: Binding(
                                get: { nullFlags[col.name] ?? false },
                                set: {
                                    nullFlags[col.name] = $0
                                    if $0 { enabledColumns[col.name] = true }
                                }
                            ))
                            .toggleStyle(.checkbox)
                            .font(.caption)
                        }
                        .opacity(isChecked ? 1.0 : 0.75)
                    }
                }
                .padding(.vertical, 4)
            }

            VStack(alignment: .leading, spacing: 4) {
                Text("Live Bulk SQL Preview")
                    .font(.caption.weight(.semibold))
                    .foregroundStyle(.secondary)
                ScrollView {
                    Text(sqlPreview)
                        .font(.system(size: 11, design: .monospaced))
                        .textSelection(.enabled)
                        .frame(maxWidth: .infinity, alignment: .leading)
                }
                .padding(8)
                .frame(height: 72)
                .background(Color.secondary.opacity(0.08), in: RoundedRectangle(cornerRadius: 6))
            }

            if let errorMessage {
                Label(errorMessage, systemImage: "exclamationmark.triangle.fill")
                    .font(.caption)
                    .foregroundStyle(GlassTheme.danger)
            }

            Divider()

            HStack {
                Button("Cancel") { dismiss() }
                    .keyboardShortcut(.cancelAction)
                Spacer()
                Button("Update \(targetRows.count) Row(s)") {
                    submit()
                }
                .buttonStyle(.borderedProminent)
                .tint(GlassTheme.accent)
                .disabled(isSubmitting || updatedValues.isEmpty)
                .keyboardShortcut(.defaultAction)
            }
        }
        .padding(18)
        .frame(width: 600, height: 480)
    }

    private func submit() {
        isSubmitting = true
        errorMessage = nil
        let updates = updatedValues
        Task {
            do {
                try await state.bulkUpdateRows(
                    in: table,
                    columns: columns,
                    targetRows: targetRows,
                    updatedValues: updates
                )
                dismiss()
            } catch {
                errorMessage = error.localizedDescription
            }
            isSubmitting = false
        }
    }
}

/// Native confirmation sheet for Bulk Deleting selected rows with live SQL preview.
struct BulkDeleteConfirmSheetView: View {
    @Bindable var state: AppState
    let table: TableInfo
    let columns: [ColumnDef]
    let targetRows: [[CellValue]]
    var onDeleted: () -> Void
    @Environment(\.dismiss) private var dismiss

    @State private var errorMessage: String?
    @State private var isDeleting = false

    private var sqlPreview: String {
        let dialect = state.activeConnection?.type ?? .sqlite
        let isDemo = state.activeConnection.map(DemoDatabaseCatalog.isDemo) ?? false
        let pks = state.activeConnection.map { state.primaryKeyNamesSync(for: table, connectionID: $0.id) } ?? []
        switch dialect {
        case .redis:
            let fields = targetRows.compactMap { $0.first?.description }.filter { !$0.isEmpty }.map(RedisCommandParser.quote)
            return "HDEL \(RedisCommandParser.quote(table.name)) \(fields.joined(separator: " "))"
        case .elasticsearch:
            let idIdx = columns.firstIndex { $0.name == "_id" } ?? 0
            return targetRows.map { row in
                let docID = idIdx < row.count ? row[idIdx].description : ""
                return "DELETE /\(table.name)/_doc/\(docID)"
            }.joined(separator: "\n")
        default:
            return (try? RowMutator.buildBulkDeleteSQL(
                table: table,
                dialect: dialect,
                isDemo: isDemo,
                columns: columns,
                pkColumnNames: pks,
                rows: targetRows
            )) ?? "-- Unable to build bulk DELETE statement"
        }
    }

    var body: some View {
        VStack(alignment: .leading, spacing: 14) {
            HStack {
                Label("Confirm Bulk Delete (\(targetRows.count) Row\(targetRows.count == 1 ? "" : "s"))",
                      systemImage: "trash.fill")
                    .font(.title3.weight(.semibold))
                    .foregroundStyle(GlassTheme.danger)
                Spacer()
            }

            Text("You are about to permanently delete \(targetRows.count) row(s) from \"\(table.name)\". Review the statement below before confirming:")
                .font(.caption)
                .foregroundStyle(.secondary)

            ScrollView {
                Text(sqlPreview)
                    .font(.system(size: 11, design: .monospaced))
                    .textSelection(.enabled)
                    .frame(maxWidth: .infinity, alignment: .leading)
            }
            .padding(10)
            .frame(height: 110)
            .background(Color.secondary.opacity(0.08), in: RoundedRectangle(cornerRadius: 6))

            if let errorMessage {
                Label(errorMessage, systemImage: "exclamationmark.triangle.fill")
                    .font(.caption)
                    .foregroundStyle(GlassTheme.danger)
            }

            Divider()

            HStack {
                Button("Cancel") { dismiss() }
                    .keyboardShortcut(.cancelAction)
                Spacer()
                Button(role: .destructive) {
                    isDeleting = true
                    errorMessage = nil
                    Task {
                        do {
                            try await state.deleteRows(from: table, columns: columns, rows: targetRows)
                            onDeleted()
                            dismiss()
                        } catch {
                            errorMessage = error.localizedDescription
                        }
                        isDeleting = false
                    }
                } label: {
                    Text(isDeleting ? "Deleting…" : "Delete \(targetRows.count) Row\(targetRows.count == 1 ? "" : "s")")
                }
                .buttonStyle(.borderedProminent)
                .tint(GlassTheme.danger)
                .disabled(isDeleting)
                .keyboardShortcut(.defaultAction)
            }
        }
        .padding(18)
        .frame(width: 540, height: 310)
    }
}
