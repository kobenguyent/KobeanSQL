import fs from 'fs'
import http from 'http'
import net from 'net'
import os from 'os'
import path from 'path'
import { afterEach, describe, expect, it } from 'vitest'
import {
  applyDetectedEngineToConfig,
  detectEngineFromFilePath,
  detectEngineFromHostname,
  detectEngineFromPort,
  detectEngineFromUri,
  parseMySQLGreeting,
  probeEndpointEngine,
  refineEngineFromServerVersion
} from '../../../src/main/db/engine-detector'
import { detectEngineFromInput } from '../../../src/renderer/src/utils/connection-uri'
import type { ConnectionConfig } from '../../../src/main/db/types'

const tempFiles: string[] = []
const activeServers: Array<net.Server | http.Server> = []

async function startTcpServer(
  onConnection: (socket: net.Socket) => void
): Promise<number> {
  const server = net.createServer(onConnection)
  activeServers.push(server)
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', () => resolve()))
  const addr = server.address() as net.AddressInfo
  return addr.port
}

async function startHttpServer(
  handler: (req: http.IncomingMessage, res: http.ServerResponse) => void
): Promise<number> {
  const server = http.createServer(handler)
  activeServers.push(server)
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', () => resolve()))
  const addr = server.address() as net.AddressInfo
  return addr.port
}

afterEach(async () => {
  while (activeServers.length > 0) {
    const srv = activeServers.pop()!
    await new Promise<void>((resolve) => srv.close(() => resolve()))
  }
  while (tempFiles.length > 0) {
    const f = tempFiles.pop()!
    try {
      fs.unlinkSync(f)
    } catch {
      // ignore
    }
  }
})

