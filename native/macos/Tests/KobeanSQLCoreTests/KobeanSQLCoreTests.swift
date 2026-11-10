import Foundation
import KobeanSQLCore
#if canImport(XCTest)
import XCTest

final class KobeanSQLCoreTests: XCTestCase {
    func testAllCoreCapabilities() async throws {
        try await SelfTestSuite.runAll()
    }
}
#endif
