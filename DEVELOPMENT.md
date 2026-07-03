# Development

## Documentation Sync

User-facing docs are maintained across three canonical surfaces:

- `README.md`
- `docs/index.html`
- `CHANGELOG.md`

If you change visible product behavior, supported databases, setup steps, or feature coverage, update the relevant docs in the same PR and run:

```bash
npm run docs:sync:check
```

The sync check verifies that `README.md` and `docs/index.html` still mention the core product topics we expect to keep aligned.

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
npm run install:dev
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

---

## Adding a new database adapter

All adapters implement the `DatabaseAdapter` interface in `src/main/db/adapter.ts`.

### Steps

1. **Create the adapter** — add `src/main/db/adapters/<type>.ts` implementing `DatabaseAdapter`.
2. **Register the type** — add the new `DatabaseType` value to both:
   - `src/main/db/types.ts`
   - `src/renderer/src/types/index.ts`
3. **Assign a category** — add the type to `DB_CATEGORY` in both type files using one of:
   `'relational' | 'document' | 'key-value' | 'wide-column' | 'time-series' | 'graph' | 'cloud-warehouse'`
4. **Register in the manager** — add a `case` for the new type in `ConnectionManager.createAdapter()` (`src/main/db/manager.ts`).
5. **Add capabilities** — update `getCapabilitiesForType()` in `src/main/db/capabilities.ts`.
6. **Add a UI logo** — add an SVG entry to `DB_LOGOS` in `src/renderer/src/components/ConnectionModal/index.tsx`.
7. **Add color and port** — extend `DB_COLORS` and `DB_DEFAULT_PORTS` in `src/renderer/src/types/index.ts`.
8. **Write tests** — add adapter mocks and test cases to `tests/unit/db/manager.test.ts` and update `tests/unit/db/db-categories.test.ts`.

### Supported categories

| Category | Label | Use for |
|----------|-------|---------|
| `relational` | Relational SQL | Traditional RDBMS with SQL and full ACID support |
| `document` | Document NoSQL | JSON/BSON document stores and search engines |
| `key-value` | Key-Value | In-memory or persistent key-value stores |
| `wide-column` | Wide-Column | Column-family stores with sparse row schema |
| `time-series` | Time-Series | Optimised for time-stamped measurements |
| `graph` | Graph | Native graph databases with node/relationship model |
| `cloud-warehouse` | Cloud Data Warehouse | Columnar OLAP engines and managed cloud warehouses |
