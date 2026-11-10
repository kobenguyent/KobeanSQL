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
    @State private var testFeedback: String?
    @State private var testSucceeded = false

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
                        Text("Database Engine")
                            .font(.caption.weight(.semibold))
                            .foregroundStyle(.secondary)

                        ForEach(DatabaseCategory.allCases, id: \.rawValue) { category in
                            VStack(alignment: .leading, spacing: 4) {
                                Text(category.label.uppercased())
                                    .font(.system(size: 9, weight: .bold))
                                    .foregroundStyle(.tertiary)
                                LazyVGrid(columns: [GridItem(.adaptive(minimum: 112), spacing: 6)], spacing: 6) {
                                    ForEach(category.types) { dbType in
                                        let selected = draft.type == dbType
                                        Button {
                                            draft.type = dbType
                                            draft.port = dbType.defaultPort
                                            if (draft.user ?? "").isEmpty {
                                                draft.user = dbType.defaultUser
                                            }
                                            testFeedback = nil
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
                                    set: { draft.filename = $0 }
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
                                    }
                                }
                            }
                        }
                    } else {
                        Toggle("Connect using Connection URI", isOn: $useURI)
                            .toggleStyle(.switch)
                            .controlSize(.small)

                        if useURI {
                            VStack(alignment: .leading, spacing: 4) {
                                Text("Connection URI")
                                    .font(.caption.weight(.semibold))
                                TextField("\(draft.type.rawValue)://user:pass@localhost:\(draft.type.defaultPort ?? 5432)/mydb", text: Binding(
                                    get: { draft.connectionUri ?? "" },
                                    set: { draft.connectionUri = $0 }
                                ))
                                .textFieldStyle(.roundedBorder)
                                .font(.system(size: 12, design: .monospaced))
                            }
                        } else {
                            HStack(spacing: 10) {
                                VStack(alignment: .leading, spacing: 4) {
                                    Text("Host")
                                        .font(.caption.weight(.semibold))
                                    TextField("localhost", text: Binding(
                                        get: { draft.host ?? "" },
                                        set: { draft.host = $0 }
                                    ))
                                    .textFieldStyle(.roundedBorder)
                                }

                                VStack(alignment: .leading, spacing: 4) {
                                    Text("Port")
                                        .font(.caption.weight(.semibold))
                                    TextField("\(draft.type.defaultPort ?? 5432)", value: $draft.port, format: .number)
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
                                    TextField(draft.type == .redis ? "0" : "postgres", text: Binding(
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
                    isTesting = true
                    testFeedback = nil
                    let configToTest = sanitizedDraft()
                    Task {
                        do {
                            let version = try await ConnectionManager.test(configToTest)
                            testSucceeded = true
                            testFeedback = "Connected — \(version)"
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
                .disabled(isTesting)

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
        .frame(width: 640, height: 590)
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
