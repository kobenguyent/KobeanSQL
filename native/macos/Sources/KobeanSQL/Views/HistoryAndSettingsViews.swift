import AppKit
import SwiftUI
import KobeanSQLCore

struct HistorySheetView: View {
    @Bindable var state: AppState
    @Environment(\.dismiss) private var dismiss
    @State private var search: String = ""

    var body: some View {
        VStack(alignment: .leading, spacing: 12) {
            HStack {
                Label("Query History (\(state.history.count))", systemImage: "clock.arrow.circlepath")
                    .font(.title3.weight(.semibold))
                Spacer()
                TextField("Search history…", text: $search)
                    .textFieldStyle(.roundedBorder)
                    .frame(width: 220)
                Button("Clear All", role: .destructive) {
                    state.clearHistory()
                }
                .disabled(state.history.isEmpty)
                Button("Done") { dismiss() }
                    .keyboardShortcut(.defaultAction)
            }

            Divider()

            if filtered.isEmpty {
                VStack(spacing: 8) {
                    Image(systemName: "clock")
                        .font(.system(size: 28))
                        .foregroundStyle(.tertiary)
                    Text("No matching query history")
                        .foregroundStyle(.secondary)
                }
                .frame(maxWidth: .infinity, maxHeight: .infinity)
            } else {
                List(filtered) { item in
                    VStack(alignment: .leading, spacing: 5) {
                        HStack {
                            Text(item.connectionName)
                                .font(.caption.weight(.semibold))
                                .padding(.horizontal, 6)
                                .padding(.vertical, 2)
                                .background(GlassTheme.accent.opacity(0.18), in: Capsule())

                            if let db = item.database, !db.isEmpty {
                                Text(db)
                                    .font(.caption)
                                    .foregroundStyle(.secondary)
                            }

                            Spacer()

                            if let err = item.error {
                                Label(err, systemImage: "xmark.circle.fill")
                                    .font(.caption2)
                                    .foregroundStyle(GlassTheme.danger)
                                    .lineLimit(1)
                            } else {
                                Text("\(item.rowCount) rows • \(String(format: "%.0f ms", item.duration * 1000))")
                                    .font(.caption2)
                                    .foregroundStyle(GlassTheme.success)
                            }

                            Text(item.date, style: .relative)
                                .font(.caption2)
                                .foregroundStyle(.tertiary)
                        }

                        Text(item.query)
                            .font(.system(size: 11, design: .monospaced))
                            .lineLimit(3)
                            .frame(maxWidth: .infinity, alignment: .leading)
                    }
                    .padding(.vertical, 4)
                    .contentShape(Rectangle())
                    .onTapGesture {
                        state.activeTab?.sql = item.query
                        dismiss()
                    }
                }
            }
        }
        .padding(16)
        .frame(width: 680, height: 480)
    }

    private var filtered: [HistoryEntry] {
        let q = search.trimmingCharacters(in: .whitespacesAndNewlines).lowercased()
        guard !q.isEmpty else { return state.history }
        return state.history.filter {
            $0.query.lowercased().contains(q) || $0.connectionName.lowercased().contains(q)
        }
    }
}

struct SettingsSheetView: View {
    @Bindable var state: AppState
    @Environment(\.dismiss) private var dismiss
    @State private var draft: NativeAppSettings

    init(state: AppState) {
        self.state = state
        _draft = State(initialValue: state.settings)
    }

