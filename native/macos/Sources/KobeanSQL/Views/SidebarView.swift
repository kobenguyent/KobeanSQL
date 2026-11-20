import AppKit
import SwiftUI
import KobeanSQLCore

struct SidebarView: View {
    @Bindable var state: AppState
    @State private var schemaFilter: String = ""
    @State private var expandedTables: Set<String> = []
    @State private var showingCreateTableSheet = false
    @State private var copyingTable: TableInfo?

    var body: some View {
        VStack(spacing: 0) {
            // Floating Liquid Glass top action bar
            LiquidGlassContainer(spacing: 6) {
                VStack(spacing: 6) {
                    HStack(spacing: 6) {
                        Button {
                            state.editingConnection = nil
                            state.showingConnectionSheet = true
                        } label: {
                            Label("New Connection", systemImage: "plus.circle.fill")
                                .frame(maxWidth: .infinity)
                        }
                        .liquidGlassButton(prominent: true, tint: GlassTheme.accent)
                        .controlSize(.small)

                        Button {
                            state.importElectronConnections()
                        } label: {
                            Image(systemName: "square.and.arrow.down")
                        }
                        .liquidGlassButton()
                        .controlSize(.small)
                        .help("Import Connections from Electron App")
                    }

                    Menu {
                        Button {
                            Task { await state.loadAllDemoDatabases() }
                        } label: {
                            Label("Load All 8 Demo Databases", systemImage: "sparkles")
                        }
                        Divider()
                        ForEach(DemoDatabaseCatalog.presets) { preset in
                            Button {
                                Task { await state.openOrCreateDemoDatabase(type: preset.type) }
                            } label: {
                                Label("\(preset.type.displayName) — \(preset.name.replacingOccurrences(of: "Demo — \(preset.type.displayName) ", with: ""))", systemImage: preset.type.symbolName)
                            }
                        }
                    } label: {
                        Label("Try Built-in Demo DBs (8 Types)", systemImage: "sparkles")
                            .frame(maxWidth: .infinity)
                    }
                    .liquidGlassButton(tint: GlassTheme.accent)
                    .controlSize(.small)
                }
                .padding(10)
                .liquidGlassBar(cornerRadius: 14)
            }
            .padding(.horizontal, 10)
            .padding(.top, 8)
            .padding(.bottom, 4)

            ScrollView {
                VStack(alignment: .leading, spacing: 16) {
                    // Connections Section
                    VStack(alignment: .leading, spacing: 6) {
                        Text("CONNECTIONS (\(state.connections.count))")
                            .font(.system(size: 10, weight: .bold))
                            .foregroundStyle(.secondary)
                            .padding(.horizontal, 4)

                        if state.connections.isEmpty {
                            Text("No saved connections yet. Click \"Try Built-in Demo DBs\" above or \"New Connection\" to get started.")
                                .font(.caption)
                                .foregroundStyle(.secondary)
                                .padding(10)
                                .frame(maxWidth: .infinity, alignment: .leading)
                                .liquidGlassCard(cornerRadius: 10)
                        } else {
                            LiquidGlassContainer(spacing: 6) {
                                VStack(spacing: 6) {
                                    ForEach(state.connections) { conn in
                                ConnectionRowView(
                                    conn: conn,
                                    isConnected: state.connectedIDs.contains(conn.id),
                                    isConnecting: state.connectingIDs.contains(conn.id),
                                    isActive: state.activeTab?.connectionID == conn.id,
                                    version: state.serverVersions[conn.id],
                                    onSelect: {
                                        state.activeTab?.connectionID = conn.id
                                        state.activeTab?.database = state.selectedDatabaseByConnection[conn.id] ?? conn.database
                                        if DemoDatabaseCatalog.isDemo(conn) || conn.id.hasPrefix("demo-") {
                                            let preset = DemoDatabaseCatalog.preset(for: conn.type)
                                            state.activeTab?.title = "\(conn.type.displayName) Demo"
                                            state.activeTab?.sql = preset.sampleQuery
                                        }
                                        Task {
                                            if !state.connectedIDs.contains(conn.id) {
                                                await state.connect(conn)
                                            }
                                            if DemoDatabaseCatalog.isDemo(conn) || conn.id.hasPrefix("demo-") {
                                                await state.runActiveQuery()
                                            }
                                        }
                                    },
                                    onToggleConnect: {
                                        Task {
                                            if state.connectedIDs.contains(conn.id) {
                                                await state.disconnect(conn.id)
                                            } else {
                                                await state.connect(conn)
                                            }
                                        }
                                    },
                                    onEdit: {
                                        state.editingConnection = conn
                                        state.showingConnectionSheet = true
                                    },
                                    onDelete: {
                                        state.deleteConnection(conn.id)
                                    }
                                )
                            }
                                }
                            }
                        }
                    }

                    // Active Connection Schema Browser
                    if let conn = state.activeConnection, state.connectedIDs.contains(conn.id) {
                        Divider()

                        VStack(alignment: .leading, spacing: 8) {
                            HStack(spacing: 8) {
                                Text("SCHEMA — \(conn.name.uppercased())")
                                    .font(.system(size: 10, weight: .bold))
                                    .foregroundStyle(.secondary)
                                Spacer()
                                if conn.type.usesSQLLimitGuard {
                                    Button {
                                        showingCreateTableSheet = true
                                    } label: {
                                        Image(systemName: "plus")
                                            .font(.system(size: 10, weight: .bold))
                                            .frame(width: 20, height: 20)
                                    }
                                    .buttonStyle(.plain)
                                    .liquidGlass(.clear, interactive: true, in: Circle())
                                    .help("Create New Table")
                                }
                                Button {
                                    Task {
                                        await state.loadTables(
                                            connectionID: conn.id,
                                            database: state.selectedDatabaseByConnection[conn.id],
                                            force: true
                                        )
                                    }
                                } label: {
                                    Image(systemName: "arrow.clockwise")
                                        .font(.system(size: 10, weight: .semibold))
                                        .frame(width: 20, height: 20)
                                }
                                .buttonStyle(.plain)
                                .liquidGlass(.clear, interactive: true, in: Circle())
                                .help("Refresh Schema")
                            }
                            .padding(.horizontal, 4)

                            let dbs = state.databasesByConnection[conn.id] ?? []
                            if dbs.count > 1 {
                                Picker("Database", selection: Binding(
                                    get: { state.selectedDatabaseByConnection[conn.id] ?? dbs.first ?? "" },
                                    set: { newDB in Task { await state.selectDatabase(newDB, for: conn.id) } }
                                )) {
                                    ForEach(dbs, id: \.self) { db in
                                        Text(db).tag(db)
                                    }
                                }
                                .pickerStyle(.menu)
                                .controlSize(.small)
                            }

                            HStack(spacing: 6) {
                                Image(systemName: "magnifyingglass")
                                    .font(.system(size: 11))
                                    .foregroundStyle(.secondary)
                                TextField("Filter tables…", text: $schemaFilter)
                                    .textFieldStyle(.plain)
                                    .font(.system(size: 12))
                                if !schemaFilter.isEmpty {
                                    Button {
                                        schemaFilter = ""
                                    } label: {
                                        Image(systemName: "xmark.circle.fill")
                                            .font(.system(size: 11))
                                            .foregroundStyle(.secondary)
                                    }
                                    .buttonStyle(.plain)
                                }
                            }
                            .padding(.horizontal, 9)
                            .padding(.vertical, 5)
                            .liquidGlassPill()

                            let tables = filteredTables(for: conn.id)
                            if tables.isEmpty {
                                Text("No tables or views found")
                                    .font(.caption)
                                    .foregroundStyle(.secondary)
                                    .padding(.horizontal, 4)
                            } else {
                                VStack(alignment: .leading, spacing: 3) {
                                    ForEach(tables) { table in
                                        let isExpanded = expandedTables.contains(table.id)
                                        VStack(alignment: .leading, spacing: 2) {
                                            HStack(spacing: 4) {
                                                Button {
                                                    if isExpanded {
                                                        expandedTables.remove(table.id)
                                                    } else {
                                                        expandedTables.insert(table.id)
                                                        Task { await state.loadColumns(for: table, connectionID: conn.id) }
                                                    }
                                                } label: {
                                                    Image(systemName: isExpanded ? "chevron.down" : "chevron.right")
                                                        .font(.system(size: 9, weight: .bold))
                                                        .foregroundStyle(.secondary)
                                                        .frame(width: 14, height: 14)
                                                }
                                                .buttonStyle(.plain)

                                                Button {
                                                    Task { await state.previewTable(table, connectionID: conn.id, inNewTab: false) }
                                                } label: {
                                                    HStack(spacing: 6) {
                                                        Image(systemName: table.kind == .view ? "eye" : "tablecells")
                                                            .font(.system(size: 11))
                                                            .foregroundStyle(table.kind == .view ? GlassTheme.accentBright : GlassTheme.color(for: conn.type))
                                                        Text(table.name)
                                                            .font(.system(size: 12, weight: .medium))
                                                            .lineLimit(1)
                                                        Spacer()
                                                        if let schema = table.schema, schema != "public" && schema != "main" {
                                                            Text(schema)
                                                                .font(.system(size: 9))
                                                                .foregroundStyle(.tertiary)
                                                        }
                                                    }
                                                    .contentShape(Rectangle())
                                                }
                                                .buttonStyle(.plain)
                                            }
                                            .padding(.horizontal, 8)
                                            .padding(.vertical, 5)
                                            .liquidGlassCard(cornerRadius: 8, tint: isExpanded ? GlassTheme.color(for: conn.type) : nil, isSelected: isExpanded, interactive: true)
                                            .contextMenu {
                                                Button("Preview Rows") {
                                                    Task { await state.previewTable(table, connectionID: conn.id, inNewTab: false) }
                                                }
                                                Button("Open in New Tab") {
                                                    Task { await state.previewTable(table, connectionID: conn.id, inNewTab: true) }
                                                }
                                                if conn.type.usesSQLLimitGuard && table.kind == .table {
                                                    Divider()
                                                    Button("Copy Table…") {
                                                        copyingTable = table
                                                    }
                                                    Menu("SQL CRUD Templates") {
                                                        Button("SELECT * FROM \(table.name)") {
                                                            state.activeTab?.sql = "SELECT * FROM \"\(table.name)\" LIMIT 100;"
                                                        }
                                                        Button("INSERT INTO \(table.name)") {
                                                            state.activeTab?.sql = "INSERT INTO \"\(table.name)\" (col1, col2)\nVALUES ('val1', 'val2');"
                                                        }
                                                        Button("UPDATE \(table.name)") {
                                                            state.activeTab?.sql = "UPDATE \"\(table.name)\"\nSET col1 = 'new_value'\nWHERE id = 1;"
                                                        }
                                                        Button("DELETE FROM \(table.name)") {
                                                            state.activeTab?.sql = "DELETE FROM \"\(table.name)\"\nWHERE id = 1;"
                                                        }
                                                    }
                                                    Divider()
                                                    Button("Truncate Table", role: .destructive) {
                                                        Task { await state.truncateTable(table, connectionID: conn.id) }
                                                    }
                                                }
                                                Button(table.kind == .view ? "Drop View" : "Drop Table / Key", role: .destructive) {
                                                    Task { await state.dropTable(table, connectionID: conn.id) }
                                                }
                                                Divider()
                                                Button("Copy Name") {
                                                    NSPasteboard.general.clearContents()
                                                    NSPasteboard.general.setString(table.name, forType: .string)
                                                }
                                            }

                                            if isExpanded {
                                                let cols = state.columns(for: table, connectionID: conn.id)
                                                VStack(alignment: .leading, spacing: 2) {
                                                    if cols.isEmpty {
                                                        Text("Loading columns…")
                                                            .font(.caption2)
                                                            .foregroundStyle(.secondary)
                                                    } else {
                                                        ForEach(cols) { col in
                                                            HStack(spacing: 6) {
                                                                Image(systemName: col.primaryKey ? "key.fill" : "circle.fill")
                                                                    .font(.system(size: col.primaryKey ? 8 : 4))
                                                                    .foregroundStyle(col.primaryKey ? GlassTheme.warning : .secondary)
                                                                Text(col.name)
                                                                    .font(.system(size: 11, design: .monospaced))
                                                                    .lineLimit(1)
                                                                Spacer()
                                                                Text(col.type)
                                                                    .font(.system(size: 10, design: .monospaced))
                                                                    .foregroundStyle(.secondary)
                                                            }
                                                            .padding(.vertical, 1)
                                                        }
                                                    }
                                                }
                                                .padding(.leading, 24)
                                                .padding(.trailing, 6)
                                                .padding(.vertical, 3)
                                            }
                                        }
                                    }
                                }
                            }
                        }
                    }

                    // Saved Queries Section
                    if !state.savedQueries.isEmpty {
                        Divider()

                        VStack(alignment: .leading, spacing: 6) {
                            Text("SAVED QUERIES (\(state.savedQueries.count))")
                                .font(.system(size: 10, weight: .bold))
                                .foregroundStyle(.secondary)
                                .padding(.horizontal, 4)

                            ForEach(state.savedQueries) { sq in
                                Button {
                                    state.activeTab?.sql = sq.sql
                                    state.activeTab?.title = sq.name
                                } label: {
                                    HStack {
                                        Image(systemName: "bookmark.fill")
                                            .font(.system(size: 10))
                                            .foregroundStyle(GlassTheme.accent)
                                        Text(sq.name)
                                            .font(.system(size: 12))
                                            .lineLimit(1)
                                        Spacer()
                                    }
                                    .padding(.horizontal, 9)
                                    .padding(.vertical, 6)
                                    .liquidGlassCard(cornerRadius: 8, interactive: true)
                                }
                                .buttonStyle(.plain)
                                .contextMenu {
                                    Button("Open in New Tab") {
                                        state.newTab(title: sq.name, sql: sq.sql)
                                    }
                                    Divider()
                                    Button("Delete", role: .destructive) {
                                        state.deleteSavedQuery(sq.id)
                                    }
                                }
                            }
                        }
                    }
                }
                .padding(10)
            }
        }
        .background(VisualEffectBackground(material: .sidebar, blendingMode: .behindWindow))
        .sheet(isPresented: $showingCreateTableSheet) {
            CreateTableSheetView(state: state)
        }
        .sheet(isPresented: Binding(
            get: { copyingTable != nil },
            set: { if !$0 { copyingTable = nil } }
        )) {
            if let table = copyingTable {
                CopyTableSheetView(state: state, sourceTable: table)
            }
        }
    }

