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
                .navigationSplitViewColumnWidth(min: 236, ideal: 276, max: 380)
        } detail: {
            VStack(spacing: 8) {
                // Floating Liquid Glass Top Tab Bar + Action Cluster
                TabHeaderBar(
                    state: state,
                    showingAIPopover: $showingAIPopover,
                    onSaveQuery: {
                        newSavedQueryName = state.activeTab?.title ?? "Saved Query"
                        showingSaveQueryAlert = true
                    }
                )
                .padding(.horizontal, 10)
                .padding(.top, 8)

                if state.shouldShowUpdateBanner, let latest = state.settings.updates.cachedLatestVersion {
                    UpdateNotificationBanner(state: state, latestVersion: latest)
                        .padding(.horizontal, 10)
                }

                // Editor + Results vertical split
                VSplitView {
                    EditorPaneView(state: state)
                        .frame(minHeight: 160, idealHeight: 280)

                    ResultsPaneView(state: state)
                        .frame(minHeight: 180, idealHeight: 340)
                }
                .padding(.horizontal, 10)

                // Floating Liquid Glass Bottom Status Dock
                StatusBarView(state: state)
                    .padding(.horizontal, 10)
                    .padding(.bottom, 8)
            }
            .background(
                LiquidGlassAmbientBackground(
                    accentTint: state.activeConnection.map { GlassTheme.color(for: $0.type) } ?? GlassTheme.accent
                )
            )
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
        .sheet(isPresented: $state.showingUpdateSheet) {
            UpdateSheetView(state: state)
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
            // Query Tabs inside LiquidGlassContainer for fluid sibling refraction
            ScrollView(.horizontal, showsIndicators: false) {
                LiquidGlassContainer(spacing: 6) {
                    HStack(spacing: 6) {
                        ForEach(state.tabs) { tab in
                            let isActive = tab.id == state.activeTabID
                            HStack(spacing: 6) {
                                Circle()
                                    .fill(isActive ? GlassTheme.accentBright : Color.secondary.opacity(0.45))
                                    .frame(width: 6, height: 6)
                                    .shadow(color: isActive ? GlassTheme.accentBright.opacity(0.8) : .clear, radius: 4)
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
                            .padding(.horizontal, 11)
                            .padding(.vertical, 6)
                            .liquidGlass(
                                isActive ? .regular : .clear,
                                tint: isActive ? GlassTheme.accent : nil,
                                interactive: true,
                                emphasized: isActive,
                                in: Capsule()
                            )
                            .onTapGesture {
                                withAnimation(.spring(response: 0.25, dampingFraction: 0.82)) {
                                    state.activeTabID = tab.id
                                }
                            }
                        }

                        Button {
                            withAnimation(.spring(response: 0.25, dampingFraction: 0.82)) {
                                state.newTab()
                            }
                        } label: {
                            Image(systemName: "plus")
                                .font(.system(size: 11, weight: .semibold))
                                .frame(width: 26, height: 26)
                        }
                        .buttonStyle(.plain)
                        .liquidGlass(.clear, interactive: true, in: Circle())
                        .help("New Query Tab (⌘T)")
                    }
                    .padding(.vertical, 2)
                }
            }

            Spacer(minLength: 6)

            // Active connection picker + Floating Liquid Glass action cluster
            LiquidGlassContainer(spacing: 6) {
                HStack(spacing: 6) {
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
                        .frame(maxWidth: 205)
                        .controlSize(.small)
                    }

                    Button(action: onSaveQuery) {
                        Image(systemName: "bookmark")
                    }
                    .liquidGlassButton()
                    .controlSize(.small)
                    .help("Save Current Query")

                    Button {
                        showingAIPopover.toggle()
                    } label: {
                        Label("Local AI", systemImage: "sparkles")
                    }
                    .liquidGlassButton(tint: GlassTheme.accent)
                    .controlSize(.small)
                    .popover(isPresented: $showingAIPopover, arrowEdge: .bottom) {
                        LocalAIPopoverView(state: state)
                    }

                    Button {
                        state.showingHistorySheet = true
                    } label: {
                        Image(systemName: "clock.arrow.circlepath")
                    }
                    .liquidGlassButton()
                    .controlSize(.small)
                    .help("Query History (⌘Y)")

                    Button {
                        if state.isUpdateAvailable {
                            state.showingUpdateSheet = true
                        } else {
                            Task { await state.checkForUpdates(manual: true) }
                        }
                    } label: {
                        if state.isCheckingForUpdates {
                            ProgressView()
                                .controlSize(.mini)
                        } else if state.isUpdateAvailable {
                            Label("Update", systemImage: "arrow.down.circle.fill")
                                .foregroundStyle(GlassTheme.success)
                        } else {
                            Image(systemName: "arrow.triangle.2.circlepath.circle")
                        }
                    }
                    .liquidGlassButton(tint: state.isUpdateAvailable ? GlassTheme.success : nil)
                    .controlSize(.small)
                    .help(state.isUpdateAvailable
                          ? "Update available (v\(state.settings.updates.cachedLatestVersion ?? "")) — click to install"
                          : "Check for Updates on GitHub Releases")

                    Button {
                        state.showingSettingsSheet = true
                    } label: {
                        Image(systemName: "gearshape")
                    }
                    .liquidGlassButton()
                    .controlSize(.small)
                    .help("Settings (⌘,)")
                }
            }
        }
        .padding(.horizontal, 12)
        .padding(.vertical, 7)
        .liquidGlassBar(cornerRadius: 14)
    }
}