    var body: some View {
        VStack(alignment: .leading, spacing: 14) {
            HStack {
                Label("KobeanSQL Native Settings", systemImage: "gearshape.fill")
                    .font(.title3.weight(.semibold))
                Spacer()
                Button("Open Data Folder") {
                    try? FileManager.default.createDirectory(at: state.storage.directory, withIntermediateDirectories: true)
                    NSWorkspace.shared.activateFileViewerSelecting([state.storage.directory])
                }
                .controlSize(.small)
            }

            Divider()

            Form {
                Section("Query Execution, Deadlock & Safety Guards") {
                    HStack {
                        Text("Table Preview Row Limit")
                        Spacer()
                        TextField("100", value: $draft.queryLimit, format: .number)
                            .textFieldStyle(.roundedBorder)
                            .frame(width: 90)
                    }
                    HStack {
                        Text("Query Execution Timeout (seconds)")
                        Spacer()
                        TextField("30", value: $draft.queryTimeoutSeconds, format: .number)
                            .textFieldStyle(.roundedBorder)
                            .frame(width: 90)
                    }
                    Toggle("Auto-append LIMIT 1000 to unbounded SELECT queries", isOn: $draft.autoLimitEnabled)
                    Toggle("Confirm before executing destructive queries (DROP, TRUNCATE, DELETE/UPDATE without WHERE)", isOn: $draft.confirmDestructiveQueries)
                    Toggle("Read-Only Safe Mode (block all write & DDL queries)", isOn: $draft.readOnlyMode)
                    Text("Result sets are capped at 10,000 rows, SQLite runs in WAL mode with busy_timeout + progress interrupt, and connection pools are capped at 5.")
                        .font(.caption)
                        .foregroundStyle(.secondary)
                }

                Section("Appearance") {
                    Picker("Theme Mode", selection: $draft.appearance) {
                        ForEach(NativeAppSettings.AppearanceMode.allCases) { mode in
                            Text(mode.label).tag(mode)
                        }
                    }
                    .pickerStyle(.segmented)
                }

                Section("Software Updates (GitHub Releases)") {
                    HStack {
                        VStack(alignment: .leading, spacing: 2) {
                            Text("Installed Version: v\(state.currentAppVersion)")
                                .font(.subheadline.weight(.medium))
                            if let latest = state.settings.updates.cachedLatestVersion {
                                if state.isUpdateAvailable {
                                    Text("Update available: v\(latest)")
                                        .font(.caption)
                                        .foregroundStyle(GlassTheme.success)
                                } else {
                                    Text("Up to date (latest: v\(latest))")
                                        .font(.caption)
                                        .foregroundStyle(.secondary)
                                }
                            } else {
                                Text("Checks github.com/kobenguyent/KobeanSQL/releases")
                                    .font(.caption)
                                    .foregroundStyle(.secondary)
                            }
                        }
                        Spacer()
                        Button {
                            Task { await state.checkForUpdates(manual: true) }
                        } label: {
                            if state.isCheckingForUpdates {
                                ProgressView().controlSize(.small)
                            } else {
                                Label("Check for Updates…", systemImage: "arrow.triangle.2.circlepath")
                            }
                        }
                        .controlSize(.small)
                        .disabled(state.isCheckingForUpdates)
                    }

                    Toggle("Automatically check GitHub Releases for new versions", isOn: $draft.updates.autoCheckEnabled)

                    HStack {
                        Text("Check Interval (hours)")
                        Spacer()
                        TextField("24", value: $draft.updates.checkIntervalHours, format: .number)
                            .textFieldStyle(.roundedBorder)
                            .frame(width: 90)
                            .disabled(!draft.updates.autoCheckEnabled)
                    }
                }

                Section("Local AI SQL Assistant (Loopback Only)") {
                    Picker("Provider", selection: $draft.ai.provider) {
                        ForEach(AISettings.Provider.allCases) { p in
                            Text(p.label).tag(p)
                        }
                    }
                    .onChange(of: draft.ai.provider) { _, newValue in
                        if newValue == .ollama && draft.ai.baseURL.contains("1234") {
                            draft.ai.baseURL = "http://127.0.0.1:11434"
                        } else if newValue == .openAICompatible && draft.ai.baseURL.contains("11434") {
                            draft.ai.baseURL = "http://127.0.0.1:1234/v1"
                        }
                    }

                    TextField("Base URL (localhost / 127.0.0.1 only)", text: $draft.ai.baseURL)
                        .textFieldStyle(.roundedBorder)
                    TextField("Model Name", text: $draft.ai.model)
                        .textFieldStyle(.roundedBorder)

                    if let validationError = AIService.validateLocalURL(draft.ai.baseURL) {
                        Label(validationError, systemImage: "exclamationmark.shield.fill")
                            .font(.caption)
                            .foregroundStyle(GlassTheme.danger)
                    } else {
                        Label("Verified local loopback endpoint — zero cloud data egress", systemImage: "lock.shield.fill")
                            .font(.caption)
                            .foregroundStyle(GlassTheme.success)
                    }
                }
            }
            .formStyle(.grouped)

            HStack {
                Spacer()
                Button("Cancel") { dismiss() }
                    .keyboardShortcut(.cancelAction)
                Button("Save Settings") {
                    state.updateSettings(draft)
                    dismiss()
                }
                .buttonStyle(.borderedProminent)
                .tint(GlassTheme.accent)
                .disabled(AIService.validateLocalURL(draft.ai.baseURL) != nil)
                .keyboardShortcut(.defaultAction)
            }
        }
        .padding(18)
        .frame(width: 580, height: 560)
    }
}

struct UpdateSheetView: View {
    @Bindable var state: AppState
    @Environment(\.dismiss) private var dismiss

