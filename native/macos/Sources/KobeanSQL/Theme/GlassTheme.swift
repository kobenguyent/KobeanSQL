import AppKit
import SwiftUI
import KobeanSQLCore

enum GlassTheme {
    static let accent = Color(red: 0.482, green: 0.482, blue: 0.918) // #7b7bea
    static let accentBright = Color(red: 0.596, green: 0.596, blue: 0.949) // #9898f2
    static let success = Color(red: 0.290, green: 0.871, blue: 0.502) // #4ade80
    static let warning = Color(red: 0.984, green: 0.749, blue: 0.141) // #fbbf24
    static let danger = Color(red: 0.973, green: 0.443, blue: 0.443) // #f87171

    static func color(for db: DatabaseType) -> Color {
        switch db {
        case .mysql: Color(red: 0.976, green: 0.451, blue: 0.086)
        case .mariadb: Color(red: 0.753, green: 0.518, blue: 0.988)
        case .postgres, .cockroachdb: Color(red: 0.376, green: 0.647, blue: 0.980)
        case .sqlite: Color(red: 0.290, green: 0.871, blue: 0.502)
        case .redis: Color(red: 0.973, green: 0.443, blue: 0.443)
        case .clickhouse: Color(red: 0.984, green: 0.749, blue: 0.141)
        case .elasticsearch: Color(red: 0.133, green: 0.827, blue: 0.933)
        case .neo4j: Color(red: 0.220, green: 0.741, blue: 0.973)
        case .influxdb: Color(red: 0.659, green: 0.333, blue: 0.969)
        default: accent
        }
    }

    static func color(hex: String?) -> Color? {
        guard let hex = hex?.trimmingCharacters(in: CharacterSet.alphanumerics.inverted),
              hex.count == 6, let val = UInt64(hex, radix: 16) else { return nil }
        return Color(
            red: Double((val >> 16) & 0xFF) / 255.0,
            green: Double((val >> 8) & 0xFF) / 255.0,
            blue: Double(val & 0xFF) / 255.0
        )
    }
}

/// AppKit `NSVisualEffectView` wrapper for authentic macOS desktop vibrancy.
struct VisualEffectBackground: NSViewRepresentable {
    var material: NSVisualEffectView.Material = .sidebar
    var blendingMode: NSVisualEffectView.BlendingMode = .behindWindow

    func makeNSView(context: Context) -> NSVisualEffectView {
        let v = NSVisualEffectView()
        v.material = material
        v.blendingMode = blendingMode
        v.state = .active
        return v
    }

    func updateNSView(_ nsView: NSVisualEffectView, context: Context) {
        nsView.material = material
        nsView.blendingMode = blendingMode
    }
}