private struct EditorPaneView: View {
    @Bindable var state: AppState
    @Environment(\.colorScheme) private var colorScheme

    var body: some View {
        VStack(spacing: 6) {
            // Floating Liquid Glass Editor Control Bar
            LiquidGlassContainer(spacing: 8) {
                HStack(spacing: 10) {
                    if state.activeTab?.isRunning == true {
                        Button(role: .destructive) {
                            state.cancelActiveQuery()
                        } label: {
                            Label("Stop Query", systemImage: "stop.fill")
                        }
                        .liquidGlassButton(prominent: true, tint: GlassTheme.danger)
                        .controlSize(.small)
                        .help("Abort running query immediately")
                    } else {
                        Button {
                            state.startActiveQuery()
                        } label: {
                            Label("Run Query (⌘↩)", systemImage: "play.fill")
                        }
                        .liquidGlassButton(prominent: true, tint: GlassTheme.accent)
                        .controlSize(.small)
                    }

                    if let conn = state.activeConnection {
                        Text(conn.type.languageName)
                            .font(.system(size: 11, weight: .semibold, design: .monospaced))
                            .lineLimit(1)
                            .padding(.horizontal, 9)
                            .padding(.vertical, 3)
                            .liquidGlassPill(tint: GlassTheme.color(for: conn.type), emphasized: true)
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
                    .liquidGlassButton()
                    .controlSize(.small)
                    .fixedSize(horizontal: true, vertical: false)
                }
                .padding(.horizontal, 10)
                .padding(.vertical, 6)
                .liquidGlassBar(cornerRadius: 12)
            }

            // Crisp SQL Content Surface with subtle Liquid Glass frame
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
            .background(.ultraThinMaterial, in: RoundedRectangle(cornerRadius: 12, style: .continuous))
            .clipShape(RoundedRectangle(cornerRadius: 12, style: .continuous))
            .overlay(
                RoundedRectangle(cornerRadius: 12, style: .continuous)
                    .strokeBorder(GlassTheme.specularRimGradient(for: colorScheme), lineWidth: 0.85)
                    .allowsHitTesting(false)
            )
        }
        .padding(.bottom, 4)
    }
}

private struct StatusBarView: View {
    let state: AppState