    var body: some View {
        let updates = state.settings.updates
        let latest = updates.cachedLatestVersion
        let hasUpdate = state.isUpdateAvailable

        VStack(alignment: .leading, spacing: 14) {
            HStack(spacing: 10) {
                Image(systemName: hasUpdate ? "arrow.down.circle.fill" : "checkmark.seal.fill")
                    .font(.system(size: 26))
                    .foregroundStyle(hasUpdate ? GlassTheme.success : GlassTheme.accent)

                VStack(alignment: .leading, spacing: 2) {
                    Text(hasUpdate ? "New Version Available" : "Software Update")
                        .font(.title3.weight(.semibold))
                    Text("Source: GitHub Releases (kobenguyent/KobeanSQL)")
                        .font(.caption)
                        .foregroundStyle(.secondary)
                }

                Spacer()

                Button {
                    Task { await state.checkForUpdates(manual: true) }
                } label: {
                    if state.isCheckingForUpdates {
                        ProgressView().controlSize(.small)
                    } else {
                        Label("Check Now", systemImage: "arrow.triangle.2.circlepath")
                    }
                }
                .controlSize(.small)
                .disabled(state.isCheckingForUpdates)
            }

            Divider()

            // Version comparison summary box
            HStack(spacing: 16) {
                VStack(alignment: .leading, spacing: 4) {
                    Text("INSTALLED VERSION")
                        .font(.caption2.weight(.semibold))
                        .foregroundStyle(.secondary)
                    Text("v\(state.currentAppVersion)")
                        .font(.system(size: 15, weight: .bold, design: .monospaced))
                }
                .frame(maxWidth: .infinity, alignment: .leading)
                .padding(10)
                .background(Color.secondary.opacity(0.08), in: RoundedRectangle(cornerRadius: 8))

                Image(systemName: "arrow.right")
                    .foregroundStyle(.secondary)

                VStack(alignment: .leading, spacing: 4) {
                    Text("LATEST GITHUB RELEASE")
                        .font(.caption2.weight(.semibold))
                        .foregroundStyle(.secondary)
                    Text(latest.map { "v\($0)" } ?? (state.isCheckingForUpdates ? "Checking…" : "Unknown"))
                        .font(.system(size: 15, weight: .bold, design: .monospaced))
                        .foregroundStyle(hasUpdate ? GlassTheme.success : .primary)
                }
                .frame(maxWidth: .infinity, alignment: .leading)
                .padding(10)
                .background(
                    RoundedRectangle(cornerRadius: 8)
                        .fill(hasUpdate ? GlassTheme.success.opacity(0.12) : Color.secondary.opacity(0.08))
                )
            }

            if let err = state.updateCheckError {
                Label(err, systemImage: "exclamationmark.triangle.fill")
                    .font(.caption)
                    .foregroundStyle(GlassTheme.danger)
            }

            if let assetName = updates.cachedAssetName {
                HStack(spacing: 6) {
                    Image(systemName: "shippingbox.fill")
                        .font(.caption)
                        .foregroundStyle(.secondary)
                    Text("Asset: \(assetName)")
                        .font(.system(size: 11, design: .monospaced))
                    if let size = updates.cachedAssetSize, size > 0 {
                        Text("(\(ByteCountFormatter.string(fromByteCount: size, countStyle: .file)))")
                            .font(.caption)
                            .foregroundStyle(.secondary)
                    }
                    Spacer()
                    if let checkedAt = updates.lastCheckedAt {
                        Text("Checked \(checkedAt, style: .relative) ago")
                            .font(.caption2)
                            .foregroundStyle(.tertiary)
                    }
                }
            }

            // Release Notes
            VStack(alignment: .leading, spacing: 6) {
                HStack {
                    Text(updates.cachedReleaseName ?? "Release Notes")
                        .font(.subheadline.weight(.semibold))
                    Spacer()
                    Button("View on GitHub ↗") {
                        state.openReleasePage()
                    }
                    .buttonStyle(.link)
                    .font(.caption)
                }

                ScrollView {
                    Text(
                        (updates.cachedReleaseNotes?.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty == false)
                            ? updates.cachedReleaseNotes!
                            : (hasUpdate
                                ? "A new release of KobeanSQL is available on GitHub Releases."
                                : "You are running the latest version of KobeanSQL (\(state.currentAppVersion)).")
                    )
                    .font(.system(size: 11.5, design: .monospaced))
                    .textSelection(.enabled)
                    .frame(maxWidth: .infinity, alignment: .leading)
                    .padding(10)
                }
                .frame(minHeight: 130, maxHeight: 200)
                .background(Color.secondary.opacity(0.07), in: RoundedRectangle(cornerRadius: 8))
            }

            // Download progress / error state
            switch state.updateDownloadState {
            case .idle:
                EmptyView()
            case .downloading(let progress):
                VStack(alignment: .leading, spacing: 4) {
                    HStack {
                        Text("Downloading update from GitHub Releases…")
                            .font(.caption.weight(.medium))
                        Spacer()
                        Text("\(Int(progress * 100))%")
                            .font(.system(size: 11, weight: .semibold, design: .monospaced))
                    }
                    ProgressView(value: progress, total: 1.0)
                }
            case .ready(let fileURL):
                Label("Downloaded \(fileURL.lastPathComponent) — ready to install & relaunch!", systemImage: "checkmark.circle.fill")
                    .font(.caption.weight(.semibold))
                    .foregroundStyle(GlassTheme.success)
            case .failed(let msg):
                Label(msg, systemImage: "xmark.octagon.fill")
                    .font(.caption)
                    .foregroundStyle(GlassTheme.danger)
            }

            Divider()

            HStack(spacing: 8) {
                if hasUpdate {
                    Button("Skip This Version") {
                        state.ignoreCurrentUpdate()
                    }
                    .controlSize(.small)

                    Button("Remind Me Later") {
                        state.dismissUpdateReminder()
                        dismiss()
                    }
                    .controlSize(.small)
                }

                Spacer()

                Button("Close") {
                    dismiss()
                }
                .keyboardShortcut(.cancelAction)

                if hasUpdate {
                    if case .ready = state.updateDownloadState {
                        Button {
                            state.installReadyUpdate()
                        } label: {
                            Label("Install & Relaunch Now", systemImage: "arrow.triangle.2.circlepath")
                        }
                        .buttonStyle(.borderedProminent)
                        .tint(GlassTheme.success)
                        .keyboardShortcut(.defaultAction)
                    } else {
                        Button {
                            Task { await state.downloadAndInstallUpdate() }
                        } label: {
                            Label("Download & Install Update", systemImage: "arrow.down.to.line")
                        }
                        .buttonStyle(.borderedProminent)
                        .tint(GlassTheme.accent)
                        .disabled(isDownloading)
                        .keyboardShortcut(.defaultAction)
                    }
                }
            }
        }
        .padding(18)
        .frame(width: 580)
    }

