import Foundation

/// JSON persistence under `~/Library/Application Support/KobeanSQL Native/`.
/// Kept separate from the Electron app's `kobeansql` folder so both can be installed side by side.
public struct AppStorage: Sendable {
    public let directory: URL

    public init(directory: URL? = nil) {
        if let directory {
            self.directory = directory
        } else {
            let base = FileManager.default.urls(for: .applicationSupportDirectory, in: .userDomainMask)[0]
            self.directory = base.appendingPathComponent("KobeanSQL Native", isDirectory: true)
        }
    }

    private struct ConnectionsFile: Codable {
        var version: Int
        var connections: [ConnectionConfig]
    }

    private var connectionsURL: URL { directory.appendingPathComponent("connections.json") }
    private var historyURL: URL { directory.appendingPathComponent("history.json") }
    private var savedQueriesURL: URL { directory.appendingPathComponent("saved-queries.json") }
    private var settingsURL: URL { directory.appendingPathComponent("settings.json") }

    // MARK: Connections

    public func loadConnections() -> [ConnectionConfig] {
        guard let data = try? Data(contentsOf: connectionsURL),
              let file = try? JSONDecoder().decode(ConnectionsFile.self, from: data) else { return [] }
        return file.connections
    }

    public func saveConnections(_ connections: [ConnectionConfig]) throws {
        try FileManager.default.createDirectory(at: directory, withIntermediateDirectories: true)
        let file = ConnectionsFile(version: 1, connections: connections.map(\.withoutSecrets))
        let encoder = JSONEncoder()
        encoder.outputFormatting = [.prettyPrinted, .sortedKeys]
        try encoder.encode(file).write(to: connectionsURL, options: .atomic)
    }

    // MARK: Saved Queries

    public func loadSavedQueries() -> [SavedQuery] {
        guard let data = try? Data(contentsOf: savedQueriesURL),
              let items = try? JSONDecoder().decode([SavedQuery].self, from: data) else { return [] }
        return items
    }

    public func saveSavedQueries(_ queries: [SavedQuery]) throws {
        try FileManager.default.createDirectory(at: directory, withIntermediateDirectories: true)
        let encoder = JSONEncoder()
        encoder.outputFormatting = [.prettyPrinted, .sortedKeys]
        try encoder.encode(queries).write(to: savedQueriesURL, options: .atomic)
    }

    // MARK: Settings

    public func loadSettings() -> NativeAppSettings {
        guard let data = try? Data(contentsOf: settingsURL),
              let s = try? JSONDecoder().decode(NativeAppSettings.self, from: data) else {
            return NativeAppSettings()
        }
        return s
    }

    public func saveSettings(_ settings: NativeAppSettings) throws {
        try FileManager.default.createDirectory(at: directory, withIntermediateDirectories: true)
        let encoder = JSONEncoder()
        encoder.outputFormatting = [.prettyPrinted, .sortedKeys]
        try encoder.encode(settings).write(to: settingsURL, options: .atomic)
    }

    // MARK: History

    public func loadHistory() -> [HistoryEntry] {
        guard let data = try? Data(contentsOf: historyURL) else { return [] }
        let decoder = JSONDecoder()
        decoder.dateDecodingStrategy = .iso8601
        return (try? decoder.decode([HistoryEntry].self, from: data)) ?? []
    }

    public func saveHistory(_ entries: [HistoryEntry]) throws {
        try FileManager.default.createDirectory(at: directory, withIntermediateDirectories: true)
        let encoder = JSONEncoder()
        encoder.dateEncodingStrategy = .iso8601
        try encoder.encode(Array(entries.prefix(HistoryEntry.maxEntries))).write(to: historyURL, options: .atomic)
    }

    // MARK: Electron import

    /// Location of the Electron app's saved connections.
    public static var electronConnectionsURL: URL {
        FileManager.default.urls(for: .applicationSupportDirectory, in: .userDomainMask)[0]
            .appendingPathComponent("kobeansql/connections.json")
    }

