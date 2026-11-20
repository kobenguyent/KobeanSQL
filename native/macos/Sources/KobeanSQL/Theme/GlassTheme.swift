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
        v.state = .followsWindowActiveState
        return v
    }

    func updateNSView(_ nsView: NSVisualEffectView, context: Context) {
        if nsView.material != material {
            nsView.material = material
        }
        if nsView.blendingMode != blendingMode {
            nsView.blendingMode = blendingMode
        }
    }
}

/// Subtle atmospheric canvas behind the main window so floating Liquid Glass controls
/// have soft optical light and depth to refract without reducing SQL/table legibility.
/// Corner glow orbs are fixed-size pre-rasterized sprites so Metal never reallocates
/// offscreen textures during sidebar toggle or live window resizing.
struct LiquidGlassAmbientBackground: View {
    @Environment(\.colorScheme) private var colorScheme
    var accentTint: Color = GlassTheme.accent

    var body: some View {
        ZStack {
            VisualEffectBackground(material: .underWindowBackground, blendingMode: .behindWindow)

            Color.clear
                .overlay(alignment: .topLeading) {
                    Circle()
                        .fill(
                            RadialGradient(
                                colors: [
                                    accentTint.opacity(colorScheme == .dark ? 0.14 : 0.08),
                                    Color.clear
                                ],
                                center: .center,
                                startRadius: 10,
                                endRadius: 280
                            )
                        )
                        .frame(width: 560, height: 560)
                        .drawingGroup(opaque: false)
                        .offset(x: -180, y: -180)
                }
                .overlay(alignment: .bottomTrailing) {
                    Circle()
                        .fill(
                            RadialGradient(
                                colors: [
                                    GlassTheme.cyanGlow.opacity(colorScheme == .dark ? 0.09 : 0.06),
                                    Color.clear
                                ],
                                center: .center,
                                startRadius: 10,
                                endRadius: 260
                            )
                        )
                        .frame(width: 520, height: 520)
                        .drawingGroup(opaque: false)
                        .offset(x: 160, y: 160)
                }
                .transaction { $0.animation = nil }
                .allowsHitTesting(false)
        }
        .ignoresSafeArea()
    }
}

/// Attaches `LiquidGlassAmbientBackground` at the `NSWindow` container level on macOS 15+
/// so opening/closing the `NavigationSplitView` sidebar NEVER resizes or invalidates the
/// behind-window vibrancy view.
private struct WindowGlassBackdropModifier: ViewModifier {
    let accentTint: Color

    func body(content: Content) -> some View {
        if #available(macOS 15.0, *) {
            content.containerBackground(for: .window) {
                LiquidGlassAmbientBackground(accentTint: accentTint)
            }
        } else {
            content.background(LiquidGlassAmbientBackground(accentTint: accentTint))
        }
    }
}

/// Lets macOS 26+ `NavigationSplitView` provide its native hardware-accelerated Liquid Glass
/// sidebar surface without stacking a second redundant `NSVisualEffectView` on top.
private struct SidebarGlassBackdropModifier: ViewModifier {
    func body(content: Content) -> some View {
        #if compiler(>=6.2)
        if #available(macOS 26.0, *) {
            content
        } else {
            content.background(VisualEffectBackground(material: .sidebar, blendingMode: .behindWindow))
        }
        #else
        content.background(VisualEffectBackground(material: .sidebar, blendingMode: .behindWindow))
        #endif
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
                    Color.clear
                        .overlay(alignment: .topTrailing) {
                            Circle()
                                .fill(
                                    RadialGradient(
                                        colors: [
                                            accentTint.opacity(colorScheme == .dark ? 0.14 : 0.08),
                                            Color.clear
                                        ],
                                        center: .center,
                                        startRadius: 10,
                                        endRadius: 220
                                    )
                                )
                                .frame(width: 440, height: 440)
                                .drawingGroup(opaque: false)
                                .offset(x: 140, y: -140)
                        }
                        .transaction { $0.animation = nil }
                        .allowsHitTesting(false)
                }
            }
    }
}

/// Zero-backdrop-pass crystalline surface for repeating list rows, chips, and elements seated
/// *inside* a top-level Liquid Glass bar. Avoids stacking nested `CABackdropLayer` passes so
/// sidebar open/close, split resizing, and scrolling stay locked at 120fps.
private struct FrostedSurfaceModifier<S: InsettableShape>: ViewModifier {
    @Environment(\.colorScheme) private var colorScheme
    @State private var isHovered = false
    let shape: S
    let tint: Color?
    let isSelected: Bool
    let hoverable: Bool