    var body: some View {
        LiquidGlassContainer(spacing: 8) {
            HStack(spacing: 10) {
                Circle()
                    .fill(statusColor)
                    .frame(width: 7, height: 7)
                    .shadow(color: statusColor.opacity(0.7), radius: 4)

                Text(state.statusMessage)
                    .font(.system(size: 11))
                    .foregroundStyle(.secondary)
                    .lineLimit(1)

                Spacer()

                if let conn = state.activeConnection {
                    let connected = state.connectedIDs.contains(conn.id)
                    HStack(spacing: 6) {
                        Circle()
                            .fill(connected ? GlassTheme.success : Color.secondary.opacity(0.5))
                            .frame(width: 6, height: 6)
                        Text(connected ? conn.name : "\(conn.name) (disconnected)")
                            .font(.system(size: 10.5, weight: .medium))
                            .foregroundStyle(connected ? GlassTheme.success : .secondary)
                        if connected && state.settings.autoDisconnectEnabled {
                            Text("• idle \(state.settings.autoDisconnectMinutes)m")
                                .font(.system(size: 10, design: .monospaced))
                                .foregroundStyle(.tertiary)
                        }
                    }
                    .padding(.horizontal, 9)
                    .padding(.vertical, 3)
                    .liquidGlassPill(tint: connected ? GlassTheme.success : nil)
                    .help(
                        connected && state.settings.autoDisconnectEnabled
                            ? "Connected to \(conn.name) (\(conn.type.displayName)). Auto-disconnects after \(state.settings.autoDisconnectMinutes) min of inactivity."
                            : "Connection status for \(conn.name) (\(conn.type.displayName))"
                    )
                }

                Button {
                    state.showingUpdateSheet = true
                } label: {
                    HStack(spacing: 4) {
                        Text("v\(state.currentAppVersion)")
                        if state.isUpdateAvailable, let latest = state.settings.updates.cachedLatestVersion {
                            Text("→ v\(latest)")
                                .foregroundStyle(GlassTheme.success)
                        }
                        Text("• Liquid Glass")
                    }
                    .font(.system(size: 10, weight: .medium, design: .monospaced))
                    .foregroundStyle(.secondary)
                    .padding(.horizontal, 9)
                    .padding(.vertical, 3)
                    .liquidGlassPill(
                        tint: state.isUpdateAvailable ? GlassTheme.success : nil,
                        interactive: true
                    )
                }
                .buttonStyle(.plain)
                .help("Click to view version & check GitHub Releases for updates")
            }
            .padding(.horizontal, 12)
            .padding(.vertical, 5)
            .liquidGlassBar(cornerRadius: 12)
        }
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

private struct UpdateNotificationBanner: View {
    @Bindable var state: AppState
    let latestVersion: String

    var body: some View {
        LiquidGlassContainer(spacing: 8) {
            HStack(spacing: 10) {
                Image(systemName: "arrow.down.circle.fill")
                    .font(.system(size: 14))
                    .foregroundStyle(GlassTheme.success)

                Text("New release available: **KobeanSQL v\(latestVersion)** (current: v\(state.currentAppVersion))")
                    .font(.system(size: 12))
                    .lineLimit(1)

                if case .downloading(let progress) = state.updateDownloadState {
                    ProgressView(value: progress, total: 1.0)
                        .frame(width: 110)
                    Text("\(Int(progress * 100))%")
                        .font(.system(size: 11, design: .monospaced))
                        .foregroundStyle(.secondary)
                } else if case .verifying = state.updateDownloadState {
                    ProgressView().controlSize(.small)
                    Text("Verifying…")
                        .font(.system(size: 11))
                        .foregroundStyle(.secondary)
                } else if case .installing = state.updateDownloadState {
                    ProgressView().controlSize(.small)
                    Text("Closing & updating…")
                        .font(.system(size: 11))
                        .foregroundStyle(GlassTheme.success)
                }

                Spacer()

                if case .ready = state.updateDownloadState {
                    Button {
                        state.installReadyUpdate()
                    } label: {
                        Label("Install & Relaunch", systemImage: "arrow.triangle.2.circlepath")
                    }
                    .liquidGlassButton(prominent: true, tint: GlassTheme.success)
                    .controlSize(.small)
                } else {
                    Button {
                        Task { await state.downloadAndInstallUpdate() }
                    } label: {
                        Label("Update Now", systemImage: "arrow.down.to.line")
                    }
                    .liquidGlassButton(prominent: true, tint: GlassTheme.accent)
                    .controlSize(.small)
                    .disabled(isDownloading)
                }

                Button("Release Notes…") {
                    state.showingUpdateSheet = true
                }
                .liquidGlassButton()
                .controlSize(.small)

                Button("Later") {
                    state.dismissUpdateReminder()
                }
                .liquidGlassButton()
                .controlSize(.small)
            }
            .padding(.horizontal, 12)
            .padding(.vertical, 7)
            .liquidGlassBar(cornerRadius: 12, tint: GlassTheme.accent)
        }
    }

    private var isDownloading: Bool {
        switch state.updateDownloadState {
        case .downloading, .verifying, .installing:
            return true
        default:
            return false
        }
    }
}
