# KobeanSQL Project Context

KobeanSQL is a cross-platform SQL client designed to manage multiple database connections through a unified interface.

## Architecture

- **Main Process**: Orchestrates database connectivity (`src/main/db/adapter.ts`) and system-level operations.
- **Renderer Process**: React-based UI. Use `src/renderer/store/` as the single source of truth for UI state.
- **IPC Bridge**: Renderer-to-main communication is handled via the IPC bridge (`src/main/ipc/index.ts`).

## Key Files Index

| File Path | Description |
| :--- | :--- |
| `src/main/db/types.ts` | Interface definitions for all database adapters. |
| `src/renderer/types/schema.ts` | TypeScript definitions for database schema models. |
| `src/main/ipc/index.ts` | Primary IPC event handlers. |
| `src/renderer/store/index.ts` | Centralized state management for the UI. |

## Standards

- **Language**: TypeScript.
- **UI**: React (functional components + hooks).
- **Testing**: Vitest.