    func body(content: Content) -> some View {
        let fillColor: Color = {
            if isSelected {
                let base = tint ?? GlassTheme.accent
                return base.opacity(colorScheme == .dark ? 0.24 : 0.16)
            }
            if hoverable && isHovered {
                let base = tint ?? Color.primary
                return base.opacity(colorScheme == .dark ? 0.13 : 0.09)
            }
            if let tint {
                return tint.opacity(colorScheme == .dark ? 0.13 : 0.10)
            }
            return colorScheme == .dark ? Color.white.opacity(0.055) : Color.white.opacity(0.45)
        }()

        let borderColor: Color = {
            if isSelected {
                return (tint ?? GlassTheme.accentBright).opacity(colorScheme == .dark ? 0.58 : 0.45)
            }
            if hoverable && isHovered {
                return (tint ?? Color.white).opacity(colorScheme == .dark ? 0.28 : 0.55)
            }
            if let tint {
                return tint.opacity(colorScheme == .dark ? 0.28 : 0.22)
            }
            return colorScheme == .dark ? Color.white.opacity(0.11) : Color.black.opacity(0.08)
        }()

        let base = content
            .background {
                shape.fill(fillColor)
            }
            .overlay {
                shape
                    .strokeBorder(borderColor, lineWidth: isSelected ? 1.0 : 0.75)
                    .allowsHitTesting(false)
            }

        if hoverable {
            base.onHover { hovering in
                if isHovered != hovering {
                    isHovered = hovering
                }
            }
        } else {
            base
        }
    }
}

/// Crisp, GPU-free translucent surface for large scrollable content panes (SQL editor & table grid).
/// Lets the behind-window macOS vibrancy gently show through without recomputing full-pane Gaussian
/// backdrop blurs on every frame of sidebar open/close or split-view resizing.
private struct FrostedContentPaneModifier: ViewModifier {
    @Environment(\.colorScheme) private var colorScheme
    let cornerRadius: CGFloat

    func body(content: Content) -> some View {
        let shape = RoundedRectangle(cornerRadius: cornerRadius, style: .continuous)
        content
            .background(
                Color(nsColor: .textBackgroundColor).opacity(colorScheme == .dark ? 0.58 : 0.74),
                in: shape
            )
            .clipShape(shape)
            .overlay {
                shape
                    .strokeBorder(GlassTheme.specularRimGradient(for: colorScheme), lineWidth: 0.75)
                    .allowsHitTesting(false)
            }
    }
}

/// Tactile crystalline button style for controls seated *inside* a Liquid Glass bar.
/// Eliminates nested `.buttonStyle(.glass)` inside `.glassEffect(...)` while preserving crisp
/// specular highlights, hover illumination, and prominent tinted primary actions.
struct FrostedControlButtonStyle: ButtonStyle {
    @Environment(\.colorScheme) private var colorScheme
    @Environment(\.isEnabled) private var isEnabled
    @State private var isHovered = false
    var prominent: Bool = false
    var tint: Color? = nil
    var circular: Bool = false

    func makeBody(configuration: Configuration) -> some View {
        let effectiveTint = tint ?? GlassTheme.accent
        let bgColor: Color = {
            if prominent {
                return effectiveTint.opacity(configuration.isPressed ? 0.76 : (isHovered ? 0.96 : 0.88))
            }
            if let tint {
                return tint.opacity(configuration.isPressed ? 0.28 : (isHovered ? 0.22 : 0.14))
            }
            if colorScheme == .dark {
                return Color.white.opacity(configuration.isPressed ? 0.20 : (isHovered ? 0.14 : 0.08))
            }
            return Color.white.opacity(configuration.isPressed ? 0.78 : (isHovered ? 0.68 : 0.50))
        }()

        let borderColor: Color = {
            if prominent {
                return Color.white.opacity(colorScheme == .dark ? 0.34 : 0.45)
            }
            if let tint {
                return tint.opacity(isHovered ? 0.45 : 0.30)
            }
            return colorScheme == .dark
                ? Color.white.opacity(isHovered ? 0.24 : 0.14)
                : Color.black.opacity(isHovered ? 0.16 : 0.09)
        }()

        let fgColor: Color = prominent ? .white : .primary

        Group {
            if circular {
                configuration.label
                    .font(.system(size: 11, weight: .semibold))
                    .foregroundStyle(fgColor)
                    .frame(width: 24, height: 24)
                    .background(Circle().fill(bgColor))
                    .overlay(Circle().strokeBorder(borderColor, lineWidth: 0.75).allowsHitTesting(false))
            } else {
                configuration.label
                    .font(.system(size: 11.5, weight: prominent ? .semibold : .medium))
                    .foregroundStyle(fgColor)
                    .padding(.horizontal, 9)
                    .padding(.vertical, 4)
                    .background(Capsule().fill(bgColor))
                    .overlay(Capsule().strokeBorder(borderColor, lineWidth: 0.75).allowsHitTesting(false))
            }
        }
        .contentShape(Capsule())
        .scaleEffect(configuration.isPressed ? 0.97 : 1.0)
        .opacity(isEnabled ? 1.0 : 0.42)
        .onHover { hovering in
            if isHovered != hovering {
                isHovered = hovering
            }
        }
    }
}

