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
                Section("Query Execution & Safety Guards") {
                    HStack {
                        Text("Table Preview Row Limit")
                        Spacer()
                        TextField("100", value: $draft.queryLimit, format: .number)
                            .textFieldStyle(.roundedBorder)
                            .frame(width: 90)
                    }
                    Toggle("Auto-append LIMIT 1000 to unbounded SELECT queries", isOn: $draft.autoLimitEnabled)
                    Text("Result sets are always capped at 10,000 rows with a 30s execution timeout and max 5 connections per pool.")
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
        .frame(width: 560, height: 480)
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
