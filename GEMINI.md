# KobeanSQL Project Context

KobeanSQL is a cross-platform SQL client designed to manage multiple database connections through a unified interface with a modern glassmorphism aesthetic.

## Architecture

- **Main Process**: Manages system lifecycle, AI services, and database connectivity.
  - `src/main/db/adapter.ts`: Base class for database adapters.
  - `src/main/db/adapters/`: Specific implementations (Postgres, MySQL, MongoDB, etc.).
  - `src/main/ai/`: Local-only AI services (Ollama and OpenAI-compatible).
  - `src/main/local-store/`: SQLite-based persistence for query history, connection logs, and dashboard layouts.
- **Renderer Process**: React-based UI.
  - `src/renderer/src/store/`: Zustand + Immer for global state.
  - `src/renderer/src/components/`: Functional React components.
  - `src/renderer/src/hooks/useThemeClass.ts`: Standard way to apply theme classes to portals and modals.
- **IPC Bridge**: `src/main/ipc/index.ts` handles all renderer-to-main communication.

## Key Files Index

| File Path | Description |
| :--- | :--- |
| `src/main/db/types.ts` | Interface definitions for database adapters and connection configs. |
| `src/renderer/src/types/index.ts` | Shared TypeScript types for the UI. |
| `src/main/ipc/index.ts` | Primary IPC event handlers. |
| `src/renderer/src/store/index.ts` | Centralized state management (Zustand). |
| `src/renderer/src/styles/globals.css` | Global styles, including theme definitions (`.theme-light`, `.theme-matrix`, etc.). |

## Standards & Conventions

- **Language**: TypeScript (strict mode).
- **UI**: React functional components with hooks.
- **State**: Use `useAppStore` for global state. Avoid local state for data that should persist across tabs.
- **Theming**: Portals and modals must explicitly apply the current theme class using the `useThemeClass` hook to ensure styles (like Matrix or Cyberpunk) are inherited correctly.
- **AI Mandate**: AI features MUST remain local-only (Ollama/OpenAI-compat). Never introduce cloud-based AI dependencies. AI prompts should leverage `schemaContext` for accuracy.
- **Testing**: Vitest for unit tests; Playwright for E2E tests (including Schema Visualizer).
- **Icons**: Use `lucide-react`.

## Common Workflows

- **Adding a Database Adapter**: Extend `BaseAdapter` in `src/main/db/adapter.ts` and register it in the `ConnectionManager`.
- **Modifying the UI**: Ensure changes are responsive and adhere to the glassmorphism design language. Use CSS variables defined in `globals.css`.
- **IPC Additions**: Add the handler in `src/main/ipc/index.ts` and update the `window.db` type definition in `src/renderer/src/store/index.ts`.

## DB Client Architecture & Safety Rules:

When generating DB client code (Electron/React), strictly enforce these safeguards to prevent server crashes:
- **Connection Safety**: Enforce connection pooling (max limit: 5). Never create one-off connections outside the pool. Set enableKeepAlive: true.
- **OOM / Limit Guard**: Intercept unbounded SELECT queries and auto-append LIMIT 1000. Abort streams exceeding 10,000 rows.
- **Transaction / Lock Guard**: Enforce a strict 30s execution timeout (timeout: 30000). Auto-rollback open transactions when a connection is idle or released.
- **CPU / Polling Guard**: Cache information_schema metadata on first load; do not poll on tab switches. Throttle dashboard auto-refresh to a 30s minimum. Use approximate table stats for COUNT(*) on large tables.