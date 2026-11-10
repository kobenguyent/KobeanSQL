# KobeanSQL Native for macOS (SwiftUI + AppKit)

A 100% real native macOS port of **KobeanSQL** written in Swift 5.10 / 6 with **SwiftUI + AppKit** — zero Electron, zero Chromium, zero `WKWebView`.

## Architecture

- **`Sources/KobeanSQLCore/`** — Pure-Swift database core:
  - **Wire-protocol & native drivers**:
    - `SQLiteDriver` — System `libsqlite3` C API
    - `PostgresDriver` — PostgreSQL & CockroachDB via `PostgresNIO`
    - `MySQLDriver` — MySQL & MariaDB via `MySQLNIO`
    - `RedisDriver` — Redis RESP protocol via `RediStack`
    - `ClickHouseDriver`, `ElasticsearchDriver`, `Neo4jDriver`, `InfluxDBDriver` — Native `URLSession` HTTP/REST drivers
  - **Safety Guards (`QueryGuard` & `ConnectionManager`)**:
    - Auto-appends `LIMIT 1000` to unbounded `SELECT` queries
    - Caps result sets at `10,000` rows
    - Enforces `30s` query timeout, `15s` connect timeout, and max `5` pooled connections
  - **Security & Persistence (`KeychainStore` & `AppStorage`)**:
    - Passwords / tokens are stored in the **macOS Keychain** (`com.kobenguyent.kobeansql.native`), never in plaintext JSON
    - One-click **Electron Connection Importer** reads `~/Library/Application Support/kobeansql/connections.json`
  - **Local AI SQL Assistant (`AIService`)**:
    - Connects strictly to local loopback endpoints (`Ollama` at `127.0.0.1:11434` or local `OpenAI-compatible` servers at `127.0.0.1:1234/v1`)
- **`Sources/KobeanSQL/`** — Native SwiftUI + AppKit macOS application:
  - `NSVisualEffectView` desktop glassmorphism & vibrancy
  - `NSTextView`-backed SQL/Cypher/Flux code editor with live syntax highlighting and `⌘↩` execution
  - `NSTableView`-backed virtualized results grid capable of scrolling 10,000 rows smoothly, with TSV copy & CSV/JSON export
  - Built-in **Demo SQLite Database** generator (`⇧⌘D`) for instant testing without any external database server

---

## Installing on Your MacBook Pro (No Apple Developer Account Required)

### Option 1: One-Command Local Build & Install

From the repository root:

```bash
# Build, run self-tests, ad-hoc sign, strip Gatekeeper quarantine, and install to /Applications/KobeanSQL.app
npm run macos:native:install

# Or build, install, and launch immediately:
npm run macos:native:run
```

For fast debug iteration during development:

```bash
KOBEAN_NATIVE_CONFIG=debug ./scripts/install-macos-native.sh --build --launch
```

### Option 2: Open in Xcode (Sign to Run Locally)

If `xcodegen` is installed (`brew install xcodegen`), `scripts/build-macos-native.sh` automatically generates `native/macos/KobeanSQL.xcodeproj` configured with `CODE_SIGN_IDENTITY = "-"` (**Sign to Run Locally** — no paid Apple Developer Program account or Team ID required):

```bash
cd native/macos
xcodegen generate
open KobeanSQL.xcodeproj
```

### Option 3: Download Prebuilt Artifact on the Fly from GitHub Actions

Every push, pull request, or manual `workflow_dispatch` on [`.github/workflows/macos-native.yml`](../../.github/workflows/macos-native.yml) builds and uploads:
- **`KobeanSQL-macOS-native-dmg`** (`.dmg` containing `KobeanSQL.app` + `Install KobeanSQL (No Apple Dev Account).command`)
- **`KobeanSQL-macOS-native-zip`** (`.zip` containing `KobeanSQL.app`)

After downloading the artifact from GitHub Actions:
1. Open the `.dmg` and double-click **`Install KobeanSQL (No Apple Dev Account).command`**, **or**
2. Drag `KobeanSQL.app` to `/Applications` and run:
   ```bash
   xattr -cr /Applications/KobeanSQL.app && open /Applications/KobeanSQL.app
   ```
