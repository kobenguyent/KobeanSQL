import AppKit
import SwiftUI
import KobeanSQLCore

enum GlassTheme {
    static let accent = Color(red: 0.482, green: 0.482, blue: 0.918) // #7b7bea
    static let accentBright = Color(red: 0.596, green: 0.596, blue: 0.949) // #9898f2
    static let cyanGlow = Color(red: 0.220, green: 0.741, blue: 0.973) // #38bdf8
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

    /// Directional specular light rim that catches top-left light like real curved glass.
    static func specularRimGradient(for scheme: ColorScheme, tint: Color? = nil, emphasis: Bool = false) -> LinearGradient {
        let topLead: Color
        let mid: Color
        let bottomTrail: Color
        if scheme == .dark {
            topLead = (tint ?? .white).opacity(emphasis ? 0.65 : 0.36)
            mid = Color.white.opacity(emphasis ? 0.18 : 0.10)
            bottomTrail = (tint ?? .white).opacity(emphasis ? 0.30 : 0.14)
        } else {
            topLead = Color.white.opacity(emphasis ? 0.95 : 0.85)
            mid = (tint ?? Color.black).opacity(emphasis ? 0.22 : 0.08)
            bottomTrail = (tint ?? Color.white).opacity(emphasis ? 0.35 : 0.45)
        }
        return LinearGradient(
            colors: [topLead, mid, bottomTrail],
            startPoint: .topLeading,
            endPoint: .bottomTrailing
        )
    }

    /// Soft optical sheen across the upper glass surface.
    static func innerSheenGradient(for scheme: ColorScheme) -> LinearGradient {
        if scheme == .dark {
            return LinearGradient(
                colors: [Color.white.opacity(0.14), Color.white.opacity(0.03), Color.clear],
                startPoint: .top,
                endPoint: .bottom
            )
        } else {
            return LinearGradient(
                colors: [Color.white.opacity(0.55), Color.white.opacity(0.12), Color.clear],
                startPoint: .top,
                endPoint: .bottom
            )
        }
    }
}

/// Visual intensity for Liquid Glass surfaces.
enum LiquidGlassStyleVariant: Sendable {
    case regular
    case clear
    case subtle
    case prominent
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

/// Subtle atmospheric canvas behind the main window so floating Liquid Glass controls
/// have soft optical light and depth to refract without reducing SQL/table legibility.
struct LiquidGlassAmbientBackground: View {
    @Environment(\.colorScheme) private var colorScheme
    var accentTint: Color = GlassTheme.accent

    var body: some View {
        ZStack {
            VisualEffectBackground(material: .underWindowBackground, blendingMode: .behindWindow)

            // Soft refractive light pools in corners
            RadialGradient(
                colors: [
                    accentTint.opacity(colorScheme == .dark ? 0.16 : 0.10),
                    Color.clear
                ],
                center: .topLeading,
                startRadius: 20,
                endRadius: 560
            )
            .allowsHitTesting(false)

            RadialGradient(
                colors: [
                    GlassTheme.cyanGlow.opacity(colorScheme == .dark ? 0.10 : 0.07),
                    Color.clear
                ],
                center: .bottomTrailing,
                startRadius: 20,
                endRadius: 520
            )
            .allowsHitTesting(false)
        }
        .ignoresSafeArea()
    }
}

/// Wraps neighboring Liquid Glass controls in Apple's native `GlassEffectContainer` on macOS 26+
/// so sibling pills, tabs, and buttons share fluid optical morphing and refraction.
struct LiquidGlassContainer<Content: View>: View {
    var spacing: CGFloat
    @ViewBuilder var content: () -> Content

    init(spacing: CGFloat = 10, @ViewBuilder content: @escaping () -> Content) {
        self.spacing = spacing
        self.content = content
    }

    var body: some View {
        #if compiler(>=6.2)
        if #available(macOS 26.0, *) {
            GlassEffectContainer(spacing: spacing) {
                content()
            }
        } else {
            content()
        }
        #else
        content()
        #endif
    }
}

/// Unified Liquid Glass surface modifier:
/// - On macOS 26+ (Tahoe), renders native Apple `.glassEffect(...)` with optional tint & interactivity.
/// - On macOS 14–15, renders a high-craft specular multi-layer glass fallback with vibrancy, top sheen,
///   directional rim highlight, and soft elevation shadow.
private struct LiquidGlassSurfaceModifier<S: InsettableShape>: ViewModifier {
    @Environment(\.colorScheme) private var colorScheme
    let shape: S
    let variant: LiquidGlassStyleVariant
    let tint: Color?
    let interactive: Bool
    let isEmphasized: Bool

