import AppKit
import SwiftUI
import UniformTypeIdentifiers
import KobeanSQLCore

struct ConnectionSheetView: View {
    @Bindable var state: AppState
    @Environment(\.dismiss) private var dismiss

    @State private var draft: ConnectionConfig
    @State private var useURI: Bool
    @State private var isTesting = false
    @State private var isDetecting = false
    @State private var testFeedback: String?
    @State private var testSucceeded = false
    @State private var detectionBanner: String?

    private let colorPalette = ["7b7bea", "60a5fa", "4ade80", "fbbf24", "f97316", "f87171", "c084fc"]

    init(state: AppState, existing: ConnectionConfig?) {
        self.state = state
        let initial = existing ?? ConnectionConfig(name: "Local PostgreSQL", type: .postgres, host: "localhost", port: 5432, user: "postgres", database: "postgres", color: "60a5fa")
        _draft = State(initialValue: initial)
        _useURI = State(initialValue: !(initial.connectionUri ?? "").isEmpty)
    }

    var body: some View {
        VStack(alignment: .leading, spacing: 14) {
            HStack {
                Label(state.editingConnection == nil ? "New Database Connection" : "Edit Connection", systemImage: "externaldrive.connected.to.line.below")
                    .font(.title3.weight(.semibold))
                Spacer()
                Text(draft.type.category.label)
                    .font(.caption.weight(.medium))
                    .padding(.horizontal, 8)
                    .padding(.vertical, 3)
                    .background(GlassTheme.color(for: draft.type).opacity(0.18), in: Capsule())
            }

            Divider()

            ScrollView {
                VStack(alignment: .leading, spacing: 14) {
                    // Categorized DB Picker (matches KobeanSQL categorized DB picker UI)
                    VStack(alignment: .leading, spacing: 8) {
                        HStack {
                            Text("Database Engine")
                                .font(.caption.weight(.semibold))
                                .foregroundStyle(.secondary)
                            Spacer()
                            if let banner = detectionBanner {
                                Label(banner, systemImage: "sparkles")
                                    .font(.caption2.weight(.medium))
                                    .foregroundStyle(GlassTheme.accent)
                                    .lineLimit(1)
                            }
                        }

                        ForEach(DatabaseCategory.allCases, id: \.rawValue) { category in
                            VStack(alignment: .leading, spacing: 4) {
                                Text(category.label.uppercased())
                                    .font(.system(size: 9, weight: .bold))
                                    .foregroundStyle(.tertiary)
                                LazyVGrid(columns: [GridItem(.adaptive(minimum: 112), spacing: 6)], spacing: 6) {
                                    ForEach(category.types) { dbType in
                                        let selected = draft.type == dbType
                                        Button {
                                            applyEngineSelection(dbType)
                                            detectionBanner = nil
                                        } label: {
                                            HStack(spacing: 5) {
                                                Image(systemName: dbType.symbolName)
                                                    .font(.system(size: 11))
                                                Text(dbType.displayName)
                                                    .font(.system(size: 11, weight: .medium))
                                                    .lineLimit(1)
                                                Spacer(minLength: 0)
                                            }
                                            .padding(.horizontal, 8)
                                            .padding(.vertical, 6)
                                            .background(
                                                RoundedRectangle(cornerRadius: 7)
                                                    .fill(selected ? GlassTheme.color(for: dbType).opacity(0.24) : Color.secondary.opacity(0.08))
                                            )
                                            .overlay(
                                                RoundedRectangle(cornerRadius: 7)
                                                    .stroke(selected ? GlassTheme.color(for: dbType) : Color.clear, lineWidth: 1.5)
                                            )
                                        }
                                        .buttonStyle(.plain)
                                        .disabled(!dbType.isSupportedNatively)
                                        .opacity(dbType.isSupportedNatively ? 1.0 : 0.4)
                                        .help(dbType.isSupportedNatively ? dbType.displayName : "\(dbType.displayName) requires a proprietary driver not yet bundled in the native build")
                                    }
                                }
                            }
                        }
                    }

                    Divider()

                    // Connection Name & Color Tag
                    HStack(spacing: 12) {
                        VStack(alignment: .leading, spacing: 4) {
                            Text("Connection Name")
                                .font(.caption.weight(.semibold))
                            TextField("e.g. Production Analytics", text: $draft.name)
                                .textFieldStyle(.roundedBorder)
                        }

                        VStack(alignment: .leading, spacing: 4) {
                            Text("Badge Color")
                                .font(.caption.weight(.semibold))
                            HStack(spacing: 6) {
                                ForEach(colorPalette, id: \.self) { hex in
                                    Circle()
                                        .fill(GlassTheme.color(hex: hex) ?? GlassTheme.accent)
                                        .frame(width: 18, height: 18)
                                        .overlay(
                                            Circle()
                                                .stroke(Color.primary, lineWidth: draft.color == hex ? 2 : 0)
                                        )
                                        .onTapGesture { draft.color = hex }
                                }
                            }
                        }
                    }

                    // Engine-specific connection fields
                    if draft.type == .sqlite {
                        VStack(alignment: .leading, spacing: 4) {
                            Text("SQLite Database File")
                                .font(.caption.weight(.semibold))
                            HStack {
                                TextField("/path/to/database.sqlite", text: Binding(
                                    get: { draft.filename ?? "" },
                                    set: { newValue in
                                        draft.filename = newValue
                                        if let detected = DatabaseEngineDetector.detect(fromFilePath: newValue) {
                                            detectionBanner = detected.detail
                                        }
                                    }
                                ))
                                .textFieldStyle(.roundedBorder)
                                Button("Browse…") {
                                    let panel = NSOpenPanel()
                                    panel.canChooseFiles = true
                                    panel.canChooseDirectories = false
                                    panel.allowsMultipleSelection = false
                                    panel.canCreateDirectories = true
                                    if panel.runModal() == .OK, let url = panel.url {
                                        draft.filename = url.path
                                        if let detected = DatabaseEngineDetector.detect(fromFilePath: url.path) {
                                            applyDetection(detected)
                                        }
                                    }
                                }
                            }
                        }
                    } else {
                        Toggle("Connect using Connection URI (auto-recognizes DB engine)", isOn: $useURI)
                            .toggleStyle(.switch)
                            .controlSize(.small)

                        if useURI {
                            VStack(alignment: .leading, spacing: 4) {
                                Text("Connection URI")
                                    .font(.caption.weight(.semibold))
                                TextField("\(draft.type.rawValue)://user:pass@localhost:\(draft.type.defaultPort ?? 5432)/mydb", text: Binding(
                                    get: { draft.connectionUri ?? "" },
                                    set: { newValue in
                                        draft.connectionUri = newValue
                                        handleURIChange(newValue)
                                    }
                                ))
                                .textFieldStyle(.roundedBorder)
                                .font(.system(size: 12, design: .monospaced))
                            }
                        } else {
                            HStack(spacing: 10) {
                                VStack(alignment: .leading, spacing: 4) {
                                    Text("Host")
                                        .font(.caption.weight(.semibold))
                                    TextField("localhost (or paste any DB URI)", text: Binding(
                                        get: { draft.host ?? "" },
                                        set: { newValue in
                                            handleHostChange(newValue)
                                        }
                                    ))
                                    .textFieldStyle(.roundedBorder)
                                }

                                VStack(alignment: .leading, spacing: 4) {
                                    Text("Port")
                                        .font(.caption.weight(.semibold))
                                    TextField("\(draft.type.defaultPort ?? 5432)", value: Binding(
                                        get: { draft.port },
                                        set: { newPort in
                                            draft.port = newPort
                                            if let newPort, let detected = DatabaseEngineDetector.detect(fromPort: newPort),
                                               detected.engine.isSupportedNatively,
                                               detected.engine != draft.type {
                                                applyDetection(detected, keepPort: newPort)
                                            }
                                        }
                                    ), format: .number)
                                    .textFieldStyle(.roundedBorder)
                                    .frame(width: 90)
                                }
                            }

                            HStack(spacing: 10) {
                                VStack(alignment: .leading, spacing: 4) {
                                    Text(draft.type == .influxdb ? "Organization" : "Username")
                                        .font(.caption.weight(.semibold))
                                    TextField(draft.type.defaultUser, text: Binding(
                                        get: { draft.user ?? "" },
                                        set: { draft.user = $0 }
                                    ))
                                    .textFieldStyle(.roundedBorder)
                                }

                                VStack(alignment: .leading, spacing: 4) {
                                    Text(draft.type == .influxdb ? "API Token (stored in Keychain)" : "Password (stored in Keychain)")
                                        .font(.caption.weight(.semibold))
                                    SecureField("••••••••", text: Binding(
                                        get: { draft.password ?? "" },
                                        set: { draft.password = $0 }
                                    ))
                                    .textFieldStyle(.roundedBorder)
                                }
                            }

                            HStack(spacing: 10) {
                                VStack(alignment: .leading, spacing: 4) {
                                    Text(draft.type == .influxdb ? "Default Bucket" : (draft.type == .redis ? "Database Index (0-15)" : "Default Database"))
                                        .font(.caption.weight(.semibold))
                                    TextField(draft.type == .redis ? "0" : (draft.type == .postgres ? "postgres" : ""), text: Binding(
                                        get: { draft.database ?? "" },
                                        set: { draft.database = $0 }
                                    ))
                                    .textFieldStyle(.roundedBorder)
                                }

                                Toggle("Use SSL / TLS", isOn: Binding(
                                    get: { draft.ssl ?? false },
                                    set: { draft.ssl = $0 }
                                ))
                                .padding(.top, 18)
                            }
                        }
                    }

                    if let feedback = testFeedback {
                        HStack(spacing: 6) {
                            Image(systemName: testSucceeded ? "checkmark.seal.fill" : "xmark.octagon.fill")
                                .foregroundStyle(testSucceeded ? GlassTheme.success : GlassTheme.danger)
                            Text(feedback)
                                .font(.caption)
                                .foregroundStyle(testSucceeded ? GlassTheme.success : GlassTheme.danger)
                        }
                        .padding(8)
                        .frame(maxWidth: .infinity, alignment: .leading)
                        .background((testSucceeded ? GlassTheme.success : GlassTheme.danger).opacity(0.12), in: RoundedRectangle(cornerRadius: 8))
                    }
                }
            }

            Divider()

            HStack {
                Button {
                    isDetecting = true
                    testFeedback = nil
                    let configToProbe = sanitizedDraft()
                    Task {
                        if let detected = await DatabaseEngineDetector.probe(config: configToProbe) {
                            if detected.engine.isSupportedNatively {
                                applyDetection(detected)
                                testSucceeded = true
                                testFeedback = "Auto-recognized \(detected.engine.displayName) — \(detected.detail)"
                            } else {
                                testSucceeded = false
                                testFeedback = "Detected \(detected.engine.displayName) (\(detected.detail)), which is supported in the Electron edition."
                            }
                        } else {
                            testSucceeded = false
                            testFeedback = "Could not automatically identify the database engine at this endpoint."
                        }
                        isDetecting = false
                    }
                } label: {
                    if isDetecting {
                        ProgressView().controlSize(.small)
                    } else {
                        Label("Auto-Detect Engine", systemImage: "sparkles")
                    }
                }
                .disabled(isDetecting || isTesting)
                .help("Probe the target endpoint or URI to automatically select the right database engine & configuration")

                Button {
                    isTesting = true
                    testFeedback = nil
                    let configToTest = sanitizedDraft()
                    Task {
                        do {
                            let outcome = try await ConnectionManager.testWithDetection(configToTest)
                            if outcome.detectedType != draft.type && outcome.detectedType.isSupportedNatively {
                                draft = outcome.resolvedConfig
                                detectionBanner = outcome.detectionDetail ?? "Auto-recognized \(outcome.detectedType.displayName)"
                            }
                            testSucceeded = true
                            testFeedback = outcome.detectedType != configToTest.type
                                ? "Auto-recognized \(outcome.detectedType.displayName) & connected — \(outcome.serverVersion)"
                                : "Connected — \(outcome.serverVersion)"
                        } catch {
                            testSucceeded = false
                            testFeedback = error.localizedDescription
                        }
                        isTesting = false
                    }
                } label: {
                    if isTesting {
                        ProgressView().controlSize(.small)
                    } else {
                        Label("Test Connection", systemImage: "bolt.horizontal.circle")
                    }
                }
                .disabled(isTesting || isDetecting)

                Spacer()

                Button("Cancel") { dismiss() }
                    .keyboardShortcut(.cancelAction)

                Button("Save & Connect") {
                    let finalConfig = sanitizedDraft()
                    state.saveConnection(finalConfig)
                    dismiss()
                    Task { await state.connect(finalConfig) }
                }
                .buttonStyle(.borderedProminent)
                .tint(GlassTheme.accent)
                .keyboardShortcut(.defaultAction)
            }
        }
        .padding(18)
        .frame(width: 660, height: 610)
    }

