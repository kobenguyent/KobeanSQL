# Development

## Database Schema Visualizer E2E Test System

### Architecture flow

```text
Playwright Test Controller
        |
        | seeds SQLite via scripts/setup-test-db.ts
        v
  Local SQLite DB (.sqlite)
        |
        | connection form values (renderer UI)
        v
Electron Renderer (React + React Flow)
        ^
        | IPC: db:testConnection / db:connect / db:get-schema
        |
Electron Main (ConnectionManager + SQLite adapter)
```

### E2E environment setup

```bash
npm install --ignore-scripts
npm run rebuild:sqlite
npx playwright install
```

> Linux CI/headless: run Electron Playwright tests through `xvfb-run -a` (already baked into npm scripts).

### Run commands

```bash
npm run test:e2e:visualizer
npm run test:e2e:visualizer:update
```

### Visual review lifecycle

- Documentation image output: `./docs/screenshots/database-visualizer.png`
- Snapshot baseline path: `./tests/database-visualizer.spec.ts-snapshots/`
- To refresh snapshot baselines after intentional UI/layout updates:

```bash
npm run test:e2e:visualizer:update
```

---

## Oracle Database adapter

The `oracle` database type uses the [`oracledb`](https://www.npmjs.com/package/oracledb) npm package,
which requires the **Oracle Instant Client** native libraries to be installed on the host system.

### Prerequisites

1. Download and install Oracle Instant Client (Basic or Basic Light) from  
   https://www.oracle.com/database/technologies/instant-client/downloads.html

2. Ensure the library directory is on the system library path:
   - **Linux**: add to `LD_LIBRARY_PATH` or create `/etc/ld.so.conf.d/oracle.conf`
   - **macOS**: add to `DYLD_LIBRARY_PATH`
   - **Windows**: add the directory to `PATH`

3. After installing Node.js dependencies, rebuild the native addon:
   ```bash
   npm run rebuild:sqlite  # rebuilds better-sqlite3; run the same for oracledb if needed
   npx electron-rebuild -f -w oracledb
   ```

### CI / Docker notes

- Oracle Instant Client is **not** pre-installed on standard GitHub Actions runners.
- If you need Oracle in CI, either use a self-hosted runner with Instant Client, or add an
  installation step in your workflow before running tests that require Oracle.
- Oracle-specific tests can be skipped in environments without Instant Client by checking for the
  `oracledb` module load error and marking them as pending/skipped.