    func body(content: Content) -> some View {
        #if compiler(>=6.2)
        if #available(macOS 26.0, *) {
            let baseGlass: Glass = (variant == .clear || variant == .subtle) ? .clear : .regular
            let tintedGlass: Glass = {
                if let tint {
                    let opacity: Double
                    switch variant {
                    case .prominent: opacity = 0.28
                    case .regular: opacity = isEmphasized ? 0.22 : 0.12
                    case .clear: opacity = isEmphasized ? 0.18 : 0.10
                    case .subtle: opacity = isEmphasized ? 0.14 : 0.07
                    }
                    return baseGlass.tint(tint.opacity(opacity))
                }
                return baseGlass
            }()
            let finalGlass = interactive ? tintedGlass.interactive(true) : tintedGlass

            content
                .glassEffect(finalGlass, in: shape)
                .overlay {
                    if isEmphasized {
                        shape
                            .strokeBorder(
                                GlassTheme.specularRimGradient(for: colorScheme, tint: tint, emphasis: true),
                                lineWidth: 1.0
                            )
                            .allowsHitTesting(false)
                    }
                }
        } else {
            fallbackGlass(content)
        }
        #else
        fallbackGlass(content)
        #endif
    }

    @ViewBuilder
    private func fallbackGlass(_ content: Content) -> some View {
        let material: Material = {
            switch variant {
            case .prominent: .regularMaterial
            case .regular: .thinMaterial
            case .clear, .subtle: .ultraThinMaterial
            }
        }()

        let tintOpacity: Double = {
            switch variant {
            case .prominent: colorScheme == .dark ? 0.24 : 0.16
            case .regular: isEmphasized ? 0.20 : 0.10
            case .clear: isEmphasized ? 0.16 : 0.07
            case .subtle: isEmphasized ? 0.12 : 0.05
            }
        }()

        content
            .background {
                ZStack {
                    shape.fill(material)
                    if let tint {
                        shape.fill(tint.opacity(tintOpacity))
                    }
                    shape.fill(GlassTheme.innerSheenGradient(for: colorScheme))
                }
            }
            .overlay {
                shape
                    .strokeBorder(
                        GlassTheme.specularRimGradient(for: colorScheme, tint: tint, emphasis: isEmphasized),
                        lineWidth: isEmphasized ? 1.25 : 0.8
                    )
                    .allowsHitTesting(false)
            }
            .shadow(
                color: Color.black.opacity(colorScheme == .dark ? (variant == .subtle ? 0.16 : 0.28) : 0.08),
                radius: variant == .subtle ? 4 : 10,
                x: 0,
                y: variant == .subtle ? 1 : 4
            )
    }
}

/// Specular interactive Liquid Glass button style for macOS 14–15 fallback.
struct SpecularLiquidGlassButtonStyle: ButtonStyle {
    @Environment(\.colorScheme) private var colorScheme
    @Environment(\.isEnabled) private var isEnabled
    var prominent: Bool = false
    var tint: Color = GlassTheme.accent
    var cornerRadius: CGFloat = 10

    func makeBody(configuration: Configuration) -> some View {
        let shape = RoundedRectangle(cornerRadius: cornerRadius, style: .continuous)
        configuration.label
            .padding(.horizontal, 10)
            .padding(.vertical, 5)
            .foregroundStyle(prominent ? Color.white : Color.primary)
            .background {
                ZStack {
                    shape.fill(prominent ? AnyShapeStyle(tint.gradient) : AnyShapeStyle(.ultraThinMaterial))
                    if !prominent {
                        shape.fill(tint.opacity(configuration.isPressed ? 0.22 : 0.08))
                    }
                    shape.fill(GlassTheme.innerSheenGradient(for: colorScheme))
                }
            }
            .overlay {
                shape
                    .strokeBorder(
                        GlassTheme.specularRimGradient(for: colorScheme, tint: prominent ? .white : tint, emphasis: prominent || configuration.isPressed),
                        lineWidth: prominent ? 1.0 : 0.85
                    )
            }
            .shadow(
                color: (prominent ? tint : Color.black).opacity(prominent ? 0.30 : 0.14),
                radius: configuration.isPressed ? 2 : 6,
                x: 0,
                y: configuration.isPressed ? 1 : 2
            )
            .scaleEffect(configuration.isPressed ? 0.97 : 1.0)
            .opacity(isEnabled ? 1.0 : 0.45)
            .animation(.spring(response: 0.22, dampingFraction: 0.72), value: configuration.isPressed)
    }
}

