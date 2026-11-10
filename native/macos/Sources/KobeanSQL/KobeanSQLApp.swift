import AppKit
import SwiftUI
import KobeanSQLCore

@main
enum KobeanSQLEntrypoint {
    static func main() {
        if CommandLine.arguments.contains("--self-test") {
            Task.detached {
                do {
                    try await SelfTestSuite.runAll()
                    print("PASS: All KobeanSQL native self-tests succeeded.")
                    Foundation.exit(0)
                } catch {
                    FileHandle.standardError.write(Data("FAIL: \(error.localizedDescription)\n".utf8))
                    Foundation.exit(1)
                }
            }
            dispatchMain()
        }
        KobeanSQLNativeApp.main()
    }
}

struct KobeanSQLNativeApp: App {
    @State private var state = AppState()

    init() {
        NSApplication.shared.setActivationPolicy(.regular)
        NSApplication.shared.activate(ignoringOtherApps: true)
    }

    var body: some Scene {
        WindowGroup("KobeanSQL") {
            MainWindowView(state: state)
                .frame(minWidth: 980, minHeight: 640)
        }
        .windowStyle(.titleBar)
        .windowToolbarStyle(.unified(showsTitle: true))
        .commands {
            CommandGroup(replacing: .newItem) {
                Button("New Query Tab") {
                    state.newTab()
                }
                .keyboardShortcut("t", modifiers: [.command])

                Button("New Database Connection…") {
                    state.editingConnection = nil
                    state.showingConnectionSheet = true
                }
                .keyboardShortcut("n", modifiers: [.command])

                Divider()

                Menu("Open Built-in Demo Database") {
                    Button("Load All 8 Demo Databases") {
                        Task { await state.loadAllDemoDatabases() }
                    }
                    .keyboardShortcut("d", modifiers: [.command, .shift])
                    Divider()
                    ForEach(DemoDatabaseCatalog.presets) { preset in
                        Button(preset.name) {
                            Task { await state.openOrCreateDemoDatabase(type: preset.type) }
                        }
                    }
                }

                Button("Import Connections from Electron App") {
                    state.importElectronConnections()
                }
            }

            CommandMenu("Query") {
                Button("Run Query") {
                    Task { await state.runActiveQuery() }
                }
                .keyboardShortcut(.return, modifiers: [.command])

                Button("Query History…") {
                    state.showingHistorySheet = true
                }
                .keyboardShortcut("y", modifiers: [.command])

                Divider()

                Button("Settings…") {
                    state.showingSettingsSheet = true
                }
                .keyboardShortcut(",", modifiers: [.command])
            }
        }
    }
}