    private func applyEngineSelection(_ dbType: DatabaseType) {
        let prev = draft.type
        draft.type = dbType
        draft.port = dbType.defaultPort
        let trimmedUser = (draft.user ?? "").trimmingCharacters(in: .whitespacesAndNewlines)
        if trimmedUser.isEmpty || trimmedUser == prev.defaultUser {
            draft.user = dbType.defaultUser.isEmpty ? nil : dbType.defaultUser
        }
        if prev == .postgres && draft.database == "postgres" && dbType != .postgres {
            draft.database = dbType == .redis ? "0" : nil
        } else if dbType == .redis && (draft.database ?? "").isEmpty {
            draft.database = "0"
        }
        updateDefaultNameIfAuto(previous: prev, next: dbType)
        testFeedback = nil
    }

    private func handleURIChange(_ rawURI: String) {
        guard let detected = DatabaseEngineDetector.detect(fromURI: rawURI) else { return }
        if detected.engine.isSupportedNatively {
            applyDetection(detected)
        } else {
            detectionBanner = "Detected \(detected.engine.displayName) (Electron edition)"
        }
    }

    private func handleHostChange(_ newValue: String) {
        let trimmed = newValue.trimmingCharacters(in: .whitespacesAndNewlines)
        // If user pastes a full connection URI into Host, automatically switch to URI mode & detect engine
        if trimmed.contains("://"), let detected = DatabaseEngineDetector.detect(fromURI: trimmed) {
            if detected.engine == .sqlite, let fp = detected.filePath {
                draft.filename = fp
                draft.connectionUri = nil
                useURI = false
                applyDetection(detected)
                return
            }
            if detected.engine.isSupportedNatively {
                draft.connectionUri = trimmed
                useURI = true
                applyDetection(detected)
                return
            }
        }

        // If user pastes a local SQLite file path into Host
        if (trimmed.hasPrefix("/") || trimmed.hasPrefix("~/")),
           let detected = DatabaseEngineDetector.detect(fromFilePath: trimmed) {
            draft.filename = detected.filePath ?? trimmed
            useURI = false
            applyDetection(detected)
            return
        }

        draft.host = newValue
        if let detected = DatabaseEngineDetector.detect(fromHostname: trimmed),
           detected.engine.isSupportedNatively {
            applyDetection(detected)
        }
    }

    private func applyDetection(_ detected: EngineDetectionResult, keepPort: Int? = nil) {
        let prev = draft.type
        var updated = draft.applyingDetection(detected)
        if let keepPort {
            updated.port = keepPort
        }
        if detected.engine == .sqlite {
            useURI = false
        }
        draft = updated
        updateDefaultNameIfAuto(previous: prev, next: detected.engine)
        detectionBanner = detected.detail
        testFeedback = nil
    }

    private func updateDefaultNameIfAuto(previous: DatabaseType, next: DatabaseType) {
        guard previous != next else { return }
        let trimmed = draft.name.trimmingCharacters(in: .whitespacesAndNewlines)
        if trimmed.isEmpty || trimmed == "Local \(previous.displayName)" {
            draft.name = "Local \(next.displayName)"
        }
    }

    private func sanitizedDraft() -> ConnectionConfig {
        var copy = draft
        if copy.name.trimmingCharacters(in: .whitespaces).isEmpty {
            copy.name = "\(copy.type.displayName) (\(copy.host ?? "local"))"
        }
        if !useURI {
            copy.connectionUri = nil
        }
        return copy
    }
}