    private func filteredTables(for connectionID: String) -> [TableInfo] {
        let all = state.tables(for: connectionID)
        let q = schemaFilter.trimmingCharacters(in: .whitespacesAndNewlines).lowercased()
        guard !q.isEmpty else { return all }
        return all.filter { $0.name.lowercased().contains(q) }
    }
}

private struct ConnectionRowView: View {
    let conn: ConnectionConfig
    let isConnected: Bool
    let isConnecting: Bool
    let isActive: Bool
    let version: String?
    let onSelect: () -> Void
    let onToggleConnect: () -> Void
    let onEdit: () -> Void
    let onDelete: () -> Void

    var body: some View {
        Button(action: onSelect) {
            HStack(spacing: 8) {
                Circle()
                    .fill(isConnected ? GlassTheme.success : (GlassTheme.color(hex: conn.color) ?? .secondary.opacity(0.4)))
                    .frame(width: 8, height: 8)
                    .shadow(color: isConnected ? GlassTheme.success.opacity(0.75) : .clear, radius: 4)

                Image(systemName: conn.type.symbolName)
                    .font(.system(size: 12))
                    .foregroundStyle(GlassTheme.color(for: conn.type))

                VStack(alignment: .leading, spacing: 2) {
                    HStack(spacing: 5) {
                        Text(conn.name.isEmpty ? conn.type.displayName : conn.name)
                            .font(.system(size: 12, weight: isActive ? .semibold : .medium))
                            .lineLimit(1)
                        Text(conn.type.displayName)
                            .font(.system(size: 9, weight: .semibold))
                            .padding(.horizontal, 6)
                            .padding(.vertical, 1.5)
                            .liquidGlassPill(tint: GlassTheme.color(for: conn.type))
                    }
                    Text(version ?? conn.subtitle)
                        .font(.system(size: 10))
                        .foregroundStyle(.secondary)
                        .lineLimit(1)
                }

                Spacer()

                if isConnecting {
                    ProgressView()
                        .controlSize(.small)
                }
            }
            .padding(.horizontal, 9)
            .padding(.vertical, 7)
            .liquidGlassCard(
                cornerRadius: 10,
                tint: isActive ? GlassTheme.color(for: conn.type) : nil,
                isSelected: isActive,
                interactive: true
            )
            .contentShape(Rectangle())
        }
        .buttonStyle(.plain)
        .contextMenu {
            Button(isConnected ? "Disconnect" : "Connect", action: onToggleConnect)
            Button("Edit Connection…", action: onEdit)
            Divider()
            Button("Delete Connection", role: .destructive, action: onDelete)
        }
    }
}