    /// Reads connections from the Electron app. Passwords are encrypted with Electron's
    /// safeStorage key and are intentionally not imported — users re-enter them once.
    public static func importElectronConnections(from url: URL = electronConnectionsURL) throws -> [ConnectionConfig] {
        let data = try Data(contentsOf: url)
        let json = try JSONSerialization.jsonObject(with: data)
        let items: [Any]
        if let dict = json as? [String: Any] {
            items = (dict["connections"] as? [Any]) ?? (dict["data"] as? [Any]) ?? []
        } else {
            items = json as? [Any] ?? []
        }
        return items.compactMap { item -> ConnectionConfig? in
            guard var obj = item as? [String: Any] else { return nil }
            obj["password"] = nil
            guard let itemData = try? JSONSerialization.data(withJSONObject: obj) else { return nil }
            return try? JSONDecoder().decode(ConnectionConfig.self, from: itemData)
        }
    }
}

public struct SavedQuery: Codable, Identifiable, Hashable, Sendable {
    public var id: String
    public var name: String
    public var sql: String
    public var category: String?
    public var createdAt: Date

    public init(id: String = UUID().uuidString, name: String, sql: String, category: String? = nil, createdAt: Date = Date()) {
        self.id = id
        self.name = name
        self.sql = sql
        self.category = category
        self.createdAt = createdAt
    }
}

public struct NativeAppSettings: Codable, Hashable, Sendable {
    public enum AppearanceMode: String, Codable, CaseIterable, Identifiable, Sendable {
        case dark, light, system
        public var id: String { rawValue }
        public var label: String {
            switch self {
            case .dark: "Dark Glass"
            case .light: "Light Glass"
            case .system: "Follow macOS"
            }
        }
    }

    public var queryLimit: Int
    public var autoLimitEnabled: Bool
    public var readOnlyMode: Bool
    public var confirmDestructiveQueries: Bool
    public var queryTimeoutSeconds: Int
    public var appearance: AppearanceMode
    public var ai: AISettings
    public var updates: UpdateSettings

    public init(
        queryLimit: Int = 100,
        autoLimitEnabled: Bool = true,
        readOnlyMode: Bool = false,
        confirmDestructiveQueries: Bool = true,
        queryTimeoutSeconds: Int = 30,
        appearance: AppearanceMode = .dark,
        ai: AISettings = AISettings(),
        updates: UpdateSettings = UpdateSettings()
    ) {
        self.queryLimit = min(max(queryLimit, 1), 10_000)
        self.autoLimitEnabled = autoLimitEnabled
        self.readOnlyMode = readOnlyMode
        self.confirmDestructiveQueries = confirmDestructiveQueries
        self.queryTimeoutSeconds = min(max(queryTimeoutSeconds, 5), 120)
        self.appearance = appearance
        self.ai = ai
        self.updates = updates
    }

    public init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        self.queryLimit = min(max((try? c.decode(Int.self, forKey: .queryLimit)) ?? 100, 1), 10_000)
        self.autoLimitEnabled = (try? c.decode(Bool.self, forKey: .autoLimitEnabled)) ?? true
        self.readOnlyMode = (try? c.decode(Bool.self, forKey: .readOnlyMode)) ?? false
        self.confirmDestructiveQueries = (try? c.decode(Bool.self, forKey: .confirmDestructiveQueries)) ?? true
        self.queryTimeoutSeconds = min(max((try? c.decode(Int.self, forKey: .queryTimeoutSeconds)) ?? 30, 5), 120)
        self.appearance = (try? c.decode(AppearanceMode.self, forKey: .appearance)) ?? .dark
        self.ai = (try? c.decode(AISettings.self, forKey: .ai)) ?? AISettings()
        self.updates = (try? c.decode(UpdateSettings.self, forKey: .updates)) ?? UpdateSettings()
    }
}

public struct HistoryEntry: Codable, Identifiable, Hashable, Sendable {
    public static let maxEntries = 500
    public var id: UUID
    public var connectionID: String
    public var connectionName: String
    public var database: String?
    public var query: String
    public var date: Date
    public var duration: TimeInterval
    public var rowCount: Int
    public var error: String?

    public init(connectionID: String, connectionName: String, database: String?, query: String,
                duration: TimeInterval, rowCount: Int, error: String?) {
        self.id = UUID()
        self.connectionID = connectionID
        self.connectionName = connectionName
        self.database = database
        self.query = query
        self.date = Date()
        self.duration = duration
        self.rowCount = rowCount
        self.error = error
    }
}
