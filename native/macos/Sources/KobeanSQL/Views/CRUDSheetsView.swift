import SwiftUI
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
