import Foundation
import KobeanSQLCore
#if canImport(XCTest)
import XCTest
import NIOCore
import NIOPosix

final class KobeanSQLCoreTests: XCTestCase {
    func testAllCoreCapabilities() async throws {
        try await SelfTestSuite.runAll()
    }

    func testLiveTCPWireProtocolProbing() async throws {
        let group = MultiThreadedEventLoopGroup(numberOfThreads: 1)
        do {
            // 1. Mock MariaDB server sending v10 greeting packet immediately upon connect
            let mariaGreeting: [UInt8] = [0x20, 0x00, 0x00, 0x00, 0x0a] + Array("11.4.2-MariaDB".utf8) + [0x00, 0x01, 0x02]
            let mariaServer = try await startMockTCPServer(group: group, initialBanner: mariaGreeting, onRead: nil)
            defer { _ = mariaServer.close() }
            let mariaPort = mariaServer.localAddress!.port!
            let mariaDetected = await DatabaseEngineDetector.probeEndpoint(host: "127.0.0.1", port: mariaPort, timeout: 1.5)
            XCTAssertEqual(mariaDetected?.engine, .mariadb)
            XCTAssertEqual(mariaDetected?.source, .wireProtocol)

            // 2. Mock PostgreSQL server replying 'N' to SSLRequest packet
            let pgServer = try await startMockTCPServer(group: group, initialBanner: nil) { bytes in
                if bytes.count == 8 && bytes[4] == 0x04 && bytes[5] == 0xd2 {
                    return [UInt8(ascii: "N")]
                }
                return nil
            }
            defer { _ = pgServer.close() }
            let pgPort = pgServer.localAddress!.port!
            let pgDetected = await DatabaseEngineDetector.probeEndpoint(host: "127.0.0.1", port: pgPort, timeout: 1.5)
            XCTAssertEqual(pgDetected?.engine, .postgres)
            XCTAssertEqual(pgDetected?.source, .wireProtocol)

            // 3. Mock Redis server replying +PONG\r\n to PING\r\n
            let redisServer = try await startMockTCPServer(group: group, initialBanner: nil) { bytes in
                if let str = String(bytes: bytes, encoding: .utf8), str.hasPrefix("PING") {
                    return Array("+PONG\r\n".utf8)
                }
                return nil
            }
            defer { _ = redisServer.close() }
            let redisPort = redisServer.localAddress!.port!
            let redisDetected = await DatabaseEngineDetector.probeEndpoint(host: "127.0.0.1", port: redisPort, timeout: 1.5)
            XCTAssertEqual(redisDetected?.engine, .redis)
            XCTAssertEqual(redisDetected?.source, .wireProtocol)

            // 4. Mock ClickHouse HTTP /ping server
            let chServer = try await startMockTCPServer(group: group, initialBanner: nil) { bytes in
                guard let req = String(bytes: bytes, encoding: .utf8) else { return nil }
                if req.hasPrefix("GET /ping ") {
                    return Array("HTTP/1.1 200 OK\r\nContent-Type: text/plain\r\nContent-Length: 4\r\nConnection: close\r\n\r\nOk.\n".utf8)
                }
                return Array("HTTP/1.1 404 Not Found\r\nContent-Length: 0\r\nConnection: close\r\n\r\n".utf8)
            }
            defer { _ = chServer.close() }
            let chPort = chServer.localAddress!.port!
            let chDetected = await DatabaseEngineDetector.probeEndpoint(host: "127.0.0.1", port: chPort, timeout: 1.5)
            XCTAssertEqual(chDetected?.engine, .clickhouse)
            XCTAssertEqual(chDetected?.source, .httpProbe)
        } catch {
            try? await group.shutdownGracefully()
            throw error
        }
        try? await group.shutdownGracefully()
    }

    private func startMockTCPServer(
        group: EventLoopGroup,
        initialBanner: [UInt8]?,
        onRead: (@Sendable ([UInt8]) -> [UInt8]?)?
    ) async throws -> Channel {
        final class MockHandler: ChannelInboundHandler, @unchecked Sendable {
            typealias InboundIn = ByteBuffer
            let initialBanner: [UInt8]?
            let onRead: (@Sendable ([UInt8]) -> [UInt8]?)?

            init(initialBanner: [UInt8]?, onRead: (@Sendable ([UInt8]) -> [UInt8]?)?) {
                self.initialBanner = initialBanner
                self.onRead = onRead
            }

            func channelActive(context: ChannelHandlerContext) {
                if let banner = initialBanner {
                    var buf = context.channel.allocator.buffer(capacity: banner.count)
                    buf.writeBytes(banner)
                    context.writeAndFlush(NIOAny(buf), promise: nil)
                }
            }

            func channelRead(context: ChannelHandlerContext, data: NIOAny) {
                var buf = unwrapInboundIn(data)
                guard let bytes = buf.readBytes(length: buf.readableBytes),
                      let reply = onRead?(bytes) else { return }
                var out = context.channel.allocator.buffer(capacity: reply.count)
                out.writeBytes(reply)
                context.writeAndFlush(NIOAny(out), promise: nil)
            }
        }

        return try await ServerBootstrap(group: group)
            .serverChannelOption(ChannelOptions.socketOption(.so_reuseaddr), value: 1)
            .childChannelInitializer { channel in
                channel.pipeline.addHandler(MockHandler(initialBanner: initialBanner, onRead: onRead))
            }
            .bind(host: "127.0.0.1", port: 0)
            .get()
    }
}
#endif
