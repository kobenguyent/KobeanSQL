// swift-tools-version:5.10
// KobeanSQL — native macOS app (SwiftUI + AppKit). No Electron, no web views.
import PackageDescription

let package = Package(
    name: "KobeanSQL",
    platforms: [.macOS(.v14)],
    products: [
        .executable(name: "KobeanSQL", targets: ["KobeanSQL"]),
        .library(name: "KobeanSQLCore", targets: ["KobeanSQLCore"])
    ],
    dependencies: [
        // Pure-Swift wire-protocol drivers (no C client libraries to bundle).
        .package(url: "https://github.com/vapor/postgres-nio.git", from: "1.21.0"),
        .package(url: "https://github.com/vapor/mysql-nio.git", from: "1.7.0"),
        .package(url: "https://github.com/swift-server/RediStack.git", from: "1.6.0"),
        .package(url: "https://github.com/apple/swift-nio.git", from: "2.65.0"),
        .package(url: "https://github.com/apple/swift-nio-ssl.git", from: "2.27.0"),
        // swift-log >= 1.17 uses `@nonexhaustive`, which needs a newer compiler than Swift 6.2.
        .package(url: "https://github.com/apple/swift-log.git", "1.6.0"..<"1.17.0")
    ],
    targets: [
        .target(
            name: "KobeanSQLCore",
            dependencies: [
                .product(name: "PostgresNIO", package: "postgres-nio"),
                .product(name: "MySQLNIO", package: "mysql-nio"),
                .product(name: "RediStack", package: "RediStack"),
                .product(name: "Logging", package: "swift-log"),
                .product(name: "NIOCore", package: "swift-nio"),
                .product(name: "NIOPosix", package: "swift-nio"),
                .product(name: "NIOSSL", package: "swift-nio-ssl")
            ]
        ),
        .executableTarget(
            name: "KobeanSQL",
            dependencies: ["KobeanSQLCore"]
        ),
        .testTarget(
            name: "KobeanSQLCoreTests",
            dependencies: ["KobeanSQLCore"]
        )
    ]
)
