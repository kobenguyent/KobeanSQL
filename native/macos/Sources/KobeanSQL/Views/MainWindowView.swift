import SwiftUI
import KobeanSQLCore

struct MainWindowView: View {
    @Bindable var state: AppState
    @State private var showingAIPopover = false
    @State private var showingSaveQueryAlert = false
    @State private var newSavedQueryName = ""

    var body: some View {
        NavigationSplitView {
            SidebarView(state: state)
                .navigationSplitViewColumnWidth(min: 230, ideal: 270, max: 380)
        } detail: {
            VStack(spacing: 0) {
                // Top Tab Bar + Connection Selector
                TabHeaderBar(
                    state: state,
                    showingAIPopover: $showingAIPopover,
                    onSaveQuery: {
                        newSavedQueryName = state.activeTab?.title ?? "Saved Query"
                        showingSaveQueryAlert = true
                    }
                )

                Divider()

                // Editor + Results vertical split
                VSplitView {
                    EditorPaneView(state: state)
                        .frame(minHeight: 160, idealHeight: 280)

                    ResultsPaneView(state: state)
                        .frame(minHeight: 180, idealHeight: 340)
                }

                Divider()

                // Bottom Status Bar
                StatusBarView(state: state)
            }
            .background(VisualEffectBackground(material: .underWindowBackground, blendingMode: .behindWindow))
        }
        .preferredColorScheme(preferredScheme)
        .sheet(isPresented: $state.showingConnectionSheet) {
            ConnectionSheetView(state: state, existing: state.editingConnection)
        }
        .sheet(isPresented: $state.showingHistorySheet) {
            HistorySheetView(state: state)
        }
        .sheet(isPresented: $state.showingSettingsSheet) {
            SettingsSheetView(state: state)
        }
        .alert("Save Query", isPresented: $showingSaveQueryAlert) {
            TextField("Query Name", text: $newSavedQueryName)
            Button("Save") {
                if let sql = state.activeTab?.sql {
                    state.saveQuery(name: newSavedQueryName, sql: sql)
                }
            }
            Button("Cancel", role: .cancel) {}
        }
        .alert("Confirm Destructive Query", isPresented: Binding(
            get: { state.pendingDestructiveWarning != nil },
            set: { if !$0 { state.pendingDestructiveWarning = nil } }
        )) {
            Button("Execute Anyway", role: .destructive) {
                state.pendingDestructiveWarning = nil
                state.startActiveQuery(confirmedDestructive: true)
            }
            Button("Cancel", role: .cancel) {
                state.pendingDestructiveWarning = nil
            }
        } message: {
            Text(state.pendingDestructiveWarning ?? "")
        }
    }

    private var preferredScheme: ColorScheme? {
        switch state.settings.appearance {
        case .dark: .dark
        case .light: .light
        case .system: nil
        }
    }
}

private struct TabHeaderBar: View {
    @Bindable var state: AppState
    @Binding var showingAIPopover: Bool
    var onSaveQuery: () -> Void

    var body: some View {
        HStack(spacing: 8) {
            // Query Tabs
            ScrollView(.horizontal, showsIndicators: false) {
                HStack(spacing: 4) {
                    ForEach(state.tabs) { tab in
                        let isActive = tab.id == state.activeTabID
                        HStack(spacing: 6) {
                            Image(systemName: "terminal")
                                .font(.system(size: 10))
                                .foregroundStyle(isActive ? GlassTheme.accentBright : .secondary)
                            Text(tab.title)
                                .font(.system(size: 12, weight: isActive ? .semibold : .regular))
                                .lineLimit(1)
                            if state.tabs.count > 1 {
                                Button {
                                    state.closeTab(tab.id)
                                } label: {
                                    Image(systemName: "xmark")
                                        .font(.system(size: 9, weight: .bold))
                                        .foregroundStyle(.secondary)
                                }
                                .buttonStyle(.plain)
                            }
                        }
                        .padding(.horizontal, 10)
                        .padding(.vertical, 6)
                        .background(
                            RoundedRectangle(cornerRadius: 7)
                                .fill(isActive ? GlassTheme.accent.opacity(0.22) : Color.secondary.opacity(0.08))
                        )
                        .overlay(
                            RoundedRectangle(cornerRadius: 7)
                                .stroke(isActive ? GlassTheme.accent.opacity(0.55) : Color.clear, lineWidth: 1)
                        )
                        .onTapGesture {
                            state.activeTabID = tab.id
                        }
                    }

                    Button {
                        state.newTab()
                    } label: {
                        Image(systemName: "plus")
                            .font(.system(size: 11, weight: .semibold))
                            .padding(6)
                    }
                    .buttonStyle(.plain)
                    .help("New Query Tab (⌘T)")
                }
            }

            Spacer()

            // Active connection picker for current tab
            if !state.connections.isEmpty {
                Picker("Connection", selection: Binding(
                    get: { state.activeTab?.connectionID ?? state.connections.first?.id ?? "" },
                    set: { newID in
                        state.activeTab?.connectionID = newID
                        state.activeTab?.database = state.selectedDatabaseByConnection[newID]
                    }
                )) {
                    ForEach(state.connections) { conn in
                        Text("\(conn.name) (\(conn.type.displayName))").tag(conn.id)
                    }
                }
                .labelsHidden()
                .frame(maxWidth: 210)
                .controlSize(.small)
            }

            Button(action: onSaveQuery) {
                Image(systemName: "bookmark")
            }
            .controlSize(.small)
            .help("Save Current Query")

            Button {
                showingAIPopover.toggle()
            } label: {
                Label("Local AI", systemImage: "sparkles")
            }
            .controlSize(.small)
            .popover(isPresented: $showingAIPopover, arrowEdge: .bottom) {
                LocalAIPopoverView(state: state)
            }

            Button {
                state.showingHistorySheet = true
            } label: {
                Image(systemName: "clock.arrow.circlepath")
            }
            .controlSize(.small)
            .help("Query History (⌘Y)")

            Button {
                state.showingSettingsSheet = true
            } label: {
                Image(systemName: "gearshape")
            }
            .controlSize(.small)
            .help("Settings (⌘,)")
        }
        .padding(.horizontal, 12)
        .padding(.vertical, 8)
        .background(.ultraThinMaterial)
    }
}