extension View {
    /// Applies Liquid Glass styling with an explicit `InsettableShape`.
    /// Reserve for top-level floating chrome landmarks — avoid nesting glass inside glass or per-row inside ScrollViews.
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

    /// Floating Liquid Glass pill (`Capsule`) for standalone top-level badges and sheet headers.
    func liquidGlassPill(
        tint: Color? = nil,
        interactive: Bool = false,
        emphasized: Bool = false
    ) -> some View {
        liquidGlass(.clear, tint: tint, interactive: interactive, emphasized: emphasized, in: Capsule())
    }

    /// Floating Liquid Glass rail/toolbar surface (top-level chrome landmark).
    func liquidGlassBar(
        cornerRadius: CGFloat = 14,
        tint: Color? = nil
    ) -> some View {
        liquidGlass(.regular, tint: tint, interactive: false, emphasized: false, in: RoundedRectangle(cornerRadius: cornerRadius, style: .continuous))
    }

    /// Liquid Glass card surface for standalone non-scrolling callouts, previews, and empty states.
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
    /// Use for standalone floating buttons (never nested inside `.liquidGlassBar`).
    func liquidGlassButton(prominent: Bool = false, tint: Color? = nil) -> some View {
        modifier(LiquidGlassButtonModifier(prominent: prominent, tint: tint))
    }

    /// Frosted Liquid Glass backdrop for modal sheets and popovers.
    func liquidGlassSheet(accentTint: Color = GlassTheme.accent) -> some View {
        modifier(LiquidGlassSheetModifier(accentTint: accentTint))
    }

    /// Native macOS 26 sidebar glass pass-through with macOS 14–15 sidebar vibrancy fallback.
    func sidebarGlassBackdrop() -> some View {
        modifier(SidebarGlassBackdropModifier())
    }

    /// Window-level behind-window Liquid Glass backdrop that stays stationary during sidebar animation.
    func windowGlassBackdrop(accentTint: Color = GlassTheme.accent) -> some View {
        modifier(WindowGlassBackdropModifier(accentTint: accentTint))
    }

    /// Zero-backdrop-pass crystalline surface for repeating rows, tiles, and elements inside a glass bar.
    func frostedSurface(
        cornerRadius: CGFloat = 10,
        tint: Color? = nil,
        isSelected: Bool = false,
        hoverable: Bool = false
    ) -> some View {
        modifier(FrostedSurfaceModifier(
            shape: RoundedRectangle(cornerRadius: cornerRadius, style: .continuous),
            tint: tint,
            isSelected: isSelected,
            hoverable: hoverable
        ))
    }

    /// Zero-backdrop-pass crystalline `Capsule` pill for badges/tabs/chips inside a glass bar or scrolling row.
    func frostedPill(
        tint: Color? = nil,
        isSelected: Bool = false,
        hoverable: Bool = false
    ) -> some View {
        modifier(FrostedSurfaceModifier(
            shape: Capsule(),
            tint: tint,
            isSelected: isSelected,
            hoverable: hoverable
        ))
    }

    /// Lightweight translucent surface for large SQL editor & results grid panes (zero live backdrop blur).
    func frostedContentPane(cornerRadius: CGFloat = 12) -> some View {
        modifier(FrostedContentPaneModifier(cornerRadius: cornerRadius))
    }

    /// Tactile crystalline button for controls seated *inside* a Liquid Glass bar (zero nested glass).
    func frostedControlButton(prominent: Bool = false, tint: Color? = nil, circular: Bool = false) -> some View {
        buttonStyle(FrostedControlButtonStyle(prominent: prominent, tint: tint, circular: circular))
    }
}