    private var isDownloading: Bool {
        if case .downloading = state.updateDownloadState { return true }
        return false
    }
}

struct LocalAIPopoverView: View {
    @Bindable var state: AppState
    @State private var task: AITask = .generate
    @State private var prompt: String = ""
    @State private var output: String = ""
    @State private var isRunning = false
    @State private var errorText: String?

    var body: some View {
        VStack(alignment: .leading, spacing: 10) {
            HStack {
                Label("Local AI Assistant", systemImage: "cpu")
                    .font(.headline)
                Spacer()
                Text(state.settings.ai.model)
                    .font(.caption2)
                    .padding(.horizontal, 6)
                    .padding(.vertical, 2)
                    .background(GlassTheme.accent.opacity(0.18), in: Capsule())
            }

            Picker("Task", selection: $task) {
                ForEach(AITask.allCases) { t in
                    Text(t.label).tag(t)
                }
            }
            .pickerStyle(.segmented)

            if task == .generate {
                TextField("Describe the query (e.g. top 10 customers by spend)…", text: $prompt)
                    .textFieldStyle(.roundedBorder)
            } else {
                Text("Uses the current editor query and cached schema context.")
                    .font(.caption)
                    .foregroundStyle(.secondary)
            }

            HStack {
                Button {
                    runAITask()
                } label: {
                    if isRunning {
                        ProgressView().controlSize(.small)
                    } else {
                        Label("Run Local AI", systemImage: "sparkles")
                    }
                }
                .buttonStyle(.borderedProminent)
                .tint(GlassTheme.accent)
                .disabled(isRunning || (task == .generate && prompt.trimmingCharacters(in: .whitespaces).isEmpty))

                if !output.isEmpty {
                    Button("Insert into Editor") {
                        state.activeTab?.sql = output
                    }
                }
            }

            if let errorText {
                Text(errorText)
                    .font(.caption)
                    .foregroundStyle(GlassTheme.danger)
            }

            if !output.isEmpty {
                ScrollView {
                    Text(output)
                        .font(.system(size: 11, design: .monospaced))
                        .textSelection(.enabled)
                        .frame(maxWidth: .infinity, alignment: .leading)
                }
                .frame(maxHeight: 160)
                .padding(8)
                .background(Color.secondary.opacity(0.08), in: RoundedRectangle(cornerRadius: 6))
            }
        }
        .padding(14)
        .frame(width: 420)
    }

    private func runAITask() {
        isRunning = true
        errorText = nil
        let sql = state.activeTab?.sql ?? ""
        let dialect = state.activeConnection?.type ?? .postgres
        let schema = state.currentSchemaContext()
        let aiSettings = state.settings.ai
        Task {
            do {
                output = try await AIService.run(
                    task: task,
                    prompt: prompt,
                    sql: sql,
                    dialect: dialect,
                    schemaContext: schema,
                    settings: aiSettings
                )
            } catch {
                errorText = error.localizedDescription
            }
            isRunning = false
        }
    }
}