private struct EditorPaneView: View {
    @Bindable var state: AppState

    var body: some View {
        VStack(spacing: 0) {
            // Editor action bar
            HStack(spacing: 10) {
                if state.activeTab?.isRunning == true {
                    Button(role: .destructive) {
                        state.cancelActiveQuery()
                    } label: {
                        Label("Stop Query", systemImage: "stop.fill")
                    }
                    .buttonStyle(.borderedProminent)
                    .tint(GlassTheme.danger)
                    .controlSize(.small)
                    .help("Abort running query immediately")
                } else {
                    Button {
                        state.startActiveQuery()
                    } label: {
                        Label("Run Query (⌘↩)", systemImage: "play.fill")
                    }
                    .buttonStyle(.borderedProminent)
                    .tint(GlassTheme.accent)
                    .controlSize(.small)
                }

                if let conn = state.activeConnection {
                    Text(conn.type.languageName)
                        .font(.system(size: 11, weight: .semibold, design: .monospaced))
                        .lineLimit(1)
                        .padding(.horizontal, 7)
                        .padding(.vertical, 2)
                        .background(GlassTheme.color(for: conn.type).opacity(0.18), in: Capsule())
                        .fixedSize(horizontal: true, vertical: false)
                }

                Toggle("Auto LIMIT 1000", isOn: Binding(
                    get: { state.settings.autoLimitEnabled },
                    set: { newValue in
                        var s = state.settings
                        s.autoLimitEnabled = newValue
                        state.updateSettings(s)
                    }
                ))
                .toggleStyle(.checkbox)
                .font(.caption)
                .lineLimit(1)
                .fixedSize(horizontal: true, vertical: false)

                Toggle("Read-Only Safe Mode", isOn: Binding(
                    get: { state.settings.readOnlyMode },
                    set: { newValue in
                        var s = state.settings
                        s.readOnlyMode = newValue
                        state.updateSettings(s)
                    }
                ))
                .toggleStyle(.checkbox)
                .font(.caption)
                .lineLimit(1)
                .fixedSize(horizontal: true, vertical: false)
                .help("Blocks all INSERT/UPDATE/DELETE/DDL statements when enabled")

                Spacer(minLength: 8)

                Text("Autocomplete: Type or ⌃Space")
                    .font(.system(size: 10, design: .monospaced))
                    .foregroundStyle(.tertiary)
                    .lineLimit(1)

                Button("Clear") {
                    state.activeTab?.sql = ""
                }
                .controlSize(.small)
                .fixedSize(horizontal: true, vertical: false)
            }
            .padding(.horizontal, 12)
            .padding(.vertical, 6)
            .background(.thinMaterial)

            Divider()

            NativeCodeEditor(
                text: Binding(
                    get: { state.activeTab?.sql ?? "" },
                    set: { state.activeTab?.sql = $0 }
                ),
                onExecute: {
                    state.startActiveQuery()
                },
                suggestionsProvider: { prefix, fullSQL in
                    state.autocompleteSuggestions(prefix: prefix, fullSQL: fullSQL)
                }
            )
        }
    }
}

private struct StatusBarView: View {
    let state: AppState

    var body: some View {
        HStack(spacing: 10) {
            Circle()
                .fill(statusColor)
                .frame(width: 7, height: 7)

            Text(state.statusMessage)
                .font(.system(size: 11))
                .foregroundStyle(.secondary)
                .lineLimit(1)

            Spacer()

            if let conn = state.activeConnection {
                let connected = state.connectedIDs.contains(conn.id)
                Text(connected ? "● \(conn.name)" : "○ \(conn.name) (disconnected)")
                    .font(.system(size: 11, weight: .medium))
                    .foregroundStyle(connected ? GlassTheme.success : .secondary)
            }

            Text("Native macOS • SwiftUI + AppKit")
                .font(.system(size: 10, weight: .medium, design: .monospaced))
                .foregroundStyle(.tertiary)
        }
        .padding(.horizontal, 12)
        .padding(.vertical, 5)
        .background(.ultraThinMaterial)
    }

    private var statusColor: Color {
        switch state.statusLevel {
        case .info: GlassTheme.accent
        case .success: GlassTheme.success
        case .warning: GlassTheme.warning
        case .error: GlassTheme.danger
        }
    }
}