/// Applies native macOS 26 `.buttonStyle(.glass)` / `.buttonStyle(.glassProminent)` with
/// automatic fallback to `SpecularLiquidGlassButtonStyle` on macOS 14–15.
private struct LiquidGlassButtonModifier: ViewModifier {
    let prominent: Bool
    let tint: Color?

    func body(content: Content) -> some View {
        #if compiler(>=6.2)
        if #available(macOS 26.0, *) {
            if prominent {
                content
                    .buttonStyle(.glassProminent)
                    .tint(tint ?? GlassTheme.accent)
            } else {
                content
                    .buttonStyle(.glass)
                    .tint(tint)
            }
        } else {
            content.buttonStyle(SpecularLiquidGlassButtonStyle(prominent: prominent, tint: tint ?? GlassTheme.accent))
        }
        #else
        content.buttonStyle(SpecularLiquidGlassButtonStyle(prominent: prominent, tint: tint ?? GlassTheme.accent))
        #endif
    }
}

/// Modal sheet glass container with frosted vibrancy, subtle ambient glow, and crisp rim.
private struct LiquidGlassSheetModifier: ViewModifier {
    @Environment(\.colorScheme) private var colorScheme
    let accentTint: Color

    func body(content: Content) -> some View {
        content
            .background {
                ZStack {
                    VisualEffectBackground(material: .hudWindow, blendingMode: .behindWindow)
                    RadialGradient(
                        colors: [
                            accentTint.opacity(colorScheme == .dark ? 0.14 : 0.08),
                            Color.clear
                        ],
                        center: .topTrailing,
                        startRadius: 10,
                        endRadius: 420
                    )
                    .allowsHitTesting(false)
                }
            }
    }
}

extension View {
    /// Applies Liquid Glass styling with an explicit `InsettableShape`.
    func liquidGlass<S: InsettableShape>(
        _ variant: LiquidGlassStyleVariant = .regular,
        tint: Color? = nil,
        interactive: Bool = false,
        emphasized: Bool = false,
        in shape: S
    ) -> some View {
        modifier(LiquidGlassSurfaceModifier(
            shape: shape,
            variant: variant,
            tint: tint,
            interactive: interactive,
            isEmphasized: emphasized
        ))
    }

    /// Floating Liquid Glass pill (`Capsule`) for badges, status chips, and compact controls.
    func liquidGlassPill(
        tint: Color? = nil,
        interactive: Bool = false,
        emphasized: Bool = false
    ) -> some View {
        liquidGlass(.clear, tint: tint, interactive: interactive, emphasized: emphasized, in: Capsule())
    }

    /// Floating Liquid Glass rail/toolbar surface.
    func liquidGlassBar(
        cornerRadius: CGFloat = 14,
        tint: Color? = nil
    ) -> some View {
        liquidGlass(.regular, tint: tint, interactive: false, emphasized: false, in: RoundedRectangle(cornerRadius: cornerRadius, style: .continuous))
    }

    /// Liquid Glass card surface for sidebar items, engine tiles, SQL previews, and info panels.
    func liquidGlassCard(
        cornerRadius: CGFloat = 12,
        tint: Color? = nil,
        isSelected: Bool = false,
        interactive: Bool = false
    ) -> some View {
        liquidGlass(
            isSelected ? .regular : .subtle,
            tint: tint,
            interactive: interactive,
            emphasized: isSelected,
            in: RoundedRectangle(cornerRadius: cornerRadius, style: .continuous)
        )
    }

    /// Native macOS 26 `.glass` / `.glassProminent` button style with specular fallback on macOS 14–15.
    func liquidGlassButton(prominent: Bool = false, tint: Color? = nil) -> some View {
        modifier(LiquidGlassButtonModifier(prominent: prominent, tint: tint))
    }

    /// Frosted Liquid Glass backdrop for modal sheets and popovers.
    func liquidGlassSheet(accentTint: Color = GlassTheme.accent) -> some View {
        modifier(LiquidGlassSheetModifier(accentTint: accentTint))
    }
}