describe('Database engine auto-recognition', () => {
  it('recognizes all database engines from connection URI schemes', () => {
    expect(detectEngineFromUri('postgresql://alice:secret@db.local:5432/app')?.engine).toBe('postgres') // betterleaks:allow - test fixture
    expect(detectEngineFromUri('postgres://root@localhost:26257/defaultdb')?.engine).toBe('cockroachdb')
    expect(detectEngineFromUri('cockroachdb://root@cluster.cockroachlabs.cloud:26257/app')?.engine).toBe('cockroachdb')
    expect(detectEngineFromUri('mysql://root:pass@127.0.0.1:3306/shop')?.engine).toBe('mysql') // betterleaks:allow - test fixture
    expect(detectEngineFromUri('mariadb://root:pass@127.0.0.1:3306/shop')?.engine).toBe('mariadb') // betterleaks:allow - test fixture
    expect(detectEngineFromUri('sqlserver://sa:pass@localhost:1433/master')?.engine).toBe('mssql') // betterleaks:allow - test fixture
    expect(detectEngineFromUri('mongodb+srv://alice:secret@cluster0.mongodb.net/app')?.engine).toBe('mongodb') // betterleaks:allow - test fixture
    expect(detectEngineFromUri('rediss://default:token@redis.upstash.io:6379/0')?.engine).toBe('redis') // betterleaks:allow - test fixture
    expect(detectEngineFromUri('clickhouse://default@localhost:8123/analytics')?.engine).toBe('clickhouse')
    expect(detectEngineFromUri('cassandra://localhost:9042/ks')?.engine).toBe('cassandra')
    expect(detectEngineFromUri('elasticsearch://localhost:9200')?.engine).toBe('elasticsearch')
    expect(detectEngineFromUri('oracle+thin://system:pass@localhost:1521/ORCL')?.engine).toBe('oracle') // betterleaks:allow - test fixture
    expect(detectEngineFromUri('influxdb://localhost:8086')?.engine).toBe('influxdb')
    expect(detectEngineFromUri('neo4j+s://abc.databases.neo4j.io:7687')?.engine).toBe('neo4j')
    expect(detectEngineFromUri('snowflake://org-acct.snowflakecomputing.com/analytics')?.engine).toBe('snowflake')
    expect(detectEngineFromUri('sqlite:///tmp/example.db')?.engine).toBe('sqlite')

    // Disambiguate HTTP/HTTPS by well-known ports
    expect(detectEngineFromUri('http://localhost:8123')?.engine).toBe('clickhouse')
    expect(detectEngineFromUri('https://localhost:9200')?.engine).toBe('elasticsearch')
    expect(detectEngineFromUri('http://localhost:8086')?.engine).toBe('influxdb')
    expect(detectEngineFromUri('http://localhost:7474')?.engine).toBe('neo4j')
  })

  it('recognizes SQLite from file extension and 16-byte SQLite 3 magic header', () => {
    expect(detectEngineFromFilePath('/tmp/data/app.sqlite3')?.engine).toBe('sqlite')
    expect(detectEngineFromFilePath(':memory:')?.engine).toBe('sqlite')

    // Create a file with non-standard extension but real SQLite 3 header
    const magicFile = path.join(os.tmpdir(), `kobeansql-magic-${Date.now()}.dat`)
    fs.writeFileSync(magicFile, Buffer.concat([Buffer.from('SQLite format 3\0', 'utf8'), Buffer.alloc(32)]))
    tempFiles.push(magicFile)

    const detected = detectEngineFromFilePath(magicFile)
    expect(detected?.engine).toBe('sqlite')
    expect(detected?.source).toBe('file-magic')
  })

  it('recognizes cloud hostnames and default ports', () => {
    expect(detectEngineFromHostname('ep-cool-sun.us-east-2.aws.neon.tech')?.engine).toBe('postgres')
    expect(detectEngineFromHostname('db.xyz.supabase.co')?.suggestedSSL).toBe(true)
    expect(detectEngineFromHostname('cluster.cockroachlabs.cloud')?.engine).toBe('cockroachdb')
    expect(detectEngineFromHostname('acct.snowflakecomputing.com')?.engine).toBe('snowflake')
    expect(detectEngineFromHostname('my-redis.upstash.io')?.engine).toBe('redis')
    expect(detectEngineFromPort(5432)?.engine).toBe('postgres')
    expect(detectEngineFromPort(26257)?.engine).toBe('cockroachdb')
    expect(detectEngineFromPort(6379)?.engine).toBe('redis')
    expect(detectEngineFromPort(9200)?.engine).toBe('elasticsearch')
  })

  it('applies detected engine defaults cleanly while preserving custom user settings', () => {
    const initial: ConnectionConfig = {
      id: 'c1',
      name: 'My DB',
      type: 'postgres',
      host: 'localhost',
      port: 5432,
      user: 'postgres'
    }
    const detection = detectEngineFromUri('rediss://default@cache.upstash.io:6380/0')!
    const updated = applyDetectedEngineToConfig(initial, detection)
    expect(updated.type).toBe('redis')
    expect(updated.host).toBe('cache.upstash.io')
    expect(updated.port).toBe(6380)
    expect(updated.ssl).toBe(true)
    expect(updated.database).toBe('0')
  })

  it('refines MySQL <-> MariaDB and PostgreSQL -> CockroachDB from server version strings', () => {
    expect(refineEngineFromServerVersion('11.4.2-MariaDB-ubu2404', 'mysql')?.engine).toBe('mariadb')
    expect(refineEngineFromServerVersion('8.4.0', 'mariadb')?.engine).toBe('mysql')
    expect(refineEngineFromServerVersion('CockroachDB CCL v24.1.0 (x86_64)', 'postgres')?.engine).toBe('cockroachdb')
    expect(refineEngineFromServerVersion('PostgreSQL 16.3', 'postgres')).toBeNull()
  })

  it('parses MySQL and MariaDB v10 wire greeting packets', () => {
    const makeGreeting = (ver: string) =>
      Buffer.concat([Buffer.from([0x20, 0x00, 0x00, 0x00, 0x0a]), Buffer.from(ver, 'utf8'), Buffer.from([0x00, 0x01, 0x02, 0x03])])
    expect(parseMySQLGreeting(makeGreeting('8.4.2'), 3306)?.engine).toBe('mysql')
    expect(parseMySQLGreeting(makeGreeting('11.4.2-MariaDB'), 3306)?.engine).toBe('mariadb')
  })

  it('probes live TCP MySQL, MariaDB, PostgreSQL, and Redis wire-protocol mock servers', async () => {
    const mariaPort = await startTcpServer((socket) => {
      const packet = Buffer.concat([
        Buffer.from([0x20, 0x00, 0x00, 0x00, 0x0a]),
        Buffer.from('11.4.2-MariaDB', 'utf8'),
        Buffer.from([0x00, 0x01, 0x02, 0x03])
      ])
      socket.write(packet)
    })
    const mariaDetected = await probeEndpointEngine('127.0.0.1', mariaPort, false, 1500)
    expect(mariaDetected?.engine).toBe('mariadb')
    expect(mariaDetected?.source).toBe('wire-protocol')

    const pgPort = await startTcpServer((socket) => {
      socket.once('data', (chunk) => {
        if (chunk.length === 8 && chunk[4] === 0x04 && chunk[5] === 0xd2) {
          socket.write(Buffer.from('N', 'ascii'))
        }
      })
    })
    const pgDetected = await probeEndpointEngine('127.0.0.1', pgPort, false, 1500)
    expect(pgDetected?.engine).toBe('postgres')
    expect(pgDetected?.source).toBe('wire-protocol')

    const redisPort = await startTcpServer((socket) => {
      socket.once('data', (chunk) => {
        if (chunk.toString('utf8').startsWith('PING')) {
          socket.write('+PONG\r\n')
        }
      })
    })
    const redisDetected = await probeEndpointEngine('127.0.0.1', redisPort, false, 1500)
    expect(redisDetected?.engine).toBe('redis')
    expect(redisDetected?.source).toBe('wire-protocol')
  })

  it('probes live HTTP Elasticsearch, ClickHouse, InfluxDB, and Neo4j mock servers', async () => {
    const esPort = await startHttpServer((_req, res) => {
      res.writeHead(200, { 'Content-Type': 'application/json', 'X-Elastic-Product': 'Elasticsearch' })
      res.end(JSON.stringify({ cluster_name: 'kobean-es', version: { number: '8.14.0' } }))
    })
    expect((await probeEndpointEngine('127.0.0.1', esPort, false, 1500))?.engine).toBe('elasticsearch')

    const chPort = await startHttpServer((req, res) => {
      if (req.url === '/ping') {
        res.writeHead(200, { 'Content-Type': 'text/plain' })
        res.end('Ok.\n')
      } else {
        res.writeHead(404)
        res.end()
      }
    })
    expect((await probeEndpointEngine('127.0.0.1', chPort, false, 1500))?.engine).toBe('clickhouse')

    const influxPort = await startHttpServer((req, res) => {
      if (req.url === '/health') {
        res.writeHead(200, { 'Content-Type': 'application/json' })
        res.end(JSON.stringify({ name: 'influxdb', status: 'pass' }))
      } else {
        res.writeHead(404)
        res.end()
      }
    })
    expect((await probeEndpointEngine('127.0.0.1', influxPort, false, 1500))?.engine).toBe('influxdb')

    const neoPort = await startHttpServer((_req, res) => {
      res.writeHead(200, { 'Content-Type': 'application/json' })
      res.end(JSON.stringify({ neo4j_version: '5.20.0', bolt_direct: 'bolt://localhost:7687' }))
    })
    expect((await probeEndpointEngine('127.0.0.1', neoPort, false, 1500))?.engine).toBe('neo4j')
  })

  it('renderer helper detects engine from URI, file path, host, and port', () => {
    expect(detectEngineFromInput({ connectionUri: 'postgresql://localhost:5432/app' })?.engine).toBe('postgres')
    expect(detectEngineFromInput({ connectionUri: 'mariadb://localhost:3306/app' })?.engine).toBe('mariadb')
    expect(detectEngineFromInput({ filename: '/tmp/app.sqlite' })?.engine).toBe('sqlite')
    expect(detectEngineFromInput({ host: 'my-db.neon.tech' })?.engine).toBe('postgres')
    expect(detectEngineFromInput({ port: 6379 })?.engine).toBe('redis')
  })
})
